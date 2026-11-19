# Proposal

## Why

A trilha de compra (`customer-purchase-trail`) já grava as falhas por cliente e mercado, mas o operador só as vê abrindo a ficha de um cliente de cada vez. Não há como ver, num lugar só, o que falhou para todos os clientes de um mercado. A tela "Checkout da loja" mostra o que faria o pagamento falhar agora; falta a tela do que já falhou.

## What Changes

- Rota nova de leitura `GET /api/v1/admin/purchase-trail/errors?market=br|us`, com `billing.subscribers.read`, `market` obrigatório (ausente ou inválido = 400; fora do escopo do staff = 403 `market_forbidden`), filtros de período (dentro de 180 dias), área e código de erro, paginação por cursor, mais recentes primeiro. Só lê as tabelas da migration `1700000000090`.
- Painel: página "Erros de compra" em `/operations/purchase-errors`, primeiro item do grupo Operação, acima de "Checkout da loja". Somente leitura: lista densa de falhas, linha expansível com os passos da tentativa, link para a ficha do cliente na aba "Trilha de compra" com o mercado da linha, e seção separada com os eventos de configuração que falharam (rota `config-events` existente).
- A ficha do cliente passa a aceitar o mercado na URL (`?aba=trilha&mercado=BR|US`) para abrir a aba já no mercado da linha.
- Manifesto de rotas e contract do painel atualizados.

Fora: gravação (recorder, middleware, webhook, job de retenção), migration, entidade TypeORM, alertas, métricas, gráficos, replay, export, mutação, tela na loja, e qualquer mudança em "Checkout da loja" além da posição no menu.

## Capabilities

### New Capabilities
- `purchase-error-monitor`: listagem transversal, somente leitura e por mercado, das falhas já gravadas na trilha de compra, e a tela do painel que a mostra.

### Modified Capabilities
(nenhuma; `customer-purchase-trail` ainda não foi arquivado e sua gravação não muda)

## Impact

- API: `src/api/routes/admin-purchase-trail.routes.js`, `src/services/customer-purchase-trail.service.js` e `src/infrastructure/repositories/customer-purchase-trail.repository.js` (só leitura nova); `docs/api-routes.json`.
- Painel: `src/lib/menu.ts`, `src/App.tsx`, página nova em `src/pages/`, `src/pages/UserDetailPage.tsx` e `src/components/PurchaseTrail.tsx` (mercado inicial pela URL), `contracts/backend-routes.json`, `e2e/helpers/mockAdminApi.ts` e spec Playwright.
- Sem dependência nova, sem schema novo.
