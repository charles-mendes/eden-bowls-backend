# Tasks

Loja (`eden-bowls`) não entra nesta mudança. O catálogo público já filtra `publish`, e o checkout com `variation_id` já gravado não muda. Não criar tarefa nem editar arquivo nesse repositório.

O painel (`eden-bowls-admin`) também não se edita neste apply. Ele consome este contrato na change irmã de mesmo nome.

## 1. Vínculo em lote

- [x] 1.1 Numa consulta por página (e no detalhe), marcar `canDelete` no produto e em cada variação a partir dos `variation_id` e dos `price_` já carregados, olhando `stripe_subscriptions.stripe_price_id` e os line items de `plan_selection`. Sem contagem e sem índice novo. Verificar no teste do service que um price só no JSON deixa `canDelete` false no produto e na variação, e que a variação irmã fica true.

## 2. DELETE

- [x] 2.1 Em `deleteProduct` e `deleteVariation`, responder 409 `product_in_use` ou `variation_in_use` antes de qualquer archive quando o alvo (ou, no produto, qualquer variação) está no ledger, e não apagar posts. Verificar no teste que a Stripe não é chamada e que os posts seguem.
- [x] 2.2 Sem vínculo, arquivar os produtos Stripe e só então apagar os posts. Se o archive de um `prod_` real falhar, responder 502 `stripe_product_archive_failed` e manter os posts. Ids `prod_seed_*` continuam ignorados. Verificar os dois casos no teste do service: sucesso apaga e arquiva; falha de archive não apaga.
- [x] 2.3 Produto com variação A vinculada e B livre: DELETE do produto responde 409; DELETE da B remove só a B; DELETE da A responde 409. Verificar os três no mesmo teste.

## 3. Verificação

- [x] 3.1 Rodar `npx jest --runTestsByPath tests/admin-catalog.service.test.js` e confirmar os casos de vínculo, 409, 502 e variação mista.
