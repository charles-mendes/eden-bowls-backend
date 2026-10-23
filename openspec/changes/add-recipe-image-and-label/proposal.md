# Proposal

## Why

A imagem do banner e os dados de rótulo de cada receita moram no código da loja (`eden-bowls/public/images/recipe-*.png` e `eden-bowls/src/content/{pt-br,en-us}/recipes/<sabor>.md`). A API não sabe se a imagem publicada é a provisória ou a final, nem se o rótulo existe. Por isso a ativação de uma variação depende das confirmações manuais `_final_image_ready` e `_label_data_ready`, que são palavra do operador. Com o conteúdo guardado na API, o painel cadastra, a loja lê e a ativação confere sozinha.

## What Changes

Duas fases, cada uma pode ir para produção sozinha.

**Fase 1: imagem**
- Tabela nova `recipe_contents`, com um registro por (mercado, slug do sabor), compartilhado pelas variações daquele sabor no produto do mercado.
- Rotas admin para ler o conteúdo e enviar ou remover a imagem (`catalog.read` / `catalog.write`, escopo de mercado). A imagem precisa ser PNG, JPEG ou WebP de exatamente 1024 × 636 e ter no máximo 5 MB. A API recusa o resto com 422 `recipe_image_invalid` e guarda a imagem aceita como WebP.
- A remoção da imagem é recusada com 409 `recipe_content_in_use` enquanto houver variação ativa do sabor no mercado.
- A checagem `final_image` da ativação aceita a imagem cadastrada **ou** a confirmação manual atual.
- O detalhe do produto passa a informar, para cada variação, a imagem e o estado do rótulo do sabor.
- Rota pública `GET /api/v1/recipes/:key?market=` com o conteúdo cadastrado de uma receita lançada, resolvendo aliases.
- Diretório das imagens configurável (`RECIPE_IMAGE_DIR`), com volume persistente nos dois compose e servido em `/recipe-images`.

**Fase 2: rótulo**
- Rota admin para gravar o rótulo no idioma do mercado (BR em pt-BR, US em en-US). Um rótulo incompleto é aceito como rascunho. Nos EUA, o rótulo só fica completo com pelo menos um aviso, de qualquer texto.
- A checagem `label_data` (só US) aceita o rótulo completo **ou** a confirmação manual. A API recusa a mudança que torna incompleto o rótulo de um sabor US com variação ativa.
- A rota pública passa a devolver o rótulo.

## Capabilities

### New Capabilities

- `recipe-content`: imagem e rótulo de cada receita por mercado e sabor (validação, guarda, travas com variação ativa, permissões, auditoria e rota pública), e como esse conteúdo conta na ativação da variação.

### Modified Capabilities

- `production-readiness`: o diretório das imagens de receita entra na lista de diretórios que sobrevivem à troca do container e são servidos como arquivo estático.

## Impact

- Código: migração `1700000000038-create-recipe-contents.js`, `src/core/recipe-content.js`, repositório, serviço, `src/infrastructure/imaging/recipe-image.js`, `src/infrastructure/storage/local-recipe-image-storage.js`, `src/api/routes/admin.routes.js`, `src/api/routes/recipes.routes.js` (novo), `src/services/admin-catalog.service.js`, `src/app.js`, `src/index.js`, `src/config/env.js`.
- Contrato: rotas novas em `docs/api-routes.json` (`npm run routes:manifest`). O painel sincroniza com `npm run contract:sync`.
- Infra: volumes `eden-bowls-recipe-images` (`docker-compose.backend.yml`) e `eden-bowls-recipe-images-qa` (`docker-compose.qa.yml`), só no serviço `api`. Variáveis `RECIPE_IMAGE_DIR` e `RECIPE_IMAGE_PUBLIC_BASE_URL` nos `.env` de exemplo. `docs/production-go-live.md` atualizado.
- Changes irmãos com o mesmo nome: `eden-bowls-admin` (página "Conteúdo da receita" e coluna na tabela de variações) e `eden-bowls` (consumo da rota pública, com o conteúdo do código como alternativa). Este change é entregue primeiro em cada fase.
- Spec relacionada: as checagens de ativação estão em `life-stage-recipe-catalog` (change aberto `add-life-stage-recipes`, em `eden-bowls/openspec`). O change irmão da loja ajusta aquele texto.
