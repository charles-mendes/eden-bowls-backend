# Design

## Context

- `UpsClient` (`src/infrastructure/shipping/ups-client.js`) já tem OAuth, `request()` com timeout (`ups_timeout`, `upsTimeout`), erro de rede (`ups_network_error`, `upsNetwork`) e erro da UPS (`ups_upstream_error`). `ensureCanShip()` recusa o cliente só de simulação. Compra e anulação de etiqueta usam a versão `v2409`.
- `UpsShipmentService` monta a fila de etiquetas e o endereço de saída vem de `shippingService.settings.us.ship_from` (nome, rua, cidade, estado, CEP, país). Não há telefone.
- `ups_shipments` guarda `status` (`pending`, `unknown`, `created`, `delivered`, `voided`), `shipped_at` e as leituras do rastreio (`in_transit_at`, `out_for_delivery_at`).
- O calendário (`delivery_closed_days`) tem `closes_pickup` por mercado e dia, já usado no cálculo de datas dos EUA (`src/core/delivery-closed-days.js`).
- A compra sem confirmação da UPS (`unknown`) tem o caminho "Fechar após conferir na UPS". A coleta repete esse padrão.

## Goals / Non-Goals

**Goals:**

- Uma etiqueta está em, no máximo, uma coleta ativa (`requested` ou `unknown`), mesmo com dois pedidos ao mesmo tempo.
- A UPS é chamada uma vez por pedido de coleta. Um timeout nunca vira um segundo pedido automático.

**Non-Goals:**

- Mostrar o preço da coleta (Pickup Rate) ou travar a coleta por custo.
- Coleta em endereço diferente do `ship_from`, ou várias coletas por dia em locais diferentes.
- Consultar a situação da coleta na UPS depois do pedido (Pickup Pending Status). A confirmação de que a caixa saiu continua sendo o rastreio.
- Mudar a compra de etiqueta ou o texto "Aguardando coleta UPS" do Hoje.

## Decisions

- **Tabela `ups_pickups` e coluna `ups_shipments.pickup_id`.**
  - **Colunas da coleta:** `id`, `pickup_date` (DATE, dia de Nova York), `ready_time` e `close_time` (`HH:MM`), `package_count`, `status` (`pending`, `requested`, `unknown`, `canceled`, `not_created`), `prn`, `shipment_ids` (JSON, a lista enviada, para o histórico), `requested_by`, `closed_by`, `closed_at`, `last_error`, `raw_response`, `created_at`, `updated_at`.
  - **`pickup_id`** aponta a coleta ativa e volta a `NULL` quando a coleta é cancelada ou fechada; o histórico fica em `shipment_ids`.
  - **Alternativa descartada:** tabela de ligação. Ela guarda o histórico melhor, mas a trava de "uma coleta ativa por etiqueta" vira consulta mais `FOR UPDATE`, em vez de um `UPDATE … WHERE pickup_id IS NULL`.
- **Reserva antes da chamada.** Numa transação, `INSERT` da coleta como `pending`, depois `UPDATE ups_shipments SET pickup_id = ? WHERE id IN (…) AND status = 'created' AND pickup_id IS NULL`. Se as linhas afetadas forem menos que os ids, a transação desfaz e a resposta é `422 pickup_shipment_not_eligible`, sem chamar a UPS. Assim, dois pedidos ao mesmo tempo nunca pegam a mesma etiqueta.
- **Depois da chamada:**
  - com PRN, a coleta vira `requested`;
  - um timeout ou erro de rede vira `unknown`, as etiquetas ficam ligadas e a resposta é `502 pickup_unconfirmed`;
  - uma recusa da UPS apaga a reserva e solta as etiquetas (a spec diz que nada fica guardado), e a resposta repassa a mensagem da UPS.
- **Reserva que ficou `pending`.** Se o processo cair entre a reserva e a resposta da UPS, ou se falhar ao marcar `requested`/`unknown`, a coleta fica `pending` com as etiquetas presas. Depois de 5 minutos (o timeout da UPS é de segundos), a lista, a fila e a rota "não foi criada" tratam esse `pending` como `unknown`. Antes disso, "não foi criada" recusa com `409 pickup_not_unknown`, porque a resposta da UPS ainda pode chegar e gravar o PRN. A conta é feita na leitura (`effectivePickupStatus`), sem job.
- **Mesmo recorte no Hoje, na seção e na reserva.** Uma etiqueta entra na coleta só se está `created`, sem coleta ativa e sem leitura de rastreio (`in_transit_at` e `out_for_delivery_at` vazios). A contagem do Hoje, a lista da seção no painel e o `UPDATE` da reserva usam a mesma condição, para o aviso e o formulário nunca discordarem.
- **Validação antes da reserva.** A data é hoje ou o próximo dia de coleta em `America/New_York` (dia útil sem `closes_pickup` nos EUA), a janela é `HH:MM` com fim depois do início, e a quantidade é inteira a partir de 1. Endereço e telefone do `ship_from` são checados aqui também: o telefone precisa de 10 dígitos, e a recusa `pickup_ship_from_incomplete` diz em `missing` o que falta, para o painel falar do telefone quando é só ele.
- **`UpsClient.createPickup` e `cancelPickup`.**
  - **Criar:** `POST /api/pickupcreation/v2409/pickup` com `PickupCreationRequest`, levando:
    - `RatePickupIndicator: 'N'` e a conta (`Shipper.Account`);
    - `PickupDateInfo` (`PickupDate` `YYYYMMDD`, `ReadyTime` e `CloseTime` `HHMM`);
    - `PickupAddress` do `ship_from` com o telefone;
    - `PickupPiece` (serviço da etiqueta, quantidade, destino US, `ContainerCode` `01`);
    - `TotalWeight` = peso do pacote padrão × quantidade;
    - `PaymentMethod` `01` (conta).
    A resposta traz `PickupCreationResponse.PRN`.
  - **Cancelar:** `DELETE /api/shipments/v2409/pickup/02` com o cabeçalho `Prn`.
  - Os dois passam por `ensureCanShip()` e `retryOnUnauthorized: false` no criar, como a compra.
  - A versão da rota é conferida contra o CIE na implementação. Se a UPS só aceitar outra, muda a constante e nada mais.
- **Telefone em `ship_from`.** Coluna `ship_from_phone` (VARCHAR 32, nula), aceita no validador das configurações dos EUA e devolvida na leitura. A compra de etiqueta passa a mandar o telefone ao `Shipper` quando existir, porque `buildAddress` já aceita `phone`. Isso não muda o comportamento quando o campo está vazio.
- **`pickup` na fila.** `listLabelQueue` lê as coletas ativas das etiquetas `created` de uma vez, por `pickup_id`.
- **Contagem do Hoje.** Uma consulta em `ups_shipments`: `status = 'created' AND pickup_id IS NULL AND in_transit_at IS NULL AND out_for_delivery_at IS NULL`. Mesmo escopo de `upsUnresolved`: conta só com os EUA na tela e no escopo do operador.

## Risks / Trade-offs

- [A UPS cobra a coleta avulsa] → o custo é do contrato da conta; o painel não mostra o preço. Conferir o contrato antes de produção.
- [Coleta pedida e a caixa não sai] → a etiqueta continua `created`, com a coleta ligada, até o rastreio ler. Cancelar solta a etiqueta para outra coleta.
- [Corpo da API de coleta diferente no CIE] → testar com o CIE do QA antes de marcar a tarefa. O mapeamento fica todo em `createPickup`.
- [Etiqueta anulada que já estava numa coleta] → a coleta não muda e a UPS ainda vem buscar a quantidade pedida. Fica para outro lote; por ora o operador cancela e pede de novo.
- [Telefone ausente nas configurações] → a coleta recusa com `pickup_ship_from_incomplete`, e o painel diz onde cadastrar.

## Migration Plan

1. A migração cria `ups_pickups` e adiciona `ups_shipments.pickup_id` e `shipping_settings.ship_from_phone`, sem preencher nada. O `down` remove os três.
2. Cadastrar o telefone do remetente dos EUA em Configurações > Frete, no QA e depois em produção.
3. Reverter: as rotas novas deixam de ser usadas; as etiquetas e a compra seguem como hoje.
