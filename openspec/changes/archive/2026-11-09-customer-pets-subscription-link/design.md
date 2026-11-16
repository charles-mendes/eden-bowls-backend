# Design

## Context

O detalhe do cliente no painel lê duas rotas:

- `GET /api/v1/admin/users/:userId` (`users.read`) monta as assinaturas em `AdminUsersService.presentSubscriptions`, a partir das linhas do ledger já filtradas por `scopedSubscriptions`. Cada linha já traz `planSelection` e `petsSnapshot`, mas nenhum dos dois chega ao item.
- `GET /api/v1/admin/onboarding/checkouts/:userId` (`onboarding.read`) alimenta a aba Pets. `AdminOnboardingService.getByUserId` já lê as assinaturas do cliente pelo ledger e já filtra pelo mercado do ator (`scopedSubscriptions` local). Os pets vêm do checkout, com `id`.

Os pets de uma assinatura estão em dois lugares:

- **`plan_selection.pets[]`** tem `pet_id`, `pet_name` e `enabled`. É o que a edição reescreve.
- **`pets_snapshot`** (`buildPetsSnapshot`) guarda `pet_ids`, `pets_names` e `pets` com id e nome. Não guarda `enabled` e não remove os pets desativados.

`planPetIds` (`src/core/life-stage-lines.js`) já devolve os pets ativos de um plano: os de `plan.pets` com `enabled !== false`, mais o `pet_id` de cada linha de `catalog_pricing.line_items`.

Os status já usados pelo resto do sistema são estes:

- produção, fila, cobrança e atualização de pets usam `active`, `trialing` e `past_due`;
- o checkout recusa um pet em `active`, `trialing`, `incomplete`, `past_due`, `paused` e `unpaid` (`SUBSCRIBED_PET_STATUSES`);
- `unpaid` é gravado no ledger como `past_due` (`stripe-subscription-map.js:70`).

## Goals / Non-Goals

**Goals:**

- Uma regra só de "esta assinatura possui este pet", usada pelas duas rotas.
- Nenhuma leitura nova no banco: só os dados que cada rota já carrega.

**Non-Goals:**

- Mudar a trava `pet_blocked` ou a regra do checkout.
- Expor `planSelection` ou `petsSnapshot` inteiros no detalhe do cliente.

## Decisions

### 1. Uma função pura em `src/core/subscription-pet-link.js`

`ownedPets(row)` devolve `[{ id, name }]` dos pets que a linha do ledger possui. `petSubscriptions(petId, rows)` devolve as linhas que possuem o pet, da mais recente para a mais antiga. As duas rotas chamam essas funções sobre as linhas que já carregam.

Alternativa descartada: montar o vínculo no painel, cruzando as duas respostas. O painel teria que saber a regra de status e de `enabled`, e a aba Pets não tem o plano da assinatura.

### 2. Status que possuem o pet: `active`, `trialing`, `past_due`, `paused`, `incomplete`

`past_due` segue a produção, que continua tratando a assinatura como a que alimenta o pet. `paused` e `incomplete` seguem o checkout: se o selo dissesse "sem assinatura" para um desses pets, o checkout recusaria criar uma nova e o operador ficaria sem entender o motivo. O status vai no item, então o painel mostra que a assinatura pausada ou não paga não está entregando.

Na prática, o conjunto é o mesmo de `SUBSCRIBED_PET_STATUSES`, porque `unpaid` vira `past_due` no ledger. Mesmo assim fica como constante própria da função: o selo mostra o que o ledger grava, e mudar a regra do checkout não deve mudar o selo sem passar pelo spec.

### 3. Pets ativos vêm do plano; o snapshot só serve de fallback

O conjunto de pets ativos usa `planPetIds(row.planSelection)` e depois remove qualquer id marcado `enabled: false` em `plan.pets`. Isso cobre uma linha de catálogo que ainda cite um pet desativado. Só quando o plano não traz nenhum pet em `plan.pets` (ativo ou não) e nenhuma linha de catálogo, como numa assinatura antiga, usa `petsSnapshot.pet_ids`. O teste do fallback olha o plano bruto, não o resultado de `planPetIds`: um plano com todos os pets desativados devolve vazio e não pode cair no snapshot, que traria o pet desativado de volta.

O nome vem de `plan.pets[].pet_name`, depois de `petsSnapshot.pets[].name`. Se não houver nome, fica `''`, e o painel mostra "Pet sem nome", como já faz.

### 4. Formato das respostas

- **Na assinatura (`users/:userId`):** `pets: [{ id, name }]`, presente em todo item, inclusive no caminho `latestCycleUnavailable`. Não depende de permissão além de `users.read`. Hoje o card não mostra nomes de pets, mas todo papel com `users.read` (`readonly`, `operator`, admin) também tem `onboarding.read` e já vê esses nomes na aba Pets. Então não se abre nenhum dado novo para os papéis atuais.
- **No pet (`onboarding/checkouts/:userId`):** `subscriptions: [{ id, stripeSubscriptionId, status, planLabel }]`. É uma lista, e não um objeto único, porque a trava de edição só olha `active` e `trialing`: um pet pode estar numa assinatura `paused` e numa `active` ao mesmo tempo. A lista mostra os dois casos em vez de escolher um em silêncio. A ordem é por `createdAt` decrescente e, no empate, por `id` decrescente.

## Risks / Trade-offs

- **[Snapshot antigo com pet desativado]** Uma assinatura sem `plan_selection.pets` não tem `enabled` e conta todos os pets do snapshot. → Só afeta linhas antigas. O fallback fica documentado no spec.
- **[Pet em duas assinaturas]** O painel precisa lidar com mais de um selo. → A change irmã mostra todos, e é um sinal útil para o suporte.

## Migration Plan

Nenhuma migração. Os dois campos são aditivos e o painel antigo os ignora. O rollback é reverter o commit.

## Open Questions

- **Assimetria da trava `pet_blocked`** (`subscriptions-edit-commit.service.js:117` e `subscriptions-edit-preview.service.js:83`): a trava ignora `enabled: false` nos pets enviados na edição, mas compara com `petsSnapshot.pet_ids` das outras assinaturas, que inclui os pets desativados. Com isso, um pet desativado numa assinatura ainda bloqueia a edição de outra. O checkout faz a mesma coisa em `collectPetIdsFromSnapshot`. Isso não muda esta change: o selo segue a regra do spec. Vale uma change própria depois de confirmar se esse bloqueio é intencional.
