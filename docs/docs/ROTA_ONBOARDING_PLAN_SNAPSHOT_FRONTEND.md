# Rota onboarding plan snapshot para o frontend

## Endpoint

GET /api/v1/onboarding/session/:sessionId/plan/snapshot

## Objetivo

Retornar um snapshot autoritativo do plano para montar a tela de plano no frontend, incluindo contexto de mercado, consumo simplificado por pet, catálogo de sabores e termos de assinatura.

## Requisitos de autenticação

A rota aceita um token de sessão por um dos headers abaixo:

- x-session-token
- Authorization: Bearer <token>

Se nenhum token for enviado, a resposta será:

```json
{
  "success": false,
  "message": "Session access token is required."
}
```

## Request

Não há body para esta rota. Basta chamar o endpoint com o sessionId da URL.

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "country": "US",
    "currency": "USD",
    "labels": {
      "daily": "Per day",
      "monthly": "Per month",
      "packs": "Packs"
    },
    "consumption": {
      "labels": {
        "daily": "Per day",
        "monthly": "Per month",
        "packs": "Packs"
      },
      "pets": [
        {
          "pet_id": "pet-1",
          "pet_name": "Milo",
          "daily": {
            "value": 200,
            "unit": "g",
            "grams": 200,
            "formatted": "200 g"
          },
          "monthly": {
            "value": 6000,
            "unit": "g",
            "grams": 6000,
            "formatted": "6,000 g"
          },
          "packs": {
            "count": 2,
            "pack_size_grams": 500,
            "pack_size_value": 2,
            "pack_size_unit": "pack",
            "formatted": "2 packs"
          }
        }
      ]
    },
    "pets": [
      {
        "pet_id": "pet-1",
        "pet_name": "Milo",
        "daily": {
          "value": 200,
          "unit": "g",
          "grams": 200,
          "formatted": "200 g"
        },
        "monthly": {
          "value": 6000,
          "unit": "g",
          "grams": 6000,
          "formatted": "6,000 g"
        },
        "packs": {
          "count": 2,
          "pack_size_grams": 500,
          "pack_size_value": 2,
          "pack_size_unit": "pack",
          "formatted": "2 packs"
        }
      }
    ],
    "flavor_options": [
      {
        "key": "chicken",
        "label": "Chicken"
      }
    ],
    "plan_terms": [
      {
        "subscription_term_months": 1,
        "discount_percent": 10
      },
      {
        "subscription_term_months": 3,
        "discount_percent": 25
      },
      {
        "subscription_term_months": 6,
        "discount_percent": 40
      }
    ]
  }
}
```

## Campos principais retornados

- session_id: identificador da sessão de onboarding
- country: país inferido para o snapshot
- currency: moeda associada ao país
- labels: rótulos de consumo para a UI
- consumption: estrutura detalhada com consumo por pet
- pets: lista de pets com dados de consumo
- flavor_options: opções de sabores disponíveis para seleção
- plan_terms: termos de assinatura e descontos associados

## Observações para o frontend

- Use esta rota para montar a tela de plano antes da confirmação final.
- O frontend pode consumir os campos flavor_options e plan_terms para renderizar os componentes de escolha de sabores e prazo do plano.
- O payload inclui dados prontos para exibição, sem necessidade de montar a estrutura no cliente.

## Exemplo de uso no frontend

```ts
async function getPlanSnapshot(sessionId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/plan/snapshot`, {
    method: 'GET',
    headers: {
      'x-session-token': sessionToken
    }
  });

  return response.json();
}
```
