# Analise Tecnica - Migracao da Rota Onboarding Plan Selection para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/plan-selection

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (syncLocalPlanSelectionToApi)

Arquivos principais analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-request-validator.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php
- pawbowl-wp/wp/wp-content/plugins/custom-meal-plan-builder/includes/meal-plan-service.php
- pawbowl-wp/wp/wp-content/plugins/custom-meal-plan-builder/includes/wc-country-pricing.php
- eden-bowls/src/services/onboardingApi.ts

Observacao:

- No pedido foi citado GET, mas a implementacao real e POST.

## Responsabilidade da rota

A rota valida e persiste a selecao de plano do onboarding na sessao, incluindo:

1. prazo da assinatura (`subscription_term_months`),
2. sabores/pesos por pet,
3. snapshot de precificacao de catalogo (`catalog_pricing`),
4. metadados de validacao do plano.

Diferenca essencial para `plan/preview`:

- `plan-selection` persiste no aggregate da sessao.
- `plan/preview` so simula e nao persiste.

## Endpoint, Controller e permissao

### Registro da rota

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/plan-selection
- Method: CREATABLE (POST)
- Callback: OnboardingApi::set_plan_selection
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Le `session_id`
- Extrai payload
- Valida com RequestValidator::validate_plan_selection
- Chama OnboardingService::set_plan_selection
- Retorna `{ success: true, data: ... }`

## Parametros recebidos

Path param:

- session_id: string (regex [A-Za-z0-9_-]+)

Headers:

- x-session-token (preferencial)
- Authorization: Bearer <session-token> (fallback)

Body:

{
  "subscription_term_months": 1 | 3 | 6,
  "pets": [
    {
      "pet_id": "string opcional",
      "pet_name": "string",
      "enabled": true,
      "selected_flavors": ["string"],
      "flavor_weights": [number]
    }
  ]
}

## Validacoes que devem existir

## 1) Validacoes de acesso

- `session_id` obrigatorio (403)
- rate limit de auth (429)
- token de sessao obrigatorio (401)
- token invalido/expirado/sessao divergente (401/403)

## 2) Validacoes de payload (RequestValidator)

- `subscription_term_months` deve ser 1, 3 ou 6
- `pets` deve ser array nao vazio
- para cada pet habilitado:
  - `selected_flavors` nao vazio
  - `flavor_weights` com mesmo tamanho de `selected_flavors`
  - pesos numericos
  - ao menos um peso > 0

## 3) Validacoes de negocio (Service)

- sessao deve existir (404)
- recommendation da sessao deve existir e ter pets
- pet enviado deve casar com recommendation atual (por id ou nome)
- pack recomendado por pet deve existir
- sabor selecionado deve existir no catalogo atual
- tamanho de pacote solicitado deve existir nas variacoes de catalogo
- ao menos um item de catalogo valido apos normalizacao

## Fluxo da requisicao

1. Request entra em `POST /plan-selection`.
2. Permission callback valida sessao/token.
3. Controller valida schema do payload.
4. Service executa `resolve_plan_selection(sessionId, payload, persist=true)`.
5. Service:
   - carrega sessao
   - carrega recommendation atual
   - valida sincronismo do payload com recommendation
   - normaliza sabores e pesos
   - resolve mercado (`country`) e moeda (`currency`)
   - monta `catalogLineRequests`
   - calcula `catalog_pricing` via catalogo externo
6. Service monta `plan_selection` com:
   - subscription_term_months
   - catalog_pricing
   - flavors_by_pet
   - pets normalizados
   - validated_with
   - updated_at
7. Como `persist=true`, salva `session.plan_selection` no repositorio.
8. Retorna `session_id` + `plan_selection`.

## Estrutura de resposta

Sucesso (200):

{
  "success": true,
  "data": {
    "session_id": "...",
    "plan_selection": {
      "subscription_term_months": 1,
      "catalog_pricing": {
        "source": "custom_meal_plan_builder",
        "country": "US|BR",
        "currency": "USD|BRL",
        "line_items": [ ... ],
        "subtotal": 123.45,
        "discounted_first_month_total": 123.45
      },
      "flavors_by_pet": [ ... ],
      "pets": [ ... ],
      "validated_with": {
        "recommendation_version": "v1",
        "validated_at": "ISO-8601"
      },
      "updated_at": "ISO-8601"
    }
  }
}

Erros relevantes:

- `invalid_plan_selection_payload` (422)
- `invalid_subscription_term` (422)
- `invalid_plan_selection` (422)
- `plan_selection_snapshot_mismatch` (422)
- `catalog_pricing_unavailable` (422)
- `session_not_found` (404)

## Regras de negocio escondidas no WordPress

1. Acoplamento forte com recommendation atual
- Se recommendation mudar entre render e submit, retorna mismatch.

2. Matching de pet por id OU nome
- Nomes ambíguos podem gerar risco de mapeamento errado.

3. Flavor normalizado por slug
- Backend usa normalizacao estilo `sanitize_title`.
- Front normaliza com regex JS.
- Divergencia de normalizacao pode causar mismatch.

4. Quantidades por sabor sao agregadas
- pesos positivos de sabores iguais sao somados.

5. Tamanho de pacote vem da recommendation simplificada
- `recommended_pack_size_grams` e obrigatorio para cada pet habilitado.

6. Selecao de variacao por peso
- escolhe variacao com menor distancia em gramas.
- em empate, menor preco.

7. Persistencia do `plan_selection` impacta checkout
- checkout exige `plan_selection` e `catalog_pricing.line_items`.
- sem isso, checkout falha com `session_incomplete`.

8. Desconto nao e decidido integralmente nesta rota
- essa rota persiste base de plano/preco.
- no checkout ocorre revalidacao de elegibilidade e ajuste de `discount_percent_applied`/`discounted_first_month_total`.

## Banco, queries e fontes de dados

## Tabelas utilizadas

1. `wp_hsr_onboarding_sessions`
- leitura e escrita da sessao
- coluna usada para persistencia: `plan_selection_json`

2. `wp_hsr_onboarding_pets`
- leitura de pets para recommendation
- escrita indireta via `save(session)` (estrategia de replace dos pets)

3. Catalogo de produtos/variacoes (WooCommerce + CMPB)
- sabores e variacoes por peso
- preco por moeda/zona

## Persistencia

- `OnboardingRepository::save()` grava aggregate completo da sessao.
- `plan_selection_json` passa a conter o snapshot persistido.

## CPT, taxonomias e campos customizados

- Nao ha uso de CPT para estado do onboarding.
- Nao ha uso direto de taxonomia nesta rota.
- Campos customizados relevantes sao JSON em tabela custom (`*_json`), nao post meta de CPT.

## Plugins e dependencias

1. headless-secure-registration
- endpoint/service/repository de onboarding

2. custom-meal-plan-builder
- catalogo e precificacao por sabor/variacao

3. WooCommerce
- base de produtos/variacoes

4. Price-based-on-country (via classes CMPB)
- resolve precos por moeda/zona

## Regras de preco, moeda e pais

Pais:
- resolvido pela sessao/locale (`BR` ou `US`, fallback `US`).

Moeda:
- `BR -> BRL`
- `US -> USD`

Preco:
- `catalog_pricing.subtotal` = soma de line items
- `discounted_first_month_total` inicialmente igual a subtotal
- desconto efetivo pode ser ajustado no checkout apos revalidar elegibilidade

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/plan-selection

Controller:
- `OnboardingApi::set_plan_selection`

Service:
- `OnboardingService::set_plan_selection`
- `resolve_plan_selection(..., persist=true)`

Repository:
- `OnboardingRepository::get`
- `OnboardingRepository::save`

Banco/tabelas:
- `wp_hsr_onboarding_sessions` (`plan_selection_json`)
- `wp_hsr_onboarding_pets`

Regras de negocio:
- valida payload + recommendation snapshot
- valida sabor/peso no catalogo
- compoe e persiste snapshot de preco

Campos retornados:
- `session_id`
- `plan_selection` completo

## Node.js (proposto)

Controller:
- `OnboardingPlanSelectionController.setPlanSelection`

Service:
- `OnboardingPlanSelectionService.setPlanSelection`
- `RecommendationService.getForSession`
- `CatalogPricingService.buildPricingSnapshot`

Repository:
- `OnboardingSessionRepository.findBySessionId`
- `OnboardingSessionRepository.savePlanSelection`
- `OnboardingPetRepository.findActiveBySessionId`

Entities/Models (TypeORM):
- `OnboardingSessionEntity`
- `OnboardingPetEntity`
- opcional: `CatalogProductEntity` / `CatalogVariationEntity` se houver cache local

DTOs:

Entrada:
- `SetPlanSelectionParamsDto`
  - sessionId: string
- `SetPlanSelectionRequestDto`
  - subscriptionTermMonths: 1 | 3 | 6
  - pets: PlanSelectionPetDto[]

Saida:
- `SetPlanSelectionResponseDto`
  - sessionId: string
  - planSelection: PlanSelectionDto

Validacoes:
- auth de sessao
- schema do payload
- sincronismo com recommendation
- disponibilidade de sabores/variacoes
- consistencia de moeda/pais

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- locale
- country
- plan_selection_json
- questionnaire_json
- recurrence_json
- updated_at

2. onboarding_pets
- id PK
- session_id FK
- pet_uuid
- pet_json (ou modelo normalizado)

3. fonte de catalogo/preco
- adaptador externo para catalogo atual
  ou
- tabela local sincronizada de variacoes/precos por mercado

## Possiveis problemas na migracao

1. Divergencia de normalizacao de flavor
- Node e front podem divergir em slug final.

2. Corrida entre recommendation e submit
- maior incidencia de `snapshot_mismatch` sem controle de versao.

3. Dependencia externa de catalogo
- indisponibilidade do provider quebra persistencia do plan selection.

4. Persistencia parcial incorreta
- grava somente parte do aggregate pode perder campos da sessao.

5. Divergencia com checkout
- se regras de `catalog_pricing` mudarem, checkout pode recusar sessao por incompletude.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- TypeORM obrigatorio
- Nao usar Prisma

### Desenho recomendado

1. Controller
- valida params e body
- delega para service
- sem regra de negocio

2. Service
- carrega sessao + recommendation
- valida e normaliza payload
- monta pricing snapshot
- persiste plan selection
- retorna DTO de saida

3. Repository
- update atomico do `plan_selection_json`
- preservar outros campos da sessao

4. Integracao de catalogo
- encapsular em porta/adaptador
- facilitar testes e fallback de erro de negocio

### Testes unitarios recomendados

1. Payload invalido (422)
- termo invalido, pets vazio, pesos inconsistentes

2. Sessao inexistente (404)

3. Snapshot mismatch (422)
- pet nao encontrado
- sabor invalido
- tamanho indisponivel

4. Persistencia correta
- grava `plan_selection` completo
- nao remove outros campos da sessao

5. Pais/moeda
- BR -> BRL
- fallback -> US/USD

6. Compatibilidade com checkout
- `catalog_pricing.line_items` populado apos set

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Auth de sessao compatível com fluxo atual.
3. Mesmo comportamento de validacao de payload.
4. Mesmo comportamento de validacao semantica contra recommendation.
5. Persistencia em `plan_selection` mantida.
6. Moeda/pais equivalentes.
7. Controller sem regra de negocio.
8. TypeORM em Repository/Entity.
9. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
