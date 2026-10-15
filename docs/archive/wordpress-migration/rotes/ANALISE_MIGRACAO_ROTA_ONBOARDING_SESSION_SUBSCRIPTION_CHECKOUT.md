# Analise Tecnica - Migracao da Rota Onboarding Subscription Checkout para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/subscription/checkout

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (runSubscriptionCheckout)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-product-tax-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-checkout-sync.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/Checkout.tsx
- eden-bowls/src/pages/checkout/CHECKOUT_RULES.md

Observacao importante:

- No enunciado apareceu GET, mas o endpoint real e POST.

## Responsabilidade da rota

A rota cria (ou reaproveita) o checkout de assinatura com base na sessao onboarding vinculada ao usuario autenticado.

No fluxo principal ela:

1. valida precondicoes da sessao,
2. monta pedido WooCommerce (order-first) com itens, endereco, frete e impostos,
3. dispara sincronizacao Stripe assincrona,
4. retorna estado de pagamento e dados de checkout.

Tambem existe um fluxo alternativo `subscription_first` via payload, que cria assinatura Stripe primeiro e persiste snapshot em `session.stripe_checkout` sem criar pedido local imediatamente.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/subscription/checkout
- Method: POST
- Callback: OnboardingApi::subscription_checkout
- Permission callback: OnboardingApi::require_linked_user_session_access

### Controller

- Extrai `session_id`
- Extrai payload
- Chama `CheckoutService::checkout(sessionId, payload)`
- Retorna envelope `{ success: true, data: result }` com status 200

### Regras de acesso escondidas

A permission callback da rota e mais restrita que as demais de onboarding:

1. exige token de sessao valido (`x-session-token` preferencial),
2. exige usuario autenticado (`is_user_logged_in`),
3. exige que `session.linked_user_id` seja igual ao `current_user_id`.

Erros comuns de acesso:

- 401 unauthorized
- 403 session_forbidden
- 404 session_not_found
- 429 rate_limit (limite de auth)

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- Authorization: Bearer JWT do usuario

Body (contrato front atual):

- billing?:
  - first_name?: string
  - last_name?: string
  - email?: string
  - phone?: string
  - company?: string
- payment_method_id?: string
- paymentMethodId?: string (alias aceito no backend)

Campos adicionais suportados pelo backend (fluxos legados/alternativos):

- checkout_mode / flow (ex.: `subscription_first`)
- product_id, variation_id, quantity (fallback quando sessao nao possui line_items)
- priceId / price_id (fluxo subscription_first)
- attempt_id (idempotencia stripe subscription-first)

## Validacoes que devem existir

## 1) Validacoes de plataforma

- WooCommerce ativo (`wc_create_order`, `wc_get_product`) ou erro 503 `woocommerce_required`.

## 2) Validacoes de sessao e usuario

- sessao deve existir
- sessao deve estar vinculada a usuario valido
- usuario vinculado deve estar ativo (`ActivationService::STATUS_ACTIVE`)

Erros:

- 404 `session_not_found`
- 422 `customer_required`
- 403 `customer_inactive`

## 3) Validacoes de completude da sessao

Obrigatorios para checkout:

- pets (>=1)
- questionnaire
- plan_selection
- plan_selection.catalog_pricing.line_items
- recurrence
- zipcode
- shipping (quando a sessao requer frete)

Erro principal:

- 422 `session_incomplete` (mensagens variam por campo faltante)

## 4) Validacoes de desconto e promocao

- revalida elegibilidade de desconto na hora do checkout
- aplica percentual por termo:
  - 1 mes -> 10%
  - 3 meses -> 25%
  - 6 meses -> 40%
- se promo Stripe de first purchase nao estiver configurada para termo valido, retorna 503 `first_purchase_promo_not_configured`

## 5) Validacoes de pagamento (subscription_first)

- `payment_method_id` deve existir e iniciar com `pm_`
- `priceId`/`price_id` deve iniciar com `price_`
- email do usuario vinculado deve ser valido

Erros comuns:

- 422 `invalid_payment_method`
- 422 `invalid_price_id`
- 422 `invalid_customer_email`
- 503 `stripe_subscription_unavailable`

## Fluxo da requisicao

## Fluxo principal (order-first)

1. permission callback valida usuario+sessao vinculada
2. CheckoutService carrega sessao
3. valida precondicoes de checkout
4. revalida elegibilidade de desconto
5. calcula snapshot de contexto e fingerprint de idempotencia
6. tenta reaproveitar pedido existente (`pending|failed|on-hold`) com mesmo fingerprint
7. se nao reaproveitar, monta linhas de checkout (preferindo `session.plan_selection.catalog_pricing.line_items`)
8. precheck fiscal (`ProductTaxService`)
9. cria pedido WooCommerce
10. aplica itens, endereco, shipping, metadados de onboarding e fiscais
11. calcula totais e salva pedido
12. dispara hook `hsr_checkout_order_ready_for_stripe_sync` (sync Stripe assincrona)
13. salva `session.checkout_order_id`
14. retorna `present_checkout(...)`

## Fluxo alternativo (subscription-first)

1. ativado com `checkout_mode` ou `flow` = `subscription_first`
2. valida payment method + price ids
3. monta payload para filtro `hsr_checkout_create_stripe_subscription`
4. recebe retorno da camada Stripe
5. persiste em `session.stripe_checkout`
6. retorna response com `order_id=0` e `stripe_client_secret` para confirmacao no front

## Estrutura de resposta

Contrato usado pelo front (`SubscriptionCheckoutResponse`):

- session_id: string
- order_id: number
- order_key: string
- status: string
- total: number
- subtotal?: number
- product_tax?: number
- shipping_total: number
- shipping_tax: number
- shipping_total_with_tax: number
- currency: string
- payment_url?: string
- subscription_ids: number[]
- flexible_subscription_id: number
- stripe_subscription_id: string
- stripe_client_secret?: string
- stripe_payment_intent_id?: string
- stripe_payment_intent_status?: string
- stripe_subscription_status?: string
- stripe_sync_error?: string
- stripe_sync_debug?: Record<string, unknown>
- payment_state?: string
- has_payment_method: boolean
- reused: boolean

Observacao:

- O backend tambem pode retornar campos operacionais extras em alguns fluxos (`hsr_idempotency_key`, `hsr_attempt_id`, `checkout_trace_id`).

## Regras de negocio escondidas no WordPress

1. Idempotencia por fingerprint de contexto
- Reuso de pedido depende de hash com sessao, moeda, subtotal, total com desconto, termo, line_items e pets.

2. Persistencia extensa em meta de pedido
- grava snapshot completo de onboarding e contexto de checkout em order meta (`_hsr_onboarding_*`, `_hsr_checkout_*`, `_hsr_shipping_*`, `_hsr_product_tax*`).

3. Discount e promo sao revalidados no checkout
- mesmo se ja avaliados antes na UI.

4. Shipping obrigatorio e dinamico
- se produtos da sessao exigirem frete (`needs_shipping`) e nao houver `plan_selection.shipping`, checkout falha.

5. Sincronizacao Stripe e assincrona (order-first)
- pedido e criado antes; dados Stripe podem chegar depois via hook.

6. Materializacao tardia de assinatura local
- apos confirmacao de invoice Stripe paga, pode criar `fsb_subscription` local e propagar metadados de frete.

7. Fallback de linhas via payload
- se sessao nao tiver line_items, tenta usar `product_id`/`variation_id`/`quantity` do payload.

8. Estado de pagamento derivado
- `payment_state` e inferido por status do pedido + dados Stripe + presença de payment method.

## Banco, tabelas e consultas

## Tabelas/entidades principais

1. wp_hsr_onboarding_sessions
- leitura/escrita do aggregate onboarding (incluindo `checkout_order_id`, `plan_selection_json`, `stripe_checkout_json`)

2. wp_hsr_onboarding_pets
- leitura de pets da sessao (via repository)

3. wp_posts / wp_postmeta (WooCommerce)
- criacao e atualizacao de `shop_order`
- busca e vinculacao de `fsb_subscription` (Flexible Subscriptions)
- persistencia de metadados de checkout/frete/tax/stripe

4. wp_hsr_stripe_subscriptions
- consulta para detectar subscription ativa/trialing na revalidacao de elegibilidade de desconto

5. wp_usermeta
- leitura de status de ativacao do usuario vinculado

## Consultas e operacoes relevantes

- `SELECT` sessao por session_id via repository
- `INSERT/UPDATE` sessao onboarding via repository
- `wc_create_order`, `wc_get_order`, `wc_get_orders`
- query SQL direta para `wp_hsr_stripe_subscriptions` (active/trialing por user/email)

## Custom Post Types, taxonomias e campos personalizados

Custom post types / order types usados:

- `shop_order` (WooCommerce)
- `fsb_subscription` (Flexible Subscriptions)

Taxonomias:

- nao ha uso de taxonomias nesta rota

Campos personalizados (order meta) relevantes:

- `_hsr_onboarding_session_id`
- `_hsr_onboarding_pets`
- `_hsr_onboarding_questionnaire`
- `_hsr_onboarding_recurrence`
- `_hsr_onboarding_plan_selection`
- `_hsr_onboarding_zipcode`
- `_hsr_checkout_payload`
- `_hsr_checkout_context_fingerprint`
- `_hsr_shipping_*`
- `_hsr_product_tax`, `_hsr_product_subtotal`, `_hsr_product_tax_percent`
- `_hsr_stripe_*`
- `_hsr_discount_*`

## Plugins e dependencias

1. headless-secure-registration
- endpoint, permission, CheckoutService, OnboardingRepository

2. WooCommerce
- criacao de pedido, itens, totais, enderecos, metadados

3. Flexible Subscriptions bridge/ecossistema
- tipo `fsb_subscription`
- criacao via hook `woocommerce_rest_insert_shop_order_object`

4. pawbowl-stripe-billing
- sync Stripe via hook `hsr_checkout_order_ready_for_stripe_sync`
- fluxo subscription-first via filtro `hsr_checkout_create_stripe_subscription`

5. Stripe
- payment intent/subscription state refletidos nos metadados

## Regras de preco, moeda e pais

1. Moeda
- prioridade: `plan_selection.catalog_pricing.currency` -> zipcode.country -> session.country -> moeda default WooCommerce.

2. Preco e subtotal
- preferencia por line_items e totais de `catalog_pricing` da sessao.

3. Impostos
- `ProductTaxService` recalcula/resolve imposto de produto e persiste metadados fiscais.

4. Desconto de primeiro pedido
- aplicado conforme termo de assinatura e elegibilidade real no momento do checkout.

5. Frete
- snapshot de shipping selecionado e incorporado ao pedido (incluindo faixa de prazo e tax de frete).

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/subscription/checkout

Controller:
- OnboardingApi::subscription_checkout

Service:
- CheckoutService::checkout
- validate_session_for_checkout
- revalidate_discount_eligibility_for_checkout
- build_checkout_lines
- present_checkout
- checkout_subscription_first (fluxo alternativo)

Repository:
- OnboardingRepository::get
- OnboardingRepository::save
- OnboardingRepository::find_by_stripe_subscription_id (materializacao tardia)

Banco/tabelas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets
- wp_posts/wp_postmeta (shop_order, fsb_subscription)
- wp_hsr_stripe_subscriptions
- wp_usermeta

Regras de negocio:
- acesso com sessao vinculada ao usuario autenticado
- idempotencia por fingerprint
- validacao forte de completude
- desconto revalidado no checkout
- integracao Stripe assíncrona + fallbacks

Campos retornados:
- contrato SubscriptionCheckoutResponse (incluindo bloco Stripe/payment_state/reused)

## Node.js (proposto)

Controller:
- OnboardingSubscriptionCheckoutController.checkout

Service:
- SubscriptionCheckoutService.checkout
- CheckoutValidationService.validateSession
- CheckoutPricingService.resolveLinesTaxesDiscounts
- PaymentOrchestrationService (order-first/subscription-first)

Repository:
- OnboardingSessionRepository
- CheckoutOrderRepository
- StripeSubscriptionLedgerRepository
- UserAccountRepository

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity
- CheckoutOrderEntity
- CheckoutOrderMetaEntity (ou tabela equivalente de snapshots)
- StripeSubscriptionLedgerEntity
- UserEntity/UserMetaEntity

DTOs:

Entrada:
- SubscriptionCheckoutParamsDto
  - sessionId: string
- SubscriptionCheckoutRequestDto
  - billing?: { first_name?, last_name?, email?, phone?, company? }
  - payment_method_id?: string
  - paymentMethodId?: string
  - checkout_mode?: string
  - flow?: string
  - product_id?: number
  - variation_id?: number
  - quantity?: number
  - priceId?: string
  - price_id?: string
  - attempt_id?: string

Saida:
- SubscriptionCheckoutResponseDto
  - mesmo contrato funcional do front atual

Validacoes:
- autenticacao JWT + sessao vinculada
- sessao completa para checkout
- payment method e price id quando fluxo exigir
- consistencia de shipping/tax/currency
- idempotencia por fingerprint

## Modelo de dados necessario no Node

Minimo para paridade:

1. Aggregate de sessao onboarding
- session_id, linked_user_id, checkout_order_id
- questionnaire/recurrence/plan_selection/zipcode/stripe_checkout

2. Entidade de pedido de checkout
- estado do pedido, totais, moeda
- snapshot de contexto de checkout
- metadados de shipping/tax/stripe/discount

3. Ledger de subscriptions Stripe
- status por user/email para revalidacao de elegibilidade

4. Estado de pagamento
- client secret, payment_intent_id, payment_intent_status, payment_state

## Possiveis problemas na migracao

1. Quebra de idempotencia
- sem fingerprint de contexto + politica de reuso, pode duplicar pedidos.

2. Divergencia de precondicoes
- qualquer relaxamento de `session_incomplete` muda comportamento do funil.

3. Diferenca no fluxo async Stripe
- se Node tornar tudo sincrono ou mudar gatilhos, pode alterar timing/estado da UI.

4. Perda de snapshots de metadados
- sem metadados equivalentes, reconciliacao, debug e retomada de checkout ficam fragilizados.

5. Divergencia em desconto first purchase
- ausencia de revalidacao com ledger real pode permitir desconto indevido.

6. Inconsistencia de currency/tax/shipping
- discrepancias no calculo final impactam total pago e estado de pagamento.

7. Compatibilidade com subscription-first
- ignorar esse modo quebra fluxos administrativos/experimentais ja existentes.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- Node.js + TypeScript + Express
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- somente parse/validacao superficial de DTO + auth context
- sem regra de negocio

2. Service de dominio
- orquestrar validacao de sessao
- calcular contexto/fingerprint
- decidir reuso vs criacao
- persistir snapshots e estado de pagamento
- retornar contrato compativel com frontend

3. Repository layer
- transacoes atomicas para sessao+pedido
- lock otimista/pessimista em checkout_order_id para evitar corrida

4. Integracao de pagamento
- adapter Stripe isolado
- eventos/hook equivalentes para sincronizacao assíncrona

5. Compatibilidade progressiva
- manter branch subscription-first com o mesmo contrato

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. usuario nao vinculado/ativo -> customer_required/customer_inactive
3. sessao incompleta por cada precondicao -> session_incomplete
4. reuso de pedido com mesmo fingerprint -> reused=true
5. nao reuso com fingerprint diferente
6. fallback de line_items para product_id payload
7. desconto por termo (1/3/6) + ineligibilidade
8. erro de promo nao configurada -> 503
9. fluxo subscription-first com payment_method_id invalido -> 422
10. resposta final com contrato completo esperado pelo frontend

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Permissao linked-user-session equivalente preservada.
3. Validacoes de completude da sessao preservadas.
4. Idempotencia por fingerprint preservada.
5. Fluxo order-first + async stripe preservado.
6. Fluxo subscription-first preservado.
7. Contrato SubscriptionCheckoutResponse preservado.
8. Metadados de shipping/tax/discount/stripe preservados.
9. Controller sem regra de negocio.
10. TypeORM em repository/entity.
11. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
