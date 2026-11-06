# Tasks

Rode só os testes relacionados (`npx jest --runTestsByPath …` ou `--findRelatedTests`). Integração MySQL só no arquivo afetado, com `RUN_DB_INTEGRATION_TESTS=true`.

## 1. Banco e configurações

- [x] 1.1 Migração nova: tabela `ups_pickups` (colunas do design), `ups_shipments.pickup_id` (com índice) e `shipping_settings.ship_from_phone`, com `down`.

  Verificar: teste da migração no padrão dos outros (`hasColumn`/`hasTable` antes de criar; `down` remove) e `RUN_DB_INTEGRATION_TESTS=true` no teste de integração de migração existente, se houver um para `ups_shipments`.
- [x] 1.2 Configurações de frete dos EUA: `ship_from.phone` na entidade, no validador, no serviço (leitura e gravação) e no `ship_from` que a compra de etiqueta manda à UPS.

  Verificar: testes do validador e do serviço de frete (salva e lê o telefone; vazio continua aceito); teste do `UpsClient` mostra `Shipper.Phone` quando há telefone.

## 2. Cliente da UPS

- [x] 2.1 `UpsClient.createPickup({ pickupDate, readyTime, closeTime, packageCount, shipFrom, serviceCode, weightLb })` e `cancelPickup(prn)`, com `ensureCanShip()`.

  Verificar: `tests/ups-client.test.js` (corpo de `PickupCreationRequest`, data `YYYYMMDD` e horas `HHMM`, peso total, PRN lido da resposta, resposta sem PRN vira `502 ups_pickup_incomplete`, cancelamento com o cabeçalho `Prn`, cliente de simulação recusa).

## 3. Coletas

- [x] 3.1 Repositório de coletas: `insertPending`, a reserva das etiquetas (`UPDATE … WHERE pickup_id IS NULL`) na mesma transação, `markRequested`, `markUnknown`, `release` (cancelar, fechar, apagar a reserva recusada), `list({ from })`, `findById`, `listActiveByIds`.

  Verificar: teste do repositório (SQL) e `RUN_DB_INTEGRATION_TESTS=true` num teste de integração novo (reserva parcial desfaz tudo; duas reservas ao mesmo tempo, uma ganha; soltar zera `pickup_id`).
- [x] 3.2 Serviço de coleta: `request`, `cancel`, `markNotCreated` e `list`, com escopo de mercado (só EUA), validação de data (hoje ou próximo dia de coleta em Nova York, sem fim de semana nem `closesPickup`), janela, quantidade, `ship_from` completo, auditoria e os códigos da spec.

  Verificar: teste novo do serviço (segunda com 8 etiquetas; etiqueta em coleta ativa; etiqueta anulada; dia fechado; sábado; dois dias à frente; janela invertida; sem telefone; timeout vira `unknown`; recusa da UPS solta as etiquetas; cancelar chama a UPS e solta; cancelar cancelada é 409; fechar `unknown`; operador do Brasil recebe lista vazia; auditoria em cada ação).
- [x] 3.3 Rotas `GET /admin/shipments/pickups`, `POST /admin/shipments/pickups`, `POST /admin/shipments/pickups/:id/cancel` e `POST /admin/shipments/pickups/:id/not-created`, com as permissões; `src/index.js` monta o serviço.

  Verificar: teste de rotas novo (403 para quem só lê nas escritas; `from` repassado; códigos e detalhes chegam à resposta); `npm run routes:manifest` e `tests/api-routes-manifest.test.js`.

## 4. Fila e Hoje

- [x] 4.1 `listLabelQueue`: `pickup` em cada item `created` (coleta ativa ou `null`), lido de uma vez.

  Verificar: `tests/ups-label-queue.test.js` (etiqueta com coleta pedida; coleta cancelada dá `null`; uma leitura por fila).
- [x] 4.2 `fulfillment.upsLabelsWithoutPickup` no Hoje: consulta no repositório de envios e o mesmo escopo de `upsUnresolved`.

  Verificar: teste do repositório (SQL) e `tests/admin-today.service.test.js` (conta; já com leitura não conta; operador do Brasil recebe 0).

## 5. Fechamento

- [x] 5.1 `npx jest --changedSince=HEAD`, `docs/api-routes.json` commitado com as quatro rotas, e uma chamada de coleta de teste no CIE do QA (pedir e cancelar), com o resultado anotado no PR.
