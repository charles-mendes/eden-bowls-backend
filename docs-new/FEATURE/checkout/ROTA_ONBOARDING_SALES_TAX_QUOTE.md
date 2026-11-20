# Rota atual: Onboarding Sales Tax Quote

## Escopo

Rota atual no backend Node:

- `POST /api/v1/onboarding/sales-tax/quote`

Origem no front-end:

- `eden-bowls/src/services/onboardingApi.ts` (`fetchSalesTaxQuote`)
- `Checkout.tsx` (imposto US; fallback se Stripe preview falhar)

Arquivos principais:

- `src/api/routes/onboarding-sales-tax-quote.routes.js`
- `src/services/onboarding-sales-tax-quote.service.js`
- `src/infrastructure/repositories/onboarding-sales-tax-quote.repository.js`

Rota legado WordPress:

- `POST /custom/v1/onboarding/session/:sessionId/sales-tax/quote`

JWT **obrigatorio**. Nao persiste.

## Responsabilidade

Devolver imposto sobre produto para endereco US. Fora dos US o imposto de produto e zero.

Nao confundir com `POST /onboarding/subscription/preview` (preview Stripe Tax, so US). O front prefere o preview Stripe e cai nesta rota se aquele falhar.

## Estado de implementacao

| Parte | Status |
|---|---|
| JWT | implementado |
| Taxa CA 10%, demais US 0% | hardcoded no service |
| Subtotal usado | **fixo `20`**, ignora body/catalogo |
| Stripe Tax / Woo tax | **nao** |
| `session_id` na resposta | **ausente** (o type TS do front ainda declara) |

## Endpoint e auth

- Path: `/api/v1/onboarding/sales-tax/quote`
- Method: `POST`
- Registrar: `registerOnboardingSalesTaxQuoteRoutes`
- Sem `currentUser.id` → `401`

```http
Authorization: Bearer <jwt-de-usuario>
Content-Type: application/json
```

```json
{
  "address": {
    "country": "US",
    "state": "CA",
    "postal_code": "94105",
    "city": "San Francisco"
  }
}
```

`address.country` default `'US'`. Alias `postcode` para postal.

## Regras

US:

- `subtotal` efetivo <= 0 → `422 sales_tax_unavailable` reason `missing_subtotal` (hoje o service passa `20`, entao este ramo nao dispara no caminho feliz)
- sem `state` ou postal → `422` reason `missing_address`
- `state === 'CA'` → 10%; senão 0%
- `tax_jurisdiction`: `US-{state}`

Nao-US: `productTax = 0`, `taxJurisdiction: "{country}-ZERO"`. Nao exige state/postal.

O repository so ecoa o objeto calculado em snake_case:

```json
{
  "success": true,
  "data": {
    "subtotal": 20,
    "product_tax": 2,
    "product_tax_percent": 10,
    "tax_jurisdiction": "US-CA",
    "country": "US"
  }
}
```

O type `SalesTaxQuoteResponse` no front ainda tem `session_id`. O Node nao envia.

## O que mudou em relacao ao WordPress

| Antes (WP) | Hoje (Node) |
|---|---|
| sessao + token | JWT |
| subtotal da sessao / plano | constante 20 |
| `session_id` | removido |
