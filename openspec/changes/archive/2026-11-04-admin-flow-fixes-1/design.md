# Design

## Context

Ver proposal.md (Why). Os quatro ajustes servem ao change irmão do painel e são aditivos. `src/core/admin-market-scope.js` já tem `effectiveMarkets(identity, env)`, usado pelo escopo das rotas; ele lança `403 market_required` quando a flag está ligada e o operador não tem mercado. `GET /admin/me` devolve `request.adminIdentity` direto, com chaves em camelCase. O validador da lista de NF-e limita `status` a 32 caracteres, e o de correção do cliente descarta chaves desconhecidas (zod sem `passthrough`), então `reason` hoje some em silêncio.

## Goals / Non-Goals

**Goals:** dar ao painel o dado de que ele precisa sem mudar o que a API aceita ou recusa hoje.

**Non-Goals:** exigir `reason` na API; auditar `PATCH /admin/users/:userId/fiscal` (fica como está neste lote); mudar o escopo de mercado das rotas.

## Decisions

**`effectiveMarkets` a partir da função do escopo.** Calcular com `effectiveMarkets` e tratar o `market_required` como `[]`, em vez de reimplementar a regra. Assim o menu nunca diverge do que as rotas aplicam. `/admin/me` continua `market: 'none'` e não passa a recusar ninguém.

**Lista de status por vírgula no mesmo parâmetro.** `status=a,b,c` evita parâmetro novo e mantém o formato de URL do painel. O validador sobe o limite de `status` para caber os três maiores nomes, separa, confere cada um contra `NFE_STATUSES` e o repositório usa `IN (...)`. Alternativa: `status[]=`. Descartada: o cliente HTTP do painel monta query com `buildQueryString`, que não serializa arrays.

**`reason` opcional, auditado, fora do endereço.** `AdminUsersService.updateDelivery` passa a separar `reason` do corpo antes de chamar `profileService.updateDelivery`, então o endereço salvo não ganha a chave. O evento `users.delivery.update` leva só os nomes dos campos enviados, não os valores, para não duplicar dado pessoal na auditoria.

**Busca da fila pelas quatro chaves de nome.** `JSON_UNQUOTE(JSON_EXTRACT(q.address, '$.<chave>')) LIKE ?` para cada chave, no mesmo `OR` do `q` atual. Mesma ordem do presenter da fila. Sem índice novo: o volume é baixo (X-01) e a busca já usa `LIKE '%…%'`.

## Risks / Trade-offs

- [Um painel antigo que leia `/admin/me` estritamente] → O campo é novo e opcional; o painel atual ignora chaves extras.
- [Busca por `LIKE` em JSON em tabela grande] → Aceitável no volume atual; revisitar com PM-29 se a fila crescer.
- [Auditoria de delivery passa a existir] → Eventos novos em `admin_audit_events`; nenhum consumidor quebra.

## Migration Plan

Deploy antes do painel. Rollback: reverter; o painel novo degrada como descrito no design dele (sem `effectiveMarkets` usa `markets`; sem a lista de status, "Precisam de ação" mostra erro). `docs/api-routes.json` não muda.
