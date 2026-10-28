# Design

## Context

- Permissões: `ROLE_PERMISSIONS` em `src/core/admin-roles.js`; `GET /admin/me` devolve a lista. Cada rota admin passa por `requirePermission(permission, { market })` (`require-admin-permission.middleware.js`). Em `query`, o middleware já resolve `request.marketQuery` via `constrainMarketQuery` (mercados, contas Stripe, `403 market_forbidden`).
- As métricas que existem hoje são pontuais e fixas em 30 dias: `SubscriptionLedgerRepository.metrics` (contagens por status, `canceled30d` por `updated_at`, `mrr: 0`) e `AdminOnboardingRepository.metrics` (carrega até 100 000 checkouts em memória). Nenhuma aceita período nem série.
- O ledger guarda só o status atual, já mapeado. `mapStripeStatus` (`src/core/stripe-subscription-map.js:67`) grava `incomplete_expired` como `canceled`, então o status sozinho não separa "nunca pagou" de "cancelou". Também não existe data de ativação nem de término.
- Fontes por relatório:
  - Receita: `customer_invoices` (`stripe_account`, `currency` em minúsculas, `amount_paid_minor`, `invoice_status`, `billing_reason`, `issued_at`). É emitida para toda fatura paga com total > 0 (`stripe-webhook.service.js:434`). `subscription_charged_invoices` registra as faturas cobradas por assinatura.
  - Assinaturas e mix: `stripe_subscriptions` (`status`, `created_at`, `cancel_at_period_end`, `current_period_end`, `plan_selection.catalog_pricing` com `subtotal` e `line_items[]`). A edição de plano pela loja atualiza `plan_selection` no commit (`stripe-webhook.service.js:392`).
  - Aquisição: `onboarding_user_state` (`market`, `created_at`) com join no ledger por `user_id`.
  - Operação: `subscription_production_cycles`. Só os ciclos pagos têm linha com `preparation_day`/`delivery_date`. O ciclo não pago é derivado do ledger, sem datas (`queueSourceSql`, `subscription-ledger.repository.js:687`). Os status possíveis são só `to_prepare`, `in_production`, `ready` e `blocked` (`ALLOWED_TRANSITIONS` em `admin-production.service.js`). Envios em `ups_shipments`.
  - Estoque: `pack_stock_items` e `pack_stock_movements` (`production`, `adjustment`, `separation`, `separation_reversal`).
- Banco: docker-compose e CI usam `mysql:8.4`. `JSON_TABLE` já roda em produção na proteção contra exclusão de catálogo (`subscription-ledger.repository.js:936`). Versão do servidor confirmada em 2026-10-28 pelo MCP da Hostinger, só com operações de leitura (`vps_virtual-machines_list`, `vps_docker_list`, `vps_docker_logs`):
  - VPS `srv1612122.hstgr.cloud`, projeto Docker `eden-bowls-backend` (`docker-compose.qa.yml`), container `eden-bowls-mysql-qa`.
  - Imagem `mysql:8.4`; os logs mostram `mysqld: ready for connections. Version: '8.4.11'` e `MySQL Community Server - GPL`. É MySQL, não MariaDB.
  - Os nomes do compose e do container são de QA. A produção usa a mesma configuração Docker do QA, então vale a mesma versão.
- O CSV atual (`checkouts.csv`) usa `,`, sem BOM e sem escape de fórmula.

## Goals / Non-Goals

**Goals:**
- Agregar no MySQL, sem carregar linhas na memória do Node.
- Uma regra de mercado só, reaproveitando `constrainMarketQuery`.
- Os mesmos números no JSON e no CSV.
- Contagens de novas, canceladas e churn que não dependem da hora do último webhook.

**Non-Goals:**
- Painel em tempo real, cache distribuído ou data warehouse.
- Relatório por cliente ou lista de clientes (já existe em Clientes/Assinantes).
- Conversão de moeda ou total consolidado BR + US.
- Reembolsos (o faturamento é bruto).
- Mudar a página de demonstração `/insights` ou o formato do `checkouts.csv` atual.

## Decisions

1. **Uma rota por relatório, e não `GET /reports/:id`.** O manifesto de rotas e o contrato do painel validam cada caminho. O CSV fica numa rota só (`export.csv?report=`), porque reusa os mesmos builders.
   - Alternativa: `/reports/:report` genérico. Foi descartada porque esconde do manifesto quais relatórios existem.

2. **Camadas.** `src/core/report-period.js` é puro: período, fuso, período anterior, corte de hoje e buckets parciais. `AdminReportsRepository` tem uma consulta por fonte e recebe os limites em UTC. `AdminReportsService` resolve o mercado, chama o repositório para o período atual e o anterior, completa os buckets e monta o JSON. `src/core/report-csv.js` serializa.

3. **Fuso fora do SQL.** O service converte as bordas locais em instantes UTC, e o filtro usa `>= ? AND < ?` nas colunas `datetime` (gravadas em UTC). Para as séries, o SQL agrupa por hora UTC (`DATE_FORMAT(col, '%Y-%m-%d %H')`, cerca de 8 800 linhas em 366 dias). O service converte cada hora para o dia local com `Intl`, o que cobre o horário de verão, e soma em dia, semana ou mês.
   - Alternativa: `CONVERT_TZ` com nome de fuso. Foi descartada porque depende de `mysql.time_zone` populado na Hostinger. Um offset fixo erra nas viradas de horário de verão.

4. **Período padrão termina ontem.** São 30 dias completos, para não comparar um dia pela metade com dias inteiros. Quando `to` é hoje, o período atual termina em `now`, e o anterior termina no mesmo horário local do último dia dele (`partialToday: true`). O bucket é `partial` quando `from`, `to` ou `now` cortam o intervalo dele.

5. **Mercado único.** `requireSingleReportMarket(marketQuery)` em `admin-market-scope.js` devolve o mercado quando há um só, ou lança `400 report_market_required`. `summary` itera `marketQuery.markets`.

6. **`activated_at` e `canceled_at` no ledger (migração `1700000000055`).**
   - Colunas: `activated_at datetime NULL`, `activated_at_approximate tinyint(1) NOT NULL DEFAULT 0`, `canceled_at datetime NULL` e `canceled_at_approximate tinyint(1) NOT NULL DEFAULT 0`.
   - Escrita, no upsert do ledger, no mesmo SQL de `ON DUPLICATE KEY UPDATE`:
     - `activated_at = COALESCE(activated_at, CASE WHEN VALUES(status) IN ('active','trialing','past_due') THEN UTC_TIMESTAMP() END)`.
     - `canceled_at = CASE WHEN VALUES(status) = 'canceled' THEN COALESCE(canceled_at, VALUES(canceled_at)) ELSE NULL END`.
     - O valor de entrada vem de `subscription.ended_at || subscription.canceled_at`, só quando o status mapeado é `canceled`. Não se usa `canceled_at` da Stripe sozinho, porque ele é preenchido no pedido de cancelamento com `cancel_at_period_end`.
     - Status diferente de `canceled` zera `canceled_at`. Na prática isso não acontece, porque `canceled` é terminal na Stripe, mas protege contra dados inconsistentes.
   - Para a ativação, a hora do webhook é suficiente: o primeiro `invoice.paid`/`customer.subscription.updated` chega em segundos.
   - Backfill:
     - `activated_at = created_at` (aproximado) para `active`/`trialing`/`past_due`/`paused`, e para `canceled` que tenham `customer_invoices` pagas ou `subscription_charged_invoices`.
     - `canceled_at = updated_at` (aproximado) para `canceled` que tenham `activated_at`.
   - `SubscriptionLedgerRepository.metrics` passa a contar `canceled30d` por `canceled_at`, o que corrige o card de Assinantes sem mudar o contrato.
   - Alternativa: tabela de histórico de status. Foi descartada por ser mais cara do que o relatório precisa. As duas datas respondem a todas as perguntas da spec.

7. **Churn por coorte do início.** `activeAtStart` conta `activated_at < fromUtc AND (canceled_at IS NULL OR canceled_at >= fromUtc)`. O numerador conta as linhas dessa coorte com `canceled_at` no período. `canceled` conta todas as linhas com `activated_at` e `canceled_at` no período, e por isso inclui quem entrou e saiu dentro dele.

8. **Funil, etapa 3 = `activated_at` preenchido.** Assim a etapa não depende do status de hoje, e turmas antigas não parecem piores por terem tido mais tempo para cancelar. Foi preferido a "pagou a fatura `subscription_create`", porque uma primeira compra com 100% de desconto não emite `customer_invoices` (total 0).

9. **Mix com `JSON_TABLE`.** Usa `JSON_TABLE` em `catalog_pricing.line_items`, igual ao que já roda no servidor. O MySQL 8.4.11 suporta (a função existe desde a 8.0.4), então não é preciso agregar no Node.

10. **MRR estimado.** Toda assinatura cobra por mês: todo preço da Stripe é criado com `recurring: { interval: 'month' }` (`stripe-billing-client.js:216`), e a "frequência" do plano é só um apelido legado do prazo de 1/3/6 meses (`onboarding-recurrence.service.js`). Por isso o MRR soma `catalog_pricing.subtotal` (valor mensal sem o desconto de primeira compra, em unidade maior) convertido para minor units, sem normalização. Só entram `active` e `past_due`. `trialing` fica separado, como no MRR da Stripe. Linhas sem `subtotal` válido entram em `unpricedSubscriptions`.
    - Alternativa: buscar o preço na Stripe por `stripe_price_id`. Foi descartada porque gera N chamadas externas por relatório.
    - Se um dia existir preço com outro intervalo, o cálculo precisa ler o intervalo da linha; hoje não existe.

11. **Filtro de moeda.** As consultas de faturas filtram `stripe_account = ? AND currency = ?` (`br`→`brl`, `us`→`usd`). Uma segunda contagem com `currency <> ?` vira `excludedInvoices` e gera `logger.warn` quando é maior que zero.

12. **Timeout no banco.** Toda consulta de relatório leva o hint `/*+ MAX_EXECUTION_TIME(10000) */` (MySQL 5.7.8+, só `SELECT`). O erro `ER_QUERY_TIMEOUT` (3024) vira `503 report_timeout`. O hint funciona no MySQL 8.4.11 do servidor. O `withTimeout` atual não é usado, porque só abandona a promise e a consulta continua rodando.

13. **CSV.** `formato=excel` (padrão, e o que o painel usa) gera BOM UTF-8, `;` e vírgula decimal. `formato=csv` gera RFC 4180 com `,` e ponto. Toda célula vai entre aspas, com `"` duplicado. Uma célula de texto que começa com `= + - @ \t \r` recebe o prefixo `'`. As células numéricas são escritas sem prefixo.

14. **Permissões.** `reports.read` entra em `readonly` e `operator` (e portanto em `admin`). `reports.export` entra em `operator`. A rota CSV declara `reports.export` no middleware e verifica `reports.read` no handler.

15. **Sem dados pessoais.** As consultas fazem só `SELECT` de agregados.

16. **Mercado do checkout corrigido na origem (migração `1700000000056`).** Os passos de recorrência, plano, frete e checkout criavam a linha de `onboarding_user_state` sem `market`, e o passo de CEP só gravava o mercado no `INSERT`. Por isso parte dos checkouts ficava sem mercado e sumia do funil. O upsert do CEP passa a fazer `market = COALESCE(NULLIF(market, ''), VALUES(market))`: preenche o vazio e nunca troca um mercado gravado. A migração 056 preenche os vazios a partir do mercado do perfil (`hsr_market_country`, só `BR`/`US`); sem mercado no perfil, a linha continua vazia. O relatório não tem fallback: o campo canônico é `onboarding_user_state.market`, o mesmo da lista de Checkouts. Para o admin, `unassignedCheckouts` mostra quantos checkouts do período continuam sem mercado.

17. **Mix e estoque mostram tudo.** Receita sem nome no catálogo do mercado aparece pela chave, com `nameMissing: true` e, no CSV, `(sem nome no catálogo EUA)`. Tamanhos de pack ficam uma linha por grama; nos EUA o rótulo é `17.6 oz (499 g)`, para que dois tamanhos com as mesmas onças não se confundam.

18. **Aguardando pagamento não é atraso.** Renovações em `awaiting_payment` ou `past_due` na fila ainda não têm dia de preparo nem data de entrega. Ficam fora das contagens por status e do `late`, e aparecem só em `awaitingPayment`.

## Risks / Trade-offs

- [Datas aproximadas nas linhas anteriores ao change] → `approximateNewCount` e `approximateCanceledCount` no relatório, e aviso no painel. O número diminui com o tempo.
- [O MRR estimado diverge da Stripe] → selo **Estimado** no JSON e no painel. Limitações conhecidas:
  - Cupons recorrentes não são descontados.
  - Mudança de plano feita direto no dashboard da Stripe não atualiza o snapshot (a edição pela loja atualiza).
  - Impostos e frete entram se estiverem no `subtotal` do snapshot.
- [Faturamento bruto diverge do extrato da Stripe] → o card se chama **Faturamento bruto**. Inclui impostos e frete cobrados e não desconta reembolsos nem taxas da Stripe.
- [Consultas pesadas em 366 dias] → índices novos, agregação no SQL e `MAX_EXECUTION_TIME`.
- [Horário de verão nos EUA] → bucket por hora UTC convertido com `Intl`. Os testes cobrem as viradas de março e novembro.
- [Ativação registrada pela hora do webhook, não pela da Stripe] → a diferença é de segundos a minutos e não muda o dia, exceto perto da meia-noite. Aceito.
- [Ciclos não pagos ficam fora do relatório de operação] → aparecem só como `awaitingPayment`, porque ainda não têm data de entrega.

## Migration Plan

1. A versão do MySQL foi confirmada no QA (8.4.11, tarefa 0.1). A produção usa o mesmo Docker, então não precisa de outra checagem.
2. Antes do deploy, no QA e em produção: `SELECT COUNT(*) FROM onboarding_user_state WHERE market IS NULL OR market = '';` (anotar o número; repetir depois da migração 056 para ver quantos sobraram sem mercado no perfil).
3. Deploy da API com as migrações 055 (colunas, backfill e índices) e 056 (mercado dos checkouts) e as rotas novas. O build atual do painel ignora as rotas novas.
4. `npm run routes:manifest` e o commit do JSON entram no mesmo PR.
5. Deploy do painel (change irmão) depois de `npm run contract:sync`.
6. Rollback: o `down` da 055 remove as colunas e os índices. O `down` da 056 não desfaz o preenchimento (o mercado gravado é o correto). As rotas novas são só de leitura.

## Open Questions

- Mostrar reembolsos (`charge.refunded`) como receita negativa numa versão futura? Não muda este escopo.
- Remover `/insights` no change seguinte, para o cliente não ver dois painéis com números diferentes (decisão do painel).
