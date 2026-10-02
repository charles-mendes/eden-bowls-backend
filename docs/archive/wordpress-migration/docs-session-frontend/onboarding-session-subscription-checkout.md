# Onboarding Session Subscription Checkout

## Endpoint

POST /api/v1/onboarding/session/:sessionId/subscription/checkout

## Autenticação

- Requer um token de sessão informado via header `x-session-token` ou `Authorization`.
- Retorna `401` quando não houver token.

## Request body

```json
{
  "billing": {
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane@example.com",
    "phone": "+1-555-0100",
    "company": "Acme"
  },
  "paymentMethodId": "pm_123",
  "checkout_mode": "subscription_first"
}
```

## Response success

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "order_id": 101,
    "order_key": "order-key",
    "status": "pending",
    "total": 29.99,
    "subtotal": 25,
    "product_tax": 2.5,
    "shipping_total": 2.49,
    "shipping_tax": 0.25,
    "shipping_total_with_tax": 2.74,
    "currency": "USD",
    "subscription_ids": [1],
    "flexible_subscription_id": 7,
    "stripe_subscription_id": "sub_123",
    "payment_state": "requires_payment_method",
    "has_payment_method": false,
    "reused": false
  }
}
```

## Frontend notes

- Use this endpoint after the user has completed the onboarding checkout flow.
- The response is designed to be consumed by the frontend subscription checkout experience and can be used to render order summary and payment state.

## Exemplo de fetch

```js
await fetch(`/api/v1/onboarding/session/${sessionId}/subscription/checkout`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken
  },
  body: JSON.stringify({
    billing: {
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com'
    },
    paymentMethodId: 'pm_123',
    checkout_mode: 'subscription_first'
  })
});
```
