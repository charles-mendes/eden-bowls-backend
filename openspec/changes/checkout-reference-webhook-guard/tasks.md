# Tasks

## 1. Escrita condicional no repositório

- [x] 1.1 Em `subscription-ledger.repository.js`, fazer `updateCheckoutReference(userId, patch, owner)` aceitar `owner = { subscriptionId, paymentIntentId }` opcional e aplicar o merge numa única instrução, só quando o `checkout_reference` gravado tiver um desses IDs (design, Decisão 3). O método deve devolver se aplicou ou não. Sem `owner`, mantém o comportamento atual. Com `owner`, só entram na condição os IDs não vazios. Se nenhum sobrar, nada é gravado (design, "ID vazio nunca é dono"). Verificar com testes de repositório (mock do `dataSource`) que checam a SQL condicional, que ID vazio não entra no `OR`, que `owner` sem IDs não executa `UPDATE`, e que sem `owner` não há condição.
- [x] 1.2 Garantir que o merge condicional produz o mesmo resultado de `{ ...atual, ...compact(patch) }`: conserva os campos existentes e não apaga chaves com `null`. Verificar com teste `RUN_DB_INTEGRATION_TESTS=true` em um arquivo de integração novo, ou no existente de `onboarding_user_state`, que grava um checkout, aplica o patch com o dono certo e com o dono errado, e confere o JSON.

## 2. `invoice.paid` só atualiza o checkout da própria assinatura

- [x] 2.1 Em `handleInvoicePaid` (`stripe-webhook.service.js`, ~415), passar `{ subscriptionId }` como dono do patch. Verificar em `tests/stripe-webhook.service.test.js`: a primeira cobrança da assinatura do checkout chama o patch com esse dono, e o ajuste nas expectativas existentes (linhas ~252, ~919 e ~951) continua passando.
- [x] 2.2 Adicionar ao `tests/stripe-webhook.service.test.js` o caso "fatura da assinatura A paga com o checkout na assinatura B": o patch é chamado com o dono A, o repositório (mock que respeita o dono) não altera o checkout, e o upsert do ledger, o NF-e e o ciclo de A continuam acontecendo. Rodar `npx jest --runTestsByPath tests/stripe-webhook.service.test.js`.
- [x] 2.3 Cobrir o intervalo entre o ledger e o `persistCheckout` em `tests/onboarding-subscription-checkout.service.test.js` (ou no teste de integração da 1.2). Com a linha ainda no checkout anterior (assinatura A), um patch com dono B não grava. Depois do `persistCheckout`, o checkout tem B e o `payment_state` derivado do payment intent, e nada de A.

## 3. `invoice.payment_failed` só atualiza o checkout a que pertence

- [x] 3.1 Em `handlePaymentFailed` (~729), passar `{ subscriptionId, paymentIntentId }` como dono do patch. Manter o `return` atual para o ledger `active`/`trialing` e o envio do e-mail antes dele. Verificar em `tests/stripe-webhook.service.test.js`: a falha do próprio checkout (pelo payment intent) grava `failed`, e a falha de uma assinatura A não ativa, com outro payment intent e o checkout em B, não altera o checkout. O e-mail de falha continua sendo enviado nos dois casos.

## 4. Reuso de checkout não devolve outra assinatura

- [x] 4.1 Em `tests/onboarding-subscription-checkout.service.test.js`, cobrir o cenário da spec: o checkout cria a assinatura B, chega um `invoice.paid` da assinatura A (pelo service do webhook, ou pelo repositório com dono A), e o cliente reenvia o mesmo carrinho. A resposta traz B. Se o teste já passar só com a trava, registrar isso no teste. Rodar `npx jest --runTestsByPath tests/onboarding-subscription-checkout.service.test.js tests/checkout-idempotency.test.js`.

## 5. Verificação final

- [x] 5.1 Rodar `npx jest --findRelatedTests src/services/stripe-webhook.service.js src/infrastructure/repositories/subscription-ledger.repository.js` e `npx jest --changedSince=main`. Todos devem passar. Sem rota nova, então `npm run routes:manifest` não deve gerar diff.
- [x] 5.2 Rodar `openspec validate checkout-reference-webhook-guard --strict` e confirmar que passa.
