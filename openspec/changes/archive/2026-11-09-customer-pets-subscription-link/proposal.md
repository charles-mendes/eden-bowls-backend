# Proposal

## Why

O detalhe do cliente no painel mostra os pets numa aba e as assinaturas em outra, mas nenhuma das duas mostra a ligação entre eles. Para responder "qual assinatura alimenta o Rex?" ou "este pet ficou sem plano?", o operador precisa abrir a assinatura na Stripe ou adivinhar. Os dados já existem: cada assinatura guarda os seus pets em `plan_selection` e em `pets_snapshot`.

A change irmã em `eden-bowls-admin`, aberta depois desta, mostra o selo da assinatura no card do pet e os nomes dos pets no card da assinatura.

## What Changes

- Cada item de `subscriptions` em `GET /api/v1/admin/users/:userId` passa a trazer `pets`, uma lista com `{ id, name }` dos pets ativos daquela assinatura. A lista está sempre presente e é `[]` quando não há pet.
- Cada pet de `pets` em `GET /api/v1/admin/onboarding/checkouts/:userId` passa a trazer `subscriptions`. São as assinaturas que ainda possuem aquele pet, cada uma com `id`, `stripeSubscriptionId`, `status` e `planLabel`, da mais recente para a mais antiga. A lista está sempre presente e é `[]` quando nenhuma assinatura possui o pet.
- Regras do vínculo (decididas com o usuário em 09/11/2026):
  - **Uma assinatura possui o pet** quando o status dela é `active`, `trialing`, `past_due`, `paused` ou `incomplete`. `past_due` entra porque a produção e a fila ainda tratam essa assinatura como a que alimenta o pet. `paused` e `incomplete` entram porque o checkout recusa uma nova assinatura para esse pet, e o status no selo mostra que ela não está entregando. Fica de fora `canceled`, onde o ledger também grava `incomplete_expired`.
  - **Pet desativado não conta.** Um pet com `enabled: false` em `plan_selection.pets` não aparece em `pets` da assinatura, e aquela assinatura não aparece em `subscriptions` do pet. Isso vale mesmo que o id continue no `pets_snapshot`.
  - **Escopo de mercado:** as duas listas só usam as assinaturas que o operador já enxerga hoje em cada rota.
- **Sem mudança:** nenhuma rota nova, nenhuma coluna nova, nenhuma chamada à Stripe. Os campos que já existiam continuam iguais.
- **Fora do escopo:**
  - Histórico de assinaturas canceladas no pet, como "Antes em: #sub_… (cancelada)".
  - Mudar a trava `pet_blocked`. Ela fica registrada como questão aberta no design.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `admin-customer-subscriptions`: cada assinatura do detalhe do cliente passa a listar os seus pets, e cada pet do checkout do cliente passa a listar a assinatura que o possui.

## Impact

- Novo `src/core/subscription-pet-link.js`, uma função pura sem acesso a banco, usada pelas duas rotas.
- `src/services/admin-users.service.js`: `presentSubscriptions` anexa `pets` a cada assinatura.
- `src/services/admin-onboarding.service.js`: `getByUserId` anexa `subscriptions` a cada pet.
- Testes em `tests/subscription-pet-link.test.js` (novo), `tests/admin-users-subscriptions.service.test.js` e `tests/admin-onboarding.service.test.js`.
- `docs/api-routes.json` não muda.
- Painel: change irmã para o selo no card do pet e os nomes no card da assinatura.
