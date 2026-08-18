# POST `/onboarding/session/{session_id}/subscription/preview`

Documentacao da logica **atual** do preview de imposto Stripe no onboarding.

Escopo: estimar `subtotal` / `tax` / `total` da **primeira fatura de assinatura** via Stripe Invoice Preview (`invoices.createPreview`) com `automatic_tax` ligado. Somente endereco **US**. A rota **nao persiste** o resultado na sessao, **nao cria** customer/subscription/invoice, **nao aplica** cupom de 1a compra e **nao inclui** frete.

Plugin de entrada: `headless-secure-registration`.  
Plugin de billing: `pawbowl-stripe-billing` (obrigatorio; se ausente → 503).

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php` (`get_subscription_preview`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-product-tax-service.php` (`is_us_country` apenas)
- `wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-rate-limiter.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php` (`preview_subscription_invoice`)
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-client-factory.php`
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-tax-rate-service.php` (`is_us_country` no billing)
- caller interno (nao e esta rota REST): `pawbowl-stripe-billing/src/class-stripe-subscription-edit-service.php` (preview de **proximo ciclo** em edit de assinatura existente)

Nao ha teste unitario nem smoke dedicado desta rota. Nao aparece no Swagger (`artefatos/swagger-pawbowl.yaml`) nem na lista sugerida de rotas Node (`artefatos/migracao-node-reverse-engineering/08-endpoints-rest-sugeridos.md`).

Namespace REST: `custom/v1`  
Base: `{WP_URL}/wp-json`

---

## 1) Identidade da rota

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/subscription/preview
```

| Item | Valor |
|---|---|
| Namespace WP | `custom/v1` |
| Metodo | `POST` (`WP_REST_Server::CREATABLE`) |
| Path param | `session_id` — regex `[A-Za-z0-9_-]+` |
| Permission | `OnboardingApi::require_valid_session_access` |
| Handler | `OnboardingApi::subscription_preview` |
| Servico HSR | `OnboardingService::get_subscription_preview` |
| Servico Stripe | `PawBowlStripe\StripeSubscriptionService::preview_subscription_invoice` |
| Validator | nenhum (`RequestValidator` nao e usado; sem `args` no `register_rest_route`) |
| Rate limit proprio | nenhum (so o de auth no permission_callback) |
| Registro | `add_action('rest_api_init', [OnboardingApi, 'register_routes'])` |

Objetivo (comentario no codigo: "Phase 2"): devolver um preview de imposto **Stripe Tax** para o resumo de checkout US, quando `STRIPE_US_AUTOMATIC_TAX` esta ligado nas rotas irmas (`shipping/select`, `sales-tax/quote`) e o Woo devolve tax 0.

Nao confundir com:

- `POST .../plan/preview` — preco mensal do plano (catalogo meal-plan), **nao** imposto Stripe.
- `POST .../sales-tax/quote` — tax de **produto** via Woo (`WC_Tax`) ou 0 se automatic tax ligado; **grava** `plan_selection.product_tax`.
- `POST .../shipping/select` — persiste frete e recalcula product tax Woo; **nao** chama Stripe.
- `POST /custom/v1/create-subscription` — cria a assinatura de verdade (`automatic_tax` so se a flag estiver ligada).
- Preview de **edit** de assinatura existente (`StripeSubscriptionEditService`) — outro payload (`customer` + `subscription` + prorations).

---

## 2) Fluxo completo

```mermaid
sequenceDiagram
    participant Front
    participant WP as OnboardingApi
    participant RL as RateLimiter (transients)
    participant Tok as SessionTokenService
    participant Svc as OnboardingService
    participant Repo as OnboardingRepository
    participant SQL as wp_hsr_onboarding_sessions
    participant Bill as StripeSubscriptionService
    participant Fact as StripeClientFactory
    participant Stripe as Stripe API

    Front->>WP: POST .../subscription/preview + X-Session-Token
    Note over WP: permission_callback
    WP->>RL: consume onboarding_auth (300 / 300s)
    alt estouro auth
        WP-->>Front: 429 rate_limit
    end
    WP->>Tok: validate(token, session_id)
    alt token invalido/expirado
        WP-->>Front: 401/403
    end

    Note over WP: callback subscription_preview
    WP->>Svc: get_subscription_preview(sessionId, payload)
    Svc->>Repo: get(sessionId)
    Note over Repo: SELECT; se so transient legado, save() lazy migrate
    alt sessao inexistente
        Svc-->>Front: 404 session_not_found
    end

    Note over Svc: country = address.country ?? zipcode.country ?? session.country
    alt country != US
        Svc-->>Front: 400 preview_us_only
    end
    alt classes PawBowlStripe ausentes
        Svc-->>Front: 503 stripe_unavailable
    end

    Note over Svc: price_ids do body (prefixo price_) ou fallback catalog_pricing.line_items
    alt nenhum price_id
        Svc-->>Front: 422 invalid_price_id
    end

    Svc->>Bill: preview_subscription_invoice(priceIds, address)
    Bill->>Fact: create()
    alt SDK ou STRIPE_SECRET_KEY ausente
        Bill-->>Front: 503 stripe_sdk_missing / stripe_secret_missing
    end
    Bill->>Stripe: POST /v1/invoices/create_preview
    alt Throwable Stripe
        Bill-->>Front: 502 stripe_preview_failed
    end
    Bill-->>Front: 200 { success:true, data:{ subtotal, tax, total, currency } }
```

### 2.1 Camada REST (`OnboardingApi::subscription_preview`)

1. Sanitiza `session_id` com `sanitize_text_field`.
2. Extrai body via `extract_payload`:
   - `get_json_params()` se array **nao vazio**;
   - senao `get_body_params()` (form-urlencoded).
   - `{}` vazio cai no form body (em PHP `empty([])` e true). Sem body, payload = `[]`.
3. Chama `OnboardingService::get_subscription_preview`.
4. Se `WP_Error` → devolve o erro (status no `data.status`; sem envelope `success`).
5. Senao → HTTP `200` com `{ success: true, data: <resultado> }`.

O `data` **nao** e a sessao. Sao quatro campos numericos/string vindos do Stripe (apos conversao de centavos).

Nao ha rate limit especifico. So o bucket `onboarding_auth` do permission_callback.

Nao ha validacao de schema REST. Campos extras no JSON sao ignorados (`promotion_code`, `quantity`, `shipping`, etc. nao entram).

### 2.2 Autenticacao (`require_valid_session_access`)

Roda **antes** do callback. Ordem:

1. `session_id` vazio → HTTP `403` (`session_forbidden`).
2. Rate limit de auth por sessao:
   - chave: `onboarding_auth`
   - default: `300` tentativas / `300` s
   - env: `HSR_ONBOARDING_AUTH_RATE_LIMIT_MAX`, `HSR_ONBOARDING_AUTH_RATE_LIMIT_WINDOW`
   - filters: `hsr/onboarding_rate_limit_max`, `hsr/onboarding_rate_limit_window`
   - janela efetiva no limiter: `max(60, window)`; tentativas: `max(1, max)`
   - estouro → HTTP `429` (`rate_limit`)
3. Token:
   - preferencial: header `X-Session-Token`
   - fallback: `Authorization: Bearer {token}` (e `HTTP_AUTHORIZATION` / `REDIRECT_HTTP_AUTHORIZATION`)
   - ausente → HTTP `401` (`session_unauthorized`)
4. `SessionTokenService::validate(token, session_id)`:
   - formato/assinatura invalidos → HTTP `401` (`session_token_invalid`)
   - expirado (`exp < now`) ou `sid` vazio → HTTP `401` (`session_token_expired`)
   - token de outra sessao → HTTP `403` (`session_forbidden`)

Origem do token: `POST /custom/v1/onboarding/session/start` → `data.session_token`.  
Assinatura: HMAC-SHA256 do payload base64url, secret `AUTH_KEY` (fallback `wp_salt('auth')`). Filter de TTL na **emissao**: `hsr/onboarding_token_ttl` (env `HSR_ONBOARDING_TOKEN_TTL`, default 172800 s, minimo 1800 s).

CORS: `Plugin::allow_rest_cors_headers` adiciona `x-session-token` em `rest_allowed_cors_headers`.

Nao exige usuario WP logado. Sessao anonima com token e suficiente.

### 2.3 Validacoes de negocio (`OnboardingService::get_subscription_preview`)

Sessao precisa existir (`repository->get`). Sem sessao → HTTP `404` (`session_not_found`).

Pipeline, nesta ordem. Falha e `WP_Error` (nao envelope `success: true`).

| # | Regra | HTTP | `code` | Dominio i18n |
|---|---|---|---|---|
| 1 | Sessao inexistente | 404 | `session_not_found` | `headless-secure-registration` |
| 2 | Pais != `US` (apos uppercase + sanitize) | 400 | `preview_us_only` | `headless-secure-registration` |
| 3 | Classes `PawBowlStripe\StripeClientFactory` ou `StripeSubscriptionService` ausentes | 503 | `stripe_unavailable` | `headless-secure-registration` |
| 4 | Nenhum `price_id` valido (`price_...`) no body nem no snapshot | 422 | `invalid_price_id` | `headless-secure-registration` |
| 5 | Stripe SDK PHP ausente | 503 | `stripe_sdk_missing` | `headless-secure-registration` (mensagem no factory) |
| 6 | `STRIPE_SECRET_KEY` vazio | 503 | `stripe_secret_missing` | idem |
| 7 | Pais != US **de novo** dentro do billing (defesa) | 400 | `preview_us_only` | `pawbowl-stripe-billing` |
| 8 | Itens vazios apos refiltro `price_` no billing | 422 | `invalid_price_id` | `pawbowl-stripe-billing` |
| 9 | Qualquer `Throwable` do SDK Stripe | 502 | `stripe_preview_failed` | message = `$e->getMessage()` (texto cru da Stripe) |

Resolucao de pais (primeiro nao-vazio, depois uppercase):

```
payload.address.country
  ?? session.zipcode.country
  ?? session.country
```

`ProductTaxService::is_us_country` e igualdade estrita com `"US"`. `USA`, `United States`, `us ` (apos sanitize/trim/upper vira `US` so se for exatamente essas duas letras) — `USA` **falha**. Pais vazio / `BR` / `CA` → 400.

**Nao valida:**

- se `POST .../zipcode` ou `plan-selection` rodaram antes (so usa o que existir);
- se `state` / `postal_code` / `line1` / `city` estao preenchidos (repassa string vazia; Stripe pode 502);
- se os `price_ids` pertencem ao catalogo da sessao (aceita qualquer `price_...`);
- quantidade por linha (sempre `quantity: 1`);
- `STRIPE_US_AUTOMATIC_TAX` (esta rota **sempre** manda `automatic_tax.enabled=true`);
- cupom / promotion code;
- frete selecionado;
- usuario vinculado / account-link.

### 2.4 Resolucao de `price_ids`

Dois caminhos. O segundo so roda se o primeiro ficar vazio.

**1) Body `price_ids` (array)**

Cada item: `sanitize_text_field`, descarta vazio e o que **nao** comeca com `price_`. Nao ha checagem de `price_data` / product.

**2) Fallback da sessao** (`plan_selection.catalog_pricing.line_items[]`)

Le `line.stripe_price_id` **ou** `line.price_id`, mesma regra de prefixo.

Ha um bloco morto imediatamente acima:

```php
$checkoutItems = [];
if (class_exists('\\HSR\\CheckoutService')) {
    // Resolve from session catalog stripe price mapping via filter-friendly path.
}
```

Nao chama `CheckoutService::resolve_checkout_items_from_session`. Esse metodo (usado no checkout de verdade) mapeia `variation_id` / `product_id` → `_stripe_price_ids_by_currency` / `_stripe_price_id` e **soma quantity**. O preview **nao**.

O snapshot de `POST .../plan-selection` (`build_catalog_pricing_snapshot_for_plan_selection`) grava `variation_id`, `product_id`, `quantity`, `unit_price` — **nao** grava `stripe_price_id` nem `price_id`. Sem o front mandar `price_ids`, o fallback tipicamente devolve array vazio → 422 `invalid_price_id`.

Depois: `array_values(array_unique($priceIds))`. Duplicatas somem. Cada id vira **um** item Stripe com `quantity: 1`.

### 2.5 Montagem do endereco de preview

```php
$previewAddress = [
  'country'     => $country,           // ja US
  'state'       => strtoupper(address.state ?? zipcode.state ?? ''),
  'postal_code' => address.postal_code ?? zipcode.postal_code ?? zipcode.zipcode ?? '',
  'line1'       => address.line1 ?? zipcode.address_line1 ?? zipcode.street ?? '',
  'city'        => address.city ?? zipcode.city ?? '',
];
```

Todos os strings passam por `sanitize_text_field`. `state` e forcado uppercase.

**Nao** envia: `line2`, `number`, `neighborhood`, `complement`/`address_line2`, `phone`. Stripe Tax US costuma aceitar `country` + `postal_code`; `line1`/`city` melhoram precisao municipal. Sem `postal_code`, a Stripe frequentemente responde erro de location (vira 502).

No billing, `line1` e `city` so entram no payload Stripe se nao-vazios. `country`, `state` e `postal_code` sempre vao, mesmo `""`.

### 2.6 Persistencia

**Esta rota nao chama `repository->save`.** Nao atualiza `plan_selection.product_tax`, `stripe_checkout`, `updated_at` (salvo o caso legado abaixo).

Excecao: `OnboardingRepository::get` ainda promove transient legado `hsr_onb_{sessionId}` para SQL (`save` + rewrite de pets) **antes** das validacoes. Sessao so-SQL = read-only neste request.

O preview **nao** e cacheado. Cada POST bate na Stripe.

---

## 3) Chamadas a backend / servicos externos

Unico HTTP de saida: **Stripe** (API de faturamento). Nao ha client PawBowl, ViaCEP, OSRM, Woo Tax, meal-plan catalog HTTP.

Servico: Stripe Billing / Stripe Tax (Automatic Tax).  
SDK: `stripe/stripe-php` `^16` (lock: `v16.6.0`).  
Cliente: `StripeClientFactory::create()` → `\Stripe\StripeClient`.

### 3.1 Configuracao do client

| Env / constante | Uso |
|---|---|
| `STRIPE_SECRET_KEY` | `api_key`. Vazio → 503 `stripe_secret_missing` |
| `STRIPE_API_VERSION` | header `Stripe-Version` se nao-vazio. `.env.example`: `2025-09-30.clover` |
| `STRIPE_MAX_RETRIES` | `\Stripe\Stripe::setMaxNetworkRetries`. `(int)` de string vazia = `0` (nao cai no default `2`; so valores **negativos** viram 2) |
| `STRIPE_US_AUTOMATIC_TAX` | **nao lido nesta rota** |

Plugin `pawbowl-stripe-billing` precisa estar ativo (`class_exists`). SDK precisa estar no autoload (`\Stripe\StripeClient`).

### 3.2 Endpoint Stripe

```
POST https://api.stripe.com/v1/invoices/create_preview
```

PHP: `$stripe->invoices->createPreview($params)`.

Auth: Bearer `STRIPE_SECRET_KEY` (Basic no curl oficial).  
Content-Type: `application/x-www-form-urlencoded` (SDK).  
Idempotency-Key: **nenhuma** (preview nao cria objeto persistente; id de resposta prefixado `upcoming_in_...`).

Nao envia `customer` nem `subscription`. Preview de **criacao** hipotetica: `subscription_details.items` + `customer_details.address`.

### 3.3 Payload enviado (equivalente form)

Campos efetivos montados em `preview_subscription_invoice`:

```
automatic_tax[enabled]=true
customer_details[address][country]=US
customer_details[address][state]=NY
customer_details[address][postal_code]=10001
customer_details[address][line1]=350%205th%20Avenue     # omitido se vazio
customer_details[address][city]=New%20York               # omitido se vazio
subscription_details[items][0][price]=price_abc
subscription_details[items][0][quantity]=1
subscription_details[items][1][price]=price_def
subscription_details[items][1][quantity]=1
```

JSON equivalente (nao e o wire format, so leitura):

```json
{
  "customer_details": {
    "address": {
      "country": "US",
      "state": "NY",
      "postal_code": "10001",
      "line1": "350 5th Avenue",
      "city": "New York"
    }
  },
  "subscription_details": {
    "items": [
      { "price": "price_abc", "quantity": 1 },
      { "price": "price_def", "quantity": 1 }
    ]
  },
  "automatic_tax": { "enabled": true }
}
```

**Nao enviado (de proposito ou por omissao):**

| Campo Stripe | Motivo |
|---|---|
| `customer` | preview anonimo; nao cria/consulta Customer |
| `discounts` / `subscription_details.items[].discounts` | cupom 1a compra **nao** entra (ver `09-stripe-coupons-first-purchase.md`) |
| `add_invoice_items` (frete) | checkout real adiciona shipping so no `subscriptions.create`; preview de produto puro |
| `currency` | herda dos Prices |
| `subscription_details.items[].tax_rates` | automatic tax, nao Tax Rate manual (`txr_`) |
| `tax_behavior` no item | precisa ja estar no Price Stripe (`exclusive`/`inclusive`); `unspecified` quebra automatic tax |

### 3.4 Resposta Stripe esperada

Objeto Invoice de preview (`id` com prefixo `upcoming_in_`, `status` tipicamente `draft`, `billing_reason` `upcoming`). **Nao** aparece em listagens; nao e cobravel.

Com `STRIPE_API_VERSION=2025-09-30.clover` (e clover posteriores), campos relevantes:

```json
{
  "id": "upcoming_in_1ABC...",
  "object": "invoice",
  "currency": "usd",
  "subtotal": 7900,
  "subtotal_excluding_tax": 7900,
  "total": 8601,
  "total_excluding_tax": 7900,
  "total_taxes": [
    {
      "amount": 701,
      "tax_behavior": "exclusive",
      "taxable_amount": 7900,
      "type": "tax_rate_details",
      "taxability_reason": "standard_rated"
    }
  ],
  "automatic_tax": {
    "enabled": true,
    "status": "complete"
  }
}
```

Valores em **centavos** (USD). `automatic_tax.status` pode ser `complete`, `failed`, `requires_location_inputs`.

O PHP **nao** le `total_taxes`, `tax`, `automatic_tax.status` nem `lines`. Extrai so:

```php
'subtotal' => round(((int) ($preview->subtotal ?? 0)) / 100, 2),
'tax'      => round(((int) ($preview->total_tax ?? 0)) / 100, 2),
'total'    => round(((int) ($preview->total ?? 0)) / 100, 2),
'currency' => strtolower(sanitize_text_field((string) ($preview->currency ?? 'usd'))),
```

**Bug de contrato vs API clover:** Invoice clover nao tem propriedade `total_tax`. O campo legado era `tax` (int) e/ou `total_tax_amounts[]`; o clover usa `total_taxes[].amount`. Com a versao do `.env.example`, `$preview->total_tax` e `null` → `data.tax` sai **`0.00` mesmo com imposto calculado**. `data.total` ainda reflete o total com tax se a Stripe preencheu `total`. Front que mostra `data.tax` fica zerado; `total - subtotal` seria o workaround nao implementado.

### 3.5 Tratamento de erro Stripe

`try/catch (\Throwable)`. Qualquer falha (rede, 4xx/5xx Stripe, Price inexistente, tax location, Price sem `tax_behavior`) vira:

- HTTP **502**
- `code`: `stripe_preview_failed`
- `message`: string crua da Stripe (`$e->getMessage()`), **sem** mapear `code` Stripe (`resource_missing`, `customer_tax_location_invalid`, etc.)
- sem retry extra alem de `STRIPE_MAX_RETRIES`
- sem log proprio nesta funcao
- **nada gravado** na sessao

Erros tipicos da Stripe neste payload:

| Situacao | Comportamento observado |
|---|---|
| `price_id` inexistente / outra conta | 502, message tipo "No such price: price_..." |
| Price `tax_behavior=unspecified` + automatic tax | 502, incompatibilidade de automatic tax |
| Stripe Tax nao habilitado na conta / sem nexus | 502 ou preview com `automatic_tax.status=failed` e tax 0 (se a chamada nao throw) |
| Address incompleto (sem ZIP) | 502 location invalid, **ou** 200 com tax 0 e `requires_location_inputs` (PHP nao distingue) |
| Moedas misturadas nos prices | 502 |
| Timeout / 5xx Stripe | 502 apos retries do SDK |

Nao ha circuit breaker. Cada request do front e uma ida a `api.stripe.com`.

### 3.6 Relacao com checkout real (`create_subscription`)

| | Preview desta rota | `subscriptions.create` no checkout |
|---|---|---|
| `automatic_tax` | **sempre** `enabled: true` | so se `STRIPE_US_AUTOMATIC_TAX` em `{1,true,yes,on}` **e** pais US |
| Tax Rates manuais (`txr_`) | nao | ramo flag off: `StripeTaxRateService::get_or_create_stripe_tax_rate` |
| Frete | nao | `add_invoice_items` com `price_data` (1a fatura) |
| Cupom 1a compra | nao | `discounts[].promotion_code` se elegivel |
| Quantity | sempre 1 por price unico | soma `line.quantity` no `CheckoutService` |
| Customer | nao | customer Stripe do usuario vinculado |
| Persistencia | nenhuma | pedido Woo + metas `_hsr_*` |

Com a flag **desligada** (default `.env.example` = `0`): select/sales-tax usam Woo; checkout anexa `tax_rates`; **esta rota ainda chama Stripe Tax**. Resumo de checkout e cobranca podem divergir se o front misturar as duas fontes.

Com a flag **ligada**: select/sales-tax devolvem `product_tax: 0` (placeholder); o numero de imposto "de verdade" deveria vir daqui — mas ver o bug `total_tax` acima.

---

## 4) Request / response

### 4.1 Headers

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/subscription/preview
Content-Type: application/json
X-Session-Token: {session_token}
```

`Authorization: Bearer {session_token}` tambem vale se `X-Session-Token` estiver vazio.

### 4.2 Sucesso US (front manda `price_ids` + address)

Request:

```http
POST /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/subscription/preview
Content-Type: application/json
X-Session-Token: eyJzaWQiOiIzYWJmNGIyZC....hmac

{
  "price_ids": ["price_1MealChickenUsd", "price_1MealTurkeyUsd"],
  "address": {
    "country": "US",
    "state": "NY",
    "postal_code": "10001",
    "line1": "350 5th Avenue",
    "city": "New York"
  }
}
```

Response `200` (shape real do PHP; `tax` pode estar 0 por causa de `total_tax` vs `total_taxes`):

```json
{
  "success": true,
  "data": {
    "subtotal": 79.0,
    "tax": 0.0,
    "total": 86.01,
    "currency": "usd"
  }
}
```

Se a API Stripe ainda expuser `total_tax` (versao pre-clover / SDK mapeando o campo), o mesmo request poderia devolver `"tax": 7.01`. Node nao deve copiar a leitura de `total_tax` às cegas.

`currency` e sempre lowercase (`usd`). Centavos: `7900` → `79.0` via `/ 100` + `round(..., 2)`.

### 4.3 Sucesso minimo (address omitido; usa `session.zipcode`)

Sessao ja tem zipcode US gravado por `POST .../zipcode`. Body so com prices:

```json
{
  "price_ids": ["price_1MealChickenUsd"]
}
```

Equivalente interno:

```
country     = zipcode.country ?? session.country
state       = zipcode.state
postal_code = zipcode.postal_code ?? zipcode.zipcode
line1       = zipcode.address_line1 ?? zipcode.street
city        = zipcode.city
```

Response `200` mesmo shape da 4.2.

### 4.4 Body vazio / sem `price_ids` e sem snapshot mapeado

```json
{}
```

Se `plan_selection.catalog_pricing.line_items` nao tiver `stripe_price_id`/`price_id` (caso normal pos plan-selection):

```json
{
  "code": "invalid_price_id",
  "message": "At least one Stripe price_id is required for preview.",
  "data": { "status": 422 }
}
```

`price_ids: ["foo", "bar"]` (sem prefixo `price_`) cai no mesmo 422.

### 4.5 Pais nao-US

```json
{
  "address": { "country": "BR" },
  "price_ids": ["price_1MealChickenBrl"]
}
```

```json
{
  "code": "preview_us_only",
  "message": "Subscription tax preview is only available for US addresses.",
  "data": { "status": 400 }
}
```

A checagem de pais e **antes** de exigir `price_ids`. BR com body vazio tambem e 400, nao 422.

### 4.6 Stripe falhou

```json
{
  "code": "stripe_preview_failed",
  "message": "No such price: 'price_doesNotExist'",
  "data": { "status": 502 }
}
```

`message` varia; casar no front por `code`, nao por texto.

### 4.7 Erros HTTP (resumo)

| HTTP | `code` | Quando | Message (EN) |
|---|---|---|---|
| 401 | `session_unauthorized` | sem token | Session token is required. |
| 401 | `session_token_invalid` | assinatura/formato | Invalid session token. |
| 401 | `session_token_expired` | `exp` vencido | Session token expired. |
| 403 | `session_forbidden` | `session_id` vazio ou token de outra sessao | Session access denied. |
| 404 | `session_not_found` | sessao nao existe (SQL nem transient legado) | Onboarding session not found. |
| 400 | `preview_us_only` | pais != US | Subscription tax preview is only available for US addresses. |
| 422 | `invalid_price_id` | nenhum `price_...` | At least one Stripe price_id is required for preview. |
| 429 | `rate_limit` | auth 300/300s | Too many requests. Please try again later. |
| 502 | `stripe_preview_failed` | SDK throw | message da Stripe |
| 503 | `stripe_unavailable` | plugin billing off | Stripe billing is not available. |
| 503 | `stripe_sdk_missing` | `\Stripe\StripeClient` ausente | Stripe SDK is not available in this environment. |
| 503 | `stripe_secret_missing` | env vazio | STRIPE_SECRET_KEY is not configured. |

Formato WP REST de erro: `{ "code", "message", "data": { "status": N } }`. Sem `success: false`.

---

## 5) Hooks e filters do WordPress

### 5.1 Especificos HSR (esta rota)

| Tipo | Hook | Onde | Efeito |
|---|---|---|---|
| action | `rest_api_init` | `Plugin::boot` | registra a rota |
| filter | `hsr/onboarding_rate_limit_max` | `consume_onboarding_limit` | altera max de **auth**. Args: `($maxAttempts, $scope)` com `$scope` = `auth` |
| filter | `hsr/onboarding_rate_limit_window` | idem | altera janela em segundos |
| filter | `hsr/onboarding_ttl` | `OnboardingRepository::ttl` | so se `get()` migrar transient legado |
| filter | `rest_allowed_cors_headers` | `Plugin::allow_rest_cors_headers` | libera header `x-session-token` |

`hsr/onboarding_token_ttl` nao e lido aqui (so na emissao).  
Filters globais do `RateLimiter` (`hsr/rate_limit_max`, `hsr/rate_limit_window`) **nao** se aplicam: onboarding usa `consume_with_limits` com valores explicitos.

Nao ha `do_action` proprio do preview. Nenhum `hsr_checkout_*`, cupom ou meal-plan filter entra neste caminho.

### 5.2 Billing (nao disparados por esta rota, mas vizinhos)

| Hook | Uso real |
|---|---|
| `pawbowl_stripe_us_automatic_tax_enabled` | **nao** nesta rota. Default `true` so no **proration preview** de edit (`StripeSubscriptionEditService`). Onboarding ignora. |

`STRIPE_US_AUTOMATIC_TAX` e lido em `ProductTaxService::is_automatic_tax_enabled` e `StripeSubscriptionService::is_us_automatic_tax_enabled` (checkout). Preview de onboarding nao consulta nenhum dos dois.

### 5.3 Core WP envolvidos

| Hook / API | Uso |
|---|---|
| REST API (`register_rest_route`, `permission_callback`) | roteamento e auth |
| `$wpdb->get_row` | `SELECT *` da sessao |
| `get_transient` / `set_transient` | rate limit auth; migrate legado `hsr_onb_*` |
| `sanitize_text_field` | path, address, price ids, currency |
| `__()` | mensagens i18n |
| `class_exists` | feature-detect do plugin Stripe |

Nao usa `WC_Tax`, carrinho Woo, `wp_cache` grupo `taxes`, nem post meta de Price (o checkout sim).

---

## 6) Dependencias e efeitos colaterais

### 6.1 O que e lido

- Path: `session_id`.
- Headers: `X-Session-Token` / `Authorization`.
- Body: `price_ids[]` (opcional), `address.{country,state,postal_code,line1,city}` (opcional).
- Banco: `{prefix}hsr_onboarding_sessions` (`SELECT *`). Pets sao carregados no `get` e **ignorados**.
- `zipcode_json` (fallback de address).
- `plan_selection_json` → `catalog_pricing.line_items[].stripe_price_id|price_id`.
- `session.country` (ultimo fallback de pais).
- Transient legado: `hsr_onb_{sessionId}` se a linha SQL nao existir.
- Env: `STRIPE_SECRET_KEY`, `STRIPE_API_VERSION`, `STRIPE_MAX_RETRIES`.
- Plugin `pawbowl-stripe-billing` + SDK Stripe.

### 6.2 O que e gravado

| Recurso | Gravado? | Detalhe |
|---|---|---|
| `plan_selection.product_tax` | **nao** | diferente de `sales-tax/quote` |
| `plan_selection.shipping` | **nao** | |
| `stripe_checkout` | **nao** | |
| `zipcode_json` | **nao** | |
| `updated_at` SQL | so se migrate legado | `get()` → `save()` |
| tabela de pets | so se migrate legado | `replace_pets` |
| transient `hsr_onb_{sessionId}` | so se migrate legado | |
| transient rate limit | **sim** | `onboarding_auth` a cada request autenticado |
| Customer / Invoice / Subscription Stripe | **nao** | preview efemero |
| pedido Woo / user meta | **nao** | |

Chave de rate limit:

```
hsr_rl_{md5('onboarding_auth|{sessionId}')}
```

Payload: `{ "count": N }`, TTL = janela (minimo 60 s). Token invalido ainda consome o bucket (permission_callback).

### 6.3 Consumidores posteriores (efeito diferido)

Nenhum consumidor le um "resultado de preview" persistido, porque **nao ha persistencia**.

O front (fora deste repo) e o unico consumidor imediato: usar `data.tax` / `data.total` no resumo US quando automatic tax esta ligado.

Checkout **nao** reusa este preview: recalcula na criacao da subscription. O preview e informativo. Divergencia preview vs cobranca e esperada se:

- cupom de 1a compra aplicar depois;
- frete entrar como `add_invoice_items`;
- quantity real != 1;
- Prices mudarem entre preview e charge;
- `data.tax` estiver 0 por bug de campo.

`StripeSubscriptionEditService` chama o **mesmo** `preview_subscription_invoice` para `next_cycle` em edit US. Corrigir extração de tax no Node/PHP afeta onboarding **e** edit.

### 6.4 Sem efeitos em

- Woo cart / `WC_Tax`
- catalogo `custom-meal-plan-builder` (nao e chamado)
- ViaCEP / Zippopotam / Nominatim / OSRM
- mapeamento `_stripe_price_id` (nao e lido aqui)
- `POST .../zipcode`, shipping, sales-tax
- criacao de Promotion Code / Coupon

---

## 7) Pontos de atencao para reimplementacao em Node

1. **Rota e US-only e 400, nao 422.** Pais vazio ou BR nao deve cair em `invalid_price_id`. Checar country **antes** de price ids.

2. **`STRIPE_US_AUTOMATIC_TAX` nao governa o preview.** PHP sempre manda `automatic_tax.enabled=true`. Copiar isso com a flag default `0` faz o front ver Stripe Tax enquanto o charge usa Woo `tax_rates`. No Node, alinhar preview ao mesmo flag do checkout: flag off → nao chamar Stripe Tax (devolver 409/404 de feature, ou redirecionar o front para `sales-tax/quote`); flag on → esta rota.

3. **Fallback de `price_ids` esta quebrado no PHP.** `catalog_pricing.line_items` nao tem `stripe_price_id`. O stub de `CheckoutService` nao executa. Front **precisa** mandar `price_ids`, ou o Node deve implementar de verdade o mapeamento `variation_id` → Price por moeda (como `resolve_checkout_items_from_session`), incluindo **quantity**.

4. **Quantity sempre 1 e unique de ids.** Duas lines com o mesmo `price_` viram um item qty 1. Checkout soma quantities. Preview subestima o subtotal se o front nao expandir ids. Replicar fielmente ou corrigir (correcao: usar o mesmo resolver do checkout).

5. **Nao persistir.** Nao gravar `product_tax` neste POST. `sales-tax/quote` e quem persiste o ramo Woo. Misturar os dois no mesmo campo sem `source` quebra o GET da sessao.

6. **Nao incluir frete nem cupom.** Checkout adiciona shipping na 1a invoice e pode aplicar `promo_`. Preview "fiel ao PHP" e produto puro, pre-desconto. Se o Node quiser preview = o que o cliente paga, isso e comportamento **novo** (e desejavel), nao copia.

7. **Ler imposto da Invoice clover.** Nao copiar `$preview->total_tax`. Somar `total_taxes[].amount` (e fallback `tax` se API antiga). Validar `automatic_tax.status === complete`; `requires_location_inputs` / `failed` nao devem virar `tax: 0` silencioso se o front precisa de numero.

8. **Address minimo para Stripe Tax US.** Docs Stripe: `country` + `postal_code` obrigatorios para calcular. PHP nao valida e deixa a Stripe 502. No Node, 422 proprio (`missing_address`) e melhor que vazar message da Stripe.

9. **`line1`/`city` opcionais no wire.** Nao mandar chave vazia (PHP omite). `state` e `postal_code` o PHP manda mesmo vazios — Stripe pode reclamar.

10. **Prices precisam de `tax_behavior`.** Sync Woo→Stripe tem que gravar `exclusive` (checkout ja poe isso no shipping `price_data` quando flag on). Price legado `unspecified` → 502. Tratar como erro de catalogo, nao de sessao.

11. **Nao criar Customer.** Preview com `customer_details` avulso. Criar customer so para preview poluiria a conta Stripe e mudaria o contrato.

12. **Sem Idempotency-Key.** Preview e GET semantico via POST. Nao exige idempotency (diferente de `create-subscription`).

13. **502 vaza texto da Stripe.** Front deve casar `code`. No Node, mapear erros conhecidos (`resource_missing` → 422 `invalid_price_id`; location → 422) e **nao** devolver stack/secret. Message EN do PHP hoje e o `getMessage()` cru.

14. **Plugin billing ausente = 503**, nao 500. Ambiente Node unificado nao tem esse split; o equivalente e Stripe client/config missing → 503 `stripe_secret_missing` / `stripe_sdk_missing`.

15. **Lazy migrate de sessao.** `get()` ainda pode `save()` transient legado. No Node com Postgres, ignore esse ramo.

16. **Sanitize.** `sanitize_text_field` em ids e address (strip tags, trim). Prefix gate: so `price_` (nao `prod_`, nao Price lookup por nickname).

17. **Moeda.** Response `currency` lowercase da Invoice, nao da sessao. Prices BRL num preview US tendem a falhar na Stripe. Nao converter FX aqui.

18. **Retries.** `STRIPE_MAX_RETRIES`; env vazio no PHP vira **0**, nao 2. `.env.example` declara `2`. Copiar o quirk ou usar default 2 consciente.

19. **Rate limit.** So auth 300/300s por sessao. Preview e pago (Stripe + latencia). Vale limite proprio (ex. 30/min) no Node; isso e melhoria, nao copia.

20. **Contrato de resposta.** Manter `{ success, data: { subtotal, tax, total, currency } }` se o front ja consome. Nao devolver a Invoice inteira. Numeros em unidade major (2 casas), nao centavos.

21. **i18n.** Messages EN via `__()`. Casar `code`. `preview_us_only` existe em dois text domains com a mesma string.

22. **Edit de assinatura.** Qualquer helper compartilhado de "preview invoice + automatic tax" e usado tambem em `StripeSubscriptionEditService` (`next_cycle`). Mudar extração de tax uma vez so.

23. **Rota sugerida na migracao Node** (ainda nao listada no doc 08): `POST /api/v1/onboarding/sessions/:sessionId/subscription/preview`. Manter US-only e o envelope `data`.

24. **Testes ausentes.** Cobrir no Node: BR → 400; sem price_ids e sem mapping → 422; price_ids filtrando lixo; unique+qty 1; fallback zipcode vs override address; Stripe 4xx → 502 mapeado; `total_taxes` somado; flag automatic tax alinhada ao checkout; nao persistir sessao; nao mandar discounts/shipping.

---

## 8) Relacao com tax, zipcode e checkout

Fluxo feliz US (Phase 2, flag ligada):

```
1. POST .../zipcode                 → grava endereco US
2. POST .../plan-selection          → catalog_pricing (sem stripe_price_id)
3. POST .../shipping/select         → product_tax=0, jurisdiction=state
4. POST .../subscription/preview    → Stripe Tax (esta rota); front manda price_ids
5. POST .../account-link
6. POST .../subscription/checkout   → subscriptions.create automatic_tax=true
                                     + add_invoice_items de frete
                                     + promo se 1a compra
```

Phase 1 (flag off, default do repo):

```
3'. POST .../sales-tax/quote ou shipping/select → WC_Tax, grava product_tax
4'. esta rota ainda existe e ainda chama Stripe Tax (nao e o numero cobrado)
6'. checkout anexa tax_rates manuais (txr_), nao automatic_tax
```

Quote de tax Woo **grava** sessao. Preview Stripe **nao grava**. Sem o passo 4, o resumo US com flag on nao tem imposto de produto (fica 0 no select).
