# Rota onboarding address autocomplete para o frontend

## Endpoint

POST /api/v1/onboarding/session/:sessionId/address/autocomplete

## Objetivo

Fornecer sugestões de endereço com base em texto digitado pelo usuário durante o onboarding, sem persistir dados no backend.

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
  "query": "123 Main",
  "country": "US",
  "zipcode": "62704",
  "state": "IL",
  "city": "Springfield"
}
```

### Campos suportados

- query: string obrigatório para a busca
- country: "US" | "BR"
- zipcode: string opcional
- state: string opcional
- city: string opcional

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "status": "found",
    "country": "US",
    "query": "123 Main",
    "suggestions": [
      {
        "id": "autocomplete-1",
        "label": "123 Main Street",
        "street": "123 Main Street",
        "city": "Springfield",
        "state": "IL",
        "zipcode": "62704",
        "country": "US",
        "neighborhood": "",
        "complement": ""
      }
    ],
    "message": "Found 1 suggestion."
  }
}
```

## Possíveis status retornados

- found: sugestões encontradas
- incomplete: query menor que 4 caracteres
- not_found: nenhuma sugestão encontrada
- error: falha no fluxo de sugestão
- unsupported_country: país não suportado no fluxo atual

## Exemplos de resposta funcional

### unsupported_country

```json
{
  "success": true,
  "data": {
    "status": "unsupported_country",
    "country": "BR",
    "query": "123 Main",
    "suggestions": [],
    "message": "Autocomplete is currently supported only for US addresses."
  }
}
```

### incomplete

```json
{
  "success": true,
  "data": {
    "status": "incomplete",
    "country": "US",
    "query": "12",
    "suggestions": [],
    "message": "Query must be at least 4 characters long."
  }
}
```

## Observações para o frontend

- O fluxo atual suporta apenas endereços dos Estados Unidos.
- Para países diferentes de US, a API retorna status unsupported_country com lista vazia.
- O frontend deve usar o campo data.suggestions para renderizar a lista de opções.
- O campo data.status deve ser usado para controlar a UI de estado vazio, erro ou sugestão encontrada.

## Exemplo de uso no frontend

```ts
async function autocompleteAddress(sessionId: string, query: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/address/autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify({ query, country: 'US' })
  });

  return response.json();
}
```
