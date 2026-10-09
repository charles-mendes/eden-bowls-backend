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
- A rota responde **503** `{ received: false }` (`STRIPE_US_WEBHOOK_SECRET` vazio; `STRIPE_WEBHOOK_SECRET` is not read)
- A rota responde **400** `{ received: false }` (assinatura invalida: secret do dashboard no `.env` enquanto o CLI esta encaminhando, ou o contrario)

So investigue codigo (front/Node) depois de ver o evento chegar no terminal do `stripe listen` **e** no log do Express.

## O que e o Stripe CLI

Programa **fora** do `node_modules`. Nao substitui `StripeWebhookService`.

No dashboard, o Stripe POSTA para uma URL publica HTTPS. No PC isso nao existe. O CLI:

1. Abre um tunel autenticado com a conta **test** (a mesma do `STRIPE_US_SECRET_KEY`; `STRIPE_SECRET_KEY` is not read)
2. Recebe os eventos
3. Encaminha `POST` para o Express com header `Stripe-Signature`

Rota ja existente no projeto:

```text
POST /stripe/v1/webhook
```

- Fora de `/api/v1` (sem JWT)
- Body **raw** (`express.raw` em `src/app.js`, antes de `express.json()`)
- Auth = `Stripe-Signature` + `STRIPE_US_WEBHOOK_SECRET`. `STRIPE_WEBHOOK_SECRET` is not read

Nao instale o CLI como dependencia npm. O script `npm run stripe:listen` so chama o binario ja instalado no SO.

## Contas de QA no localhost

O `stripe listen` local entra nas contas de teste de QA, não numa conta só da máquina. Os secrets da API local são os secrets de teste de QA. O secret de webhook local é o valor que o CLI imprime. Não copie o signing secret do dashboard de QA nem o de produção para o `.env` local, e não use chaves live.

O banco local copia o post meta de preço e de produto do export do operador, casando slug do produto pai, sabor e peso. Rode o script de retire. Não rode o sync de catálogo localmente: cada execução criaria produtos de novo na conta de QA compartilhada.

`EDEN_RUNTIME=local` é obrigatório, inclusive quando `NODE_ENV=production`. Um `invoice.paid` de um checkout feito no QA, encaminhado pelo CLI, não é aplicado no usuário local.

## Setup neste repo

### 1) Instalar o CLI (uma vez)

Docs oficiais: [https://docs.stripe.com/stripe-cli](https://docs.stripe.com/stripe-cli)

No WSL:

```bash
stripe --version
```

Não precisa de `stripe login` para o `npm run dev`: cada listener recebe a chave da conta pela variável `STRIPE_API_KEY` do processo filho.

### 2) Subir API e listeners juntos

Na raiz de `eden-bowls-backend`:

```bash
npm run dev
```

O script `scripts/dev-with-stripe-listen.js`:

- sobe a API com `node --watch src/index.js` e `NODE_ENV=development`;
- sobe `stripe listen --forward-to localhost:${PORT}/stripe/v1/webhook/us` com `STRIPE_API_KEY=$STRIPE_US_SECRET_KEY`;
- sobe o listener BR (`/webhook/br`, `STRIPE_BR_SECRET_KEY`) só se `STRIPE_BR_SECRET_KEY` estiver preenchida;
- lê o signing secret que cada CLI imprime e grava em `.local/stripe-webhook-secrets.json` (`{ "us": "<signing secret US>", "br": "<signing secret BR>" }`, gitignored);
- prefixa a saída com `[api]`, `[stripe-us]`, `[stripe-br]` e mostra o secret mascarado;
- reinicia um listener que caia (o novo secret vai para o arquivo);
- no Ctrl+C ou SIGTERM encerra API e listeners juntos. Se a API sair, encerra os listeners. Em qualquer desses encerramentos apaga `.local/stripe-webhook-secrets.json`, porque o secret morre com a sessão do listener.

Sem o binário `stripe` no PATH, a API sobe mesmo assim e o script avisa como instalar.

Em `development`, `StripeAccounts.webhookSecret()` lê esse arquivo **a cada POST** de webhook. O valor do arquivo vence o `.env`. Por isso:

- o `.env` local pode ficar com `STRIPE_US_WEBHOOK_SECRET` / `STRIPE_BR_WEBHOOK_SECRET` vazios;
- um secret novo do listener vale no próximo evento, sem reiniciar o Node.

Arquivo ausente, JSON inválido ou conta sem secret: a API usa o `.env` e loga um warn. Sem secret em nenhuma fonte, o webhook responde 503 dizendo que o secret do listener ainda não está disponível.

Em `production` e `test` o arquivo é ignorado. `npm start` não muda.

### 3) Fluxo manual (alternativa)

```bash
npm run dev:api          # só a API, node --watch
npm run stripe:listen    # outro terminal, conta US (exige stripe login nessa conta)
npm run stripe:listen:br # outro terminal, conta BR
```

Nesse fluxo o arquivo `.local/` não é atualizado. Cole o secret que o CLI imprimiu no `.env` e reinicie a API:

```bash
STRIPE_US_WEBHOOK_SECRET=
STRIPE_BR_WEBHOOK_SECRET=
# STRIPE_WEBHOOK_SECRET is not read
```

Ao encerrar, o `npm run dev` apaga `.local/stripe-webhook-secrets.json`, então o `dev:api` volta a usar o `.env`. Exceção: se o script morrer sem chance de limpar (`kill -9`, terminal fechado à força, queda da máquina), o arquivo fica e continua vencendo o `.env` em `development`. Nesse caso apague o arquivo à mão.

O `signing secret` do CLI **nao** e o `signing secret` do endpoint do dashboard. Sao dois destinos. Local = secret que o `listen` imprimiu.

### 4) Pagar de novo no front

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

## Local vs QA/prod

| Ambiente | Como o Stripe chega | Qual secret (`STRIPE_WEBHOOK_SECRET` is not read) |
|---|---|---|
| Local | `npm run dev` (ou `npm run stripe:listen`) | `signing secret ` impresso pelo CLI |
| QA / prod | endpoint no dashboard da conta do país → `{API}/stripe/v1/webhook/br` (conta Brasil) e `{API}/stripe/v1/webhook/us` (conta Estados Unidos) | `signing secret ` **daquele** endpoint (`STRIPE_BR_WEBHOOK_SECRET` / `STRIPE_US_WEBHOOK_SECRET`) |

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
