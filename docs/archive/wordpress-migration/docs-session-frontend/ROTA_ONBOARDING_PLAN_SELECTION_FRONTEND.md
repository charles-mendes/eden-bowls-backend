# Rota onboarding plan selection para o frontend

## Endpoint

POST /api/v1/onboarding/session/:sessionId/plan-selection

## Objetivo

Persistir a seleção do plano da sessão de onboarding e retornar o snapshot/estado final do plano escolhido para o frontend.

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
  "catalog_pricing": {
    "source": "custom_meal_plan_builder",
    "country": "US",
    "currency": "USD",
    "line_items": [
      {
        "pet_id": "pet-1",
        "flavor": "chicken",
        "quantity": 2,
        "unit_price": 10,
        "line_total": 20
      }
    ],
    "subtotal": 20,
    "discounted_first_month_total": 20
  },
  "flavors_by_pet": [
    {
      "pet_id": "pet-1",
      "flavors": ["chicken"]
    }
  ],
  "pets": [
    {
      "pet_id": "pet-1",
      "pet_name": "Milo",
      "enabled": true
    }
  ],
  "validated_with": {
    "recommendation_version": "v1",
    "validated_at": "2026-08-09T00:00:00.000Z"
  }
}
```

## Campos suportados

- subscription_term_months: número opcional com a duração escolhida do plano
- catalog_pricing: objeto opcional com o resumo do pricing do plano
- flavors_by_pet: array opcional com os sabores por pet
- pets: array opcional com os pets associados à seleção
- validated_with: objeto opcional com metadados de validação da recomendação

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "plan_selection": {
      "subscription_term_months": 1,
      "catalog_pricing": {
        "source": "custom_meal_plan_builder",
        "country": "US",
        "currency": "USD",
        "line_items": [
          {
            "pet_id": "pet-1",
            "flavor": "chicken",
            "quantity": 2,
            "unit_price": 10,
            "line_total": 20
          }
        ],
        "subtotal": 20,
        "discounted_first_month_total": 20
      },
      "flavors_by_pet": [
        {
          "pet_id": "pet-1",
          "flavors": ["chicken"]
        }
      ],
      "pets": [
        {
          "pet_id": "pet-1",
          "pet_name": "Milo",
          "enabled": true
        }
      ],
      "validated_with": {
        "recommendation_version": "v1",
        "validated_at": "2026-08-09T00:00:00.000Z"
      },
      "updated_at": "2026-08-09T00:00:00.000Z"
    }
  }
}
```

## Observações para o frontend

- Use esta rota para confirmar a escolha do plano após o usuário selecionar o período e revisar os dados do preview.
- O frontend pode persistir o payload enviado e exibir o estado retornado na tela de confirmação.
- O campo plan_selection é o ponto principal de consumo para montar a próxima etapa do onboarding.

## Exemplo de uso no frontend

```ts
async function selectPlan(sessionId: string, sessionToken: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/plan-selection`, {
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
