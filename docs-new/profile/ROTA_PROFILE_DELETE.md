# Rota: excluir conta

## Escopo

Rota alvo no backend Node:

- `DELETE /api/v1/profile`

Front:

- `deleteAccount` em `profileApi.ts`
- `ProfileDeleteSection` — botao habilitado pela flag `accountStatus.canDeleteAccount` do GET; confirm dialog **sem senha**

Rota legado WordPress:

- `DELETE /custom/v1/profile` — `docs/profile/07-delete-profile.md`

Cancelar assinatura (nao apaga a conta):

- `POST /api/v1/subscriptions/:id/actions` `cancel` — [../other-routers/ROTA_SUBSCRIPTIONS_ACTIONS.md](../other-routers/ROTA_SUBSCRIPTIONS_ACTIONS.md)

Logout (so mata refresh):

- `POST /api/v1/auth/logout`

## Responsabilidade

Self-service "apagar minha conta", alinhado a `accountStatus.canDeleteAccount` do GET.

Bloquear se o ledger tiver assinatura `active` ou `trialing`. Se livre: cancelar leftover Stripe, revogar refresh, apagar user + metas, soft-delete pets.

**Nao** pede senha no body (o front nao envia). Qualquer Bearer valido, sem assinatura ativa, apaga.

## Estado de implementacao

| Parte | Status |
|---|---|
| Rota | **ausente** |
| `hasActiveSubscription` | helper no ledger (checkout / eligibility) |
| `revokeAllForUser` | ja existe |
| `StripeBillingClient.cancelSubscription` | ja existe (cancel at period end) |
| `DELETE FROM wp_users` | **nao** |

## Endpoint, controller e permissao

- Path: `/api/v1/profile` (mesmo path do GET)
- Method: `DELETE`
- Body: ignorado
- Service: `ProfileService.deleteAccount({ userId })`

JWT obrigatorio. `assertCriticalOperationAllowed`.

## Fluxo

```mermaid
sequenceDiagram
    participant Front
    participant SV as ProfileService
    participant Ledger as stripe_subscriptions
    participant Stripe as StripeBillingClient
    participant Refresh as auth_refresh_tokens
    participant Users as wp_users + wp_usermeta
    participant Pets as onboarding_pets

    Front->>SV: DELETE /api/v1/profile + Bearer
    SV->>Ledger: hasActiveSubscription(userId, email)
    alt active OR trialing OR tabela ausente
        SV-->>Front: 422 active_subscription
    end
    SV->>Ledger: listByUserId (leftover incomplete/past_due/paused)
    opt sub_ restante
        SV->>Stripe: cancelSubscription(sub_)
    end
    SV->>Refresh: revokeAllForUser(userId, 'account_deleted')
    SV->>Pets: deleted_at = now (ativos do user)
    SV->>Users: DELETE usermeta + wp_users
    Note over Stripe: Customer cus_ pode permanecer; cobranca de active/trialing nao existe neste ramo
    alt delete user falhou
        SV-->>Front: 500 delete_failed
    end
    SV-->>Front: 200 { deleted: true }
```

## Validacoes

| # | Regra | HTTP | `details.code` | Message |
|---|---|---|---|---|
| 1 | auth | 401 / 403 | `unauthorized` / `jwt_auth_*` | |
| 2 | conta bloqueada | 403 | `account_operation_not_allowed` | |
| 3 | assinatura ativa | 422 | `active_subscription` | `You have an active subscription. Please cancel it before deleting your account.` |

A mensagem e a mesma de `accountStatus.deleteRestrictionMessage` no GET.

Definicao de ativa = **a mesma query do GET**:

- `stripe_subscriptions.status IN ('active', 'trialing')` por `user_id` (fallback e-mail)
- tabela ausente / `hasActiveSubscription === null` → **bloquear** (fail closed). O PHP liberava se o CPT nao existisse.

Nao bloquear: `cancelled`, `incomplete`, `past_due`, `paused`, `unpaid`. Esses leftover ainda devem ser cancelados no Stripe **antes** de apagar o user, para nao deixar cobranca orfa.

Nao ha confirmacao de e-mail, cooldown, nem senha (paridade de contrato com o front). Soft-delete do user **nao** — o PHP era hard no `wp_users`.

## Dados apagados / preservados

| Recurso | Efeito |
|---|---|
| `wp_users` | row removida |
| `wp_usermeta` | todas as metas do `user_id` (OTP, `_eden_*`, `_hsr_stripe_customer_id`) |
| `auth_refresh_tokens` | `revoked_at` em todas as familias (`account_deleted`) |
| `onboarding_pets` | `deleted_at` preenchido (mesmo criterio do delete de pet) |
| `onboarding_user_state` | apagar a linha do `user_id` |
| `stripe_subscriptions` | **manter** o ledger (historico de cobranca); status deve refletir o cancel |
| Stripe Customer `cus_` | nao apagar o customer (auditoria); cancelar subscriptions leftover |
| Ficheiro de avatar | apagar best-effort |
| Pedidos / invoices Stripe | permanecem no Stripe |

Nao chamar `wp_delete_user`. Nao disparar hooks Woo. Nao zerar `_customer_user` de CPT.

`StripeBillingClient.cancelSubscription` hoje e `cancel_at_period_end: true`. No delete, preferir cancelamento **imediato** (`subscriptions.cancel`) se o client expuser; senao documentar que leftover `incomplete` ainda pode existir ate o period end. Nao deixar `active`/`trialing` — esses ja foram bloqueados.

## Contrato

### Request

```
DELETE /api/v1/profile
Authorization: Bearer {jwt}
```

Sem body. Sem senha.

### Sucesso (200)

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

O front faz `logout()` + `navigate('/')` apos o 200. O access JWT ainda cabe no `exp`, mas `currentUser.id` aponta para user inexistente: proximos GETs → 401.

### Erros

| HTTP | `details.code` | Quando |
|---|---|---|
| 401 | `unauthorized` | sem JWT / user ja apagado (segundo DELETE) |
| 403 | `jwt_auth_*` / `account_operation_not_allowed` | |
| 422 | `active_subscription` | ledger `active`/`trialing` ou tabela ausente |
| 502 | `stripe_*` | cancel leftover falhou — **nao** apagar o user |
| 500 | `delete_failed` | `DELETE` do user falhou |

Idempotencia: segundo DELETE com o mesmo JWT → 401 (user sumiu), nao 500.

## O que mudou em relacao ao WordPress

| Antes (WP) | Alvo (Node) |
|---|---|
| CPT `active`/`pending`/`on-hold` | ledger `active`/`trialing` |
| CPT ausente = pode apagar | tabela ausente = **nao** pode apagar |
| `trialing` podia apagar | `trialing` bloqueia |
| Stripe **nao** chamado | cancelar leftover **antes** do delete |
| refresh Node zumbi | `revokeAllForUser` |
| avatars / pets orfaos | best-effort avatar + soft-delete pets |
| `wp_delete_user` + hooks WC | `DELETE` SQL das tabelas Node |

GET `canDeleteAccount` e DELETE **tem** de usar a mesma funcao `hasActiveSubscription`.

## Testes

`active` bloqueia; `trialing` bloqueia; `cancelled` permite; tabela ledger ausente bloqueia; Stripe cancel e chamado para leftover `incomplete`; refresh revogado; segundo DELETE → 401; 401 sem JWT.
