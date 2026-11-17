# Proposal

## Why

O banner da receita (1024 × 636) aparece no carrossel "Nossas receitas para cães" da tela inicial. Ele é cadastrado no painel em `PUT/DELETE /api/v1/admin/catalog/recipe-content/:flavorSlug/image`, mas o arquivo não fica guardado: trocar o banner, removê-lo ou excluir a receita apaga o arquivo do disco. A miniatura do plano já resolveu esse problema com a Biblioteca de imagens (`plan-image-library`). Agora existem os 16 banners das três linhas (Adulto, Filhote e Sênior) em português e em inglês, em `docs-new/FEATURE_ADICIONANDO_IMAGENS_DESTAQUE_TELA_INICIAL/{pt,en}/<linha>/`, e eles merecem a mesma proteção.

## What Changes

- **Banner na biblioteca.** `media_assets` passa a aceitar `kind = 'banner'`, com 1024 × 636, PNG, JPEG ou WebP até 5 MB, gravado como WebP. A deduplicação por bytes, o arquivar/restaurar e o bloqueio de arquivar imagem em uso valem como para a miniatura.
- **A receita aponta para um banner da biblioteca.** `PUT .../image` aceita `{ assetId }` de um banner que já está na biblioteca. O upload direto continua funcionando: entra na biblioteca e já é vinculado.
- **Trocar, desvincular ou excluir não apaga o arquivo.** Trocar o banner deixa o anterior na biblioteca, servido na mesma URL. `DELETE .../image` só desvincula, e continua recusado com 409 `recipe_content_in_use` enquanto houver variação ativa. Excluir uma receita sem variações não apaga mais o banner.
- **Nenhuma imagem de receita é apagada pela API.** Com o banner na biblioteca, deixa de existir qualquer caminho que apague arquivo de `RECIPE_IMAGE_DIR`.
- **Backfill.** Todo `recipe_contents.image_url` que já existe vira um banner da biblioteca vinculado, com a mesma URL. A loja continua mostrando o mesmo arquivo.
- **Painel:**
  - a Biblioteca de imagens ganha a alternância "Destaques / Miniaturas", abre em Destaques e explica em que tela da loja cada tipo aparece;
  - o upload em lote checa 1024 × 636 nos destaques e sugere o vínculo pelo nome do arquivo, nas três linhas (`receita-frango-pt.png` → BR `turkey`, `recipe-beef.png` → US `beef`, `filhote-frango-porco.png` → BR `puppy-chicken-pork`, `senior-chicken.png` → US `senior-chicken`);
  - cada imagem da biblioteca ganha "Editar vínculo", para desvincular a receita errada e vincular a certa sem apagar nada;
  - a seção de banner da receita ganha "Escolher da biblioteca" e "Enviar nova", e "Remover imagem" vira "Desvincular imagem".
- **Loja: sem mudança.** Continua usando `imageUrl`, senão a imagem que vem junto com o front.
- **Rotas: nenhuma nova nem removida.** `GET/POST /admin/media` e `PUT/DELETE .../image` já existem.

Fora desta entrega:
- outras imagens (avatar, foto de pet, feedback);
- exclusão definitiva.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `plan-image-library`: a biblioteca passa a ter dois tipos, `plan` (400 × 400) e `banner` (1024 × 636). O `usedBy`, o bloqueio de arquivar e a regra de nunca apagar valem para os dois.
- `recipe-content`:
  - o banner vira um vínculo a uma imagem da biblioteca;
  - trocar o banner não apaga mais o arquivo anterior;
  - remover o banner só desvincula;
  - excluir a receita não apaga o banner;
  - os banners existentes viram imagens da biblioteca.

## Impact

- **API (`eden-bowls-backend`):**
  - migration `recipe_contents.image_asset_id`, com FK e backfill;
  - `src/core/recipe-content.js` (`MEDIA_ASSET_KINDS`);
  - `MediaLibraryService` (tamanho pelo `kind`) e `MediaAssetRepository` (`usedBy` pela coluna do `kind`);
  - `RecipeContentService` (`uploadImage`, `removeImage`, `remove`, fim de `deleteFile`), `RecipeContentRepository` (`setImage` no lugar de `upsertImage`/`clearImage`);
  - `LocalRecipeImageStorage` perde o `delete`;
  - `docs/production-go-live.md`.
- **Painel (`eden-bowls-admin`):** `MediaLibraryPage.tsx`, `lib/mediaLibrary.ts`, `RecipeContentPage.tsx` (seção do banner), mocks e fixtures.
- **Loja (`eden-bowls`):** nenhuma mudança de código.
- **Contrato:** `docs/api-routes.json` não deve mudar. Confirmar com `npm run routes:manifest`.
- **Produção:** primeiro upload dos 16 PNGs pela Biblioteca, com `pt/` → BR e `en/` → US (4 adultos, 2 filhotes e 2 sêniores por mercado). Os 4 adultos de `en/adult/` são idênticos às imagens embutidas na loja, então em US a loja não muda visualmente, mas o banner passa a ser cadastrado e protegido. Um banner só aparece na loja quando a receita tem variação ativa naquele mercado.
