# Rota onboarding pets create para o frontend

## Endpoint

POST /api/v1/onboarding/session/:sessionId/pets

## Objetivo

Criar um novo pet dentro da sessão de onboarding e retornar o estado atualizado da sessão com o pet criado.

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
  "name": "Luna",
  "type": "dog",
  "breed": "Labrador",
  "weight": 12.5,
  "weight_unit": "kg",
  "birthday": "2022-05-10",
  "sex": "female",
  "neutered": true,
  "notes": "Muito brincalhona"
}
```

## Campos suportados

- name: string obrigatório
- type: string obrigatório
- breed: string opcional
- weight: número opcional
- weight_unit: string opcional, por exemplo kg ou lb
- birthday: string opcional no formato ISO (YYYY-MM-DD)
- sex: string opcional
- neutered: boolean opcional
- notes: string opcional

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session": {
      "session_id": "session-123",
      "pets": [
        {
          "id": "pet-123",
          "name": "Luna",
          "type": "dog",
          "breed": "Labrador",
          "weight": 12.5,
          "weight_unit": "kg",
          "birthday": "2022-05-10",
          "sex": "female",
          "neutered": true,
          "notes": "Muito brincalhona"
        }
      ]
    },
    "pet": {
      "id": "pet-123",
      "name": "Luna",
      "type": "dog",
      "breed": "Labrador",
      "weight": 12.5,
      "weight_unit": "kg",
      "birthday": "2022-05-10",
      "sex": "female",
      "neutered": true,
      "notes": "Muito brincalhona"
    }
  }
}
```

## Observações para o frontend

- O frontend deve enviar os dados do pet no body em formato JSON.
- O backend retorna um envelope com success e data.
- O objeto data.session contém a sessão atualizada com a lista de pets.
- O objeto data.pet traz o pet criado para uso imediato na UI.

## Exemplo de uso no frontend

```ts
async function createPet(sessionId: string, sessionToken: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/pets`, {
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
