# Products Flavors Business Rules (WordPress Atual)

## 1. Regras de negocio identificadas

### 1.1 Filtros aplicados
1. category_slug e sanitizado (slug normalizado).
2. country e normalizado para maiusculo e validado contra mapa permitido.
3. currency e normalizada para maiusculo.
4. Compatibilidade country x currency obrigatoria.
5. Busca de produtos apenas publicados e da taxonomia product_cat igual ao category_slug.
6. Filtro por metadado de produto de pais (meta _cmpb_plan_country).
7. Filtro por variacoes com preco valido na moeda solicitada.
8. Para flavors: filtro adicional de vinculo Stripe estrito por variacao/item.

### 1.2 Regras relacionadas a categoria
- category_slug vazio gera erro 422.
- category_slug inexistente em product_cat gera 404.
- category_slug=flavors ativa regra extra de elegibilidade Stripe.

### 1.3 Regras relacionadas a pais (country)
- Apenas BR e US sao aceitos.
- Produto entra no resultado somente se meta _cmpb_plan_country do produto for igual ao country solicitado.
- country invalido gera 422.

### 1.4 Regras relacionadas a moeda (currency)
- currency deve ser compativel com country.
- Mapeamento observado:
  - BR -> BRL
  - US -> USD
- Se currency vier vazia e country valido, aplica fallback automatico.
- Se houver incompatibilidade, retorna 422.

### 1.5 Regras de precificacao
- Preco e resolvido por zona/moeda (Price Based on Country).
- Ordem de tentativa de preco:
  1. sale_price ativo
  2. regular_price
  3. sem preco -> item/variacao descartado
- Produto sem nenhuma variacao precificada nao entra na resposta.

### 1.6 Regras Stripe especificas para flavors
Para cada item/variacao em flavors, todos os criterios abaixo devem ser verdadeiros:
1. _stripe_product_id com prefixo prod_
2. _stripe_price_id (legado) com prefixo price_
3. _stripe_price_ids_by_currency em JSON valido
4. Entrada da moeda solicitada no JSON (ex.: brl) com valor price_

Se algum criterio falhar, a variacao e excluida.

### 1.7 Regras de ordenacao e estrutura
- Produtos sao consultados por menu_order ASC e title ASC.
- Para cada produto:
  - starting_price = menor preco entre variacoes elegiveis.
  - days vem do meta _cmpb_plan_days.
  - tags vem da taxonomia product_tag.

### 1.8 Rate limit
- Escopo da rota: products_list.
- Limite observado: 120 requisicoes por 300 segundos por chave IP + User-Agent.
- Excedente retorna 429.

---

## 2. Transformacoes de dados observadas

- Sanitizacao de entradas:
  - category_slug: sanitize_title
  - country/currency: sanitize_text_field + uppercase
- Normalizacao de atributos de variacao:
  - flavor e weight sao inferidos por chaves contendo flavor/sabor e weight/gram/peso.
  - Quando atributo e taxonomia (pa_*), tenta resolver nome do termo.
- Booleans de controle:
  - empty na raiz da resposta indica ausencia de produtos apos todos os filtros.

---

## 3. Casos de borda relevantes

1. Categoria existe, mas nenhum produto passa pelos filtros
- Retorno 200 com products vazio e empty=true.

2. Produtos existem, mas sem preco para BRL
- Produtos/variacoes sao removidos da resposta final.

3. Produtos flavors com setup Stripe parcial
- Variacoes sem binding estrito sao removidas; possivel sumico total do produto.

4. currency omitida
- Se country BR/US, fallback preenche automatico.
- Se country invalido, erro 422 prevalece.

---

## 4. Itens marcados como Necessario investigar

- Necessario investigar: regra exata de optionalidade de currency no contrato publico/documentacao oficial.
- Necessario investigar: consistencia de naming de atributos de sabor/peso em todo catalogo (podem existir variacoes fora do padrao).
- Necessario investigar: impacto de cache de objeto/transients na latencia e consistencia entre ambientes.
- Necessario investigar: criterios de exclusao por status de estoque (na leitura atual, filtro principal e preco/stripe/pais/categoria).