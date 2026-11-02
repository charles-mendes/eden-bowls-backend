# Pendências da NF-e no Bling

Última atualização: 2 de novembro de 2026.

O fluxo já funciona até gerar a nota. O envio da nota de teste nº 000001 foi recusado pelo próprio Bling, antes de chegar à SEFAZ. A tela do Bling informou o que falta, e está na seção 1.

Nada neste arquivo inclui Client Secret ou token.

## 1. Para destravar o teste em homologação

Conta Bling de teste. `tpAmb` já confirmado em `2`. Mensagens informadas pelo Bling ao tentar enviar a nota nº 000001.

| # | Pendência | Onde | Responsável | Situação |
|---|---|---|---|---|
| 1 | Preencher número, cidade e bairro do endereço da empresa | Bling, Dados da Empresa | Charles | Confirmado pelo Bling |
| 2 | Preencher o endereço completo e uma inscrição estadual válida da filial | Bling, Configurações de integrações, integração com os dados da filial | Charles | Confirmado pelo Bling |
| 3 | Trocar o CSOSN `101` da natureza de operação. O Bling não aceita esse código em venda para não contribuinte. Provisório sugerido para teste: `102` | Bling, natureza usada em `BLING_NATUREZA_OPERACAO_ID` | Charles | Confirmado pelo Bling |
| 4 | Gerar uma nota nova. O rascunho nº 000001 pode manter os dados antigos | Dev | Dev | Depende dos itens acima |
| 5 | Enviar e confirmar a autorização, a chave e o XML | Dev | Charles e dev | Depende dos itens acima |

Os dados da empresa precisam ser os reais, compatíveis com o CNPJ do certificado, porque a SEFAZ também valida o emitente em homologação.

## 2. Dados fiscais a pedir ao contador do cliente

Estes valores valem para a conta de produção. Os provisórios de teste não servem para ela.

| # | Informação | Por que importa | Valor de teste, não usar em produção |
|---|---|---|---|
| 1 | NCM de cada produto | Obrigatório em cada item da nota | `2309.10.00` |
| 2 | Origem da mercadoria | Obrigatória em cada item | `0` |
| 3 | Produção própria ou revenda | Define o CFOP | Produção própria |
| 4 | CFOP de venda dentro do estado | Cliente do mesmo estado do emitente | A definir |
| 5 | CFOP de venda para fora do estado, consumidor final pessoa física | A nota de teste saiu com `6101`, ainda sem cidade do emissor. Avaliar se o correto é `6107`, para não contribuinte | `6101` |
| 6 | Regime tributário | Define se usa CST ou CSOSN | A nota saiu como Simples Nacional |
| 7 | CST/CSOSN de ICMS, PIS e COFINS, com alíquotas | O Bling recusou o CSOSN `101` para não contribuinte. O código de produção precisa servir para venda a pessoa física | `102`, provisório |
| 8 | DIFAL e partilha de ICMS em venda interestadual a consumidor final | Pode gerar imposto extra por estado | A definir |
| 9 | Série e número inicial da NF-e | Não podem repetir numeração já usada | Série 1, nº 000001 |
| 10 | Forma de pagamento fiscal para cartão e Pix | Hoje toda nota sai como Dinheiro. Ver a seção 4 | Dinheiro |
| 11 | Se a nota deve lançar estoque ou contas no Bling | A integração não lança. Isso não deve ficar ligado na natureza sem decisão | Desligado |

## 3. Configuração da conta de produção

Fazer só depois da seção 2 e de uma nota autorizada em homologação.

| # | Pendência | Onde |
|---|---|---|
| 1 | Criar o aplicativo de produção, separado dos de local e QA, com os quatro escopos do guia | Bling, Área do Integrador |
| 2 | Criar a natureza de operação de venda com CFOP e tributos definitivos | Bling |
| 3 | Preencher NCM e origem definitivos em cada variação do Brasil | Painel, Produtos |
| 4 | Conferir dados da empresa e certificado A1 | Bling |
| 5 | Preencher as quatro variáveis `BLING_*` no `.env` de produção | Servidor |
| 6 | Autorizar pelo botão do painel, logado na conta real | Painel |
| 7 | Emitir uma nota real de valor baixo e conferir com o contador | Bling e painel |

A API cria os produtos no Bling na primeira nota de cada variação, com o código `EDEN-<id da variação>`.

## 4. Pendências de código

| # | Pendência | Risco |
|---|---|---|
| 1 | Enviar a forma de pagamento certa no pedido | Sem isso, nota de venda pela Stripe sai como Dinheiro |
| 2 | Atualizar o endereço de contato já existente no Bling | Cliente que mudou de endereço sai com o endereço antigo, salvo correção pelo painel |
| 3 | Criar reautorização pelo painel | Com a conexão ativa, o botão fica oculto. Hoje é preciso limpar a conexão no banco |
| 4 | Cobrir o CPF e o nome fiscal nos fluxos de LGPD | Pedidos de exportação e exclusão ainda não tratam esses dados |
| 5 | Testar a correção de dados em nota rejeitada | Só foi testada em nota Pendente, porque ainda não há nota rejeitada real |
| 6 | Renumerar a migration `1700000000057` antes do merge | O número colide com outra branch. Usar `061` se as demais entrarem antes |

## 5. Dados de teste na conta Bling de teste

Estes registros podem ser excluídos pelo painel do Bling. A integração nunca apaga nada lá.

| Registro | Id | Observação |
|---|---|---|
| Pedido | `27283460894` | Sem nota. Usou contato sem CPF |
| Pedido | `27283535748` | Fatura fictícia `in_test_dryrun_002` |
| Nota | `27283535836` | Nº 000001, Pendente |
| Contato | `18487886964` | Cliente Teste Homologacao, CPF fictício. O complemento foi alterado nos testes de correção |
| Produtos | 15 | Códigos antigos `EDEN-<sabor>-<gramas>`, com NCM provisório. A API não os usa mais |
