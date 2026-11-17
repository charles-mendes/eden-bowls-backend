# Design

## Context

Hoje a miniatura do plano é uma URL solta em `recipe_contents.plan_image_url`. Fluxo atual:

- `RecipeContentService.uploadPlanImage` valida a imagem (`processRecipeImage`, `kind: 'plan'`, 200 ou 400), grava o arquivo com `LocalRecipeImageStorage.write` (nome `recipe-<market>-<slug>-plan-<hex>.webp`) e apaga o arquivo anterior.
- `removePlanImage` e `remove` também chamam `deleteFile`.
- As imagens chegam como JSON base64. O limite de 8 MB fica em `app.js`, numa regex só para `PUT .../(plan-)?image`.
- As tabelas são acessadas com SQL cru via `dataSource.query`.
- As migrations usam `queryRunner` com `hasTable`/`hasColumn`, para poderem rodar de novo sem erro.
- O painel já valida dimensões no navegador (`checkRecipePlanImage`) e converte para base64 (`fileToImagePayload`).

As chaves de receita não seguem o nome dos arquivos da designer. O frango adulto é `turkey`, e as demais são `beef`, `fish`, `pork`, `puppy-beef-chicken`, `puppy-chicken-pork`, `senior-beef` e `senior-chicken`.

## Goals / Non-Goals

**Goals:**
- A biblioteca é um modelo à parte (`media_assets`) que o banner pode usar depois, mudando só o `kind` aceito.
- O vínculo receita → imagem é por id. A loja continua lendo a URL, sem join no caminho público.
- O upload em lote dos 16 arquivos tem que ser à prova de troca de mercado.

**Non-Goals:**
- Paginação: a biblioteca vai ter dezenas de imagens, não milhares.
- Busca por texto.
- Tags.
- Recorte ou redimensionamento no navegador.

## Decisions

### 1. Tabela `media_assets`, com `plan_image_asset_id` e `plan_image_url` em `recipe_contents`

Colunas da tabela:

| Coluna | Tipo |
|---|---|
| `id` | int auto-increment |
| `kind` | varchar(16) |
| `market` | char(2) |
| `url` | varchar(512) |
| `original_filename` | varchar(255) |
| `mime_type` | varchar(32) |
| `width` | int, nulo |
| `height` | int, nulo |
| `bytes` | int, nulo |
| `sha256` | char(64), nulo |
| `uploaded_by` | nulo |
| `created_at` | datetime |
| `archived_at` | datetime, nulo |

- Índice único em `(market, kind, sha256)`. O MySQL aceita vários `NULL` nesse índice, então as linhas do backfill (sem hash) não colidem entre si.
- O `sha256` é calculado sobre os bytes **originais** enviados. Assim, o mesmo PNG da designer é reconhecido mesmo que o WebP gerado varie entre versões do Sharp.

Em `recipe_contents` entra `plan_image_asset_id` (int, nulo, FK para `media_assets.id` com `ON DELETE RESTRICT`). `plan_image_url` continua existindo e é gravada junto com o id. A URL de um asset nunca muda, então as duas colunas não divergem. Com isso, `listByMarket`/`findByMarketAndSlug`, a rota pública e `planRecipeCard.ts` ficam como estão.

*Alternativa:* tirar `plan_image_url` e sempre fazer join. É mais normalizado, mas mexe em toda leitura pública para nada mudar no comportamento.

### 2. Nenhum caminho de código apaga um arquivo de asset

- `MediaLibraryService` não tem método de exclusão e o repositório não tem `DELETE`.
- Em `RecipeContentService`, `uploadPlanImage`, `removePlanImage` e `remove` deixam de chamar `deleteFile` para a miniatura. `remove` continua apagando o **banner**, porque o banner ainda não está na biblioteca.
- A FK `RESTRICT` protege o vínculo no banco caso alguém tente apagar um asset por SQL.
- Arquivar só grava `archived_at`. O arquivo continua sendo servido, porque um link antigo (e-mail, cache) não deve quebrar.

### 3. Escrita do arquivo sem slug, no mesmo storage

`LocalRecipeImageStorage` ganha `writeAsset({ market, kind, buffer })`, que grava `<kind>-<market>-<32 hex>.webp` em `RECIPE_IMAGE_DIR`. Para isso:

- o nome segue `^(plan|banner)-(br|us)-[a-f0-9]{32}\.webp$`;
- `delete` continua aceitando só o padrão do banner (`recipe-…`), então um nome da biblioteca nunca é apagado, nem por engano.

Não há volume, rota estática nem variável de ambiente novos.

### 4. Upload por arquivo, lote só no painel

`POST /api/v1/admin/media` recebe **uma** imagem: `{ kind, market, originalFilename, mimeType, imageBase64 }`.

- Responde 201 quando cria e 200 com `duplicate: true` quando reaproveita.
- O lote é sequencial no painel: um request por arquivo, com resultado por linha.
- O limite de 8 MB do `app.js` passa a cobrir `POST /api/v1/admin/media`.

*Alternativa:* um request multipart com 16 arquivos. Precisaria de multer (dependência nova), estouraria o limite de corpo e transformaria uma falha parcial num erro do lote inteiro. Por arquivo, uma imagem recusada não impede as outras.

O vínculo é uma segunda chamada, `PUT .../plan-image { assetId }`, para cada linha confirmada. Assim, o upload em lote e o vínculo pela página da receita usam o mesmo caminho.

### 5. `PUT .../plan-image` com duas formas de corpo

- Com `assetId`: valida que o asset existe (404), é do mercado da receita e do kind `plan` (422 `media_asset_invalid`) e não está arquivado (409 `media_asset_archived`).
- Com `imageBase64`: chama `MediaLibraryService.upload` (mesma validação e deduplicação) e vincula.
- Os dois juntos, ou nenhum: 422 `media_asset_invalid`.

O `kind` desconhecido em `POST /media` também responde 422 `media_asset_invalid`.

### 6. 400 × 400 é o único tamanho aceito

`RECIPE_PLAN_IMAGE_SIZES` vira `[400]`, no backend e em `imageUpload.ts` no painel. A mensagem de erro já é montada a partir da lista (`sizeText`). Assets antigos de 200 continuam válidos, porque o tamanho só é conferido no upload.

### 7. `usedBy` calculado na leitura

`GET /media` faz um `LEFT JOIN recipe_contents ON plan_image_asset_id = media_assets.id`, filtrando pelo mercado, e devolve `usedBy: [{ key, name, market }]`. O arquivar faz a mesma consulta dentro de uma transação, junto com o `UPDATE ... SET archived_at`. O vínculo de um asset arquivado é recusado no `PUT`. Isso fecha a corrida em que alguém arquiva e outra pessoa vincula ao mesmo tempo.

### 8. Sugestão de vínculo pelo nome do arquivo, só no painel

Em `lib/mediaLibrary.ts`, `suggestPlanLink(fileName)` funciona assim:

1. Tira `_400`/`_200` e a extensão do nome.
2. Separa o resto em palavras.
3. Define o **mercado** pelo idioma das palavras:
   - `adulto`, `filhote`, `carne`, `frango`, `peixe` e `porco` → BR;
   - `adult`, `puppy`, `beef`, `chicken`, `fish` e `pork` → US;
   - `senior` aparece nos dois idiomas, então quem decide é o sabor.
4. Traduz para as palavras da chave e monta a chave:
   - linha adulta: só o sabor, com `chicken` → `turkey`;
   - outras linhas: `<linha>-<sabores>`.
5. Só sugere se a chave existir entre as receitas do mercado. Se não existir, a linha fica "sem sugestão" e o operador escolhe.

A tela de confirmação mostra uma linha por arquivo, com:

- a prévia;
- o mercado e a receita, editáveis;
- "substitui a miniatura atual (a atual continua na biblioteca)";
- um bloqueio se duas linhas apontarem para a mesma receita do mesmo mercado;
- um bloqueio se o mercado estiver fora da sessão.

Nada é enviado antes do "Confirmar". Um arquivo pode ficar "Só guardar na biblioteca".

*Alternativa:* deduzir o mercado pela pasta (`webkitdirectory`). Não funciona quando se arrastam arquivos soltos, e o idioma do nome já resolve todos os 16 arquivos.

### 9. Painel: página nova e seção da receita

- Rota `/catalog/media`, com o item "Biblioteca de imagens" no grupo Loja de `menu.ts` e os mesmos papéis de "Receitas".
- A grade mostra:
  - um seletor de mercado (os da sessão);
  - uma alternância "Arquivadas";
  - em cada card: prévia, nome original, data, "Em uso por Adulto Carne (BR)" ou o botão "Arquivar" (o botão some quando a imagem está em uso), e "Restaurar" nas arquivadas.
- `RecipePlanImageSection` ganha:
  - "Escolher da biblioteca", um seletor com as imagens não arquivadas do mercado;
  - "Enviar nova";
  - "Desvincular miniatura" no lugar de "Remover miniatura", com a confirmação "A imagem sai do card do plano e continua na Biblioteca de imagens.".
- O botão "Arquivar" não aparece na receita.

## Risks / Trade-offs

- [Arquivos se acumulam no volume, sem exclusão] → Cada imagem tem cerca de 30 a 80 KB em WebP, então centenas delas cabem em poucos MB. A exclusão definitiva fica para quando houver necessidade real.
- [O volume `recipe-images` hoje não tem backup] → Uma tarefa documenta o backup do volume em `docs/production-go-live.md`. A configuração em produção é passo de operação, fora do código.
- [O backfill não conhece `width`/`height`/`sha256` dos arquivos antigos] → As colunas aceitam nulo. A deduplicação não reconhece esses assets e um reenvio cria uma cópia. É aceitável, porque o primeiro lote real usa os arquivos novos da designer.
- [Um nome de arquivo engana a sugestão] → A sugestão nunca grava sozinha. O operador vê mercado e receita lado a lado antes de confirmar.
- [Painel e API precisam ir juntos (BREAKING do 200 px)] → Fazer o deploy da API primeiro. O painel antigo continua funcionando com uploads de 400. O de 200 passa a receber um 422 legível.

## Migration Plan

1. Migration `1700000000057-create-media-assets`: cria `media_assets`.
2. Migration `1700000000058-link-recipe-plan-image-asset`:
   - adiciona `recipe_contents.plan_image_asset_id` com a FK;
   - para cada linha com `plan_image_url` e sem asset, insere um asset `plan` do mercado da linha com a mesma URL, `original_filename` igual ao basename e `mime_type` `image/webp`, e grava o id;
   - pode rodar de novo sem duplicar.
3. Rollback: o `down` remove a FK e a coluna e depois a tabela. `plan_image_url` continua preenchida, então o código anterior volta a funcionar sem perder a miniatura.
4. Deploy da API, depois do painel. `npm run routes:manifest` na API e `npm run contract:sync` no painel.
5. Operação: subir os 16 `_400` pela Biblioteca de imagens (`pt/` → BR, `en/` → US), confirmar a lista sugerida e conferir a tela Plano nas duas lojas.
