# Analise Tecnica - Migracao da Rota Onboarding Pets para Node.js

## Escopo

Rota atual no WordPress:

- GET /custom/v1/onboarding/session/:sessionId/pets

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (listSessionPetsInApi)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-request-validator.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/onboarding/ONBOARDING_RULES.md
- eden-bowls/src/pages/onboarding/Onboarding.tsx
- eden-bowls/src/pages/dashboard/pages/MyPets.tsx
- eden-bowls/src/pages/plan/Plan.tsx
- eden-bowls/src/pages/checkout/Checkout.tsx

## Responsabilidade da rota

A rota lista os pets associados ao contexto de onboarding da sessao.

Na pratica, ela nao retorna apenas o snapshot bruto salvo na sessao. O backend tenta resolver um usuario associado e, quando consegue, mescla:

1. pets da sessao atual;
2. pets historicos da conta do usuario;
3. pets persistidos em tabelas de onboarding ligadas ao usuario.

Objetivo funcional:

- carregar pets persistidos para a sessao autenticada;
- permitir reaproveitamento de pets do usuario em onboarding futuro;
- alimentar telas de Onboarding, Plan e MyPets.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/pets
- Method: GET
- Callback: OnboardingApi::list_pets
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Chama `OnboardingService::list_pets(sessionId)`
- Retorna envelope `{ success: true, data: result }` com status 200

### Regra de acesso importante

Esta rota nao usa a permissao de usuario logado diretamente. Ela usa acesso validado por sessao:

1. `x-session-token` e priorizado na extracao do token;
2. `Authorization: Bearer ...` tambem pode ser aceito se nao houver header de sessao;
3. o token precisa ser valido para a `session_id` solicitada.

Erros de acesso comuns:

- 401 session_unauthorized
- 403 session_forbidden
- 404 session_not_found
- 429 rate_limit

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- Authorization: Bearer token (fallback para flows headless)

Body:

- nenhum

## Validacoes que devem existir

## 1) Validacao de sessao

- `session_id` obrigatorio
- sessao deve existir no repositório SQL ou no fallback legado

Erro:

- `session_not_found` -> 404

## 2) Validacao de acesso por sessao

A permissao usa o mesmo mecanismo de validacao de sessão do onboarding:

- rate limit por escopo `auth`
- token ausente -> 401 `session_unauthorized`
- token invalido/incompatível com a sessao -> erro da validacao do session token service

## 3) Validacao de ownership e resolucao de usuario

A busca de pets historicos tenta resolver um usuario associado nesta ordem:

1. usuario autenticado no WP (`is_user_logged_in`)
2. `session.linked_user_id`
3. dono do pedido referenciado por `session.checkout_order_id`
4. pedido encontrado por meta `_hsr_onboarding_session_id`
5. meta de usuario `hsr_onboarding_last_session`

Se nenhum usuario for resolvido, a rota retorna apenas os pets da sessao.

## Fluxo da requisicao

1. GET /pets chega na rota
2. permission callback valida token e acesso da sessao
3. controller chama `OnboardingService::list_pets`
4. service carrega a sessao via repository
5. se sessao nao existir, retorna 404
6. service coleta os pets da sessao
7. tenta resolver um usuario associado ao contexto
8. se usuario for encontrado, carrega pets historicos da conta
9. faz merge entre pets da sessao e pets da conta
10. retorna `session_id` + lista final de `pets`

## Estrutura de resposta

Contrato atual esperado pelo front:

- session_id: string
- pets: array

A forma exata de cada item de `pets` e o JSON do pet persistido, normalizado pelo backend.

Campos relevantes consumidos pela UI:

- id
- name
- breed
- age_years
- age_months
- age
- weight_input
- weight_unit
- weight_kg
- weight
- size
- activity_level
- pet_condition
- neutered
- image_url
- deleted_at (quando aplicavel no snapshot persistido)

## Regras de negocio escondidas no WordPress

1. Merge entre sessao e conta
- se o backend resolve um usuario, os pets da conta podem aparecer junto com os pets da sessao.

2. Account wins em conflitos
- quando a mesma identidade de pet existe em sessao e conta, os dados da conta prevalecem.

3. Deduplicacao por chave de merge
- primeiro tenta `id`
- depois combina `name|breed|age_years|age_months`
- por fim usa chave fallback baseada no indice

4. Ordenacao de origem
- pets historicos da conta sao carregados em ordem mais recente primeiro, e a primeira ocorrencia de cada chave e preservada.

5. Soft delete
- remover pet nao apaga o registro; marca `deleted_at`, `deleted_by_user_id` e `deleted_reason = user_request`.
- a listagem da conta ignora pets com `deleted_at` em `wp_hsr_onboarding_pets`, mas os pets da sessao podem continuar no snapshot se estiverem la.

6. Reaproveitamento de cadastro entre fluxos
- o usuario pode ver novamente pets usados em outros fluxos de onboarding ou em pedidos anteriores.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_hsr_onboarding_sessions
- leitura da sessao pelo `session_id`
- campos relevantes:
  - `session_id`
  - `linked_user_id`
  - `checkout_order_id`
  - `pets` via JSON materializado no aggregate da sessao

2. wp_hsr_onboarding_pets
- leitura de pets persistidos por sessao e vinculados a usuario
- usada no merge historico da conta

3. wp_posts / wp_postmeta (WooCommerce)
- leitura do pedido referenciado pela sessao
- busca de pedidos recentes do usuario
- meta usada no fallback:
  - `_hsr_onboarding_session_id`

4. wp_users / usermeta
- fallback final via `hsr_onboarding_last_session`

## Queries observadas

A rota indireta usa estes padroes de consulta:

- `get_session(sessionId)` no repository SQL
- `wc_get_order(checkout_order_id)` para descobrir owner do pedido
- `wc_get_orders(...)` buscando pedidos com meta `_hsr_onboarding_session_id`
- `get_users(...)` com meta `hsr_onboarding_last_session`
- `wc_get_customer_orders(...)` para carregar historico de pets da conta
- join SQL entre `wp_hsr_onboarding_pets` e `wp_hsr_onboarding_sessions` quando carrega pets da conta por tabela

## Custom Post Types

- `shop_order` (WooCommerce)

## Taxonomias

- nenhuma taxonomia usada nesta rota

## Campos personalizados relevantes

- `_hsr_onboarding_session_id`
- `hsr_onboarding_last_session`
- `_hsr_onboarding_pets`

## Plugins e dependencias

1. headless-secure-registration
- endpoint REST, service, repository e regras de merge

2. WooCommerce
- `wc_get_order`
- `wc_get_orders`
- `wc_get_customer_orders`

3. wp usermeta / onboarding state
- fallback para associacao de usuario

## Regras de preco, moeda e pais

Esta rota nao calcula preco, moeda, imposto ou frete.

- preco: nao aplicavel
- moeda: nao aplicavel
- pais: nao aplicavel diretamente

A rota trabalha apenas com pets e contexto de conta/sessao.

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- GET /custom/v1/onboarding/session/:sessionId/pets

Controller:
- OnboardingApi::list_pets

Service:
- OnboardingService::list_pets
- merge_session_and_account_pets
- get_account_history_pets
- find_pet_in_user_sessions

Repository:
- OnboardingRepository::get
- leitura de `wp_hsr_onboarding_sessions`
- leitura de `wp_hsr_onboarding_pets`

Banco/tabelas utilizadas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets
- wp_posts/wp_postmeta (shop_order)
- wp_users/wp_usermeta

Regras de negocio:
- validacao por sessao
- merge entre pets de sessao e conta
- account wins em conflitos
- deduplicacao por id/identidade
- soft delete persistente

Campos retornados:
- session_id
- pets[]

## Node.js

Controller:
- OnboardingPetsController.list

Service:
- OnboardingPetsService.listForSession
- OnboardingPetsService.resolveAssociatedUser
- OnboardingPetsService.mergeSessionAndAccountPets

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingPetRepository.findBySessionId
- OnboardingPetRepository.findByUserIdFromOrders
- OnboardingOrderRepository.findOrdersBySessionMeta
- OnboardingUserRepository.findByLastSession

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity
- OrderEntity
- OrderMetaEntity
- UserMetaEntity (ou equivalente, se houver tabela modelada)

DTOs:

Entrada:
- ListOnboardingPetsParamsDto
  - sessionId: string

Saida:
- ListOnboardingPetsResponseDto
  - sessionId: string
  - pets: PetDto[]

PetDto recomendado:
- id: string
- name: string
- breed: string
- ageYears: number
- ageMonths: number
- age: number
- weightInput: number
- weightUnit: string
- weightKg: number
- weight: number
- size: string
- activityLevel: string
- petCondition: string
- neutered: boolean
- imageUrl?: string
- deletedAt?: string
- deletedByUserId?: number
- deletedReason?: string

Validacoes:
- sessionId obrigatorio
- token de sessao valido
- session existente
- ownership/usuario associado quando houver merge de conta
- compatibilidade com soft delete

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe sessionId
2. Guard valida sessao via token
3. Service carrega sessao
4. Service extrai pets da sessao
5. Service tenta resolver usuario associado
6. Se usuario existir, carrega pets historicos e aplica merge
7. Service retorna DTO normalizado para o front
8. Controller responde 200 com envelope padrao

## Modelo de dados necessario no Node

Minimo para paridade:

1. onboarding_sessions
- session_id
- linked_user_id
- checkout_order_id
- pets_json ou relacao normalizada

2. onboarding_pets
- id/uuid
- session_id
- user_id opcional
- pet_json ou colunas normalizadas
- deleted_at
- deleted_by_user_id
- deleted_reason

3. orders / order_meta
- necessario para fallback por `_hsr_onboarding_session_id`

4. users / user_meta
- necessario para fallback `hsr_onboarding_last_session`

## Possiveis problemas na migracao

1. Perda do merge historico
- se Node retornar apenas pets da sessao, o front perde pets reaproveitados da conta.

2. Deduplicacao diferente
- mudar a chave de merge altera qual pet aparece em conflitos.

3. Soft delete ignorado
- se `deleted_at` nao for respeitado, pets removidos podem reaparecer indevidamente.

4. Fallback de ownership ausente
- sem resolver usuario por pedido/meta, a UX de MyPets e Onboarding regressa.

5. Estrutura de pet divergente
- o front espera campos como `age_years`, `weight_unit` e `image_url`.

6. Regressao de sessao autenticada
- a rota precisa continuar funcionando tanto para onboarding quanto para telas de conta.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- extrai `sessionId`
- nao faz merge nem consulta de negocio

2. Service central
- resolve sessao, usuario, merge e deduplicacao
- aplica regra de account wins

3. Repository dedicado
- sessao, pets, pedidos, metadados e usermeta
- consultas indexadas para fallback

4. Normalizador de pet
- padroniza campos do DTO
- preserva compatibilidade com o front

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. sessao valida sem usuario resolvido -> retorna pets da sessao
3. usuario resolvido -> mescla pets da conta
4. conflito por mesmo id -> conta vence
5. conflito por mesma identidade -> conta vence
6. pet soft-deleted nao entra no merge historico
7. fallback por checkout_order_id funciona
8. fallback por `_hsr_onboarding_session_id` funciona
9. fallback por `hsr_onboarding_last_session` funciona
10. DTO de saida preserva `session_id` e `pets`

## Checklist de equivalencia

1. Endpoint GET equivalente preservado.
2. Validacao por sessao preservada.
3. Merge com pets da conta preservado.
4. Deduplicacao por id/identidade preservada.
5. Soft delete preservado.
6. Contrato `session_id + pets` preservado.
7. Campos de pet compativeis com o front preservados.
8. Controller sem regra de negocio.
9. TypeORM em Repository/Entity.
10. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
