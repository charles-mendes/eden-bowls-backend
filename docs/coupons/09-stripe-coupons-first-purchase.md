# Coupons Stripe (1a compra) e rotas do onboarding

Documentacao da logica **atual** de cupons Stripe no backend headless.

Escopo: desconto automatico de **primeira compra**, aplicado so na **primeira fatura mensal** da assinatura. Nao existe cupom digitado pelo cliente neste fluxo. Cupons WooCommerce nao entram nesta logica.

Plugins envolvidos:

- `pawbowl-stripe-billing` — cria/mapeia Coupon + Promotion Code na Stripe e aplica `discounts` na criacao da assinatura
- `headless-secure-registration` — decide elegibilidade no onboarding e dispara o apply no checkout

Arquivos principais:

- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-coupon-service.php`
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/hook-provider/admin/class-stripe-coupons-page.php`
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-subscription-service.php`
- `wp/wp-content/plugins/pawbowl-stripe-billing/src/class-stripe-checkout-sync.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php`

Namespace REST: `custom/v1`  
Base: `{WP_URL}/wp-json`

---

## 1) O que o sistema faz hoje

O desconto **nao** e um cupom WooCommerce e **nao** e um codigo que o front envia no checkout.

Fluxo em tres camadas:

1. **Catalogo de percentuais (WP, hardcoded)** — UI mostra 10% / 25% / 40% conforme o prazo (1 / 3 / 6 meses).
2. **Elegibilidade (WP)** — so usuario autenticado/vinculado, sem pedido previo e sem assinatura ativa/trialing.
3. **Apply real (Stripe)** — se elegivel, o checkout anexa um `promotion_code` (`promo_...`) na criacao da Subscription. A Stripe calcula o desconto na primeira invoice (`duration = once`).

A Stripe permanece a fonte de verdade do desconto cobrado. O WordPress guarda so o **mapeamento prazo → `promo_id`** e um snapshot nos metas do pedido.

Regra de negocio da tela admin (`Stripe Cupons`):

> Desconto de 1a compra aplica-se somente a primeira fatura mensal. Nos planos de 3 e 6 meses, os meses seguintes cobram o preco cheio. O percentual maior (25%/40%) e beneficio de compromisso, nao desconto sobre o valor total do contrato.

---

## 2) Modelo Stripe vs WordPress

### 2.1 Objetos Stripe

Ao criar um cupom de 1a compra (WP Admin → Stripe → Cupons), o backend chama a Stripe duas vezes:

| Objeto | Papel | Campos relevantes |
|---|---|---|
| **Coupon** (`coupons.create`) | regra de desconto | `percent_off`, `duration = once`, metadata `pawbowl_purpose=first_purchase`, `pawbowl_term_months` |
| **Promotion Code** (`promotionCodes.create`) | identificador aplicado na subscription | `code` (ex. `FIRST_1M`), `coupon` = id do cupom, `active = true`, `restrictions.first_time_transaction = true`, mesmo metadata |

O checkout **nao** envia o Coupon id. Envia o **Promotion Code id** (`promo_...`) em:

```json
{ "discounts": [ { "promotion_code": "promo_xxx" } ] }
```

### 2.2 Mapeamento no WordPress

Option: `pawbowl_stripe_first_purchase_promos`

```json
{
  "1": "promo_...",
  "3": "promo_...",
  "6": "promo_..."
}
```

So ids que comecam com `promo_` sao persistidos. Sem os tres slots, clientes **elegiveis** tem o checkout **bloqueado** (`503 first_purchase_promo_not_configured`). Clientes nao elegiveis seguem sem desconto.

Metrica de falha: option `pawbowl_stripe_first_purchase_promo_misconfig_count` (incrementada quando o slot do prazo esta vazio no checkout).

### 2.3 Tabela de percentuais (hardcoded em 3 lugares)

| `subscription_term_months` | `discount_percent` |
|---|---|
| 1 | 10 |
| 3 | 25 |
| 6 | 40 |
| qualquer outro | 0 |

Fontes (devem permanecer iguais):

- `PawBowlStripe\StripeCouponService::TERM_PERCENT_MAP`
- `HSR\OnboardingService::resolve_discount_percent_for_subscription_term`
- `HSR\CheckoutService::resolve_discount_percent_for_subscription_term`

A criacao admin recusa cupom cujo `percent_off` nao bata com essa tabela.

---

## 3) Relacao das rotas citadas

As tres rotas do front na tela `/plan` **nao aplicam** o cupom Stripe. So a terceira fala de desconto, e mesmo assim so de **elegibilidade**.

| Rota | Liga com coupon Stripe? | O que faz hoje |
|---|---|---|
| `GET .../recommendation` | **Nao** | Consumo nutricional (g/dia, kg/mes, packs). Sem preco, sem prazo, sem coupon. |
| `GET .../plan/snapshot` | **So informativo** | Devolve `plan_terms` com 10/25/40%. Nao consulta Stripe, nao valida elegibilidade, nao aplica desconto. |
| `GET .../discount/eligibility` | **Elegibilidade WP** | Diz se o usuario *pode* ganhar 1a compra. Nao devolve `promo_id` nem percentual. Nao chama Stripe. |

A aplicacao do coupon acontece depois, no checkout:

```
GET  .../plan/snapshot                 → UI dos prazos (10/25/40)
GET  .../discount/eligibility          → eligible true/false
POST .../plan/preview                  → preco cheio (desconto NAO entra)
POST .../plan-selection                → grava prazo escolhido
POST .../account-link                  → vincula usuario (habilita eligibility real)
POST .../subscription/checkout         → revalida + resolve promo_ + cria subscription Stripe com discounts
```

---

## 4) Rota a rota

Auth comum das rotas de sessao (exceto `start`): header `X-Session-Token` (fallback `Authorization: Bearer`). Sem token: `401`. Sessao inexistente: `404`.

### 4.1 `GET /onboarding/session/{session_id}/recommendation`

Handler: `OnboardingApi::get_recommendation` → `OnboardingService::get_recommendation`.

**Sem ligacao com coupons.** Calcula recomendacao nutricional por pet e monta `simplified` / `packaging`.

`plan/snapshot` chama esta rota internamente para reusar consumo. Por isso o curl de recommendation aparece na mesma tela `/plan`, mas o payload nao tem desconto.

### 4.2 `GET /onboarding/session/{session_id}/plan/snapshot`

Handler: `OnboardingApi::get_plan_snapshot` → `OnboardingService::get_plan_snapshot`.

Devolve consumo + sabores + **catalogo de prazos**. Trecho atual:

```json
"plan_terms": [
  { "subscription_term_months": 1, "discount_percent": 10 },
  { "subscription_term_months": 3, "discount_percent": 25 },
  { "subscription_term_months": 6, "discount_percent": 40 }
]
```

Esses percentuais sao constantes PHP, nao vem da Stripe. O snapshot **nao** inclui:

- `eligible` / `reason`
- `promotion_code_id`
- preco com desconto

Uso no front: desenhar os cards de 1/3/6 meses com o selo de percentual. O desconto de fato so existe se, no checkout, o usuario for elegivel **e** o slot `promo_` daquele prazo estiver mapeado.

### 4.3 `GET /onboarding/session/{session_id}/discount/eligibility`

Handler: `OnboardingApi::get_discount_eligibility` → `OnboardingService::get_discount_eligibility` → `resolve_discount_eligibility_for_session`.

Resposta HTTP 200:

```json
{
  "success": true,
  "data": {
    "validated": true,
    "eligible": true,
    "reason": null
  }
}
```

#### Como o usuario e resolvido

1. Se `is_user_logged_in()` e `get_current_user_id() > 0` → usa esse id.
2. Senao, `session.linked_user_id` (preenchido por `POST .../account-link`).
3. Senao, nao autenticado.

#### Regras

| `validated` | `eligible` | `reason` | Quando |
|---|---|---|---|
| `false` | `null` | `NOT_AUTHENTICATED` | sem login e sem `linked_user_id` |
| `true` | `false` | `HAS_PREVIOUS_PURCHASE` | existe pedido Woo do usuario com status `pending`, `on-hold`, `processing` ou `completed` (exceto o `checkout_order_id` da propria sessao) |
| `true` | `false` | `HAS_ACTIVE_SUBSCRIPTION` | existe linha em `{prefix}hsr_stripe_subscriptions` com `status IN ('active','trialing')` para o `wp_user_id` **ou** o `customer_email` |
| `true` | `true` | `null` | passou nas duas checagens |

Observacoes:

- Pedido `pending` **conta** como compra previa. Um checkout abandonado com order criada pode impedir o desconto.
- A rota **nao** consulta o mapeamento `promo_`. Um usuario elegivel ainda pode falhar no checkout se o admin nao mapeou o slot.
- A rota **nao** persiste o resultado na sessao. Persistencia acontece so no checkout (`session.discount_eligibility`).

### 4.4 `POST .../plan/preview` (nao listada, mas usada na mesma tela)

Calcula preco de catalogo (`unit_price × packs`).  
`discounted_first_month_total = subtotal`. O percentual de prazo **nao e aplicado** aqui.

Ver `06-onboarding-plan-preview.md`.

### 4.5 `POST .../plan-selection`

Mesma resolucao do preview, com persistencia. Guarda `subscription_term_months` na sessao. Nao grava `promo_id`. Nao chama Stripe.

### 4.6 `POST .../account-link`

Vincula a sessao a um WP user (`linked_user_id`). Sem isso, `discount/eligibility` fica `NOT_AUTHENTICATED` e o checkout recusa (`customer_required`).

Se `plan_selection.discount_percent` existir, copia para user meta `hsr_plan_discount_percent`. Esse campo **nao** e o percentual aplicado no Stripe; e snapshot de preferencia do plano.

### 4.7 `POST .../subscription/checkout` — ponto de apply

Handler: `OnboardingApi::subscription_checkout` → `CheckoutService::checkout`.

Passos de desconto:

1. `revalidate_discount_eligibility_for_checkout` (repete as regras da rota eligibility, sempre com `linked_user_id`).
2. Se elegivel, `applied_discount_percent` = 10/25/40 conforme o prazo; senao `0`.
3. Recalcula `catalog_pricing.discounted_first_month_total = subtotal * (1 - percent/100)` **na sessao** (preview da 1a fatura no WP; a cobranca real e da Stripe).
4. `resolve_first_purchase_promotion_for_checkout`:
   - nao elegivel ou percent `0` → `null` (checkout segue sem desconto)
   - prazo fora de 1/3/6 → `503 first_purchase_promo_not_configured`
   - slot `promo_` vazio → mesmo `503` + incrementa metrica de misconfig
5. Dois caminhos de criacao:

**A. `subscription_first`** (fluxo atual preferencial)

- Monta payload do filter `hsr_checkout_create_stripe_subscription` com `promotion_code_id`, `discount_percent`, `discount_duration = once`.
- `PawBowlStripe\Plugin` encaminha para `StripeSubscriptionService::create_subscription`.
- Stripe cria a subscription com `discounts: [{ promotion_code }]`.

**B. Order-first (Woo order + sync posterior)**

- Grava metas no pedido (`_hsr_stripe_promotion_code_id`, `_hsr_discount_applied_percent`, etc.).
- `StripeCheckoutSync` le essas metas (ou resolve o `promo_` pelo prazo) e chama `create_subscription`.
- Se percent > 0 e nao ha `promo_` mapeado, aborta o sync com `_hsr_stripe_sync_error = first_purchase_promo_not_configured`.

Nao ha campo de cupom no body do checkout. O front nao escolhe o `promo_id`.

### 4.8 Edit de assinatura (apos a 1a compra)

`StripeSubscriptionEditService` devolve sempre:

```json
"discount": {
  "eligible": false,
  "reason": "edit_no_first_purchase_promo",
  "percent": 0
}
```

Troca de plano / prazo em assinatura existente **nao** reaplica cupom de 1a compra.

### 4.9 Rotas que **nao** participam

| Rota | Motivo |
|---|---|
| `POST .../shipping/quote` | `applied_coupons: []` e campo do pacote Woo/Melhor Envio, nao cupom Stripe |
| `POST .../sales-tax/quote` | imposto US |
| `POST .../subscription/preview` | preview de imposto/assinatura, sem promotion code |
| `POST /custom/v1/create-subscription` | API Stripe billing; o apply de 1a compra entra pelo filter HSR, nao por cupom digitado nesta rota |
| REST de cupons WooCommerce | fora deste fluxo |

---

## 5) Fluxo ponta a ponta

```mermaid
sequenceDiagram
    participant Front
    participant HSR as HSR Onboarding/Checkout
    participant Opt as WP option promo map
    participant Stripe

    Front->>HSR: GET recommendation
    Note right of HSR: so nutricao

    Front->>HSR: GET plan/snapshot
    Note right of HSR: plan_terms 10/25/40 hardcoded

    Front->>HSR: GET discount/eligibility
    alt sem usuario vinculado
        HSR-->>Front: validated=false reason=NOT_AUTHENTICATED
    else tem compra ou sub ativa
        HSR-->>Front: eligible=false
    else primeira compra
        HSR-->>Front: eligible=true
    end

    Front->>HSR: POST plan-selection (term 1/3/6)
    Front->>HSR: POST account-link
    Front->>HSR: POST subscription/checkout

    HSR->>HSR: revalida elegibilidade
    alt elegivel
        HSR->>Opt: promo_id do prazo
        alt slot vazio
            HSR-->>Front: 503 first_purchase_promo_not_configured
        else mapeado
            HSR->>Stripe: subscriptions.create discounts[promotion_code]
            Stripe-->>HSR: invoice 1 com percent_off once
        end
    else nao elegivel
        HSR->>Stripe: subscriptions.create sem discounts
    end
```

---

## 6) Persistencia no pedido Woo

Metas gravados no checkout / apos create da subscription / webhooks de invoice:

| Meta | Origem | Significado |
|---|---|---|
| `_hsr_discount_eligibility` | JSON da revalidacao | `{validated, eligible, reason}` |
| `_hsr_discount_applied_percent` | WP | percentual que o WP decidiu aplicar (0 se inelegivel) |
| `_hsr_stripe_promotion_code_id` | mapeamento / Stripe | `promo_...` |
| `_hsr_stripe_coupon_id` | objeto discount da Stripe | `coupon_...` (preenchido depois do create/webhook) |
| `_hsr_stripe_discount_percent` | WP ou `coupon.percent_off` | percentual |
| `_hsr_stripe_discount_amount` | invoice `total_discount_amounts` ou subtotal − discounted | valor abatido na 1a fatura |
| `_hsr_stripe_discount_duration` | sempre `once` neste fluxo | duracao Stripe |
| `_hsr_stripe_amount_paid` | invoice | valor pago |

Admin Woo (`OrderOnboardingMetabox`) mostra Promotion Code, Coupon (link dashboard Stripe), percentual, valor abatido e duration. Tambem renderiza linha de total "Desconto Stripe (N%)".

---

## 7) Admin WP (nao e REST)

Pagina: `wp-admin/admin.php?page=pawbowl-stripe-coupons`  
Capability: `access_pawbowl_stripe`  
Classe: `PawBowlStripe\HookProvider\Admin\StripeCouponsPage`

Tres blocos:

1. **Mapeamento 1a compra** — inputs `promo_...` para slots 1m/3m/6m. Salva a option.
2. **Criar cupom de 1a compra** — cria Coupon (`duration=once`) + Promotion Code (`first_time_transaction=true`) na Stripe e opcionalmente atribui ao slot. Percentual e forçado pela tabela (nao e editavel no form).
3. **Lista** — ultimos 25 promotion codes da Stripe, com link de dashboard.

Avisos:

- mapeamento incompleto → checkout de elegiveis sera bloqueado
- contador de misconfig > 0 → falhas reais de checkout por slot vazio

Nao ha endpoint REST publico para criar/listar esses cupons. Tudo passa por esta pagina admin + Stripe API.

---

## 8) Contratos de erro ligados a coupon

| HTTP | code | Onde | Quando |
|---|---|---|---|
| 200 | — | eligibility | sempre que a sessao existe; inelegibilidade vem no body (`eligible: false`) |
| 404 | `session_not_found` | eligibility / checkout | sessao inexistente |
| 422 | `customer_required` | checkout | sem `linked_user_id` |
| 422 | `invalid_promotion_code_id` | `create_subscription` | `promotion_code_id` nao comeca com `promo_` |
| 503 | `first_purchase_promo_not_configured` | checkout / checkout-sync | usuario elegivel e slot do prazo vazio, ou prazo invalido |

Elegibilidade **nao** gera 4xx por `HAS_PREVIOUS_PURCHASE` / `HAS_ACTIVE_SUBSCRIPTION`. O front deve ler `data.eligible`.

---

## 9) O que o front precisa saber (tela `/plan`)

1. `GET recommendation` — so consumo. Ignorar para desconto.
2. `GET plan/snapshot` → `data.plan_terms[]` — rotulos 10/25/40. Nao significa que o cliente vai pagar com desconto.
3. `GET discount/eligibility` — se `validated=false`, o usuario ainda nao esta logado/vinculado; tratar como "ainda nao sabemos", nao como "sem desconto".
4. `POST plan/preview` — preco cheio. Nao usar `first_month_total` como preco com 1a compra.
5. O desconto so e cobrado na Stripe no `POST .../subscription/checkout`, e so na primeira invoice.

Exemplo eligibility (sessao ainda anonima, como os curls da tela `/plan` antes do login):

```json
{
  "success": true,
  "data": {
    "validated": false,
    "eligible": null,
    "reason": "NOT_AUTHENTICATED"
  }
}
```

Isso e o comportamento esperado daqueles curls se a sessao nao passou por `account-link` e o request nao leva cookie/JWT de usuario WP logado. O `x-session-token` autentica a **sessao de onboarding**, nao o cliente Woo.

---

## 10) Pontos de atencao

1. Percentuais duplicados em tres classes. Mudar um e esquecer os outros deixa UI, eligibility e Stripe divergentes.
2. Preview/snapshot **nao** aplicam o desconto. Qualquer UI de "voce paga X no 1o mes" precisa calcular no front com `eligible` + `plan_terms`, ou esperar o checkout.
3. `HAS_PREVIOUS_PURCHASE` inclui `wc-pending`. Orders de tentativa de checkout podem queimar a 1a compra.
4. Stripe `first_time_transaction` no Promotion Code e uma segunda barreira (lado Stripe). O WP tambem checa historico. As duas precisam estar alinhadas.
5. Edit de assinatura nunca reaplica o cupom.
6. Sem mapeamento completo, **so o cliente elegivel** e bloqueado. Cliente recorrente checkouta sem desconto normalmente.
7. Nao ha aplicacao de cupom avulso (codigo promocional livre). Qualquer cupom novo precisa ser criado na Stripe e, se for 1a compra, mapeado no slot do prazo.

---

## 11) Testes de referencia

- `wp/wp-content/plugins/headless-secure-registration/tests/unit/onboarding-service-discount-eligibility-test.php` — NOT_AUTHENTICATED, HAS_PREVIOUS_PURCHASE (inclui pending), exclusao de `checkout_order_id`, HAS_ACTIVE_SUBSCRIPTION, elegivel.
- `wp/wp-content/plugins/pawbowl-stripe-billing/tests/StripeCouponServiceMappingTest.php` — tabela 10/25/40 e health dos slots `promo_`.
