# Proposal

## Why

A designer entregou a v3 dos e-mails (PT e EN) com o selo circular no topo, o logo horizontal no rodapé e uma redação nova. O gerador atual já usa a paleta, Tenor Sans e Quicksand, mas o miolo ainda é o wordmark em texto e a cópia antiga ("Cão", "Da cozinha" como título de carta). Os clientes que já recebem OTP, convite, privacidade, confirmação, falha de pagamento e envio UPS continuam vendo o layout anterior.

## What Changes

- Atualizar os 13 builders existentes para a casca e a cópia de `new-designer-emails/pt` e `en`. Não criar um décimo quarto tipo de e-mail: cada HTML da designer corresponde a um builder que já existe.
- Trocar o cabeçalho em texto pelo `logo-circle@2x.png` (96px) e o rodapé em texto pelo `logo-horizontal@2x.png` (132×47), em URL https absoluta, como o `LEIA-ME.txt` pede. Base http, vazia ou com barra final fora do padrão não entra na carta: http e vazio omitem as tags de imagem; a barra final de um https é removida. Cada logo leva `alt="Eden Bowls"`. O texto plano repete os fatos do HTML, sem o logo. Manter fallback de fonte (Georgia / Segoe UI) porque cliente de e-mail bloqueia Google Fonts e SVG.
- Servir os dois PNGs uma vez em `public/email/` e referenciá-los nos templates. Não duplicar o arquivo por idioma.
- Preencher só dados que o fluxo já tem. "14 dias" e "Fresh Bowl" nos HTMLs são exemplo da designer. Plano sai de `plan_label`. Frequência sai de `subscription_term_months` (1, 3 ou 6 meses), não de um ciclo de 14 dias inventado.
- Omitir a linha "Retomada prevista" quando o Stripe não manda `pause_collection.resumes_at`. A pausa atual grava `behavior: void` sem data.
- Atualizar os previews em `docs-new/Email/previews` para PT e EN, gerados pelos mesmos builders.
- Escrever `.agents/skills/transactional-email-layout/SKILL.md` com o padrão real (o repositório nomeia skills assim, não `skill.md` na raiz).
- Não ligar envio novo. Renovação, pausa, retomada, cancelamento, troca de plano e reset de senha continuam só como template e preview. O change `complete-transactional-emails` é quem liga esses disparos.

## Capabilities

### New Capabilities

- `transactional-email-layout`: casca visual, cópia PT/EN, assets e campos visíveis dos 13 e-mails, sem mudar quem dispara cada um.

### Modified Capabilities

- Nenhuma. `admin-market-scope`, `catalog-product-delete` e `production-readiness` não descrevem e-mail.

## Impact

- `src/core/email/html.js`, `transactional-emails.js`, `otp-email.js`, `invite-email.js`, `privacy-email.js`, `preview-fixtures.js`, `src/scripts/render-email-previews.js`.
- `public/email/` e um static `/email` no Express. `EMAIL_ASSET_BASE_URL` aponta para a origem pública da API.
- Testes de template e do preview. Loja e painel não mudam de API.
- Fora deste change: fila de e-mail, reset de senha funcional, e-mail de envio no Brasil, novos status de produção.
