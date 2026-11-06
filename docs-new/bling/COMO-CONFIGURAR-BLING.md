# Como configurar o Bling (NF-e de homologação)

Aplicativo privado da API do Bling, um por ambiente. A loja não fala com o Bling. Quem emite é a API, no job `bling_nfe`, depois de uma fatura paga da conta Brasil.

Estes dois aplicativos são de homologação. A nota que eles emitem não vale como NF-e. Produção usa outro aplicativo, outras credenciais e a conta Bling em ambiente de produção. Não aponte `api.edenbowls.com` para estes Client Id.

O Client Id e o secret do local ficam no `.env`. Os de QA ficam no `.env.qa.example`, que a VPS copia para o `.env`. Este arquivo não repete Client Secret.

## 1. Cadastro do aplicativo

No Bling: Central de Extensões, Área do Integrador, Criar aplicativo. Tipo API, uso Privado. Um app público aparece na Central de Extensões para outras contas.

Cada ambiente tem o próprio app. O de local e o de QA não compartilham Client Id.

| Campo | O que preencher |
|---|---|
| Nome | `Eden Bowls SA TESTE` no local. No QA, um nome que deixe claro que é QA, por exemplo `Eden Bowls SA QA`. |
| Categoria | Plataforma de e-commerce |
| Logo | Pode ficar vazio |
| Descrição | Aplicativo privado de homologação da Eden Bowls. Depois de um pagamento no Brasil, cria o cliente, o produto e o pedido de venda no Bling e emite a NF-e. Uso interno. A nota deste app não tem valor fiscal. |
| Descrição curta | Emissão de NF-e da loja Eden Bowls (homologação). |
| Link de redirecionamento | A URL abaixo, exatamente |
| Contato | Nome, e-mail e celular de quem o Bling deve chamar. São dados do desenvolvedor. |

Link de redirecionamento:

- Local: `http://localhost:3000/api/v1/bling/oauth/callback`
- QA: `https://qa-api.edenbowls.com/api/v1/bling/oauth/callback`

O Bling ignora outra URL na autorização e sempre volta para a cadastrada no aplicativo. A API também não envia `redirect_uri` na hora de autorizar: ela usa a URL do cadastro. Se o formulário recusar `http://localhost`, use um túnel HTTPS apontando para a API local e cadastre essa URL no app e em `BLING_REDIRECT_URI`. Não use a URL de QA no app local, nem a de produção em nenhum dos dois.

Escopos. Em Lista de escopos, Adicionar, marque só estes:

| Módulo | Escopo |
|---|---|
| Clientes e Fornecedores | Gerenciar contatos |
| Produtos | Gerenciar produtos |
| Pedidos de Venda | Gerenciar pedidos de venda |
| Notas Fiscais | Emissão de Nota Fiscal Eletrônica (NF-e) |

A API consulta e cria contato, produto e pedido, gera a NF-e a partir do pedido e envia a nota. Sem um desses escopos a chamada volta 403 e o job para de tentar aquela nota. Não marque nota de serviço, estoque, contratos nem categorias.

Em Clientes e Fornecedores, o escopo tem de permitir criar contato, não só ler. Só com leitura, `GET /contatos` funciona e `POST /contatos` volta `403 insufficient_scope`. Nenhum cliente novo chega à nota nesse caso.

Salvar só habilita depois do primeiro escopo. Incluir ou tirar escopo depois revoga todo mundo que já autorizou o app. É preciso autorizar de novo pelo painel, como explica o passo 4 em "Autorizar de novo".

Na aba Informações do app, copie Client Id e Client Secret. O Client Secret não entra em git, em doc nem em print. Redefinir o secret no Bling invalida o valor que está no `.env`.

O link de convite que o Bling mostra nessa tela não serve para esta API. O `state` dele não foi gravado por nós. Abrir esse link cai no callback e o painel mostra "A autorização do Bling expirou ou não confere". A autorização válida é o botão do painel, no passo 4.

## 2. Variáveis da API

Quatro variáveis. Enquanto faltar qualquer uma, o job registra `Background job tick` com `skipped: true` e `durationMs` perto de 0, e nenhuma nota sai.

| Variável | Local (`.env`) | QA (`.env.qa.example`, copiado para o `.env` da VPS) |
|---|---|---|
| `BLING_CLIENT_ID` | app local | app QA |
| `BLING_CLIENT_SECRET` | secret do app local | secret do app QA |
| `BLING_REDIRECT_URI` | `http://localhost:3000/api/v1/bling/oauth/callback` | `https://qa-api.edenbowls.com/api/v1/bling/oauth/callback` |
| `BLING_NATUREZA_OPERACAO_ID` | id numérico da natureza de venda da conta de teste | o mesmo, na conta usada pelo QA |

`BLING_NATUREZA_OPERACAO_ID` não sai do cadastro do aplicativo. No Bling, abra a natureza de operação de venda dessa conta e use o id numérico. A API manda esse id em todo pedido. Sem ele o serviço se considera desconfigurado, mesmo com Client Id e secret preenchidos.

O Compose de QA lê o `.env` do servidor. Na VPS, copie `.env.qa.example` para `.env` e reinicie a API. O `.env` local está no `.gitignore`. O `.env.qa.example` entra no git, então o secret de homologação do QA vai junto no commit.

Reinicie o processo depois de mudar o `.env`. A API lê essas variáveis só na subida. No local, pare e suba de novo o `npm run dev`.

Trocar o Client Secret também derruba a conexão. Os tokens ficam cifrados com uma chave derivada dele, então o painel volta a mostrar "Sem conexão" e é preciso autorizar de novo.

Depois da autorização, a API devolve o navegador para `ADMIN_APP_URL`. Esse valor tem de ser a mesma origem em que você abriu o painel: `http://localhost:5174` no local. O login do painel fica guardado por origem. Com outra porta, você volta sem sessão ou cai numa página que não abre.

## 3. Conta Bling em homologação

O cadastro do aplicativo não escolhe o ambiente fiscal. Quem escolhe é a conta Bling, em configurações de NF-e, ambiente de emissão Homologação.

Para conferir antes de testar: Todas as configurações, Notas fiscais, Configurações de NF-e, Configurações de Emissão. `<tpAmb>2</tpAmb>` é homologação e `<tpAmb>1</tpAmb>` é produção. A API do Bling não informa o ambiente, então essa conferência é manual. Se a conta estiver em produção, o job envia nota real à SEFAZ.

Use uma conta Bling só de testes. Assim, nota, pedido e contato de teste não ficam na conta que emite as notas reais. Ao autorizar, confira se o login do navegador está nessa conta.

Homologação emite nota de teste. Ela não vale, não substitui a fatura EB- da Eden Bowls e não deve ser enviada ao cliente como documento fiscal. Produção só quando a conta Bling e o aplicativo forem os de produção.

A natureza de operação, o certificado e os dados do emitente precisam existir nessa conta, senão o Bling recusa a nota mesmo com o OAuth certo.

NCM e origem ficam no painel, em cada variação do Brasil: Produtos, editar variação, Dados fiscais. Uma variação do Brasil não ativa sem NCM. A API cria o produto no Bling com esses dados e, se o produto já existir com NCM ou origem diferente, corrige antes de usar. Uma variação ativa sem NCM para a nota com erro, e a nota volta pela Nova tentativa depois do preenchimento.

O código do produto no Bling é `EDEN-<id da variação>`, por exemplo `EDEN-3001`. Ele usa o id porque o SKU do catálogo se repete entre variações e algumas não têm SKU.

Na conta de teste, o NCM provisório é `2309.10.00` (alimentos para cães e gatos em embalagem de varejo), com origem 0. Na conta de produção, NCM, origem, CFOP e tributação vêm do contador do cliente. Não copie os valores de teste.

## 4. Autorizar pelo painel

Com a API no ar e as quatro variáveis preenchidas:

1. Entre no painel com um usuário que tenha a permissão `bling.connect`.
2. Abra Notas fiscais: `http://localhost:5174/operations/nfe` no local, `https://qa-admin.edenbowls.com/operations/nfe` no QA.
3. Se as credenciais estiverem carregadas e a conta ainda não autorizou, a página mostra "Sem conexão" e o botão Autorizar Bling.
4. O botão pede à API um link com um `state` que ela acabou de gravar. O navegador vai ao Bling, você entra na conta de teste e autoriza.
5. O Bling devolve o navegador para o callback da API. A API troca o código pelo token e manda o navegador de volta ao painel. A mensagem esperada é "Bling autorizado."

"A autorização do Bling expirou ou não confere" é `state` inválido, inclusive o do link de convite. "O Bling recusou a autorização" é falha na troca do código. Tente de novo pelo botão.

O token fica na API. O painel não guarda Client Secret. O refresh dura 30 dias. O job renova o acesso para a autorização não morrer num mês sem cobrança no Brasil.

### Autorizar de novo

O botão só aparece quando a API sabe que a conexão caiu. Depois de mudar escopo no app, ela só descobre isso numa próxima chamada ao Bling. Sem nota na fila, o painel continua sem o botão, mesmo com a autorização revogada.

Para forçar, limpe a conexão no banco do ambiente e recarregue a página:

```sql
UPDATE bling_connection
SET needs_authorization = 1, access_token_enc = NULL, refresh_token_enc = NULL
WHERE id = 1;
```

Isso apaga só os tokens guardados. Nenhum dado do Bling muda. O botão Autorizar Bling volta a aparecer e o fluxo é o mesmo da lista acima.

## 5. O que o job faz depois

A cada 60 segundos o job `bling_nfe` pega faturas pagas do Brasil que já viraram linha de NF-e e, para cada uma, cria ou reutiliza contato, produto e pedido, gera a NF-e, envia à SEFAZ e consulta a situação.

O envio é automático. Com o Bling conectado, toda linha pendente em `bling_nfe` vira nota enviada sem nenhuma confirmação. Não insira linha de teste nessa tabela sem antes confirmar o ambiente da conta, como no passo 3.

O job `bling_nfe_sync` roda a cada 5 minutos e só lê do Bling. Ele percorre as notas de saída dos últimos 90 dias, porque a API do Bling não oferece webhook de nota, e faz duas coisas:

- Atualiza a nota que mudou de situação no Bling, como autorização, rejeição ou cancelamento. O painel mostra essa situação na coluna Bling.
- Importa a nota que existe só no Bling, por exemplo uma criada à mão. Ela aparece no painel com a marca "Criada no Bling". Fica somente para consulta: não entra na fila, não pode ser reenviada e o sistema nunca a envia à SEFAZ.

Ele usa o mesmo lock do `bling_nfe`, porque o Bling troca o refresh token a cada renovação. Se o outro job estiver rodando, esta rodada é pulada e a próxima vem em 5 minutos. A nota cancelada tem status próprio e não oferece reenvio.

Leitura do log:

- `skipped: true` sem `reason`: falta credencial ou falta `BLING_NATUREZA_OPERACAO_ID`.
- `skipped: true` com `reason: bling_not_connected`: as variáveis estão preenchidas e ninguém autorizou ainda, ou o refresh morreu.
- `scanned`, `updated`, `imported`, `failed`: resultado do `bling_nfe_sync`.
- `scanned`, `done`, `failed`: o job rodou de verdade. `failed` maior que zero é tentativa recusada. O detalhe da nota no painel guarda o erro. 403 de escopo não volta a tentar sozinho: o escopo tem de ser corrigido no app e a nota reenviada pelo painel.

Uma fatura sem CPF válido fica bloqueada antes de qualquer chamada ao Bling.

## 6. E-mail da nota ao cliente

Quem envia é a Eden Bowls. A opção `enviarEmail` do Bling fica desligada, então existe um remetente só. Este e-mail não é a fatura `EB-`. O cliente recebe os dois.

O envio fica ligado em todos os ambientes, e `BLING_NFE_EMAIL_ENABLED` vale `true` mesmo sem estar no `.env`. A nota autorizada entra na fila de e-mail. Os jobs `bling_nfe` (60 segundos, notas enviadas) e `bling_nfe_sync` (5 minutos, lista do Bling) descobrem a autorização. O `bling_nfe` envia no minuto seguinte, com o DANFE em PDF e o XML anexados.

No local e no QA, a nota é de teste, autorizada pela SEFAZ de homologação. O e-mail vai de verdade para o endereço do cliente da nota, com `[TESTE]` no assunto e o aviso de que não tem valor fiscal. Use endereços de teste nesses ambientes. Em produção, a nota é autorizada pela SEFAZ e o e-mail sai sem esse aviso.

Com `BLING_NFE_EMAIL_ENABLED=false`, a nota fica como "Não enviado" e não entra na fila. Religar depois não envia as notas antigas: use Enviar e-mail no detalhe da nota.

Proteções contra envio repetido:

- A nota entra na fila uma vez, na primeira autorização.
- O job reserva a nota no banco antes de enviar. Duas rodadas ao mesmo tempo não enviam duas vezes.
- O job consulta o Bling de novo logo antes do envio. Nota cancelada não sai.
- Se o servidor de e-mail não responder, ou o processo cair no meio do envio, não há nova tentativa automática, porque a mensagem pode ter sido entregue. O detalhe da nota mostra o motivo, e o operador decide.
- Outras falhas, como o Bling fora do ar, tentam até 6 vezes, com espera crescente de 5 minutos até 6 horas.
- Nota criada à mão no Bling não recebe e-mail.

## 7. O que o operador faz pelo painel

No detalhe da nota:

- **Nova tentativa:** volta a nota com erro, rejeitada ou sem documento para a fila.
- **Corrigir dados:** altera nome, e-mail, CPF e endereço de uma nota ainda não autorizada. Exige a permissão `nfe.edit`, de operador e administrador. Fica registrado na auditoria. Nada vai ao Bling nessa hora: a correção é aplicada pelo job na próxima tentativa, antes de enviar a nota.
- **Abrir no Bling:** abre a nota no site do Bling.
- **Enviar e-mail ou Reenviar e-mail:** coloca o e-mail da nota autorizada na fila. Pede confirmação, exige a permissão `nfe.retry` e fica na auditoria.

A correção também altera o contato no Bling. Um campo apagado no painel não apaga o valor lá, porque o Bling ignora valor vazio. Para limpar um campo, use o Bling.

No cadastro do cliente do Brasil, a seção Dados fiscais guarda o nome completo e o CPF usados nas próximas notas. O CPF só aparece para quem pode editar endereço. O endereço do cliente também tem número, bairro e UF. A loja vende só para pessoa física, então o documento é sempre CPF. O nome da nota é o nome completo pedido no checkout. Sem ele, a nota usa o nome de exibição.

Só no Bling, porque a API dele não oferece: cancelar nota autorizada, carta de correção, inutilizar numeração e alterar dados de nota autorizada. O painel avisa isso no detalhe da nota.

Não existe exclusão de nota. A API do Bling permite, mas esta integração não usa esse recurso, para não perder histórico fiscal.
