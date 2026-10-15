# Rota onboarding recurrence para o frontend

## Endpoint

POST /api/v1/onboarding/session/:sessionId/recurrence

## Objetivo

Persistir a recorrência da sessão de onboarding e normalizar a frequência para um valor canônico usado por fluxos posteriores do checkout e da recomendação.

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
  "frequency": "1 month"
}
```

## Frequências aceitas

A rota aceita os aliases abaixo e converte para o valor canônico correspondente:

- weekly / semanal / 6 month / 6 months -> weekly
- biweekly / fortnightly / quinzenal / 3 month / 3 months -> biweekly
- monthly / mensal / 1 month / 1 months -> monthly

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "recurrence": {
      "frequency": "monthly",
      "period_days": 30,
      "updated_at": "2026-08-09T00:00:00.000Z"
    }
  }
}
```

## Campos principais retornados

- session_id: identificador da sessão de onboarding
- recurrence.frequency: frequência canônica (weekly, biweekly ou monthly)
- recurrence.period_days: período derivado da frequência (7, 14 ou 30)
- recurrence.updated_at: timestamp da atualização

## Observações para o frontend

- O frontend pode enviar tanto a forma canônica quanto os aliases legados, como 1 month, 3 months e 6 months.
- O backend normalize a frequência e retorna o valor canônico.
- O campo period_days é útil para montar cálculos de recomendação de pacotes e resumo de consumo.

## Exemplo de uso no frontend

```ts
async function setRecurrence(sessionId: string, sessionToken: string, frequency: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/recurrence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify({ frequency })
  });

  return response.json();
}
```
