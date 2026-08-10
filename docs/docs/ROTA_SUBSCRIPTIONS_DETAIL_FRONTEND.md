# Rota subscriptions detail para o frontend

## Endpoint

GET /api/v1/subscriptions/:subscriptionId/detail

## Objetivo

Retornar o detalhe completo de uma assinatura para telas de dashboard, plano e edição de assinatura.

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

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "subscription": {
      "subscription_id": "sub_123",
      "stripe_subscription_id": "sub_123",
      "legacy_subscription_id": null,
      "slug": "premium-plan",
      "plan_label": "Premium",
      "status": "active",
      "stripe_subscription_status": "active",
      "contract_label": "Premium plan",
      "start_date": "2026-01-01T00:00:00.000Z",
      "end_date": null,
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
      "pets": [{ "id": "pet_1", "name": "Milo" }],
      "packs_per_month": 2,
      "order_total_per_month": 60,
      "packs_per_delivery": 2,
      "frequency": "monthly",
      "active_flavors": ["chicken"],
      "price_per_cycle": 30,
      "cycle_unit": "month",
      "payment_method_brand": "visa",
      "payment_method_last4": "4242",
      "delivery_address": "Rua Teste, 123",
      "auto_renew": true,
      "current_cycle": 1,
      "total_cycles": 3,
      "billing_history": [],
      "plan_items": [],
      "plan_items_source": "plan_selection",
      "stripe_timeline": [],
      "edit_payment_pending": false,
      "subscription_term_months": 1
    }
  }
}
```

## Campos principais retornados

- subscription.subscription_id: identificador da assinatura
- subscription.plan_label: nome do plano
- subscription.status: estado atual da assinatura
- subscription.pets_names / pets: pets vinculados
- subscription.billing_history: histórico de cobranças
- subscription.plan_items: itens do plano
- subscription.stripe_timeline: timeline do Stripe
- subscription.payment_method_brand / payment_method_last4: forma de pagamento
- subscription.auto_renew: se o ciclo renova automaticamente

## Observações para o frontend

- Use esta rota para montar a tela de detalhe do plano, edição de assinatura e resumo de cobrança.
- O payload é rico o suficiente para exibir pets, histórico, itens do plano e informações de pagamento.
- O frontend deve tratar `subscription_id` e `stripe_subscription_id` como identificadores equivalentes da assinatura.

## Exemplo de uso no frontend

```ts
async function getSubscriptionDetail(subscriptionId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/subscriptions/${subscriptionId}/detail`, {
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
await getSubscriptionDetail('sub_123', 'token-123');
```
