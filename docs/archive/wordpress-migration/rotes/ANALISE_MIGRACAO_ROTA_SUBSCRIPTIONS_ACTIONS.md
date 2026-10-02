# Analise Tecnica - Migracao da Rota Subscription Actions para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/subscriptions/:subscriptionId/actions

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (runSubscriptionAction)
- eden-bowls/src/services/subscriptionEditApi.ts (updateSubscriptionPaymentMethod)
- eden-bowls/src/pages/dashboard/pages/EditSubscription.tsx
- eden-bowls/src/pages/dashboard/pages/PlanDetail.tsx

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-api.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-ledger-schema.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-edit-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-wp-status-sync-listener.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-checkout-sync.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/services/subscriptionEditApi.ts
- eden-bowls/src/pages/dashboard/pages/EditSubscription.tsx
- eden-bowls/src/pages/dashboard/pages/PlanDetail.tsx
- artefatos/documentacao-plugins-backend/04-pawbowl-stripe-billing.md
- artefatos/AUDITORIA_STRIPE_ARQUITETURA_2026-07-07.md

## Responsabilidade da rota

A rota executa acoes de manutencao/alteracao sobre uma assinatura do usuario autenticado.

Nao e uma operacao CRUD simples. Ela atua como um comando que dispara uma acao no Stripe e/ou no estado local do WooCommerce, e normalmente retorna com `pending_webhook_confirmation = true` para indicar que a confirmacao final deve vir via webhook.

Acoes suportadas no WordPress:

- `pause`
- `reactivate`
- `cancel`
- `toggle_auto_renew`
- `change_plan`
- `change_billing_frequency`
- `update_payment_method`

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /subscriptions/(?P<subscription_id>[^/]+)/actions
- Method: POST
- Callback: StripeSubscriptionApi::subscription_action
- Permission callback: StripeSubscriptionApi::require_authenticated_user

### Controller

- Verifica usuario logado
- Sanitiza `subscription_id`
- Aplica rate limit por usuario
- Carrega a assinatura do usuario
- Extrai `action` do payload
- Encaminha a operacao para `StripeSubscriptionService` ou `StripeSubscriptionEditService`
- Retorna a assinatura refrescada no payload de resposta

### Regra de acesso importante

A rota depende de usuario autenticado no WordPress.

Erros comuns:

- 401 unauthorized
- 422 invalid_subscription_id
- 422 invalid_action
- 404 subscription_not_found
- 429 rate_limit

## Parametros recebidos

Path params:

- subscription_id: string

Body esperado:

- action: string
- enabled?: boolean
- new_variation_id?: number
- new_product_id?: number
- new_price_id?: string
- frequency?: string
- proration_behavior?: string
- payment_method_id?: string
- request_fingerprint?: string

Campos por acao:

### 1) pause
- nenhum campo adicional obrigatorio

### 2) reactivate
- nenhum campo adicional obrigatorio

### 3) cancel
- nenhum campo adicional obrigatorio

### 4) toggle_auto_renew
- enabled?: boolean (opcional)

### 5) change_plan
- new_variation_id ou new_product_id obrigatorio
- new_price_id obrigatorio e deve iniciar com `price_`
- proration_behavior opcional

### 6) change_billing_frequency
- frequency obrigatorio: weekly, biweekly ou monthly
- new_price_id obrigatorio e deve iniciar com `price_`
- proration_behavior opcional

### 7) update_payment_method
- payment_method_id obrigatorio e deve iniciar com `pm_`

## Validacoes que devem existir

## 1) Validacao de autenticacao

- usuario precisa estar logado (`get_current_user_id() > 0`)

Erro:

- `unauthorized` -> 401

## 2) Validacao de subscription_id

- `subscription_id` nao pode ser vazio
- precisa ser um Stripe subscription id valido

Erro:

- `invalid_subscription_id` -> 422

## 3) Rate limit

- limite por usuario: 40 requisicoes em 300 segundos

Erro:

- `rate_limit` -> 429

## 4) Ownership da assinatura

- a assinatura precisa pertencer ao usuario autenticado
- o backend carrega a ordem/assinatura local via `load_user_subscription`

Erro:

- `subscription_not_found` -> 404

## 5) Validacao da action

- `action` obrigatorio
- apenas valores suportados sao aceitos

Erro:

- `invalid_action` -> 422

## 6) Validacoes especificas por acao

### change_plan
- precisa de `new_variation_id` ou `new_product_id`
- precisa de `new_price_id` com prefixo `price_`
- erro `invalid_plan` ou `invalid_price_id`

### change_billing_frequency
- `frequency` precisa ser weekly, biweekly ou monthly
- `new_price_id` precisa iniciar com `price_`
- erro `invalid_frequency` ou `invalid_price_id`

### update_payment_method
- `payment_method_id` precisa iniciar com `pm_`
- erro `invalid_payment_method`

## Fluxo da requisicao

1. POST /subscriptions/:subscriptionId/actions chega na rota
2. controller valida usuario autenticado
3. sanitiza `subscription_id`
4. aplica rate limit por usuario
5. carrega a assinatura do usuario
6. extrai `action` do payload
7. executa o comando apropriado no service
8. quando aplicavel, atualiza Stripe primeiro e mantem o estado local pendente de webhook
9. recarrega a assinatura e formata o detalhe atualizado
10. retorna resposta com `pending_webhook_confirmation`

## Estrutura de resposta

Envelope HTTP:

- success: true
- data:
  - action: string
  - pending_webhook_confirmation: boolean
  - command_result: array
  - subscription: DashboardSubscriptionDetail

## Comportamento por acao

### pause
- chama `pause_subscription(stripeSubscriptionId)`
- marca `pending_webhook_confirmation = true`

### reactivate
- chama `reactivate_subscription(stripeSubscriptionId)`
- marca `pending_webhook_confirmation = true`

### cancel
- chama `cancel_subscription(stripeSubscriptionId)`
- marca `pending_webhook_confirmation = true`

### toggle_auto_renew
- resolve `enabled` do payload ou alterna o valor atual da assinatura
- chama `set_subscription_auto_renew(stripeSubscriptionId, enabled)`
- marca `pending_webhook_confirmation = true`

### change_plan
- atualiza o preco da assinatura no Stripe primeiro
- nao faz mutacao otimista local
- marca `pending_webhook_confirmation = true`
- usa `x-request-id` como `request_fingerprint` quando disponivel

### change_billing_frequency
- valida frequencia e novo price id
- atualiza a assinatura no Stripe
- marca `pending_webhook_confirmation = true`

### update_payment_method
- atualiza o payment method do cliente/assinatura no Stripe
- marca `pending_webhook_confirmation = true`

## Regras de negocio escondidas no WordPress

1. Comando com confirmacao diferida
- a maior parte das acoes retorna sucesso imediato, mas o estado final pode depender do webhook Stripe.

2. Stripe e a fonte autoritativa para varias mudancas
- principalmente `change_plan`, `change_billing_frequency`, `pause`, `reactivate`, `cancel` e `update_payment_method`.

3. Sem mutacao local otimista para troca de plano/frequencia
- a alteracao final e materializada depois do webhook.

4. `pending_webhook_confirmation`
- o front usa esse sinal para aguardar o estado convergir antes de considerar a operacao totalmente concluida.

5. `toggle_auto_renew` pode inferir o novo estado
- se `enabled` nao vier no payload, o backend alterna com base no estado atual.

6. `change_plan` aceita `new_variation_id` ou `new_product_id`
- isso preserva compatibilidade entre nivel de produto/variacao.

7. Idempotencia observacional via fingerprint
- `request_fingerprint` e `x-request-id` ajudam o backend a rastrear a troca.

8. A resposta sempre inclui a assinatura refrescada
- o front usa isso para atualizar a UI imediatamente, mesmo antes do webhook confirmar o estado final.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_posts / wp_postmeta
- assinaturas WooCommerce/Flexible Subscriptions
- metadados da assinatura e do pedido

2. wp_hsr_stripe_subscriptions
- ledger para estado Stripe da assinatura

3. wp_hsr_stripe_payment_intents
- auxilia no estado de pagamentos associados a mudancas de metodo/assinatura

4. wp_hsr_stripe_events
- rastreamento de webhooks e deduplicacao/reprocessamento

5. wp_hsr_stripe_customers
- vinculo de customer e payment method

6. wp_hsr_stripe_invoices
- historico de cobranca para mudancas que impactam o ciclo

## Queries observadas

### Carregamento da assinatura do usuario

- `load_user_subscription(stripeSubscriptionId, currentUserId)`
- busca em `wc_get_orders([ 'type' => 'fsb_subscription', 'customer_id' => userId ])`

### Atualizacoes Stripe

- chamadas do service:
  - `pause_subscription`
  - `reactivate_subscription`
  - `cancel_subscription`
  - `set_subscription_auto_renew`
  - `update_subscription`
  - `update_payment_method`

### Lock/trace

- uso de `x-request-id` como fingerprint em mudancas de plano/frequencia

## Custom Post Types e tipos de post/pedido

- `fsb_subscription` (assinatura WooCommerce/Flexible Subscriptions)
- `shop_order` em suporte/espelho do ecossistema

## Taxonomias

- nenhuma taxonomia usada nesta rota

## Campos personalizados relevantes

No WooCommerce/order:

- `_hsr_stripe_subscription_id`
- `_hsr_stripe_subscription_status`
- `_hsr_stripe_payment_intent_id`
- `_hsr_stripe_payment_intent_status`
- `_hsr_payment_method_id`
- `_hsr_payment_method_brand`
- `_hsr_payment_method_last4`
- `_hsr_stripe_current_period_start`
- `_hsr_stripe_current_period_end`
- `_hsr_stripe_plan_price_id`
- `_hsr_edit_payment_pending`
- `_hsr_stripe_last_webhook_event`
- `_hsr_stripe_last_webhook_event_id`
- `_hsr_stripe_last_webhook_at`
- `_hsr_stripe_last_correlation_id`

## Plugins e dependencias

1. pawbowl-stripe-billing
- endpoint de acoes e services de controle de assinatura

2. WooCommerce
- carregamento da assinatura local e persistencia de metadados

3. Stripe PHP SDK
- operacionalmente usado pelos services chamados pelo controller

4. headless-secure-registration
- origina a autenticacao do usuario no ecossistema headless

## Regras de preco, moeda e pais

### change_plan e change_billing_frequency
- exigem `new_price_id` Stripe valido
- a moeda/preco final sao derivados do price map do Stripe

### update_payment_method
- nao altera preco, mas pode afetar o status de cobranca futura

### pause/reactivate/cancel/toggle_auto_renew
- nao fazem calculo de preco, mas podem alterar o proximo ciclo e os estados de billing

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/subscriptions/:subscriptionId/actions

Controller:
- StripeSubscriptionApi::subscription_action

Service:
- StripeSubscriptionService::pause_subscription
- StripeSubscriptionService::reactivate_subscription
- StripeSubscriptionService::cancel_subscription
- StripeSubscriptionService::set_subscription_auto_renew
- StripeSubscriptionService::update_subscription
- StripeSubscriptionService::update_payment_method
- StripeSubscriptionEditService quando acoplado ao detalhe/edicao

Repository/queries:
- load_user_subscription
- load_user_subscription_ledger
- query em wp_hsr_stripe_subscriptions e metadados de WooCommerce

Banco/tabelas utilizadas:
- wp_posts/wp_postmeta
- wp_hsr_stripe_subscriptions
- wp_hsr_stripe_events
- wp_hsr_stripe_payment_intents
- wp_hsr_stripe_invoices
- wp_hsr_stripe_customers

Regras de negocio:
- acao comandada com confirmacao via webhook
- stripe e autoritativo para o estado final
- mutacao local nao otimista em change_plan/change_billing_frequency
- `pending_webhook_confirmation` sempre que a mudanca depende de webhook

Campos retornados:
- action
- pending_webhook_confirmation
- command_result
- subscription

## Node.js

Controller:
- SubscriptionsController.executeAction

Service:
- SubscriptionsService.executeActionForUser
- SubscriptionsService.pauseSubscription
- SubscriptionsService.reactivateSubscription
- SubscriptionsService.cancelSubscription
- SubscriptionsService.toggleAutoRenew
- SubscriptionsService.changePlan
- SubscriptionsService.changeBillingFrequency
- SubscriptionsService.updatePaymentMethod

Repository:
- SubscriptionRepository.findByStripeSubscriptionIdAndUser
- SubscriptionLedgerRepository.findByStripeIdAndUser
- EventRepository.insertWebhookTrace
- CustomerRepository.findByStripeCustomerId
- PaymentRepository.updatePaymentMethod

Entities/Models (TypeORM):
- SubscriptionEntity / OrderEntity
- SubscriptionLedgerEntity
- CustomerEntity
- InvoiceEntity
- PaymentIntentEntity
- WebhookEventEntity
- OrderMetaEntity

DTOs:

Entrada:
- ExecuteSubscriptionActionParamsDto
  - subscriptionId: string
- ExecuteSubscriptionActionRequestDto
  - action: 'pause' | 'reactivate' | 'cancel' | 'toggle_auto_renew' | 'change_plan' | 'change_billing_frequency' | 'update_payment_method'
  - enabled?: boolean
  - newVariationId?: number
  - newProductId?: number
  - newPriceId?: string
  - frequency?: 'weekly' | 'biweekly' | 'monthly'
  - prorationBehavior?: string
  - paymentMethodId?: string
  - requestFingerprint?: string

Saida:
- ExecuteSubscriptionActionResponseDto
  - action: string
  - pendingWebhookConfirmation: boolean
  - commandResult: Record<string, unknown>
  - subscription: DashboardSubscriptionDetailDto

Validacoes:
- usuario autenticado
- subscriptionId valido (`sub_...`)
- ownership da assinatura
- action suportada
- validacoes especificas por acao
- rate limit por usuario
- `priceId` com prefixo `price_`
- `paymentMethodId` com prefixo `pm_`

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe subscriptionId e payload
2. Guard valida usuario autenticado
3. Service carrega assinatura do usuario
4. Service valida a acao e parametros especificos
5. Service chama o provider Stripe adequado
6. Service persiste rastreio/estado auxiliar quando necessario
7. Service recalcula projeção do detalhe retornado
8. Controller responde com `pendingWebhookConfirmation` e `subscription`

## Modelo de dados necessario no Node

Minimo para paridade:

1. subscriptions / orders
- id
- user_id
- stripe_subscription_id
- status
- current_period_end
- plan_label
- edit_payment_pending
- subscription_term_months

2. subscription_ledger
- stripe_subscription_id
- wp_user_id
- stripe_customer_id
- status
- current_period_end
- payment_method_last4

3. customers
- stripe_customer_id
- user_id
- email
- name

4. invoices / payment_intents / webhook_events
- necessario para trilha de auditoria e confirmacao de webhook

5. order_meta / subscription_meta
- necessario para manter compatibilidade com os campos exibidos no dashboard

## Possiveis problemas na migracao

1. Esquecer o estado `pending_webhook_confirmation`
- a UI pode assumir sucesso final antes da hora.

2. Nao separar `change_plan` de `change_billing_frequency`
- cada um tem validacoes e impacto de precificacao distintos.

3. Ignorar `request_fingerprint`
- perde rastreabilidade e correlação entre comandos e webhooks.

4. Nao validar ownership no Node
- um usuario poderia alterar assinatura de outro.

5. Exigir mutacao local imediata
- contraria o comportamento atual de deixar o webhook materializar o estado final.

6. Contrato de retorno diferente
- o front espera `subscription` atualizado com shape de dashboard detalhado.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- valida DTO e auth
- sem logica de negocio

2. Service central
- orquestra a acao, valida comandos, chama Stripe e monta a resposta

3. Repository dedicado
- assinatura, ledger, customer, pagamentos e webhooks

4. Coordenação com webhook
- manter uma trilha de eventos/estado para garantir confirmacao assincrona

### Testes unitarios recomendados

1. usuario nao autenticado -> 401
2. subscriptionId invalido -> 422
3. action ausente -> 422
4. subscription inexistente -> 404
5. pause/reactivate/cancel retornam pendingWebhookConfirmation
6. toggle_auto_renew alterna estado quando enabled nao vier
7. change_plan valida new_price_id e new_variation_id/new_product_id
8. change_billing_frequency valida frequency e new_price_id
9. update_payment_method valida pm_ e persiste rastreio
10. resposta inclui subscription atualizada

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Permissao autenticada preservada.
3. Rate limit por usuario preservado.
4. Acoes suportadas preservadas.
5. `pending_webhook_confirmation` preservado.
6. Validacoes de `price_` e `pm_` preservadas.
7. Resposta com `subscription` refrescada preservada.
8. Controller sem regra de negocio.
9. TypeORM em Repository/Entity.
10. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
