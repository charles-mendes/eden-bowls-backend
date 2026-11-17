# Tasks

## 1. Schema e backfill (API)

- [x] 1.1 Criar a migration `1700000000059-link-recipe-banner-image-asset`:
  - coluna `recipe_contents.image_asset_id` com FK `RESTRICT` para `media_assets.id`;
  - backfill de cada `image_url` sem asset (kind `banner`, mesma URL, basename como nome original, `image/webp`), sem duplicar numa segunda execução;
  - `down` que remove a FK e a coluna;
  - registrar no `db.js`;
  - teste em `tests/recipe-banner-image-asset.migration.test.js`, cobrindo "Backfill of a stored banner" e a segunda execução;
  - verificar com `npx jest --runTestsByPath tests/recipe-banner-image-asset.migration.test.js`.
- [x] 1.2 Estender `tests/integration/media-assets.integration.test.js` com o backfill do banner, a segunda execução e a FK `RESTRICT` em `image_asset_id`:
  - verificar com `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/media-assets.integration.test.js`.

## 2. Biblioteca aceita `banner` (API)

- [x] 2.1 `MEDIA_ASSET_KINDS = ['plan', 'banner']` em `src/core/recipe-content.js`:
  - em `tests/media-library.service.test.js`, cobrir "Upload a 1024 × 636 banner", "Plan-sized image as a banner is refused" e o kind desconhecido `avatar`;
  - verificar com `npx jest --runTestsByPath tests/media-library.service.test.js tests/recipe-image.imaging.test.js`.
- [x] 2.2 `MediaAssetRepository.usedByIds` escolhe a coluna pelo `kind` (`plan` → `plan_image_asset_id`, `banner` → `image_asset_id`), por um mapa fixo, em `list`, `findById`, `findByHash` e `archive`:
  - em `tests/media-asset.repository.test.js`, cobrir "Banner in use" e que um banner não aparece como usado por uma miniatura com o mesmo id;
  - verificar com `npx jest --runTestsByPath tests/media-asset.repository.test.js`.
- [x] 2.3 Em `tests/admin-media.routes.test.js`, cobrir `POST /media` com `kind: banner` (201 e depois 200 `duplicate`), `GET /media?kind=banner` e "Archive a banner in use" (409):
  - verificar com `npx jest --runTestsByPath tests/admin-media.routes.test.js`.

## 3. Banner da receita aponta para a biblioteca (API)

- [x] 3.1 `RecipeContentRepository.setImage({ market, flavorSlug, assetId, actorId })`:
  - trava o asset, dá 404 se ele não existe e 409 `media_asset_archived` se está arquivado;
  - grava `image_url`, `image_asset_id` e `image_updated_at` juntos, e com `assetId` nulo desvincula;
  - a leitura expõe `imageAssetId`;
  - remover `upsertImage` e `clearImage`;
  - verificar em `tests/recipe-content.repository.test.js`.
- [x] 3.2 `RecipeContentService`:
  - helper `resolveLinkedAsset(recipe, kind, payload, actor)`, usado por `uploadImage` e `uploadPlanImage`;
  - `uploadImage` aceita `{ assetId }` ou upload (kind `banner`), com 422 se vierem os dois ou nenhum, e nunca apaga o banner anterior;
  - `present` expõe `imageAssetId`;
  - auditoria com `assetId`;
  - verificar em `tests/recipe-content.service.test.js`: "Link an existing library banner", "Plan thumbnail as a banner", "Banner of another market", "Archived banner", "Unknown image", "Valid image replaces the old one" e "Banner link is audited".
- [x] 3.3 `removeImage` mantém o 409 com variação ativa e só desvincula. `remove` não apaga mais nenhum arquivo. Remover `deleteFile`:
  - em `tests/recipe-content.service.test.js`, cobrir "Remove with only inactive variations", "Unlink and link again", "Delete an unused recipe" e "Backfilled banner is not deleted on replace", com o storage sem `delete`.
- [x] 3.4 `LocalRecipeImageStorage`:
  - remover `write`, `delete` e `RECIPE_IMAGE_FILENAME_PATTERN`, deixando só `writeAsset`;
  - ajustar `tests/local-recipe-image-storage.test.js`, para o storage não expor `delete`;
  - verificar com `npx jest --runTestsByPath tests/local-recipe-image-storage.test.js`.
- [x] 3.5 Ajustar `tests/admin-recipe-content.routes.test.js` para `PUT .../image { assetId }` e o 422 de corpo inválido, e conferir que `GET /api/v1/recipes/:key` continua expondo o mesmo `imageUrl` e que a ativação com banner da biblioteca satisfaz `final_image`:
  - verificar com `npx jest --runTestsByPath tests/admin-recipe-content.routes.test.js tests/recipes.routes.test.js`.
- [x] 3.6 Atualizar a seção de volumes em `docs/production-go-live.md`:
  - banners e miniaturas nunca são apagados pela API;
  - o mesmo backup cobre os dois;
  - verificar relendo a seção.
- [x] 3.7 Rodar `npm run routes:manifest` e confirmar que `docs/api-routes.json` não mudou (se mudar, commitar):
  - verificar com `npx jest --runTestsByPath tests/api-routes-manifest.test.js`.
- [x] 3.8 Rodar a suíte da área:
  - `npx jest --changedSince=main`;
  - corrigir as falhas antes do painel.

## 4. Painel (`eden-bowls-admin`)

- [x] 4.1 `lib/mediaLibrary.ts`:
  - `MediaKind = 'plan' | 'banner'`;
  - `suggestPlanLink` vira `suggestRecipeLink`, com `receita`/`recipe` como linha adulta e o sufixo `pt`/`en` como idioma (design, decisão 7);
  - em `lib/mediaLibrary.test.ts`, cobrir os 16 nomes de `docs-new/FEATURE_ADICIONANDO_IMAGENS_DESTAQUE_TELA_INICIAL/{pt,en}/<linha>/`:
    - adultos: `receita-carne-pt.png` → BR `beef`, `receita-frango-pt.png` → BR `turkey`, `receita-peixe-pt.png` → BR `fish`, `receita-porco-pt.png` → BR `pork`, `recipe-chicken.png` → US `turkey`, `recipe-beef.png` → US `beef`;
    - filhotes e sêniores: `filhote-frango-porco.png` → BR `puppy-chicken-pork`, `senior-carne.png` → BR `senior-beef`, `puppy-beef-chicken.png` → US `puppy-beef-chicken`, `senior-chicken.png` → US `senior-chicken`;
  - os testes atuais com os nomes `_400` das miniaturas continuam passando.
- [x] 4.2 Atualizar `mockAdminFetch.ts` e `fixtures.ts` com banners na biblioteca, `imageAssetId` e `PUT .../image { assetId }`.
- [x] 4.3 `MediaLibraryPage.tsx`:
  - alternância "Destaques / Miniaturas", com Destaques por padrão (`?kind=plan` para as miniaturas) e o texto de onde cada tipo aparece na loja;
  - títulos e textos por tipo;
  - checagem 1024 × 636 no lote de destaques;
  - vínculo por `PUT .../image { assetId }`;
  - aviso de substituição;
  - verificar em `MediaLibraryPage.test.tsx` com os 16 nomes, incluindo o bloqueio de receita repetida e "Só guardar na biblioteca".
- [x] 4.4 Seção de banner em `RecipeContentPage.tsx`:
  - "Escolher da biblioteca" e "Enviar nova";
  - "Desvincular imagem" com a confirmação do design;
  - bloqueio por variação ativa como hoje;
  - sem "Arquivar";
  - verificar em `RecipeContentPage.test.tsx`.
- [x] 4.5 Rodar no painel `npx vitest run --changed main`, o typecheck e o lint. Se o manifesto mudou na 3.7, rodar também `npm run contract:sync` e o Vitest do contrato.

- [x] 4.6 Classificar por linha na confirmação do lote:
  - `suggestRecipeLink` devolve a linha do nome do arquivo;
  - o seletor de receita agrupa por Adulto, Filhote e Sênior e mostra a linha da receita escolhida;
  - aviso, sem bloquear, quando a linha do arquivo e a da receita divergem;
  - verificar em `lib/mediaLibrary.test.ts` (linha dos 16 nomes) e `MediaLibraryPage.test.tsx` (grupos, linha escolhida e aviso).

- [x] 4.7 Editar o vínculo pela Biblioteca e reorganizar a tela (design, decisão 7):
  - `MediaLinkDialog` com "Desvincular" por receita e "Vincular a outra receita" agrupada por linha;
  - mercado no cabeçalho, tipo em abas, envio na ação da lista, contagem e "Na biblioteca / Arquivadas" acima da grade;
  - verificar em `MediaLibraryPage.test.tsx`: corrigir um vínculo errado (desvincula e vincula a certa), 409 com variação ativa e vincular pelo card.

## 5. Verificação integrada

- [x] 5.1 Rodar API, painel e loja localmente e conferir:
  - os 16 PNGs de `docs-new/FEATURE_ADICIONANDO_IMAGENS_DESTAQUE_TELA_INICIAL/{pt,en}/<linha>/` sobem como Destaques e a lista sugerida está certa nas três linhas;
  - o carrossel "Nossas receitas para cães" mostra os banners novos em BR e US nas receitas lançadas, com os adultos BR em embalagem PT;
  - trocar um banner mantém o anterior na biblioteca e servido;
  - desvincular faz a loja voltar à imagem do front;
  - arquivar um banner em uso é bloqueado com o nome da receita.
  - Conferido em 28/10/2026 no ambiente local:
    - os 16 assets `banner` têm o mesmo SHA-256 dos PNGs da pasta;
    - BR tem os 8 vínculos certos; US tem os 4 adultos vinculados, e os 4 filhotes e sêniores ficam só na biblioteca, porque US ainda não tem essas receitas;
    - o carrossel carrega os banners da biblioteca (200) nas abas Adulto, Filhote e Sênior em BR, e nos 4 adultos em US;
    - trocar `turkey` (BR) mantém o asset anterior na biblioteca, sem uso e servido (200);
    - arquivar em uso dá 409 `media_asset_in_use` com "Frango (BR)";
    - desvincular com variação ativa dá 409 `recipe_content_in_use`. Toda receita local tem variação ativa, então a volta à imagem do front ficou coberta pelos testes de serviço e pela regra `imageUrl || fallbackImage` da loja.
- [x] 5.2 `openspec validate add-banner-image-library --strict` sem erros.
