# Proposal

## Why

O painel trata Brasil e Estados Unidos como um único conjunto de registros. Operador e readonly com `users.read` (e equivalentes) listam e abrem clientes, onboarding, billing e produção dos dois mercados. Os papéis atuais controlam o que a pessoa pode fazer, não o que ela pode ver. Com operação nos dois países, isso vaza dados do mercado errado.

## What Changes

- Staff operacional ganha um mercado persistido por usuário (`BR` ou `US`). Admin e e-mails da allowlist continuam vendo os dois.
- `GET /api/v1/admin/me` passa a devolver `markets` e permissões derivadas `market.br` / `market.us`.
- Convite, PATCH de acesso e PUT de papéis exigem `market` quando o papel não é `admin`. Locks de último admin, self-demote e allowlist permanecem.
- Toda rota `/api/v1/admin/*` declara `marketScope`: `none` | `query` | `record`.
- Listas e métricas recortam no **WHERE** pelo campo canônico do recurso. Filtro pedido fora do escopo → `403 market_forbidden`. Registro do outro mercado → `404`.
- Cliente e onboarding gravam mercado na **primeira escrita**. Troca depois só por ação explícita do admin.
- Billing, produção, cupons, faturas e webhooks continuam mandando por `stripe_account`. Identidade na fila/billing vem do snapshot do ledger, não do perfil cruzado. PDF de fatura não tenta o outro Stripe.
- Script de backfill com `--dry-run` (órfãos e conflitos perfil vs Stripe). Flag `ADMIN_ENFORCE_STAFF_MARKET` para o `403 market_required`.
- **BREAKING** (depois da atribuição): operator/readonly/nutritionist com mercado deixa de ver o outro país. Com a flag ligada, staff sem mercado toma `403 market_required` em rotas `query`/`record`.

## Capabilities

### New Capabilities

- `admin-market-scope`: isolamento por mercado no painel — identidade do staff, declaração de escopo nas rotas admin, recorte SQL, 403/404, canônico na escrita, backfill e rollout.

### Modified Capabilities

- (nenhuma — o inventário de specs do backend está vazio)

## Impact

- **Backend (este repo):** `admin-roles.js`, `admin-identity.service.js`, `require-admin-permission.middleware.js`, `admin.routes.js`, `privacy.routes.js`, validators/services/repos de users, onboarding, catalog, billing, production, feedbacks, privacy, coupons, shipping; migração `1700000000019` (`onboarding_user_state.market`); first-write de `hsr_market_country`; script `src/scripts/backfill-admin-markets.js`; Jest de isolamento e da matriz record.
- **Painel (`eden-bowls-admin`, repo irmão):** consumidor de `markets` em `/admin/me`. Fora do apply deste change. Precisa de change OpenSpec própria (campo Mercado no convite/papéis, pickers, dashboard, esconder link Cliente/360).
- **Dados:** usermeta `_eden_admin_markets` e `hsr_market_country`; coluna `onboarding_user_state.market`. Sem tabela `admin_user_markets`. JWT permanece só com `user.id`.
- **Fora de escopo:** loja `eden-bowls`; operador com os dois mercados; mercados no JWT; UI de auditoria; índice extra em `meta_value` sem `EXPLAIN`.
