const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');
const { withTimeout } = require('../core/with-timeout');
const { startScheduler } = require('../core/job-scheduler');
const { BackgroundJobCursorRepository } = require('../infrastructure/repositories/background-job-cursor.repository');
const { DeliveryCalendarStripeSyncsRepository } = require('../infrastructure/repositories/delivery-calendar-stripe-syncs.repository');
const { DeliveryCalendarStripeSyncService } = require('./delivery-calendar-stripe-sync.service');

const UPS_TRACK_CAP_MS = 10 * 1000;
const UPS_TRACK_BATCH = 20;
const RECONCILE_PAGE_SIZE = 50;
const RECONCILE_TIMEOUT_MS = 15 * 1000;
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const JOB_INTERVALS = {
  webhook_retry: 60 * 1000,
  ledger_reconcile: 60 * 60 * 1000,
  mail_resend: 5 * 60 * 1000,
  invoice_email: 5 * 60 * 1000,
  ups_tracking: 30 * 60 * 1000,
  refresh_cleanup: DAY_MS,
  webhook_retention: DAY_MS,
  delivery_calendar_stripe_sync: 60 * 1000
};

const LOCKS = {
  webhook_retry: 'eden_job_webhook_retry',
  ledger_reconcile: 'eden_job_ledger_reconcile',
  mail_resend: 'eden_job_mail_resend',
  invoice_email: 'eden_job_invoice_email',
  ups_tracking: 'eden_job_ups_tracking',
  refresh_cleanup: 'eden_job_refresh_cleanup',
  webhook_retention: 'eden_job_webhook_retention',
  delivery_calendar_stripe_sync: 'eden_job_delivery_calendar_stripe_sync'
};

function upsTrackTimeoutMs(clientTimeoutMs) {
  const client = Number(clientTimeoutMs) > 0 ? Number(clientTimeoutMs) : 5000;
  return Math.min(UPS_TRACK_CAP_MS, client);
}

function customerId(remote) {
  if (!remote || remote.customer == null) {
    return '';
  }
  if (typeof remote.customer === 'string') {
    return remote.customer;
  }
  return remote.customer.id || '';
}

async function runLedgerReconcile(deps) {
  const cursorRepository = deps.cursorRepository;
  const cursor = Number(await cursorRepository.get('ledger_reconcile')) || 0;
  const rows = await deps.ledgerRepository.listAfterId(cursor, RECONCILE_PAGE_SIZE);
  if (!rows.length) {
    if (cursor !== 0) {
      await cursorRepository.set('ledger_reconcile', '0');
    }
    return { scanned: 0, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;
  let lastId = cursor;
  for (const item of rows) {
    lastId = item.id;
    try {
      const billing = resolveStripeBilling(deps, item.stripeAccount || 'us');
      const stripe = billing.ensureClient();
      const remote = await withTimeout(
        stripe.subscriptions.retrieve(item.stripeSubscriptionId),
        RECONCILE_TIMEOUT_MS
      );
      await deps.ledgerRepository.upsert({
        stripeSubscriptionId: remote.id,
        stripeCustomerId: customerId(remote) || item.stripeCustomerId,
        stripeAccount: item.stripeAccount || 'us',
        status: remote.status,
        currentPeriodStart: remote.current_period_start,
        currentPeriodEnd: remote.current_period_end,
        cancelAtPeriodEnd: Boolean(remote.cancel_at_period_end),
        userId: item.userId,
        customerEmail: item.customerEmail
      });
      updated += 1;
    } catch (_error) {
      failed += 1;
    }
  }

  const more = rows.length === RECONCILE_PAGE_SIZE && await deps.ledgerRepository.hasIdAfter(lastId);
  await cursorRepository.set('ledger_reconcile', more ? String(lastId) : '0');
  return { scanned: rows.length, updated, failed };
}

async function runUpsTracking(deps) {
  const timeoutMs = upsTrackTimeoutMs(deps.upsClient && deps.upsClient.timeoutMs);
  const rows = await deps.upsShipmentRepository.listOpenForTracking(UPS_TRACK_BATCH);
  let updated = 0;
  let failed = 0;
  let scanned = 0;

  for (const row of rows) {
    if (!row.tracking_number || row.status === 'delivered' || row.status === 'voided') {
      continue;
    }
    scanned += 1;
    try {
      const payload = await deps.upsClient.track(row.tracking_number, { timeoutMs });
      await deps.upsShipmentRepository.updateTracking(row.id, row.tracking_number, payload);
      updated += 1;
    } catch (error) {
      failed += 1;
      if (deps.logger) {
        deps.logger.warn({
          shipmentId: row.id,
          code: error && error.details && error.details.code,
          status: error && error.details && error.details.status
        }, 'UPS tracking refresh failed.');
      }
    }
  }

  return { scanned, updated, failed };
}

async function runRefreshCleanup(deps, now = new Date()) {
  const deleted = await deps.refreshTokenRepository.deleteExpired(now);
  return { deleted };
}

async function runWebhookRetention(deps, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const deleted = await deps.eventsRepository.deleteProcessedBefore(cutoff);
  return { deleted };
}

function deliveryCalendarSyncService(deps) {
  if (deps.deliveryCalendarSyncService) return deps.deliveryCalendarSyncService;
  return new DeliveryCalendarStripeSyncService({
    repository: deps.deliveryCalendarSyncsRepository || new DeliveryCalendarStripeSyncsRepository(deps.dataSource),
    billingFor: (market) => resolveStripeBilling(deps, String(market || 'us').toLowerCase()),
    maxAttempts: deps.deliveryCalendarSyncMaxAttempts,
    logger: deps.logger
  });
}

function createJobDefinitions(deps) {
  return [
    {
      name: 'webhook_retry',
      lockName: LOCKS.webhook_retry,
      intervalMs: JOB_INTERVALS.webhook_retry,
      run: () => deps.stripeWebhookService.retryPending()
    },
    {
      name: 'ledger_reconcile',
      lockName: LOCKS.ledger_reconcile,
      intervalMs: JOB_INTERVALS.ledger_reconcile,
      run: () => runLedgerReconcile(deps)
    },
    {
      name: 'mail_resend',
      lockName: LOCKS.mail_resend,
      intervalMs: JOB_INTERVALS.mail_resend,
      run: () => deps.transactionalMailer.resendUnsent()
    },
    {
      name: 'invoice_email',
      lockName: LOCKS.invoice_email,
      intervalMs: JOB_INTERVALS.invoice_email,
      run: () => (deps.customerInvoicesService ? deps.customerInvoicesService.sendDueEmails() : { skipped: true })
    },
    {
      name: 'ups_tracking',
      lockName: LOCKS.ups_tracking,
      intervalMs: JOB_INTERVALS.ups_tracking,
      run: () => runUpsTracking(deps)
    },
    {
      name: 'refresh_cleanup',
      lockName: LOCKS.refresh_cleanup,
      intervalMs: JOB_INTERVALS.refresh_cleanup,
      run: () => runRefreshCleanup(deps)
    },
    {
      name: 'webhook_retention',
      lockName: LOCKS.webhook_retention,
      intervalMs: JOB_INTERVALS.webhook_retention,
      run: () => runWebhookRetention(deps)
    },
    {
      name: 'delivery_calendar_stripe_sync',
      lockName: LOCKS.delivery_calendar_stripe_sync,
      intervalMs: JOB_INTERVALS.delivery_calendar_stripe_sync,
      run: () => deliveryCalendarSyncService(deps).runDue()
    }
  ];
}

function startBackgroundJobs(deps) {
  const cursorRepository = deps.cursorRepository || new BackgroundJobCursorRepository(deps.dataSource);
  const jobs = createJobDefinitions({ ...deps, cursorRepository });
  return startScheduler({
    jobs,
    dataSource: deps.dataSource,
    logger: deps.logger
  });
}

module.exports = {
  LOCKS,
  JOB_INTERVALS,
  UPS_TRACK_BATCH,
  RECONCILE_PAGE_SIZE,
  RECONCILE_TIMEOUT_MS,
  RETENTION_DAYS,
  upsTrackTimeoutMs,
  runLedgerReconcile,
  runUpsTracking,
  runRefreshCleanup,
  runWebhookRetention,
  createJobDefinitions,
  startBackgroundJobs
};
