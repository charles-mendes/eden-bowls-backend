# Spec Delta

## Purpose

Define o registro do checkout mais recente de cada cliente e o que pode alterá-lo depois de gravado, para que ele sempre descreva uma única tentativa de checkout e a assinatura que ela criou.

## ADDED Requirements

### Requirement: Uma fatura paga só atualiza o checkout da própria assinatura
Quando uma fatura é paga, o checkout do cliente MUST receber o estado `paid`, a assinatura e a fatura do evento somente se a assinatura gravada no checkout for a mesma da fatura. A fatura paga de qualquer outra assinatura do cliente MUST NOT alterar o checkout. O restante do processamento dessa fatura (assinatura, NF-e, ciclo de produção, e-mail) MUST continuar igual.

#### Scenario: Primeira cobrança da assinatura criada pelo checkout
- **WHEN** a primeira fatura da assinatura que o checkout criou é paga
- **THEN** o checkout fica com o estado de pagamento `paid` e o ID da fatura
- **AND** continua com o ID dessa mesma assinatura

#### Scenario: Cobrança de uma assinatura antiga depois de um checkout novo
- **WHEN** o checkout do cliente é da assinatura B
- **AND** uma fatura da assinatura A, do mesmo cliente, é paga
- **THEN** o checkout continua com a assinatura B, o estado de pagamento e a fatura que já tinha
- **AND** a assinatura A tem o pagamento registrado normalmente

#### Scenario: Cobrança enquanto um checkout novo é gravado
- **WHEN** o cliente conclui um checkout que cria a assinatura B
- **AND** a primeira fatura de B ou uma fatura da assinatura antiga A é processada antes de o checkout novo ser gravado
- **THEN** depois da gravação, o checkout tem a assinatura B e o estado de pagamento do checkout de B
- **AND** nada da assinatura A fica no checkout

#### Scenario: Evento sem ID não atualiza o checkout
- **WHEN** um evento de pagamento chega sem ID de assinatura e sem payment intent
- **THEN** o checkout não é alterado, mesmo que o checkout gravado também não tenha esses IDs

### Requirement: Uma falha de pagamento só atualiza o checkout a que pertence
Quando um pagamento de fatura falha, o checkout do cliente MUST receber o estado `failed` e o payment intent do evento somente se esse payment intent for o do checkout, ou se a assinatura do evento for a do checkout. A falha de qualquer outra assinatura MUST NOT alterar o checkout. O e-mail de falha MUST continuar sendo enviado como hoje.

#### Scenario: Falha no pagamento do próprio checkout
- **WHEN** o pagamento do checkout falha e o evento traz o payment intent desse checkout
- **THEN** o checkout fica com o estado de pagamento `failed` e o status desse payment intent

#### Scenario: Falha de uma assinatura antiga
- **WHEN** o checkout do cliente é da assinatura B
- **AND** a cobrança da assinatura A, que não está ativa nem em trial, falha com outro payment intent
- **THEN** o checkout mantém o estado de pagamento, o payment intent e o status que já tinha

### Requirement: Reenviar o checkout não devolve a assinatura de outro checkout
Reenviar um checkout já concluído MUST devolver apenas a assinatura que esse checkout criou. Uma cobrança ou falha de outra assinatura do cliente, recebida entre o checkout e o reenvio, MUST NOT fazer o reenvio devolver essa outra assinatura.

#### Scenario: Reenvio depois da cobrança de uma assinatura antiga
- **WHEN** o cliente conclui um checkout que cria a assinatura B
- **AND** uma fatura da assinatura A, do mesmo cliente, é paga
- **AND** o cliente reenvia o mesmo carrinho
- **THEN** a resposta do checkout traz a assinatura B, nunca a assinatura A
