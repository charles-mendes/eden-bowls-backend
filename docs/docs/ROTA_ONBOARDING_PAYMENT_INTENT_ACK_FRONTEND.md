# Rota onboarding payment intent ACK para o frontend

## Endpoint

POST /api/v1/onboarding/session/:sessionId/payment-intent/ack

## Objetivo

Confirmar ao backend o estado final do Stripe PaymentIntent após a validação ou confirmação feita no frontend.

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
  "payment_intent_id": "pi_123456",
  "payment_intent_status": "succeeded"
}
```

### Campos suportados

A API aceita os aliases abaixo:

- payment_intent_id ou paymentIntentId
- payment_intent_status ou paymentIntentStatus

## Validações aplicadas

- payment_intent_id é obrigatório e deve começar com "pi_"
- payment_intent_status deve estar entre os valores permitidos:
  - succeeded
  - processing
  - requires_capture
  - requires_payment_method
  - requires_action
  - requires_confirmation
  - canceled

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "orderId": 42,
    "stripePaymentIntentId": "pi_123456",
    "stripePaymentIntentStatus": "succeeded",
    "paymentState": "paid",
    "acked": true
  }
}
```

## Campos retornados

- orderId: número do pedido, quando disponível
- stripePaymentIntentId: identificador do PaymentIntent
- stripePaymentIntentStatus: status confirmado pelo frontend
- paymentState: estado derivado para a UI
- acked: indica se o ACK foi processado com sucesso

## Exemplos de resposta

### sucesso

```json
{
  "success": true,
  "data": {
    "orderId": 42,
    "stripePaymentIntentId": "pi_123456",
    "stripePaymentIntentStatus": "succeeded",
    "paymentState": "paid",
    "acked": true
  }
}
```

### erro de validação

```json
{
  "success": false,
  "message": "Invalid payment intent id."
}
```

## Observações para o frontend

- O frontend deve enviar o status final do PaymentIntent após a confirmação de pagamento.
- O campo paymentState é o mais útil para atualizar a UI de checkout após o ACK.
- Em cenários de sucesso de pagamento, o backend pode retornar paymentState como "paid".

## Exemplo de uso no frontend

```ts
async function acknowledgePaymentIntent(sessionId: string, paymentIntentId: string, paymentIntentStatus: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/payment-intent/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify({
      payment_intent_id: paymentIntentId,
      payment_intent_status: paymentIntentStatus
    })
  });

  return response.json();
}
```
