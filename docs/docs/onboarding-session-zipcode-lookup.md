# Onboarding Session Zipcode Lookup

## Endpoint

POST /api/v1/onboarding/session/:sessionId/zipcode/lookup

## Autenticação

- Requer um token de sessão informado via header `x-session-token` ou `Authorization`.
- Retorna `401` quando não houver token.

## Request body

```json
{
  "zipcode": "94105",
  "country": "US"
}
```

## Response success

```json
{
  "success": true,
  "data": {
    "status": "found",
    "country": "US",
    "zipcode_input": "94105",
    "zipcode": "94105",
    "is_complete": true,
    "state": "CA",
    "city": "San Francisco",
    "street": "Market St",
    "neighborhood": "Downtown",
    "complement": "",
    "message": "Address found."
  }
}
```

## Frontend notes

- Use this endpoint to provide address autocomplete feedback while the user types a postal code.
- The response carries a functional status so the UI can decide between incomplete, invalid, found, not found or error.

## Exemplo de fetch

```js
await fetch(`/api/v1/onboarding/session/${sessionId}/zipcode/lookup`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken
  },
  body: JSON.stringify({
    zipcode: '94105',
    country: 'US'
  })
});
```
