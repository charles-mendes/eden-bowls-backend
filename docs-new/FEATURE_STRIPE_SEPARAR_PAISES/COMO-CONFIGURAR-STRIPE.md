# Como configurar a Stripe (US + BR)

Guia operacional: keys, API version, webhook secret e cadastro dos endpoints. Duas merchant accounts independentes (não é Stripe Connect).

Cutover e kill switch: [o-que-alterar-para-funcionar.md](./o-que-alterar-para-funcionar.md).  
Contrato da rota: [../other-routers/ROTA_STRIPE_WEBHOOK.md](../other-routers/ROTA_STRIPE_WEBHOOK.md).  
Webhook no localhost: [../BUG_CHECKOUT_BACK_AND_FRONT_END/STRIPE_CLI_WEBHOOK_LOCAL.md](../BUG_CHECKOUT_BACK_AND_FRONT_END/STRIPE_CLI_WEBHOOK_LOCAL.md).

## Contas por ambiente

QA e localhost usam a QA Brazil sandbox e a conta de teste dos Estados Unidos. "Área Restrita" é o nome em português que a Stripe dá a uma sandbox. Não é uma chave restrita. Produção usa a conta live do Brasil e a conta live dos Estados Unidos. A sandbox compartilhada da Charles está aposentada.

Cada endpoint assina a lista de 28 eventos em `src/infrastructure/stripe/stripe-webhook-events.js` e usa a API version `2025-09-30.clover`.

URLs:

- `https://qa-api.edenbowls.com/stripe/v1/webhook/br`
- `https://qa-api.edenbowls.com/stripe/v1/webhook/us`
- `https://api.edenbowls.com/stripe/v1/webhook/br`
- `https://api.edenbowls.com/stripe/v1/webhook/us`

A loja usa `VITE_STRIPE_PUBLISHABLE_KEY_BR` e `VITE_STRIPE_PUBLISHABLE_KEY_US` da mesma conta que o secret da API daquele país e daquele ambiente. Mudou a publishable key, faz rebuild da loja.

A conta é escolhida pelo país do endereço, não pelo domínio. Brasil cobra em BRL e os Estados Unidos em USD. O mesmo usuário pode ter um customer id por conta: `_hsr_stripe_customer_id_br`, `_hsr_stripe_customer_id_us`, e o legado `_hsr_stripe_customer_id`.

Ids ficam em post meta `_stripe_price_id`, `_stripe_price_ids_by_currency`, `_stripe_product_id` e `_stripe_product_ids_by_currency`; no ledger `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id` e `stripe_account` (`br` ou `us`); e em `coupon_id` / `promotion_code_id` de `stripe_first_purchase_promos`.

Não copie ids da Charles. `prod_seed_` e `price_seed_` não são ids reais. O catálogo e os cupons são recriados uma vez no host de QA, depois do script de retire. Esse script apaga linhas de `stripe_subscriptions` por `created_at`, porque `stripe_account` só guarda `br` ou `us` e nenhum status faz `listAfterId` pular a linha. O checkout não usa `_stripe_price_id` quando a moeda não está em `_stripe_price_ids_by_currency`.

Rollback de QA restaura o `.env` anterior junto com o dump da task 7.2. O dump não inclui `background_job_cursors`. Para repetir o cutover, apague a linha `job_name = 'stripe_ledger_retire'` e só então rode o script de novo.

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

São **4 endpoints** se houver test + live × US + BR. Cada um tem o próprio `signing secret `.

---

## 2. Duas contas, dois Dashboards

1. Abra [https://dashboard.stripe.com](https://dashboard.stripe.com).
2. No canto superior direito, troque a **conta** (não só Test/Live).
3. Faça o restante deste guia **duas vezes**: uma na conta US, outra na conta BR.

| Conta | Moeda | Loja | Variáveis `_US` / legado | Variáveis `_BR` |
|-------|--------|------|--------------------------|-----------------|
| US | USD | `.com` | sim | — |
| BR | BRL | `.com.br` | — | sim |

Objetos (`cus_`, `sub_`, `price_`, `promo_`, `signing secret `) **não atravessam** contas. Key US no checkout BR (ou o inverso) quebra o pagamento.

Test e Live no mesmo Dashboard são modos diferentes. `test publishable key ` / `test secret key ` / `signing secret ` de test **não** misturam com `live publishable key ` / `live secret key ` / `signing secret ` live.

---

## 3. Publishable key (`pk_`)

Usada **só na loja** (Stripe.js / Elements). Não entra no backend.

### Onde copiar

1. Dashboard da conta certa (US ou BR).
2. Toggle **Test mode** (QA/local) ou **Live mode** (produção).
3. **Developers → API keys**.
4. Copie **Publishable key**.
   - Test: começa com `test publishable key `.
   - Live: começa com `live publishable key `.

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
VITE_STRIPE_PUBLISHABLE_KEY_US=test publishable key 51US...
VITE_STRIPE_PUBLISHABLE_KEY_BR=test publishable key 51BR...
```

A pk do Elements tem que ser da **mesma** conta que gerou o `client_secret`. Se o POST devolver `stripe_account` diferente, o checkout aborta.

---

## 4. Secret key (`sk_`)

Usada **só no backend**. Nunca no front, nunca no Git, nunca no browser.

### Onde copiar

1. Mesmo lugar: **Developers → API keys**, conta + modo (Test/Live) certos.
2. Em **Secret key**, clique **Reveal** e copie.
   - Test: `test secret key `.
   - Live: `live secret key `.

Quem vê a secret controla a conta. Rotacione se vazar.

### Onde colar

Arquivo da API: `eden-bowls-backend/.env` (QA VPS: o `.env` que o compose lê). Restart da API depois de mudar.

| Variável | Conta | Fallback |
|----------|--------|----------|
| `STRIPE_US_SECRET_KEY` | US | nenhum. `STRIPE_SECRET_KEY` is not read |
| `STRIPE_BR_SECRET_KEY` | BR | nenhum — obrigatória para criar na conta BR |

Exemplo:

```env
STRIPE_US_SECRET_KEY=test secret key 51US...
STRIPE_BR_SECRET_KEY=test secret key 51BR...
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

## 6. Webhook signing secret (`signing secret `)

Não está em API keys. Só existe **depois** de criar o endpoint (ou no `stripe listen` local).

Cada endpoint = um `signing secret `. US test, US live, BR test e BR live são quatro secrets diferentes.

### Onde copiar (Dashboard)

1. Abra o endpoint recém-criado (**Developers → Webhooks**, ou Workbench → Event destinations).
2. **Signing secret → Reveal**.
3. Copie o valor `signing secret ...`.

### Onde colar

| Path | Variável | Fallback |
|------|----------|----------|
| `/stripe/v1/webhook/us` e `/stripe/v1/webhook` | `STRIPE_US_WEBHOOK_SECRET` | nenhum. `STRIPE_WEBHOOK_SECRET` is not read |
| `/stripe/v1/webhook/br` | `STRIPE_BR_WEBHOOK_SECRET` | nenhum |

```env
STRIPE_US_WEBHOOK_SECRET=signing secret US...
STRIPE_BR_WEBHOOK_SECRET=signing secret BR...
```

Assinatura inválida (incluindo secret da **outra** conta no path errado) → `400 { received: false }`. O receiver **não** tenta o outro secret.

Secret da conta do path vazio → `503 { received: false }` só naquele path.

Local com CLI: o `signing secret ` do `stripe listen` **não** é o do Dashboard. Veja a seção 9.

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
8. Selecione **os 28 eventos da seção 8** (não “all events”).
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
7. Os **28 eventos** da seção 8.
8. Salve. Copie o **Signing secret** → `STRIPE_BR_WEBHOOK_SECRET`.
9. Restart da API.

Não aponte o Dashboard BR para `/webhook/us` nem o US para `/webhook/br`.

### 7.3 Testar o endpoint no Dashboard

No detalhe do endpoint: **Send test webhook**. Use `invoice.paid` (evento que o Node processa).

- `200 { "received": true }` → URL, secret e conta batem.
- `400` → `signing secret ` do `.env` não é o deste endpoint, ou modo test/live trocado.
- `503` → secret daquela conta vazio no `.env`.
- Timeout / 404 → URL errada (loja em vez da API, ou path legado `/qa-api`).

Evento desconhecido pelo código ainda assim deve responder **200** (o Node ignora). Por isso dá para assinar a lista longa da seção 8 sem quebrar o receiver.

---

## 8. Eventos a assinar nos dois webhooks

Sempre que configurar um webhook — Dashboard US, Dashboard BR, modo Test, modo Live ou `stripe listen` — assine **estes 28 eventos**. Não use “all events” e não cadastre um endpoint com um subconjunto.

A lista canônica está em `src/infrastructure/stripe/stripe-webhook-events.js`. `npm run stripe:listen` e `npm run stripe:listen:br` já passam `--events` com ela.

Eventos que o Node ainda não trata são ignorados com 200.

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
charge.dispute.closed
charge.dispute.created
charge.dispute.updated
charge.refund.updated
charge.refunded
checkout.session.completed
checkout.session.expired
customer.created
customer.deleted
customer.subscription.created
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.trial_will_end
customer.subscription.updated
customer.updated
invoice.created
invoice.finalized
invoice.paid
invoice.payment_action_required
invoice.payment_failed
payment_intent.canceled
payment_intent.payment_failed
payment_intent.succeeded
payment_method.attached
payment_method.detached
refund.created
refund.updated
```

---

## 9. Local (Stripe CLI)

O Dashboard não alcança `localhost`. O CLI encaminha os eventos. Um comando sobe tudo:

```bash
cd eden-bowls-backend
npm run dev
```

- API em `node --watch` com `NODE_ENV=development`.
- Listener US → `localhost:${PORT}/stripe/v1/webhook/us`, autenticado com `STRIPE_US_SECRET_KEY` (via `STRIPE_API_KEY`, sem `stripe login`).
- Listener BR → `localhost:${PORT}/stripe/v1/webhook/br`, com `STRIPE_BR_SECRET_KEY`. Se essa chave estiver vazia, o listener BR não sobe.
- Os `whsec_` impressos pelos listeners vão para `.local/stripe-webhook-secrets.json` (gitignored). A API lê esse arquivo a cada webhook em `development`, com prioridade sobre o `.env`. O `npm run dev` apaga o arquivo ao encerrar (Ctrl+C, SIGTERM ou saída da API), e o `npm run dev:api` volta a usar o `.env`. Se o script for morto com `kill -9`, apague o arquivo à mão.

O `.env` local pode deixar `STRIPE_US_WEBHOOK_SECRET` e `STRIPE_BR_WEBHOOK_SECRET` vazios. Trocar o secret do listener não exige reiniciar a API.

Fluxo manual (continua valendo):

```bash
npm run dev:api          # só a API
npm run stripe:listen    # conta US (stripe login nessa conta)
npm run stripe:listen:br # conta BR (stripe login nessa conta)
```

No fluxo manual cole o `signing secret` impresso pelo CLI no `.env` e reinicie a API:

- US listen → `STRIPE_US_WEBHOOK_SECRET`
- BR listen → `STRIPE_BR_WEBHOOK_SECRET`

Não use o `signing secret` do Dashboard enquanto o CLI estiver encaminhando (a assinatura não bate → 400). Produção e QA continuam lendo só as variáveis de ambiente.

Detalhe: [STRIPE_CLI_WEBHOOK_LOCAL.md](../BUG_CHECKOUT_BACK_AND_FRONT_END/STRIPE_CLI_WEBHOOK_LOCAL.md).

---

## 10. Mapa completo das variáveis

### Backend (`eden-bowls-backend/.env`)

```env
STRIPE_API_VERSION=2025-09-30.clover
STRIPE_MAX_RETRIES=2
STRIPE_US_AUTOMATIC_TAX=true
STRIPE_BR_ENABLED=false

# US. STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are not read
STRIPE_US_SECRET_KEY=
STRIPE_US_WEBHOOK_SECRET=

# BR (sem fallback)
STRIPE_BR_SECRET_KEY=
STRIPE_BR_WEBHOOK_SECRET=
```

Só ligue `STRIPE_BR_ENABLED=true` depois de: secrets BR, catálogo BR, cupons BR e webhook BR recebendo evento de teste. O frete BR usa o `shipping_product_id` gravado na assinatura, não uma variável de ambiente.

### Loja (`eden-bowls/.env`)

```env
VITE_STRIPE_PUBLISHABLE_KEY_US=
VITE_STRIPE_PUBLISHABLE_KEY_BR=
VITE_STRIPE_US_AUTOMATIC_TAX=true
```

`VITE_STRIPE_US_AUTOMATIC_TAX` deve bater com `STRIPE_US_AUTOMATIC_TAX`. BR não usa automatic tax.

---

## 11. Checklist rápido

- [ ] Conta US: `test publishable key ` / `test secret key ` no `.env` da loja e da API
- [ ] Conta BR: `test publishable key ` / `test secret key ` nas variáveis `_BR` (sem fallback)
- [ ] `STRIPE_API_VERSION=2025-09-30.clover`
- [ ] Endpoint US → `.../stripe/v1/webhook/us` + `STRIPE_US_WEBHOOK_SECRET`
- [ ] Endpoint BR → `.../stripe/v1/webhook/br` + `STRIPE_BR_WEBHOOK_SECRET`
- [ ] Os dois endpoints com os 28 eventos da seção 8
- [ ] Test webhook `invoice.paid` → 200 em cada conta
- [ ] Loja rebuildada depois de mudar `VITE_*`
- [ ] API reiniciada depois de mudar `STRIPE_*`
- [ ] Live só no host de produção, com `live publishable key ` / `live secret key ` / `signing secret ` live
- [ ] Nunca commitar `.env` nem colar `sk_` / `signing secret ` em ticket/chat
