# Definições não desenvolvidas ou em aberto

O que o PAY-01 **não implementou**, o que ficou **opcional no plano e não foi feito**, e o que é **fora de escopo** de propósito. Cutover operacional (env, Dashboard, sync): [o-que-alterar-para-funcionar.md](./o-que-alterar-para-funcionar.md). Plano original com status atualizado: [contexto.md](./contexto.md).

---

## 1. Fora do PAY-01 (não é bug)

Não entram nesta entrega. Não bloquear o cutover US/BR cartão por isso.

| Tema | Decisão |
|------|---------|
| PIX, boleto, `payment_method_types` além de `card` | Continua cartão nos dois países |
| CPF / documento fiscal no checkout | Sem campo, sem metadata Stripe de CPF |
| NF-e / ISS / nota fiscal | Stripe não emite. Precisa de outro fluxo **antes** do go-live BR |
| Stripe Connect / plataformas | Duas merchant accounts, dois `sk_`. Sem `stripeAccount` header |
| Canary por % de tráfego | Kill switch binário `STRIPE_BR_ENABLED` |
| Migrar `sub_` / `cus_` da conta atual para a BR | Assinaturas existentes ficam `us` |
| `automatic_tax` no Brasil | Só o client US usa Stripe Tax |

---

## 2. Plano citou; código não fez

### Catálogo no admin — IDs por conta/moeda

O sync **grava** `_stripe_price_ids_by_currency` e `_stripe_product_ids_by_currency` no Woo. O detalhe do produto no painel ainda mostra **um** `stripeProductId` / `stripePriceId` (o do mercado selecionado), sem tabela BR vs US.

O plano dizia que o detalhe *podia* listar os dois se o mapa já existisse. Não é bloqueio de cobrança: o checkout usa o `price_` da conta certa. Falta só visibilidade operacional no UI.

Arquivo: `eden-bowls-admin/src/pages/ProductDetailPage.tsx`.

### ACK do PaymentIntent

O plano listava Checkout / preview / ACK resolvendo conta por `address.country`. O ACK (`POST` onboarding payment-intent-ack) **não** chama Stripe e **não** devolve `stripe_account`. Ele só marca o PI no banco do usuário.

Não é regressão de cobrança: a conta já foi escolhida no checkout e persistida no ledger / webhook. Se alguém esperar `stripe_account` no JSON do ACK, não virá.

### Cópia explícita de cupons na migration

O plano falava em “copiar” linhas de first-purchase promo para `us`. A `0014` adiciona `stripe_account NOT NULL DEFAULT 'us'` — as linhas atuais **viram** `us`. Não há `INSERT` duplicando mapa. Funcionalmente o mapa US continua; mapa BR começa vazio até o admin preencher.

### Testes que o plano descreveu e não existem neste formato

| Esperado no plano | O que existe |
|-------------------|--------------|
| Playwright checkout BR vs US | Não. Decisão: Jest + Vitest. Sem spec E2E desta feature |
| Vitest montando `Checkout.tsx` / `EditSubscription.tsx` | Vitest em `stripe-publishable`, saved-cards por país, helper de edit. Não monta as páginas |
| Isolamento HTTP: payload assinado com secret BR no path `/us` | Isolamento no **service** (`handle({ account })` + secret errado → 400). Rotas só conferem que `/br` e `/us` passam `account`. Sem `whsec_` real no HTTP |
| Admin: coluna Conta + “Ver no Stripe” em teste de página | Billing tem filtro/coluna e teste do seletor. Coupons tem teste do `?account=`. Detalhe usa `dashboardUrl` do backend |

Nenhum desses gaps impede o cutover se o smoke manual (cartão teste nas duas contas) passar.

---

## 3. Verificação que não foi feita

- Checkout BR **no browser** com conta Stripe BR real (test mode) não rodou nesta entrega.
- Rebuild da imagem da loja com as duas `pk_` e conferência de Elements BR vs US não foi validado em QA.
- Webhook BR em URL pública (Caddy → `qa-api`) não foi disparado de ponta a ponta aqui.

O compose QA já injeta o `.env` inteiro no container da API. Se o `.env` da VPS não tiver `STRIPE_BR_*`, o YAML não avisa — o gap é preenchimento do env, não wiring do compose.

---

## 4. Comportamentos que parecem “faltando” mas estão corretos

| Observação | Por quê |
|------------|---------|
| Preview / Stripe Tax só no client US | BR não usa `automatic_tax` |
| Flag off → checkout BR 503, não fallback US | Evita `cus_` na conta errada |
| Pause de `sub_` BR com flag off ainda usa client BR | Mutação segue o ledger, não o país do request |
| Cupom 1/3/6 duplicado no admin | `promo_` não atravessa conta |
| Alias `/stripe/v1/webhook` = US | Cutover; Dashboard US antigo continua válido |
| Meta `_hsr_stripe_customer_id` some após 0014 | Renomeada para `_hsr_stripe_customer_id_us` |

---

## 5. Se for priorizar depois do PAY-01

Ordem sugerida, só se o negócio pedir:

1. NF-e / ISS (bloqueio legal BR — fora deste código).
2. Smoke QA no browser + webhooks públicos BR/US.
3. Catálogo admin: mostrar `prod_` / `price_` BR e US na mesma tela.
4. PIX / boleto / CPF — produto novo, não extensão silenciosa deste split.
