# Rota onboarding pets update para o frontend

## Endpoint

PATCH /api/v1/onboarding/session/:sessionId/pets/:petId

## Objetivo

Atualizar os dados de um pet já existente na sessão de onboarding e retornar o estado atualizado da sessão com o pet modificado.

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
  "name": "Milo",
  "breed": "Labrador",
  "ageYears": 3,
  "weightUnit": "kg"
}
```

## Campos suportados

A API aceita os campos abaixo no body:

- name: string opcional
- breed: string opcional
- age_years ou ageYears: número opcional
- age_months ou ageMonths: número opcional
- weight: número opcional
- weight_unit ou weightUnit: "kg" | "lb"
- size: "small" | "medium" | "large"
- activity_level ou activityLevel: "low" | "medium" | "high"
- pet_condition ou weightCondition: "underweight" | "ideal" | "overweight"
- neutered: boolean opcional

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session": {
      "session_id": "session-123",
      "pets": []
    },
    "pet": {
      "id": "pet-1",
      "name": "Milo",
      "breed": "Labrador",
      "type": "dog",
      "age_years": 3,
      "age_months": 0,
      "age": 3,
      "weight_input": 12,
      "weight_unit": "kg",
      "weight_kg": 12,
      "weight": 12,
      "size": "large",
      "activity_level": "high",
      "pet_condition": "ideal",
      "neutered": true,
      "image_url": ""
    }
  }
}
```

## Observações para o frontend

- O frontend pode enviar apenas os campos que precisam ser alterados.
- O contrato de resposta usa o envelope success + data.
- O objeto data.pet contém o pet atualizado para uso imediato na UI.
- O objeto data.session traz a sessão atualizada com a lista de pets.

## Exemplo de uso no frontend

```ts
async function updatePet(sessionId: string, petId: string, sessionToken: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/pets/${petId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify(payload)
  });

  return response.json();
}
```
