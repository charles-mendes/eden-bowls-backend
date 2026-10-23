# Tasks

Duas fases. Cada fase deste change sai antes da mesma fase nos changes irmãos `add-recipe-image-and-label` da loja (`eden-bowls`) e do painel (`eden-bowls-admin`). Rode só os testes relacionados (`npx jest tests/<arquivo>`).

## 1. Fase 1 · Dados, diretório e volume

- [ ] 1.1 Criar `src/infrastructure/migrations/1700000000038-create-recipe-contents.js` (tabela e índice da decisão 2), com `up`/`down` idempotentes, e registrar em `src/infrastructure/db.js`. Verificar com `tests/recipe-contents.migration.test.js`: cria, roda de novo sem erro, `down` remove.
- [ ] 1.2 Criar `src/infrastructure/repositories/recipe-content.repository.js` com `findByMarketAndSlug`, `findByMarketAndSlugs`, `upsertImage` e `clearImage`. Verificar com `tests/recipe-content.repository.test.js`: upsert cria e depois atualiza a mesma linha, e mercados diferentes não se misturam.
- [ ] 1.3 Adicionar `RECIPE_IMAGE_DIR` (padrão `./public/recipe-images`) e `RECIPE_IMAGE_PUBLIC_BASE_URL` em `src/config/env.js`, no molde de `FEEDBACK_PHOTO_DIR`, e nos três `.env*.example`. Verificar com `tests/env.parse.test.js`: o padrão e o valor informado.
- [ ] 1.4 Montar o volume `eden-bowls-recipe-images:/app/public/recipe-images` no serviço `api` de `docker-compose.backend.yml` e `eden-bowls-recipe-images-qa` no serviço `api` de `docker-compose.qa.yml` (não no `cron`), declarando os volumes. Atualizar a seção "Files" de `docs/production-go-live.md` com o volume novo e a cópia de `public/recipe-images` antes de trocar o bind. Verificar com `docker compose -f docker-compose.qa.yml config`, que deve listar o volume só no `api`, e com uma checagem em `tests/qa-compose-jobs.test.js`.

## 2. Fase 1 · Imagem

- [ ] 2.1 Criar `src/core/recipe-content.js` com as constantes da imagem e `src/infrastructure/imaging/recipe-image.js` (decisão 4). Verificar com `tests/recipe-image.imaging.test.js`: PNG 1024 × 636 com alpha vira WebP 1024 × 636; 1200 × 800 recusa com `width`/`height`/`expectedWidth`/`expectedHeight`; GIF recusa; acima de 5 MB recusa.
- [ ] 2.2 Criar `src/infrastructure/storage/local-recipe-image-storage.js` no padrão de `local-feedback-photo-storage.js` (`delete` só apaga nomes `recipe-<market>-<slug>-<uuid>.webp`), instanciar em `src/index.js` com `RECIPE_IMAGE_DIR` e servir `/recipe-images` em `src/app.js`. Verificar com `tests/local-recipe-image-storage.test.js` e com um teste de rota em que a URL gravada responde sem token.
- [ ] 2.3 Criar `src/services/recipe-content.service.js` com `get`, `uploadImage` (valida, grava, apaga o anterior depois do upsert, audita `catalog.recipe.image.update` com mercado e sabor) e `removeImage` (409 `recipe_content_in_use` com variação ativa e auditoria `catalog.recipe.image.delete`). Verificar com `tests/recipe-content.service.test.js`: cenários de "Recipe image must match the store banner size", "Image of an active recipe cannot be removed" e "Recipe content belongs to a market and a flavor", e um evento de auditoria por ação.
- [ ] 2.4 Adicionar em `src/api/routes/admin.routes.js` as rotas GET, PUT `/image` e DELETE `/image` (decisão 6), com `express.json({ limit: '8mb' })` só no PUT de imagem em `src/app.js`. Injetar o serviço em `src/config/` e rodar `npm run routes:manifest`. Verificar com `tests/admin-recipe-content.routes.test.js` (cenários de "Content changes follow catalog permissions and market scope", e 422/409 repassados) e com o teste de manifesto.
- [ ] 2.5 Em `admin-catalog.service.js`, devolver `recipeImageUrl` e `recipeLabelStatus` por variação no detalhe (uma consulta `findByMarketAndSlugs`) e aceitar `final_image` com imagem cadastrada **ou** `_final_image_ready` (decisão 8). Verificar com `tests/admin-catalog-activation.service.test.js` e `tests/admin-catalog.service.test.js`: os cenários de "Stored content satisfies the activation checks" (imagem) e "Product detail reports each variation's content", e os casos atuais seguem passando.
- [ ] 2.6 Criar `src/api/routes/recipes.routes.js` com `GET /api/v1/recipes/:key?market=` (`limiter` de produtos, aliases, 404 sem variação ativa, 400 para mercado inválido, `label: null` nesta fase) e rodar `npm run routes:manifest`. Verificar com `tests/recipes.routes.test.js`: cenários de "Public route serves launched recipe content".

## 3. Fase 2 · Rótulo

- [ ] 3.1 Acrescentar a `src/core/recipe-content.js` a validação de formato do rótulo (textos com no máximo 500 caracteres, listas com no máximo 40 itens, linhas de análise com `nutrient` e `value`) e `labelCompleteness(label, market)` (decisão 7). Verificar com `tests/recipe-content.core.test.js`: os cenários de "Label completeness depends on the market", incluindo aviso de outro texto em US e BR sem aviso.
- [ ] 3.2 Acrescentar `upsertLabel` ao repositório e `saveLabel` ao serviço (grava rascunho, 409 `recipe_content_in_use` quando torna incompleto um US ativo, auditoria `catalog.recipe.label.update`), com `labelStatus`/`labelMissing` no `get`. Criar `PUT /label` e rodar `npm run routes:manifest`. Verificar com `tests/recipe-content.service.test.js` e `tests/admin-recipe-content.routes.test.js`: cenários de "Label data is stored per market in the market language" e "Label of an active US recipe stays complete".
- [ ] 3.3 Em `admin-catalog.service.js`, usar o `recipeLabelStatus` real e aceitar `label_data` (US) com rótulo completo **ou** `_label_data_ready`. Verificar com `tests/admin-catalog-activation.service.test.js`: o cenário "US activation with incomplete stored label" e a ativação US com rótulo completo sem confirmação.
- [ ] 3.4 Devolver `label` na rota pública. Verificar com `tests/recipes.routes.test.js`: o rótulo cadastrado vem inteiro, e sem cadastro vem `null`.

## 4. Integração

- [ ] 4.1 Em QA, enviar uma imagem, recriar o container `api` (`docker compose -f docker-compose.qa.yml up -d --force-recreate api`) e abrir a URL `/recipe-images/...`. Verificar o cenário "Recipe image survives a redeploy".
