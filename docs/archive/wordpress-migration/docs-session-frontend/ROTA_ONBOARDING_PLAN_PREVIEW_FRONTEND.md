# Rota onboarding plan preview para o frontend

## Endpoint

POST /api/v1/onboarding/session/:sessionId/plan/preview

## Objetivo

Calcular um preview do plano selecionado para a sessão de onboarding, sem persistir a escolha, e retornar os totais, os pets e os line items do plano.

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

## Request body

```json
{
  "subscription_term_months": 1,
  "pets": [
    {
      "pet_id": "pet-1",
      "pet_name": "Milo",
      "enabled": true,
      "selected_flavors": ["chicken"],
      "flavor_weights": [500]
    }
  ]
}
```

## Campos suportados

- subscription_term_months: 1, 3 ou 6
- pets: array com os pets selecionados
  - pet_id: string opcional
  - pet_name: string obrigatório
  - enabled: boolean opcional
  - selected_flavors: array de sabores
  - flavor_weights: array numérica com os pesos correspondentes

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "subscription_term_months": 1,
    "currency": "USD",
    "totals": {
      "grand_total": 20,
      "grand_total_monthly": 20,
      "first_month_total": 20
    },
    "pricing": {
      "grand_total": 20,
      "grand_total_monthly": 20,
      "first_month_total": 20
    },
    "grand_total": 20,
    "grand_total_monthly": 20,
    "first_month_total": 20,
    "pets": [
      {
        "pet_id": "pet-1",
        "pet_name": "Milo",
        "monthly_total": 20,
        "total": 20,
        "first_month_total": 20
      }
    ],
    "line_items": [
      {
        "pet_id": "pet-1",
        "pet_name": "Milo",
        "flavor": "chicken",
        "quantity": 2,
        "pack_size_grams": 500,
        "pack_size_label": "500 g",
        "variation_id": 100,
        "product_id": 200,
        "currency": "USD",
        "unit_price": 10,
        "line_total": 20
      }
    ]
  }
}
```

## Observações para o frontend

- O frontend pode usar esta rota para exibir o valor estimado do plano antes de confirmar a seleção.
- O contrato de resposta contém os totais gerais e os valores por pet.
- O campo line_items pode ser usado para montar a UI detalhada do plano.

## Exemplo de uso no frontend

```ts
async function previewPlan(sessionId: string, sessionToken: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/plan/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify(payload)
  });

  return response.json();
}
```
