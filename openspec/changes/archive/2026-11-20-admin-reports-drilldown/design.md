# Design

## Context

- `AdminReportsService` (`src/services/admin-reports.service.js`) monta cada relatório a partir de consultas agregadas do `AdminReportsRepository` (`SUM`/`COUNT` com `GROUP BY`). As tabelas de origem são `customer_invoices`, `stripe_subscriptions`, `onboarding_user_state`, `subscription_production_cycles`, `ups_shipments`, `pack_stock_items` e `pack_stock_movements`. Os filtros (conta Stripe, moeda, status, janela em UTC calculada por `report-period.js`) estão escritos dentro de cada SQL agregado.
- O CSV agregado (`src/core/report-csv.js`, já reescrito na working tree) gera uma `Chave` por número da tela. Essa chave vira o id do indicador no detalhamento.
- O painel (`eden-bowls-admin`) renderiza as abas em `ReportsPage.tsx` com `KpiCard`, `BarSeries`, `FunnelBars` e `ReportTable`, e guarda os filtros na URL (`aba`, `mercado`, `de`, `ate`, `agrupamento`).
- O saldo de estoque é a coluna `pack_stock_items.on_hand`, mantida pelo serviço de estoque. Não é calculado a partir dos movimentos.
- Requisitos: ver `specs/admin-report-details/spec.md` e o delta de `specs/admin-reports/spec.md`.

## Goals / Non-Goals

**Goals:**
- Um único lugar define o critério de cada indicador, usado pela consulta agregada e pela de registros, para que as duas não divirjam.
- A conferência é calculada a cada requisição e nunca é corrigida em silêncio.
- O detalhamento reaproveita as telas de detalhe que já existem (assinatura, cliente) em vez de criar telas por registro.

**Non-Goals:**
- Não mostrar o evento cru do Stripe nem o payload da fatura.
- Não editar nada a partir do detalhamento: é só leitura.
- Não criar tabela de snapshot nem cache. O detalhamento é sempre calculado na hora.
- Não reconciliar `on_hand` com os movimentos (só mostrar a diferença). Corrigir o estoque é com o fluxo atual de ajuste.

## Decisions

### 1. Catálogo de indicadores declarativo

Novo módulo `src/core/report-indicators.js` com uma entrada por chave (as mesmas do CSV). Cada entrada tem: `report`, `label`, `description`, `kind`, `pointInTime`, `criteria` (textos), `source` (qual consulta de registros usar), `contribution` (como cada registro entra: valor, `1`, quantidade, movimento com sinal) e, para taxas e médias, `numerator`/`denominator` apontando para outras chaves. Chaves dinâmicas (`recipes.<receita>.packs`, `rows.<receita>.<gramas>.*`, `shipments.byStatus.<status>`) usam padrões com parâmetros validados contra os dados do mercado.

O CSV agregado e a tela passam a ler rótulo e descrição desse catálogo, para os três dizerem a mesma coisa.

*Alternativa:* um switch por indicador dentro do service. Foi descartada porque espalha os textos e torna fácil a chave do CSV e a do detalhamento se separarem.

### 2. Critério compartilhado entre agregado e registros

Cada fonte vira um par de métodos no repositório sobre o mesmo fragmento `FROM … WHERE`: `xxxScope(params)` devolve `{ from, where, params }`. A consulta agregada atual passa a ser `SELECT SUM(...) ${scope}` e a de registros `SELECT <colunas> ${scope} ORDER BY data, id LIMIT/OFFSET`. Os totais do detalhamento saem de um `SELECT SUM/COUNT` sobre o mesmo escopo, e não da página.

`reconciliation.reportValue` vem do service do relatório consolidado (mesmo código do card). `recordsValue` é a soma das contribuições sobre o escopo de registros. As duas consultas rodam na mesma requisição. Divergência → `matches: false` + `logger.error`.

*Alternativa:* calcular o card a partir dos registros. Foi descartada porque mudaria o caminho do relatório consolidado, que já tem testes e integração, e esconderia exatamente a divergência que queremos detectar.

### 3. Uma rota com `report` + `indicator`

`GET /api/v1/admin/reports/details?report&indicator&market&from&to&granularity&bucket&period&page&perPage` e `GET /api/v1/admin/reports/details/export.csv` com os mesmos parâmetros. As duas rotas são fixas no manifesto, sem `:param`, no mesmo padrão de `export.csv`. Período, mercado e bucket passam por `resolveReportPeriod` e pelo `foldHourlyRows` existentes. Assim o bucket da barra usa os limites exatos da série, inclusive o corte de "hoje".

`summary` não tem fonte própria. O catálogo mapeia cada card do Resumo para a chave do relatório do mercado (`summary.activeSubscriptions` → fonte de assinaturas com status `active`+`trialing`), e o painel passa `market` do bloco clicado.

### 4. Identificação do registro e do cliente

`reference` usa o número que o operador já vê nas outras telas: `invoice_number` da fatura (cai para `Fatura #<id>` se estiver vazio), `Assinatura #<id do ledger>`, `Checkout #<id>`, `Ciclo #<id>`, `Envio #<id>`, `Movimento #<id>`. `link` aponta para rotas existentes do painel: `/billing/subscriptions/:id` (fatura, assinatura, ciclo, envio, item do mix), `/users/:userId` (checkout) e `/operations/stock` (movimento).

`customer` (nome + `/users/:id`) só é preenchido quando `adminIdentity.permissions` inclui `billing.subscribers.read`. A coluna de nome é buscada em consulta separada, por `user_id` da página, para o SQL de escopo continuar sem dado pessoal. E-mail, documento, endereço e ids Stripe nunca entram no SELECT. Um teste varre a resposta por `@`, `cus_`, `sub_`, `in_`, `pi_`.

### 5. Paginação e CSV

JSON: `parsePageQuery` (padrão 50, máx. 200). CSV: primeiro um `COUNT` no escopo. Se passar de 50.000, responde `413 report_detail_too_large`. Senão, lê em lotes de 5.000 e escreve com `formatCell`/`FORMATS` de `report-csv.js`. Blocos do arquivo: cabeçalho do indicador, critérios, fórmula, registros, excluídos, subtotais, total, conferência. Nome: `eden-<report>-<indicator>-<market>-<from>-<to>.csv`, com `.` e `<>` da chave trocados por `-`.

### 6. Painel

- `src/lib/reports.ts`: `detailPath(state, indicator, extras)` e o parse da URL do detalhamento (`aba`, `indicador`, `mercado`, `de`, `ate`, `agrupamento`, `bucket`, `anterior`, `pagina`).
- `KpiCard`, barras de `BarSeries`, etapas de `FunnelBars` e linhas de `ReportTable` recebem `to` opcional e viram `<Link>`, com foco visível e o mesmo visual. A barra da série ganha alvo de clique na coluna inteira.
- Nova `ReportDetailPage` em `/reports/detalhe`, protegida como `/reports`. Mostra cabeçalho com valor e janela, alternância Período atual/anterior (só para indicadores de período), critérios, fórmula, subtotais, tabela paginada, excluídos, total e alerta de divergência. "Voltar para Relatórios" monta a URL de `/reports` com os mesmos filtros. "Exportar CSV" reaproveita o fluxo de download de `ReportsPage`.

## Risks / Trade-offs

- [Consulta de registros lenta em período de 12 meses] → mesmos índices dos agregados (o escopo é igual), `LIMIT` na página, limite de 10 s e 413 no CSV.
- [Refatorar o SQL agregado para usar o escopo muda números] → os testes atuais de repositório, service e integração (`RUN_DB_INTEGRATION_TESTS=true`) precisam passar sem mudar nenhum valor esperado antes de criar as consultas de registros.
- [`on_hand` diverge dos movimentos por dados antigos] → aparece como `matches: false` no saldo. É informação útil, não um bug do relatório, e a tela explica isso no texto do critério.
- [Nome do cliente fora do relatório agregado muda a regra de privacidade] → só com `billing.subscribers.read`, só nome, nunca no agregado. O delta da spec registra a mudança.
- [Chaves dinâmicas com valores livres (receita)] → validar contra as chaves existentes do mercado e responder `report_indicator_unknown`, sem interpolar no SQL.

## Migration Plan

Sem migration. Deploy normal da API e depois do painel (o painel novo depende das rotas). Rollback: reverter o painel primeiro. As rotas novas ficam sem uso e podem ficar até o rollback da API. Rotas novas → `npm run routes:manifest` na API e `npm run contract:sync` no painel.

## Open Questions

- Descrição de cada indicador: o texto inicial sai dos hints da tela e da spec. Se o negócio quiser outra redação, muda só no catálogo, sem impacto na spec.
