# Analise Tecnica - Migracao da Rota Onboarding Recommendation para Node.js

## Escopo

Rota atual no WordPress:

- GET /custom/v1/onboarding/session/:sessionId/recommendation

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchOnboardingRecommendation)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-nutrition-recommendation-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-breeds-repository.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/plan/Plan.tsx
- eden-bowls/src/pages/plan/PLAN_RULES.md

Observacao importante:

- O endpoint real e GET (READABLE), sem body relevante.

## Responsabilidade da rota

A rota calcula e retorna a recomendacao nutricional da sessao de onboarding, baseada nos pets e no questionario da sessao.

Ela retorna tres blocos principais:

1. recommendations
- recomendacao detalhada por pet (kcal, gramas/dia, fator, etc.)

2. packaging
- sugestao de embalagens 300g/500g para o periodo, incluindo combinacoes alternativas e itens de checkout por SKU

3. simplified
- visao resumida para UI (daily/monthly/packs), com labels localizadas

No front da tela Plan, o consumo simplificado e usado como fallback best-effort quando necessario.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/recommendation
- Method: GET
- Callback: OnboardingApi::get_recommendation
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Nao usa body
- Chama `OnboardingService::get_recommendation(sessionId)`
- Retorna envelope `{ success: true, data: result }` em 200

Observacao de seguranca/acesso:

- A permissao exige token de sessao valido.
- Header preferencial: `x-session-token`
- Fallback: `Authorization: Bearer <token>`
- Existe rate limit de autenticacao no permission callback (`auth`), mas nao ha rate limit dedicado especifico da rota recommendation.

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body:

- nao aplicavel (GET sem payload funcional)

## Validacoes que devem existir

## 1) Validacoes de acesso

- sessao/token validos
- erros tipicos: 401/403/429

## 2) Validacoes de negocio

1. sessao deve existir
- erro: session_not_found
- status: 404

2. sessao deve conter pets
- erro: pets_required
- status: 422

3. questionario ausente
- nao retorna erro
- backend auto-hidrata questionario a partir do primeiro pet e persiste em banco (efeito colateral)

4. pais de mercado
- resolve por `session.country` (US/BR)
- fallback por locale (`pt*` -> BR; restante -> US)

## Fluxo da requisicao

1. Request entra em GET /recommendation
2. Permission callback valida token da sessao
3. Controller extrai session_id e chama service
4. Service carrega sessao via repository
5. Service valida existencia de pets
6. Service hidrata `questionnaire` automaticamente (se ausente) e salva sessao
7. Service calcula recomendacao detalhada por pet (`NutritionRecommendationService`)
8. Service monta bloco `packaging` com mix de embalagens e itens por SKU
9. Service monta bloco `simplified` com metricas localizadas
10. Service retorna `{ session_id, country, recommendations, packaging, simplified, version }`

## Estrutura de resposta

Resposta de sucesso HTTP 200 envelopada em `{ success: true, data: ... }`.

Top-level em `data`:

- session_id: string
- country: 'US' | 'BR'
- recommendations: array
- packaging: object
- simplified: object
- version: 'v1'

### simplified (consumido diretamente no front)

- country: 'US' | 'BR'
- period_days: number
- labels:
  - daily: string
  - monthly: string
  - packs: string
- pets[]:
  - pet_id: string
  - pet_name: string
  - daily: { value, unit, grams, formatted }
  - monthly: { value, unit, grams, formatted }
  - packs: { count, pack_size_grams, pack_size_value, pack_size_unit, formatted }

### recommendations (detalhado por pet)

Cada item inclui (entre outros):

- energia_kcal_dia
- quantidade_g_dia
- refeicoes
- quantidade_por_refeicao
- fator_aplicado
- porte
- especie
- nem_kcal_kg
- decision_trace
- display metadata
- pet_id, pet_name, pet

### packaging (resumo)

Inclui campos relevantes para continuidade do checkout:

- selected_frequency / recurrence_used
- period_days
- suggested_frequency / suggested_period_days
- package_sizes_grams
- total_grams_per_day
- total_target_grams
- suggested_bags_by_size
- selected_package_split
- alternative_combinations
- per_pet
- checkout_items
- checkout_items_summary

## Regras de negocio escondidas no WordPress

1. Efeito colateral em rota GET
- Se questionario estiver ausente, a rota cria automaticamente um questionario derivado dos pets e salva na sessao.

2. Auto-questionario baseado apenas no primeiro pet
- Campos como atividade, condicao corporal e castrado sao inferidos do primeiro pet valido.

3. Recommendation usa calculadora nutricional interna
- Nao depende de CPT/taxonomia para o calculo base.
- Usa tabelas de fatores e heuristicas (especie, porte, castracao, atividade, condicao corporal, fase de vida etc.).

4. Packaging depende de dados de selecao da sessao
- Usa `menu_selection`, `recurrence` e `package_selection` para frequencia e combinacao de embalagens.

5. Frequencia sugerida por consumo total diario
- >= 900 g/dia -> weekly
- <= 250 g/dia -> monthly
- caso intermediario -> biweekly

6. Mistura de pacotes otimizada
- algoritmo escolhe combinacao 300g/500g minimizando excedente, depois numero de bolsas, e por fim prioriza mais 500g em empate.

7. Tentativa de resolucao de SKU no WooCommerce
- Packaging gera `checkout_items` por SKU e tenta resolver produto via WooCommerce (`wc_get_product_id_by_sku`, `wc_get_product`).
- Se WooCommerce nao estiver disponivel, item volta como `resolved=false` com mensagem.

8. Front trata recommendation como best-effort
- Falha de recommendation nao bloqueia fluxo da Plan; erro e silenciosamente ignorado no loadRecommendation.

## Banco, tabelas e consultas

## Tabelas usadas diretamente

1. wp_hsr_onboarding_sessions
- leitura da sessao
- escrita eventual quando questionario e auto-hidratado

2. wp_hsr_onboarding_pets
- leitura dos pets da sessao

3. wp_hsr_breeds
- nao e usada diretamente em `get_recommendation`, mas existe dependencia estrutural no modulo onboarding para mapeamentos de raca/tamanho em outros fluxos.

## Consultas SQL (via repository)

- SELECT sessao por `session_id`
- SELECT pets da sessao ordenados por `id`
- UPDATE/INSERT da sessao quando ocorre hidratacao automatica do questionario
- mecanismo de fallback legado por transient para compatibilidade

## CPT, taxonomias e campos customizados

- Nao usa CPT nesta rota.
- Nao usa taxonomias nesta rota.
- Nao usa ACF/campos custom de posts nesta rota.

Observacao:

- Apesar disso, o bloco `packaging.checkout_items` tenta resolver SKU em produtos WooCommerce, o que cria dependencia operacional de catalogo/produtos no ambiente WP.

## Plugins e dependencias

1. headless-secure-registration
- endpoint/controller/service/repository

2. WooCommerce (dependencia indireta no packaging)
- lookup de SKU/produto para montar `checkout_items` resolvidos

3. Front-end Plan
- consome principalmente `data.simplified` como fallback de exibicao de consumo

## Regras de preco, moeda e pais

- Esta rota nao retorna preco final nem moeda explicitamente.
- Pais influencia unidade/formato do `simplified`:
  - BR: g/dia, kg/mes, labels em pt
  - US: oz/day, oz/month, labels em en
- Country e resolvido por sessao/locale (fallback para US).

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- GET /custom/v1/onboarding/session/:sessionId/recommendation

Controller:
- OnboardingApi::get_recommendation

Service:
- OnboardingService::get_recommendation
- ensure_questionnaire_for_recommendation
- build_simplified_recommendation
- build_packaging_recommendation
- NutritionRecommendationService::build_for_pet

Repository:
- OnboardingRepository::get
- OnboardingRepository::save (quando hidrata questionario)

Banco/tabelas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets

Regras de negocio:
- pets obrigatorios
- auto-hidratacao de questionario
- calculo nutricional por pet
- montagem de packaging e checkout_items
- localizacao BR/US em simplified

Campos retornados:
- session_id, country, recommendations, packaging, simplified, version

## Node.js (proposto)

Controller:
- OnboardingRecommendationController.get

Service:
- OnboardingRecommendationService.getRecommendation
- QuestionnaireHydrationService.ensureQuestionnaire
- NutritionRecommendationDomainService.buildForPet
- PackagingRecommendationService.build

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.updateQuestionnaireIfMissing
- OnboardingPetsRepository.findBySessionId

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity

DTOs:

Entrada:
- GetOnboardingRecommendationParamsDto
  - sessionId: string

Saida:
- OnboardingRecommendationResponseDto
  - sessionId: string
  - country: 'US' | 'BR'
  - recommendations: RecommendationItemDto[]
  - packaging: PackagingRecommendationDto
  - simplified: SimplifiedRecommendationDto
  - version: 'v1'

Validacoes:
- token/sessao
- sessao existente
- pets obrigatorios
- saneamento e normalizacao dos campos de pet/questionario

## Modelo de dados necessario no Node

Minimo para paridade:

1. onboarding_sessions
- session_id PK
- country
- locale
- questionnaire_json
- recurrence_json
- menu_selection_json
- package_selection_json

2. onboarding_pets
- id PK
- session_id FK
- pet_json (ou colunas normalizadas equivalentes)

Observacao de modelagem:

- Para manter compatibilidade rapida com o WP atual, usar JSON nas mesmas estruturas de sessao e pets reduz risco de regressao.

## Possiveis problemas na migracao

1. Perda de efeito colateral da GET
- Se Node nao persistir questionario quando ausente, resultados podem divergir do WP.

2. Divergencia no algoritmo nutricional
- Pequenas diferencas de rounding/fatores mudam gramas/dia e todo o bloco de embalagem.

3. Divergencia na localizacao/unidades
- Erros em BR vs US (g/kg vs oz) quebram expectativa da UI.

4. Dependencia WooCommerce no bloco packaging
- Em Node puro sem adapter de catalogo, `checkout_items` pode ficar incompleto e impactar etapas seguintes.

5. Contrato amplo de resposta
- Front atual usa `simplified`, mas outros fluxos podem depender de `packaging`/`recommendations`; remover campos gera regressao silenciosa.

6. Sessao legada/transient
- WP ainda possui fallback por transient; Node deve decidir estrategia de compatibilidade para sessoes antigas durante cutover.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- Node.js + TypeScript + Express
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- valida params e contexto de autenticacao
- nao contem regra de negocio
- delega tudo ao service

2. Service principal
- busca sessao/pets
- aplica validacoes de dominio
- hidrata questionario ausente e persiste
- calcula recommendation/simplified/packaging

3. Repository layer (TypeORM)
- leitura e escrita transacionais de sessao/pets
- metodo de update parcial seguro para questionario

4. Adapter de catalogo/produto
- abstrair resolucao de SKU (equivalente ao papel indireto do WooCommerce no packaging)
- prever fallback `resolved=false` quando indisponivel

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. sessao sem pets -> 422
3. sessao sem questionario -> hidrata + persiste
4. country/locale BR -> unidades/labels BR
5. country/locale US -> unidades/labels US
6. calculo de frequencia sugerida por thresholds (<=250, intermediario, >=900)
7. algoritmo de mix 300g/500g (min overage, tie-break)
8. fallback quando resolver SKU nao disponivel

## Checklist de equivalencia

1. Endpoint GET equivalente preservado.
2. Sessao/token via `x-session-token` e fallback Bearer.
3. Contrato top-level completo preservado (`recommendations`, `packaging`, `simplified`).
4. Efeito colateral de hidratacao de questionario preservado.
5. Regras BR/US de unidade/labels preservadas.
6. Controller sem regra de negocio.
7. TypeORM em repository/entity.
8. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
