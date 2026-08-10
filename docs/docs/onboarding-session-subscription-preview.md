# Onboarding Session Subscription Preview

## Endpoint

POST /api/v1/onboarding/session/:sessionId/subscription/preview

## Autenticação

- Requer um token de sessão informado via header `x-session-token` ou `Authorization`.
- Retorna `401` quando não houver token.

## Request body

```json
{
  "address": {
    "country": "US",
    "state": "CA",
    "postal_code": "94105"
  },
  "price_ids": ["price_123"]
}
```

## Response success

```json
{
  "success": true,
  "data": {
    "subtotal": 25,
    "tax": 2.5,
    "total": 27.5,
    "currency": "usd"
  }
}
```

## Frontend notes

- Use this endpoint to calculate a Stripe invoice preview for US checkout flows.
- It is intended as a tax preview helper before the final subscription checkout.

## Exemplo de fetch

```js
await fetch(`/api/v1/onboarding/session/${sessionId}/subscription/preview`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken
  },
  body: JSON.stringify({
    address: {
      country: 'US',
      state: 'CA',
      postal_code: '94105'
    },
    price_ids: ['price_123']
  })
});
```
