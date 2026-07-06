# Eden Bowls - Fase 5 - Projeto Completo do Frontend (Sem Codigo)

Escopo desta fase:

1. projetar frontend cliente (web)
2. projetar painel administrativo
3. definir paginas e rotas
4. definir componentes por tela
5. definir estados e gerenciamento de dados
6. mapear chamadas para API

Fora de escopo:

1. implementacao de componentes
2. criacao de codigo React
3. testes de interface implementados

## 1) Stack de frontend

1. React + Vite
2. TypeScript
3. React Router
4. TanStack Query
5. Axios
6. Tailwind CSS
7. shadcn/ui (base funcional)
8. Magic UI (componentes visuais premium)
9. Aceternity UI (blocos visuais e layouts)
10. react-hook-form + zod

## 2) Estrutura de pastas (frontend)

## 2.1 Web (apps/web)

1. src/app/
2. src/routes/
3. src/pages/
4. src/features/
5. src/components/
6. src/layouts/
7. src/services/
8. src/stores/
9. src/hooks/
10. src/lib/
11. src/i18n/
12. src/styles/

## 2.2 Admin (apps/admin)

1. src/app/
2. src/routes/
3. src/pages/
4. src/features/
5. src/components/
6. src/layouts/
7. src/services/
8. src/stores/
9. src/hooks/
10. src/lib/
11. src/styles/

## 2.3 Pacote compartilhado de UI (packages/ui)

1. components/base (shadcn/ui wrappers)
2. components/premium (Magic UI/Aceternity UI wrappers)
3. components/domain
4. themes/tokens
5. icons

## 3) Arquitetura de estado e dados

## 3.1 Estado remoto

1. TanStack Query para cache e sincronizacao de dados da API
2. query keys por dominio:
   - auth
   - profile
   - pets
   - onboarding
   - catalog
   - checkout
   - subscriptions
   - admin

## 3.2 Estado local

1. estado efemero em componentes
2. store global minima para:
   - sessao onboarding
   - auth token state
   - preferencias de idioma/moeda

## 3.3 Formularios

1. react-hook-form
2. validacao com zod
3. mensagens de erro padrao

## 3.4 Client HTTP

1. instancia Axios publica
2. instancia Axios autenticada
3. interceptors para:
   - refresh token
   - correlation id
   - tratamento de erro padrao

## 4) Frontend cliente (Web)

## 4.1 Mapa de rotas (Web)

1. / (landing)
2. /plans
3. /plans/:planId
4. /onboarding/start
5. /onboarding/:sessionId
6. /onboarding/:sessionId/recommendation
7. /onboarding/:sessionId/shipping
8. /onboarding/:sessionId/checkout
9. /auth/login
10. /auth/register
11. /account
12. /account/pets
13. /account/subscriptions
14. /account/orders
15. /account/profile

## 4.2 Paginas e componentes (Web)

## Landing (/)

Objetivo:

1. apresentar proposta premium da marca
2. converter para onboarding

Componentes:

1. HeroSection (Aceternity/Magic UI)
2. BenefitsSection
3. HowItWorksSection
4. PricingTeaser
5. FAQ
6. Footer

Estados:

1. idle
2. loading catalog teaser
3. error fallback

APIs:

1. GET /catalog/plans (teaser)

## Lista de planos (/plans)

Objetivo:

1. listar planos e variacoes por mercado

Componentes:

1. PlanFilters
2. PlanCardsGrid
3. MarketCurrencySelector
4. EmptyState

Estados:

1. loading
2. loaded
3. empty
4. error

APIs:

1. GET /catalog/plans
2. GET /catalog/categories

## Detalhe do plano (/plans/:planId)

Objetivo:

1. mostrar detalhes e CTA de iniciar onboarding

Componentes:

1. PlanHeader
2. PlanComposition
3. TermSelector
4. CTAStartOnboarding

Estados:

1. loading
2. loaded
3. not_found

APIs:

1. GET /catalog/plans/:planId
2. GET /catalog/products/:productId/variants

## Login (/auth/login)

Objetivo:

1. autenticar cliente

Componentes:

1. LoginForm
2. AuthLayout
3. InlineError

Estados:

1. idle
2. submitting
3. success
4. invalid_credentials

APIs:

1. POST /auth/login
2. POST /auth/refresh (interceptor)

## Registro (/auth/register)

Objetivo:

1. criar conta e validar OTP

Componentes:

1. RegisterForm
2. OtpVerificationForm
3. ResendOtpAction

Estados:

1. idle
2. submitting
3. awaiting_otp
4. verified

APIs:

1. POST /auth/register
2. POST /auth/otp/verify
3. POST /auth/otp/resend

## Onboarding start (/onboarding/start)

Objetivo:

1. abrir sessao onboarding

Componentes:

1. StartOnboardingCard
2. CountryLocaleSelector

Estados:

1. creating_session
2. created
3. error

APIs:

1. POST /onboarding/sessions

## Onboarding wizard (/onboarding/:sessionId)

Objetivo:

1. coletar dados de pets e questionario

Componentes:

1. OnboardingStepper
2. PetForm
3. PetsList
4. QuestionnaireForm
5. SessionProgress

Estados:

1. loading_session
2. editing
3. autosaving
4. save_error

APIs:

1. GET /onboarding/sessions/:sessionId
2. POST /onboarding/sessions/:sessionId/pets
3. PATCH /onboarding/sessions/:sessionId/pets/:petId
4. DELETE /onboarding/sessions/:sessionId/pets/:petId
5. POST /onboarding/sessions/:sessionId/questionnaire
6. POST /onboarding/sessions/:sessionId/recurrence

## Recomendacao (/onboarding/:sessionId/recommendation)

Objetivo:

1. apresentar recomendacao por pet e total
2. salvar selecao de plano

Componentes:

1. RecommendationSummary
2. PetConsumptionCards
3. PlanSelectionBuilder
4. SnapshotStatusBadge

Estados:

1. loading_recommendation
2. ready
3. mismatch
4. saving_selection

APIs:

1. GET /onboarding/sessions/:sessionId/recommendation
2. GET /onboarding/sessions/:sessionId/plan/snapshot
3. POST /onboarding/sessions/:sessionId/plan-selection
4. POST /onboarding/sessions/:sessionId/plan/preview

## Shipping (/onboarding/:sessionId/shipping)

Objetivo:

1. capturar endereco e selecionar frete

Componentes:

1. ShippingAddressForm
2. ZipLookup
3. ShippingRatesList
4. QuoteExpirationTimer

Estados:

1. quoting
2. quoted
3. quote_expired
4. selecting_rate

APIs:

1. POST /onboarding/sessions/:sessionId/zipcode
2. POST /onboarding/sessions/:sessionId/zipcode/lookup
3. POST /onboarding/sessions/:sessionId/address/autocomplete
4. POST /onboarding/sessions/:sessionId/shipping/quote
5. POST /onboarding/sessions/:sessionId/shipping/select

## Checkout (/onboarding/:sessionId/checkout)

Objetivo:

1. fechar pedido e iniciar assinatura

Componentes:

1. CheckoutSummary
2. PaymentMethodSection
3. ConfirmCheckoutButton
4. PaymentStatusTimeline

Estados:

1. creating_checkout
2. awaiting_payment
3. payment_processing
4. payment_success
5. payment_failed

APIs:

1. POST /onboarding/sessions/:sessionId/checkout
2. POST /onboarding/sessions/:sessionId/payment-intent/ack
3. POST /billing/subscriptions

## Minha conta (/account)

Objetivo:

1. hub de navegacao da area logada

Componentes:

1. AccountSidebar (Aceternity style)
2. AccountOverviewCards
3. QuickActions

Estados:

1. loading
2. loaded

APIs:

1. GET /auth/me
2. GET /profile

## Pets da conta (/account/pets)

Objetivo:

1. CRUD de pets

Componentes:

1. PetsTable
2. PetModalForm
3. DeletePetDialog

Estados:

1. list_loading
2. modal_editing
3. save_success

APIs:

1. GET /pets
2. POST /pets
3. PATCH /pets/:id
4. DELETE /pets/:id

## Assinaturas (/account/subscriptions)

Objetivo:

1. visualizar e operar assinatura

Componentes:

1. SubscriptionCards
2. SubscriptionDetailDrawer
3. SubscriptionActionPanel

Estados:

1. loading
2. ready
3. action_pending
4. action_error

APIs:

1. GET /billing/subscriptions
2. GET /billing/subscriptions/:subscriptionId
3. PATCH /billing/subscriptions/:subscriptionId
4. POST /billing/subscriptions/:subscriptionId/actions

## Pedidos (/account/orders)

Objetivo:

1. acompanhar historico e status

Componentes:

1. OrdersTable
2. OrderDetailDrawer
3. StatusTimeline

Estados:

1. loading
2. empty
3. ready

APIs:

1. GET /orders
2. GET /orders/:orderId

## Perfil (/account/profile)

Objetivo:

1. manter dados de conta e endereco

Componentes:

1. PersonalDataForm
2. DeliveryPreferencesForm
3. AddressesManager
4. PasswordForm

Estados:

1. loading
2. saving
3. success
4. validation_error

APIs:

1. GET /profile
2. PATCH /profile/personal
3. PATCH /profile/delivery
4. PATCH /profile/email
5. PATCH /profile/password
6. POST /profile/addresses
7. PATCH /profile/addresses/:id
8. DELETE /profile/addresses/:id

## 5) Painel Administrativo (Admin)

## 5.1 Mapa de rotas (Admin)

1. /admin/login
2. /admin/dashboard
3. /admin/onboarding/sessions
4. /admin/onboarding/sessions/:id
5. /admin/catalog/products
6. /admin/catalog/pricing
7. /admin/subscriptions
8. /admin/orders
9. /admin/billing/webhooks
10. /admin/config/business-rules

## 5.2 Paginas e componentes (Admin)

## Admin Login (/admin/login)

Objetivo:

1. autenticar usuario admin/operator/readonly

Componentes:

1. AdminLoginForm
2. SecurityNotice

Estados:

1. idle
2. submitting
3. forbidden

APIs:

1. POST /auth/login
2. GET /auth/me

## Dashboard (/admin/dashboard)

Objetivo:

1. monitorar operacao e funil basico

Componentes:

1. KpiCards
2. ConversionChart
3. WebhookHealthWidget
4. AlertsPanel

Estados:

1. loading
2. ready
3. partial_error

APIs:

1. GET /admin/onboarding/metrics
2. GET /admin/billing/webhooks
3. GET /admin/billing/subscriptions

## Onboarding sessions (/admin/onboarding/sessions)

Objetivo:

1. listar sessoes e identificar gargalos

Componentes:

1. SessionsDataGrid (shadcn data table)
2. FiltersBar
3. SessionStatusBadge

Estados:

1. loading
2. ready
3. empty

APIs:

1. GET /admin/onboarding/sessions

## Onboarding 360 (/admin/onboarding/sessions/:id)

Objetivo:

1. visao completa de uma sessao

Componentes:

1. SessionSummary
2. PetsPanel
3. QuestionnairePanel
4. RecommendationPanel
5. CheckoutPanel

Estados:

1. loading
2. ready
3. not_found

APIs:

1. GET /admin/onboarding/sessions/:id

## Catalog products (/admin/catalog/products)

Objetivo:

1. CRUD de produtos e variacoes

Componentes:

1. ProductsDataGrid
2. ProductFormDrawer
3. VariantsEditor

Estados:

1. loading
2. editing
3. saving

APIs:

1. GET /admin/catalog/products
2. POST /admin/catalog/products
3. PATCH /admin/catalog/products/:id

## Catalog pricing (/admin/catalog/pricing)

Objetivo:

1. manter matriz de precos por moeda/mercado

Componentes:

1. PricingMatrix
2. PriceEditorDialog
3. MarketCurrencyFilter

Estados:

1. loading
2. editing
3. save_error

APIs:

1. GET /admin/catalog/pricing
2. POST /admin/catalog/pricing

## Subscriptions (/admin/subscriptions)

Objetivo:

1. monitorar e operar assinaturas

Componentes:

1. SubscriptionsGrid
2. SubscriptionDetailDrawer
3. ActionModal

Estados:

1. loading
2. action_pending
3. action_done

APIs:

1. GET /admin/billing/subscriptions
2. PATCH /billing/subscriptions/:subscriptionId
3. POST /billing/subscriptions/:subscriptionId/actions

## Orders (/admin/orders)

Objetivo:

1. operar pedidos por status

Componentes:

1. OrdersGrid
2. OrderTimeline
3. StatusTransitionAction

Estados:

1. loading
2. transition_pending
3. transition_failed

APIs:

1. GET /admin/orders (planejado na fase de implementacao)
2. PATCH /admin/orders/:orderId/status (planejado na fase de implementacao)

## Billing webhooks (/admin/billing/webhooks)

Objetivo:

1. acompanhar falhas e processamentos

Componentes:

1. WebhooksGrid
2. EventDetailDrawer
3. FailureSummaryCard

Estados:

1. loading
2. ready
3. empty

APIs:

1. GET /admin/billing/webhooks

## Business rules config (/admin/config/business-rules)

Objetivo:

1. configurar regras pendentes sem deploy

Componentes:

1. RulesTable
2. RuleEditor
3. EffectiveDatePicker
4. ChangeAuditPreview

Estados:

1. loading
2. editing
3. saving
4. conflict

APIs:

1. GET /admin/config/business-rules
2. PUT /admin/config/business-rules/:id

## 6) Layouts e componentes de design system

## 6.1 Layouts

1. WebPublicLayout
2. WebAuthLayout
3. WebAccountLayout
4. AdminLayout com sidebar

## 6.2 Componentes base

1. DataTable
2. FormField
3. Modal
4. Drawer
5. Tabs
6. Badge
7. Toast
8. Skeleton

## 6.3 Componentes visuais premium

1. MagicCard para cards de destaque
2. AnimatedBackground para landing
3. Sidebar com base no padrao Aceternity
4. Spotlight sections para storytelling da marca

## 7) Gestao de estados e autorizacao

1. Guard de rota publica, autenticada e admin.
2. Guard por papel no admin:
   - admin: leitura e mutacao
   - operator: leitura e mutacoes operacionais permitidas
   - readonly: somente leitura
3. Controle de sessao onboarding por token temporario.
4. Estrategia de refresh token transparente em chamadas autenticadas.

## 8) Mapeamento de erros na UI

1. 401 -> redirecionar para login
2. 403 -> tela sem permissao
3. 404 -> tela de recurso nao encontrado
4. 409 -> mensagem de conflito de negocio (snapshot, transicao, idempotencia)
5. 422 -> erro de validacao de formulario
6. 429 -> estado de rate limit com retry guidance
7. 5xx -> fallback de indisponibilidade

## 9) Internacionalizacao e mercado

1. i18n PT/EN para textos.
2. formatacao monetaria por BRL/USD.
3. componentes de data/hora por locale.
4. filtros e labels orientados ao mercado selecionado.

## 10) Analytics de frontend (fase de implementacao)

Eventos recomendados:

1. onboarding_started
2. onboarding_step_completed
3. recommendation_viewed
4. shipping_quote_selected
5. checkout_started
6. checkout_payment_success
7. checkout_payment_failed
8. subscription_action_requested

## 11) Criterios de pronto da fase 5

1. todas as paginas e rotas mapeadas (web + admin)
2. componentes por tela definidos
3. estados de loading/erro/sucesso documentados
4. chamadas de API por fluxo documentadas
5. guardas de autenticacao e papel definidos
6. pronto para iniciar implementacao por modulo
