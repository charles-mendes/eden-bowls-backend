# Caixas de envio

Change `shipping-boxes`. Medidas e pesos vêm de `Eden_Bowls_Medidas_e_Pesos.md`. As regras vêm de `eden-bowls-starter-box-e-assinaturas.md` e de `perguntas-resposta-claude.md` (respostas 8, 10 e 11).

## As duas caixas

| Caixa | Chave | Medidas | Caixa vazia | Até |
|---|---|---|---|---|
| Starter Box | `starter` | 14 × 12 × 8″ | 1,0 kg | 10 pacotes |
| Caixa mensal | `monthly` | 18 × 14 × 12″ | 1,5 kg | 30 pacotes |

O limite é o número de pacotes, seja o pacote de 300 g ou de 500 g. Esses são os valores do deploy, gravados na tabela `shipping_us_boxes` pela migração `1700000000070`.

## Onde editar

As caixas ficam nas configurações de frete dos EUA, em `us.boxes`. Elas são lidas por `GET /api/v1/admin/shipping/settings` e salvas por `PUT` na mesma rota, com a permissão `shipping.write`. No painel, ficam em Frete › Regras › EUA › "Caixas de envio".

O que a API aceita:

- Medidas: acima de 0 e até 108″.
- Caixa vazia: de 0,1 a 10 kg.
- Máximo de pacotes: número inteiro de 1 a 100. A Starter precisa caber menos pacotes que a mensal.

Qualquer outro valor recebe 422 `invalid_shipping_box`, e nada é gravado.

O Brasil usa o mesmo máximo de pacotes para contar as caixas. Medidas e peso só importam para a UPS.

## Quais caixas vão num pedido

A conta é feita por `planBoxes`, em `src/core/shipping-boxes.js`. Ela recebe os pacotes que a cozinha separa para o ciclo (`cyclePacks`: todas as receitas e tamanhos, com os pets somados).

1. Enquanto sobrarem mais pacotes do que cabem numa caixa mensal, sai uma mensal cheia.
2. O resto vai numa Starter, se couber nela. Se não couber, vai em mais uma mensal.
3. Os pacotes mais pesados entram primeiro.

Exemplos com os valores do deploy:

| Pacotes | Caixas |
|---|---|
| 8 | 1 Starter com 8 |
| 12 | 1 mensal com 12 |
| 40 | 1 mensal com 30 e 1 Starter com 10 |
| 45 | 2 mensais, com 30 e 15 |

Uma linha sem tamanho de pacote fica fora das caixas e é registrada no log com o evento `boxes.unsized_line`, como já acontece na separação do estoque.

## Peso de cada caixa

Peso = gramas dos pacotes + caixa vazia + gelo seco.

- **EUA:** o gelo seco é `us.package.dry_ice_kg` (0,5 kg por caixa).
- **Brasil:** não leva gelo seco, porque o motoboy usa caixa de isopor.
- **Libras:** quilos × 2,20462, sempre arredondado para cima, com uma casa decimal. A UPS cobra um ajuste quando o peso declarado fica abaixo do real. Por isso a Starter com 10 × 500 g sai como 14,4 lb, e a tabela do cliente diz 14,3 lb.

## Onde as caixas aparecem

- **Fila de produção e fila do motoboy:** cada item traz `boxes`, com `key`, `label`, `pack_count` e `weight_kg` de cada caixa.
- **Etiqueta UPS:** cada caixa vira uma embalagem do mesmo envio, com as medidas dela, o peso e a declaração de gelo seco. Cada caixa tem a própria etiqueta, aberta com `GET /api/v1/admin/shipments/:id/label?package=N`. Sem `package`, vem a etiqueta da primeira caixa. O rastreio segue a primeira caixa, e o cancelamento cancela todas de uma vez. Um ciclo sem pacotes com tamanho usa a "Caixa da cotação do checkout" como uma embalagem só.
- **Coleta UPS:** o peso enviado é a soma das caixas das etiquetas. Uma etiqueta comprada antes desta change conta como uma "Caixa da cotação do checkout".

## Limitação: a cotação do checkout

A cotação do checkout e a simulação do painel não usam `planBoxes`. Elas continuam usando o `package` das configurações dos EUA, a "Caixa da cotação do checkout" no painel, porque o frete grátis ainda está em aberto com o cliente.

Enquanto isso, essa caixa deve ser a mensal com peso cheio: 18 × 14 × 12″ e 37,5 lb, com o gelo seco já incluído. A migração `1700000000070` faz essa troca sozinha, mas só se a caixa ainda estiver no valor antigo (12 × 12 × 12″, 10 lb). Uma caixa que o operador já mudou fica como está.
