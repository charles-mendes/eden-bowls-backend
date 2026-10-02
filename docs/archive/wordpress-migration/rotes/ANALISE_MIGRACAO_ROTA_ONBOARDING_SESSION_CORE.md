# Analise Tecnica - Migracao das Rotas Core de Onboarding Session para Node.js

## Escopo

Rotas atuais no WordPress:

- POST /custom/v1/onboarding/session/start
- GET /custom/v1/onboarding/session/:sessionId
- POST /custom/v1/onboarding/session/:sessionId/token/refresh
- POST /custom/v1/onboarding/session/:sessionId/account-link

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts
  - ensureOnboardingSession
  - ensureFreshSessionToken
  - refreshSessionToken
  - buildSessionHeaders
  - linkSessionToAuthenticatedUser
  - fetchOnboardingSessionSnapshot

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-geo-detection-service.php
- eden-bowls/src/services/onboardingApi.ts

## Resumo executivo

As quatro rotas formam o nucleo de identidade de sessao do onboarding.

1. start cria sessao em SQL e emite token proprio da sessao.
2. get_session devolve snapshot filtrado da sessao.
3. token/refresh reemite token para o mesmo session_id.
4. account-link vincula sessao ao usuario autenticado e sincroniza dados para user_meta.

Pontos criticos para paridade:

1. Prioridade do header x-session-token sobre Authorization para token de sessao.
2. Dupla autenticacao no fluxo account-link: sessao valida + usuario logado.
3. Rate limit no start e nas rotas autenticadas por sessao.
4. Persistencia em tabelas customizadas SQL e nao em CPT.
5. Side effects fortes do account-link em metadados do usuario.

## Responsabilidade por rota

### 1) POST /custom/v1/onboarding/session/start

Responsabilidade:

1. Receber seed inicial da sessao (locale, country, state).
2. Resolver country via GeoDetectionService::resolve_country_for_session_seed.
3. Criar sessao na tabela hsr_onboarding_sessions.
4. Emitir session token assinado por HMAC.

Permissao:

- permission_callback: __return_true
- sem JWT de usuario
- sem token de sessao previo

### 2) GET /custom/v1/onboarding/session/:sessionId

Responsabilidade:

1. Validar acesso a sessao via token.
2. Buscar sessao por session_id.
3. Retornar presentacao parcial (present_session), nao necessariamente o objeto interno completo.

Permissao:

- permission_callback: require_valid_session_access
- exige token de sessao valido

### 3) POST /custom/v1/onboarding/session/:sessionId/token/refresh

Responsabilidade:

1. Validar sessao existente.
2. Validar token atual contra o session_id.
3. Emitir novo token com novo exp.

Permissao:

- permission_callback: require_valid_session_access
- exige token de sessao valido

### 4) POST /custom/v1/onboarding/session/:sessionId/account-link

Responsabilidade:

1. Exigir usuario autenticado.
2. Mesclar pets da sessao com historico da conta.
3. Marcar sessao como linked e preencher linked_user_id.
4. Salvar snapshot e resumo de merge em user_meta.
5. Sincronizar endereco/preferencias da sessao para user_meta.

Permissao:

- permission_callback: require_authenticated_session_access
- exige usuario logado
- exige token de sessao valido

## Parametros recebidos

### start

Body:

- locale: string (opcional)
- country: string (opcional; normalizado)
- state: string (opcional)

Headers:

- Content-Type: application/json

### get_session

Path:

- session_id: string

Headers:

- x-session-token: token da sessao (prioritario)
- Authorization: Bearer <token> (fallback para extracao de token de sessao)

### token/refresh

Path:

- session_id: string

Headers:

- x-session-token ou Authorization Bearer
- Content-Type: application/json

Body:

- vazio (front envia {})

### account-link

Path:

- session_id: string

Headers:

- x-session-token: token da sessao
- Authorization: Bearer <JWT de usuario>
- Content-Type: application/json

Body:

- vazio (front envia {})

## Validacoes e regras de acesso

## 1) Rate limit

Start:

- scope start
- limite padrao: 20 tentativas / 300s por visitante
- erro: rate_limit (429)

Auth/session routes (get_session, refresh, account-link):

- scope auth
- limite padrao: 300 tentativas / 300s por sessao
- configuravel por env:
  - HSR_ONBOARDING_AUTH_RATE_LIMIT_MAX
  - HSR_ONBOARDING_AUTH_RATE_LIMIT_WINDOW
- erro: rate_limit (429)

## 2) Validacao do token de sessao

Servico: SessionTokenService::validate

Regras:

1. Formato token: payloadBase64Url.signatureHmac
2. Signature: hash_hmac sha256 com secret do WP (AUTH_KEY/wp_salt)
3. Payload minimo:
   - sid
   - iat
   - exp
4. exp deve ser futuro
5. sid do token deve ser igual ao session_id da URL

Erros:

- session_token_missing (401)
- session_token_invalid (401)
- session_token_expired (401)
- session_forbidden (403)

## 3) Regras de autenticacao por rota

- start: publica
- get_session/refresh: sessao valida obrigatoria
- account-link: usuario logado + sessao valida

Erros comuns:

- unauthorized (401)
- session_unauthorized (401)
- session_forbidden (403)
- session_not_found (404)

## 4) Validacao de existencia da sessao

Todas as rotas com session_id verificam existencia em repository->get.

Comportamento relevante:

- se nao achar em SQL, tenta transient legado
- se transient existir, faz lazy migrate para SQL
- se nao existir, retorna session_not_found (404)

## Estrutura de resposta

## start (201)

Envelope:

- success: true
- data:
  - session: objeto completo interno
  - session_token: string
  - token_type: Bearer
  - expires_in: int
  - expires_at: ISO datetime

Observacao:

- o front usa session.session_id e session_token para persistir estado local.

## get_session (200)

Envelope:

- success: true
- data: present_session(session)

Campos retornados no snapshot:

- session_id
- status
- checkout_order_id
- pets
- questionnaire
- recurrence
- plan_selection
- shipping (atalho de plan_selection.shipping)
- zipcode
- locale
- country
- state
- created_at
- updated_at

Regra escondida:

- linked_user_id existe no estado interno, mas nao aparece no snapshot publico de get_session.

## token/refresh (200)

Envelope:

- success: true
- data:
  - session_id
  - session_token
  - token_type: Bearer
  - expires_in
  - expires_at

## account-link (200)

Envelope:

- success: true
- data: sessao completa interna apos link e merge

Campos relevantes alterados:

- linked_user_id
- status = linked
- pets (merge)
- merge_summary (injetado no retorno)

## Regras de negocio escondidas no WordPress

1. Prioridade de header
- x-session-token sempre tem prioridade sobre Authorization para validar sessao.
- Isso permite Authorization ficar reservado para JWT do usuario em rotas mistas.

2. Token nao e JWT padrao
- e um token HMAC simples com payload base64url + assinatura.
- nao ha refresh token separado.

3. Session TTL configuravel
- padrao 172800s (2 dias), com piso 1800s.
- filtro/env pode alterar TTL.

4. Geo seed do country
- start pode ignorar country enviado no payload quando real detection estiver habilitada.
- valores normalizados em US, BR, OTHER, UNKNOWN ou vazio.

5. account-link faz merge de pets
- nao apenas marca linked_user_id.
- reconcilia pets da sessao com pets de historico da conta.

6. account-link propaga estado para user_meta
- salva onboarding snapshot e resumo de merge.
- sincroniza endereco (billing/shipping) e preferencias comerciais.

7. Migracao transparente de armazenamento legado
- repository->get tenta transient legado e persiste em SQL automaticamente.

## Controller, Service, Repository e entidades atuais (WP)

Controller (camada REST):

- OnboardingApi::start_session
- OnboardingApi::get_session
- OnboardingApi::refresh_session_token
- OnboardingApi::link_account

Service (regras):

- OnboardingService::start_session
- OnboardingService::get_session
- OnboardingService::refresh_session_token
- OnboardingService::link_account

Repositorios:

- OnboardingRepository

Servico de token:

- SessionTokenService

Dependencias de apoio:

- GeoDetectionService
- RateLimiter

## Banco, queries, CPT, taxonomias, custom fields, plugins

## Tabelas SQL customizadas

1. wp_hsr_onboarding_sessions
- PK: session_id
- campos chave: status, linked_user_id, checkout_order_id, locale, country, state
- blobs json: questionnaire_json, recurrence_json, package_selection_json, menu_selection_json, plan_selection_json, stripe_checkout_json, zipcode_json
- indexes: linked_user_id, checkout_order_id, updated_at

2. wp_hsr_onboarding_pets
- PK: id auto increment
- relacao: session_id
- campos chave: pet_uuid, pet_json
- indexes: session_id, pet_uuid

## Queries relevantes

1. Carregar sessao por id
- SELECT * FROM wp_hsr_onboarding_sessions WHERE session_id = ? LIMIT 1

2. Carregar pets da sessao
- SELECT pet_json FROM wp_hsr_onboarding_pets WHERE session_id = ? ORDER BY id ASC

3. Persistencia de sessao
- upsert logico via INSERT/UPDATE em wp_hsr_onboarding_sessions
- replace de pets: DELETE by session_id + INSERT sequencial

## CPT

- nenhum CPT para estas quatro rotas

## Taxonomias

- nenhuma taxonomia usada diretamente

## Custom fields/metadados afetados no account-link

Endereco e contato:

- billing_address_1, billing_address_2, billing_city, billing_state, billing_postcode, billing_country
- shipping_address_1, shipping_address_2, shipping_city, shipping_state, shipping_postcode, shipping_country
- billing_phone
- _eden_phone_country
- _eden_delivery_instructions

Snapshot e controle onboarding:

- hsr_onboarding_last_session
- hsr_onboarding_snapshot
- hsr_onboarding_last_merge_summary

Preferencias:

- hsr_locale
- hsr_market_country
- hsr_recurrence_frequency
- hsr_recurrence_period_days
- hsr_questionnaire_preferences
- hsr_questionnaire_restrictions
- hsr_plan_subscription_term_months
- hsr_plan_discount_percent
- hsr_flavors_by_pet
- hsr_shipping_preference

## Plugins/dependencias

1. headless-secure-registration
- rotas, servicos, repositorio, token, geo, rate-limit

2. WordPress core
- REST API, is_user_logged_in, user_meta, transient API

3. WooCommerce (indireto neste pacote)
- account-link aproveita dados da conta/historico em fluxos seguintes de checkout

## Regras de moeda, pais e precificacao

Estas quatro rotas nao calculam preco diretamente.

Impacto de pais:

1. country e definido no start e persistido na sessao.
2. country influencia etapas posteriores (peso, frete, imposto, moeda e catalogo), mesmo que nao haja calculo aqui.

Moeda:

- nao retornada por estas rotas.
- determinada em etapas de plan/subscription e checkout.

## Mapeamento WordPress -> Node.js (Express + TypeORM)

## Endpoints sugeridos no Node mantendo contrato atual

1. POST /custom/v1/onboarding/session/start
2. GET /custom/v1/onboarding/session/:sessionId
3. POST /custom/v1/onboarding/session/:sessionId/token/refresh
4. POST /custom/v1/onboarding/session/:sessionId/account-link

## Controllers sugeridos

- OnboardingSessionController.start
- OnboardingSessionController.getById
- OnboardingSessionController.refreshToken
- OnboardingSessionController.linkAccount

Controller deve apenas:

1. Extrair params/headers/body.
2. Chamar service.
3. Traduzir DomainError para HTTP.

## Services sugeridos

- OnboardingSessionService.startSession
- OnboardingSessionService.getSessionSnapshot
- OnboardingSessionService.refreshSessionToken
- OnboardingSessionService.linkAccount
- SessionTokenService.issue
- SessionTokenService.validate

## Repositories sugeridos

- OnboardingSessionRepository
- OnboardingPetRepository
- UserMetaRepository

## Entidades TypeORM sugeridas

- OnboardingSessionEntity
- OnboardingPetEntity
- UserMetaEntity (ou adaptador para armazenamento equivalente)

## Modelo de dados minimo para paridade

OnboardingSessionEntity:

- sessionId (string, pk)
- status (active|linked)
- linkedUserId (nullable)
- checkoutOrderId (nullable)
- locale
- country
- state
- questionnaireJson
- recurrenceJson
- packageSelectionJson
- menuSelectionJson
- planSelectionJson
- stripeCheckoutJson
- zipcodeJson
- createdAt
- updatedAt

OnboardingPetEntity:

- id (pk autoincrement ou uuid)
- sessionId (fk)
- petUuid
- petJson
- createdAt
- updatedAt

## Riscos de migracao

1. Quebra de contrato de header
- se x-session-token nao tiver prioridade, account-link pode falhar com Authorization de usuario.

2. Divergencia de token
- trocar formato do token sem compatibilidade pode invalidar sessoes em andamento.

3. Perda de side effects do account-link
- se user_meta nao for sincronizado, fluxo posterior de checkout/assinatura fica inconsistente.

4. Snapshot diferente no get_session
- expor campos internos adicionais ou omitir campos esperados quebra o front.

5. Concorrencia em persistencia de pets
- replace total de pets pode perder atualizacoes se nao houver controle de concorrencia basico.

6. Esquecer fallback de armazenamento legado
- durante transicao, sessoes antigas podem parar de ser lidas.

## Sugestao de implementacao (sem codigo)

Fase 1 - compatibilidade de contrato:

1. Reproduzir exatamente as quatro rotas e envelopes atuais.
2. Reproduzir extracao de token com prioridade para x-session-token.
3. Reproduzir codigos HTTP e codigos de erro.

Fase 2 - persistencia e seguranca:

1. Implementar entidades TypeORM espelhando schema atual.
2. Implementar SessionTokenService compativel com TTL e validacoes atuais.
3. Implementar middleware de rate limit por escopo start/auth.

Fase 3 - account-link e side effects:

1. Portar rotina de merge de pets.
2. Portar sincronizacao de metadados de endereco e preferencias.
3. Garantir idempotencia basica do link para chamadas repetidas.

Fase 4 - observabilidade e rollout:

1. Logar erros por codigo de dominio (session_not_found, session_forbidden, session_token_expired etc).
2. Publicar com feature flag e comparar respostas WP vs Node em smoke tests.
3. Migrar frontend gradualmente mantendo fallback para WP durante janela de corte.

## Checklist de paridade para aprovacao

1. start retorna 201 com session + session_token + expires.
2. get_session retorna snapshot com os mesmos campos atuais.
3. refresh reemite token valido para o mesmo session_id.
4. account-link exige JWT de usuario e token de sessao valido.
5. user_meta essencial e atualizado apos account-link.
6. rate limit e codigos de erro estao equivalentes.
7. front atual funciona sem mudanca de contrato nessas quatro rotas.
