# Spec Delta

## Purpose

Guardar no MySQL, por cliente e por mercado (br|us), o que o cliente fez até comprar ou ao mudar uma assinatura já comprada, e o que falhou nesse caminho, para que um operador veja o passo e o erro depois que a tela da loja foi atualizada.

## ADDED Requirements

### Requirement: Toda linha de jornada tem cliente e mercado

Toda tentativa e todo evento de jornada MUST ter `user_id` e `market` (`br` ou `us`) preenchidos em colunas próprias. O mercado MUST vir do país do endereço do cliente quando o endereço já existe; antes disso, do mercado que a loja envia na requisição daquela página. Para assinatura já comprada, MUST vir do `stripe_account` da assinatura no ledger. Requisição sem usuário autenticado MUST NOT gerar linha de jornada. `stripe_account` pode ficar nulo enquanto não houver conta resolvida (ex.: passo do pet antes do endereço). Uma linha MUST NOT misturar BR e US, e um correlation id MUST NOT ser reutilizado entre mercados: se a mesma correlação chegar com outro mercado, a API MUST abrir uma tentativa nova.

#### Scenario: Falha de pet grava cliente e mercado
- **WHEN** um cliente autenticado na loja BR recebe erro com `code` em `POST /api/v1/onboarding/pets`
- **THEN** existe um evento com o `user_id` do cliente, `market = br`, `area = onboarding`, a ação do pet e o `error_code`

#### Scenario: Endereço US define o mercado
- **WHEN** o cliente já tem endereço nos Estados Unidos e falha em `POST /api/v1/onboarding/shipping`
- **THEN** o evento grava `market = us`

#### Scenario: Correlação não atravessa de mercado
- **WHEN** o mesmo correlation id chega primeiro com mercado `br` e depois com `us`
- **THEN** os eventos ficam em duas tentativas distintas, uma por mercado

### Requirement: Uma correlação por visita

A loja MUST usar um único correlation id por visita (sessão do navegador), compartilhado entre onboarding, plano e checkout, e MUST trocá-lo quando o mercado muda e depois que a tentativa fecha `paid`. Sem correlation id na requisição, a API MUST gerar um UUID; o `attempt_id` MUST NOT ser copiado para a coluna de correlação.

#### Scenario: Pet, plano e pagamento na mesma tentativa
- **WHEN** o cliente cria o pet, escolhe o plano e paga na mesma visita e no mesmo mercado
- **THEN** os eventos dos três passos ficam numa única tentativa

#### Scenario: Visita nova após pagamento
- **WHEN** a tentativa fechou `paid` e o cliente volta ao onboarding na mesma sessão
- **THEN** os novos eventos abrem outra tentativa

### Requirement: Tentativa de compra com desfecho

Cada tentativa de compra ou de mudança de assinatura MUST ter uma linha com `user_id`, `market`, email, `stripe_account`, `correlation_id`, `attempt_id` quando existir, `area` (`onboarding|plan|checkout|subscription`), termo em meses, `promotion_code_id`, `subscription_id`, `status` (`in_progress|paid|completed|failed`), passo do desfecho, `http_status`, `error_code`, mensagem sanitizada, `stripe_code`, `stripe_type`, `stripe_param`, `started_at` e `finished_at`. Quando o checkout cria o `attempt_id`, a API MUST gravá-lo na mesma linha da correlação já aberta. Regras de status:
- erro de passo intermediário (ex.: CEP inválido, frete, preview) MUST gerar só evento; a tentativa continua `in_progress`;
- `paid` MUST ser definido só por confirmação do servidor: `POST /api/v1/onboarding/payment-intent/ack` respondendo 200, ou webhook `payment_intent.succeeded`/`invoice.paid` resolvido no ledger para aquele cliente e mercado. Evento reportado pelo navegador MUST NOT marcar `paid`;
- mudança de assinatura bem-sucedida MUST fechar `completed`;
- erro que interrompe o fluxo (falha da criação da assinatura, `confirm_card_payment` failed, `payment_failed` via webhook, falha de commit de assinatura) MUST fechar `failed`;
- um `paid` posterior na mesma tentativa MUST substituir um `failed` anterior; `failed` MUST NOT substituir `paid`.

#### Scenario: Checkout pago fecha como paid
- **WHEN** o checkout cria a assinatura e o `payment-intent/ack` responde 200
- **THEN** a tentativa fica `status = paid`, com `attempt_id` e `correlation_id` na mesma linha e `finished_at` preenchido

#### Scenario: Erro de CEP não fecha a tentativa
- **WHEN** `POST /api/v1/onboarding/zipcode/lookup` falha e depois o pagamento é confirmado pelo ack
- **THEN** o evento do CEP fica com `outcome = failed` e a tentativa termina `paid`

#### Scenario: Pagamento confirmado por webhook
- **WHEN** a tentativa estava `failed` ou `in_progress` e chega `invoice.paid` cuja assinatura o ledger liga ao `attempt_id`
- **THEN** a tentativa passa a `paid`

#### Scenario: Falha de checkout respondida direto pela rota
- **WHEN** `POST /api/v1/onboarding/subscription/checkout` responde 4xx com `details.code` (consentimento, endereço, cupom de primeira compra, price ou conta Stripe)
- **THEN** o evento grava `http_status`, `error_code`, `user_id` e `market`, e a tentativa continua `in_progress` (o cliente pode corrigir e tentar de novo)

#### Scenario: Falha Stripe na criação da assinatura
- **WHEN** a criação da assinatura responde 502 `stripe_subscription_failed`
- **THEN** a tentativa fecha `failed` com `stripe_code`, `stripe_type` e `stripe_param` extraídos do erro Stripe

### Requirement: Passos registrados por página

A API MUST gravar um evento, com `area`, `step` e `outcome`, para as rotas:
- onboarding: `POST /api/v1/onboarding/pets`, `PATCH` e `DELETE /api/v1/onboarding/pets/:petId`, `POST /api/v1/onboarding/pets/sync`, `POST /api/v1/onboarding/recommendation`, gravando `pet_id`, a ação e o `code`, sem o corpo do pet;
- plano: `POST /api/v1/onboarding/plan/preview`, `plan/snapshot`, `plan-selection`, `recurrence`, incluindo a recusa de life stage, gravando termo em meses, moeda e `code`, sem a grade do plano;
- checkout, nesta ordem: `zipcode/lookup`, `address`, `shipping`, `sales-tax/quote` quando houver, `subscription/preview`, `subscription/checkout`, confirmação no navegador, `payment-intent/ack` e desfecho;
- assinatura: `POST /api/v1/subscriptions/:subscriptionId/edit/preview`, `edit/commit`, `actions`, `deliveries/:deliveryId/skip`, `reschedule` e `packs`, gravando `subscription_id`, a ação e o `code`.

Upload de foto do pet e cada tecla do autocomplete MUST NOT ser gravados.

#### Scenario: Recusa de life stage no plano
- **WHEN** `POST /api/v1/onboarding/plan-selection` recusa por life stage
- **THEN** o evento grava `area = plan`, o termo, a moeda e o `error_code`, sem a grade do plano

#### Scenario: Falha ao mudar assinatura existente
- **WHEN** `POST /api/v1/subscriptions/:subscriptionId/edit/commit` falha com `code`
- **THEN** a tentativa de `area = subscription` grava `subscription_id`, a ação, o `error_code` e o mercado do `stripe_account` da assinatura, e fecha `failed`

#### Scenario: Mudança de assinatura bem-sucedida
- **WHEN** `edit/commit` responde 200
- **THEN** a tentativa de `area = subscription` fecha `completed`

#### Scenario: Erro do ack sem details no corpo
- **WHEN** o ack falha com `HttpError` que tem `details.code`, mas a resposta só traz `{ success, message }`
- **THEN** o evento grava o `error_code` tirado do erro no servidor

#### Scenario: 401 numa página da trilha
- **WHEN** uma rota da trilha responde 401 para um usuário já identificado (ex.: sessão expirada no meio do checkout, com cliente resolvido)
- **THEN** grava-se só o 401 e o passo, sem senha, OTP ou token; login, cadastro, OTP e reset não geram eventos próprios

#### Scenario: 401 sem usuário não grava
- **WHEN** uma rota da trilha responde 401 sem token válido
- **THEN** nenhuma linha é gravada

### Requirement: Eventos do navegador reportados pela loja

A API MUST expor `POST /api/v1/onboarding/checkout/client-events`, autenticada como cliente, que aceita o passo (`retrieve_payment_intent|confirm_card_payment|payment_intent_ack|stripe_account_check`, este último quando o checkout responde com conta Stripe diferente da página), o `outcome`, o `code`/`type`/`param` do erro Stripe quando houver, a mensagem mostrada ao cliente, `attempt_id` e correlation id. A rota MUST responder 202 mesmo quando a gravação falha e MUST descartar campos fora da lista. Ela grava o evento sempre, MUST NOT marcar `paid`, e pode fechar `failed` só para `confirm_card_payment` failed. A rota MUST NOT exigir nem gravar o objeto de erro ou o body do Stripe, `client_secret` ou `payment_method`. A falha do `payment-intent/ack` continua engolida na loja e o checkout pago segue; só o registro é novo.

#### Scenario: Falha do confirmCardPayment
- **WHEN** a loja envia `step = confirm_card_payment`, `outcome = failed` e `stripe_code = card_declined`, sem body do Stripe
- **THEN** a API responde 202, grava o evento com `user_id`, `market` e `stripe_code` e marca a tentativa `failed`

#### Scenario: Navegador não marca paid
- **WHEN** a loja reporta `confirm_card_payment` com `outcome = ok`
- **THEN** o evento é gravado e a tentativa continua `in_progress`

#### Scenario: Ack falhou mas pagamento aprovado
- **WHEN** a loja reporta `confirm_card_payment` ok e o `payment-intent/ack` falha
- **THEN** a tentativa fica `in_progress` com os dois eventos visíveis, até um webhook resolvido confirmar o pagamento

### Requirement: Falha de webhook Stripe registrada

A API MUST gravar um evento de webhook (a) quando a entrega falha de forma terminal (esgotou tentativas ou prazo de retry e o evento é marcado failed), (b) quando o handler retorna sem resolver o cliente, e (c) para `payment_intent.payment_failed` e `invoice.payment_failed`, mesmo processados com sucesso. Falha de uma entrega que ainda será retentada MUST NOT gerar evento. `payment_intent.succeeded` e `invoice.paid` resolvidos no ledger MUST fechar a tentativa ligada como `paid`. Cada evento grava um evento com `event id`, `stripe_account`, tipo do evento, `code` e `market` (`br` para `POST /stripe/v1/webhook/br`, `us` para `/stripe/v1/webhook/us` e para o legado `/stripe/v1/webhook`). Quando o customer ou subscription id do evento é conhecido no ledger, MUST preencher `user_id`; senão `user_id` fica nulo. MUST NOT gravar o payload cru nem duplicar a linha de idempotência de `stripe_webhook_events`.

#### Scenario: Webhook BR falha com cliente resolvido
- **WHEN** um evento em `/stripe/v1/webhook/br` esgota as tentativas e o subscription id existe no ledger
- **THEN** o evento grava `market = br` e o `user_id` do dono da assinatura

#### Scenario: Falha transitória não grava
- **WHEN** o processamento falha mas o evento ainda será retentado
- **THEN** nenhum evento de trilha é gravado

#### Scenario: Declínio de cartão com aba fechada
- **WHEN** chega `invoice.payment_failed` com assinatura conhecida no ledger e a loja não reportou nada
- **THEN** a trilha grava o evento com `user_id` e `market` e a tentativa ligada fecha `failed`

#### Scenario: Cliente não resolvido
- **WHEN** o evento não traz customer ou subscription conhecido
- **THEN** o evento grava `market` e `user_id` nulo

### Requirement: Eventos de configuração de mercado

Mudanças admin que podem impedir a compra de qualquer cliente daquele mercado MUST gravar um evento de configuração com `market` da conta alterada, actor operador, ação, `outcome` e `error_code`, sem `user_id` de cliente: `POST /api/v1/admin/stripe/first-purchase-coupons`, `POST /api/v1/admin/stripe/first-purchase-promos/sync`, alteração do percentual do termo, `PUT /api/v1/admin/shipping/settings`, `POST /api/v1/admin/catalog/sync`, `POST /api/v1/admin/catalog/sync/:productId`, ativação de variação e `PUT /api/v1/admin/catalog/plan-settings`. A auditoria de operador existente MUST continuar sendo gravada. Uma tentativa de cliente que falhe depois por cupom, price ou frete referencia só o `error_code`, sem copiar a configuração.

#### Scenario: Criar cupom grava evento de configuração
- **WHEN** um operador cria cupom de primeira compra na conta US
- **THEN** existe um evento de configuração `market = us` sem `user_id` de cliente, e a linha de `admin_audit_events` continua gravada

### Requirement: Privacidade dos dados gravados

A trilha MUST NOT gravar body, header, query, token, `client_secret`, `payment_method` id, número de cartão, CPF, nome fiscal completo, endereço completo, payload cru de webhook nem a ficha do pet. Pode gravar user id, email, market, stripe account, termo, promotion code id, pet id, subscription id, event id Stripe, códigos de erro e a mensagem já devolvida ao cliente, truncada. IP, se gravado, MUST usar o mesmo hash do consentimento legal; IP cru MUST NOT ser gravado.

#### Scenario: Mensagem com dado sensível
- **WHEN** um erro chega com mensagem maior que o limite
- **THEN** a mensagem é truncada e nenhum campo do body da requisição é persistido

### Requirement: Gravar a trilha não muda a resposta

Falha ao gravar a trilha MUST NOT alterar o status HTTP, o body da resposta nem esconder o erro original; a falha de gravação vai para o logger do processo.

#### Scenario: Insert falha no checkout
- **WHEN** o insert da trilha lança erro durante um checkout que responderia 409
- **THEN** a resposta continua 409 com o mesmo `details.code`

### Requirement: Leitura admin por cliente e mercado

`GET /api/v1/admin/users/:userId/purchase-trail?market=br|us` MUST listar as tentativas do cliente naquele mercado, mais recentes primeiro, com até 50 eventos por tentativa. `GET /api/v1/admin/purchase-trail/config-events?market=br|us` MUST listar à parte os eventos de configuração do mercado. As duas exigem papel operacional com permissão de leitura e respeitam o escopo de mercado do staff; `market` é obrigatório: ausente ou fora de `br|us` MUST responder 400; mercado fora do escopo do staff responde 403 `market_forbidden`. Cliente comum MUST receber 401/403. O painel mostra a trilha na ficha do cliente, somente leitura, com o mercado visível; a loja não ganha tela de histórico.

#### Scenario: Filtro de mercado isola as tentativas
- **WHEN** o cliente tem uma tentativa US falha e o operador lista com `market=br`
- **THEN** a tentativa US não aparece

#### Scenario: Mercado ausente
- **WHEN** o operador chama a lista sem `market`
- **THEN** a API responde 400, sem listar todos os mercados do staff

#### Scenario: Cliente comum não lê
- **WHEN** um token de cliente chama a rota admin
- **THEN** a API responde 401 ou 403 sem dados

### Requirement: Retenção da trilha

Linhas de tentativas, eventos e eventos de configuração com mais de 180 dias MUST ser apagadas, BR e US pelo mesmo prazo.

#### Scenario: Linha antiga é apagada
- **WHEN** o job de retenção roda e uma tentativa US e uma BR têm `started_at` de 181 dias atrás
- **THEN** as duas e seus eventos são apagados
