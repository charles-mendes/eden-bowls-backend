# Stripe CLI no checkout local (nao e bug)

## Sintoma que engana

Fluxo local tipico:

1. `POST /api/v1/onboarding/subscription/checkout` devolve `status: incomplete` + `payment_state: requires_confirmation` + `stripe_client_secret`.
2. O front confirma o PaymentIntent (`confirmCardPayment`). No Stripe o PI fica `succeeded`.
3. `POST /api/v1/onboarding/payment-intent/ack` devolve `payment_state: paid` + `acked: true`.
4. A UI mostra sucesso.

Isso **nao** prova que o plano fechou. O ACK e otimista (confia no body do front). A fonte de verdade e o webhook:

- `invoice.paid` → ledger `stripe_subscriptions` `active` + `checkout_reference.payment_state = paid`
- `invoice.created` → frete nos ciclos seguintes
- `customer.subscription.*` → pause / cancel / edit convergem

No localhost o Stripe **nao consegue** chamar `http://localhost:3000`. Sem encaminhamento, o Node nunca recebe o evento. O dashboard Stripe mostra fatura paga; o app local continua `incomplete` / Meu Plano vazio.

Isso e ambiente, nao regressao do Place Order.

## Checklist: bug de verdade ou webhook ausente?

Trate como **falta de CLI / secret** se:

- Checkout + confirm + ACK deram 200, mas `GET /api/v1/subscriptions` volta `[]`
- Ledger permanece `incomplete` depois do cartao `succeeded`
- A 2a compra ainda recebe cupom de 1a compra
- Logs do Node nao mostram `POST /stripe/v1/webhook` depois do pagamento
- A rota responde **503** `{ received: false }` (`STRIPE_WEBHOOK_SECRET` vazio)
- A rota responde **400** `{ received: false }` (assinatura invalida: secret do dashboard no `.env` enquanto o CLI esta encaminhando, ou o contrario)

So investigue codigo (front/Node) depois de ver o evento chegar no terminal do `stripe listen` **e** no log do Express.

## O que e o Stripe CLI

Programa **fora** do `node_modules`. Nao substitui `StripeWebhookService`.

No dashboard, o Stripe POSTA para uma URL publica HTTPS. No PC isso nao existe. O CLI:

1. Abre um tunel autenticado com a conta **test** (a mesma do `STRIPE_SECRET_KEY` `sk_test_...`)
2. Recebe os eventos
3. Encaminha `POST` para o Express com header `Stripe-Signature`

Rota ja existente no projeto:

```text
POST /stripe/v1/webhook
```

- Fora de `/api/v1` (sem JWT)
- Body **raw** (`express.raw` em `src/app.js`, antes de `express.json()`)
- Auth = `Stripe-Signature` + `STRIPE_WEBHOOK_SECRET`

Nao instale o CLI como dependencia npm. O script `npm run stripe:listen` so chama o binario ja instalado no SO.

## Setup neste repo

### 1) Instalar e logar (uma vez)

Docs oficiais: [https://docs.stripe.com/stripe-cli](https://docs.stripe.com/stripe-cli)

No WSL:

```bash
stripe --version
stripe login
```

O login abre o browser e liga o CLI a conta test.

### 2) Subir o backend

```bash
npm run dev
```

Porta padrao: `3000` (`.env` / `PORT`).

### 3) Encaminhar eventos (outro terminal)

Na raiz de `eden-bowls-backend`:

```bash
npm run stripe:listen
```

Equivalente:

```bash
stripe listen --forward-to localhost:3000/stripe/v1/webhook
```

O CLI imprime um secret **desta sessao**:

```text
Ready! Your webhook signing secret is whsec_...
```

### 4) Colocar o secret no `.env` e reiniciar o Node

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

Reinicie `npm run dev`. O Node so le o `.env` na subida.

O `whsec_` do CLI **nao** e o `whsec_` do endpoint do dashboard. Sao dois destinos. Local = secret que o `listen` imprimiu.

### 5) Pagar de novo no front

No terminal do `listen` devem aparecer linhas como `invoice.created`, `invoice.paid`, `payment_intent.succeeded`, encaminhadas com 200.

Eventos que o `StripeWebhookService` processa:

- `invoice.paid`
- `invoice.created`
- `payment_intent.succeeded` / `processing` / `payment_failed`
- `invoice.payment_failed`
- `customer.subscription.updated` / `deleted`

Os demais o handler ignora com `{ received: true }`.

## O que `stripe trigger` nao prova

```bash
stripe trigger invoice.paid
```

Confirma que a rota aceita o POST assinado. O payload de fixture **nao** tem o `sub_` / `user_id` do checkout que voce acabou de fazer. Ledger e Meu Plano so fecham no pagamento real (ou num evento cujo objeto exista no seu banco).

## Local vs staging/prod

| Ambiente | Como o Stripe chega | Qual `STRIPE_WEBHOOK_SECRET` |
|---|---|---|
| Local | `npm run stripe:listen` | `whsec_` impresso pelo CLI |
| Staging / prod | endpoint no dashboard → `{API}/stripe/v1/webhook` | `whsec_` **daquele** endpoint |

Em producao o CLI nao entra. URL publica HTTPS + secret do dashboard.

## Relacao ACK vs webhook (para nao confundir captura)

Captura de exemplo nesta pasta: [context.md](./context.md).

Nesse dump o ACK ja volta `payment_state: paid`. Isso e esperado e **nao** substitui `invoice.paid`. Sem CLI, o passo 4 do dump pode existir e o plano ainda nao aparece.

| | ACK | Webhook `invoice.paid` |
|---|---|---|
| Quem chama | front autenticado | Stripe (via CLI no local) |
| Confia no status? | body do cliente | evento assinado |
| Marca UI paid? | sim (otimista) | nao fala com a UI |
| Cria ledger / fecha dominio? | nao | sim |
