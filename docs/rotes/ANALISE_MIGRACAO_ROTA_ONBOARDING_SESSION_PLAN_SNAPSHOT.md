# Analise Tecnica - Migracao da Rota Onboarding Plan Snapshot para Node.js

## Escopo analisado

Rota atual no WordPress:

- GET /custom/v1/onboarding/session/:session_id/plan/snapshot

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (funcao fetchPlanSnapshotFromApi)

Arquivos principais analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-nutrition-recommendation-service.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/plan/Plan.tsx

## Responsabilidade da rota

A rota retorna um snapshot autoritativo para montar a tela de plano no front-end, contendo:

1. Contexto de mercado:
- country
- currency

2. Consumo simplificado por pet:
- labels
- pets com daily/monthly/packs

3. Catalogo de sabores disponiveis:
- flavor_options

4. Tabela de termos de plano e desconto:
- plan_terms

Em resumo, ela funciona como uma agregacao de:

- recomendacao nutricional por pet
- dados de catalogo de sabores
- politica de desconto por periodo de assinatura

## Endpoint, controller e permissao

### Registro da rota

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/plan/snapshot
- Method: READABLE (GET)
- Callback: OnboardingApi::get_plan_snapshot
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Le session_id da URL
- Chama service.get_plan_snapshot(sessionId)
- Retorna envelope de sucesso: { success: true, data: ... }

## Parametros recebidos

Path param:

- session_id: string (regex [A-Za-z0-9_-]+)

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>
- front pode enviar tambem Authorization com JWT de usuario em paralelo

Body:

- nenhum (GET)

## Validacoes que devem existir

### Validacoes de acesso (permission callback)

1. session_id obrigatorio
- erro: session_forbidden
- status: 403

2. rate limit de autenticacao por sessao
- erro: rate_limit
- status: 429

3. token de sessao obrigatorio
- erro: session_unauthorized / session_token_missing
- status: 401

4. token invalido / expirado / sessao divergente
- erros: session_token_invalid, session_token_expired, session_forbidden
- status: 401 ou 403

### Validacoes de negocio (service)

1. sessao existente (via get_recommendation)
- erro: session_not_found
- status: 404

2. ao menos um pet na sessao (via get_recommendation)
- erro: pets_required
- status: 422

3. classes do catalogo disponiveis
- erro: invalid_plan_snapshot_contract
- status: 502

4. resolucao de sabores no catalogo
- erro: invalid_plan_snapshot_contract
- status: 502

5. flavor_options nao vazio
- erro: invalid_plan_snapshot_contract
- status: 502

## Fluxo completo da requisicao

1. GET /plan/snapshot entra no OnboardingApi::get_plan_snapshot
2. Permission callback valida sessao/token
3. Service chama get_recommendation(sessionId)
4. get_recommendation carrega sessao e pets do repositorio
5. Se questionnaire estiver ausente, gera questionario automatico e persiste sessao
6. Service resolve country (BR/US) e calcula recomendacao por pet
7. Service constroi bloco simplified (consumo mensal fixo, labels localizados)
8. get_plan_snapshot resolve currency por country (BRL/USD)
9. Carrega catalogo de sabores via CMPB_Meal_Plan_Service
10. Normaliza/agrupa flavors e monta flavor_options
11. Anexa plan_terms fixo (1,3,6 meses com descontos)
12. Controller retorna success/data

## Estrutura de resposta retornada

Contrato observado:

{
  "success": true,
  "data": {
    "session_id": "string",
    "country": "BR|US",
    "currency": "BRL|USD",
    "labels": {
      "daily": "string",
      "monthly": "string",
      "packs": "string"
    },
    "consumption": {
      "labels": { "daily": "string", "monthly": "string", "packs": "string" },
      "pets": [
        {
          "pet_id": "string",
          "pet_name": "string",
          "daily": { "value": number, "unit": "string", "grams": number, "formatted": "string" },
          "monthly": { "value": number, "unit": "string", "grams": number, "formatted": "string" },
          "packs": { "count": number, "pack_size_grams": number, "pack_size_value": number, "pack_size_unit": "string", "formatted": "string" }
        }
      ]
    },
    "pets": [/* espelho de consumption.pets */],
    "flavor_options": [
      { "key": "string", "label": "string" }
    ],
    "plan_terms": [
      { "subscription_term_months": 1, "discount_percent": 10 },
      { "subscription_term_months": 3, "discount_percent": 25 },
      { "subscription_term_months": 6, "discount_percent": 40 }
    ]
  }
}

Observacao de compatibilidade front:

- O front valida obrigatoriamente existencia de sabores (flavor_options / flavors / catalog).
- Se nao houver sabores, trata como invalid_plan_snapshot_contract (erro de contrato).

## Regras de negocio escondidas no WordPress

1. GET com efeito colateral (importante)
- Embora seja GET, pode escrever no banco.
- Se questionnaire nao existir, ele e auto-hidratado e a sessao e salva.
- Isso e comportamento inesperado em termos REST e deve ser decidido na migracao.

2. Pais e moeda sao inferidos/normalizados
- country valido final: BR ou US.
- qualquer outro valor cai para US.
- currency: BR -> BRL, senao USD.

3. Consumo simplificado usa periodo fixo de 30 dias
- independentemente da recorrencia salva em outra etapa.
- simplified.period_days e sempre 30.

4. Catalogo de sabores vem de classes externas CMPB
- depende de:
  - CMPB_Meal_Plan_Service
  - CMPB_Validation
  - CMPB_WC_Country_Pricing
  - CMPB_Product_Config
- falha nessas classes vira erro 502 de contrato.

5. Montagem de flavor_options usa fallback por tags/variations
- tenta variation.flavor
- fallback para primeira tag do produto
- normaliza slug via sanitize_title
- deduplica por key e ordena alfabeticamente

6. plan_terms estatico
- descontos sao hardcoded no snapshot:
  - 1 mes: 10
  - 3 meses: 25
  - 6 meses: 40

## Queries no banco e dados utilizados

### Tabelas utilizadas

1. wp_hsr_onboarding_sessions
- leitura da sessao (session_id)
- possivel escrita de questionnaire_json (auto-hidratacao)
- campos usados no fluxo: country, locale, questionnaire_json

2. wp_hsr_onboarding_pets
- leitura de pets da sessao
- apenas pets nao deletados (filtro por deleted_at no JSON)

3. wp_hsr_breeds
- usada indiretamente por validacoes/classificacao de pet em fluxos de onboarding (nao e fonte principal do snapshot, mas participa do dominio de recomendacao)

### Schema relevante

- session aggregate em JSON:
  - questionnaire_json
  - recurrence_json
  - package_selection_json
  - menu_selection_json
  - plan_selection_json
  - zipcode_json

## CPT, taxonomias e campos personalizados

- Custom Post Types: nao usado nesta rota.
- Taxonomias WP: nao usadas diretamente na rota.
- Campos customizados:
  - nesta rota, predominam campos JSON em tabelas customizadas, nao post meta de CPT.

## Plugins e dependencias existentes

1. headless-secure-registration
- endpoint, service, repositorio, auth de sessao e schema

2. WooCommerce
- dependencia indireta do ecossistema de catalogo/precos

3. Stack CMPB (meal plan)
- fonte de produtos/variacoes de sabores por mercado e moeda

4. Front-end eden-bowls
- consumidor direto do contrato de snapshot

## Regras de preco, moeda e pais

Pais:
- BR ou US (fallback US)

Moeda:
- BRL para BR
- USD para US

Preco/desconto:
- snapshot nao calcula preco final por pet (isso e no preview)
- snapshot define plan_terms de desconto percentual por prazo
- front extrai descontos de plan_terms para montar UI das tabs

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- GET /custom/v1/onboarding/session/:sessionId/plan/snapshot

Controller/Endpoint:
- OnboardingApi::get_plan_snapshot

Service:
- OnboardingService::get_plan_snapshot
- OnboardingService::get_recommendation (dependencia direta)
- load_plan_snapshot_flavor_options

Repository:
- OnboardingRepository::get
- OnboardingRepository::save (apenas quando questionnaire nao existe)

Banco/tabelas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets
- (indireta) wp_hsr_breeds

Regras de negocio:
- auth de sessao
- requisito de pets
- auto-hidratacao de questionnaire
- country/currency normalization
- flavor_options de catalogo externo
- plan_terms fixo

Campos retornados:
- session_id
- country
- currency
- labels
- consumption.labels
- consumption.pets
- pets
- flavor_options
- plan_terms

## Node.js (proposto)

Controller:
- OnboardingPlanSnapshotController.getSnapshot

Service:
- OnboardingPlanSnapshotService.getSnapshot
- RecommendationService.buildRecommendationForSession
- FlavorCatalogService.listFlavorOptionsByMarket

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingPetRepository.findActiveBySessionId
- OnboardingSessionRepository.saveQuestionnaireIfMissing (se mantiver comportamento legado)

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity
- BreedEntity (opcional conforme dominio de recomendacao)

DTOs:

Entrada:
- GetPlanSnapshotParamsDto
  - sessionId: string

Saida:
- PlanSnapshotResponseDto
  - sessionId
  - country
  - currency
  - labels
  - consumption
  - pets
  - flavorOptions
  - planTerms

Validacoes:
- Session param valido
- Session token valido e vinculado a sessao
- Sessao existente
- Pets existentes
- Catalogo de sabores disponivel e nao vazio
- Country/currency restritos ao dominio esperado

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id (PK)
- country
- locale
- questionnaire_json
- recurrence_json
- package_selection_json
- menu_selection_json
- plan_selection_json
- updated_at

2. onboarding_pets
- id (PK)
- session_id (FK)
- pet_uuid
- pet_json (ou colunas normalizadas)

3. flavor catalog source
- opcao A: consumir servico externo equivalente ao CMPB
- opcao B: cache local em tabela (flavors/products/variations)

## Possiveis problemas na migracao

1. Quebra por ausencia de flavor options
- front considera erro de contrato quando nao encontra sabores.

2. Diferenca de semantica REST
- legado faz escrita em GET (questionnaire auto-hidratado).
- em Node, decidir se mantem compatibilidade ou separa para etapa explicita.

3. Dependencia forte de classes CMPB
- se nao houver adaptador equivalente no Node, snapshot perde source de sabor.

4. Divergencia de pais/moeda
- fallback para US e critico para manter comportamento atual.

5. Divergencia de labels e unidades
- front usa labels e consumos formatados no snapshot/recommendation.

6. Contrato de erro diferente
- WP_Error varia formato.
- Node deve padronizar sem quebrar tratamento atual no front.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- Sem regra de negocio no Controller
- TypeORM obrigatorio
- Nao usar Prisma

### Design sugerido

1. Controller
- valida params e contexto de auth de sessao
- chama service
- retorna envelope success/data

2. Service
- busca aggregate da sessao
- valida pets
- constroi recomendacao simplificada
- resolve mercado (country/currency)
- consulta FlavorCatalogService
- valida flavor_options nao vazio
- retorna DTO final com plan_terms

3. Repository
- findBySessionId com joins/dados necessarios
- saveQuestionnaireIfMissing (somente se manter side effect legado)

4. Integracao de catalogo
- criar adapter para provider atual (CMPB-like)
- mapear resposta para FlavorOptionDTO padrao

### Testes unitarios recomendados

1. Service - happy path
- retorna snapshot com currency/country/flavors/plan_terms

2. Service - contrato invalido
- sem provider de flavor -> erro de contrato (502)
- provider sem sabores -> erro de contrato (502)

3. Service - validacao
- sessao inexistente -> 404
- sem pets -> 422

4. Country/Currency
- country invalido no aggregate -> fallback US/USD
- country BR -> BRL

5. Compatibilidade front
- shape de flavor_options e plan_terms conforme extractions do front

## Checklist de equivalencia

1. Endpoint GET equivalente mantido.
2. Auth de sessao (x-session-token/Bearer) preservada.
3. Regras BR/US e BRL/USD preservadas.
4. flavor_options obrigatorio e nao vazio.
5. plan_terms 1/3/6 com 10/25/40.
6. Contrato de resposta compativel com front atual.
7. Controller sem regra de negocio.
8. TypeORM em repository/entities.
9. Nenhum uso de Prisma.

## Status desta entrega

- Analise tecnica concluida.
- Nao foi implementado codigo Node ainda, conforme solicitado.
- Pronto para avancar para implementacao apos sua aprovacao.
