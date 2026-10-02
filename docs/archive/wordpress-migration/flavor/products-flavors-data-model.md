# Products Flavors Data Model (Sugestao Inicial para Migracao Node)

## 1. Objetivo
Propor um modelo inicial de dados para reproduzir o comportamento atual da rota de produtos por categoria com filtro de pais, moeda, precificacao por variacao e elegibilidade Stripe para flavors.

---

## 2. Entidades sugeridas

## 2.1 Product
Campos sugeridos:
- id (number)
- name (string)
- slug (string)
- status (string) ex.: publish
- country_code (string) ex.: BR, US
- plan_days (number)
- category_id (number)
- created_at (datetime)
- updated_at (datetime)

Observacao:
- country_code e plan_days replicam metas WordPress (_cmpb_plan_country, _cmpb_plan_days).

## 2.2 ProductVariation
Campos sugeridos:
- id (number)
- product_id (number)
- flavor_label (string)
- weight_label (string)
- is_active (boolean)
- created_at (datetime)
- updated_at (datetime)

Observacao:
- flavor_label e weight_label no WordPress podem vir de atributos livres ou termos de taxonomia pa_*.

## 2.3 Category
Campos sugeridos:
- id (number)
- slug (string)
- name (string)

## 2.4 Tag
Campos sugeridos:
- id (number)
- slug (string)
- name (string)

Tabela associativa:
- ProductTag
  - product_id
  - tag_id

## 2.5 Country
Campos sugeridos:
- code (string) BR, US
- name (string)
- default_currency (string) BRL, USD
- is_active (boolean)

## 2.6 Currency
Campos sugeridos:
- code (string) BRL, USD
- symbol (string)
- is_active (boolean)

## 2.7 CountryCurrencyPolicy
Campos sugeridos:
- country_code (string)
- currency_code (string)
- is_allowed (boolean)

Observacao:
- Permite reproduzir regra country_currency_mismatch sem hardcode.

## 2.8 VariationPrice
Campos sugeridos:
- variation_id (number)
- currency_code (string)
- regular_price (decimal)
- sale_price (decimal, nullable)
- sale_from (datetime, nullable)
- sale_to (datetime, nullable)
- source_zone_id (string, nullable)

Regra:
- preco efetivo = sale_price ativo, senao regular_price.

## 2.9 StripeBinding (para flavors)
Campos sugeridos:
- item_type (string) product|variation
- item_id (number)
- stripe_product_id (string)
- legacy_price_id (string)
- price_id_by_currency_json (json)
- is_strict_valid (boolean derivado)

Regra:
- Em flavors, somente variacoes com binding estrito valido entram no retorno.

---

## 3. Relacionamentos

- Category 1:N Product
- Product 1:N ProductVariation
- Product N:N Tag (via ProductTag)
- ProductVariation 1:N VariationPrice
- Country N:N Currency (via CountryCurrencyPolicy)
- ProductVariation 1:1 StripeBinding (ou 0:1 fora de flavors)

---

## 4. Projecao de resposta (view de leitura)

Sugestao de materializacao/DTO para resposta:
- ProductCatalogItem
  - product_id
  - name
  - slug
  - country
  - currency
  - days
  - tags[]
  - starting_price
  - variations[]

- ProductCatalogVariationItem
  - variation_id
  - flavor
  - weight
  - price
  - currency

---

## 5. Regras de integridade recomendadas

1. Product.country_code obrigatorio.
2. Product.plan_days > 0 para produtos de meal plan.
3. VariationPrice deve existir para a moeda consultada, senao variacao fica inelegivel.
4. Para flavors:
- stripe_product_id deve comecar com prod_
- legacy_price_id deve comecar com price_
- mapa por moeda deve conter a moeda consultada com valor price_

---

## 6. Necessario investigar (modelo)

- Necessario investigar: necessidade de granularidade por zona de preco (alem de moeda) no Node.
- Necessario investigar: estrategia para manter compatibilidade com dados legados de atributos WooCommerce (nome de taxonomia e termos).
- Necessario investigar: se binding Stripe pode existir no product pai ou somente em variacoes no catalogo atual.
- Necessario investigar: formato canonical para armazenar peso (string livre vs valor numerico + unidade).