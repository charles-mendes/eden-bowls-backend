# Rota subscriptions para o frontend

## Endpoint

GET /api/v1/subscriptions

## Objetivo

Listar as assinaturas do usuário autenticado para exibir o painel de plano, histórico e detalhes de assinatura.

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

Esta rota não exige query params nem body.

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "subscriptions": [
      {
        "subscription_id": "sub_123",
        "stripe_subscription_id": "sub_123",
        "legacy_subscription_id": null,
        "slug": "premium-plan",
        "plan_label": "Premium",
        "status": "active",
        "stripe_subscription_status": "active",
        "contract_label": "Premium Plan",
        "start_date": "2026-01-01T00:00:00.000Z",
        "end_date": null,
        "end_date_source": null,
        "current_period_start": "2026-08-01T00:00:00.000Z",
        "current_period_end": "2026-09-01T00:00:00.000Z",
        "next_billing_date": "2026-09-01T00:00:00.000Z",
        "next_billing_source": "stripe",
        "next_shipment_date": "2026-08-15T00:00:00.000Z",
        "next_shipment_source": "plan_selection",
        "next_shipment_context": {
          "shipping_window": "weekly"
        },
        "pets_names": ["Milo"],
        "pet_ids": ["pet_1"],
        "packs_per_month": 2,
        "order_total_per_month": 60
      }
    ],
    "count": 1
  }
}
```

## Campos principais retornados

- data.subscriptions: lista de assinaturas do usuário
- data.count: quantidade total de assinaturas retornadas
- cada item pode incluir:
  - subscription_id
  - stripe_subscription_id
  - plan_label
  - status
  - next_billing_date
  - next_shipment_date
  - pets_names
  - order_total_per_month

## Observações para o frontend

- Use esta rota para montar a tela de “Meu Plano” ou a lista de assinaturas do dashboard.
- O frontend pode usar `subscription_id` ou `stripe_subscription_id` para navegar até a tela de detalhe.
- A resposta já vem estruturada para consumo direto pela UI.

## Exemplo de uso no frontend

```ts
async function getSubscriptions(sessionToken: string) {
  const response = await fetch('/api/v1/subscriptions', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    }
  });

  return response.json();
}
```

Exemplo de chamada:

```ts
await getSubscriptions('token-123');
```
