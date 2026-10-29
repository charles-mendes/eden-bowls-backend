# Proposal

## Why

A miniatura da embalagem no seletor de sabor da tela Plano já é cadastrada no painel por receita e mercado (`PUT/DELETE /api/v1/admin/catalog/recipe-content/:flavorSlug/plan-image`). A loja lê `planImageUrl` sem precisar de deploy. Só que o arquivo não fica guardado: trocar a miniatura, removê-la ou excluir a receita apaga o arquivo do disco (`RecipeContentService.deleteFile`). Essas imagens são o núcleo visual do plano, mudam pouco e foram feitas sob encomenda pela designer (16 PNGs, 8 sabores × PT/EN). Perder uma delas por um clique errado significa pedir a imagem de novo.

## What Changes

- **Biblioteca de imagens.** A miniatura do plano passa a existir sozinha, como um registro de biblioteca (`media_assets`, `kind = 'plan'`, por mercado). A receita só aponta para uma imagem da biblioteca.
- **Trocar ou desvincular não apaga o arquivo.** Trocar a miniatura de uma receita, desvinculá-la (o `DELETE .../plan-image` de hoje) ou excluir a receita só tira o vínculo. O arquivo e o registro continuam na biblioteca.
- **Arquivar em vez de excluir.** Na biblioteca, "Arquivar" esconde a imagem da lista padrão e "Restaurar" traz de volta. Uma imagem em uso não pode ser arquivada: a API responde 409 dizendo quem usa (por exemplo "Adulto Carne (BR)"). Nesta entrega não existe exclusão definitiva.
- **Rotas novas em `/api/v1/admin/media`:** listar, enviar, arquivar e restaurar.
- **`PUT .../plan-image` aceita `{ assetId }`**, para vincular uma imagem que já está na biblioteca. O upload direto continua funcionando: cria o asset e já vincula.
- **BREAKING (painel):** a miniatura do plano passa a aceitar só 400 × 400 px. 200 × 200 é recusado com 422 `recipe_image_invalid`. Continua sendo convertida para WebP, sem gerar uma versão de 200 e sem `srcset`. As miniaturas de 200 já gravadas continuam servindo.
- **Nome de arquivo sem slug da receita.** Fica `plan-<market>-<32 hex>.webp`: um nome novo a cada upload, no mesmo `RECIPE_IMAGE_DIR` e servido em `/recipe-images`.
- **Backfill.** Toda `recipe_contents.plan_image_url` que já existe vira um asset vinculado, mantendo a mesma URL.
- **Painel:**
  - Página "Biblioteca de imagens", só com miniaturas quadradas, com:
    - filtro por mercado e por arquivadas;
    - "Em uso por …" em cada imagem;
    - "Arquivar" e "Restaurar";
    - upload em lote que sugere o vínculo pelo nome do arquivo (`adulto-carne_400.png` → Adulto Carne, BR; `adult-chicken_400.png` → `turkey`, US) e mostra a lista para confirmar antes de gravar.
  - Na página da receita:
    - "Escolher da biblioteca" e "Enviar nova";
    - "Remover miniatura" vira "Desvincular miniatura", com o texto de que a imagem continua na biblioteca.
- **Loja: sem mudança de contrato.** Continua usando `planImageUrl`, senão o banner, senão a imagem fixa do front.
- **Operação:** documentar o backup do volume de `RECIPE_IMAGE_DIR` em `docs/production-go-live.md`.

Fora desta entrega:
- banner da home na biblioteca (a tabela já tem `kind` para isso);
- avatar, foto de pet e foto de feedback;
- R2/S3;
- exclusão definitiva.

## Capabilities

### New Capabilities
- `plan-image-library`: biblioteca de imagens do painel. Cobre upload por mercado, deduplicação, listagem com uso, arquivar e restaurar sem exclusão, e a regra de que o arquivo de uma imagem da biblioteca nunca é apagado pela API.

### Modified Capabilities
- `recipe-content`:
  - a miniatura do plano entra no spec: 400 × 400, vínculo a um asset da biblioteca, desvincular sem apagar e o fallback da loja;
  - excluir uma receita sem variações deixa de apagar a miniatura do plano. O banner continua sendo apagado como hoje.

## Impact

- **API (`eden-bowls-backend`):**
  - migrations: tabela `media_assets`, coluna `recipe_contents.plan_image_asset_id` e backfill;
  - `MediaAssetRepository` e `MediaLibraryService` novos;
  - `RecipeContentService` (`uploadPlanImage`, `removePlanImage`, `remove`), `LocalRecipeImageStorage` (escrita sem slug), `recipe-content.js` (`RECIPE_PLAN_IMAGE_SIZES`);
  - `admin.routes.js`, mais o limite de corpo JSON de 8 MB em `POST /api/v1/admin/media` (`app.js`);
  - `docs/api-routes.json` (`npm run routes:manifest`).
- **Painel (`eden-bowls-admin`):**
  - página nova `/catalog/media` e item "Biblioteca de imagens" no menu, no grupo Loja;
  - `RecipePlanImageSection.tsx` e `imageUpload.ts` (só 400);
  - `lib/mediaLibrary.ts` novo;
  - mocks e fixtures de teste;
  - `contracts/backend-routes.json` (`npm run contract:sync`).
- **Loja (`eden-bowls`):** nenhuma mudança de código.
- **Produção:**
  - nenhum volume novo (é o mesmo `recipe-images`);
  - backup do volume a configurar;
  - primeiro upload: os 16 arquivos `_400` de `docs-new/FEATURE_ADICIONAR_FOTOS_RECEITAS_DESIGNER/.../{pt,en}`, com `pt/` → BR e `en/` → US. Esses arquivos não entram de novo no git.
