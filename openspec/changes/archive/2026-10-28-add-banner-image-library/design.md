# Design

## Context

Motivação em `proposal.md`. Estado atual do código:

- `RecipeContentService.uploadImage` valida com `processRecipeImage` (`kind` padrão `banner`, 1024 × 636), grava com `LocalRecipeImageStorage.write` (nome `recipe-<market>-<slug>-<32 hex>.webp`), faz `upsertImage` e apaga o arquivo anterior. `removeImage` e `remove` também chamam `deleteFile`. São os únicos chamadores de `imageStorage.delete`.
- A biblioteca (`media_assets`, `MediaLibraryService`, `MediaAssetRepository`) já existe para `plan`. `writeAsset` e `MEDIA_ASSET_FILENAME_PATTERN` (`^(plan|banner)-(br|us)-[a-f0-9]{32}\.webp$`) já aceitam `banner`. `MEDIA_ASSET_KINDS` é `['plan']`.
- `MediaLibraryService.upload` já repassa `kind` para `processRecipeImage`, então o tamanho já segue o `kind`.
- `MediaAssetRepository.usedByIds` consulta só `plan_image_asset_id`.
- `RecipeContentRepository.setPlanImage` trava a linha do asset (`FOR UPDATE`) e grava URL e id juntos. `MediaAssetRepository.archive` trava o mesmo asset. Isso fecha a corrida entre arquivar e vincular.
- A loja (`recipePresentation.ts`) usa `stored.imageUrl || recipe.fallbackImage`. A checagem de ativação `final_image` lê `image_url`.
- No painel, `MediaLibraryPage` já tem `MediaKind` e `mediaListPath(..., { kind })`, mas só usa `plan`. `suggestPlanLink` já resolve os nomes de Filhote e Sênior (`senior-carne` → BR `senior-beef`), porque o sufixo `_400` é opcional. Os adultos não: `recipe-beef.png` e `receita-carne-pt.png` não trazem palavra de linha e trazem palavras que a sugestão não conhece (`recipe`, `receita`, `pt`), então ficam sem sugestão. A seção de banner fica em `RecipeContentPage.tsx` (botão "Remover imagem").

## Goals / Non-Goals

**Goals:**
- O banner usa a mesma tabela, o mesmo serviço e as mesmas rotas da miniatura, mudando só o `kind`.
- Depois desta change, a API não tem nenhum caminho que apague um arquivo de `RECIPE_IMAGE_DIR`.
- A leitura pública e a checagem de ativação não mudam.

**Non-Goals:**
- Unificar `PUT .../image` e `PUT .../plan-image` numa rota com `kind`. As duas continuam, cada uma com seu tipo.
- Redimensionar ou recortar no navegador.
- Mudar a regra de 409 ao remover o banner de receita com variação ativa.

## Decisions

### 1. `image_asset_id` ao lado de `image_url`, como na miniatura

Migration `1700000000059-link-recipe-banner-image-asset`:
- adiciona `recipe_contents.image_asset_id` (int unsigned, nulo) com FK `fk_recipe_contents_image_asset_id` → `media_assets.id`, `ON DELETE RESTRICT`;
- para cada linha com `image_url` e sem `image_asset_id`, insere um asset `banner` do mercado com a mesma URL, `original_filename` igual ao basename e `mime_type` `image/webp`, e grava o id. Uma linha por vez, como na 058, sem depender de collation;
- pode rodar de novo sem duplicar;
- o `down` remove a FK e a coluna, e os assets do backfill ficam (como na 058). `image_url` continua preenchida, então o código anterior volta a funcionar.

`image_url` continua sendo gravada junto com o id. Assim `listByMarket`, `findByMarketAndSlug`, a rota pública e a ativação ficam como estão.

*Alternativa:* uma tabela de vínculos `recipe_media(recipe_id, slot, asset_id)`. É mais genérica, mas mexe em toda leitura e em duas migrations por nada que esta entrega precise.

### 2. `RecipeContentRepository.setImage` substitui `upsertImage` e `clearImage`

Segue o mesmo padrão de `setPlanImage`, com `SELECT ... FOR UPDATE` no asset, 404 se ele não existe e 409 `media_asset_archived` se está arquivado. Grava `image_url`, `image_asset_id` e `image_updated_at` juntos, e com `assetId` nulo desvincula. O `upsert` do insert continua, porque toda receita registrada já tem linha em `recipe_contents` desde o registro. Com isso `upsertImage` e `clearImage` deixam de existir.

### 3. `uploadImage` com duas formas de corpo, como `uploadPlanImage`

- `{ assetId }`: usa `mediaLibraryService.get` (escopo de mercado e 404) e confere `kind === 'banner'` e o mercado da receita (422 `media_asset_invalid`).
- `{ imageBase64, mimeType, originalFilename? }`: chama `mediaLibraryService.upload({ kind: 'banner', ... })`, com `originalFilename` padrão `<key>-banner`.
- Os dois juntos, ou nenhum: 422 `media_asset_invalid`.

O painel antigo manda só `{ imageBase64, mimeType }`, então continua funcionando. A auditoria `catalog.recipe.image.update` passa a levar `assetId`.

Para não duplicar código, a lógica que é igual nos dois casos (escolher o asset, validar `kind` e mercado) vira um helper privado `resolveLinkedAsset(recipe, kind, payload, actor)`, usado por `uploadImage` e `uploadPlanImage`.

### 4. Remover `deleteFile` e `LocalRecipeImageStorage.delete`

Os arquivos de banner antigos (`recipe-<market>-<slug>-<hex>.webp`) viram assets pelo backfill e ainda casam com `RECIPE_IMAGE_FILENAME_PATTERN`, o único padrão que `delete` aceita. Por isso tirar só as chamadas deixaria uma armadilha. A regra fica garantida pelo código: sem método de exclusão, nenhuma refatoração futura apaga um asset por engano.

- `removeImage` mantém o 409 `recipe_content_in_use` e passa a chamar `setImage(null)`.
- `remove` não apaga mais nenhum arquivo.
- `write` (o nome antigo, com slug) deixa de ter chamadores e também sai. `writeAsset` é o único jeito de escrever. `RECIPE_IMAGE_FILENAME_PATTERN` sai junto.
- Os arquivos antigos continuam sendo servidos pela rota estática `/recipe-images`, que não depende do padrão.

*Alternativa:* manter `delete` para a foto de pet. Não se aplica, porque a foto de pet usa outro storage (`petPhotoStorage`).

### 5. `usedBy` pela coluna do `kind`

`usedByIds(ids, runner)` passa a receber o `kind` (`plan` → `plan_image_asset_id`, `banner` → `image_asset_id`) a partir de um mapa fixo no repositório, nunca da entrada do usuário. Como `list`, `findById`, `findByHash` e `archive` sempre conhecem o `kind` da linha, a consulta é por linha ou por grupo de `kind`. O `archive` continua transacional.

### 6. `MEDIA_ASSET_KINDS = ['plan', 'banner']`

É o único ajuste no serviço da biblioteca: o `kind` já vai para `processRecipeImage`. Um `kind` desconhecido continua dando 422 `media_asset_invalid`. O exemplo `banner` do spec antigo vira `avatar`.

### 7. Painel

- `MediaKind = 'plan' | 'banner'`.
- `MediaLibraryPage`:
  - alternância "Destaques / Miniaturas", com Destaques primeiro e aberto por padrão, porque é a tela inicial da loja (`?kind=plan` abre as miniaturas);
  - abaixo da alternância, onde a loja usa o tipo escolhido: destaques no carrossel "Nossas receitas para cães" da tela inicial e no topo da página da receita (1024 × 636); miniaturas no card de sabor da tela Plano (400 × 400), que usa o destaque quando não há miniatura;
  - textos e títulos por tipo ("Destaques da tela inicial", 1024 × 636);
  - o lote usa `checkRecipeImage` nos destaques e `checkRecipePlanImage` nas miniaturas;
  - a confirmação manda `POST /media { kind }` e depois `PUT .../image { assetId }` ou `PUT .../plan-image { assetId }`, conforme o tipo;
  - "substitui o destaque atual (o atual continua na biblioteca)".
- `suggestPlanLink` passa a se chamar `suggestRecipeLink`, com duas extensões para os nomes da pasta de destaques:
  - `receita` (BR) e `recipe` (US) contam como palavra da linha adulta, com mercado;
  - um sufixo de idioma `pt` (BR) ou `en` (US) é retirado do fim e entra no voto do mercado.

  Assim `receita-frango-pt.png` → BR `turkey`, `receita-carne-pt.png` → BR `beef`, `recipe-chicken.png` → US `turkey` e `recipe-fish.png` → US `fish`. Os nomes das miniaturas (`adulto-carne_400.png`) continuam resolvendo como hoje. O teste cobre os 16 nomes da pasta de destaques e os 16 das miniaturas.

  A sugestão também devolve a **linha** que o nome indica (`filhote-…` → Filhote), mesmo quando não acha a receita.
- Na confirmação do lote (miniaturas e destaques), o seletor de receita agrupa as receitas por linha (Adulto, Filhote, Sênior). Abaixo dele aparece "Linha Filhote · Filhote Frango e Porco (BR)". Se a linha do nome do arquivo for diferente da linha da receita escolhida, aparece o aviso "O nome do arquivo indica a linha Filhote, mas a receita escolhida é da linha Sênior.". O aviso não bloqueia o envio, porque um nome de arquivo pode estar errado e quem decide é o operador.

  *Alternativa:* deduzir mercado e linha pela pasta (`pt/adulto/`). Foi descartada pelo mesmo motivo da miniatura: arquivos soltos arrastados não trazem a pasta, e o nome resolve todos os casos.
- Layout da Biblioteca:
  - no cabeçalho da página fica só o mercado (Brasil / Estados Unidos), porque ele vale para a página inteira;
  - o tipo (Destaques / Miniaturas) vira abas da página (`role="tablist"`, setas do teclado);
  - o envio ("Enviar destaques" / "Enviar miniaturas") vira a ação do título da lista do tipo, ao lado de "Destaques da tela inicial", e não do título da página;
  - acima da grade, a contagem ("4 imagens em Brasil") e o filtro "Na biblioteca / Arquivadas";
  - cada card tem "Editar vínculo" (ou "Vincular a uma receita", quando sem uso) e, sem uso, "Arquivar".
- Editar o vínculo pela Biblioteca (`MediaLinkDialog`). Um vínculo errado se corrige sem sair da tela:
  - o diálogo mostra a prévia, as receitas que usam a imagem (com linha e mercado) e um "Desvincular" por receita, com confirmação;
  - "Vincular a outra receita" lista as receitas do mercado da imagem, agrupadas por linha, sem as já vinculadas, e avisa se a receita escolhida já tem imagem, que será substituída e continua na biblioteca;
  - usa as rotas que já existem (`PUT`/`DELETE .../image` ou `.../plan-image`). O 409 de variação ativa aparece no diálogo;
  - nada é apagado: desvincular só tira o vínculo.
- Seção de banner em `RecipeContentPage.tsx`:
  - "Escolher da biblioteca" (os banners não arquivados do mercado) e "Enviar nova";
  - "Remover imagem" vira "Desvincular imagem", com a confirmação "Desvincular a imagem? Ela sai do destaque da tela inicial e continua na Biblioteca de imagens.";
  - o bloqueio de variação ativa continua sendo mostrado como hoje.

## Risks / Trade-offs

- [Banners se acumulam no volume] → Cada um tem cerca de 80 a 150 KB em WebP. São dezenas por ano. O backup do volume já está documentado. Esta change só acrescenta que os banners também nunca são apagados.
- [O backfill não conhece tamanho e hash dos banners antigos] → As colunas aceitam nulo, e um reenvio do mesmo arquivo cria uma cópia. É aceitável: os uploads novos são os PNGs da designer.
- [Tirar `write`/`delete` do storage quebra testes antigos] → Os testes de `local-recipe-image-storage` e `recipe-content.service` mudam na mesma tarefa.
- [Banner novo de uma receita não lançada não aparece] → É a regra atual da rota pública. Na verificação, conferir o lançamento antes de concluir que o upload falhou.

## Migration Plan

1. Deploy da API com a migration 059. O backfill roda no boot, como as outras.
2. Deploy do painel. O painel antigo continua funcionando, porque o upload direto em `PUT .../image` segue aceito.
3. `npm run routes:manifest` não deve mudar `docs/api-routes.json`. Se mudar, commitar e rodar `npm run contract:sync` no painel.
4. Operação: subir os 16 PNGs como Destaques (`pt/{adulto,filhote,senior}` → BR, `en/{adult,puppy,senior}` → US), confirmar a lista sugerida e conferir o carrossel em .com.br e .com. Se um adulto já tem banner cadastrado com os mesmos bytes, o upload devolve `duplicate: true`. Se tem banner com bytes diferentes, o vínculo novo substitui o atual, e o atual continua na biblioteca.
5. Rollback: reverter a API. O `down` da 059 tira a coluna. `image_url` continua igual, então a loja não muda. O código antigo volta a apagar o banner na troca, mas os arquivos da biblioteca (`banner-…`) não casam com o padrão antigo de `delete`.
