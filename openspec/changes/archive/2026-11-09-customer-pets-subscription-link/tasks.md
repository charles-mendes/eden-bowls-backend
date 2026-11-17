# Tasks

## 1. Regra do vínculo

- [x] 1.1 Criar `src/core/subscription-pet-link.js` com `ownedPets(row)` e `petSubscriptions(petId, rows)`, seguindo as decisões 1 a 3 do design e reaproveitando `planPetIds` de `src/core/life-stage-lines.js`. Verificar com a tarefa 1.2
- [x] 1.2 Testes em `tests/subscription-pet-link.test.js`, um por cenário de "A subscription owns a pet while it still holds it", mais:
  - pet com `enabled: false` em `plan.pets` que ainda aparece numa linha de `catalog_pricing.line_items` não é possuído;
  - plano com todos os pets desativados não cai no snapshot;
  - nome vindo de `plan.pets[].pet_name`, depois de `petsSnapshot.pets[].name`, e `''` sem nenhum dos dois;
  - ordem por `createdAt` decrescente, com empate resolvido por `id`.

  Rodar `npx jest --runTestsByPath tests/subscription-pet-link.test.js`

## 2. Detalhe do cliente

- [x] 2.1 Em `AdminUsersService.presentSubscriptions` (`src/services/admin-users.service.js`), anexar `pets: ownedPets(row)` a cada item, também no caminho `latestCycleUnavailable`
- [x] 2.2 Testes em `tests/admin-users-subscriptions.service.test.js`:
  - assinatura `active` com dois pets → `pets` com os dois;
  - assinatura `canceled` → `pets: []`;
  - leitura dos ciclos falhando → `pets` continua presente.

  Rodar `npx jest --runTestsByPath tests/admin-users-subscriptions.service.test.js`

## 3. Checkout do cliente

- [x] 3.1 Em `AdminOnboardingService.getByUserId` (`src/services/admin-onboarding.service.js`), anexar `subscriptions: petSubscriptions(pet.id, scopedSubscriptions)` a cada pet, com `id`, `stripeSubscriptionId`, `status` e `planLabel`
- [x] 3.2 Testes em `tests/admin-onboarding.service.test.js`:
  - pet numa assinatura `active` → uma entrada;
  - pet sem assinatura, ou só numa `canceled` → `subscriptions: []`;
  - pet numa `paused` e numa `active` → as duas, a mais recente primeiro;
  - ator com escopo Brasil e assinatura `us` → `subscriptions: []`.

  Rodar `npx jest --runTestsByPath tests/admin-onboarding.service.test.js`

## 4. Verificação

- [x] 4.1 `npx jest --findRelatedTests src/core/subscription-pet-link.js src/services/admin-users.service.js src/services/admin-onboarding.service.js` e `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passam sem mudar `docs/api-routes.json`
- [x] 4.2 Abrir a change irmã em `eden-bowls-admin`: no card do pet (aba Pets), um selo por item de `subscriptions`, cada um com o status, o mais recente primeiro, e "Sem assinatura" quando a lista vier vazia; e os nomes dos pets no `CustomerSubscriptionCard`
