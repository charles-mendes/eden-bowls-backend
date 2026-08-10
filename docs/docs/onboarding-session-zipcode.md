# Onboarding Session Zipcode

## Endpoint

POST /api/v1/onboarding/session/:sessionId/zipcode

## Autenticação

- Requer um token de sessão informado via header `x-session-token` ou `Authorization`.
- Retorna `401` quando não houver token.

## Request body

```json
{
  "zipcode": "94105",
  "country": "US",
  "state": "CA",
  "city": "San Francisco",
  "street": "Market St",
  "number": "100",
  "neighborhood": "Downtown",
  "complement": "Suite 1",
  "phone": "+1-555-0100",
  "phone_country": "US",
  "delivery_instructions": "Leave at front desk"
}
```

## Response success

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "zipcode": {
      "zipcode": "94105",
      "postal_code": "94105",
      "country": "US",
      "state": "CA",
      "city": "San Francisco",
      "street": "Market St",
      "number": "100",
      "neighborhood": "Downtown",
      "complement": "Suite 1",
      "phone": "+1-555-0100",
      "phone_country": "US",
      "delivery_instructions": "Leave at front desk",
      "address_line1": "Market St",
      "address_line2": "Suite 1"
    }
  }
}
```

## Frontend notes

- Use this endpoint after the user confirms the address details.
- The backend normalizes the payload and saves it in the onboarding session so later shipping and checkout steps can rely on it.

## Exemplo de fetch

```js
await fetch(`/api/v1/onboarding/session/${sessionId}/zipcode`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken
  },
  body: JSON.stringify({
    zipcode: '94105',
    country: 'US',
    state: 'CA',
    city: 'San Francisco',
    street: 'Market St',
    number: '100',
    neighborhood: 'Downtown',
    complement: 'Suite 1'
  })
});
```
