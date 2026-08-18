# POST `/onboarding/session/{session_id}/sales-tax/quote`

Documentacao da logica **atual** da cotacao de sales tax de produto no onboarding.

Escopo: calcular imposto de **produto** (nao de frete) para o resumo de checkout e gravar o snapshot em `plan_selection.product_tax`. Comentario no codigo: *"Lightweight US product sales-tax quote for checkout summary (does not require shipping rates)"*. A rota **nao cotiza** frete, **nao persiste** `zipcode` nem `shipping`, e **nao chama** Stripe.

Plugin: `headless-secure-registration`.

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php` (`get_sales_tax_quote`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-product-tax-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-rate-limiter.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`
- Woo (ramo US, automatic tax off): `wp/wp-content/plugins/woocommerce/includes/class-wc-tax.php`
- consumidores posteriores: `src/class-checkout-service.php` (precheck, metas `_hsr_product_tax*`, payload Stripe); `pawbowl-stripe-billing/src/class-stripe-tax-rate-service.php` (cria `txr_` a partir do percentual)

Nao ha teste unitario nem smoke dedicado desta rota. Nao aparece no Swagger (`artefatos/swagger-pawbowl.yaml`) nem na lista sugerida de rotas Node (`artefatos/migracao-node-reverse-engineering/08-endpoints-rest-sugeridos.md`).

Namespace REST: `custom/v1`  
Base: `{WP_URL}/wp-json`

---

## 1) Identidade da rota

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/sales-tax/quote
```

| Item | Valor |
|---|---|
| Namespace WP | `custom/v1` |
| Metodo | `POST` (`WP_REST_Server::CREATABLE`) |
| Path param | `session_id` — regex `[A-Za-z0-9_-]+` |
| Permission | `OnboardingApi::require_valid_session_access` |
| Handler | `OnboardingApi::get_sales_tax_quote` |
| Servico | `OnboardingService::get_sales_tax_quote` |
| Tax | `ProductTaxService::resolve_from_session($session, null, $addressOverride)` |
| Validator | nenhum (`RequestValidator` nao e usado; sem `args` no `register_rest_route`) |
| Rate limit proprio | nenhum (so o de auth no permission_callback) |
| Registro | `add_action('rest_api_init', [OnboardingApi, 'register_routes'])` |

Objetivo: devolver `subtotal` + `product_tax` + percentual + jurisdicao para o resumo do checkout, e persistir o mesmo objeto em `plan_selection.product_tax` (com `quoted_at`).

Nao confundir com:

- `POST .../shipping/select` — persiste **frete** e tambem recalcula product tax. Select **nao** aceita override de `address`.
- `POST .../shipping/quote` — cotiza frete (e ja grava product tax). Exige zipcode na sessao.
- `POST .../subscription/preview` — preview **Stripe Tax** (`invoices.createPreview`). **Nao** grava `product_tax`. So US.
- `POST .../zipcode` — grava endereco; **nao** recalcula tax.
- `POST .../plan/preview` — preco do plano no catalogo meal-plan, nao imposto.

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
    participant Tax as ProductTaxService
    participant Woo as WC_Tax (tabelas Woo)
    participant SQL as wp_hsr_onboarding_sessions
    participant Tr as transient hsr_onb_*

    Front->>WP: POST .../sales-tax/quote + X-Session-Token
    Note over WP: permission_callback
    WP->>RL: consume onboarding_auth (300 / 300s)
    alt estouro auth
        WP-->>Front: 429 rate_limit
    end
    WP->>Tok: validate(token, session_id)
    alt token invalido/expirado
        WP-->>Front: 401/403
    end

    Note over WP: callback get_sales_tax_quote
    WP->>Svc: get_sales_tax_quote(sessionId, payload)
    Svc->>Repo: get(sessionId)
    Note over Repo: SELECT; se so transient legado, save() lazy migrate
    alt sessao inexistente
        Svc-->>Front: 404 session_not_found
    end

    Note over Svc: addressOverride = payload.address (array) ou null
    Svc->>Tax: resolve_from_session(session, null, addressOverride)
    alt country != US
        Note over Tax: tax=0, sem HTTP, sem Woo
    else US e STRIPE_US_AUTOMATIC_TAX ligado
        Note over Tax: tax=0, jurisdiction=state (Stripe Tax e Phase 2)
    else US e automatic tax desligado
        Tax->>Woo: WC_Tax::find_rates + calc_exclusive_tax
        alt subtotal/endereco/rates ausentes
            Tax-->>Front: 422 sales_tax_unavailable (nada gravado)
        end
    end

    Svc->>Repo: save(plan_selection.product_tax)
    Note over Repo: retorno do save e ignorado
    Repo->>SQL: UPDATE plan_selection_json + updated_at
    Repo->>SQL: DELETE+INSERT pets (efeito colateral)
    Repo->>Tr: set_transient hsr_onb_{sessionId}
    Svc-->>Front: 200 { success:true, data:{ session_id, subtotal, product_tax, ... } }
```

### 2.1 Camada REST (`OnboardingApi::get_sales_tax_quote`)

1. Sanitiza `session_id` com `sanitize_text_field`.
2. Extrai body via `extract_payload`:
   - `get_json_params()` se array nao vazio;
   - senao `get_body_params()` (form-urlencoded).
   - `{}` vazio cai no form body (em PHP `empty([])` e true) → payload `[]`.
3. Chama `OnboardingService::get_sales_tax_quote`.
4. Se `WP_Error` → devolve o erro (404/422; 401/403/429 so no permission).
5. Senao → HTTP `200` com envelope `{ success: true, data: <resultado> }`.

O `data` **nao** e a sessao completa (diferente de `POST .../zipcode`). E um subset: `session_id`, `subtotal`, `product_tax`, `product_tax_percent`, `tax_jurisdiction`, `country`.

Nao ha rate limit especifico de quote de tax. So o bucket `onboarding_auth` do permission_callback.

Nao ha validacao de schema REST (`args` / `RequestValidator`). Campos extras no JSON sao ignorados. Body vazio e valido.

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
   - `sid` != `session_id` da URL → HTTP `403` (`session_forbidden`)

Token HMAC (`payload.signature`), secret interno do plugin. `hsr/onboarding_token_ttl` so na emissao, nao na validacao alem do `exp` gravado.

Token invalido **ainda consome** o bucket de auth (o limiter roda antes do validate).

### 2.3 Servico (`OnboardingService::get_sales_tax_quote`)

Gates, nesta ordem:

| # | Condicao | HTTP | `code` |
|---|---|---|---|
| 1 | sessao ausente (SQL e transient legado) | 404 | `session_not_found` |
| 2 | `ProductTaxService` devolve `WP_Error` | 422 | `sales_tax_unavailable` |

Nao ha gate de zipcode, shipping, plano ou pais no servico. Pais nao-US **passa** com tax 0.

Passos no sucesso:

1. `addressOverride = payload['address']` se for array; senao `null`. String / numero / `null` → sem override.
2. `ProductTaxService::resolve_from_session($session, null, $addressOverride)` — o segundo arg (`$subtotalOverride`) e sempre `null` nesta rota.
3. Merge em `plan_selection` existente (preserva flavors, catalog_pricing, shipping, discount, etc.).
4. Overwrite de `plan_selection.product_tax` (objeto inteiro).
5. `repository->save($session)` — **retorno ignorado**. Falha de DB ainda devolve HTTP 200 com o quote.
6. Return do subset (sem `quoted_at` no response HTTP; `quoted_at` so no JSON persistido).

### 2.4 Payload aceito

Nenhum campo e obrigatorio.

| Campo | Tipo | Uso |
|---|---|---|
| `address` | object | override **in-memory** para o calculo. Nao grava `zipcode_json`. |
| `address.country` | string | pais do override; fallback: `session.zipcode.country` |
| `address.state` | string | estado; fallback: `zipcode.state` |
| `address.postal_code` | string | CEP/ZIP; alias `address.postcode` |
| `address.postcode` | string | alias de `postal_code` |
| `address.city` | string | cidade; fallback: `zipcode.city` |
| `address.line1` / `line2` / etc. | — | **ignorados** (diferente de `subscription/preview`) |

Override so entra se `is_array($address) && ! empty($address)`. `[]` nao mergeia. Objeto com qualquer chave (mesmo so `city`) dispara o merge dos cinco campos.

`??` no PHP **nao** trata string vazia. `{ "state": "" }` zera `state` mesmo se a sessao tiver `NY`.

Pais efetivo apos merge: `zipcode.country ?? session.country`, depois `strtoupper(sanitize_text_field(...))`.

### 2.5 Persistencia de `product_tax`

```php
$planSelection['product_tax'] = [
  'subtotal' => (float),
  'product_tax' => (float),
  'product_tax_percent' => (float),
  'tax_jurisdiction' => (string),  // state US, "" no nao-US
  'country' => (string),
  'quoted_at' => gmdate('c'),      // ISO UTC; so no JSON da sessao
];
```

Overwrite, nao merge. Um segundo POST substitui o objeto. `quoted_at` e sempre novo.

Subtotal lido de `plan_selection.catalog_pricing.subtotal`; fallback: `plan_selection.product_tax.subtotal` ja cacheado. Nao consulta catalogo meal-plan nem Stripe nesta rota.

---

## 3) Chamadas a backend / servicos externos

**Esta rota nao faz HTTP para um backend PawBowl, nem para ViaCEP, OSRM, Nominatim, Zippopotam ou Stripe.**

O unico servico tocado alem do repositorio e `ProductTaxService`, in-process. Stripe Tax (Phase 2) e a rota irma `POST .../subscription/preview`.

### 3.1 Nenhum endpoint PawBowl

Nao ha client HTTP proprio. Nao ha URL `PAWBOWL_*` / meal-plan / nutrition neste caminho.

### 3.2 `ProductTaxService` (in-process)

Resolucao de pais: apos o merge opcional de `address`, `zipcode.country ?? session.country`, uppercase via `sanitize_text_field`. `is_us_country` e igualdade estrita com `"US"` (apos trim/upper). `USA`, `United States`, `US-NY` **nao** passam.

| Condicao | Comportamento | HTTP externo |
|---|---|---|
| `country !== 'US'` (inclui BR, `""`, `CA`) | `product_tax = 0`, `product_tax_percent = 0`, `tax_jurisdiction = ""` | nenhum |
| `country === 'US'` **e** `STRIPE_US_AUTOMATIC_TAX` em `{1,true,yes,on}` (env ou constante PHP) | tax 0; `tax_jurisdiction = state`; Stripe Tax fica para preview/charge | nenhum |
| `country === 'US'` e automatic tax off | `WC_Tax::find_rates` + `WC_Tax::calc_exclusive_tax` | nenhum (tabelas Woo + object cache) |

Env: `STRIPE_US_AUTOMATIC_TAX`. Em `.env.example` default `0`. Se getenv vazio, cai na constante PHP `STRIPE_US_AUTOMATIC_TAX` se definida. Se ambos vazios, o ramo Woo e o usado para US.

No ramo nao-US, `country` no retorno e o codigo resolvido; se ainda vazio, cai em `session.country`.

#### 3.2.1 WooCommerce Tax (so US, automatic tax off)

Nao e um REST remoto. `WC_Tax::find_rates` le `{prefix}woocommerce_tax_rates` + `{prefix}woocommerce_tax_rate_locations`, com cache `wp_cache` grupo `taxes`.

**Entrada interna (nao e JSON de request):**

```php
WC_Tax::find_rates([
  'country'  => 'US',
  'state'    => $state,      // zipcode.state (ja upper + sanitize)
  'postcode' => $postcode,   // zipcode.postal_code ?? zipcode.zipcode
  'city'     => $city,
]);
```

`tax_class` nao e passado → classe padrao (`''`). A classe fiscal do produto Woo **nao** e consultada.

Woo normaliza o postcode com `wc_normalize_postcode`: uppercase, remove espacos e hifens. `10001-1234` vira `100011234` para o match. City no SQL e `strtoupper` exact match.

**Resposta esperada de `find_rates`:** mapa `tax_rate_id => { rate, label, shipping, compound }`. Woo devolve **no maximo um rate por `tax_rate_priority`**. O servico:

1. Soma todos os `rate` → `product_tax_percent` (4 casas).
2. `WC_Tax::calc_exclusive_tax($subtotal, $rates)` — precos tratados como **exclusive** (nao-inclusive). Rates `compound=yes` incidem sobre `price + taxes nao-compostos`. Cada parcela passa por `woocommerce_price_ex_tax_amount` e `woocommerce_tax_round` (precisao Woo, tipicamente 4 DP, `.5` para cima).
3. `product_tax` = `round(array_sum($taxes), 2)`. Negativo vira `0`.
4. Se o calc der `0` mas o percentual `> 0`, deriva `round(subtotal * percent / 100, 2)` — aproximacao linear da **soma** dos percentuais, que **nao** reproduz compound Woo.

**Falhas → HTTP 422 `sales_tax_unavailable`** (`product_tax` **nao** e gravado):

| `data.reason` | Quando | Log Woo? |
|---|---|---|
| `missing_subtotal` | subtotal do plano <= 0 | nao |
| `missing_address` | `state` ou `postcode` vazios | nao |
| `wc_tax_missing` | classe `WC_Tax` nao carregada | nao |
| `empty_rates` | `find_rates` vazio | sim |
| `zero_percent` | soma dos `rate` <= 0 | sim |
| `zero_tax_amount` | valor calculado ainda <= 0 | sim |

Log (best-effort, source `hsr-sales-tax`):

```
US sales tax unavailable session={id} country={c} state={s} postal={p} reason={reason}
```

Falha de logger e engolida (`catch Throwable`).

Shape do `WP_Error`:

```json
{
  "code": "sales_tax_unavailable",
  "message": "Unable to calculate sales tax for this address",
  "data": {
    "status": 422,
    "country": "US",
    "state": "NY",
    "postal_code": "10001",
    "reason": "empty_rates"
  }
}
```

#### 3.2.2 Implicacao BR vs US

- **BR / qualquer nao-US / pais vazio:** nunca falha por tax. Grava `product_tax` 0 mesmo se houver ICMS futuro. Nao exige subtotal nem endereco.
- **US sem plano precificado:** `catalog_pricing.subtotal` 0 e cache `product_tax.subtotal` 0 → 422 `missing_subtotal`, a menos que automatic tax esteja ligado (ai tax 0 e o POST passa).
- **US sem zipcode na sessao e sem override:** `state`/`postcode` vazios → 422 `missing_address` (automatic tax off). Com automatic tax on, passa com `tax_jurisdiction` `""`.
- **US com override de address:** calcula com o override; **nao** atualiza `zipcode_json`. Checkout posterior chama `resolve_from_session($session)` **sem** override → usa o zipcode da sessao, nao o address do quote.

### 3.3 Relacao com Stripe (fora desta rota)

Esta rota **nao** cria Tax Rate nem Invoice Preview.

No checkout (outro request):

1. `CheckoutService` chama de novo `ProductTaxService::resolve_from_session($session)` (sem override).
2. Se US + automatic tax **off**, o percentual vai para `StripeTaxRateService::get_or_create_stripe_tax_rate` → `POST https://api.stripe.com/v1/tax_rates` (cache transient 7 dias, id `txr_...`) e e anexado nas subscription items.
3. Se automatic tax **on**, checkout usa `automatic_tax.enabled=true` e o numero desta rota e placeholder 0.

### 3.4 Tratamento de erro (resumo HTTP)

Formato WP REST: `{ "code", "message", "data": { "status": N, ... } }`.

Nao ha retry, timeout nem circuit breaker: nao ha HTTP de saida (exceto o proprio request REST).

---

## 4) Request / response

### 4.1 Headers

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/sales-tax/quote
Content-Type: application/json
X-Session-Token: {session_token}
```

`Authorization: Bearer {session_token}` tambem vale se `X-Session-Token` estiver vazio.

### 4.2 Sucesso BR (body vazio, tax 0)

Sessao com `zipcode.country = "BR"` e `catalog_pricing.subtotal = 189.9`.

Request:

```http
POST /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/sales-tax/quote
Content-Type: application/json
X-Session-Token: eyJzaWQiOiIzYWJmNGIyZC....hmac

{}
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "subtotal": 189.9,
    "product_tax": 0,
    "product_tax_percent": 0,
    "tax_jurisdiction": "",
    "country": "BR"
  }
}
```

JSON persistido em `plan_selection.product_tax` (nao volta no HTTP):

```json
{
  "subtotal": 189.9,
  "product_tax": 0,
  "product_tax_percent": 0,
  "tax_jurisdiction": "",
  "country": "BR",
  "quoted_at": "2026-08-17T22:40:00+00:00"
}
```

`subtotal` e o de **produto** (`catalog_pricing.subtotal`), nao inclui frete.

### 4.3 Sucesso US (Woo rates, automatic tax off)

Sessao com zipcode NY `10001`, `catalog_pricing.subtotal = 79`. Rate Woo 8.875%.

Request minimo (sem override; usa `session.zipcode`):

```http
POST /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/sales-tax/quote
Content-Type: application/json
X-Session-Token: eyJzaWQiOiIzYWJmNGIyZC....hmac

{}
```

Response `200` (exemplo NY ~8.875%):

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "subtotal": 79.0,
    "product_tax": 7.01,
    "product_tax_percent": 8.875,
    "tax_jurisdiction": "NY",
    "country": "US"
  }
}
```

`7.01` = `round(79 * 8.875 / 100, 2)`.

### 4.4 Sucesso US com override de address

Zipcode na sessao ainda e o antigo (ex.: CA). Front manda o endereco do form de checkout **antes** de `POST .../zipcode`.

Request:

```json
{
  "address": {
    "country": "US",
    "state": "NY",
    "postal_code": "10001",
    "city": "New York"
  }
}
```

`postcode` no lugar de `postal_code` e aceito.

Response `200`: mesmo shape da secao 4.3 (`tax_jurisdiction: "NY"`, `country: "US"`).

**Efeito colateral:** `zipcode_json` **nao** muda. `plan_selection.product_tax` fica com NY. Um checkout imediato **recalcula** a partir do zipcode CA da sessao — o resumo que o front mostrou pode nao ser o cobrado.

### 4.5 Sucesso US com `STRIPE_US_AUTOMATIC_TAX=true`

Mesmo request da 4.3. Woo **nao** e consultado.

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "subtotal": 79.0,
    "product_tax": 0,
    "product_tax_percent": 0,
    "tax_jurisdiction": "NY",
    "country": "US"
  }
}
```

Numero "de verdade" deveria vir de `POST .../subscription/preview` (Stripe Tax). Esta rota so deixa o placeholder 0 + jurisdicao.

### 4.6 Erros HTTP

| HTTP | `code` | Quando | Message (EN, dominio `headless-secure-registration`) |
|---|---|---|---|
| 401 | `session_unauthorized` | sem token | Session token is required. |
| 401 | `session_token_invalid` | assinatura/formato | Invalid session token. |
| 401 | `session_token_expired` | `exp` vencido | Session token expired. |
| 403 | `session_forbidden` | `session_id` vazio ou token de outra sessao | Session access denied. |
| 404 | `session_not_found` | sessao nao existe (SQL nem transient legado) | Onboarding session not found. |
| 422 | `sales_tax_unavailable` | Woo tax US falhou (ver `data.reason`) | Unable to calculate sales tax for this address |
| 429 | `rate_limit` | auth 300/300s | Too many requests. Please try again later. |

Exemplo 422 (US sem rates Woo; **nada** persistido):

```http
POST /wp-json/custom/v1/onboarding/session/abc123/sales-tax/quote
Content-Type: application/json
X-Session-Token: ...

{
  "address": {
    "country": "US",
    "state": "NY",
    "postal_code": "10001"
  }
}
```

```json
{
  "code": "sales_tax_unavailable",
  "message": "Unable to calculate sales tax for this address",
  "data": {
    "status": 422,
    "country": "US",
    "state": "NY",
    "postal_code": "10001",
    "reason": "empty_rates"
  }
}
```

Exemplo 422 (US sem plano / subtotal 0):

```json
{
  "code": "sales_tax_unavailable",
  "message": "Unable to calculate sales tax for this address",
  "data": {
    "status": 422,
    "country": "US",
    "state": "NY",
    "postal_code": "10001",
    "reason": "missing_subtotal"
  }
}
```

Exemplo 404:

```json
{
  "code": "session_not_found",
  "message": "Onboarding session not found.",
  "data": { "status": 404 }
}
```

Pais vazio / BR **nao** geram 422 desta rota.

---

## 5) Hooks e filters do WordPress

### 5.1 Especificos HSR (esta rota)

| Tipo | Hook | Onde | Efeito |
|---|---|---|---|
| action | `rest_api_init` | `Plugin::boot` | registra a rota |
| filter | `hsr/onboarding_rate_limit_max` | `consume_onboarding_limit` | altera max de **auth**. Args: `($maxAttempts, $scope)` com `$scope` = `auth` |
| filter | `hsr/onboarding_rate_limit_window` | idem | altera janela em segundos |
| filter | `hsr/onboarding_ttl` | `OnboardingRepository::ttl` | TTL do transient legado no `save` (env `HSR_ONBOARDING_TTL`, default 172800, minimo 1800) |
| filter | `rest_allowed_cors_headers` | `Plugin::allow_rest_cors_headers` | libera header `x-session-token` |

`hsr/onboarding_token_ttl` nao e lido aqui (so na emissao do token).  
Filters globais do `RateLimiter` (`hsr/rate_limit_max`, `hsr/rate_limit_window`) **nao** se aplicam: onboarding usa `consume_with_limits` com valores explicitos.

Nao ha `do_action` proprio do quote. Nenhum coupon, Stripe HTTP, meal-plan ou `hsr_checkout_*` entra neste caminho.

### 5.2 Core WP / Woo envolvidos

| Hook / API | Uso |
|---|---|
| REST API (`register_rest_route`, `permission_callback`) | roteamento e auth |
| `$wpdb->get` / `update` / `delete` / `insert` | persistencia da sessao e rewrite de pets |
| `get_transient` / `set_transient` | rate limit auth; cache legado `hsr_onb_*` |
| `sanitize_text_field` | path param e campos de address / zipcode |
| `__()` | mensagens i18n (`headless-secure-registration`) |
| `WC_Tax::find_rates` | so US + automatic tax off |
| filter `woocommerce_find_rates` | Woo, depois do match (cache inclusive) |
| filter `woocommerce_matched_tax_rates` | Woo, dentro de `get_matched_tax_rates` |
| filter `woocommerce_price_ex_tax_amount` | Woo, cada parcela exclusive (e compound) |
| filter `woocommerce_tax_round` | Woo, arredondamento interno (4 DP tipico) |
| `wp_cache_get` / `wp_cache_set` grupo `taxes` | cache de rates Woo; chave `wc_tax_rates_{md5(country+state+city+postcode+tax_class)}` |
| `wc_normalize_postcode` | strip espaco/hifen, uppercase |
| `wc_get_logger()` | warning `hsr-sales-tax` em `empty_rates` / `zero_percent` / `zero_tax_amount` |

Plugins de tax que hookam `woocommerce_find_rates` (ex.: WooCommerce Tax / TaxJar / Avalara) **alteram** o resultado desta rota no ramo US, mesmo sem o HSR chamar a API deles direto.

---

## 6) Dependencias e efeitos colaterais

### 6.1 O que e lido

- Path: `session_id`.
- Headers: `X-Session-Token` / `Authorization`.
- Body: `address` opcional (tabela 2.4).
- Banco: `{prefix}hsr_onboarding_sessions` (`SELECT *`). `get_from_sql` tambem carrega `{prefix}hsr_onboarding_pets` (nao usados na logica, mas regravados no save).
- `plan_selection_json` (`catalog_pricing.subtotal`, `product_tax` cache).
- `zipcode_json` (country/state/city/postal).
- `session.country` (fallback de pais se zipcode.country vazio).
- Transient legado: `hsr_onb_{sessionId}` se a linha SQL nao existir (lazy migrate via `save` no `get`).
- Env/constante `STRIPE_US_AUTOMATIC_TAX`.
- Tabelas de tax Woo + object cache (ramo US).

### 6.2 O que e gravado

| Recurso | Gravado? | Detalhe |
|---|---|---|
| `plan_selection.product_tax` | **sim** | overwrite; `quoted_at` novo |
| `plan_selection.shipping` | **nao** | |
| demais chaves de `plan_selection` | preservadas | flavors, catalog_pricing, discount, shipping, etc. |
| `zipcode_json` | **nao** | override de address e so in-memory |
| colunas `country` / `state` da sessao | **nao** | |
| `updated_at` SQL | **sim** | via `save` |
| tabela de pets | **sim, rewrite** | `replace_pets` em todo save |
| transient `hsr_onb_{sessionId}` | **sim** | compat legado |
| transient rate limit | **sim** | so `onboarding_auth` |
| pedido Woo / Stripe / user meta | **nao neste request** | so depois, no checkout |

Chave de rate limit:

```
hsr_rl_{md5('onboarding_auth|{sessionId}')}
```

Payload: `{ "count": N }`, TTL = janela (minimo 60 s). Token invalido ainda consome o bucket (permission_callback).

`save()` retorna `bool`; o servico **ignora**. 200 nao garante que o JSON foi persistido.

### 6.3 Consumidores posteriores (efeito diferido)

Nao rodam neste POST, mas **dependem** do JSON gravado (e/ou recalculam):

| Consumidor | Uso |
|---|---|
| `CheckoutService` precheck (`resolve_from_session` sem override) | 422 `sales_tax_unavailable` aborta o checkout US se Woo falhar de novo |
| `CheckoutService` Stripe subscription payload | `product_tax`, `product_tax_percent`, `tax_jurisdiction`, `tax_country` |
| `CheckoutService::persist_shipping_projection_meta` | metas `_hsr_product_tax`, `_hsr_product_tax_percent`, `_hsr_tax_jurisdiction`, `_hsr_tax_country`, `_hsr_product_subtotal` (re-resolve; fallback no cache da sessao) |
| `StripeTaxRateService::get_or_create_stripe_tax_rate` | cria/cached `txr_` a partir de state + percent (Phase 1, automatic tax off) |
| `OnboardingApi::present_session` | `plan_selection.product_tax` no GET da sessao (nao ha top-level `product_tax`) |
| `POST .../shipping/quote` e `.../shipping/select` | tambem gravam o mesmo objeto `product_tax` (podem sobrescrever o desta rota) |

Checkout **nao** confia cegamente no cache: recalcula. O cache serve o front (GET sessao / resposta desta rota) e como fallback se o re-resolve falhar so no persist de meta.

### 6.4 Sem efeitos em

- cotacao HTTP (ViaCEP / OSRM / Nominatim / Zippopotam)
- Stripe (nem Tax Rate, nem Invoice preview, nem PaymentIntent)
- `zipcode_json` / colunas `country`/`state`
- `plan_selection.shipping`
- usuario WP / user meta
- catalogo `custom-meal-plan-builder` (so le o snapshot ja gravado)
- carrinho Woo (`WC()->cart`)
- `WC_Order` / subscription Flexible

---

## 7) Pontos de atencao para reimplementacao em Node

1. **Nao e Stripe Tax.** Copiar esta rota como `invoices.createPreview` muda o contrato (Phase 1 = tabelas Woo). Com `STRIPE_US_AUTOMATIC_TAX` off, o numero tem que sair das mesmas rates (ou de uma tabela portada). Com a flag on, devolver 0 + `tax_jurisdiction=state` e deixar o preview Stripe na rota irma.

2. **Flag `STRIPE_US_AUTOMATIC_TAX`.** Valores truthy: `1`, `true`, `yes`, `on` (case-insensitive). Default no `.env.example` e `0`. Node precisa da mesma flag que o checkout, senao o resumo (Woo) e a cobranca (Stripe Tax ou `tax_rates`) divergem.

3. **BR nunca bloqueia.** `product_tax` 0 e HTTP 200 mesmo sem subtotal/endereco. Nao "consertar" aplicando ICMS aqui sem o front.

4. **Pais vazio = nao-US.** Quote sem zipcode e sem `session.country` grava tax 0. Diferente de `shipping/quote` (exige endereco) e de `subscription/preview` (400 `preview_us_only`).

5. **Override de address nao persiste o endereco.** Front pode mostrar tax de NY e a sessao continuar em CA. Checkout re-resolve **sem** override. No Node, ou copiar (e o front deve `POST .../zipcode` antes do charge), ou gravar o address usado no snapshot (`product_tax.quoted_address`) e recusar checkout se zipcode divergir — o segundo e correcao.

6. **String vazia no override zera campo.** `{ "address": { "state": "" } }` dispara merge e apaga `state` da sessao **so no calculo**. `{ "address": {} }` nao mergeia. Replicar `??` (nullish), nao `||`.

7. **Alias `postcode` / `postal_code`.** Os dois preenchem `postal_code` e `zipcode` no merge. `line1` e ignorado aqui; em `subscription/preview` e usado. Nao unificar os payloads sem olhar o front.

8. **Subtotal US obrigatorio no ramo Woo.** Sem `catalog_pricing.subtotal` (e sem cache), 422 `missing_subtotal`. Ordem real do funil: plan-selection **antes** desta rota para US. Fallback do cache e o `product_tax.subtotal` anterior — um quote BR (0) seguido de mudanca para US pode herdar subtotal 0 e falhar, ou herdar um subtotal velho.

9. **`tax_class` sempre default.** Produtos reduced-rate/zero-rate no Woo sao ignorados. Portar "por SKU" seria comportamento novo.

10. **Precos exclusive.** Nao usar formula inclusive (`price - price/(1+r)`). Compound Woo e sequencial sobre `price + taxes anteriores`; o fallback HSR (`subtotal * sum(rate)/100`) e linear. Replicar os dois passos para nao divergir em centavos.

11. **Um rate por priority.** Woo descarta o segundo rate com a mesma `tax_rate_priority`. Somar todos os rows da tabela sem esse filtro infla o percentual.

12. **Match de postcode/city.** Portar `wc_normalize_postcode` (strip `[\s-]`), wildcards/ranges Woo (`wc_get_wildcard_postcodes`, `location_code LIKE '%...%'`) e city uppercase exact. ZIP+4 `10001-1234` vira `100011234`.

13. **Plugins Woo de tax.** Qualquer `woocommerce_find_rates` no WP altera o numero. No Node nao ha esses hooks — ou replica as tabelas manuais, ou declara que TaxJar/Avalara deixam de valer.

14. **422 nao grava.** US sem rates deixa o `product_tax` anterior intacto. Front que trata 422 como "imposto 0" esta errado; o GET da sessao ainda mostra o snapshot velho.

15. **Save ignora falha de DB + rewrite de pets.** 200 com persistencia falha e rewrite de pets num UPDATE de plan_selection. No Node: transacao, 500 se persistir falhar, e **nao** reescrever pets.

16. **`quoted_at` so na sessao.** Response HTTP nao inclui. GET da sessao expoe via `plan_selection.product_tax`. Nao omitir no JSON persistido: consumidores podem usar para TTL.

17. **Resposta e subset.** Incluir `country` (select de shipping **nao** inclui). Nao devolver a sessao crua. Nao devolver `shipping`.

18. **Overwrite de `product_tax`.** `shipping/quote` e `shipping/select` gravam o mesmo objeto. A ultima rota a gravar vence. Nao ha `source` (`woo` vs `stripe`). Com automatic tax on, esta rota persiste 0 e pode apagar um percentual Woo anterior.

19. **Nao invalidar no `POST .../zipcode`.** Trocar CEP deixa este snapshot velho ate o proximo quote/select. Copiar o bug ou invalidar `product_tax` ao mudar postcode (correcao; ver doc de zipcode).

20. **Sem rate limit proprio.** So auth 300/300s. Woo e barato; se o Node chamar um provider (TaxJar/Stripe Tax) por request, um limite de write e necessario — comportamento **novo**.

21. **i18n.** Messages em ingles via `__()`. Front deve casar em `code` e `data.reason`, nao em `message`.

22. **Sanitize.** `sanitize_text_field` em country/state/postcode/city (strip tags, trim). State comparado em uppercase. `USA` nao e `US`.

23. **Migracao legado.** `repository->get` ainda promove transient `hsr_onb_*` para SQL. No Node, se a sessao ja estiver em Postgres, ignore esse ramo.

24. **Contrato sugerido na migracao.** A lista `08-endpoints-rest-sugeridos.md` **nao** inclui esta rota (vai de `shipping/select` para `recommendation`). Sugestao alinhada as irmas: `POST /api/v1/onboarding/sessions/:sessionId/sales-tax/quote`. Manter o mesmo `data` (`session_id`, `subtotal`, `product_tax`, `product_tax_percent`, `tax_jurisdiction`, `country`) para o front.

25. **Testes ausentes.** Vale cobrir: BR tax 0 sem body; pais vazio tax 0; US Woo sucesso; US 422 `empty_rates` nao persiste; US 422 `missing_subtotal`; US 422 `missing_address`; US automatic tax 0 + jurisdiction; override `postal_code` vs `postcode`; override `state: ""` zera; override nao grava zipcode; `country` no response; segundo POST overwrite; save falho ainda 200 (PHP) vs 500 (Node desejavel).

---

## 8) Relacao com zipcode, shipping, preview e checkout

Fluxo feliz (Phase 1, automatic tax off):

```
1. POST .../plan-selection           → grava catalog_pricing.subtotal
2. POST .../zipcode                  → grava endereco (nao mexe em tax)
3. POST .../shipping/quote           → lista rates e ja grava product_tax
4. POST .../shipping/select          → persiste rate + regrava product_tax
5. POST .../sales-tax/quote          → opcional; so tax, sem mexer em shipping   ← esta rota
6. POST .../account-link
7. POST .../subscription/checkout    → re-resolve tax; cria txr_ Stripe; metas _hsr_product_tax*
```

Fluxo Phase 2 (automatic tax on):

```
3'/5'. POST .../sales-tax/quote      → product_tax 0, jurisdiction=state (placeholder)
5''. POST .../subscription/preview   → numero Stripe Tax (nao persiste)
7'.  checkout com automatic_tax.enabled
```

Esta rota e opcional se o front ja passou por `shipping/quote` ou `shipping/select` (ambos gravam o mesmo snapshot). Serve quando o resumo de checkout precisa de tax **antes** ou **sem** escolher frete, ou quando o usuario mudou o address no form e o front quer recotar so o imposto.
