# Design

## Context

- `queueMembership` (`subscription-ledger.repository.js`) junta duas partes:
  - **janela:** `due_at` de hoje até o fim da janela, com `ready` ou não;
  - **atrasados:** `due_at` antes de hoje, `production_status <> 'ready'`, e piso de 30 dias só para o que não está pago.

  Por isso um pedido atrasado que fica pronto sai da fila na mesma hora. Um pedido no prazo fica até o dia de preparo passar e depois some também, mesmo sem ter saído.
- `countPaidCourierCyclesToDispatch` conta em SQL. A trava de endereço (`brazilAddressIssues`, em `src/core/delivery-address-check.js`) é calculada em JS sobre o JSON `address`, com aliases (`recipient_name`/`name`/`full_name`, `zipcode`/`postal_code` etc.).
- O presenter da fila (`production-queue-presenter.js`) já recebe `row.address`, `stripeAccount` e `country`.
- O detalhe da assinatura (`AdminBillingService.getSubscription` com `detail`) já tem o endereço.

## Goals / Non-Goals

**Goals**

- O pronto atrasado do Brasil fica na fila até a saída.
- A trava de endereço chega ao painel antes do clique: no Hoje, na linha da fila e no detalhe da assinatura.
- Atrasados continua querendo dizer "preparo atrasado".

**Non-Goals**

- Mudar a regra do despacho ou a dos problemas de endereço. Uma leitura não abre problema nem manda e-mail.
- Deixar o operador preencher o nome de quem recebe: é decisão de negócio, melhoria 3 do relatório.
- Manter na fila o pronto dos EUA: a fila de etiquetas UPS já lista os ciclos pagos sem etiqueta, prontos ou não.
- Linha do tempo do pedido (melhoria 5).

## Decisions

### 1. A parte de atrasados ganha um terceiro caso, só para o Brasil

```sql
? AND q.due_at < :startOfToday AND (
  (q.production_status <> 'ready' AND (q.due_at >= :overdueFloor OR q.payment_state = 'paid'))
  OR (
    q.production_status = 'ready' AND q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL
    AND q.due_at >= :overdueFloor
    AND <shipmentMarketSql('BR')>
    AND <courierOpenSql(courierTableName)>
  )
)
```

- Reusa `shipmentMarketSql('BR')` e `courierOpenSql`, as mesmas regras de "A despachar". Mercado divergente fica fora, como na lista de entregas.
- O piso de 30 dias (`overdueFloor`, `OVERDUE_DAYS`) é o mesmo de "A despachar" (`DISPATCH_FLOOR_DAYS`). Sem piso, um pronto antigo que saiu antes de existir o registro de entrega ficaria na fila para sempre.
- `queueMembership` passa a receber `courierTableName`, com padrão `courier_deliveries`. O nome vem do repositório de entregas, como em `listPaidCourierCycles`.
- **Alternativa recusada:** tirar `production_status <> 'ready'` sem condição. Isso traria de volta todo pronto atrasado, também os dos EUA e os que já saíram.

### 2. Contas de atrasados ignoram `ready`

- Metrics da fila: `admin-production.service`, sobre `listQueueMetricRows`, que já devolve `production_status`.
- Totais do Hoje: `admin-today.service`, ao somar por `dueBucket`.
- As duas pulam `ready` no balde `overdue`. A lista com `due=overdue` mostra os dois casos; o painel agrupa os prontos à parte (change irmã), então o número do chip bate com o grupo "Atrasados".
- Pack-stock já ignora `ready`.

### 3. `courierAddressLocked` conta em JS sobre os mesmos ciclos

- Nova leitura `listPaidCourierCycleAddresses(query)`: o mesmo `where` de `countPaidCourierCyclesToDispatch`, devolvendo só `q.address`.
- `countQueue` roda `brazilAddressIssues` em cada endereço e devolve `addressLocked`.
- O volume é o de "A despachar" no período padrão (30 dias até amanhã, só prontos), que cabe em memória.
- **Alternativa recusada:** reescrever a regra em SQL com `JSON_EXTRACT` para cada alias. Isso duplicaria a regra e ela poderia divergir do despacho.
- O `where` sai de um helper comum, para a conta e a lista não divergirem.

### 4. `courierIssues` e `courier_issues` usam a mesma função

- **Presenter da fila:** quando `stripeAccount === 'br'` e `country === 'BR'` (a mesma regra do link Expedir), devolve `brazilAddressIssues(row.address)`; nos outros casos, `null`.
- **Detalhe da assinatura:** usa `shipmentMarket({ stripeAccount, address }).market === 'BR'`.
- Os dois são campos aditivos, que o painel antigo ignora.

### 5. "Marcar como pronto" não avisa o cliente

Decisão do produto (08/11/2026): ficar `ready` com o endereço travado não abre problema e não manda e-mail. O problema continua abrindo só nos eventos de `delivery-address-issues`:

- pagamento;
- tentativa de despacho;
- compra de etiqueta;
- falha por endereço;
- NF-e.

A transição de status da produção e as leituras novas (`courierIssues`, `courier_issues`, `courierAddressLocked`) chamam só `brazilAddressIssues`. Nenhuma passa pelo serviço de problemas de endereço. O operador vê a trava na linha e decide o que fazer.

**Alternativa recusada:** abrir o problema ao marcar pronto. O cliente receberia e-mail antes de o operador olhar o pedido, e o "Marcar como pronto" passaria a ter efeito fora da cozinha.

## Risks / Trade-offs

- **A fila fica um pouco mais longa:** prontos atrasados aparecem até sair. É o comportamento pedido. O piso de 30 dias limita o acúmulo.
- **Atrasados no Hoje cai quando o pedido fica pronto:** um pedido continua atrasado para o cliente até sair, mas passa a ser contado em "a despachar". O texto "O dia de preparo já passou e o preparo não foi concluído" continua certo.
- **Leitura extra no Hoje:** a leitura dos endereços roda em paralelo às outras contas.
- **Travado sem aviso ao cliente:** `courierAddressLocked` pode ser maior que os problemas abertos, porque o problema só abre num evento. Isso fica visível no Hoje, e o operador decide se tenta o despacho (que abre o problema e manda o e-mail) ou registra um contato.

## Migration Plan

Sem migração de dados. Backend e painel sobem juntos. O painel antigo com o backend novo mostra o pronto atrasado no grupo Atrasados, com Expedir, o que já é melhor que hoje.

## Open Questions

Nenhuma.
