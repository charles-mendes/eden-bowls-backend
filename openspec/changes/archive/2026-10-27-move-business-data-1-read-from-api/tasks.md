# Tasks

Fase 1 de 3. Este change cobre a API e sai antes dos changes irmãos `move-business-data-1-read-from-api` do painel (`eden-bowls-admin`) e da loja (`eden-bowls`). Rode só os testes relacionados (`npx jest tests/<arquivo>`).

## 1. Lista pública de receitas lançadas

- [x] 1.1 Acrescentar `listPublic(market)` a `src/services/recipe-content.service.js` (decisão 1): receitas do mercado com variação ativa, com `key`, `name` e `lifeStage`, e 400 `invalid_market` pelo `marketOf` atual. Verificar com `tests/recipe-content.service.test.js`: os cenários "Senior line launched in BR only" e "Deactivating the last variation removes the recipe", e toda chave listada resolve em `getPublic`.
- [x] 1.2 Registrar `GET /api/v1/recipes` em `src/api/routes/recipes.routes.js`, com o mesmo `limiter` da rota por chave e sem autenticação, e rodar `npm run routes:manifest`. Verificar com `tests/recipes.routes.test.js` (200 com a lista, 400 `invalid_market` para `AR`, sem `label` nem imagem na resposta) e com `npx jest tests/api-routes-manifest.test.js`.

## 2. Percentual por prazo na saúde dos cupons

- [x] 2.1 Incluir `terms: PLAN_TERMS` na resposta de saúde dos cupons de 1ª compra em `src/services/stripe-coupon.service.js`, inclusive quando não há cupom mapeado (decisão 3). Verificar com `tests/stripe-coupon.service.test.js` e `tests/admin-shipping-coupons.routes.test.js`: os cenários "Health lists the three terms" e "Health without any mapped coupon", com os mesmos percentuais de `plan_terms`.

## 3. Limpeza do frete

- [x] 3.1 Remover `data/shipping-settings.json` e acrescentar uma linha em `docs-new/FEATURE_UPS/gates-e-pontos-em-aberto.md` (item 9) dizendo que o arquivo foi removido. Verificar com `rg "shipping-settings\.json" src tests` sem resultado e com `npx jest tests/shipping-settings.test.js tests/shipping-settings.repository.test.js`.

## 4. Integração

- [x] 4.1 Com a API local de pé, conferir `curl "localhost:3000/api/v1/recipes?market=BR"` contra a lista do painel em Receitas: as receitas com variação ativa batem. Registrar no PR as chaves que estavam com `VITE_LIFE_STAGE_RECIPES_LAUNCHED_*=true` e não têm variação ativa, para o operador ativar antes do deploy da loja (passo 3 do Migration Plan).
