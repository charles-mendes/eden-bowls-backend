# Pontos faltantes do e-mail

P0 já dispara: OTP, convite, privacidade, pedido confirmado, aviso admin de nova assinatura, falha de pagamento (cliente) e enviado UPS. Mapa em [PONTOS_DE_DISPARO.md](./PONTOS_DE_DISPARO.md). Templates P1/P2 existem no preview; a maior parte abaixo ainda **não tem produto**.

Este arquivo é o backlog do que precisa de **decisão**, **tela no painel** ou **API/loja**. Não é especificação de implementação.

## Já resolvido (não repetir)

- HTML + SMTP (`otpMailer.sendMail`)
- Destinatário ops: `MAIL_OPS_TO` (env). Vazio = skip do aviso admin
- CTA loja: `STORE_APP_URL` + `/dashboard/plans`
- Claims atômicos: tabela `subscription_mail_claims`
- Pedido / admin / falha / UPS shipped

## 1. Decisões (bloquear ou definir antes de construir)

| Tema | Hoje | Precisa decidir |
|---|---|---|
| Recibo Stripe vs carta Eden | Sem toggle no código. Checkout manda `receipt_email: null`. Dashboard Stripe pode ainda enviar invoice/recibo | Manter recibo Stripe, desligar Customer emails, ou só a carta Eden. Risco: cliente recebe **dois** e-mails no primeiro ciclo |
| Aviso admin de falha de pagamento | Woo tinha `admin-failed-order`. Node só manda ao **cliente** | Ops quer carta em `MAIL_OPS_TO` quando a cobrança falha? |
| Enviado no Brasil | Carta “shipped” só após label **UPS/US**. BR tem cotação de frete, não label → mail | Qual evento BR dispara “saiu para entrega”? Correios? Marcação manual no painel? Ou documentar US-only até existir transportadora |
| Greeting (`firstName`) | Ledger não tem `customerName`. Mail lê `address.name` / recipient; senão “oi” / “there” | Copiar `first_name` do onboarding/Stripe Customer para o ledger no checkout, ou aceitar o fallback |
| CTA do e-mail admin | `ADMIN_APP_URL` aponta à **raiz** do painel | Deep-link para `/billing/subscriptions/:id` (a tela já existe) |
| `MAIL_OPS_TO` | Só env. Sem UI | Quem edita em QA/prod: `.env` / secrets, ou tela de settings? |
| Fila / retry SMTP | Sync Nodemailer. Se SMTP falha **depois** do claim, Stripe já teve 200; `sent_at` fica NULL | Só reenvio manual no admin (abaixo), ou fila + worker? P0 documentou o buraco; P1 sugeriu o botão |
| Termos / Privacidade | Ainda prometem pedido, cobrança e entrega de forma ampla; ciclo P1 e reset **não** existem | Recortar o legal até P1+reset, ou deixar e aceitar o gap. Os `.md` legais **não** foram editados no P0 |

## 2. Telas no painel administrativo (não existem)

Hoje o menu (`eden-bowls-admin/src/lib/menu.ts`) não tem nada de e-mail. O único “reenviar” é **convite de staff** em Clientes.

Sugerido, no grupo **Billing** (ou **Equipe**, se for só ops):

### 2.1 E-mails / claims (P1 operacional — o mais urgente)

**Por quê:** o P0 deixa claims com `sent_at` NULL invisíveis. Sem tela, o time só acha no MySQL.

| Peça | Detalhe |
|---|---|
| Rota | `/billing/mail` (lista) + ação na detalhe da assinatura |
| Menu | item “E-mails” em Billing; papéis `admin` / `operator` (mutação); `readonly` só lê |
| Lista | tabela: data do claim, assinatura, template, `reference_id`, e-mail destino, `claimed_at`, `sent_at` (badge Enviado / Falhou / Pendente) |
| Filtros | `sent_at` NULL, template, `stripe_subscription_id` / e-mail |
| Reenviar | botão só se `sent_at` IS NULL (ou “forçar novo send” com **novo** `reference_id`, sem reprocessar Stripe). `readonly` esconde |
| API backend | hoje o repositório só tem `claimMailSend` + `markSent`. Falta `GET` lista + `POST .../resend` |

Na **detalhe da assinatura** (`/billing/subscriptions/:id`, já existe): bloco “E-mails desta assinatura” com o mesmo reenvio. Evita o staff sair da ficha do cliente.

### 2.2 Settings de destinatários (opcional)

Não há tela de configuração SMTP nem de `MAIL_OPS_TO`. Continua aceitável via env. Só vale UI se ops não puder mexer em secrets.

Não copiar paleta da loja: o painel continua grotesk + cinzas (skill do admin).

### 2.3 O que **não** precisa de tela nova

- Preview das cartas: já é HTML estático em `docs-new/Email/previews/`
- Editar HTML no painel: fora (código + preview script)
- Dashboard de entrega Brevo: fica no provedor, não no SPA

## 3. Loja + API ainda stub

### Reset de senha (produto completo, não só mail)

A UI em `AuthModal.handleForgotSubmit` valida o e-mail e **só troca de tela** (`forgotConfirm`), como se o link tivesse sido enviado.

Falta, nesta ordem:

1. `POST /api/v1/auth/password/forgot` (não enumerar se o e-mail existe)
2. Token com TTL + persistência
3. `POST /api/v1/auth/password/reset`
4. Página na loja que lê o token (hoje não há rota)
5. Ligar `buildPasswordResetEmail` (template já existe)
6. Trocar o stub do `AuthModal` para chamar a API de verdade

Sem isso, a carta de reset **não pode** disparar.

### Troca de e-mail da conta (P2)

`PUT/PATCH /api/v1/profile/email` atualiza o e-mail WP. Não manda confirmação e não sincroniza o Customer no Stripe. Template P2 no catálogo; decisão: confirmar no endereço **novo**, no **antigo**, ou os dois.

## 4. Cartas P1 — template pronto, hook não ligado

| Carta | Evento | Onde ligar | Observação |
|---|---|---|---|
| Renovação | `invoice.paid` + `billing_reason=subscription_cycle` | `handleInvoicePaid` | Hoje o ciclo só adiciona linha de frete no draft |
| Pausa | `POST /subscriptions/:id/actions` pause | após Stripe OK | |
| Retomar | mesma rota, reactivate | após Stripe OK | |
| Cancelamento | cancel / cancel-at-period-end | mesma rota | Definir: imediato vs fim do período (textos diferentes?) |
| Mudança de plano | `POST .../edit/commit` | se não `edit_payment_pending`; senão no `invoice.paid` com `promotedPending` | **Não** usar o ramo P0 `subscription_create` |

Cada uma precisa de `template` novo na unique de claims (ex. `renewal`, `paused`, `resumed`, `cancelled`, `plan_changed`) para não colidir com P0.

## 5. P2 (depois, sem tela obrigatória agora)

- Reembolso (`charge.refunded` / refund Stripe) — só se o fluxo de refund existir de verdade
- Método de pagamento atualizado (`update_payment_method` já existe, sem mail)
- Lembrete de renovação (opt-in / marketing: fora do transacional obrigatório)
- Skip: a API não tem skip; não inventar carta

## 6. Ordem sugerida

1. **Painel: lista + reenvio de claims** — fecha o buraco SMTP do P0
2. Deep-link do e-mail admin para a ficha da assinatura
3. Decidir Stripe receipts vs Eden (5 minutos no Dashboard, não é código)
4. Ligar P1 (renovação → pause/resume/cancel → plan-changed)
5. Reset de senha (API + página + AuthModal)
6. Evento de “enviado” no BR, se for produto
7. P2 + alinhar Termos/Privacidade com o que realmente sai

## 7. Fora de escopo (não construir)

POS, downloads, stock, nota de pedido Woo, máquina `processing / completed / on-hold`, fila SendGrid, editor de template no admin.
