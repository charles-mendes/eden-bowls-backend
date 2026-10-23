# Design

## Context

Motivação em `proposal.md`. Estado atual que molda a solução:

- Cada mercado tem um produto ("Flavors BR", "Flavors US") com variações por sabor e tamanho. O sabor é o meta `_flavor_slug`, e `FLAVOR_KEY_ALIASES` (`src/core/flavors.js`) resolve aliases (`chicken` → `turkey`).
- A ativação (`admin-catalog.service.js`, perto da linha 630) checa `price`, `stripe_price`, `final_image` (`_final_image_ready`) e, só nos EUA, `label_data` (`_label_data_ready`).
- O upload de imagem de feedback já é feito em JSON com `{ mimeType, imageBase64 }`, usa `sharp` (`src/infrastructure/imaging/feedback-photo.js`) e `LocalFeedbackPhotoStorage`. O diretório vem de `FEEDBACK_PHOTO_DIR` (`src/config/env.js`), o arquivo é servido por `express.static` em `src/app.js` e o volume nomeado está nos dois compose.
- A loja escolhe o idioma pelo domínio (`com.br` → pt-BR, senão en-US), então mercado e idioma do rótulo andam juntos.

## Goals / Non-Goals

**Goals:**
- Um dono por (mercado, sabor), lido igual pelo admin, pela ativação e pela rota pública.
- A API como fonte de verdade do tamanho da imagem e da completude do rótulo.
- Transição sem quebra: sabores sem cadastro funcionam como hoje.

**Non-Goals:**
- Armazenamento externo (S3, CDN) e redimensionamento ou recorte automático.
- Título, tagline, descrição, destaques e cores da receita.
- Remover `_final_image_ready` e `_label_data_ready`. Isso fica para depois que todos os sabores tiverem cadastro.

## Decisions

### 1. Chave: (mercado, slug do sabor), não a variação

O conteúdo é da receita, não do tamanho. Gravar por variação obrigaria a enviar a mesma imagem para 300 g e 500 g e deixaria as duas divergirem. Gravar só por sabor juntaria embalagem e idioma de BR e de US e furaria o escopo de mercado da sessão.

### 2. Tabela própria `recipe_contents`

Migração `1700000000038-create-recipe-contents.js`, com as colunas `id`, `market` (`BR`/`US`), `flavor_slug`, `image_url`, `image_updated_at`, `label` (JSON), `label_updated_at`, `updated_by`, `created_at`, `updated_at` e índice único em `(market, flavor_slug)`. Postmeta de variação não serve, porque o conteúdo não pertence a uma variação. Postmeta de produto misturaria vários sabores num registro.

### 3. Upload em JSON base64, no padrão do feedback

O formato é `PUT .../image` com `{ mimeType, imageBase64 }`, e `express.json({ limit: '8mb' })` vale só nessa rota (5 MB viram cerca de 6,7 MB em base64). Não entra dependência nova (`multer`).

### 4. Tamanho exato, saída em WebP

`sharp().metadata()` lê o tamanho, que precisa ser 1024 × 636. Não há redimensionamento: recortar a foto do pacote sem ninguém ver é pior do que recusar com mensagem clara. A imagem aceita é regravada como WebP (qualidade 85, mesmo tamanho, alpha preservado).

### 5. Armazenamento e volume

`LocalRecipeImageStorage` grava em `RECIPE_IMAGE_DIR` (padrão `./public/recipe-images`, como `FEEDBACK_PHOTO_DIR`), servido em `/recipe-images`. A URL base vem de `RECIPE_IMAGE_PUBLIC_BASE_URL`, com padrão `${JWT_AUTH_ISSUER}/recipe-images`. O nome é `recipe-<market>-<slug>-<uuid>.webp`: o UUID impede que o navegador ou um CDN sirva a imagem antiga depois da troca. O arquivo anterior é apagado depois que a linha nova é gravada. O volume nomeado `eden-bowls-recipe-images` (e `-qa`) é montado em `/app/public/recipe-images` só no serviço `api`, porque o `cron` não lê nem serve essas imagens.

### 6. Rotas

| Método | Caminho | Permissão |
| --- | --- | --- |
| GET | `/api/v1/admin/catalog/recipe-content/:flavorSlug?market=` | `catalog.read`, `market: 'query'` |
| PUT | `/api/v1/admin/catalog/recipe-content/:flavorSlug/image?market=` | `catalog.write`, `market: 'query'` |
| DELETE | `/api/v1/admin/catalog/recipe-content/:flavorSlug/image?market=` | `catalog.write`, `market: 'query'` |
| PUT | `/api/v1/admin/catalog/recipe-content/:flavorSlug/label?market=` | `catalog.write`, `market: 'query'` (fase 2) |
| GET | `/api/v1/recipes/:key?market=` | pública, com o `limiter` de `/api/v1/products` |

O GET admin devolve `{ market, flavorSlug, imageUrl, label, labelStatus, labelMissing, variations: [{ id, name, sku, active }] }`. O detalhe do produto ganha `recipeImageUrl` e `recipeLabelStatus` em cada variação, com uma consulta por produto. A rota pública devolve `{ key, market, imageUrl, label }`.

### 7. Completude do rótulo numa função pura

`labelCompleteness(label, market)` em `src/core/recipe-content.js` é a única regra. Ela é usada na resposta admin, na ativação e na trava de US ativo. Nos EUA, ela exige "pelo menos um aviso" e não confere o texto: as receitas de filhote ou sênior podem ter outra declaração AAFCO (por exemplo, formulação para crescimento), e um texto fixo travaria isso. Os rótulos atuais dos EUA têm dois avisos. O painel só exibe `labelStatus` e `labelMissing`.

### 8. Ativação: cadastro **ou** confirmação manual

`final_image` passa com `image_url` para (mercado, slug) **ou** com `_final_image_ready = yes`. `label_data` (US) passa com o rótulo completo **ou** com `_label_data_ready = yes`. O código de erro e o `details.missing` não mudam, então o painel e os testes atuais seguem valendo. Exigir só o cadastro travaria os sabores lançados em 23/10 pelo fluxo do `.png`.

## Risks / Trade-offs

- [Várias instâncias do backend, cada uma com seu disco] → Igual ao das outras fotos. A troca para armazenamento externo é outro change.
- [A confirmação manual continua burlável] → Aceito durante a transição. O painel mostra o estado do conteúdo de cada variação.
- [Imagem com o tamanho certo e o enquadramento errado] → A API valida só o tamanho. A prévia no painel, no formato do banner, é a defesa.

## Migration Plan

1. Fase 1: migração, imagem, rota pública com `label: null`, `final_image` com "ou", diretório e volume. Sem efeito visível até existir cadastro.
2. Fase 2: rótulo, `label` na rota pública e `label_data` com "ou".
3. Em cada fase, este change sai antes da loja e do painel. O painel roda `contract:sync` depois do `routes:manifest` daqui.
4. Rollback: reverter a imagem do backend. A tabela fica sem leitura, a loja cai no conteúdo do código e a ativação volta às confirmações manuais. O volume novo pode ficar montado sem efeito.
