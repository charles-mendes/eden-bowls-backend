# Como configurar a Stripe (US + BR)

Guia operacional: keys, API version, webhook secret e cadastro dos endpoints. Duas merchant accounts independentes (não é Stripe Connect).

Cutover e kill switch: [o-que-alterar-para-funcionar.md](./o-que-alterar-para-funcionar.md).  
Contrato da rota: [../other-routers/ROTA_STRIPE_WEBHOOK.md](../other-routers/ROTA_STRIPE_WEBHOOK.md).  
Webhook no localhost: [../BUG_CHECKOUT_BACK_AND_FRONT_END/STRIPE_CLI_WEBHOOK_LOCAL.md](../BUG_CHECKOUT_BACK_AND_FRONT_END/STRIPE_CLI_WEBHOOK_LOCAL.md).

---

## 1. O que vai para onde

Os sites **não** recebem webhook. A Stripe chama a **API**.

| Mercado | Loja | Dashboard Stripe | Path do webhook |
|---------|------|------------------|-----------------|
| Estados Unidos | `https://www.edenbowls.com` | conta **US** | `POST /stripe/v1/webhook/us` |
| Brasil | `https://www.edenbowls.com.br` | conta **BR** | `POST /stripe/v1/webhook/br` |

Alias de cutover (só US): `POST /stripe/v1/webhook`. Cadastre `/us` e `/br`. Não use o alias em endpoint novo.

Não cadastre webhook em:

- `https://www.edenbowls.com/...`
- `https://www.edenbowls.com.br/...`
- `https://edenbowls.com/qa-api/stripe/v1/webhook` (legado)

URL pública de QA:

```text
https://qa-api.edenbowls.com/stripe/v1/webhook/us
https://qa-api.edenbowls.com/stripe/v1/webhook/br
```

Produção: o mesmo path no host da API live (`https://{API}/stripe/v1/webhook/us` e `.../br`). Não apontar webhook **live** para QA.

São **4 endpoints** se houver test + live × US + BR. Cada um tem o próprio `whsec_`.

---

## 2. Duas contas, dois Dashboards

1. Abra [https://dashboard.stripe.com](https://dashboard.stripe.com).
2. No canto superior direito, troque a **conta** (não só Test/Live).
3. Faça o restante deste guia **duas vezes**: uma na conta US, outra na conta BR.

| Conta | Moeda | Loja | Variáveis `_US` / legado | Variáveis `_BR` |
|-------|--------|------|--------------------------|-----------------|
| US | USD | `.com` | sim | — |
| BR | BRL | `.com.br` | — | sim |

Objetos (`cus_`, `sub_`, `price_`, `promo_`, `whsec_`) **não atravessam** contas. Key US no checkout BR (ou o inverso) quebra o pagamento.

Test e Live no mesmo Dashboard são modos diferentes. `pk_test_` / `sk_test_` / `whsec_` de test **não** misturam com `pk_live_` / `sk_live_` / `whsec_` live.

---

## 3. Publishable key (`pk_`)

Usada **só na loja** (Stripe.js / Elements). Não entra no backend.

### Onde copiar

1. Dashboard da conta certa (US ou BR).
2. Toggle **Test mode** (QA/local) ou **Live mode** (produção).
3. **Developers → API keys**.
4. Copie **Publishable key**.
   - Test: começa com `pk_test_`.
   - Live: começa com `pk_live_`.

### Onde colar

Arquivo da loja: `eden-bowls/.env` (QA: o `.env` do build da loja). `VITE_*` entra no bundle no **build**. Mudou key → rebuild da loja.

| Variável | Conta | Fallback |
|----------|--------|----------|
| `VITE_STRIPE_PUBLISHABLE_KEY_US` | US | `VITE_STRIPE_PUBLISHABLE_KEY` |
| `VITE_STRIPE_PUBLISHABLE_KEY_BR` | BR | nenhum — sem ela o Elements BR não carrega |
| `VITE_STRIPE_PUBLISHABLE_KEY` | legado US | — |

Não existe `STRIPE_PUBLISHABLE_KEY` no backend. O nome curto da Stripe no Dashboard é a publishable key; no projeto ela é `VITE_STRIPE_PUBLISHABLE_KEY_*`.

Exemplo (valores fictícios):

```env
VITE_STRIPE_PUBLISHABLE_KEY_US=pk_test_51US...
VITE_STRIPE_PUBLISHABLE_KEY_BR=pk_test_51BR...
```

A pk do Elements tem que ser da **mesma** conta que gerou o `client_secret`. Se o POST devolver `stripe_account` diferente, o checkout aborta.

---

## 4. Secret key (`sk_`)

Usada **só no backend**. Nunca no front, nunca no Git, nunca no browser.

### Onde copiar

1. Mesmo lugar: **Developers → API keys**, conta + modo (Test/Live) certos.
2. Em **Secret key**, clique **Reveal** e copie.
   - Test: `sk_test_`.
   - Live: `sk_live_`.

Quem vê a secret controla a conta. Rotacione se vazar.

### Onde colar

Arquivo da API: `eden-bowls-backend/.env` (QA VPS: o `.env` que o compose lê). Restart da API depois de mudar.

| Variável | Conta | Fallback |
|----------|--------|----------|
| `STRIPE_US_SECRET_KEY` | US | `STRIPE_SECRET_KEY` |
| `STRIPE_BR_SECRET_KEY` | BR | nenhum — obrigatória para criar na conta BR |
| `STRIPE_SECRET_KEY` | legado US | — |

Exemplo:

```env
STRIPE_US_SECRET_KEY=sk_test_51US...
STRIPE_BR_SECRET_KEY=sk_test_51BR...
```

Checkout Brasil só cria `cus_` / `sub_` na conta BR com `STRIPE_BR_ENABLED=true`. Sem a secret BR, a API responde `503 stripe_br_not_configured`.

---

## 5. API version (`STRIPE_API_VERSION`)

O SDK **não** herda a default da conta. Os dois clients usam o pin do `.env`.

Valor atual do projeto:

```env
STRIPE_API_VERSION=2025-09-30.clover
```

Fallback no código (`src/core/stripe-account.js`): o mesmo `2025-09-30.clover`.

### Onde conferir no Dashboard

1. **Developers → API version** (ou Workbench → API versions).
2. A versão default da conta pode ser outra. O pin do `.env` prevalece nas chamadas do Node.
3. Manter as duas contas alinhadas com `2025-09-30.clover`, ou aceitar que o código manda nessa versão mesmo assim.

Não copie a versão “latest” do Dashboard para o `.env` sem alinhar o código. Webhook criado no Dashboard pode escolher a versão dos **eventos**; deixe a mesma `2025-09-30.clover` no endpoint, se o UI pedir.

`STRIPE_MAX_RETRIES` (default `2`) não é key; é retry de rede do SDK.

---

## 6. Webhook signing secret (`whsec_`)

Não está em API keys. Só existe **depois** de criar o endpoint (ou no `stripe listen` local).

Cada endpoint = um `whsec_`. US test, US live, BR test e BR live são quatro secrets diferentes.

### Onde copiar (Dashboard)

1. Abra o endpoint recém-criado (**Developers → Webhooks**, ou Workbench → Event destinations).
2. **Signing secret → Reveal**.
3. Copie o valor `whsec_...`.

### Onde colar

| Path | Variável | Fallback |
|------|----------|----------|
| `/stripe/v1/webhook/us` e `/stripe/v1/webhook` | `STRIPE_US_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SECRET` |
| `/stripe/v1/webhook/br` | `STRIPE_BR_WEBHOOK_SECRET` | nenhum |

```env
STRIPE_US_WEBHOOK_SECRET=whsec_US...
STRIPE_BR_WEBHOOK_SECRET=whsec_BR...
```

Assinatura inválida (incluindo secret da **outra** conta no path errado) → `400 { received: false }`. O receiver **não** tenta o outro secret.

Secret da conta do path vazio → `503 { received: false }` só naquele path.

Local com CLI: o `whsec_` do `stripe listen` **não** é o do Dashboard. Veja a seção 9.

---

## 7. Configurar o webhook no Dashboard

Repita na conta **US** (modo Test para QA) e na conta **BR** (modo Test para QA). Depois, o mesmo em Live na produção.

### 7.1 Conta Estados Unidos

1. Dashboard da conta **US**.
2. **Test mode** (QA) ou **Live mode** (produção).
3. **Developers → Webhooks** → **Add endpoint** (ou Workbench → **Add event destination** → Webhook endpoint).
4. **Endpoint URL:**

   ```text
   https://qa-api.edenbowls.com/stripe/v1/webhook/us
   ```

5. Description opcional: `Eden Bowls API — US`.
6. Listen to: **Your account** (não Connected accounts).
7. API version do evento: `2025-09-30.clover` se o formulário pedir.
8. Selecione **os mesmos eventos da seção 8** (não “all events”).
9. Salve. Copie o **Signing secret** → `STRIPE_US_WEBHOOK_SECRET`.
10. Restart da API.

### 7.2 Conta Brasil

1. Troque para a conta **BR** no canto superior direito.
2. Confira Test vs Live de novo (o toggle é por conta).
3. **Add endpoint**.
4. **Endpoint URL:**

   ```text
   https://qa-api.edenbowls.com/stripe/v1/webhook/br
   ```

5. Description opcional: `Eden Bowls API — BR`.
6. Listen to: **Your account**.
7. Os **mesmos eventos** da seção 8.
8. Salve. Copie o **Signing secret** → `STRIPE_BR_WEBHOOK_SECRET`.
9. Restart da API.

Não aponte o Dashboard BR para `/webhook/us` nem o US para `/webhook/br`.

### 7.3 Testar o endpoint no Dashboard

No detalhe do endpoint: **Send test webhook**. Use `invoice.paid` (evento que o Node processa).

- `200 { "received": true }` → URL, secret e conta batem.
- `400` → `whsec_` do `.env` não é o deste endpoint, ou modo test/live trocado.
- `503` → secret daquela conta vazio no `.env`.
- Timeout / 404 → URL errada (loja em vez da API, ou path legado `/qa-api`).

Evento desconhecido pelo código ainda assim deve responder **200** (o Node ignora). Por isso dá para assinar a lista longa da seção 8 sem quebrar o receiver.

---

## 8. Eventos a assinar nos dois webhooks

Cadastre **esta lista nos dois** endpoints (US e BR). Eventos que o Node ainda não trata são ignorados com 200.

### Charge

| Evento | Quando |
|--------|--------|
| `charge.refunded` | Charge reembolsado, inclusive parcial. Para detalhe do refund, `refund.created`. |
| `charge.refund.updated` | Refund atualizado em alguns métodos. Para todos os refunds, `refund.updated`. |
| `charge.dispute.created` | Cliente disputa o charge com o banco. |
| `charge.dispute.updated` | Disputa atualizada (em geral com evidência). |
| `charge.dispute.closed` | Disputa fechada (`lost`, `warning_closed` ou `won`). |

### Checkout

| Evento | Quando |
|--------|--------|
| `checkout.session.completed` | Checkout Session concluída com sucesso. |
| `checkout.session.expired` | Checkout Session expirou. |

O Place Order da loja **não** usa Checkout Session (é PaymentIntent + Subscription). Assinar mesmo assim não atrapalha.

### Customer

| Evento | Quando |
|--------|--------|
| `customer.created` | Novo customer. |
| `customer.updated` | Qualquer propriedade do customer muda. |
| `customer.deleted` | Customer apagado. |

### Subscription

| Evento | Quando |
|--------|--------|
| `customer.subscription.created` | Customer assina um plano. |
| `customer.subscription.updated` | Assinatura muda (plano, status trial → active, etc.). |
| `customer.subscription.deleted` | Assinatura termina. |
| `customer.subscription.paused` | Status vira `paused` (não é pause de cobrança). |
| `customer.subscription.resumed` | Sai de `paused`. |
| `customer.subscription.trial_will_end` | Três dias antes do trial acabar, ou na hora se o trial for encerrado cedo. |

O Node já usa `customer.subscription.updated` / `deleted` para convergir pause / cancel / edit.

### Invoice

| Evento | Quando |
|--------|--------|
| `invoice.created` | Nova invoice. O Node injeta frete no 2º ciclo. |
| `invoice.finalized` | Draft vira invoice `open`. |
| `invoice.paid` | Pagamento da invoice ok (ou marcada paga out-of-band). Fecha o plano no app. |
| `invoice.payment_failed` | Tentativa falhou (declínio ou sem payment method). |
| `invoice.payment_action_required` | Precisa de ação do usuário para completar. |

### Payment Intent

| Evento | Quando |
|--------|--------|
| `payment_intent.succeeded` | PaymentIntent pagou. |
| `payment_intent.payment_failed` | Falhou criar método ou pagar. |
| `payment_intent.canceled` | PaymentIntent cancelado. |

### Payment Method

| Evento | Quando |
|--------|--------|
| `payment_method.attached` | Método ligado a um customer. |
| `payment_method.detached` | Método desligado do customer. |

### Refund

| Evento | Quando |
|--------|--------|
| `refund.created` | Refund criado. |
| `refund.updated` | Refund atualizado. |

Lista pronta para colar no CLI / API:

```text
charge.refunded
charge.refund.updated
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
checkout.session.completed
checkout.session.expired
customer.created
customer.updated
customer.deleted
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.trial_will_end
invoice.created
invoice.finalized
invoice.paid
invoice.payment_failed
invoice.payment_action_required
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
payment_method.attached
payment_method.detached
refund.created
refund.updated
```

---

## 9. Local (Stripe CLI)

O Dashboard não alcança `localhost`. Encaminhe com o CLI, **dois terminais**, cada um logado na conta correspondente.

```bash
cd eden-bowls-backend
npm run dev
```

Outro terminal, conta US:

```bash
npm run stripe:listen
# → localhost:3000/stripe/v1/webhook/us
```

Outro terminal, conta BR (`stripe login` nessa conta):

```bash
npm run stripe:listen:br
# → localhost:3000/stripe/v1/webhook/br
```

O CLI imprime um `whsec_`. Cole no `.env` da API:

- US listen → `STRIPE_US_WEBHOOK_SECRET`
- BR listen → `STRIPE_BR_WEBHOOK_SECRET`

Não use o `whsec_` do Dashboard enquanto o CLI estiver encaminhando (a assinatura não bate → 400).

Detalhe: [STRIPE_CLI_WEBHOOK_LOCAL.md](../BUG_CHECKOUT_BACK_AND_FRONT_END/STRIPE_CLI_WEBHOOK_LOCAL.md).

---

## 10. Mapa completo das variáveis

### Backend (`eden-bowls-backend/.env`)

```env
STRIPE_API_VERSION=2025-09-30.clover
STRIPE_MAX_RETRIES=2
STRIPE_US_AUTOMATIC_TAX=true
STRIPE_BR_ENABLED=false

# US (legado STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_SHIPPING_PRODUCT_ID ainda funciona)
STRIPE_US_SECRET_KEY=
STRIPE_US_WEBHOOK_SECRET=
STRIPE_US_SHIPPING_PRODUCT_ID=

# BR (sem fallback)
STRIPE_BR_SECRET_KEY=
STRIPE_BR_WEBHOOK_SECRET=
STRIPE_BR_SHIPPING_PRODUCT_ID=
```

Só ligue `STRIPE_BR_ENABLED=true` depois de: secrets BR, product de frete BR, catálogo BR, cupons BR e webhook BR recebendo evento de teste.

### Loja (`eden-bowls/.env`)

```env
VITE_STRIPE_PUBLISHABLE_KEY_US=
VITE_STRIPE_PUBLISHABLE_KEY_BR=
VITE_STRIPE_US_AUTOMATIC_TAX=true
```

`VITE_STRIPE_US_AUTOMATIC_TAX` deve bater com `STRIPE_US_AUTOMATIC_TAX`. BR não usa automatic tax.

---

## 11. Checklist rápido

- [ ] Conta US: `pk_test_` / `sk_test_` no `.env` da loja e da API
- [ ] Conta BR: `pk_test_` / `sk_test_` nas variáveis `_BR` (sem fallback)
- [ ] `STRIPE_API_VERSION=2025-09-30.clover`
- [ ] Endpoint US → `.../stripe/v1/webhook/us` + `STRIPE_US_WEBHOOK_SECRET`
- [ ] Endpoint BR → `.../stripe/v1/webhook/br` + `STRIPE_BR_WEBHOOK_SECRET`
- [ ] Os dois endpoints com a lista da seção 8
- [ ] Test webhook `invoice.paid` → 200 em cada conta
- [ ] Loja rebuildada depois de mudar `VITE_*`
- [ ] API reiniciada depois de mudar `STRIPE_*`
- [ ] Live só no host de produção, com `pk_live_` / `sk_live_` / `whsec_` live
- [ ] Nunca commitar `.env` nem colar `sk_` / `whsec_` em ticket/chat
