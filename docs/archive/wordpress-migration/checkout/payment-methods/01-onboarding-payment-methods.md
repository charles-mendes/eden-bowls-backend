# GET `/onboarding/session/{session_id}/payment-methods`

Documentacao da logica **atual** da listagem de cartoes salvos no onboarding.

Escopo: devolver os PaymentMethods Stripe do tipo `card` ja anexados ao Customer do usuario vinculado, com flag `is_default` (invoice settings). A rota **nao persiste** nada na sessao, **nao cria** customer/payment method, **nao cobra**, **nao lista** ACH/Link/outros tipos.

Plugin de entrada: `headless-secure-registration`.  
Plugin de billing: **nao e obrigatorio**. O handler instancia `\Stripe\StripeClient` direto (nao usa `PawBowlStripe\StripeClientFactory`). O SDK `stripe/stripe-php` precisa estar no autoload (HSR `composer.json` declara `^16`).  
WooCommerce: necessario para **resolver** o `cus_`; sem pedido/meta, a resposta e `200` com `data: []` (nao 503).

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php` (`register_routes`, `list_payment_methods`, `require_linked_user_session_access`, `create_stripe_client`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php` (`get_session`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-rate-limiter.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`
- origem do customer no pedido: `pawbowl-stripe-billing/src/class-stripe-subscription-service.php` (`persist_subscription_state` grava `_hsr_stripe_customer_id`)
- caller de checkout que cria/anexa o PM: mesmo `StripeSubscriptionService::create_subscription` (nao e esta rota)
- auth WP user (headless): plugin `jwt-authentication-for-wp-rest-api` (`determine_current_user`)

Nao ha teste unitario nem smoke dedicado desta rota. Nao aparece no Swagger (`artefatos/swagger-pawbowl.yaml`). Esta na lista sugerida Node: `GET /api/v1/onboarding/sessions/:sessionId/payment-methods`.

Namespace REST: `custom/v1`  
Base: `{WP_URL}/wp-json`

---

## 1) Identidade da rota

```
GET /wp-json/custom/v1/onboarding/session/{session_id}/payment-methods
```

| Item | Valor |
|---|---|
| Namespace WP | `custom/v1` |
| Metodo | `GET` (`WP_REST_Server::READABLE`; WP tambem aceita `HEAD`) |
| Path param | `session_id` — regex `[A-Za-z0-9_-]+` |
| Query / body | nenhum (GET sem schema; query string ignorada) |
| Permission | `OnboardingApi::require_linked_user_session_access` |
| Handler | `OnboardingApi::list_payment_methods` |
| Servico HSR | so `OnboardingService::get_session` (leitura). A listagem Stripe vive **no proprio API class** |
| Factory Stripe billing | **nao usada** |
| Validator | nenhum (`RequestValidator` nao e usado; sem `args` no `register_rest_route`) |
| Rate limit proprio | nenhum (so o de auth no permission_callback) |
| Registro | `add_action('rest_api_init', [OnboardingApi, 'register_routes'])` |

Objetivo: o front de checkout, **depois** de `POST .../account-link` (usuario logado + sessao vinculada), listar cartoes ja salvos no Stripe para o cliente reutilizar `pm_...` no `POST .../subscription/checkout` em vez de tokenizar um cartao novo.

Nao confundir com:

- `POST .../subscription/checkout` — cria assinatura e **anexa** um `payment_method_id` (grava `_hsr_stripe_customer_id` no pedido).
- `POST .../payment-intent/ack` — confirma PI; nao lista metodos.
- `StripeSubscriptionService::fetch_payment_method_summary` — resumo de **um** `pm_` (brand/last4/exp) para admin/webhook; outro contrato.
- `StripeSubscriptionService::update_payment_method` — troca o default de uma assinatura existente.
- Woo My Account `/payment-methods` / tokens `WC_Payment_Token` — outro stack; esta rota **nao** le tokens Woo.
- `GET /custom/v1/subscriptions` — listagem de assinaturas, nao de cartoes.

---

## 2) Fluxo completo

```mermaid
sequenceDiagram
    participant Front
    participant JWT as jwt-auth (determine_current_user)
    participant WP as OnboardingApi
    participant RL as RateLimiter (transients)
    participant Svc as OnboardingService
    participant Repo as OnboardingRepository
    participant SQL as wp_hsr_onboarding_sessions
    participant Woo as WooCommerce orders
    participant Stripe as Stripe API

    Front->>JWT: Authorization Bearer {user JWT}
    JWT-->>WP: get_current_user_id()
    Front->>WP: GET .../payment-methods
    Note over WP: permission_callback (sem X-Session-Token)
    WP->>RL: consume onboarding_auth (300 / 300s)
    alt estouro auth
        WP-->>Front: 429 rate_limit
    end
    alt nao logado
        WP-->>Front: 401 unauthorized
    end
    WP->>Svc: get_session(sessionId)
    alt sessao inexistente
        WP-->>Front: 404 session_not_found
    end
    alt linked_user_id != current_user
        WP-->>Front: 403 session_forbidden
    end

    Note over WP: callback list_payment_methods
    WP->>Svc: get_session(sessionId) de novo
    alt sessao sumiu entre permission e callback
        WP-->>Front: 404 session_not_found
    end

    alt session.checkout_order_id > 0
        WP->>Woo: wc_get_order + meta _hsr_stripe_customer_id
    end
    alt customerId vazio
        WP->>Woo: wc_get_orders(customer=linked_user_id, meta EXISTS, limit 10)
        Note over Woo: so usa o pedido [0] (mais recente)
    end
    alt customerId ainda vazio
        WP-->>Front: 200 { success:true, data:[] }
    end

    WP->>Stripe: GET /v1/customers/{cus_}
    alt Throwable
        WP-->>Front: 502 stripe_customer_retrieve_failed
    end
    WP->>Stripe: GET /v1/payment_methods?customer=&type=card
    alt Throwable
        WP-->>Front: 502 stripe_payment_methods_list_failed
    end
    WP-->>Front: 200 { success:true, data:[ {id,brand,last4,exp_*,is_default} ] }
```

### 2.1 Camada REST (`OnboardingApi::list_payment_methods`)

1. Sanitiza `session_id` com `sanitize_text_field`.
2. `OnboardingService::get_session` → `OnboardingRepository::get`. Sem sessao → HTTP `404` (`session_not_found`).
3. Resolve Stripe Customer ID (secao 2.4). Vazio → HTTP `200` `{ success: true, data: [] }` **sem** chamar Stripe.
4. `create_stripe_client()`:
   - `STRIPE_SECRET_KEY` vazio (env e constante) → `503` `stripe_secret_missing`
   - `\Stripe\StripeClient` ausente → `503` `stripe_sdk_missing`
   - construtor throw → `503` `stripe_client_init_failed` (message crua)
5. `$stripe->customers->retrieve($customerId, [])`. Throw → `502` `stripe_customer_retrieve_failed`.
6. `$stripe->paymentMethods->all({ customer, type: 'card' })`. Throw → `502` `stripe_payment_methods_list_failed`.
7. Mapeia `methods->data[]` + compara `customer.invoice_settings.default_payment_method` com cada `pm.id`.
8. HTTP `200` `{ success: true, data: <array> }`.

O `data` **nao** e a sessao. E um array (possivelmente vazio) de cartoes. Sem envelope interno `{ items, default }`.

Nao ha rate limit especifico. So o bucket `onboarding_auth` do permission_callback.

Nao ha validacao de schema REST. Query `?type=sepa_debit` e ignorada: o PHP **sempre** manda `type=card`.

### 2.2 Autenticacao (`require_linked_user_session_access`)

Roda **antes** do callback. **Nao valida** `X-Session-Token` nem `Authorization` como token de sessao onboarding. Diferente da maioria das rotas (`require_valid_session_access`) e tambem de `account-link` (`require_authenticated_session_access` = login **mais** session token).

Ordem:

1. `session_id` vazio → HTTP `403` (`session_forbidden`).
2. Rate limit de auth por sessao:
   - chave: `onboarding_auth`
   - default: `300` tentativas / `300` s
   - env: `HSR_ONBOARDING_AUTH_RATE_LIMIT_MAX`, `HSR_ONBOARDING_AUTH_RATE_LIMIT_WINDOW`
   - filters: `hsr/onboarding_rate_limit_max`, `hsr/onboarding_rate_limit_window`
   - janela efetiva no limiter: `max(60, window)`; tentativas: `max(1, max)`
   - estouro → HTTP `429` (`rate_limit`)
3. `is_user_logged_in()` falso → HTTP `401` (`unauthorized`, message "Authentication is required.").
4. `get_session` de novo. Inexistente → HTTP `404` (`session_not_found`).
5. Ownership:
   - `linked_user_id` da sessao (int) vs `get_current_user_id()`
   - `linked_user_id <= 0` **ou** current `<= 0` **ou** IDs diferentes → HTTP `403` (`session_forbidden`)
6. Sucesso → `true` (boolean). O session token **nao e lido**.

Como o WP user e autenticado no REST headless:

- Plugin `jwt-authentication-for-wp-rest-api` no filter `determine_current_user`: se `Authorization: Bearer {jwt}` existir, decodifica com `JWT_AUTH_SECRET_KEY` e seta o user id.
- Cookie WP + `X-WP-Nonce` tambem faria `is_user_logged_in()` (browser same-origin); o front Eden usa JWT, nao cookie WP.
- Login atual do front (`POST /api/v1/auth/token` no Node) **nao** e o mesmo emissor que `jwt-auth/v1/token`. Token Node na `Authorization` desta rota WP so funciona se o secret/iss bater com o plugin jwt-auth. Ver ponto de atencao 1.

CORS: `Plugin::allow_rest_cors_headers` adiciona `x-session-token` em `rest_allowed_cors_headers`. Esta rota **nao precisa** desse header; o front ainda pode manda-lo sem efeito.

Pre-requisito de negocio: `POST .../account-link` ja gravou `linked_user_id` igual ao user logado. Sem isso, sempre 403 (mesmo com JWT valido).

### 2.3 Validacoes de negocio

Nao ha validator de payload. Pipeline, nesta ordem:

| # | Regra | HTTP | `code` | Dominio i18n |
|---|---|---|---|---|
| 1 | `session_id` vazio (permission) | 403 | `session_forbidden` | `headless-secure-registration` |
| 2 | Rate limit auth | 429 | `rate_limit` | idem |
| 3 | Usuario WP nao autenticado | 401 | `unauthorized` | idem |
| 4 | Sessao inexistente (permission **ou** callback) | 404 | `session_not_found` | idem |
| 5 | `linked_user_id` != current user | 403 | `session_forbidden` | idem |
| 6 | Sem `cus_` resolvido | **200** | — | `data: []` (nao e erro) |
| 7 | Secret Stripe ausente | 503 | `stripe_secret_missing` | idem |
| 8 | Classe `\Stripe\StripeClient` ausente | 503 | `stripe_sdk_missing` | idem |
| 9 | Construtor do client throw | 503 | `stripe_client_init_failed` | message crua |
| 10 | `customers.retrieve` throw | 502 | `stripe_customer_retrieve_failed` | `$e->getMessage()` Stripe |
| 11 | `paymentMethods.all` throw | 502 | `stripe_payment_methods_list_failed` | `$e->getMessage()` Stripe |

**Nao valida:**

- prefixo `cus_` no ID resolvido (string vazia apos sanitize e o unico short-circuit);
- se o pedido `checkout_order_id` existe / esta no status certo;
- se o customer Stripe esta `deleted`;
- se o JWT e do mesmo usuario que `linked_user_id` **alem** da igualdade de IDs (nao ha check de email);
- tipo de PM (hardcoded `card`);
- paginacao (`has_more`);
- `stripe_checkout` da sessao (nao e lido);
- plugin `pawbowl-stripe-billing` ativo.

### 2.4 Resolucao do Stripe Customer ID

Dois caminhos. O segundo so roda se o primeiro ficar string vazia.

**1) Pedido da sessao**

```
checkout_order_id = (int) session.checkout_order_id
se > 0 e wc_get_order existe:
  order = wc_get_order(id)
  se WC_Order:
    customerId = sanitize_text_field(order->get_meta('_hsr_stripe_customer_id', true))
```

Origem do meta: `StripeSubscriptionService::persist_subscription_state` (e webhooks que chamam o mesmo persist). Tambem aparece em refund/PI sync. **Nao** e o meta do plugin Woo Stripe (`_stripe_customer_id`).

`checkout_order_id` e gravado pelo `CheckoutService` no fluxo Woo-order-first. No fluxo `subscription_first`, o checkout pode devolver `order_id: 0` e **nao** preencher este campo — o caminho 1 falha mesmo depois de criar o Customer na Stripe.

**2) Fallback: pedidos recentes do usuario vinculado**

```
linked_user_id da sessao > 0 e wc_get_orders existe:
  wc_get_orders({
    type: 'shop_order',
    customer: linkedUserId,   // WP user id
    limit: 10,
    return: 'ids',
    orderby: 'date',
    order: 'DESC',
    meta_query: [{ key: '_hsr_stripe_customer_id', compare: 'EXISTS' }]
  })
  se array nao vazio:
    so o orders[0] (mais novo) e lido
    customerId = meta _hsr_stripe_customer_id desse pedido
```

Nao itera os outros 9 ids. Se o pedido mais recente tem a chave EXISTS com valor vazio, `customerId` fica `''` e a rota devolve `[]` sem tentar o segundo pedido.

`meta_query` EXISTS casa chave presente mesmo vazia. Com HPOS (High-Performance Order Storage) o `wc_get_orders` + `meta_query` em geral funciona na tabela de order meta; se a query falhar/devolver vazio, o efeito e o mesmo que "sem customer" → `[]`.

**Fontes que o PHP NAO consulta:**

| Fonte | Existe no projeto? | Usada aqui? |
|---|---|---|
| `session.stripe_checkout` | sim (ids de sub/PI; **sem** `customerId`) | nao |
| `{prefix}hsr_stripe_customers` | ledger do billing (`wp_user_id`, `stripe_customer_id`) | nao |
| option `hsr_stripe_customer_map` | mapa interno do billing | nao |
| user option `_stripe_customer_id` | plugin `woocommerce-gateway-stripe` | nao |
| meta `_stripe_customer_id` no pedido | Woo Stripe | nao |
| `customers.search` / `customers.list` por email | Stripe | nao (checkout sim, esta rota nao) |

Primeira compra (usuario recem-vinculado, sem pedido HSR anterior): `customerId === ''` → **200 com array vazio**. Isso e o comportamento feliz de "ainda nao tem cartao salvo", nao um 404.

### 2.5 Mapeamento da resposta

Para cada item em `$methods->data` (so se `$methods` for object e `data` for array):

```php
[
  'id'         => (string) $pm->id,           // pm_...
  'brand'      => (string) $card->brand,      // visa, mastercard, amex... (lowercase Stripe)
  'last4'      => (string) $card->last4,
  'exp_month'  => (int) $card->exp_month,
  'exp_year'   => (int) $card->exp_year,
  'is_default' => default_payment_method === $pm->id,
]
```

`is_default`: `isset($customer->invoice_settings->default_payment_method)` **e** cast string igual ao `pm.id`. O retrieve **nao** usa `expand`; o campo vem como id string (`pm_...`), nao objeto.

Se `default_payment_method` for um Source legado (`card_...`) ou estiver vazio, **todos** os itens saem `is_default: false`. Checkout (`create_subscription`) faz `customers.update` com `invoice_settings.default_payment_method = paymentMethodId` apos attach — cartoes criados por esse fluxo devem marcar um default.

Se `$pm->card` nao for object: `brand`/`last4` = `''`, exp = `0`, o item **ainda entra** na lista.

Nao devolve: `fingerprint`, `funding`, `country`, `wallet`, `billing_details`, `created`, `customer`, `has_more`, `livemode`.

### 2.6 Persistencia

**Esta rota nao chama `repository->save`.** Nao atualiza `stripe_checkout`, `checkout_order_id`, `linked_user_id`, `updated_at` (salvo o caso legado abaixo).

Excecao: `OnboardingRepository::get` ainda promove transient legado `hsr_onb_{sessionId}` para SQL (`save` + rewrite de pets) **antes** das validacoes. Como o permission_callback **e** o handler chamam `get()`, um migrate legado pode ocorrer **duas vezes** no mesmo request (segunda e no-op se a linha ja existir).

A listagem **nao** e cacheada. Cada GET bate na Stripe (2 calls) quando ha `cus_`.

---

## 3) Chamadas a backend / servicos externos

Unico HTTP de saida: **Stripe** (Customers + Payment Methods). Nao ha client PawBowl, ViaCEP, OSRM, Woo Tax, meal-plan catalog HTTP.

Servico: Stripe Payments / Customers.  
SDK: `stripe/stripe-php` `^16` (HSR e billing).  
Cliente: `new \Stripe\StripeClient($secret)` — **string pura**, nao o array de `StripeClientFactory`.

### 3.1 Configuracao do client

| Env / constante | Uso nesta rota |
|---|---|
| `STRIPE_SECRET_KEY` (getenv, senao constante PHP) | `api_key`. Vazio → 503 `stripe_secret_missing`. Passa por `sanitize_text_field` |
| `STRIPE_API_VERSION` | **nao lido**. Header `Stripe-Version` fica no default do SDK |
| `STRIPE_MAX_RETRIES` | **nao lido**. Sem `Stripe::setMaxNetworkRetries` aqui |
| `STRIPE_WEBHOOK_SECRET` | nao |
| `STRIPE_US_AUTOMATIC_TAX` | nao |

Divergencia vs checkout/preview (`StripeClientFactory::create()`): la aplicam `stripe_version` e retries. Aqui o pin de API e o default do `stripe-php` instalado. Invoice clover vs PaymentMethod list raramente quebra o shape de `card`, mas e uma fonte de drift.

Plugin billing ausente **nao** gera 503 por si; so falta do SDK ou da secret.

### 3.2 Endpoint 1 — retrieve Customer

```
GET https://api.stripe.com/v1/customers/{customerId}
```

PHP: `$stripe->customers->retrieve($customerId, [])`.

Auth: Bearer `STRIPE_SECRET_KEY`.  
Expand: nenhum.  
Idempotency-Key: nenhuma (GET).

Usado **so** para ler `invoice_settings.default_payment_method`. Nao envia `expand[]=invoice_settings.default_payment_method`.

Resposta esperada (recorte):

```json
{
  "id": "cus_ABC123",
  "object": "customer",
  "email": "owner@example.com",
  "invoice_settings": {
    "default_payment_method": "pm_1DefaultCard"
  },
  "deleted": false
}
```

Customer **deletado**: a API costuma devolver `{ "id": "cus_...", "object": "customer", "deleted": true }` **sem** throw. O PHP nao checa `deleted`. `invoice_settings` ausente → todos `is_default: false`. O list seguinte pode vir vazio ou 502.

### 3.3 Endpoint 2 — list PaymentMethods

```
GET https://api.stripe.com/v1/payment_methods?customer={customerId}&type=card
```

PHP: `$stripe->paymentMethods->all(['customer' => $customerId, 'type' => 'card'])`.

Equivalente: `GET /v1/customers/{id}/payment_methods?type=card`.

Params efetivos:

| Campo | Valor |
|---|---|
| `customer` | `cus_...` resolvido |
| `type` | `card` (fixo) |
| `limit` | **omitido** → default Stripe **10** |
| `starting_after` | nao |

**Nao ha auto-pagination.** O SDK so pagina com `autoPagingIterator()`. Cliente com 11+ cartoes: o 11o some da resposta. `has_more` e ignorado.

Resposta Stripe esperada (recorte):

```json
{
  "object": "list",
  "url": "/v1/payment_methods",
  "has_more": false,
  "data": [
    {
      "id": "pm_1DefaultCard",
      "object": "payment_method",
      "type": "card",
      "customer": "cus_ABC123",
      "card": {
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2028,
        "funding": "credit",
        "country": "US"
      }
    }
  ]
}
```

O PHP so usa `id` + `card.{brand,last4,exp_month,exp_year}`.

### 3.4 Tratamento de erro Stripe

Dois `try/catch (\Throwable)` separados. Retrieve falhou → **nao** tenta o list.

- HTTP **502**
- `code`: `stripe_customer_retrieve_failed` ou `stripe_payment_methods_list_failed`
- `message`: string crua da Stripe (`$e->getMessage()`)
- sem mapear `code` Stripe (`resource_missing`, `invalid_request_error`)
- sem retry extra (e sem `STRIPE_MAX_RETRIES` desta rota)
- sem log proprio nesta funcao
- **nada gravado** na sessao

Erros tipicos:

| Situacao | Comportamento |
|---|---|
| `cus_` inexistente / outra conta Stripe | 502 `stripe_customer_retrieve_failed`, "No such customer: cus_..." |
| `cus_` malformado (nao passa de sanitize, mas nao e prefix-checked) | 502 retrieve |
| Customer deletado | 200 com `[]` ou `is_default` todos false; ou 502 no list |
| Timeout / 5xx Stripe | 502 no catch correspondente |
| Secret de outro modo (test vs live) vs `cus_` live | 502 No such customer |
| SDK ausente | 503 **antes** das calls (so se `customerId` nao-vazio) |

Nao ha circuit breaker. Cada GET autenticado com `cus_` = 2 round-trips a `api.stripe.com`.

### 3.5 Relacao com checkout real (`create_subscription`)

| | Esta GET | `subscriptions.create` / attach no checkout |
|---|---|---|
| Customer | so le meta `_hsr_stripe_customer_id` | `customers.list` por email (`limit: 1`) ou `customers.create`; grava meta no persist |
| PaymentMethod | lista `type=card` ja anexados | `paymentMethods.retrieve` + `attach` se `customer` vazio; 409 se PM de outro `cus_` |
| Default | le `invoice_settings` | **escreve** default = PM do payload |
| Pedido Woo | le `checkout_order_id` ou fallback 10 pedidos | pode criar pedido **depois** (subscription_first: order 0) |
| Tipos | so card | qualquer `pm_` que o front mandar (em geral card do Stripe.js) |

Checkout **nao** reusa esta listagem no servidor: o front escolhe um `id` (`pm_...`) e manda de volta no body do checkout. A GET e informativa/UX.

---

## 4) Request / response

### 4.1 Headers

```
GET /wp-json/custom/v1/onboarding/session/{session_id}/payment-methods
Authorization: Bearer {jwt_wp_user}
```

`X-Session-Token` **nao e exigido**. Se enviado, e ignorado por esta permission.

Sem `Authorization` (e sem cookie WP autenticado): 401 `unauthorized`, nao 401 `session_unauthorized` (esse code e das rotas com session token).

### 4.2 Sucesso com cartoes (usuario returning)

Request:

```http
GET /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/payment-methods
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

Sessao: `linked_user_id` = user do JWT. Pedido `checkout_order_id` (ou fallback) com `_hsr_stripe_customer_id=cus_ABC123`.

Response `200`:

```json
{
  "success": true,
  "data": [
    {
      "id": "pm_1DefaultCard",
      "brand": "visa",
      "last4": "4242",
      "exp_month": 12,
      "exp_year": 2028,
      "is_default": true
    },
    {
      "id": "pm_1OtherCard",
      "brand": "mastercard",
      "last4": "4444",
      "exp_month": 4,
      "exp_year": 2027,
      "is_default": false
    }
  ]
}
```

`brand` segue o enum Stripe (`visa`, `mastercard`, `amex`, `discover`, `diners`, `jcb`, `unionpay`, `unknown`) em lowercase. Front deve tratar string, nao i18n do PHP.

### 4.3 Sucesso vazio (primeira compra / sem meta)

Mesmo request. Sessao vinculada, mas nenhum pedido com `_hsr_stripe_customer_id` (ou Woo inativo):

```json
{
  "success": true,
  "data": []
}
```

HTTP 200, **nao** 404. Front deve mostrar form de cartao novo.

### 4.4 Usuario nao logado

```json
{
  "code": "unauthorized",
  "message": "Authentication is required.",
  "data": { "status": 401 }
}
```

### 4.5 Sessao de outro usuario

JWT user `42`, `linked_user_id` `99` (ou `null`/0):

```json
{
  "code": "session_forbidden",
  "message": "Session access denied.",
  "data": { "status": 403 }
}
```

### 4.6 Stripe customer inexistente

```json
{
  "code": "stripe_customer_retrieve_failed",
  "message": "No such customer: 'cus_doesNotExist'",
  "data": { "status": 502 }
}
```

`message` varia; casar no front por `code`, nao por texto.

### 4.7 Erros HTTP (resumo)

| HTTP | `code` | Quando | Message (EN) |
|---|---|---|---|
| 401 | `unauthorized` | sem user WP (JWT/cookie) | Authentication is required. |
| 403 | `session_forbidden` | `session_id` vazio, ou linked != current | Session access denied. |
| 404 | `session_not_found` | sessao nao existe (SQL nem transient legado) | Onboarding session not found. |
| 429 | `rate_limit` | auth 300/300s | Too many requests. Please try again later. |
| 502 | `stripe_customer_retrieve_failed` | retrieve throw | message da Stripe |
| 502 | `stripe_payment_methods_list_failed` | list throw | message da Stripe |
| 503 | `stripe_secret_missing` | env/constante vazia (so se ja tem `cus_`) | STRIPE_SECRET_KEY is not configured. |
| 503 | `stripe_sdk_missing` | `\Stripe\StripeClient` ausente | Stripe SDK is not available in this environment. |
| 503 | `stripe_client_init_failed` | construtor throw | message crua |

Formato WP REST de erro: `{ "code", "message", "data": { "status": N } }`. Sem `success: false`.

Nao existe 401 `session_unauthorized` / `session_token_invalid` nesta rota (session token nao e checado).

---

## 5) Hooks e filters do WordPress

### 5.1 Especificos HSR (esta rota)

| Tipo | Hook | Onde | Efeito |
|---|---|---|---|
| action | `rest_api_init` | `Plugin::boot` | registra a rota |
| filter | `hsr/onboarding_rate_limit_max` | `consume_onboarding_limit` | altera max de **auth**. Args: `($maxAttempts, $scope)` com `$scope` = `auth` |
| filter | `hsr/onboarding_rate_limit_window` | idem | altera janela em segundos |
| filter | `hsr/onboarding_ttl` | `OnboardingRepository::ttl` | so se `get()` migrar transient legado |
| filter | `rest_allowed_cors_headers` | `Plugin::allow_rest_cors_headers` | libera header `x-session-token` (nao usado na auth desta rota) |

`hsr/onboarding_token_ttl` nao e lido aqui.  
Filters globais do `RateLimiter` (`hsr/rate_limit_max`, `hsr/rate_limit_window`) **nao** se aplicam: onboarding usa `consume_with_limits` com valores explicitos.

Nao ha `do_action` proprio da listagem.

### 5.2 Vizinhos (nao disparados por esta GET)

| Hook | Uso real |
|---|---|
| `hsr_checkout_create_stripe_subscription` | checkout cria/anexa PM e persiste `_hsr_stripe_customer_id`. Sem esse ciclo (ou webhook persist), a GET devolve `[]` |
| `hsr_stripe_invoice_paid_confirmed` | `CheckoutService` listener; nao lista cartoes |
| `jwt_auth_expire` / `jwt_auth_token_before_dispatch` | plugin jwt-auth, na autenticacao do user, nao no handler |

### 5.3 Core WP / Woo / JWT envolvidos

| Hook / API | Uso |
|---|---|
| REST API (`register_rest_route`, `permission_callback`) | roteamento e auth |
| `determine_current_user` | jwt-auth seta o WP user a partir do Bearer |
| `is_user_logged_in` / `get_current_user_id` | ownership |
| `$wpdb->get_row` | `SELECT *` da sessao |
| `get_transient` / `set_transient` | rate limit auth; migrate legado `hsr_onb_*` |
| `wc_get_order` / `wc_get_orders` / `WC_Order::get_meta` | resolver `cus_` |
| `sanitize_text_field` | path, customer id, secret |
| `__()` | mensagens i18n |
| `class_exists('\\Stripe\\StripeClient')` | feature-detect SDK |
| `function_exists('wc_get_order')` | feature-detect Woo |

Nao usa `WC_Payment_Tokens`, carrinho Woo, `wp_cache` de PaymentMethod, nem a tabela ledger `hsr_stripe_customers`.

---

## 6) Dependencias e efeitos colaterais

### 6.1 O que e lido

- Path: `session_id`.
- Header: `Authorization: Bearer` (via jwt-auth / cookie), **nao** `X-Session-Token`.
- Banco sessao: `{prefix}hsr_onboarding_sessions` (`SELECT *`) — campos usados: `linked_user_id`, `checkout_order_id`. Pets e JSON de plano **ignorados**.
- Transient legado: `hsr_onb_{sessionId}` se a linha SQL nao existir.
- Pedido Woo: meta `_hsr_stripe_customer_id` (HPOS ou post meta).
- Ate 10 ids de pedidos do customer WP, so o mais recente e aberto.
- Env/constante: `STRIPE_SECRET_KEY`.
- SDK Stripe no autoload.

### 6.2 O que e gravado

| Recurso | Gravado? | Detalhe |
|---|---|---|
| sessao SQL / `stripe_checkout` | **nao** | |
| `updated_at` SQL | so se migrate legado | `get()` → `save()` |
| tabela de pets | so se migrate legado | `replace_pets` |
| transient `hsr_onb_{sessionId}` | so se migrate legado | |
| transient rate limit | **sim** | `onboarding_auth` a cada request autenticavel (inclusive 401 depois do consume) |
| Customer / PaymentMethod Stripe | **nao** | so GET |
| pedido Woo / user meta | **nao** | |

Chave de rate limit:

```
hsr_rl_{md5('onboarding_auth|{sessionId}')}
```

Payload: `{ "count": N }`, TTL = janela (minimo 60 s). JWT invalido **ainda consome** o bucket: o consume e **antes** de `is_user_logged_in()`.

Ordem no permission: rate limit → login → sessao → ownership. 401/403 ainda incrementam o contador.

### 6.3 Consumidores posteriores (efeito diferido)

Nenhum consumidor le um "resultado de listagem" persistido.

O front (fora deste repo) e o unico consumidor imediato: radio de cartoes salvos + `payment_method_id` no checkout.

Checkout **nao** chama esta GET internamente.

### 6.4 Sem efeitos em

- Woo cart / tokens / My Account payment methods
- catalogo `custom-meal-plan-builder`
- ViaCEP / Zippopotam / Nominatim / OSRM
- `POST .../zipcode`, shipping, sales-tax, subscription/preview
- criacao de Promotion Code / Coupon
- `pawbowl-stripe-billing` ledger (`hsr_stripe_customers`) — **nao atualizado nem lido**

---

## 7) Pontos de atencao para reimplementacao em Node

1. **Auth e user JWT, nao session token.** PHP exige WP user logado **e** `linked_user_id === current_user`. `X-Session-Token` e ignorado. No Node, exigir o JWT de `/api/v1/auth` (ja emitido pelo backend novo) + vinculo da sessao. Nao copiar `require_valid_session_access`. Se o front ainda chama o WP, o Bearer Node pode **nao** autenticar jwt-auth (secret diferente) — na migracao, esta rota deve viver no mesmo emissor do login.

2. **401 `unauthorized` vs `session_unauthorized`.** Front que trata so `session_*` quebra. Manter o `code` `unauthorized` nesta rota ou alinhar o cliente.

3. **200 com `[]` nao e erro.** Primeira compra, Woo off, meta ausente, EXISTS vazio: sempre `{ success: true, data: [] }`. Nao virar 404 `customer_not_found`.

4. **Resolver `cus_` sem depender so de `checkout_order_id`.** Fluxo `subscription_first` pode nao gravar pedido. PHP cai no fallback de 10 orders e **so olha o [0]**. No Node, preferir uma fonte canonica por usuario:
   - tabela tipo `hsr_stripe_customers.wp_user_id` (ledger ja existe no WP e esta rota **ignora**);
   - ou `customers.list`/`search` por email (e o que o checkout faz na criacao).
   Copiar o fallback "ultimo pedido EXISTS" replica o bug de meta vazia / pedido mais novo sem customer.

5. **Nao usar `_stripe_customer_id` do plugin Woo Stripe** se o Node for fiel ao HSR. Sao namespaces diferentes; misturar pode apontar para outro Customer.

6. **Validar prefixo `cus_`.** PHP nao valida; `cus_` de outra conta → 502 com texto Stripe. Mapear `resource_missing` → 200 `[]` ou 422 `stripe_customer_missing`, e **nao** vazar `No such customer`.

7. **Customer deletado.** Checar `deleted === true` apos retrieve (ou usar o ledger `deleted`). PHP nao checa.

8. **Duas calls Stripe: retrieve + list.** Retrieve so serve para `is_default`. Alternativas:
   - `customers.retrieve` com `expand: ['invoice_settings.default_payment_method']` + list;
   - ou so o list e comparar com um `GET customer` se precisar do default.
   Manter as duas se o contrato `is_default` for obrigatorio.

9. **`type=card` fixo e limit 10.** Fiel ao PHP: so cartao, sem paginar. Melhoria consciente: `limit=100` e/ou auto-page; expor `has_more` se o front precisar. Nao listar `link` / `us_bank_account` sem o front pedir — checkout atual espera `pm_` de card.

10. **Nao persistir.** Nao gravar a lista na sessao. Nao cachear longo (PCI-adjacent: last4/brand ok, mas e dado de pagamento). Cache curto (ex. 30s) e melhoria, nao copia.

11. **Client Stripe unificado.** Esta rota PHP **nao** aplica `STRIPE_API_VERSION` nem `STRIPE_MAX_RETRIES`. No Node, usar o **mesmo** client do checkout (versao + retries) para nao ter drift.

12. **Plugin billing / Woo ausentes.** PHP: Woo off → `[]`; SDK off → 503 so se ja tem `cus_`. Ambiente Node unico: customer store + Stripe. 503 `stripe_secret_missing` se config falta **e** ha customer para listar; sem customer, `[]` ainda e correto.

13. **Lazy migrate de sessao.** `get()` ainda pode `save()` transient legado. No Node com Postgres, ignore esse ramo. Cuidado: permission + handler leem a sessao **duas vezes** no PHP; uma leitura basta.

14. **Rate limit.** Auth 300/300s por `sessionId`, consumido **antes** do check de login. Vale limite proprio (Stripe e pago). Copiar o quirk "401 ainda conta" ou nao, de proposito.

15. **Contrato de resposta.** Manter `{ success, data: Array<{ id, brand, last4, exp_month, exp_year, is_default }> }` se o front ja consome. Nao devolver o PaymentMethod inteiro. `id` e o valor que volta no checkout como `payment_method_id`.

16. **`is_default` por string id.** Nao expandir o campo no retrieve sem ajustar o compare (objeto vs string). Varios `true` so se a Stripe tiver um default; zero `true` e valido.

17. **502 vaza texto da Stripe.** Front deve casar `code`. No Node, nao devolver stack/secret. Distinguir retrieve vs list ajuda debug; o PHP ja faz isso com dois codes.

18. **i18n.** Messages EN via `__()`. Casar `code`.

19. **Rota Node sugerida:** `GET /api/v1/onboarding/sessions/:sessionId/payment-methods`. Mesmo envelope `data` array.

20. **Ordem no funil:** `account-link` → (opcional) esta GET → `subscription/checkout` com `pm_` escolhido ou PM novo do Stripe.js. Chamar a GET **antes** do account-link e 401/403.

21. **Testes ausentes no PHP.** Cobrir no Node: sem JWT → 401; JWT de outro user → 403; sessao missing → 404; sem customer → 200 `[]`; customer + 2 cards com um default; limit/has_more; retrieve 404 Stripe mapeado; list 5xx → 502; nao persistir sessao; nao exigir session token; `type` query ignorado (so card).

---

## 8) Relacao com account-link e checkout

Fluxo feliz returning customer:

```
1. POST .../account-link              → grava linked_user_id = user JWT
2. GET  .../payment-methods           → esta rota; data[] de cartoes do cus_ de pedidos anteriores
3. Front escolhe pm_... ou tokeniza novo
4. POST .../subscription/checkout     → attach se preciso, default = esse PM, cria subscription
5. persist_subscription_state         → _hsr_stripe_customer_id no pedido (alimenta a proxima GET)
```

Primeira compra:

```
1. account-link
2. GET payment-methods → 200 data: []
3. checkout com PM novo (Stripe.js)
```

Sem o passo 1, a GET nunca chega no Stripe (403). Sem pedidos/ledger com `cus_`, o passo 2 e vazio mesmo com assinatura ja criada em `subscription_first` sem `checkout_order_id` — gap a corrigir no Node via fonte de customer por `wp_user_id`/email.
