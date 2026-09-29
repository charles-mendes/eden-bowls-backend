# Rota onboarding pets delete para o frontend

## Endpoint

DELETE /api/v1/onboarding/session/:sessionId/pets/:petId

## Objetivo

Remover um pet da sessão de onboarding de forma suave, sem apagar o registro fisicamente, e retornar o estado atualizado da sessão junto com o pet removido.

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
    "session": {
      "session_id": "session-123",
      "pets": []
    },
    "removed_pet": {
      "id": "pet-1",
      "deleted_at": "2026-08-09T00:00:00.000Z",
      "deleted_by_user_id": 1,
      "deleted_reason": "user_request"
    }
  }
}
```

## Campos retornados

- session: objeto com a sessão atualizada após a remoção
- removed_pet: objeto com os metadados do pet removido
  - id: identificador do pet removido
  - deleted_at: timestamp da remoção
  - deleted_by_user_id: usuário responsável pela remoção
  - deleted_reason: motivo da remoção

## Observações para o frontend

- O frontend pode usar esta rota para remover um pet do estado local após a confirmação do backend.
- A remoção é feita de forma suave, preservando histórico e auditoria.
- O payload pode ser usado apenas como confirmação de sucesso; o frontend não precisa depender da resposta para renderizar a UI.

## Exemplo de uso no frontend

```ts
async function deletePet(sessionId: string, petId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/pets/${petId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    }
  });

  return response.json();
}
```
