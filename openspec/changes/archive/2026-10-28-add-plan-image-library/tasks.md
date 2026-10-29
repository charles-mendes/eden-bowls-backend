# Tasks

## 1. Schema e backfill (API)

- [x] 1.1 Criar a migration `1700000000057-create-media-assets`:
  - tabela `media_assets` com as colunas e o índice único `(market, kind, sha256)` do design;
  - `up`/`down` que podem rodar de novo sem erro;
  - registrar no `db.js`;
  - teste em `tests/media-assets.migration.test.js`;
  - verificar com `npx jest --runTestsByPath tests/media-assets.migration.test.js`.
- [x] 1.2 Criar a migration `1700000000058-link-recipe-plan-image-asset`:
  - coluna `recipe_contents.plan_image_asset_id` com FK `RESTRICT`;
  - backfill de cada `plan_image_url` sem asset (mesma URL, basename como nome original, `image/webp`), sem duplicar em uma segunda execução;
  - `down` que remove a FK e a coluna;
  - teste em `tests/recipe-plan-image-asset.migration.test.js`, cobrindo o cenário "Backfill of a stored thumbnail" e a segunda execução.
- [x] 1.3 Conferir as migrations num MySQL real. O dump do CI é só o schema legado e as migrations rodam por cima, então o dump não muda:
  - `tests/integration/media-assets.integration.test.js` cobre backfill, segunda execução, FK `RESTRICT` e índice único;
  - verificar com `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/media-assets.integration.test.js`.

## 2. Biblioteca na API

- [x] 2.1 `RECIPE_PLAN_IMAGE_SIZES` passa a ser `[400]` em `src/core/recipe-content.js`, e entram os códigos `media_asset_invalid`, `media_asset_in_use` e `media_asset_archived`:
  - ajustar `tests/recipe-image.imaging.test.js` (200 × 200 recusado, `expectedWidth` 400);
  - verificar com `npx jest --findRelatedTests src/infrastructure/imaging/recipe-image.js`.
- [x] 2.2 Adicionar `LocalRecipeImageStorage.writeAsset({ market, kind, buffer })`:
  - grava `<kind>-<market>-<32 hex>.webp`;
  - padrão de nome ampliado;
  - verificar em `tests/local-recipe-image-storage.test.js` que o nome não leva slug e muda a cada escrita.
- [x] 2.3 Criar `src/infrastructure/repositories/media-asset.repository.js`:
  - insert;
  - busca por id e por `(market, kind, sha256)`;
  - lista por mercado, kind e arquivadas, com `usedBy` por `LEFT JOIN recipe_contents`;
  - archive/restore transacional que confere o uso;
  - nenhum `DELETE`;
  - verificar em `tests/media-asset.repository.test.js`.
- [x] 2.4 Criar `src/services/media-library.service.js`:
  - `upload` com validação (`processRecipeImage` `kind: 'plan'`), `sha256` dos bytes originais, dedup com `duplicate: true` e restauração se arquivado, e `writeAsset`;
  - `list`, `archive` (409 `media_asset_in_use` com `usedBy`) e `restore`;
  - escopo de mercado;
  - auditoria `media.upload`, `media.archive` e `media.restore` com market, id e nome original;
  - verificar em `tests/media-library.service.test.js` os cenários do spec `plan-image-library`.
- [x] 2.5 Registrar as rotas em `admin.routes.js`:
  - `GET /api/v1/admin/media` (`catalog.read`);
  - `POST /api/v1/admin/media`;
  - `POST /api/v1/admin/media/:id/archive`;
  - `POST /api/v1/admin/media/:id/restore` (`catalog.write`);
  - escopo de mercado: query no GET e mercado do corpo ou do asset nas escritas;
  - limite de 8 MB para `POST /api/v1/admin/media` em `app.js`;
  - montar o serviço em `src/index.js`;
  - verificar em `tests/admin-media.routes.test.js`: 403 readonly, 403 fora do mercado, 404 em `DELETE /media/:id`, 201/200 duplicate.
- [x] 2.6 Rodar `npm run routes:manifest`, commitar `docs/api-routes.json` e verificar com `npx jest --runTestsByPath tests/api-routes-manifest.test.js`.

## 3. Receita aponta para a biblioteca (API)

- [x] 3.1 Repositório: `setPlanImage` grava `plan_image_asset_id` e `plan_image_url` juntos, e a leitura expõe `planImageAssetId`:
  - verificar em `tests/recipe-content.repository.test.js`.
- [x] 3.2 `RecipeContentService.uploadPlanImage`:
  - aceita `{ assetId }` (404, 422 `media_asset_invalid` por mercado/kind, 409 `media_asset_archived`) ou upload via `MediaLibraryService.upload`;
  - os dois juntos, ou nenhum: 422;
  - nunca apaga o asset anterior;
  - auditoria com o id do asset;
  - verificar em `tests/recipe-content.service.test.js`: "Link an existing library image", "Image of another market", "Archived image", "Upload replaces the linked thumbnail".
- [x] 3.3 `removePlanImage` só desvincula, e `remove` deixa de apagar o arquivo da miniatura (o banner continua sendo apagado):
  - verificar em `tests/recipe-content.service.test.js`: "Unlink and link again" e "Delete an unused recipe with a plan thumbnail", com `imageStorage.delete` chamado só para o banner.
- [x] 3.4 Ajustar `tests/admin-recipe-content.routes.test.js` para o corpo `{ assetId }` e o 422 de 200 px, e conferir que `GET /api/v1/recipes/:key` continua expondo `planImageUrl`:
  - verificar com `npx jest --runTestsByPath tests/admin-recipe-content.routes.test.js tests/recipes.routes.test.js`.
- [x] 3.5 Documentar em `docs/production-go-live.md`:
  - os arquivos de `recipe-images` nunca são apagados pela API;
  - o volume precisa de backup periódico (o que copiar e como restaurar);
  - verificar relendo a seção de volumes.
- [x] 3.6 Rodar a suíte da área:
  - `npx jest --changedSince=main`;
  - corrigir as falhas antes do painel.

## 4. Painel (`eden-bowls-admin`)

- [x] 4.1 `npm run contract:sync` e commitar `contracts/backend-routes.json`:
  - verificar com o Vitest do contrato.
- [x] 4.2 `imageUpload.ts`: `RECIPE_PLAN_IMAGE_SIZES` = `[400]`:
  - verificar em `imageUpload.test.ts` que 200 × 200 é recusado com o texto "400 × 400 px".
- [x] 4.3 Criar `lib/mediaLibrary.ts`:
  - tipos e chamadas de `/admin/media`;
  - `suggestPlanLink(fileName, recipesByMarket)` conforme o design;
  - verificar em `lib/mediaLibrary.test.ts` que os 16 nomes da designer sugerem mercado e chave certos (`adulto-frango_400.png` → BR `turkey`, `filhote-carne-frango_400.png` → BR `puppy-beef-chicken`, `senior-chicken_400.png` → US `senior-chicken`) e que um nome desconhecido fica sem sugestão.
- [x] 4.4 Atualizar `mockAdminFetch.ts` e `fixtures.ts` com as rotas de mídia e o `planImageAssetId`.
- [x] 4.5 Criar a página `pages/MediaLibraryPage.tsx` em `/catalog/media`, com o item "Biblioteca de imagens" no grupo Loja de `menu.ts`:
  - grade por mercado, alternância "Arquivadas", "Em uso por Adulto Carne (BR)";
  - "Arquivar" só quando a imagem não está em uso, "Restaurar" nas arquivadas;
  - escrita escondida para readonly;
  - verificar em `MediaLibraryPage.test.tsx` e `menu.test.ts`.
- [x] 4.6 Upload em lote na mesma página:
  - escolha de vários arquivos e checagem de 400 × 400 por arquivo;
  - lista de confirmação com prévia, mercado e receita editáveis, aviso de substituição e opção "Só guardar na biblioteca";
  - bloqueio de receita repetida e de mercado fora da sessão;
  - nada é enviado antes de "Confirmar"; depois, um `POST /media` e um `PUT .../plan-image { assetId }` por linha, com resultado por linha;
  - verificar em `MediaLibraryPage.test.tsx` com os 16 nomes da designer.
- [x] 4.7 `RecipePlanImageSection.tsx`:
  - "Escolher da biblioteca" (seletor das não arquivadas do mercado) e "Enviar nova";
  - "Desvincular miniatura" com o texto "A imagem sai do card do plano e continua na Biblioteca de imagens.";
  - sem "Arquivar";
  - verificar em `RecipeContentPage.test.tsx`.
- [x] 4.8 Rodar no painel `npx vitest run --changed main`, mais o typecheck e o lint.

## 5. Verificação integrada

- [x] 5.1 Rodar API e painel localmente e conferir:
  - envio dos 16 arquivos `_400` de `docs-new/.../{pt,en}` pela Biblioteca e confirmação da lista sugerida;
  - a tela Plano da loja em BR e US mostra as miniaturas novas sem mudança de código na loja;
  - desvincular uma miniatura faz o card cair para o banner e a imagem continuar listada na biblioteca;
  - arquivar uma imagem em uso é bloqueado com o nome da receita.
- [x] 5.2 `openspec validate add-plan-image-library --strict` sem erros.
