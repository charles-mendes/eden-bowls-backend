# Proposal

## Why

Lote 2 da proposta de melhorias do painel (`docs/analise/proposta-melhorias.md`, na raiz do workspace): pôr na tela o dado que hoje o operador vai buscar em outra tela, e criar a base que os lotes 3 e 4 usam. O change irmão no painel (`admin-flow-fixes-2` em `eden-bowls-admin`) consome estas mudanças. Sem produção ainda (só QA), então nenhuma migração de dado real.

## What Changes

- **Hoje não pede nova compra quando a UPS não respondeu (PM-03).** `GET /admin/today` devolve `upsLabel: 'unresolved'` para o ciclo dos EUA cuja compra está `pending` ou `unknown`. `created` e `delivered` continuam `created`.
- **Motivo estruturado na falha do courier (PM-12).** `POST /admin/courier-deliveries/:id/fail` aceita `failure_kind` (`address_unusable`, `customer_absent`, `other`) ao lado do texto livre. Coluna nova `failure_kind` em `courier_deliveries`. A edição dos dados depois do despacho já existe na API (`PATCH`); só o painel muda.
- **Confirmação de pedido não pronto na compra UPS (PM-20).** `POST /admin/billing/subscriptions/:id/shipments` responde `409 ups_label_needs_confirmation` com os motivos (preparo não `ready`, assinatura não ativa) e só compra com `confirm_not_ready: true`. Mesma regra e mesmos códigos do despacho do courier. **Quebra** para quem compra sem o campo; o único chamador é o painel, que muda junto.
- **Fila do courier com o que o despacho precisa (PM-11).** Cada linha de `GET /admin/courier-deliveries/queue` ganha o endereço completo da assinatura, o telefone da conta, as instruções de entrega do perfil e os sabores e pacotes do ciclo.
- **Ciclos pagos da assinatura (PM-13).** Rota nova `GET /admin/billing/subscriptions/:id/paid-cycles` (`shipping.read`, escopo do registro): os ciclos pagos da assinatura, da mesma fonte das filas, com dia de preparo, preparo, entrega e a situação da expedição (etiqueta UPS ou entrega do courier). O painel deixa de depender de "Sincronizar faturas" para saber o que expedir.
- **Registro de contato (PM-17).** Tabela nova `customer_contacts`, permissão nova `customers.contact.write` (operador e admin) e rotas `GET/POST /admin/billing/subscriptions/:id/contacts`. A leitura usa `billing.subscribers.read`. Os contatos entram no export de privacidade, com a nota, e saem com a exclusão da conta.
- **Hoje com courier, NF-e e Bling (PM-26, primeira etapa).** `GET /admin/today` ganha um bloco `fulfillment` com contagens próprias (sem o teto de 200): Brasil a despachar, em rota há mais de 24 h, falhas sem novo despacho; NF-e bloqueadas sem CPF, rejeitadas e com erro; Bling desconectado; compras UPS não confirmadas. Cada pendência de pagamento recusado traz o último contato registrado e o telefone da conta. Cada ciclo BR pago traz a situação da entrega do courier da fatura (`none`, `out_for_delivery`, `delivered`, `failed`), para o painel saber se a caixa já saiu.
- **Levantamento antes do lote 3.** Script só de leitura que conta os ciclos pagos em aberto com endereço incompleto, NF-e não autorizada, sem linha de NF-e, cliente BR sem nome fiscal, e endereço de país diferente da conta, além dos cruzados (X-03). Em QA o número não decide nada; o script fica pronto para rodar com dado real.

## Capabilities

### New Capabilities

- `customer-contacts`: registro, leitura, export e exclusão dos contatos que o operador faz com o cliente fora do sistema.
- `subscription-paid-cycles`: os ciclos pagos de uma assinatura e a situação da expedição de cada um.
- `admin-today`: o que `GET /admin/today` devolve sobre expedição, NF-e e contatos.

### Modified Capabilities

- `courier-delivery`: motivo estruturado da falha; a linha da fila traz endereço, telefone, instruções e itens.
- `ups-label-queue`: a compra de etiqueta pede confirmação quando o pedido não está pronto.

## Impact

- `src/services/admin-today.service.js` (`labeledInvoices` com `listActiveByInvoiceIds`; bloco `fulfillment`; último contato), `src/index.js` (injetar courier, NF-e, Bling e contatos no Hoje).
- `src/core/courier-fields.js`, `src/services/courier-delivery.service.js` (`markFailed`, `presentQueueItem`), `src/infrastructure/repositories/courier-delivery.repository.js`, migração `1700000000064`.
- `src/services/ups-shipment.service.js` (`createForSubscription`), regra de prontidão compartilhada com o courier.
- `src/infrastructure/repositories/subscription-ledger.repository.js` (ciclos pagos por assinatura), rota nova em `src/api/routes/admin.routes.js`.
- Contatos: migração `1700000000065`, repositório e serviço novos, `src/core/admin-roles.js`, `src/services/privacy.service.js`.
- Rotas novas: `GET /admin/billing/subscriptions/:id/paid-cycles`, `GET` e `POST /admin/billing/subscriptions/:id/contacts`. `docs/api-routes.json` muda (`npm run routes:manifest`); nenhuma rota removida.
- `scripts/` ganha o levantamento só de leitura.
