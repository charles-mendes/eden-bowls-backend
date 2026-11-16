# Design

## Context

O motivo está em proposal.md (Why). O estado atual que importa para a abordagem:

- O checkout grava o `checkout_reference` inteiro uma única vez, em `persistCheckout`, depois de criar a assinatura e de gravar o ledger (`upsertLedger`). A gravação usa `ON DUPLICATE KEY UPDATE`, que substitui o JSON. O JSON já sai com `stripe_subscription_id = subscription.id`, `stripe_payment_intent_id` e `payment_state` (`stripe-billing-client.js`, ~1051 e ~1081). Não há gravação intermediária com o campo vazio. Até o checkout novo ser gravado, a linha guarda o checkout anterior, com o ID da assinatura anterior.
- O pagamento confirmado já nasce `paid` no próprio checkout: `resolvePaymentState` devolve `paid` para `succeeded`, `processing` e `requires_capture`. Na confirmação tardia (3DS), o ack do payment intent (`onboarding-payment-intent-ack.repository.js`) grava `paid`. O webhook só complementa a linha.
- Nenhum código em `src` lê o `stripe_invoice_id` do `checkout_reference`.
- `updateCheckoutReference(userId, patch)` (`subscription-ledger.repository.js`, ~295) lê o JSON, faz `{ ...atual, ...patch }` e grava. Ele não sabe de qual tentativa o patch veio.
- Três chamadores em `stripe-webhook.service.js`:
  - `handleInvoicePaid` (~415): grava `payment_state: 'paid'`, `stripe_subscription_id` e `stripe_invoice_id` para qualquer assinatura do cliente.
  - `handlePaymentIntent` (~686): já encontra o checkout pelo payment intent (`findUserStateByPaymentIntentId`). O patch só chega ao checkout dono do payment intent. Já está correto.
  - `handlePaymentFailed` (~729): o usuário vem pelo payment intent ou, se não houver, pela assinatura (`resolveUserContext`). O patch grava `failed` mesmo quando o usuário veio só pela assinatura e ela é outra.
- `resolveUserContext` procura primeiro no ledger (`stripe_subscriptions`). O fallback por `checkout_reference.stripe_subscription_id` só é usado quando a assinatura ainda não tem linha no ledger. Esta mudança não altera essa ordem.

## Goals / Non-Goals

**Goals:**
- Um patch de webhook só alcança o `checkout_reference` quando o evento é da tentativa gravada nele.
- A verificação e a escrita acontecem numa única instrução, sem uma janela de corrida entre ler e gravar.

**Non-Goals:**
- Mudar `handlePaymentIntent` (já é escopado pelo payment intent).
- Corrigir o `stripe_subscription_status` desatualizado que fica no JSON depois do pagamento. É outro campo, e nenhum webhook o atualiza hoje.
- Mudar a resolução de usuário do webhook ou o fallback por `checkout_reference`.

## Decisions

### 1. Trava estrita: a assinatura gravada é igual à do evento
`invoice.paid` aplica o patch só quando `checkout_reference.stripe_subscription_id` é igual ao `subscriptionId` do evento.

Alternativa considerada: liberar também quando o campo está vazio, para cobrir uma primeira gravação. Rejeitada. O checkout já grava o ID e o `payment_state` ao criar a assinatura, então nenhuma gravação legítima depende do webhook. O intervalo entre criar a assinatura e gravar o checkout também não tem campo vazio: a linha está com o ID antigo. Aceitar vazio não cobriria esse intervalo. Só abriria o buraco que a spec proíbe, se algum caminho futuro passar a gravar um checkout sem assinatura.

**ID vazio nunca é dono.** A condição só compara IDs que o evento trouxe e que não são vazios. `JSON_EXTRACT(...) = ''` MUST NOT valer como dono. Se o evento não tiver nenhum ID utilizável, o patch não é aplicado.

**Intervalo entre o ledger e o `persistCheckout`.** Se a primeira `invoice.paid` da assinatura B for processada nesse intervalo, o `UPDATE` não encontra B na linha e não grava. A Stripe não reenvia um evento respondido com 200. O checkout fica correto mesmo assim, porque o `persistCheckout` grava B e o `payment_state` derivado do payment intent. Só o `stripe_invoice_id` fica fora, e ninguém lê esse campo do checkout. Nesse mesmo intervalo, uma fatura da assinatura antiga A casa com o ID antigo e atualiza o checkout antigo. Isso é inofensivo, porque o `persistCheckout` substitui o JSON inteiro logo depois. Hoje o comportamento é pior: o merge em memória pode reescrever o carrinho antigo por cima do novo.

Alternativa considerada: comparar `order_key` com `sub_${subscriptionId}`. Dá o mesmo resultado, mas depende de um formato de string derivado. O `stripe_subscription_id` é o campo que `evaluateCheckoutReuse` lê, então a trava fica nele.

### 2. A falha de pagamento é aceita pelo payment intent ou pela assinatura
`invoice.payment_failed` aplica o patch quando o payment intent gravado no checkout é igual ao do evento, ou quando a assinatura gravada é igual à do evento.

Motivo: uma falha da primeira cobrança pode chegar antes de qualquer outro webhook, e o checkout já tem os dois IDs. Aceitar qualquer um dos dois cobre a falha via payment intent (`payment_intent.payment_failed`, que não traz assinatura) e a falha de uma fatura da assinatura do checkout com um payment intent novo, por exemplo um retry da Stripe. Hoje há um `return` quando o ledger está `active`/`trialing`. Ele continua antes da trava e não muda.

### 3. Condição no repositório, como `UPDATE` condicional
`updateCheckoutReference(userId, patch, { subscriptionId, paymentIntentId })` passa a aceitar uma condição de dono opcional. Com a condição, a escrita vira uma única instrução: `UPDATE ... SET checkout_reference = JSON_MERGE_PATCH(checkout_reference, ?) WHERE user_id = ? AND (JSON_UNQUOTE(JSON_EXTRACT(checkout_reference, '$.stripe_subscription_id')) = ? OR ... payment_intent ...)`. O método devolve se aplicou ou não. Sem a condição, o comportamento atual se mantém, e `handlePaymentIntent` continua usando esse caminho.

Alternativa considerada: fazer a verificação no service, lendo antes de gravar. Rejeitada porque deixa uma janela de corrida entre a leitura e a escrita, em que um checkout novo pode gravar no meio.

`JSON_MERGE_PATCH` remove chaves com valor `null`. O patch atual usa `compact()`, que já tira `undefined`. A implementação MUST também tirar os `null` antes do merge, ou manter o merge em JS dentro de uma transação com `SELECT ... FOR UPDATE`. A escolha fica para a implementação. O requisito é a atomicidade e o mesmo resultado de `{ ...atual, ...compact(patch) }`.

### 4. Sem migração de dados
Não há produção (só QA). Os checkouts já misturados ficam como estão e se corrigem no próximo checkout do cliente.

## Risks / Trade-offs

- [O checkout grava um ID diferente do que a Stripe envia no evento, por exemplo um checkout reusado que troca de assinatura] → O ID gravado vem do mesmo objeto `subscription` criado ou reusado. O teste da primeira cobrança cobre o caminho feliz, e o teste de reuso cobre o checkout reusado.
- [Um evento legítimo deixa de atualizar o checkout e o `payment_state` fica preso em `requires_confirmation`] → `handlePaymentIntent` continua atualizando o status do payment intent, que `evaluateCheckoutReuse` também lê. O teste da primeira cobrança garante que o `paid` continua chegando.
- [A diferença entre `JSON_MERGE_PATCH` e o spread JS com valores `null`] → Tratada na Decisão 3, com um teste de que o patch conserva os campos existentes.

## Migration Plan

Deploy normal, sem mudança de schema. Para reverter, basta reverter o commit. O código antigo continua lendo o mesmo JSON.
