# Rota onboarding sales tax quote para o frontend

## Endpoint

POST /api/v1/onboarding/session/:sessionId/sales-tax/quote

## Objetivo

Calcular ou resolver um quote fiscal para o checkout de assinatura e retornar um resumo com subtotal, imposto e jurisdição fiscal.

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
  "address": {
    "country": "US",
    "state": "CA",
    "postal_code": "94105"
  }
}
```

## Campos suportados no body

- address: objeto opcional
  - country: string
  - state: string
  - postal_code: string
  - postcode: alias opcional para postal_code

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "subtotal": 20,
    "product_tax": 2,
    "product_tax_percent": 10,
    "tax_jurisdiction": "US-CA",
    "country": "US"
  }
}
```

## Campos principais retornados

- session_id: identificador da sessão de onboarding
- subtotal: valor base do cálculo
- product_tax: valor do imposto calculado
- product_tax_percent: percentual aplicado
- tax_jurisdiction: jurisdição fiscal resolvida
- country: país usado no cálculo

## Observações para o frontend

- Esta rota é usada como fallback para preencher o imposto quando o preview Stripe não estiver disponível.
- Para países diferentes de US, o imposto é retornado como zero.
- O payload de address pode sobrescrever o endereço salvo na sessão.

## Exemplo de uso no frontend

```ts
async function getSalesTaxQuote(sessionId: string, sessionToken: string, address: Record<string, unknown>) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/sales-tax/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify({ address })
  });

  return response.json();
}
```
