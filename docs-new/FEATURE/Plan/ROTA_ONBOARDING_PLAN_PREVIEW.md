# Rota atual: Onboarding Plan Preview

## Escopo

Rota atual no backend Node:

- `POST /api/v1/onboarding/plan/preview`

Origem no front-end:

- `eden-bowls/src/services/onboardingApi.ts` (`fetchPlanPreviewFromApi`)

Arquivos principais:

- `src/api/routes/onboarding-plan-preview.routes.js`
- `src/api/validators/onboarding-plan-preview.validator.js`
- `src/services/onboarding-plan-preview.service.js`
- `src/infrastructure/repositories/onboarding-plan-preview.repository.js`
- `src/infrastructure/repositories/onboarding-quotes.repository.js`
- `src/infrastructure/repositories/onboarding-recommendation.repository.js`
- `src/infrastructure/repositories/products.repository.js`
- `src/infrastructure/entities/onboarding-quote.entity.js`
- `src/infrastructure/migrations/1700000000006-create-onboarding-quotes-table.js`
- `src/core/flavors.js`
- `src/core/simplified-consumption.js`
- `src/core/plan-catalog-pricing.js`
- `tests/onboarding-plan-preview.routes.test.js`
- `tests/onboarding-plan-preview.service.test.js`
- `tests/onboarding-plan-preview.repository.test.js`
- `tests/plan-catalog-pricing.test.js`
- `tests/onboarding-quotes.repository.test.js`

Rota legado WordPress (substituida):

- `POST /custom/v1/onboarding/session/:sessionId/plan/preview`

Nao ha `session_id` na URL nem na resposta. Nao ha `x-session-token`.

## Responsabilidade

Devolver o **preco mensal** da assinatura para a UI `/mes` **sem persistir** `plan_selection`, e gravar um **quote** temporario em `onboarding_quotes` (TTL 10 min) para o checkout reutilizar o mesmo pricing.

Diferenca essencial para `plan-selection`: preview nao grava o plano no usuario; so cria quote.

Esta rota **nao** devolve consumo (`kg/mês`, packs). Consumo vem de `GET /api/v1/onboarding/recommendation` ou `GET /api/v1/onboarding/plan/snapshot`.

Nao confundir com `POST /api/v1/onboarding/subscription/preview` (imposto Stripe, somente US).

## Estado de implementacao

| Parte | Status |
|---|---|
| Endpoint publico + rate limit 30/min | implementado |
| Mercado (`country` / `domain` / headers) | implementado |
| Validacao Zod do payload | implementada |
| Persistencia de quote | implementada |
| Pricing / catalogo / recommendation | implementado |
| Regras semanticas 422 (sabores/pesos/match) | implementado |
| Contrato 502 (subtotal / totais por pet) | implementado |
| Desconto de prazo no first month | **nao aplicar** (mesmo no contrato final) |

O repository casa sabores/pesos com o catalogo `flavors` (fallback `listFlavorVariations`) e devolve o subtotal real. A moeda segue o mercado da Home: `USD` em `.com` / `US`, `BRL` em `.com.br` / `BR`.

O restante deste documento e o contrato Node de como o pricing calcula.

## Endpoint, controller e permissao

### Registro

- Path: `/api/v1/onboarding/plan/preview`
- Method: `POST`
- Rate limit proprio: 30 req / 60s (`express-rate-limit`)
- Registrar: `registerOnboardingPlanPreviewRoutes`
- Validator: `parseOnboardingPlanPreviewInput` (Zod) + regras semanticas no service
- Service: `OnboardingPlanPreviewService.previewPlan` (`persist = false`)

### Controller

1. Exige service injetado (`503`).
2. Resolve mercado com `parseRequestMarket(request, body)`.
3. Valida body com `parseOnboardingPlanPreviewInput` (Zod).
4. Chama `previewPlan({ userId, payload, market })`.
   - `userId` vem de `request.currentUser.id` se houver JWT.
   - Sem JWT, `userId` e `null`.
5. Responde `200` com o envelope.

**Nao exige autenticacao.** As cinco rotas de plano sao publicas; esta e a que tambem persiste quote com `user_id` nulo.

## Autenticacao

JWT e opcional. A rota **nao** devolve `401` sem Bearer.

```http
Authorization: Bearer <jwt-de-usuario>
```

- Sem JWT: `userId = null`. Preview publico. Quote com `user_id = null`. Precificacao usa so o body + catalogo (nao exige pets no banco). Pack size cai no fallback `300` g.
- Com JWT valido: `userId = request.currentUser.id`. Quote associado ao usuario. Pack size e match de pets vêm da recommendation em `onboarding_pets`.
- JWT invalido: o middleware rejeita antes da rota.

Nao ha `x-session-token`. Nao ha `session_id`.

## Fluxo da requisicao

Contrato Node (o que o service/repository devem fazer):

```
POST /api/v1/onboarding/plan/preview
  │
  ├─ 1. Rate limit 30/min                  → 429
  ├─ 2. Mercado (country/domain/headers)
  ├─ 3. Zod parseOnboardingPlanPreviewInput → 400
  └─ 4. previewPlan({ userId ou null, payload, market })
        │
        ├─ resolvePlanSelection(..., persist=false)
        │    ├─ revalida prazo              → 422 invalid_subscription_term
        │    ├─ getRecommendation(userId)   → pets [] se userId null
        │    ├─ casa pets do body
        │    │    • com JWT: vs simplified.pets[]
        │    │    • sem JWT: usa o proprio body (sem mismatch de recommendation)
        │    ├─ monta catalogLineRequests (sabor + qtd packs + pack_size)
        │    └─ buildCatalogPricingSnapshot
        │         └─ ProductsRepository.listByCategory('flavors')
        │            fallback: listFlavorVariations(country)
        │
        ├─ buildPlanPreviewResponse(resolved)
        │    ├─ grand_total = catalog_pricing.subtotal
        │    ├─ agrega line_items por pet_id
        │    └─ 502 se subtotal <= 0 ou sem totais por pet
        │
        └─ createQuote (TTL 10 min)        → quote_id na resposta
```

O preview **nao grava** `onboarding_user_state.plan_selection`.  
Para persistir a escolha, o cliente chama `POST /api/v1/onboarding/plan-selection` com o mesmo body (persistencia so com JWT).

Sem escrita de questionnaire. A recommendation Node usa os campos do pet (`activity_level`, `pet_condition`, `neutered`) e nao hidrata sessao.

## Parametros

### Headers

- `Content-Type: application/json`
- `Authorization: Bearer <jwt>` (opcional)
- `X-Eden-Country` / `X-Eden-Domain` (opcionais)

### Mercado

Mesmo contrato das outras rotas de plano (`parseRequestMarket` / `resolveMarket`):

1. `domain=com.br` ou `X-Eden-Domain: com.br` → `BR` / `BRL`
2. `domain=com` → `US` / `USD`
3. `country=BR|US` no body, query ou `X-Eden-Country`
4. fallback → `US` / `USD`

Pais invalido → `400`.

### Body

```json
{
  "subscription_term_months": 1,
  "pets": [
    {
      "pet_id": "pet-1",
      "pet_name": "Luna",
      "enabled": true,
      "selected_flavors": ["beef"],
      "flavor_weights": [8]
    }
  ]
}
```

| Campo | Obrigatorio | Regras |
|---|---|---|
| `subscription_term_months` | sim | Inteiro. Somente `1`, `3` ou `6`. |
| `pets` | sim | Array nao vazio, max 20. |
| `pets[].enabled` | sim (Zod) | Boolean. Se `false`, o pet e ignorado. |
| `pets[].pet_id` | recomendado | Usado para casar com a recommendation quando ha JWT. |
| `pets[].pet_name` | sim | Match case-insensitive se `pet_id` nao casar. |
| `pets[].selected_flavors` | sim (pet enabled) | Array nao vazio de slugs (`beef`, `fish`, `pork`, `turkey`). |
| `pets[].flavor_weights` | sim (pet enabled) | Array numerico com **o mesmo length** de `selected_flavors`. Pelo menos um valor `> 0`. |
| `country` / `domain` | nao | Mercado da Home. |

Schema Zod (`onboarding-plan-preview.validator.js`):

- `subscription_term_months`: literal `1 | 3 | 6`
- `pets`: array `min(1)` `max(20)`
- cada pet:
  - `pet_id` opcional, string ate 64
  - `pet_name` obrigatorio, 1–120
  - `enabled` boolean obrigatorio
  - `selected_flavors` array de strings, max 20
  - `flavor_weights` array de numeros finitos `>= 0`, max 20
  - `country` / `domain` opcionais no payload raiz

O validator **nao** exige `selected_flavors` nao vazio nem `flavor_weights.length === selected_flavors.length`. Essas regras semanticas ficam no service (`422`).

## Semantica de `flavor_weights`

Cada peso e **quantidade de packs** daquele sabor (nao percentual).

Pipeline:

1. `weight` do indice `i` associa ao sabor `selected_flavors[i]`.
2. Pesos `<= 0` sao descartados.
3. Slug do sabor e normalizado (`trim` + `toLowerCase` + slug).
4. Pesos do mesmo sabor sao somados.
5. Quantidade enviada ao catalogo: `(int) Math.round(weight)`.

O tamanho do pack **nao vem do body**.

- Com JWT: `simplified.pets[].packs.pack_size_grams` da recommendation (300 g ou 500 g).
- Sem JWT: fallback `300` g.

Regra do pack recomendado (30 dias, igual a `selectLocalPackForMonth`):

```
usa_pack_500    = (monthly_grams / 300) > 8
pack_size_grams = usa_pack_500 ? 500 : 300
```

## Validacoes

| Camada | Regra | HTTP | Status |
|---|---|---|---|
| Rota | rate limit 30/min | 429 | implementado |
| Rota | mercado invalido | 400 | implementado |
| Validator | schema Zod | 400 | implementado |
| Service | repository de preview | 503 | implementado |
| Service | `quotesRepository` | 503 | implementado |
| Quotes repo | DataSource inicializado | 503 | implementado |
| Service | prazo 1/3/6 (segunda checagem) | 422 `invalid_subscription_term` | implementado |
| Service | pet enabled sem sabores / pesos inconsistentes | 422 `invalid_plan_preview_payload` | implementado |
| Service | nenhum pet enabled apos filtro | 422 `invalid_plan_selection` | implementado |
| Service | pet/sabor/pack/peso nao casa | 422 `plan_selection_snapshot_mismatch` | implementado |
| Catalogo | `listByCategory('flavors')` falhou | 422 `catalog_pricing_unavailable` | implementado |
| Contrato | subtotal `<= 0` ou nenhum total por pet | 502 `invalid_plan_preview_contract` | implementado |

Zod na rota (`400` `Invalid request payload.`):

- prazo fora de `{1,3,6}`
- `pets` ausente/vazio/nao-array
- `pet_name` vazio
- `enabled` nao boolean
- arrays acima do maximo

Regras semanticas no service (`422` `invalid_plan_preview_payload`), pets `enabled: false` pulados:

- pet enabled sem sabores → `pets.{i}.selected_flavors`
- `flavor_weights` ausente, nao-array, ou length diferente dos sabores → `pets.{i}.flavor_weights`
- peso nao numerico, ou todos `<= 0` → `pets.{i}.flavor_weights`

A resposta 422 inclui `errors` com as chaves acima.

Codigos de sessao WordPress **nao existem** nesta rota: `session_unauthorized`, `session_token_*`, `session_forbidden`, `session_not_found`, `pets_required`. Rotas de plano publicas devolvem vazio ou mismatch, nunca exigem sessao.

## Resolucao da selecao (`resolvePlanSelection`)

`persist = false`. A estrutura montada e a mesma que `plan-selection` usaria, mas so serve para a resposta e para o JSON do quote. Nao chama o repository de `plan-selection`.

### Recommendation interna

Chama `OnboardingRecommendationRepository.getRecommendation(userId, market)` — o mesmo calculo de `GET /recommendation`.

| Contexto | Comportamento |
|---|---|
| Sem JWT | `pets = []`. Nao e erro. Preview segue so com o body. |
| Com JWT, sem pets em `onboarding_pets` | `simplified.pets = []`. Pets do body nao casam → `422 plan_selection_snapshot_mismatch`. |
| Com JWT, com pets | `buildForPet` + `buildSimplifiedRecommendation` (periodo 30 dias). |

Se `simplified.pets` vier vazio **e** houver JWT, o match de cada pet enabled falha (mismatch). Sem JWT isso nao se aplica.

### Match de pets

Para cada item de `payload.pets` com `enabled !== false`:

**Com JWT:**

1. Resolve `pet_id` / `pet_name`.
2. Primeiro por `pet_id` identico; senao por `pet_name` case-insensitive.
3. Sem match → `422 plan_selection_snapshot_mismatch`.

**Sem JWT:**

Nao consulta recommendation. O `pet_id` / `pet_name` do body entram direto no `catalogLineRequest`.

Pets `enabled: false` sao pulados. Itens que nao sao objeto tambem.

### Sabores e pesos

1. `selected_flavors` passa por lista sanitizada (`trim`, lowercase, unique).
2. `flavor_weights` vira indices reindexados.
3. Se listas vazias ou lengths diferentes → `422 plan_selection_snapshot_mismatch`.
4. Para cada par sabor/peso:
   - peso `<= 0` ignorado;
   - slug vazio ignorado;
   - pesos do mesmo slug somados.
5. Sem nenhum peso positivo restante → mismatch.
6. Com JWT: `packs.pack_size_grams` do pet da recommendation `<= 0` → mismatch.

`sanitize` remove duplicatas. Se o cliente enviar o mesmo sabor duas vezes, o length pode divergir de `flavor_weights` e a rota falha com mismatch.

Slugs Node do catalogo atual: `beef`, `fish`, `pork`, `turkey`. Sabor fora dessa lista falha no passo de catalogo.

### Pedidos de linha para o catalogo

Um `catalogLineRequest` por sabor com peso positivo:

| Campo | Origem |
|---|---|
| `pet_id` | pet casado na recommendation, ou o do body se anonimo |
| `pet_name` | recommendation (fallback: payload) |
| `flavor` | slug normalizado |
| `quantity` | `Math.round(weight)` como inteiro |
| `target_pack_size_grams` | recommendation, ou `300` se anonimo |

Se, ao final, nao houver nenhum request (todos disabled / pesos zero) → mismatch.

### Estrutura interna (nao persistida em `plan_selection`)

```
plan_selection = {
  subscription_term_months,
  catalog_pricing,
  flavors_by_pet[],
  pets[],
  validated_with: { recommendation_version, validated_at },
  updated_at
}
```

`previewPlan` usa isso so para montar a resposta e o JSON `pricing` do quote.

## Precificacao (`buildCatalogPricingSnapshot`)

### Catalogo

Fonte primaria: `ProductsRepository.listByCategory({ categorySlug: 'flavors', country, currency })` — o mesmo catalogo de `GET /api/v1/products`.

Se o catalogo DB nao estiver inicializado (`catalog_not_initialized` / tabelas ausentes), fallback local:

```
listFlavorVariations(country)   // src/core/flavors.js
```

| Mercado | Packs | Precos (beef / fish / pork / turkey) |
|---|---|---|
| BR | `300g`, `500g` | 25 / 35 / 25 / 22.5 e 45 / 65 / 45 / 42.5 |
| US | `10.6oz`, `17.6oz` | mesmos valores em USD |

Erro real do catalogo (query falhou, categoria `flavors` inexistente) → `422 catalog_pricing_unavailable`.

Catalogo vazio **e** fallback local vazio → `502 invalid_plan_preview_contract` (subtotal `<= 0`).

Indexa variacoes por sabor + peso:

- sabor: `variation.flavor`, fallback primeira tag do produto;
- peso: label (`500g`, `500 g`, `10.6oz`, `17.6 oz`) parseado para gramas (`oz * 28.3495`);
- preco: `variation.price`.

### Match sabor / pack

Para cada `catalogLineRequest`:

1. `quantity <= 0` ou `target_pack_size_grams <= 0` → pula a linha.
2. Sabor ausente no catalogo → `422 plan_selection_snapshot_mismatch`.
3. Escolhe a variacao com **menor distancia em gramas** ao pack alvo; empate → menor preco.
4. Sem variacao valida → mismatch.
5. `line_total = round(unit_price * quantity, 2)`.
6. Soma no `subtotal`.

Line item gerado:

```json
{
  "pet_id": "pet-1",
  "pet_name": "Luna",
  "flavor": "beef",
  "quantity": 8,
  "pack_size_grams": 500,
  "pack_size_label": "500 g",
  "variation_id": 1005,
  "product_id": 100,
  "currency": "BRL",
  "unit_price": 45,
  "line_total": 360
}
```

`pack_size_label` segue o mercado: BR em gramas (`500 g`); US em oz (`17.6 oz`).

### Desconto de prazo — nao aplicar

`subscription_term_months` e aceito, validado e ecoado na resposta.

`GET /plan/snapshot` expoe `plan_terms`:

| `subscription_term_months` | `discount_percent` |
|---|---|
| 1 | 10 |
| 3 | 25 |
| 6 | 40 |

**O preview nao aplica esse desconto.**  
O prazo entra na estrutura e nao e usado no calculo.  
`discounted_first_month_total = subtotal`.  
`first_month_total = grand_total_monthly`.

O total e o preco de catalogo `unit_price × packs`, sem promocao de prazo e sem imposto/frete.

`GET /discount/eligibility` tambem **nao entra** neste calculo.

### Resumo da logica de preco

```
grand_total_monthly
  = soma( unit_price_catalogo(sabor, pack_mais_proximo_do_alvo) × qtd_packs )
  = catalog_pricing.subtotal
  = first_month_total
```

Onde:

- `qtd_packs` = `flavor_weights` arredondados;
- `pack_alvo` = `simplified.pets[].packs.pack_size_grams` se houver JWT/pet, senao `300`;
- `unit_price` = variacao `flavors` do mercado (`ProductsRepository` ou `FLAVOR_CATALOG`);
- desconto de prazo (10/25/40%), imposto e frete **nao entram**;
- JWT **nao e obrigatorio**.

## Contrato da resposta publica (`buildPlanPreviewResponse`)

Envelope HTTP 200:

```json
{
  "success": true,
  "data": { }
}
```

### Regras de contrato (502 se falhar)

1. `catalog_pricing.subtotal` arredondado, `Math.max(0, ...)`. Se `<= 0` → `invalid_plan_preview_contract` (missing grand total).
2. `first_month_total` e igual ao grand total; se `<= 0` → mesmo code (missing first month total).
3. Agrega `line_items` por `pet_id` somando `line_total`. Ignora item sem `pet_id` ou com `line_total <= 0`.
4. Sem nenhum total por pet → `invalid_plan_preview_contract` (missing per-pet totals).

### Campos de `data`

| Campo | Tipo | Significado |
|---|---|---|
| `subscription_term_months` | int | Prazo enviado (1, 3 ou 6) |
| `country` | string | `BR` ou `US` |
| `currency` | string | `BRL` ou `USD` |
| `grand_total` | number | Alias do mensal |
| `grand_total_monthly` | number | **Campo principal da UI `/mes`** |
| `first_month_total` | number | Hoje igual ao mensal |
| `totals.*` | number | Alias dos tres valores |
| `pricing.*` | number | Alias dos tres valores |
| `pets[]` | array | Totais **monetarios** por pet |
| `pets[].pet_id` | string | |
| `pets[].pet_name` | string | |
| `pets[].monthly_total` | number | Soma das line items daquele pet |
| `pets[].total` | number | Alias de `monthly_total` |
| `pets[].first_month_total` | number | Alias de `monthly_total` |
| `line_items[]` | array | Detalhe de catalogo |
| `quote_id` | string | `q_` + UUID sem hifens |
| `quote_expires_at` | string | ISO; agora + 600s |
| `quote_payload_hash` | string | SHA-256 do payload canonicalizado |

`data.pets[]` nesta rota e **preco**, nao consumo. Nao existem `daily`, `monthly.formatted` nem `packs`.

Nao existe `session_id`.

Formatacao `R$ 299 /mês` e responsabilidade do cliente (`currency` + `grand_total_monthly`).

### Exemplo (JWT, pet com 8 packs de 500 g beef, BR)

```json
{
  "success": true,
  "data": {
    "subscription_term_months": 1,
    "country": "BR",
    "currency": "BRL",
    "grand_total": 360,
    "grand_total_monthly": 360,
    "first_month_total": 360,
    "totals": {
      "grand_total": 360,
      "grand_total_monthly": 360,
      "first_month_total": 360
    },
    "pricing": {
      "grand_total": 360,
      "grand_total_monthly": 360,
      "first_month_total": 360
    },
    "pets": [
      {
        "pet_id": "pet-1",
        "pet_name": "Luna",
        "monthly_total": 360,
        "total": 360,
        "first_month_total": 360
      }
    ],
    "line_items": [
      {
        "pet_id": "pet-1",
        "pet_name": "Luna",
        "flavor": "beef",
        "quantity": 8,
        "pack_size_grams": 500,
        "pack_size_label": "500 g",
        "variation_id": 1005,
        "product_id": 100,
        "currency": "BRL",
        "unit_price": 45,
        "line_total": 360
      }
    ],
    "quote_id": "q_a1b2c3",
    "quote_expires_at": "2026-08-16T22:00:00.000Z",
    "quote_payload_hash": "sha256-hex"
  }
}
```

Sem JWT o shape e o mesmo. `pet_id` / `pet_name` vêm do body; `pack_size_grams` cai em `300` se nao houver recommendation.

Payload invalido `400`:

```json
{
  "success": false,
  "message": "Invalid request payload.",
  "details": [/* issues Zod */]
}
```

## Persistencia do quote

Tabela `onboarding_quotes` (migration `1700000000006`):

| Coluna | Uso |
|---|---|
| `id` | `q_` + UUID sem hifens |
| `user_id` | JWT ou `null` |
| `payload_hash` | SHA-256 do payload com chaves ordenadas |
| `payload` | JSON enviado |
| `pricing` | JSON da resposta (antes de anexar metadados do quote) |
| `status` | `active` na criacao |
| `expires_at` | agora + 600s |
| `consumed_at` | preenchido por `consumeQuote` |

Canonicalizacao: objetos tem chaves ordenadas antes do hash, para o mesmo payload gerar o mesmo `payload_hash` independente da ordem das keys.

O repository de quotes tambem expoe:

- `findActiveQuote(id)` — `status = active` e `expires_at > now`
- `consumeQuote(id)` — marca `consumed` uma unica vez

Nenhuma outra rota de onboarding consome o quote ainda. A infraestrutura ja esta pronta para checkout.

Preview **nao** grava `onboarding_user_state.plan_selection`.

## Erros

| HTTP | code | Quando |
|---|---|---|
| 400 | Zod `Invalid request payload.` | schema (termo, pets vazio, tipos) |
| 400 | market | pais/dominio invalido |
| 422 | `invalid_plan_preview_payload` | sabores/pesos semanticos |
| 422 | `invalid_subscription_term` | prazo nao e 1/3/6 (segunda checagem) |
| 422 | `invalid_plan_selection` | payload sem pets enabled apos filtro |
| 422 | `plan_selection_snapshot_mismatch` | pet, sabor, pack ou peso nao casa |
| 422 | `catalog_pricing_unavailable` | `listByCategory('flavors')` falhou |
| 429 | rate limit | 30 req / 60s |
| 502 | `invalid_plan_preview_contract` | subtotal `<= 0` ou nenhum total por pet |
| 503 | — | service / repository / DataSource ausente |

Mensagens tipicas em `plan_selection_snapshot_mismatch.errors.pets`:

- pet nao encontrado na recommendation atual (so com JWT)
- distribuicao de sabores inconsistente
- pet enabled sem sabor com peso positivo
- pack size recomendado ausente (so com JWT)
- nenhum pet enabled com pesos validos
- sabor fora do catalogo
- pack size indisponivel para o sabor

## Relacao com outras rotas Node

| Rota | Relacao |
|---|---|
| `GET /onboarding/recommendation` | Com JWT, preview chama internamente. Origem de `pack_size_grams` e do match de pets. |
| `GET /onboarding/plan/snapshot` | Tela de plano: consumo + `flavor_options` + `plan_terms`. **Nao devolve preco.** |
| `POST /onboarding/plan-selection` | Mesmo body. Preview e dry-run; selection persiste so com JWT. |
| `POST /onboarding/subscription/preview` | Imposto Stripe (US). Nao substitui esta rota. |
| `GET /onboarding/discount/eligibility` | Elegibilidade de usuario. Nao entra no calculo deste preview. |
| `GET /products?category_slug=flavors` | Catalogo de variacoes/precos usado no match. |

Fluxo tipico:

```
GET  /api/v1/onboarding/plan/snapshot      → consumo + sabores + prazos
POST /api/v1/onboarding/plan/preview       → preco /mes + quote (nao persiste plano)
POST /api/v1/onboarding/plan-selection     → grava a selecao (so com JWT)
```

## Camadas

| Camada | Classe / funcao | Papel |
|---|---|---|
| Route | `registerOnboardingPlanPreviewRoutes` | rate limit + mercado + Zod + `userId` opcional |
| Validator | `parseOnboardingPlanPreviewInput` | schema de entrada |
| Service | `OnboardingPlanPreviewService.previewPlan` | resolucao + contrato + quote |
| Preview repo | `OnboardingPlanPreviewRepository.previewPlan` | match + catalogo + totais |
| Recommendation repo | `OnboardingRecommendationRepository.getRecommendation` | pack size / match (so com JWT) |
| Products repo | `ProductsRepository.listByCategory` | precos `flavors` |
| Flavors | `listFlavorVariations(country)` | fallback de catalogo |
| Quotes repo | `OnboardingQuotesRepository.createQuote` | INSERT `onboarding_quotes` |
| Catalog pricing | `src/core/plan-catalog-pricing.js` | slug, pack match, snapshot, contrato 502 |

Wiring em `src/index.js`:

```js
const onboardingPlanPreviewRepository = new OnboardingPlanPreviewRepository({
  recommendationRepository: onboardingRecommendationRepository,
  productsRepository
});
const onboardingQuotesRepository = new OnboardingQuotesRepository(dataSource);
const onboardingPlanPreviewService = new OnboardingPlanPreviewService(
  onboardingPlanPreviewRepository,
  { quotesRepository: onboardingQuotesRepository }
);
```

## Consumo no front

O cliente exige `grand_total` / `grand_total_monthly`, `first_month_total` e totais por pet. Campos de quote sao extras.

Campo a renderizar na UI `/mes`: `data.grand_total_monthly` (aliases em `data.totals` e `data.pricing`).

## Diferencas em relacao ao WordPress

| Tema | WordPress | Node |
|---|---|---|
| URL | `/session/:sessionId/plan/preview` | `/plan/preview` |
| Auth | token de sessao obrigatorio | publica; JWT opcional |
| Persistencia | nenhuma (so side effect de questionnaire) | quote em `onboarding_quotes` |
| Pricing | catalogo CMPB + WCPBC | catalogo `flavors` + fallback `listFlavorVariations` |
| Pack size | recommendation da sessao | recommendation do usuario se JWT; senao `300` g |
| Validacao vs recommendation | mismatch 422 | contrato: so com JWT |
| Totais zero | 502 contrato | contrato: `invalid_plan_preview_contract` |
| `session_id` | presente | removido |
| Quote | nao existia | `quote_id` + TTL 10 min |
| Desconto de prazo | nao no preview | **nao aplicar** |
| Imposto / frete | nao | **nao aplicar** |

## Testes existentes

`tests/onboarding-plan-preview.routes.test.js`:

1. Cria quote **sem** Bearer; service recebe `userId: null` e `market: US`.
2. Body com `country: BR` encaminha `market: BR`.
3. Payload invalido (`term = 2`, `pets = []`) retorna `400` e nao chama o service.
4. HttpError semantico devolve `code` e `data.errors`.

`tests/onboarding-plan-preview.service.test.js`:

1. Quote anonimo com totais de catalogo.
2. 422 `invalid_plan_preview_payload` / `invalid_plan_selection` / `invalid_subscription_term`.
3. 502 `invalid_plan_preview_contract` nao cria quote.

`tests/onboarding-plan-preview.repository.test.js`:

1. Anonimo usa pack 300 g; JWT casa o pet e usa 500 g.
2. Prazo 6 meses nao aplica desconto.
3. Catalogo DB, fallback `catalog_not_initialized`, e 422 `catalog_pricing_unavailable`.
4. JWT sem pet na recommendation e sabores duplicados → mismatch.

`tests/plan-catalog-pricing.test.js` cobre slug, parse de peso, match BR 500 g e contrato 502.

`tests/onboarding-quotes.repository.test.js`:

1. INSERT aceita `user_id` nulo.
2. `consumeQuote` so atualiza quote `active` e nao expirado.
