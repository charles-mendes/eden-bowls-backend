# Proposal

## Why

A página **Visão do negócio** do painel (`/insights`) só existe no build de demonstração e mostra números fixos (`businessOverview.ts`), sem API. Para apresentar o negócio ao cliente com números reais, o painel precisa de uma área de **Relatórios** alimentada pela API, separada por mercado (Brasil e Estados Unidos, cada um na sua moeda) e com a mesma regra de permissão e de escopo de mercado do resto de `/api/v1/admin`.

Os dados já existem no banco: faturas emitidas (`customer_invoices`), assinaturas (`stripe_subscriptions` com `plan_selection.catalog_pricing`), checkouts (`onboarding_user_state`), ciclos de produção (`subscription_production_cycles`), envios UPS (`ups_shipments`) e estoque de packs. Falta uma camada que agregue por período e por mercado.

Também faltam datas no ciclo de vida da assinatura. Hoje "canceladas em 30 dias" usa `updated_at`, que muda a cada webhook. E o ledger grava `incomplete_expired` como `canceled`, então um checkout que nunca pagou parece uma assinatura nova que depois cancelou.

## What Changes

- **Rotas novas de relatório, somente leitura, em `/api/v1/admin/reports/*`**, todas com `marketScope: query`:
  - `summary`: comparativo Brasil × Estados Unidos com os KPIs principais de cada mercado lado a lado, sem somar moedas. Mostra só os mercados do ator.
  - `revenue`: faturamento, número de faturas, ticket médio, receita recorrente mensal estimada e série por semana ou mês.
  - `subscriptions`: retrato atual por status, novas e canceladas no período, churn e série.
  - `acquisition`: funil de checkout (iniciados → vinculados ao Stripe → assinatura ativa) dos checkouts criados no período.
  - `mix`: receitas e tamanhos de pack das assinaturas que ainda entregam.
  - `operations`: ciclos de produção por status, entregas no prazo e com atraso, e envios UPS (só EUA).
  - `stock`: produzido, consumido e ajustado por receita e pack no período, e o saldo atual.
  - `export.csv`: CSV de qualquer um desses relatórios, com o mesmo filtro.
- **Período**: `from`/`to` em datas locais do mercado (America/Sao_Paulo, America/New_York), máximo de 366 dias. O padrão são os 30 dias completos até ontem. Cada KPI traz o valor do período anterior de mesmo tamanho. Quando o período inclui hoje, o anterior é cortado no mesmo horário. Buckets cortados vêm marcados como `partial`.
- **Definições que não dependem do status de hoje**:
  - **Nova**: assinatura que ativou no período.
  - **Cancelada**: assinatura que terminou no período (`ended_at` da Stripe, e não o pedido de cancelamento).
  - **Churn**: cancelamentos da coorte que estava ativa no início do período.
  - **Funil**: a etapa 3 conta quem chegou a ativar.
  - Checkout que nunca pagou não entra em nenhuma dessas contagens.
- **Receita**: **faturamento bruto**, ou seja, faturas pagas como cobradas (com impostos e frete, sem descontar reembolsos), filtradas por conta e por moeda. O MRR estimado não inclui `trialing`.
- **Mercado**: todo relatório, exceto `summary`, é de um mercado só. Se o ator tem dois mercados e não informa `market`, a API responde `400 report_market_required`. Pedir um mercado fora do escopo responde `403 market_forbidden`, como nas outras rotas `query`.
- **Permissões novas**: `reports.read` para admin, operador e somente leitura. `reports.export` para admin e operador. Veterinário(a) não recebe nenhuma das duas.
- **Datas do ciclo de vida**: colunas `activated_at` e `canceled_at` em `stripe_subscriptions`, gravadas pelo webhook. A migração preenche as linhas existentes com datas marcadas como aproximadas.
- **CSV**: por padrão no formato do Excel em pt-BR (BOM, `;` e vírgula decimal). `formato=csv` gera RFC 4180. Os textos são escapados contra formula injection.
- **Timeout no banco**: 10 s por consulta, interrompida no próprio MySQL, com resposta `503 report_timeout`.
- Manifesto de rotas atualizado (`npm run routes:manifest`).

## Capabilities

### New Capabilities

- `admin-reports`: relatórios agregados de receita, assinaturas, aquisição, mix, operação e estoque, por mercado e período, com comparativo entre mercados e exportação CSV.

### Modified Capabilities

- `admin-market-scope`: a tabela de campos canônicos ganha as rotas de relatório, e a regra de um mercado por relatório passa a fazer parte do escopo `query`.

## Impact

- API: `src/core/admin-roles.js` (permissões novas); `src/core/admin-market-scope.js` (helper de mercado único); novos `src/services/admin-reports.service.js`, `src/infrastructure/repositories/admin-reports.repository.js` e `src/core/report-period.js`; rotas em `src/api/routes/admin.routes.js`; migrações `1700000000055-add-subscription-lifecycle-dates.js` e `1700000000056-backfill-onboarding-user-state-market.js`; `onboarding-zipcode.repository.js` passa a preencher o mercado vazio do checkout; `src/core/report-csv.js` e `src/core/report-mrr.js`; `subscription-ledger.repository.js` passa a gravar `activated_at` e `canceled_at` no upsert (com `ended_at || canceled_at` vindo do webhook); `docs/api-routes.json`.
- Banco: quatro colunas novas e índices para as consultas por período (`customer_invoices(stripe_account, issued_at)`, `stripe_subscriptions(stripe_account, activated_at)` e `(stripe_account, canceled_at)`). Checkouts sem mercado são preenchidos a partir do mercado do perfil. MySQL 8.4.11 confirmado no QA, igual à produção.
- Change irmão no painel (mesmo nome, `eden-bowls-admin`): página **Relatórios** no grupo Visão geral, com seletor Brasil/Estados Unidos, período, abas por relatório, comparativo e botão de CSV; `roles.ts`/menu com as permissões novas; `npm run contract:sync`. A página de demonstração `/insights` continua como está.
- Sem impacto na loja.
