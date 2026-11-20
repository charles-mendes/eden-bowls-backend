# Proposal

## Why

A tela de Relatórios do painel mostra só números consolidados. Hoje não dá para conferir de onde vem um valor como "Faturamento bruto US$ 2.295,00" ou "Churn 100%". O operador não consegue auditar o resultado nem explicar uma divergência com o Stripe ou com a fila de produção. Queremos que cada número da tela leve aos registros que o formam, com a memória de cálculo, e que a soma desses registros seja exatamente o valor do card.

## What Changes

- Todo indicador das 7 abas (Resumo, Receita, Assinaturas, Aquisição, Mix, Operação, Estoque) fica clicável: cards de KPI, barras das séries, etapas do funil e linhas das tabelas (receita do mix, tamanho de pack, status UPS, item de estoque).
- Nova tela no painel, `/reports/detalhe`, com: nome e descrição do indicador, valor do card, filtros e critérios aplicados, fórmula/memória de cálculo, lista de registros de origem (com descrição e valor de cada um), subtotais por agrupamento e total final. Tem "Voltar para Relatórios" com os mesmos filtros (mercado, período, agrupamento, aba).
- Nova rota da API `GET /api/v1/admin/reports/details`. Ela devolve os registros de um indicador com os mesmos critérios do relatório consolidado e uma conferência (`reconciliation`) que compara a soma dos registros com o valor do relatório.
- Nova rota `GET /api/v1/admin/reports/details/export.csv` com o detalhamento completo em CSV (mesmos formatos `excel`/`csv`). Exige `reports.export`.
- Cada registro mostra seu identificador interno (nº da fatura, #assinatura, #checkout, #ciclo, #envio, #movimento) e, para sessões com `billing.subscribers.read`, o nome do cliente com link para a tela de detalhe que já existe. Sem essa permissão aparece só o identificador interno.
- O detalhamento pode ser aberto também para o período anterior, para conferir a comparação ("vs. período anterior").
- O CSV agregado de cada aba passa a espelhar a tela, com rótulos em português, período anterior, variação, avisos e séries com total. Isso já está implementado na working tree desta branch e entra aqui como mudança de requisito. **BREAKING** para quem lia as 9 colunas antigas (`secao;item;indicador;…`). A coluna `Chave` mantém o nome técnico.
- **BREAKING (regra)**: o requisito "Reports carry no personal data" passa a valer só para os relatórios agregados. O detalhamento pode trazer o nome do cliente, sujeito a `billing.subscribers.read`.

## Capabilities

### New Capabilities
- `admin-report-details`: detalhamento por indicador dos relatórios do painel. Cobre o catálogo de indicadores, os registros de origem, a memória de cálculo, os subtotais, a conferência com o valor consolidado, o período anterior, a exibição de cliente por permissão e o CSV do detalhamento.

### Modified Capabilities
- `admin-reports`: muda "CSV export" (layout que espelha a tela), "Report routes" (duas rotas novas no manifesto) e "Reports carry no personal data" (restrita aos agregados).

## Impact

- **API (`eden-bowls-backend`)**: novo `AdminReportDetailsService` e consultas de detalhe em `admin-reports.repository.js`. Os filtros (WHERE) de cada indicador passam a ser compartilhados entre a consulta agregada e a de detalhe. Duas rotas novas em `admin.routes.js`. `docs/api-routes.json` é regenerado. `src/core/report-csv.js` já foi alterado.
- **Painel (`eden-bowls-admin`)**: `ReportsPage.tsx`, `KpiCard`, `BarSeries`, `FunnelBars` e `ReportTable` ganham navegação. Nova página `ReportDetailPage` com rota em `App.tsx` e `src/lib/reports.ts`. `npm run contract:sync` atualiza `contracts/backend-routes.json`.
- **Banco**: só leitura, sem migration. As consultas de detalhe usam o mesmo limite de 10 s (`report_timeout`) e paginação.
- **Permissões**: nenhuma permissão nova. Leitura com `reports.read`, CSV com `reports.export`, nome do cliente com `billing.subscribers.read`.
