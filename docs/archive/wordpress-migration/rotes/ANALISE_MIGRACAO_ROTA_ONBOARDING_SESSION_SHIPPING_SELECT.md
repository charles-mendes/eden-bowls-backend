# Analise Tecnica - Migracao da Rota Onboarding Shipping Select para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/shipping/select

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (syncShippingSelectionToApi)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-product-tax-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/Checkout.tsx
- eden-bowls/src/pages/checkout/CHECKOUT_RULES.md

Observacao importante:

- No pedido apareceu GET, mas o endpoint real desta rota e POST.

## Responsabilidade da rota

A rota salva na sessao o frete selecionado pelo usuario e consolida um snapshot de frete dentro de plan_selection para ser usado no checkout.

Ela tambem recalcula e persiste dados de imposto de produto (`product_tax`) para manter o resumo de checkout consistente.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/shipping/select
- Method: POST
- Callback: OnboardingApi::select_shipping
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Extrai payload JSON
- Chama `OnboardingService::select_shipping(sessionId, payload)`
- Retorna envelope `{ success: true, data: result }` com status 200

Observacao:

- Nao ha rate limit dedicado para shipping/select no controller (somente o rate limit de autenticacao da permission callback).

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body (payload esperado do front):

- rate_id: string
- method_id: string
- label: string
- cost: number
- tax_total: number
- total: number
- instance_id: number
- delivery_days?: number
- transit_business_days?: number
- distance?: number
- distance_source?: string
- per_km?: number
- quoted_at?: string
- zipcode?: string

## Validacoes que devem existir

## 1) Validacoes de acesso

- sessao/token validos
- erros tipicos: 401/403/429

## 2) Validacoes de negocio (service)

1. sessao existente
- erro: session_not_found
- status: 404

2. identificador de frete
- exige ao menos um entre `rate_id` ou `method_id`
- erro: invalid_shipping
- status: 422

3. normalizacao numerica
- `cost`, `tax_total`, `total`, `instance_id`, `transit_business_days`, `distance`, `per_km` sao truncados para nao-negativo

4. prazo de entrega
- se `transit_business_days` vier 0, backend tenta inferir pelo texto de `label` (extracao de numeros em expressoes como business days / dias uteis)

5. imposto de produto
- backend recalcula `product_tax` via ProductTaxService
- se tax service falhar (ex.: US sem endereco valido/tax table), retorna erro WP_Error (tipicamente 422 `sales_tax_unavailable`)

## Fluxo da requisicao

1. Request entra em POST /shipping/select
2. Permission callback valida sessao/token
3. Controller delega para service
4. Service busca sessao no repository
5. Service sanitiza payload e aplica defaults
6. Service resolve zipcode snapshot (payload.zipcode ou fallback da sessao)
7. Service monta objeto `selection` com campos de frete e metadados (`selected_at`, `quoted_at`, `snapshot=true`)
8. Service grava `selection` em `session.plan_selection.shipping`
9. Service resolve e grava `session.plan_selection.product_tax`
10. Service salva sessao no repository
11. Service retorna payload de confirmacao com shipping + impostos

## Estrutura de resposta

Resposta HTTP 200 com envelope:

{
  "success": true,
  "data": {
    "session_id": "string",
    "shipping": {
      "rate_id": "string",
      "method_id": "string",
      "instance_id": 0,
      "label": "string",
      "cost": 0,
      "tax_total": 0,
      "total": 0,
      "transit_business_days": 0,
      "delivery_days": 0,
      "delivery_days_min": 0,
      "delivery_days_max": 0,
      "estimate_label": "string",
      "selected_at": "ISO datetime",
      "quoted_at": "ISO datetime",
      "distance": 0,
      "distance_source": "string",
      "per_km": 0,
      "zipcode": "string",
      "snapshot": true
    },
    "subtotal": 0,
    "product_tax": 0,
    "product_tax_percent": 0,
    "tax_jurisdiction": "string"
  }
}

Observacao de consumo front:

- O front atual trata essa chamada como `Promise<void>` e usa apenas sucesso/erro HTTP.
- Mesmo assim, o backend retorna payload rico que pode ser aproveitado no Node para observabilidade e UI futura.

## Regras de negocio escondidas no WordPress

1. Rota de persistencia com efeito fiscal
- Nao apenas salva shipping; ela recalcula e persiste `product_tax` em `plan_selection`.

2. Snapshot de zipcode no shipping
- `shipping.zipcode` usa payload.zipcode; se ausente, cai para `session.zipcode.postal_code|zipcode`.

3. Parsing de prazo pelo label
- `delivery_days_min/max` pode ser inferido do texto do label quando nao vem transit time explicito.

4. Snapshot imutavel por evento
- registra `selected_at`, `quoted_at` e `snapshot=true` para rastreabilidade.

5. Ausencia de reconciliacao server-side com quote anterior
- custo/taxa/total enviados pelo cliente sao aceitos apos sanitizacao.
- nao ha validacao de integridade contra uma cotacao armazenada.

6. Dependencia indireta do checkout
- checkout falha com `session_incomplete` se `plan_selection.shipping` nao existir quando a sessao exige frete.

## Banco, tabelas e consultas

## Tabelas usadas

1. wp_hsr_onboarding_sessions
- leitura da sessao
- escrita do JSON `plan_selection_json` com `shipping` e `product_tax`

2. wp_hsr_onboarding_pets
- pode ser regravada indiretamente quando repository.save() executa replace_pets (mesmo sem alteracao de pets)

## Persistencia real

- Nao existe tabela dedicada de shipping selection.
- Tudo fica serializado em `plan_selection_json` dentro da sessao.

## Consultas SQL

Via repository:

- SELECT sessao por session_id
- UPDATE/INSERT em `wp_hsr_onboarding_sessions`
- DELETE + INSERT de pets em `wp_hsr_onboarding_pets` dentro de save

## CPT, taxonomias e campos customizados

- Nao usa CPT nesta rota.
- Nao usa taxonomias nesta rota.
- Nao usa ACF/campos custom de post nesta rota.

Observacao:

- Em etapas seguintes (checkout), os dados de shipping sao refletidos em metadados de pedido WooCommerce (`_hsr_shipping_*`, `_hsr_product_tax*`).

## Plugins e dependencias

1. headless-secure-registration
- endpoint/controller/service/repository

2. WooCommerce
- usado indiretamente via ProductTaxService (`WC_Tax`) para imposto de produto US quando automatic tax nao esta ligado

3. Integracao de shipping quote previa
- selection geralmente vem da rota de quote (BR distancia dinamica, US tarifa fixa), mas select nao verifica origem/assinatura da cotacao

## Regras de preco, moeda e pais

1. Frete
- `cost`, `tax_total`, `total` sao persistidos conforme payload do cliente (com clamp para >=0)

2. Imposto de produto
- recalculado server-side via ProductTaxService
- US pode exigir estado/zipcode e tabela de taxes
- BR e outros paises retornam imposto de produto zerado

3. Moeda
- select_shipping nao grava moeda explicitamente no snapshot
- moeda e inferida posteriormente no checkout (catalogo/zipcode/country)

4. Pais
- influencia diretamente calculo de imposto no ProductTaxService

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/shipping/select

Controller:
- OnboardingApi::select_shipping

Service:
- OnboardingService::select_shipping
- extract_business_days_range_from_label

Repository:
- OnboardingRepository::get
- OnboardingRepository::save

Banco/tabelas:
- wp_hsr_onboarding_sessions (plan_selection_json)
- wp_hsr_onboarding_pets (efeito colateral de save)

Regras de negocio:
- session obrigatoria
- rate_id ou method_id obrigatorio
- normalizacao dos numeros
- parsing opcional de prazo via label
- persistencia de shipping + product_tax

Campos retornados:
- session_id
- shipping (snapshot detalhado)
- subtotal
- product_tax
- product_tax_percent
- tax_jurisdiction

## Node.js (proposto)

Controller:
- OnboardingShippingSelectController.select

Service:
- OnboardingShippingSelectService.select
- ShippingTransitParserService.extractRangeFromLabel
- ProductTaxDomainService.resolveFromSession

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.savePlanSelectionShippingSnapshot

Entities/Models (TypeORM):
- OnboardingSessionEntity
- (opcional) OnboardingPetEntity se o mesmo aggregate save for mantido

DTOs:

Entrada:
- ShippingSelectParamsDto
  - sessionId: string
- ShippingSelectRequestDto
  - rateId?: string
  - methodId?: string
  - label?: string
  - cost?: number
  - taxTotal?: number
  - total?: number
  - instanceId?: number
  - deliveryDays?: number
  - transitBusinessDays?: number
  - distance?: number
  - distanceSource?: string
  - perKm?: number
  - quotedAt?: string
  - zipcode?: string

Saida:
- ShippingSelectResponseDto
  - sessionId: string
  - shipping: ShippingSelectionSnapshotDto
  - subtotal: number
  - productTax: number
  - productTaxPercent: number
  - taxJurisdiction: string

Validacoes:
- autenticacao de sessao
- sessao existente
- rateId ou methodId
- limites e tipos numericos
- validacao de consistencia opcional contra quote assinada (recomendado)

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- country
- zipcode_json
- plan_selection_json (com subchaves shipping e product_tax)
- updated_at

2. onboarding_pets
- mantido se aggregate de sessao continuar equivalente ao modelo atual

3. (recomendado para robustez)
- tabela de quotes assinadas/temporarias por sessao para validar integridade no select

## Possiveis problemas na migracao

1. Confianca excessiva em payload do cliente
- Sem reconciliar com quote anterior, cliente pode manipular custo/taxa/total.

2. Divergencia no tax service
- Mudancas na regra US/automatic tax podem alterar `product_tax` e quebrar paridade.

3. Parsing de label inconsistente
- Inferencia de delivery range por texto e fragil a i18n e formatos variados.

4. Persistencia de aggregate monolitico
- Regravar JSON completo aumenta risco de concorrencia e overwrite.

5. Dependencia de shipping para checkout
- Se snapshot nao for salvo com consistencia, checkout falha com `session_incomplete`.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- Node.js + TypeScript + Express
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- valida params/body
- nao contem regra de negocio
- delega ao service

2. Service
- carrega sessao
- aplica validacoes de dominio
- normaliza payload
- reconcilia opcionalmente com quote salva
- resolve tax e persiste snapshot em transacao

3. Repository
- update parcial de `plan_selection.shipping` e `plan_selection.product_tax`
- lock otimista/pessimista para evitar corrida entre selecoes

4. Tax adapter
- encapsular regra US/BR e fallbacks sem dependencias de WP

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. rateId e methodId vazios -> 422 invalid_shipping
3. clamp de valores negativos para zero
4. fallback de zipcode para session.zipcode
5. parse de delivery range pelo label
6. tax service com erro -> propagacao de erro
7. persistencia de shipping e product_tax em plan_selection
8. regressao: checkout precondition reconhece shipping salvo

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Sessao/token via x-session-token e fallback Bearer.
3. Validacao rate_id ou method_id preservada.
4. Snapshot shipping com timestamps e range preservado.
5. Recalculo de product_tax no ato da selecao preservado.
6. Persistencia em plan_selection (aggregate) preservada.
7. Controller sem regra de negocio.
8. TypeORM em repository/entity.
9. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
