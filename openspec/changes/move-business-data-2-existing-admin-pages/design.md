# Design

## Context

- `recipe_contents` guarda, por (mercado, chave), nome, imagem, imagem do plano, fase da vida e `label` (JSON). A apresentação que a loja mostra (título, chamada, resumo, destaques, cores) está em `eden-bowls/src/data/recipes.ts` e `src/content/{pt-br,en-us}/recipes/*.md`. A semente do rótulo (`1700000000041` e `helpers/seed-recipe-labels.js`) é o modelo para semear dados vindos de outro repositório.
- A ativação de variação confere uma lista de checagens (`admin-catalog.service.js`: `final_image`, `label_data`…), devolvida como `missing`.
- `TERM_PERCENT_MAP` (`src/core/first-purchase-discount.js`) alimenta `expectedPercentForTerm`, que é usado no checkout (`onboarding-subscription-checkout.service.js:200`), na resolução do cupom (`stripe-coupon.service.js:445`), em `termFromStripePromo` (que adivinha o prazo pelo percentual) e na criação do cupom, que recusa outro `percent_off` com `percent_off_locked`. `PLAN_TERMS` vai no snapshot do plano. `stripe_first_purchase_promos` tem chave (`stripe_account`, `term_months`) e só existe linha para prazo mapeado.
- `MAX_TRANSIT_DAYS_US` é lido em `delivery-estimate.routes.js`, `delivery-calendar-impact.service.js` e `customer-deliveries.service.js`. O raio do Brasil já usa um valor de módulo atualizado por `shipping.service.js` quando as configurações são carregadas ou salvas (`setBrDeliveryRadiusKm`).
- `simplified-consumption.js` fixa `SMALL_PACK_GRAMS = 300`, `LARGE_PACK_GRAMS = 500`, `LARGE_PACK_THRESHOLD = 8` e `PERIOD_DAYS = 30`. O produto já tem `_cmpb_plan_days`, editado no painel, e as variações já têm o peso em gramas (`variation.grams` em `plan-catalog-pricing.js`).

## Goals / Non-Goals

**Goals:**
- Cada dado com uma fonte só, editável na página do painel onde o operador já trabalha.
- Deploy sem mudança visível: toda migração grava o valor de hoje.

**Non-Goals:**
- Os nomes de sabor de `MARKETS.flavorLabels` (`market.js`) e `FLAVOR_RECIPE_LABELS` da fatura. Eles alimentam nomes de produto na Stripe e o texto aprovado da fatura; trocar a fonte muda texto impresso e fica para quando o nome cadastrado da receita for revisado nos dois mercados.
- Os limites de frequência de `suggestFrequency` (250 g e 900 g por dia), que não aparecem para o cliente hoje.
- Ingredientes e análise: já estão no rótulo.

## Decisions

### 1. Apresentação como JSON inteiro em `recipe_contents.presentation`

Coluna `presentation` (JSON, nula) e `presentation_updated_at`, no molde de `label`. A validação fica em `src/core/recipe-content.js`, junto da do rótulo. A apresentação é gravada inteira, sem rascunho. Ao contrário do rótulo, ela não tem uso parcial: uma página de receita sem título não pode ir ao ar.

Rota: `PUT /api/v1/admin/catalog/recipe-content/:flavorSlug/presentation`, com o mesmo `requirePermission('catalog.write', { market })` das rotas de rótulo.

Alternativa descartada: colunas separadas. São seis campos que só fazem sentido juntos, e o rótulo já usa JSON.

### 2. Semente da apresentação copiada da loja

Helper `helpers/seed-recipe-presentations.js` com os valores atuais dos `.md` e de `recipes.ts` (título, chamada, resumo, destaques e cores), por idioma. A migração grava só onde `presentation` é nula, como na semente do rótulo. A chave da loja `chicken` corresponde a `turkey` na API, resolvida pelo alias.

### 3. Checagem `presentation` na ativação

Nova checagem `presentation` na lista de `admin-catalog.service.js`. Não há confirmação manual alternativa, porque a semente cobre as receitas existentes. Como a apresentação só é substituída inteira, não existe o caso "tornar incompleta uma receita ativa", e não é preciso a trava 409 que o rótulo tem.

### 4. Percentual em tabela própria, separada do mapeamento

Tabela nova `first_purchase_term_discounts` (`stripe_account`, `term_months`, `discount_percent`, `updated_by`, `updated_at`), com chave (`stripe_account`, `term_months`) e semente 10/25/40 para `br` e `us`.

Alternativa descartada: uma coluna em `stripe_first_purchase_promos`. Lá só há linha para prazo mapeado, e o checkout precisa do percentual mesmo sem cupom.

`expectedPercentForTerm` deixa de ser síncrono: um repositório lê a tabela com `TtlCache` (60 s, limpo ao gravar), e `checkout`, snapshot do plano e saúde dos cupons recebem os percentuais da conta. `termFromStripePromo` continua usando o metadado `pawbowl_term_months`. A adivinhação pelo percentual passa a comparar com os valores gravados da conta.

### 5. Mudar o percentual = criar cupom novo

O painel não tem um campo "percentual" isolado. Ele ganha `percent_off` no formulário "Criar cupom na Stripe" já existente.

Sequência na API:
1. Criar o cupom e o código na Stripe.
2. Gravar o mapeamento do prazo.
3. Gravar o percentual e o evento de auditoria, numa transação.

Se a Stripe falhar, nada é gravado. Se a gravação falhar depois da Stripe, o cupom fica órfão na Stripe e a saúde o lista em `candidates`, como hoje; o operador o vincula ou o desativa.

Alternativa descartada: editar o percentual sem cupom novo. A Stripe aplicaria o cupom antigo, e o cliente veria um percentual e pagaria outro.

### 6. `max_transit_days` no modelo do raio do Brasil

Coluna `max_transit_days` (int, padrão 1) em `shipping_us_settings`. `delivery-closed-days.js` ganha `setUsMaxTransitDays`/`currentUsMaxTransitDays`, no mesmo molde de `setBrDeliveryRadiusKm`, chamados por `shipping.service.js` ao carregar e ao salvar. As três leituras de `MAX_TRANSIT_DAYS_US` passam a usar `currentUsMaxTransitDays()`, e a constante fica só como valor inicial.

### 7. Pacotes a partir do produto do plano do mercado

`buildSimplifiedRecommendation` e `buildPackagingRecommendation` passam a receber `{ packSizesGrams, planDays, largePackLimit }`. O repositório de recomendação monta esse objeto do produto do plano do mercado (variações ativas, `_cmpb_plan_days` e o meta novo `_cmpb_large_pack_limit`, com 8 por padrão). Sem produto ou sem variação ativa, usa os valores de hoje. As funções seguem puras e testáveis sem banco.

`bags`, hoje `{ 300: 0, 500: 0 }`, passa a ter uma chave por tamanho.

O tamanho de cada variação vem do peso cadastrado (`attribute_pa_weight`). Um peso em gramas (`300g`) entra como está. Um peso em onças é convertido e arredondado para 10 g (`packGramsFromWeight` em `plan-catalog-pricing.js`), porque o catálogo dos EUA escreve 300 g como `10.6oz` (300,5 g) e 500 g como `17.6oz` (498,95 g): sem o arredondamento os pacotes viram 301/499 g e a contagem muda no deploy. A diferença do arredondamento fica abaixo da precisão de 0,1 oz do rótulo. Variação ativa sem peso não entra na lista.

## Risks / Trade-offs

- [`expectedPercentForTerm` passa a ser assíncrono e tem vários chamadores] → Os testes de checkout e de snapshot cobrem os três prazos nas duas contas antes da troca.
- [Percentual mudado sem revisar os termos de uso] → A tela de cupom mostra o aviso "os termos de uso citam o percentual" ao salvar. Na fase 3 o texto legal passa a ser editável no painel.
- [O valor de módulo de `max_transit_days`, como o do raio do Brasil, só é atualizado no processo que salva as configurações] → Aceito: há um só container de API, e é nele que rodam a estimativa de entrega, as entregas do cliente e o impacto do calendário, os únicos leitores do limite. O container `cron` lê as configurações na partida, mas nenhum job dele usa o prazo nem o raio (o estimador usa o trânsito gravado de cada assinatura). Se a API passar a ter mais de um container, os leitores precisam reler as configurações do banco.
- [Uma variação de teste ativa pode mudar a recomendação de todos] → A recomendação só usa variações ativas do produto do plano. O detalhe do produto mostra os tamanhos que entram na recomendação.
- [A semente da apresentação pode divergir dos `.md` se a loja mudar antes do deploy] → O teste da semente compara com o snapshot `lifeStageRecipesContent.test.ts.snap` da loja, copiado para a fixture. Com a remoção dos `.md` na loja, a fixture passa a ser a referência do texto aprovado.

## Migration Plan

1. API: migrações (percentual, apresentação com semente, trânsito), checagem `presentation` e rotas. A loja atual segue lendo os `.md`.
2. Painel: as quatro edições.
3. Antes do deploy da loja: conferir em QA e em produção que toda receita ativa tem apresentação com `tag` (a migração `1700000000048` preenche o `tag` das já gravadas).
4. Loja: lê `presentation` e o rótulo só da API e remove os `.md` de receita (o change irmão da loja). `recipes.ts` fica com chave, fase, imagem e cor. O build da loja precisa desta API de pé para pré-renderizar o texto.

Rollback: as colunas novas são nulas ou têm padrão, e o `down` de cada migração as remove. Um cupom criado com outro percentual continua válido na Stripe depois de um rollback; o `down` da tabela de percentuais não desfaz o mapeamento.
