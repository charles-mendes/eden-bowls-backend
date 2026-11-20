# SOP: pedidos de privacidade por e-mail

Canal público descrito na política: `hello@edenbowls.com`. **Não existe formulário anônimo.**

## O que o staff pode fazer

1. Abrir o ticket na fila **Privacidade** com o `user_id` interno (`channel = email`, `identity_status = unverified`).
2. Enviar a verificação **somente** para o e-mail cadastrado em `wp_users.user_email`.
3. Depois de resposta inequívoca **dessa** caixa, marcar identidade como `verified_account_email`, ou esperar o titular confirmar o link.
4. Tratar correção, prazo (uma prorrogação) e notas no próprio ticket.
5. Concluir acesso, exclusão ou portabilidade **só com identidade verificada**.

## O que o staff não pode fazer

- Completar acesso, exclusão ou portabilidade com identidade `unverified` (o backend recusa).
- Enviar o e-mail de verificação para o `From:` da mensagem se for diferente do e-mail da conta.
- Tratar coincidência de endereço de e-mail como prova de controle da caixa.
- Entregar dump ou apagar conta porque o solicitante “parece” o titular.
- Abrir portal público ou atender pedido sem vincular `user_id`.

Pedidos na sessão logada (`channel = in_app`) já nascem com `verified_session`.
