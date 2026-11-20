# Tasks

## 1. CSV agregado espelhando a tela

- [x] 1.1 Reescrever `src/core/report-csv.js` com as 17 colunas em português, linhas `Relatório`, rótulos das abas, período anterior, variação (% ou p.p.), `agora`, `Avisos`, séries com `Total do período` e `Chave`; `npx jest --runTestsByPath tests/report-csv.test.js tests/admin-reports.routes.test.js tests/admin-reports.service.test.js` passa com um teste por aba.

## 2. Catálogo de indicadores e escopo compartilhado (API)

- [x] 2.1 Criar `src/core/report-indicators.js` com uma entrada por chave do CSV (rótulo, descrição, `kind`, `pointInTime`, critérios, fonte, contribuição, numerador/denominador, mapeamento dos cards do Resumo) e validação das chaves dinâmicas; `tests/report-indicators.test.js` confere que toda `Chave` gerada pelo CSV de cada aba existe no catálogo e que chave desconhecida lança `report_indicator_unknown`.
- [x] 2.2 Fazer `report-csv.js` ler rótulos e descrições do catálogo; `tests/report-csv.test.js` continua passando sem mudar valores esperados.
- [x] 2.3 Extrair em `admin-reports.repository.js` os escopos `FROM … WHERE` de faturas, assinaturas (agora, novas, canceladas, ativas no início), checkouts, itens do mix, ciclos, aguardando pagamento, envios UPS e movimentos de estoque, e reescrever as consultas agregadas atuais sobre eles; `npx jest --findRelatedTests src/infrastructure/repositories/admin-reports.repository.js` e `RUN_DB_INTEGRATION_TESTS=true npx jest tests/integration/admin-reports.integration.test.js` passam sem alterar números esperados.

## 3. Consultas de registros (API)

- [x] 3.1 Registros de faturas (pagas na janela e em outra moeda como excluídas) com `invoice_number`, motivo de cobrança, valor, data e `user_id`/`subscription_id`; teste em `tests/admin-reports.repository.test.js` com página, ordem por data e id, e total sobre o escopo inteiro.
- [x] 3.2 Registros de assinaturas para status atual, renovam em 7 dias, novas, canceladas, ativas no início (marcando canceladas no período), MRR (preço mensal do plano; em teste e sem preço como excluídas) e data aproximada; testes cobrindo o cenário de churn da spec.
- [x] 3.3 Registros de checkouts com etapa mais alta atingida e checkouts sem mercado; teste do funil 200/120/90 da spec.
- [x] 3.4 Registros do mix por assinatura e item (receita, gramas, quantidade); teste de `recipes.<receita>.packs` somando os packs.
- [x] 3.5 Registros de ciclos (status, preparo, entrega, atrasado), aguardando pagamento e envios UPS (cancelados como excluídos no total); teste do ciclo atrasado da spec.
- [x] 3.6 Registros de movimentos de estoque por tipo na janela e de todos os movimentos para o saldo; teste do estorno de separação 40/−5 e do saldo divergente.

## 4. Service e rotas do detalhamento (API)

- [x] 4.1 `AdminReportDetailsService` resolvendo período, mercado, bucket (`report_bucket_invalid`), `period=previous` (`report_detail_no_previous`), fórmula, grupos, totais, excluídos e `reconciliation` com `reportValue` do service consolidado e `logger.error` na divergência; `tests/admin-report-details.service.test.js` com conferência que bate, divergência simulada, bucket parcial de hoje e card do Resumo mapeado.
- [x] 4.2 `customer` (nome + `/users/:id`) só com `billing.subscribers.read`, buscado em consulta separada pela página; teste que sem a permissão não há `customer` e que a resposta não contém `@`, `cus_`, `sub_`, `in_`, `pi_`.
- [x] 4.3 Rota `GET /api/v1/admin/reports/details` (`reports.read`, `marketScope` `query`, paginação 50/200) em `admin.routes.js` e wiring em `src/index.js`; `tests/admin-report-details.routes.test.js` com readonly 200, operador BR pedindo US 403 `market_forbidden`, veterinário 403 e indicador desconhecido 400.
- [x] 4.4 Rota `GET /api/v1/admin/reports/details/export.csv` (`reports.export` + `reports.read`, `excel`/`csv`, proteção contra fórmula, 413 `report_detail_too_large` acima de 50.000, leitura em lotes); testes do arquivo com linha de total igual ao card, readonly 403 e 413.
- [x] 4.5 Rodar `npm run routes:manifest` e commitar `docs/api-routes.json`; `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passa.

## 5. Painel: navegação a partir de Relatórios (`eden-bowls-admin`)

- [x] 5.1 `npm run contract:sync` e commitar `contracts/backend-routes.json`; tipos e `detailPath`/parse da URL do detalhamento em `src/lib/reports.ts`, com teste em `src/lib/reports.test.ts` para ida e volta dos filtros (aba, mercado, de, ate, agrupamento, bucket, anterior).
- [x] 5.2 `KpiCard`, `BarSeries`, `FunnelBars` e `ReportTable` aceitam destino e viram links acessíveis por teclado; `ReportsPage.tsx` passa a chave de cada número das 7 abas; `src/pages/ReportsPage.test.tsx` cobre clique no card de Receita, barra da série, etapa do funil, linha do estoque e Enter no card.

## 6. Painel: tela de detalhamento

- [x] 6.1 `ReportDetailPage` em `/reports/detalhe` (`App.tsx`, mesma proteção de `/reports`) com cabeçalho, janela, alternância atual/anterior só para indicadores de período, critérios, fórmula, subtotais, tabela paginada com referência, cliente (quando vier) e link, excluídos, total e alerta de divergência; `src/pages/ReportDetailPage.test.tsx` cobre conferência ok, divergência, sem `customer` e período anterior.
- [x] 6.2 "Voltar para Relatórios" com os mesmos filtros e "Exportar CSV" só com `reports.export`; teste do link de volta para `/reports?aba=operacao&mercado=US&de=2026-10-20&ate=2026-11-18` e do botão oculto para readonly.
- [x] 6.3 Mocks do e2e (`e2e/helpers/mockAdminApi.ts`) com as rotas novas e um spec Playwright indo de Relatórios → detalhe → voltar; screenshot da tela de detalhe em claro e escuro conferido antes de entregar.

## 7. Conferência integrada

- [x] 7.1 Com o banco local, abrir `/reports?mercado=US&de=2026-10-20&ate=2026-11-18` e, para cada aba, abrir pelo menos um card, uma barra e uma linha de tabela e conferir que `reconciliation.matches` é `true` (ou divergência explicada, como o saldo de estoque) e que o total do CSV do detalhamento é igual ao card.
