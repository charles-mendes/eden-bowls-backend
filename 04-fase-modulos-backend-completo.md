# Eden Bowls - Fase 4 - Projeto Completo dos Modulos Backend (Sem Codigo)

Escopo desta fase:

1. detalhar modulo por modulo do backend
2. definir responsabilidades
3. definir services
4. definir repositories
5. definir controllers
6. definir DTOs
7. definir validacoes

Fora de escopo:

1. implementacao de codigo
2. testes automatizados implementados
3. configuracao de deploy

## 1) Padrao estrutural por modulo

Cada modulo segue a estrutura:

1. application/
   - use-cases (services)
   - dto
   - validators
2. domain/
   - entities
   - rules
   - events
3. infrastructure/
   - repositories
   - mappers
   - providers
4. presentation/
   - controllers
   - serializers

## 2) Modulo Auth

Responsabilidade:

1. ciclo completo de autenticacao e sessao
2. OTP de ativacao e recuperacao
3. refresh token com rotacao e revogacao

Services:

1. RegisterUserService
2. LoginService
3. RefreshTokenService
4. LogoutService
5. VerifyOtpService
6. ResendOtpService

Repositories:

1. UsersRepository
2. RefreshTokensRepository
3. OtpChallengesRepository
3. UserRolesRepository

Controllers:

1. AuthController
   - POST /auth/register
   - POST /auth/login
   - POST /auth/refresh
   - POST /auth/logout
   - POST /auth/otp/verify
   - POST /auth/otp/resend
   - GET /auth/me

DTOs:

1. RegisterRequestDto
2. LoginRequestDto
3. RefreshRequestDto
4. OtpVerifyRequestDto
5. OtpResendRequestDto
6. AuthResponseDto

Validacoes:

1. email valido e unico
2. senha forte
3. OTP por finalidade e TTL
4. limite de tentativas e reenvio
5. status do usuario (pending/active/blocked)

## 3) Modulo RBAC

Responsabilidade:

1. autorizacao baseada em papel e permissao
2. isolamento de rotas admin e operacionais

Services:

1. AuthorizeActionService
2. ResolveUserPermissionsService

Repositories:

1. RolesRepository
2. PermissionsRepository
3. RolePermissionsRepository
4. UserRolesRepository

Controllers:

1. sem controller proprio obrigatorio
2. usado por guards/middlewares de autorizacao

DTOs:

1. PermissionCheckDto
2. UserPermissionSnapshotDto

Validacoes:

1. role existente
2. permissao obrigatoria por recurso/acao
3. fallback deny-by-default

## 4) Modulo Users/Profile

Responsabilidade:

1. gestao de perfil do cliente
2. gestao de enderecos

Services:

1. GetProfileService
2. UpdatePersonalProfileService
3. UpdateDeliveryProfileService
4. ChangeEmailService
5. ChangePasswordService
6. CreateAddressService
7. UpdateAddressService
8. DeleteAddressService

Repositories:

1. UsersRepository
2. UserProfilesRepository
3. UserAddressesRepository

Controllers:

1. ProfileController
   - GET /profile
   - PATCH /profile/personal
   - PATCH /profile/delivery
   - PATCH /profile/email
   - PATCH /profile/password
   - POST /profile/addresses
   - PATCH /profile/addresses/:id
   - DELETE /profile/addresses/:id

DTOs:

1. UpdatePersonalProfileDto
2. UpdateDeliveryProfileDto
3. ChangeEmailDto
4. ChangePasswordDto
5. CreateAddressDto
6. UpdateAddressDto
7. ProfileResponseDto

Validacoes:

1. ownership obrigatoria
2. telefone e endereco por padrao de pais
3. limite de tamanho de campos
4. endereco default unico por tipo

## 5) Modulo Breeds

Responsabilidade:

1. catalogo de racas e suporte de localizacao

Services:

1. ListBreedsService

Repositories:

1. BreedsRepository

Controllers:

1. BreedsController
   - GET /breeds

DTOs:

1. ListBreedsQueryDto
2. BreedResponseDto

Validacoes:

1. species permitido
2. locale suportado

## 6) Modulo Pets

Responsabilidade:

1. cadastro e manutencao de pets do cliente

Services:

1. ListPetsService
2. CreatePetService
3. UpdatePetService
4. DeletePetService

Repositories:

1. PetsRepository
2. BreedsRepository

Controllers:

1. PetsController
   - GET /pets
   - POST /pets
   - PATCH /pets/:id
   - DELETE /pets/:id

DTOs:

1. CreatePetDto
2. UpdatePetDto
3. PetResponseDto

Validacoes:

1. ownership
2. peso, idade e atividade em ranges validos
3. species e breed coerentes
4. soft delete para manter historico

## 7) Modulo Onboarding

Responsabilidade:

1. sessao onboarding e estado da jornada
2. armazenamento de respostas por etapa
3. vinculo de sessao com conta autenticada

Services:

1. StartOnboardingSessionService
2. GetOnboardingSessionService
3. RefreshOnboardingTokenService
4. AddPetToSessionService
5. UpdateSessionPetService
6. RemoveSessionPetService
7. SaveQuestionnaireService
8. SaveRecurrenceService
9. SavePlanSelectionService
10. SaveZipcodeService
11. LinkSessionToAccountService

Repositories:

1. OnboardingSessionsRepository
2. OnboardingAnswersRepository
3. OnboardingSessionPetsRepository
4. PetsRepository

Controllers:

1. OnboardingController
   - POST /onboarding/sessions
   - GET /onboarding/sessions/:sessionId
   - POST /onboarding/sessions/:sessionId/token/refresh
   - POST /onboarding/sessions/:sessionId/pets
   - PATCH /onboarding/sessions/:sessionId/pets/:petId
   - DELETE /onboarding/sessions/:sessionId/pets/:petId
   - POST /onboarding/sessions/:sessionId/questionnaire
   - POST /onboarding/sessions/:sessionId/recurrence
   - POST /onboarding/sessions/:sessionId/plan-selection
   - POST /onboarding/sessions/:sessionId/zipcode
   - POST /onboarding/sessions/:sessionId/account-link

DTOs:

1. StartSessionDto
2. SaveQuestionnaireDto
3. SaveRecurrenceDto
4. SavePlanSelectionDto
5. SaveZipcodeDto
6. SessionResponseDto

Validacoes:

1. token de sessao valido e nao expirado
2. consistencia de estado por etapa
3. sessao pertence ao usuario quando autenticado
4. payload de pets e respostas valido

## 8) Modulo Recommendation

Responsabilidade:

1. motor de recomendacao nutricional
2. versionamento de algoritmo
3. snapshot para consistencia de checkout

Services:

1. ComputeRecommendationService
2. GetRecommendationService
3. BuildPlanSnapshotService
4. ValidateSnapshotSelectionService
5. PreviewPlanService

Repositories:

1. RecommendationRunsRepository
2. RecommendationPetResultsRepository
3. PlanSnapshotsRepository
4. OnboardingSessionsRepository

Controllers:

1. RecommendationController
   - GET /onboarding/sessions/:sessionId/recommendation
   - GET /onboarding/sessions/:sessionId/plan/snapshot
   - POST /onboarding/sessions/:sessionId/plan/preview

DTOs:

1. RecommendationResponseDto
2. PlanSnapshotResponseDto
3. PlanPreviewRequestDto
4. PlanPreviewResponseDto

Validacoes:

1. dados minimos de pets e respostas
2. recommendation_version obrigatoria
3. snapshot_hash valido e ativo
4. currency/market coerentes

## 9) Modulo Catalog

Responsabilidade:

1. produtos, categorias, variacoes e disponibilidade

Services:

1. ListCategoriesService
2. ListProductsService
3. GetProductVariantsService
3. AdminCreateProductService
4. AdminUpdateProductService

Repositories:

1. CategoriesRepository
2. ProductsRepository
3. ProductVariantsRepository
4. ProductMarketConfigRepository

Controllers:

1. CatalogPublicController
   - GET /catalog/categories
   - GET /catalog/products
   - GET /catalog/products/:productId/variants
2. CatalogAdminController
   - GET /admin/catalog/products
   - POST /admin/catalog/products
   - PATCH /admin/catalog/products/:id

DTOs:

1. ListProductsQueryDto
2. ProductResponseDto
3. ProductVariantResponseDto
4. AdminCreateProductDto
5. AdminUpdateProductDto

Validacoes:

1. slug unico
2. SKU unico
3. produto ativo por mercado
4. traducao e consistencia de dados

## 10) Modulo Pricing

Responsabilidade:

1. matriz de precificacao por moeda/mercado
2. termos de assinatura e descontos configuraveis

Services:

1. ListPlansService
2. GetPlanService
3. CalculatePlanService
4. ListAdminPricingService
5. UpsertAdminPricingService
6. ResolveActiveSubscriptionTermService

Repositories:

1. VariantPricesRepository
2. SubscriptionTermsRepository
3. ProductVariantsRepository

Controllers:

1. PricingPublicController
   - GET /catalog/plans
   - GET /catalog/plans/:planId
   - POST /catalog/plans/calculate
2. PricingAdminController
   - GET /admin/catalog/pricing
   - POST /admin/catalog/pricing

DTOs:

1. CalculatePlanRequestDto
2. CalculatePlanResponseDto
3. AdminUpsertPriceDto
4. PlanResponseDto

Validacoes:

1. sale_price <= regular_price
2. termo ativo para mercado
3. currency compativel com market
4. regras pendentes vindas de configuracao

## 11) Modulo Shipping

Responsabilidade:

1. cotacao e selecao de frete
2. estrategia por mercado (BR manual local, US USPS)

Services:

1. CreateShippingQuoteService
2. SelectShippingRateService
3. LookupZipcodeService
4. AutocompleteAddressService

Repositories:

1. ShippingQuotesRepository
2. ShippingQuoteRatesRepository
3. OnboardingSessionsRepository

Providers:

1. ShippingProviderStrategy
2. BrManualShippingProvider
3. UspsShippingProvider

Controllers:

1. ShippingController
   - POST /onboarding/sessions/:sessionId/zipcode/lookup
   - POST /onboarding/sessions/:sessionId/address/autocomplete
   - POST /onboarding/sessions/:sessionId/shipping/quote
   - POST /onboarding/sessions/:sessionId/shipping/select

DTOs:

1. ShippingQuoteRequestDto
2. ShippingQuoteResponseDto
3. ShippingSelectRequestDto
4. ShippingSelectResponseDto

Validacoes:

1. endereco completo
2. quote nao expirada
3. rate pertence a quote
4. moeda do frete igual a moeda do checkout

## 12) Modulo Checkout

Responsabilidade:

1. criacao transacional de checkout order
2. idempotencia financeira
3. ack de estado de pagamento

Services:

1. CreateCheckoutOrderService
2. AcknowledgePaymentIntentService
3. ValidateCheckoutReadinessService

Repositories:

1. CheckoutOrdersRepository
2. CheckoutOrderItemsRepository
3. CheckoutShippingSelectionRepository
4. PlanSnapshotsRepository
5. IdempotencyKeysRepository

Controllers:

1. CheckoutController
   - POST /onboarding/sessions/:sessionId/checkout
   - POST /onboarding/sessions/:sessionId/payment-intent/ack

DTOs:

1. CreateCheckoutRequestDto
2. CreateCheckoutResponseDto
3. PaymentIntentAckDto

Validacoes:

1. Idempotency-Key obrigatoria
2. snapshot valido e coerente
3. shipping selecionado e ativo
4. transicao valida de payment_state

## 13) Modulo Orders

Responsabilidade:

1. visao de pedidos para cliente e operacao
2. trilha de alteracao de status

Services:

1. ListCustomerOrdersService
2. GetCustomerOrderDetailService
3. TransitionOrderStatusService (admin)

Repositories:

1. OrdersRepository
2. OrderStatusHistoryRepository

Controllers:

1. OrdersCustomerController
   - GET /orders
   - GET /orders/:orderId
2. OrdersAdminController
   - PATCH /admin/orders/:orderId/status (futuro imediato)

DTOs:

1. ListOrdersQueryDto
2. OrderResponseDto
3. OrderStatusTransitionDto

Validacoes:

1. ownership no cliente
2. maquina de estados de pedido
3. auditoria de alteracao administrativa

## 14) Modulo Subscriptions

Responsabilidade:

1. ciclo de vida da assinatura
2. troca de plano e pausa/reativacao
3. leitura de politicas de proracao configuraveis

Services:

1. CreateSubscriptionFromCheckoutService
2. ListSubscriptionsService
3. GetSubscriptionDetailService
4. UpdateSubscriptionService
5. ExecuteSubscriptionActionService

Repositories:

1. SubscriptionsRepository
2. SubscriptionItemsRepository
3. SubscriptionEventsRepository
4. SubscriptionTermsRepository
5. BusinessRulesConfigRepository

Controllers:

1. SubscriptionsController
   - POST /billing/subscriptions
   - GET /billing/subscriptions
   - GET /billing/subscriptions/:subscriptionId
   - PATCH /billing/subscriptions/:subscriptionId
   - POST /billing/subscriptions/:subscriptionId/actions

DTOs:

1. CreateSubscriptionDto
2. UpdateSubscriptionDto
3. SubscriptionActionDto
4. SubscriptionResponseDto

Validacoes:

1. estado elegivel para acao
2. ownership para customer
3. politica de proracao aplicada por configuracao
4. termo/mercado validos

## 15) Modulo Billing

Responsabilidade:

1. sync de catalogo Stripe
2. webhook Stripe
3. reconciliacao de status
4. retries controlados

Services:

1. StartCatalogSyncService
2. SyncSingleProductService
3. GetCatalogSyncStatusService
4. GetCatalogSyncHealthService
5. ProcessStripeWebhookService
6. RetryFailedWebhookService (interno)
7. ResolveStripePriceMappingService

Repositories:

1. StripeProductPriceMapRepository
2. WebhookEventsRepository
3. IdempotencyKeysRepository
4. SubscriptionsRepository
5. OrdersRepository

Providers:

1. StripeClientProvider
2. StripeWebhookSignatureValidator

Controllers:

1. BillingController
   - POST /billing/catalog/sync
   - POST /billing/catalog/sync/:productId
   - GET /billing/catalog/sync/status
   - GET /billing/catalog/sync/health
   - GET /billing/products/:productId/variants/:variantId/stripe-price
   - POST /billing/webhooks/stripe

DTOs:

1. CatalogSyncRequestDto
2. CatalogSyncStatusDto
3. WebhookPayloadDto
4. StripePriceMappingDto

Validacoes:

1. assinatura de webhook valida
2. idempotencia por provider/event_id
3. mapeamento de moeda consistente
4. retries com limite configurado

## 16) Modulo Emails

Responsabilidade:

1. envio transacional
2. templates por evento
3. rastreamento de entrega e falha

Services:

1. SendTransactionalEmailService
2. QueueEmailService
3. MarkEmailDeliveryResultService

Repositories:

1. EmailMessagesRepository
2. BusinessRulesConfigRepository

Providers:

1. EmailProviderStrategy
2. SesProvider ou SendgridProvider

Controllers:

1. sem endpoint publico obrigatorio nesta fase
2. endpoints admin de monitoracao podem ser adicionados no modulo admin

DTOs:

1. SendEmailCommandDto
2. EmailMessageDto

Validacoes:

1. template existente
2. payload minimo do template
3. destinatario valido

## 17) Modulo Admin

Responsabilidade:

1. endpoints de leitura e operacao administrativa
2. dashboard e metricas basicas
3. configuracao de regras pendentes

Services:

1. ListOnboardingSessionsAdminService
2. GetOnboardingSession360Service
3. GetOnboardingMetricsService
4. ListBillingWebhooksService
5. ListBillingSubscriptionsAdminService
6. ListBusinessRulesConfigService
7. UpdateBusinessRulesConfigService

Repositories:

1. OnboardingSessionsRepository
2. WebhookEventsRepository
3. SubscriptionsRepository
4. BusinessRulesConfigRepository
5. AuditLogsRepository

Controllers:

1. AdminOnboardingController
   - GET /admin/onboarding/sessions
   - GET /admin/onboarding/sessions/:id
   - GET /admin/onboarding/metrics
2. AdminBillingController
   - GET /admin/billing/webhooks
   - GET /admin/billing/subscriptions
3. AdminConfigController
   - GET /admin/config/business-rules
   - PUT /admin/config/business-rules/:id

DTOs:

1. AdminListQueryDto
2. Onboarding360ResponseDto
3. AdminMetricsResponseDto
4. BusinessRuleConfigDto

Validacoes:

1. RBAC por papel (admin/operator/readonly)
2. readonly sem permissao de mutacao
3. mutacoes auditadas
4. vigencia de configuracao sem sobreposicao indevida

## 18) Modulo Audit

Responsabilidade:

1. trilha de mudancas sensiveis
2. rastreio de ator e contexto

Services:

1. RecordAuditEventService
2. QueryAuditLogsService

Repositories:

1. AuditLogsRepository

Controllers:

1. opcional de leitura admin futura

DTOs:

1. AuditRecordDto
2. AuditQueryDto

Validacoes:

1. resource e action obrigatorios
2. before/after em formato consistente
3. correlation_id quando presente

## 19) Dependencias entre modulos (resumo)

1. Auth -> RBAC
2. Users -> Auth
3. Pets -> Users, Breeds
4. Onboarding -> Pets, Users
5. Recommendation -> Onboarding, Pricing, Catalog
6. Shipping -> Onboarding
7. Checkout -> Onboarding, Recommendation, Shipping, Pricing, Idempotency
8. Subscriptions -> Checkout, Pricing, Billing Config
9. Billing -> Subscriptions, Orders
10. Orders -> Checkout
11. Admin -> praticamente todos modulos de leitura
12. Audit -> usado transversalmente por todos os modulos de mutacao

## 20) Validacoes transversais obrigatorias

1. Validacao de DTO antes da entrada no service.
2. Validacao de ownership em recursos do cliente.
3. Validacao de RBAC em rotas admin.
4. Idempotencia em checkout e assinatura.
5. Correlation id propagado em logs e erros.
6. Normalizacao de erro padrao da API.

## 21) Criterios de pronto da fase 4

1. todos os modulos com responsabilidades claras
2. services, repositories e controllers mapeados
3. DTOs e validacoes definidos por modulo
4. dependencias entre modulos documentadas
5. pronto para iniciar desenvolvimento na ordem acordada
