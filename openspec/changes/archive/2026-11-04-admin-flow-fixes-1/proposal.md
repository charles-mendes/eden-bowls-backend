# Proposal

## Why

Lote 1 da proposta de melhorias do painel (`docs/analise/proposta-melhorias.md`, na raiz do workspace). O change irmão no painel (`admin-flow-fixes-1` em `eden-bowls-admin`) corrige atalhos, textos e filtros. Quatro dessas correções precisam de um ajuste pequeno e aditivo na API. Nenhum deles muda o que a API permite ou recusa hoje.

## What Changes

- **`/admin/me` com mercados efetivos (PM-27).** A resposta ganha `effectiveMarkets`: os mercados que o escopo da API de fato aplica ao usuário. Um operador sem mercado gravado recebe `markets: []` (como hoje) e `effectiveMarkets: ["BR","US"]` enquanto `ADMIN_ENFORCE_STAFF_MARKET` está desligada, e `[]` quando ela está ligada. O painel usa isso para montar o menu.
- **Lista de NF-e com vários status (PM-16).** `GET /admin/nfe` passa a aceitar `status` com até três valores separados por vírgula (para "Precisam de ação": `blocked_missing_document,rejected,error`). Um valor só continua igual.
- **Motivo nas correções de cópia (PM-07).** `PATCH /admin/users/:userId/delivery` e `PATCH /admin/nfe/:id/customer` aceitam `reason` opcional (3 a 255 caracteres) e o gravam na auditoria. A correção de endereço do perfil passa a ser auditada (hoje não é).
- **Busca da fila pelo nome (PM-18).** O `q` de `GET /admin/production/queue` também casa as chaves de nome do endereço da assinatura (`recipient_name`, `name`, `full_name`, `recipient`), as mesmas que a fila usa para mostrar o nome. O requisito fica no spec `operations/production-queue` do painel, que já descreve os parâmetros dessa rota.

## Capabilities

### New Capabilities

- `nfe-admin`: o que a API de NF-e do painel aceita nas listas e nas correções feitas pelo operador.
- `admin-customer-delivery`: como a API registra a correção, pelo operador, da cópia de endereço de entrega guardada no perfil do cliente.

### Modified Capabilities

- `admin-market-scope`: `GET /api/v1/admin/me` devolve também os mercados efetivos.

## Impact

- `src/services/admin-identity.service.js` (ou o ponto que monta `adminIdentity`), `src/core/admin-market-scope.js` (`effectiveMarkets`, já existe).
- `src/api/validators/admin-nfe.validator.js` (`parseNfeListQuery`, `parseNfeCustomerInput`), `src/services/bling-nfe.service.js` (`list`, `updateCustomer`), `src/infrastructure/repositories/bling-nfe.repository.js` (`list` com `IN`).
- `src/api/routes/admin.routes.js` (repasse de `reason` na rota de delivery), `src/services/admin-users.service.js` (`updateDelivery` grava auditoria).
- `src/infrastructure/repositories/subscription-ledger.repository.js` (busca da fila).
- Nenhuma rota nova, renomeada ou removida: `docs/api-routes.json` não muda. Sem migração.
