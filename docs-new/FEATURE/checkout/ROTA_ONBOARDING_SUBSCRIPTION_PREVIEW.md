# Rota atual: Onboarding Subscription Preview (tax)

## Escopo

Rota atual no backend Node:

- `POST /api/v1/onboarding/subscription/preview`

Origem no front-end:

- `eden-bowls/src/services/onboardingApi.ts` (`fetchSubscriptionPreview`)
- `Checkout.tsx` (Phase 2 Stripe preview, preferido sobre sales-tax quote)

Arquivos principais:

- `src/api/routes/onboarding-subscription-preview.routes.js`
- `src/services/onboarding-subscription-preview.service.js`
- `src/infrastructure/repositories/onboarding-subscription-preview.repository.js`
- `tests/onboarding-subscription-preview.repository.test.js`

Nao confundir com `POST /api/v1/onboarding/plan/preview` (preco mensal da tela Plan). Esta rota e **imposto US** no checkout.

JWT **obrigatorio**. So US.

## Responsabilidade

Preview de subtotal + tax + total para endereco US, usando `price_ids` do body ou fallback em `plan_selection.pets[].price_ids`.

## Estado de implementacao

| Parte | Status |
|---|---|
| JWT + so US | implementado |
| Fallback `price_ids` do `plan_selection` | implementado (leitura real) |
| Stripe Invoice preview / Tax | **nao** — totais stub `25 / 2.5 / 27.5` `usd` |
| Persistencia | nao grava; so le `plan_selection` |

## Endpoint e auth

- Path: `/api/v1/onboarding/subscription/preview`
- Method: `POST`
- Sem `currentUser.id` → `401`

```json
{
  "address": {
    "country": "US",
    "state": "CA",
    "postal_code": "94105",
    "line1": "Market St",
    "city": "San Francisco"
  },
  "price_ids": ["price_abc"]
}
```

`price_ids` opcional. So entram strings que comecam com `price_`. Se o array filtrado ficar vazio, le fallback do usuario. Se ainda vazio → `422 invalid_price_id`.

`address.country !== 'US'` → `400 preview_us_only`.

## Contrato de sucesso

```json
{
  "success": true,
  "data": {
    "subtotal": 25,
    "tax": 2.5,
    "total": 27.5,
    "currency": "usd"
  }
}
```

O front (`SubscriptionPreviewResponse`) casa com esses quatro campos. Nao ha `session_id`.

## Relacao com o checkout

Preview de imposto **nao** aplica cupom de 1a compra. O apply e em [ROTA_ONBOARDING_SUBSCRIPTION_CHECKOUT.md](./ROTA_ONBOARDING_SUBSCRIPTION_CHECKOUT.md).
