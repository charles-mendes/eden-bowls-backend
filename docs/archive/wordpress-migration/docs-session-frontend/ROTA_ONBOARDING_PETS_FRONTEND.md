# Rota onboarding pets para o frontend

## Endpoint

GET /api/v1/onboarding/session/:sessionId/pets

## Objetivo

Listar os pets associados à sessão de onboarding para que o frontend possa exibir a lista atual do usuário durante o fluxo.

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

Não há body na requisição.

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "pets": [
      {
        "id": "pet-1",
        "name": "Milo",
        "breed": "Labrador",
        "age_years": 2,
        "age_months": 0,
        "age": 2,
        "weight_input": 10,
        "weight_unit": "kg",
        "weight_kg": 10,
        "weight": 10,
        "size": "large",
        "activity_level": "high",
        "pet_condition": "ideal",
        "neutered": true,
        "image_url": ""
      }
    ]
  }
}
```

## Campos retornados

- session_id: identificador da sessão
- pets: lista de pets da sessão

Cada item da lista pode conter:

- id
- name
- breed
- age_years
- age_months
- age
- weight_input
- weight_unit
- weight_kg
- weight
- size
- activity_level
- pet_condition
- neutered
- image_url

## Observações para o frontend

- O frontend pode consumir diretamente o array em data.pets.
- O contrato usa campos com snake_case, compatíveis com o fluxo atual.
- Se a sessão ainda não tiver pets, a API retorna uma lista vazia.

## Exemplo de uso no frontend

```ts
async function listPets(sessionId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/pets`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    }
  });

  return response.json();
}
```
