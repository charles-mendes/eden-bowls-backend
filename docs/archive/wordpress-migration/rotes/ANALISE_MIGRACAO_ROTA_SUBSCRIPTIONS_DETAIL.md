# Analise Tecnica - Migracao da Rota Subscription Detail para Node.js

## Escopo

Rota atual no WordPress:

- GET /custom/v1/subscriptions/:subscriptionId/detail

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchUserSubscriptionDetail)
- eden-bowls/src/pages/dashboard/pages/PlanDetail.tsx
- eden-bowls/src/pages/dashboard/pages/EditSubscription.tsx
- eden-bowns/src/pages/plan/Plan.tsx

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-api.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-ledger-schema.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-checkout-sync.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-edit-service.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/dashboard/pages/PlanDetail.tsx
- eden-bowls/src/pages/dashboard/pages/EditSubscription.tsx
- artefatos/documentacao-plugins-backend/04-pawbowl-stripe-billing.md
- artefatos/AUDITORIA_STRIPE_ARQUITETURA_2026-07-07.md

## Responsabilidade da rota

A rota retorna o detalhe completo de uma assinatura do usuario autenticado.

Ela e a fonte de dados principal para:

- tela de detalhe do plano;
- tela de edicao de assinatura;
- exibição de pets vinculados, periodicidade, historico de cobrancas, metodo de pagamento e linha do tempo Stripe.

A rota trabalha em cima de uma assinatura identificada por `sub_...` e tenta resolver o detalhe por duas vias:

1. assinatura WooCommerce/Flexible Subscriptions vinculada ao usuario;
2. ledger legada `wp_hsr_stripe_subscriptions` quando nao existe order Woo equivalente.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /subscriptions/(?P<subscription_id>[^/]+)/detail
- Method: GET
- Callback: StripeSubscriptionApi::get_user_subscription_detail
- Permission callback: StripeSubscriptionApi::require_authenticated_user

### Controller

- Verifica usuario logado
- Sanitiza `subscription_id`
- Aplica rate limit por usuario
- Tenta carregar assinatura WooCommerce do usuario
- Se nao existir, tenta carregar o ledger Stripe
- Formata a resposta de detalhe completa

### Regra de acesso importante

A rota depende de usuario autenticado no WordPress.

Erros comuns:

- 401 unauthorized
- 422 invalid_subscription_id
- 429 rate_limit
- 404 subscription_not_found

## Parametros recebidos

Path params:

- subscription_id: string

Formato valido esperado:

- Stripe subscription id, normalmente `sub_...`

Body:

- nenhum

Query:

- nenhuma query obrigatoria

## Validacoes que devem existir

## 1) Validacao de autenticacao

- usuario precisa estar logado (`get_current_user_id() > 0`)

Erro:

- `unauthorized` -> 401

## 2) Validacao de subscription_id

- `subscription_id` nao pode ser vazio
- precisa ser um Stripe subscription id valido
- o backend sanitiza e rejeita ids invalidos

Erro:

- `invalid_subscription_id` -> 422

## 3) Rate limit

- limite por usuario: 60 requisicoes em 300 segundos

Erro:

- `rate_limit` -> 429

## 4) Validacao de ownership

- a assinatura precisa pertencer ao usuario autenticado
- primeiro pelo relacionamento WooCommerce/Flexible Subscriptions
- depois pelo ledger com `wp_user_id` ou fallback por email

Se nao pertencer ao usuario ou nao existir:

- `subscription_not_found` -> 404

## Fluxo da requisicao

1. GET /subscriptions/:subscriptionId/detail chega na rota
2. controller valida usuario autenticado
3. sanitiza `subscription_id`
4. aplica rate limit por usuario
5. tenta localizar assinatura local via WooCommerce (`fsb_subscription`)
6. se encontrar, formata o detalhe completo da ordem/assinatura
7. se nao encontrar, tenta localizar no ledger `wp_hsr_stripe_subscriptions`
8. se encontrar no ledger, formata o detalhe legada
9. se nao encontrar em nenhuma fonte, retorna 404

## Estrutura de resposta

Envelope HTTP:

- success: true
- data:
  - subscription: DashboardSubscriptionDetail

Campos retornados pela assinatura local WooCommerce/Flexible Subscriptions:

- subscription_id
- stripe_subscription_id
- legacy_subscription_id
- slug
- plan_label
- status
- stripe_subscription_status
- contract_label
- start_date
- end_date
- end_date_source
- current_period_start
- current_period_end
- next_billing_date
- next_billing_source
- next_shipment_date
- next_shipment_source
- next_shipment_context
- pets_names
- pet_ids
- packs_per_month
- order_total_per_month
- pets
- packs_per_delivery
- frequency
- active_flavors
- price_per_cycle
- cycle_unit
- payment_method_brand
- payment_method_last4
- delivery_address
- auto_renew
- current_cycle
- total_cycles
- billing_history
- plan_items
- plan_items_source
- stripe_timeline
- edit_payment_pending
- subscription_term_months

Campos retornados pela assinatura via ledger quando nao ha order local:

- subscription_id
- stripe_subscription_id
- legacy_subscription_id
- slug
- plan_label
- status
- stripe_subscription_status
- contract_label
- start_date
- end_date
- end_date_source
- current_period_start
- current_period_end
- next_billing_date
- next_billing_source
- next_shipment_date
- next_shipment_source
- next_shipment_context
- pets_names
- pet_ids
- packs_per_month
- order_total_per_month

## Regras de negocio escondidas no WordPress

1. Duplicidade de fonte
- o detalhe prefere a assinatura WooCommerce, mas aceita fallback do ledger Stripe quando a assinatura local nao existe.

2. Shape mais rico que a listagem
- a rota expande dados de pets, billing history, itens do plano, timeline Stripe e endereco de entrega.

3. `subscription_id` e `stripe_subscription_id` sao o mesmo identificador logico
- o front usa ambos como equivalente na maior parte dos fluxos.

4. `subscription_term_months` pode vir de meta ou do planSelection
- isso preserva compatibilidade com contratos antigos e novos.

5. `edit_payment_pending` controla UX
- o front usa esse campo para saber se existe pendencia de edicao de pagamento.

6. `next_shipment_context` e estruturado
- a UI usa esse contexto para exibir previsao de proxima entrega.

7. `billing_history` e projetado
- o backend monta o historico de cobranca a partir de pedidos/invoices e ledger Stripe.

8. `plan_items_source` e informativo
- ajuda a rastrear se a origem veio do planSelection local ou do snapshot do ledger.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_posts / wp_postmeta
- ordem/assinatura WooCommerce do tipo `fsb_subscription`
- metadados da assinatura e do pedido

2. wp_hsr_stripe_subscriptions
- ledger legada para fallback e detalhes de assinaturas antigas

3. wp_hsr_stripe_invoices
- historico e metadados de invoice utilizados em billing history/timeline

4. wp_hsr_stripe_payment_intents
- observacao de status de pagamento, quando aplicavel na timeline/historico

5. wp_hsr_stripe_orders
- enriquecimento auxiliar para timeline/historico

6. wp_hsr_stripe_customers
- ajuda na resolucao de informacoes de pagamento/ownership em alguns resumos

## Queries observadas

### Caminho WooCommerce

- `wc_get_orders([ 'type' => 'fsb_subscription', 'customer_id' => currentUserId, 'status' => 'any', 'orderby' => 'date', 'order' => 'DESC', 'limit' => -1 ])`
- varredura para encontrar o `stripe_subscription_id` correspondente

### Caminho ledger

- `SELECT * FROM wp_hsr_stripe_subscriptions WHERE stripe_subscription_id = %s AND wp_user_id = %d LIMIT 1`
- fallback por email do usuario quando `wp_user_id` nao existe

### Dados auxiliares

- leitura de metadados do pedido e da assinatura para extrair:
  - pets
  - recurrence
  - plan_selection
  - payment method
  - delivery address
  - billing history

## Custom Post Types e tipos de post/pedido

- `fsb_subscription` (assinatura WooCommerce/Flexible Subscriptions)
- `shop_order` em alguns caminhos auxiliares do ecossistema, mas nao como fonte principal do detalhe

## Taxonomias

- nenhuma taxonomia usada nesta rota

## Campos personalizados relevantes

No WooCommerce/order:

- `_hsr_stripe_subscription_id`
- `_hsr_stripe_subscription_status`
- `_hsr_stripe_current_period_start`
- `_hsr_stripe_current_period_end`
- `_hsr_subscription_term_months`
- `_hsr_payment_method_id`
- `_hsr_edit_payment_pending`
- `_hsr_stripe_plan_price_id`
- `_hsr_onboarding_pets`
- metadados de recurrence/plan_selection/end_date/next_shipment usados pelos projetores

No ledger Stripe:

- `stripe_subscription_id`
- `stripe_customer_id`
- `wp_user_id`
- `customer_email`
- `stripe_price_id`
- `plan_label`
- `status`
- `current_period_end`
- `payment_method_last4`
- `plan_amount`
- `plan_currency`
- `cancel_at_period_end`
- `canceled_at`

## Plugins e dependencias

1. pawbowl-stripe-billing
- endpoint REST e formatacao de assinatura/detalhe

2. headless-secure-registration
- integrações de onboarding e checkout que alimentam os dados da assinatura

3. WooCommerce
- assinatura local `fsb_subscription`

4. Flexible Subscriptions
- base do contrato local exibido no dashboard

## Regras de preco, moeda e pais

A rota nao recalcula precos, mas expõe valores derivados:

- `order_total_per_month`
- `packs_per_month`
- `packs_per_delivery`
- `price_per_cycle`

A moeda e herdada do contexto persistido no pedido/ledger.

O pais nao e usado como regra de filtragem nesta rota, mas influencia os dados que alimentam a assinatura em fluxos de checkout.

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- GET /custom/v1/subscriptions/:subscriptionId/detail

Controller:
- StripeSubscriptionApi::get_user_subscription_detail

Service:
- StripeSubscriptionApi::format_subscription_detail_item
- StripeSubscriptionApi::format_ledger_subscription_detail_item
- StripeSubscriptionApi::load_user_subscription
- StripeSubscriptionApi::load_user_subscription_ledger

Repository/queries:
- wc_get_orders para `fsb_subscription`
- SQL em `wp_hsr_stripe_subscriptions`
- leituras auxiliares de invoices, payment intents e orders

Banco/tabelas utilizadas:
- wp_posts/wp_postmeta
- wp_hsr_stripe_subscriptions
- wp_hsr_stripe_invoices
- wp_hsr_stripe_payment_intents
- wp_hsr_stripe_orders
- wp_hsr_stripe_customers

Regras de negocio:
- prioridade para assinatura local
- fallback para ledger Stripe
- detalhe rico para dashboard e edicao
- campos de UX como edit_payment_pending e next_shipment_context
- datas formatadas para exibicao

Campos retornados:
- `subscription` com campos de dashboard detalhado, pets, billing history, plan items, timeline e payment method

## Node.js

Controller:
- SubscriptionsController.getDetail

Service:
- SubscriptionsService.getDetailForUser
- SubscriptionsService.resolveLocalOrLedgerSubscription
- SubscriptionsService.buildDetailProjection

Repository:
- SubscriptionRepository.findLocalSubscriptionByStripeIdAndUser
- SubscriptionLedgerRepository.findByStripeIdAndUser
- BillingRepository.findBillingHistoryBySubscription
- PaymentRepository.findLatestPaymentMethodBySubscription
- OrderRepository.findDeliveryAddressBySubscription

Entities/Models (TypeORM):
- SubscriptionEntity / OrderEntity
- SubscriptionLedgerEntity
- InvoiceEntity
- PaymentIntentEntity
- CustomerEntity
- OrderMetaEntity

DTOs:

Entrada:
- GetSubscriptionDetailParamsDto
  - subscriptionId: string

Saida:
- GetSubscriptionDetailResponseDto
  - subscription: DashboardSubscriptionDetailDto

DashboardSubscriptionDetailDto sugerido:
- subscriptionId: string
- stripeSubscriptionId: string
- legacySubscriptionId: number
- slug: string
- planLabel: string
- status: string
- stripeSubscriptionStatus: string
- contractLabel: string
- startDate: string | null
- endDate: string | null
- currentPeriodStart?: string | null
- currentPeriodEnd?: string | null
- nextBillingDate: string | null
- nextShipmentDate: string | null
- nextShipmentContext?: Record<string, unknown>
- petsNames?: string[]
- petIds?: string[]
- pets?: Array<{ name?: string; pet_id?: string; id?: string }>
- packsPerMonth?: number | null
- packsPerDelivery?: number | null
- frequency?: string | null
- activeFlavors?: string[]
- pricePerCycle?: number | null
- cycleUnit?: string | null
- paymentMethodBrand?: string | null
- paymentMethodLast4?: string | null
- deliveryAddress?: string | null
- autoRenew?: boolean
- currentCycle?: number | null
- totalCycles?: number | null
- billingHistory?: unknown[]
- planItems?: unknown[]
- planItemsSource?: string | null
- stripeTimeline?: unknown[]
- editPaymentPending?: boolean
- subscriptionTermMonths?: number | null

Validacoes:
- usuario autenticado
- subscriptionId valido (`sub_...`)
- ownership da assinatura
- rate limit por usuario
- fallback para ledger legada quando assinatura local nao existir

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe subscriptionId
2. Guard valida usuario autenticado
3. Service aplica rate limit e valida formato `sub_...`
4. Repository tenta localizar assinatura local do usuario
5. Se nao encontrar, busca no ledger Stripe do mesmo usuario
6. Service monta a projeção completa do detalhe
7. Controller retorna `subscription` no envelope padrao

## Modelo de dados necessario no Node

Minimo para paridade:

1. subscriptions / orders
- id
- user_id
- stripe_subscription_id
- status
- plan_label
- contract_label
- current_period_start
- current_period_end
- next_billing_date
- next_shipment_date
- edit_payment_pending
- subscription_term_months

2. subscription_ledger
- stripe_subscription_id
- wp_user_id
- customer_email
- stripe_price_id
- status
- current_period_end
- payment_method_last4
- plan_amount
- plan_currency

3. invoices / payment_intents / orders
- necessario para billing history e timeline

4. order_meta / subscription_meta
- necessario para pets, recurrence, plan_items, delivery_address e payment method

## Possiveis problemas na migracao

1. Perder o fallback do ledger
- assinaturas antigas deixariam de abrir no dashboard.

2. Simplificar demais o detalhe
- a tela de edicao depende de `billing_history`, `plan_items`, `pets`, `payment_method_*` e `edit_payment_pending`.

3. Nao manter `subscription_id` como chave principal do front
- o front resolve rota e detalhe usando `sub_...`.

4. Nao formatar datas para exibição
- a UI espera strings legiveis, nao timestamps crus.

5. Ignorar `next_shipment_context`
- pode quebrar a previsao de entrega ou a tela de detalhe.

6. Nao preservar `subscription_term_months`
- algumas regras de edicao e billing dependem desse valor.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- autentica usuario e encaminha `subscriptionId`

2. Service central
- resolve a fonte correta, monta a projeção e unifica formato local/ledger

3. Repositories separados
- subscriptions locais
- ledger Stripe
- billing history
- payment method
- address/order meta

4. Projeção de dashboard
- manter nomes de campos e semântica compatíveis com o front

### Testes unitarios recomendados

1. usuario nao autenticado -> 401
2. subscriptionId invalido -> 422
3. subscription local encontrada -> retorna detalhe rico
4. fallback ledger encontrada -> retorna detalhe rico
5. assinatura inexistente -> 404
6. rate limit aplicado por usuario
7. campos `pets`, `billing_history`, `plan_items` e `stripe_timeline` preenchidos conforme fonte
8. `edit_payment_pending` e `subscription_term_months` preservados

## Checklist de equivalencia

1. Endpoint GET equivalente preservado.
2. Permissao autenticada preservada.
3. Rate limit por usuario preservado.
4. Prioridade para assinatura local preservada.
5. Fallback ledger preservado.
6. Contrato rico de detalhe preservado.
7. Campos usados pela UI preservados.
8. Controller sem regra de negocio.
9. TypeORM em Repository/Entity.
10. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
