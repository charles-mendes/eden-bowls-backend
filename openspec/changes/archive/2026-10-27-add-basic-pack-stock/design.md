# Design

## Context

Ver `proposal.md` para o motivo. Estado atual que molda a solução:

- A Fila de produção (`AdminProductionService`) lista ciclos de `subscription_production_cycles` numa janela de 7, 14 ou 30 dias, com vencidos incluídos por padrão. O status de cada ciclo segue `to_prepare → in_production → ready`, com `blocked` como desvio. Só um ciclo pago entra em `in_production`.
- Os packs de cada ciclo vêm do snapshot do catálogo na linha do ledger (`catalog.line_items`: `flavor`, `quantity`, `pack_size_grams`, `pack_size_label`), com fallback para os pets do `plan_selection`. `production-queue-presenter.js` agrupa por receita, tamanho (rótulo) e pet. Hoje o rótulo é o que chega ao painel; os gramas se perdem no agrupamento.
- O snapshot do ledger é o da assinatura no momento, não um retrato congelado do ciclo. Se o cliente muda os packs, a fila passa a mostrar os novos.
- O escopo de mercado da fila usa `stripe_account` (`br`/`us`). Rotas de escrita do painel declaram `market: 'query'` e validam o mercado do corpo no serviço.
- Não existe tabela nem conceito de estoque.

## Goals / Non-Goals

**Goals:**

- Saldo auditável: o número na tela sempre se explica pelo histórico.
- O estoque concorda com a fila: o comprometido de um item é a soma do que a fila mostra para ele.
- A separação continua funcionando como hoje, com ou sem saldo.

**Non-Goals:**

- Matéria-prima, ficha técnica, compras e fornecedores.
- Lote, validade, FEFO.
- Reserva de saldo no checkout ou na renovação.
- Baixa no momento da etiqueta UPS.

## Decisions

### 1. Unidade: pack pronto por mercado, receita e gramas

A chave é `(market, flavor_key, pack_size_grams)`. Os gramas vêm de `pack_size_grams` da linha do catálogo. Sem ele, o sistema tenta ler o número do rótulo (`"300 g"`). Se não conseguir, a linha é "sem tamanho" e fica fora do estoque.

Alternativa considerada: usar `variation_id`. Rejeitada porque o ID muda quando o catálogo é ressincronizado com o Stripe, e linhas antigas e os pets do `plan_selection` não têm esse campo. Receita e gramas são estáveis e são exatamente o que a cozinha separa.

### 2. Histórico de movimentos com saldo em cache

Duas tabelas:

- `pack_stock_items`: `id`, `market` (`BR`/`US`), `flavor_key`, `pack_size_grams`, `on_hand` (inteiro com sinal), `min_level` (nulo), `created_at`, `updated_at`. Chave única em `(market, flavor_key, pack_size_grams)`.
- `pack_stock_movements`: `id`, `item_id`, `type` (`production`, `separation`, `separation_reversal`, `adjustment`), `quantity` (com sinal), `reason` (nulo, só em ajuste), `note` (nulo), `production_cycle_id` (nulo, só em separação e estorno), `subscription_id` (nulo), `actor_user_id` (nulo), `created_at`. Índices em `(item_id, created_at)` e `(production_cycle_id)`.

Cada escrita trava a linha do item (`SELECT ... FOR UPDATE`, criando-a se faltar), insere o movimento e soma a quantidade em `on_hand`, tudo na mesma transação. Quando a operação mexe em vários itens, as travas seguem a ordem da chave, para evitar deadlock.

Alternativas: só o contador (perde a auditoria) ou só os movimentos com `SUM` a cada leitura (a visão e a cobertura da fila fariam a soma em toda listagem). O cache mais o teste "saldo = soma dos movimentos" fica com o melhor dos dois.

### 3. Baixa na transição para `ready`, na mesma transação do status

A baixa acontece em `AdminProductionService.updateStatus` quando `fromStatus === 'in_production'` e `toStatus === 'ready'`. O estorno acontece quando `fromStatus === 'ready'` e `toStatus === 'in_production'`. O upsert do ciclo e os movimentos rodam numa única transação: um não grava sem o outro.

- Os movimentos referenciam `subscription_production_cycles.id`, e não `period_end`, porque `moveCycle` pode mudar o `period_end` de um ciclo.
- **Quantidades da baixa**: as `lineItems` que o presenter calcula para aquele ciclo no momento da transição, somadas por receita e gramas (somando os pets).
- **Ciclo já baixado**: se a soma dos movimentos de separação e estorno do ciclo for diferente de zero, ele já tem uma separação aberta e não baixa de novo. A trava é feita na linha do ciclo.
- **Estorno**: lê os movimentos de separação abertos do ciclo e grava o inverso exato. Ele não recalcula a partir do snapshot atual, que pode ter mudado.
- A resposta do `PATCH /production/queue/:id` ganha `stock: { shortages, unsized }`. Fica vazia quando nada faltou.

O momento da etiqueta UPS foi considerado e rejeitado: a etiqueta pode falhar ou ser refeita, e o pack sai da prateleira na separação.

### 4. Demanda e cobertura reaproveitam a consulta da fila

O repositório do ledger ganha `listQueueDemandRows(input)`: o mesmo `queueMembership` e o mesmo join de `listQueue`, sem `LIMIT`, com as colunas que o presenter usa. O serviço de estoque usa `civilBounds` com a mesma janela e inclui os vencidos, como a fila faz por padrão. Assim o comprometido de um item é, por construção, a soma do que a fila mostra.

- Contam só ciclos em `to_prepare` e `in_production`. `ready` já foi baixado, e `blocked` foi tirado da semana.
- `committedAwaitingPayment` é a parte com `paymentState` diferente de `paid`.
- **Cobertura**: os ciclos que contam são ordenados por `due_at`, depois `id`. O `on_hand` de cada item é distribuído nessa ordem. O resultado é um mapa `cycleKey → covered | short | unknown`. `listQueue` calcula o mapa uma vez por requisição, com a janela pedida, e anota os itens da página. Itens de outras páginas também consomem saldo, por isso o cálculo precisa da janela inteira.

O presenter passa a expor `packSizeGrams` em cada linha. O agrupamento por receita, tamanho e pet não muda, e os campos atuais seguem iguais.

**Linhas sem tamanho**: a mesma função pura que soma a demanda devolve as linhas descartadas, e a visão as expõe em `unsizedLines`. O serviço registra um `logger.warn` por linha descartada (`stock.unsized_line`, com `subscriptionId`, `productionCycleId` ou `periodEnd`, e o rótulo). O log fica no serviço, não na função pura, para que os testes do núcleo continuem sem efeitos colaterais.

**Medição**: não existe hoje latência por rota em `/metrics` (só as métricas padrão e as dos jobs). Em vez de instrumentar toda a API, o cálculo novo ganha duas métricas no padrão de `src/core/job-metrics.js`: o histograma `eden_stock_coverage_duration_seconds` (rótulo `source`: `queue` ou `overview`) e o gauge `eden_stock_demand_rows` com as linhas carregadas na última execução. Se o p95 da fila passar de algumas centenas de milissegundos, entra o `includeStock=true` descrito em Riscos.

### 5. Rotas e permissões

| Rota | Permissão | Escopo |
|---|---|---|
| `GET /api/v1/admin/stock?market=&windowDays=` | `production.read` | `query` |
| `GET /api/v1/admin/stock/movements?market=&flavorKey=&packSizeGrams=&type=&page=&perPage=` | `production.read` | `query` |
| `POST /api/v1/admin/stock/production` | `production.write` | `query` (mercado do corpo validado no serviço) |
| `POST /api/v1/admin/stock/adjustments` | `production.write` | `query` (idem) |
| `PUT /api/v1/admin/stock/minimum` | `production.write` | `query` (idem) |

- `market` é obrigatório para quem vê os dois mercados. Para quem tem um só, o padrão é o mercado da pessoa.
- `windowDays` aceita 7, 14 ou 30, como na fila (`invalid_window_days`). O padrão é 7.
- As escritas recebem `{ market, flavorKey, packSizeGrams, ... }` no corpo, porque um item pode não ter linha ainda.
- Permissões reaproveitadas, porque quem opera a fila é quem opera a cozinha. Um `stock.*` separado só faria sentido com papéis diferentes, e hoje não há.
- O lançamento de produção, o ajuste e o mínimo também gravam no `AdminAuditService` (`stock.production`, `stock.adjustment`, `stock.minimum.update`). A separação já é auditada por `production.status.update`.

### 6. Validação da chave contra o catálogo

`flavorKey` passa por `flavorKeyFromLabel`. A combinação é aceita quando o catálogo do mercado tem, em qualquer status, uma variação com essa receita e esses gramas (arredondados), ou quando o item já existe. Aceitar variações inativas deixa a cozinha dar baixa no estoque de uma receita que saiu de linha.

## Risks / Trade-offs

- [O snapshot do ledger muda quando o cliente ajusta os packs, então a demanda de um ciclo ainda não separado pode mudar até a separação] → É o mesmo comportamento da fila hoje. O estorno usa o que foi baixado, nunca o snapshot.
- [Saldo negativo pode confundir] → A visão mostra o "a produzir" e o painel destaca o negativo. A resposta da separação lista as faltas.
- [A cobertura carrega a janela inteira a cada listagem da fila] → Volume atual de centenas de ciclos. Uma consulta extra por listagem, sem N+1. Se crescer, passa a ser calculada só sob demanda (`includeStock=true`).
- [Linhas sem tamanho] → Ficam fora do estoque, são contadas em `unsized` e marcam o ciclo como `unknown`, para não sumirem em silêncio.
- [Concorrência entre separações de ciclos diferentes que mexem nos mesmos itens] → Travas por item na ordem da chave, dentro da transação.
- [Verificar as tabelas uma vez por processo não percebe um rollback feito com a API no ar] → Rollback de migração já exige reiniciar a API. Se a escrita falhar mesmo assim, o erro desfaz a transação inteira e o operador vê a falha, sem baixa pela metade.

## Migration Plan

1. Migração com o próximo número livre, registrada em `src/infrastructure/db.js`. As tabelas nascem vazias, e todo item começa em 0.
2. Deploy da API antes do painel. Enquanto o painel antigo estiver no ar, a separação já dá baixa, e o campo `stock` novo é ignorado.
3. No primeiro dia, a cozinha conta o freezer e lança cada item como ajuste com motivo `count`.
4. Rollback: `down` remove as duas tabelas. O serviço da fila trata tabela ausente como "sem estoque" (padrão `isMissingTableError` do repositório), e a separação segue sem baixa. Isso vale também para a **escrita**. Dentro da transação da separação, um erro de tabela ausente vindo do estoque não pode desfazer a mudança de status. Por isso o repositório verifica a existência das tabelas uma vez por processo, antes de abrir a transação, e o serviço pula os movimentos quando elas não existem. Capturar o erro no meio da transação não serve, porque no MySQL o erro já teria desfeito o upsert do ciclo.
