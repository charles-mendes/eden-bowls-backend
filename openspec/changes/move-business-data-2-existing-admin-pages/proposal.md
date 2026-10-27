# Proposal

## Why

Fase 2 de 3 da retirada de dados de negócio do código (fase 1: `move-business-data-1-read-from-api`). Estes dados ainda são constantes da API ou da loja, mas já têm uma página no painel onde caberiam. Hoje, mudar o percentual de um prazo, o texto de apresentação de uma receita, o prazo de trânsito dos EUA ou o tamanho dos pacotes exige deploy. Além disso, a página "Produtos" já edita os dias do plano (`_cmpb_plan_days`), mas a recomendação de pacotes usa uma constante de 30 dias, então as duas podem divergir.

## What Changes

- **Receitas → Apresentação na loja (#6).** Cada receita cadastrada ganha, por mercado e no idioma do mercado, título, chamada curta, resumo, destaques e as cinco cores da página. A rota pública `GET /api/v1/recipes/:key` passa a devolver esses campos. A ativação de variação passa a exigir a apresentação completa da receita. Uma migração grava a apresentação atual das 8 receitas da loja nos dois mercados, então nada muda no deploy. Com isso, criar uma receita nova não exige deploy da loja.
- **Cupons 1ª compra → percentual editável (#2).** O percentual de cada prazo passa a ser gravado por conta Stripe (BR e US), com os valores atuais (10/25/40) como semente. O cupom da Stripe não permite mudar o percentual depois de criado, então mudar o percentual no painel **cria um cupom novo** com o valor escolhido e passa a usá-lo no prazo. Os assinantes atuais seguem com o cupom antigo. A saúde dos cupons avisa quando o cupom vinculado tem percentual diferente do gravado. **BREAKING** (contrato do painel): `POST /api/v1/admin/stripe/first-purchase-coupons` deixa de recusar `percent_off` com `percent_off_locked`.
- **Frete → prazo máximo de trânsito nos EUA (B).** `MAX_TRANSIT_DAYS_US = 1` vira o campo `max_transit_days` em `shipping_us_settings`, editável na seção UPS. Isso segue o modelo do raio de entrega do Brasil, que já é editável.
- **Produtos → pacotes do plano (B).** A recomendação de pacotes passa a usar os tamanhos das variações ativas do mercado (em vez de 300/500 g fixos) e os dias do plano do produto (em vez de 30). O limite que decide o pacote grande (hoje 8 pacotes pequenos) passa a ser campo da seção "Plano" do produto.

## Capabilities

### New Capabilities

- `shipping-settings`: configurações de frete por mercado editadas no painel, começando pelo prazo máximo de trânsito dos EUA.
- `plan-packaging`: como a recomendação escolhe o tamanho e a quantidade de pacotes a partir do catálogo do mercado.

### Modified Capabilities

- `recipe-content`: apresentação da receita na loja por mercado, entregue pela rota pública e exigida na ativação. A capability é criada por `add-recipe-image-and-label` (ainda não arquivado).
- `first-purchase-discount`: percentual por conta e prazo gravado no banco e editável por cupom novo. A capability é criada pela fase 1 (ainda não arquivada).

## Impact

- API: migrações novas (percentual por prazo, coluna `presentation` em `recipe_contents` com a semente, `max_transit_days` em `shipping_us_settings`), `src/core/first-purchase-discount.js`, `src/services/stripe-coupon.service.js`, `src/services/onboarding-subscription-checkout.service.js`, `src/infrastructure/repositories/onboarding-plan-snapshot.repository.js`, `src/core/recipe-content.js`, `src/services/recipe-content.service.js`, `src/services/admin-catalog.service.js`, `src/core/delivery-closed-days.js`, `src/core/simplified-consumption.js`, `src/infrastructure/repositories/onboarding-recommendation.repository.js`, `src/api/routes/admin.routes.js`. Rotas novas no manifesto (`npm run routes:manifest`).
- Change irmão no painel (mesmo nome): seção "Apresentação na loja" em `RecipeContentPage`, edição do percentual em `CouponsPage`, campo na seção UPS de `ShippingPage`, campo na seção "Plano" de `ProductDetailPage`; `npm run contract:sync`.
- Change irmão na loja (mesmo nome): página de receita, home, rodapé e plano leem a apresentação e o rótulo da API; saem `src/content/*/recipes/*.md`. `src/data/recipes.ts` fica com chave, fase, imagem e cor.
- Texto legal: os termos de uso citam "10%, 25% e 40%". Mudar o percentual exige revisar esse texto, que só fica editável no painel na fase 3.
