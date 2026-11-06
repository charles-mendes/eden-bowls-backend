# Proposal

## Why

Lote 3 da proposta de melhorias do painel (`docs/analise/proposta-melhorias.md`, na raiz do workspace). É o primeiro lote que muda o que o sistema permite. Hoje, três leituras decidem o mercado de um pedido, cada uma por um critério:

- o courier decide pelo país do endereço;
- a NF-e decide pela conta Stripe;
- a fatura comercial aceita qualquer um dos dois.

O courier despacha com endereço incompleto. A NF-e lê uma terceira cópia do endereço (`onboarding_user_state`) e reaproveita o contato do Bling sem atualizá-lo. A edição na loja troca o país em silêncio, e o cliente não tem onde corrigir CPF e nome fiscal.

Este change põe um critério único e trava a saída por endereço. O endereço passa a ser exigido na gravação, e o cliente recebe um e-mail quando o endereço não serve.

Os changes irmãos `admin-flow-fixes-3` em `eden-bowls-admin` (painel) e em `eden-bowls` (loja) consomem estas mudanças. Decisões já tomadas:

- **A trava liga direto.** Não existe modo relatório: ainda não há produção, só QA. O script `src/scripts/lote3-precheck.js` continua sendo o passo manual antes de entrar em produção.
- **Um change só** cobre PM-21, PM-22, PM-23 e PM-24.

## What Changes

- **Mercado de saída único (PM-21).**
  - **Regra.** Uma função em `src/core/shipment-market.js` decide o mercado de saída: é BR quando a conta é `br` e o país do endereço da assinatura é `BR`, e US quando a conta é `us` e o país é `US`. Qualquer outra combinação é "exceção de mercado".
  - **Filas.** A de courier passa a exigir também a conta `br`, e a de etiquetas também o país `US`. A contagem do Hoje segue a fila.
  - **Despacho e compra.**
    - Um despacho de courier para uma exceção é recusado com `422 shipment_market_exception`.
    - A compra de etiqueta para uma exceção também é recusada, e o motivo aparece na fila de etiquetas.
  - **NF-e.** Não é registrada para uma exceção. O pagamento continua e o log registra o motivo.
  - **Fatura comercial.** O idioma passa a seguir só a conta. **BREAKING** para uma conta `us` com endereço BR: a fatura, antes em pt-BR, passa a sair em en-US.
  - **Lista de exceções.** Rota nova `GET /admin/market-exceptions` (`shipping.read`, `market: 'query'`). Lista as assinaturas não canceladas em exceção, com os ciclos pagos em aberto de cada uma. O detalhe da assinatura no admin ganha `shipment_market` e `market_exception`.
- **Endereço exigido na gravação (PM-23).**
  - **Campos obrigatórios.** O checkout e a edição de assinatura passam a exigir, no backend, rua, cidade, estado, CEP e nome de quem recebe. No Brasil, também número e bairro.
  - **Recusas na edição.**
    - O nome de quem recebe que não foi enviado continua vindo do endereço gravado, mas um endereço gravado sem nome deixa de passar.
    - Um país diferente do mercado da conta é recusado com `422 address_country_mismatch`. Hoje `withLedgerMarket` troca o país em silêncio.
    - Uma assinatura cujo endereço gravado já é de outro país recusa qualquer edição de endereço com `422 subscription_market_mismatch`.
    - A edição só de pacotes, ou sem endereço, continua passando. **BREAKING** só para chamadores fora da loja.
  - **CPF e nome fiscal.** A edição de uma assinatura `br` aceita `tax_document` e `fiscal_name`, com a validação do checkout, e grava os dois nos metas do usuário.
    - Ao salvar, as NF-e daquele cliente travadas por falta desses dados releem o cliente e voltam à fila.
    - O detalhe da assinatura na loja passa a dizer o que falta: só os 4 últimos dígitos do CPF e o nome fiscal.
- **Trava de saída por endereço (PM-22).**
  - **Courier.** Checagem do endereço BR em `src/core/delivery-address-check.js`, a mesma regra da gravação.
    - Sem os campos, o despacho é recusado com `422 courier_address_incomplete`, e a resposta diz o que falta. Não há "despachar mesmo assim".
    - As linhas "A despachar" e "Falhas" da fila trazem `issues`.
  - **NF-e.**
    - **Fonte.** Passa a ler o endereço da assinatura do ciclo, não `onboarding_user_state`.
    - **Nome fiscal.** Trava também sem ele: `blocked_missing_document`, com a coluna nova `missing_fields` (`tax_document`, `fiscal_name`).
    - **Emissão.** Toda nota ainda não autorizada relê o endereço e os dados fiscais antes de gerar. A exceção é a nota com "Corrigir dados" do operador, que mantém a correção.
    - **Contato no Bling.** É atualizado quando diverge. Uma NF-e editável no Bling recebe o mesmo endereço.
    - **Nova tentativa.** Deixa de depender de não haver contato no Bling.
  - **Etiqueta US.** Mantém as travas atuais.
- **Problema de endereço e e-mail (PM-24).**
  - **Tabela.** Tabela nova `delivery_address_issues`, com no máximo um problema aberto por assinatura.
  - **Abertura.** Um problema abre só em eventos:
    - pagamento de ciclo com endereço que não passa;
    - despacho de courier recusado por endereço;
    - compra UPS recusada pelas travas de endereço;
    - falha de courier com `failure_kind: address_unusable`;
    - NF-e travada por CPF ou nome fiscal.

    Abrir a fila nunca abre um problema.
  - **E-mail.** Na abertura sai um e-mail ao cliente, em pt-BR ou en-US, com o que falta e o link para `/dashboard/plans/:sub/edit?step=address`.
  - **Sem repetição.** O mesmo problema nunca reenvia. Outro conjunto de motivos encerra o anterior e abre outro, com outro e-mail.
  - **Encerramento.** O problema se encerra quando o cliente salva um endereço, ou dados fiscais, que passam na checagem.
  - **Onde aparece.** Nas linhas das filas, no detalhe da assinatura e no detalhe da NF-e.
  - **Privacidade.** Os problemas entram no export de privacidade e saem com a exclusão da conta.
  - **Sem abertura retroativa.** Pedidos já travados antes da entrada abrem o problema no próximo evento.

## Capabilities

### New Capabilities

- `shipment-market`: a regra que decide o mercado de saída e a lista de exceções de mercado.
- `delivery-address-issues`: abertura, e-mail, encerramento e exibição dos problemas de endereço.

### Modified Capabilities

- `courier-delivery`: a fila e o despacho exigem o mercado BR e o endereço completo, e a linha mostra o que falta.
- `ups-label-queue`: a fila exige o mercado US, e uma exceção aparece como motivo de bloqueio.
- `delivery-recipient`: a edição recusa o endereço sem nome de quem recebe, mesmo quando o nome não foi enviado e o endereço gravado não tem; a NF-e deixa de usar o nome da conta no lugar do nome fiscal.
- `nfe-admin`: a NF-e lê o endereço da assinatura, trava sem nome fiscal, relê o cliente na emissão e mantém o contato do Bling atualizado.
- `subscription-contract`: a edição exige o endereço completo, recusa outro país e aceita CPF e nome fiscal.

## Impact

- **Mercado de saída.**
  - novo: `src/core/shipment-market.js`;
  - `subscription-ledger.repository.js` (`listPaidCourierCycles`, `listPaidLabelCycles`, `countPaidCourierCyclesToDispatch`, lista de exceções);
  - `courier-delivery.service.js`, `ups-shipment.service.js` (`inspectLabel`);
  - `bling-nfe.service.js` (`recordPaidInvoice`), `core/invoice/invoice-document.js` (`invoiceLocale`), `admin-billing.service.js`.
- **Endereço e edição.**
  - novo: `src/core/delivery-address-check.js`;
  - `core/checkout-state.js`, `api/validators/subscriptions-edit.validator.js`;
  - `core/subscription-edit-plan.js` (`withLedgerMarket` vira recusa), os repositórios de preview e commit da edição;
  - `core/subscription-dashboard.js` (dados fiscais no detalhe da loja).
- **NF-e.** `bling-nfe.service.js` (`customerSnapshot`, `emit`, `ensureContact`, `applyCustomerEdit`, `retry`), `bling-nfe.repository.js` (cliente pela assinatura), `infrastructure/bling/bling-client.js` (`updateContact`).
- **Problemas de endereço.**
  - serviço e repositório novos;
  - gatilhos em `stripe-webhook.service.js`, courier, UPS e NF-e, e o encerramento no commit da edição;
  - e-mail novo em `transactional-mailer.js` e `core/email/transactional-emails.js`;
  - `privacy.service.js`.
- **Migrações:**
  - `1700000000066`: `delivery_address_issues`;
  - `1700000000067`: `bling_nfe.missing_fields`.
- **Rota nova:** `GET /admin/market-exceptions`.
  - `docs/api-routes.json` muda (`npm run routes:manifest`). Nenhuma rota é removida.
  - Os contratos de `GET /admin/courier-deliveries/queue`, `GET /admin/shipments/queue`, `GET /admin/billing/subscriptions/:id`, `GET /admin/nfe/:id` e `GET /api/v1/subscriptions/:id/detail` ganham campos.
- **Fora do escopo:**
  - a trava fiscal do courier (PM-25, lote 4);
  - as contagens de exceções e bloqueios no Hoje (PM-26, segunda etapa, lote 5);
  - o relatório `market-conflicts`, que segue como está;
  - a recusa da própria UPS por destino: a resposta 4xx não diz com segurança que o motivo é o endereço, então não abre problema.
