# POST `/onboarding/session/{session_id}/subscription/checkout`

Documentacao da logica **atual** do checkout de assinatura no onboarding.

Escopo: converter a sessao de onboarding (plano + endereco + frete + usuario vinculado) em cobranca Stripe da **primeira fatura**, devolvendo `client_secret` para o front confirmar o PaymentIntent. Existem **dois ramos** no mesmo endpoint, escolhidos pelo body:

| `checkout_mode` / `flow` | Nome interno | Pedido Woo na hora? | Stripe na hora? |
|---|---|---|---|
| `subscription_first` | fluxo preferencial (docs de cupom / billing) | **nao** (`order_id: 0`); materializa no webhook `invoice.paid` | **sim**, via filter `hsr_checkout_create_stripe_subscription` |
| ausente / qualquer outro valor | `order_first_checkout` (smoke/Postman) | **sim**, `wc_create_order` | so se o body tiver `payment_method_id` (`pm_...`); erros Stripe **nao** viram HTTP 5xx |

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

So depois disso o codigo olha `is_subscription_first_checkout($payload)`:

```
mode = strtolower(payload.checkout_mode ?? payload.flow)
return mode === 'subscription_first'
```

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

---

## 3) Ramo A — `subscription_first`

Ativado por `"checkout_mode": "subscription_first"` (ou `"flow": "subscription_first"`).

### 3.1 Validacoes extras do ramo

| # | Regra | HTTP | `code` |
|---|---|---|---|
| 1 | `payment_method_id` / `paymentMethodId` vazio ou nao comeca com `pm_` | 422 | `invalid_payment_method` |
| 2 | nenhum Price mapeado a partir dos line items | 422 | `invalid_price_id` |
| 3 | `priceId`/`price_id` (ou fallback do 1o item) vazio / nao `price_` | 422 | `invalid_price_id` |
| 4 | email do WP user vinculado invalido | 422 | `invalid_customer_email` |
| 5 | `ProductTaxService::resolve_from_session` falhou (US, flag off, rates Woo vazias) | 422 | `sales_tax_unavailable` |
| 6 | promo 1a compra (secao 2.5) | 503 | `first_purchase_promo_not_configured` |
| 7 | filter retorna nao-array | 503 | `stripe_subscription_unavailable` |

`attempt_id`: do payload ou `wp_generate_uuid4()`. **Novo UUID a cada retry se o front nao reenviar o mesmo** — isso muda a idempotency key Stripe (ver 3.3).

Endereco enviado a Stripe = shipping da sessao (`zipcode`), com `address_1 = street + ", " + number` se o number ainda nao estiver na street. Billing first/last name vem do body (`payload.billing`); email vem do **WP user**, nao do body (o body so entra no `build_address` para o campo email se o user nao tiver — mas o check de email usa o user).

Mapeamento Price (`resolve_checkout_items_from_session`):

1. Para cada `catalog_pricing.line_items[]`: tenta `variation_id` depois `product_id`.
2. Le post meta `_stripe_price_ids_by_currency` (JSON `{ "usd": "price_...", "brl": "price_..." }`) na **moeda** da sessao (`catalog_pricing.currency` se USD/BRL; senao pais zipcode/session; senao `get_woocommerce_currency()`).
3. Fallback: `_stripe_price_id` depois `stripe_price_id`.
4. Fallback: primeiro valor do mapa.
5. Lines sem `price_` sao **silenciosamente puladas**.
6. Quantities do mesmo `price_` sao somadas; resultado ordenado por `ksort` do price id.

Se **todas** as lines forem puladas → 422 `invalid_price_id`.

### 3.2 Filter `hsr_checkout_create_stripe_subscription`

HSR monta o payload e chama:

```php
$result = apply_filters('hsr_checkout_create_stripe_subscription', null, $filterPayload);
```

`PawBowlStripe\Plugin` registra o unico listener (priority 10, 2 args) e encaminha para `StripeSubscriptionService::create_subscription`. Sem o plugin billing, `$result` continua `null` → 503.

Payload do filter (campos sanitizados de novo no listener):

```json
{
  "customerEmail": "user@example.com",
  "customerName": "Charles Mendes",
  "paymentMethodId": "pm_...",
  "items": [{ "price": "price_...", "quantity": 2 }],
  "priceId": "price_...",
  "sessionId": "3abf4b2d-...",
  "attempt_id": "uuid",
  "checkout_context_fingerprint": "sha256...",
  "shipping_rate_id": "...",
  "shipping_method_id": "...",
  "shipping_label": "UPS Ground",
  "shipping_cost": 8.5,
  "shipping_tax_total": 0.68,
  "shipping_currency": "USD",
  "tax_country": "US",
  "tax_jurisdiction": "NY",
  "product_tax_percent": 8.875,
  "product_tax": 7.01,
  "customer_address": {
    "line1": "350 5th Avenue, 100",
    "line2": "",
    "city": "New York",
    "state": "NY",
    "postal_code": "10001",
    "country": "US"
  },
  "checkout_mode": "subscription_first",
  "source": "headless_secure_registration",
  "promotion_code_id": "promo_...",
  "discount_percent": 25,
  "discount_coupon_id": "",
  "discount_duration": "once"
}
```

Campos de promo so entram se `resolve_first_purchase_promotion` retornou array. `source` e injetado pelo listener do plugin Stripe, nao pelo HSR.

### 3.3 `StripeSubscriptionService::create_subscription` — o que a Stripe recebe

Servico backend: **Stripe Billing API** (`api.stripe.com`), client `\Stripe\StripeClient` via `StripeClientFactory`.

Env:

| Env | Uso | Default no PHP se vazio |
|---|---|---|
| `STRIPE_SECRET_KEY` | `api_key` | 503 `stripe_secret_missing` |
| `STRIPE_API_VERSION` | `stripe_version` do client | omite (SDK default) |
| `STRIPE_MAX_RETRIES` | `Stripe::setMaxNetworkRetries` | **0** (`.env.example` declara `2`) |
| `STRIPE_US_AUTOMATIC_TAX` | `automatic_tax.enabled` se pais US | off (`0`) |

Nao ha HTTP interno PawBowl alem do WordPress. Todas as idas externas deste ramo sao Stripe.

#### Chamadas Stripe (ordem feliz)

| # | Recurso Stripe | Metodo | Quando | Payload resumido | Resposta esperada |
|---|---|---|---|---|---|
| 1 | Customers | `GET /v1/customers?email=&limit=1` (`customers->all`) | sempre | `email`, `limit: 1` | lista; usa `data[0]` se houver |
| 2 | Customers | `POST /v1/customers` (`customers->create`) | nenhum customer com aquele email | `email`, `name`, `metadata.wp_user_id` | `cus_...` |
| 3 | PaymentMethods | `GET /v1/payment_methods/{pm}` | sempre | id `pm_...` | objeto PM; 422 se retrieve falhar |
| 4 | PaymentMethods | `POST /v1/payment_methods/{pm}/attach` | PM sem `customer` | `{ customer: cus_... }` | PM anexado. Se `customer` **outro** `cus_` → 409 `payment_method_attached_to_other_customer` |
| 5 | Customers | `POST /v1/customers/{cus}` | sempre apos attach | `invoice_settings.default_payment_method`; se address tiver `country`+`postal_code`: `address` + `shipping` | customer atualizado |
| 6 | Prices | `GET /v1/prices/{price}` | **so se** `count(items) > 1` | — | checa mesma `currency` + `recurring.interval` + `interval_count`. Mix → 422 `invalid_subscription_items_mixed_cycle_or_currency`. Retrieve falhou → 502 `stripe_price_retrieve_failed` |
| 7 | Tax Rates | `POST /v1/tax_rates` | US **e** `STRIPE_US_AUTOMATIC_TAX` off **e** percent > 0 | `display_name`, `percentage`, `inclusive: false`, `jurisdiction`, `country: US` | `txr_...` cacheado 7 dias no transient `stripe_tax_rate_{STATE}_{percent}` |
| 8 | Products | `GET /v1/products/{prod}` ou `POST /v1/products` | frete > 0 | name `Shipping`, `tax_code: txcd_92010001` | id em option `hsr_stripe_initial_shipping_product_id` |
| 9 | Subscriptions | `POST /v1/subscriptions` | sempre (se nao reuse) | ver abaixo | `sub_...` + `latest_invoice.payment_intent` expandido |
| 10 | PaymentIntents | `GET /v1/payment_intents/{pi}` | so no **reuse** de pedido com PI existente (`reconcile_order_payment_intent_status`) | — | status atualizado na order meta |

`create_subscription` **nao** chama `paymentIntents.create` nem `checkout.sessions.create`. O PI nasce da invoice da subscription.

#### Body de `subscriptions.create`

```json
{
  "customer": "cus_...",
  "items": [
    { "price": "price_meal_chicken", "quantity": 2, "tax_rates": ["txr_..."] }
  ],
  "default_payment_method": "pm_...",
  "payment_behavior": "default_incomplete",
  "expand": ["latest_invoice.payment_intent", "latest_invoice.discounts", "discounts"],
  "metadata": {
    "wp_user_id": "42",
    "source": "hsr_headless",
    "hsr_attempt_id": "uuid",
    "onboarding_session_id": "3abf4b2d-...",
    "hsr_items_digest": "abc...",
    "hsr_item_count": "1",
    "hsr_primary_price_id": "price_...",
    "hsr_shipping_rate_id": "...",
    "hsr_shipping_method_id": "...",
    "hsr_shipping_label": "UPS Ground",
    "hsr_shipping_cost": "8.5",
    "hsr_shipping_tax_total": "0.68",
    "hsr_shipping_currency": "USD",
    "hsr_idempotency_key": "hsr-sub-create-...",
    "hsr_promotion_code_id": "promo_...",
    "hsr_initial_shipping_mode": "add_invoice_items",
    "hsr_initial_shipping_amount_minor": "918"
  },
  "automatic_tax": { "enabled": true },
  "discounts": [{ "promotion_code": "promo_..." }],
  "add_invoice_items": [
    {
      "price_data": {
        "currency": "usd",
        "product": "prod_shipping",
        "unit_amount": 850,
        "tax_behavior": "exclusive"
      },
      "quantity": 1,
      "metadata": { "source": "hsr_initial_subscription_shipping" }
    }
  ]
}
```

Regras de montagem:

- `automatic_tax.enabled: true` **somente** se flag on **e** pais US. Sem address normalizado (`country` + `postal_code`) nesse ramo → 422 `sales_tax_unavailable`.
- Flag off + US: anexa `tax_rates` em **cada** item (nao no shipping invoice item). US sem state/percent → 422 `sales_tax_unavailable`. Pais != US: sem tax_rates e sem automatic_tax.
- `discounts` so se `promotion_code_id` comeca com `promo_` (senao 422 `invalid_promotion_code_id` **antes** da chamada).
- Frete na 1a invoice:
  - flag on: `unit_amount` = so `shipping_cost` (tax do frete a Stripe Tax calcula).
  - flag off: `unit_amount` = `shipping_cost + shipping_tax_total`.
  - `shipping_currency` vazio com frete > 0 → 422 `shipping_currency_missing`.
  - Conversao major→minor: `stripe_amount_decimal_to_minor` (centavos para USD/BRL).
- Header Stripe `Idempotency-Key`:

```
hsr-sub-create-{wpUserId}-{sha256(email)}-{itemsScope}-{attemptHash16}-{promoScope12}
```

`attemptHash` = primeiros 16 hex de `sha256(attempt_id)`. Sem `attempt_id` estavel no front, **cada POST cria outra subscription**.

Lock WP (nao e Stripe): option `hsr_sub_lock_order_{orderId}` ou `hsr_sub_lock_{attemptHash}`, TTL 120 s. Concorrencia sem estado persistido → 409 `concurrent_subscription_create`.

Reuse: se `resolve_order_id_for_subscription` achar um pedido (meta `_hsr_onboarding_session_id` ou `orderId` no payload) **com** `sub_` / PI settled / status active|trialing, devolve o estado persistido com `reused: true` **sem** novo `subscriptions.create`. Fingerprint divergente → 409 `checkout_context_mismatch`. No `subscription_first` o HSR manda `orderId` omitido (`0`); o resolver ainda pode achar pedido antigo da **mesma sessao**.

Pos-create, se `subscriptionId` **ou** `clientSecret` vazio → 502 `stripe_subscription_failed`. Qualquer throw do SDK → 502 `stripe_subscription_failed` com `getMessage()` cru da Stripe.

Resposta interna do servico (nao e o envelope HTTP):

```json
{
  "clientSecret": "pi_..._secret_...",
  "subscriptionId": "sub_...",
  "customerId": "cus_...",
  "status": "incomplete",
  "paymentIntentId": "pi_...",
  "paymentIntentStatus": "requires_confirmation",
  "current_period_end": 0,
  "orderId": 0,
  "hsr_idempotency_key": "hsr-sub-create-...",
  "hsr_attempt_id": "uuid",
  "reused": false
}
```

(`reused` so no early-return.)

### 3.4 Persistencia apos o filter (HSR)

`session.stripe_checkout` gravado em `stripe_checkout_json`:

```json
{
  "checkout_mode": "subscription_first",
  "stripe_subscription_id": "sub_...",
  "stripe_client_secret": "pi_..._secret_...",
  "stripe_payment_intent_id": "pi_...",
  "stripe_payment_intent_status": "requires_confirmation",
  "stripe_subscription_status": "incomplete",
  "hsr_idempotency_key": "...",
  "hsr_attempt_id": "...",
  "currency": "USD",
  "subtotal": 79.0,
  "product_tax": 0.0,
  "product_tax_percent": 0.0,
  "tax_jurisdiction": "NY",
  "total": 87.5,
  "payment_state": "requires_confirmation",
  "promotion_code_id": "promo_...",
  "discount_percent": 25,
  "discount_duration": "once"
}
```

`total` HSR = `productSubtotal + productTax + shippingCost + shippingTaxTotal` — **nao** e o `invoice.total` da Stripe (pode divergir com cupom e Stripe Tax).

`order_id` na resposta HTTP e **0**. Pedido Woo nasce depois, em `CheckoutService::on_stripe_invoice_paid_confirmed` → `materialize_order_from_subscription_first`, disparado pelo webhook (`hsr_stripe_invoice_paid_confirmed`). Lookup da sessao: `stripe_checkout_json LIKE '%"stripe_subscription_id":"sub_..."%'`.

Billing tambem grava no mesmo `create_subscription`:

- ledger `{prefix}hsr_stripe_subscriptions` (+ enrichment);
- option `hsr_stripe_subscription_order_map` (order_id pode ser 0);
- option `hsr_idempotency_audit` (cap 5000, trim 2000);
- metas de order **so** se `resolvedOrderId > 0`.

---

## 4) Ramo B — `order_first_checkout`

Default quando o body **nao** tem `checkout_mode`/`flow` = `subscription_first`. E o caminho do smoke/Postman.

### 4.1 Reuso de pedido

`should_reuse_checkout_order`:

- status Woo em `{ pending, failed, on-hold }`;
- meta `_hsr_checkout_context_fingerprint` presente e `hash_equals` com o fingerprint atual.

Se reusa:

1. `sync_reused_order_context` — corrige currency e billing email vazio.
2. `retry_stripe_sync_for_reused_order` — se ainda nao tem `sub_` **e** tem `pm_`, dispara de novo `hsr_checkout_order_ready_for_stripe_sync` (`flow: order_reuse_retry`).
3. `present_checkout(..., reused: true)` — HTTP 200.

Fingerprint **nao inclui** shipping, zipcode, tax, payment method nem pets alem de `id`+`name`. Mudar frete **sem** mudar line items/prazo **reusa o pedido velho** (shipping antigo no Woo).

Se nao reusa: cria pedido novo. O anterior permanece `pending` orfao.

### 4.2 Criacao do pedido Woo

1. `build_checkout_lines` a partir de `catalog_pricing.line_items` (`variation_id` preferido). Fallback legado: `payload.product_id` / `variation_id` / `quantity` — so se as lines da sessao estiverem vazias (o validate ja exige lines, entao o fallback quase nao dispara no caminho feliz).
2. `ProductTaxService::resolve_from_session` — falha US/Woo → 422 **antes** de criar o pedido.
3. `wc_create_order({ customer_id: linked_user_id })`.
4. `add_product` por line; se a line tem `line_total`, forca subtotal/total do item.
5. `build_address` — zipcode da sessao + `payload.billing` (first/last/email/phone/company).
6. Metas Eden: `_eden_delivery_instructions`, `_eden_phone_country` (do zipcode).
7. `_hsr_payment_method_id` se `pm_` no body.
8. `apply_selected_shipping` → `WC_Order_Item_Shipping` com cost/tax do snapshot.
9. `persist_shipping_projection_meta` — `_hsr_shipping_*` e `_hsr_product_tax*`.
10. Snapshot de onboarding em metas `_hsr_onboarding_*`, desconto, fingerprint, payload cru.
11. `calculate_totals`; se houve `line_total` forcado, **reescreve** `order.total` = lines + fees + shipping + shipping_tax + `_hsr_product_tax` (Woo tax nativo pode ser ignorado).
12. `_hsr_checkout_deferred_local_subscription = 1` — **nao** cria Flexible Subscription agora.
13. `order->save()`.
14. `do_action('hsr_checkout_order_ready_for_stripe_sync', $order, { session_id, fingerprint, flow: 'order_first_checkout' })` — **sincrono no mesmo request**.
15. Grava `session.checkout_order_id`. Throw qualquer → 500 `checkout_failed` com `details` = exception message (pedido pode ter ficado pela metade).

### 4.3 `StripeCheckoutSync::sync_order`

Listener de `hsr_checkout_order_ready_for_stripe_sync`.

Early-return **silencioso** (HTTP 200 do checkout mesmo assim):

- ja existe `_hsr_stripe_subscription_id`;
- nao ha `pm_` na order meta.

Erros viram meta `_hsr_stripe_sync_error` (string) e o checkout **ainda devolve 200** com `payment_state: sync_error`:

| Valor gravado | Quando |
|---|---|
| `missing_price_mapping` | nenhum line item mapeou `price_` (+ `_hsr_stripe_sync_debug` JSON) |
| `missing_billing_email` | email de billing vazio/invalido |
| `first_purchase_promo_not_configured` | percent > 0 e slot `promo_` vazio |
| message do `WP_Error` | `create_subscription` falhou |
| `missing_subscription_id_after_sync` | resultado sem `subscriptionId` |

Se ok: grava `_hsr_stripe_subscription_id`, `_hsr_stripe_client_secret`, PI id/status, idempotency/attempt. O `create_subscription` neste ramo **passa `orderId`**, entao lock/reuse/metas de order funcionam de verdade.

Flexible Subscription local: **nao** neste POST. `on_stripe_invoice_paid_confirmed` chama `do_action('woocommerce_rest_insert_shop_order_object', $order, null, true)` para o plugin Flexible criar `fsb_subscription`, depois `hsr_flexible_subscription_confirmed_after_payment`.

---

## 5) Request / response

### 5.1 Headers

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
```

### 5.2 Sucesso `subscription_first` (fluxo preferencial)

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

`price_id` omitido: usa o primeiro Price mapeado dos line items. `paymentMethodId` (camelCase) e aceito.

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

Front seguinte: `stripe.confirmPayment({ clientSecret })` e depois `POST .../payment-intent/ack`.

### 5.3 Sucesso order-first **sem** `pm_` (smoke)

Request (Postman / `SMOKE_TEST_ONBOARDING_CHECKOUT.md`):

```http
POST /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/subscription/checkout
Content-Type: application/json
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
X-Session-Token: eyJzaWQiOiIzYWJmNGIyZC....hmac

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

`product_id` e ignorado se a sessao ja tem `catalog_pricing.line_items`. Email do body vai para o pedido Woo; o email Stripe (se houver sync depois) usa o billing da order.

Response `200` (shape de `present_checkout`):

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "order_id": 4567,
    "order_key": "wc_order_abc123",
    "status": "pending",
    "total": 87.5,
    "subtotal": 79.0,
    "product_tax": 0.0,
    "shipping_total": 8.5,
    "shipping_tax": 0.0,
    "shipping_total_with_tax": 8.5,
    "currency": "BRL",
    "payment_url": "http://localhost:8080/checkout/order-pay/4567/?pay_for_order=true&key=wc_order_abc123",
    "subscription_ids": [],
    "flexible_subscription_id": 0,
    "stripe_subscription_id": "",
    "stripe_client_secret": "",
    "stripe_payment_intent_id": "",
    "stripe_payment_intent_status": "",
    "stripe_subscription_status": "",
    "stripe_sync_error": "",
    "stripe_sync_debug": [],
    "hsr_idempotency_key": "",
    "hsr_attempt_id": "",
    "checkout_trace_id": "6f1e2c90-....",
    "payment_state": "pending_payment_method",
    "has_payment_method": false,
    "reused": false
  }
}
```

Segundo POST identico (fingerprint igual, status `pending`) → `"reused": true`, mesmo `order_id`.

### 5.4 Sucesso order-first **com** `pm_` (sync no mesmo request)

Body adicional:

```json
{
  "payment_method_id": "pm_1NxxxxCard",
  "billing": {
    "first_name": "Charles",
    "last_name": "Mendes",
    "email": "charles_test@example.com"
  }
}
```

`data` igual ao 5.3, porem:

- `stripe_subscription_id`, `stripe_client_secret`, `stripe_payment_intent_id` preenchidos;
- `payment_state`: `requires_confirmation` (tem client_secret) ou `sync_error` se o sync gravou `_hsr_stripe_sync_error`;
- `has_payment_method`: true.

Falha Stripe neste ramo **nao** muda o HTTP 200.

### 5.5 `payment_state` (ambos os ramos)

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

### 5.6 Erros HTTP (resumo)

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

Sessao sem account-link (JWT de user que nao e o linked — ou permission 403 se linked_user_id vazio):

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

## 6) Hooks e filters do WordPress

### 6.1 Especificos desta rota / checkout

| Tipo | Hook | Onde | Efeito |
|---|---|---|---|
| action | `rest_api_init` | `Plugin::boot` | registra a rota |
| filter | `hsr/onboarding_rate_limit_max` | `consume_onboarding_limit` | max do bucket **auth**. Args `($maxAttempts, 'auth')` |
| filter | `hsr/onboarding_rate_limit_window` | idem | janela em segundos |
| filter | `hsr/onboarding_ttl` | `OnboardingRepository::ttl` | TTL do transient `hsr_onb_*` (default 172800) |
| filter | `hsr_checkout_create_stripe_subscription` | `checkout_subscription_first` | unico ponto de criacao Stripe no ramo A. Default `null`. Listener: `PawBowlStripe\Plugin` → `create_subscription` |
| action | `hsr_checkout_order_ready_for_stripe_sync` | ramo B (create e retry) | `StripeCheckoutSync::sync_order`. Args: `($order, $context)` com `flow` = `order_first_checkout` ou `order_reuse_retry` |
| action | `hsr_stripe_invoice_paid_confirmed` | **nao** neste POST; webhook | `CheckoutService::on_stripe_invoice_paid_confirmed` materializa order (ramo A) e Flexible Subscription |
| action | `woocommerce_rest_insert_shop_order_object` | apos invoice paid | trigger intencional para o plugin Flexible criar `fsb_subscription` |
| action | `hsr_flexible_subscription_confirmed_after_payment` | apos materializar | `StripeCheckoutSync::bind_confirmed_flexible_subscription` copia metas Stripe/shipping para a sub Flexible |
| action | `hsr_flexible_subscription_created_before_stripe_sync` | bridge Flexible | outro caminho de sync (nao e o onboarding checkout direto) |
| filter | `rest_allowed_cors_headers` | `Plugin::allow_rest_cors_headers` | libera `x-session-token` |
| filter | `determine_current_user` | jwt-auth | autentica JWT no REST |
| filter | `jwt_auth_expire` | jwt-auth | TTL do JWT (default 7d) |

`hsr/onboarding_token_ttl` **nao** e lido aqui (esta rota nao valida session token).

Filters globais do `RateLimiter` (`hsr/rate_limit_max`, `hsr/rate_limit_window`) **nao** se aplicam: onboarding usa `consume_with_limits` com valores explicitos.

### 6.2 Core WP / Woo envolvidos

| API | Uso |
|---|---|
| REST (`register_rest_route`, `permission_callback`) | roteamento |
| `is_user_logged_in` / `get_current_user_id` / `get_user_by` | auth + email |
| `get_user_meta` (`hsr_activation_status`) | conta ativa |
| `get_post_meta` (`_stripe_price_ids_by_currency`, `_stripe_price_id`, `stripe_price_id`) | mapa Price |
| `$wpdb` | sessao, pets, ledger `hsr_stripe_subscriptions` (elegibilidade) |
| `get_transient` / `set_transient` | rate limit; cache sessao `hsr_onb_*`; cache `txr_` |
| `get_option` / `update_option` / `add_option` | promos, lock `hsr_sub_lock_*`, shipping product, audit, maps |
| `wc_create_order` / `wc_get_order` / `wc_get_orders` / `wc_get_product` | pedido |
| `WC_Tax::find_rates` / `calc_exclusive_tax` | tax US se flag off |
| `WC_Order_Item_Shipping` | frete no pedido |
| `wc_get_logger` | `hsr.present_checkout`, `hsr-idempotency`, `hsr-sub-created`, `pawbowl.stripe_sync`, `hsr-first-purchase-promo` |
| `sanitize_text_field` / `sanitize_email` / `sanitize_textarea_field` | inputs |
| `__()` | i18n EN |
| `wp_generate_uuid4` | attempt_id / checkout_trace_id |
| `hash('sha256')` / `hash_equals` | fingerprint e idempotency |

Nao usa carrinho Woo (`WC_Cart`), Checkout Session Stripe, nem REST de cupons Woo.

---

## 7) Dependencias e efeitos colaterais

### 7.1 O que e lido

- Path: `session_id`.
- Headers: `Authorization` (JWT). `X-Session-Token` ignorado no permission.
- Body: `checkout_mode`/`flow`, `payment_method_id`/`paymentMethodId`, `priceId`/`price_id`, `attempt_id`, `billing.{first_name,last_name,email,phone,company}`, legado `product_id`/`variation_id`/`quantity`.
- SQL sessao: `{prefix}hsr_onboarding_sessions` + `{prefix}hsr_onboarding_pets`.
- `plan_selection_json` (catalog_pricing, shipping, product_tax, subscription_term_months).
- `zipcode_json`, `questionnaire_json`, `recurrence_json`, `linked_user_id`, `checkout_order_id`, `stripe_checkout_json`.
- User: email, meta `hsr_activation_status`.
- Woo orders do usuario (historico de compra).
- `{prefix}hsr_stripe_subscriptions` (assinatura ativa).
- Option `pawbowl_stripe_first_purchase_promos`.
- Post meta de produto/variacao (Price IDs).
- Woo tax tables (US, flag off).
- Env Stripe / `STRIPE_US_AUTOMATIC_TAX`.
- Pedido Woo existente (reuso / fingerprint).

### 7.2 O que e gravado (por ramo)

| Recurso | `subscription_first` | `order_first` |
|---|---|---|
| `plan_selection_json` (desconto recalculado) | sim (save comum) | sim |
| `checkout_order_id` | nao neste POST (fica 0/null) | sim, id Woo |
| `stripe_checkout_json` | sim | nao (estado vai para order meta) |
| `{prefix}hsr_onboarding_pets` | **sim** (`replace_pets` no save comum) | **sim** |
| transient `hsr_onb_{sessionId}` | sim | sim |
| transient rate limit | sim | sim |
| Pedido Woo + metas `_hsr_*` | **nao agora** (webhook) | **sim** |
| Stripe Customer / PM attach / Subscription / Invoice / PI | sim | so se `pm_` |
| `{prefix}hsr_stripe_subscriptions` | sim (create) | sim se sync |
| option lock `hsr_sub_lock_*` | sim (TTL 120s, released no finally) | sim se sync |
| option `hsr_idempotency_audit` | sim | sim se sync |
| option `hsr_stripe_subscription_order_map` | sim (order_id 0) | sim |
| option `hsr_stripe_initial_shipping_product_id` | se frete > 0 | se frete > 0 e sync |
| option `pawbowl_stripe_first_purchase_promo_misconfig_count` | se slot vazio | se slot vazio **no sync** (HTTP 200) |
| transient `stripe_tax_rate_*` | US flag off | US flag off + sync |
| Flexible `fsb_subscription` | **nao** neste POST | **nao** neste POST |
| WC cart / session PHP do shopper | nao | nao |

Metas relevantes no pedido (ramo B, e materializacao A no webhook):

`_hsr_onboarding_session_id`, `_hsr_onboarding_pets`, `_hsr_onboarding_questionnaire`, `_hsr_onboarding_recurrence`, `_hsr_onboarding_plan_selection`, `_hsr_onboarding_zipcode`, `_hsr_discount_eligibility`, `_hsr_discount_applied_percent`, `_hsr_stripe_discount_*`, `_hsr_stripe_promotion_code_id`, `_hsr_checkout_payload`, `_hsr_checkout_context_fingerprint`, `_hsr_checkout_context_snapshot_json`, `_hsr_checkout_context_line_items_json`, `_hsr_checkout_context_pets_json`, `_hsr_checkout_context_total`, `_hsr_checkout_deferred_local_subscription`, `_hsr_flexible_subscription_ids`, `_hsr_payment_method_id`, `_hsr_shipping_*`, `_hsr_product_tax*`, `_hsr_stripe_subscription_id`, `_hsr_stripe_customer_id`, `_hsr_stripe_client_secret`, `_hsr_stripe_payment_intent_*`, `_hsr_idempotency_key`, `_hsr_attempt_id`, `_eden_delivery_instructions`, `_eden_phone_country`.

### 7.3 Consumidores posteriores

| Consumidor | O que le |
|---|---|
| Front Payment Element | `data.stripe_client_secret` |
| `POST .../payment-intent/ack` | order meta **ou** `session.stripe_checkout` se `order_id=0` |
| `GET .../payment-methods` | `_hsr_stripe_customer_id` no pedido da sessao |
| Webhook `invoice.paid` | metadata `onboarding_session_id` / map sub→order; dispara materializacao + Flexible |
| Webhook `invoice.created` | injeta frete recorrente (`invoiceItems.create`) — **nao** este POST, mas depende das metadata de shipping gravadas no create |
| Admin Woo `OrderOnboardingMetabox` | JSON das metas `_hsr_*` |
| `GET` sessao | `checkout_order_id`; **nao** devolve `stripe_checkout` no serializer publico (campo existe no repo) — conferir `OnboardingApi` present session: inclui `checkout_order_id` |

GET sessao (`class-onboarding-api.php` ~999) expoe `checkout_order_id`. O JSON `stripe_checkout` fica no banco para o webhook achar a sessao; o front do checkout deve guardar `client_secret` da resposta deste POST.

### 7.4 Sem efeitos em

- `POST .../subscription/preview` (nao e chamado; preview nao e reusado).
- Catalogo `custom-meal-plan-builder` (nao recalcula preco; usa snapshot).
- ViaCEP / Zippopotam / Nominatim / OSRM.
- Criacao de Promotion Code (so **aplica** o `promo_` ja mapeado).
- `paymentIntents.create` explicito.

---

## 8) Pontos de atencao para reimplementacao em Node

1. **Dois ramos no mesmo path.** O PHP escolhe por `checkout_mode === 'subscription_first'`. Smoke/Postman exercitam o outro. No Node, **padronizar um** (recomendado: `subscription_first` + webhook materializando pedido) e versionar o contrato. Se precisar compat com o front atual, aceitar os dois ate o cutover.

2. **Auth desta rota e JWT de usuario + ownership, nao session token.** Copiar `require_valid_session_access` aqui seria **mudar** o comportamento. Recomendado no Node: exigir **os dois** (session token **e** user vinculado) — e melhoria de seguranca, documentar como breaking se o front so manda JWT.

3. **Gate Woo no topo e acidente historico no ramo A.** `subscription_first` nao cria order na hora, mas 503 se Woo estiver down. Node nao precisa de Woo para cobrar; precisa de catalogo de Prices + snapshot da sessao.

4. **`replace_pets` em todo `save`.** O save comum (desconto + zerar order id) regrava todos os pets. No Node, UPDATE pontual de `plan_selection` / `stripe_checkout` **sem** reescrever pets.

5. **Fingerprint incompleto.** Nao entra shipping, endereco, tax, `pm_`. Reuso de pedido com frete/CEP mudado e um bug a **nao** copiar. Incluir no hash: shipping snapshot, zipcode, tax, items Stripe, promo id.

6. **Idempotencia depende de `attempt_id` do cliente.** Sem ele, PHP gera UUID novo → nova `subscriptions.create`. No Node: exigir `Idempotency-Key` HTTP **ou** `attempt_id` persistido na sessao no primeiro POST e reusar. Nao gerar attempt novo no retry.

7. **Customer Stripe por email, nao por `wp_user_id`.** Dois WP users com o mesmo email compartilham `cus_`. PM anexado ao `cus_` de outro user → 409. No Node, chave natural = `user_id` interno com unique email; nao fazer `customers.list(email)` cego se puder guardar `stripe_customer_id` no usuario.

8. **`payment_behavior: default_incomplete`.** A cobranca **nao** confirma sozinha. Front precisa de `confirmPayment`. Sem ack/webhook, a sub fica `incomplete` e o cupom ja esta na subscription (a invoice 1 ainda nao foi paga).

9. **Total da response HSR != invoice Stripe.** Cupom `once` e Stripe Tax alteram o valor cobrado. `data.total` e soma local (subtotal Woo/catalogo + tax placeholder + frete). Para o resumo fiel, preferir `latest_invoice.amount_due` da Stripe (comportamento **novo**, melhor). Se copiar o PHP, aceite a divergencia.

10. **Flag `STRIPE_US_AUTOMATIC_TAX`.** Default repo `0`: tax via Woo `WC_Tax` + `tax_rates` manuais (`txr_`). Flag `1`: `product_tax=0` no HSR e `automatic_tax` no create; address `country+postal_code` obrigatorio. Preview (`subscription/preview`) **sempre** chama Stripe Tax — desalinhado. No Node, **um** modo de tax no preview e no charge.

11. **Frete so na 1a invoice via `add_invoice_items`.** Ciclos seguintes dependem do webhook `invoice.created` injetar `invoiceItems`. Sem esse worker, o cliente paga frete uma vez e some. Reimplementar os dois (create + webhook) ou usar Stripe Shipping Rates / item recorrente consciente.

12. **Mapeamento Price e post meta Woo.** `_stripe_price_ids_by_currency` por moeda; fallback legado. Lines sem mapa sao dropadas em silencio ate zerar a lista (422). No Node, falhar **na line** (`unmapped_variant`) em vez de pular. Quantity somada por `price_` — igual ao PHP.

13. **Cupom 1a compra e fail-closed para elegiveis.** Usuario elegivel + slot vazio = **503**, nao checkout cheio. Inelegivel segue sem `discounts`. Pedido `pending` conta como compra previa (pode queimar o desconto apos um order-first abandonado). No Node, nao contar checkout incompleto como compra.

14. **Ramo B engole erro Stripe em HTTP 200.** `stripe_sync_error` no body. Front desatento acha que deu certo. Nao copiar: sync falho deve ser 502/422. `payment_state: sync_error` existe por causa disso.

15. **Materializacao tardia no ramo A.** Webhook `invoice.paid` cria o Woo order e a Flexible sub. Lookup por `LIKE` no JSON e fragil. No Node: tabela `stripe_checkout` com `stripe_subscription_id` indexado; outbox do webhook.

16. **Lock de create e option WP, TTL 120s.** Nao e Redis. Stale lock pode 409. No Node: lock por `(user_id, attempt_id)` com TTL curto e wait/retry.

17. **`STRIPE_MAX_RETRIES` vazio = 0 no PHP.** `.env.example` diz 2. Escolher default 2 consciente.

18. **502 vaza texto da Stripe.** Mapear `resource_missing`, card errors, `idempotency_error`. Nao devolver secret/stack.

19. **Sem schema de body.** Aceitar camelCase e snake_case para `payment_method_id` / `price_id`. No Node, um schema (zod) com os dois aliases.

20. **i18n.** Messages EN via `__()`. Front deve casar `code`. Manter os mesmos codes no cutover.

21. **Rate limit.** So auth 300/300s. Checkout e pago (Stripe + lock). Vale limite proprio (ex. 10/min por user) — melhoria, nao copia.

22. **Envelope.** Sucesso `{ success, data }`. Erro WP `{ code, message, data.status }`. O doc 08 sugere `{ success: false, error: { code, message } }`. Traduzir na borda HTTP se o front novo usar o envelope 08; o front atual espera WP_Error cru.

23. **Contrato Node sugerido:** `POST /api/v1/onboarding/sessions/:sessionId/checkout`. Manter `data.stripe_client_secret`, `payment_state`, `reused`, `attempt_id`. Preferir nao devolver `payment_url` Woo.

24. **Ordem de jornada.** Sem `account-link` + OTP `active`, 422/403. Sem shipping quando o produto envia, 422. O Node deve falhar com os mesmos `session_incomplete` para o stepper do front continuar funcionando.

25. **Testes a cobrir no Node:** JWT errado → 403; conta pending → 403; sem plan snapshot → 422; sem shipping quando precisa → 422; `subscription_first` sem `pm_` → 422; elegivel sem promo map → 503; inelegivel cria sub **sem** `discounts`; mesmo `attempt_id` → reused, sem segunda sub; `attempt_id` novo → **nao** duplicar se a sessao ja tem `sub_incomplete` (corrigir o PHP); fingerprint/shipping change → nao reusar pedido stale; US flag on sem ZIP → 422; BR sem tax_rates; falha Stripe → 502 no ramo A; webhook paid materializa pedido uma vez so (idempotente).

---

## 9) Relacao com o resto do onboarding

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

Rotas irmas:

- `POST .../payment-intent/ack` — persiste status do PI (order meta ou `stripe_checkout_json`).
- `GET .../payment-methods` — lista cards do `cus_` da order.
- `POST .../subscription/preview` — nao e input deste POST.
- `GET .../discount/eligibility` — informativo; checkout **revalida**.
