# Analise Tecnica - Migracao da Rota Subscriptions para Node.js

## Escopo

Rota atual no WordPress:

- GET /custom/v1/subscriptions

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchUserSubscriptions)
- eden-bowls/src/pages/dashboard/pages/MyPlan.tsx
- eden-bowls/src/pages/plan/Plan.tsx
- eden-bowls/src/pages/dashboard/pages/PlanDetail.tsx

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-api.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-ledger-schema.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-checkout-sync.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-edit-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-wp-status-sync-listener.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/dashboard/pages/MyPlan.tsx
- eden-bowls/src/pages/dashboard/pages/PlanDetail.tsx
- eden-bowls/src/pages/plan/Plan.tsx
- eden-bowls/src/pages/dashboard/pages/EditSubscription.tsx
- artefatos/documentacao-plugins-backend/04-pawbowl-stripe-billing.md
- artefatos/AUDITORIA_STRIPE_ARQUITETURA_2026-07-07.md

## Responsabilidade da rota

A rota lista as assinaturas do usuario autenticado para o dashboard.

Ela nao e uma listagem simples de pedidos WooCommerce. O backend combina duas fontes:

1. assinaturas WooCommerce do tipo `fsb_subscription` ligadas ao usuario;
2. registros legados/auxiliares da tabela `wp_hsr_stripe_subscriptions`.

Objetivo funcional:

- exibir o historico e o estado atual das assinaturas do usuario;
- sustentar a tela Meu Plano, detalhe de assinatura e fluxos de edicao/cancelamento;
- manter compatibilidade com assinaturas antigas que podem existir apenas no ledger Stripe.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /subscriptions
- Method: GET
- Callback: StripeSubscriptionApi::get_user_subscriptions
- Permission callback: StripeSubscriptionApi::require_authenticated_user

### Controller

- Verifica usuario logado
- Aplica rate limit por usuario
- Garante que WooCommerce esteja ativo
- Lista assinaturas WooCommerce do tipo `fsb_subscription`
- Complementa com assinaturas do ledger Stripe
- Retorna envelope `{ success: true, data: { subscriptions, count } }`

### Regra de acesso importante

A rota depende de usuario autenticado no WordPress, nao de session token de onboarding.

Erros comuns:

- 401 unauthorized
- 429 rate_limit
- 503 woocommerce_required

## Parametros recebidos

A rota nao recebe payload de negocio.

Entrada efetiva:

- nenhuma query obrigatoria
- nenhum body
- nenhum path param

Comportamento:

- retorna todas as assinaturas do usuario autenticado, ordenadas por data decrescente
- nao foi observado paginacao na rota atual

## Validacoes que devem existir

## 1) Validacao de autenticacao

- o usuario precisa estar logado (`get_current_user_id() > 0`)

Erro:

- `unauthorized` -> 401

## 2) Validacao de ambiente WooCommerce

- `wc_get_orders` precisa estar disponivel

Erro:

- `woocommerce_required` -> 503

## 3) Rate limit

- limite por usuario: 60 requisicoes em 300 segundos
- chaves calculadas por usuario autenticado

Erro:

- `rate_limit` -> 429

## 4) Validacao de integridade da assinatura

Na listagem principal, a assinatura so entra se o backend conseguir resolver um `stripe_subscription_id` valido.

- assinaturas sem stripe id sao ignoradas
- registros duplicados entre Woo e ledger sao deduplicados por `stripe_subscription_id`

## Fluxo da requisicao

1. GET /subscriptions chega na rota
2. controller valida usuario autenticado
3. aplica rate limit por usuario
4. verifica disponibilidade do WooCommerce
5. consulta `wc_get_orders` para `type = fsb_subscription`
6. para cada ordem, resolve o `stripe_subscription_id`
7. formata item de lista com metadados do pedido/assinatura
8. armazena ids conhecidos para evitar duplicidade
9. consulta o ledger `wp_hsr_stripe_subscriptions`
10. adiciona entradas ainda nao vistas, inclusive legadas sem order compatível
11. retorna `subscriptions` + `count`

## Estrutura de resposta

Envelope HTTP:

- success: true
- data:
  - subscriptions: DashboardSubscription[]
  - count: number

Campos retornados por item na listagem:

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

1. Dupla fonte de verdade
- a listagem agrega assinatura WooCommerce e ledger Stripe para nao perder registros legados.

2. Deduplicacao por `stripe_subscription_id`
- se a mesma assinatura aparecer nas duas fontes, a versao ja conhecida ganha e a duplicada e ignorada.

3. Ordem por recencia
- tanto as assinaturas Woo quanto os registros do ledger sao consultados por data decrescente.

4. Fallback por email no ledger
- se o ledger nao tiver `wp_user_id`, o backend tenta localizar pelo email do usuario e faz backfill do vinculo.

5. Formato orientado ao dashboard
- os campos retornados sao pensados para a tela Meu Plano e para o detalhe da assinatura, nao para um CRUD bruto.

6. Sequencia de plano
- o `plan_label` pode ser gerado como `Plan #n` quando nao ha label persistida.

7. Contrato legivel por datas humanas
- o backend entrega datas formatadas para exibição, nao timestamps crus.

8. `slug` e derivado do stripe_subscription_id
- isso sustenta rotas/links do dashboard.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_posts / wp_postmeta
- consultas WooCommerce para `type = fsb_subscription`
- leitura de metadados da order/subscription

2. wp_hsr_stripe_subscriptions
- ledger principal usado como fallback/compatibilidade legada

3. wp_hsr_stripe_customers
- nao usado diretamente nesta rota de listagem, mas influente em backfills e detalhes do ledger no ecossistema Stripe

## Queries observadas

### Query principal WooCommerce

- `wc_get_orders([ 'type' => 'fsb_subscription', 'customer_id' => currentUserId, 'status' => 'any', 'orderby' => 'date', 'order' => 'DESC', 'limit' => -1 ])`

### Query ledger principal

- `SELECT * FROM wp_hsr_stripe_subscriptions WHERE wp_user_id = %d ORDER BY updated_at DESC LIMIT 200`
- fallback por email do usuario quando `wp_user_id` e zero

### Deduplicacao

- o backend mantem um conjunto em memoria de `knownSubscriptionIds`
- cada `stripe_subscription_id` so aparece uma vez

## Custom Post Types e tipos de post/pedido

- `fsb_subscription` (tipo de order WooCommerce/Flexible Subscriptions)
- `shop_order` nao e o tipo principal desta rota

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
- metadados de periodo/agenda/frete usados pelos formatadores

No ledger Stripe:

- `stripe_subscription_id`
- `stripe_customer_id`
- `wp_user_id`
- `customer_email`
- `stripe_price_id`
- `plan_label`
- `unit_amount`
- `billing_interval`
- `plan_interval`
- `plan_interval_count`
- `plan_amount`
- `plan_currency`
- `payment_method_last4`
- `wp_order_id`
- `wp_subscription_id`
- `status`
- `current_period_end`
- `cancel_at_period_end`
- `canceled_at`

## Plugins e dependencias

1. pawbowl-stripe-billing
- endpoint REST, ledger e formatacao de assinatura

2. headless-secure-registration
- integracao complementar no checkout/onboarding e contexto de onboarding dos pets

3. WooCommerce
- armazenamento principal das assinaturas `fsb_subscription`

4. Flexible Subscriptions
- origem do tipo `fsb_subscription` e do fluxo de assinatura local

5. Stripe PHP SDK
- usado em outros endpoints do mesmo plugin, mas nao na listagem em si

## Regras de preco, moeda e pais

Esta rota nao faz calculo de preco, mas expõe valores derivadas do estado da assinatura.

- moeda: vem do pedido/ledger
- pais: nao e aplicado nesta listagem
- preco: aparece como `order_total_per_month` e, no detalhe, como `price_per_cycle` em outros endpoints

A listagem em si nao recalcula valores; apenas projeta o que ja foi persistido.

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- GET /custom/v1/subscriptions

Controller:
- StripeSubscriptionApi::get_user_subscriptions

Service:
- StripeSubscriptionApi::format_subscription_item
- StripeSubscriptionApi::format_ledger_subscription_item
- StripeSubscriptionApi::list_user_subscription_ledgers
- StripeSubscriptionApi::resolve_stripe_subscription_id

Repository/queries:
- wc_get_orders para `fsb_subscription`
- consulta SQL em `wp_hsr_stripe_subscriptions`
- fallback por email do usuario

Banco/tabelas utilizadas:
- wp_posts/wp_postmeta (assinaturas WooCommerce)
- wp_hsr_stripe_subscriptions

Regras de negocio:
- listagem combinada Woo + ledger
- deduplicacao por stripe_subscription_id
- fallback legado por email
- datas formatadas para dashboard
- ignorar assinaturas sem stripe id

Campos retornados:
- `subscriptions[]`
- `count`
- cada item com `subscription_id`, `status`, `plan_label`, `next_billing_date`, `next_shipment_date`, `pet_ids`, `pets_names`, etc.

## Node.js

Controller:
- SubscriptionsController.listMine

Service:
- SubscriptionsService.listForCurrentUser
- SubscriptionsService.mergePrimaryAndLedgerSubscriptions
- SubscriptionsService.formatDashboardSubscription

Repository:
- SubscriptionRepository.findWooSubscriptionsByUserId
- SubscriptionLedgerRepository.findByUserId
- SubscriptionLedgerRepository.findByEmailFallback

Entities/Models (TypeORM):
- SubscriptionEntity (ou OrderEntity com tipo fsb_subscription)
- SubscriptionLedgerEntity
- CustomerEntity
- OrderMetaEntity (se o modelo for normalizado por meta)

DTOs:

Entrada:
- nenhuma query obrigatoria

Saida:
- ListSubscriptionsResponseDto
  - subscriptions: DashboardSubscriptionDto[]
  - count: number

DashboardSubscriptionDto sugerido:
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
- packsPerMonth?: number | null
- orderTotalPerMonth?: number | null

Validacoes:
- usuario autenticado
- suporte ao tipo de assinatura local
- rate limit por usuario
- deduplicacao por stripeSubscriptionId
- fallback para ledger legado

## Fluxo da requisicao no Node (sugestao)

1. Controller identifica o usuario autenticado
2. Service aplica rate limit e valida disponibilidade do modulo de subscriptions
3. Repository consulta assinaturas locais do usuario
4. Repository consulta ledger Stripe para complementacao/fallback
5. Service deduplica por stripeSubscriptionId
6. Service formata datas e rótulos para o dashboard
7. Controller retorna `{ subscriptions, count }`

## Modelo de dados necessario no Node

Minimo para paridade:

1. subscriptions
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
- currency
- total_per_month

2. subscription_ledger
- stripe_subscription_id
- wp_user_id
- customer_email
- stripe_price_id
- plan_label
- status
- current_period_end
- payment_method_last4
- plan_amount
- plan_currency

3. customers/user mapping
- necessario para fallback por email e integridade de ownership

4. order/subscription meta
- se o modelo Node mantiver metadados equivalentes em entidade separada

## Possiveis problemas na migracao

1. Perder o fallback do ledger
- assinaturas antigas podem sumir do dashboard.

2. Nao deduplicar corretamente
- a mesma assinatura pode aparecer duas vezes.

3. Paginar sem manter ordenacao/sequence
- o dashboard depende da ordem cronologica e da sequencia para `Plan #n`.

4. Nao formatar datas como o WordPress
- a UI espera strings legiveis, nao timestamps crus.

5. Ignorar backfill por email
- registros antigos podem continuar sem user_id e nao aparecer no Node.

6. Mapear errado `subscription_id` versus `legacy_subscription_id`
- o front usa o Stripe subscription id como chave principal em varios fluxos.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- autentica usuario e retorna envelope padrao

2. Service central
- busca duas fontes, deduplica, formata e ordena

3. Repository dedicado
- um repositorio para subscriptions locais
- outro para ledger Stripe
- consulta eficiente por user_id e fallback por email

4. Projecao de dashboard
- manter nomes de campos e datas compatíveis com o front atual

### Testes unitarios recomendados

1. usuario nao autenticado -> 401
2. woocommerce indisponivel -> 503
3. retorna apenas assinaturas locais quando nao ha ledger
4. inclui ledger legado sem duplicar
5. fallback por email traz registro ausente de user_id
6. item sem stripe_subscription_id e ignorado
7. count corresponde ao tamanho final deduplicado
8. datas e labels formatadas corretamente

## Checklist de equivalencia

1. Endpoint GET equivalente preservado.
2. Permissao autenticada preservada.
3. Rate limit por usuario preservado.
4. Merge Woo + ledger preservado.
5. Deduplicacao por stripe_subscription_id preservada.
6. Fallback por email preservado.
7. Contrato `{ subscriptions, count }` preservado.
8. Controller sem regra de negocio.
9. TypeORM em Repository/Entity.
10. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
