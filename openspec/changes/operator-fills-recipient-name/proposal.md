# Proposal

## Why

Fizemos a segunda caminhada com um operador do Brasil em 08/11/2026, depois de `keep-ready-orders-dispatchable`. O caminho principal ficou curto: 8 cliques do pedido atrasado até a entrega. Sobraram três pontos:

- **O operador não destrava o nome de quem recebe.** Três pedidos prontos estão parados com "Travado: Falta o nome de quem recebe". O painel só permite abrir a entrega e esperar o cliente. A edição de endereço do painel muda a cópia da conta, não o endereço da assinatura que a entrega lê. Muitas vezes o operador sabe o nome (é o titular da conta ou o cliente disse por WhatsApp).
- **A fila não mostra um nome.** Sem nome de quem recebe, a fila mostra o e-mail. Com vários pedidos do mesmo cliente, o operador separa os pedidos pela data e pelos sabores.
- **"Marcar entregues" falha logo após a saída.** O painel sugere a hora atual cortada no minuto (03:32), a saída foi gravada com segundos (03:32:40) e a API recusa com "A data de entrega não pode ser no futuro nem antes da saída."

A change irmã `operator-fills-recipient-name` em `eden-bowls-admin` consome o que esta muda.

## What Changes

- **Nova rota** `PATCH /api/v1/admin/billing/subscriptions/:id/recipient-name` com `{ recipient_name }`:
  - grava só o nome de quem recebe no endereço daquela assinatura, com a regra de validação que já existe;
  - não muda o nome da conta, o Stripe nem as outras assinaturas;
  - fica registrada na auditoria;
  - confere de novo o problema de endereço aberto daquela assinatura: fecha com `resolved_by: operator` se nada sobrar, ou fica aberto só com o que sobrou, sem e-mail;
  - devolve o nome gravado e `courier_issues` atualizado.
- **Nome mostrado nas telas de operação:** sem nome de quem recebe, a fila de produção, a lista de Entregas Brasil e o detalhe da assinatura mostram o nome da conta (quando não é um e-mail) e só então o e-mail. O nome da conta não destrava nada: a trava continua até alguém gravar o nome de quem recebe.
- **Busca da fila:** `q` acha também pelo nome da conta, já que a fila passa a mostrá-lo.
- **Sugestão do nome:** os itens da fila, as linhas de Entregas Brasil e o detalhe da assinatura trazem `account_name` (nome da conta, ou `null` quando não há ou é um e-mail), para o painel sugerir o nome.
- **Hora da entrega:** a saída conta pelo minuto em que aconteceu. Uma hora de entrega no mesmo minuto da saída é aceita e gravada como a hora da saída. Antes desse minuto continua 422. (Já implementado nesta branch, com teste.)
- **Sem mudança:**
  - a regra que recusa o despacho (`courier_address_incomplete`);
  - quando um problema de endereço abre e o e-mail ao cliente;
  - a edição de endereço da conta pelo painel, que continua mudando só a conta.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `delivery-recipient`: o operador grava o nome de quem recebe de uma assinatura; as telas de operação mostram o nome da conta antes do e-mail e trazem a sugestão.
- `delivery-address-issues`: o nome gravado pelo operador fecha o problema como o do cliente, com `resolved_by: operator`.
- `courier-delivery`: a hora de entrega no minuto da saída é aceita.

## Impact

- `src/api/routes/admin.routes.js`: rota nova, permissão `users.delivery.write` com escopo de mercado do registro.
- Novo método no serviço de cobrança do admin (ou num serviço pequeno próprio) que lê a assinatura, valida com `src/core/recipient-name.js`, grava com `JSON_SET` no endereço, audita e chama a reconferência do problema.
- `src/services/delivery-address-issue.service.js`: reconferência de uma assinatura com `resolvedBy` informado.
- `src/core/production-queue-presenter.js`, `src/services/courier-delivery.service.js`, `src/services/admin-billing.service.js`: nome da conta como segunda opção e `account_name`.
- `src/infrastructure/repositories/subscription-ledger.repository.js`: a fila passa a ler o nome da conta (junção com a tabela de usuários).
- `src/services/courier-delivery.service.js`: `parseDeliveredAt` (feito).
- Rota nova: `npm run routes:manifest` e commit de `docs/api-routes.json`; depois `npm run contract:sync` no painel.
- Testes: rota, serviço novo, problema de endereço, presenter, courier, billing.
