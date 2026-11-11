Ajuda bastante. Com essas respostas já dá para escrever duas das quatro changes: o aceite de renovação (A) e a parte operacional das caixas (D). A compra da Starter (B) e a passagem para o mensal (C) ainda dependem de três respostas do cliente.

Situação das 11 perguntas

┌─────┬───────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  #  │                    Assunto                    │                                               Situação                                               │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1   │ Frete grátis                                  │ Pendente (cliente)                                                                                   │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2   │ Frete da Starter                              │ Resolvida em parte: o frete fica fora dos 40%. Se é cobrado depende da 1                             │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3   │ Starter obrigatória ou opcional               │ Pendente (cliente)                                                                                   │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4a  │ Desconto de primeira compra depois da Starter │ Pendente (cliente)                                                                                   │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4b  │ Desconto para quem assina direto              │ Resolvida: continua como hoje                                                                        │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 5   │ Uma Starter por cliente                       │ Resolvida: por cliente, identificado por conta ou e-mail, CPF (Brasil) e impressão digital do cartão │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 6   │ Entrega não confirmada                        │ Resolvida: o e-mail sai no 5º dia contando da data prevista, e a operação recebe um alerta           │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 7   │ Assinar antes de receber                      │ Resolvida: só depois da entrega, e a sobreposição de caixas é aceita                                 │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 8   │ Limite da caixa                               │ Resolvida: por quantidade de pacotes (10 e 30), e a combinação de caixas fica com a equipe técnica   │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 9   │ 3 dias úteis                                  │ Resolvida: é meta, e o site mostra a data do calendário                                              │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 10  │ Gelo seco no Brasil                           │ Resolvida: não leva, porque o motoboy usa caixa de isopor                                            │
├─────┼───────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 11  │ Peso da embalagem                             │ Resolvida: 1,0 kg e 1,5 kg como padrão, com pesagem real depois                                      │
└─────┴───────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────┘

Sobre a 10: no seu texto está "a pergunta 5", mas li como a 10 (gelo seco), que é o que o conteúdo responde.

Três detalhes para a spec, sem precisar do cliente

- 5. CPF: ele só serve para identificar o cliente se for obrigatório antes do pagamento da Starter. Hoje o CPF pode ser informado depois, na edição da assinatura. Na change B, eu tornaria o CPF obrigatório na compra da Starter no Brasil.
- 5. Cartão: a impressão digital do cartão existe no Stripe, mas cada mercado tem a sua conta Stripe, então ela não cruza Brasil e EUA. Isso não é problema, porque a regra pode valer por mercado. Também vale saber que ela bloqueia um familiar que use o mesmo cartão.
- 6. Data do 5º dia: se a entrega for confirmada, conta da data confirmada. Se não for, conta da data prevista, e a operação recebe o alerta.

Quais specs dá para escrever agora

┌─────────────────────────┬────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│         Change          │   Pode     │                                                       Por quê                                                       │
│                         │ escrever?  │                                                                                                                     │
├─────────────────────────┼────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ A. Aceite de renovação  │ Sim        │ Não depende de nada em aberto                                                                                       │
│ no checkout             │            │                                                                                                                     │
├─────────────────────────┼────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ D. Caixas e vários      │            │ A escolha da caixa pela quantidade de pacotes, o peso real (pacotes + gelo seco nos EUA + caixa vazia) e as         │
│ volumes (parte          │ Sim        │ etiquetas com vários volumes já estão definidos. Também a coleta pelo peso somado, o cadastro das caixas no painel  │
│ operacional)            │            │ e a caixa de cada pedido nas filas. No Brasil, só a quantidade de caixas, sem gelo seco                             │
├─────────────────────────┼────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ D. Cotação do frete     │ Não        │ Se o frete passar a ser grátis (pergunta 1), essa parte deixa de existir                                            │
│ pela caixa no checkout  │            │                                                                                                                     │
├─────────────────────────┼────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ B. Compra da Starter    │ Não        │ O fluxo da loja muda conforme a pergunta 3, e o frete conforme a pergunta 1                                         │
│ Box                     │            │                                                                                                                     │
├─────────────────────────┼────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ C. Passagem para o      │ Quase      │ Falta só a 4a, que define o preço da primeira cobrança mensal                                                       │
│ mensal                  │            │                                                                                                                     │
└─────────────────────────┴────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

As três perguntas que faltam para o cliente

1. Frete: o frete passa a ser grátis em todos os pedidos (Starter e mensal, Brasil e EUA), continua cobrado e só as caixas extras saem de graça, ou é grátis só na Starter? Hoje o frete é cobrado todo mês: por distância no Brasil e pela cotação da UPS nos EUA.
2. Starter obrigatória: todo cliente novo começa pela Starter, ou ele escolhe entre a Starter e assinar direto o mensal?
3. Desconto depois da Starter: quem fez a Starter e confirma o mensal ganha, na primeira cobrança mensal, o desconto de primeira compra que já existe (10% no plano de 1 mês, 25% no de 3 e 40% no de 6)? Ou, para quem fez a Starter, esse desconto não se aplica?

Quer que eu abra as changes A e D agora, enquanto o cliente responde as três?


-----------------------

Abri as changes A e D. Cada uma tem uma change irmã de mesmo nome nos repositórios que toca, e todas passam em openspec validate --strict. Não implementei nem commitei nada. Os quatro repositórios continuam na feat/bling-nfe.

A. checkout-renewal-consent (backend e loja)

O checkout já tinha um aceite obrigatório de Termos e Privacidade, gravado antes da cobrança. A renovação segue o mesmo caminho.
- Backend (3 tarefas de código e 1 de verificação):
  - o checkout passa a exigir renewal_consent.accepted: true e responde 422 renewal_consent_required sem ele;
  - grava um consentimento auto_renewal junto com os outros dois, antes do Stripe. Se a gravação falhar, responde 503 e não cobra.
- Loja (3 tarefas de código e 1 de verificação):
  - um bloco antes do botão de pagar, com a duração, a primeira cobrança, o valor mensal depois dela (plano mais frete, e imposto nos EUA), a renovação ao fim do prazo, onde desligar ("Meu Plano") e o aviso por e-mail 7 dias antes;
  - uma segunda caixa de aceite, sem a qual o botão de pagar não libera.
- O e-mail de 7 dias já existe: o padrão de plan_notice_days é 7, então não precisa de código.
- Ficou de fora a edição da assinatura. Trocar a duração do plano ali também começa um novo contrato. Vale uma change própria depois.

D. shipping-boxes (backend e painel)

- Backend (10 tarefas):- Caixas: Starter e mensal, com medidas, peso vazio e máximo de paconfigurações que já existe.- Plano de caixas: uma função pura parte dos mesmos pacotes que a coplos: 45 pacotes → 30 + 15; 40 → 30 + 10; 12 → uma mensal; 8 → uma  Starter.
  - Peso de cada caixa: pacotes + gelo seco (só nos EUA) + caixa vazia. Exemplo: 30 × 500 g = 17,0 kg, ou 37,5 lb.
  - Etiqueta: um envio UPS com um pacote por caixa. Cada pacote tem a sua etiqueta, que pode ser impressa com ?package=N, e o cancelamento anula todas de uma vez.        - Coleta: o peso é a soma dos pacotes.
  - Filas: a fila de produção e as entregas do motoboy passam a listar as caixas de cada pedido.
- Painel (6 tarefas):                                                                                                                                                     - Cadastro: uma seção "Caixas de envio" nas regras dos EUA. A "Caixaaixa da cotação do checkout".- Etiquetas: a impressão sai com todas as etiquetas de cada envio.- Coleta: a contagem passa a ser de caixas, não de etiquetas.
  - Filas: as caixas de cada pedido aparecem na fila de produção e nas entregas do motoboy.
- A cotação do checkout não muda: ela continua usando a caixa única das configurações. Enquanto o cliente não responde sobre o frete grátis, ponha nessa caixa as medidas da mensal (18 × 14 × 12″, 37,5 lb), para a cotação não sair abaixo d

Fora da D

Como avisei antes, o prazo de 3 dias úteis e o e-mail do 5º dia não en à Starter. Registrei essas decisões, as outras já tomadas e as trêspendências do cliente em docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md, para servirem de base às changes B e C.

As changes estão prontas para revisão. A ordem que eu recomendo para a
1. A, no backend e na loja juntos.
2. D no backend, depois D no painel.