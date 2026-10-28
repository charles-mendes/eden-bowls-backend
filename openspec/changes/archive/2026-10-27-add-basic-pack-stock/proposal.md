# Proposal

## Why

A proposta comercial prevê "controle básico de estoque e gestão de packs", e hoje não existe saldo de packs em lugar nenhum. A Fila de produção já sabe a demanda das próximas entregas (receita, tamanho e quantidade de cada ciclo), mas a cozinha não tem onde registrar quantos packs prontos existem. Sem isso, ela não sabe quanto falta produzir para a semana. Como o negócio é de assinatura, a demanda é conhecida antes. O estoque só precisa cruzar essa demanda com o saldo físico.

## What Changes

- **Saldo de packs prontos por mercado, receita e tamanho** (por exemplo BR, frango, 300 g). Não cobre matéria-prima, lote nem validade.
- **Histórico de movimentos**: todo aumento ou baixa no saldo vira um movimento (produção, separação, estorno de separação ou ajuste), com quem fez, quando, quantidade e motivo. O saldo atual é sempre a soma dos movimentos.
- **Lançar produção**: a cozinha informa "produzi N packs de receita e tamanho" e o saldo sobe.
- **Ajuste manual** com motivo obrigatório (perda, vencimento, contagem, amostra ou outro), positivo ou negativo.
- **Baixa automática na separação**: quando a Fila de produção move um ciclo de `in_production` para `ready`, a API baixa do saldo os packs daquele ciclo. Quando o ciclo volta de `ready` para `in_production`, a API devolve ao saldo exatamente o que tinha baixado. A baixa acontece só uma vez por ciclo.
- **Falta de saldo só avisa**: a separação nunca é bloqueada por falta de estoque. O saldo pode ficar negativo, e a resposta da mudança de status lista os itens que ficaram negativos.
- **Visão de estoque**: para uma janela de 7, 14 ou 30 dias (a mesma da fila), cada item mostra em estoque, comprometido (com a parte que ainda aguarda pagamento), disponível, a produzir e se está abaixo do mínimo.
- **Linhas sem tamanho não somem**: packs que não puderem ser ligados a um tamanho ficam fora das contas, mas aparecem listados na visão (`unsizedLines`) e geram um log de aviso com a assinatura, para alguém corrigir o catálogo.
- **Estoque mínimo opcional** por item.
- **Fila de produção**: cada ciclo ainda não separado informa se o saldo atual cobre os packs dele, distribuindo o saldo pela ordem de vencimento.
- O escopo de mercado do painel passa a incluir o estoque: operador BR só vê e movimenta o estoque BR.
- Rotas admin novas, com `npm run routes:manifest`.

## Capabilities

### New Capabilities

- `pack-stock`: saldo de packs prontos por mercado, receita e tamanho, histórico de movimentos, lançamento de produção, ajuste, baixa e estorno na separação, visão de comprometido e a produzir, e o aviso de cobertura na fila de produção.

### Modified Capabilities

- `admin-market-scope`: a tabela de campos canônicos ganha a linha do estoque de packs (campo `market` do item).

## Impact

- API: migração nova com `pack_stock_items` e `pack_stock_movements`; `src/services/admin-production.service.js` (baixa e estorno na transição para e de `ready`, aviso na resposta e cobertura na lista); `src/core/production-queue-presenter.js` (tamanho em gramas em cada linha); `src/infrastructure/repositories/subscription-ledger.repository.js` (linhas da janela sem paginação para a demanda); serviço, repositório, validador e rotas novos de estoque em `src/api/routes/admin.routes.js`; `docs/api-routes.json`.
- Permissões: reutiliza `production.read` (ver) e `production.write` (lançar, ajustar e definir mínimo). Nenhum papel muda.
- Change irmão no painel (mesmo nome): página "Estoque" no grupo Operação, aviso de cobertura na Fila de produção e `npm run contract:sync`.
- Fora de escopo: matéria-prima e ficha técnica, lote e validade, bloqueio da separação por falta de saldo, estoque na loja.
