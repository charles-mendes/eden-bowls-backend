# Teste de fumaça do SMTP Brevo

`scripts/brevo-smoke.js` confirma que um conjunto de credenciais SMTP da Brevo funciona:

1. faz login no SMTP (`transport.verify()`);
2. envia um e-mail com assunto `[TESTE] Brevo produção <data ISO>` para o destinatário informado.

Usa o mesmo `nodemailer` e a mesma regra de TLS do backend (`src/infrastructure/mailers/otp-mailer.js`).
Nunca imprime a senha e mostra o usuário mascarado.

## Onde fica o `.env`

As credenciais ficam **fora do repositório**, num arquivo que só o seu usuário lê:

```
~/.eden-brevo-prod.env
```

Criar (uma vez):

```bash
touch ~/.eden-brevo-prod.env && chmod 600 ~/.eden-brevo-prod.env
nano ~/.eden-brevo-prod.env
```

Conteúdo (mesmos nomes de variável do backend):

```
AUTH_SMTP_HOST=smtp-relay.brevo.com
AUTH_SMTP_PORT=587
AUTH_SMTP_ENCRYPTION=tls
AUTH_SMTP_USER=<login SMTP da Brevo, ex.: 9xxxxx001@smtp-brevo.com>
AUTH_SMTP_PASS=<chave SMTP xsmtpsib-...>
AUTH_MAIL_FROM=<remetente de produção>
AUTH_MAIL_FROM_NAME=Eden Bowls
```

Nunca commite esse arquivo nem cole a chave em chat, issue ou PR.

## Como executar

Na raiz do `eden-bowls-backend` (Node 20+, por causa do `--env-file`):

```bash
node --env-file=$HOME/.eden-brevo-prod.env scripts/brevo-smoke.js seu-email@exemplo.com
```

Dentro do Claude Code, prefixe com `!` para a saída cair na conversa sem expor a chave:

```
! node --env-file=$HOME/.eden-brevo-prod.env scripts/brevo-smoke.js seu-email@exemplo.com
```

Para testar outro ambiente, crie outro arquivo (ex.: `~/.eden-brevo-qa.env`) e troque o `--env-file`.

## Saída esperada

```
host: smtp-relay.brevo.com | port: 587 | encryption: tls
user: 9xx***om (30 chars) | pass: definida (89 chars)
from: hello@edenbowls.com
OK: login SMTP aceito pela Brevo.
OK: enviado. messageId: <...> | response: 250 2.0.0 OK: queued as <...>
accepted: [ 'seu-email@exemplo.com' ] | rejected: []
```

Códigos de saída: `0` sucesso, `1` falha de login/envio, `2` faltam argumento ou variáveis.

## Erros comuns

| Saída | Causa provável |
|---|---|
| `FALHOU: EAUTH 535` | Usuário ou chave errados. A chave SMTP é `xsmtpsib-`, não a de API (`xkeysib-`). O usuário é o login SMTP, não o e-mail da conta. |
| Login OK, envio rejeitado | `AUTH_MAIL_FROM` não verificado ou domínio não autenticado na Brevo. |
| `ETIMEDOUT` / `ECONNECTION` | Porta 587 bloqueada na rede de onde o script roda. |

## Limite

Rodado na sua máquina, o teste valida chave, login e remetente, não a rede do servidor de produção.
Para isso, rode o mesmo comando no servidor apontando `--env-file` para o `.env` de produção,
ou dispare um OTP real (cadastro / esqueci a senha) e confira o log da API.

Depois do teste, se não for reutilizar: `rm ~/.eden-brevo-prod.env`.
