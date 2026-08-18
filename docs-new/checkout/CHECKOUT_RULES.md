# Checkout - Regras de negocio (backend Node)

Este documento descreve as regras de negocio da tela Checkout **do ponto de vista do `eden-bowls-backend`**.

Origem da tela:

- `eden-bowls/src/pages/checkout/Checkout.tsx`
- `eden-bowls/src/pages/checkout/CHECKOUT_RULES.md` (regras de UI)
- `eden-bowls/src/services/onboardingApi.ts`
- `eden-bowls/src/services/shippingApi.ts`

Identidade: **JWT**. Nao existe sessao de onboarding, `session_id`, `x-session-token` nem `account-link`. O usuario e `request.currentUser.id`. Estado persistido mora em `onboarding_user_state` (PK `user_id`).

Rotas e contratos: [README.md](./README.md).

## 1) Escopo

O backend de checkout e responsavel por:

- validar CEP/ZIP (lookup) sem persistir
- sugerir endereco US (autocomplete) sem persistir
- gravar endereco de entrega no usuario autenticado
- gravar snapshot de frete escolhido pelo front (nao cotiza)
- cotar imposto US (sales-tax quote / subscription preview)
- listar cartoes salvos
- executar checkout de assinatura
- confirmar PaymentIntent (ACK) apos Stripe no front

O front continua responsavel por:

- paineis Address → Shipping → Payment → Order Summary
- debounce de lookup/autocomplete
- Stripe Elements (criar `payment_method_id`, `confirmCardPayment`)
- draft local (`saveLocalOnboardingCheckout`)
- totais exibidos a partir do preview da tela Plan

## 2) Pre-condicoes

Rota da pagina: `/checkout`.

Entrada esperada no front via `navigate(state)` vinda de `/plan` (contrato de UI, nao de API):

- `petSummaries`
- `grandTotal` (mensal recorrente, vem do preview)
- `firstMonthTotal` (primeiro mes, vem do preview)
- `discount` (decimal, ex. `0.5`)
- `selectedPlan` (opcional)

No Node, Place Order **nao** recebe esses campos. O checkout le `plan_selection` e eligibility do `user_id`.

Place Order no front exige:

- `paymentMethodId` preenchido
- JWT real (nao `mock-session`)

Sem JWT, as rotas de escrita respondem `401`.

## ALERTA CRITICO - FONTE DE VERDADE DE TOTAL

Esta regra e prioritaria para qualquer alteracao no checkout.

- O front exibe totais recebidos da tela Plan (`POST /api/v1/onboarding/plan/preview`).
- Preview **nao** aplica desconto de prazo no first month (ver `docs-new/Plan/ROTA_ONBOARDING_PLAN_PREVIEW.md`).
- O valor final de cobranca pertence ao back-end: `POST /api/v1/onboarding/subscription/checkout` aplica desconto de primeira compra a partir de eligibility + `plan_selection.subscription_term_months`.

Risco: o valor exibido no front pode divergir do valor cobrado.

Regra alvo:

- Antes de confirmar totais finais, o front deveria consultar uma API de preview/calculo autenticada.
- Usar no front apenas os totais retornados pelo back-end.
- `grandTotal` local e estimativa de UI, nunca fonte final de cobranca.

Checklist:

- Existe validacao de total no back-end antes do Place Order? Hoje o checkout stub **nao** recalcula catalogo real; aplica percent de 1a compra sobre `catalog_pricing` persistido.
- O total exibido em tela vem do back-end? Hoje vem do preview da Plan page, nao de uma reconsulta no checkout.
- Em caso de divergencia, a UI deve bloquear confirmacao.

## 3) Fluxo de paineis (UI) e o que o Node faz

Ordem fixa no front:

1. Address
2. Shipping
3. Payment
4. Order Summary

| Painel | Chamadas Node | Auth |
|---|---|---|
| Address (digitacao CEP) | `POST /onboarding/zipcode/lookup` | publica |
| Address (rua US) | `POST /onboarding/address/autocomplete` | publica |
| Address (Continue) | `POST /onboarding/address` | JWT |
| Shipping (cotar BR) | `POST /shipping/v1/calculate` | **nao existe no Node** (front ainda aponta para essa URL) |
| Shipping (tarifa US) | `GET /shipping/v1/settings?country=US` | **nao existe no Node** |
| Shipping (Continue) | `POST /onboarding/shipping` | JWT |
| Payment (cartoes) | `GET /onboarding/payment-methods` | JWT |
| Order Summary (imposto US) | `POST /onboarding/sales-tax/quote` e/ou `POST /onboarding/subscription/preview` | JWT |
| Place Order | `POST /onboarding/subscription/checkout` | JWT + conta ativa |
| Pos-Stripe | `POST /onboarding/payment-intent/ack` | JWT + conta ativa |

Regras de UI (bloqueio de painel, reopen) nao vivem no backend.

## 4) Persistencia

### 4.1 Draft local (so front)

`saveLocalOnboardingCheckout` grava `checkout.address` e `checkout.shipping` no browser. O Node nao le esse draft.

### 4.2 Estado autenticado (Node)

Tabela `onboarding_user_state`, PK `user_id`:

| Coluna JSON | Gravada por |
|---|---|
| `address` | `POST /onboarding/address` |
| `shipping` | `POST /onboarding/shipping` |
| `plan_selection` | `POST /onboarding/plan-selection` (tela Plan); checkout pode regravar `catalog_pricing` com first month descontado |
| `checkout_reference` | `POST /onboarding/subscription/checkout` e `POST /onboarding/payment-intent/ack` |
| `payment_reference` | coluna existe; **nenhuma rota de checkout grava hoje** |
| `recurrence` | fora deste fluxo |

Lookup, autocomplete, payment-methods, sales-tax quote e shipping/v1 **nao** gravam.

## 5) Regras de endereco

### 5.1 Deteccao de pais (lookup)

No service Node (`inferCountry`):

- `country` explicito `US` ou `BR` vence
- senao, ZIP `NNNNN` ou `NNNNN-NNNN` → US
- senao, 8 digitos → BR
- senao, vazio

O front tambem infere (5/9 digitos = US, 8+ = BR) para UX. O backend nao depende da inferencia do front se `country` vier no body.

### 5.2 Completude

- US: `^\d{5}(-\d{4})?$` ou 9 digitos
- BR: exatamente 8 digitos (so numeros apos strip)

Caracteres fora de `[0-9-\s]` → `status: invalid` (HTTP 200).

### 5.3 Campos no save (`POST /onboarding/address`)

Obrigatorios no backend:

- `country` (`US` | `BR`)
- `zipcode` (aliases `postal_code` / `postalCode`)
- `state` e `city`

Nao ha 422 para `street` / `number` / `neighborhood` vazios. O front exige number/neighborhood fora dos US; o Node persiste string vazia.

Opcionais persistidos: `street`, `number`, `neighborhood`, `complement`, `phone`, `phone_country`, `delivery_instructions`.

### 5.4 Lookup

- Publico. Sem JWT. Sem `session_id`.
- Status de negocio dentro de HTTP 200: `incomplete` | `invalid` | `found` (hoje o repository stub sempre devolve `found` apos as validacoes locais).
- **Nao persiste.** Continue chama `POST /onboarding/address`.

Estado de implementacao: ViaCEP / Zippopotam **nao** estao ligados. O stub devolve San Francisco / Market St.

### 5.5 Autocomplete

- Publico. Sem JWT.
- So US. `country != US` → `unsupported_country` (HTTP 200).
- Query com menos de 4 caracteres (pos-trim) → `incomplete`.
- **Nao persiste.**
- Default de country se ausente: `US` (nao le estado do usuario).

Estado de implementacao: Nominatim **nao** e chamado. O stub monta uma sugestao fake (`Springfield, IL 62704`).

## 6) Regras de frete

Duas etapas distintas:

1. **Cotacao** (front): BR `POST /shipping/v1/calculate` (`distance_km × per_km`); US `GET /shipping/v1/settings` (FedEx fixo). Essas rotas **nao existem** no Express. Ver [ROTA_SHIPPING_CALCULATE.md](./ROTA_SHIPPING_CALCULATE.md).
2. **Persistencia** (Node): `POST /api/v1/onboarding/shipping` grava o snapshot que o front mandou. Nao recalcula distancia, nao chama OSRM, nao valida contra settings.

Continue em Shipping exige JWT. Sem `rate_id` e sem `method_id` → `422 invalid_shipping`.

O Place Order re-sincroniza shipping (`syncShippingSelectionToApi`) antes do checkout.

## 7) Regras de pagamento

### 7.1 Cartoes salvos

`GET /api/v1/onboarding/payment-methods` exige JWT. Hoje devolve stub (`pm_123`, Visa `4242`). Nao consulta Stripe.

### 7.2 Novo cartao

Stripe Elements roda **so no front**. O Node recebe `payment_method_id` no checkout. Nao ha rota de criar payment method.

### 7.3 Conclusao da etapa Payment (UI)

Completa quando ha `selectedSavedPaymentMethod` ou Stripe devolveu um `payment_method_id`. O backend so e chamado no Place Order.

## 8) Place Order e estados de pagamento

Fluxo:

1. Front valida `paymentMethodId` + JWT.
2. Front regrava shipping.
3. `POST /api/v1/onboarding/subscription/checkout` com `billing` + `payment_method_id`.
4. Node: JWT → `assertCriticalOperationAllowed` → eligibility + cupom 1a compra → repository stub grava `checkout_reference`.
5. Se vier `stripe_client_secret` (modo `subscription_first` no stub):
   - front `retrievePaymentIntent` / `confirmCardPayment`
   - se pago, `POST /onboarding/payment-intent/ack`
6. Se ACK falhar apos pagamento confirmado, a UI mantem sucesso e deixa webhook convergir (regra de UI; **nao ha webhook Node hoje**).

Estados que a UI trata: `sync_error`, `pending_sync`, `requires_confirmation` sem client secret, `failed`, `requires_payment_method`.

Stub de checkout hoje:

- `payment_method_id` presente → `payment_state: requires_confirmation`, `has_payment_method: true`
- ausente → `requires_payment_method`
- `checkout_mode` / `flow` default `order_first` (sem `stripe_client_secret`); `subscription_first` devolve `stripe_client_secret`

O front **nao** envia `checkout_mode`. Cai no default `order_first`.

## 9) Calculos de resumo (UI, backend-first)

Na Order Summary do front:

- `subtotalDiscounted = firstMonthTotal` (state da Plan)
- `shipping` = snapshot cotado no passo Shipping
- `orderTotal = subtotalDiscounted + shipping`
- `discountPercent = discount * 100`

Nenhum desses valores e recalculado pelo Node na tela. Imposto US pode vir de sales-tax quote / subscription preview (stubs).

No Place Order, o checkout aplica `discount_applied_percent` (10/25/40 conforme prazo, se elegivel) sobre `catalog_pricing.subtotal` persistido e grava `discounted_first_month_total`. Totais do stub (`total: 29.99`, `subtotal: 25`) **nao** usam o catalogo real.

## 10) Condicao de sucesso (UI)

Pedido pago quando:

- `payment_state == paid`, ou
- `stripe_payment_intent_status` em `succeeded` | `processing` | `requires_capture`

ACK Node marca `payment_state: paid` se status for `succeeded` ou `processing`; demais status viram `pending`.

CTA de sucesso no front: `/dashboard/plans`.

## 11) Auth JWT (sem sessao)

```http
Authorization: Bearer <jwt-de-usuario>
```

Middleware (`buildBearerTokenMiddleware`):

- Path `/api/v1/*` (exceto auth publica e geo).
- Sem header: segue **sem** `currentUser`. A rota decide se isso e `401`.
- Header malformado: `403 jwt_auth_bad_auth_header`.
- JWT invalido/expirado: `403 jwt_auth_invalid_token`.
- Valido: `request.currentUser = verified.data.user`.

Rotas legado `/api/v1/onboarding/session/...` ainda sao puladas pelo middleware (compat). O checkout novo **nao** usa esse path.

Checkout e ACK extra: usuario precisa existir e nao estar em `pending` | `inactive` | `suspended` | `banned`.

## 12) Contratos (indice)

Detalhe em cada `ROTA_*.md`. Resumo do que o front chama hoje:

| Funcao front | Path Node |
|---|---|
| `lookupZipcodeInApi` | `POST /api/v1/onboarding/zipcode/lookup` |
| `autocompleteAddressInApi` | `POST /api/v1/onboarding/address/autocomplete` |
| `syncZipcodeToApi` | `POST /api/v1/onboarding/address` |
| `calculateDistanceShipping` | `POST /shipping/v1/calculate` (**gap**) |
| `fetchUsFixedShippingSettings` | `GET /shipping/v1/settings?country=US` (**gap**) |
| `syncShippingSelectionToApi` | `POST /api/v1/onboarding/shipping` |
| `fetchSalesTaxQuote` | `POST /api/v1/onboarding/sales-tax/quote` |
| `fetchSubscriptionPreview` | `POST /api/v1/onboarding/subscription/preview` |
| `fetchSavedPaymentMethods` | `GET /api/v1/onboarding/payment-methods` |
| `runSubscriptionCheckout` | `POST /api/v1/onboarding/subscription/checkout` |
| `acknowledgeSubscriptionPaymentIntent` | `POST /api/v1/onboarding/payment-intent/ack` |

## 13) Seguranca

- Stripe publishable key continua no front (`VITE_STRIPE_PUBLISHABLE_KEY`).
- Segredo Stripe / cupom: so no Node (`stripeCouponService` no checkout).
- Lookup e autocomplete publicos: rate limit global 300/min. Nao ha bucket por usuario como no WP (`onboarding_address_autocomplete` 60/300s).
- Escritas e cobranca exigem JWT de usuario, nao token de sessao anonima.

## 14) Quando atualizar este documento

Atualize quando mudar:

- paths ou payloads das rotas de checkout
- JWT vs rota publica
- colunas gravadas em `onboarding_user_state`
- regra de desconto / fonte de verdade de total
- ligacao real de ViaCEP, Nominatim, Stripe ou cotacao de frete
- fluxo ACK / PaymentIntent
- criterios de `assertCriticalOperationAllowed`
