# Proposal

## Why

Lote 4 da proposta de melhorias do painel (`docs/analise/proposta-melhorias.md`, na raiz do workspace): a trava fiscal (PM-25). Hoje uma caixa do Brasil sai pelo courier com ou sem NF-e, e ninguém confere. A fila "A despachar" não diz se a nota da fatura foi autorizada, e `POST /admin/billing/subscriptions/:id/courier-deliveries` não olha a NF-e.

O change irmão `admin-flow-fixes-4` em `eden-bowls-admin` (painel) consome estas mudanças. A loja não muda. O que já existe e este change usa:

- PM-21 (lote 3): uma assinatura em exceção de mercado não entra na fila de courier, então nenhuma caixa cruzada fica travada por falta de nota.
- PM-22 e PM-24 (lote 3): "sem CPF ou nome fiscal" já abre um problema de endereço e manda o e-mail ao cliente.
- `bling_nfe` guarda uma nota por fatura (índice único `stripe_account` + `stripe_invoice_id`), com `status` `pending`, `blocked_missing_document`, `submitted`, `authorized`, `rejected`, `canceled` ou `error`.

Ainda não há produção, só QA. Não há pedidos em andamento para proteger, então este change não traz script para registrar notas antigas (`recordPaidInvoice` retroativo): onde a trava estiver ligada, um ciclo pago sem linha em `bling_nfe` fica travado como "sem nota registrada".

## What Changes

- **Interruptor por ambiente.** Variável nova `COURIER_REQUIRE_AUTHORIZED_NFE` (booleana), desligada sem valor. Não pode seguir `NODE_ENV`: o QA roda com `NODE_ENV=production` (`.env.qa.example`), e com o Bling de homologação nem sempre conectado a trava pararia todo despacho do QA. Produção liga a variável pelo checklist de `docs/production-go-live.md`, como já exige o cookie seguro e o CORS. Quem quiser ensaiar a trava no QA liga explícito.
- **Trava no despacho.** Com o interruptor ligado, o despacho de um ciclo cuja fatura não tem NF-e `authorized` é recusado com `422 courier_nfe_not_authorized`, com `nfe_status` (o status da nota, ou `null` sem nota) e `nfe_id` nos detalhes. É trava, não aviso:
  - a checagem roda antes da checagem de "pronto", e `confirm_not_ready` não a libera;
  - nenhum campo do corpo a libera;
  - vale também para "Despachar de novo" depois de uma falha, que é o mesmo `POST`.
  Com o interruptor desligado, o despacho segue como hoje.
- **NF-e na fila.** Cada item de "A despachar" e de "Falhas" de `GET /admin/courier-deliveries/queue` ganha `nfe`: `{ id, status, number }` da nota da fatura, ou `null` sem nota. As notas da página são lidas de uma vez (uma consulta por `stripe_invoice_id`). A resposta ganha `nfe_required`, o valor do interruptor, para o painel saber se a nota trava ou só informa.
- **Hoje.** O bloco `fulfillment` ganha `courierAwaitingNfe`: quantos ciclos de "A despachar", no recorte padrão da fila, têm fatura sem NF-e `authorized`. É um subconjunto de `courierToDispatch`, que não muda: "3 a despachar" inclui os "2 aguardando NF-e". "Falhas" fica fora da conta, embora "Despachar de novo" também trave. Com o interruptor desligado, vale `null`. Respeita o escopo de mercado (0 para quem não vê o Brasil) e não herda o teto de 200.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `courier-delivery`: requisitos novos para a trava fiscal no despacho (com o interruptor) e para a NF-e nas linhas da fila.
- `admin-today`: `fulfillment` conta os pedidos a despachar aguardando NF-e.

## Impact

- **Código:**
  - `src/config/env.js`: `COURIER_REQUIRE_AUTHORIZED_NFE`.
  - `src/services/courier-delivery.service.js`: a checagem em `dispatch`, `nfe` e `nfe_required` em `listQueue`, a contagem para o Hoje.
  - `src/infrastructure/repositories/bling-nfe.repository.js`: leitura das notas de várias faturas de uma vez.
  - `src/infrastructure/repositories/subscription-ledger.repository.js`: contagem de ciclos a despachar sem nota autorizada.
  - `src/services/admin-today.service.js` e `src/index.js`: o repositório de NF-e e o interruptor injetados no `CourierDeliveryService`.
- **API:** nenhuma rota nova nem removida; o manifesto de rotas não muda. Campos novos na fila do courier e no Hoje, e um código de erro novo no despacho.
- **Ambientes:** produção liga a variável e precisa do Bling conectado; com o Bling fora, nenhuma caixa do Brasil sai pelo courier. QA, local e teste seguem sem trava, a menos que a variável seja ligada.
- **Docs:** `docs/production-go-live.md` (variável obrigatória em produção), `.env.example` e `.env.qa.example`.
- **Sem migração.**
