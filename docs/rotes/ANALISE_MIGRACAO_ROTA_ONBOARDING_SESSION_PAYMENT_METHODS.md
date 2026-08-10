# Analise Tecnica - Migracao da Rota Onboarding Payment Methods para Node.js

## Escopo

Rota atual no WordPress:

- GET /custom/v1/onboarding/session/:sessionId/payment-methods

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchSavedPaymentMethods)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-checkout-sync.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/Checkout.tsx
- eden-bowls/src/pages/checkout/CHECKOUT_RULES.md

## Responsabilidade da rota

A rota lista metodos de pagamento (cartoes) ja salvos no cliente Stripe vinculado ao usuario/sessao de onboarding.

Responsabilidade funcional:

1. Resolver o Stripe customer id associado ao contexto da sessao.
2. Consultar Stripe API para listar payment methods do tipo card.
3. Retornar formato simplificado para a UI de checkout reutilizar cartao salvo.

A rota nao cria nem atualiza metodos de pagamento. Ela apenas consulta.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/payment-methods
- Method: GET
- Callback: OnboardingApi::list_payment_methods
- Permission callback: OnboardingApi::require_linked_user_session_access

### Controller

- Extrai session_id
- Carrega sessao via OnboardingService
- Resolve customer id Stripe (order da sessao ou fallback por historico de pedidos do usuario)
- Inicializa cliente Stripe
- Busca customer e payment methods no Stripe
- Retorna envelope { success: true, data: [] }

### Regra de acesso importante

A permission callback exige:

1. rate limit de auth por sessao
2. usuario autenticado (is_user_logged_in)
3. sessao existente
4. ownership: linked_user_id da sessao deve ser igual ao current_user_id

Erros de acesso mais comuns:

- 401 unauthorized
- 403 session_forbidden
- 404 session_not_found
- 429 rate_limit

## Parametros recebidos

Path params:

- session_id: string

Headers esperados:

- x-session-token (prioritario no backend para validar token da sessao)
- Authorization: Bearer JWT (necessario para user auth no fluxo linked-user)

Payload:

- nenhum body

## Validacoes que devem existir

## 1) Validacao de sessao e ownership

- session_id obrigatorio
- sessao deve existir
- linked_user_id da sessao deve bater com usuario autenticado

## 2) Validacao para descoberta de customer Stripe

1. Tentativa primaria
- se session.checkout_order_id > 0, carregar order Woo e ler meta `_hsr_stripe_customer_id`

2. Fallback
- se customer id nao encontrado, buscar ate 10 pedidos mais recentes do usuario (`shop_order`) com meta `_hsr_stripe_customer_id` existente

3. Sem customer id
- retornar sucesso com lista vazia
- nao retorna erro

## 3) Validacao de ambiente Stripe

- secret key configurada em `STRIPE_SECRET_KEY` (env ou constante)
- Stripe SDK presente (`\\Stripe\\StripeClient`)

Erros:

- 503 stripe_secret_missing
- 503 stripe_sdk_missing
- 503 stripe_client_init_failed

## 4) Validacao de chamada externa Stripe

- retrieve customer pode falhar
- list payment methods pode falhar

Erros:

- 502 stripe_customer_retrieve_failed
- 502 stripe_payment_methods_list_failed

## Fluxo da requisicao

1. GET /payment-methods chega na rota
2. Permission callback valida sessao vinculada ao usuario autenticado
3. Controller carrega sessao
4. Tenta resolver stripe customer id por `session.checkout_order_id`
5. Se vazio, faz fallback em pedidos recentes do usuario com meta `_hsr_stripe_customer_id`
6. Se continuar vazio, retorna 200 com `data: []`
7. Se customer id existir:
   - cria StripeClient
   - Stripe customers.retrieve(customerId)
   - Stripe paymentMethods.list(customer=customerId, type=card)
8. Normaliza resposta para itens simples
9. Retorna 200 com lista

## Estrutura de resposta

Contrato retornado para o front (`SavedPaymentMethod[]`):

- id: string
- brand: string
- last4: string
- exp_month: number
- exp_year: number
- is_default: boolean

Envelope HTTP:

- success: true
- data: SavedPaymentMethod[]

Comportamento relevante:

- Se nao houver customer id, resposta e `200` com `data: []`.
- Frontend trata erro de rede/API com fallback local para lista vazia.

## Regras de negocio escondidas no WordPress

1. Descoberta indireta do customer
- A rota depende do meta `_hsr_stripe_customer_id` em pedidos, nao de coluna dedicada na sessao.

2. Fallback por historico de pedidos
- Limite de 10 pedidos mais recentes com meta existente.
- Escolhe o primeiro resultado (mais recente).

3. Estado default do cartao
- `is_default` e calculado comparando payment method id com `customer.invoice_settings.default_payment_method`.

4. Dependencia de composicao de plugins
- `headless-secure-registration` lista os metodos.
- `pawbowl-stripe-billing` e quem popula `_hsr_stripe_customer_id` nos pedidos em fluxos Stripe.

5. Falha silenciosa de vinculo
- Se customer nao for encontrado no contexto, nao sinaliza erro de negocio; apenas lista vazia.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas e leituras

1. wp_hsr_onboarding_sessions
- leitura da sessao (`session_id`, `linked_user_id`, `checkout_order_id`)

2. wp_posts / wp_postmeta (WooCommerce)
- leitura do order por `checkout_order_id`
- fallback por pedidos recentes do usuario:
  - type = shop_order
  - customer = linked_user_id
  - limit = 10
  - order by date desc
  - meta_query: EXISTS `_hsr_stripe_customer_id`

## Custom Post Types

- `shop_order` (WooCommerce)

## Taxonomias

- nenhuma taxonomia usada nesta rota

## Campos personalizados relevantes

- `_hsr_stripe_customer_id` (fonte principal para lookup de customer no Stripe)

## Plugins/dependencias

1. headless-secure-registration
- endpoint REST, permissao e orquestracao da listagem

2. WooCommerce
- `wc_get_order` e `wc_get_orders` para resolver pedidos/contexto do cliente

3. Stripe PHP SDK
- `\\Stripe\\StripeClient`
- customers.retrieve
- paymentMethods.all(type=card)

4. pawbowl-stripe-billing
- popula/atualiza metadados Stripe em pedidos, incluindo customer id

## Regras de preco, moeda e pais

Nao ha calculo de preco/frete/imposto nesta rota.

- moeda: nao aplicavel
- pais: nao aplicavel diretamente
- preco: nao aplicavel

Observacao:

- A rota e estritamente de meios de pagamento salvos no cliente Stripe.

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- GET /custom/v1/onboarding/session/:sessionId/payment-methods

Controller:
- OnboardingApi::list_payment_methods

Banco/tabelas utilizadas:
- wp_hsr_onboarding_sessions
- wp_posts/wp_postmeta (shop_order)

Regras de negocio:
- ownership forte de sessao vinculada
- descoberta de customer id por order/meta
- fallback para historico de pedidos
- retorno vazio quando nao ha customer
- consulta Stripe customer + payment methods card

Campos retornados:
- id
- brand
- last4
- exp_month
- exp_year
- is_default

## Node.js

Controller:
- OnboardingPaymentMethodsController.list

Service:
- PaymentMethodsService.listSavedMethodsForSession
- fluxo: validar acesso -> resolver customer -> listar no Stripe -> normalizar resposta

Repository:
- OnboardingSessionRepository.findBySessionId
- CheckoutOrderRepository.findById
- CheckoutOrderRepository.findRecentWithStripeCustomerByUser

Entities/Models (TypeORM):
- OnboardingSessionEntity (sessionId, linkedUserId, checkoutOrderId)
- OrderEntity (id, customerUserId)
- OrderMetaEntity (orderId, metaKey, metaValue) ou modelo equivalente para meta

DTOs:

Entrada:
- PaymentMethodsParamsDto
  - sessionId: string

Saida:
- SavedPaymentMethodDto
  - id: string
  - brand: string
  - last4: string
  - expMonth: number
  - expYear: number
  - isDefault: boolean
- PaymentMethodsResponseDto
  - success: boolean
  - data: SavedPaymentMethodDto[]

Validacoes:
- autenticacao JWT
- token de sessao
- ownership linked user
- sessao existente
- customer id opcional (sem erro: retorna lista vazia)
- robustez em erros Stripe com mapeamento 502/503

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe sessionId
2. Guard de auth valida JWT + session token
3. Service carrega sessao e valida ownership
4. Service resolve customerId
   - por checkoutOrderId
   - fallback por pedidos recentes com meta stripe customer
5. Se customerId vazio -> retorna []
6. StripeGateway consulta customer e paymentMethods(card)
7. Service mapeia para DTO de saida
8. Controller retorna envelope 200

## Dependencias existentes

Dependencias atuais no WP que precisam equivalencia:

1. Sessao onboarding SQL
2. Order/meta WooCommerce
3. Stripe SDK
4. Integracao previa que grava `_hsr_stripe_customer_id`

Na migracao para Node, manter regra de descoberta do customer por order/meta evita regressao funcional.

## Modelo de dados necessario no Node

Minimo para paridade:

1. tabela de sessoes onboarding
- session_id
- linked_user_id
- checkout_order_id

2. tabela/estrutura de pedidos
- id
- user_id
- created_at

3. tabela/estrutura de metadados de pedido
- order_id
- key
- value

Indices recomendados:

- onboarding_sessions(session_id)
- orders(user_id, created_at desc)
- order_meta(order_id, key)
- order_meta(key, value) para lookup de customer id

## Possiveis problemas na migracao

1. Ausencia de `_hsr_stripe_customer_id`
- sem estrategia de fallback equivalente, rota retorna vazio sempre.

2. Divergencia de ownership
- afrouxar validacao pode expor cartoes de outro usuario.

3. Diferenca de status em erro Stripe
- se nao mapear 502/503, frontend pode ter regressao no tratamento.

4. Latencia externa Stripe
- sem timeout/retry controlado, pode degradar checkout step.

5. N+1 em lookup de metas
- fallback por pedidos recentes precisa query eficiente.

6. Divergencia de nome de campos
- frontend espera snake_case no payload dos cartoes (`exp_month`, `exp_year`, `is_default`).

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- apenas parsing de params e retorno HTTP
- nenhuma regra de negocio

2. Service central
- ownership, resolucao de customer, chamada Stripe e mapeamento DTO

3. Repository dedicado
- metodos claros para sessao, order e order meta
- fallback em pedidos recentes com join/index

4. Stripe gateway isolado
- encapsular SDK e mapeamento de erros para manter testabilidade

5. Politica de resiliencia
- timeout curto na chamada Stripe
- fallback para erro controlado (502)

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. ownership invalido -> 403
3. customer id ausente no order e fallback -> retorna []
4. customer id via checkout_order_id -> lista cartoes
5. customer id via fallback orders -> lista cartoes
6. erro em init Stripe -> 503
7. erro em retrieve customer -> 502
8. erro em list payment methods -> 502
9. mapping correto de default payment method
10. preservacao do contrato snake_case esperado pelo frontend

## Checklist de equivalencia

1. Endpoint GET equivalente preservado.
2. Autenticacao e ownership equivalentes preservados.
3. Lookup de customer por order/meta preservado.
4. Fallback por pedidos recentes preservado.
5. Regra de retorno vazio sem customer preservada.
6. Integracao Stripe customer + payment methods card preservada.
7. Contrato SavedPaymentMethod preservado.
8. Erros 502/503 equivalentes preservados.
9. Controller sem regra de negocio.
10. TypeORM em Repository/Entity.
11. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
