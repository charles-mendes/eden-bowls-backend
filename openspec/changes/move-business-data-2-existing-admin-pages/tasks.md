# Tasks

Fase 2 de 3. Depende da fase 1 (`move-business-data-1-read-from-api`) aplicada. Este change cobre a API e sai antes dos changes irmãos de mesmo nome no painel e na loja. Use o próximo número livre de migração e registre cada uma em `src/infrastructure/db.js`. Rode só os testes relacionados (`npx jest tests/<arquivo>`).

## 1. Apresentação da receita

- [x] 1.1 Criar a migração que adiciona `presentation` (JSON, nula) e `presentation_updated_at` a `recipe_contents`, e `helpers/seed-recipe-presentations.js` com os valores atuais da loja nos dois idiomas, gravando só onde `presentation` é nula (decisões 1 e 2). Verificar com `tests/recipe-presentations.migration.test.js`: os cenários "Seed after deploy" e "Saved presentation survives a rerun", e `down` remove as colunas.
- [x] 1.2 Acrescentar a `src/core/recipe-content.js` a validação da apresentação (limites de texto, 1 a 8 destaques, cinco cores `#RRGGBB`) com 422 `recipe_presentation_invalid` e a lista de campos. Verificar com `tests/recipe-content.core.test.js`: o cenário "Invalid color" e cada limite.
- [x] 1.3 Acrescentar `upsertPresentation` ao repositório e `savePresentation` ao serviço (auditoria `catalog.recipe.presentation.update`), criar `PUT /api/v1/admin/catalog/recipe-content/:flavorSlug/presentation` e rodar `npm run routes:manifest`. Verificar com `tests/recipe-content.service.test.js` e `tests/admin-recipe-content.routes.test.js`: os cenários "Save a presentation in BR" e "Operator outside the market scope", e com `tests/api-routes-manifest.test.js`.
- [x] 1.4 Incluir `name` e `presentation` em `getPublic`. Verificar com `tests/recipes.routes.test.js`: o cenário "Launched recipe with a presentation" e `presentation: null` sem apresentação.
- [x] 1.5 Acrescentar a checagem `presentation` à ativação em `src/services/admin-catalog.service.js` (decisão 3). Verificar com `tests/admin-catalog-activation.service.test.js`: os cenários "New recipe without presentation" e "New recipe goes live without a store deploy", e os casos atuais seguem passando com a semente.

## 2. Percentual por prazo

- [x] 2.1 Criar a migração da tabela `first_purchase_term_discounts` com a semente 10/25/40 para `br` e `us`, e o repositório com leitura em `TtlCache` (60 s, limpo ao gravar) (decisão 4). Verificar com `tests/first-purchase-term-discounts.migration.test.js` e `tests/first-purchase-term-discounts.repository.test.js`: o cenário "Values after deploy" e contas independentes.
- [x] 2.2 Trocar as leituras de `TERM_PERCENT_MAP`/`PLAN_TERMS` pelo repositório no checkout, no snapshot do plano, na resolução do cupom e em `termFromStripePromo`. Verificar com `tests/first-purchase-discount.test.js`, `tests/stripe-coupon.service.test.js` e os testes do checkout de assinatura (`npx jest --findRelatedTests src/services/onboarding-subscription-checkout.service.js`): o cenário "Accounts are independent" e os três prazos sem mudança com a semente.
- [x] 2.3 Em `createFirstPurchaseCoupon`, aceitar `percent_off` de 1 a 90 (422 `invalid_percent_off`), remover `percent_off_locked` e, depois da Stripe, mapear o código e gravar o percentual e a auditoria `billing.first_purchase.percent.update` numa transação (decisão 5). Verificar com `tests/stripe-coupon-create.test.js`: os cenários "Raise the 3-month percent in BR", "Stripe refuses the coupon" e "Percent out of range".
- [x] 2.4 Marcar `percent_mismatch` e `percent_off` em cada slot da saúde dos cupons. Verificar com `tests/stripe-coupon.service.test.js`: o cenário "Coupon mapped by hand with another percent" e `false` sem cupom.

## 3. Prazo máximo de trânsito nos EUA

- [x] 3.1 Criar a migração de `max_transit_days` (int, padrão 1) em `shipping_us_settings`, incluir o campo na entidade, no repositório e na validação do `PUT` de configurações (1 a 10, 422 fora disso). Verificar com `tests/shipping-settings.migration.test.js`, `tests/shipping-settings.repository.test.js` e `tests/admin-shipping.service.test.js`: o cenário "Out of range".
- [x] 3.2 Acrescentar `setUsMaxTransitDays`/`currentUsMaxTransitDays` a `src/core/delivery-closed-days.js`, chamados por `shipping.service.js` ao carregar e ao salvar, e trocar as três leituras de `MAX_TRANSIT_DAYS_US` (decisão 6). Verificar com `tests/delivery-closed-days.test.js` e um teste da rota de estimativa: os cenários "Value after deploy" e "Operator allows two transit days".

## 4. Pacotes do plano

- [x] 4.1 Fazer `buildSimplifiedRecommendation` e `buildPackagingRecommendation` receberem `{ packSizesGrams, planDays, largePackLimit }`, com os valores atuais como padrão (decisão 7). Verificar com `tests/simplified-consumption.test.js`: os testes atuais passam sem o objeto, e os cenários "Operator adds a 1 kg variation" e "Lower large-pack limit".
- [x] 4.2 Montar o objeto no repositório de recomendação e no `admin-onboarding.service.js` a partir do produto do plano do mercado. Verificar com o teste do repositório (`npx jest --findRelatedTests src/infrastructure/repositories/onboarding-recommendation.repository.js`): o cenário "Catalog with 300 g and 500 g" e o fallback sem variação ativa.
- [x] 4.3 Aceitar e devolver `largePackLimit` (1 a 60, meta `_cmpb_large_pack_limit`, padrão 8; camelCase como `planDays` no mesmo payload) no detalhe e na edição do produto em `admin-catalog.service.js`. Verificar com `tests/admin-catalog.service.test.js`: grava, devolve 8 sem meta, 422 fora do intervalo.

## 5. Integração

- [x] 5.1 Na base local com as migrações, gerar uma recomendação e um snapshot de plano para um pet de cada mercado antes e depois do deploy e comparar os JSON: pacotes, percentuais e frete iguais. Anexar a comparação ao PR.
