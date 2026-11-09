# Tasks

## 1. Regras

- [x] 1.1 Criar `src/core/customer-subscription-alerts.js` com `subscriptionAlerts({ item, row, now })` seguindo as decisões 1 a 4 do design
- [x] 1.2 Testes em `tests/customer-subscription-alerts.test.js`, um por cenário do spec, incluindo:
  - a virada do dia em São Paulo e em Nova York para `ready_not_dispatched`;
  - o limite de 24h para `nfe_missing`;
  - `pendingDeliveryChanges: {}` sem alerta;
  - item sem as chaves de permissão sem alerta.

  Rodar `npx jest --runTestsByPath tests/customer-subscription-alerts.test.js`

## 2. Detalhe do cliente

- [x] 2.1 Em `AdminUsersService.presentSubscriptions`, anexar `alerts` a cada item, também no caminho `latestCycleUnavailable`, usando o relógio de `nowProvider`
- [x] 2.2 Testes em `tests/admin-users-subscriptions.service.test.js`:
  - `alerts: []` sem problema;
  - nota rejeitada com operador → `nfe_problem`;
  - `latestCycleUnavailable` com edição pendente → só `pending_change`;
  - ator sem `nfe.read` com nota rejeitada → sem alerta de NF-e.

  Rodar o arquivo com `npx jest --runTestsByPath`

## 3. Verificação

- [x] 3.1 `npx jest --findRelatedTests src/services/admin-users.service.js src/core/customer-subscription-alerts.js` e `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passam sem mudar `docs/api-routes.json`
- [x] 3.2 Abrir a change irmã em `eden-bowls-admin` para os badges no cabeçalho do cartão
