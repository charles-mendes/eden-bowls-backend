# Rota subscriptions actions para o frontend

## Endpoint

POST /api/v1/subscriptions/:subscriptionId/actions

## Objetivo

Executar uma ação de assinatura a partir do painel administrativo, como pausar, reativar, cancelar, alternar renovação automática, trocar plano ou atualizar método de pagamento.

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

## Request body

O campo `action` é obrigatório.

```json
{
  "action": "pause"
}
```

### Ações suportadas

- pause
- reactivate
- cancel
- toggle_auto_renew
- change_plan
- change_billing_frequency
- update_payment_method

### Campos opcionais por ação

```json
{
  "action": "change_plan",
  "new_product_id": "prod_123",
  "new_variation_id": "var_456",
  "new_price_id": "price_789"
}
```

```json
{
  "action": "toggle_auto_renew",
  "enabled": true
}
```

```json
{
  "action": "update_payment_method",
  "payment_method_id": "pm_123"
}
```

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "action": "pause",
    "pending_webhook_confirmation": true,
    "command_result": [
      {
        "status": "queued"
      }
    ],
    "subscription": {
      "id": "sub_123",
      "status": "active",
      "plan_label": "Premium",
      "current_period_end": "2026-09-09T00:00:00.000Z"
    }
  }
}
```

## Campos principais retornados

- data.action: ação executada
- data.pending_webhook_confirmation: indica se a ação depende de confirmação via webhook
- data.command_result: resultado da execução da ação
- data.subscription: resumo da assinatura afetada

## Observações para o frontend

- Use esta rota para ações de assinatura que alteram o estado do plano do cliente.
- O frontend pode tratar `pending_webhook_confirmation: true` como um estado de processamento/aguardando confirmação.
- A validação de `action` e do formato do `subscriptionId` é feita no backend.

## Exemplo de uso no frontend

```ts
async function executeSubscriptionAction(
  subscriptionId: string,
  sessionToken: string,
  payload: Record<string, unknown>
) {
  const response = await fetch(`/api/v1/subscriptions/${subscriptionId}/actions`, {
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
await executeSubscriptionAction('sub_123', 'token-123', {
  action: 'pause'
});
```
