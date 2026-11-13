# Proposal

## Why

Lote 5 da proposta de melhorias do painel (`docs/analise/proposta-melhorias.md`, na raiz do workspace): volume e conforto. Nenhum item muda o que o sistema permite. Hoje:

- as filas de etiquetas e de courier cortam em 100 e 200 pedidos sem dizer o que ficou de fora;
- o aviso de bloqueio de um pedido não pago não diz para quando a cobrança vai;
- o Hoje não conta os problemas de endereço nem as exceções de mercado que o lote 3 criou;
- o selo "Falta estoque" não diz de qual receita.

O change irmão `admin-flow-fixes-5` em `eden-bowls-admin` (painel) consome estas mudanças. A loja não muda. Decisões já tomadas:

- **PM-29 por filtro de data**, sem paginação. Ainda não há produção, só QA, e o volume esperado cabe num recorte de poucos dias.
- **PM-10 (ações em lote) sem rota nova.** O painel chama o `PATCH /admin/production/queue/:id` que já existe, um pedido por vez. Este change não toca nisso.
- **PM-09 entra no lote.** O backend só precisa dizer quais receitas faltam.

## What Changes

- **Filas por período de entrega (PM-29).**
  - `GET /admin/courier-deliveries/queue` e `GET /admin/shipments/queue` aceitam `from` e `to` (datas `YYYY-MM-DD`).
  - **Padrão:** sem `from`/`to`, o recorte vai do piso de 30 dias até amanhã: atrasados, hoje e amanhã.
  - **O que o período limita.** Só os pedidos ainda sem saída: "A despachar" no courier e "Prontos" nas etiquetas. "Em rota", "Falhas" e "Entregues" do courier, e as compras sem confirmação e as etiquetas criadas, continuam como hoje.
  - **Resposta.** Ganha `range` (`from`, `to`, `default`), `later` (quantos pedidos sem saída têm entrega depois de `to`) e, quando a lista é cortada, `next_from` (a data de entrega do primeiro pedido que ficou de fora).
  - **Recusa.** Uma data inválida, `from` depois de `to`, `from` antes do piso de 30 dias ou `to` mais de 31 dias depois de `from` é recusado com `400 invalid_delivery_range`. O padrão tem exatamente 31.
  - **Limites.** O de 200 do courier passa a contar só "A despachar": quem já saiu ou falhou deixa de ocupar vaga. O de 100 das etiquetas conta só os prontos; criadas e sem confirmação têm consulta própria.
  - **Hoje.** A contagem "a despachar" do Hoje passa a seguir o recorte padrão da fila (até amanhã), para o número do card bater com a lista que ele abre.
- **Prévia do bloqueio (PM-15 com data).** Rota nova `GET /admin/production/queue/:id/block-preview?periodEnd=…` (`production.write`, `market: 'record'`). Diz se o ciclo já foi cobrado e, se não foi, para quando o bloqueio adia a cobrança e qual o dia de preparo. A prévia usa o mesmo cálculo do bloqueio e não chama a Stripe.
- **Receitas em falta (PM-09).** Cada item `short` da fila de produção ganha `stockShortages`: as receitas e tamanhos que não couberam no saldo, na mesma distribuição por ordem de entrega que já decide `stockCoverage`.
- **Hoje, segunda etapa (PM-26).** O bloco `fulfillment` ganha:
  - `addressIssues`: por mercado (`BR`, `US`), quantos problemas de endereço estão abertos (`open`) e quantos estão abertos há 72 horas ou mais (`stale`, o mesmo corte do "Sem correção há N dias" do painel);
  - `marketExceptions`: por mercado da conta Stripe (`BR`, `US`), quantas assinaturas estão em exceção, pela regra da lista e sem o corte de 200 dela.

  As contagens respeitam o escopo de mercado do operador e não herdam o teto de 200 itens.

## Capabilities

### New Capabilities

- `production-block-preview`: a prévia do efeito de um bloqueio na cobrança do ciclo.

### Modified Capabilities

- `courier-delivery`: "A despachar" passa a ser lido por período de entrega, com o que ficou depois e onde a lista cortou.
- `ups-label-queue`: os prontos passam a ser lidos por período de entrega, do mesmo jeito.
- `pack-stock`: o item `short` da fila diz quais receitas faltam.
- `admin-today`: conta problemas de endereço e exceções de mercado, e "a despachar" segue o recorte padrão do courier.

## Impact

- **Filas.**
  - `src/services/courier-delivery.service.js` (`listQueue`, `countQueue`);
  - `src/services/ups-shipment.service.js` (`listLabelQueue`);
  - `src/infrastructure/repositories/subscription-ledger.repository.js` (`listPaidCourierCycles`, `listPaidLabelCycles`, `countPaidCourierCyclesToDispatch` e as contagens depois do período);
  - o parser do período e as duas rotas em `src/api/routes/admin.routes.js`.
- **Bloqueio.** `src/services/customer-deliveries.service.js` (prévia com `planBlockTrialEnd`), `src/services/admin-production.service.js` e a rota nova.
- **Estoque.** `src/core/pack-stock.js` (`allocateCoverage`), `src/services/admin-pack-stock.service.js`, `src/services/admin-production.service.js`.
- **Hoje.**
  - `src/services/admin-today.service.js` (`fulfillment`);
  - `delivery-address-issues.repository.js` (contagem por conta);
  - `subscription-ledger.repository.js` (contagem das exceções);
  - a injeção em `src/index.js`.
- **Rota nova:** `GET /admin/production/queue/:id/block-preview`.
  - `docs/api-routes.json` muda (`npm run routes:manifest`). Nenhuma rota é removida.
  - Os contratos de `GET /admin/courier-deliveries/queue`, `GET /admin/shipments/queue`, `GET /admin/production/queue` e `GET /admin/today` ganham campos. Nenhum campo existente muda. O painel atual ignora os campos novos e passa a ver só até amanhã nas filas.
- **Sem migração.**
- **Fora do escopo:**
  - a trava fiscal e "prontos aguardando NF-e" no Hoje (PM-25, lote 4);
  - a coleta UPS (PM-28, lote 6);
  - uma rota de lote para a produção (PM-10 usa o `PATCH` existente).
