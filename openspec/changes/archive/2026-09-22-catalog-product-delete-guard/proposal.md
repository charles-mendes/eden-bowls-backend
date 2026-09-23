# Proposal

## Why

`DELETE` de produto no catálogo admin apaga `wp_posts` mesmo com assinatura apontando para a variação ou para o price. Não existe foreign key. O archive na Stripe, quando falha, é ignorado e o cadastro local some do mesmo jeito.

## What Changes

- Lista e detalhe de produto passam a incluir `canDelete` no produto e em cada variação.
- `DELETE` do produto ou da variação, se houver vínculo, responde **409** (`product_in_use` ou `variation_in_use`) e não chama a Stripe.
- Sem vínculo, o backend arquiva o produto Stripe e só então apaga os posts. Se o archive de um `prod_` real falhar, os posts ficam e a resposta é **502** `stripe_product_archive_failed`. Ids de seed continuam ignorados.
- Uma variação vinculada deixa o produto inteiro com `canDelete` false. Outra variação do mesmo produto, sem vínculo, continua excluível.
- **BREAKING** para quem hoje apaga produto já vendido: esse DELETE deixa de ter sucesso.

## Capabilities

### New Capabilities

- `catalog-product-delete`: trava de exclusão do catálogo admin quando a assinatura referencia variação ou price, e falha explícita quando o archive na Stripe não completa.

### Modified Capabilities

- (nenhuma — o inventário do backend não tem spec de catálogo)

## Impact

- **Backend (este repo):** `admin-catalog.service.js` (`deleteProduct`, `deleteVariation`, listagem e detalhe), consulta em lote no ledger de `stripe_subscriptions`, e `tests/admin-catalog.service.test.js`. Sem índice novo e sem migração.
- **Painel (`eden-bowls-admin`, change irmã `catalog-product-delete-guard`):** consome `canDelete` e os códigos 409/502. Fora do apply deste change.
- **Loja (`eden-bowls`):** sem impacto e sem tarefa. `GET /api/v1/products` já filtra `post_status = publish`. Desativar o produto no painel continua o `PATCH { active: false }` que já tira o produto dessa lista. Checkout com `variation_id` já gravado segue lendo postmeta sem olhar o status; isso não muda aqui.
