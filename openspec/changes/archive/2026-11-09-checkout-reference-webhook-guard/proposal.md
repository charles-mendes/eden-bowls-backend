# Proposal

## Why

Cada cliente tem um único `checkout_reference` (em `onboarding_user_state`, chave `user_id`), que descreve o checkout mais recente. Os webhooks `invoice.paid` e `invoice.payment_failed` de **qualquer** assinatura do cliente fazem merge nesse JSON. Uma renovação, um trial ou uma falha de uma assinatura antiga trocam o `stripe_subscription_id`, o `payment_state` ou o payment intent do checkout atual. O resultado é um checkout misturado: o plano, os pets e o `order_key` são de uma assinatura, e o ID ou o pagamento são de outra.

Isso foi observado em QA (usuário 5): o checkout tem o carrinho da assinatura 2717 com o ID da 115. Tem dois efeitos:
- a aba Checkout do painel mostra dados incoerentes;
- `evaluateCheckoutReuse` pode tratar o checkout como pago e devolver a assinatura antiga quando o cliente reenvia o mesmo carrinho.

## What Changes

- `invoice.paid` só atualiza o `checkout_reference` do cliente quando o `stripe_subscription_id` gravado nele é igual ao da assinatura do evento. A fatura de outra assinatura continua atualizando o ledger, o NF-e e o ciclo de produção, mas não toca no checkout.
- `invoice.payment_failed` só atualiza o `checkout_reference` quando a falha é do checkout. Isso vale quando o payment intent do evento é o do checkout ou quando a assinatura do evento é a do checkout.
- A verificação e a escrita acontecem numa única instrução `UPDATE` condicional no repositório, sem uma janela entre ler e gravar.
- Os testes cobrem três casos:
  - a cobrança de uma assinatura antiga não altera o checkout atual;
  - a primeira cobrança da assinatura do checkout continua marcando o checkout como `paid`;
  - o reuso de checkout não devolve uma assinatura diferente da que o checkout criou.

Fora de escopo:
- o modelo de um checkout por assinatura;
- renomear ou mudar a aba Checkout do painel;
- migrar os dados de QA já misturados. Ainda não há produção.

## Capabilities

### New Capabilities
- `checkout-reference`: o registro do checkout mais recente de cada cliente. Diz o que pode alterá-lo depois de gravado, para que ele continue descrevendo uma única tentativa de checkout.

### Modified Capabilities
<!-- Nenhuma: nenhuma spec atual define o checkout_reference. -->

## Impact

- `src/services/stripe-webhook.service.js`: `handleInvoicePaid` (patch na linha ~415) e `handlePaymentFailed` (patch na linha ~729).
- `src/infrastructure/repositories/subscription-ledger.repository.js`: `updateCheckoutReference` ganha uma condição opcional de dono (assinatura ou payment intent).
- Testes: `tests/stripe-webhook.service.test.js`, `tests/checkout-idempotency.test.js` e `tests/onboarding-subscription-checkout.service.test.js`.
- Sem mudança de rota, de contrato HTTP, de schema MySQL ou do painel.
