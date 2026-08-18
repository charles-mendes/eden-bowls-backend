# Rota alvo: Stripe webhook

## Escopo

Rota legado WordPress:

- `POST /custom/v1/stripe-webhook`

Rota alvo Node:

- `POST /stripe/v1/webhook`

**Nao existe no Express hoje.** O Place Order real (`StripeBillingClient.createOnboardingSubscription`) e o ACK ja rodam; a cobranca so fecha neste POST.

Origem: Stripe (nao o front). Consumidores posteriores: `GET /subscriptions`, eligibility de 1a compra, actions/edit.

Arquivos a criar:

- `src/api/routes/stripe-webhook.routes.js` — `registerStripeWebhookRoutes`
- `src/services/stripe-webhook.service.js` — `StripeWebhookService.handle`
- `src/infrastructure/repositories/stripe-webhook-events.repository.js`
- `src/infrastructure/repositories/subscription-ledger.repository.js` (compartilhado)
- `tests/stripe-webhook.routes.test.js`
- `tests/stripe-webhook.service.test.js`

Estender:

- `src/infrastructure/stripe/stripe-billing-client.js` — `constructEvent`, `addShippingInvoiceItem`, `retrieveSubscription`
- `src/app.js` — raw body + registro da rota
- `src/index.js` — wiring
- `src/config/env.js` — `STRIPE_WEBHOOK_SECRET`

## Responsabilidade

Receber eventos Stripe, verificar assinatura, processar **uma vez** e atualizar o estado local.

Nao e chamada pelo `Checkout.tsx`. Se o ACK falhar apos `confirmCardPayment`, a UI assume que **este** webhook converge `payment_state`.

## Auth

Publica. **Sem JWT**. Auth = header `Stripe-Signature` + `STRIPE_WEBHOOK_SECRET`.

Path **fora** de `/api/v1`: `buildBearerTokenMiddleware` ja faz `next()` se `!request.path.startsWith('/api/v1')` — igual `/shipping/v1/*` e `/health`.

Body: **raw** (`application/json` bytes). Montar `express.raw` **antes** de `express.json()` em `src/app.js` (ver [APLICACAO_POS_CHECKOUT.md](./APLICACAO_POS_CHECKOUT.md) secao 8).

| Falha | Status |
|---|---|
| `STRIPE_WEBHOOK_SECRET` ausente | 503 `{ received: false }` — nao derrubar o resto da API |
| sem `Stripe-Signature` / secret errado | 400 |
| evento desconhecido | 200 (ignorar) |
| `evt_` ja processado | 200 sem reexecutar |

## Eventos que o Node precisa

### 1) `invoice.paid` — obrigatorio agora

Resolver `user_id` nesta ordem:

1. `invoice.subscription` / `parent.subscription_details.subscription` → `onboarding_user_state.checkout_reference.stripe_subscription_id`
2. `invoice.customer` (`cus_`) → `StripeCustomerStore` (scan por user e meta `_hsr_stripe_customer_id`) — preferir gravar `user_id` na metadata da sub no checkout para evitar scan
3. `subscription.metadata.wp_user_id` (checkout ja grava)

Depois:

1. UPSERT ledger (`status = active`, periodos, price, last4 se vierem).
2. UPDATE `checkout_reference.payment_state = paid` (mesmo se ACK ja escreveu).
3. Se `edit_payment_pending` e a invoice e a de prorrata (`edit_pending.invoice_id`): limpar pendencia e promover `plan_selection` / termo / shipping do `edit_pending`.
4. Idempotente: segundo `invoice.paid` da mesma invoice nao duplica ledger.

Sem este evento, Meu Plano fica vazio e a 2a compra ainda pode receber cupom de 1a.

**Nao** criar pedido Woo. **Nao** gravar `client_secret` no ledger.

### 2) `invoice.created` — obrigatorio para o 2o ciclo

O checkout Node so coloca frete na **1a** invoice (`add_invoice_items`). Ciclos seguintes **somem o frete** se este handler nao existir.

Alvo: se `billing_reason === 'subscription_cycle'` (nao `subscription_create`), invoice `status === 'draft'`, e a sub/ledger tiver shipping persistido, chamar `invoiceItems.create` com o product `STRIPE_SHIPPING_PRODUCT_ID` **antes** da invoice fechar.

Checkout precisa gravar na metadata da Subscription (hoje so tem `wp_user_id` + `source`):

```text
shipping_amount_minor
shipping_currency
shipping_product_id
```

Sem metadata/ledger de shipping → no-op.

### 3) `payment_intent.succeeded` / `processing`

Atualizar `checkout_reference` (id + status). **Nao** tratar como substituto de `invoice.paid`. **Nao** limpar `client_secret` (o ACK settled e quem limpa no fluxo de onboarding).

### 4) `payment_intent.payment_failed` / `invoice.payment_failed`

Corrige ACK otimista. `payment_state = failed` no `checkout_reference` se a sub ainda nao estiver `active` no ledger. Webhook **nao** rebaixa `paid` se o ledger ja estiver `active`.

### 5) `customer.subscription.updated` / `deleted`

Fecha actions e edit commit. Atualizar ledger (`status`, `cancel_at_period_end`, periodos, items). Sem isso, `pending_webhook_confirmation: true` nunca converge.

Mapear status Stripe → ledger:

| Stripe | Ledger / front |
|---|---|
| `active` | `active` |
| `paused` / `pause_collection` | `paused` |
| `canceled` / `incomplete_expired` | `canceled` |
| `past_due` / `unpaid` | `past_due` |
| `incomplete` | `incomplete` |
| `trialing` | `trialing` |

## Fluxo alvo

```mermaid
sequenceDiagram
    participant Stripe
    participant RT as POST /stripe/v1/webhook
    participant SV as StripeWebhookService
    participant EVT as stripe_webhook_events
    participant ST as onboarding_user_state
    participant LED as stripe_subscriptions

    Stripe->>RT: POST + Stripe-Signature
    RT->>SV: billing.constructEvent(rawBody, sig, secret)
    SV->>EVT: insert evt_ (unique)
    alt duplicate
        SV-->>Stripe: 200 { received: true }
    end
    alt invoice.paid
        SV->>ST: payment_state paid
        SV->>LED: upsert active
    end
    alt invoice.created
        SV->>Stripe: invoiceItems.create shipping
    end
    SV-->>Stripe: 200 { received: true }
```

Responder **200 rapido**. Falha de negocio depois de verificar a assinatura: logar e ainda 200 se o retry da Stripe ia duplicar efeito; 500 so se o processamento for seguro de retentar (insert do `evt_` ainda nao commitado). Ordem sugerida: verificar assinatura → insert `evt_` → processar. Duplicate key no insert → return 200.

## Relacao com ACK

| | ACK | Webhook `invoice.paid` |
|---|---|---|
| Quem chama | front autenticado | Stripe |
| Confia no status? | body do cliente | evento assinado |
| Marca UI paid? | sim (otimista) | nao fala com UI |
| Cria ledger / fecha dominio? | **nao** | **sim** |

## Request

```http
POST /stripe/v1/webhook
Stripe-Signature: t=...,v1=...
Content-Type: application/json
```

Body: evento Stripe cru (`id`, `type`, `data.object`).

## Response

```json
{ "received": true }
```

Nao usar o envelope `{ success, data }` do resto da API.

## Controller

```js
function registerStripeWebhookRoutes(app, dependencies = {}) {
  app.post('/stripe/v1/webhook', async (request, response, next) => {
    // request.body e Buffer
    const result = await dependencies.stripeWebhookService.handle({
      rawBody: request.body,
      signature: request.headers['stripe-signature']
    });
    response.status(200).json(result);
  });
}
```

## Persistencia

- `stripe_webhook_events.event_id`
- `onboarding_user_state.checkout_reference`
- `stripe_subscriptions`

Resolver user no ACK repository ja le `checkout_reference` por `user_id`. O webhook precisa do inverso: `SELECT user_id FROM onboarding_user_state WHERE JSON_UNQUOTE(JSON_EXTRACT(checkout_reference, '$.stripe_subscription_id')) = ?` (MySQL JSON). Indexar se a query ficar lenta; alternativa: gravar `stripe_subscription_id` no ledger ja no checkout (`incomplete`) e lookup so no ledger.

## O que mudou em relacao ao WordPress

| Antes (WP) | Alvo (Node) |
|---|---|
| materializa Woo + Flexible | upsert ledger + `checkout_reference` |
| lookup LIKE no JSON da sessao | `stripe_subscription_id` no estado do `user_id` / ledger |
| option `hsr_stripe_subscription_order_map` | desnecessario |
| `wp_hsr_stripe_events` | `stripe_webhook_events` |

## Testes minimos

- sem `Stripe-Signature` → 400
- secret errado → 400
- secret nao configurado → 503
- `invoice.paid` primeiro → ledger active + `payment_state` paid
- mesmo `evt_` de novo → 200, um unico upsert
- `invoice.created` de ciclo 2 com shipping metadata → chama `invoiceItems.create`
- JWT no header nao e exigido e nao bloqueia
- path **nao** passa pelo bearer (teste de app: POST sem Authorization → nao 401)
