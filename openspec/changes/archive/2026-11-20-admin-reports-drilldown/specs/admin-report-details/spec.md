# Spec Delta

## Purpose

Deixar o operador partir de qualquer número da tela de Relatórios e chegar aos registros que o formam, com critérios, memória de cálculo, subtotais e total. A soma desses registros MUST bater com o valor exibido no relatório consolidado.

## ADDED Requirements

### Requirement: Rota de detalhamento

A API SHALL expor `GET /api/v1/admin/reports/details` com `report`, `indicator`, `market`, `from`, `to` e `granularity` com o mesmo significado e as mesmas validações do relatório consolidado (`report_period_invalid`, `report_market_required`, `market_forbidden`). A rota MUST exigir `reports.read`, MUST declarar `marketScope` `query`, MUST NOT gravar dados e MUST constar em `docs/api-routes.json`.

#### Scenario: Readonly abre o detalhamento

- **WHEN** uma sessão `readonly` com `BR` chama `GET /api/v1/admin/reports/details?report=revenue&indicator=grossRevenue&market=BR`
- **THEN** a API responde `200` com o detalhamento do faturamento bruto BR do período padrão

#### Scenario: Mercado fora da sessão

- **WHEN** um operador com `BR` pede `market=US`
- **THEN** a API responde `403` com code `market_forbidden` e nenhum registro US

#### Scenario: Veterinário não acessa

- **WHEN** uma sessão só `veterinarian` chama a rota
- **THEN** a API responde `403`

### Requirement: Indicador usa a mesma chave do CSV do relatório

`indicator` MUST ser a chave que identifica o valor na coluna `Chave` do CSV agregado (ex.: `grossRevenue`, `current.pastDue`, `stages.linked`, `conversions.startedToActivated`, `recipes.<receita>.packs`, `packSizes.<gramas>.share`, `cycles.to_prepare`, `shipments.byStatus.<status>`, `rows.<receita>.<gramas>.produced`, `totals.onHand`, `series.revenue`). Chave desconhecida para o `report` MUST responder `400` com code `report_indicator_unknown`.

#### Scenario: Chave da linha do CSV abre o mesmo valor

- **WHEN** o CSV de Assinaturas tem a linha `Pagamento atrasado` com `Chave` `current.pastDue` e valor `2`
- **THEN** `GET /api/v1/admin/reports/details?report=subscriptions&indicator=current.pastDue` devolve valor `2` e dois registros

#### Scenario: Indicador inexistente

- **WHEN** o caller pede `report=revenue&indicator=customers`
- **THEN** a API responde `400` com code `report_indicator_unknown`

### Requirement: Detalhamento de um ponto da série

Para chaves `series.*`, a rota MUST aceitar `bucket` com a `key` de um bucket do mesmo relatório para o mesmo período e agrupamento. O detalhamento MUST usar os limites exatos daquele bucket, inclusive o corte parcial. A ausência de `bucket` MUST detalhar o total do período. Um `bucket` fora da série MUST responder `400` com code `report_bucket_invalid`.

#### Scenario: Barra de um dia

- **WHEN** a série diária de Receita US tem o bucket `2026-11-05` com faturamento `229500`
- **THEN** o detalhamento de `series.revenue` com `bucket=2026-11-05` lista as faturas pagas naquele dia em America/New_York e soma `229500`

#### Scenario: Bucket inexistente

- **WHEN** o caller pede `bucket=2027-01-01` num período de outubro
- **THEN** a API responde `400` com code `report_bucket_invalid`

### Requirement: Detalhamento do período anterior

A rota MUST aceitar `period=previous` para indicadores de período. Nesse caso ela detalha o valor `previous` do card, usando a janela `period.previous` do relatório. Para indicadores de agora (status atual de assinaturas, MRR estimado, aguardando pagamento, saldo, mínimo e o mix), `period=previous` MUST responder `400` com code `report_detail_no_previous`.

#### Scenario: Conferir a comparação

- **WHEN** o card Faturas pagas BR mostra `3` e anterior `3`, e o operador abre o detalhamento com `period=previous`
- **THEN** a resposta lista as 3 faturas pagas de `period.previous.from` a `period.previous.to`

#### Scenario: Indicador de agora não tem anterior

- **WHEN** o caller pede `indicator=current.active&period=previous`
- **THEN** a API responde `400` com code `report_detail_no_previous`

### Requirement: Conteúdo do detalhamento

A resposta MUST trazer: `label` e `description` do indicador em português; `kind` (`money`, `count` ou `rate`); `currency`; `value`, igual ao do relatório consolidado na mesma consulta; a janela aplicada; `criteria`, a lista dos filtros e regras aplicados em texto; `formula`, a expressão e os termos com valor; `groups`, os subtotais; `records`, os registros de origem paginados; `totals`; e `reconciliation`.

#### Scenario: Ticket médio mostra a conta

- **WHEN** o detalhamento de `averageTicket` US tem 2 faturas pagas que somam `229500`
- **THEN** `formula` mostra `Faturamento bruto ÷ Faturas pagas` com os termos `229500` e `2`, e `value` é `114750`

#### Scenario: Critérios do faturamento

- **WHEN** o operador abre `grossRevenue`
- **THEN** `criteria` diz que entram faturas `paid` da conta do mercado, na moeda do mercado, emitidas na janela local, com impostos e frete, sem descontar reembolsos

### Requirement: A soma dos registros bate com o card

Para indicadores de soma ou contagem, a soma das contribuições de todos os registros MUST ser igual a `value`. Para taxas e médias, numerador e denominador MUST ser somas de registros e `value` MUST ser a conta entre eles. `reconciliation` MUST trazer `reportValue`, `recordsValue` e `matches`. Uma divergência MUST aparecer na resposta, nunca ser escondida ou ajustada, e MUST gerar log de erro.

#### Scenario: Soma confere

- **WHEN** o card Faturamento bruto BR mostra `307741`
- **THEN** o detalhamento tem `reconciliation.reportValue` `307741`, `recordsValue` `307741` e `matches` `true`

#### Scenario: Divergência é exibida

- **WHEN** a consulta agregada e a de registros dão valores diferentes
- **THEN** a resposta traz `matches: false` com os dois valores, e a API registra log de erro com report, indicator, market e janela

### Requirement: Registros de origem

Cada registro MUST trazer `id` interno, `type`, `reference` legível (ex.: `Fatura EB-2026-000123`, `Assinatura #42`, `Checkout #17`, `Ciclo #88`, `Envio #5`, `Movimento #301`), `date`, `description`, `group`, `contribution` (o quanto entra no indicador, na unidade dele) e `link` para a tela do painel que já mostra aquele registro, quando ela existir. Os registros MUST vir ordenados por data e depois por `id`.

#### Scenario: Fatura com link

- **WHEN** o detalhamento de `grossRevenue` lista uma fatura paga da assinatura 42
- **THEN** o registro tem `reference` com o número da fatura, `contribution` em centavos e `link` `/billing/subscriptions/42`

### Requirement: Paginação sem perder o total

`records` MUST ser paginado com `page` e `perPage` (padrão 50, máximo 200). `totals`, `groups` e `reconciliation` MUST ser calculados sobre todos os registros do indicador, não só sobre a página.

#### Scenario: Segunda página mantém o total

- **WHEN** um indicador tem 120 registros e o caller pede `page=2&perPage=50`
- **THEN** `records.items` tem 50 registros, `records.total` é `120`, e `totals` e `reconciliation` são os do indicador inteiro

### Requirement: Registros excluídos ficam visíveis

Quando a regra do relatório deixa registros de fora e os conta à parte, o detalhamento MUST listá-los em `excluded`, com o motivo, sem somá-los. Isso vale para faturas em outra moeda, assinaturas em teste ou sem preço no MRR, envios cancelados no total UPS e checkouts sem mercado (só admin).

#### Scenario: Faturas em outra moeda

- **WHEN** o período US tem 2 faturas pagas em outra moeda na conta `us`
- **THEN** o detalhamento de `grossRevenue` lista as 2 em `excluded` com motivo "moeda diferente do mercado", e elas não entram em `recordsValue`

#### Scenario: MRR mostra quem ficou de fora

- **WHEN** uma assinatura US está `trialing`
- **THEN** ela aparece em `excluded` do `estimatedMrr` com motivo "em teste", e não no total

### Requirement: Origem dos registros de Receita

Os indicadores de Receita MUST listar as faturas de cliente da conta do mercado: faturamento, faturas pagas, ticket médio e as barras listam as faturas pagas da janela; primeira compra só `subscription_create` e renovações as demais, cada uma agrupada por motivo de cobrança. O MRR estimado MUST listar as assinaturas `active` e `past_due` com o preço mensal guardado no plano (todo preço cobra por mês).

#### Scenario: Primeira compra e renovação somam o faturamento

- **WHEN** o período tem uma fatura `subscription_create` de `100000` e uma `subscription_cycle` de `50000`
- **THEN** `grossRevenue` tem dois grupos, com subtotais `100000` e `50000`, e total `150000`

#### Scenario: MRR de uma assinatura

- **WHEN** uma assinatura ativa tem `catalog_pricing.subtotal` `150` no plano
- **THEN** o registro do MRR tem contribuição `15000` em centavos, e a soma dos registros é o `estimatedMrr` do card

### Requirement: Origem dos registros de Assinaturas

Os indicadores de agora MUST listar as assinaturas no status do card (renovam em 7 dias pela próxima cobrança). Novas MUST listar as de `activated_at` na janela e canceladas as de `canceled_at` na janela. Ativas no início MUST listar a base do churn, marcando as canceladas no período. Datas aproximadas MUST vir marcadas.

#### Scenario: Churn separa numerador e denominador

- **WHEN** 10 assinaturas estavam ativas no início e 1 delas cancelou no período, e outra ativou e cancelou dentro do período
- **THEN** o detalhamento de `churn` tem o denominador com as 10 assinaturas, o numerador com 1 e `value` `0.1`, e a que começou e terminou no período aparece só em `canceled`

#### Scenario: Data aproximada marcada

- **WHEN** uma das novas assinaturas tem `activated_at` preenchido pelo backfill
- **THEN** o registro dela vem com `approximateDate: true`

### Requirement: Origem dos registros de Aquisição

As etapas do funil MUST listar os checkouts do mercado criados na janela: iniciados todos, vinculados os que têm assinatura Stripe na conta do mercado, ativados os que têm assinatura com `activated_at`. Cada registro MUST mostrar a etapa mais alta atingida. As conversões MUST usar as etapas como numerador e denominador. Para admin, `excluded` MUST listar os checkouts sem mercado.

#### Scenario: Conversão total

- **WHEN** a janela US tem 1 checkout iniciado e nenhum ativado
- **THEN** `conversions.startedToActivated` tem denominador com 1 checkout, numerador vazio e `value` `0`

### Requirement: Origem dos registros de Mix

As linhas do Mix MUST listar, por assinatura `active`, `trialing` ou `past_due` do mercado, os itens da assinatura com receita, tamanho de pack e quantidade por ciclo. A participação MUST mostrar os packs da linha como numerador e o total de packs do mercado como denominador.

#### Scenario: Packs de uma receita

- **WHEN** a receita Beef US tem 88 packs por ciclo em 3 assinaturas
- **THEN** `recipes.beef.packs` lista 3 assinaturas cujas quantidades somam `88`

### Requirement: Origem dos registros de Operação

Os status de ciclo e atrasados MUST listar os ciclos pagos com entrega na janela, com status, dia de preparo e entrega (atrasados só os que passam na regra de atraso). Aguardando pagamento MUST listar as assinaturas com renovação ainda não paga. Os envios UPS MUST listar os envios criados na janela, com status; no total, os cancelados vão para `excluded`.

#### Scenario: Ciclo atrasado

- **WHEN** um ciclo BR tem dia de preparo 2026-10-20 e está `in_production` em 2026-10-28
- **THEN** ele aparece no detalhamento de `cycles.in_production` e de `late`

### Requirement: Origem dos registros de Estoque

Produzido, separado e ajustado MUST listar os movimentos do item na janela pelo tipo (separação com estorno subtraindo). O saldo MUST listar todos os movimentos do item e comparar a soma com o saldo guardado em `reconciliation`. O mínimo MUST mostrar a configuração do item, sem registros. Os totais MUST somar os itens do mercado.

#### Scenario: Estorno de separação

- **WHEN** `BR / frango / 300` teve separação de 40 e estorno de 5 na janela
- **THEN** `rows.frango.300.separated` lista os dois movimentos, com contribuições `40` e `-5`, e total `35`

#### Scenario: Saldo guardado diverge dos movimentos

- **WHEN** o saldo guardado de um item é `23` e a soma dos movimentos é `20`
- **THEN** o detalhamento de `rows.<item>.onHand` mostra `value` `23`, `recordsValue` `20` e `matches: false`

### Requirement: Cards do Resumo abrem o detalhamento do mercado

Cada card do Resumo MUST abrir o detalhamento do indicador equivalente no relatório do mercado daquele bloco, com a mesma janela: faturamento, faturas e ticket em Receita; assinaturas ativas (ativas + em teste), novas, canceladas e churn em Assinaturas; checkouts e conversão em Aquisição. `report=summary` com `indicator` de um card MUST aceitar `market` obrigatório.

#### Scenario: Assinaturas ativas do Resumo

- **WHEN** o Resumo US mostra Assinaturas ativas `3`
- **THEN** o detalhamento lista as assinaturas US `active` e `trialing`, agrupadas por status, que somam `3`

### Requirement: Cliente aparece só com permissão de assinantes

Para sessões com `billing.subscribers.read`, cada registro ligado a um cliente MUST trazer `customer` com o nome do cliente e o link para `/users/<id>`. Sem essa permissão, `customer` MUST ficar ausente. O detalhamento MUST NOT trazer e-mail, telefone, endereço, documento nem ids do Stripe.

#### Scenario: Operador vê o nome do cliente

- **WHEN** um operador abre `grossRevenue`
- **THEN** cada fatura traz `customer.name` e `customer.link`

#### Scenario: Sem permissão não há nome

- **WHEN** uma sessão com `reports.read` e sem `billing.subscribers.read` abre o mesmo indicador
- **THEN** os registros não têm `customer`, só `reference` e `link`

#### Scenario: Nenhum id do Stripe

- **WHEN** o detalhamento de `estimatedMrr` é gerado
- **THEN** nenhum campo contém valores que começam com `cus_`, `sub_`, `in_` ou `pi_`

### Requirement: CSV do detalhamento

A API SHALL expor `GET /api/v1/admin/reports/details/export.csv` com os mesmos parâmetros da rota de detalhamento (sem `page`/`perPage`). A rota MUST exigir `reports.export` e `reports.read` e usar os formatos `excel`/`csv` e a proteção contra fórmula do CSV de relatório. O arquivo MUST ter o cabeçalho do indicador, critérios, fórmula, todos os registros, os excluídos, os subtotais, o total e a conferência.

#### Scenario: CSV soma igual à tela

- **WHEN** um operador exporta `report=revenue&indicator=grossRevenue&market=BR`
- **THEN** o arquivo `eden-revenue-grossRevenue-BR-<de>-<ate>.csv` lista todas as faturas e a linha de total tem o mesmo valor do card

#### Scenario: Readonly não exporta

- **WHEN** uma sessão `readonly` chama a rota de CSV do detalhamento
- **THEN** a API responde `403`

### Requirement: Limite de registros do detalhamento

As consultas de detalhamento MUST seguir o limite de 10 s de banco (`503` `report_timeout`). O CSV do detalhamento MUST ter no máximo 50.000 registros. Acima disso MUST responder `413` com code `report_detail_too_large` e o total de registros, para o operador reduzir o período.

#### Scenario: Período grande demais para o CSV

- **WHEN** um indicador tem 60.000 registros na janela
- **THEN** a rota de CSV responde `413` com code `report_detail_too_large` e `details.total` `60000`

### Requirement: Navegação do painel até o detalhamento

No painel, todo card de KPI, barra de série, etapa do funil e linha de tabela da tela de Relatórios MUST ser clicável e abrir `/reports/detalhe`. A URL MUST levar aba, indicador, mercado, período, agrupamento, bucket e período anterior quando houver. A navegação MUST funcionar por teclado.

#### Scenario: Clique no card mantém os filtros

- **WHEN** o operador está em `/reports?aba=receita&mercado=US&de=2026-10-20&ate=2026-11-18` e clica em Faturamento bruto
- **THEN** o painel abre `/reports/detalhe?aba=receita&indicador=grossRevenue&mercado=US&de=2026-10-20&ate=2026-11-18`

#### Scenario: Teclado

- **WHEN** o foco está num card e o operador aperta Enter
- **THEN** o detalhamento daquele card abre

### Requirement: Tela de detalhamento do painel

A tela `/reports/detalhe` MUST mostrar nome e descrição do indicador, valor do card, janela, critérios, fórmula, subtotais por grupo, tabela de registros paginada, excluídos com motivo, total final e o resultado da conferência (com destaque visual quando `matches` for falso). Ela MUST ter "Voltar para Relatórios", que volta para a mesma aba com os mesmos filtros, e "Exportar CSV" só para quem tem `reports.export`. A tela MUST usar os componentes e estilos atuais do painel.

#### Scenario: Voltar mantém a aba e os filtros

- **WHEN** o operador abriu o detalhamento a partir da aba Operação US de 20/10 a 18/11 e clica em "Voltar para Relatórios"
- **THEN** o painel abre `/reports?aba=operacao&mercado=US&de=2026-10-20&ate=2026-11-18`

#### Scenario: Divergência em destaque

- **WHEN** a resposta traz `reconciliation.matches: false`
- **THEN** a tela mostra um alerta com o valor do relatório e a soma dos registros

#### Scenario: Comparar com o período anterior

- **WHEN** o card tem valor anterior e o operador escolhe "Período anterior" no detalhamento
- **THEN** a tela recarrega com `anterior=1` e lista os registros da janela anterior
