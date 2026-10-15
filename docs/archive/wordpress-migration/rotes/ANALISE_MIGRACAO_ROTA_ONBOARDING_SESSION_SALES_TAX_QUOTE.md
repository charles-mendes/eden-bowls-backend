# Analise Tecnica - Migracao da Rota Onboarding Sales Tax Quote para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/sales-tax/quote

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (fetchSalesTaxQuote)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-product-tax-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/Checkout.tsx

Observacao importante:

- No pedido apareceu GET, mas o endpoint real e POST.

## Responsabilidade da rota

A rota calcula (ou resolve) imposto de produto para o checkout de assinatura e salva esse snapshot fiscal na sessao.

Ela e usada como fallback quando o preview Stripe de imposto nao esta disponivel no front.

Principais objetivos:

1. Retornar subtotal e imposto de produto para resumo de checkout.
2. Persistir `plan_selection.product_tax` com `quoted_at` na sessao.
3. Considerar endereco da sessao ou um endereco sobrescrito no payload.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/sales-tax/quote
- Method: POST
- Callback: OnboardingApi::get_sales_tax_quote
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Extrai payload
- Chama `OnboardingService::get_sales_tax_quote(sessionId, payload)`
- Retorna envelope `{ success: true, data: result }` em 200

Observacao de acesso:

- Header preferencial: `x-session-token`
- Fallback: `Authorization: Bearer <session-token>`
- Nao ha rate limit dedicado desta rota; aplica-se o rate limit de autenticacao da permission callback.

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body opcional:

- address?:
  - country: string
  - state: string
  - postal_code: string
  - city?: string

Observacao:

- O service aceita override de endereco via `address`; quando ausente, usa `session.zipcode`/`session.country`.
- Em override, backend tambem aceita `postcode` como alias interno de `postal_code`.

## Validacoes que devem existir

## 1) Validacoes de acesso

- sessao/token validos
- erros tipicos: 401/403/429

## 2) Validacoes de negocio

1. sessao existente
- erro: session_not_found
- status: 404

2. subtotal valido para calculo US
- se subtotal <= 0 para fluxo US sem automatic tax, erro `sales_tax_unavailable` (422, reason `missing_subtotal`)

3. endereco minimo para calculo US
- estado e postal_code obrigatorios para consulta de taxa WooCommerce (quando automatic tax desligado)
- falha gera `sales_tax_unavailable` (422, reason `missing_address`)

4. dependencia WC_Tax no fluxo US classico
- se WC_Tax indisponivel, `sales_tax_unavailable` (422, reason `wc_tax_missing`)

5. tabela de taxas WooCommerce
- sem rates / percentual zero / valor final zero resultam em `sales_tax_unavailable` (422)

6. pais nao-US
- retorna sucesso com imposto zero (nao erro)

7. US com automatic tax ligado
- retorna sucesso com imposto zero (nao falha-fechada), delegando tax real para Stripe na etapa de cobranca/preview

## Fluxo da requisicao

1. Request entra em POST /sales-tax/quote
2. Permission callback valida sessao/token
3. Controller chama service
4. Service carrega sessao
5. Service extrai `payload.address` (override opcional)
6. Service chama ProductTaxService::resolve_from_session(session, null, addressOverride)
7. ProductTaxService resolve logica por pais:
   - nao-US: retorna imposto 0
   - US + automatic tax ligado: retorna imposto 0 (com jurisdiction)
   - US + automatic tax desligado: usa WC_Tax::find_rates + calc_exclusive_tax
8. Service salva snapshot em `session.plan_selection.product_tax` com `quoted_at`
9. Service persiste sessao no repository
10. Service retorna resumo fiscal

## Estrutura de resposta

Resposta HTTP 200 (envelope):

{
  "success": true,
  "data": {
    "session_id": "string",
    "subtotal": 0,
    "product_tax": 0,
    "product_tax_percent": 0,
    "tax_jurisdiction": "string",
    "country": "string"
  }
}

Tipo usado no front:

- SalesTaxQuoteResponse
  - session_id
  - subtotal
  - product_tax
  - product_tax_percent
  - tax_jurisdiction
  - country

## Regras de negocio escondidas no WordPress

1. Rota de consulta com efeito colateral
- Apesar de parecer quote-only, ela persiste `plan_selection.product_tax` na sessao.

2. Nao-US sempre degrada para zero
- Para BR/outros paises, retorna imposto de produto 0 sem erro.

3. Modo automatic tax (feature flag)
- Com `STRIPE_US_AUTOMATIC_TAX` habilitado, US tambem retorna imposto 0 no quote local e deixa tax final para Stripe.

4. Subtotal vem da sessao
- Resolve subtotal principalmente de `plan_selection.catalog_pricing.subtotal`; fallback para cache anterior de `plan_selection.product_tax.subtotal`.

5. Erro detalhado em 422
- Quando indisponivel no fluxo US classico, retorna `sales_tax_unavailable` com metadata (`country`, `state`, `postal_code`, `reason`).

6. Logging tecnico
- Razoes de indisponibilidade sao logadas via `wc_get_logger()` com source `hsr-sales-tax`.

7. Front usa como fallback
- Checkout tenta primeiro preview Stripe; se falhar, usa esta rota para preencher imposto exibido.

## Banco, tabelas e consultas

## Tabelas usadas

1. wp_hsr_onboarding_sessions
- leitura de sessao/contexto (country/zipcode/plan_selection)
- escrita de `plan_selection_json` com bloco `product_tax`

2. wp_hsr_onboarding_pets
- sem uso funcional direto nesta rota
- pode ser regravada indiretamente pelo save aggregate do repository

## Consultas SQL

Via repository:

- SELECT sessao por session_id
- UPDATE/INSERT de sessao com `plan_selection_json`
- fluxo de save aggregate pode executar replace de pets

## CPT, taxonomias e campos customizados

- Nao usa CPT nesta rota.
- Nao usa taxonomias nesta rota.
- Nao usa campos customizados de post nesta rota.

## Plugins e dependencias

1. headless-secure-registration
- endpoint/controller/service/repository

2. WooCommerce
- dependencia no calculo US sem automatic tax:
  - WC_Tax::find_rates
  - WC_Tax::calc_exclusive_tax

3. Stripe (indireto por estrategia)
- feature flag de automatic tax altera comportamento do quote local para imposto zero

## Regras de preco, moeda e pais

1. Pais
- US: tenta calculo fiscal real (salvo automatic tax ligado)
- Nao-US: retorna imposto 0

2. Subtotal
- deriva do snapshot de plano da sessao (catalog pricing)

3. Moeda
- a rota nao retorna moeda explicitamente
- moeda e resolvida em outros pontos do checkout

4. Imposto
- retornado como `product_tax` + `product_tax_percent` + `tax_jurisdiction`

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/sales-tax/quote

Controller:
- OnboardingApi::get_sales_tax_quote

Service:
- OnboardingService::get_sales_tax_quote
- ProductTaxService::resolve_from_session
- ProductTaxService::resolve_plan_subtotal

Repository:
- OnboardingRepository::get
- OnboardingRepository::save

Banco/tabelas:
- wp_hsr_onboarding_sessions (plan_selection_json)

Regras de negocio:
- quote com persistencia de snapshot fiscal
- comportamento por pais e feature flag de automatic tax
- erro 422 detalhado em indisponibilidade US classica

Campos retornados:
- session_id
- subtotal
- product_tax
- product_tax_percent
- tax_jurisdiction
- country

## Node.js (proposto)

Controller:
- OnboardingSalesTaxQuoteController.quote

Service:
- OnboardingSalesTaxQuoteService.quote
- ProductTaxService.resolveFromSession

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.saveProductTaxSnapshot

Entities/Models (TypeORM):
- OnboardingSessionEntity

DTOs:

Entrada:
- SalesTaxQuoteParamsDto
  - sessionId: string
- SalesTaxQuoteRequestDto
  - address?:
    - country: string
    - state: string
    - postalCode: string
    - city?: string

Saida:
- SalesTaxQuoteResponseDto
  - sessionId: string
  - subtotal: number
  - productTax: number
  - productTaxPercent: number
  - taxJurisdiction: string
  - country: string

Validacoes:
- autenticacao de sessao
- sessao existente
- coerencia de address override
- subtotal disponivel para fluxo US classico
- state/postal_code para lookup de taxas US classico

## Modelo de dados necessario no Node

Minimo para paridade:

1. onboarding_sessions
- session_id PK
- country
- zipcode_json
- plan_selection_json
- updated_at

2. cache fiscal dentro de plan_selection
- product_tax.subtotal
- product_tax.product_tax
- product_tax.product_tax_percent
- product_tax.tax_jurisdiction
- product_tax.country
- product_tax.quoted_at

## Possiveis problemas na migracao

1. Divergencia de engine de taxas
- Sem regra equivalente ao WC_Tax para US, valores podem divergir.

2. Mudanca de semantica com automatic tax
- Se Node nao replicar feature flag, comportamento US pode quebrar UX (erro vs zero tax).

3. Perda de efeito colateral
- Se Node nao persistir snapshot fiscal no quote, checkout posterior pode ficar inconsistente.

4. Dependencia de subtotal de snapshot
- Se plan_selection.catalog_pricing nao existir, quote US classico falha.

5. Contrato de erro
- Front espera mensagem clara e pode tratar `sales_tax_unavailable`; alteracoes de código/status afetam fluxo.

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
- aplica address override
- resolve imposto via dominio fiscal
- persiste snapshot em plan_selection.product_tax
- retorna DTO de quote

3. Repository
- update parcial seguro de `plan_selection.product_tax`
- controle de concorrencia para nao sobrescrever snapshot recente

4. Tax adapter
- modulo isolado por estrategia:
  - US classic tax engine
  - US automatic tax flag
  - non-US zero tax

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. nao-US -> sucesso com imposto zero
3. US com automatic tax ligado -> sucesso com imposto zero
4. US sem state/postal -> 422 sales_tax_unavailable (missing_address)
5. US sem subtotal -> 422 sales_tax_unavailable (missing_subtotal)
6. US com rates validos -> imposto > 0
7. persistencia de plan_selection.product_tax apos quote
8. address override deve prevalecer sobre endereco salvo

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Sessao/token por x-session-token com fallback Bearer.
3. Contrato de resposta fiscal preservado.
4. Persistencia de product_tax snapshot preservada.
5. Semantica non-US (tax=0) preservada.
6. Semantica US automatic tax (tax=0) preservada.
7. Erro 422 sales_tax_unavailable com metadata preservado.
8. Controller sem regra de negocio.
9. TypeORM em repository/entity.
10. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
