# Eden Bowls - Fase 3 - Projeto Completo de APIs (Sem Codigo)

Escopo desta fase:

1. projetar endpoints REST da plataforma
2. definir autenticacao por endpoint
3. definir request/response padrao
4. definir regras de negocio por endpoint
5. definir matriz de erros por endpoint

Fora de escopo:

1. implementacao de controllers/services
2. codigo OpenAPI/Swagger gerado
3. testes automatizados

## 1) Convencoes globais de API

Base URL:

1. /api/v1

Headers padrao:

1. Authorization: Bearer <jwt> (rotas privadas)
2. x-correlation-id: opcional na entrada, obrigatorio na resposta
3. Idempotency-Key: obrigatorio em operacoes financeiras sensiveis

Auth modes:

1. Publica: sem token
2. Session Token: onboarding token temporario
3. Customer JWT: cliente autenticado
4. Admin JWT: administrador/operator/readonly conforme RBAC
5. Provider Signature: webhooks externos assinados

Formato de sucesso:

1. success: true
2. data: objeto ou lista
3. meta: paginacao, correlation_id, adicionais

Formato de erro:

1. success: false
2. error.code
3. error.message
4. error.details
5. correlation_id

Codigos de erro padrao:

1. 400 BAD_REQUEST
2. 401 UNAUTHORIZED
3. 403 FORBIDDEN
4. 404 NOT_FOUND
5. 409 CONFLICT
6. 422 UNPROCESSABLE_ENTITY
7. 429 TOO_MANY_REQUESTS
8. 500 INTERNAL_ERROR

## 2) Auth e acesso

## POST /auth/register

1. Metodo: POST
2. Auth: Publica
3. Request:
   - email
   - password
   - locale
   - accept_terms
4. Response:
   - user_id
   - status = pending
   - otp_expires_at
5. Regras:
   - email unico
   - senha forte
   - gera OTP inicial
6. Erros:
   - 409 email_exists
   - 422 weak_password
   - 429 rate_limited

## POST /auth/login

1. Metodo: POST
2. Auth: Publica
3. Request:
   - email
   - password
4. Response:
   - access_token
   - refresh_token
   - expires_in
   - user.roles
5. Regras:
   - usuario active
   - bloqueio progressivo por tentativas invalidas
6. Erros:
   - 401 invalid_credentials
   - 423 user_blocked
   - 429 rate_limited

## POST /auth/refresh

1. Metodo: POST
2. Auth: Publica (token de refresh no body)
3. Request:
   - refresh_token
4. Response:
   - access_token
   - refresh_token (rotacao)
5. Regras:
   - refresh valido e nao revogado
6. Erros:
   - 401 invalid_refresh
   - 409 token_reused

## POST /auth/logout

1. Metodo: POST
2. Auth: Customer JWT/Admin JWT
3. Request:
   - refresh_token opcional
4. Response:
   - revoked: true
5. Regras:
   - revoga familia de refresh quando aplicavel
6. Erros:
   - 401 unauthorized

## POST /auth/otp/verify

1. Metodo: POST
2. Auth: Publica
3. Request:
   - email
   - otp
   - purpose
4. Response:
   - verified: true
   - user.status = active
5. Regras:
   - OTP dentro do TTL
   - limite de tentativas
6. Erros:
   - 422 otp_invalid
   - 410 otp_expired
   - 429 otp_locked

## POST /auth/otp/resend

1. Metodo: POST
2. Auth: Publica
3. Request:
   - email
   - purpose
4. Response:
   - resent: true
   - next_allowed_at
5. Regras:
   - janela de reenvio
6. Erros:
   - 429 resend_limited

## GET /auth/me

1. Metodo: GET
2. Auth: Customer JWT/Admin JWT
3. Request: sem body
4. Response:
   - user
   - roles
   - permissions
5. Regras:
   - token valido
6. Erros:
   - 401 unauthorized

## 3) Perfil e clientes

## GET /profile

1. Metodo: GET
2. Auth: Customer JWT
3. Request: sem body
4. Response:
   - perfil
   - enderecos
5. Regras:
   - retorna apenas owner
6. Erros:
   - 401 unauthorized

## PATCH /profile/personal

1. Metodo: PATCH
2. Auth: Customer JWT
3. Request:
   - full_name
   - phone
   - phone_country
4. Response:
   - perfil atualizado
5. Regras:
   - validacao de formato
6. Erros:
   - 422 invalid_phone

## PATCH /profile/delivery

1. Metodo: PATCH
2. Auth: Customer JWT
3. Request:
   - delivery_instructions
4. Response:
   - perfil atualizado
5. Regras:
   - tamanho maximo de campo
6. Erros:
   - 422 invalid_delivery_notes

## PATCH /profile/email

1. Metodo: PATCH
2. Auth: Customer JWT
3. Request:
   - new_email
   - password
4. Response:
   - email_update_pending
5. Regras:
   - reconfirmacao por OTP
6. Erros:
   - 409 email_exists
   - 401 invalid_password

## PATCH /profile/password

1. Metodo: PATCH
2. Auth: Customer JWT
3. Request:
   - current_password
   - new_password
4. Response:
   - changed: true
5. Regras:
   - senha forte
6. Erros:
   - 401 invalid_password
   - 422 weak_password

## POST /profile/addresses

1. Metodo: POST
2. Auth: Customer JWT
3. Request:
   - type
   - country/state/city/postcode
   - address_1/address_2
   - is_default
4. Response:
   - address_id
5. Regras:
   - maximo configuravel de enderecos
6. Erros:
   - 422 invalid_address

## PATCH /profile/addresses/{id}

1. Metodo: PATCH
2. Auth: Customer JWT
3. Request:
   - campos parciais de endereco
4. Response:
   - endereco atualizado
5. Regras:
   - ownership obrigatoria
6. Erros:
   - 404 address_not_found
   - 403 forbidden

## DELETE /profile/addresses/{id}

1. Metodo: DELETE
2. Auth: Customer JWT
3. Request: sem body
4. Response:
   - deleted: true
5. Regras:
   - soft delete
6. Erros:
   - 404 address_not_found

## 4) Pets e racas

## GET /breeds

1. Metodo: GET
2. Auth: Publica
3. Request:
   - species opcional
   - locale opcional
4. Response:
   - lista de racas
5. Regras:
   - suporte PT/EN
6. Erros:
   - 400 invalid_species

## GET /pets

1. Metodo: GET
2. Auth: Customer JWT
3. Request: sem body
4. Response:
   - lista de pets do usuario
5. Regras:
   - ownership obrigatoria
6. Erros:
   - 401 unauthorized

## POST /pets

1. Metodo: POST
2. Auth: Customer JWT
3. Request:
   - name
   - species
   - breed_id
   - weight_kg
   - age/birth_date
   - neutered
   - activity_level
   - nutrition_goal
   - restrictions
4. Response:
   - pet_id
5. Regras:
   - validacao nutricional minima
6. Erros:
   - 422 invalid_pet_payload

## PATCH /pets/{id}

1. Metodo: PATCH
2. Auth: Customer JWT
3. Request: campos parciais do pet
4. Response:
   - pet atualizado
5. Regras:
   - ownership obrigatoria
6. Erros:
   - 404 pet_not_found
   - 403 forbidden

## DELETE /pets/{id}

1. Metodo: DELETE
2. Auth: Customer JWT
3. Request: sem body
4. Response:
   - deleted: true
5. Regras:
   - soft delete
6. Erros:
   - 404 pet_not_found

## 5) Onboarding

## POST /onboarding/sessions

1. Metodo: POST
2. Auth: Publica
3. Request:
   - locale
   - country
4. Response:
   - session_id
   - session_token
   - expires_at
5. Regras:
   - cria sessao anonima inicial
6. Erros:
   - 422 invalid_country
   - 429 rate_limited

## GET /onboarding/sessions/{sessionId}

1. Metodo: GET
2. Auth: Session Token ou owner JWT
3. Request: sem body
4. Response:
   - estado completo da sessao
5. Regras:
   - sessao nao expirada
6. Erros:
   - 404 session_not_found
   - 410 session_expired

## POST /onboarding/sessions/{sessionId}/token/refresh

1. Metodo: POST
2. Auth: Session Token
3. Request: sem body
4. Response:
   - new_session_token
   - expires_at
5. Regras:
   - renovacao permitida dentro da janela
6. Erros:
   - 410 session_expired

## POST /onboarding/sessions/{sessionId}/pets

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - dados do pet
4. Response:
   - pet_id vinculado a sessao
5. Regras:
   - valida dados minimos para recomendacao
6. Erros:
   - 422 invalid_pet_payload

## PATCH /onboarding/sessions/{sessionId}/pets/{petId}

1. Metodo: PATCH
2. Auth: Session Token
3. Request: campos de pet
4. Response:
   - pet atualizado
5. Regras:
   - pet precisa pertencer a sessao
6. Erros:
   - 404 session_pet_not_found

## DELETE /onboarding/sessions/{sessionId}/pets/{petId}

1. Metodo: DELETE
2. Auth: Session Token
3. Request: sem body
4. Response:
   - removed: true
5. Regras:
   - reordena sort_order da sessao
6. Erros:
   - 404 session_pet_not_found

## POST /onboarding/sessions/{sessionId}/questionnaire

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - answers por step
4. Response:
   - saved: true
   - next_step
5. Regras:
   - grava por step_key
6. Erros:
   - 422 invalid_answers

## POST /onboarding/sessions/{sessionId}/recurrence

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - frequency
   - term_months
4. Response:
   - recurrence_saved
5. Regras:
   - termo deve existir/estar ativo na configuracao
6. Erros:
   - 422 invalid_term

## POST /onboarding/sessions/{sessionId}/plan-selection

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - selected_variants
   - quantities
   - snapshot_hash
4. Response:
   - selection_saved
5. Regras:
   - selecao deve bater com snapshot valido
6. Erros:
   - 409 snapshot_mismatch

## GET /onboarding/sessions/{sessionId}/recommendation

1. Metodo: GET
2. Auth: Session Token
3. Request: sem body
4. Response:
   - recommendation_version
   - pet_results
   - totals
5. Regras:
   - exige dados minimos preenchidos
6. Erros:
   - 409 onboarding_incomplete

## GET /onboarding/sessions/{sessionId}/plan/snapshot

1. Metodo: GET
2. Auth: Session Token
3. Request: sem body
4. Response:
   - snapshot_hash
   - subtotal
   - total
5. Regras:
   - snapshot mais recente da sessao
6. Erros:
   - 404 snapshot_not_found

## POST /onboarding/sessions/{sessionId}/plan/preview

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - termo
   - frequencia
   - itens
4. Response:
   - preview financeiro
5. Regras:
   - nao persiste ordem
6. Erros:
   - 422 invalid_preview_payload

## POST /onboarding/sessions/{sessionId}/zipcode

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - postcode
   - country
4. Response:
   - saved: true
5. Regras:
   - formato por pais
6. Erros:
   - 422 invalid_postcode

## POST /onboarding/sessions/{sessionId}/zipcode/lookup

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - postcode
   - country
4. Response:
   - city/state/address_suggestions
5. Regras:
   - usa provider configurado
6. Erros:
   - 502 zipcode_provider_unavailable

## POST /onboarding/sessions/{sessionId}/address/autocomplete

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - query
   - country
4. Response:
   - suggestions
5. Regras:
   - timeout curto e fallback
6. Erros:
   - 502 autocomplete_provider_unavailable

## POST /onboarding/sessions/{sessionId}/shipping/quote

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - destination
   - items
4. Response:
   - quote_id
   - rates
   - expires_at
5. Regras:
   - BR manual_local suportado no go-live
   - US com USPS no go-live
6. Erros:
   - 422 invalid_shipping_payload
   - 502 shipping_provider_error

## POST /onboarding/sessions/{sessionId}/shipping/select

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - quote_id
   - rate_id
4. Response:
   - selected_shipping
5. Regras:
   - quote precisa estar valida (nao expirada)
6. Erros:
   - 409 quote_expired
   - 404 rate_not_found

## POST /onboarding/sessions/{sessionId}/account-link

1. Metodo: POST
2. Auth: Customer JWT + Session Token
3. Request: sem body
4. Response:
   - linked: true
5. Regras:
   - sessao passa a pertencer ao usuario autenticado
6. Erros:
   - 403 session_not_owned

## 6) Catalogo e pricing

## GET /catalog/categories

1. Metodo: GET
2. Auth: Publica
3. Request:
   - market
   - locale
4. Response:
   - categorias ativas
5. Regras:
   - filtra por mercado
6. Erros:
   - 422 invalid_market

## GET /catalog/products

1. Metodo: GET
2. Auth: Publica
3. Request:
   - category
   - market
   - currency
   - page/per_page
4. Response:
   - lista paginada de produtos
5. Regras:
   - somente ativos e disponiveis no mercado
6. Erros:
   - 422 invalid_filter

## GET /catalog/products/{productId}/variants

1. Metodo: GET
2. Auth: Publica
3. Request:
   - market
   - currency
4. Response:
   - variacoes com preco
5. Regras:
   - aplicar vigencia de sale_price
6. Erros:
   - 404 product_not_found

## GET /catalog/plans

1. Metodo: GET
2. Auth: Publica
3. Request:
   - market
   - currency
4. Response:
   - planos e termos disponiveis
5. Regras:
   - usa configuracao ativa de subscription_terms
6. Erros:
   - 404 no_active_terms

## GET /catalog/plans/{planId}

1. Metodo: GET
2. Auth: Publica
3. Request: sem body
4. Response:
   - detalhe do plano
5. Regras:
   - plano deve estar ativo
6. Erros:
   - 404 plan_not_found

## POST /catalog/plans/calculate

1. Metodo: POST
2. Auth: Publica
3. Request:
   - pets
   - term_months
   - market
   - currency
4. Response:
   - subtotal
   - discount
   - total
5. Regras:
   - validacao de pets
   - descontos por configuracao
6. Erros:
   - 422 invalid_calculation_payload

## 7) Checkout e pedidos

## POST /onboarding/sessions/{sessionId}/checkout

1. Metodo: POST
2. Auth: Session Token
3. Headers:
   - Idempotency-Key obrigatoria
4. Request:
   - snapshot_hash
   - selected_shipping
   - billing_address
5. Response:
   - checkout_order_id
   - payment_intent_ref
   - status
6. Regras:
   - snapshot deve ser valido
   - shipping selecionado e nao expirado
7. Erros:
   - 409 snapshot_mismatch
   - 409 quote_expired
   - 409 idempotency_conflict

## POST /onboarding/sessions/{sessionId}/payment-intent/ack

1. Metodo: POST
2. Auth: Session Token
3. Request:
   - payment_intent_id
   - status
4. Response:
   - payment_state atualizado
5. Regras:
   - ack apenas para ordem vinculada a sessao
6. Erros:
   - 404 checkout_order_not_found
   - 409 invalid_payment_transition

## GET /orders

1. Metodo: GET
2. Auth: Customer JWT
3. Request:
   - status
   - page/per_page
4. Response:
   - lista paginada de pedidos do cliente
5. Regras:
   - ownership obrigatoria
6. Erros:
   - 401 unauthorized

## GET /orders/{orderId}

1. Metodo: GET
2. Auth: Customer JWT
3. Request: sem body
4. Response:
   - detalhe do pedido
   - timeline de status
5. Regras:
   - ownership obrigatoria
6. Erros:
   - 404 order_not_found
   - 403 forbidden

## 8) Assinaturas

## POST /billing/subscriptions

1. Metodo: POST
2. Auth: Customer JWT
3. Headers:
   - Idempotency-Key obrigatoria
4. Request:
   - checkout_order_id
   - payment_method_id
5. Response:
   - subscription_id
   - provider_subscription_id
   - status
6. Regras:
   - checkout elegivel
   - evita duplicidade por idempotencia
7. Erros:
   - 409 checkout_not_eligible
   - 409 idempotency_conflict

## GET /billing/subscriptions

1. Metodo: GET
2. Auth: Customer JWT
3. Request:
   - status opcional
4. Response:
   - lista de assinaturas do usuario
5. Regras:
   - ownership obrigatoria
6. Erros:
   - 401 unauthorized

## GET /billing/subscriptions/{subscriptionId}

1. Metodo: GET
2. Auth: Customer JWT
3. Request: sem body
4. Response:
   - detalhe da assinatura
   - itens
   - proxima cobranca
5. Regras:
   - ownership obrigatoria
6. Erros:
   - 404 subscription_not_found
   - 403 forbidden

## PATCH /billing/subscriptions/{subscriptionId}

1. Metodo: PATCH
2. Auth: Customer JWT ou Admin JWT
3. Request:
   - action (pause, resume, cancel, swap)
   - payload opcional
4. Response:
   - assinatura atualizada
5. Regras:
   - transicao valida de estado
   - politica de proracao via configuracao
6. Erros:
   - 409 invalid_subscription_transition
   - 422 invalid_action_payload

## POST /billing/subscriptions/{subscriptionId}/actions

1. Metodo: POST
2. Auth: Customer JWT ou Admin JWT
3. Request:
   - action_type
   - effective_mode (immediate, next_renewal)
   - proration_mode (none, prorated)
4. Response:
   - action_result
5. Regras:
   - regras pendentes lidas de configuracao
6. Erros:
   - 422 unsupported_action
   - 409 action_not_allowed

## 9) Billing Stripe e webhooks

## POST /billing/catalog/sync

1. Metodo: POST
2. Auth: Admin JWT (admin/operator)
3. Request:
   - market
   - currency
4. Response:
   - sync_job_id
   - status
5. Regras:
   - somente perfil operacional
6. Erros:
   - 403 forbidden
   - 409 sync_already_running

## POST /billing/catalog/sync/{productId}

1. Metodo: POST
2. Auth: Admin JWT (admin/operator)
3. Request: sem body
4. Response:
   - sync_job_id
5. Regras:
   - produto precisa existir
6. Erros:
   - 404 product_not_found

## GET /billing/catalog/sync/status

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - sync_job_id
4. Response:
   - estado do job
   - resumo de progresso
5. Regras:
   - leitura operacional
6. Erros:
   - 404 sync_job_not_found

## GET /billing/catalog/sync/health

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - market
   - currency
4. Response:
   - gaps de mapeamento
5. Regras:
   - relatorio de consistencia catalogo x stripe
6. Erros:
   - 422 invalid_market

## GET /billing/products/{productId}/variants/{variantId}/stripe-price

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - currency
4. Response:
   - stripe_product_id
   - stripe_price_id
   - synced_at
5. Regras:
   - mapeamento por moeda
6. Erros:
   - 404 stripe_mapping_not_found

## POST /billing/webhooks/stripe

1. Metodo: POST
2. Auth: Provider Signature
3. Request:
   - payload Stripe bruto
   - assinatura no header
4. Response:
   - received: true
5. Regras:
   - validar assinatura
   - idempotencia por provider/event_id
   - retry controlado em falha
6. Erros:
   - 400 invalid_signature
   - 409 duplicate_event

## 10) Admin operacional

## GET /admin/onboarding/sessions

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - filtros de status, periodo, pais
4. Response:
   - lista paginada
5. Regras:
   - somente leitura operacional
6. Erros:
   - 403 forbidden

## GET /admin/onboarding/sessions/{id}

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request: sem body
4. Response:
   - visao 360 da sessao
5. Regras:
   - inclui trilha de eventos
6. Erros:
   - 404 session_not_found

## GET /admin/onboarding/metrics

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - periodo
   - mercado
4. Response:
   - metricas de funil
5. Regras:
   - agregados somente
6. Erros:
   - 422 invalid_period

## GET /admin/catalog/products

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - filtros e pagina
4. Response:
   - produtos paginados
5. Regras:
   - leitura para readonly
6. Erros:
   - 403 forbidden

## POST /admin/catalog/products

1. Metodo: POST
2. Auth: Admin JWT (admin/operator)
3. Request:
   - dados de produto e mercado
4. Response:
   - product_id
5. Regras:
   - validacao de slug e categoria
6. Erros:
   - 409 slug_exists
   - 422 invalid_payload

## PATCH /admin/catalog/products/{id}

1. Metodo: PATCH
2. Auth: Admin JWT (admin/operator)
3. Request:
   - campos de produto/variacoes
4. Response:
   - produto atualizado
5. Regras:
   - auditar alteracoes
6. Erros:
   - 404 product_not_found

## GET /admin/catalog/pricing

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - market
   - currency
5. Response:
   - matriz de precos
6. Regras:
   - leitura para readonly
7. Erros:
   - 422 invalid_market

## POST /admin/catalog/pricing

1. Metodo: POST
2. Auth: Admin JWT (admin/operator)
3. Request:
   - variant_id
   - currency
   - regular_price
   - sale_price
   - vigencia
4. Response:
   - price_id
5. Regras:
   - sale_price <= regular_price
6. Erros:
   - 422 invalid_price

## GET /admin/billing/webhooks

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - state
   - period
   - page/per_page
4. Response:
   - eventos de webhook
5. Regras:
   - apenas leitura
6. Erros:
   - 403 forbidden

## GET /admin/billing/subscriptions

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - status
   - market
   - page/per_page
4. Response:
   - lista de assinaturas
5. Regras:
   - dados mascarados quando necessarios
6. Erros:
   - 403 forbidden

## 11) Configuracao de regras pendentes

## GET /admin/config/business-rules

1. Metodo: GET
2. Auth: Admin JWT (admin/operator/readonly)
3. Request:
   - domain
   - market
4. Response:
   - regras configuradas
5. Regras:
   - permite visualizar politicas pendentes
6. Erros:
   - 403 forbidden

## PUT /admin/config/business-rules/{id}

1. Metodo: PUT
2. Auth: Admin JWT (admin)
3. Request:
   - value_json
   - effective_from
4. Response:
   - regra atualizada
5. Regras:
   - versionamento por vigencia
6. Erros:
   - 422 invalid_config

## 12) Matriz resumida de regras criticas

1. Idempotency-Key obrigatoria:
   - POST /onboarding/sessions/{sessionId}/checkout
   - POST /billing/subscriptions
2. Signature obrigatoria:
   - POST /billing/webhooks/stripe
3. Ownership obrigatoria:
   - /profile/*
   - /pets/*
   - /orders/*
   - /billing/subscriptions/* (customer)
4. RBAC obrigatorio:
   - /admin/*
   - /billing/catalog/sync*

## 13) Criterios de pronto da fase 3

1. todos os endpoints criticos mapeados
2. contrato de autenticacao definido por rota
3. regras de negocio por endpoint documentadas
4. erros esperados documentados
5. pronto para converter em OpenAPI na fase de implementacao
