# Rota atual: Onboarding Payment Methods

## Escopo

Rota atual no backend Node:

- `GET /api/v1/onboarding/payment-methods`

Origem no front-end:

- `eden-bowls/src/services/onboardingApi.ts` (`fetchSavedPaymentMethods`)
- painel Payment em `Checkout.tsx`

Arquivos principais:

- `src/api/routes/onboarding-payment-methods.routes.js`
- `src/services/onboarding-payment-methods.service.js`
- `src/infrastructure/repositories/onboarding-payment-methods.repository.js`

Rota legado WordPress (substituida):

- `GET /custom/v1/onboarding/session/:sessionId/payment-methods`

JWT **obrigatorio**. Nao persiste. Nao cria cartao (Stripe Elements e no front).

## Responsabilidade

Listar cartoes salvos do usuario autenticado para reuso no checkout.

## Estado de implementacao

| Parte | Status |
|---|---|
| JWT obrigatorio | implementado |
| Stripe Customer / PaymentMethods API | **nao ligado** |
| Repository | stub fixo Visa `4242` |

O stub **ignora** `userId` alem de exigir que exista. Todo usuario autenticado ve o mesmo cartao fake `pm_123`.

## Endpoint, controller e permissao

- Path: `/api/v1/onboarding/payment-methods`
- Method: `GET`
- Registrar: `registerOnboardingPaymentMethodsRoutes`
- Service: `OnboardingPaymentMethodsService.listSavedPaymentMethods`

Sem `currentUser.id` → `401`. Sem service → `503`.

HttpError com `details.code` nesta rota **nao** devolve `details` no JSON (so `success` + `message`), diferente de address/shipping.

## Autenticacao

```http
GET /api/v1/onboarding/payment-methods
Authorization: Bearer <jwt-de-usuario>
```

Sem body. Sem query.

## Contrato

Resposta:

```json
{
  "success": true,
  "data": [
    {
      "id": "pm_123",
      "brand": "visa",
      "last4": "4242",
      "exp_month": 12,
      "exp_year": 2028,
      "is_default": true
    }
  ]
}
```

O front trata `data` como array. Lista vazia e valida (`[]`).

Ao selecionar, a UI define `paymentMethodId` e conclui Payment sem nova chamada Node. O id vai no Place Order: [ROTA_ONBOARDING_SUBSCRIPTION_CHECKOUT.md](./ROTA_ONBOARDING_SUBSCRIPTION_CHECKOUT.md).

## O que mudou em relacao ao WordPress

| Antes (WP) | Hoje (Node) |
|---|---|
| GET com `sessionId` | GET sem sessao |
| token de sessao + customer Stripe da sessao | JWT; stub sem Stripe |
| `session_id` no envelope | `data` e o array direto |
