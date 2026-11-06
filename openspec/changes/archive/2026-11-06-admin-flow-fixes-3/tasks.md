# Tasks

Rode só os testes relacionados (`npx jest --runTestsByPath …` ou `--findRelatedTests <source>`), nunca a suíte inteira. Integração MySQL só com `RUN_DB_INTEGRATION_TESTS=true` no arquivo afetado.

## 1. Mercado de saída (PM-21)

- [x] 1.1 `src/core/shipment-market.js` com `shipmentMarket({ stripeAccount, address })`, que lê o país cru, sem padrão.
  - Verificar: `tests/shipment-market.test.js` cobre os pares br/BR, us/US, br/US, us/BR, e a conta `us` sem país como exceção.
- [x] 1.2 `subscription-ledger.repository.js` usa o helper SQL do mercado em três consultas:
  - `listPaidCourierCycles` e `countPaidCourierCyclesToDispatch`: conta `br` e país `BR`;
  - `listPaidLabelCycles`: conta `us` e país `US`.

  Verificar: integração da fila (`tests/integration/subscription-ledger-queue.integration.test.js`) com um ciclo cruzado, ausente nas duas filas e na contagem.
- [x] 1.3 `requireDeliverableInvoice` (courier) recusa `shipment_market_exception` no par cruzado ou com país vazio e mantém `courier_country_not_supported` para us/US. `inspectLabel` (UPS) põe `shipment_market_exception` como primeiro motivo.
  - Verificar: testes do serviço de courier e de UPS (despacho, compra avulsa e linha da fila).
- [x] 1.4 `recordPaidInvoice` busca a assinatura pelo `subscriptionId` e não grava a linha para uma exceção, com `logger.warn`. `invoiceLocale` passa a seguir só a conta.
  - Verificar: testes da NF-e (exceção sem linha, BR normal com linha), de `invoice-document` e de `customer-invoices` (us com endereço BR: en-US, emissor US e numeração US).
- [x] 1.5 Lista de exceções:
  - consulta no ledger com teto de 200 e `open_paid_cycles`;
  - `GET /admin/market-exceptions` (`shipping.read`, `market: 'query'`);
  - `npm run routes:manifest`.

  Verificar: teste da rota (admin vê, staff US não vê br, sem permissão dá 403), integração da consulta e `tests/api-routes-manifest.test.js`.
- [x] 1.6 `admin-billing.service.js`: o detalhe ganha `shipment_market` e `market_exception`.
  - Verificar: teste do presenter do detalhe com um par cruzado.

## 2. Endereço exigido na gravação e dados fiscais na edição (PM-23)

- [x] 2.1 `src/core/delivery-address-check.js` com `brazilAddressIssues` e `usAddressIssues`, aceitando os apelidos de campo.
  - `usAddressIssues` devolve um código, na ordem de hoje.
  - O nome continua em `inspectLabel`, com o fallback do `display_name`.

  Verificar: `tests/delivery-address-check.test.js` (inclui `line1`/`postal_code`) e os testes atuais de UPS passando sem alteração.
- [x] 2.2 Checkout: o serviço que inicia a assinatura exige a rua, e no BR o número e o bairro, com 422 `address_incomplete` e `fields`, antes da Stripe. `hasAddress` e `session_incomplete` não mudam.
  - Verificar: testes do checkout (BR sem bairro, US sem rua, completo passa, a sessão do onboarding continua igual).
- [x] 2.3 Edição:
  - `withLedgerMarket` vira `assertLedgerMarket`: `address_country_mismatch` e `subscription_market_mismatch`; sem país, o payload recebe o da conta;
  - a mesma checagem roda no preview e no commit;
  - com endereço, a edição exige os campos obrigatórios (`address_incomplete`) e o nome de quem recebe, enviado ou gravado (`recipient_name_required`).

  Verificar: testes de preview e commit (país trocado, endereço gravado cruzado, só pacotes passa, sem nome nos dois lados, completo passa).
- [x] 2.4 `tax_document` e `fiscal_name` no validador da edição:
  - só na conta `br`; na `us`, `fiscal_fields_not_allowed`;
  - o commit grava os metas depois do `upsert`.

  Verificar: testes do validador e do commit (CPF inválido não grava nada, nome fiscal válido grava, falha na Stripe não grava).
- [x] 2.5 `subscription-dashboard.js`: o detalhe da loja ganha `fiscal` (conta `br`, últimos 4 dígitos) e `market_mismatch`.
  - Verificar: teste do detalhe com CPF sem nome fiscal e com o par cruzado.

## 3. Trava de saída por endereço e NF-e com o endereço da assinatura (PM-22)

- [x] 3.1 Courier:
  - `dispatch` recusa com 422 `courier_address_incomplete` e `issues` antes da regra de prontidão, sem contorno por `confirm_not_ready`;
  - `presentQueueItem` devolve `issues` nas linhas `to_dispatch` e `failed`.

  Verificar: testes do serviço e da rota de courier.
- [x] 3.2 Migração `1700000000067-add-nfe-missing-fields.js` (`missing_fields JSON NULL`).
  - Verificar: a migração sobe e desce no MySQL de teste.
- [x] 3.3 Cliente da NF-e:
  - `findCustomer(userId, stripeSubscriptionId)` lê o endereço da assinatura;
  - `customerSnapshot` usa só o nome fiscal e calcula `missing_fields`;
  - `recordPaidInvoice` trava sem CPF ou sem nome fiscal.

  Verificar: testes da NF-e (sem nome fiscal trava com `["fiscal_name"]`, endereço da assinatura copiado) e integração do repositório.
- [x] 3.4 Releitura na emissão:
  - `emit` relê o cliente (`refreshCustomer`) em toda nota que não seja `customerEdited`;
  - `retry` sem a condição de `blingContactId`;
  - `refreshBlockedForUser(userId)`.

  Verificar: testes do job (pendente pega o endereço novo, correção do operador mantida, bloqueada volta à fila quando completa).
- [x] 3.5 `bling-client.js` ganha `updateContact(id, payload)` (`PUT /contatos/{id}`):
  - `ensureContact` atualiza o contato achado quando o nome ou o endereço divergem;
  - `applyCustomerEdit` roda sempre que a NF-e é editável e difere.

  Verificar: teste do cliente (método, caminho e corpo) e testes do job (contato igual não chama, divergente chama antes do pedido).
- [x] 3.6 O detalhe da NF-e devolve `missing_fields`.
  - Verificar: teste do presenter.

## 4. Problema de endereço e e-mail (PM-24)

- [x] 4.1 Migração `1700000000066-create-delivery-address-issues.js`, com `open_key` único e `utf8mb4_unicode_ci`, e um repositório com:
  - `findOpen`, `insertOpen` (a corrida no índice único lê o vencedor), `close`;
  - `latestForSubscriptions`, `listByUser`, `deleteByUser`.

  Verificar: integração do repositório (`RUN_DB_INTEGRATION_TESTS=true`) com dois abertos concorrentes.
- [x] 4.2 `DeliveryAddressIssueService` com `report`, `recheckForUser` e `latestForSubscriptions`:
  - `report` recalcula o conjunto ainda verdadeiro (endereço do mercado e, no BR, CPF e nome fiscal), mais o `extra`, e não faz nada para uma exceção de mercado;
  - `nfe_check` seguido de `payment_check` no mesmo pagamento dá um problema e um e-mail;
  - mesmo conjunto não faz nada;
  - outro conjunto encerra como `superseded` e abre o novo;
  - um erro no serviço só vai ao log.

  Verificar: `tests/delivery-address-issue.service.test.js`.
- [x] 4.3 E-mail `deliveryAddressIssue`:
  - template em pt-BR e en-US em `core/email/transactional-emails.js`;
  - `notifyDeliveryAddressIssue` em `transactional-mailer.js`, por `sendClaimed` com `referenceId` igual ao id do problema;
  - grava `email_sent_at`;
  - fora de `automated-email-settings` e de `RESEND_TEMPLATES`: sai sempre, e uma falha de SMTP deixa `email_sent_at` vazio.

  Verificar: testes do template (link `?step=address`, um parágrafo por código, idioma pela conta) e do mailer (segunda chamada vira `duplicate`).
- [x] 4.4 Gatilhos:
  - `payment_check` no webhook de `invoice.paid`, depois de `recordChargedDelivery`;
  - `courier_check` em `dispatch`, só na recusa `courier_address_incomplete` (`shipment_market_exception` não reporta);
  - `ups_check` em `createForSubscription`;
  - `courier_failed` em `markFailed` com `address_unusable`;
  - `nfe_check` em `recordPaidInvoice` e `emit`;
  - injeção em `index.js`.

  Verificar: um teste por gatilho no serviço de cada um, e o teste da fila confirmando que a leitura não abre problema.
- [x] 4.5 Encerramento: o commit da edição chama `recheckForUser`, por usuário.
  - Verificar: teste do commit:
    - endereço corrigido encerra;
    - só o número salvo, com CPF ainda faltando, fica aberto só com o CPF e sem e-mail;
    - nome fiscal salvo numa assinatura encerra o problema da outra assinatura BR do mesmo cliente;
    - endereço novo tira `courier_address_unusable`.
- [x] 4.6 `address_issue` nas linhas do courier e das etiquetas, no detalhe da assinatura no admin e no detalhe da NF-e, numa consulta por leitura.
  - Verificar: testes dos serviços de fila e dos presenters.
- [x] 4.7 `privacy.service.js`: os problemas entram no export e saem com a exclusão da conta.
  - Verificar: testes de privacidade.

## 5. Fechamento

- [x] 5.1 Alinhar `src/scripts/lote3-precheck.js` à regra nova:
  - `addressCountryOtherThanAccount` conta também o país vazio;
  - `incompleteAddress` conta a falta de nome de quem recebe;
  - as duas contagens usam os mesmos apelidos de campo.

  Verificar: o teste do script confere que toda consulta é `SELECT` e cobre os dois critérios novos.
- [x] 5.2 Rodar os testes relacionados a todos os arquivos alterados (`npx jest --findRelatedTests <arquivos>`) e as integrações afetadas com `RUN_DB_INTEGRATION_TESTS=true`.
  - Verificar: tudo passa, e o manifesto de rotas está atualizado e commitável.
