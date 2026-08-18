# POST `/onboarding/session/{session_id}/subscription/checkout`

Documentacao da logica **atual** do checkout de assinatura no onboarding.

Escopo: converter a sessao de onboarding (plano + endereco + frete + usuario vinculado) em cobranca Stripe da **primeira fatura**, devolvendo `client_secret` para o front confirmar o PaymentIntent. Existem **dois ramos** no mesmo endpoint, escolhidos pelo body:

| `checkout_mode` / `flow` | Nome interno | Pedido Woo na hora? | Stripe na hora? | Detalhe |
|---|---|---|---|---|
| `subscription_first` | fluxo preferencial | **nao** (`order_id: 0`); materializa no webhook `invoice.paid` | **sim**, via filter `hsr_checkout_create_stripe_subscription` | [02-ramo-subscription-first.md](./02-ramo-subscription-first.md) |
| ausente / qualquer outro valor | `order_first_checkout` | **sim**, `wc_create_order` | so se o body tiver `payment_method_id` (`pm_...`); erros Stripe **nao** viram HTTP 5xx | [03-ramo-order-first.md](./03-ramo-order-first.md) |

Stripe (`subscriptions.create`, tax, cupom, idempotencia, webhook): [04-stripe-webhook-e-efeitos.md](./04-stripe-webhook-e-efeitos.md).

Plugin de entrada: `headless-secure-registration`.  
Plugin de billing: `pawbowl-stripe-billing` (obrigatorio no ramo Stripe; se o filter nao tiver listener → 503 no `subscription_first`).  
Plugin de auth de usuario: `jwt-authentication-for-wp-rest-api` (`Authorization: Bearer` → `determine_current_user`).  
WooCommerce: obrigatorio **mesmo** no `subscription_first` (gate no topo de `CheckoutService::checkout`).

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php` (`subscription_checkout`, `require_linked_user_session_access`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php` (`wp_hsr_onboarding_sessions.stripe_checkout_json`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-product-tax-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-activation-service.php` (`hsr_activation_status === active`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-rate-limiter.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-plugin.php` (filter `hsr_checkout_create_stripe_subscription`)
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php` (`create_subscription`)
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-checkout-sync.php` (`hsr_checkout_order_ready_for_stripe_sync`)
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-client-factory.php`
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-coupon-service.php` (mapeamento `promo_` 1a compra)
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-tax-rate-service.php` (tax rates manuais se `STRIPE_US_AUTOMATIC_TAX` off)
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-ledger-schema.php` (`wp_hsr_stripe_subscriptions`)
- consumidores posteriores: `POST .../payment-intent/ack`, webhook `POST /custom/v1/stripe-webhook` (`invoice.paid` → `hsr_stripe_invoice_paid_confirmed`)

Smoke: `artefatos/SMOKE_TEST_ONBOARDING_CHECKOUT.md` (ramo **order-first**, sem `checkout_mode` e sem `pm_`).  
Postman: `pawbowl-rotas-implementadas.postman_collection.json` (mesmo ramo).  
Swagger: `artefatos/swagger-pawbowl.yaml` (schema `AnyObject`; security lista SessionToken **e** Bearer — o PHP desta rota **nao** valida o session token).  
Contrato Node sugerido: `POST /api/v1/onboarding/sessions/:sessionId/checkout` em `artefatos/migracao-node-reverse-engineering/08-endpoints-rest-sugeridos.md`.

Cupom 1a compra (contexto): `artefatos/documentacao-plugins-backend/09-stripe-coupons-first-purchase.md` secao 4.7.

Namespace REST: `custom/v1`  
Base: `{WP_URL}/wp-json`

---

## Serie desta pasta

| Arquivo | Conteudo |
|---|---|
| [01-onboarding-subscription-checkout.md](./01-onboarding-subscription-checkout.md) | Identidade, auth, pipeline comum, validacoes, desconto, contrato HTTP, erros, jornada |
| [02-ramo-subscription-first.md](./02-ramo-subscription-first.md) | Ramo A: Stripe primeiro, `order_id: 0` |
| [03-ramo-order-first.md](./03-ramo-order-first.md) | Ramo B: `wc_create_order`, reuso, sync opcional |
| [04-stripe-webhook-e-efeitos.md](./04-stripe-webhook-e-efeitos.md) | `create_subscription`, tax, cupom, webhook, hooks, efeitos, notas Node |

Rotas irmas:

- `POST .../payment-intent/ack` — [../payment-intent-ack/01-onboarding-payment-intent-ack.md](../payment-intent-ack/01-onboarding-payment-intent-ack.md)
- `GET .../payment-methods` — [../payment-methods/01-onboarding-payment-methods.md](../payment-methods/01-onboarding-payment-methods.md)
- `POST .../subscription/preview` — [../subscription-preview/01-onboarding-subscription-preview.md](../subscription-preview/01-onboarding-subscription-preview.md)
- `POST .../shipping/select` — [../shipping/01-onboarding-shipping-select.md](../shipping/01-onboarding-shipping-select.md)
- `POST .../sales-tax/quote` — [../sales-tax/01-onboarding-sales-tax-quote.md](../sales-tax/01-onboarding-sales-tax-quote.md)
- `POST .../zipcode` — [../zipcode/02-onboarding-zipcode.md](../zipcode/02-onboarding-zipcode.md)

---

## 1) Identidade da rota

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/subscription/checkout
```

| Item | Valor |
|---|---|
| Namespace WP | `custom/v1` |
| Metodo | `POST` (`WP_REST_Server::CREATABLE`) |
| Path param | `session_id` — regex `[A-Za-z0-9_-]+` |
| Permission | `OnboardingApi::require_linked_user_session_access` |
| Handler | `OnboardingApi::subscription_checkout` |
| Servico HSR | `CheckoutService::checkout` |
| Servico Stripe | `PawBowlStripe\StripeSubscriptionService::create_subscription` |
| Validator | nenhum (`RequestValidator` nao e usado; sem `args` no `register_rest_route`) |
| Rate limit proprio | nenhum (so o de **auth** no permission_callback) |
| Registro | `add_action('rest_api_init', [OnboardingApi, 'register_routes'])` |

Objetivo: criar a assinatura Stripe (`payment_behavior: default_incomplete`) com itens mapeados do snapshot de preco da sessao, anexar PaymentMethod, aplicar cupom de 1a compra se elegivel, injetar frete na 1a invoice (`add_invoice_items`) e devolver `stripe_client_secret` para o Payment Element confirmar.

Nao confundir com:

- `POST .../subscription/preview` — preview de imposto Stripe Tax, **nao** cria subscription.
- `POST .../plan/preview` — preco de catalogo meal-plan, sem Stripe.
- `POST .../sales-tax/quote` / `POST .../shipping/select` — gravam tax/frete na sessao; checkout **recalcula** tax e **reusa** o shipping snapshot.
- `POST /custom/v1/create-subscription` — API billing direta; o onboarding entra pelo filter HSR, nao por essa rota.
- `POST .../payment-intent/ack` — so persiste status do PI **depois** do front confirmar.
- Woo Store API / `get_checkout_payment_url()` — so aparece no ramo order-first (`payment_url`).

---

## 2) Fluxo completo

```mermaid
sequenceDiagram
    participant Front
    participant JWT as jwt-auth (determine_current_user)
    participant WP as OnboardingApi
    participant RL as RateLimiter (transients)
    participant Repo as OnboardingRepository
    participant SQL as wp_hsr_onboarding_sessions
    participant CS as CheckoutService
    participant Tax as ProductTaxService
    participant Woo as WooCommerce / WC_Tax
    participant Coupon as StripeCouponService (option)
    participant Bill as StripeSubscriptionService
    participant Stripe as Stripe API
    participant Sync as StripeCheckoutSync

    Front->>JWT: Authorization Bearer JWT
    JWT-->>WP: current_user_id
    Front->>WP: POST .../subscription/checkout
    Note over WP: permission_callback (SEM X-Session-Token)
    WP->>RL: consume onboarding_auth (300 / 300s)
    alt estouro auth
        WP-->>Front: 429 rate_limit
    end
    alt nao logado
        WP-->>Front: 401 unauthorized
    end
    WP->>Repo: get(sessionId)
    alt sessao inexistente
        WP-->>Front: 404 session_not_found
    end
    alt linked_user_id != current_user_id
        WP-->>Front: 403 session_forbidden
    end

    Note over WP: callback subscription_checkout
    WP->>CS: checkout(sessionId, payload)
    alt Woo inativo
        CS-->>Front: 503 woocommerce_required
    end
    CS->>Repo: get(sessionId)
    CS->>CS: validate_session_for_checkout
    CS->>CS: revalidate_discount_eligibility_for_checkout
    CS->>Repo: save (plan_selection + checkout_order_id talvez null)
    Repo->>SQL: UPDATE + replace_pets
    Repo->>Repo: set_transient hsr_onb_{sessionId}

    alt payload.checkout_mode == subscription_first
        CS->>CS: checkout_subscription_first
        CS->>Tax: resolve_from_session
        CS->>Coupon: promo_ do prazo (se elegivel)
        CS->>Bill: apply_filters hsr_checkout_create_stripe_subscription
        Bill->>Stripe: customers / paymentMethods / subscriptions.create
        Stripe-->>Bill: sub_ + pi_ + client_secret
        CS->>Repo: save stripe_checkout_json
        CS-->>Front: 200 order_id=0 + stripe_client_secret
    else order_first
        alt pedido pendente com mesmo fingerprint
            CS->>Sync: retry se pm_ e sem sub_
            CS-->>Front: 200 reused=true
        end
        CS->>Woo: wc_create_order + line items + shipping
        CS->>Woo: do_action hsr_checkout_order_ready_for_stripe_sync
        opt payment_method_id presente
            Sync->>Bill: create_subscription
            Bill->>Stripe: subscriptions.create
        end
        CS->>Repo: save checkout_order_id
        CS-->>Front: 200 order_id + payment_url + (client_secret se sync ok)
    end
```

### 2.1 Camada REST (`OnboardingApi::subscription_checkout`)

1. Sanitiza `session_id` com `sanitize_text_field`.
2. Extrai body via `extract_payload`:
   - `get_json_params()` se array **nao vazio**;
   - senao `get_body_params()` (form-urlencoded).
   - `{}` vazio cai no form body (em PHP `empty([])` e true).
3. Chama `CheckoutService::checkout($sessionId, $payload)`.
4. Se `WP_Error` → devolve o erro (formato WP REST `{ code, message, data: { status } }`, **sem** envelope `success: false`).
5. Senao → HTTP `200` com `{ success: true, data: <resultado> }`.

Nao ha rate limit especifico de checkout. So o bucket `onboarding_auth` do permission_callback.

Nao ha validacao de schema REST. Campos extras no JSON sao ignorados.

`checkout_mode` e lido **so** no servico, depois das validacoes comuns. Default = order-first.

```
mode = strtolower(payload.checkout_mode ?? payload.flow)
return mode === 'subscription_first'
```

### 2.2 Autenticacao (`require_linked_user_session_access`)

Roda **antes** do callback. Ordem:

| # | Regra | HTTP | `code` |
|---|---|---|---|
| 1 | `session_id` vazio | 403 | `session_forbidden` |
| 2 | Rate limit auth por sessao (ver 2.2.1) | 429 | `rate_limit` |
| 3 | `! is_user_logged_in()` | 401 | `unauthorized` |
| 4 | sessao inexistente | 404 | `session_not_found` |
| 5 | `linked_user_id` ausente **ou** `linked_user_id !== get_current_user_id()` | 403 | `session_forbidden` |

**Diferenca critica vs outras rotas de onboarding:** este permission **nao** chama `SessionTokenService::validate`. `X-Session-Token` e **ignorado**. A fronteira de auth e:

1. Usuario WP logado (JWT no header `Authorization: Bearer` via plugin `jwt-authentication-for-wp-rest-api`, **ou** cookie de sessao WP).
2. Ownership: o JWT/cookie precisa ser o mesmo `linked_user_id` gravado por `POST .../account-link`.

Swagger e smoke ainda mandam `X-Session-Token`. Funciona, mas nao e checado.

JWT: `Jwt_Auth_Public::determine_current_user` le `HTTP_AUTHORIZATION` / `REDIRECT_HTTP_AUTHORIZATION` com prefixo `Bearer`. Sem JWT e sem cookie → 401.

Origem do JWT: `POST /jwt-auth/v1/token` (username + password). Filter de expiracao: `jwt_auth_expire` (default 7 dias).

CORS: `Plugin::allow_rest_cors_headers` adiciona `x-session-token` (irrelevante para esta rota).

#### 2.2.1 Rate limit de auth

- chave: `onboarding_auth`
- default: `300` tentativas / `300` s
- env: `HSR_ONBOARDING_AUTH_RATE_LIMIT_MAX`, `HSR_ONBOARDING_AUTH_RATE_LIMIT_WINDOW`
- filters: `hsr/onboarding_rate_limit_max`, `hsr/onboarding_rate_limit_window`
- janela efetiva no limiter: `max(60, window)`; tentativas: `max(1, max)`
- transient: `hsr_rl_{md5('onboarding_auth|{sessionId}')}` payload `{ "count": N }`
- 401/403 **ainda consomem** o bucket (permission roda o consume primeiro)

### 2.3 Pipeline comum (`CheckoutService::checkout`) — antes do fork

Gate inicial: `function_exists('wc_create_order') && function_exists('wc_get_product')`. Sem Woo → `503 woocommerce_required`. Vale para **os dois** ramos.

1. `repository->get($sessionId)`. Sem sessao → `404 session_not_found` (segunda checagem; o permission ja fez uma).
2. `validate_session_for_checkout` (tabela abaixo). Falha → HTTP 4xx, **nada gravado**.
3. `revalidate_discount_eligibility_for_checkout` — **sempre** reexecuta as regras de 1a compra (nao confia no GET eligibility).
4. Monta snapshot + fingerprint SHA-256 do contexto (pets, line items, prazo, subtotal, discounted, currency, session_id).
5. Se `checkout_order_id` aponta para pedido inexistente **ou** fingerprint diferente: zera `checkout_order_id` na sessao (pedido antigo fica orfao `pending`).
6. `repository->save($session)` — persiste desconto recalculado em `plan_selection_json` e o `checkout_order_id` (possivelmente null). **Efeito colateral:** `replace_pets` (DELETE + INSERT de todos os pets).

So depois disso o codigo olha `is_subscription_first_checkout($payload)`.

### 2.4 Validacoes de sessao (`validate_session_for_checkout`)

Ordem. Primeira falha aborta.

| # | Regra | HTTP | `code` | Message (EN) |
|---|---|---|---|---|
| 1 | `linked_user_id <= 0` | 422 | `customer_required` | An active linked customer is required before checkout. Use account-link first. |
| 2 | `get_user_by('id')` falhou | 422 | `customer_required` | Linked customer is invalid. Please link a valid account before checkout. |
| 3 | user meta `hsr_activation_status` !== `active` | 403 | `customer_inactive` | Linked customer must have an active account before checkout. |
| 4 | `pets` vazio / nao-array | 422 | `session_incomplete` | Add at least one pet before checkout. |
| 5 | `questionnaire` nao e array | 422 | `session_incomplete` | Questionnaire is required before checkout. |
| 6 | `plan_selection` nao e array | 422 | `session_incomplete` | Plan selection is required before checkout. |
| 7 | `plan_selection.catalog_pricing.line_items` vazio | 422 | `session_incomplete` | Plan pricing snapshot is required before checkout. |
| 8 | `recurrence` nao e array | 422 | `session_incomplete` | Recurrence selection is required before checkout. |
| 9 | `zipcode` nao e array | 422 | `session_incomplete` | Zip code and address are required before checkout. |
| 10 | produtos precisam de shipping **e** `plan_selection.shipping` nao e array | 422 | `session_incomplete` | Shipping selection is required before checkout. |

`session_requires_shipping`:

- para cada line item, carrega `wc_get_product(variation_id || product_id)`;
- se **qualquer** produto `needs_shipping()` → exige shipping;
- se **nenhum** produto Woo foi encontrado → **exige shipping** (fail-closed);
- se todos os produtos conhecidos **nao** precisam de shipping → shipping opcional.

Nao valida: autenticidade da quote de frete, CEP vs pais da sessao, `payment_method_id` (isso e por ramo), cupom no body.

### 2.5 Revalidacao de desconto de 1a compra

Nao usa o resultado persistido de `GET .../discount/eligibility`. Recalcula:

1. `user_has_paid_order_history(linked_user_id, exclude=checkout_order_id)` — `wc_get_orders` status `pending|on-hold|processing|completed`. Pedido **pending** conta. O pedido da propria sessao e excluido.
2. Senao, `user_has_active_subscription` — `SELECT 1 FROM {prefix}hsr_stripe_subscriptions WHERE wp_user_id = ? AND status IN ('active','trialing')`; fallback pelo `customer_email`. Tabela ausente / throw → trata como **sem** assinatura (elegivel).
3. Motivos: `HAS_PREVIOUS_PURCHASE` (prioridade) ou `HAS_ACTIVE_SUBSCRIPTION`. Inelegibilidade **nao** e HTTP 4xx; `eligible=false` e `applied_discount_percent=0`.

Percentual (constantes PHP, iguais ao `plan/snapshot`):

| `subscription_term_months` | % |
|---|---|
| 6 | 40 |
| 3 | 25 |
| 1 | 10 |
| outro | 0 |

`discounted_first_month_total = round(subtotal * (1 - percent/100), 2)` e gravado em `plan_selection.catalog_pricing`. Tambem grava `plan_selection.discount_eligibility`, `plan_selection.discount_percent_applied` e, **em memoria**, `session.discount_eligibility`.

O top-level `discount_eligibility` **nao** tem coluna SQL. Sobrevive no transient `hsr_onb_*` deste save; o proximo `get()` via SQL so ve o bloco dentro de `plan_selection_json`. No mesmo request o ramo `subscription_first` usa o objeto em memoria.

`resolve_first_purchase_promotion_for_checkout` (depois, em cada ramo):

| Condicao | Resultado |
|---|---|
| `!eligible` ou percent `<= 0` | `null` (checkout segue **sem** `discounts`) |
| prazo fora de `{1,3,6}` | `503 first_purchase_promo_not_configured` |
| slot `promo_` vazio / nao comeca com `promo_` | `503` + incrementa option `pawbowl_stripe_first_purchase_promo_misconfig_count` + log `hsr-first-purchase-promo` |
| mapeado | `{ promotion_code_id, discount_percent, coupon_id: '', duration: 'once' }` |

Fonte do `promo_id`: `StripeCouponService::get_promotion_code_id_for_term` → option `pawbowl_stripe_first_purchase_promos` (`{"1":"promo_...","3":"...","6":"..."}`). Sem a classe, le a option direto.

O front **nao** manda cupom. Nao ha campo de promocao no body.

### 2.6 Fingerprint do contexto

`build_checkout_context_snapshot` → `normalize_checkout_context_for_hash` → `hash('sha256', wp_json_encode(...))`.

Entra no hash:

- `session_id`
- `currency` (USD/BRL do catalogo, senao pais zipcode/session, senao `get_woocommerce_currency()`)
- `subtotal`
- `discounted_first_month_total`
- `subscription_term_months`
- line items (`product_id`, `variation_id`, `quantity`, `line_total`) ordenados
- pets (`id`, `name`) ordenados

**Nao entra:** shipping, zipcode, tax, payment method, questionnaire, recurrence.

Usos:

- invalidar `checkout_order_id` se o pedido existente nao bate;
- reuso no ramo B (`should_reuse_checkout_order`);
- metadata / check `checkout_context_mismatch` no create Stripe (409).

---

## 3) Request / response

### 3.1 Headers

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/subscription/checkout
Content-Type: application/json
Authorization: Bearer {jwt}
```

`X-Session-Token` e opcional nesta rota (nao validado). Cookie WP autenticado tambem satisfaz `is_user_logged_in()`.

Pre-requisitos de jornada (nao sao lidos do body, vem da sessao):

```
POST .../session/start
POST .../pets
POST .../questionnaire   (ou auto-hidratacao via recommendation)
POST .../recurrence
POST .../plan-selection  (grava catalog_pricing.line_items)
POST .../zipcode
POST .../shipping/select (se needs_shipping)
POST .../account-link    (JWT + linked_user_id; conta active via OTP)
GET  .../payment-methods (opcional; reusar pm_)
```

### 3.2 Body aceito

Nao ha schema REST. Campos lidos:

| Campo | Aliases | Uso |
|---|---|---|
| `checkout_mode` | `flow` | `subscription_first` liga o ramo A; qualquer outro / ausente = ramo B |
| `payment_method_id` | `paymentMethodId` | obrigatorio no ramo A; no B dispara sync Stripe se comecar com `pm_` |
| `priceId` | `price_id` | opcional no ramo A; fallback = primeiro Price mapeado |
| `attempt_id` | — | idempotencia Stripe; se omitido o PHP gera UUID **novo** |
| `billing.first_name` | — | nome no customer Stripe / pedido Woo |
| `billing.last_name` | — | idem |
| `billing.email` | — | pedido Woo (ramo B); ramo A usa email do **WP user** |
| `billing.phone` | — | pedido Woo / fallback zipcode.phone |
| `billing.company` | — | pedido Woo |
| `product_id` / `variation_id` / `quantity` | — | legado ramo B; ignorado se a sessao ja tem `line_items` |

Campos extras sao ignorados.

### 3.3 Sucesso `subscription_first`

Request:

```http
POST /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/subscription/checkout
Content-Type: application/json
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...

{
  "checkout_mode": "subscription_first",
  "payment_method_id": "pm_1NxxxxCard",
  "attempt_id": "7c2e1f3a-9b10-4d2a-8c11-55aa00bbccdd",
  "billing": {
    "first_name": "Charles",
    "last_name": "Mendes",
    "phone": "+12125550100"
  }
}
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "order_id": 0,
    "order_key": "",
    "status": "pending",
    "total": 87.5,
    "subtotal": 79.0,
    "product_tax": 0.0,
    "shipping_total": 8.5,
    "shipping_tax": 0.0,
    "shipping_total_with_tax": 8.5,
    "currency": "USD",
    "payment_url": "",
    "subscription_ids": [],
    "flexible_subscription_id": 0,
    "stripe_subscription_id": "sub_1Nxxxx",
    "stripe_client_secret": "pi_1Nxxxx_secret_abc",
    "stripe_payment_intent_id": "pi_1Nxxxx",
    "stripe_payment_intent_status": "requires_confirmation",
    "stripe_subscription_status": "incomplete",
    "stripe_sync_error": "",
    "stripe_sync_debug": [],
    "hsr_idempotency_key": "hsr-sub-create-42-deadbeef-price_xxx-aabbccdd-none",
    "hsr_attempt_id": "7c2e1f3a-9b10-4d2a-8c11-55aa00bbccdd",
    "checkout_trace_id": "6f1e2c90-....",
    "payment_state": "requires_confirmation",
    "has_payment_method": true,
    "reused": false
  }
}
```

`checkout_trace_id` e gerado **por response** (`wp_generate_uuid4`), nao e persistido. `product_tax` neste exemplo e 0 porque `STRIPE_US_AUTOMATIC_TAX=1` (Phase 2: Woo devolve placeholder 0; o imposto real esta na invoice Stripe, nao neste `data.total`).

`data.total` HSR = `productSubtotal + productTax + shippingCost + shippingTaxTotal`. **Nao** e o `invoice.total` da Stripe (cupom e Stripe Tax podem divergir).

Front seguinte: `stripe.confirmPayment({ clientSecret })` e depois `POST .../payment-intent/ack`.

### 3.4 Sucesso order-first **sem** `pm_` (smoke)

```json
{
  "product_id": 123,
  "variation_id": 0,
  "quantity": 1,
  "billing": {
    "first_name": "Charles",
    "last_name": "Mendes",
    "email": "charles_test@example.com",
    "phone": "+5511999999999"
  }
}
```

`product_id` e ignorado se a sessao ja tem `catalog_pricing.line_items`.

Response `200` (shape de `present_checkout`): mesmo envelope, porem `order_id > 0`, `payment_url` Woo preenchida, campos Stripe vazios, `payment_state: pending_payment_method`, `has_payment_method: false`.

Segundo POST identico (fingerprint igual, status `pending`) → `"reused": true`, mesmo `order_id`.

Com `pm_`: campos Stripe preenchidos; `payment_state` = `requires_confirmation` ou `sync_error`. Falha Stripe neste ramo **nao** muda o HTTP 200. Ver [03](./03-ramo-order-first.md).

### 3.5 `payment_state`

`resolve_payment_state` (order-first). `subscription_first` forca `requires_confirmation` na hora do create.

| Condicao (primeira que casar) | `payment_state` |
|---|---|
| status Woo `processing` / `completed` | `paid` |
| `_hsr_stripe_sync_error` nao vazio | `sync_error` |
| PI `succeeded` / `processing` / `requires_capture` | `paid` |
| PI `requires_payment_method` | `failed` |
| `client_secret` nao vazio | `requires_confirmation` |
| tem `sub_` e tem `pm_` | `requires_confirmation` |
| tem `pm_` | `pending_sync` |
| senao | `pending_payment_method` |

Quando `paid`, `present_checkout` zera `stripe_client_secret` na **resposta** (meta pode ainda ter o secret ate o ack/webhook).

### 3.6 Erros HTTP

Formato WP REST: `{ "code", "message", "data": { "status": N } }`. Sem `success: false`. Casar no front por `code`.

| HTTP | `code` | Ramo | Quando | Message (EN) |
|---|---|---|---|---|
| 401 | `unauthorized` | permission | sem JWT/cookie | Authentication is required. |
| 403 | `session_forbidden` | permission | `session_id` vazio ou JWT de outro user | Session access denied. |
| 403 | `customer_inactive` | comum | `hsr_activation_status !== active` | Linked customer must have an active account before checkout. |
| 404 | `session_not_found` | permission / comum | sessao inexistente | Onboarding session not found. |
| 409 | `checkout_context_mismatch` | Stripe | fingerprint do pedido != atual | Checkout context changed. Please refresh checkout and try again. |
| 409 | `payment_method_attached_to_other_customer` | Stripe | `pm_` ja no outro `cus_` | This payment method is attached to a different Stripe customer. |
| 409 | `concurrent_subscription_create` | Stripe | lock 120s | Another subscription creation is in progress for this order/attempt. |
| 422 | `customer_required` | comum | sem `linked_user_id` / user invalido | ... Use account-link first. |
| 422 | `session_incomplete` | comum | pets / questionnaire / plan / pricing / recurrence / zipcode / shipping | varia (ver 2.4) |
| 422 | `invalid_payment_method` | A | sem `pm_` | payment_method_id is required and must be a Stripe PaymentMethod ID. |
| 422 | `invalid_price_id` | A | sem Price mapeado | At least one mapped Stripe Price ID is required for checkout. / priceId is required... |
| 422 | `invalid_customer_email` | A / Stripe | email WP invalido | A valid customer email is required. |
| 422 | `invalid_promotion_code_id` | Stripe | `promo_` malformado | promotion_code_id must start with promo_. |
| 422 | `invalid_subscription_items` | Stripe | item sem `price_` | Each item must include a valid Stripe Price ID. |
| 422 | `invalid_subscription_items_mixed_cycle_or_currency` | Stripe | prices misturam moeda/intervalo | All subscription items must use the same currency and billing cycle. |
| 422 | `sales_tax_unavailable` | A / tax / Stripe | US sem rates Woo, ou flag on sem address, ou flag off sem percent | Unable to calculate sales tax for this address |
| 422 | `shipping_currency_missing` | Stripe | frete > 0 sem currency | Unable to determine shipping currency for initial invoice. |
| 422 | `shipping_amount_invalid` | Stripe | minor units <= 0 | Unable to determine shipping amount for initial invoice. |
| 422 | `stripe_payment_method_retrieve_failed` | Stripe | retrieve `pm_` throw | message da Stripe |
| 422 | `invalid_product` | B | lines vazias e sem `product_id` (quase morto) | No checkout line items available in session and product_id is missing. |
| 429 | `rate_limit` | permission | 300/300s | Too many requests. Please try again later. |
| 500 | `order_create_failed` | B | `wc_create_order` nao retornou order | Unable to create checkout order. |
| 500 | `checkout_failed` | B | throw no try de criacao | Checkout order creation failed. (`data.details` = exception) |
| 502 | `stripe_subscription_failed` | A | SDK throw / sub ou client_secret vazio | message da Stripe ou Unable to create Stripe subscription. |
| 502 | `stripe_customer_failed` | Stripe | create/retrieve sem `cus_` | Unable to create/retrieve Stripe customer. |
| 502 | `stripe_price_retrieve_failed` | Stripe | `prices.retrieve` throw | message da Stripe |
| 502 | `stripe_tax_rate_create_failed` | Stripe | `taxRates.create` throw | message da Stripe |
| 502 | `shipping_product_unavailable` | Stripe | nao criou prod Shipping | Unable to prepare shipping product for initial invoice. |
| 503 | `woocommerce_required` | comum | Woo inativo | WooCommerce must be active to run checkout. |
| 503 | `stripe_subscription_unavailable` | A | plugin billing off | Stripe checkout subscription flow is unavailable. |
| 503 | `stripe_sdk_missing` | Stripe | `\Stripe\StripeClient` ausente | Stripe SDK is not available in this environment. |
| 503 | `stripe_secret_missing` | Stripe | env vazio | STRIPE_SECRET_KEY is not configured. |
| 503 | `first_purchase_promo_not_configured` | comum (elegivel) | slot `promo_` vazio ou prazo invalido | First-purchase discount is temporarily unavailable... / ...unavailable for this plan term... |

Exemplos:

Sessao sem account-link (JWT de user que nao e o linked — ou permission 403 se `linked_user_id` vazio):

```json
{
  "code": "session_forbidden",
  "message": "Session access denied.",
  "data": { "status": 403 }
}
```

Sem pets (passou do permission):

```json
{
  "code": "session_incomplete",
  "message": "Add at least one pet before checkout.",
  "data": { "status": 422 }
}
```

Elegivel 1a compra, admin nao mapeou o `promo_` de 3 meses:

```json
{
  "code": "first_purchase_promo_not_configured",
  "message": "First-purchase discount is temporarily unavailable. Please try again later or contact support.",
  "data": { "status": 503 }
}
```

Stripe recusou o Price:

```json
{
  "code": "stripe_subscription_failed",
  "message": "No such price: 'price_doesNotExist'",
  "data": { "status": 502 }
}
```

---

## 4) Relacao com o resto do onboarding

Fluxo feliz US (Phase 2, flag ligada, ramo A):

```
1. POST .../zipcode
2. POST .../plan-selection            → catalog_pricing.line_items (product/variation ids)
3. POST .../shipping/select           → product_tax=0, jurisdiction=state
4. POST .../subscription/preview      → Stripe Tax informativo (front manda price_ids)
5. POST .../account-link              → linked_user_id + JWT
6. POST .../subscription/checkout     → esta rota, checkout_mode=subscription_first
      → customers + attach pm_ + subscriptions.create
        automatic_tax=true + add_invoice_items + promo se 1a compra
7. Front confirma PI (Stripe.js)
8. POST .../payment-intent/ack
9. Webhook invoice.paid               → materializa Woo order + Flexible sub
```

Phase 1 / smoke (flag off, ramo B, sem `pm_`):

```
6'. POST .../subscription/checkout    → wc_create_order, payment_url Woo
      Stripe so entra se o front mandar payment_method_id
```

GET sessao expoe `checkout_order_id`. O JSON `stripe_checkout` fica no banco para o webhook achar a sessao; o front do checkout deve guardar `client_secret` da resposta deste POST.
