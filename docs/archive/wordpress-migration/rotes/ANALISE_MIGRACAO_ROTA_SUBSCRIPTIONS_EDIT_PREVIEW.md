# Analise Tecnica - Migracao da Rota Subscription Edit Preview para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/subscriptions/:subscriptionId/edit/preview

Origem no front-end:

- eden-bowls/src/services/subscriptionEditApi.ts (previewSubscriptionEdit)
- eden-bowls/src/pages/dashboard/pages/EditSubscription.tsx

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-api.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-edit-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-ledger-schema.php
- eden-bowls/src/services/subscriptionEditApi.ts
- eden-bowls/src/pages/dashboard/pages/EditSubscription.tsx
- eden-bowls/src/pages/dashboard/pages/PlanDetail.tsx
- artefatos/documentacao-plugins-backend/04-pawbowl-stripe-billing.md
- artefatos/AUDITORIA_STRIPE_ARQUITETURA_2026-07-07.md

## Responsabilidade da rota

A rota gera uma previsualizacao da edicao de assinatura antes do commit.

Ela calcula:

- estado atual da assinatura;
- estado proposto com base no payload de edicao;
- hash de consistencia do estado atual (`expected_current_hash`);
- prorrata (charge/credit/none);
- subtotal/tax/total do proximo ciclo;
- informacao de elegibilidade de desconto;
- sinalizacao se ha troca de termo.

Essa rota nao persiste a alteracao final. Ela apenas valida e projeta o impacto da mudanca.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /subscriptions/(?P<subscription_id>[^/]+)/edit/preview
- Method: POST
- Callback: StripeSubscriptionApi::subscription_edit_preview
- Permission callback: StripeSubscriptionApi::require_authenticated_user

### Controller

- Verifica usuario logado
- Sanitiza `subscription_id`
- Aplica rate limit por usuario
- Carrega a assinatura local WooCommerce/Flexible Subscriptions
- Encaminha payload para `StripeSubscriptionEditService::preview`
- Retorna envelope `{ success: true, data: result }`

### Regra de acesso importante

A rota depende de usuario autenticado no WordPress.

Erros comuns:

- 401 unauthorized
- 422 invalid_subscription_id
- 404 subscription_not_found
- 409 edit_payment_pending
- 422 invalid_subscription_term
- 422 invalid_plan
- 422 expected_current_hash_required
- 409 subscription_state_changed
- 502 stripe_preview_failed
- 422 catalog_pricing_unavailable
- 422 shipping_currency_missing
- 422 shipping_amount_invalid

## Parametros recebidos

Path params:

- subscription_id: string

Body esperado pelo frontend (`SubscriptionEditPayload`):

- subscription_term_months: 1 | 3 | 6
- pets: array de configuracoes de pets
- address?: objeto de endereco
- shipping?: objeto de frete
- payment_method_id?: string
- expected_current_hash?: string (na preview nao e obrigatorio, mas a UI usa a resposta para o commit)

### Estrutura de `pets[]`

Cada item pode conter:

- pet_id?: string
- pet_name: string
- enabled: boolean
- selected_flavors: string[]
- flavor_weights: number[]

### Estrutura de `address`

- country?: string
- state?: string
- postal_code?: string
- zipCode?: string
- line1?: string
- address?: string
- city?: string
- neighborhood?: string
- complement?: string
- number?: string

### Estrutura de `shipping`

- method_id?: string
- label?: string
- cost?: number
- tax_total?: number
- total?: number

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

## 4) Validacao de elegibilidade de edicao

- assinatura cancelada nao pode ser editada
- se houver pendencia de pagamento de edicao (`_hsr_edit_payment_pending`), a preview e bloqueada

Erros:

- `subscription_not_editable` -> 422
- `edit_payment_pending` -> 409

## 5) Validacao do termo

- `subscription_term_months` precisa ser 1, 3 ou 6

Erro:

- `invalid_subscription_term` -> 422

## 6) Validacao de plano proposto

- cada pet habilitado precisa gerar ao menos um item de sabor com peso positivo
- os sabores precisam existir no catalogo
- o pack size precisa existir no catalogo de precificacao
- nao pode gerar uma lista vazia de itens de Stripe

Erros:

- `invalid_plan` -> 422
- `catalog_pricing_unavailable` -> 422

## 7) Validacao de bloqueio de pet

- um pet nao pode estar vinculado a outra assinatura ativa

Erro:

- `pet_blocked` -> 422

## 8) Validacao de hash de consistencia

- a preview gera `expected_current_hash`
- o commit usa esse hash para evitar sobrescrever uma assinatura que mudou entre preview e commit

## Fluxo da requisicao

1. POST /edit/preview chega na rota
2. controller valida usuario autenticado
3. sanitiza `subscription_id`
4. aplica rate limit por usuario
5. carrega a assinatura do usuario
6. service valida se a assinatura esta editavel
7. resolve o plano proposto com base em termo, pets, endereco e shipping
8. busca a assinatura Stripe atual com `expand` de itens
9. calcula hash do estado atual
10. calcula prorrata via Stripe
11. para endereco US, consulta preview de imposto/Invoice via service de subscription
12. retorna a projeção de estado atual e proposto

## Estrutura de resposta

Envelope HTTP:

- success: true
- data: SubscriptionEditPreviewResponse

Campos retornados:

- subscription_id
- expected_current_hash
- term_change
- current
- proposed
- proration
- next_cycle
- discount

### `current`

- subscription_term_months
- items
- address
- status

### `proposed`

- subscription_term_months
- items
- address
- plan_selection

### `proration`

- direction: charge | credit | none
- amount_due_now
- credit_applied
- currency
- line_items?

### `next_cycle`

- subtotal
- tax
- total
- currency

### `discount`

- eligible
- reason
- percent

## Regras de negocio escondidas no WordPress

1. Preview nao persiste nada
- a rota so calcula e retorna projeção.

2. `expected_current_hash`
- a UI usa esse hash para detectar mudancas concorrentes antes do commit.

3. `term_change` altera a logica de prorrata
- quando o termo muda, a simulacao precisa refletir isso.

4. `current` inclui snapshot local e estado Stripe ao mesmo tempo
- a projeção compara a ordem local com a assinatura Stripe expandida.

5. `discount` na edicao e sempre ineligivel
- a resposta fixa `eligible=false`, `reason=edit_no_first_purchase_promo`, `percent=0`.

6. Taxa de US pode ser simulada com invoice preview
- quando o endereco e US, o backend chama preview de invoice para obter subtotal/tax/total.

7. O catalogo e a fonte de verdade de items
- o plano proposto e resolvido a partir de `CMPB_Meal_Plan_Service` e catalogo de sabores.

8. O metodo de pagamento pode ser enviado na preview
- se vier `payment_method_id`, ele entra na projeção e no fluxo do commit.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_posts / wp_postmeta
- ordem/assinatura `fsb_subscription`
- metadados da assinatura, plano, endereco e itens

2. wp_hsr_stripe_subscriptions
- para resolver `stripe_subscription_id` e dados persistidos no ecossistema Stripe

3. wp_hsr_stripe_invoices
- metadados de invoice e prorrata relacionados a preview/commit

4. wp_hsr_stripe_payment_intents
- usado indiretamente na leitura do estado de pagamento quando existe pendencia

5. wp_hsr_stripe_orders
- suporte a projeção/historico do fluxo de edicao

6. catálogos de produtos/preco do plugin de meal plan
- usados para traduzir sabores e pesos em Stripe prices

## Queries observadas

### Carregamento da assinatura

- consulta de assinatura local por `stripe_subscription_id` e `customer_id`

### Stripe atual

- `subscriptions->retrieve($stripeSubscriptionId, ['expand' => ['items.data.price']])`

### Preview de taxa para US

- `preview_subscription_invoice($priceIds, [...])`

### Catalogo de precificacao

- consulta a `CMPB_Meal_Plan_Service->get_products_by_category('flavors', $country, $currency)`

## Custom Post Types e tipos de post/pedido

- `fsb_subscription`
- `shop_order` como suporte ao ecossistema

## Taxonomias

- nenhuma taxonomia usada nesta rota

## Campos personalizados relevantes

No WooCommerce/order:

- `_hsr_onboarding_plan_selection`
- `_hsr_subscription_term_months`
- `_hsr_shipping_method_id`
- `_hsr_shipping_label`
- `_hsr_shipping_cost`
- `_hsr_edit_preimage`
- `_hsr_edit_pending_plan_selection`
- `_hsr_edit_pending_term_months`
- `_hsr_edit_pending_shipping`
- `_hsr_edit_pending_invoice_id`
- `_hsr_edit_payment_pending`
- `_hsr_stripe_plan_price_id`

## Plugins e dependencias

1. pawbowl-stripe-billing
- endpoint de preview e service de edicao

2. headless-secure-registration
- fluxo de autenticacao e onboarding relacionado

3. WooCommerce
- base da assinatura local editavel

4. Flexible Subscriptions
- estrutura local da assinatura

5. Catalogo de meal plan / precificacao do plugin de produtos
- necessário para resolver itens e preco propostos

6. Stripe PHP SDK
- consulta de assinatura, prorrata e invoice preview

## Regras de preco, moeda e pais

1. Termo muda a prorrata
- `subscription_term_months` impacta o valor do proximo ciclo.

2. Pais influencia o catalogo e o imposto
- US usa preview de invoice/tax com `country`, `state`, `postal_code`, `line1` e `city`.

3. Moeda e derivada do pais ou do catalogo
- US -> USD
- BR -> BRL

4. `next_cycle` sempre retorna subtotal/tax/total/currency
- a UI usa esses valores para mostrar o impacto da edicao.

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/subscriptions/:subscriptionId/edit/preview

Controller:
- StripeSubscriptionApi::subscription_edit_preview

Service:
- StripeSubscriptionEditService::preview
- assert_editable
- resolve_proposed_plan
- build_current_hash
- preview_proration
- build_catalog_pricing
- preview_subscription_invoice

Repository/queries:
- load_user_subscription
- queries de ledger e metadados de assinatura
- lookup de catalogo de precificacao

Banco/tabelas utilizadas:
- wp_posts/wp_postmeta
- wp_hsr_stripe_subscriptions
- wp_hsr_stripe_invoices
- wp_hsr_stripe_payment_intents
- wp_hsr_stripe_orders

Regras de negocio:
- preview sem persistencia
- hash de estado atual
- prorrata Stripe
- invoice/tax preview para US
- bloqueio por edit_payment_pending
- catalog pricing por sabores/pack size

Campos retornados:
- expected_current_hash
- term_change
- current
- proposed
- proration
- next_cycle
- discount

## Node.js

Controller:
- SubscriptionsEditController.preview

Service:
- SubscriptionEditService.preview
- SubscriptionEditService.assertEditable
- SubscriptionEditService.resolveProposedPlan
- SubscriptionEditService.computeCurrentHash
- SubscriptionEditService.computeProration
- SubscriptionEditService.previewTax

Repository:
- SubscriptionRepository.findEditableSubscriptionByIdAndUser
- SubscriptionLedgerRepository.findByStripeIdAndUser
- CatalogRepository.findPricesByFlavorAndWeight
- BillingRepository.previewTaxByAddress

Entities/Models (TypeORM):
- SubscriptionEntity / OrderEntity
- SubscriptionLedgerEntity
- OrderMetaEntity
- CatalogProductEntity / CatalogPriceEntity
- InvoiceEntity
- PaymentIntentEntity

DTOs:

Entrada:
- SubscriptionEditPreviewParamsDto
  - subscriptionId: string
- SubscriptionEditPreviewRequestDto
  - subscriptionTermMonths: 1 | 3 | 6
  - pets: SubscriptionEditPetDto[]
  - address?: SubscriptionEditAddressDto
  - shipping?: SubscriptionEditShippingDto
  - paymentMethodId?: string

Saida:
- SubscriptionEditPreviewResponseDto
  - subscriptionId: string
  - expectedCurrentHash: string
  - termChange: boolean
  - current: Record<string, unknown>
  - proposed: Record<string, unknown>
  - proration: SubscriptionEditProrationDto
  - nextCycle: { subtotal: number; tax: number; total: number; currency: string }
  - discount: { eligible: boolean; reason: string | null; percent: number }

Validacoes:
- usuario autenticado
- subscriptionId valido
- assinatura editavel
- termo permitido
- pets com sabores e pesos validos
- catalogo resolvivel
- bloqueio por `edit_payment_pending`
- endereco valido para preview de imposto quando aplicavel

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe subscriptionId e payload
2. Guard valida usuario autenticado
3. Service carrega assinatura editavel do usuario
4. Service resolve o plano proposto no catalogo
5. Service busca estado atual da assinatura e do ledger
6. Service calcula hash de consistencia
7. Service simula prorrata e, se for US, preview de tax
8. Service retorna a projeção completa para UI
9. Controller responde 200 com DTO de preview

## Modelo de dados necessario no Node

Minimo para paridade:

1. subscriptions / orders
- id
- user_id
- stripe_subscription_id
- status
- subscription_term_months
- edit_payment_pending
- plan_selection_json
- shipping_json
- address_json

2. subscription_ledger
- stripe_subscription_id
- wp_user_id
- current_period_end
- status
- stripe_customer_id

3. catalog tables
- flavor/product
- variation/price
- currency/country mapping

4. invoices/payment intents
- necessario para projeção de prorrata e estado de pagamento quando aplicavel

## Possiveis problemas na migracao

1. Nao validar `expected_current_hash` no commit equivalente
- o preview precisa gerar hash consistente com o commit posterior.

2. Nao reproduzir o catalogo de precificacao
- o preview fica incoerente com o checkout real.

3. Ignorar bloqueio por `edit_payment_pending`
- permite editar assinaturas em estado inconsistente.

4. Responder sem `current` e `proposed` detalhados
- a UI de edicao depende desses blocos.

5. Nao separar prorrata de subtotal/tax total
- o front usa os dois para explicar a cobranca imediata.

6. Nao tratar US tax preview
- o valor do proximo ciclo pode divergir da experiencia atual.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- autentica, valida DTO e chama o service

2. Service central
- calcula estado atual/proposto, prorrata e impostos

3. Repositories separados
- assinatura editavel
- catalogo
- billing/tax preview

4. Projecao imutavel
- o preview precisa ser somente leitura e deterministico

### Testes unitarios recomendados

1. usuario nao autenticado -> 401
2. subscriptionId invalido -> 422
3. assinatura cancelada -> 422
4. edit_payment_pending -> 409
5. termo invalido -> 422
6. plano invalido -> 422
7. hash gerado e retornado corretamente
8. prorrata charge/credit/none calculada
9. preview tax US aplicada quando endereco e US
10. response shape compatível com o front

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Permissao autenticada preservada.
3. Rate limit por usuario preservado.
4. Bloqueio por `edit_payment_pending` preservado.
5. Hash de consistencia preservado.
6. Catalogo de plano preservado.
7. Prorrata e preview de taxa preservados.
8. Response shape de preview preservado.
9. Controller sem regra de negocio.
10. TypeORM em Repository/Entity.
11. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
