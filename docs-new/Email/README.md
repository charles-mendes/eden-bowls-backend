# Envio de e-mail (OTP) no backend Node

Documentacao do fluxo atual de OTP + SMTP no `eden-bowls-backend`.

A analise antiga em `docs/email/08-envio-email.md` descrevia o plugin WordPress `headless-secure-registration`. Este diretorio documenta o que o Node faz hoje, o que as rotas de auth ja tinham, e o que ainda falta para paridade com o WP.

O Node **dispara** OTP, convite de staff, verificacao de privacidade, pedido confirmado, aviso admin de nova assinatura, falha de pagamento e envio UPS (HTML + texto). Mapa de cada carta: [PONTOS_DE_DISPARO.md](./PONTOS_DE_DISPARO.md). O que ainda falta (decisoes, tela de claims no painel, P1, reset): [PONTOS_FALTANTES.md](./PONTOS_FALTANTES.md). Catalogo Woo vs Eden e previews: [CATALOGO_EMAILS_WP_VS_NODE.md](./CATALOGO_EMAILS_WP_VS_NODE.md). Nao ha fila, retry automatico apos SMTP, SDK SendGrid, nem API de recuperacao de senha.

Base local do Node: **`http://localhost:3000`**. O Vite (`http://localhost:5173`) e so a UI; auth nao passa por proxy.

| Rota | Metodo | Envia e-mail? | Documento |
|---|---|---|---|
| `http://localhost:3000/api/v1/auth/register` | POST | sim, apos criar usuario `pending` | [ENVIO_EMAIL_OTP.md](./ENVIO_EMAIL_OTP.md) |
| `http://localhost:3000/api/v1/auth/otp/resend` | POST | sim, reemissao | [ENVIO_EMAIL_OTP.md](./ENVIO_EMAIL_OTP.md) |
| `http://localhost:3000/api/v1/auth/otp/verify` | POST | nao | [ENVIO_EMAIL_OTP.md](./ENVIO_EMAIL_OTP.md) |
| `http://localhost:3000/api/v1/auth/account/email-exists` | POST | nao | [ENVIO_EMAIL_OTP.md](./ENVIO_EMAIL_OTP.md) |
| `http://localhost:3000/api/v1/auth/token` | POST | nao | login JWT; bloqueia `pending` |
| `http://localhost:3000/api/v1/auth/refresh` | POST | nao | |
| `http://localhost:3000/api/v1/auth/logout` | POST | nao | |
| `http://localhost:3000/api/v1/auth/me` | GET | nao | |

## Mudanca de modelo

| Aspecto | WordPress (legado) | Node (atual) |
|---|---|---|
| Disparo | `wp_mail()` + `phpmailer_init` | `nodemailer` em `createOtpMailer` |
| SMTP | `HSR_SMTP_*` via `getenv()` | `AUTH_SMTP_*` (aceita alias `HSR_SMTP_*`) |
| Provider local | Brevo `smtp-relay.brevo.com:587` TLS | o mesmo host, se as envs estiverem preenchidas |
| OTP hash | HMAC-SHA256 com `AUTH_SALT` | HMAC-SHA256 com `AUTH_OTP_PEPPER` (fallback `AUTH_SALT` / JWT secret / `hsr-default-salt`) |
| TTL efetivo | `max(900, HSR_ACTIVATION_TTL)` | `max(900, AUTH_OTP_TTL_SECONDS)` |
| Metas | `hsr_activation_otp_*` | as mesmas chaves WP |
| Envelope | `{ success, data }` / `{ success: false, error }` | igual, em `/api/v1/auth/*` de signup |
| Front | `onboardingApi.ts` + `AuthContext` | `VITE_AUTH_API_BASE_URL` (fallback `VITE_API_BASE_URL` / `http://localhost:3000` no dev). Signup, OTP, login, refresh e logout no Node |

## Fontes no codigo

- Rotas: `src/api/routes/auth.routes.js`
- Service: `src/services/auth.service.js`
- Persistencia OTP: `src/infrastructure/repositories/auth.repository.js`
- Transporte: `src/infrastructure/mailers/otp-mailer.js`
- Corpo / TTL: `src/core/otp-email.js`
- HMAC: `src/core/otp.js`
- Envs: `src/config/env.js`, `.env.example`
- Wiring: `src/index.js`
