# Proposal

## Why

Fizemos uma caminhada com um operador do Brasil em 08/11/2026 (relatório "Fluxo do operador Brasil — relatório de complexidade") e apareceram três quebras:

- **Pedido atrasado some da fila.** Quando o pedido é marcado pronto, sai da fila de produção. Assim o Expedir nunca aparece.
- **Hoje conta pedido travado.** O Hoje mostrou "4 pedidos a despachar", mas os 4 estavam travados pelo endereço (falta o nome de quem recebe). Nenhum podia sair.
- **A trava aparece tarde.** A trava de endereço só aparece na Entregas Brasil ou como erro, depois que o operador preenche o despacho pela assinatura.

A change irmã `keep-ready-orders-dispatchable` em `eden-bowls-admin` consome o que esta muda.

## What Changes

- **Fila de produção:** um ciclo pago do Brasil, `ready`, sem entrega em rota, entregue ou com falha, continua na fila depois do dia de preparo. Isso vale enquanto o preparo for de até 30 dias atrás (o mesmo piso de "A despachar"). Hoje a parte de atrasados da fila tira todo ciclo `ready`. Os ciclos dos EUA não mudam.
- **Contas de atrasados:** as contas de "Atrasados" (metrics da fila e totais do Hoje) passam a contar só ciclos que não estão `ready`. Elas continuam querendo dizer "o preparo atrasou". O ciclo pronto que espera a saída é contado em "a despachar".
- **Hoje:** `fulfillment` passa a trazer `courierAddressLocked`. É a parte de `courierToDispatch` cujo endereço a regra de despacho recusaria (`brazilAddressIssues`). Vale 0 para quem não vê o Brasil.
- **Itens da fila de produção:** cada item passa a trazer `courierIssues`. Num ciclo cujo mercado de envio é o Brasil (conta `br` e endereço no Brasil), são os códigos que o despacho recusaria, vazio quando o endereço passa. Nos outros casos é `null`.
- **Detalhe da assinatura:** com `detail` (página do painel), o detalhe passa a trazer `courier_issues` pela mesma regra.
- **Sem mudança:**
  - a regra que recusa o despacho (`courier_address_incomplete`);
  - o problema de endereço, que continua abrindo só num evento (pagamento, tentativa de despacho, compra de etiqueta, falha por endereço, NF-e). "Marcar como pronto" com o endereço travado não é um evento: o operador vê a trava e decide;
  - o e-mail ao cliente;
  - `COURIER_REQUIRE_AUTHORIZED_NFE`.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `courier-delivery`: a fila de produção mantém o pedido pronto do Brasil até a saída e mostra a trava de endereço no item e no detalhe da assinatura.
- `admin-today`: atrasados contam só o preparo atrasado; `fulfillment` conta os pedidos a despachar travados por endereço.
- `delivery-address-issues`: marcar pronto um pedido com o endereço travado não abre problema nem manda e-mail; a leitura do Hoje, da fila e da assinatura também não.

## Impact

- `src/infrastructure/repositories/subscription-ledger.repository.js`:
  - `queueMembership`, na parte de atrasados;
  - nova leitura dos endereços dos ciclos a despachar, com a regra de `countPaidCourierCyclesToDispatch`.
- `src/services/courier-delivery.service.js`: `countQueue` devolve `addressLocked`.
- `src/services/admin-today.service.js`: `courierAddressLocked` e a conta de atrasados sem os `ready`.
- `src/services/admin-production.service.js`: metrics de atrasados sem os `ready`.
- `src/core/production-queue-presenter.js`: `courierIssues`.
- `src/services/admin-billing.service.js`: `courier_issues` no detalhe.
- Pack-stock não muda: ciclo `ready` já não entra no comprometido.
- Testes: repositório da fila (unit e integração), Hoje, produção, courier, presenter e billing.
- Sem rota nova; o manifesto de rotas não muda.
- O painel precisa sair junto. Sem a change irmã, a fila mostra o pronto atrasado sem um grupo próprio e ninguém lê os campos novos.
