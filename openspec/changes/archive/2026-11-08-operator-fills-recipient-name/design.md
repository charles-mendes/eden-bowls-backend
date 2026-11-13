# Design

## Context

O despacho do Brasil recusa um endereço sem nome de quem recebe (`recipient_name_missing`). O nome é gravado no checkout ou quando o cliente edita a assinatura. O painel edita só a cópia de endereço da conta (`PATCH /api/v1/admin/users/:userId/delivery`). Essa cópia vale para o próximo checkout e não chega ao endereço da assinatura, que é o que a fila, a entrega e a etiqueta leem.

A etiqueta UPS já usa o nome da conta quando falta o nome de quem recebe. O despacho do Brasil não usa, por decisão anterior: quem recebe pode ser outra pessoa (presente).

## Goals / Non-Goals

**Goals:**
- O operador destrava um pedido pelo nome de quem recebe sem sair da tela onde viu a trava.
- A fila mostra um nome legível mesmo sem nome de quem recebe.
- Marcar entregue logo após a saída funciona.

**Non-Goals:**
- Usar o nome da conta automaticamente no despacho. O operador confirma o nome; nada destrava sozinho.
- Editar outros campos do endereço da assinatura pelo painel (número, CEP etc.). Fica para outra change.
- Mudar o e-mail ao cliente ou quando o problema abre.

## Decisions

- **Rota estreita, só o nome.** `PATCH /api/v1/admin/billing/subscriptions/:id/recipient-name` recebe só `recipient_name`. Uma rota de endereço completo teria de repetir a validação do endereço e a regra de mercado; o nome é o que trava hoje. Alternativa descartada: reaproveitar a edição de assinatura do cliente, que exige o endereço inteiro e passa pelo Stripe.
- **Permissão `users.delivery.write`, escopo de mercado do registro.** É a permissão que o operador já usa para corrigir endereço. Um operador só do Brasil não grava numa assinatura dos EUA (404, como as outras rotas de registro).
- **Gravação com `JSON_SET` na coluna de endereço da assinatura.** Não toca o Stripe nem o nome da conta, como pede o requisito "O nome de quem recebe fica separado do nome da conta".
- **Auditoria sem o nome.** O registro guarda a ação, a assinatura e o ator, e se havia nome antes, mas não o nome, como já é feito na correção de endereço (só os campos).
- **Só preencher, nunca trocar.** Com nome de quem recebe já gravado, a rota responde 409 `recipient_name_present`. Como a auditoria não guarda o nome, uma troca apagaria o nome do cliente sem volta. Trocar um nome existente fica para outra change, se precisar.
- **Reconferência do problema.** Depois de gravar, o serviço de problemas de endereço reconfere aquela assinatura. Fecha com `resolved_by: operator` (a coluna é `VARCHAR(16)`) ou fica com os códigos que sobraram, sem e-mail.
- **Nome da conta só com o perfil no mercado.** A spec `admin-market-scope` manda os itens de cobrança e produção usarem só a identidade do ledger, sem leitura viva do perfil, porque o perfil pode ser de outro mercado. O nome da conta vira a única exceção, e só com `customerProfileInScope` verdadeiro. A fila e a lista de Entregas Brasil juntam o perfil (mercado e nome) e o presenter descarta o nome fora do mercado. A busca recebe os mercados do operador e só casa o nome da conta com perfil desses mercados. Admin sem restrição de mercado vê sempre.
- **Nome da conta como segunda opção na tela, não na regra.** O nome mostrado passa a ser: nome de quem recebe → nome da conta (se não for e-mail) → e-mail. `account_name` vai separado para o painel sugerir, e `name_source` diz de onde veio o nome mostrado, para o painel marcar "(conta)". `brazilAddressIssues` não muda.
- **Minuto da saída.** O painel manda minutos inteiros. A API compara com a saída cortada no minuto e, se a hora informada ficar antes da saída exata, grava a hora da saída. Assim a entrega nunca fica antes da saída nos dados.

## Risks / Trade-offs

- [O operador grava um nome errado] → o nome é só o de quem recebe, a auditoria registra quem gravou, e o cliente pode trocar pela assinatura.
- [Nome da conta na fila parece nome de quem recebe] → a trava continua na linha ("Travado: Falta o nome de quem recebe"), então o operador vê que falta.
- [Junção com usuários deixa a fila mais lenta] → a fila já filtra por período; a junção é por chave primária.
