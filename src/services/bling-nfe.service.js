const { DateTime } = require('luxon');
const { HttpError } = require('../core/http-error');
const { assertStripeAccountMarket, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { ledgerStripeAccount } = require('../core/stripe-account');
const { linePriceId, lineProductId, isShippingLine, recipeDescription, shippingProductIdsFrom } = require('../core/invoice/invoice-document');
const {
  BLING_SITUACAO,
  NFE_RETRYABLE_STATUSES,
  NFE_STATUS,
  NFE_STATUSES,
  buildNfeOrderLines,
  formatNcm,
  nfeStatusFromSituacao,
  protocolFromXml,
  situacaoLabel
} = require('../core/nfe');
const { digitsOf, parseTaxDocument } = require('../core/tax-document');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { BlingNotConnectedError } = require('../infrastructure/bling/bling-client');

const BR_ACCOUNT = 'br';
const JOB_BATCH = 10;
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const POLL_GAP_MS = 2 * 60 * 1000;
const MAX_ERROR_LENGTH = 1000;
const MAX_PAYLOAD_TEXT = 4000;
const BLING_TIMEZONE = 'America/Sao_Paulo';
const IMPORTED_PREFIX = 'bling:';
const SYNC_PAGE_SIZE = 100;
const SYNC_MAX_PAGES = 5;
const SYNC_WINDOW_DAYS = 90;
const OUTGOING_NOTE = 1;
// Only these can still take new customer data. An authorized note cannot, and neither can a denied or blocked one.
const EDITABLE_SITUACOES = new Set([BLING_SITUACAO.PENDENTE, BLING_SITUACAO.REJEITADA]);
// Sent to Bling when the note is sent or already on its way: sending again would only repeat the attempt.
const IN_FLIGHT_SITUACOES = new Set([
  BLING_SITUACAO.AGUARDANDO_RECIBO,
  BLING_SITUACAO.AGUARDANDO_PROTOCOLO,
  BLING_SITUACAO.CONSULTA_SITUACAO
]);
const ADDRESS_LINE = {
  street: ['street', 'address_line1', 'line1', 'address'],
  number: ['number'],
  complement: ['complement', 'address_line2', 'line2'],
  neighborhood: ['neighborhood'],
  city: ['city'],
  state: ['state'],
  zipcode: ['zipcode', 'postal_code', 'zipCode']
};

function money(minor) {
  return Math.round(Number(minor) || 0) / 100;
}

function normalizedAddress(source) {
  const address = {};
  for (const [field, keys] of Object.entries(ADDRESS_LINE)) {
    const key = keys.find((name) => source && String(source[name] || '').trim());
    address[field] = key ? String(source[key]).trim() : '';
  }
  return address;
}

function clipped(value) {
  if (typeof value === 'string') {
    return value.length > MAX_PAYLOAD_TEXT ? `${value.slice(0, MAX_PAYLOAD_TEXT)}…` : value;
  }
  if (Array.isArray(value)) return value.map(clipped);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clipped(item)]));
  }
  return value;
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

// A note that exists only in Bling. It has no Stripe invoice behind it, so this system shows it and never sends it.
function isImported(row) {
  return String(row.stripeInvoiceId || '').startsWith(IMPORTED_PREFIX);
}

function customerEdited(row) {
  return Boolean(row.requestPayload && row.requestPayload.customer_edited_at);
}

function canEdit(row) {
  return NFE_RETRYABLE_STATUSES.includes(row.status)
    && !isImported(row)
    && (row.blingSituacao == null || EDITABLE_SITUACOES.has(row.blingSituacao));
}

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

// What the note must carry, in Bling's names. Bling ignores an empty value, so a blank field is not a change.
function wantedContact(row) {
  const address = row.customerAddress || {};
  return {
    nome: row.customerName,
    email: row.customerEmail,
    numeroDocumento: row.customerDocument,
    endereco: {
      endereco: address.street,
      numero: address.number,
      complemento: address.complement,
      bairro: address.neighborhood,
      municipio: address.city,
      uf: address.state,
      cep: address.zipcode
    }
  };
}

function contactDiffers(current, wanted) {
  const same = (key, left, right) => (['numeroDocumento', 'cep'].includes(key)
    ? onlyDigits(left) === onlyDigits(right)
    : String(left || '').trim() === String(right || '').trim());
  const differs = (now, next) => Object.entries(next).some(([key, value]) => {
    if (value && typeof value === 'object') return differs((now && now[key]) || {}, value);
    return Boolean(value) && !same(key, now && now[key], value);
  });
  return differs(current, wanted);
}

function presentSummary(row) {
  return {
    id: row.id,
    status: row.status,
    customer_name: row.customerName,
    customer_email: row.customerEmail,
    customer_document: row.customerDocument,
    total_minor: row.totalMinor,
    currency: row.currency,
    nfe_number: row.nfeNumber,
    nfe_series: row.nfeSeries,
    access_key: row.accessKey,
    last_error: row.lastError,
    attempts: row.attempts,
    created_at: row.createdAt,
    authorized_at: row.authorizedAt,
    bling_situacao: row.blingSituacao,
    bling_situacao_label: situacaoLabel(row.blingSituacao),
    imported: isImported(row),
    can_retry: NFE_RETRYABLE_STATUSES.includes(row.status) && !isImported(row),
    can_edit: canEdit(row)
  };
}

function presentDetail(row) {
  return {
    ...presentSummary(row),
    user_id: row.userId,
    stripe_account: row.stripeAccount,
    stripe_subscription_id: row.stripeSubscriptionId,
    stripe_invoice_id: row.stripeInvoiceId,
    bling_contact_id: row.blingContactId,
    bling_order_id: row.blingOrderId,
    bling_nfe_id: row.blingNfeId,
    protocol: row.protocol,
    customer_address: row.customerAddress,
    request_payload: row.requestPayload,
    response_payload: row.responsePayload,
    danfe_url: row.danfeUrl,
    pdf_url: row.pdfUrl,
    xml_url: row.xmlUrl,
    next_attempt_at: row.nextAttemptAt,
    submitted_at: row.submittedAt,
    updated_at: row.updatedAt
  };
}

class BlingNfeService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.client = options.client || null;
    this.billingFor = options.billingFor || null;
    this.variants = options.variants || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.naturezaOperacaoId = Number(options.naturezaOperacaoId) || 0;
    this.adminAppUrl = options.adminAppUrl || '';
    this.auditService = options.auditService || null;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
    this.now = options.now || (() => new Date());
  }

  isConfigured() {
    return Boolean(this.client && this.client.isConfigured() && this.naturezaOperacaoId);
  }

  ensureReady() {
    if (!this.repository) {
      throw new HttpError(503, 'NF-e service is not available.');
    }
  }

  // What the note will carry for this customer. Without a valid CPF or CNPJ the note is blocked before any Bling call.
  async customerSnapshot(userId, invoice) {
    const customer = await this.repository.findCustomer(userId);
    const document = parseTaxDocument(customer && customer.taxDocument);
    return {
      customerName: (customer && customer.name) || (invoice && invoice.customer_name) || null,
      customerEmail: (customer && customer.email) || (invoice && invoice.customer_email) || null,
      customerDocument: document ? document.digits : null,
      customerAddress: normalizedAddress(customer && customer.address)
    };
  }

  // Called from invoice.paid after the eden_env filter and the user lookup. A repeated event finds the same row.
  async recordPaidInvoice({ invoice, account, userId, subscriptionId }) {
    if (!this.repository || account !== BR_ACCOUNT || !(Number(invoice && invoice.total) > 0)) {
      return null;
    }
    const existing = await this.repository.findByStripeInvoice(account, invoice.id);
    if (existing) {
      return existing;
    }
    const snapshot = await this.customerSnapshot(userId, invoice);
    const blocked = !snapshot.customerDocument;
    return this.repository.insertOrGet({
      ...snapshot,
      status: blocked ? NFE_STATUS.BLOCKED_MISSING_DOCUMENT : NFE_STATUS.PENDING,
      userId,
      stripeAccount: account,
      stripeSubscriptionId: subscriptionId,
      stripeInvoiceId: invoice.id,
      totalMinor: Number(invoice.total),
      currency: String(invoice.currency || 'brl').toLowerCase(),
      nextAttemptAt: blocked ? null : this.now()
    });
  }

  // The only caller of Bling for notes: one job under one lock, so a note and the rotating refresh token are never
  // handled by two processes at once.
  async runDue({ limit = JOB_BATCH } = {}) {
    if (!this.repository || !this.isConfigured()) {
      return { skipped: true };
    }
    try {
      await this.client.keepAlive();
    } catch (error) {
      if (error instanceof BlingNotConnectedError) {
        return { skipped: true, reason: 'bling_not_connected' };
      }
      this.logger.warn({ status: error && error.status }, 'Bling token could not be renewed.');
    }

    const rows = await this.repository.listDue({ now: this.now(), limit });
    let failed = 0;
    let done = 0;
    for (const row of rows) {
      try {
        if (row.status === NFE_STATUS.SUBMITTED) {
          await this.poll(row);
        } else {
          await this.emit(row);
        }
        done += 1;
      } catch (error) {
        // The connection is lost, not the note: it stays due and keeps its attempts.
        if (error instanceof BlingNotConnectedError) {
          return { scanned: rows.length, done, failed, reason: 'bling_not_connected' };
        }
        failed += 1;
        await this.recordFailure(row, error);
      }
    }
    return { scanned: rows.length, done, failed };
  }

  // Bling has no webhook for notes in its API, so the job reads the recent list. A note that did not change costs no
  // extra call. This path only reads from Bling: it never creates, sends or changes anything there.
  async syncFromBling() {
    if (!this.repository || !this.isConfigured()) {
      return { skipped: true };
    }
    const since = DateTime.fromJSDate(this.now()).setZone(BLING_TIMEZONE).minus({ days: SYNC_WINDOW_DAYS }).toISODate();
    let scanned = 0;
    let updated = 0;
    let imported = 0;
    let failed = 0;
    try {
      for (let pagina = 1; pagina <= SYNC_MAX_PAGES; pagina += 1) {
        const notes = await this.client.listNfes({
          pagina,
          limite: SYNC_PAGE_SIZE,
          tipo: OUTGOING_NOTE,
          dataEmissaoInicial: since
        });
        scanned += notes.length;
        const known = await this.repository.findByBlingNfeIds(notes.map((note) => Number(note.id)));
        for (const note of notes) {
          try {
            const row = known.get(Number(note.id));
            if (!row) {
              imported += await this.importNote(note);
            } else if (await this.syncRow(row, note)) {
              updated += 1;
            }
          } catch (error) {
            if (error instanceof BlingNotConnectedError) throw error;
            failed += 1;
            this.logger.warn({ blingNfeId: note.id, status: error && error.status }, 'NF-e status sync failed.');
          }
        }
        if (notes.length < SYNC_PAGE_SIZE) break;
      }
    } catch (error) {
      if (error instanceof BlingNotConnectedError) {
        return { skipped: true, reason: 'bling_not_connected' };
      }
      throw error;
    }
    return { scanned, updated, imported, failed };
  }

  async syncRow(row, note) {
    const situacao = Number(note.situacao);
    if (situacao === row.blingSituacao) return false;
    // Still a draft in Bling. A note of ours waiting for a retry stays in its queue, or it would never be sent.
    if (situacao === BLING_SITUACAO.PENDENTE) {
      await this.repository.update(row.id, { blingSituacao: situacao });
      return true;
    }
    await this.applyNfe(row, await this.client.getNfe(row.blingNfeId));
    return true;
  }

  async importNote(note) {
    const nfe = await this.client.getNfe(note.id);
    // Generated by a row of ours that lost its answer: emit links it, so it must not appear twice.
    if (nfe.numeroPedidoLoja && await this.repository.findByStripeInvoice(BR_ACCOUNT, nfe.numeroPedidoLoja)) {
      return 0;
    }
    const contact = nfe.contato || {};
    const address = contact.endereco || {};
    const row = await this.repository.insertOrGet({
      status: NFE_STATUS.PENDING,
      userId: null,
      stripeAccount: BR_ACCOUNT,
      stripeSubscriptionId: null,
      stripeInvoiceId: `${IMPORTED_PREFIX}${note.id}`,
      totalMinor: Math.round((Number(nfe.valorNota) || 0) * 100),
      currency: 'brl',
      customerName: contact.nome || null,
      customerEmail: contact.email || null,
      customerDocument: String(contact.numeroDocumento || '').replace(/\D/g, '').slice(0, 14) || null,
      customerAddress: normalizedAddress({
        street: address.endereco,
        number: address.numero,
        complement: address.complemento,
        neighborhood: address.bairro,
        city: address.municipio,
        state: address.uf,
        zipcode: address.cep
      }),
      nextAttemptAt: null
    });
    const issuedAt = DateTime.fromSQL(String(nfe.dataEmissao || ''), { zone: BLING_TIMEZONE });
    await this.repository.update(row.id, {
      blingNfeId: Number(note.id),
      blingContactId: contact.id ? Number(contact.id) : null,
      ...(issuedAt.isValid ? { createdAt: issuedAt.toJSDate() } : {})
    });
    await this.applyNfe(row, nfe);
    return 1;
  }

  async recordFailure(row, error) {
    const attempts = row.attempts + 1;
    // A 403 is a missing scope: only an operator changing the app can fix it, so the job stops here.
    const stop = (error && error.status === 403) || attempts >= MAX_ATTEMPTS;
    const delay = Math.min(BASE_BACKOFF_MS * (2 ** (attempts - 1)), MAX_BACKOFF_MS);
    await this.repository.update(row.id, {
      status: NFE_STATUS.ERROR,
      attempts,
      lastError: String(error && error.message ? error.message : 'nfe_failed').slice(0, MAX_ERROR_LENGTH),
      nextAttemptAt: stop ? null : new Date(this.now().getTime() + delay)
    });
    this.logger.warn({ nfeId: row.id, status: error && error.status, attempts }, 'NF-e attempt failed.');
  }

  async savePayloads(row, step, request, response) {
    row.requestPayload = { ...(row.requestPayload || {}), ...(request ? { [step]: clipped(request) } : {}) };
    row.responsePayload = { ...(row.responsePayload || {}), [step]: clipped(response) };
    await this.repository.update(row.id, { requestPayload: row.requestPayload, responsePayload: row.responsePayload });
  }

  contactPayload(row, document) {
    const address = row.customerAddress || {};
    return {
      nome: row.customerName,
      situacao: 'A',
      tipo: document.kind === 'cnpj' ? 'J' : 'F',
      indicadorIe: 9,
      numeroDocumento: document.digits,
      email: row.customerEmail,
      endereco: {
        geral: {
          endereco: address.street,
          numero: address.number,
          complemento: address.complement,
          bairro: address.neighborhood,
          municipio: address.city,
          uf: address.state,
          cep: address.zipcode
        }
      }
    };
  }

  async ensureContact(row, document) {
    if (row.blingContactId) return row.blingContactId;
    const found = await this.client.findContactByDocument(document.digits);
    let contactId = found && found.id;
    if (!contactId) {
      const payload = this.contactPayload(row, document);
      const created = await this.client.createContact(payload);
      contactId = created && created.id;
      await this.savePayloads(row, 'contact', payload, created);
    }
    row.blingContactId = contactId;
    await this.repository.update(row.id, { blingContactId: contactId });
    return contactId;
  }

  async ensureProduct(item) {
    const found = await this.client.findProductByCode(item.code);
    if (found && found.id) {
      await this.alignProductTaxes(found.id, item);
      return found.id;
    }
    if (!item.ncm) {
      throw new Error(`Product ${item.code} has no NCM in the catalog.`);
    }
    const created = await this.client.createProduct({
      nome: item.description.slice(0, 120),
      codigo: item.code,
      preco: money(item.unitMinor),
      tipo: 'P',
      situacao: 'A',
      formato: 'S',
      unidade: 'UN',
      tributacao: { origem: item.origin, ncm: formatNcm(item.ncm) }
    });
    return created.id;
  }

  // The catalog owns NCM and origin. A product without a catalog NCM keeps what Bling has.
  async alignProductTaxes(productId, item) {
    if (!item.ncm) return;
    const product = await this.client.getProduct(productId);
    const taxes = (product && product.tributacao) || {};
    if (digitsOf(taxes.ncm) === item.ncm && Number(taxes.origem) === item.origin) return;
    await this.client.updateProduct(productId, { tributacao: { origem: item.origin, ncm: formatNcm(item.ncm) } });
  }

  async invoiceLines(invoice) {
    const lines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
    const variants = this.variants ? await this.variants.findVariantsByPriceIds(lines.map(linePriceId)) : new Map();
    return lines.map((line) => {
      const variant = variants.get(linePriceId(line));
      const label = variant && recipeDescription(variant, 'pt-BR', 'BR');
      return {
        ...line,
        amountMinor: line.amount,
        // The variation id: the catalog SKU repeats between variations and some variations have none.
        code: variant ? `EDEN-${variant.variationId}` : String(lineProductId(line) || linePriceId(line) || 'EDEN-ITEM'),
        ncm: (variant && variant.ncm) || null,
        origin: (variant && variant.origin) || 0,
        description: String(label || line.description || 'Eden Bowls')
      };
    });
  }

  async orderPayload(row, contactId) {
    const billing = this.billingFor(row.stripeAccount);
    const invoice = await billing.retrieveInvoiceWithLines(row.stripeInvoiceId);
    const shippingIds = shippingProductIdsFrom(invoice, [billing.shippingProductId]);
    const order = buildNfeOrderLines({
      lines: await this.invoiceLines(invoice),
      totalMinor: Number(invoice.total),
      isShipping: (line) => isShippingLine(line, shippingIds)
    });
    if (!order.items.length) {
      throw new Error('The Stripe invoice has no product line to bill.');
    }
    const paidAt = invoice.status_transitions && invoice.status_transitions.paid_at;
    const day = (paidAt ? DateTime.fromSeconds(Number(paidAt)) : DateTime.fromJSDate(this.now()))
      .setZone(BLING_TIMEZONE)
      .toISODate();

    const itens = [];
    for (const item of order.items) {
      itens.push({
        produto: { id: await this.ensureProduct(item) },
        codigo: item.code,
        descricao: item.description,
        unidade: 'UN',
        quantidade: item.quantity,
        valor: money(item.unitMinor),
        naturezaOperacao: { id: this.naturezaOperacaoId }
      });
    }

    return {
      numeroLoja: row.stripeInvoiceId,
      data: day,
      dataSaida: day,
      dataPrevista: day,
      contato: { id: contactId },
      itens,
      ...(order.freightMinor ? { transporte: { fretePorConta: 0, frete: money(order.freightMinor) } } : {}),
      ...(order.discountMinor ? { desconto: { valor: money(order.discountMinor), unidade: 'REAL' } } : {}),
      ...(order.otherExpensesMinor ? { outrasDespesas: money(order.otherExpensesMinor) } : {}),
      observacoesInternas: `Stripe ${row.stripeInvoiceId}`
    };
  }

  // numeroLoja is the Stripe invoice id: a create that timed out on our side is found here and not sent twice.
  async ensureOrder(row, contactId) {
    if (row.blingOrderId) return row.blingOrderId;
    const found = await this.client.findOrderByStoreNumber(row.stripeInvoiceId);
    let orderId = found && found.id;
    if (!orderId) {
      const payload = await this.orderPayload(row, contactId);
      const created = await this.client.createOrder(payload);
      orderId = created && created.id;
      await this.savePayloads(row, 'order', payload, created);
    }
    row.blingOrderId = orderId;
    await this.repository.update(row.id, { blingOrderId: orderId });
    return orderId;
  }

  async ensureNfe(row, orderId) {
    if (row.blingNfeId) return row.blingNfeId;
    const order = await this.client.getOrder(orderId);
    let nfeId = order && order.notaFiscal && order.notaFiscal.id;
    if (!nfeId) {
      const generated = await this.client.generateNfe(orderId);
      nfeId = generated && (generated.idNotaFiscal || (generated.data && generated.data.idNotaFiscal));
      await this.savePayloads(row, 'nfe', null, generated);
    }
    if (!nfeId) {
      throw new Error('Bling generated no NF-e for the order.');
    }
    row.blingNfeId = nfeId;
    await this.repository.update(row.id, { blingNfeId: nfeId });
    return nfeId;
  }

  async applyNfe(row, nfe, { message } = {}) {
    const imported = isImported(row);
    const status = imported && Number(nfe.situacao) === BLING_SITUACAO.PENDENTE
      ? NFE_STATUS.PENDING
      : nfeStatusFromSituacao(nfe.situacao);
    const now = this.now();
    const xml = nfe.xml || '';
    await this.savePayloads(row, 'status', null, nfe);
    await this.repository.update(row.id, {
      status,
      blingSituacao: nfe.situacao == null ? null : Number(nfe.situacao),
      nfeNumber: nfe.numero == null ? row.nfeNumber : String(nfe.numero),
      nfeSeries: nfe.serie == null ? row.nfeSeries : String(nfe.serie),
      accessKey: nfe.chaveAcesso || row.accessKey,
      protocol: nfe.protocolo || protocolFromXml(xml) || row.protocol,
      danfeUrl: nfe.linkDanfe || row.danfeUrl,
      pdfUrl: nfe.linkPDF || row.pdfUrl,
      xmlUrl: isUrl(xml) ? xml : row.xmlUrl,
      lastError: status === NFE_STATUS.REJECTED
        ? String(message || `Bling: ${situacaoLabel(nfe.situacao) || nfe.situacao}`).slice(0, MAX_ERROR_LENGTH)
        : null,
      nextAttemptAt: status === NFE_STATUS.SUBMITTED && !imported ? new Date(now.getTime() + POLL_GAP_MS) : null,
      ...(status === NFE_STATUS.AUTHORIZED ? { authorizedAt: now } : {})
    });
    return status;
  }

  // The operator's correction reaches Bling here, inside the job, because only the job may use the rotating token.
  // Bling answers PUT with the whole note in mind: what comes from GET goes back, minus what it computes itself.
  async applyCustomerEdit(row, nfeId) {
    if (!customerEdited(row)) return;
    const current = await this.client.getNfe(nfeId);
    if (!EDITABLE_SITUACOES.has(Number(current.situacao))) return;
    const wanted = wantedContact(row);
    if (!contactDiffers(current.contato, wanted)) return;
    const { id, situacao, chaveAcesso, xml, linkDanfe, linkPDF, ...editable } = current;
    const payload = {
      ...editable,
      contato: {
        ...current.contato,
        nome: wanted.nome || current.contato.nome,
        email: wanted.email || current.contato.email,
        numeroDocumento: wanted.numeroDocumento || current.contato.numeroDocumento,
        endereco: {
          ...current.contato.endereco,
          ...Object.fromEntries(Object.entries(wanted.endereco).filter(([, value]) => value))
        }
      }
    };
    const updated = await this.client.updateNfe(nfeId, payload);
    await this.savePayloads(row, 'edit', { contato: payload.contato }, updated);
  }

  async send(row, nfeId) {
    const current = await this.client.getNfe(nfeId);
    const situacao = Number(current && current.situacao);
    const alreadyGone = IN_FLIGHT_SITUACOES.has(situacao)
      || nfeStatusFromSituacao(situacao) === NFE_STATUS.AUTHORIZED;
    if (alreadyGone) {
      return this.applyNfe(row, current);
    }

    try {
      await this.client.sendNfe(nfeId);
    } catch (error) {
      if (error instanceof BlingNotConnectedError || error.status === 403) throw error;
      // SEFAZ refuses through the same call: the note then reads as rejected and this message says why.
      const after = await this.client.getNfe(nfeId);
      if (Number(after && after.situacao) === BLING_SITUACAO.REJEITADA) {
        await this.repository.update(row.id, { attempts: row.attempts + 1, submittedAt: this.now() });
        return this.applyNfe(row, after, { message: error.message });
      }
      throw error;
    }
    await this.repository.update(row.id, { attempts: row.attempts + 1, submittedAt: this.now() });
    return this.applyNfe(row, await this.client.getNfe(nfeId));
  }

  async emit(row) {
    const document = parseTaxDocument(row.customerDocument);
    if (!document) {
      await this.repository.update(row.id, { status: NFE_STATUS.BLOCKED_MISSING_DOCUMENT, nextAttemptAt: null });
      return NFE_STATUS.BLOCKED_MISSING_DOCUMENT;
    }
    const contactId = await this.ensureContact(row, document);
    const orderId = await this.ensureOrder(row, contactId);
    const nfeId = await this.ensureNfe(row, orderId);
    await this.applyCustomerEdit(row, nfeId);
    return this.send(row, nfeId);
  }

  async poll(row) {
    const nfe = await this.client.getNfe(row.blingNfeId);
    return this.applyNfe(row, nfe);
  }

  assertMarket(row, actor) {
    if (shouldEnforceMarketScope(actor)) {
      assertStripeAccountMarket(actor, row.stripeAccount);
    }
  }

  async requireRow(id, actor) {
    this.ensureReady();
    const row = await this.repository.findById(id);
    if (!row) {
      throw new HttpError(404, 'NF-e not found.', { code: 'nfe_not_found' });
    }
    this.assertMarket(row, actor);
    return row;
  }

  async list(filters = {}, pagination = {}, actor = {}) {
    this.ensureReady();
    if (filters.status && !NFE_STATUSES.includes(filters.status)) {
      throw new HttpError(422, 'Invalid status.', { code: 'invalid_status' });
    }
    if (shouldEnforceMarketScope(actor)) {
      assertStripeAccountMarket(actor, BR_ACCOUNT);
    }
    const { items, total } = await this.repository.list({ ...filters, stripeAccount: BR_ACCOUNT, ...pagination });
    return { success: true, data: paginatedEnvelope({ items: items.map(presentSummary), total, ...pagination }) };
  }

  async detail(id, actor = {}) {
    return { success: true, data: presentDetail(await this.requireRow(id, actor)) };
  }

  // Back to pending for the job. A note that has no Bling contact yet takes the customer's current data, which is
  // how a blocked note picks up the document saved after it was recorded.
  async retry(id, actor = {}) {
    const row = await this.requireRow(id, actor);
    if (!NFE_RETRYABLE_STATUSES.includes(row.status) || isImported(row)) {
      throw new HttpError(409, 'This NF-e cannot be retried in its current status.', { code: 'nfe_not_retryable' });
    }
    if (!row.blingContactId && !customerEdited(row)) {
      const snapshot = await this.customerSnapshot(row.userId, null);
      await this.repository.update(row.id, {
        ...snapshot,
        customerName: snapshot.customerName || row.customerName,
        customerEmail: snapshot.customerEmail || row.customerEmail
      });
      if (!snapshot.customerDocument) {
        return { success: true, data: presentDetail(await this.repository.findById(row.id)) };
      }
    }
    if (!(await this.repository.requeue(row.id, { now: this.now() }))) {
      throw new HttpError(409, 'This NF-e cannot be retried in its current status.', { code: 'nfe_not_retryable' });
    }
    await this.repository.update(row.id, { lastError: null });
    return { success: true, data: presentDetail(await this.repository.findById(row.id)) };
  }

  // Saved here and sent by the job on the next retry. Nothing reaches Bling or SEFAZ from this call.
  async updateCustomer(id, input, actor = {}) {
    const row = await this.requireRow(id, actor);
    if (!canEdit(row)) {
      throw new HttpError(409, 'This NF-e cannot be changed in its current status.', { code: 'nfe_not_editable' });
    }
    const documentChanged = input.document !== row.customerDocument;
    await this.repository.update(row.id, {
      customerName: input.name,
      customerEmail: input.email,
      customerDocument: input.document,
      customerAddress: input.address,
      requestPayload: { ...(row.requestPayload || {}), customer_edited_at: this.now().toISOString() },
      // Before the order exists, the contact can still be found again by the new document.
      ...(documentChanged && !row.blingOrderId ? { blingContactId: null } : {})
    });
    if (this.auditService) {
      await this.auditService.record({
        actor,
        action: 'nfe.customer.update',
        targetUserId: row.userId,
        targetEmail: null,
        metadata: { nfeId: row.id, documentChanged }
      });
    }
    return { success: true, data: presentDetail(await this.repository.findById(row.id)) };
  }

  async listForSubscription(subscriptionId, actor = {}) {
    this.ensureReady();
    const item = this.ledgerRepository ? await this.ledgerRepository.findById(subscriptionId) : null;
    if (!item) {
      throw new HttpError(404, 'Subscription not found.');
    }
    if (shouldEnforceMarketScope(actor)) {
      assertStripeAccountMarket(actor, ledgerStripeAccount(item));
    }
    const rows = await this.repository.listBySubscription(item.stripeSubscriptionId);
    return { success: true, data: { items: rows.map(presentSummary) } };
  }

  async connectionStatus() {
    const configured = this.isConfigured();
    return { success: true, data: { configured, connected: configured && await this.client.isConnected() } };
  }

  async authorizeUrl() {
    if (!this.isConfigured()) {
      throw new HttpError(503, 'Bling is not configured.', { code: 'bling_not_configured' });
    }
    return { success: true, data: { authorize_url: await this.client.buildAuthorizeUrl() } };
  }

  // The public OAuth callback: the state is checked before the code goes anywhere, and the operator lands back on
  // the panel with no token in the URL.
  async handleOAuthCallback({ code, state }) {
    const target = (result) => `${this.adminAppUrl}/operations/nfe?bling=${result}`;
    if (!this.isConfigured() || !code || !state || !(await this.client.consumeState(String(state)))) {
      return target('invalid');
    }
    try {
      await this.client.exchangeCode(String(code));
      return target('connected');
    } catch (error) {
      this.logger.error({ status: error && error.status }, 'Bling authorization failed.');
      return target('failed');
    }
  }
}

module.exports = {
  BlingNfeService
};
