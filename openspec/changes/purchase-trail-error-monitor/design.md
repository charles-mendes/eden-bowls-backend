# Design

## Context

Ver proposal.md. O que já existe e esta mudança só lê:

- Tabelas da migration `1700000000090`: `customer_purchase_attempts` (índices `(user_id, market, started_at)` e `(market, status, started_at)`), `customer_purchase_events` (índices `(attempt_row_id, id)`, `(market, area, created_at)`), `customer_purchase_config_events`.
- `CustomerPurchaseTrailRepository` em SQL direto, sem entidade TypeORM; `CustomerPurchaseTrailService` expõe `listForCustomer` e `listConfigEvents`.
- `src/api/routes/admin-purchase-trail.routes.js`: `requiredMarket` (400 `market_required`) roda depois de `requirePermission('billing.subscribers.read', { market: 'query' })`, que já responde 403 `market_forbidden`.
- Painel: `CheckoutReadinessPage.tsx` (PageFrame, `.segmented`, lista densa, `.alert`, estado vazio), `src/lib/menu.ts` (item por `roles`, `group`, `permission`), `PurchaseTrail.tsx` (escolhe o mercado inicial pelo país do endereço).

## Goals / Non-Goals

**Goals:** uma consulta por página da lista, sem N+1 por linha além dos eventos da página; mesma forma de resposta da aba do cliente para reaproveitar a renderização de eventos.

**Non-Goals:** contagens, agregados, gráficos, ordenação por coluna, busca por email, export.

## Decisions

1. **Unidade da lista = "linha de falha" de dois tipos.** `kind: 'attempt'` (tentativa com falha) e `kind: 'webhook'` (evento de webhook com falha e `attempt_row_id IS NULL`). Eventos de webhook com tentativa já aparecem dentro da tentativa. Alternativa (listar eventos soltos) rejeitada: o operador veria um CEP que depois pagou como compra perdida.

2. **Instante da linha.** Tentativa: o instante da falha exibida, `MAX(created_at)` dos eventos com falha (restritos ao `error_code` filtrado, quando houver), ou `finished_at` quando o status é `failed` sem evento com falha. Calculado numa subconsulta agregada por `attempt_row_id`; o período filtra por esse instante, não por `started_at` (uma visita aberta há 8 dias com ack falho ontem entra nos 7 dias). Webhook sem tentativa: `created_at`. Ordem `occurred_at DESC, kind, id DESC`; cursor `before` opaco = base64 de `{ t: occurred_at ISO, k: kind, id }`, comparado como tupla. Garante página estável com instantes iguais.

3. **Consulta.** `UNION ALL` de:
   - tentativas do mercado cujo instante de falha está no período, onde `status = 'failed' OR` existe evento com falha, filtrando `error_code` (código da tentativa ou de evento com falha) e `area` pela **área da tentativa** (com `area=webhook`, este ramo não roda);
   - eventos `area = 'webhook'`, `outcome = 'failed'`, `attempt_row_id IS NULL` no período, só quando `area` vazio ou `webhook`.
   Com `LIMIT limit + 1` para saber se há próxima página. Depois, uma consulta `WHERE attempt_row_id IN (...)` traz os eventos das tentativas da página, cortados em 50 por tentativa no código. O passo/erro exibido da tentativa é o do último evento com falha (com filtro de código, o último com esse código); se não houver, o desfecho (`final_step`, `error_code`) da tentativa. Email vem da coluna `email` da tentativa (sem join em usuários).

4. **Período.** `from`/`to` em datas ISO; padrão últimos 7 dias; `from` antes de `now - 180 dias` = 400 `period_out_of_retention`; `from > to` = 400 `invalid_period`. `limit` padrão 50, máximo 100.

5. **Rota no arquivo existente** `admin-purchase-trail.routes.js`, reaproveitando só `requiredMarket`. `pageOf` não serve: trata `before` como número e corta `limit` em 50. A rota lê o próprio `limit` (padrão 50, máximo 100) e decodifica o cursor base64 `{ t, k, id }`; cursor inválido = 400 `invalid_cursor`. Resposta `{ success, data: { market, rows, next_before } }`.

7. **Config events com falha.** `config-events` ganha `outcome=failed` e `from`/`to` opcionais; `listConfigEvents` aceita esses filtros (`WHERE outcome = 'failed' AND created_at BETWEEN`). Sem os parâmetros, a consulta é a de hoje, então a aba da ficha não muda. Alternativa (filtrar no painel) rejeitada: só via as falhas dentro dos 50 eventos mais recentes.

6. **Painel.**
   - `menu.ts`: item `{ label: 'Erros de compra', href: '/operations/purchase-errors', roles: ['admin','operator','readonly'], group: 'Operação', permission: 'billing.subscribers.read' }` antes de "Checkout da loja"; `App.tsx` guarda a rota com a mesma permissão (redireciona para `/dashboard` sem ela).
   - Página `PurchaseErrorsPage.tsx` com `PageFrame`, `.segmented` de mercado (só mercados da sessão; um mercado = rótulo fixo), filtros (de/até, área, código), botão Atualizar, lista em `<details>` por linha, "Carregar mais" pelo cursor, seção "Configuração com falha" filtrando `outcome = failed` da rota `config-events`.
   - Tabela de eventos: extrair `EventsTable` de `PurchaseTrail.tsx` para um componente compartilhado, mantendo o agrupamento de cada célula num só elemento (correção do celular).
   - Ficha: `UserDetailPage` lê `mercado` da URL e passa a `PurchaseTrail` como mercado inicial; `initialMarket` passa a preferir esse valor ao `customerCountry`, desde que no escopo do staff.

## Risks / Trade-offs

- [`EXISTS` com `error_code` pesa em mercado com muito volume] → filtro sempre por `market` + período, índices existentes, limite máximo 100; retenção limita a 180 dias.
- [Email gravado na tentativa pode estar desatualizado] → é o email do momento da compra, o que ajuda a investigação; a ficha mostra o atual.
- [Subconsulta do instante de falha pesa mais que filtrar por `started_at`] → sempre restrita a `market` e ao período via `(market, area, created_at)` dos eventos; limite máximo 100.

## Migration Plan

Sem schema. Deploy da API antes do painel; o painel sem a rota mostra erro de carga, não quebra o resto. Rollback: remover item de menu e rota.
