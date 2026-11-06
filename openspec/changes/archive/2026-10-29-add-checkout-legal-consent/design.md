# Design

## Context

- O cadastro grava o aceite em `PrivacyService.recordOtpConsents`. A rota (`auth.routes.js`) monta o contexto com `privacyService.contextFromRequest({ ip: detectRequestIp(...), userAgent })` e o `AuthService` repassa `ipHash` e `userAgent`. A versão sai de `consentVersion(market, kind, sent)`: a enviada, se estiver publicada no mercado, ou a atual, com aviso no log.
- `privacy_consents` é append-only, e `source` é `varchar(32)` sem enum no banco. `CONSENT_SOURCES` em `src/core/privacy.js` lista as origens conhecidas.
- O checkout (`OnboardingSubscriptionCheckoutService.checkout`) recebe só `{ userId, payload }`. Ele valida o estado, a área de entrega, a fase da vida e o e-mail, resolve o cupom (que pode consultar o Stripe), pega o lock por usuário e só então reaproveita a referência guardada (`buildReusedCheckout`) ou cria a assinatura (`createOnboardingSubscription`). O mercado vem do país do endereço de entrega (`resolveStripeAccountFromCountry`).
- O validator usa `z.object`, que descarta chaves desconhecidas. A API de hoje aceita um payload com `legal_consent` sem erro.
- Em `src/index.js`, o `PrivacyService` é criado depois do service de checkout. O `AuthService` recebe o `privacyService` por atribuição tardia (`authService.privacyService = privacyService`).

## Goals / Non-Goals

**Goals:**
- O mesmo registro do cadastro, com outra origem, sem tabela nova.
- Nenhuma compra sem registro de aceite.

**Non-Goals:**
- Guardar o aceite no pedido ou no ledger (`stripe_subscriptions`). A trilha de consentimento já liga usuário, versão e momento.
- Pedir novo aceite fora do checkout quando uma versão nova é publicada (por exemplo, para assinantes ativos).
- Marcar a caixa sozinha para quem já aceitou no cadastro.
- Exibir a origem `checkout` com um rótulo no painel.

## Decisions

1. **Campo `legal_consent` aninhado, em snake_case.** O payload do checkout já é snake_case (`payment_method_id`, `attempt_id`). Um objeto `{ accepted, terms_version, privacy_version }` mantém os três juntos. Alternativa: `termsAccepted`/`termsVersion` soltos, como no cadastro. Foi descartada porque misturaria convenções no mesmo payload.

2. **A recusa sem aceite fica no validator.** `parseOnboardingSubscriptionCheckoutInput` responde 422 `legal_consent_required` antes do service, como já faz com `invalid_payment_method`, e a rota já devolve `details.code`. Assim nada do checkout roda, nem lock, nem Stripe. O service confere `payload.legal_consent.accepted` de novo, para não depender de quem o chama.

3. **O registro fica dentro do lock, antes de reaproveitar ou criar a assinatura.** Logo depois de `lockStore.acquire` e antes de `evaluateCheckoutReuse`. Um checkout recusado pelas validações não grava nada, e um aceito grava antes de qualquer cobrança. Alternativa: gravar depois do sucesso no Stripe. Foi descartada porque uma falha entre a cobrança e a gravação deixaria uma compra sem registro.

4. **A falha ao gravar bloqueia (503 `legal_consent_unavailable`).** No cadastro, um erro em `recordOtpConsents` já interrompe o fluxo. No checkout vale o mesmo, porque o aceite é condição da compra. Se o `privacyService` não estiver ligado, também 503: a compra não segue sem trilha.

5. **`PrivacyService.recordCheckoutConsents({ userId, market, privacyVersion, termsVersion, ipHash, userAgent })`.** Reaproveita `consentVersion` e grava `privacy_policy` e `terms` com `source: 'checkout'`. Não grava `marketing_email`: o checkout não pergunta isso. `'checkout'` entra em `CONSENT_SOURCES`. O validator público de privacidade (`privacy.validator.js`) não muda, então a loja não consegue gravar `checkout` por outra rota.

6. **O contexto da requisição entra pela rota.** A rota do checkout monta `requestContext` como em `auth.routes.js` (`contextFromRequest` com `detectRequestIp` e `trustProxy`) e passa `checkout({ userId, payload, requestContext })`. O `privacyService` passa a ser dependência da rota e do service. No service, entra por atribuição tardia em `src/index.js`, como no `AuthService`.

7. **O mercado do registro é o do endereço de entrega.** É o mesmo mercado da conta Stripe e da cobrança. Se a loja mandar a versão de outro mercado (por exemplo, o site .com.br com endereço nos EUA), a versão não estará publicada naquele mercado. A API grava a atual e registra o aviso: a compra não é bloqueada.

8. **Cada tentativa grava de novo.** Uma nova tentativa depois de 3DS, de uma nova cotação de frete ou de um reaproveitamento é um novo clique com a caixa marcada. A trilha é append-only, e linhas repetidas são corretas. Alternativa: deduplicar por `attempt_id`. Foi descartada porque exigiria uma coluna nova sem ganho legal.

## Risks / Trade-offs

- [Loja antiga em cache depois do deploy da API não consegue comprar] → Fazer o deploy da loja antes. A API antiga ignora `legal_consent`, então a loja nova funciona com ela. Depois do deploy da API, uma aba aberta com o bundle antigo recebe 422 e a mensagem genérica de erro do checkout; recarregar a página resolve.
- [Linhas repetidas na trilha a cada tentativa] → Esperado (decisão 8). O volume é de duas linhas por clique em "Fazer pedido".
- [Versão de outro mercado gravada como a atual] → Fica o aviso no log com a versão recebida (decisão 7). Não acontece no fluxo normal, em que o domínio e o endereço são do mesmo mercado.

## Migration Plan

1. Fazer o deploy do change irmão da loja (caixa e payload com `legal_consent`).
2. Fazer o deploy da API. Não há migration.
3. Rollback: voltar a API para a versão anterior. A loja nova continua funcionando, porque o campo extra é ignorado.
