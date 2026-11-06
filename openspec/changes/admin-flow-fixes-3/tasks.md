# Tasks

Rode só os testes relacionados (`npx jest --runTestsByPath …` ou `--findRelatedTests <source>`), nunca a suíte inteira. Integração MySQL só com `RUN_DB_INTEGRATION_TESTS=true` no arquivo afetado.

## 1. Mercado de saída (PM-21)

- [ ] 1.1 `src/core/shipment-market.js` com `shipmentMarket({ stripeAccount, address })`.
  - Verificar: `tests/shipment-market.test.js` cobre os pares br/BR, us/US, br/US, us/BR e o país vazio.
- [ ] 1.2 `subscription-ledger.repository.js` usa o helper SQL do mercado em três consultas:
  - `listPaidCourierCycles` e `countPaidCourierCyclesToDispatch`: conta `br` e país `BR`;
  - `listPaidLabelCycles`: conta `us` e país `US`.

  Verificar: integração da fila (`tests/integration/subscription-ledger-queue.integration.test.js`) com um ciclo cruzado, ausente nas duas filas e na contagem.
- [ ] 1.3 `requireDeliverableInvoice` (courier) recusa `shipment_market_exception` no par cruzado ou com país vazio e mantém `courier_country_not_supported` para us/US. `inspectLabel` (UPS) põe `shipment_market_exception` como primeiro motivo.
  - Verificar: testes do serviço de courier e de UPS (despacho, compra avulsa e linha da fila).
- [ ] 1.4 `recordPaidInvoice` busca a assinatura pelo `subscriptionId` e não grava a linha para uma exceção, com `logger.warn`. `invoiceLocale` passa a seguir só a conta.
  - Verificar: testes da NF-e (exceção sem linha, BR normal com linha) e de `invoice-document` (us com endereço BR em en-US).
- [ ] 1.5 Lista de exceções:
  - consulta no ledger com teto de 200 e `open_paid_cycles`;
  - `GET /admin/market-exceptions` (`shipping.read`, `market: 'query'`);
  - `npm run routes:manifest`.

  Verificar: teste da rota (admin vê, staff US não vê br, sem permissão dá 403), integração da consulta e `tests/api-routes-manifest.test.js`.
- [ ] 1.6 `admin-billing.service.js`: o detalhe ganha `shipment_market` e `market_exception`.
  - Verificar: teste do presenter do detalhe com um par cruzado.

## 2. Endereço exigido na gravação e dados fiscais na edição (PM-23)

- [ ] 2.1 `src/core/delivery-address-check.js` com `brazilAddressIssues` e `usAddressIssues`. `inspectLabel` passa a usar `usAddressIssues`, sem mudar os códigos.
  - Verificar: `tests/delivery-address-check.test.js` e os testes atuais de UPS passando iguais.
- [ ] 2.2 Checkout: `checkout-state.js` `hasAddress` e o serviço do checkout exigem a rua, e no BR o número e o bairro, com 422 `address_incomplete` e `fields`.
  - Verificar: testes do checkout (BR sem bairro, US sem rua, completo passa).
- [ ] 2.3 Edição:
  - `withLedgerMarket` vira `assertLedgerMarket`: `address_country_mismatch` e `subscription_market_mismatch`; sem país, o payload recebe o da conta;
  - a mesma checagem roda no preview e no commit;
  - com endereço, a edição exige os campos obrigatórios (`address_incomplete`) e o nome de quem recebe, enviado ou gravado (`recipient_name_required`).

  Verificar: testes de preview e commit (país trocado, endereço gravado cruzado, só pacotes passa, sem nome nos dois lados, completo passa).
- [ ] 2.4 `tax_document` e `fiscal_name` no validador da edição:
  - só na conta `br`; na `us`, `fiscal_fields_not_allowed`;
  - o commit grava os metas depois do `upsert`.

  Verificar: testes do validador e do commit (CPF inválido não grava nada, nome fiscal válido grava, falha na Stripe não grava).
- [ ] 2.5 `subscription-dashboard.js`: o detalhe da loja ganha `fiscal` (conta `br`, últimos 4 dígitos) e `market_mismatch`.
  - Verificar: teste do detalhe com CPF sem nome fiscal e com o par cruzado.

## 3. Trava de saída por endereço e NF-e com o endereço da assinatura (PM-22)

- [ ] 3.1 Courier:
  - `dispatch` recusa com 422 `courier_address_incomplete` e `issues` antes da regra de prontidão, sem contorno por `confirm_not_ready`;
  - `presentQueueItem` devolve `issues` nas linhas `to_dispatch` e `failed`.

  Verificar: testes do serviço e da rota de courier.
- [ ] 3.2 Migração `1700000000067-add-nfe-missing-fields.js` (`missing_fields JSON NULL`).
  - Verificar: a migração sobe e desce no MySQL de teste.
- [ ] 3.3 Cliente da NF-e:
  - `findCustomer(userId, stripeSubscriptionId)` lê o endereço da assinatura;
  - `customerSnapshot` usa só o nome fiscal e calcula `missing_fields`;
  - `recordPaidInvoice` trava sem CPF ou sem nome fiscal.

  Verificar: testes da NF-e (sem nome fiscal trava com `["fiscal_name"]`, endereço da assinatura copiado) e integração do repositório.
- [ ] 3.4 Releitura na emissão:
  - `emit` relê o cliente (`refreshCustomer`) em toda nota que não seja `customerEdited`;
  - `retry` sem a condição de `blingContactId`;
  - `refreshBlockedForUser(userId)`.

  Verificar: testes do job (pendente pega o endereço novo, correção do operador mantida, bloqueada volta à fila quando completa).
- [ ] 3.5 `bling-client.js` ganha `updateContact(id, payload)` (`PUT /contatos/{id}`):
  - `ensureContact` atualiza o contato achado quando o nome ou o endereço divergem;
  - `applyCustomerEdit` roda sempre que a NF-e é editável e difere.

  Verificar: teste do cliente (método, caminho e corpo) e testes do job (contato igual não chama, divergente chama antes do pedido).
- [ ] 3.6 O detalhe da NF-e devolve `missing_fields`.
  - Verificar: teste do presenter.

## 4. Problema de endereço e e-mail (PM-24)

- [ ] 4.1 Migração `1700000000066-create-delivery-address-issues.js`, com `open_key` único e `utf8mb4_unicode_ci`, e um repositório com:
  - `findOpen`, `insertOpen` (a corrida no índice único lê o vencedor), `close`;
  - `latestForSubscriptions`, `listByUser`, `deleteByUser`.

  Verificar: integração do repositório (`RUN_DB_INTEGRATION_TESTS=true`) com dois abertos concorrentes.
- [ ] 4.2 `DeliveryAddressIssueService` com `report`, `resolveIfPasses` e `latestForSubscriptions`:
  - mesmo conjunto não faz nada;
  - outro conjunto encerra como `superseded` e abre o novo;
  - um erro no serviço só vai ao log.

  Verificar: `tests/delivery-address-issue.service.test.js`.
- [ ] 4.3 E-mail `deliveryAddressIssue`:
  - template em pt-BR e en-US em `core/email/transactional-emails.js`;
  - `notifyDeliveryAddressIssue` em `transactional-mailer.js`, por `sendClaimed` com `referenceId` igual ao id do problema;
  - grava `email_sent_at`;
  - entra nas configurações de e-mail automático.

  Verificar: testes do template (link `?step=address`, um parágrafo por código, idioma pela conta) e do mailer (segunda chamada vira `duplicate`).
- [ ] 4.4 Gatilhos:
  - `payment_check` no webhook de `invoice.paid`;
  - `courier_check` em `dispatch`;
  - `ups_check` em `createForSubscription`;
  - `courier_failed` em `markFailed` com `address_unusable`;
  - `nfe_check` em `recordPaidInvoice` e `emit`;
  - injeção em `index.js`.

  Verificar: um teste por gatilho no serviço de cada um, e o teste da fila confirmando que a leitura não abre problema.
- [ ] 4.5 Encerramento: o commit da edição chama `resolveIfPasses`, para o endereço e para os dados fiscais.
  - Verificar: teste do commit (endereço corrigido encerra; só endereço, com CPF ainda faltando, mantém aberto).
- [ ] 4.6 `address_issue` nas linhas do courier e das etiquetas, no detalhe da assinatura no admin e no detalhe da NF-e, numa consulta por leitura.
  - Verificar: testes dos serviços de fila e dos presenters.
- [ ] 4.7 `privacy.service.js`: os problemas entram no export e saem com a exclusão da conta.
  - Verificar: testes de privacidade.

## 5. Fechamento

- [ ] 5.1 Atualizar `src/scripts/lote3-precheck.js`, se alguma contagem mudou de critério com a regra nova (mercado pelo par conta/país).
  - Verificar: o teste do script confere que toda consulta é `SELECT`.
- [ ] 5.2 Rodar os testes relacionados a todos os arquivos alterados (`npx jest --findRelatedTests <arquivos>`) e as integrações afetadas com `RUN_DB_INTEGRATION_TESTS=true`.
  - Verificar: tudo passa, e o manifesto de rotas está atualizado e commitável.
