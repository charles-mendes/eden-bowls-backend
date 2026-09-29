# Rota subscriptions edit preview para o frontend

## Endpoint

POST /api/v1/subscriptions/:subscriptionId/edit/preview

## Objetivo

Gerar uma pré-visualização da edição de uma assinatura antes de aplicar a alteração definitiva.

## Requisitos de autenticação

A rota aceita um token de sessão por um dos headers abaixo:

- x-session-token
- Authorization: Bearer <token>

Se nenhum token for enviado, a resposta será:

```json
{
  "success": false,
  "message": "Authentication is required."
}
```

## Parâmetros

### Path params

- subscriptionId: string

Formato esperado:

- deve seguir o padrão `sub_...`

### Body

```json
{
  "subscription_term_months": 1,
  "pets": [
    {
      "pet_name": "Milo",
      "enabled": true,
      "selected_flavors": ["chicken"],
      "flavor_weights": [100]
    }
  ],
  "address": {
    "country": "US",
    "state": "CA",
    "postal_code": "94105"
  },
  "shipping": {
    "method_id": "ship_1",
    "label": "Express",
    "cost": 5,
    "tax_total": 0,
    "total": 5
  }
}
```

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "subscription_id": "sub_123",
    "expected_current_hash": "hash-123",
    "term_change": false,
    "current": {
      "subscription_term_months": 1,
      "items": [],
      "address": {}
    },
    "proposed": {
      "subscription_term_months": 1,
      "items": [],
      "address": {}
    },
    "proration": {
      "direction": "none",
      "amount_due_now": 0,
      "credit_applied": 0,
      "currency": "USD"
    },
    "next_cycle": {
      "subtotal": 30,
      "tax": 0,
      "total": 30,
      "currency": "USD"
    },
    "discount": {
      "eligible": false,
      "reason": "edit_no_first_purchase_promo",
      "percent": 0
    }
  }
}
```

## Campos principais retornados

- data.subscription_id: identificador da assinatura
- data.expected_current_hash: hash de consistência para o commit posterior
- data.term_change: indica se houve mudança de termo
- data.current: estado atual da assinatura
- data.proposed: estado proposto após a edição
- data.proration: impacto de cobrança/crédito imediato
- data.next_cycle: subtotal, imposto e total do próximo ciclo
- data.discount: informações de elegibilidade de desconto

## Observações para o frontend

- Use esta rota antes de confirmar a edição da assinatura.
- O frontend pode usar `expected_current_hash` para evitar sobrescrever alterações concorrentes no commit final.
- A resposta é útil para exibir impacto financeiro, termos e plano proposto antes de salvar.

## Exemplo de uso no frontend

```ts
async function previewSubscriptionEdit(
  subscriptionId: string,
  sessionToken: string,
  payload: Record<string, unknown>
) {
  const response = await fetch(`/api/v1/subscriptions/${subscriptionId}/edit/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify(payload)
  });

  return response.json();
}
```

Exemplo de chamada:

```ts
await previewSubscriptionEdit('sub_123', 'token-123', {
  subscription_term_months: 1,
  pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
});
```
