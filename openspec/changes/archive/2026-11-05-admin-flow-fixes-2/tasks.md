# Tasks

Rodar só os testes relacionados (`npx jest --runTestsByPath …` ou `--findRelatedTests <source>`), nunca a suíte inteira. Integração MySQL só com `RUN_DB_INTEGRATION_TESTS=true` no arquivo afetado.

## 1. Hoje: compra UPS não confirmada (PM-03)

- [x] 1.1 `admin-today.service.js`: `labeledInvoices` usa `listActiveByInvoiceIds` e devolve o status por fatura; `upsLabel` vira `unresolved` para `pending`/`unknown`, `created` para `created`/`delivered`, `missing` sem linha. Verificar: teste do serviço de Hoje (criar `tests/admin-today.service.test.js` se nenhum cobrir) com os três casos.

## 2. Courier: motivo estruturado (PM-12)

- [x] 2.1 Migração `1700000000064-add-courier-failure-kind.js` (`failure_kind VARCHAR(32) NULL`). Verificar: migração sobe e desce no MySQL de teste.
- [x] 2.2 `core/courier-fields.js` ganha `parseFailureKind` (valores fechados, 422 `invalid_courier_field` com `field: failure_kind`); `markFailed` grava e audita o tipo; o presenter devolve `failure_kind`. Verificar: testes de courier-fields e do serviço/rota de courier (falha com tipo, tipo inválido, sem tipo).

## 3. UPS: confirmação de pedido não pronto (PM-20)

- [x] 3.1 Extrair a regra de prontidão do courier para `src/core/` e usá-la no courier sem mudar o comportamento. Verificar: testes de courier passam iguais.
- [x] 3.2 `ups-shipment.service.js` `createForSubscription`: depois do reuso da linha ativa e de `inspectLabel` (o 422 de endereço vem antes) e antes de `insertPending`, 409 `ups_label_needs_confirmation` com `reasons` sem `confirm_not_ready: true`; a rota repassa o campo; auditoria com `confirmedNotReady`. Injetar o ledger no serviço em `index.js`. Verificar: testes do serviço/rota de UPS (não pronto sem confirmação, confirmado, pronto, linha ativa existente, endereço inválido e não pronto responde 422).

## 4. Fila do courier com endereço, telefone, instruções e itens (PM-11)

- [x] 4.1 Consulta por lote de `user_id` para `billing_phone` e `delivery_instructions` do perfil; `presentQueueItem` acrescenta `address` (rua, número, complemento, bairro, cidade, UF, CEP), `phone`, `delivery_instructions` com `delivery_instructions_source: 'profile'` e `items` pelo presenter da fila de produção. Verificar: teste do serviço de courier (linha completa, sem telefone) e o teste da rota da fila.

## 5. Ciclos pagos da assinatura (PM-13)

- [x] 5.1 `subscription-ledger.repository.js`: `listPaidCyclesBySubscription(id, limit)` a partir de `queueSourceSql`, ordenado por `COALESCE(delivery_date, DATE(cycle_period_end)) DESC`. Verificar: teste do repositório (SQL e parâmetros) e, com `RUN_DB_INTEGRATION_TESTS=true`, um teste de integração com ciclo pago, ciclo sem data de entrega e fatura zero sem ciclo.
- [x] 5.2 Rota `GET /api/v1/admin/billing/subscriptions/:id/paid-cycles` (`shipping.read`, `market: 'record'`) com a etiqueta ativa e a última entrega do courier por fatura. Verificar: teste de rota (ciclo a expedir, ciclo com etiqueta, mercado de fora) e `npm run routes:manifest`.

## 6. Registro de contato (PM-17)

- [x] 6.1 Migração `1700000000065-create-customer-contacts.js` e repositório. Verificar: migração sobe e desce; teste do repositório.
- [x] 6.2 Serviço e validador (motivos, resultados, nota ≤ 500, 422 `invalid_contact`), rotas `GET`/`POST /api/v1/admin/billing/subscriptions/:id/contacts` (`billing.subscribers.read` / `customers.contact.write`, `market: 'record'`), auditoria `customers.contact.create` sem a nota. Verificar: teste de rota (gravar, valor inválido, readonly 403, lista mais nova primeiro, mercado de fora).
- [x] 6.3 `admin-roles.js`: `customers.contact.write` para operador (e admin por herança). Verificar: teste de papéis e `tests/admin-me.routes.test.js`.
- [x] 6.4 Export em `privacy.service.js` `buildExportPackage` (contatos sem o e-mail do operador); exclusão em `profile.service.js` `deleteAccount`, que atende a loja e o pedido de privacidade. Verificar: teste do export e teste de `deleteAccount` (contatos apagados), cobrindo a exclusão pela loja.

## 7. Hoje com courier, NF-e e Bling (PM-26, primeira etapa)

- [x] 7.1 Bloco `fulfillment` com contagens próprias no escopo do ator, cada uma com a regra da tela de destino e não o tamanho de uma lista cortada: a despachar BR (regra da aba), em rota há mais de 24 h, falhas sem novo despacho (última entrega da fatura falhou), NF-e por status, UPS `pending`/`unknown` e `blingConnected` só com `bling.connect`. Injetar courier, NF-e, Bling e UPS em `index.js`. Verificar: teste do serviço de Hoje (BR, US, admin com Bling desconectado, 230 a despachar com a lista cortada em 200, falha seguida de novo despacho não conta).
- [x] 7.2 Último contato e telefone da conta nos itens `past_due`, numa consulta por lote. Verificar: teste do serviço de Hoje (com e sem contato, sem telefone, item não `past_due` sem telefone).
- [x] 7.3 `courierDelivery` nos itens BR pagos: última entrega da fatura (`none`, `out_for_delivery`, `delivered`, `failed`; cancelada conta como `none`). Verificar: teste do serviço de Hoje com cada caso.

## 8. Levantamento antes do lote 3

- [x] 8.1 `src/scripts/lote3-precheck.js`, só leitura: ciclos pagos em aberto com endereço incompleto, com NF-e não autorizada, sem linha de NF-e, de cliente BR sem `_eden_fiscal_name`, com endereço de país diferente da conta, e os cruzados (X-03). Verificar: roda contra o MySQL de QA e imprime as contagens sem escrever nada.

## 9. Fechamento

- [x] 9.1 `npx jest --changedSince=HEAD`, `npm run routes:manifest` commitado com as três rotas novas e nenhuma em `docs/api-routes-removed.json`. Verificar: testes verdes, `tests/api-routes-manifest.test.js` verde.
