# Products Flavors API Specification (WordPress Atual)

## 1. Visao Geral da Rota

### Objetivo da API
Disponibilizar produtos de uma categoria WooCommerce (ex.: flavors) com variacoes e precos por moeda/pais para consumo do frontend headless.

### Quando ela e utilizada
- Etapas de selecao de sabores/produtos no onboarding.
- Listagem de produtos elegiveis por contexto geografico/comercial (country + currency).
- Montagem de catalogo dinamico no frontend sem renderizacao do WooCommerce tradicional.

### Problema de negocio que resolve
- Evita exibir produtos/variacoes sem precificacao valida para o mercado alvo.
- Garante compatibilidade entre pais e moeda (ex.: BR com BRL).
- Para category_slug=flavors, restringe ao que esta preparado para Stripe (evita itens incompletos no fluxo comercial).

---

## 2. Especificacao do Endpoint

### Metodo HTTP
GET

### URL
- Base local observada: http://localhost:8080
- Endpoint: /wp-json/custom-meal-plan/v1/products

URL completa do exemplo:
http://localhost:8080/wp-json/custom-meal-plan/v1/products?category_slug=flavors&country=BR&currency=BRL

### Headers necessarios
Obrigatorios tecnicamente:
- Nenhum header de autenticacao (rota publica).

Recomendados:
- Accept: application/json

Observacao:
- O User-Agent impacta rate limit por IP + User-Agent.

### Query Params
- category_slug (string, obrigatorio)
  - Exemplo: flavors
- country (string, obrigatorio)
  - Valores aceitos: BR, US
- currency (string, opcional no contrato, mas na pratica necessario para validacao)
  - Exemplo: BRL
  - Fallback observado: se country informado e currency vazio, BR->BRL e US->USD

### Exemplos de chamadas

#### Exemplo minimo
curl "http://localhost:8080/wp-json/custom-meal-plan/v1/products?category_slug=flavors&country=BR&currency=BRL"

#### Exemplo com headers de browser
curl "http://localhost:8080/wp-json/custom-meal-plan/v1/products?category_slug=flavors&country=BR&currency=BRL" \
  -H "Accept: */*" \
  -H "Origin: http://localhost:5173" \
  -H "Referer: http://localhost:5173/"

---

## 3. Contrato da API

## 3.1 Resposta de sucesso (HTTP 200)

Envelope:
- success (boolean)
- data (object)

Estrutura de data:
- country (string)
- currency (string)
- category (object)
  - id (number)
  - slug (string)
  - name (string)
- products (array)
  - product_id (number)
  - name (string)
  - slug (string)
  - country (string)
  - currency (string)
  - days (number)
  - tags (array)
    - id (number)
    - name (string)
    - slug (string)
  - starting_price (number)
  - variations (array)
    - variation_id (number)
    - flavor (string)
    - weight (string)
    - price (number)
    - currency (string)
- empty (boolean)

Exemplo de shape:
```json
{
  "success": true,
  "data": {
    "country": "BR",
    "currency": "BRL",
    "category": {
      "id": 123,
      "slug": "flavors",
      "name": "Flavors"
    },
    "products": [
      {
        "product_id": 1001,
        "name": "Plano Premium",
        "slug": "plano-premium",
        "country": "BR",
        "currency": "BRL",
        "days": 30,
        "tags": [
          { "id": 7, "name": "frango", "slug": "frango" }
        ],
        "starting_price": 29.9,
        "variations": [
          {
            "variation_id": 2001,
            "flavor": "Frango",
            "weight": "300g",
            "price": 29.9,
            "currency": "BRL"
          }
        ]
      }
    ],
    "empty": false
  }
}
```

## 3.2 Erros esperados
- 404 category_not_found
  - Categoria inexistente para o category_slug.
- 422 invalid_category_slug
  - category_slug vazio/invalido.
- 422 invalid_country
  - country fora do conjunto suportado.
- 422 country_currency_mismatch
  - currency nao permitida para country.
- 429 too_many_requests
  - Rate limit excedido.

Exemplo de erro (shape aproximado WP_Error no REST):
```json
{
  "code": "country_currency_mismatch",
  "message": "Currency is not allowed for selected country.",
  "data": { "status": 422 }
}
```

## 3.3 Campos obrigatorios vs opcionais
Obrigatorios na entrada:
- category_slug
- country

Condicional:
- currency pode vir vazia apenas quando country e BR/US (fallback automatico).

Observacoes sobre optionalidade na saida:
- tags pode ser array vazio.
- products pode ser array vazio.
- variations pode ser vazio por produto durante processamento, mas produtos sem variacao precificada tendem a ser filtrados antes da resposta final.
