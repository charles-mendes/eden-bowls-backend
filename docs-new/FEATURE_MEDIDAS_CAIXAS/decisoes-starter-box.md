# Starter Box e assinaturas — decisões e pendências

Fontes: `eden-bowls-starter-box-e-assinaturas.md` (cliente), `perguntas-resposta-claude.md` (respostas da equipe), `Eden_Bowls_Medidas_e_Pesos.md` (medidas) e as respostas finais da cliente (Cris), de 17/11/2026, registradas abaixo.

## Changes

| Change | Repositórios | Situação |
|---|---|---|
| A. `checkout-renewal-consent` | backend, loja | Implementada e arquivada (11/11/2026) |
| D. `shipping-boxes` (parte operacional) | backend, painel | Implementada e arquivada (10/11/2026) |
| B. `starter-box-purchase` | backend, loja, painel | Proposta aberta (17/11/2026) |
| C. `starter-to-monthly` | backend, loja, painel | Proposta aberta (17/11/2026) |
| E. `us-company-paid-shipping` | backend, loja, painel | Implementada e arquivada (18/11/2026) |
| F. `shipping-boxes-real-weights` | backend, painel | Proposta aberta (17/11/2026) |

## Respostas da cliente de 17/11/2026

Elas resolvem as três pendências anteriores e mudam duas decisões já tomadas (peso das caixas e frete).

1. **Starter opcional.** Depois de cadastrar os pets e ver o plano calculado, o cliente novo escolhe entre experimentar a Starter (10 dias) ou assinar direto o mensal de 1, 3 ou 6 meses. Resolve a antiga pendência 2.
2. **Desconto depois da Starter.** Quem comprou a Starter paga a primeira cobrança mensal pelo valor regular do plano, sem desconto de primeira compra. Resolve a antiga pendência 3.
3. **Frete.** Resolve a antiga pendência 1:
   - **EUA:** o cliente não paga frete, nem na Starter nem no mensal. A cotação UPS continua sendo calculada e registrada como custo da empresa. O cliente vê US$ 0.
   - **Brasil:** o frete continua cobrado como hoje (pela distância entre a cozinha e o endereço), na Starter e no mensal.
4. **Peso das caixas vazias** (pesadas pela cliente): Starter 355 g, mensal 600 g. Substituem as estimativas de 1,0 kg e 1,5 kg.
5. **Combinação de caixas:** quando o pedido passa da capacidade, o sistema escolhe sozinho a combinação mais econômica.

## Regras definidas

### Starter Box

- **Opcional**, uma por cliente. O limite vale por cliente, não por pet: um pet novo não libera outra Starter. Quem cancelar e voltar assina direto o mensal.
- **Mesmo cliente:** cruza e-mail da conta, CPF (Brasil) e impressão digital do cartão no Stripe. Se qualquer um deles já tiver uma Starter associada, a compra é bloqueada. A impressão digital vale por conta Stripe, ou seja, por mercado. Ela também bloqueia um familiar que use o mesmo cartão. O endereço não entra, para não bloquear vizinhos e familiares.
- **CPF:** o checkout do Brasil já exige CPF válido em toda compra (`tax_document_required`), então o cruzamento por CPF funciona sem mudança.
- **Quantidade:** cálculo nutricional de 10 dias, só embalagens inteiras de 300 g ou 500 g, com os sabores e proporções escolhidos.

### Descontos (nunca se acumulam)

| Caminho | Desconto |
|---|---|
| Starter | 40% sobre o subtotal dos alimentos da Starter. O frete não tem desconto |
| Mensal depois da Starter | Nenhum: a primeira cobrança sai pelo valor regular do plano |
| Mensal direto, sem Starter | Desconto de primeira compra atual: 10% (1 mês), 25% (3 meses), 40% (6 meses), editáveis no painel |

### Passagem para o mensal

- O cliente pode confirmar o mensal a partir da entrega da Starter (Dia 1). Receber o mensal ainda dentro dos 10 dias é aceito.
- Os sabores da Starter vêm como padrão, e o cliente pode mudar antes de confirmar.
- A primeira cobrança é feita na confirmação. Sem confirmação, a experiência termina sem cobrança.
- **E-mail do 5º dia:** sai uma vez só. Se a entrega foi confirmada (rastreio UPS nos EUA, entregador no Brasil), conta da data confirmada. Se não foi (rastreio parado ou entregador sem marcar), conta da data prevista, e a operação recebe um alerta para verificar.
- **Prazo da primeira entrega mensal:** os "3 dias úteis" são meta da operação, não promessa. O site mostra a data calculada pelo calendário de entregas (dia de preparo, dias fechados e, nos EUA, trânsito UPS). O sistema já funciona assim.

### Frete

- **EUA:** com a chave desligada, o frete é US$ 0 para o cliente. A cotação UPS continua obrigatória (valida o endereço) e fica gravada na assinatura como custo da empresa (`company_cost`: valor, moeda e origem `ups`, `fixed` ou `fallback`), visível no detalhe da assinatura no painel. A cotação continua usando a "Caixa da cotação do checkout"; calcular o custo com as caixas reais do pedido (`planBoxes`) ficou fora da change E. O custo real de cada etiqueta continua em `ups_shipments`.
- **Brasil:** frete cobrado como hoje, na Starter e no mensal.
- **Chave de cobrança nos EUA (pedido da cliente, 17/11/2026):** o admin ou o operador dos EUA liga e desliga a cobrança do frete no painel (`charge_shipping`, desligada no deploy), com histórico de quem mudou e quando. Desligada, a loja mostra o valor original riscado e FREE, e a fatura sai com "Shipping: FREE". Ligada, o frete é cobrado como hoje. A mudança vale só para checkouts novos: cada assinatura mantém a condição com que foi contratada (decisão de 17/11/2026).
  - **Como ficou no backend (18/11/2026):** coluna `shipping_us_settings.charge_shipping`, 0 no deploy (migração `1700000000087`). Cada troca grava o evento `shipping.us.charge.enable` ou `shipping.us.charge.disable` em `admin_audit_events`, na mesma transação, e a leitura das configurações devolve `us.charge_shipping_history` (até 50 eventos, mais recente primeiro). Valor que não é booleano volta 422 `invalid_charge_shipping`.
  - A cotação (`POST /shipping/v1/calculate`) devolve `original_amount`, `charged_amount` e `charge_enabled`. O checkout relê a chave no banco na hora da compra e grava na assinatura `shipping_waived` e `shipping_original_minor` (metadata da Stripe e snapshot do ledger). Com frete dispensado, o custo de frete do ledger fica 0, a renovação não recebe item de frete e a edição de plano mantém frete 0. Assinaturas anteriores, sem `shipping_waived`, continuam cobradas.
  - A fatura Eden Bowls de uma assinatura com frete dispensado imprime "Shipping: FREE" (em português o texto é "GRÁTIS", que existe só para as duas línguas ficarem completas). O custo da empresa nunca aparece na fatura.
- **Brasil com 2 ou mais caixas (decisão de 18/11/2026):** o frete continua sendo uma taxa por pedido, pela distância, sem multiplicar pelo número de caixas. Não há configuração "empresa ou cliente" por enquanto. Motivo: no Brasil o frete é uma estimativa (valor por km × distância) e cada entrega é pedida uma a uma na Uber Entregas, então o custo depende do peso e do que uma corrida em Curitiba aceita, não do número de caixas. Peso real por caixa, sem gelo seco:

  | Caixa | Alimentos | Embalagem | Total |
  |---|---|---|---|
  | Starter 300 g (10 un.) | 3 kg | 0,355 kg | 3,355 kg |
  | Starter 500 g (10 un.) | 5 kg | 0,355 kg | 5,355 kg |
  | Mensal 300 g (30 un.) | 9 kg | 0,600 kg | 9,6 kg |
  | Mensal 500 g (30 un.) | 15 kg | 0,600 kg | 15,6 kg |

  Duas Starters (6,71 kg ou 10,71 kg) e duas mensais de 300 g (19,2 kg) caberiam numa referência hipotética de 20 kg; duas mensais de 500 g somam 31,2 kg. Esses 20 kg não são limite confirmado da Uber em Curitiba.
- **Change futura do frete do Brasil**, depois que a Cris confirmar quem paga as caixas extras e a Uber confirmar quais modalidades em Curitiba aceitam esses pesos e dimensões: calcular o peso total, identificar quantidade e dimensões das caixas, cotar a Uber com os dados reais e, se a modalidade não aceitar, trocar de modalidade ou dividir a entrega. A validação de capacidade fica na integração de entrega. Separar `estimated_shipping_cost` (o que o cliente vê) de `actual_shipping_cost` (o que a Uber cobra), para auditar a diferença sem alterar o valor gravado no pedido.

### Caixas, peso e gelo seco

| Caixa | Medidas | Caixa vazia | Até |
|---|---|---|---|
| Starter | 14 × 12 × 8″ | 355 g | 10 pacotes |
| Mensal | 18 × 14 × 12″ | 600 g | 30 pacotes |

- O limite é o número de pacotes, de 300 g ou de 500 g.
- Acima da capacidade, o sistema escolhe a combinação mais econômica. A regra atual de `planBoxes` (mensais cheias e o resto numa Starter, se couber) já minimiza o número de caixas. A change F confere se ela continua sendo a mais barata com os pesos novos.
- **Gelo seco** só nos EUA: 500 g por caixa. No Brasil, o motoboy usa caixa térmica, sem gelo seco.
- **Peso enviado à UPS**, por caixa: caixa vazia + alimentos + gelo seco.
- Com os pesos novos, uma mensal com 30 × 500 g nos EUA pesa 15 + 0,6 + 0,5 = 16,1 kg (35,5 lb), e não mais 17,0 kg (37,5 lb). Uma Starter com 10 × 300 g no Brasil pesa 3,355 kg, e não mais 4,0 kg.

## O que cada change nova cobre

- **B. Compra da Starter:** escolha entre Starter e mensal na loja; checkout da Starter com 40% nos alimentos; bloqueio de uma Starter por cliente (e-mail, CPF, cartão); registro da Starter para o cruzamento.
- **C. Passagem para o mensal:** liberação a partir da entrega; primeira cobrança sem desconto para quem fez a Starter e com o desconto atual para quem assina direto; sabores como padrão; e-mail do 5º dia com fallback na data prevista e alerta para a operação.
- **E. Frete:** chave de cobrança do frete nos EUA (desligada no deploy) com histórico; cotação UPS gravada como custo da empresa quando não é cobrada; valor riscado e FREE na loja; "Shipping: FREE" na fatura; frete do Brasil como hoje, uma taxa por pedido.
- **F. Peso real das caixas:** migração que troca 1,0 kg → 0,355 kg e 1,5 kg → 0,600 kg em `shipping_us_boxes`, só se o operador não tiver mudado o valor; atualização dos cenários da spec `shipping-boxes` e de `caixas-de-envio.md`; validação de que a combinação de caixas continua a mais econômica.

## Testes pedidos pela cliente

- Limite de uma Starter por cliente: bloqueio por e-mail, por CPF e por cartão, cada um sozinho.
- Desconto de primeira compra: não aplicado depois da Starter, aplicado para quem assina direto.
- Frete zerado nos EUA (Starter e mensal) e cobrado no Brasil.
- Cálculo de caixas e de peso enviado à UPS.

## Termos e Política publicados

Os textos de 2026-10-22 não batem com as regras novas: os Termos descrevem a Starter com compromisso de 3 meses e cobrança da diferença no cancelamento, e dizem que o frete é cobrado (inclusive nos EUA). Antes de lançar a Starter e o frete grátis nos EUA, é preciso publicar uma versão nova dos Termos pelo painel (Configurações › Documentos legais). Isso não é código, mas bloqueia o lançamento.

## Pendência com a cliente

1. **Frete do Brasil com 2 ou mais caixas.** A cliente respondeu "como já definimos". O documento original dizia que, com duas ou mais caixas, "o frete continuará gratuito", sem cobrança adicional. Até a confirmação, o frete do Brasil fica como hoje (uma taxa por pedido). Falta também a Uber confirmar o que uma corrida em Curitiba aceita. As duas respostas abrem a change futura descrita acima.
