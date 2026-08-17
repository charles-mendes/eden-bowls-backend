# Envio de e-mail OTP (versao atual Node.js)

## Escopo

Unico e-mail transacional do backend Node: codigo OTP de 6 digitos no cadastro e no reenvio.

Origem no front-end (Node em `http://localhost:3000`):

- `eden-bowls/src/components/ui/AuthModal.tsx`
- `eden-bowls/src/services/onboardingApi.ts` (`checkEmailExists`, `registerAccount`, `resendOtpCode`, `verifyOtpCode`)
- `eden-bowls/src/contexts/AuthContext.tsx` (`login`, refresh, logout)

Base: `VITE_AUTH_API_BASE_URL` (senao `VITE_API_BASE_URL`, senao `http://localhost:3000` no `vite` dev). Nao usar `http://localhost:5173/api/...` — o Vite nao faz proxy de `/api`.

Contrato legado analisado:

- `docs/email/08-envio-email.md`
- `docs/token/07-auth-signup-login-frontend.md`

Arquivos Node:

- `src/api/routes/auth.routes.js`
- `src/api/validators/auth-register.validator.js`
- `src/services/auth.service.js`
- `src/infrastructure/repositories/auth.repository.js`
- `src/infrastructure/mailers/otp-mailer.js`
- `src/core/otp.js`
- `src/core/otp-email.js`
- `src/config/env.js`
- `src/index.js`

Nao ha `PUT /profile/email`, recuperacao de senha, fila, HTML nem SendGrid.

---

## 1) O que as rotas ja tinham (antes do SMTP)

As rotas publicas de signup ja existiam em `/api/v1/auth`:

| Rota | Ja fazia | Nao fazia |
|---|---|---|
| `POST /account/email-exists` | consulta `wp_users` | e-mail |
| `POST /register` | cria usuario `pending`, gera OTP, hash, devolve `uid` | SMTP real; metas WP; TTL 900; `requires_email_verification` |
| `POST /otp/verify` | compara hash, ativa, grava termos | `hsr_email_verified_at`; limpar contador de resend |
| `POST /otp/resend` | gera OTP novo e tenta enviar | teto 3 / 3600 s; codigo `already_active` |
| `POST /token` | bloqueia `pending` com `account_pending_activation` | — |

O mailer era so log em development e `throw` em production. Sem host SMTP o cadastro local nao mandava e-mail de verdade, e o codigo OTP ia parar no log de debug.

---

## 2) O que teve que ser alterado

Para a logica de `08-envio-email.md` caber no Node, as rotas **nao mudaram de path**. Mudou o comportamento interno.

| Item WP | Node antes | Node agora |
|---|---|---|
| SMTP Brevo 587 TLS | mailer fake | `nodemailer` com `AUTH_SMTP_*` (alias `HSR_SMTP_*`) |
| Subject / body texto puro | inexistente | `Your verification code` + `expires in {N} minutes` |
| TTL `max(900, env)` | 600 s direto | piso 900 s (`effectiveOtpTtlSeconds`) |
| Metas `hsr_activation_otp_hash/expires/attempts` | `hsr_otp_hash`, `hsr_otp_expires_at`, `hsr_otp_attempts` | chaves iguais ao HSR |
| HMAC `AUTH_SALT` | secret JWT | `AUTH_OTP_PEPPER` → `AUTH_SALT` → JWT → `hsr-default-salt` |
| Resend 3 / 3600 s por usuario | sem teto | `consumeResend`; `429 otp_resend_rate_limited` |
| Conta ja ativa no resend | `409 account_already_active` | `400 already_active` |
| `201` com `requires_email_verification` | so `uid/email/otp_expires_in` | campo incluido |
| `503 otp_email_failed` | `uid` | `uid` + `account_created: true` |
| `hsr_email_verified_at` na ativacao | nao | ISO no verify |
| Log de falha sem corpo/senha | logava OTP em debug | loga `to`, `subject`, `code`; redaction no pino |
| From / From name | — | `AUTH_MAIL_FROM` / `AUTH_MAIL_FROM_NAME` |

Paths **nao** registrados (e nao devem ser, pelo contrato Node):

- `/custom/v1/register`
- `/custom/v1/otp/resend`
- `/custom/v1/otp/verify`

O front chama `http://localhost:3000/api/v1/auth/*` (signup, OTP, token, refresh, logout).

---

## 3) Objetivo

1. Gerar OTP de 6 digitos no `register` / `otp/resend`.
2. Enviar o codigo por SMTP (Brevo no ambiente local, se as envs existirem).
3. Bloquear login JWT enquanto `hsr_activation_status = pending`.
4. Se o envio falhar depois de criar a conta, devolver `503 otp_email_failed` com `uid` — a conta **ja existe**.

---

## 4) Credenciais

O Node le `AUTH_*` e, se vazias, as aliases `HSR_*` do plugin WP. Nao copiar senha SMTP para o repositorio.

| Variavel Node | Alias WP | Default |
|---|---|---|
| `AUTH_SMTP_HOST` | `HSR_SMTP_HOST` | vazio (sem SMTP) |
| `AUTH_SMTP_PORT` | `HSR_SMTP_PORT` | `587` |
| `AUTH_SMTP_USER` | `HSR_SMTP_USER` | vazio |
| `AUTH_SMTP_PASS` | `HSR_SMTP_PASS` | vazio |
| `AUTH_SMTP_ENCRYPTION` | `HSR_SMTP_ENCRYPTION` | `tls` |
| `AUTH_SMTP_AUTH` | `HSR_SMTP_AUTH` | `true` |
| `AUTH_MAIL_FROM` | `HSR_MAIL_FROM` | vazio |
| `AUTH_MAIL_FROM_NAME` | `HSR_MAIL_FROM_NAME` | `Eden Bowls` |
| `AUTH_OTP_TTL_SECONDS` | `HSR_ACTIVATION_TTL` | env `600`, **efetivo 900** |
| `AUTH_OTP_MAX_ATTEMPTS` | `HSR_OTP_VERIFY_MAX_ATTEMPTS` | `5` |
| `AUTH_OTP_RESEND_MAX_ATTEMPTS` | `HSR_OTP_RESEND_MAX_ATTEMPTS` | `3` |
| `AUTH_OTP_RESEND_WINDOW_SECONDS` | `HSR_OTP_RESEND_WINDOW_SECONDS` | `3600` |
| `AUTH_OTP_PEPPER` | `AUTH_SALT` | JWT secret, senao `hsr-default-salt` |

Host vazio:

- development / test → nao envia; loga `to` + `subject` (sem OTP)
- production → falha; a rota vira `503 otp_email_failed`

`HSR_ACTIVATION_BASE_URL` continua letra morta: o e-mail nao leva link de ativacao.

---

## 5) Rotas que disparam e-mail

Permission: publica. Sem cookie, sem Bearer. O middleware JWT ignora essas paths.

Host local: `http://localhost:3000`.

| Metodo | Rota | Handler | Quando envia |
|---|---|---|---|
| POST | `http://localhost:3000/api/v1/auth/register` | `AuthService.register` | depois de criar usuario pendente |
| POST | `http://localhost:3000/api/v1/auth/otp/resend` | `AuthService.resendOtp` | reemissao |

`POST http://localhost:3000/api/v1/auth/otp/verify` **nao** envia. So consome o codigo.

`POST http://localhost:3000/api/v1/auth/account/email-exists` **nao** envia.

Login e sessao (tambem no Node, sem e-mail):

| Metodo | Rota |
|---|---|
| POST | `http://localhost:3000/api/v1/auth/token` |
| POST | `http://localhost:3000/api/v1/auth/refresh` |
| POST | `http://localhost:3000/api/v1/auth/logout` |
| GET | `http://localhost:3000/api/v1/auth/me` |

---

## 6) Fluxo de negocio

### 6.1 Registro

1. Zod: `username`, `email`, `password` (min 8, maiuscula, digito), `recaptchaToken` opcional (ignorado).
2. E-mail ja existe → `409 account_email_exists` com `field: email`.
3. Cria `wp_users` + metas `pending` + HMAC do OTP. **Nao** devolve o OTP no JSON.
4. `otpMailer.sendOtpEmail({ to, otp, expiresInSeconds })`.
5. SMTP falhou → HTTP `503` `otp_email_failed`, `data.uid`, `data.account_created: true`.
6. Sucesso → HTTP `201`:

```json
{
  "success": true,
  "data": {
    "uid": 12,
    "email": "jane@example.com",
    "otp_expires_in": 900,
    "requires_email_verification": true
  }
}
```

### 6.2 Reenvio

Body: `{ "uid": 123 }`.

1. `uid` invalido → `400`.
2. Usuario inexistente → `404 user_not_found`.
3. Status != `pending` → `400 already_active`.
4. Janela 3600 s, teto 3 → `429 otp_resend_rate_limited`. O `issue` **nao** zera esse contador.
5. Novo OTP (invalida o anterior, zera tentativas de verify).
6. SMTP falhou → `503 otp_email_failed`.
7. Sucesso → HTTP `200` com `uid` e `otp_expires_in`.

### 6.3 Verificacao (sem e-mail)

Compara HMAC, exige `termsAccepted` e `privacyAccepted`, marca `hsr_activation_status = active`, grava consents + `hsr_email_verified_at`, apaga hash/expiracao/attempts/resend.

A conta **ainda nao esta autenticada**. O front precisa chamar `POST http://localhost:3000/api/v1/auth/token`.

Usuario `pending` no login/refresh/`me` → `403 account_pending_activation` / `401 unauthorized`.

---

## 7) Persistencia do OTP

`AuthService` gera `randomInt(0, 999999)` com pad de 6 digitos.

Hash: `HMAC-SHA256(otp, AUTH_OTP_PEPPER)`.

TTL efetivo: **900 s** (15 min) mesmo se `.env` tiver `600`.

| Meta | Valor |
|---|---|
| `hsr_activation_status` | `pending` ate o verify |
| `hsr_activation_otp_hash` | HMAC |
| `hsr_activation_otp_expires` | unix time |
| `hsr_activation_otp_attempts` | `0` a cada emissao |
| `hsr_activation_otp_resend_count` | teto de reenvio |
| `hsr_activation_otp_resend_window_start` | unix time da janela |
| `hsr_email_verified_at` | ISO, so no verify |
| `hsr_marketing_opt_in` / `hsr_terms_accepted` / `hsr_privacy_accepted` | `1`/`0` no verify |

O codigo em claro **nao** e persistido.

---

## 8) Conteudo do e-mail

| Campo | Valor |
|---|---|
| Destinatario | `user_email` |
| Subject | `Your verification code` |
| Body | `Your Eden Bowls verification code is {OTP}. This code expires in {N} minutes.` |
| `{N}` | `floor(TTL / 60)` → **15** |
| Content-Type | `text/plain` |
| HTML / template / anexo / link | nao |

---

## 9) Transporte SMTP

`createOtpMailer` (nodemailer):

```
AUTH_SMTP_HOST / HSR_SMTP_HOST vazio?
  production → throw
  outro ambiente → skip + log (sem OTP)
senao:
  host / port (587)
  requireTLS se encryption=tls
  auth user/pass se AUTH_SMTP_AUTH true
  From = AUTH_MAIL_FROM + AUTH_MAIL_FROM_NAME
```

Falha do `sendMail`:

- pino `error` com `to`, `subject`, `code`
- **nao** loga senha SMTP nem corpo
- a rota responde `503 otp_email_failed`

Sem retry. O usuario chama `/otp/resend` (countdown de 10 s no `AuthModal`).

---

## 10) Rate limits ligados ao e-mail

| Escopo | Limite | Onde |
|---|---|---|
| HTTP geral Node | 300 / 60 s | `express-rate-limit` em `app.js` |
| resend por usuario | 3 / 3600 s | `AuthService.consumeResend` |
| tentativas de codigo | 5 por emissao | `AuthService.verifyOtp` |
| TTL do OTP | minimo 900 s | `effectiveOtpTtlSeconds` |
| countdown UI de resend | 10 s | `AuthModal` |
| `POST /register` dedicado 5 / 900 s | **nao** (so o limite global) | gap vs WP |
| `POST /otp/verify` HTTP 5 / 600 s | **nao** (so tentativas por emissao) | gap vs WP |
| `email-exists` | sem limite extra | enumeracao, igual ao WP |

---

## 11) Diagrama

```mermaid
sequenceDiagram
    autonumber
    participant UI as AuthModal
    participant API as POST http://localhost:3000/api/v1/auth
    participant AS as AuthService
    participant DB as wp_users / wp_usermeta
    participant M as otp-mailer
    participant SMTP as smtp-relay.brevo.com

    UI->>API: POST /register
    API->>AS: register(payload)
    AS->>DB: user pending + HMAC OTP TTL 900s
    AS->>M: sendOtpEmail(to, otp)
    alt SMTP host configurado
        M->>SMTP: 587 STARTTLS + AUTH
        SMTP-->>M: ok / erro
    else host vazio (dev)
        M-->>AS: skip (sem OTP no log)
    end
    alt envio ok
        AS-->>UI: 201 uid + otp_expires_in 900
    else envio falhou
        AS-->>UI: 503 otp_email_failed (conta ja criada)
    end

    UI->>API: POST /otp/verify
    API->>AS: verifyOtp
    Note over AS: sem e-mail; status=active

    opt reenvio
        UI->>API: POST /otp/resend
        API->>AS: consumeResend + issue + sendOtpEmail
    end
```

---

## 12) O que este fluxo **nao** faz

| E-mail / recurso | Estado Node |
|---|---|
| Confirmacao de cadastro / OTP | implementado (texto puro, SMTP) |
| Recuperacao de senha | **nao** (o modal so troca de tela) |
| Confirmacao de pedido / envio / renovacao | WooCommerce / Stripe, fora deste backend |
| SDK SendGrid | **nao**. SMTP (Brevo no local) |
| Fila / retry | **nao** |
| Template HTML | **nao** |
| Link de ativacao | env morta |
| `PUT /profile/email` + novo OTP | **nao** |
| Rate limit HTTP dedicado de register/verify | **nao** (so global 300/60 e teto de resend por uid) |
| Front em `/api/v1/auth/register\|otp/*` | **sim**. `onboardingApi.ts` usa `http://localhost:3000/api/v1/auth` |

---

## 13) Pontos de atencao

1. Preencher `AUTH_SMTP_*` (ou reutilizar `HSR_SMTP_*`) no `.env` do Node. Sem host, production nao envia OTP.
2. From de Gmail pelo relay Brevo continua com risco de spam se o dominio nao estiver autenticado no Brevo. Nao versionar a senha SMTP.
3. Conta e criada **antes** do SMTP. `503` nao significa que o usuario nao existe; o front precisa guardar `uid` para o resend.
4. TTL no `.env.example` (`600`) e menor que o piso do codigo (`900`). `otp_expires_in` na resposta e 900.
5. Se Node e WP compartilharem `wp_usermeta` no meio da migracao, `AUTH_OTP_PEPPER` precisa ser o `AUTH_SALT` do WordPress, senao um OTP emitido por um lado nao valida no outro.
6. Sem HTML, sem `List-Unsubscribe`. Corpo so com o codigo em claro.
7. `email-exists` continua sem rate limit proprio (enumeracao).
8. Recaptcha do WP (`HSR_RECAPTCHA_ENABLED`) nao foi portado: o campo chega vazio e e ignorado.
9. O `AuthModal` chama o Node em `http://localhost:3000`. Se o DevTools mostrar `http://localhost:5173/api/v1/auth/...`, `VITE_AUTH_API_BASE_URL` / `VITE_API_BASE_URL` nao esta definido e o Vite precisa ser reiniciado.
