# POST `/onboarding/session/{session_id}/payment-intent/ack`

Documentacao da logica **atual** do acknowledge de PaymentIntent no onboarding.

Escopo: o front, depois de `confirmPayment` / `retrievePaymentIntent` no Stripe.js, informa ao WP o `payment_intent_id` + `payment_intent_status`. A rota **persiste** esse status localmente (meta do pedido Woo **ou** `session.stripe_checkout`) e devolve um `payment_state` para a UI. **Nao confirma** pagamento na Stripe, **nao cobra**, **nao muda** status Woo (`pending` → `processing`), **nao chama** `payment_complete`, **nao materializa** assinatura Flexible. Fonte de verdade de cobranca continua sendo o webhook (`invoice.paid` / `payment_intent.*`).

Plugin de entrada: `headless-secure-registration`.  
WooCommerce: obrigatorio (`wc_get_order`); se ausente → 503, inclusive no fluxo sem pedido.  
Plugin de billing `pawbowl-stripe-billing`: **nao e chamado** por esta rota (so escreveu o PI no checkout anterior e continua via webhook em paralelo).

Arquivos principais:

- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php` (`payment_intent_ack`, `require_linked_user_session_access`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-checkout-service.php` (`acknowledge_payment_intent`, `acknowledge_payment_intent_without_order`, `resolve_payment_state`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php` (`stripe_checkout_json`)
- `wp/wp-content/plugins/headless-secure-registration/src/class-rate-limiter.php`
- `wp/wp-content/plugins/headless-secure-registration/src/class-plugin.php`
- contexto anterior (nao e esta rota): `CheckoutService::checkout` / `checkout_subscription_first`
- contexto posterior (webhook, nao e esta rota): `PawBowlStripe\StripeSubscriptionService` (`payment_intent.*`, `invoice.paid` → `hsr_stripe_invoice_paid_confirmed`)

Nao ha teste unitario nem smoke dedicado desta rota. Aparece na auditoria Stripe (`artefatos/AUDITORIA_STRIPE_ARQUITETURA_2026-07-07.md`) e na lista sugerida Node (`artefatos/migracao-node-reverse-engineering/08-endpoints-rest-sugeridos.md` item 21). Nao aparece no Swagger (`artefatos/swagger-pawbowl.yaml`).

Namespace REST: `custom/v1`  
Base: `{WP_URL}/wp-json`

---

## 1) Identidade da rota

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/payment-intent/ack
```

| Item | Valor |
|---|---|
| Namespace WP | `custom/v1` |
| Metodo | `POST` (`WP_REST_Server::CREATABLE`) |
| Path param | `session_id` — regex `[A-Za-z0-9_-]+` |
| Permission | `OnboardingApi::require_linked_user_session_access` |
| Handler | `OnboardingApi::payment_intent_ack` |
| Servico | `CheckoutService::acknowledge_payment_intent` |
| Validator | nenhum (`RequestValidator` nao e usado; sem `args` no `register_rest_route`) |
| Rate limit proprio | nenhum (so o de auth no permission_callback) |
| Registro | `add_action('rest_api_init', [OnboardingApi, 'register_routes'])` |

Objetivo: ecoar para o backend o resultado do Payment Element (3DS ok, processing, cartao recusado, canceled) **sem** round-trip Stripe no servidor, para o front poder transicionar UI (`paid` / `failed` / `requires_confirmation`) antes do webhook chegar.

Nao confundir com:

- `POST .../subscription/checkout` — cria pedido e/ou Subscription Stripe; devolve `stripe_client_secret` + `payment_intent_id`. **Esta rota vem depois.**
- `POST /custom/v1/stripe-webhook` — Stripe avisa `payment_intent.succeeded` / `invoice.paid`. E quem de fato marca cobranca e dispara `hsr_stripe_invoice_paid_confirmed`.
- `POST /custom/v1/create-subscription` — API admin/legado de billing; outro contrato.
- `GET .../payment-methods` — lista PMs do customer; mesma permission, outro handler.
- `StripeSubscriptionService::reconcile_order_payment_intent_status` — **retrieve** real do PI na Stripe; usado no checkout/reuse, **nao** no ack.

Dois ramos internos (escolha pelo `session.checkout_order_id`):

| Ramo | Quando | Persistencia |
|---|---|---|
| Com pedido | `checkout_order_id > 0` e `wc_get_order` devolve `WC_Order` | meta do pedido Woo |
| Sem pedido (`subscription_first`) | `checkout_order_id` vazio/0 | `session.stripe_checkout` (SQL `stripe_checkout_json`) |

---

## 2) Fluxo completo

```mermaid
sequenceDiagram
    participant Front
    participant StripeJS as Stripe.js (browser)
    participant WP as OnboardingApi
    participant RL as RateLimiter (transients)
    participant Svc as OnboardingService
    participant Ck as CheckoutService
    participant Repo as OnboardingRepository
    participant SQL as wp_hsr_onboarding_sessions
    participant Woo as WC_Order meta
    participant Log as wc_get_logger

    Front->>StripeJS: confirmPayment / retrievePaymentIntent
    StripeJS-->>Front: { id: pi_..., status }
    Front->>WP: POST .../payment-intent/ack + JWT
    Note over WP: permission_callback (sem X-Session-Token)
    WP->>RL: consume onboarding_auth (300 / 300s)
    alt estouro auth
        WP-->>Front: 429 rate_limit
    end
    alt usuario nao logado
        WP-->>Front: 401 unauthorized
    end
    WP->>Svc: get_session(sessionId)
    alt sessao inexistente
        WP-->>Front: 404 session_not_found
    end
    alt linked_user_id != current_user
        WP-->>Front: 403 session_forbidden
    end

    Note over WP: callback payment_intent_ack
    WP->>Ck: acknowledge_payment_intent(sessionId, payload)
    Ck->>Repo: get(sessionId)
    alt Woo inativo
        Ck-->>Front: 503 woocommerce_required
    end
    alt PI id/status invalidos
        Ck-->>Front: 422
    end

    alt checkout_order_id > 0
        Ck->>Woo: wc_get_order
        alt pedido sumiu
            Ck-->>Front: 404 checkout_order_not_found
        end
        alt PI ja gravado e diferente
            Ck-->>Front: 409 payment_intent_mismatch
        end
        Ck->>Woo: update_meta PI id/status; limpa client_secret se settled
        Ck->>Woo: order.save()
        Ck->>Log: info hsr.payment_intent_ack
        Ck-->>Front: 200 { acked, order_id, payment_state, ... }
    else sem pedido
        alt stripe_checkout vazio
            Ck-->>Front: 422 checkout_order_not_found
        end
        alt PI ja gravado e diferente
            Ck-->>Front: 409 payment_intent_mismatch
        end
        Ck->>Repo: save(stripe_checkout)
        Repo->>SQL: UPDATE stripe_checkout_json + updated_at
        Repo->>SQL: DELETE+INSERT pets
        Ck-->>Front: 200 { acked, order_id:0, stripe_subscription_id, ... }
    end

    Note over Front: webhook Stripe segue em paralelo (nao e esta rota)
```

### 2.1 Camada REST (`OnboardingApi::payment_intent_ack`)

1. Sanitiza `session_id` com `sanitize_text_field`.
2. Extrai body via `extract_payload`:
   - `get_json_params()` se array **nao vazio**;
   - senao `get_body_params()` (form-urlencoded).
   - `{}` vazio cai no form body (em PHP `empty([])` e true). Sem body, payload = `[]`.
3. Chama `CheckoutService::acknowledge_payment_intent`.
4. Se `WP_Error` → devolve o erro (status no `data.status`; sem envelope `success`).
5. Senao → HTTP `200` com `{ success: true, data: <resultado> }`.

O `data` **nao** e a sessao. E um envelope curto (`acked: true` + ids/status/`payment_state`). Shape **difere** entre os dois ramos (ver 4.2 vs 4.3).

Nao ha rate limit especifico. So o bucket `onboarding_auth` do permission_callback.

Nao ha validacao de schema REST. Campos extras no JSON sao ignorados (`client_secret`, `payment_method_id`, `checkout_mode`, etc. nao entram).

### 2.2 Autenticacao (`require_linked_user_session_access`)

Roda **antes** do callback. **Nao** usa `SessionTokenService`. `X-Session-Token` e ignorado nesta rota (diferente de zipcode/shipping/preview).

Ordem:

1. `session_id` vazio → HTTP `403` (`session_forbidden`).
2. Rate limit de auth por sessao:
   - chave: `onboarding_auth`
   - default: `300` tentativas / `300` s
   - env: `HSR_ONBOARDING_AUTH_RATE_LIMIT_MAX`, `HSR_ONBOARDING_AUTH_RATE_LIMIT_WINDOW`
   - filters: `hsr/onboarding_rate_limit_max`, `hsr/onboarding_rate_limit_window`
   - janela efetiva no limiter: `max(60, window)`; tentativas: `max(1, max)`
   - estouro → HTTP `429` (`rate_limit`)
3. Usuario WP:
   - `is_user_logged_in() === false` → HTTP `401` (`unauthorized`, message `Authentication is required.`)
   - headless tipico: `Authorization: Bearer {JWT}` processado pelo plugin JWT do WP (`jwt-auth/v1`), que popula `get_current_user_id()`. Cookie + nonce `X-WP-Nonce` tambem vale.
   - o JWT de sessao de onboarding (`session_token` do `POST .../session/start`) **nao** autentica esta rota.
4. Sessao: `OnboardingService::get_session` → `repository->get`. Inexistente → HTTP `404` (`session_not_found`). Este `get` ja pode migrar transient legado (ver 6.2).
5. Vinculo: `linked_user_id` da sessao deve ser `> 0` **e** igual a `get_current_user_id()`. Senao → HTTP `403` (`session_forbidden`).

Nao revalida `ActivationService::STATUS_ACTIVE` (o checkout sim, com `customer_inactive` 403). Conta pending e bloqueada no login (`Plugin::block_pending_users`), nao aqui.

Pre-requisito de negocio: `POST .../account-link` (permission `require_authenticated_session_access`: JWT **e** session token) precisa ter gravado `linked_user_id`. Sem link, ack e 403 mesmo com JWT valido.

CORS: `Plugin::allow_rest_cors_headers` adiciona `x-session-token` em `rest_allowed_cors_headers` (irrelevante para esta permission).

### 2.3 Validacoes de negocio (`acknowledge_payment_intent`)

Falha e `WP_Error` (nao envelope `success: true`). Ordem efetiva:

| # | Regra | HTTP | `code` | Dominio i18n |
|---|---|---|---|---|
| 1 | `wc_get_order` inexistente (Woo off) | 503 | `woocommerce_required` | `headless-secure-registration` |
| 2 | Sessao inexistente (2a leitura no servico) | 404 | `session_not_found` | idem |
| 3 | `payment_intent_id` vazio ou sem prefixo `pi_` no **inicio** | 422 | `invalid_payment_intent_id` | idem |
| 4 | `payment_intent_status` vazio ou fora da whitelist | 422 | `invalid_payment_intent_status` | idem |
| 5a | Com pedido: `wc_get_order` nao devolve `WC_Order` | 404 | `checkout_order_not_found` | idem |
| 5b | Sem pedido: `session.stripe_checkout` vazio | 422 | `checkout_order_not_found` | idem (HTTP **diferente** do 5a; mesma `code`) |
| 6a | Com pedido: meta `_hsr_stripe_payment_intent_id` ja preenchida e != body | 409 | `payment_intent_mismatch` | message "...checkout order." |
| 6b | Sem pedido: `stripe_checkout.stripe_payment_intent_id` ja preenchida e != body | 409 | `payment_intent_mismatch` | message "...checkout session." |

Aliases de body (primeiro que existir):

```
payment_intent_id     ?? paymentIntentId
payment_intent_status ?? paymentIntentStatus
```

Ambos passam por `sanitize_text_field` (trim, strip tags). Prefix gate: `strpos($id, 'pi_') === 0`. `seti_...` (SetupIntent), `in_...`, `pi` sem underscore → 422. A string `"pi_"` sozinha **passa** o prefixo.

Whitelist de status (igualdade estrita, **sem** mapear aliases Stripe antigos):

```
succeeded
processing
requires_capture
requires_payment_method
requires_action
requires_confirmation
canceled
```

Fora da lista (`incomplete`, `requires_source`, `cancelled` com dois L, status de Subscription): 422.

**Nao valida:**

- se o PI existe na Stripe / pertence ao customer do usuario;
- se o `status` bate com o retrieve real (confia 100% no front);
- se `POST .../subscription/checkout` rodou com sucesso alem de exigir pedido **ou** `stripe_checkout`;
- `client_secret` no body;
- idempotency key;
- monotonicidade (ack `requires_action` **depois** de um webhook `succeeded` **sobrescreve** o status);
- account activation;
- pets / plan / zipcode (nao reusa `validate_session_for_checkout`).

### 2.4 Ramo com pedido (order-first)

Condicao: `(int) session.checkout_order_id > 0`.

1. `wc_get_order($orderId)`. Falha → 404 (nao cai no ramo sem pedido).
2. Le `_hsr_stripe_payment_intent_id`. Se nao-vazio e diferente do body → 409. Se vazio, **aceita qualquer** `pi_*` (sync de checkout pode nao ter gravado o id ainda).
3. Grava:
   - `_hsr_stripe_payment_intent_id`
   - `_hsr_stripe_payment_intent_status`
   - se status ∈ `{succeeded, processing, requires_capture}`: `_hsr_stripe_client_secret` = `''` (string vazia, nao delete)
4. `$order->save()`.
5. Rele meta para montar `payment_state` via `resolve_payment_state` (ver 2.6).
6. Log Woo `info` (`source: hsr.payment_intent_ack`). Falha de logger e swallow.
7. **Nao** chama `repository->save`. Sessao (`updated_at`, `stripe_checkout_json`) **nao muda**.

Nao altera: status Woo, totais, `_hsr_stripe_subscription_id`, `_hsr_stripe_sync_error`, `_hsr_payment_method_id`.

### 2.5 Ramo sem pedido (`subscription_first`)

Condicao: `checkout_order_id` ausente/0. Caminho de `checkout_subscription_first` (body de checkout com `checkout_mode`/`flow` = `subscription_first`), que gravou `session.stripe_checkout` e deixou `order_id: 0`.

1. Exige `stripe_checkout` array nao-vazio. Senao 422 `checkout_order_not_found` (pedido nunca existiu; HTTP 422, nao 404).
2. Match de PI contra `stripe_checkout.stripe_payment_intent_id` (mesma regra 409).
3. Atualiza no array:
   - `stripe_payment_intent_id`
   - `stripe_payment_intent_status`
   - se status settled (`succeeded` / `processing` / `requires_capture`):
     - `stripe_client_secret` = `''`
     - `payment_state` = `'paid'` (hardcoded; **nao** chama `resolve_payment_state`)
4. `session.stripe_checkout = $stripeCheckout`; `repository->save($session)`.
5. Response inclui `stripe_subscription_id` copiado do snapshot. `order_id` sempre `0`.
6. **Nao** loga no Woo logger.

Se o status **nao** e settled (`requires_action`, `canceled`, `requires_payment_method`, ...): `payment_state` no JSON **nao e atualizado**. A response usa `$stripeCheckout['payment_state'] ?? 'requires_confirmation'` — tipicamente permanece `requires_confirmation` gravado no checkout, **mesmo** com cartao recusado. Divergencia vs ramo com pedido (`requires_payment_method` → `failed`).

`GET .../session/{id}` (`present_session`) **nao** devolve `stripe_checkout`. O front so ve o estado via response deste POST (ou relendo checkout).

### 2.6 `resolve_payment_state` (so ramo com pedido)

Primeira regra que casar:

| # | Condicao | `payment_state` |
|---|---|---|
| 1 | status Woo ∈ `{processing, completed}` | `paid` |
| 2 | `_hsr_stripe_sync_error` nao-vazio | `sync_error` |
| 3 | PI status ∈ `{succeeded, processing, requires_capture}` | `paid` |
| 4 | PI status = `requires_payment_method` | `failed` |
| 5 | `_hsr_stripe_client_secret` nao-vazio | `requires_confirmation` |
| 6 | tem `_hsr_stripe_subscription_id` **e** `_hsr_payment_method_id` | `requires_confirmation` |
| 7 | so tem payment method | `pending_sync` |
| 8 | senao | `pending_payment_method` |

`canceled` e `requires_action` **nao** tem case proprio. Com client_secret ainda preenchido (ack **nao** limpa nesses status) cai na regra 5 → `requires_confirmation`. Ack `canceled` **nao** vira um state `canceled`.

Regra 2 e **antes** da 3: se o pedido ficou com `_hsr_stripe_sync_error` de um sync antigo **e** o front acka `succeeded`, a response ainda e `sync_error`, nao `paid`. O meta do PI e gravado mesmo assim.

### 2.7 Persistencia

Ver tabelas na secao 6. Resumo:

- Com pedido: so order meta + log. Sem `updated_at` da sessao.
- Sem pedido: `stripe_checkout_json` + `updated_at` + rewrite de pets + transient `hsr_onb_*`.
- Excecao: `get()` no permission/servico ainda promove transient legado para SQL **antes** das validacoes de PI.

---

## 3) Chamadas a backend / servicos externos

**Esta rota nao faz HTTP de saida.** Nao chama Stripe (`paymentIntents.retrieve` / `confirm`), nao chama PawBowl, ViaCEP, OSRM, meal-plan catalog. O status e o relatado pelo browser.

O SDK Stripe **nao** e instanciado. `STRIPE_SECRET_KEY` **nao** e lido. Plugin `pawbowl-stripe-billing` **nao** precisa estar ativo para o ack responder 200 (Woo sim).

Servicos "internos" tocados:

| Alvo | Tipo | Papel |
|---|---|---|
| `{prefix}hsr_onboarding_sessions` | MySQL | SELECT; UPDATE so no ramo sem pedido |
| `{prefix}hsr_onboarding_pets` | MySQL | DELETE+INSERT so no `save()` do ramo sem pedido |
| Woo order / HPOS meta | MySQL | ramo com pedido |
| Transient `hsr_rl_*` | object cache / options | rate limit auth |
| Transient `hsr_onb_{sessionId}` | object cache / options | rewrite no `save()`; migrate no `get()` |
| `wc_get_logger()` | Woo logs | so ramo com pedido |

### 3.1 O que o front ja chamou (Stripe.js, fora do WP)

Nao e o PHP, mas e o contrato que o ack espera. Depois de `POST .../subscription/checkout` devolver `stripe_client_secret` + `stripe_payment_intent_id`:

```
stripe.confirmPayment({ clientSecret, elements, redirect: 'if_required' })
  ou
stripe.retrievePaymentIntent(clientSecret)
```

Resposta tipica do Stripe.js (objeto PaymentIntent):

```json
{
  "id": "pi_3ABC...",
  "status": "succeeded",
  "client_secret": "pi_3ABC..._secret_xyz"
}
```

O PHP **nao** recebe nem valida `client_secret`. So `id` + `status` no POST de ack.

### 3.2 Chamadas Stripe que **nao** sao desta rota (contexto)

Para nao copiar no Node um retrieve que o PHP nao faz, e para nao omitir o que falta:

| Momento | Servico | Endpoint Stripe | Quem |
|---|---|---|---|
| Checkout order-first | `StripeSubscriptionService::create_subscription` | `POST /v1/subscriptions` (expande `latest_invoice.payment_intent`) | `hsr_checkout_order_ready_for_stripe_sync` |
| Checkout `subscription_first` | mesmo servico via filter `hsr_checkout_create_stripe_subscription` | idem | `pawbowl-stripe-billing` `class-plugin.php` |
| Reconcile no create/reuse | `reconcile_order_payment_intent_status` | `GET /v1/payment_intents/{id}` | billing, **nao** ack |
| Pos-pagamento | webhook `POST /custom/v1/stripe-webhook` | Stripe → WP (`payment_intent.succeeded` / `invoice.paid`) | billing |

Payload/resposta desses endpoints: ver `04-pawbowl-stripe-billing.md` e a doc futura de `subscription/checkout`. O ack **nao** reenvia nada disso.

### 3.3 Tratamento de erro "externo"

Nao ha. Sem timeout Stripe, sem 502, sem retry, sem Idempotency-Key. Unicos erros sao validacao local (secao 2.3) e falha de persistencia Woo/`wpdb` (nao e capturada: `order->save()` / `repository->save()` retornando false **nao** vira `WP_Error`; o handler ainda devolve 200 com `acked: true` se chegou no `return [...]`).

`save()` do repositorio, se falhar, ainda assim o metodo sem pedido devolve o array de sucesso — o PHP **nao checa** o boolean de `save()`.

### 3.4 Relacao com webhook (corrida)

Ack e webhook escrevem as **mesmas** chaves `_hsr_stripe_payment_intent_id` / `_hsr_stripe_payment_intent_status` no pedido.

Webhook `payment_intent.succeeded` (billing) **nao** limpa `_hsr_stripe_client_secret` (o ack settled **limpa**). Tambem **nao** chama `payment_complete`. Quem materializa pedido no `subscription_first` e dispara Flexible e `invoice.paid` → `do_action('hsr_stripe_invoice_paid_confirmed')` → `CheckoutService::on_stripe_invoice_paid_confirmed`.

Last-write-wins. Ack atrasado com status stale pode **rebaixar** um `succeeded` de webhook para `requires_action`.

---

## 4) Request / response

### 4.1 Headers

```
POST /wp-json/custom/v1/onboarding/session/{session_id}/payment-intent/ack
Content-Type: application/json
Authorization: Bearer {jwt_usuario_wp}
```

`X-Session-Token` e opcional e **nao e lido** no permission desta rota. Cookie WP autenticado (com nonce REST) tambem satisfaz `is_user_logged_in()`.

### 4.2 Sucesso — ramo com pedido (order-first)

Sessao ja tem `checkout_order_id` (ex. `10421`). Pedido tem `_hsr_stripe_payment_intent_id` vazio ou igual a `pi_3AckExample`.

Request:

```http
POST /wp-json/custom/v1/onboarding/session/3abf4b2d-34f8-49f2-8d6e-6b9577beef00/payment-intent/ack
Content-Type: application/json
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...

{
  "payment_intent_id": "pi_3AckExample00000000000000",
  "payment_intent_status": "succeeded"
}
```

CamelCase equivalente aceito:

```json
{
  "paymentIntentId": "pi_3AckExample00000000000000",
  "paymentIntentStatus": "succeeded"
}
```

Response `200` (shape real do PHP; **sem** `stripe_subscription_id`):

```json
{
  "success": true,
  "data": {
    "order_id": 10421,
    "stripe_payment_intent_id": "pi_3AckExample00000000000",
    "stripe_payment_intent_status": "succeeded",
    "payment_state": "paid",
    "acked": true
  }
}
```

Efeitos: meta do pedido atualizada; `_hsr_stripe_client_secret` = `""`. Status Woo permanece o que era (em geral `pending`). `GET` da sessao nao muda.

Exemplo `requires_payment_method` (mesmo pedido, PI bate):

```json
{
  "success": true,
  "data": {
    "order_id": 10421,
    "stripe_payment_intent_id": "pi_3AckExample00000000000",
    "stripe_payment_intent_status": "requires_payment_method",
    "payment_state": "failed",
    "acked": true
  }
}
```

Client secret **nao** e limpo. `acked: true` mesmo em falha de cartao — o ack foi aceito, nao o pagamento.

### 4.3 Sucesso — ramo sem pedido (`subscription_first`)

Sessao com `checkout_order_id` null e `stripe_checkout` preenchido no checkout.

Request: igual 4.2.

Response `200` (**tem** `stripe_subscription_id`; `order_id` 0):

```json
{
  "success": true,
  "data": {
    "order_id": 0,
    "stripe_subscription_id": "sub_1AckExample",
    "stripe_payment_intent_id": "pi_3AckExample00000000000",
    "stripe_payment_intent_status": "succeeded",
    "payment_state": "paid",
    "acked": true
  }
}
```

Cartao recusado neste ramo (status `requires_payment_method`), se o snapshot ainda tem `payment_state: requires_confirmation`:

```json
{
  "success": true,
  "data": {
    "order_id": 0,
    "stripe_subscription_id": "sub_1AckExample",
    "stripe_payment_intent_id": "pi_3AckExample00000000000",
    "stripe_payment_intent_status": "requires_payment_method",
    "payment_state": "requires_confirmation",
    "acked": true
  }
}
```

Nao e `failed`. Front que ramifica so por `payment_state` pode mostrar "continua 3DS" com cartao morto.

### 4.4 Body vazio / PI invalido

```json
{}
```

```json
{
  "code": "invalid_payment_intent_id",
  "message": "payment_intent_id is required and must be a Stripe PaymentIntent ID.",
  "data": { "status": 422 }
}
```

`payment_intent_id: "seti_123"` ou `"pi"` cai no mesmo 422. Status ausente **depois** de um `pi_` valido:

```json
{
  "code": "invalid_payment_intent_status",
  "message": "payment_intent_status is required and invalid.",
  "data": { "status": 422 }
}
```

A checagem de id e **antes** da de status.

### 4.5 PI nao bate com o gravado (409)

Pedido (ou `stripe_checkout`) ja tem `pi_3Original...`, body manda `pi_3Other...`:

```json
{
  "code": "payment_intent_mismatch",
  "message": "payment_intent_id does not match the checkout order.",
  "data": { "status": 409 }
}
```

Ramo sem pedido: mesma `code`, message `"...does not match the checkout session."`.

Idempotente se o body repetir o **mesmo** `pi_` (atualiza so o status).

### 4.6 Sem checkout previo

`checkout_order_id` 0 e `stripe_checkout` null, com PI valido no body:

```json
{
  "code": "checkout_order_not_found",
  "message": "Checkout order not found for this session.",
  "data": { "status": 422 }
}
```

Pedido id gravado mas Woo nao acha a ordem: mesma `code`, HTTP **404**.

### 4.7 Erros HTTP (resumo)

| HTTP | `code` | Quando | Message (EN) |
|---|---|---|---|
| 401 | `unauthorized` | sem usuario WP | Authentication is required. |
| 403 | `session_forbidden` | `session_id` vazio **ou** user != `linked_user_id` | Session access denied. |
| 404 | `session_not_found` | sessao nao existe | Onboarding session not found. |
| 404 | `checkout_order_not_found` | `checkout_order_id > 0` mas pedido sumiu | Checkout order not found for this session. |
| 409 | `payment_intent_mismatch` | PI body != PI ja persistido | ...order. / ...session. |
| 422 | `invalid_payment_intent_id` | falta / nao comeca com `pi_` | payment_intent_id is required and must be a Stripe PaymentIntent ID. |
| 422 | `invalid_payment_intent_status` | falta / fora da whitelist | payment_intent_status is required and invalid. |
| 422 | `checkout_order_not_found` | sem pedido e sem `stripe_checkout` | Checkout order not found for this session. |
| 429 | `rate_limit` | auth 300/300s | Too many requests. Please try again later. |
| 503 | `woocommerce_required` | `wc_get_order` ausente | WooCommerce must be active to acknowledge payment intent. |

Formato WP REST de erro: `{ "code", "message", "data": { "status": N } }`. Sem `success: false`.

**Nao existem** nesta rota: `session_unauthorized` / `session_token_*` (isso e `require_valid_session_access`), `stripe_*`, `customer_inactive`.

---

## 5) Hooks e filters do WordPress

### 5.1 Especificos HSR (esta rota)

| Tipo | Hook | Onde | Efeito |
|---|---|---|---|
| action | `rest_api_init` | `Plugin::boot` | registra a rota |
| filter | `hsr/onboarding_rate_limit_max` | `consume_onboarding_limit` | altera max de **auth**. Args: `($maxAttempts, $scope)` com `$scope` = `auth` |
| filter | `hsr/onboarding_rate_limit_window` | idem | altera janela em segundos |
| filter | `hsr/onboarding_ttl` | `OnboardingRepository::ttl` | so se `get()` migrar legado **ou** `save()` do ramo sem pedido regravar transient |
| filter | `rest_allowed_cors_headers` | `Plugin::allow_rest_cors_headers` | libera header `x-session-token` (nao usado na auth desta rota) |

`hsr/onboarding_token_ttl` nao e lido (token de sessao nao entra).  
Filters globais do `RateLimiter` (`hsr/rate_limit_max`, `hsr/rate_limit_window`) **nao** se aplicam: onboarding usa `consume_with_limits` com valores explicitos.

**Nenhum `do_action` proprio do ack.** Nao dispara `hsr_checkout_order_ready_for_stripe_sync`, `hsr_stripe_invoice_paid_confirmed`, `hsr_flexible_subscription_confirmed_after_payment`, `woocommerce_rest_insert_shop_order_object`.

O construtor de `CheckoutService` registra `add_action('hsr_stripe_invoice_paid_confirmed', ...)` no **boot** do plugin — nao por causa deste POST.

### 5.2 Billing (nao disparados por esta rota)

| Hook | Uso real |
|---|---|
| `hsr_checkout_create_stripe_subscription` | so no checkout `subscription_first` |
| `hsr_checkout_order_ready_for_stripe_sync` | so no checkout order-first |
| `hsr_stripe_payment_intent_event` | webhook `payment_intent.*` |
| `hsr_stripe_invoice_paid_confirmed` | webhook `invoice.paid` — materializa pedido / Flexible **depois** do pagamento real |

### 5.3 Core WP / Woo envolvidos

| Hook / API | Uso |
|---|---|
| REST API (`register_rest_route`, `permission_callback`) | roteamento e auth |
| `is_user_logged_in` / `get_current_user_id` | JWT/cookie |
| `$wpdb->get_row` / `update` | sessao |
| `get_transient` / `set_transient` | rate limit; migrate/rewrite `hsr_onb_*` |
| `sanitize_text_field` | path, PI id, status |
| `__()` | mensagens i18n |
| `wc_get_order` / `WC_Order::update_meta_data` / `save` | meta HSR |
| `wc_get_logger` | log do ramo com pedido (`source` = `hsr.payment_intent_ack`) |

Nao usa `WC_Tax`, carrinho, `payment_complete`, Action Scheduler, Stripe SDK.

---

## 6) Dependencias e efeitos colaterais

### 6.1 O que e lido

- Path: `session_id`.
- Headers: so o que o WP usa para autenticar o usuario (Authorization JWT / cookie). `X-Session-Token` ignorado.
- Body: `payment_intent_id` / `paymentIntentId`, `payment_intent_status` / `paymentIntentStatus`.
- Banco sessao: `{prefix}hsr_onboarding_sessions` (`SELECT *`) — `checkout_order_id`, `linked_user_id` (permission), `stripe_checkout_json` (ramo sem pedido). Pets carregados no `get` e ignorados na logica (mas regravados no `save`).
- Pedido Woo: status, `_hsr_stripe_payment_intent_id`, `_hsr_stripe_subscription_id`, `_hsr_stripe_client_secret`, `_hsr_payment_method_id`, `_hsr_stripe_sync_error`.
- Transient legado: `hsr_onb_{sessionId}` se a linha SQL nao existir.
- Env de rate limit: `HSR_ONBOARDING_AUTH_RATE_LIMIT_MAX`, `HSR_ONBOARDING_AUTH_RATE_LIMIT_WINDOW`.

### 6.2 O que e gravado

| Recurso | Ramo com pedido | Ramo sem pedido |
|---|---|---|
| `_hsr_stripe_payment_intent_id` | sim | n/a (nao ha order) |
| `_hsr_stripe_payment_intent_status` | sim | n/a |
| `_hsr_stripe_client_secret` | `''` se settled; senao intocado | campo JSON `stripe_client_secret` |
| status Woo / `payment_complete` | **nao** | n/a |
| `stripe_checkout_json` | **nao** | sim (id, status, secret, `payment_state` se settled) |
| `updated_at` SQL | **nao** | sim |
| tabela de pets | **nao** | **sim** (DELETE+INSERT no `save`) |
| transient `hsr_onb_*` | so se `get()` migrar legado | sim no `save` (TTL filter `hsr/onboarding_ttl`, default 172800 s, min 1800) |
| transient rate limit | **sim** (permission) | **sim** |
| Customer / Subscription / PI Stripe | **nao** | **nao** |
| Flexible `fsb_subscription` | **nao** | **nao** |
| Woo log | sim | nao |

Chave de rate limit:

```
hsr_rl_{md5('onboarding_auth|{sessionId}')}
```

Payload: `{ "count": N }`, TTL = janela (minimo 60 s). 401/403 **depois** do consume ainda gastam o bucket (permission_callback incrementa antes de checar login/vinculo).

### 6.3 Consumidores posteriores (efeito diferido)

- Front (fora deste repo, `Checkout.tsx` / `onboardingApi.ts` na auditoria): usa `data.payment_state` / `acked` para tela de sucesso, retry ou 3DS.
- `present_checkout` (proximo GET/POST de checkout reusado): se `payment_state === 'paid'`, omite `stripe_client_secret` na response. Depende das metas que o ack (ou o webhook) gravou.
- Webhook `invoice.paid` / `on_stripe_invoice_paid_confirmed`: **nao** le o ack. Usa `_hsr_stripe_subscription_id` / `session.stripe_checkout` para materializar pedido no `subscription_first`. Ack `paid` **nao** dispara isso.
- `find_order_id_by_meta('_hsr_stripe_payment_intent_id')` no billing: se o ack gravou um `pi_` **antes** do sync (meta estava vazia), o webhook de `payment_intent.*` consegue achar o pedido por esse id. Util se o sync atrasou; perigoso se o front inventou um `pi_` de outra conta (PHP nao verifica).
- `GET .../session/{id}`: **nao** expoe `stripe_checkout` nem `payment_state`.

### 6.4 Sem efeitos em

- Stripe API
- Woo cart / `WC_Tax` / catalogo meal-plan
- cupom 1a compra / Promotion Codes
- `plan_selection`, zipcode, shipping
- criacao de usuario / account-link
- cache de payment methods

---

## 7) Pontos de atencao para reimplementacao em Node

1. **Nao copiar a cegueira Stripe.** PHP confia no status do front. No Node, o ack deveria `paymentIntents.retrieve(pi)` (secret key) e so persistir se `id` + `customer` pertencerem a sessao/subscription, e usar o **status da Stripe**, nao o body. 409 se o PI nao for o `latest_invoice.payment_intent` do `sub_` da sessao.

2. **Ack nao e confirmacao de cobranca.** Nao chamar `payment_complete`, nao criar pedido Woo/Node, nao criar Flexible, nao mandar e-mail de "pago". Isso continua no handler de `invoice.paid` (ou equivalente Stripe Tax/Invoice). UI pode otimista-`paid`; o dominio so fecha no webhook.

3. **Dois ramos, dois shapes.** Order-first: `order_id > 0`, sem `stripe_subscription_id` na response. Subscription-first: `order_id: 0` + `stripe_subscription_id`. Front legado pode casar os dois. Unificar so com versionamento.

4. **`payment_state` diverge entre ramos.** Com pedido: `resolve_payment_state` (`failed` em `requires_payment_method`, `sync_error` se meta de erro). Sem pedido: so escreve `paid` em settled; recusa fica `requires_confirmation`. Node deve **um** state machine (o da tabela 2.6, corrigindo `canceled` → state proprio) nos dois fluxos.

5. **Auth e usuario vinculado, nao session token.** Copiar `require_valid_session_access` aqui e incompatível. Exigir JWT do usuario (`Authorization`) + `session.linkedUserId === jwt.sub`. Sem account-link → 403, nao 401 de token de sessao. Doc 14 da migracao que cita "token sessao" nesta rota esta **errado** em relacao ao PHP.

6. **Woo 503 mesmo sem pedido.** PHP exige `wc_get_order` no topo. Node sem Woo: equivalente e "store de pedidos/sessoes disponivel"; nao fingir 503 de Woo.

7. **409 so se o PI persistido ja existe.** Meta/JSON vazia aceita qualquer `pi_`. Isso e o furo de "gravar PI de outra sessao". No Node, se o checkout ja devolveu um PI, **sempre** exigir igualdade, inclusive na primeira escrita (comparar com o id do checkout, nao so com o campo se estiver vazio).

8. **Sem monotonicidade.** Implementar transicao so para frente (`requires_action` nao sobrescreve `succeeded`). Webhook e ack compartilham o mesmo campo — last-write-wins no PHP e um bug de corrida.

9. **Limpar client_secret so em settled.** Igual PHP: `succeeded` / `processing` / `requires_capture`. Nao apagar em `requires_action` (3DS ainda precisa do secret).

10. **Nao persistir `payment_state` no order-first.** E calculado na hora. No subscription-first o PHP **grava** `payment_state` no JSON so quando paid. GET sessao **nao** devolve isso — nao inventar o campo no GET sem avisar o front.

11. **`save()` regrava pets.** Ramo sem pedido da um DELETE+INSERT em todos os pets. No Node, UPDATE pontual de `stripe_checkout` (jsonb) **sem** tocar pets. Copiar o rewrite e risco de corrida com `PATCH /pets`.

12. **`save()` falho ainda devolve 200.** Nao copiar. Se o UPDATE falhar → 500.

13. **HTTP 404 vs 422** na mesma `code` `checkout_order_not_found`. Front legado pode casar so `code`. Manter os dois status se quiser fidelidade; no Node e mais limpo: 404 se apontava para pedido inexistente, 409/422 se checkout nunca rodou (`checkout_not_started`).

14. **Prefixo `pi_` no inicio**, aliases camelCase, whitelist fechada. `canceled` com um L (grafia Stripe). Nao aceitar status de Subscription.

15. **Idempotencia.** Repetir o mesmo PI+status e 200. Nao exige header Idempotency-Key (diferente do create-subscription). Rate limit so o bucket auth 300/300s; ack e barato (sem Stripe no PHP). Se o Node passar a retrieve Stripe, vale limite proprio (ex. 30/min).

16. **Nao tratar ack como substituto de webhook.** `on_stripe_invoice_paid_confirmed` / materialize order **nao** devem ser chamados daqui. Senao 3DS incompleto + ack mentiroso cria pedido.

17. **Log.** Ramo com pedido loga `order= pi= status= state=`. Sem pedido silencia. No Node, logar os dois, sem PII, sem `client_secret`.

18. **i18n.** Messages EN via `__()`. Casar `code` no front, nao o texto. `unauthorized` desta rota **nao** e `session_unauthorized`.

19. **Lazy migrate de sessao.** `get()` ainda pode `save()` transient legado. No Node com Postgres, ignore esse ramo.

20. **Contrato sugerido na migracao:** `POST /api/v1/onboarding/sessions/:sessionId/payment-intent/ack`. Manter envelope `{ success, data }` se o front WP ainda consumir. Campos minimos: `acked`, `payment_state`, `stripe_payment_intent_id`, `stripe_payment_intent_status`, `order_id`.

21. **Melhoria desejavel (nao e copia):** retrieve Stripe + recusar PI de outro customer (403/409) + mapear erros Stripe (`resource_missing` → 422) + nao vazar `getMessage()` de SDK. O PHP hoje nao tem 502 nesta rota.

22. **Testes ausentes.** Cobrir no Node: sem JWT; JWT de outro user; sem checkout; PI `seti_`; status `cancelled`; 409 mismatch; ack succeeded nao muda status de pedido; ack nao chama Stripe create; retrieve (se implementado) 409 de PI alheio; corrida webhook succeeded vs ack requires_action; subscription_first nao reescreve pets; `requires_payment_method` → `failed` nos dois ramos.

---

## 8) Relacao com checkout e webhook

Fluxo feliz order-first:

```
1. POST .../account-link              → linked_user_id = user JWT
2. POST .../subscription/checkout     → WC order + subscriptions.create
                                      → meta PI id/status + client_secret
3. Front Stripe.js confirmPayment
4. POST .../payment-intent/ack        → esta rota; meta status; UI "paid"
5. Stripe webhook invoice.paid
   + payment_intent.succeeded         → payment_complete / Flexible / e-mail
```

Fluxo feliz `subscription_first`:

```
2'. POST .../subscription/checkout { checkout_mode: subscription_first }
    → filter hsr_checkout_create_stripe_subscription
    → session.stripe_checkout (order_id 0)
4'. POST .../payment-intent/ack       → atualiza JSON; payment_state=paid se settled
5'. invoice.paid → materialize_order_from_subscription_first
```

Passo 4/4' e otimista e **dispensavel** para a cobranca: se o front pular o ack, o webhook sozinho fecha o pedido. Se o front ackar `succeeded` e o cartao falhar de verdade, o webhook (`payment_intent.payment_failed` / `invoice.payment_failed`) e quem corrige — a menos que a UI ja tenha navegado para "sucesso" com base no ack mentiroso.
