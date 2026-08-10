# Analise Tecnica - Migracao da Rota Onboarding Discount Eligibility para Node.js

## Escopo

Rota atual no WordPress:

- GET /custom/v1/onboarding/session/:sessionId/discount/eligibility

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchDiscountEligibilityFromApi)

Arquivos principais analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/tests/unit/onboarding-service-discount-eligibility-test.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-ledger-schema.php
- eden-bowls/src/pages/plan/Plan.tsx
- eden-bowls/src/services/onboardingApi.ts

Observacao:

- No pedido a rota foi indicada como GET, e isso esta correto na implementacao real.

## Responsabilidade da rota

A rota determina se o usuario da sessao de onboarding e elegivel ao desconto de primeiro pedido.

Ela retorna um estado de elegibilidade e motivo, sem calcular preco final diretamente:

- validated: boolean
- eligible: boolean | null
- reason: string | null

Essa resposta e usada no front para decidir se:

1. pode prosseguir checkout com desconto,
2. precisa bloquear temporariamente ate validar,
3. deve remover desconto por inelegibilidade.

## Endpoint, Controller e permissao

### Registro da rota

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/discount/eligibility
- Method: READABLE (GET)
- Callback: OnboardingApi::get_discount_eligibility
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai session_id
- Chama OnboardingService::get_discount_eligibility(sessionId)
- Retorna { success: true, data: result } com status 200

## Parametros recebidos

Path param:

- session_id: string (regex [A-Za-z0-9_-]+)

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body:

- nenhum

## Validacoes que devem existir

## 1) Validacoes de acesso

- session_id obrigatorio (403)
- rate limit de auth por sessao (429)
- token de sessao obrigatorio (401)
- token invalido/expirado/divergente da sessao (401/403)

## 2) Validacoes de negocio

- sessao deve existir (404)
- usuario de validacao deve ser resolvido (logado ou linked_user_id)

Importante:

- Quando usuario nao pode ser resolvido, a rota NAO retorna erro.
- Ela retorna estado funcional:
  - validated=false
  - eligible=null
  - reason=NOT_AUTHENTICATED

## Fluxo da requisicao

1. Request entra no endpoint GET /discount/eligibility.
2. Permission callback valida sessao/token.
3. Controller chama service.get_discount_eligibility.
4. Service carrega sessao no repositorio.
5. Service resolve userId para validacao:
   - prioriza usuario logado (is_user_logged_in/get_current_user_id)
   - fallback para session.linked_user_id
6. Se nao houver userId:
   - retorna validated=false, eligible=null, reason=NOT_AUTHENTICATED
7. Se houver userId:
   - verifica historico de pedidos WooCommerce
   - verifica assinatura ativa no ledger Stripe
8. Monta resposta final de elegibilidade.

## Estrutura de resposta

Sucesso 200:

{
  "success": true,
  "data": {
    "validated": true|false,
    "eligible": true|false|null,
    "reason": null|"NOT_AUTHENTICATED"|"HAS_PREVIOUS_PURCHASE"|"HAS_ACTIVE_SUBSCRIPTION"
  }
}

Semantica das reasons:

- NOT_AUTHENTICATED:
  - userId nao resolvido
  - validated=false
  - eligible=null

- HAS_PREVIOUS_PURCHASE:
  - encontrou historico de pedido elegivel na regra
  - validated=true
  - eligible=false

- HAS_ACTIVE_SUBSCRIPTION:
  - encontrou assinatura ativa/trialing no ledger
  - validated=true
  - eligible=false

- null:
  - elegivel
  - validated=true
  - eligible=true

## Regras de negocio escondidas no WordPress

1. Pedido pendente conta como compra previa
- A funcao user_has_paid_order_history considera status:
  - wc-pending
  - wc-on-hold
  - wc-processing
  - wc-completed
- Ou seja, pedido pendente ja torna inelegivel.

2. Precedencia de motivo
- HAS_PREVIOUS_PURCHASE tem prioridade sobre HAS_ACTIVE_SUBSCRIPTION.
- Se ambos forem verdadeiros, reason final fica HAS_PREVIOUS_PURCHASE.

3. Exclusao de pedido atual da sessao
- checkout_order_id da sessao e excluido na verificacao historica.
- Se o unico pedido encontrado for esse mesmo, pode continuar elegivel.

4. Validacao de assinatura por dois caminhos
- Primeiro busca por wp_user_id na tabela hsr_stripe_subscriptions.
- Se nao achar, tenta por customer_email do usuario.
- Status considerados ativos: active, trialing.

5. Estado funcional em vez de erro
- Ausencia de autenticacao nao e tratada como erro HTTP nesta rota.
- E tratada como estado de negocio pendente de validacao.

6. Rota influencia desconto no checkout, mas nao aplica desconto aqui
- A aplicacao do desconto ocorre em fluxo de checkout/revalidacao posterior.
- Esta rota apenas informa elegibilidade.

## Banco, queries e fontes de dados

## Tabelas utilizadas

1. wp_hsr_onboarding_sessions
- Leitura da sessao (session_id)
- Campos relevantes: linked_user_id, checkout_order_id

2. wp_hsr_onboarding_pets
- Nao e usada diretamente nesta rota

3. wp_hsr_stripe_subscriptions
- Consulta para assinatura ativa
- Campos relevantes:
  - wp_user_id
  - customer_email
  - status

## Queries importantes

Verificacao por userId:

SELECT 1
FROM wp_hsr_stripe_subscriptions
WHERE wp_user_id = ?
  AND status IN ('active','trialing')
LIMIT 1

Fallback por email:

SELECT 1
FROM wp_hsr_stripe_subscriptions
WHERE customer_email = ?
  AND status IN ('active','trialing')
LIMIT 1

## Dependencias e plugins

1. headless-secure-registration
- endpoint, service, repositorio e token de sessao

2. WooCommerce
- wc_get_orders para historico de pedido

3. pawbowl-stripe-billing
- schema/tabela de ledger hsr_stripe_subscriptions

4. Front-end eden-bowls
- usa contrato para habilitar/bloquear continuidade com desconto

## CPT, taxonomias e campos customizados

- Nao usa Custom Post Type nesta rota.
- Nao usa taxonomias WP nesta rota.
- Usa tabelas customizadas e campos de sessao em JSON aggregate.

## Regras de preco, moeda e pais

Esta rota nao retorna preco, moeda ou pais.

Porem, impacto indireto:

- A elegibilidade retornada controla se o desconto sera aplicado no fluxo de checkout.
- No checkout, desconto aplicado depende da elegibilidade revalidada.

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- GET /custom/v1/onboarding/session/:sessionId/discount/eligibility

Controller/Endpoint:
- OnboardingApi::get_discount_eligibility

Service:
- OnboardingService::get_discount_eligibility
- resolve_discount_eligibility_for_session
- resolve_discount_validation_user_id
- user_has_paid_order_history
- user_has_active_subscription

Repository:
- OnboardingRepository::get

Banco/tabelas utilizadas:
- wp_hsr_onboarding_sessions
- wp_hsr_stripe_subscriptions
- (via WC API) pedidos WooCommerce

Regras de negocio:
- priorizar usuario logado; fallback linked_user_id
- pending/on-hold/processing/completed contam como historico
- excluir checkout_order_id atual
- fallback de assinatura ativa por email
- priorizar reason HAS_PREVIOUS_PURCHASE

Campos retornados:
- validated
- eligible
- reason

## Node.js (proposto)

Controller:
- OnboardingDiscountEligibilityController.getEligibility

Service:
- OnboardingDiscountEligibilityService.getEligibility

Repository:
- OnboardingSessionRepository.findBySessionId
- OrderRepository.findRecentByUserWithStatuses
- StripeSubscriptionRepository.hasActiveByUserIdOrEmail

Entities/Models (TypeORM):
- OnboardingSessionEntity
- StripeSubscriptionEntity
- OrderEntity (ou adaptador para fonte de pedidos existente)
- UserEntity

DTOs:

Entrada:
- GetDiscountEligibilityParamsDto
  - sessionId: string

Saida:
- DiscountEligibilityResponseDto
  - validated: boolean
  - eligible: boolean | null
  - reason: 'NOT_AUTHENTICATED' | 'HAS_PREVIOUS_PURCHASE' | 'HAS_ACTIVE_SUBSCRIPTION' | null

Validacoes:
- auth de sessao
- sessao existente
- estado de autenticacao vs linked user
- consistencia de retorno (tipos de validated/eligible/reason)

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- linked_user_id nullable
- checkout_order_id nullable
- updated_at

2. stripe_subscriptions
- wp_user_id/user_id
- customer_email
- status
- indexes por user_id, email, status

3. orders
- user_id
- status
- order_id
- created_at

## Possiveis problemas na migracao

1. Divergencia na regra de historico de compra
- Se Node ignorar wc-pending e wc-on-hold, comportamento muda.

2. Divergencia de precedencia do reason
- Ordem atual e previous purchase antes de active subscription.

3. Fallback por email pode causar falso positivo
- Email compartilhado ou inconsistencias historicas podem marcar inelegivel.

4. Diferenca entre estado funcional e erro
- Se Node retornar 401 para NOT_AUTHENTICATED em vez de validated=false, o front atual quebra o fluxo.

5. Revalidacao no checkout
- Checkout service revalida elegibilidade e pode divergir da rota se logica for duplicada e inconsistente.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- valida params
- aciona guard de sessao
- delega totalmente ao service

2. Service
- carrega sessao
- resolve userId
- aplica regras de historico e assinatura ativa
- monta DTO de resposta

3. Repositories
- session query por sessionId
- consulta de orders por status permitidos
- consulta de assinatura ativa por userId e fallback email

4. Reuso de regra
- Extrair regra de elegibilidade para componente compartilhado
- Evita divergencia entre rota e checkout

### Testes unitarios recomendados

1. Sem usuario resolvido
- retorna validated=false, eligible=null, reason=NOT_AUTHENTICATED

2. Usuario com pedido previo
- retorna inelegivel com HAS_PREVIOUS_PURCHASE

3. Usuario com assinatura ativa e sem pedido
- retorna inelegivel com HAS_ACTIVE_SUBSCRIPTION

4. Usuario com apenas checkout_order_id atual
- permanece elegivel

5. Fallback por email
- sem match por user_id, com match por email => inelegivel

6. Precedencia de reason
- quando ambos verdadeiros, reason = HAS_PREVIOUS_PURCHASE

## Checklist de equivalencia

1. Endpoint GET equivalente preservado.
2. Auth de sessao via token preservada.
3. Semantica NOT_AUTHENTICATED como estado funcional preservada.
4. Status de pedidos usados na regra preservados.
5. Consulta de assinatura ativa por userId e email preservada.
6. Precedencia de reasons preservada.
7. Controller sem regra de negocio.
8. TypeORM em repositories/entities.
9. Nenhum uso de Prisma.

## Status desta entrega

- Analise tecnica concluida.
- Documentacao em .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
