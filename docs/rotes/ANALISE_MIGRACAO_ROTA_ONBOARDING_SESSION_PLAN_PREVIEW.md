# Analise Tecnica - Migracao da Rota Onboarding Plan Preview para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/plan/preview

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchPlanPreviewFromApi)

Arquivos principais analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-request-validator.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php
- pawbowl-wp/wp/wp-content/plugins/custom-meal-plan-builder/includes/meal-plan-service.php
- pawbowl-wp/wp/wp-content/plugins/custom-meal-plan-builder/includes/wc-country-pricing.php
- eden-bowls/src/services/onboardingApi.ts

Observacao:

- No pedido foi mencionado GET, mas a rota real e POST.

## Responsabilidade da rota

A rota simula (preview) o preco do plano selecionado para a sessao de onboarding, sem persistir o resultado da selecao no aggregate (modo preview).

Ela valida consistencia entre:

1. recomendacao atual por pet,
2. sabores e pesos enviados,
3. catalogo disponivel para pais/moeda,
4. prazo de assinatura (1, 3, 6 meses).

Retorno principal:

- totais do plano (grand total, first month total)
- totais por pet
- line items resolvidos a partir de catalogo de variacoes

## Endpoint, controller e fluxo base

### Endpoint WordPress

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/plan/preview
- Method: POST
- Callback: OnboardingApi::get_plan_preview
- Permission callback: OnboardingApi::require_valid_session_access

### Fluxo de requisicao

1. Auth/permissao
- valida session_id
- aplica rate limit
- exige x-session-token (ou Authorization Bearer com token de sessao)
- valida assinatura/expiracao/vinculo token->session_id

2. Controller
- extrai payload
- roda RequestValidator::validate_plan_selection
- em caso de erro: invalid_plan_preview_payload (422)
- chama OnboardingService::get_plan_preview

3. Service
- chama resolve_plan_selection(sessionId, payload, persist=false)
- transforma o resultado em contrato de preview com build_plan_preview_response

4. Resposta
- sucesso: { success: true, data: ... } (200)
- falhas de validacao/contrato: WP_Error com status 4xx/5xx

## Parametros recebidos

### Path param

- session_id: string ([A-Za-z0-9_-]+)

### Headers

- x-session-token: token de sessao (preferencial)
- Authorization: Bearer <token> (fallback de extracao)

### Body

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

- session_id obrigatorio -> 403
- token de sessao obrigatorio -> 401
- token invalido -> 401
- token expirado -> 401
- token de outra sessao -> 403
- rate limit -> 429

## 2) Validacoes de payload (RequestValidator)

- subscription_term_months deve ser 1, 3 ou 6
- pets deve ser array nao vazio
- cada pet habilitado deve ter selected_flavors nao vazio
- flavor_weights deve ter mesmo tamanho de selected_flavors
- flavor_weights deve ser numerico
- ao menos um weight > 0 por pet habilitado

## 3) Validacoes de negocio (Service)

- sessao deve existir (404)
- recommendation deve existir para a sessao
- recommendation precisa ter pets simplificados
- pet enviado deve casar com pet da recommendation (por id ou nome)
- pack_size recomendado por pet deve existir (>0)
- catalogLineRequests nao pode ficar vazio
- flavor enviado deve existir no catalogo atual
- pack size solicitado deve existir nas variacoes de catalogo
- contrato final de preview deve ter:
  - grand total > 0
  - first month total > 0
  - totais por pet

## Estrutura de resposta atual

Sucesso (200):

{
  "success": true,
  "data": {
    "session_id": "...",
    "subscription_term_months": 1,
    "currency": "USD|BRL",
    "totals": {
      "grand_total": 123.45,
      "grand_total_monthly": 123.45,
      "first_month_total": 123.45
    },
    "pricing": {
      "grand_total": 123.45,
      "grand_total_monthly": 123.45,
      "first_month_total": 123.45
    },
    "grand_total": 123.45,
    "grand_total_monthly": 123.45,
    "first_month_total": 123.45,
    "pets": [
      {
        "pet_id": "...",
        "pet_name": "...",
        "monthly_total": 61.72,
        "total": 61.72,
        "first_month_total": 61.72
      }
    ],
    "line_items": [
      {
        "pet_id": "...",
        "pet_name": "...",
        "flavor": "...",
        "quantity": 2,
        "pack_size_grams": 500,
        "pack_size_label": "500 g",
        "variation_id": 123,
        "product_id": 456,
        "currency": "USD",
        "unit_price": 14.9,
        "line_total": 29.8
      }
    ]
  }
}

Erros relevantes:

- invalid_plan_preview_payload (422)
- invalid_subscription_term (422)
- invalid_plan_selection (422)
- plan_selection_snapshot_mismatch (422)
- catalog_pricing_unavailable (422)
- invalid_plan_preview_contract (502)

## Regras de negocio escondidas (criticas na migracao)

1. Preview nao persiste plan_selection
- resolve_plan_selection roda com persist=false.
- efeito: calcula e valida, mas nao grava plan_selection no session aggregate.

2. A validacao e amarrada ao snapshot de recommendation vigente
- pet e identificado por id ou nome.
- se recommendation mudar entre UI e submit, pode dar snapshot_mismatch.

3. selected_flavors + flavor_weights sao agregados por slug normalizado
- weights <= 0 sao descartados.
- slugs invalidos sao descartados.
- se tudo for descartado, erro 422.

4. Target de pacote por pet vem da recommendation simplificada
- usa recommended pack_size_grams.
- sem esse valor, erro 422.

5. Pais e moeda sao inferidos da sessao
- country por resolve_market_country (BR/US com fallback).
- currency BRL para BR, USD para US.

6. Catalogo de pricing depende de plugin externo
- custom-meal-plan-builder (CMPB_Meal_Plan_Service etc).
- preco vem de variacoes do catalogo por flavor/peso.
- lookup de preco usa zone pricing meta via WCPBC.

7. Escolha da variacao por peso usa menor distancia em gramas
- parse do peso aceita g e oz.
- criterio de desempate: menor preco.

8. Contrato de preco nao aplica desconto no preview
- first_month_total hoje replica subtotal.
- discounted_first_month_total existe internamente em catalog_pricing, mas o preview final devolve first_month_total = grand_total.

## Banco, queries e fontes de dados

### Tabelas usadas diretamente no fluxo

1. wp_hsr_onboarding_sessions
- leitura da sessao por session_id
- leitura de locale/country/questionnaire
- leitura de plan_selection_json (quando existente)

2. wp_hsr_onboarding_pets
- leitura da lista de pets ativos da sessao

### Persistencia durante preview

- Em teoria preview nao persiste plan selection.
- Porem get_recommendation pode auto-hidratar questionnaire e salvar sessao quando questionnaire nao existe.
- Ou seja: POST /plan/preview pode ter side effect indireto na sessao (questionnaire_json).

### Fontes externas de catalogo/preco

- Produtos WooCommerce + variacoes (categoria flavors via service CMPB)
- Meta de preco por zona/currency (plugin de country pricing)

## CPT, taxonomias e campos customizados

- Nao ha uso de CPT para estado de onboarding nessa rota.
- Nao ha uso direto de taxonomia WP no endpoint de preview.
- Estado de onboarding usa tabelas custom e JSON columns.

Campos custom relevantes:

- questionnaire_json
- recurrence_json
- package_selection_json
- menu_selection_json
- plan_selection_json

## Plugins envolvidos

1. headless-secure-registration
- endpoint, auth de sessao, regra de negocio onboarding

2. custom-meal-plan-builder
- resolucao de catalogo e variacoes por flavor/peso

3. WooCommerce
- produtos/variacoes base do catalogo

4. WooCommerce Price Based on Country (WCPBC)
- resolucao de zone_id e preco por moeda

## Regras de preco, moeda e pais

Pais:
- BR ou US (fallback por locale/country da sessao)

Moeda:
- BR -> BRL
- US -> USD

Preco:
- subtotal = soma de line_items (unit_price * quantity)
- grand_total = subtotal
- first_month_total = grand_total (estado atual)
- totais por pet = soma de line_total por pet_id

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/plan/preview

Controller:
- OnboardingApi::get_plan_preview

Service:
- OnboardingService::get_plan_preview
- resolve_plan_selection(sessionId, payload, false)
- build_plan_preview_response

Repository:
- OnboardingRepository::get
- (indireto) OnboardingRepository::save via hydration do questionnaire no get_recommendation

Banco/tabelas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets

Regras de negocio:
- valida snapshot contra recommendation atual
- valida sabor/peso contra catalogo
- compoe pricing e totais por pet

Campos retornados:
- session_id
- subscription_term_months
- currency
- totals
- pricing
- grand_total/grand_total_monthly/first_month_total
- pets totals
- line_items

## Node.js (proposto)

Controller:
- OnboardingPlanPreviewController.preview

Service:
- OnboardingPlanPreviewService.preview
- RecommendationService.getForSession
- FlavorCatalogPricingService.resolvePricing

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingPetRepository.findActiveBySessionId
- OnboardingSessionRepository.saveQuestionnaireIfMissing (somente se mantiver compatibilidade de side effect)

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity
- (opcional) CatalogFlavorEntity / CatalogVariationEntity caso haja cache local

DTOs:

Entrada:
- PlanPreviewParamsDto
  - sessionId: string
- PlanPreviewRequestDto
  - subscriptionTermMonths: 1 | 3 | 6
  - pets: PlanPreviewPetInputDto[]

Saida:
- PlanPreviewResponseDto
  - sessionId
  - subscriptionTermMonths
  - currency
  - totals/pricing
  - pets
  - lineItems

Validacoes:
- auth de sessao
- schema de payload
- sincronismo com recommendation
- disponibilidade de sabor/variacao no catalogo
- totals obrigatorios > 0

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- country
- locale
- questionnaire_json
- plan_selection_json
- updated_at

2. onboarding_pets
- id PK
- session_id FK
- pet_uuid
- pet_json (ou colunas normalizadas)

3. provider de catalogo
- Integracao externa equivalente ao CMPB
  ou
- tabela local sincronizada de produtos/variacoes/precos

## Possiveis problemas na migracao

1. Quebra de contrato no front
- Front exige grand_total/first_month_total e totais por pet.
- Se shape mudar, dispara invalid_plan_preview_contract no cliente.

2. Concorrencia recommendation vs preview
- Snapshot mismatch pode aumentar em ambiente Node se recommendation variar entre requests.

3. Dependencia externa de catalogo
- Sem adapter CMPB-equivalente, preview perde pricing real.

4. Diferenca de normalizacao de flavor
- Front normaliza slug (regex JS).
- Backend normaliza via sanitize_title.
- Divergencia pode gerar mismatch de sabor.

5. Side effect indireto no preview
- GET/POST de preview pode salvar questionnaire implicitamente via recommendation.
- Precisa decidir se manter compatibilidade ou remover side effect com rollout controlado.

6. Politica de desconto
- Contrato atual nao reflete desconto no first month no preview final.
- Alterar isso sem alinhamento pode mudar preco exibido e quebrar expectativa.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- TypeORM obrigatorio
- Nao usar Prisma

### Desenho sugerido

1. Controller
- valida params/body (DTO)
- invoca guard de sessao
- delega ao service
- retorna envelope de sucesso

2. Service
- carrega sessao
- valida recommendation e payload semantico
- resolve pais/moeda
- resolve pricing por catalogo
- agrega totais por pet
- valida contrato de saida (totais obrigatorios)

3. Repository
- acesso a sessao/pets com TypeORM
- metodos explicitos para leitura e eventuais side effects controlados

4. Adapter de catalogo
- interface FlavorCatalogPricingPort
- implementacao usando provider atual (se coexistencia WP)
- fallback controlado para erro de negocio (422) quando catalogo indisponivel

### Testes unitarios recomendados

1. Payload validation
- termo invalido
- pets vazio
- pesos invalidos

2. Snapshot consistency
- pet nao encontrado na recommendation -> 422 mismatch

3. Catalog matching
- flavor inexistente -> 422 mismatch
- variacao de peso inexistente -> 422 mismatch

4. Contract validation
- subtotal zero -> 502 invalid_plan_preview_contract
- sem totais por pet -> 502 invalid_plan_preview_contract

5. Country/currency
- BR -> BRL
- fallback -> US/USD

6. Non-persistence behavior
- preview nao deve gravar plan_selection

## Checklist de equivalencia para aprovacao

1. Endpoint POST equivalente mantido.
2. Auth de sessao compativel com x-session-token.
3. Mesmo conjunto de validacoes de payload e negocio.
4. Mesmo shape de response esperado pelo front.
5. Mesmo comportamento de moeda/pais.
6. Mesmo criterio de matching de flavor/peso.
7. Controller sem regra de negocio.
8. TypeORM em repositories/entities.
9. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Codigo Node ainda nao implementado (conforme solicitado).
- Pronto para partir para implementacao apos aprovacao.
