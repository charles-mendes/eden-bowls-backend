# Design

## Context

Ver proposal.md (Why). Estado atual que molda a solução:

- **Fila de courier.** `listPaidCourierCycles` filtra só pelo país do endereço, e `countPaidCourierCyclesToDispatch` usa o mesmo filtro. `requireDeliverableInvoice` confere só o país.
- **Fila de etiquetas.** `listPaidLabelCycles` filtra só pela conta `us`. `inspectLabel` confere o país, P.O. Box, endereço militar, endereço incompleto, ship-from e nome de quem recebe.
- **NF-e.**
  - **Criação.** `recordPaidInvoice` decide pela conta. `customerSnapshot` → `bling-nfe.repository.js` `findCustomer` lê `onboarding_user_state.address`, e o nome cai em `display_name` quando falta `_eden_fiscal_name`.
  - **Contato no Bling.** `ensureContact` reaproveita o contato do CPF sem atualizar. `applyCustomerEdit` só roda depois de "Corrigir dados".
  - **Nova tentativa.** `retry` só relê o cliente quando não há `blingContactId`.
- **Edição na loja.**
  - `withLedgerMarket` troca o país em silêncio, no preview e no commit.
  - O validador aceita todo campo do endereço como opcional.
  - CPF e nome fiscal só existem no checkout: `parseCpf`, `parseFiscalName`, gravados por `replaceUserMeta` com `TAX_DOCUMENT_META_KEY` e `FISCAL_NAME_META_KEY`.
- **E-mail.** `transactional-mailer.js` tem `sendClaimed`, que reivindica por (assinatura, template, referência) e devolve `duplicate` numa segunda tentativa. O courier já usa esse padrão com a referência igual ao id da linha.
- **Privacidade.** `privacy.service.js` exporta `customer_contacts` por `listByUser` e apaga com `deleteByUser`. O padrão serve para a tabela nova.
- **Ambiente.** Sem produção. As decisões de D-05 sobre a virada (e-mail retroativo, notas pendentes com o endereço antigo) ficam no plano de entrada em produção, e o `lote3-precheck.js` conta os casos.

## Goals / Non-Goals

**Goals:**

- Uma função decide o mercado de saída, e toda leitura (filas, contagem, despacho, compra, NF-e, fatura, detalhe) chama a mesma.
- Uma checagem do endereço BR serve à gravação (PM-23), à trava do courier (PM-22) e ao gatilho do pagamento (PM-24).
- Trava sem "mesmo assim": nenhum parâmetro da API contorna o endereço.

**Non-Goals:**

- Modo relatório ou interruptor por ambiente (decisão do usuário: trava direta).
- Contagens de exceções e bloqueios no Hoje (lote 5).
- Recusa da UPS por destino como gatilho de problema: o 4xx da UPS não separa endereço de outros erros.
- Mudar o relatório `market-conflicts`.

## Decisions

### D1. `src/core/shipment-market.js`

- **Interface.** `shipmentMarket({ stripeAccount, address })` devolve `{ market: 'BR' | 'US' | null, exception: boolean }`.
- **País cru.** Lê `address.country` como está gravado, sem padrão. `normalizeShipTo` da UPS põe `US` quando o país está vazio. Se a regra lesse dali, uma conta `us` sem país viraria mercado US.
- **SQL.** O mesmo critério em SQL fica num helper `shipmentMarketSql(alias)` no repositório do ledger, usado pelas filas, pela contagem e pela lista de exceções. A regra fica escrita uma vez em JS e uma em SQL, e cada uma tem teste.
- **Alternativa descartada:** filtrar em JS depois da consulta. Quebraria o `LIMIT 201` e a contagem sem teto do Hoje.

### D2. Códigos de recusa

- **Exceção de mercado.** `shipment_market_exception` vale para o courier e para a UPS.
  - No courier, uma conta `us` com endereço US continua `courier_country_not_supported`, para não mudar a resposta de hoje. A exceção cobre só o par cruzado ou o país vazio.
  - Na UPS, a exceção entra em `inspectLabel` como primeiro motivo, antes de `country_not_supported`. Ela aparece na compra avulsa e em `label_issues` do detalhe da assinatura. A fila de etiquetas não mostra a exceção, porque o par cruzado já sai da consulta (D1). O lugar dessa lista é a página "Exceções de mercado".

### D3. `src/core/delivery-address-check.js`

- **Apelidos.** As duas funções leem os mesmos apelidos que o resto do código: `street`/`line1`/`address_line1`/`address`, `zipcode`/`postal_code`/`zipCode`, `complement`/`line2`/`address_line2`. O checkout grava as duas formas, e um leitor só de `zipcode` travaria um endereço completo.
- **Brasil.** `brazilAddressIssues(address)` devolve códigos estáveis: `address_street_missing`, `address_number_missing`, `address_neighborhood_missing`, `address_city_missing`, `address_state_missing`, `address_zipcode_invalid` (CEP sem 8 dígitos) e `recipient_name_missing`.
- **EUA.** `usAddressIssues(address)` reaproveita o que `inspectLabel` já confere sobre o endereço (P.O. Box, militar, incompleto) e devolve **um** código, na mesma ordem de hoje (a cadeia `else if`).
  - O nome de quem recebe fica fora da função: continua em `inspectLabel` por `resolveRecipientName`, com o fallback do `display_name` que já existe. O gatilho `payment_check` dos EUA usa a mesma composição (endereço, mais nome com fallback).
  - `inspectLabel` passa a chamar essa função, sem mudar os códigos nem a quantidade. Os testes atuais de etiqueta continuam iguais.
  - `ship_from_missing` e `ups_not_configured` ficam fora: são problema da operação, não do cliente.
- **Validador da edição e do checkout.** Usa as mesmas funções, mas responde `address_incomplete` com `fields` (nomes de campo do payload), porque a loja marca campo a campo.
  - No checkout, a checagem entra no serviço que inicia a assinatura (`onboarding-subscription-checkout.service.js`), antes da Stripe.
  - `hasAddress`, em `checkout-state.js`, alimenta `session_incomplete` no onboarding e não muda.
  - A loja só trata `address_incomplete` na edição. No checkout, a tela já exige os campos.
- **Nome de quem recebe.** Continua com `recipient_name_required`, que já existe.

### D4. Edição: recusar em vez de trocar o país

- **Recusas.** `withLedgerMarket` vira `assertLedgerMarket(payload, row)`:
  - um endereço gravado com país diferente da conta dá `subscription_market_mismatch`, se o payload traz endereço;
  - um país do payload diferente da conta dá `address_country_mismatch`;
  - sem país, o payload recebe o da conta.
- **Ordem.** A checagem roda no preview e no commit, antes de cotar o frete e de chamar a Stripe.
- **Edição de pacotes.** A edição só de pacotes (`delivery_id`) não traz endereço e passa.

### D5. CPF e nome fiscal na edição

- **Campos.** `tax_document` e `fiscal_name` são opcionais no payload de preview e commit, e só valem para a conta `br`. Na conta `us`, qualquer um deles dá 422 `fiscal_fields_not_allowed`. A validação é a mesma do checkout (`parseCpf`, `parseFiscalName`), com os mesmos códigos de erro.
- **Gravação.** O commit grava os dois metas do usuário depois do `upsert` do ledger. Se a Stripe falhar, nada é gravado.
- **Depois de gravar.** O commit chama `blingNfeService.refreshBlockedForUser(userId)` e `addressIssueService.recheckForUser(userId)`. As duas são por usuário, porque CPF e nome fiscal são da conta.
- **Fluxo na loja.** Os campos entram no mesmo commit, sem rota nova, para o cliente salvar tudo de uma vez.
- **Alternativa descartada:** uma rota própria `PUT /subscriptions/:id/fiscal`. Seria mais simples no backend, mas daria dois salvamentos na tela, um capaz de falhar sem o outro.

### D6. NF-e

- **Fonte do cliente.**
  - `findCustomer(userId)` vira `findCustomer(userId, stripeSubscriptionId)`: o endereço vem de `wp_eden_subscriptions.address`, pela assinatura da linha, e o CPF e o nome fiscal vêm dos metas.
  - O nome da nota é só o nome fiscal. O `display_name` deixa de ser usado.
- **Coluna nova.** `missing_fields` (JSON, migração 067) guarda `['tax_document'?, 'fiscal_name'?]`. É gravada na criação, no `emit` e na releitura.
- **Releitura na emissão.**
  - Em `emit`, antes de `ensureContact`, uma nota que não seja `customerEdited` relê o cliente (`refreshCustomer(row)`) e atualiza a cópia na linha.
  - Se faltar CPF ou nome fiscal, a nota volta a `blocked_missing_document`.
  - Em `retry`, a condição `!row.blingContactId` sai: toda nota não corrigida pelo operador relê.
- **Contato.** `ensureContact`:
  - **Contato achado.** Com contato achado pelo documento (ou já guardado na linha), compara nome e endereço com a linha. Se diferem, chama `client.updateContact(id, payload)`, um `PUT /contatos/{id}` com o `contactPayload` atual, e grava o passo em `savePayloads(row, 'contact_update', ...)`.
  - **NF-e já existente.** `applyCustomerEdit` deixa de exigir `customerEdited`. Roda sempre que a NF-e existe em situação editável e o contato dela difere da linha. Com "Corrigir dados", a linha já é a correção, então a precedência do operador se mantém.
- **Exceção de mercado.** `recordPaidInvoice` busca a assinatura pelo `subscriptionId` (`ledgerRepository.findByStripeSubscriptionId`). Para uma exceção, não grava a linha e registra `logger.warn` com o motivo.
- **Desbloqueio.** `refreshBlockedForUser(userId)` lista as notas `blocked_missing_document` do usuário, relê cada uma e põe na fila (`requeue`) as que ficaram completas.

### D7. `delivery_address_issues` (migração 066)

- **Colunas.**
  - identificação: `id`, `subscription_id` (id do ledger), `stripe_subscription_id`, `user_id`, `stripe_account`;
  - o problema: `issue_codes` (JSON, ordenado), `source`;
  - o estado: `open_key` (varchar, nulo), `opened_at`, `email_sent_at`, `resolved_at`, `resolved_by` (`customer`, `superseded`);
  - `created_at`.
- **Índices.**
  - **Um aberto por assinatura.** Índice único em `open_key`, que vale o `subscription_id` enquanto o problema está aberto e `NULL` depois. O MySQL aceita vários `NULL`, então isso garante no máximo um aberto por assinatura sem trava de aplicação.
  - **Leitura.** Índices em `(subscription_id, opened_at)` e `user_id`.
- **Collation.** `utf8mb4_unicode_ci`, explícita na migração, para evitar o `COLLATE` nos joins que o courier exigiu.
- **Serviço `DeliveryAddressIssueService`.**
  - **`report({ subscription, source, extra = [] })`.** Calcula o conjunto ainda verdadeiro e não recebe só o código daquele passo.
    - **Conjunto.** São os códigos de endereço do mercado de saída e, no BR, `tax_document_missing` e `fiscal_name_missing` lidos dos metas, mais `extra` (`courier_address_unusable` na falha do courier).
    - **Pagamento.** Assim, `nfe_check` e `payment_check` do mesmo pagamento dão o mesmo conjunto: um problema e um e-mail. Sem isso, o segundo encerraria o primeiro como `superseded` e o problema fiscal sumiria com a nota ainda travada.
    - **Exceção de mercado.** Sem mercado de saída, não faz nada.
    - Sem códigos, não faz nada.
    - Com o mesmo conjunto do aberto, não faz nada.
    - Com outro conjunto, encerra o aberto como `superseded` e insere o novo. Uma corrida no índice único lê o aberto vencedor e não insere.
    - Depois de inserir, envia o e-mail.
  - **`recheckForUser(userId, { addressSavedFor })`.** Recalcula o conjunto de cada problema aberto das assinaturas do usuário.
    - **Nada sobrou.** Encerra como `customer`.
    - **Sobrou algo.** Grava só os códigos restantes no mesmo problema, sem e-mail. Um salvamento não é evento de abertura.
    - **Endereço novo.** `courier_address_unusable` sai quando o endereço daquela assinatura foi salvo (`addressSavedFor`).
  - **`latestForSubscriptions(ids)`.** Devolve o aberto ou o último resolvido nos últimos 30 dias, para as filas e os detalhes, numa consulta só.
- **Falhas.** Um erro no serviço é registrado e nunca derruba o despacho, a compra, o pagamento ou a NF-e. O problema é um efeito colateral, não uma condição.

### D8. Gatilhos

| Evento | Onde | Códigos |
|---|---|---|
| `payment_check` | `stripe-webhook.service.js`, depois do ciclo pago (`recordChargedDelivery`), com o ledger da assinatura | o conjunto do mercado |
| `courier_check` | `dispatch`, quando a trava de endereço (`courier_address_incomplete`) recusa; `shipment_market_exception` não reporta | o conjunto do mercado |
| `ups_check` | `createForSubscription`, quando `inspectLabel` recusa por um código de endereço ou de nome | o conjunto do mercado |
| `courier_failed` | `markFailed` com `address_unusable` | o conjunto do mercado mais `courier_address_unusable` (o texto do operador não vai ao e-mail) |
| `nfe_check` | `recordPaidInvoice` e `emit`, quando a nota trava | o conjunto do mercado |

Todos chamam `report` com a fonte. O conjunto é sempre recalculado, então os gatilhos não dependem da ordem em que rodam.

A compra em lote da UPS usa o mesmo `createForSubscription`, então também abre problemas.

### D9. E-mail `deliveryAddressIssue`

- **Envio.** Template novo em `core/email/transactional-emails.js`, em pt-BR e en-US conforme a conta. Sai por `sendClaimed` com `referenceId = issue.id`. Uma segunda tentativa do mesmo problema vira `duplicate`.
- **Conteúdo.** Um parágrafo por código, em texto simples. O link é `STORE_APP_URL + /dashboard/plans/{stripeSubscriptionId}/edit?step=address`.
- **Depois do envio.** Grava `email_sent_at`. Uma falha de SMTP é registrada no log e o problema fica sem `email_sent_at`, sem nova tentativa por job. Segue o padrão das cartas do courier, fora de `RESEND_TEMPLATES`. O painel mostra "E-mail não enviado".
- **Configuração.** Não entra em `automated-email-settings`, que só tem estágio de vida, renovação e aviso de plano, e o painel não ganha tela para um interruptor. O e-mail sai sempre.

### D10. Contratos de leitura

- **Fila de courier.** As linhas de `to_dispatch` e `failed` ganham `issues` (de `brazilAddressIssues`) e `address_issue`.
- **Fila de etiquetas.** As linhas de `ready` ganham `address_issue`. `issues` já existe.
- **Detalhe da assinatura no admin.** Ganha `shipment_market`, `market_exception` e `address_issue`.
- **Detalhe da NF-e.** Ganha `missing_fields` e `address_issue`.
- **Detalhe da loja (`/subscriptions/:id/detail`).** Ganha `fiscal` (só conta `br`) e `market_mismatch: boolean`, para a loja não abrir o formulário. Hoje a loja vê `delivery_address_fields.country`, mas `addressFields` devolve o país da conta quando o endereço não tem país. O booleano evita repetir a regra na loja.
- **`GET /admin/market-exceptions`.** Devolve `{ items: [{ subscription_id, stripe_subscription_id, status, stripe_account, address_country, customer: { id, email, name }, open_paid_cycles }], truncated }`, com teto de 200.

## Risks / Trade-offs

- [O endereço legado sem número ou bairro trava pedidos pagos] → Em QA não pesa. Antes de produção, o `lote3-precheck.js` conta `incompleteAddress`, e a operação decide se avisa pelo WhatsApp antes.
- [Exigir nome fiscal trava a NF-e de quem emitia pelo `display_name`] → Coberto por `brazilWithoutFiscalName` no precheck. O cliente corrige na loja (D5), e o desbloqueio é automático.
- [Atualizar o contato do Bling muda outras notas abertas do mesmo CPF] → Esperado (um endereço por cliente). Para duas assinaturas BR em endereços diferentes, a nota leva o endereço pelo passo `applyCustomerEdit` (D6). Fica um risco conhecido, sem tratamento extra.
- [`PUT /contatos/{id}` do Bling exige o corpo completo] → O payload é o mesmo de `createContact`, que já é completo. O teste do cliente confere o método, o caminho e o corpo.
- [A regra escrita em JS e em SQL pode divergir] → Teste de tabela com os quatro pares e o país vazio nas duas formas (JS e integração MySQL).
- [Um gatilho no webhook de pagamento envia e-mail no meio do fluxo de pagamento] → O envio roda depois do ciclo gravado, e o erro não sobe (D7).
- [A fatura de conta `us` com endereço BR muda de idioma e de emissor] → `invoiceLocale` decide também o emissor (`currentIssuer(locale)`) e a numeração por ano. Aceito (BREAKING na proposta). O teste da fatura prende o idioma e o emissor. Sem produção, nenhuma fatura real muda.

## Migration Plan

1. **Deploy.** Primeiro o backend, junto com a loja e o painel. As migrações 066 e 067 rodam no boot. Nenhum dado é reescrito: `missing_fields` fica nulo nas notas antigas até a próxima releitura.
2. **Ordem entre os repositórios.**
   - **Painel.** O painel antigo, com o backend novo, mostra as recusas novas (`courier_address_incomplete`, `shipment_market_exception`) como erro genérico.
   - **Loja.** A loja antiga recebe `address_incomplete` ou `address_country_mismatch` só se tentar salvar um endereço incompleto, coisa que a tela já impede.
   - **Mesmo dia.** Por isso os três saem no mesmo dia, o backend primeiro.
3. **Antes de produção (fora deste change).** Rodar `node src/scripts/lote3-precheck.js`, tratar os casos contados e decidir o contato inicial da operação (D-05).
4. **Rollback.** Reverter o código. As duas tabelas e a coluna podem ficar: nada antigo as lê.

## Open Questions

- O texto exato de cada parágrafo do e-mail, por código, sai na implementação, seguindo o tom das cartas atuais. Não muda nenhum contrato.
