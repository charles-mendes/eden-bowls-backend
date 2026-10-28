# Design

## Context

- O lançamento das receitas de filhote e sênior tem duas chaves hoje: a ativação da variação no painel e as variáveis de build `VITE_LIFE_STAGE_RECIPES_LAUNCHED_BR/US` da loja. Elas são lidas em `src/config/lifeStageLaunch.ts`, `src/components/MainFooter.tsx`, `src/pages/recipes/RecipePage.tsx` e, no build, em `src/seo/config.ts`, que monta o sitemap e a lista de pré-renderização.
- `RecipeContentService.resolveLaunched` já decide se uma receita está no ar: ela precisa ter variação ativa no mercado. Só existe a consulta por chave; não há listagem.
- A saúde dos cupons (`StripeCouponService`) devolve `mapping`, `coupons` e `slots`, sem o percentual. O painel usa uma constante própria (`CouponsPage.tsx:45`), igual a `TERM_PERCENT_MAP` em `src/core/first-purchase-discount.js`.
- O frete dos EUA vem de `shipping_us_settings` pela cotação. A loja tem um fallback fixo (`Checkout.tsx:77`) usado antes da cotação ou quando o rascunho não tem frete. `data/shipping-settings.json` está marcado `_deprecated` e não é lido.

## Goals / Non-Goals

**Goals:**
- Uma única fonte para "a receita está no ar" e para "quanto é o desconto do prazo", lida pela loja e pelo painel.

**Non-Goals:**
- Tornar o percentual editável (fase 2).
- Mover para o banco o conteúdo de apresentação das receitas (fase 2).
- Rebuild automático da loja quando uma receita entra no ar.

## Decisions

### 1. Listagem reaproveita a regra de `resolveLaunched`

A rota nova lista as receitas cadastradas no mercado (`repository.listByMarket`) e mantém só as que têm variação ativa, usando a mesma consulta de variações por mercado que `list` já usa (`listMarketRecipeVariations`). Isso garante que toda chave listada responde em `GET /api/v1/recipes/:key`.

Alternativa descartada: um flag "linha lançada" por mercado no banco. Seria uma terceira chave para o mesmo fato, que a ativação da variação já expressa.

### 2. Loja: a página decide em runtime; o sitemap e a pré-renderização decidem no build

Em runtime, o rodapé, a home e a página de receita usam a lista da API. Uma receita ativada no painel aparece na hora, sem deploy.

O sitemap e a pré-renderização rodam no build (`scripts/prerender.ts`, `scripts/generate-seo-files.ts`). Eles passam a chamar a mesma rota durante o build. Se a API não responder, ficam só as receitas adultas, que é o comportamento atual com a variável desligada. A consequência é que o HTML estático e o sitemap de uma receita recém-lançada só aparecem no próximo build. A página funciona antes disso, porque a loja é uma SPA; o atraso afeta só a indexação.

Alternativa descartada: gerar o sitemap pela API. Resolve a indexação, mas exige servir `sitemap.xml` pela API ou por proxy no Caddy; fica para depois, se o atraso de indexação incomodar.

### 3. `terms` na saúde dos cupons vem de `PLAN_TERMS`

A resposta ganha `terms: PLAN_TERMS`, a mesma lista que o snapshot do plano devolve como `plan_terms`. Na fase 2, `PLAN_TERMS` passa a ser lido do banco, e esta rota segue igual.

### 4. Loja sem fallback de frete dos EUA

Sem cotação, o checkout mostra "calculando frete" e não deixa avançar até a cotação responder. A cotação dos EUA já tem `fallback_enabled` e o preço fixo configurados em `shipping_us_settings`, então a API já cobre a falha da UPS. O fallback da loja só escondia uma cotação ausente com um preço que pode estar errado.

## Risks / Trade-offs

- [O build da loja passa a depender da API para o sitemap] → Se a API falhar, o build não quebra: as receitas adultas ficam no sitemap.
- [A lista pública revela quais receitas estão ativas antes do anúncio] → É a mesma informação que `GET /api/v1/recipes/:key` já dá, uma chave por vez.
- [Remover o fallback de frete pode travar o checkout se a cotação falhar] → A cotação dos EUA tem fallback de preço fixo no banco; o change irmão da loja testa o estado "sem cotação".

## Migration Plan

1. Publicar a API com a rota nova e `terms` na saúde. Nada muda para a loja e o painel atuais.
2. Publicar o painel, que passa a ler `terms`.
3. Publicar a loja, que passa a ler a lista. Antes, conferir no painel que as variações de filhote e sênior estão ativas onde a variável estava `true`, para que nada saia do ar.
4. Remover as variáveis `VITE_LIFE_STAGE_RECIPES_LAUNCHED_*` dos ambientes.

Rollback: voltar a versão da loja. A rota nova não muda nenhum comportamento existente.
