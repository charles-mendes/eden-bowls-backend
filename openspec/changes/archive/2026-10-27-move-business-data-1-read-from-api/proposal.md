# Proposal

## Why

Parte dos dados de negócio já mora no banco, mas a loja e o painel ainda têm cópias fixas no código. Por isso uma mudança feita no painel não aparece sem deploy, e as duas fontes podem divergir. Esta é a fase 1 de 3 da retirada desses dados do código: cobre os casos em que o dado **já está no banco ou é decidido pela API**, e só falta a loja e o painel lerem da API. Não cria tela nova.

As fases 2 (`move-business-data-2-existing-admin-pages`) e 3 (`move-business-data-3-new-admin-pages`) tornam editáveis no painel os dados que ainda são constantes da API.

## What Changes

- **Lançamento das linhas de filhote e sênior (#5).** Rota pública nova `GET /api/v1/recipes?market=` que lista as receitas lançadas no mercado (chave, nome e fase da vida). "Lançada" segue a regra que `GET /api/v1/recipes/:key` já usa: a receita tem variação ativa no mercado. A loja passa a decidir o que mostrar por essa lista, e as variáveis de build `VITE_LIFE_STAGE_RECIPES_LAUNCHED_BR/US` deixam de existir (change irmão da loja).
- **Percentual de desconto por prazo (#2, leitura).** A rota de saúde dos cupons de 1ª compra (`GET /api/v1/admin/stripe/first-purchase-promos`) passa a devolver o percentual de cada prazo. O painel deixa de ter a tabela `{ 1: 10, 3: 25, 6: 40 }` (change irmão do painel). Os valores continuam definidos na API nesta fase; a fase 2 os torna editáveis.
- **Frete padrão dos EUA (#7).** A loja deixa de usar o fallback fixo `UPS $12.90` do checkout e mostra o frete só depois da cotação da API (change irmão da loja). Na API, o arquivo obsoleto `data/shipping-settings.json`, que não é lido em runtime, é removido.

## Capabilities

### New Capabilities

- `first-purchase-discount`: percentual de desconto da 1ª fatura por prazo de assinatura, e como a API o informa ao painel e ao checkout.

### Modified Capabilities

- `recipe-content`: lista pública das receitas lançadas por mercado. A capability é criada pelo change `add-recipe-image-and-label`, ainda não arquivado; este change só acrescenta requisitos e deve ser arquivado depois dele.

## Impact

- API: `src/api/routes/recipes.routes.js`, `src/services/recipe-content.service.js`, `src/services/stripe-coupon.service.js`, remoção de `data/shipping-settings.json`. Rota nova no manifesto `docs/api-routes.json` (`npm run routes:manifest`).
- Change irmão no painel (`eden-bowls-admin`, mesmo nome): `CouponsPage.tsx` lê os percentuais da resposta de saúde; `npm run contract:sync`.
- Change irmão na loja (`eden-bowls`, mesmo nome): `src/config/lifeStageLaunch.ts` e `src/seo/config.ts` passam a usar a lista de receitas lançadas; `Checkout.tsx` sem `DEFAULT_US_SHIPPING`; `.env*.example` sem `VITE_LIFE_STAGE_RECIPES_LAUNCHED_*`.
- Sem migração e sem mudança de dados.
