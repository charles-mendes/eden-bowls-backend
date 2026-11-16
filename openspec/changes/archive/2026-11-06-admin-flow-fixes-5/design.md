# Design

## Context

Veja `proposal.md` (Why). O que existe hoje e importa aqui:

- **Courier.** `listQueue` lê `listPaidCourierCycles({ deliveryFloor, limit: 201 })`, ordenado por data de entrega, e corta em 200 **antes** de separar os grupos: um ciclo já em rota, entregue (inclusive há 8 a 30 dias, fora de "Entregues") ou com falha ocupa vaga e não aparece em "A despachar". "Em rota", "Falhas" e "Entregues" vêm da tabela `courier_deliveries`, não dessa lista. `countQueue` (Hoje) conta "a despachar" com `countPaidCourierCyclesToDispatch`, a partir do piso e sem teto.
- **Etiquetas.** `listLabelQueue` lê `listPaidLabelCycles({ deliveryFloor, limit: 101 })` e separa prontos, sem confirmação e criadas a partir dessa mesma lista. O piso usa o relógio UTC menos 30 dias.
- **Bloqueio.** `AdminProductionService.updateStatus` resolve o ciclo (pago, ou o não pago atual, com `production_period_stale`) e chama `CustomerDeliveriesService.onProductionStatus`. Esse método calcula com `planBlockTrialEnd` e já chama a Stripe em seguida.
- **Estoque.** `allocateCoverage` (`src/core/pack-stock.js`) distribui o saldo por ordem de entrega e devolve só `covered`/`short`/`unknown` por ciclo.
- **Hoje.** `fulfillment` já reúne contagens próprias (courier, NF-e, UPS, Bling). Os problemas de endereço (`delivery_address_issues`) e as exceções de mercado (`listMarketExceptions`) existem desde o lote 3, sem contagem.

## Goals / Non-Goals

**Goals:**

- As filas mostram o recorte do dia e dizem o que ficou fora.
- O painel sabe a data da cobrança adiada antes de bloquear.
- O painel sabe qual receita falta em cada pedido `short`.
- O Hoje conta problemas de endereço e exceções.

**Non-Goals:**

- Paginação das filas.
- Uma rota de lote para a produção.
- Contar "prontos aguardando NF-e" (lote 4).
- Mudar a regra do bloqueio ou da distribuição de estoque.

## Decisions

### 1. Um parser de período compartilhado

`src/core/delivery-range.js` recebe `{ from, to }` da query, a data de hoje no fuso do mercado e o piso de 30 dias. Devolve `{ from, to, default }` ou lança `400 invalid_delivery_range`.

- **Fuso.** Courier em `America/Sao_Paulo`, como hoje. Etiquetas passam a usar `America/New_York` para "hoje", "amanhã" e o piso, no lugar do relógio UTC (as duas specs nomeiam o fuso).
- **Teto.** `to` no máximo 31 dias depois de `from`, contados como diferença de datas (`to - from <= 31`). O padrão (hoje − 30 até amanhã) dá exatamente 31 e passa; o teste do padrão crava essa conta. O teto impede que um período longo volte a esbarrar no corte em silêncio.

**Alternativa:** validar na rota com o padrão dos outros validadores. Rejeitada porque os dois services precisam do mesmo "hoje" que a regra usa para o piso, e o Hoje precisa do mesmo recorte padrão.

### 2. O período e o limite valem só para o que ainda não saiu

- **Courier.** `listPaidCourierCycles` ganha `deliveryCeiling` e passa a excluir na SQL a fatura com entrega `out_for_delivery`, `delivered` ou `failed`, o mesmo `NOT EXISTS` (com `COLLATE`) de `countPaidCourierCyclesToDispatch`. O corte de 200 passa a ser de "A despachar", e a lista e a contagem do Hoje usam a mesma regra.
  - **Efeito no serviço.** Os ciclos de "Em rota", "Falhas" e "Entregues" já vêm de `listPaidCyclesByInvoiceIds` quando não estão na página. Passam a vir sempre por ali, e a separação em memória continua como garantia.
- **Etiquetas, duas consultas.**
  - **Prontos.** `listPaidLabelCycles` com `deliveryCeiling`, só ciclos cuja fatura não tem etiqueta fora de `voided`, e o limite de 101.
  - **Etiquetas ativas.** Uma consulta nova, `listLabelCyclesWithActiveShipment({ deliveryFloor })`, traz os ciclos com etiqueta `pending`, `unknown` ou `created`, sem teto de data e sem ocupar as 100 vagas.

  Os dois `EXISTS` usam o `COLLATE` das outras consultas cruzadas (`ups_shipments` tem outra collation). Uma etiqueta `delivered` sai das duas, como hoje.

**Alternativa:** uma consulta só, com `(chave <= teto OR EXISTS etiqueta ativa)`. Rejeitada: o limite de 100 seria da lista inteira, e cem prontos no período empurrariam uma etiqueta criada para fora, contra a spec.

### 3. `later` e `next_from`

- **`later`** é uma contagem própria, com a mesma regra da lista a partir do dia seguinte a `to`:
  - courier: `countPaidCourierCyclesToDispatch` com piso `to + 1`;
  - etiquetas: uma contagem nova, ciclos pagos sem etiqueta ativa.

  Não herda o limite.
- **`next_from`** vem da linha 201 (ou 101) da consulta de "A despachar" (ou de prontos), que ela já traz para saber se cortou. Como as duas consultas só trazem o que ainda não saiu, essa linha é de fato o primeiro pedido que ficou fora. Como a ordem é por data de entrega, abrir a fila a partir dessa data mostra o que ficou fora. Pedidos dessa mesma data que já apareceram voltam a aparecer, o que é aceitável.

### 4. Hoje segue o recorte padrão

`countQueue` passa `deliveryCeiling` = amanhã para `countPaidCourierCyclesToDispatch`, e o número do card bate com a lista que ele abre. Ciclos com entrega mais distante ainda não são trabalho do dia.

### 5. Prévia do bloqueio sem efeito

- **`CustomerDeliveriesService`.** A parte de `onProductionStatus` que monta a entrada de `planBlockTrialEnd` (linhas, `followingChargeAt`, `transitDays`) vira um método `planFor(...)`. `onProductionStatus` passa a usá-lo antes da Stripe, e um `previewBlock(...)` novo usa só ele.
- **`AdminProductionService`.** A resolução do ciclo no início de `updateStatus` vira um helper interno (`resolveCycle`). A prévia e a mudança de status aplicam assim as mesmas recusas: `404`, `production_not_eligible`, `production_period_stale` e o escopo de mercado.
- **Rota.** `GET /admin/production/queue/:id/block-preview`, com `production.write` porque só quem pode bloquear precisa da prévia, e `market: 'record'`. `periodEnd` vai na query.

**Alternativa:** pôr a data da cobrança adiada em cada item da fila. Rejeitada: calcularia o calendário para toda linha não paga a cada leitura, para um modal raro.

### 6. Faltas por receita na distribuição existente

`allocateCoverage` passa a devolver, por ciclo, `{ coverage, shortages }`. A ordem continua a de vencimento (`dueAt`: dia de preparo ao meio-dia, ou o fim do período), não a de entrega: nos EUA a entrega é o preparo mais o trânsito.

- **`missing`.** Para cada pack, é a parte da quantidade que o saldo restante não cobriu: `quantidade - max(0, min(quantidade, restante antes))`.
- **Nome.** `queueCoverage` repassa o mapa, e `AdminProductionService` põe `stockShortages` no item, com o nome da receita vindo de `loadRecipeNames`, o mesmo usado na tela de estoque.

Quem lê só `stockCoverage` não muda.

### 7. Contagens novas do Hoje

- **`DeliveryAddressIssuesRepository.countOpenByAccount({ staleBefore, stripeAccounts })`.** Um `GROUP BY stripe_account` com `SUM(opened_at <= ?)` para `stale`, e `staleBefore` = agora − 72 h. É o corte de `addressIssueState` no painel (`floor(decorrido / 24 h) > 2`, isto é, a partir de 3 dias inteiros), para o Hoje não chamar de parado o que a linha ainda não mostra como parado.
- **`SubscriptionLedgerRepository.countMarketExceptions({ stripeAccounts })`.** Usa o mesmo `WHERE` de `listMarketExceptions`, extraído para os dois, com `GROUP BY stripe_account` e sem o limite de 200. Com mais de 200, o Hoje mostra o total e a página mostra as 200 primeiras com o aviso de corte que já tem.
- **Injeção.** `AdminTodayService` recebe os dois repositórios em `src/index.js`. Sem eles, as contagens são 0, como as outras.

## Risks / Trade-offs

- **[Risco] O painel atual passa a ver só até amanhã nas filas.** → O painel sai no mesmo dia, com o filtro de período. Até lá, "Próximos dias" some da tela, mas `later` já vem na resposta.
- **[Risco] O número de problemas do Hoje é maior que a fila filtrada.** Ele conta todos os problemas abertos da conta. A fila filtrada mostra só os do recorte padrão: "A despachar" e "Falhas" no courier, "Prontos" nas etiquetas. Não entram um problema num ciclo depois de amanhã nem numa etiqueta já criada. → Registrado no spec do painel, com texto de lista vazia e o seletor de período ao lado.
- **[Risco] `next_from` repete pedidos da mesma data.** → Aceitável no volume atual. A paginação fica para quando X-01 pedir.
- **[Risco] A prévia e o bloqueio podem divergir se o calendário mudar entre os dois.** → A prévia é lida ao abrir o modal. O bloqueio recalcula, e o resultado do `PATCH` é o que vale.
- **[Risco] Falta por distribuição não é saldo negativo.** Um pedido `short` pode não deixar o saldo negativo se os anteriores ainda não foram separados. → O painel fala em "falta pela ordem da fila", não em saldo negativo garantido (spec do painel).

## Migration Plan

- Sem migração.
- Deploy da API antes do painel `admin-flow-fixes-5`, no mesmo dia.
- Rollback: reverter o deploy. Os campos novos são aditivos, e a rota nova só é chamada pelo painel novo.
