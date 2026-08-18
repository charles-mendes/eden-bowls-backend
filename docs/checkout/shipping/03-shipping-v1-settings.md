# GET `/shipping/v1/settings`

Documentacao da logica **atual** da leitura publica das settings de frete.

Escopo: devolver a tarifa/configuracao de shipping **sem cotizar distancia** e **sem sessao**. A rota e **publica** (sem Bearer, sem `X-Session-Token`). **Nao persiste** nada.

Uso principal no front (onboarding, passo Shipping, pais US): `fetchUsFixedShippingSettings` → `GET /shipping/v1/settings?country=US`.

O mesmo handler, se `country` nao for `US`, devolve o recorte BR (`per_km` + label). O front BR de cotacao usa `POST /shipping/v1/calculate`, nao esta rota.

Plugin: `headless-secure-registration` (modulo `HSR\Shipping`).

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/shipping/presentation/class-shipping-api.php` (`public_settings`)
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/application/class-get-fixed-shipping-quote.php` (`forUs`)
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/infrastructure/class-shipping-settings-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/shipping/presentation/class-shipping-admin-page.php` (grava a option)
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`

Nao ha teste unitario deste handler (so do calculator / calculate BR).

Namespace REST: `shipping/v1` (nao e `custom/v1`)  
Base: `{WP_URL}/wp-json`

Nao existe equivalente no Node hoje.

---

## 1) Identidade da rota

```
GET /wp-json/shipping/v1/settings
GET /wp-json/shipping/v1/settings?country=US
```

| Item | Valor |
|---|---|
| Namespace WP | `shipping/v1` |
| Metodo | `GET` (`WP_REST_Server::READABLE`) |
| Query | `country` (opcional; uppercase no handler) |
| Permission | `__return_true` (publico) |
| Handler | `ShippingApi::public_settings` |
| Servicos | `ShippingSettingsRepository::get`, e se US: `GetFixedShippingQuote::forUs` |
| Validator | nenhum (`args` REST vazios) |
| Rate limit | **nenhum** |
| Registro | `add_action('rest_api_init', [ShippingApi, 'register_routes'])` |

Objetivo: o front US montar a opcao unica de frete (FedEx tarifa fixa) a partir da config do WP Admin → Frete → Estados Unidos, sem chamar OSRM/ViaCEP e sem token de sessao.

Nao confundir com:

- `POST /shipping/v1/calculate` — cotiza BR por KM (rejeita `country=US` com 400)
- `POST /custom/v1/onboarding/session/{id}/shipping/quote` — autenticado; no US chama o **mesmo** `forUs()`, mas devolve `rates[]` no shape de onboarding e **grava** `product_tax`
- `POST .../shipping/select` — persiste o rate escolhido
- Woo shipping zones — fallback so no quote autenticado para pais != BR/US

---

## 2) Fluxo completo

```mermaid
sequenceDiagram
    participant Front
    participant WP as ShippingApi
    participant Repo as ShippingSettingsRepository
    participant Mapper as GetFixedShippingQuote
    participant Opt as option hsr_shipping_settings

    Front->>WP: GET /shipping/v1/settings?country=US (sem Bearer)
    Note over WP: permission = true
    WP->>Repo: get()
    Repo->>Opt: get_option('hsr_shipping_settings')
    Opt-->>Repo: JSON ou defaults
    Repo-->>WP: settings mergeados

    alt country === US
        WP->>Mapper: forUs()
        Mapper->>Repo: get()['us']
        Mapper-->>WP: { cost, label, carrier, delivery, rate_id, ... }
        WP-->>Front: 200 { success, data:{ country:US, enabled, cost, label, carrier, delivery, currency:USD } }
    else qualquer outro country (BR, vazio, CA, ...)
        WP-->>Front: 200 { success, data:{ country:BR, enabled, label, per_km, currency:BRL } }
    end
```

Nao ha ramo de erro de negocio. O handler **sempre** responde HTTP 200 com envelope `success: true` (salvo falha fatal PHP / REST core).

### 2.1 Camada REST (`ShippingApi::public_settings`)

1. `country = strtoupper((string) $request->get_param('country') ?? '')`. Query string. Sem `args` registrados; o WP REST mesmo assim expoe query params via `get_param`.
2. `settings = ShippingSettingsRepository::get()`.
3. Se `$country === 'US'`:
   - chama `GetFixedShippingQuote::forUs()` (rele `get()` internamente);
   - devolve o DTO US (secao 4.2).
4. Senao:
   - usa `$settings['br']`;
   - devolve o DTO BR (secao 4.3), **forcando** `country: 'BR'` mesmo se a query era `CA`, `br` (vira `BR` e cai no if US? `br`→`BR` ≠ `US` → ramo BR), ou vazia.

Nao le body. Nao le sessao. Nao sanitiza alem do `strtoupper` do country.

`country=us` → `US` → ramo americano.  
`country=USA` → `USA` → ramo **BR** (nao e erro).

### 2.2 Autenticacao

Nenhuma. `permission_callback` e `__return_true`.

Sem rate limit proprio e sem o bucket `onboarding_auth`. Pode ser batida sem token, em loop, so para ler preco.

CORS: o plugin adiciona `x-session-token` em `rest_allowed_cors_headers` globalmente; esta rota nao usa o header.

### 2.3 Validacoes de negocio

**Nao ha.** Em particular:

| O que o front poderia esperar | O que o PHP faz |
|---|---|
| 404 se US desligado | devolve `enabled: false` **e ainda assim** `cost`/`label` preenchidos |
| 422 sem ZIP | ZIP nao e pedido |
| 400 country invalido | cai no DTO BR |
| recusar se option ausente | usa `defaults()` (`us.cost` 12.90, FedEx, etc.) |

`forUs()` **nao** consulta `us.enabled`. O flag vem em paralelo da option. Quote autenticado US (`get_shipping_quote_us_fixed`) tambem **nao** checa `enabled` — so esta rota o expoe.

### 2.4 Origem dos campos US (`GetFixedShippingQuote::forUs`)

Lidos de `settings.us` (merge com defaults):

| Campo option | Default | No response publico |
|---|---|---|
| `us.cost` | `12.90` | `cost` = `round((float) cost, 2)` |
| `us.label` | `FedEx 3–5 business days` | `label` |
| `us.carrier` | `FedEx` | `carrier` |
| `us.delivery` | `3–5 business days` | `delivery` |
| `us.enabled` | `true` | `enabled` (bool, **fora** do mapper) |

O mapper internamente tambem monta o shape de onboarding, mas o GET publico **descarta**:

```
rate_id = fixed_us:default
method_id = fixed_us
instance_id = 0
tax_total = 0
total = cost
currency = USD   ← o handler forca 'USD' de novo no DTO
```

O front `fetchUsFixedShippingSettings` precisa completar `rate_id` / `method_id` se for chamar `/shipping/select` direto (o quote autenticado ja devolve `rates[]` completo).

Traco `–` nos defaults de `label`/`delivery` e en-dash U+2013 (`3–5`), nao hifen ASCII.

### 2.5 Origem dos campos BR (query != US)

| Campo | Default | Response |
|---|---|---|
| `br.enabled` | `true` | `enabled` |
| `br.label` | `Entrega Eden Bowl` | `label` |
| `br.rule.per_km` | `0.95` | `per_km` (float) |
| — | — | `country: 'BR'`, `currency: 'BRL'` |

Nao expoe CD, `road_factor`, `min_fee`, `max_fee`, `max_distance_km` nem prazo. Nao calcula KM.

### 2.6 Persistencia desta rota

Nenhuma. So leitura de `wp_options`.

Escrita da option e o WP Admin (`ShippingAdminPage`), capability `manage_woocommerce` (a pagina tambem aceita `manage_options` no `current_user_can` do render; o submenu e registrado com `manage_woocommerce`). Save: `update_option('hsr_shipping_settings', $merged, false)` — `autoload=false`.

---

## 3) Chamadas a backend / servicos externos

**Esta rota nao faz HTTP de saida.** Sem ViaCEP, Nominatim, OSRM, Zippopotam, Stripe, PawBowl.

O unico I/O e `get_option('hsr_shipping_settings')`. Se a option nao e array, `defaults()`. Se e array parcial, `merge_defaults()` (center/rule/us preenchidos chave a chave).

Nao ha cache proprio alem do object cache padrao de options do WP (e como `autoload=false`, cada request pode ir ao MySQL se o object cache estiver frio).

### 3.1 Nenhum endpoint PawBowl

Nao ha client HTTP. Nao ha URL `PAWBOWL_*`.

### 3.2 Relacao com o quote autenticado US

`OnboardingService::get_shipping_quote_us_fixed` chama o mesmo `forUs()` e embrulha:

```json
{
  "session_id": "...",
  "destination": { "country": "US", "state": "...", "city": "...", "postcode": "..." },
  "rates": [
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
  ]
}
```

Alem disso o quote **grava** `plan_selection.product_tax` e exige sessao+zipcode. O GET settings nao.

### 3.3 Tratamento de erro

Nao ha `WP_Error` neste handler. Falhas so as do WP REST (rota inexistente se o plugin estiver off, 404 de permalink, etc.).

Front que trata `enabled: false` como erro de negocio precisa fazer isso **no cliente** — o HTTP continua 200.

---

## 4) Request / response

### 4.1 Headers

```
GET /wp-json/shipping/v1/settings?country=US
```

Sem `Authorization`. Sem `X-Session-Token`. Sem body.

### 4.2 Sucesso US (caminho do front `fetchUsFixedShippingSettings`)

Request:

```http
GET /wp-json/shipping/v1/settings?country=US
```

Response `200` (defaults de install / valores do admin):

```json
{
  "success": true,
  "data": {
    "country": "US",
    "enabled": true,
    "cost": 12.9,
    "label": "FedEx 3–5 business days",
    "carrier": "FedEx",
    "delivery": "3–5 business days",
    "currency": "USD"
  }
}
```

`cost` e float JSON (12.9, nao `"12.90"`). `enabled: false` com `cost` ainda presente:

```json
{
  "success": true,
  "data": {
    "country": "US",
    "enabled": false,
    "cost": 12.9,
    "label": "FedEx 3–5 business days",
    "carrier": "FedEx",
    "delivery": "3–5 business days",
    "currency": "USD"
  }
}
```

Nao inclui `rate_id`, `method_id`, `tax_total`, `total`, `delivery_days`, ZIP, tax.

### 4.3 Sucesso BR (mesmo endpoint, query ausente ou != US)

```http
GET /wp-json/shipping/v1/settings
GET /wp-json/shipping/v1/settings?country=BR
```

```json
{
  "success": true,
  "data": {
    "country": "BR",
    "enabled": true,
    "label": "Entrega Eden Bowl",
    "per_km": 0.95,
    "currency": "BRL"
  }
}
```

Nao e o preco final. Preco BR exige `POST /shipping/v1/calculate`.

### 4.4 Erros HTTP

Nenhum codigo de dominio (`invalid_*`, `shipping_disabled`, etc.) neste handler.

Contrastar com `POST /shipping/v1/calculate` + `country=US` → **400** `country_not_supported`. O front US **nao** deve chamar calculate.

---

## 5) Hooks e filters do WordPress

### 5.1 Especificos HSR (esta rota)

| Tipo | Hook | Onde | Efeito |
|---|---|---|---|
| action | `rest_api_init` | `Plugin::boot` | registra a rota |
| action | `admin_menu` | `ShippingAdminPage` | UI que grava `hsr_shipping_settings` |

Nenhum `apply_filters` no GET. `hsr/shipping_nominatim_user_agent` **nao** roda aqui (nao ha Nominatim).

Filters `hsr/onboarding_*` nao se aplicam.

### 5.2 Core WP envolvidos

| Hook / API | Uso |
|---|---|
| `register_rest_route` | GET publico |
| `get_option('hsr_shipping_settings')` | leitura (2× no ramo US: repository no handler + de novo dentro de `forUs`) |
| `rest_ensure_response` | envelope 200 |
| `update_option(..., false)` | so no admin, nao neste GET |

Woo / Stripe / sessao: nao.

---

## 6) Dependencias e efeitos colaterais

### 6.1 O que e lido

- Query: `country`.
- Option `hsr_shipping_settings`:
  - ramo US: `us.enabled`, `us.cost`, `us.label`, `us.carrier`, `us.delivery`
  - ramo BR: `br.enabled`, `br.label`, `br.rule.per_km`

Defaults se a option estiver vazia (trecho US):

```php
'us' => [
  'enabled' => true,
  'cost' => 12.90,
  'carrier' => 'FedEx',
  'delivery' => '3–5 business days',
  'label' => 'FedEx 3–5 business days',
]
```

### 6.2 O que e gravado

Nada. Sem transient, sem sessao, sem rate-limit hit, sem rewrite de pets.

### 6.3 Consumidores posteriores (efeito diferido, no front / outras rotas)

| Consumidor | Uso |
|---|---|
| Front `fetchUsFixedShippingSettings` | monta a unica opcao US (cost/label/carrier/delivery) |
| `POST .../shipping/select` | se o front ecoar um rate derivado daqui (`fixed_us:default`, `cost`, `label`) |
| `POST .../shipping/quote` (US) | **nao** chama este GET; chama `forUs()` in-process |
| Checkout | so apos select; usa o snapshot, nao relê a option na hora do pedido |

Se o admin mudar `us.cost` **depois** do select e **antes** do checkout, o pedido fica com o `cost` antigo (trust-the-client no select). Esta rota sempre devolve o valor **atual** da option.

### 6.4 Sem efeitos em

- ViaCEP / Nominatim / OSRM
- `ShippingRateLimiter` / transients `hsr_ship_*`
- sales tax (US tax e o quote/select autenticado)
- `br.center` / regras de KM (exceto `per_km` no DTO BR)

---

## 7) Pontos de atencao para reimplementacao em Node

1. **Publico e barato, mas expoe preco.** Sem auth e sem rate limit. No Node, um GET de config (CDN/cache) basta; nao precisa de sessao se o front US atual nao manda token. Se quiser esconder `enabled: false`, continue devolvendo 200 + flag — nao 404 — para nao quebrar o cliente.

2. **DTO US != rate de onboarding.** Settings: `country, enabled, cost, label, carrier, delivery, currency`. Rate: `rate_id, method_id, instance_id, tax_total, total`. O PHP publico nao manda `rate_id`. Front provavelmente hardcoda `fixed_us:default` / `fixed_us` ou usa o quote autenticado. Replicar o recorte para `fetchUsFixedShippingSettings` nao quebrar.

3. **Duas entradas US.** `GET /settings?country=US` (sem sessao) vs `POST .../shipping/quote` (com sessao, tax, `rates[]`). Um servico de dominio `getUsFixedQuote()` e dois adapters.

4. **`enabled` e so informativo no backend.** Quote e select US nao respeitam `us.enabled`. Se o Node passar a recusar `enabled=false`, e **correcao**, nao copia. Combinar com o front (esconder o passo vs 422).

5. **Sem ZIP, sem tax, sem distancia.** Nao chamar Avalara/Stripe Tax / FedEx API neste GET. Tarifa e numero no banco/config, igual a option WP.

6. **Country gate e estrito `=== 'US'`.** `USA`, `United States`, vazio → DTO BR. Front deve mandar exatamente `US`. Query `country=us` ok (uppercase).

7. **Defaults com en-dash.** `3–5 business days` (U+2013). O parser de dias do **select** procura a keyword `business` e extrai `\d+` → min 3, max 5. Trocar o label no Node para `3-5` (hifen) ainda funciona (`\d+`). Tirar `business`/`days` zera o range se o front nao mandar `delivery_days`.

8. **`round(cost, 2)` no mapper, nao na option crua.** Admin pode gravar 12.9; JSON devolve 12.9. Manter 2 casas.

9. **Double `get_option` no ramo US.** Cosmetico. No Node, um read.

10. **`autoload=false`.** Settings nao vem no `alloptions`. Cachear em memoria/Redis com invalidacao no save admin.

11. **Nao misturar com calculate.** US jamais deve ir para OSRM. BR nesta rota nao substitui calculate (nao ha `shipping` em reais).

12. **Select continua trust-the-client.** Este GET nao amarra o `cost` a um quote assinado. Admin baixa o preco, front antigo ainda manda 12.9 no select, checkout cobra 12.9. Fiel ao PHP; seguro seria TTL server-side (comportamento novo).

13. **Sem i18n de erro** neste handler. Messages de `forUs` nao passam por `__()`.

14. **Admin e a fonte.** Tela Frete / tab US (`cost`, `carrier`, `delivery`, `label`, checkbox ativo). Migrar para tabela `shipping_settings` (ou env so se o produto aceitar redeploy para mudar tarifa). O PHP permite ops mudar FedEx sem deploy.

15. **Contrato sugerido:** `GET /api/v1/shipping/settings?country=US` com o mesmo `data` (incluindo `enabled` mesmo quando false). Opcional: `GET ...?country=BR` com `per_km` para painel/debug; o funil BR nao depende disso.

16. **Testes a adicionar** (hoje inexistentes): default 12.9; `country=us`; `country=` → BR; `enabled=false` ainda traz `cost`; `forUs` arredonda; nao chama HTTP.

---

## 8) Relacao com calculate, quote e select

Fluxo feliz US:

```
1. POST .../zipcode                      → grava endereco (ZIP US)
2. GET /shipping/v1/settings?country=US  → tarifa fixa para a UI          ← esta rota
   e/ou
   POST .../shipping/quote               → rates[] + product_tax
3. POST .../shipping/select              → persiste o rate (eco do passo 2)
4. checkout                              → WC_Order_Item_Shipping / Stripe
```

Fluxo feliz BR **nao** depende deste GET para o preco (usa `POST /shipping/v1/calculate`). O GET BR so revela `per_km` se o front pedir.

Compare:

| | Calculate (BR) | Settings (US) |
|---|---|---|
| Auth | publica | publica |
| Side effects | cache + rate limit | nenhum |
| HTTP externo | ViaCEP + Nominatim + OSRM | nenhum |
| Falha de cobertura | 422 `out_of_coverage` | impossivel |
| Shape | `distance`, `shipping`, `delivery_days` | `cost`, `label`, `carrier`, `delivery` |
| `enabled=false` | 422 `shipping_disabled` | 200 + `enabled: false` |
