# Proposal

## Why

Os textos legais de 22/10/2026 pedem uma caixa obrigatória no checkout: "Li e aceito os Termos de Uso e a Política de Privacidade" (EN: "I have read and agree to the Terms of Service and Privacy Policy"). Hoje o aceite só acontece no cadastro, na verificação do código (`otp_verify`). `POST /api/v1/onboarding/subscription/checkout` não recebe aceite nem versão. Um cliente que se cadastrou com a versão `2026-09-13` compra sem nunca ter aceitado a `2026-10-22`, e não há registro de que viu os termos no momento da compra.

## What Changes

- `POST /api/v1/onboarding/subscription/checkout` passa a exigir `legal_consent: { accepted: true, terms_version, privacy_version }`. Sem `accepted: true`, a API responde 422 `legal_consent_required` antes de qualquer outra validação do checkout. **BREAKING** para clientes que não mandam o campo: a loja precisa subir antes da API (ver Impact).
- Cada checkout aceito grava dois consentimentos (`privacy_policy` e `terms`, `granted`) na trilha `privacy_consents`, com a origem nova `checkout`, no mesmo formato do cadastro.
- A versão gravada segue a regra que já vale no cadastro: a versão enviada, quando é uma versão publicada no mercado do checkout. Se não for, a API grava a versão atual e registra um aviso no log. Uma versão desconhecida nunca bloqueia a compra.
- O registro acontece depois das validações do checkout e antes de criar ou reaproveitar a assinatura no Stripe. Se a gravação falhar, o checkout falha (503) sem cobrar. Não há compra sem registro de aceite.
- Na loja (change irmão `add-checkout-legal-consent` em `eden-bowls`): a caixa desmarcada acima do botão "Fazer pedido" ("Place Order"), sempre desmarcada ao abrir o checkout, com links para as duas páginas. O botão só fica ativo com a caixa marcada. O payload passa a levar as versões que a loja carregou.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `legal-documents`: o requisito "Consent records the version the customer saw" passa a valer também para o checkout, e um requisito novo exige o aceite para concluir a compra.

## Impact

- **API:** `src/api/validators/onboarding-subscription-checkout.validator.js`, `src/services/onboarding-subscription-checkout.service.js` (dependência nova do `PrivacyService`, ligada em `src/index.js`), `src/services/privacy.service.js` (gravação com origem `checkout`) e `src/core/privacy.js` (`CONSENT_SOURCES`).
- **Banco:** nenhuma migration. `privacy_consents.source` é `varchar(32)` sem enum.
- **Contrato:** a rota já existe e não muda de caminho nem de método. `docs/api-routes.json` não muda, e o painel não precisa de `contract:sync`.
- **Loja:** `src/pages/checkout/Checkout.tsx`, `SubscriptionCheckoutPayload` em `src/services/onboardingApi.ts` e os textos em `src/i18n/*.json`, no change irmão.
- **Ordem de deploy:** loja primeiro, API depois. A API atual descarta campos desconhecidos (zod), então a loja nova funciona com a API antiga. Já a loja antiga, com a API nova, seria bloqueada pelo 422.
- **Painel:** nenhuma mudança. O detalhe do usuário já lista os consentimentos com `status · source`, e a origem `checkout` aparece ali como texto.
