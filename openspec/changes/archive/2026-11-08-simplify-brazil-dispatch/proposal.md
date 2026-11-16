# Proposal

## Why

"A despachar" lista todo pedido pago do Brasil que ainda não saiu, pronto ou não. O operador vê o trabalho da cozinha de novo na expedição, e o Hoje conta a mesma caixa em "preparo não iniciado" e em "a despachar". O botão Expedir da fila abre a lista sem a fatura. A change irmã `simplify-brazil-dispatch` em `eden-bowls-admin` consome o que esta muda.

## What Changes

- **BREAKING** `GET /admin/courier-deliveries/queue`: "A despachar" passa a listar só ciclos com preparo `ready`. `later`, o corte de 200 e `next_from` seguem o mesmo recorte. `preparo=todos` devolve a lista de hoje (pago, ainda sem saída). Outro valor de `preparo` responde `400 invalid_preparo`. A resposta leva `preparo` (`prontos` ou `todos`).
- O despacho de um pedido que não está pronto continua pedindo `confirm_not_ready`. Endereço incompleto e, com a trava ligada, NF-e não autorizada continuam trava, sem confirmação que as solte.
- Cada item da fila de produção passa a trazer `paidInvoiceId` (a fatura paga do ciclo, ou `null` quando o ciclo não está pago), para o Expedir abrir aquele pedido.
- `fulfillment.courierToDispatch` conta só ciclos `ready` no período padrão de "A despachar". `courierAwaitingNfe` continua subconjunto dessa conta (prontos sem NF-e autorizada) e `null` com a trava desligada. Notas sem CPF, rejeitada e com erro não mudam.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `courier-delivery`: "A despachar" abre em prontos, com `preparo=todos` para o restante; a fila de produção nomeia a fatura paga.
- `admin-today`: a conta de pedidos a despachar passa a ser a dos prontos.

## Impact

- `src/services/courier-delivery.service.js` e `src/infrastructure/repositories/subscription-ledger.repository.js`: filtro e contas de "A despachar".
- `src/core/production-queue-presenter.js`: `paidInvoiceId`.
- `src/services/admin-today.service.js` (via a conta do courier): `courierToDispatch` e `courierAwaitingNfe`.
- Testes de fila, de Hoje e do presenter. Sem endpoint novo de lote e sem mudar `COURIER_REQUIRE_AUTHORIZED_NFE`.
- O painel precisa sair junto: sem a change irmã, "A despachar" some com o que ainda está na cozinha e não oferece "mostrar todos".
