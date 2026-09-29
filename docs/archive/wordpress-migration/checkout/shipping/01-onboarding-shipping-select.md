# POST `/onboarding/session/{session_id}/shipping/select`

Documentacao da logica **atual** da selecao de frete no onboarding.

Escopo: persistir na sessao a opcao de frete escolhida pelo front (snapshot confiado no payload) e, no mesmo request, recalcular sales tax de produto (`plan_selection.product_tax`). A rota **nao cotiza** frete e **nao chama** provedor externo de shipping.

Plugin: `headless-secure-registration`.

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-product-tax-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-rate-limiter.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`
- consumidores posteriores: `src/class-checkout-service.php` (`apply_selected_shipping`, `persist_shipping_projection_meta`)
- caller interno de teste: `wp/wp-content/plugins/hsr-flexible-subscriptions-bridge/src/class-test-subscription-bridge-api.php`

Nao ha teste unitario desta rota. Shape de rate esperado pelo front vem de `GetFixedShippingQuote` (BR/US) ou de `WC_Shipping_Rate` (fallback Woo, paises != BR/US).

Namespace REST: `custom/v1`  
Base: `{WP_URL}/wp-json`

---

## 1) Identidade da rota

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/shipping/select
```

| Item | Valor |
|---|---|
| Namespace WP | `custom/v1` |
| Metodo | `POST` (`WP_REST_Server::CREATABLE`) |
| Path param | `session_id` — regex `[A-Za-z0-9_-]+` |
| Permission | `OnboardingApi::require_valid_session_access` |
| Handler | `OnboardingApi::select_shipping` |
| Servico | `OnboardingService::select_shipping` |
| Tax (efeito colateral) | `ProductTaxService::resolve_from_session` |
| Validator | nenhum (`RequestValidator` nao e usado) |
| Rate limit proprio | nenhum (so o de auth no permission_callback) |
| Registro | `add_action('rest_api_init', [OnboardingApi, 'register_routes'])` |

Objetivo: gravar `plan_selection.shipping` com o rate que o front escolheu (normalmente eco da resposta de `POST .../shipping/quote`) e atualizar `plan_selection.product_tax` para o resumo de checkout.

Nao confundir com:

- `POST .../shipping/quote` — **cotiza** (BR: distancia/OSRM/ViaCEP; US: tarifa fixa; fallback: zonas Woo). Nao grava a selecao.
- `POST .../sales-tax/quote` — so tax, sem persistir shipping.
- `POST .../zipcode` — grava endereco; **nao** invalida shipping antigo.
- Woo Store API `CartSelectShippingRate` — outro stack, cart Woo, nao sessao HSR.

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

    Front->>WP: POST .../shipping/select + X-Session-Token
    Note over WP: permission_callback
    WP->>RL: consume onboarding_auth (300 / 300s)
    alt estouro auth
        WP-->>Front: 429 rate_limit
    end
    WP->>Tok: validate(token, session_id)
    alt token invalido/expirado
        WP-->>Front: 401/403
    end

    Note over WP: callback select_shipping
    WP->>Svc: select_shipping(sessionId, payload)
    Svc->>Repo: get(sessionId)
    alt sessao inexistente
        Svc-->>Front: 404 session_not_found
    end

    Note over Svc: sanitiza payload; exige rate_id OU method_id
    alt ambos vazios
        Svc-->>Front: 422 invalid_shipping
    end

    Svc->>Tax: resolve_from_session(session original)
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

    Svc->>Repo: save(plan_selection.shipping + product_tax)
    Repo->>SQL: UPDATE plan_selection_json + updated_at
    Repo->>SQL: DELETE+INSERT pets (efeito colateral)
    Repo->>Tr: set_transient hsr_onb_{sessionId}
    Svc-->>Front: 200 { success:true, data:{ session_id, shipping, subtotal, product_tax, ... } }
```

### 2.1 Camada REST (`OnboardingApi::select_shipping`)

1. Sanitiza `session_id` com `sanitize_text_field`.
2. Extrai body via `extract_payload`:
   - `get_json_params()` se array nao vazio;
   - senao `get_body_params()` (form-urlencoded).
   - `{}` vazio cai no form body (em PHP `empty([])` e true).
3. Chama `OnboardingService::select_shipping`.
4. Se `WP_Error` → devolve o erro (404/422, e 401/403/429 so no permission).
5. Senao → HTTP `200` com envelope `{ success: true, data: <resultado> }`.

O `data` **nao** e a sessao completa (diferente de `POST .../zipcode`). E um subset: `session_id`, `shipping`, totais de product tax.

Nao ha rate limit especifico de select. So o bucket `onboarding_auth` do permission_callback.

Nao ha validacao de schema REST (`args` / `RequestValidator`). Campos extras no JSON sao ignorados.

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

### 2.3 Validacoes de negocio (`OnboardingService::select_shipping`)

Sessao precisa existir (`repository->get`). Sem sessao → `WP_Error` HTTP `404` (`session_not_found`).

Pipeline, nesta ordem. Falha daqui e HTTP 4xx com `WP_Error` (nao envelope `success: true`).

| # | Regra | HTTP | `code` |
|---|---|---|---|
| 1 | Sessao inexistente | 404 | `session_not_found` |
| 2 | `rate_id` e `method_id` ambos vazios apos sanitize | 422 | `invalid_shipping` |
| 3 | Product tax US indisponivel (ver secao 3) | 422 | `sales_tax_unavailable` |

**Nao valida:**

- se `POST .../shipping/quote` foi chamado antes;
- se `rate_id` / `method_id` / `cost` batem com uma cotacao anterior;
- se `zipcode` existe na sessao (quote exige; select nao);
- se `cost` / `total` sao coerentes (`total` default = `cost + tax_total`);
- se o pais e BR/US;
- se `label` e nao-vazio;
- se o CEP do payload bate com `session.zipcode`;
- valores negativos (viram `0` via `max(0, ...)`).

Contrato efetivo: **trust-the-client**. O front manda o rate (eco do quote) e o backend persiste o snapshot. Checkout depois aplica `cost`/`tax_total`/`label` no pedido Woo sem recotar.

### 2.4 Normalizacao do payload

Todos os strings passam por `sanitize_text_field`. Numericos: `max(0, (float|int) ...)`.

| Campo no body | Tipo gravado | Default se ausente |
|---|---|---|
| `rate_id` | string | `""` |
| `method_id` | string | `""` |
| `label` | string | `""` |
| `cost` | float >= 0 | `0` |
| `tax_total` | float >= 0 | `0` |
| `total` | float >= 0 | `cost + tax_total` |
| `instance_id` | int >= 0 | `0` |
| `transit_business_days` | int >= 0 | `payload.delivery_days` ou `0` |
| `delivery_days` | (alias de entrada) | usado so se `transit_business_days` ausente |
| `distance` | float >= 0 ou `null` | `null` se a chave nao existir |
| `distance_source` | string | `""` |
| `per_km` | float >= 0 ou `null` | `null` se a chave nao existir |
| `quoted_at` | string ISO | agora (`gmdate('c')`) se vazio |
| `zipcode` | string | `session.zipcode.postal_code` ou `session.zipcode.zipcode` ou `""` |

Dias uteis derivados do `label` (`extract_business_days_range_from_label`):

1. Lowercase + trim.
2. Se o texto **nao** contem nenhum de: `business`, `working`, `uteis`, `úteis`, `dias` → `{ min: 0, max: 0 }`.
3. Senao extrai todos os `\d+`; `min` = menor, `max` = maior.

Depois:

- se `transit_business_days <= 0`, vira `deliveryDaysRange.max`;
- `delivery_days` gravado = `transit_business_days` (mesmo valor, duplicado);
- `delivery_days_min` = range.min, ou `transit_business_days` se range.min=0 e transit > 0;
- `delivery_days_max` = range.max, ou `transit_business_days` se range.max=0;
- `estimate_label` = `label` (copia).

Exemplos:

| `label` | range | efeito |
|---|---|---|
| `FedEx 3–5 business days` | min=3, max=5 | US quote padrao |
| `Entrega Eden Bowl · 2 dias úteis` | min=2, max=2 | BR quote com 2 dias |
| `Jadlog .Com (Melhor Envio) (4 a 5 dias uteis)` | min=4, max=5 | default do bridge de teste |
| `Sedex` (sem keyword) | 0, 0 | so usa `transit_business_days` do payload |

Campos extras do quote BR (`carrier`, `delivery`, `currency`, `breakdown`) **nao** sao copiados para a selecao. Se o front quiser `per_km`, precisa mandar no top-level (`breakdown.per_km` do quote nao e lido).

Objeto gravado em `plan_selection.shipping`:

```json
{
  "rate_id": "distance_km:br-default",
  "method_id": "distance_km",
  "instance_id": 0,
  "label": "Entrega Eden Bowl · 2 dias úteis",
  "cost": 18.5,
  "tax_total": 0,
  "total": 18.5,
  "transit_business_days": 2,
  "delivery_days": 2,
  "delivery_days_min": 2,
  "delivery_days_max": 2,
  "estimate_label": "Entrega Eden Bowl · 2 dias úteis",
  "selected_at": "2026-08-17T22:40:00+00:00",
  "quoted_at": "2026-08-17T22:39:50+00:00",
  "distance": 42.3,
  "distance_source": "osrm",
  "per_km": 0.95,
  "zipcode": "01310100",
  "snapshot": true
}
```

`selected_at` e sempre agora (UTC ISO 8601). `snapshot: true` e constante.

`plan_selection` existente e preservado (flavors, catalog_pricing, discount, etc.). So as chaves `shipping` e `product_tax` sao substituidas.

### 2.5 Recalculo de product tax (antes do save)

Depois de montar `$selection` em memoria, o servico chama:

```
ProductTaxService::resolve_from_session($session)
```

sobre a **sessao original** (sem o shipping novo). Tax de produto nao inclui `cost` de frete. `tax_total` do shipping e o valor que o cliente mandou; nao e recalculado.

Se `resolve_from_session` devolve `WP_Error`, o handler retorna **sem** `repository->save`. Frete escolhido **nao** fica na sessao.

Se ok, grava:

```php
$planSelection['product_tax'] = [
  'subtotal' => ...,
  'product_tax' => ...,
  'product_tax_percent' => ...,
  'tax_jurisdiction' => ...,
  'country' => ...,
  'quoted_at' => gmdate('c'),
];
```

Subtotal lido de `plan_selection.catalog_pricing.subtotal`; fallback: `plan_selection.product_tax.subtotal` ja cacheado. Nao consulta catalogo nem Stripe.

### 2.6 Persistencia

`OnboardingRepository::save($session)`:

1. Forca `updated_at = gmdate('c')` na copia interna (o array do caller **nao** e atualizado; o response de select nao inclui `updated_at`).
2. `UPDATE` em `{prefix}hsr_onboarding_sessions` (ou `INSERT` se so existia transient legado).
3. `replace_pets`: `DELETE` + `INSERT` de **todos** os pets da sessao. Efeito colateral de todo `save`, inclusive este.
4. Regrava transient `hsr_onb_{sessionId}` (TTL `hsr/onboarding_ttl`, default 172800 s, minimo 1800).

`save()` devolve `bool`, mas `select_shipping` **ignora** o retorno. Falha de DB ainda assim responde HTTP 200 com o snapshot em memoria.

`GET .../session/{id}` expoe o shipping duas vezes: `data.shipping` (top-level, via `present_session`) e `data.plan_selection.shipping`.

---

## 3) Chamadas a backend / servicos externos

**Esta rota nao faz HTTP para um backend PawBowl, nem para ViaCEP, OSRM, Nominatim, Zippopotam ou Stripe.**

Cotacao (ViaCEP/OSRM/Nominatim no BR; tarifa fixa no US) e a rota irma `POST .../shipping/quote`. Select so persiste o que o front reenvia.

O unico servico tocado alem do repositorio e `ProductTaxService`, local.

### 3.1 Nenhum endpoint PawBowl

Nao ha client HTTP proprio. Nao ha URL `PAWBOWL_*` / meal-plan / nutrition neste caminho.

### 3.2 `ProductTaxService` (in-process)

Resolucao de pais: `zipcode.country ?? session.country`, uppercase via `sanitize_text_field`. Select **nao** recebe override de address (diferente de `get_sales_tax_quote`).

| Condicao | Comportamento | HTTP externo |
|---|---|---|
| `country !== 'US'` (inclui BR, `""`, `CA`) | `product_tax = 0`, `product_tax_percent = 0`, `tax_jurisdiction = ""` | nenhum |
| `country === 'US'` **e** `STRIPE_US_AUTOMATIC_TAX` em `{1,true,yes,on}` (env ou constante PHP) | tax 0; `tax_jurisdiction = state`; Stripe Tax fica para preview/charge (Phase 2) | nenhum |
| `country === 'US'` e automatic tax off | `WC_Tax::find_rates` + `WC_Tax::calc_exclusive_tax` | nenhum (tabelas Woo + object cache) |

Env: `STRIPE_US_AUTOMATIC_TAX`. Nao aparece no `.env` do repo por padrao; se vazio, o ramo Woo e o usado para US.

#### 3.2.1 WooCommerce Tax (so US, automatic tax off)

Nao e um REST remoto. `WC_Tax::find_rates` le `wp_woocommerce_tax_rates` (+ locations), com cache `wp_cache` grupo `taxes`.

**Entrada interna (nao e JSON de request):**

```php
WC_Tax::find_rates([
  'country'  => 'US',
  'state'    => $state,      // zipcode.state
  'postcode' => $postcode,   // zipcode.postal_code ?? zipcode.zipcode
  'city'     => $city,
]);
```

`tax_class` nao e passado → classe padrao.

**Resposta esperada:** mapa de rates Woo, cada um com `rate` (percentual). O servico soma os percentuais (`product_tax_percent`, 4 casas) e calcula valor exclusivo sobre o subtotal (`product_tax`, 2 casas). Se o calc der 0 mas o percentual > 0, deriva `subtotal * percent / 100`.

**Falhas → HTTP 422 `sales_tax_unavailable`** (shipping **nao** e gravado):

| `data.reason` | Quando |
|---|---|
| `missing_subtotal` | subtotal do plano <= 0 |
| `missing_address` | `state` ou `postcode` vazios |
| `wc_tax_missing` | classe `WC_Tax` nao carregada |
| `empty_rates` | `find_rates` vazio |
| `zero_percent` | soma dos `rate` <= 0 |
| `zero_tax_amount` | valor calculado ainda <= 0 |

Log Woo (best-effort, source `hsr-sales-tax`) nos reasons `empty_rates` / `zero_percent` / `zero_tax_amount`. Falha de logger e engolida.

#### 3.2.2 Implicacao BR vs US no select

- **BR:** select nunca falha por tax. `product_tax` gravado fica 0 mesmo se houver ICMS futuro.
- **US sem plano precificado:** `catalog_pricing.subtotal` 0 → 422 `missing_subtotal`, a menos que automatic tax esteja ligado (ai tax 0 e o select passa).
- **US sem zipcode na sessao:** `state`/`postcode` vazios → 422 `missing_address` (automatic tax off). Com automatic tax on, passa com jurisdiction `""`.
- **Pais vazio:** tratado como nao-US → tax 0, select **passa** mesmo sem endereco.

### 3.3 Relacao com o quote (o front ecoa estes rates)

Select nao chama quote, mas o payload esperado e o objeto de `data.rates[]` (mais opcionais).

**US (`GetFixedShippingQuote::forUs`), defaults de settings:**

```json
{
  "rate_id": "fixed_us:default",
  "method_id": "fixed_us",
  "instance_id": 0,
  "label": "FedEx 3–5 business days",
  "cost": 12.9,
  "tax_total": 0,
  "total": 12.9,
  "carrier": "FedEx",
  "delivery": "3–5 business days",
  "currency": "USD"
}
```

**BR (`fromBrDistanceQuote`):**

```json
{
  "rate_id": "distance_km:br-default",
  "method_id": "distance_km",
  "instance_id": 0,
  "label": "Entrega Eden Bowl · 2 dias úteis",
  "cost": 18.5,
  "tax_total": 0,
  "total": 18.5,
  "distance": 42.3,
  "distance_source": "osrm",
  "delivery_days": 2,
  "quoted_at": "2026-08-17T22:39:50+00:00",
  "breakdown": { "per_km": 0.95, "distance_km": 42.3 },
  "currency": "BRL"
}
```

O front tipicamente reenvia o rate inteiro. `carrier` / `currency` / `breakdown` / `delivery` sao ignorados no select. `delivery_days` e lido. `per_km` so se vier no top-level.

### 3.4 Tratamento de erro (resumo HTTP)

Formato WP REST: `{ "code", "message", "data": { "status": N, ... } }`.

Nao ha retry, timeout nem circuit breaker: nao ha HTTP de saida.

---

## 4) Request / response

### 4.1 Headers

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/shipping/select
Content-Type: application/json
X-Session-Token: {session_token}
```

`Authorization: Bearer {session_token}` tambem vale se `X-Session-Token` estiver vazio.

### 4.2 Sucesso BR (distancia)

Request:

```http
POST /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/shipping/select
Content-Type: application/json
X-Session-Token: eyJzaWQiOiIzYWJmNGIyZC....hmac

{
  "rate_id": "distance_km:br-default",
  "method_id": "distance_km",
  "instance_id": 0,
  "label": "Entrega Eden Bowl · 2 dias úteis",
  "cost": 18.5,
  "tax_total": 0,
  "total": 18.5,
  "delivery_days": 2,
  "quoted_at": "2026-08-17T22:39:50+00:00",
  "distance": 42.3,
  "distance_source": "osrm",
  "per_km": 0.95,
  "zipcode": "01310100"
}
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "shipping": {
      "rate_id": "distance_km:br-default",
      "method_id": "distance_km",
      "instance_id": 0,
      "label": "Entrega Eden Bowl · 2 dias úteis",
      "cost": 18.5,
      "tax_total": 0,
      "total": 18.5,
      "transit_business_days": 2,
      "delivery_days": 2,
      "delivery_days_min": 2,
      "delivery_days_max": 2,
      "estimate_label": "Entrega Eden Bowl · 2 dias úteis",
      "selected_at": "2026-08-17T22:40:00+00:00",
      "quoted_at": "2026-08-17T22:39:50+00:00",
      "distance": 42.3,
      "distance_source": "osrm",
      "per_km": 0.95,
      "zipcode": "01310100",
      "snapshot": true
    },
    "subtotal": 189.9,
    "product_tax": 0,
    "product_tax_percent": 0,
    "tax_jurisdiction": ""
  }
}
```

`subtotal` no response e o de **produto** (`catalog_pricing.subtotal`), nao `shipping.total`. Frete nao entra nessa soma.

### 4.3 Sucesso US (tarifa fixa, automatic tax off, Woo com rate)

Request minimo (so o que o servico exige + eco do quote):

```json
{
  "rate_id": "fixed_us:default",
  "method_id": "fixed_us",
  "label": "FedEx 3–5 business days",
  "cost": 12.9,
  "tax_total": 0,
  "quoted_at": "2026-08-17T22:39:50+00:00"
}
```

`zipcode` omitido → usa `session.zipcode.postal_code`. Label com `business` extrai min=3, max=5 mesmo sem `delivery_days`.

Response `200` (exemplo NY ~8.875%):

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "shipping": {
      "rate_id": "fixed_us:default",
      "method_id": "fixed_us",
      "instance_id": 0,
      "label": "FedEx 3–5 business days",
      "cost": 12.9,
      "tax_total": 0,
      "total": 12.9,
      "transit_business_days": 5,
      "delivery_days": 5,
      "delivery_days_min": 3,
      "delivery_days_max": 5,
      "estimate_label": "FedEx 3–5 business days",
      "selected_at": "2026-08-17T22:40:00+00:00",
      "quoted_at": "2026-08-17T22:39:50+00:00",
      "distance": null,
      "distance_source": "",
      "per_km": null,
      "zipcode": "10001",
      "snapshot": true
    },
    "subtotal": 79.0,
    "product_tax": 7.01,
    "product_tax_percent": 8.875,
    "tax_jurisdiction": "NY"
  }
}
```

`distance` / `per_km` viram `null` (JSON) quando a chave nao veio no body — `isset` e false. Diferente de `0`.

Com `STRIPE_US_AUTOMATIC_TAX=true`, o mesmo request devolve `product_tax: 0`, `product_tax_percent: 0`, `tax_jurisdiction: "NY"`.

### 4.4 Erros HTTP

| HTTP | `code` | Quando | Message (EN, dominio `headless-secure-registration`) |
|---|---|---|---|
| 401 | `session_unauthorized` | sem token | Session token is required. |
| 401 | `session_token_invalid` | assinatura/formato | Invalid session token. |
| 401 | `session_token_expired` | `exp` vencido | Session token expired. |
| 403 | `session_forbidden` | `session_id` vazio ou token de outra sessao | Session access denied. |
| 404 | `session_not_found` | sessao nao existe (SQL nem transient legado) | Onboarding session not found. |
| 422 | `invalid_shipping` | `rate_id` e `method_id` vazios | rate_id or method_id is required to select shipping. |
| 422 | `sales_tax_unavailable` | Woo tax US falhou (ver reasons) | Unable to calculate sales tax for this address |
| 429 | `rate_limit` | auth 300/300s | Too many requests. Please try again later. |

Exemplo 422 (payload sem identificador de rate):

```http
POST /wp-json/custom/v1/onboarding/session/abc123/shipping/select
Content-Type: application/json
X-Session-Token: ...

{
  "label": "FedEx",
  "cost": 12.9
}
```

```json
{
  "code": "invalid_shipping",
  "message": "rate_id or method_id is required to select shipping.",
  "data": { "status": 422 }
}
```

Exemplo 422 (US sem rates Woo; shipping **nao** persistido):

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

Exemplo 404:

```json
{
  "code": "session_not_found",
  "message": "Onboarding session not found.",
  "data": { "status": 404 }
}
```

`rate_id` sozinho (sem `method_id`) e valido. `method_id` sozinho (sem `rate_id`) tambem. Um dos dois basta.

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

Nao ha `do_action` proprio do select. Nenhum coupon, Stripe HTTP, meal-plan ou `hsr_checkout_*` entra neste caminho.

### 5.2 Core WP / Woo envolvidos

| Hook / API | Uso |
|---|---|
| REST API (`register_rest_route`, `permission_callback`) | roteamento e auth |
| `$wpdb->get` / `update` / `delete` / `insert` | persistencia da sessao e rewrite de pets |
| `get_transient` / `set_transient` | rate limit auth; cache legado `hsr_onb_*` |
| `sanitize_text_field` | path param e campos string do payload |
| `__()` | mensagens i18n (`headless-secure-registration`) |
| `WC_Tax::find_rates` | so US + automatic tax off |
| filter `woocommerce_find_rates` | Woo, depois do match de rates |
| filter `woocommerce_matched_tax_rates` | Woo, dentro do match |
| `wp_cache_get` / `wp_cache_set` grupo `taxes` | cache de rates Woo |
| `wc_get_logger()` | warning `hsr-sales-tax` em alguns reasons |

Plugins de tax que hookam `woocommerce_find_rates` (ex.: WooCommerce Tax / TaxJar) **alteram** o resultado desta rota no ramo US, mesmo sem o HSR chamar a API deles direto.

---

## 6) Dependencias e efeitos colaterais

### 6.1 O que e lido

- Path: `session_id`.
- Headers: `X-Session-Token` / `Authorization`.
- Body: tabela da secao 2.4.
- Banco: `{prefix}hsr_onboarding_sessions` (`SELECT *`). `get_from_sql` tambem carrega `{prefix}hsr_onboarding_pets` (nao usados na logica, mas regravados no save).
- `plan_selection_json` (catalog_pricing.subtotal, product_tax cache, shipping anterior).
- `zipcode_json` (country/state/city/postal para tax e snapshot de CEP).
- `session.country` (fallback de pais se zipcode.country vazio).
- Transient legado: `hsr_onb_{sessionId}` se a linha SQL nao existir (lazy migrate via `save` no `get`).
- Env/constante `STRIPE_US_AUTOMATIC_TAX`.
- Tabelas de tax Woo + object cache (ramo US).

### 6.2 O que e gravado

| Recurso | Gravado? | Detalhe |
|---|---|---|
| `plan_selection.shipping` | **sim** | overwrite do objeto inteiro |
| `plan_selection.product_tax` | **sim** | overwrite; `quoted_at` novo |
| demais chaves de `plan_selection` | preservadas | flavors, catalog_pricing, discount, etc. |
| `zipcode_json` | **nao** | |
| colunas `country` / `state` da sessao | **nao** | |
| `updated_at` SQL | **sim** | via `save` |
| tabela de pets | **sim, rewrite** | `replace_pets` em todo save |
| transient `hsr_onb_{sessionId}` | **sim** | compat legado |
| transient rate limit | **sim** | so `onboarding_auth` |
| pedido Woo / Stripe / user meta | **nao neste request** | so depois, no checkout / account-link |

Chave de rate limit:

```
hsr_rl_{md5('onboarding_auth|{sessionId}')}
```

Payload: `{ "count": N }`, TTL = janela (minimo 60 s). Token invalido ainda consome o bucket (permission_callback).

### 6.3 Consumidores posteriores (efeito diferido)

Nao rodam no select, mas **dependem** do JSON gravado:

| Consumidor | Uso de `plan_selection.shipping` |
|---|---|
| `CheckoutService::apply_selected_shipping` | cria `WC_Order_Item_Shipping` com `label`, `method_id`, `instance_id`, `cost`, `tax_total` |
| `CheckoutService::persist_shipping_projection_meta` | metas `_hsr_shipping_*` no pedido (dias, rate_id, cost, tax, currency) |
| `CheckoutService::propagate_shipping_projection_meta_to_subscription` | copia as metas para a subscription Flexible |
| `OnboardingService` no account-link | user meta `hsr_shipping_preference` (`rate_id`, `method_id`, `instance_id`, `label`, `delivery_days_min/max`) |
| `OnboardingApi::present_session` | `data.shipping` no GET da sessao |
| `HSRBridge\TestSubscriptionBridgeApi` | chama `select_shipping` direto (nao via REST) no seed de checkout de teste |

Defaults no checkout se campos vazios: label `Custom Shipping`, method_id `custom_shipping`.

### 6.4 Sem efeitos em

- cotacao HTTP (ViaCEP / OSRM / Nominatim / Zippopotam)
- Stripe (nem PaymentIntent nem Invoice preview)
- usuario WP (user meta so no account-link)
- catalogo `custom-meal-plan-builder`
- `POST .../zipcode` / lookup / autocomplete
- carrinho Woo (`WC()->cart`)

---

## 7) Pontos de atencao para reimplementacao em Node

1. **Nao recotar no select.** A rota PHP nao chama OSRM/ViaCEP/FedEx. Recotar no Node mudaria latencia, rate limits de terceiros e o contrato (hoje o preco e o que o front mandou). Se quiser anti-fraude, valide contra a ultima quote **persistida** — isso e comportamento **novo** (o PHP nao guarda a quote, so o tax).

2. **Trust-the-client e um risco.** Qualquer `cost` >= 0 com um `rate_id` passa. Checkout cobra esse `cost`. No Node, o minimo fiel e aceitar o snapshot; o minimo seguro e amarrar `rate_id`+`cost`+`zipcode` a uma quote server-side com TTL.

3. **Tax pode abortar o save.** US + Woo rates ausentes → 422 e **zero persistencia** de shipping. Front que trata 422 como "frete invalido" na verdade pode ter falhado tax. Separar erros (`invalid_shipping` vs `sales_tax_unavailable`) ou gravar shipping mesmo com tax falha seria correcao, nao copia.

4. **BR nunca bloqueia por tax.** `product_tax` fica 0. Nao "consertar" aplicando imposto BR aqui sem o front.

5. **`STRIPE_US_AUTOMATIC_TAX`.** Ligado: select devolve tax 0 e jurisdiction=state. Preview Stripe (`POST .../subscription/preview`) e que calcula. Node precisa da mesma flag, senao o resumo de checkout diverge (Woo vs Stripe Tax).

6. **Pais vazio = nao-US.** Select sem zipcode e sem `session.country` persiste frete com tax 0. Quote, ao contrario, exige zipcode (`shipping_address_required`). Nao unificar os gates sem olhar o front.

7. **Subtotal US obrigatorio no ramo Woo.** Sem `catalog_pricing.subtotal` (e sem cache de product_tax), select US falha `missing_subtotal`. Ordem real do funil: plan-selection/preview **antes** de shipping/select para US.

8. **`total` default vs `total` mentiroso.** Se o front omitir `total`, grava `cost + tax_total`. Se mandar `total` diferente da soma, a soma **nao** e reconciliada — persiste o `total` (ja com `max(0,)`). Checkout usa `cost` e `tax_total`, nao `total`.

9. **Dias uteis pelo label.** Parser ingênuo: qualquer digito no texto se houver keyword. `"Pacote 2.0 — 5 dias uteis"` pode pegar `2` e `5`. Replicar o regex `\d+` + keywords (`business|working|uteis|úteis|dias`) para nao mudar `delivery_days_min/max` que vao para meta do pedido e para `hsr_shipping_preference`.

10. **`delivery_days` vs `transit_business_days`.** Entrada aceita os dois; saida grava os dois iguais. Fronts antigos mandam `delivery_days` do quote BR. Aceitar os dois aliases.

11. **`null` vs `0` em distance/per_km.** `isset` distingue ausencia (`null`) de `0`. JSON `{"distance": 0}` grava `0`. Omitir grava `null`. Nao coalescer para `0` no Node se o GET da sessao for comparado.

12. **Overwrite, nao merge, de `shipping`.** Segundo select substitui o objeto. Campos opcionais omitidos no segundo POST (ex.: `distance`) somem. Front deve reenviar o rate completo.

13. **Nao invalidar no `POST .../zipcode`.** Trocar CEP deixa este snapshot velho. Checkout pode aplicar frete da cidade anterior. Copiar o bug ou invalidar shipping ao mudar postcode (correcao; ver doc de zipcode item 13).

14. **Save ignora falha de DB + rewrite de pets.** Copiar e perigoso. No Node: transacao, 500 se persistir falhar, e **nao** reescrever pets num UPDATE de plan_selection.

15. **Sem rate limit proprio.** So auth 300/300s por sessao. Quote tem os custos de terceiros; select e barato. Um limite de write e melhoria opcional.

16. **Resposta e subset.** Nao devolver a sessao crua (zipcode devolve). Front de select espera `data.shipping` + totais de tax. GET usa `present_session` e duplica shipping no top-level.

17. **i18n.** Messages em ingles via `__()`. Front deve casar em `code` (e `data.reason` no tax), nao em `message`.

18. **Sanitize.** `sanitize_text_field` em ids/labels. Replicar strip HTML + trim. `rate_id` Woo pode ter `:` (`flat_rate:12`); nao bloquear pontuacao comum de ids.

19. **Bridge de teste.** `POST /custom/v1/test/subscription/seed-checkout` chama `OnboardingService::select_shipping` in-process, com default Jadlog. A logica de select precisa continuar exportavel como funcao de dominio, nao so como handler HTTP.

20. **Migracao legado.** `repository->get` ainda promove transient `hsr_onb_*` para SQL. No Node, se a sessao ja estiver em Postgres, ignore esse ramo.

21. **Contrato sugerido na migracao** (`artefatos/migracao-node-reverse-engineering/08-endpoints-rest-sugeridos.md`): `POST /api/v1/onboarding/sessions/:sessionId/shipping/select`. Manter o mesmo `data.shipping` (incluindo `snapshot`, dias duplicados, `selected_at`) para o front e para o checkout.

22. **Testes ausentes.** Vale cobrir: so `rate_id`; so `method_id`; ambos vazios → 422; BR tax 0; US Woo 422 nao persiste; US automatic tax 0 persiste; parser de label `3–5 business days`; `delivery_days` alias; `total` omitido; `distance` omitido → null; overwrite do shipping anterior; pais vazio nao bloqueia.

---

## 8) Relacao com quote, tax e checkout

Fluxo feliz:

```
1. POST .../zipcode                 → grava endereco
2. POST .../shipping/quote          → lista rates (e ja grava product_tax)
3. POST .../shipping/select         → persiste rate escolhido + regrava product_tax   ← esta rota
4. POST .../sales-tax/quote         → opcional; so tax, sem mexer em shipping
5. POST .../account-link            → user meta hsr_shipping_preference
6. POST .../subscription/checkout   → WC_Order_Item_Shipping + metas _hsr_shipping_*
```

Quote **exige** zipcode; select **nao**. Quote **nao** grava `plan_selection.shipping`; so o select grava. Sem o passo 3, checkout nao adiciona linha de frete (`apply_selected_shipping` retorna cedo se shipping nao e array).
