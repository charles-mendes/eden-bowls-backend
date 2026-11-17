# Starter Box e assinaturas — decisões e pendências

Fontes: `eden-bowls-starter-box-e-assinaturas.md` (cliente), `perguntas-resposta-claude.md` (respostas da equipe) e `Eden_Bowls_Medidas_e_Pesos.md` (medidas).

## Changes

| Change | Repositórios | Situação |
|---|---|---|
| A. `checkout-renewal-consent` | backend, loja | Proposta aberta |
| D. `shipping-boxes` (parte operacional) | backend, painel | Proposta aberta |
| B. Compra da Starter Box | backend, loja, painel | Aguarda respostas do cliente |
| C. Passagem da Starter para o mensal | backend, loja, painel | Aguarda respostas do cliente |

## Decisões já tomadas para as changes B e C

- **Prazo da primeira entrega mensal:** os "3 dias úteis" são meta da operação, não promessa. O site mostra a data calculada pelo calendário de entregas (dia de preparo, dias fechados e, nos EUA, trânsito UPS). O sistema já funciona assim, então não há código novo.
- **E-mail do 5º dia:** sai uma vez só, 5 dias depois da entrega da Starter. Se a entrega foi confirmada (rastreio UPS nos EUA, entregador no Brasil), conta da data confirmada. Se não foi, conta da data prevista, e a operação recebe um alerta para verificar.
- **Assinar o mensal:** fica liberado depois da entrega da Starter. Receber o mensal ainda dentro dos 10 dias é aceito.
- **Uma Starter por cliente:** por cliente, não por pet. Identificação por conta ou e-mail, CPF no Brasil e impressão digital do cartão no Stripe. A impressão digital vale por conta Stripe, ou seja, por mercado. O endereço não entra, para não bloquear vizinhos e familiares. Para isso funcionar, o CPF precisa ser obrigatório na compra da Starter no Brasil.
- **Desconto da Starter:** 40% sobre o subtotal dos alimentos dos 10 dias, sem o frete. Ele não se repete no primeiro mês.
- **Desconto de primeira compra para quem assina direto:** continua como hoje.
- **Gelo seco:** só nos EUA, 500 g por caixa. No Brasil, o motoboy usa caixa de isopor.

## Pendências com o cliente

1. **Frete grátis:** grátis em tudo (Starter e mensal, Brasil e EUA), cobrado só uma caixa, ou grátis só na Starter? Define se a cotação do checkout passa a usar a caixa real. Enquanto isso, a cotação usa a "Caixa da cotação do checkout" do painel. A migração da change D já coloca nela a caixa mensal (18 × 14 × 12″, 37,5 lb), mas só se ela ainda estiver no valor antigo (12 × 12 × 12″, 10 lb). Se alguém já tiver mudado essa caixa, ela fica como está. Os 37,5 lb já incluem o gelo seco.
2. **Starter obrigatória ou opcional** para cliente novo.
3. **Desconto de primeira compra depois da Starter:** quem fez a Starter ganha os 10%, 25% ou 40% na primeira cobrança mensal?
