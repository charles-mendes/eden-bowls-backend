# Onboarding Session Shipping Select

## Endpoint

POST /api/v1/onboarding/session/:sessionId/shipping/select

## Autenticação

- Requer um token de sessão informado via header `x-session-token` ou `Authorization`.
- Retorna `401` quando não houver token.

## Request body

```json
{
  "rate_id": "rate-1",
  "method_id": "ground",
  "instance_id": 1,
  "label": "Ground",
  "cost": 5.5,
  "tax_total": 0.5,
  "total": 6,
  "transit_business_days": 3,
  "delivery_days": 3,
  "distance": 12,
  "per_km": 0.45,
  "zipcode": "94107",
  "quoted_at": "2026-08-09T00:00:00.000Z"
}
```

## Response success

```json
{
  "success": true,
  "data": {
    "session_id": "<session-id>",
    "shipping": {
      "rate_id": "rate-1",
      "method_id": "ground",
      "instance_id": 1,
      "label": "Ground",
      "cost": 5.5,
      "tax_total": 0.5,
      "total": 6,
      "transit_business_days": 3,
      "delivery_days": 3,
      "delivery_days_min": 3,
      "delivery_days_max": 3,
      "estimate_label": "3 business days",
      "selected_at": "2026-08-09T00:00:00.000Z",
      "quoted_at": "2026-08-09T00:00:00.000Z",
      "distance": 12,
      "distance_source": "manual",
      "per_km": 0.45,
      "zipcode": "94107",
      "snapshot": true
    },
    "subtotal": 20,
    "product_tax": 2,
    "product_tax_percent": 10,
    "tax_jurisdiction": "US-CA"
  }
}
```

## Frontend notes

- Use this endpoint after the user chooses a shipping method.
- Persist the selected `rate_id` or `method_id` and display the returned shipping estimates and tax jurisdiction in the checkout summary.

## Exemplo de fetch

```js
await fetch(`/api/v1/onboarding/session/${sessionId}/shipping/select`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken
  },
  body: JSON.stringify({
    rate_id: 'rate-1',
    label: 'Ground',
    cost: 5.5,
    tax_total: 0.5,
    total: 6
  })
});
```
