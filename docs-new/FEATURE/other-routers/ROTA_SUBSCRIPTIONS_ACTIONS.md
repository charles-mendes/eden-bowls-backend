# Rota: acoes da assinatura

## Escopo

Rota atual no backend Node (stub Stripe):

- `POST /api/v1/subscriptions/:subscriptionId/actions`

Front:

- `runSubscriptionAction` em `onboardingApi.ts`
- `updateSubscriptionPaymentMethod` em `subscriptionEditApi.ts` (`action: update_payment_method`)
- `PlanDetail.tsx` (pause, reactivate, cancel, toggle_auto_renew)

Arquivos atuais:

- `src/api/routes/subscriptions-actions.routes.js`
- `src/services/subscriptions-actions.service.js` — JWT + regex `sub_` + `assertCriticalOperationAllowed` + allowlist de 7 actions
- `src/infrastructure/repositories/subscriptions-actions.repository.js` — ecoa `action`, devolve `pending_webhook_confirmation: true` + Premium fake; **nao** chama Stripe
- `tests/subscriptions-actions.routes.test.js`
- `tests/subscriptions-actions.service.test.js` — cobre o guard de conta

Rota legado WordPress:

- `POST /custom/v1/subscriptions/:subscriptionId/actions`

## Responsabilidade

Comandar uma mutacao na assinatura Stripe. A resposta imediata **nao** e o estado final: a maioria das acoes devolve `pending_webhook_confirmation: true`. O webhook `customer.subscription.updated` / `deleted` confirma.

Nao e o caminho de troca de plano/prazo no front atual. Isso vai para edit preview + commit.

## Estado de implementacao

| Parte | Status |
|---|---|
| JWT + conta ativa | implementado |
| Validacao `action` + `sub_` | implementado |
| Allowlist | 7 nomes PHP (`change_plan`, `change_billing_frequency` inclusos) |
| Ownership | **nao** |
| Stripe | **nao** — pause "funciona" na UI ate o refresh |

`SUPPORTED_ACTIONS` hoje:

```js
['pause', 'reactivate', 'cancel', 'toggle_auto_renew', 'change_plan', 'change_billing_frequency', 'update_payment_method']
```

Alvo da allowlist do **front**: os cinco primeiros da tabela abaixo. Os dois `change_*` → `422 invalid_action` (o PHP ainda os tem para clientes antigos; este front nao chama).

## Auth

JWT obrigatorio. Sub tem de ser do user. `assertCriticalOperationAllowed` ja roda (manter). Sem `authService` → 503.

## Acoes a portar

| action | Body extra | Stripe (`StripeBillingClient`) |
|---|---|---|
| `pause` | — | `subscriptions.update` com `pause_collection: { behavior: 'void' }` (ou o equivalente que o WP `pause_subscription` usava) |
| `reactivate` | — | limpar `pause_collection` / retomar |
| `cancel` | — | `subscriptions.cancel` **ou** `cancel_at_period_end: true` — preferir cancel at period end se o WP fazia isso; documentar a escolha no service e cobrir com teste |
| `toggle_auto_renew` | `enabled?` boolean; se omitido, **alterna** o valor atual (`cancel_at_period_end`) | `cancel_at_period_end: !enabled` |
| `update_payment_method` | `payment_method_id` (`pm_`) | reusar `attachPaymentMethod` + default na sub e no customer |

`EditSubscription` chama `update_payment_method` **antes** do commit se o usuario trocou o cartao.

## Validacoes

| Falha | Status | code |
|---|---|---|
| Sem usuario | 401 | `unauthorized` |
| conta bloqueada | 403 | `account_operation_not_allowed` |
| id invalido | 422 | `invalid_subscription_id` |
| nao e do user / inexistente | 404 | `subscription_not_found` |
| `action` ausente / desconhecido / `change_*` | 422 | `invalid_action` |
| PM sem prefixo `pm_` | 422 | `invalid_payment_method` |
| Stripe HTTP falhou | 502 | `stripe_*` (mensagem do client) |

Nao devolver 200 `queued` fake se Stripe falhar.

## Fluxo alvo

1. JWT + `sub_` + `assertCriticalOperationAllowed` (ja existe).
2. Ownership via ledger (`user_id` + `stripe_subscription_id`).
3. Zod/normalizacao do `action` + campos por acao (service ja normaliza `enabled`, `payment_method_id` e aliases camelCase).
4. Chamar `StripeBillingClient` (mesmo instance do checkout, injetar no repository).
5. Nao marcar `active`/`paused` no ledger como verdade final — opcional `pending_*`; o webhook fecha.
6. Recarregar um resumo da assinatura (ledger ou retrieve) para a UI.
7. Devolver `pending_webhook_confirmation: true` para as cinco acoes.

O front `runSubscriptionAction` espera `json.data.subscription` (shape de detalhe **ou** o resumo com `id`/`status`). `PlanDetail` aplica `localStatus` otimista (pause → paused) mesmo com pending.

## Request

```http
POST /api/v1/subscriptions/sub_123/actions
Authorization: Bearer <jwt>
Content-Type: application/json
```

```json
{ "action": "pause" }
```

```json
{ "action": "toggle_auto_renew", "enabled": true }
```

```json
{ "action": "update_payment_method", "payment_method_id": "pm_123" }
```

## Response

```json
{
  "success": true,
  "data": {
    "action": "pause",
    "pending_webhook_confirmation": true,
    "command_result": [{ "status": "queued" }],
    "subscription": {
      "id": "sub_123",
      "status": "active",
      "plan_label": "Plan #1",
      "current_period_end": "2026-09-09T00:00:00.000Z"
    }
  }
}
```

Manter `command_result` para nao quebrar clientes que leem. O campo util e `pending_webhook_confirmation` + `subscription`.

Preferivel devolver `subscription` no shape de detalhe (o type TS de `runSubscriptionAction` e `DashboardSubscriptionDetail | null`). Minimo: `id` ou `subscription_id`, `status`, `plan_label`.

## Persistencia

Stripe + ledger no webhook. Actions **nao** precisam gravar Woo meta. Podem atualizar last4 no ledger em `update_payment_method` de forma otimista.

## O que mudar

1. `SubscriptionsActionsService`: allowlist = 5 acoes; `change_plan` / `change_billing_frequency` → 422 **antes** do repository.
2. Validar `pm_` em `update_payment_method`.
3. Repository recebe `stripeBilling` + `ledgerRepository`; `executeAction` falha 404 se a linha nao for do user.
4. `src/index.js`: `new SubscriptionsActionsRepository({ stripeBilling, ledgerRepository })`.

## Testes minimos

- sem JWT → 401 (ja existe)
- guard de conta rejeita → nao chama repository (ja existe)
- `action: explode` → 422
- `change_plan` → 422
- `pause` de sub de outro user → 404
- `pause` chama Stripe pause e devolve `pending_webhook_confirmation: true`
- `update_payment_method` sem `pm_` → 422
- Stripe down → 502, nao 200 queued fake
