# Analise Tecnica - Migracao da Rota Onboarding Payment Intent ACK para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/payment-intent/ack

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (acknowledgeSubscriptionPaymentIntent)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/Checkout.tsx
- eden-bowls/src/pages/checkout/CHECKOUT_RULES.md

## Responsabilidade da rota

A rota confirma para o backend o estado final do Stripe PaymentIntent apos validacao/confirmacao no frontend.

Objetivo pratico:

1. Persistir `payment_intent_id` e `payment_intent_status` no contexto de checkout.
2. Consolidar `payment_state` para a UI.
3. Limpar `stripe_client_secret` quando o pagamento ja esta em estado pago/processando.

Ela nao cria pedido nem calcula preco/frete; e uma rota de reconciliacao de estado de pagamento.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/payment-intent/ack
- Method: POST
- Callback: OnboardingApi::payment_intent_ack
- Permission callback: OnboardingApi::require_linked_user_session_access

### Controller

- Extrai `session_id`
- Extrai payload JSON
- Chama `CheckoutService::acknowledge_payment_intent(sessionId, payload)`
- Retorna envelope `{ success: true, data: result }` com status 200

### Regra de acesso importante

A rota exige:

1. token de sessao valido (`x-session-token` preferencial),
2. usuario logado (JWT),
3. ownership da sessao (`linked_user_id == current_user_id`).

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- Authorization: Bearer JWT

Body (PaymentIntentAckPayload):

- payment_intent_id?: string
- paymentIntentId?: string
- payment_intent_status?: string
- paymentIntentStatus?: string

## Validacoes que devem existir

## 1) Validacoes de plataforma/sessao

- WooCommerce ativo (`wc_get_order`) para o caminho com pedido
- sessao existente

Erros:

- 503 `woocommerce_required`
- 404 `session_not_found`

## 2) Validacao do PaymentIntent

1. `payment_intent_id` obrigatorio e deve comecar com `pi_`
- erro: `invalid_payment_intent_id`
- status: 422

2. `payment_intent_status` obrigatorio em lista permitida:
- `succeeded`
- `processing`
- `requires_capture`
- `requires_payment_method`
- `requires_action`
- `requires_confirmation`
- `canceled`
- erro: `invalid_payment_intent_status`
- status: 422

3. consistencia de id (mismatch)
- se ja existe `payment_intent_id` salvo e for diferente do enviado, erro:
  - `payment_intent_mismatch`
  - status: 409

## 3) Validacao de contexto de checkout

- caminho com pedido (`session.checkout_order_id > 0`): exige order existente
  - erro: `checkout_order_not_found` (404)
- caminho sem pedido (subscription-first): exige `session.stripe_checkout` existente
  - erro: `checkout_order_not_found` (422)

## Fluxo da requisicao

1. Request entra em POST /payment-intent/ack
2. Permission callback valida sessao vinculada ao usuario autenticado
3. Controller delega para CheckoutService
4. Service carrega sessao
5. Se houver `checkout_order_id`, segue fluxo de ACK por pedido:
   - valida payload
   - valida mismatch de PI
   - grava metas `_hsr_stripe_payment_intent_id` e `_hsr_stripe_payment_intent_status`
   - limpa `_hsr_stripe_client_secret` em status pago/processando
   - calcula `payment_state` via `resolve_payment_state`
   - retorna ACK
6. Se nao houver `checkout_order_id`, segue fluxo fallback (subscription-first):
   - valida payload
   - exige `session.stripe_checkout`
   - valida mismatch de PI
   - atualiza `session.stripe_checkout`
   - limpa client_secret e seta payment_state paid em status pago/processando
   - salva sessao
   - retorna ACK

## Estrutura de resposta

Retorno principal esperado pelo front (`PaymentIntentAckResponse`):

- order_id: number
- stripe_payment_intent_id: string
- stripe_payment_intent_status: string
- payment_state: string
- acked: boolean

Observacao:

- No caminho sem pedido, backend tambem retorna `stripe_subscription_id` (campo extra nao tipado no DTO do front, mas inofensivo).

## Regras de negocio escondidas no WordPress

1. Dois caminhos de ACK
- com pedido local (`shop_order`) e sem pedido local (snapshot em `session.stripe_checkout`).

2. Sem chamada direta a Stripe
- ACK apenas confirma estado informado pelo front; nao consulta API Stripe nessa rota.

3. `payment_state` derivado
- combina status do pedido, estado do PI, presence de client_secret, presence de payment method e erro de sync Stripe.

4. Limpeza de client_secret
- para `succeeded|processing|requires_capture`, client secret e limpado para evitar re-confirmacao indevida.

5. Diferenca sutil de status para checkout ausente
- com order ausente -> 404
- sem order mas com fluxo subscription-first ausente -> 422

6. Tolerancia no front
- se ACK falhar apos confirmacao Stripe, UI mantem sucesso e deixa webhook convergir estado.

## Banco, tabelas e consultas

## Tabelas usadas

1. wp_hsr_onboarding_sessions
- leitura da sessao
- escrita em `stripe_checkout_json` no caminho sem pedido

2. wp_posts/wp_postmeta (WooCommerce shop_order)
- leitura do pedido por `checkout_order_id`
- escrita de metadados Stripe do PaymentIntent

3. wp_hsr_onboarding_pets
- nao usada diretamente nesta rota

## Escrita de dados

No pedido:

- `_hsr_stripe_payment_intent_id`
- `_hsr_stripe_payment_intent_status`
- `_hsr_stripe_client_secret` (limpeza condicional)

Na sessao (fallback sem pedido):

- `stripe_checkout.stripe_payment_intent_id`
- `stripe_checkout.stripe_payment_intent_status`
- `stripe_checkout.stripe_client_secret` (limpeza condicional)
- `stripe_checkout.payment_state` (quando pago)

## CPT, taxonomias e campos customizados

- Nao usa taxonomias.
- Nao usa CPT de negocio custom.
- Usa order type do WooCommerce (`shop_order`) e metadados custom `_hsr_*`.

## Plugins e dependencias

1. headless-secure-registration
- endpoint, permissao e CheckoutService

2. WooCommerce
- resolucao e persistencia em order/meta (`wc_get_order`)

3. Stripe (indireto)
- dados de PI vem do frontend (Stripe.js), mas esta rota nao chama Stripe API.

## Regras de preco, moeda e pais

- Esta rota nao calcula preco, imposto, moeda ou frete.
- Apenas consolida estado de pagamento.

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/payment-intent/ack

Controller:
- OnboardingApi::payment_intent_ack

Service:
- CheckoutService::acknowledge_payment_intent
- acknowledge_payment_intent_without_order
- resolve_payment_state

Repository:
- OnboardingRepository::get
- OnboardingRepository::save (fallback sem pedido)

Banco/tabelas:
- wp_hsr_onboarding_sessions
- wp_posts/wp_postmeta (shop_order)

Regras de negocio:
- validacao forte de PI id/status
- protecao contra mismatch
- branch com pedido vs sem pedido
- limpeza de client_secret em status pago/processando

Campos retornados:
- order_id
- stripe_payment_intent_id
- stripe_payment_intent_status
- payment_state
- acked

## Node.js (proposto)

Controller:
- OnboardingPaymentIntentAckController.ack

Service:
- PaymentIntentAckService.acknowledge
- PaymentStateResolver.resolve

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.saveStripeCheckout
- CheckoutOrderRepository.findById
- CheckoutOrderRepository.updatePaymentIntentMeta

Entities/Models (TypeORM):
- OnboardingSessionEntity
- CheckoutOrderEntity
- CheckoutOrderMetaEntity (ou colunas equivalentes)

DTOs:

Entrada:
- PaymentIntentAckParamsDto
  - sessionId: string
- PaymentIntentAckRequestDto
  - paymentIntentId: string (map de payment_intent_id/paymentIntentId)
  - paymentIntentStatus: string (map de payment_intent_status/paymentIntentStatus)

Saida:
- PaymentIntentAckResponseDto
  - orderId: number
  - stripePaymentIntentId: string
  - stripePaymentIntentStatus: string
  - paymentState: string
  - acked: boolean

Validacoes:
- ownership de sessao vinculada
- formato de payment_intent_id (prefixo pi_)
- status permitido
- mismatch guard
- branch order vs stripe_checkout snapshot

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id
- linked_user_id
- checkout_order_id
- stripe_checkout_json

2. checkout_orders
- id/status
- payment_method_id
- stripe_subscription_id
- stripe_client_secret
- stripe_payment_intent_id
- stripe_payment_intent_status
- stripe_sync_error

3. user-session ownership
- necessario para validar acesso da rota

## Possiveis problemas na migracao

1. Quebra de compatibilidade de status
- se lista permitida de PI status divergir, ACK pode falhar em cenarios validos.

2. Falha de branch sem pedido
- ignorar fluxo subscription-first quebra ACK quando order_id ainda nao existe.

3. Falha em limpar client_secret
- pode causar tentativas duplicadas de confirmacao no front.

4. Ausencia do guard de mismatch
- permite ACK de PI errado para outra sessao/pedido.

5. Inconsistencia de payment_state
- regras diferentes de resolucao podem gerar UX incorreta de pagamento.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- Node.js + TypeScript + Express
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- validar DTO de entrada e auth context
- mapear aliases snake/camel
- sem regra de negocio

2. Service
- carregar sessao
- decidir branch (com order / sem order)
- aplicar validacoes e guardas de mismatch
- persistir update atomico
- retornar DTO

3. Repository
- updates idempotentes por sessionId/orderId
- lock concorrente para evitar races entre webhook e ACK

4. Resolvedor de estado
- centralizar regra de `payment_state` para manter paridade com checkout

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. payment_intent_id invalido -> 422
3. payment_intent_status invalido -> 422
4. mismatch de PI -> 409
5. order path com sucesso -> atualiza order meta e retorna acked
6. fallback sem pedido com sucesso -> atualiza stripe_checkout e retorna acked
7. limpeza de client_secret em status pago/processando
8. erro checkout_order_not_found nas duas variantes (404/422 conforme branch)

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Permissao linked-user-session equivalente preservada.
3. Contrato de request com aliases snake/camel preservado.
4. Lista de statuses permitidos preservada.
5. Guard de mismatch preservado.
6. Branch com pedido e sem pedido preservados.
7. Regra de limpar client_secret preservada.
8. Resposta PaymentIntentAckResponse preservada.
9. Controller sem regra de negocio.
10. TypeORM em repository/entity.
11. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
