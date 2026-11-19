# Spec Delta

## Purpose

Mostrar ao operador, num só lugar e um mercado por vez, as falhas que a trilha de compra já gravou para todos os clientes daquele mercado, sem gravar nada novo e sem expor dado que a trilha não guarda.

## ADDED Requirements

### Requirement: Listagem de falhas por mercado

`GET /api/v1/admin/purchase-trail/errors` MUST listar, de um mercado, as falhas já gravadas na trilha. Uma linha MUST ser:
- uma tentativa com `status = failed`; ou
- uma tentativa em `in_progress`, `paid` ou `completed` que tenha ao menos um evento com `outcome = failed`; ou
- um evento de webhook com `outcome = failed` que não pertence a nenhuma tentativa (`user_id` pode ser nulo).

O instante de uma linha de tentativa MUST ser o da falha exibida: o `created_at` do último evento com falha (ou do último com o código filtrado, quando há filtro de código), ou o `finished_at` quando o status é `failed` e nenhum evento falhou. O instante de um webhook sem tentativa é o seu `created_at`. Período, ordem e cursor usam esse instante.

Tentativa sem nenhuma falha MUST NOT aparecer. A linha de tentativa MUST trazer o desfecho da tentativa (status, passo final, código) junto do passo que falhou, e até 50 eventos da tentativa, para o cliente da tela expandir sem nova chamada. Cada linha traz: quando, mercado, `user_id`, email (nulo quando o cliente não foi resolvido), área, passo, status da tentativa (nulo para evento de webhook sem tentativa), `http_status`, `error_code`, `stripe_code`, `stripe_type`, `stripe_param` e a mensagem já sanitizada. A resposta MUST NOT incluir body, header, query, token, `client_secret`, `payment_method`, cartão, CPF, nome fiscal, endereço completo, payload de webhook nem ficha do pet, e não há modo de "log cru".

#### Scenario: CEP inválido que depois pagou
- **WHEN** uma tentativa BR tem um evento `zipcode_lookup` com falha e terminou `paid`
- **THEN** ela aparece com status `paid` e o passo `zipcode_lookup` com seu `error_code`

#### Scenario: Tentativa sem falha fica fora
- **WHEN** uma tentativa terminou `paid` sem nenhum evento com falha
- **THEN** ela não aparece na lista

#### Scenario: Tentativa antiga que ainda está em andamento
- **WHEN** uma tentativa começou há 8 dias, segue `in_progress` e o ack falhou ontem
- **THEN** ela aparece no período padrão de 7 dias, no instante da falha do ack

#### Scenario: Webhook sem cliente
- **WHEN** existe um evento de webhook US com falha e `user_id` nulo
- **THEN** ele aparece na lista US com email nulo e status da tentativa nulo

### Requirement: Mercado obrigatório e escopo

A rota MUST exigir `market` (`br` ou `us`). Ausente ou inválido MUST responder 400 `market_required`, sem listar todos os mercados do staff. Mercado fora do escopo do staff MUST responder 403 `market_forbidden`. Uma linha de um mercado MUST NOT aparecer na lista do outro.

#### Scenario: Falha US não aparece em BR
- **WHEN** há falhas em BR e em US e o operador pede `market=br`
- **THEN** só as linhas BR voltam

#### Scenario: Sem mercado
- **WHEN** o operador chama a rota sem `market`
- **THEN** a API responde 400 `market_required`

### Requirement: Filtros e paginação

A rota MUST aceitar `from` e `to` (datas; o padrão é os últimos 7 dias; `from` anterior a 180 dias atrás MUST responder 400 `period_out_of_retention`), `area` (`onboarding|plan|checkout|subscription|webhook`; outro valor = 400) e `error_code` (igualdade exata, comparado ao código da tentativa ou de qualquer evento com falha dela). O filtro de área MUST usar a área da tentativa; `webhook` traz só os eventos de webhook sem tentativa, e eles entram também quando a área está vazia. Com `error_code` preenchido, o passo e o código exibidos na linha MUST ser os do evento (ou desfecho) com esse código. A lista MUST vir mais recente primeiro, com `limit` explícito (padrão 50, máximo 100) e cursor `before` devolvido como `next_before` quando há mais páginas; a página seguinte MUST NOT repetir nem pular linhas com o mesmo instante.

#### Scenario: Filtro por área
- **WHEN** o operador pede `area=webhook`
- **THEN** só os eventos de webhook sem tentativa voltam; uma tentativa de checkout com evento de webhook com falha não volta

#### Scenario: Filtro por código mostra o código pedido
- **WHEN** uma tentativa tem falha `invalid_zipcode` e depois `card_declined`, e o operador filtra `error_code=invalid_zipcode`
- **THEN** a linha aparece com o passo `zipcode_lookup` e o código `invalid_zipcode`

#### Scenario: Período fora da retenção
- **WHEN** `from` é anterior a 180 dias
- **THEN** a API responde 400 `period_out_of_retention`

#### Scenario: Paginação estável
- **WHEN** duas linhas têm o mesmo instante e caem na fronteira da página
- **THEN** cada uma aparece exatamente uma vez entre as duas páginas

### Requirement: Filtro de falhas nos eventos de configuração

`GET /api/v1/admin/purchase-trail/config-events` MUST aceitar `outcome=failed` e `from`/`to` opcionais (mesmas regras de período da listagem de falhas), com o mesmo `market` obrigatório e a mesma permissão. Sem esses parâmetros, a resposta MUST ser a de hoje (50 mais recentes de qualquer resultado), para a aba da ficha não mudar.

#### Scenario: Falha antiga além dos 50 últimos sucessos
- **WHEN** os 50 eventos mais recentes do mercado são sucessos e há uma falha no período
- **THEN** a chamada com `outcome=failed` e o período devolve essa falha

#### Scenario: Chamada antiga não muda
- **WHEN** a aba da ficha chama sem `outcome`
- **THEN** a resposta é igual à de antes deste change

### Requirement: Somente leitura e acesso

A rota MUST exigir papel operacional com `billing.subscribers.read` (`admin`, `operator`, `readonly`; `veterinarian` não tem). Token de cliente MUST receber 401/403 sem dados. A rota MUST NOT gravar, reprocessar nem exportar, e MUST NOT alterar recorder, middleware, webhook, job de retenção, `admin_audit_events` nem `stripe_webhook_events`.

#### Scenario: Veterinário não lê
- **WHEN** um `veterinarian` chama a rota
- **THEN** a API responde 403

### Requirement: Tela "Erros de compra" no painel

O painel MUST ter a página "Erros de compra" em `/operations/purchase-errors`, primeiro item do grupo Operação, acima de "Checkout da loja", visível só para quem tem `billing.subscribers.read`; "Checkout da loja" MUST manter rota, regra de acesso e comportamento. A página MUST:
- ter seletor segmentado de mercado (Brasil, EUA) sem opção "Todos", limitado ao escopo do staff;
- ter filtros de período (dentro de 180 dias), área e código de erro, e botão de atualizar;
- mostrar estado de carga, estado vazio e erro de carga;
- mostrar por linha: quando, mercado, cliente (email, ou "cliente não resolvido"), área, passo, status da tentativa, `http_status`, `error_code`, `stripe_code` e mensagem;
- expandir a linha com os eventos que a rota já devolveu, sem segunda chamada;
- ligar cada linha com cliente à ficha em `/users/:userId?aba=trilha&mercado=<mercado da linha>`, e a aba abrir nesse mercado; o `mercado` da URL MUST ganhar do país do endereço do cliente, desde que esteja no escopo do staff;
- mostrar, em seção separada abaixo, os eventos de configuração com falha do mercado no mesmo período, vindos de `GET /api/v1/admin/purchase-trail/config-events?market=&outcome=failed&from=&to=`;
- não ter botão de mutação, reprocessamento nem export.

No celular, o dado extra de uma célula MUST ficar dentro da própria linha.

#### Scenario: Linha leva à ficha no mercado certo
- **WHEN** o operador clica no cliente de uma linha US e o endereço do cliente é do Brasil
- **THEN** abre `/users/<id>?aba=trilha&mercado=US` com a aba no mercado US

#### Scenario: Veterinário não vê o item
- **WHEN** um `veterinarian` entra no painel
- **THEN** "Erros de compra" não aparece no menu e a rota não renderiza a página
