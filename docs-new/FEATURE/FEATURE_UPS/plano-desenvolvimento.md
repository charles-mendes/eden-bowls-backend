# Plano de desenvolvimento — UPS US

## Decisões de produto (1ª entrega)

Ver também [decisoes-travadas.md](./decisoes-travadas.md).

- Escopo: **Rating + Shipping (etiqueta) + Tracking**.
- Checkout US: **uma opção** — preferir UPS Ground (`03`); senão a mais barata em `allowed_service_codes`.
- Etiqueta: **não** no checkout; gerada no admin a partir de invoice Stripe.
- Credenciais OAuth só em env; admin configura origem, pacote, serviços, fallback.

## Estado atual (verificado no código)

```text
Checkout US  →  GET /shipping/v1/settings?country=US  →  custo fixo FedEx ~12.90
Checkout BR  →  POST /shipping/v1/calculate           →  distância km
Select       →  POST /api/v1/onboarding/shipping      →  onboarding_user_state.shipping
Checkout     →  Stripe add_invoice_items             →  shipping.cost do select
```

- Settings vivos: MySQL (`shipping_us_settings` / `shipping_br_settings`).
- `data/shipping-settings.json` **não** é lido em runtime (`loadShippingSettings()` devolve defaults em código).
- `POST /shipping/v1/calculate` rejeita US (`country_not_supported`).
- Admin Frete (`ShippingPage`): edita cost/carrier/label US fixos.
- Admin `/orders` redireciona; fulfillment de etiqueta ainda não existe.
- Loja `PlanDetail`: UI de tracking existe, mas API mapeia `trackingCode`/`shipmentDate` como `null`.

## Arquitetura alvo

```text
Cotação
  ZIP → POST /shipping/v1/calculate country=US
     → ups-client (OAuth, timeout 5s)
     → Rating API → Ground ou mais barata
     → loja grava via POST /onboarding/shipping

Fulfillment
  Admin SubscriptionDetail → POST .../shipments { invoice_id }
     → check shipment ativo (idempotência)
     → UPS Shipping API
     → LocalLabelStorage (arquivo em disco)
     → ups_shipments
     → Tracking refresh opcional
     → PlanDetail billing_history
```

---

## Backend (`eden-bowls-backend`)

### 1. Cliente UPS

Novo: `src/infrastructure/shipping/ups-client.js`

- OAuth `client_credentials` com cache de token.
- Bases: CIE `https://wwwcie.ups.com` | prod `https://onlinetools.ups.com`.
- Métodos: `rate()`, `createShipment()`, `track()`, `voidShipment()`.
- Timeout explícito (default 5000 ms, alinhado a ViaCEP/OSRM).

Env (`src/config/env.js` + `.env.example`):

- `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`
- `UPS_ENV` = `cie` | `production`
- `UPS_HTTP_TIMEOUT_MS` = `5000`
- opcional: `UPS_TRANSACTION_SRC`

### 2. Settings US estendidos

Arquivos: `shipping-settings.js`, entity, migration, repository, `admin-shipping.validator.js`.

Campos novos em US:

| Campo | Uso |
|-------|-----|
| `quote_mode` | `'ups'` \| `'fixed'` — ficar em `fixed` até credenciais + gate dry ice |
| `ship_from` | name, street, city, state, zipcode, country=`US` |
| `package` | weight_lb, length_in, width_in, height_in |
| `allowed_service_codes` | default `['03']` — editável no admin |
| `fallback_enabled` | se UPS falhar/timeout, usa `cost` fixo |

Manter `cost` / `label` / `carrier` / `delivery` como fallback e modo `fixed`.

Limpeza: remover ou marcar DEPRECATED `data/shipping-settings.json`.

### 3. Cotação pública US

Alterar `shipping.service.js` + `shipping.routes.js`:

- `POST /shipping/v1/calculate` aceita `country: 'US'` + `zipCode`.
- Se `quote_mode === 'ups'`: Rating; Ground se disponível ∩ allowed; senão min price.
- Timeout/erro + `fallback_enabled` → resposta com custo fixo e `source: 'fallback'`.

Exemplo de resposta:

```json
{
  "shipping": 18.45,
  "delivery_days": 4,
  "currency": "USD",
  "label": "UPS Ground",
  "carrier": "UPS",
  "service_code": "03",
  "rate_id": "ups:03",
  "method_id": "ups_ground",
  "quoted_at": "...",
  "source": "ups",
  "destination": { "zipcode": "10001" }
}
```

- `GET /shipping/v1/settings?country=US`: `quote_mode`, `enabled`, fallback — sem secrets.
- Estender `POST /api/v1/admin/shipping/test` para ZIP US.

### 4. PO Box

- Helper (regex PO Box / P.O. Box / Postal Box em line1/line2).
- Loja: bloquear no checkout e EditSubscription.
- Backend: rejeitar no `createShipment` (calculate US v1 é só ZIP).

### 5. Etiquetas + idempotência

Tabela `ups_shipments`:

- `subscription_id`, `stripe_invoice_id`, `user_id`
- `ups_shipment_id` (unique), `tracking_number`, `service_code`
- `label_format`, `label_path` (disco — **não** base64)
- `quoted_shipping_cost`, `ups_monetary_value`
- `status` (`pending` | `created` | `voided`), `shipped_at`, `raw_response`, timestamps
- Unique: no máximo um shipment **não-voided** por `stripe_invoice_id`

Fluxo create:

1. Se já existe ativo para a invoice → retornar existente (não chama UPS).
2. Inserir/lock pending; chamar UPS Shipping.
3. Em sucesso: gravar ids, tracking, escrever label via `LocalLabelStorage`, `status=created`.
4. Retry após UPS OK + DB falhou: recuperar por `ups_shipment_id` / tracking antes de nova etiqueta.

Storage: `src/infrastructure/storage/local-ups-label-storage.js` (diretório privado, não público).

Rotas admin (`shipping.read` / `shipping.write`):

- `POST /api/v1/admin/billing/subscriptions/:id/shipments` — `{ invoice_id }`
- `GET /api/v1/admin/billing/subscriptions/:id/shipments`
- `GET /api/v1/admin/shipments/:id/label`
- `POST /api/v1/admin/shipments/:id/void`
- `POST /api/v1/admin/shipments/:id/refresh-tracking`

### 6. Tracking no cliente

Em `subscriptions-detail.repository.js` / dashboard: join `ups_shipments` por `stripe_invoice_id` no `billing_history` → `tracking_number` / `shipped_at`.

Cobrança Stripe continua usando `shipping.cost` do select (sem reajuste automático).

### 7. Testes backend

- ups-client: token mock, pick Ground/cheapest, timeout.
- shipping.routes: US calculate, fallback, ZIP obrigatório.
- PO Box + createShipment.
- Create shipment idempotente.
- Dashboard detail com tracking.
- Settings/repo/migration.

---

## Loja (`eden-bowls`)

| Arquivo | Mudança |
|---------|---------|
| `src/services/shippingApi.ts` | `calculateUsUpsShipping`; mapper UPS |
| `src/pages/checkout/Checkout.tsx` | US via calculate; uma opção; PO Box guard |
| `src/pages/dashboard/pages/EditSubscription.tsx` | Recotar UPS + PO Box |
| `src/services/onboardingApi.ts` | `rate_id` / `method_id` UPS |
| `src/pages/dashboard/pages/PlanDetail.tsx` | Tracking real da API |
| `src/i18n/en-us.json`, `pt-br.json` | Erros UPS / PO Box / tracking |
| `e2e/helpers/mockApi.ts` + specs | Mock calculate US |
| terms/legal | FedEx fixo → UPS (no go-live) |

---

## Admin (`eden-bowls-admin`)

| Arquivo | Mudança |
|---------|---------|
| `src/pages/ShippingPage.tsx` | quote_mode, ship-from, package, allowed_service_codes, fallback, teste ZIP US |
| `ShippingPage.test.tsx` + mocks | Fixtures |
| `src/pages/SubscriptionDetailPage.tsx` | Gerar etiqueta, tracking, download, void; opcional quoted vs UPS cost |
| `docs/05-frete.md` | UPS vs fixed; nota CIE |

Credenciais **não** vão no admin — só env no servidor.

---

## Ordem de implementação

1. Env + ups-client (timeout) + settings/migration US + calculate US + limpeza JSON + testes.
2. PO Box guard (loja + backend).
3. Loja: shippingApi + Checkout + EditSubscription + e2e.
4. Admin ShippingPage.
5. LocalLabelStorage + ups_shipments + create idempotente + rotas.
6. SubscriptionDetailPage.
7. PlanDetail + billing_history tracking.
8. Docs desta pasta + copy legal.

**Status:** itens 1–8 implementados no código (default `quote_mode=fixed`). Go-live `ups` ainda depende dos pré-requisitos e gates abaixo.

## Pré-requisitos operacionais

1. Conta UPS shipper do **cliente** + número da conta.
2. App em developer.ups.com (Rating, Shipping, Tracking).
3. Client ID/Secret CIE → depois produção.
4. Warehouse US + peso/dimensão padrão (v1 fixo; cobrir maior pacote típico).
5. Gate dry ice — ver [gates-e-pontos-em-aberto.md](./gates-e-pontos-em-aberto.md).
6. Aceite do risco de margem cotação × etiqueta.
