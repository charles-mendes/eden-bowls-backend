const fs = require('fs');
const path = require('path');
const {
  STRIPE_WEBHOOK_EVENTS,
  isSubscribedStripeEvent
} = require('../src/infrastructure/stripe/stripe-webhook-events');

const DOC_PATH = path.resolve(__dirname, '../docs-new/FEATURE_STRIPE_SEPARAR_PAISES/COMO-CONFIGURAR-STRIPE.md');

function readSection8() {
  const doc = fs.readFileSync(DOC_PATH, 'utf8');
  const start = doc.search(/^## 8\. /m);
  if (start < 0) {
    throw new Error('Section 8 heading not found in COMO-CONFIGURAR-STRIPE.md.');
  }
  const rest = doc.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

function sorted(values) {
  return [...values].sort();
}

describe('STRIPE_WEBHOOK_EVENTS', () => {
  const section = readSection8();

  test('has 29 unique events', () => {
    expect(STRIPE_WEBHOOK_EVENTS).toHaveLength(29);
    expect(new Set(STRIPE_WEBHOOK_EVENTS).size).toBe(29);
  });

  test('matches the copy-paste block in section 8 of the Stripe setup doc', () => {
    const block = section.match(/```text\n([\s\S]*?)```/);
    expect(block).not.toBeNull();
    const fromBlock = block[1].split('\n').map((line) => line.trim()).filter(Boolean);

    expect(sorted(fromBlock)).toEqual(sorted(STRIPE_WEBHOOK_EVENTS));
  });

  test('matches the event tables in section 8 of the Stripe setup doc', () => {
    const fromTables = [...section.matchAll(/^\| `([a-z_.]+)` \|/gm)].map((match) => match[1]);

    expect(sorted(fromTables)).toEqual(sorted(STRIPE_WEBHOOK_EVENTS));
  });

  test('states the event count the doc asks the operator to subscribe', () => {
    expect(section).toContain(`**estes ${STRIPE_WEBHOOK_EVENTS.length} eventos**`);
  });

  test('tells subscribed events from the rest', () => {
    expect(isSubscribedStripeEvent('invoice.paid')).toBe(true);
    expect(isSubscribedStripeEvent('payment_intent.processing')).toBe(true);
    expect(isSubscribedStripeEvent('balance.available')).toBe(false);
    expect(isSubscribedStripeEvent(undefined)).toBe(false);
  });
});
