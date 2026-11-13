# Design

## Context

Ver proposal.md. O Hoje (`admin-today.service.js`) monta os itens a partir de `listQueue` com teto de 200 e marca a etiqueta com `listByInvoiceIds`, que só devolve `created`/`delivered`. O courier já tem `readinessReasons` e o par `409 courier_dispatch_needs_confirmation` + `confirm_not_ready`. A fila do courier sai de `listPaidCourierCycles` (país do endereço `BR`) e a de etiquetas de `listPaidLabelCycles` (conta Stripe `us`): os dois critérios convivem até o PM-21 (lote 3). O detalhe da assinatura monta "a expedir" a partir das faturas da Stripe (`billingHistory`), o que exige sincronizar e mostra faturas antigas e de valor zero. O telefone fica em `billing_phone` (usermeta) e as instruções de entrega na cópia de endereço do perfil (`delivery_instructions`), não no endereço da assinatura.

## Goals / Non-Goals

**Goals:** dados no lugar da decisão, sem mudar o que pode ou não sair. Base de contatos para os lotes seguintes.

**Non-Goals:** critério único de mercado (PM-21), travas de endereço e fiscal (PM-22, PM-25), e-mail de endereço inválido (PM-24), coleta UPS (PM-28), paginação (PM-29), "prontos aguardando NF-e" no Hoje (depende de PM-25).

## Decisions

**`unresolved` só para `pending`/`unknown`.** Trocar `listByInvoiceIds` por `listActiveByInvoiceIds` e mapear por status. Tratar toda linha ativa como não resolvida esconderia a etiqueta criada.

**Prontidão compartilhada.** Extrair a regra de `readinessReasons` para um módulo de `core` usado pelo courier e pela UPS, com os mesmos códigos (`production_not_ready`, `subscription_not_active`). A UPS responde `409 ups_label_needs_confirmation` com `reasons` só quando faria uma compra nova, depois de `inspectLabel`: o 422 de endereço ou configuração vem antes, para o operador não confirmar uma compra que seria recusada no passo seguinte. Uma fatura que já tem linha ativa continua no reuso de hoje, sem confirmação, porque nada é comprado. A auditoria da compra grava `confirmedNotReady` como o courier.

**`failure_kind` opcional na API.** Coluna `VARCHAR(32) NULL`, valores fechados. A API aceita sem ele (compatível); o painel passa a exigir. `address_unusable` é o gatilho futuro do PM-24.

**Itens e contato na fila do courier.** O endereço vem do ciclo (`address` da assinatura). Telefone e instruções vêm em uma consulta por lote de `user_id` (usermeta `billing_phone` e o endereço do perfil), não uma por linha. Os itens usam o mesmo presenter da fila de produção. O escopo continua o da rota (`shipping.read` e mercado), que já restringe quem vê o telefone.

**Ciclos pagos por assinatura.** Mesma `queueSourceSql`, filtrada por `s.id` e `payment_state = 'paid'`, ordenada pela data de entrega desc, até 24 ciclos. A ordem usa `COALESCE(delivery_date, DATE(period_end)) DESC`, porque no MySQL `NULL` vem primeiro em `DESC` e um ciclo sem data ocuparia uma das 24 vagas. Cada ciclo leva a situação da expedição: a etiqueta ativa (UPS) e a última entrega do courier por fatura. A seção do painel continua decidida como hoje (país do endereço), até o PM-21.

**Contatos em tabela própria.** `customer_contacts(id, subscription_id, user_id, stripe_account, reason, outcome, note, actor_id, actor_email, created_at)`, índice `(subscription_id, created_at)`. Motivos: `payment_failed`, `late`, `delivery_failed`, `address`. Resultados: `no_answer`, `customer_will_fix`, `resolved`. Canal fixo WhatsApp, por isso não é coluna. Nota até 500 caracteres. Sem edição nem exclusão pelo painel: é registro. Escrita também gera auditoria `customers.contact.create`. Alternativa descartada: evento em `admin_audit_events`, que piora a consulta do último contato.

**Privacidade.** O export entra em `privacy.service.js` `buildExportPackage`: `customer_contacts` com motivo, resultado, nota e data, sem o e-mail do operador. A exclusão entra em `profile.service.js` `deleteAccount` (junto de `anonymizeAccountArtifacts`), que é o caminho comum da exclusão pela loja e pelo pedido de privacidade; só no serviço de privacidade, a exclusão pela loja deixaria os contatos.

**Hoje: contagens próprias.** O bloco `fulfillment` vem de consultas separadas, cada uma no escopo de mercado do ator, e não herda o teto de 200: courier (reaproveita os grupos de `listQueue` do courier, contando), NF-e (contagem por status), Bling (`connectionStatus`, só quando o ator tem `bling.connect`), UPS não confirmada (linhas `pending`/`unknown`). "Em rota há mais de 24 h" usa `out_for_delivery_at`; o limite é uma constante. Cada contagem segue a regra da tela de destino, não o tamanho de uma lista já cortada: "a despachar" repete a regra da aba (ciclo pago BR, entrega nos últimos 30 dias, sem entrega ativa e sem falha em aberto) e "falhas" conta a última entrega da fatura quando ela é a falha, não toda linha `failed`. "Em rota há mais de 24 h" é um recorte: o link abre a aba inteira, que já vem da saída mais antiga, então o total da aba pode ser maior que o aviso. Último contato e telefone entram só nos itens `past_due`, numa consulta por lote de assinatura e de `user_id`.

**Entrega do courier no item de Hoje.** O preparo continua `ready` depois do despacho, então o painel não tem como saber se a caixa saiu. O item BR pago leva `courierDelivery` da última entrega da fatura (cancelada conta como nenhuma), numa consulta por lote com `listByInvoiceIds`. O painel usa isso para "Despachar", "Em rota", "Entregue" ou "Despachar de novo".

## Risks / Trade-offs

- [409 novo na compra UPS] → O painel muda junto; deploy do backend e do painel no mesmo dia. Sem cliente externo.
- [Telefone na fila] → Já é o escopo da rota; nada novo para quem não tem `shipping.read` no mercado.
- [Hoje mais lento] → Quatro consultas a mais, todas com `COUNT` ou pequenas; volume baixo (X-01).
- [Instruções do perfil, não da assinatura] → A linha diz de onde vêm; unificar fica para PM-23.

## Migration Plan

Migrações `064` (`failure_kind`) e `065` (`customer_contacts`), ambas aditivas. O painel antigo ignora os campos novos, mas não envia `confirm_not_ready`: com o backend novo, a compra de um pedido não pronto recebe 409 e ele não sabe confirmar. Por isso backend e painel saem juntos, backend primeiro. Rollback: reverter o código; as colunas e a tabela ficam sem uso.

O prazo de 24 h de "em rota" está na spec; mudar depois é mudar a spec.
