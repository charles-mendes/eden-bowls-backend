# Rota onboarding payment methods para o frontend

## Endpoint

GET /api/v1/onboarding/session/:sessionId/payment-methods

## Objetivo

Listar os métodos de pagamento salvos vinculados à sessão de onboarding para que o frontend possa exibir opções de pagamento ao usuário.

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
  "data": [
    {
      "id": "pm_123",
      "brand": "visa",
      "last4": "4242",
      "exp_month": 12,
      "exp_year": 2028,
      "is_default": true
    }
  ]
}
```

## Campos retornados

Cada item do array possui:

- id: identificador do método de pagamento
- brand: bandeira do cartão, por exemplo visa, mastercard
- last4: os últimos 4 dígitos do cartão
- exp_month: mês de expiração
- exp_year: ano de expiração
- is_default: indica se o método é o padrão

## Observações para o frontend

- O frontend pode consumir o array retornado em data diretamente.
- O contrato usa snake_case nos campos: exp_month, exp_year e is_default.
- Em caso de ausência de métodos, a API retorna um array vazio.

## Exemplo de uso no frontend

```ts
async function listPaymentMethods(sessionId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/payment-methods`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    }
  });

  return response.json();
}
```
