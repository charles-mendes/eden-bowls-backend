# Catálogo de e-mails: WooCommerce vs Node

Checklist extraído do zip de previews WordPress cruzado com o que o backend Node envia hoje. Os previews HTML da marca Eden ficam em [`previews/index.html`](./previews/index.html).

## O que o anexo WP é

A pasta `email-previews` **não é arte da Eden**. É o pacote **core WooCommerce** em HTML estático:

- Logo **“Loja Exemplo”**, roxo `#7f54b3`, Helvetica/Arial
- Produtos mock Camiseta / Caneca, pedido `#54127`
- Sem Tenor Sans, Quicksand, musgo/argila, SKUs de ração
- Sem e-mails de WooCommerce Subscriptions

Serve como **inventário de eventos**, não como layout a copiar.

| Tipo | Arquivos |
|---|---|
| E-mails + índice | 21 (`customer-*`, `admin-*`, `index.html`) |
| Parciais Woo | 11 (`email-header`, `email-order-details`, …) |

## O que o Node dispara hoje

Transporte: Nodemailer → Brevo SMTP. Agora com **HTML + texto**.

| E-mail | Assunto (pt-BR) | Quando | HTML |
|---|---|---|---|
| OTP | Seu código de verificação Eden Bowls | `POST /auth/register` e `/otp/resend` | sim, ligado |
| Convite staff | Seu acesso ao painel Eden Bowls (PT se `locale` pt) | admin cria / reenvia convite | sim, ligado; default EN |
| Privacidade | confirme sua identidade | staff dispara verificação | sim, ligado |

**Ainda não disparam** (template pronto, sem webhook/API): reset de senha, pedido confirmado, falha de pagamento, enviado + rastreio, admin nova assinatura, renovação, pausa, retomar, cancelamento, mudança de plano.

`ADMIN_EMAILS` continua allowlist de papéis, **não** destinatário de “novo pedido”.

## Manter / adaptar / descartar (Woo → Stripe)

| Template Woo | Decisão | Evento Eden |
|---|---|---|
| `customer-processing-order` + `customer-completed-order` | Adaptar em **um** e-mail | primeiro `invoice.paid` |
| `customer-invoice` | Adaptar | renovação / recibo de ciclo |
| `customer-failed-order` + `admin-failed-order` | Adaptar | `invoice.payment_failed` |
| `customer-cancelled-order` + `admin-cancelled-order` | Adaptar | cancel / cancel-at-period-end |
| `customer-refunded-order` | P2, só se refund existir | — |
| `customer-on-hold-order` | Não replicar status Woo | vira falha / retry Stripe |
| `customer-fulfillment-*` | Adaptar | shipment UPS + tracking |
| `customer-new-account` | Não copiar | no Node o equivalente é **OTP** |
| `customer-reset-password` | Adaptar | API ainda é stub na UI |
| `customer-note` | Fora por agora | suporte |
| `admin-new-order` | Adaptar | admin nova assinatura paga |
| POS, downloads, stock (6+) | Descartar | a loja não tem PDV, arquivo digital nem lista de espera |
| Parciais `email-*` | Descartar | blocos Woo, não cartas |

Não copiar a máquina `processing / completed / on-hold`. Billing é Stripe + ledger.

## Catálogo Eden

### P0 — operação (templates criados)

- OTP (HTML, pt-BR default)
- Reset de senha
- Pedido / assinatura confirmado
- Falha de pagamento
- Enviado + rastreio
- Admin: nova assinatura paga

### P1 — ciclo (templates criados)

- Recibo de renovação
- Pausa / retomar
- Cancelamento
- Mudança de plano
- Convite staff e privacidade em HTML

### P2 — depois

- Confirmação de troca de e-mail
- Método de pagamento atualizado
- Reembolso
- Lembrete de renovação (opt-in)

### Fora

POS, downloads, stock, skip (skip não existe na API).

## Lacunas de configuração (envio)

Templates **não** ligam sozinhos. Falta:

1. `html` no transporte — **feito** neste passo
2. Destinatário operacional para admin (hoje `ADMIN_EMAILS` não dispara mail)
3. API de reset de senha (a UI `AuthModal` ainda é stub)
4. Hooks: `invoice.paid`, `invoice.payment_failed`, pause/cancel, criação de shipment UPS
5. Decisão Stripe: manter recibo Stripe, desligar, ou só a carta Eden
6. `STORE_APP_URL` (ou similar) para CTAs `/dashboard` e `/reset-password`

Gerar previews:

```bash
node src/scripts/render-email-previews.js
```

## Compliance — urgência própria

Os Termos prometem e-mails que o Node **ainda não envia** nos fluxos de pedido/cobrança/entrega. Isso não se resolve só com o backlog P0: o texto legal já está à frente do produto.

Promessas atuais:

- `eden-bowls/src/content/pt-br/legal/terms-of-use.md`: *“Podemos enviar e-mails transacionais essenciais (confirmação de conta, pedido, cobrança e entrega).”*
- EN equivalente em `terms-of-use.md`
- Privacidade PT/EN: OTP, confirmações e **atualizações de entrega**; Brevo como SMTP

O que o produto cumpre **agora**: OTP (e convite staff / verificação de privacidade). Pedido, cobrança e entrega: template pronto, **sem disparo**.

### Mitigação sugerida (não aplicada neste passo)

Enquanto o P0 não dispara, recortar os Termos para o que existe:

**PT:** *“Podemos enviar e-mails essenciais de conta, como o código de verificação (OTP). Confirmações de pedido, cobrança e entrega passam a ser enviadas quando esses fluxos estiverem ativos.”*

**EN:** *“We may send essential account emails, such as the verification code (OTP). Order, billing, and delivery confirmations will be sent once those flows are live.”*

Privacidade: limitar “atualizações de entrega” à mesma ressalva, ou tirar a linha até o e-mail de rastreio existir.

Quando pedido/cobrança/entrega dispararem, restaurar a redação completa. **Não editar** os `.md` legais nesta passagem.

## Direção visual

Uma **carta da cozinha**, não um recibo SaaS e não o roxo Woo.

| Token | Valor |
|---|---|
| Fundo | `#F5EFE2` |
| Papel | `#FFFBF4` |
| Texto | `#212E25` |
| Accent | `#7B876F` |
| Argila | `#B08F66` |
| Borda | `#D0C7AC` |
| Display | Tenor Sans → Georgia |
| Corpo | Quicksand → Helvetica |

Shell único em `src/core/email/html.js` (tabela 600px, masthead musgo, CTA sólido, texto + HTML). Sem `#7f54b3`. Sem Camiseta/Caneca: pet, sabores, ciclo, rastreio.

Abrir [`previews/index.html`](./previews/index.html) no navegador.
