# POST `/shipping/v1/calculate`

Documentacao da logica **atual** da cotacao de frete por distancia no Brasil.

Escopo: dado um CEP brasileiro, geocodificar o destino, medir a distancia ate o centro de distribuicao (CD) e devolver preco + prazo. A rota e **publica** (sem Bearer, sem `X-Session-Token`, sem sessao de onboarding). **Nao persiste** cotacao nem endereco.

Plugin: `headless-secure-registration` (modulo `HSR\Shipping`).

Caller no front (onboarding, passo Shipping, pais BR): `calculateDistanceShipping`.

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/shipping/presentation/class-shipping-api.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/application/class-calculate-shipping-use-case.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/application/class-get-fixed-shipping-quote.php` (`fromBrDistanceQuote` — so no quote autenticado)
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/domain/class-shipping-fee-calculator.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/domain/class-haversine.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/infrastructure/class-via-cep-client.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/infrastructure/class-nominatim-client.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/infrastructure/class-osrm-client.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/infrastructure/class-wp-transient-cache.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/infrastructure/class-shipping-rate-limiter.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/infrastructure/class-shipping-settings-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/presentation/class-shipping-admin-page.php` (grava settings; teste de CEP chama o mesmo use case **sem** rate limit)
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`
- testes: `tests/unit/Shipping/calculate-shipping-use-case-test.php`, `tests/unit/Shipping/shipping-fee-calculator-test.php`

Namespace REST: `shipping/v1` (nao e `custom/v1`)  
Base: `{WP_URL}/wp-json`

Nao existe equivalente no Node hoje.

---

## 1) Identidade da rota

```
POST /wp-json/shipping/v1/calculate
```

| Item | Valor |
|---|---|
| Namespace WP | `shipping/v1` |
| Metodo | `POST` (`WP_REST_Server::CREATABLE`) |
| Path param | nenhum |
| Permission | `__return_true` (publico) |
| Handler | `ShippingApi::calculate` |
| Servico | `CalculateShippingUseCase::execute($zipCode, $country, true)` |
| Validator | nenhum (`args` REST vazios; `RequestValidator` nao e usado) |
| Rate limit | `ShippingRateLimiter` por IP (nao o `RateLimiter` de onboarding) |
| Registro | `add_action('rest_api_init', [ShippingApi, 'register_routes'])` |

Objetivo: cotizar frete BR por KM (CD → CEP) para o front montar a tela Shipping **antes** (ou em paralelo) de `POST .../shipping/select`.

Nao confundir com:

- `POST /custom/v1/onboarding/session/{id}/shipping/quote` — autenticado; reusa o **mesmo** `CalculateShippingUseCase` no ramo BR, mapeia para `rates[]` via `GetFixedShippingQuote::fromBrDistanceQuote` e **grava** `product_tax` na sessao
- `POST .../shipping/select` — persiste o rate escolhido; **nao** cotiza
- `GET /shipping/v1/settings` — tarifa/config; no US e fixa, no BR so expoe `per_km` (nao calcula distancia)
- Woo Store API / zonas Woo — fallback so no quote autenticado para paises != BR/US

---

## 2) Fluxo completo

```mermaid
sequenceDiagram
    participant Front
    participant WP as ShippingApi
    participant UC as CalculateShippingUseCase
    participant RL as ShippingRateLimiter
    participant Opt as option hsr_shipping_settings
    participant Cache as transients hsr_ship_*
    participant ViaCEP as viacep.com.br
    participant Nom as nominatim.openstreetmap.org
    participant OSRM as router.project-osrm.org

    Front->>WP: POST /shipping/v1/calculate (sem Bearer)
    Note over WP: permission = true
    WP->>UC: execute(zipCode, country, applyRateLimit=true)

    alt country != BR
        UC-->>Front: 400 country_not_supported
    end
    UC->>Opt: get_option hsr_shipping_settings
    alt br.enabled = false
        UC-->>Front: 422 shipping_disabled
    end
    alt CEP != 8 digitos
        UC-->>Front: 400 invalid_zipcode
    end

    UC->>RL: assert_allowed(cep8)
    alt estouro 20/min, 60/h ou 1 cold/2s
        UC-->>Front: 429 rate_limited
    end
    alt CD lat=lng=0
        UC-->>Front: 422 route_failed
    end

    alt cache viacep:{cep8}
        Cache-->>UC: address
    else miss
        UC->>ViaCEP: GET /ws/{cep8}/json/
        alt timeout / HTTP != 2xx
            UC-->>Front: 503 upstream_unavailable
        else erro=true / JSON invalido
            UC-->>Front: 404 zipcode_not_found
        end
        UC->>Cache: set 7d
    end

    alt cache geo:{cep8}
        Cache-->>UC: lat/lng
    else miss
        UC->>Nom: GET /search?countrycodes=br
        alt vazio / HTTP != 2xx
            UC-->>Front: 422 address_not_geocodable
        end
        UC->>Cache: set 60d
    end

    alt cache route:{cdVersion}:{lat4},{lng4}
        Cache-->>UC: distance_m + source
    else miss
        UC->>RL: hit_cold(cep8)
        UC->>OSRM: GET /route/v1/driving/{lng,lat;lng,lat}
        alt OSRM ok
            Note over UC: source=osrm
        else OSRM falhou
            Note over UC: Haversine; source=haversine_fallback
            alt distancia <= 0
                UC-->>Front: 422 route_failed
            end
        end
        UC->>Cache: set 14d (metros crus)
    end

    Note over UC: billable km, teto de cobertura, fee, prazo
    alt distancia > max_distance_km
        UC-->>Front: 422 out_of_coverage
    end
    UC-->>Front: 200 { success:true, data:{ distance, shipping, ... } }
```

### 2.1 Camada REST (`ShippingApi::calculate`)

1. Le o body **somente** com `$request->get_json_params()`. Se nao for array (body vazio, form-urlencoded, XML) → trata como `[]`.
2. Extrai:
   - `zipCode` com alias `zipcode` (camelCase primeiro)
   - `country` com default `'BR'`, depois `strtoupper`
3. Chama `CalculateShippingUseCase::execute($zipCode, $country, true)`.
4. Se `WP_Error` → devolve o erro REST (HTTP do `data.status`).
5. Senao → HTTP `200` com envelope `{ success: true, data: <resultado> }`.

Nao ha:

- `X-Session-Token` / Bearer
- schema REST (`args`)
- sanitizacao `sanitize_text_field` no CEP (so `preg_replace('/\D+/', '')` no use case)
- fallback para `get_body_params()` (diferente das rotas `custom/v1` de onboarding)
- persistencia de sessao

Campos extras no JSON sao ignorados (`product_id`, `session_id`, endereco completo, etc.).

### 2.2 Autenticacao

Nenhuma. `permission_callback` e `__return_true`.

CORS: o plugin so adiciona `x-session-token` em `rest_allowed_cors_headers`. Esta rota nao precisa desse header. Preflight OPTIONS segue o default do WP REST.

### 2.3 Validacoes de negocio (`CalculateShippingUseCase::execute`)

Ordem. Falha = `WP_Error` (HTTP 4xx/5xx, **sem** envelope `success: true`).

| # | Regra | HTTP | `code` |
|---|---|---|---|
| 1 | `country` (apos trim + uppercase) != `BR` | 400 | `country_not_supported` |
| 2 | `settings.br.enabled` vazio/false | 422 | `shipping_disabled` |
| 3 | CEP, so digitos, length != 8 | 400 | `invalid_zipcode` |
| 4 | Rate limit IP (ver secao 6.2) | 429 | `rate_limited` |
| 5 | CD `lat == 0 && lng == 0` | 422 | `route_failed` |
| 6 | ViaCEP timeout / HTTP nao-2xx | 503 | `upstream_unavailable` |
| 7 | ViaCEP `erro` ou JSON nao-objeto | 404 | `zipcode_not_found` |
| 8 | Nominatim vazio / HTTP nao-2xx / sem lat/lon | 422 | `address_not_geocodable` |
| 9 | OSRM falhou **e** Haversine <= 0 m | 422 | `route_failed` |
| 10 | km faturavel > `rule.max_distance_km` (se max > 0) | 422 | `out_of_coverage` |

**Nao valida:**

- se o CEP existe na sessao de onboarding (esta rota nem ve sessao);
- cidade/UF do payload (endereco vem so do ViaCEP);
- `per_km` / CD no body (sempre da option `hsr_shipping_settings`);
- autenticidade do IP (headers de proxy sao confiados).

`country=br` passa. `country=Brazil` vira `BRAZIL` → 400. Omitir `country` assume BR.

### 2.4 Formula de distancia, preco e prazo

Settings lidos de `ShippingSettingsRepository::get()` (option + defaults). Defaults relevantes:

| Chave | Default |
|---|---|
| `br.rule.per_km` | `0.95` |
| `br.rule.road_factor` | `1.3` |
| `br.rule.min_fee` | `0` (desliga o piso) |
| `br.rule.max_fee` | `null` (sem teto) |
| `br.rule.max_distance_km` | `500` (`0` desliga o corte) |
| `br.rule.km_per_day` | `80` |
| `br.rule.min_days` | `2` |
| `br.rule.max_days` | `10` |
| `br.label` | `Entrega Eden Bowl` |
| `br.center.lat/lng` | `0` / `0` (rota inutil ate o admin gravar o CD) |

**Distancia faturavel** (`ShippingFeeCalculator::billableDistanceKm`):

1. `km = distance_m / 1000`, arredondado a 2 casas **depois** do fator.
2. Se `source === 'osrm'`: usa os km crus da rota.
3. Se `source === 'haversine_fallback'`: multiplica por `max(0.01, road_factor)`. O fator e aplicado **na leitura**, nao no cache. Mudar `road_factor` no admin altera o preco das cotacoes cacheadas em Haversine sem invalidar o transient.

**Preco** (`apply`): nao ha taxa base somada.

```
raw = round(distanceKm * per_km, 4)
shipping = raw
se min_fee > 0 e shipping < min_fee → shipping = min_fee  (piso, nao soma)
se max_fee numerico >= 0 e shipping > max_fee → shipping = max_fee
return round(shipping, 2); raw no breakdown e round(raw, 2)
```

**Prazo** (`deliveryDays`):

```
days = ceil(distanceKm / max(0.0001, km_per_day))
days = max(min_days, days)
se max_days > 0: days = min(max_days, days)
return max(1, days)
```

Exemplo (teste unitario): 18.5 km × 0.95 = **17.58**; `ceil(18.5/80)=1` → sobe para `min_days=2`.

`max_distance_km` compara a distancia **ja** com road_factor no fallback. Borda: 99.95 km passa um teto de 100; 100.05 nao.

O response **nao** inclui `rate_id` / `method_id`. O mapper `fromBrDistanceQuote` (so no quote autenticado) vira:

- `rate_id`: `distance_km:br-default`
- `method_id`: `distance_km`
- `label`: `{br.label} · {N} dia(s) útil/úteis` se `delivery_days > 0`

O front publico que chama `/calculate` precisa montar esse shape sozinho se for mandar para `/shipping/select`.

### 2.5 Persistencia desta rota

**Nao grava** sessao, pedido, user meta nem a option de settings. So transients de cache e de rate limit (ver secao 6).

---

## 3) Chamadas a backend / servicos externos

Nao ha HTTP para um backend PawBowl / meal-plan / Stripe. Os tres provedores abaixo sao publicos, timeout **5 s**, via `wp_remote_get` (injetavel nos testes).

### 3.1 ViaCEP — `ViaCepClient`

| | |
|---|---|
| Servico | ViaCEP |
| Metodo | `GET` |
| URL | `https://viacep.com.br/ws/{cep8}/json/` |
| Headers | default WP |
| Timeout | 5 s |
| Cache | transient `viacep:{cep8}`, TTL 7 dias (minimo efetivo 60 s no wrapper) |

`{cep8}` vai em `rawurlencode` (8 digitos, sem hifen).

**Resposta esperada (200):**

```json
{
  "cep": "80010-000",
  "logradouro": "Rua XV de Novembro",
  "complemento": "",
  "bairro": "Centro",
  "localidade": "Curitiba",
  "uf": "PR",
  "erro": false
}
```

Mapeamento interno:

| ViaCEP | interno |
|---|---|
| `logradouro` | `street` |
| `bairro` | `neighborhood` |
| `localidade` | `city` |
| `uf` | `state` |
| `complemento` | `complement` |

**Erros → API:**

| Condicao | HTTP API | `code` |
|---|---|---|
| `WP_Error` (timeout/DNS) ou HTTP nao-2xx | 503 | `upstream_unavailable` |
| JSON nao-array ou `erro` truthy | 404 | `zipcode_not_found` |

Nao ha retry. CEP inexistente e 404 (diferente do lookup de onboarding, que devolve HTTP 200 + `status=not_found`).

### 3.2 Nominatim — `NominatimClient`

| | |
|---|---|
| Servico | Nominatim (OpenStreetMap) |
| Metodo | `GET` |
| URL | `https://nominatim.openstreetmap.org/search?` + query |
| Timeout | 5 s |
| Cache | transient `geo:{cep8}`, TTL 60 dias |

Query:

```
q={street}, {neighborhood}, {city}, {state}, {cep8}, Brasil
countrycodes=br
format=jsonv2
limit=1
addressdetails=0
```

Partes vazias sao omitidas. CEP de cidade grande (sem logradouro) ainda geocodifica com cidade+UF+CEP.

Headers:

```
User-Agent: EdenBowlShipping/1.0 (https://edenbowl.com; shipping@edenbowl.com)
Accept: application/json
```

User-Agent filtravel: `hsr/shipping_nominatim_user_agent`. Sem UA valido o Nominatim publico bloqueia.

**Resposta esperada:** array JSON, usa `data[0].lat` e `data[0].lon`.

**Erros → API 422 `address_not_geocodable`:** timeout, HTTP nao-2xx, array vazio, `lat`/`lon` empty (em PHP `empty('0')` e true — irrelevante no BR).

Nao ha fallback de geocode (nao tenta so o CEP, nao usa Google). Sem Nominatim a cotacao **morre**, mesmo com ViaCEP ok.

### 3.3 OSRM — `OsrmClient`

| | |
|---|---|
| Servico | OSRM public demo (`project-osrm`) |
| Metodo | `GET` |
| URL | `https://router.project-osrm.org/route/v1/driving/{originLng},{originLat};{destLng},{destLat}?overview=false` |
| Coordenadas | 6 casas decimais; ordem **lng,lat** (GeoJSON) |
| Timeout | 5 s |
| Cache | ver abaixo |

Origem = CD (`br.center`). Destino = geocode do CEP.

**Resposta esperada:**

```json
{
  "code": "Ok",
  "routes": [
    { "distance": 18500, "duration": 1200 }
  ]
}
```

`distance` em **metros**. `duration` em segundos (guardado no cache; **nao** entra no preco nem no prazo — prazo e `km / km_per_day`).

**Falha do OSRM nao estoura a API.** Qualquer `WP_Error` do client (timeout, HTTP nao-2xx, `distance` nao numerico / `NoRoute`) cai no **Haversine** (raio 6_371_000 m). So se Haversine <= 0 (mesmo ponto degenerado) a API devolve 422 `route_failed`.

Cache de rota (miss chama OSRM + `hit_cold`):

```
route:{center.version}:{lat4},{lng4}
```

`lat4`/`lng4` = `number_format(coord, 4, '.', '')`. TTL 14 dias. Payload cacheado: `{ distance_m, duration_s, source }` — metros **crus**. `road_factor` nao e serializado.

Mudar lat/lng do CD no admin gera nova `center.version` (`time()`), o que **invalida** o cache de rotas. Mudar so `per_km` / `road_factor` **nao** invalida.

### 3.4 Tratamento de erro (resumo HTTP)

Formato WP REST: `{ "code", "message", "data": { "status": N, ... } }`. Messages EN, dominio `headless-secure-registration`. Sem retry/circuit breaker no PHP.

---

## 4) Request / response

### 4.1 Headers

```
POST /wp-json/shipping/v1/calculate
Content-Type: application/json
```

Sem `Authorization`. Sem `X-Session-Token`.

### 4.2 Sucesso (OSRM)

Request:

```http
POST /wp-json/shipping/v1/calculate
Content-Type: application/json

{
  "zipCode": "80010-000",
  "country": "BR"
}
```

Equivalente: `"zipcode": "80010000"` (alias). Hifen e removido.

Response `200` (distancia de exemplo do teste: 18500 m):

```json
{
  "success": true,
  "data": {
    "distance": 18.5,
    "shipping": 17.58,
    "delivery_days": 2,
    "currency": "BRL",
    "distance_source": "osrm",
    "quoted_at": "2026-08-18T01:10:00+00:00",
    "label": "Entrega Eden Bowl",
    "distribution_center": {
      "name": "CD Curitiba",
      "version": "1720000000"
    },
    "breakdown": {
      "per_km": 0.95,
      "distance_km": 18.5,
      "road_factor": 1.3,
      "minimum_applied": false,
      "maximum_applied": false,
      "raw": 17.58
    },
    "destination": {
      "zipcode": "80010-000",
      "city": "Curitiba",
      "state": "PR"
    }
  }
}
```

`destination.zipcode` e reformatado `NNNNN-NNN`. `quoted_at` e `gmdate('c')` (UTC). `label` e o da option, **sem** sufixo de dias (o sufixo so aparece no mapper do quote autenticado).

Fallback Haversine: mesmo envelope, `distance_source: "haversine_fallback"`, `distance` ja com `road_factor`, `duration_s` interno 0.

### 4.3 Erros HTTP

| HTTP | `code` | Quando | Message |
|---|---|---|---|
| 400 | `country_not_supported` | country != BR (ex.: US) | Distance shipping is only available for Brazil. |
| 400 | `invalid_zipcode` | nao ha 8 digitos | Invalid Brazilian postal code. |
| 404 | `zipcode_not_found` | ViaCEP `erro` | Postal code not found. |
| 422 | `shipping_disabled` | `br.enabled` false | Brazil distance shipping is disabled. |
| 422 | `route_failed` | CD 0,0 **ou** Haversine <= 0 apos OSRM falhar | Distribution center coordinates are not configured. **ou** Unable to calculate shipping distance. |
| 422 | `address_not_geocodable` | Nominatim falhou | Unable to locate this address for shipping. |
| 422 | `out_of_coverage` | km > teto | Delivery is not available for this distance. |
| 429 | `rate_limited` | ver secao 6.2 | Too many shipping calculations... / Please wait a moment... |
| 503 | `upstream_unavailable` | ViaCEP fora | Postal code service is temporarily unavailable. |

Exemplo 400 (front US chamando calculate por engano):

```http
POST /wp-json/shipping/v1/calculate
Content-Type: application/json

{ "zipCode": "10001", "country": "US" }
```

```json
{
  "code": "country_not_supported",
  "message": "Distance shipping is only available for Brazil.",
  "data": { "status": 400 }
}
```

Exemplo 422 fora de cobertura (`data.distance` extra):

```json
{
  "code": "out_of_coverage",
  "message": "Delivery is not available for this distance.",
  "data": {
    "status": 422,
    "distance": 612.4
  }
}
```

Exemplo 429:

```json
{
  "code": "rate_limited",
  "message": "Too many shipping calculations. Please wait a moment.",
  "data": {
    "status": 429,
    "retry_after": 60
  }
}
```

`retry_after`: `60` (limite/min), `3600` (limite/hora) ou `2` (cold por CEP).

Body nao-JSON / `{}` sem CEP → 400 `invalid_zipcode` (country default BR).

---

## 5) Hooks e filters do WordPress

### 5.1 Especificos HSR (esta rota)

| Tipo | Hook | Onde | Efeito |
|---|---|---|---|
| action | `rest_api_init` | `Plugin::boot` | registra `/shipping/v1/calculate` e `/settings` |
| filter | `hsr/shipping_nominatim_user_agent` | `NominatimClient::request` | troca o User-Agent. Arg: string default `EdenBowlShipping/1.0 (...)` |
| action | `admin_menu` | `ShippingAdminPage` | WP Admin → Frete (grava a option que esta rota le) |

Nao ha `do_action` proprio no calculate. Filters globais `hsr/rate_limit_*` e `hsr/onboarding_*` **nao** se aplicam.

### 5.2 Core WP envolvidos

| Hook / API | Uso |
|---|---|
| `register_rest_route` | roteamento publico |
| `get_option('hsr_shipping_settings')` | CD + regra |
| `get_transient` / `set_transient` | cache geocode/rota + rate limit |
| `wp_remote_get` | ViaCEP, Nominatim, OSRM |
| `rest_ensure_response` | envelope 200 |
| `__()` | i18n `headless-secure-registration` |

WooCommerce **nao** entra neste caminho (nem `WC_Shipping_Zones` nem `WC_Tax`).

---

## 6) Dependencias e efeitos colaterais

### 6.1 O que e lido

- Body JSON: `zipCode`/`zipcode`, `country`.
- Option `hsr_shipping_settings` (`autoload=false` no save do admin).
- Transients de cache e de rate limit.
- IP: `HTTP_CF_CONNECTING_IP`, `HTTP_X_REAL_IP`, primeiro hop de `HTTP_X_FORWARDED_FOR`, `REMOTE_ADDR`. Primeiro valor `FILTER_VALIDATE_IP` ganha; senao `0.0.0.0`.

### 6.2 O que e gravado

| Recurso | Gravado? | Detalhe |
|---|---|---|
| sessao onboarding | **nao** | |
| `plan_selection.shipping` | **nao** | so o select autenticado |
| option settings | **nao** | |
| transient cache | **sim** | prefixo `hsr_ship_` + `md5(chave logica)` |
| transient rate limit | **sim** | prefixo `hsr_ship_rl_` + `md5(scope)` |
| pedido Woo / Stripe | **nao** | |

Chaves logicas de cache (antes do md5):

| Logica | TTL pedido | TTL efetivo (`max(60, ttl)`) |
|---|---|---|
| `viacep:{cep8}` | 7×86400 | 7 d |
| `geo:{cep8}` | 60×86400 | 60 d |
| `route:{version}:{lat4},{lng4}` | 14×86400 | 14 d |

Rate limit (`assert_allowed` **antes** dos caches; `hit` de min/hora **sempre** que passa):

| Scope | Max | Janela | Quando incrementa |
|---|---|---|---|
| `{ip}\|min` | 20 | 60 s | todo calculate publico que passou o check |
| `{ip}\|hour` | 60 | 3600 s | idem |
| `{ip}\|cep\|{cep8}` (cold) | 1 | 2 s | **so** em miss de cache de rota (`hit_cold`) |

Cold e checado em todo request, mas so incrementado no miss. Consequencia: depois de um miss, o mesmo IP+CEP toma 429 por 2 s **mesmo** se a rota ja estiver cacheada. Hits de cache de rota antigos (cold ja expirou) **nao** disparam o debounce de 2 s.

O quote autenticado BR (`OnboardingService::get_shipping_quote_br_distance`) chama `execute(..., true)` — **compartilha** estes buckets de IP com o front publico.

Admin "Testar CEP" chama `execute(..., false)` e nao consome limite.

### 6.3 Consumidores posteriores

Esta rota nao deixa rastro na sessao. O front precisa:

1. mostrar `shipping` / `delivery_days` / `label`;
2. no select, reenviar um rate (tipicamente o shape de `fromBrDistanceQuote`).

Checkout so ve o snapshot gravado no select, nao esta cotacao.

### 6.4 Sem efeitos em

- Stripe, catalogo, sales tax, zipcode da sessao
- `us.*` das settings (pais US e rejeitado no passo 1)
- carrinho Woo

---

## 7) Pontos de atencao para reimplementacao em Node

1. **Contrato publico sem auth.** Qualquer cliente na internet cotiza. No Node, manter publico se o front atual depende disso; senão exigir session token e quebrar `calculateDistanceShipping`. Rate limit por IP e obrigatorio — Nominatim/OSRM publicos banem abuso.

2. **Nao e o mesmo payload do select.** `/calculate` devolve `shipping` (preco) + `distance`. Select espera `rate_id`/`method_id`/`cost`/`label` com dias no label. Ou o Node expoe os dois shapes, ou o front continua mapeando.

3. **Duas entradas BR.** Front pode chamar esta rota **ou** `POST .../shipping/quote`. Quote autentica, grava tax e ja devolve `rates[]`. Copiar a formula nos dois lugares diverge. No Node: um use case, dois adapters HTTP.

4. **CD em (0,0) = 422.** Install fresco quebra o passo Shipping BR ate o admin gravar lat/lng. Seedar CD no deploy Node.

5. **OSRM demo nao e producao.** `router.project-osrm.org` e best-effort. PHP engole falha e usa Haversine×1.3 (urbano). Self-host OSRM ou aceitar o fallback; documentar que preco OSRM ≠ Haversine para o mesmo CEP.

6. **Nominatim usage policy.** User-Agent identificavel + cache longo (60 d). Sem UA, 422 `address_not_geocodable` em massa. Preferir instancia propria ou provider pago na migracao.

7. **ViaCEP 404 vs 503.** CEP inexistente ≠ provedor fora. Front deve tratar `zipcode_not_found` diferente de `upstream_unavailable`. Lookup de onboarding usa outro client e HTTP 200 — nao unificar sem olhar o front.

8. **Cache: rota pela versao do CD + lat/lng a 4 casas, nao pelo CEP.** Dois CEPs no mesmo predio compartilham rota. `road_factor` nao entra na chave: Haversine cacheado re-aplica o fator atual (teste `test_osrm_down_uses_haversine_fallback_with_raw_cache_semantics`). OSRM cacheado **nao** re-aplica fator. Replicar isso ou preco muda apos migrar o cache.

9. **Invalidar rota so com lat/lng do CD.** Trocar `per_km` altera o preco na hora (recalcula em cima dos km cacheados). Trocar endereco textual do CD sem lat/lng **nao** invalida.

10. **Piso ≠ taxa base.** `min_fee` substitui se `km*per_km` for menor; nao soma. `max_fee` vazio = infinito.

11. **`max_distance_km = 0` desliga cobertura.** Nao tratar 0 como "nao entrega ninguem".

12. **Rate limit spoofable.** Confiar em `X-Forwarded-For` sem proxy de borda permite burlar. No Node, IP so do hop confiavel. Cold 1/2s e facil de bater com double-submit no front.

13. **Limites compartilhados com o quote autenticado.** Usuario no funil + retry na tela publica queimam o mesmo 20/min. Separar buckets e mudanca de comportamento.

14. **JSON-only.** Form-urlencoded nao popula `zipCode`. Manter `zipCode` camelCase como chave primaria e `zipcode` alias.

15. **`country=US` aqui e 400**, nao fallback para tarifa fixa. Front US usa `GET /shipping/v1/settings?country=US`.

16. **`br.enabled=false` → 422.** `us.enabled` e ignorado nesta rota.

17. **Sem persistencia.** Nao gravar quote no Node "por simetria" com o quote autenticado — o PHP publico e stateless alem de cache.

18. **i18n.** Casar `code`, nao `message`. `out_of_coverage` traz `data.distance` para o front mostrar km.

19. **Timeout 5 s × ate 3 HTTP** no miss frio (ViaCEP + Nominatim + OSRM). Cache hit e local. SLA do passo Shipping BR depende disso.

20. **Testes a portar:** country US; ViaCEP `erro`; Nominatim `[]`; OSRM 18.5 km → 17.58; OSRM down + mudanca de `road_factor` no cache Haversine; ViaCEP timeout → 503; piso/teto; borda `max_distance_km`.

21. **Contrato sugerido:** `POST /api/v1/shipping/calculate` com o mesmo `data` (incluindo `breakdown`, `distance_source`, `distribution_center.version`) para o front `calculateDistanceShipping` nao mudar.

---

## 8) Relacao com settings, quote e select

Fluxo feliz BR (duas variantes de cotacao):

```
A) Front publico (passo Shipping, sem Bearer)
   POST /shipping/v1/calculate     → preco/prazo              ← esta rota
   POST .../shipping/select        → grava snapshot (+ tax)

B) Front via sessao
   POST .../zipcode                → grava endereco
   POST .../shipping/quote         → mesmo use case + rates[] + grava tax
   POST .../shipping/select        → grava snapshot
```

As duas variantes podem coexistir. Select **nao** chama calculate. Sem select, checkout nao cria linha de frete.
