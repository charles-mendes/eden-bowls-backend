# Design

## Context

- `AdminUsersService.presentSubscriptions` (`src/services/admin-users.service.js`) já monta cada item com os blocos de `latestCycle` liberados por permissão: `production`, `delivery` (courier antes de UPS, courier cancelado ignorado) e `nfe` (só Brasil). Ele também marca `latestCycleUnavailable` quando a leitura falha.
- A linha do ledger já traz `editPending` (JSON ou `null`) e `pendingDeliveryChanges` (objeto como `{ packs, charge_move }`, ou `null`). `listByUserId` faz `SELECT s.*`, então os dois chegam.
- `src/core/delivery-closed-days.js` já tem `timeZoneFor(market)` e `zonedParts` para o dia local do mercado.
- O serviço recebe `nowProvider` (segundos), usado nos testes para fixar o relógio.

## Goals / Non-Goals

**Goals:**
- Alertas derivados do mesmo item que o operador vê, sem leitura nova.

**Non-Goals:**
- Guardar alertas, notificar ou ordenar clientes por alerta.
- Recalcular `readinessReasons`. A regra de "pronto" aqui é a da change, não o 409 do despacho.

## Decisions

### 1. Calcular a partir do item já apresentado

`subscriptionAlerts({ item, row, now })` em `src/core/customer-subscription-alerts.js` lê:
- `item.latestCycle` já filtrado por permissão;
- `row.editPending` e `row.pendingDeliveryChanges`.

Se o ator não tem `nfe.read`, `latestCycle.nfe` não existe e o alerta de NF-e não sai sozinho. Com isso a regra de permissão do spec fica garantida pelo próprio formato do item. `ready_not_dispatched` exige as chaves `production` e `delivery`, ou seja, as duas permissões.

Alternativa considerada: calcular a partir das linhas cruas, antes de apresentar. Foi descartada porque repetiria a checagem de permissão e poderia vazar um alerta de um bloco escondido.

### 2. "Hoje" no fuso do mercado

`market = stripeAccount === 'br' ? 'BR' : 'US'` e `today = dateKey(zonedParts(now, timeZoneFor(market)))`. O alerta sai quando `deliveryDate <= today`, comparando strings `YYYY-MM-DD`.

### 3. 24 horas a partir de `paidAt`

`now - Date.parse(paidAt) >= 24h`. `paidAt` inválido ou ausente não gera alerta.

### 4. Formato

Os objetos são em camelCase, como o resto do payload. Os campos de cada código:

| Código | Campos |
|---|---|
| `nfe_problem` | `nfeId`, `status`, `lastError` |
| `nfe_missing` | `status`, `paidAt` |
| `delivery_failed` | `courierDeliveryId`, `failedAt` |
| `ready_not_dispatched` | `deliveryDate` |
| `pending_change` | `kinds` |

## Risks / Trade-offs

- [O relógio do servidor decide "hoje" e "24h"] → `nowProvider` injetável. Os testes fixam a hora perto da virada do dia em cada fuso.
- [`pendingDeliveryChanges` pode vir `{}` depois de aplicado] → Conta como vazio: só gera alerta um objeto com alguma chave não nula.
