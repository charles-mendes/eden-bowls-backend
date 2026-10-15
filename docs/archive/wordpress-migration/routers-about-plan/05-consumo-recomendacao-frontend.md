# Consumo e precificacao mensal (rotas do front-end)

Documentacao das rotas REST que alimentam, no onboarding, os blocos:

- **Por dia**
- **Por mes**
- **Pacotes**
- **`/mes`** (sufixo de consumo ou preco da assinatura)

Fonte da logica: plugin `headless-secure-registration`.

- API: `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php`
- Servico: `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php`
- Calculo nutricional: `wp/wp-content/plugins/headless-secure-registration/src/class-nutrition-recommendation-service.php`

Namespace: `custom/v1`  
Base: `{WP_URL}/wp-json`

Este repositorio e o backend headless. O app React (front) consome estas rotas; os rotulos visuais **Por dia / Por mes / Pacotes** sao do front. A API envia `Diario / Mensal / Packs` (BR) ou `Daily / Monthly / Packs` (US).

---

## 1) Qual rota preenche o que

| UI no front | Tipo | Rota | Campo da resposta |
|---|---|---|---|
| **Por dia** | consumo | `GET .../recommendation` | `data.simplified.pets[].daily.formatted` |
| **Por mes** | consumo | `GET .../recommendation` | `data.simplified.pets[].monthly.formatted` |
| **Pacotes** | consumo | `GET .../recommendation` | `data.simplified.pets[].packs.formatted` |
| **`/mes`** (unidade de consumo) | sufixo ja incluso no texto | mesma rota | `kg/mes` e `g/mes` dentro de `formatted` |
| **Por dia / Por mes / Pacotes** (tela de plano) | consumo (espelho) | `GET .../plan/snapshot` | `data.consumption.pets[]` |
| **`/mes`** (preco, ex.: `R$ 299 /mes`) | monetario | `POST .../plan/preview` | `data.grand_total_monthly` |

Regra pratica:

1. Tela de recomendacao nutricional → **somente** `GET recommendation` → `data.simplified`.
2. Tela de escolha de plano (sabores + prazo) → `GET plan/snapshot` para consumo + catalogo; `POST plan/preview` para preco `/mes`.
3. Nao usar `data.recommendations` nem `data.packaging` para preencher esses tres blocos. Sao blocos legados.

---

## 2) Autenticacao comum

Todas as rotas abaixo exigem sessao de onboarding valida.

| Item | Valor |
|---|---|
| Path param | `session_id` |
| Header preferencial | `X-Session-Token: {session_token}` |
| Fallback | `Authorization: Bearer {session_token}` |
| Origem do token | `POST /custom/v1/onboarding/session/start` → `data.session_token` |
| Pre-requisito de consumo | pelo menos 1 pet na sessao (`POST .../pets`) |

Sem token: HTTP `401` (`session_unauthorized`).  
Sessao inexistente: HTTP `404` (`session_not_found`).  
Sessao sem pets (recommendation/snapshot): HTTP `422` (`pets_required`).

---

## 3) Rota principal — recomendacao simplificada

```
GET /wp-json/custom/v1/onboarding/session/{session_id}/recommendation
```

Handler: `OnboardingApi::get_recommendation` → `OnboardingService::get_recommendation`.

### 3.1 Comportamento

1. Carrega a sessao e valida que existe pelo menos 1 pet.
2. Se `questionnaire` ainda nao existir, **auto-hidrata** um questionario minimo a partir do primeiro pet (`activity_level`, `pet_condition`, `neutered`) e persiste na sessao.
3. Para cada pet, calcula a recomendacao nutricional (`NutritionRecommendationService::build_for_pet`) e obtem `quantidade_g_dia`.
4. Monta o bloco legado `packaging` (checkout; periodo depende da recorrencia).
5. Monta o bloco **`simplified`** (UI de consumo; periodo **sempre 30 dias**).

Pais do mercado (`BR` ou `US`):

1. `session.country` se for `BR` ou `US`;
2. senao, locale `pt` / `pt-BR` → `BR`;
3. fallback → `US`.

### 3.2 Mapeamento UI → API

O front deve preferir `*.formatted` (texto pronto para exibir). Os rotulos de coluna podem vir de `simplified.labels` ou ser fixos no i18n do app.

| UI | Label API (BR) | Label API (US) | Valor |
|---|---|---|---|
| Por dia | `Diario` | `Daily` | `pets[].daily.formatted` |
| Por mes | `Mensal` | `Monthly` | `pets[].monthly.formatted` |
| Pacotes | `Packs` | `Packs` | `pets[].packs.formatted` |

O sufixo `/mes` **nao e um campo separado**. Ele ja vem concatenado:

- mensal BR: `8,16 kg/mês`
- packs BR: `17 packs de 500 g/mês`

### 3.3 Logica de calculo do bloco `simplified`

Periodo fixo: `period_days = 30` (independente da recorrencia da sessao).

```
grams_per_day   = max(0, quantidade_g_dia)          // inteiro, arredondado no motor nutricional
monthly_grams   = grams_per_day * 30
usa_pack_500    = (monthly_grams / 300) > 8
pack_size_grams = usa_pack_500 ? 500 : 300
pack_count      = ceil(monthly_grams / pack_size_grams)
```

Selecao de pack: se o mes em packs de 300 g passar de 8 unidades, sobe para 500 g. Nao mistura tamanhos neste bloco (diferente do `packaging` legado).

Origem de `quantidade_g_dia` (resumo):

```
energia_kcal_dia = fator * peso_kg^0.75
quantidade_g_dia = round((energia_kcal_dia / nem_kcal_kg) * 1000)
```

O fator depende de especie, castracao, atividade, score corporal, raca e estado fisiologico. Detalhe no `NutritionRecommendationService`.

### 3.4 Formatacao por pais

Conversao US: `oz = grams * 0.035274`, arredondado em 1 casa decimal.

**BR**

| Campo | `value` | `unit` | `formatted` |
|---|---|---|---|
| `daily` | gramas/dia (int) | `g/dia` | `{n} g/dia` |
| `monthly` | kg com 2 casas | `kg/mês` | `{n} kg/mês` (virgula decimal) |
| `packs` | `count` + tamanho | — | `{n} packs de {size} g/mês` |

**US**

| Campo | `value` | `unit` | `formatted` |
|---|---|---|---|
| `daily` | oz/dia (1 casa) | `oz/day` | `{n} oz/day` |
| `monthly` | oz/mes (1 casa) | `oz/month` | `{n} oz/month` |
| `packs` | `count` + tamanho oz | — | `{n} × {size} oz/month` |

Packs US equivalentes: 300 g → 10.6 oz; 500 g → 17.6 oz.

### 3.5 Contrato de resposta (`data`)

```json
{
  "success": true,
  "data": {
    "session_id": "3abf4b2d-34f8-49f2-8d6e-6b9577beef00",
    "country": "BR",
    "recommendations": [],
    "packaging": {},
    "simplified": {
      "country": "BR",
      "period_days": 30,
      "labels": {
        "daily": "Diário",
        "monthly": "Mensal",
        "packs": "Packs"
      },
      "pets": [
        {
          "pet_id": "8b4ecdf5-cf37-463a-8a08-d8d8c7dbe10b",
          "pet_name": "Charles",
          "daily": {
            "value": 272,
            "unit": "g/dia",
            "grams": 272,
            "formatted": "272 g/dia"
          },
          "monthly": {
            "value": 8.16,
            "unit": "kg/mês",
            "grams": 8160,
            "formatted": "8,16 kg/mês"
          },
          "packs": {
            "count": 17,
            "pack_size_grams": 500,
            "pack_size_value": 500,
            "pack_size_unit": "g",
            "formatted": "17 packs de 500 g/mês"
          }
        }
      ]
    },
    "version": "v1"
  }
}
```

Definicao dos campos de `simplified.pets[]`:

| Campo | Tipo | Uso no front |
|---|---|---|
| `pet_id` | string | chave da linha / pet |
| `pet_name` | string | titulo da linha |
| `daily.value` | number | valor numerico (g ou oz) |
| `daily.unit` | string | unidade (`g/dia` / `oz/day`) |
| `daily.grams` | int | valor canonico em gramas |
| `daily.formatted` | string | **texto de Por dia** |
| `monthly.value` | number | kg (BR) ou oz (US) |
| `monthly.unit` | string | `kg/mês` / `oz/month` |
| `monthly.grams` | int | gramas no mes (sempre `g/dia * 30`) |
| `monthly.formatted` | string | **texto de Por mes** |
| `packs.count` | int | quantidade de packs no mes |
| `packs.pack_size_grams` | int | 300 ou 500 |
| `packs.pack_size_value` | number | 300/500 (BR) ou oz (US) |
| `packs.pack_size_unit` | string | `g` ou `oz` |
| `packs.formatted` | string | **texto de Pacotes** |

### 3.6 Exemplo curl

```bash
curl -sS -X GET "$BASE_URL/custom/v1/onboarding/session/$SESSION_ID/recommendation" \
  -H "X-Session-Token: $SESSION_TOKEN"
```

### 3.7 Erros

| HTTP | code | Quando |
|---|---|---|
| 401 | `session_unauthorized` | token ausente ou invalido |
| 404 | `session_not_found` | sessao nao existe |
| 422 | `pets_required` | nenhum pet na sessao |

---

## 4) Rota equivalente — snapshot do plano

```
GET /wp-json/custom/v1/onboarding/session/{session_id}/plan/snapshot
```

Handler: `OnboardingApi::get_plan_snapshot` → `OnboardingService::get_plan_snapshot`.

Reutiliza internamente `get_recommendation()`. Os dados de consumo sao **os mesmos** de `simplified`, reexpostos para a tela de plano.

### 4.1 O que retorna alem do consumo

- `flavor_options`: sabores do catalogo meal plan (`CMPB_Meal_Plan_Service`, categoria `flavors`)
- `plan_terms`: prazos de assinatura e desconto
- `currency`: `BRL` se pais `BR`, senao `USD`

Prazos fixos hoje:

| `subscription_term_months` | `discount_percent` |
|---|---|
| 1 | 10 |
| 3 | 25 |
| 6 | 40 |

### 4.2 Onde o front le o consumo nesta rota

```
data.consumption.labels
data.consumption.pets[]     // identico a simplified.pets[]
```

Tambem existem aliases:

- `data.labels` = mesmos labels
- `data.pets` = mesmos pets de consumo (nao confundir com a lista CRUD de pets da sessao)

### 4.3 Contrato resumido (`data`)

```json
{
  "success": true,
  "data": {
    "session_id": "...",
    "country": "BR",
    "currency": "BRL",
    "labels": { "daily": "Diário", "monthly": "Mensal", "packs": "Packs" },
    "consumption": {
      "labels": { "daily": "Diário", "monthly": "Mensal", "packs": "Packs" },
      "pets": [
        {
          "pet_id": "...",
          "pet_name": "Charles",
          "daily": { "formatted": "272 g/dia" },
          "monthly": { "formatted": "8,16 kg/mês" },
          "packs": { "formatted": "17 packs de 500 g/mês" }
        }
      ]
    },
    "pets": [],
    "flavor_options": [
      { "key": "frango", "label": "Frango" }
    ],
    "plan_terms": [
      { "subscription_term_months": 1, "discount_percent": 10 },
      { "subscription_term_months": 3, "discount_percent": 25 },
      { "subscription_term_months": 6, "discount_percent": 40 }
    ]
  }
}
```

### 4.4 Erros extras desta rota

Alem dos erros de recommendation:

| HTTP | code | Quando |
|---|---|---|
| 502 | `invalid_plan_snapshot_contract` | catalogo meal plan indisponivel, falha ao listar sabores, ou `flavor_options` vazio |

Esta rota **nao** devolve preco. Preco mensal e `POST plan/preview`.

---

## 5) Rota de preco — `/mes` monetario

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/plan/preview
```

Handler: `OnboardingApi::get_plan_preview` → `OnboardingService::get_plan_preview` (`persist = false`).

Usar quando a UI mostra valor em moeda com sufixo `/mes` (ex.: `R$ 299 /mês`), nao quando mostra `kg/mês` ou `packs/mês`.

### 5.1 Body (resumo)

Payload de selecao de plano (mesmo contrato de `POST .../plan-selection`):

- `subscription_term_months` (1, 3 ou 6)
- `pets[]` com sabor/peso por pet

Payload invalido: HTTP `422` (`invalid_plan_preview_payload`).

O preview **nao persiste** a selecao. Para gravar, usar `POST .../plan-selection`.

### 5.2 Campos de preco para o front

| UI | Campo | Notas |
|---|---|---|
| Total `/mes` | `data.grand_total_monthly` | alias em `data.totals.grand_total_monthly` e `data.pricing.grand_total_monthly` |
| 1o mes | `data.first_month_total` | hoje igual ao mensal (sem promocao extra neste contrato) |
| Por pet `/mes` | `data.pets[].monthly_total` | soma das line items daquele pet |
| Moeda | `data.currency` | `BRL` ou `USD` |

`data.pets[]` aqui e **preco**, nao consumo. Nao tem `daily` / `monthly.formatted` / `packs`.

### 5.3 Contrato resumido (`data`)

```json
{
  "success": true,
  "data": {
    "session_id": "...",
    "subscription_term_months": 1,
    "currency": "BRL",
    "grand_total_monthly": 299.0,
    "first_month_total": 299.0,
    "totals": {
      "grand_total": 299.0,
      "grand_total_monthly": 299.0,
      "first_month_total": 299.0
    },
    "pets": [
      {
        "pet_id": "...",
        "pet_name": "Charles",
        "monthly_total": 299.0,
        "total": 299.0,
        "first_month_total": 299.0
      }
    ],
    "line_items": []
  }
}
```

Formatacao `R$ 299 /mês` e responsabilidade do front (`currency` + `grand_total_monthly`).

### 5.4 Erros extras

| HTTP | code | Quando |
|---|---|---|
| 422 | `invalid_plan_preview_payload` | body nao passa no validator |
| 502 | `invalid_plan_preview_contract` | total mensal ausente/zero, ou totais por pet ausentes |

---

## 6) Fluxo tipico no onboarding

```
POST /onboarding/session/start
        │
        ▼
POST /onboarding/session/{id}/pets
        │
        ▼
GET  /onboarding/session/{id}/recommendation
        │  → preenche Por dia / Por mes / Pacotes
        │
        ▼
GET  /onboarding/session/{id}/plan/snapshot
        │  → mesmo consumo + sabores + prazos
        │
        ▼
POST /onboarding/session/{id}/plan/preview
           → preenche preco /mes
```

O questionario (`POST .../questionnaire`) e opcional antes de `recommendation`: o backend hidrata sozinho se estiver ausente.

---

## 7) Rotas que NAO preenchem esses campos

| Rota | Motivo |
|---|---|
| `POST /custom/v1/nutrition/simulate` | simulacao admin; nao devolve `simplified` |
| `POST .../subscription/preview` | preview de imposto Stripe (US) |
| `GET /custom-meal-plan/v1/plans` | catalogo WooCommerce, nao consumo por pet |
| `POST .../shipping/quote` | frete |
| `POST .../package-selection` | escolha de bags para checkout legado, nao o bloco Pacotes da UI simplificada |

O bloco `data.packaging` de `GET recommendation` usa o periodo da **recorrencia** da sessao (semanal / quinzenal / mensal). O bloco `data.simplified` **ignora** isso e fixa 30 dias. Nao misturar os dois na mesma tabela.

---

## 8) Guia de implementacao no front

1. Chamar `GET recommendation` depois que existir pelo menos 1 pet.
2. Renderizar uma linha por item em `data.simplified.pets`.
3. Exibir `daily.formatted`, `monthly.formatted` e `packs.formatted` sem reformatar, salvo se o design exigir valor e unidade separados (`value` + `unit`).
4. Se a tela de plano ja chama `plan/snapshot`, nao e obrigatorio chamar `recommendation` de novo: `consumption` e o mesmo payload.
5. Distinguir os dois `/mes`:
   - consumo: string ja localizada (`kg/mês`, `g/mês`, `oz/month`);
   - preco: numero + `currency`, sufixo `/mês` montado no i18n.
6. Nao recalcular packs no cliente. A regra `(monthly_grams / 300) > 8 → 500 g` vive no backend.

---

## 9) Referencia interna (admin)

O painel Onboarding 360 (`Onboarding360AdminPage`) renderiza o mesmo contrato:

- label: `simplified.labels.daily|monthly|packs`
- valor: `pet.daily|monthly|packs.formatted`

Serve como referencia de mapeamento quando o app React nao estiver neste workspace.

Contrato OpenAPI da rota de recommendation: `artefatos/swagger-pawbowl.yaml` (`getOnboardingRecommendation`).  
Smoke test: `artefatos/SMOKE_TEST_RECOMMENDATION.md`.
