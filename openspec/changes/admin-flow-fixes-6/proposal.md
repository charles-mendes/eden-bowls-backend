# Proposal

## Why

Lote 6 da proposta de melhorias do painel (`docs/analise/proposta-melhorias.md`, na raiz do workspace): o registro da coleta UPS (PM-28), na opção B (coleta avulsa pelo painel). Hoje o sistema compra e imprime a etiqueta, mas não sabe se alguém pediu à UPS para buscar as caixas. Só descobre que a caixa saiu na primeira leitura do rastreio (`in_transit_at`).

A decisão é a opção B porque o volume varia por dia. Por exemplo: segunda 8 caixas, terça nenhuma, quarta 15. Uma coleta diária fixa cobraria (ou faria a UPS passar) na terça sem caixa. Com a coleta avulsa, o operador pede a coleta só nos dias com etiqueta, com a quantidade do dia.

O change irmão `admin-flow-fixes-6` em `eden-bowls-admin` (painel) consome estas mudanças. A loja não muda. Ainda não há produção, só QA: a UPS de QA é o ambiente CIE, que aceita a coleta sem buscar nada.

## What Changes

- **Coleta pedida à UPS.** Rota nova `POST /admin/shipments/pickups` (`shipping.write`, mercado US).
  - **Corpo:** `pickup_date` (`YYYY-MM-DD`), `ready_time` e `close_time` (`HH:MM`), `package_count` e `shipment_ids` (as etiquetas da coleta).
  - **O que a API faz:** chama a API de coleta da UPS (Pickup Creation) com o endereço de saída (`ship_from`), guarda o número de confirmação (PRN) e liga as etiquetas à coleta.
  - **Etiquetas aceitas:** só `created`, dos EUA, sem coleta ativa.
  - **Recusas:**
    - data fora de hoje ou do próximo dia de coleta, fim de semana ou dia com `closesPickup` no calendário dos EUA;
    - janela inválida (`close_time` antes de `ready_time`);
    - quantidade menor que 1;
    - etiqueta que não pode entrar;
    - endereço de saída ou telefone faltando.
- **Cancelar a coleta.** Rota nova `POST /admin/shipments/pickups/:id/cancel` (`shipping.write`). Cancela na UPS pelo PRN, marca a coleta como cancelada e solta as etiquetas, que voltam a ficar "sem coleta".
- **Lista de coletas.** Rota nova `GET /admin/shipments/pickups` (`shipping.read`): as coletas a partir de uma data, com PRN, situação, janela, quantidade e etiquetas.
- **Sem resposta da UPS.** Um timeout ou erro de rede no pedido deixa a coleta como `unknown`, com as etiquetas ligadas, para não pedir duas vezes. Uma rota nova, `POST /admin/shipments/pickups/:id/not-created` (`shipping.write`), fecha a coleta depois de conferir no portal da UPS que ela não existe, e solta as etiquetas. É o mesmo padrão da compra de etiqueta sem confirmação.
- **Etiquetas na fila.** Os itens `created` de `GET /admin/shipments/queue` ganham `pickup`: `{ id, pickup_date, status, prn }` da coleta ativa, ou `null`.
- **Telefone do remetente.** As configurações de frete dos EUA ganham `ship_from.phone`, porque a UPS exige telefone no endereço da coleta. A compra de etiqueta não muda.
- **Hoje (PM-26, parte de coleta).** O bloco `fulfillment` ganha `upsLabelsWithoutPickup`: etiquetas `created` sem coleta ativa e ainda sem leitura de rastreio. Vale 0 para quem não vê os EUA.

## Capabilities

### New Capabilities

- `ups-pickup`: pedir, listar, cancelar e fechar coletas UPS avulsas, e a ligação entre coleta e etiquetas.

### Modified Capabilities

- `ups-label-queue`: requisito novo para a coleta nas etiquetas criadas.
- `admin-today`: `fulfillment` conta as etiquetas sem coleta.

## Impact

- **Banco:** migração com a tabela nova `ups_pickups`, a coluna `ups_shipments.pickup_id` e a coluna `ship_from_phone` nas configurações de frete.
- **Código:**
  - `src/infrastructure/shipping/ups-client.js`: `createPickup` e `cancelPickup`.
  - Repositório novo de coletas e serviço novo de coleta.
  - `src/services/ups-shipment.service.js`: `pickup` na fila.
  - `src/services/admin-today.service.js`: a contagem.
  - Configurações de frete: entidade, validador e serviço, para o telefone.
  - `src/api/routes/admin.routes.js` e `src/index.js`.
- **API:** quatro rotas novas. Rodar `npm run routes:manifest` e commitar `docs/api-routes.json`; no painel, `npm run contract:sync`.
- **Custo:** a UPS pode cobrar a coleta avulsa, conforme o contrato da conta. O painel não mostra o valor.
- **Ambientes:** QA usa a UPS CIE. Um cliente UPS só de simulação (`simulationOnly`) recusa a coleta, como recusa a compra.
