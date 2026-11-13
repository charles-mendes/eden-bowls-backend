## 1. Hora da entrega no minuto da saída

- [x] 1.1 `parseDeliveredAt` compara com a saída cortada no minuto e grava a saída quando a hora informada fica antes dela
- [x] 1.2 Testes: minuto da saída aceito e gravado como a saída; minuto anterior devolve 422

## 2. Gravar o nome de quem recebe pelo painel

- [x] 2.1 Método que lê a assinatura, recusa com 409 `recipient_name_present` quando já há nome, valida `recipient_name` com a regra existente, grava só esse campo no endereço da assinatura e audita sem o nome
- [x] 2.2 Reconferência do problema de endereço daquela assinatura com `resolved_by: operator`, sem e-mail
- [x] 2.3 Rota `PATCH /api/v1/admin/billing/subscriptions/:id/recipient-name` com `users.delivery.write` e escopo de mercado; resposta com `recipient_name` e `courier_issues`
- [x] 2.4 `npm run routes:manifest` e commit de `docs/api-routes.json`
- [x] 2.5 Testes: nome válido grava e fecha o problema; nome já existente 409 sem gravar; nome inválido 422 sem gravar; outro mercado 404; assinatura inexistente 404; nome da conta e Stripe não mudam; problema com outro código fica aberto sem e-mail

## 3. Nome mostrado e sugestão

- [x] 3.1 Fila de produção lê o nome da conta só com `customerProfileInScope`; nome mostrado vira quem recebe → conta (sem `@`) → e-mail; item traz `accountName` e `nameSource`
- [x] 3.2 Linhas de Entregas Brasil com a mesma ordem, `account_name` e `name_source`
- [x] 3.3 Detalhe da assinatura com `account_name`
- [x] 3.4 Busca da fila (`q`) acha também pelo nome da conta, só com perfil nos mercados do operador
- [x] 3.5 Testes do presenter, do courier, do billing e da busca
