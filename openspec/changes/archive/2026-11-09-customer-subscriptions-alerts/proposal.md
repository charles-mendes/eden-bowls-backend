# Proposal

## Why

`customer-subscriptions-operational-links` passou a mostrar, no detalhe do cliente, o contrato e o último ciclo pago de cada assinatura. O operador ainda precisa ler cada bloco para achar o que está errado. Ficaram de fora os alertas que dizem isso sem ler o bloco: NF-e com problema ou atrasada, entrega que falhou, pedido pronto que não saiu e alteração pendente.

A change irmã em `eden-bowls-admin`, aberta depois desta, mostra os alertas como badges no cabeçalho do cartão da assinatura.

## What Changes

- Cada item de `subscriptions` em `GET /api/v1/admin/users/:userId` passa a trazer `alerts`, uma lista calculada no backend, sempre presente e `[]` quando não há alerta.
- Os alertas e quando cada um aparece (regras decididas com o usuário em 09/11/2026):
  - **`nfe_problem`** (só Brasil, com `nfe.read`): a nota do último ciclo está rejeitada, com erro ou bloqueada por falta de CPF ou nome. Aparece na hora e traz o último erro.
  - **`nfe_missing`** (só Brasil, com `nfe.read`): o último ciclo não tem nota, ou ela está pendente ou enviada, e já passaram 24 horas do pagamento.
  - **`delivery_failed`** (com `shipping.read`): a tentativa de courier mais recente não cancelada do último ciclo falhou, ou seja, ninguém tentou de novo.
  - **`ready_not_dispatched`** (com `production.read` e `shipping.read`): o ciclo está pronto e não tem courier nem UPS, e a data de entrega é hoje ou já passou. O dia é contado no fuso do mercado.
  - **`pending_change`** (com `users.read`): a assinatura tem uma edição esperando pagamento ou uma mudança de entrega pendente.
- Com `latestCycleUnavailable`, só `pending_change` é calculado.
- **Sem mudança:** nenhuma rota nova, nenhuma chamada à Stripe ou ao Bling, e os campos que já existiam continuam iguais.
- **Fora do escopo:** alertas na lista de clientes e notificações.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `admin-customer-subscriptions`: cada assinatura do detalhe do cliente passa a trazer alertas operacionais.

## Impact

- Novo `src/core/customer-subscription-alerts.js`, uma função pura sem acesso a banco.
- `src/services/admin-users.service.js`: `presentSubscriptions` anexa `alerts` a cada assinatura.
- Testes em `tests/customer-subscription-alerts.test.js` (novo) e `tests/admin-users-subscriptions.service.test.js`.
- Painel: change irmã para os badges.
