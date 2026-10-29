# Tasks

Este change cobre a API. A caixa e o payload da loja ficam no change irmão `add-checkout-legal-consent` em `eden-bowls`, que sobe antes (design, Migration Plan). Não há migration. Rode só os testes relacionados (`npx jest --runTestsByPath tests/<arquivo>`).

## 1. Trilha de consentimento

- [x] 1.1 Acrescentar `'checkout'` a `CONSENT_SOURCES` em `src/core/privacy.js` sem mudar `src/api/validators/privacy.validator.js` (decisão 5). Verificar com `tests/privacy.routes.test.js`: um teste novo confirma que `checkout` está em `CONSENT_SOURCES` e que a rota pública de consentimento recusa `source: 'checkout'` com 400 (o erro de payload dessa rota).
- [x] 1.2 Criar `PrivacyService.recordCheckoutConsents({ userId, market, privacyVersion, termsVersion, ipHash, userAgent })`, que grava `privacy_policy` e `terms` `granted` com `source: 'checkout'` e as versões de `consentVersion`, sem `marketing_email`. Verificar com `tests/privacy.service.test.js`: os cenários "Checkout with a version the store loaded before a publication" e "Checkout with an unknown version" (versão atual gravada e `logger.warn` chamado).

## 2. Validação do payload

- [x] 2.1 Aceitar `legal_consent: { accepted, terms_version, privacy_version }` em `src/api/validators/onboarding-subscription-checkout.validator.js` (versões opcionais, até 32 caracteres) e responder 422 `legal_consent_required` quando `accepted` não for `true`. Devolver `legal_consent` normalizado no payload (decisões 1 e 2). Verificar com `tests/onboarding-subscription-checkout.routes.test.js`: os cenários "Box not ticked" e "Old client without the field" respondem 422 com `details.code` `legal_consent_required`, e o service não é chamado.

## 3. Checkout

- [x] 3.1 Montar o `requestContext` na rota do checkout (`contextFromRequest` com `detectRequestIp` e `trustProxy`, como em `auth.routes.js`), passar `checkout({ userId, payload, requestContext })` e ligar o `privacyService` ao service por atribuição tardia em `src/index.js` (decisão 6). Verificar com `tests/onboarding-subscription-checkout.routes.test.js`: o service recebe `requestContext` com `ipHash` e `userAgent`.
- [x] 3.2 No service, conferir `payload.legal_consent.accepted` e chamar `recordCheckoutConsents` logo depois de `lockStore.acquire`, antes de `evaluateCheckoutReuse`, com o mercado do endereço de entrega. Sem `privacyService` ou com erro na gravação, responder 503 `legal_consent_unavailable` (decisões 3, 4 e 7). Verificar com `tests/onboarding-subscription-checkout.service.test.js`:
  - "Accepted checkout": a gravação vem antes de `createOnboardingSubscription` e antes do caminho de reaproveitamento.
  - "Checkout refused by another validation": área de entrega não verificada, nenhuma gravação.
  - "Consent trail unavailable": 503 sem chamar `createOnboardingSubscription`.
  - Uma nova tentativa com o mesmo `attempt_id` grava de novo (decisão 8).
  - Os testes atuais do checkout passam com `legal_consent` aceito nas fixtures.

## 4. Integração

- [x] 4.1 Conferir o contrato: rodar `npx jest --runTestsByPath tests/api-routes-manifest.test.js` e confirmar que `docs/api-routes.json` não muda (a rota não muda de caminho nem de método). Depois rodar `npx jest --changedSince=origin/main` e corrigir as falhas.
