# Analise Tecnica - Migracao da Rota Onboarding Subscription Preview para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/subscription/preview

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchSubscriptionPreview)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php
- pawbowl-wp/wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-client-factory.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/Checkout.tsx

Observacao importante:

- No pedido apareceu GET, mas o endpoint real desta rota e POST.

## Responsabilidade da rota

A rota gera uma previa de subtotal/imposto/total da assinatura via Stripe Invoice Preview com automatic tax habilitado.

Ela e usada no checkout (US) como caminho preferencial de calculo fiscal. Se falhar, o front cai para o fallback local da rota sales-tax/quote.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/subscription/preview
- Method: POST
- Callback: OnboardingApi::subscription_preview
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Extrai payload
- Chama `OnboardingService::get_subscription_preview(sessionId, payload)`
- Retorna envelope `{ success: true, data: result }` com status 200

Observacao de acesso:

- Header preferencial: `x-session-token`
- Fallback: `Authorization: Bearer <session-token>`
- Nao ha rate limit dedicado da rota; aplica-se o limitador de autenticacao da permission callback.

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body esperado:

- address:
  - country: string
  - state: string
  - postal_code: string
  - line1?: string
  - city?: string
- price_ids?: string[]

Observacao:

- `price_ids` e opcional no contrato do front.
- Se nao vier, backend tenta derivar de `session.plan_selection.catalog_pricing.line_items` (`stripe_price_id` ou `price_id`).

## Validacoes que devem existir

## 1) Validacoes de acesso

- sessao/token validos
- erros tipicos: 401/403/429

## 2) Validacoes de negocio

1. sessao existente
- erro: session_not_found
- status: 404

2. pais permitido para preview
- apenas US
- erro: preview_us_only
- status: 400

3. disponibilidade do plugin Stripe
- exige classes `PawBowlStripe\StripeClientFactory` e `PawBowlStripe\StripeSubscriptionService`
- erro: stripe_unavailable
- status: 503

4. pelo menos um price_id valido
- aceita apenas ids com prefixo `price_`
- origem: payload.price_ids ou fallback de catalog_pricing.line_items
- erro: invalid_price_id
- status: 422

5. falha de chamada Stripe Preview
- qualquer excecao na API Stripe vira erro `stripe_preview_failed`
- status: 502

## Fluxo da requisicao

1. Request entra em POST /subscription/preview
2. Permission callback valida sessao/token
3. Controller delega ao service
4. Service busca sessao
5. Service resolve endereco efetivo (payload.address com fallback em session.zipcode/session.country)
6. Service valida country US-only
7. Service valida disponibilidade de classes Stripe
8. Service resolve `price_ids`:
   - usa payload.price_ids validos, ou
   - tenta extrair de `plan_selection.catalog_pricing.line_items`
9. Service instancia `StripeSubscriptionService` e chama `preview_subscription_invoice(priceIds, previewAddress)`
10. Stripe service executa `invoices.createPreview` com `automatic_tax.enabled=true`
11. Retorna subtotal/tax/total/currency

## Estrutura de resposta

Resposta HTTP 200 (envelope):

{
  "success": true,
  "data": {
    "subtotal": 0,
    "tax": 0,
    "total": 0,
    "currency": "usd"
  }
}

Tipo front-end esperado:

- SubscriptionPreviewResponse
  - subtotal: number
  - tax: number
  - total: number
  - currency: string

Observacao:

- O retorno nao traz `session_id`.
- Currency vem em lowercase (ex.: `usd`) na implementacao Stripe atual.

## Regras de negocio escondidas no WordPress

1. Preview e US-only
- mesmo que sessao tenha outro pais, endpoint retorna erro `preview_us_only`.

2. Fallback inteligente de `price_ids`
- quando front nao envia `price_ids`, backend tenta reconstruir a lista a partir do snapshot de catalogo em sessao.

3. Saneamento rigoroso de IDs
- somente IDs com prefixo `price_` sao aceitos.

4. Quantidade fixa na previa
- Stripe preview monta items com `quantity: 1` para cada price_id enviado.

5. Automatic tax forcado no preview
- chamada Stripe usa `automatic_tax.enabled=true`.

6. Dependencia forte de plugin externo
- sem plugin/SDK/secret Stripe, endpoint nao funciona.

7. Sem persistencia de snapshot
- diferente de sales-tax/quote, esta rota nao salva resultado em `plan_selection.product_tax`.

8. Papel no fluxo de checkout
- front tenta primeiro esta rota; em falha, usa fallback local (`sales-tax/quote`).

## Banco, tabelas e consultas

## Tabelas usadas

1. wp_hsr_onboarding_sessions
- leitura da sessao para country/zipcode/plan_selection/catalog_pricing

2. wp_hsr_onboarding_pets
- nao usada

## Escrita em banco

- nao ha escrita nesta rota

## Consultas SQL

- apenas carregamento de sessao via repository (`get`)

## CPT, taxonomias e campos customizados

- Nao usa CPT nesta rota.
- Nao usa taxonomias nesta rota.
- Nao usa campos custom de post nesta rota.

## Plugins e dependencias

1. headless-secure-registration
- endpoint/controller/service/repository

2. pawbowl-stripe-billing
- `StripeClientFactory`
- `StripeSubscriptionService::preview_subscription_invoice`

3. Stripe SDK
- `StripeClient`
- `invoices.createPreview`

4. Configuracao de ambiente
- `STRIPE_SECRET_KEY` obrigatorio
- `STRIPE_API_VERSION` opcional
- `STRIPE_MAX_RETRIES` opcional

## Regras de preco, moeda e pais

1. Pais
- apenas US permitido

2. Precificacao
- subtotal/tax/total vem da previa Stripe

3. Moeda
- definida pela resposta Stripe (normalizada para lowercase)

4. Modelo fiscal
- automatic tax Stripe e a fonte da verdade nessa rota

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/subscription/preview

Controller:
- OnboardingApi::subscription_preview

Service:
- OnboardingService::get_subscription_preview
- StripeSubscriptionService::preview_subscription_invoice

Repository:
- OnboardingRepository::get

Banco/tabelas:
- wp_hsr_onboarding_sessions (leitura)

Regras de negocio:
- US-only
- fallback de price_ids via plan_selection.catalog_pricing
- filtro price_ ids
- preview Stripe com automatic_tax

Campos retornados:
- subtotal, tax, total, currency

## Node.js (proposto)

Controller:
- OnboardingSubscriptionPreviewController.preview

Service:
- OnboardingSubscriptionPreviewService.preview
- StripeInvoicePreviewService.createPreview

Repository:
- OnboardingSessionRepository.findBySessionId

Entities/Models (TypeORM):
- OnboardingSessionEntity

DTOs:

Entrada:
- SubscriptionPreviewParamsDto
  - sessionId: string
- SubscriptionPreviewRequestDto
  - address:
    - country: string
    - state: string
    - postalCode: string
    - line1?: string
    - city?: string
  - priceIds?: string[]

Saida:
- SubscriptionPreviewResponseDto
  - subtotal: number
  - tax: number
  - total: number
  - currency: string

Validacoes:
- autenticacao de sessao
- sessao existente
- country US
- priceIds validos (prefixo price_)
- fallback seguro de priceIds a partir de catalog_pricing
- tratamento de erro da API Stripe

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- country
- zipcode_json
- plan_selection_json (catalog_pricing.line_items com stripe_price_id/price_id)

Nao requer tabela adicional para persistencia da propria rota.

## Possiveis problemas na migracao

1. Divergencia no fallback de price_ids
- Se Node nao ler corretamente `catalog_pricing.line_items`, preview pode falhar com invalid_price_id.

2. Divergencia de pais
- Qualquer relaxamento da regra US-only altera comportamento esperado do front.

3. Dependencia Stripe indisponivel
- Ausencia de secret/SDK/servico pode quebrar checkout fiscal em US.

4. Semantica de erro inconsistente
- Alterar codigos/status (`preview_us_only`, `invalid_price_id`, `stripe_preview_failed`) pode quebrar handling de fallback.

5. Precisao de moeda/normalizacao
- Mudancas de formato (ex.: currency uppercase) podem afetar exibicao/consistencia.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- Node.js + TypeScript + Express
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- valida params/body
- sem regra de negocio
- delega ao service

2. Service
- carrega sessao
- resolve address efetivo
- aplica regra US-only
- resolve priceIds (payload + fallback de sessao)
- chama adapter Stripe preview
- retorna DTO

3. Repository
- leitura de sessao e campos minimos de plan_selection/zipcode

4. Adapter Stripe
- encapsula `invoices.createPreview`
- mapeia excecoes para erros de dominio

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. pais nao-US -> 400 preview_us_only
3. plugin/adapter indisponivel -> 503 stripe_unavailable
4. payload sem price_ids + fallback vazio -> 422 invalid_price_id
5. payload com ids invalidos -> 422 invalid_price_id
6. preview Stripe com sucesso -> retorna subtotal/tax/total/currency
7. erro Stripe -> 502 stripe_preview_failed
8. fallback de price_ids por catalog_pricing.line_items -> sucesso

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Sessao/token via x-session-token e fallback Bearer.
3. Regra US-only preservada.
4. Fallback de price_ids preservado.
5. Filtro de IDs `price_` preservado.
6. Chamada de preview com automatic tax preservada.
7. Sem persistencia adicional (read-only da sessao) preservada.
8. Controller sem regra de negocio.
9. TypeORM em repository/entity.
10. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
