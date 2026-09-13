# O que alterar para Stripe BR e US funcionarem

O código do PAY-01 já roteia duas merchant accounts independentes (não Connect). **Cartão continua o único método.** Checkout Brasil só cria `cus_` / `sub_` na conta BR quando `STRIPE_BR_ENABLED=true`.

US já funciona com as variáveis legadas (`STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`). Brasil é aditivo: secrets + catálogo + cupons + webhooks + flag.

Não ligar a flag antes dos passos abaixo. Objetos criados na conta BR **não voltam** para a US.

Especificação original: [contexto.md](./contexto.md). O que o código não cobre: [definicoes-nao-desenvolvidas.md](./definicoes-nao-desenvolvidas.md).

---

## Ordem (não pular)

1. Conta Stripe Brasil (KYC/CNPJ) + API keys test (e live depois).
2. Deploy do código + migration `0014` no MySQL do ambiente.
3. Preencher secrets BR no backend e publishable keys na loja (rebuild da loja).
4. Recriar Product / Price / shipping product na conta **BR**.
5. Sync de catálogo no admin com `market=BR`.
6. Mapear cupons de 1ª compra **na conta BR** (mapa 1/3/6 separado do US).
7. Cadastrar webhooks `/stripe/v1/webhook/br` e `/us` em cada Dashboard.
8. Smoke em QA (checkout US intacto + checkout BR com cartão de teste).
9. Só então `STRIPE_BR_ENABLED=true` nesse ambiente.
10. Repetir 3–9 em produção com keys **live**.

Sem canary por % de tráfego: misturaria contas no mesmo usuário.

---

## 1. Contas Stripe

Duas contas, dois Dashboards.

| Conta | Moeda | Tax | Uso |
|-------|--------|-----|-----|
| US (a atual) | USD | `automatic_tax` no client US | Assinaturas já existentes; checkout US |
| BR (nova) | BRL | sem `automatic_tax` | Checkout BR, só depois da flag |

Não migrar `sub_` / `cus_` / `price_` / `promo_` entre contas. A migration marca linhas atuais como `stripe_account=us`.

Na conta BR nova, conferir a API version do Dashboard. O SDK **não** herda a default da conta: os dois clients usam `STRIPE_API_VERSION=2025-09-30.clover`. Manter essa versão nos dois Dashboards (Developers → API version) ou aceitar que o pin do código prevalece.

---

## 2. Backend — variáveis

Arquivos: `eden-bowls-backend/.env` (local) e o `.env` da VPS (a partir de `.env.qa.example`). O compose QA lê `env_file: .env`; não precisa listar cada `STRIPE_*` no YAML.

US herda o valor legado se `_US` estiver vazio.

| Variável | Conta | Fallback |
|----------|--------|----------|
| `STRIPE_US_SECRET_KEY` | US | `STRIPE_SECRET_KEY` |
| `STRIPE_BR_SECRET_KEY` | BR | nenhum — obrigatória para criar BR |
| `STRIPE_US_WEBHOOK_SECRET` | US | `STRIPE_WEBHOOK_SECRET` |
| `STRIPE_BR_WEBHOOK_SECRET` | BR | nenhum |
| `STRIPE_US_SHIPPING_PRODUCT_ID` | US | `STRIPE_SHIPPING_PRODUCT_ID` |
| `STRIPE_BR_SHIPPING_PRODUCT_ID` | BR | nenhum — criar `prod_` de frete **na conta BR** |
| `STRIPE_API_VERSION` | ambas | `2025-09-30.clover` |
| `STRIPE_US_AUTOMATIC_TAX` | só US | — |
| `STRIPE_BR_ENABLED` | criação BR | default `false` |

Com flag on e sem `STRIPE_BR_SECRET_KEY`: API responde `503 stripe_br_not_configured`.  
Com flag off: checkout BR responde `503 stripe_br_disabled` e **não** cai na conta US.

Restart da API depois de mudar env.

---

## 3. Loja — publishable keys

`VITE_*` entra no bundle na **build**. Mudou key → `docker compose ... up -d --build` (ou `npm run build` local).

| Variável | Conta | Fallback |
|----------|--------|----------|
| `VITE_STRIPE_PUBLISHABLE_KEY_US` | US | `VITE_STRIPE_PUBLISHABLE_KEY` |
| `VITE_STRIPE_PUBLISHABLE_KEY_BR` | BR | nenhum — sem ela o Elements BR não carrega |
| `VITE_STRIPE_US_AUTOMATIC_TAX` | preview US | alinhado com `STRIPE_US_AUTOMATIC_TAX` |

A pk do Elements tem que ser da **mesma** conta que gerou o `client_secret`. Se o POST devolver `stripe_account` diferente, o checkout aborta.

Arquivos: `eden-bowls/.env`, `.env.qa.example`, `Dockerfile`, `docker-compose.frontend.yml`.

---

## 4. Banco — migration 0014

No ambiente (local/QA/prod):

```bash
cd eden-bowls-backend
npm run migrate
```

O que a `1700000000014` faz no **mesmo** MySQL (`DB_NAME`):

| Tabela / meta | Efeito |
|---------------|--------|
| `stripe_subscriptions.stripe_account` | `NOT NULL` default `'us'` (backfill das linhas atuais) |
| `stripe_webhook_events` | PK `(event_id, stripe_account)` |
| `stripe_first_purchase_promos` | PK `(stripe_account, term_months)`; linhas atuais viram `us` |
| `wp_usermeta` | `_hsr_stripe_customer_id` → `_hsr_stripe_customer_id_us` |

Não há WP-CLI. Rollback da coluna **não** apaga `cus_`/`sub_` já criados na conta BR.

---

## 5. Catálogo (prices / products)

`prod_` e `price_` não atravessam contas. Sync admin com `market=BR` grava na conta BR (`_stripe_price_ids_by_currency.brl` e `_stripe_product_ids_by_currency.brl`).

No painel: Catálogo → mercado **BR** / moeda **BRL** → Sync.

Conferir health: mapped = expected, sem gaps. Sem `price_` BR o checkout BR falha mesmo com a flag on.

O product de frete (`STRIPE_BR_SHIPPING_PRODUCT_ID`) é criado à mão no Dashboard BR (o sync de bowls não cobre shipping). Sem ele, o 2º ciclo some o frete no `invoice.created`.

---

## 6. Cupons de 1ª compra

O mapa 1 / 3 / 6 meses é **por conta**, de propósito. `promo_` US não aplica no checkout BR.

No admin → Cupons:

1. Seletor **US** — mapa atual (não apagar).
2. Seletor **BR** — criar Coupon + Promotion Code na conta BR (10% / 25% / 40%, `duration=once`, first time transaction).
3. Salvar o mapa BR (`promo_...` da conta BR).
4. Health BR: `missing_in_stripe` vazio e mapa completo.

Checkout BR elegível bloqueia com `first_purchase_promo_not_configured` se o slot BR estiver vazio.

---

## 7. Webhooks

Dois endpoints. Cada Dashboard aponta só para o path daquela conta. Assinatura inválida → 400; **não** tenta o outro secret.

| Path | Secret | Alias |
|------|--------|--------|
| `POST /stripe/v1/webhook/us` | `STRIPE_US_WEBHOOK_SECRET` | `POST /stripe/v1/webhook` (cutover US) |
| `POST /stripe/v1/webhook/br` | `STRIPE_BR_WEBHOOK_SECRET` | — |

URL pública (QA): `https://qa-api.edenbowls.com/stripe/v1/webhook/us` e `.../webhook/br`.

Eventos a assinar nas duas contas:

- `invoice.paid`
- `invoice.created` (frete do 2º ciclo)
- `payment_intent.succeeded` / `processing` / `payment_failed`
- `invoice.payment_failed`
- `customer.subscription.updated` / `deleted`

São 4 endpoints no total se houver test + live × br + us.

Local:

```bash
npm run stripe:listen      # conta US → /webhook/us
npm run stripe:listen:br   # conta BR → /webhook/br
```

Dois CLIs, cada um logado na conta correspondente (`stripe login`).

---

## 8. Kill switch

`STRIPE_BR_ENABLED=false` (default):

- Checkout / preview / sync / criar cupom BR **não** chamam a conta BR.
- Pause / edit / webhook de um `sub_` já gravado como `br` **continuam** no client BR.

Só `true` depois de: secrets + shipping product + catálogo BR verde + cupons BR verdes + webhook BR recebendo evento de teste.

---

## 9. Smoke mínimo depois da flag

**US (regressão)**

- Checkout com endereço US + cartão teste da conta US.
- `stripe_account=us` no JSON do checkout.
- Webhook US processa `invoice.paid`.
- Admin billing mostra Conta US; “Ver no Stripe” abre o Dashboard US.

**BR**

- Checkout com CEP BR + cartão teste da conta **BR** (não usar o `pm_`/`pk_` US).
- Sem cair no Elements US se BR estiver disabled/misconfigured.
- Ledger com `stripe_account=br`, `cus_` na meta `_hsr_stripe_customer_id_br`.
- Cupom 1ª compra do mapa BR na primeira invoice.
- Pause/resume no detalhe usa a conta persistida, não o país do browser.

---

## 10. Produção

Repetir o mesmo checklist com keys **live** (`sk_live_`, `pk_live_`, `whsec_` live). Não apontar webhook live para QA nem misturar test/live na mesma conta do `.env`.

Confirmar NF-e / ISS **antes** do go-live BR — o SDK não emite nota. Ver [definicoes-nao-desenvolvidas.md](./definicoes-nao-desenvolvidas.md).
