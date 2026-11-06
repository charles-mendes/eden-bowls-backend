# Design

## Context

- `CourierDeliveryService.dispatch` faz, nesta ordem: market e fatura (`requireDeliverableInvoice`), endereço (`brazilAddressIssues`, trava sem confirmação), prontidão (`readinessReasons`, liberada por `confirm_not_ready`), inserção.
- `CourierDeliveryService.listQueue` monta os quatro grupos e já lê em lote os problemas de endereço (`attachAddressIssues`). `countQueue` alimenta o Hoje com `countPaidCourierCyclesToDispatch` do ledger, no recorte padrão (30 dias atrás até amanhã).
- `BlingNfeRepository` lê uma nota por `findByStripeInvoice(account, invoiceId)`. A tabela `bling_nfe` tem índice único `stripe_account` + `stripe_invoice_id`.
- O `CourierDeliveryService` não recebe hoje o repositório de NF-e. `src/index.js` cria `blingNfeRepository` antes do serviço de courier.
- O ledger já cruza a tabela de courier, que usa outra collation, com `COLLATE utf8mb4_unicode_ci` dos dois lados.

## Goals / Non-Goals

**Goals:**

- A trava é uma checagem só, chamada no `dispatch`, e o mesmo valor do interruptor chega à fila e ao Hoje.
- A fila lê as notas da página numa consulta, não uma por linha.

**Non-Goals:**

- Mudar o que o job do Bling faz, ou o fluxo de "Nova tentativa" da NF-e.
- Travar uma entrega que já saiu quando a nota é cancelada depois.
- Registrar notas de faturas antigas (sem produção, não há o que registrar).
- Travar a etiqueta UPS: a NF-e é só do Brasil.

## Decisions

- **Interruptor lido uma vez, no `env.js`, desligado por padrão.** `COURIER_REQUIRE_AUTHORIZED_NFE: toBoolean(raw, false)`. O `index.js` passa `requireAuthorizedNfe` ao `CourierDeliveryService`. Alternativas descartadas:
  - padrão `NODE_ENV === 'production'`, como `AUTH_REFRESH_COOKIE_SECURE`: o QA roda com `NODE_ENV=production` (`.env.qa.example`) e travaria sozinho;
  - ligar quando o Bling estiver configurado (`BLING_CLIENT_ID`): o QA tem o app de homologação configurado, e credencial presente não quer dizer OAuth conectado; configurado e desconectado trava a fila inteira.

  O risco de esquecer a variável em produção fica com o checklist de `docs/production-go-live.md`, que já lista o que é obrigatório lá.
- **A checagem fica entre o endereço e a prontidão.** As duas travas sem confirmação vêm antes da que se confirma, então um `confirm_not_ready` nunca chega a uma caixa sem nota. Endereço primeiro, porque um endereço incompleto também segura a nota (PM-22), e a mensagem de endereço é a que o operador resolve.
- **422, não 409.** O 409 do courier quer dizer "confirme e tente de novo". A nota não se confirma, assim como `courier_address_incomplete`, que já é 422.
- **Leitura em lote no repositório de NF-e.** Método novo `listByStripeInvoices(pairs)` com `(stripe_account, stripe_invoice_id) IN ((?, ?), …)`, que usa o índice único. O serviço devolve um `Map` por `account|invoiceId`. Alternativa: `findByStripeInvoice` por linha. Descartada: 200 consultas por leitura da fila.
- **A conta da nota é a conta do ciclo.** A linha usa `cycle.stripeAccount` (ou `row.stripe_account` numa falha sem ciclo). Uma nota de mesma fatura em outra conta não conta.
- **Contagem do Hoje no ledger.** `countPaidCourierCyclesToDispatch` ganha `nfeTableName` opcional. Com ele, soma a condição `NOT EXISTS (SELECT 1 FROM bling_nfe n WHERE n.stripe_account = q.stripe_account AND n.stripe_invoice_id COLLATE utf8mb4_unicode_ci = q.paid_invoice_id COLLATE utf8mb4_unicode_ci AND n.status = 'authorized')`. Assim a contagem segue a regra de "A despachar" sem o teto de 200. `countQueue` devolve `awaitingNfe` (null com a trava desligada) e o Hoje expõe `courierAwaitingNfe`.
- **`nfe` só onde a caixa ainda vai sair.** "A despachar" e "Falhas" ganham `nfe`; "Em rota" e "Entregues" não, porque a caixa já saiu.

## Risks / Trade-offs

- [Esquecer a variável em produção] → a caixa sai sem nota, como hoje. Mitigação: o item obrigatório no checklist de `docs/production-go-live.md`.
- [Bling fora do ar em produção] → nenhuma caixa do Brasil sai. O Hoje já mostra "Bling desconectado" ao admin, e agora "N pedidos aguardando NF-e". Desligar a trava é trocar a variável e reiniciar a API.
- [Collation entre `bling_nfe` e o ledger] → o `COLLATE` explícito dos dois lados, como na tabela de courier, e um teste de integração com MySQL.
- [Nota cancelada depois da saída] → fora do escopo; a entrega segue, e a nota aparece cancelada na lista de NF-e.

## Migration Plan

1. Subir com a variável ausente: QA, local e teste ficam sem trava.
2. Produção: `COURIER_REQUIRE_AUTHORIZED_NFE=true`, item do checklist de `docs/production-go-live.md`, com o Bling conectado antes de abrir.
3. Para ensaiar a trava no QA, ligar a variável e conectar o Bling de homologação.
4. Reverter: `COURIER_REQUIRE_AUTHORIZED_NFE=false`, sem deploy de código.
