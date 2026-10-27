# Design

## Context

- `nutrition-recommendation.js` aplica uma cadeia fixa de regras: fator base, sobrescrita por estado, grupo Dogue (200), exceção de metabolismo lento (95), sobrescrita por combinação e ajustes de gato. Os números estão em constantes nomeadas (`COMBINATION_FACTORS`, `STATE_FACTORS`, `DOG_BASE_FACTOR`…) e em literais dentro de `selectBaseFactor` (165, 125, 130, 110, 105, 80). Os grupos de raça são três `Set` com nomes normalizados.
- `LifeStageService` lê `life_stage_size_classes` e `life_stage_breeds` por mercado a cada avaliação (`repository.forMarket`). Não há rota admin para esses dados.
- A fatura lê `INVOICE_ISSUERS` de `invoice-copy.js`. O PDF é refeito sob o mesmo número quando o arquivo some ou o status muda (skill `eden-invoice`, regras 4 e 11). Por isso o emissor precisa ser congelado na fatura.
- Os e-mails usam `BRAND.support` (fixo, `html.js`) e `companyAddressFromEnv` (`MAIL_COMPANY_*`, lido em `life-stage-announcement.service.js` e na montagem do rodapé).
- O consentimento grava `privacyVersion`/`termsVersion` enviados pela loja, ou as constantes de `legal-documents.js` quando ausentes. O texto legal mora nos `.md` da loja e é pré-renderizado no build.
- A API e o `cron` são processos separados. Nenhum cache em memória é compartilhado entre eles.

## Goals / Non-Goals

**Goals:**
- Os valores viram dados, e as regras continuam no código, testáveis.
- Deploy sem mudança visível: toda semente reproduz o valor de hoje, inclusive o texto impresso na fatura.

**Non-Goals:**
- Juntar a lista de porte gigante com o grupo energético Dogue. É uma decisão clínica da veterinária; a tela mostra as duas.
- Pedir novo aceite aos clientes quando um documento legal muda.
- Parâmetros nutricionais por mercado. O cálculo de energia é o mesmo nos dois mercados; só os limites de fase variam.
- Mudar o layout aprovado da fatura.

## Decisions

### 1. Conjunto de parâmetros nutricionais versionado, em JSON

Tabela `nutrition_parameter_sets` (`id`, `status` `draft|published|retired`, `parameters` JSON, `created_by`, `published_by`, `published_at`). O JSON tem chaves nomeadas para cada número, por exemplo `base.work_dog_high: 165`, e as listas `breed_groups.dogue|slow_metabolism|terranova`.

`nutrition-recommendation.js` passa a receber `parameters` como argumento, com os valores atuais como padrão para os testes puros. Quem chama lê o conjunto publicado por um repositório com `TtlCache` de 60 s. Esse tempo vale em cada processo, então o `cron` vê a publicação em no máximo 60 s.

A recomendação grava `nutrition_parameter_set_id` junto do resultado, no repositório de recomendação do onboarding.

Alternativa descartada: uma linha por fator. São cerca de 30 números que só fazem sentido juntos; versionar o conjunto inteiro dá histórico e comparação simples.

### 2. Rascunho único e simulação com rascunho

Existe no máximo um rascunho. Ele é criado copiando o publicado, salvo à vontade, e publicado numa transação que marca o anterior `retired`. `POST /api/v1/admin/nutrition/simulate` aceita `parameter_set: "draft"`, mas só com `nutrition.settings.write`.

### 3. Limites de fase: edição direta com prévia, sem versão

`life_stage_size_classes` e `life_stage_breeds` já existem, por mercado, com colunas de auditoria. A edição é direta, porque cada linha já é a fonte e a mudança é registrada na auditoria.

A prévia (`POST …/life-stage/preview`) recalcula a fase dos pets com assinatura ativa do mercado usando os limites propostos e devolve a contagem por transição (`adult→senior`…), sem gravar. O e-mail de mudança de fase continua sendo disparado pelo job, que já compara a fase gravada com a calculada.

### 4. Permissões novas

Em `admin-roles.js`:
- `nutrition.settings.write` para `veterinarian` e `admin`.
- `settings.read` para `admin`, `operator` e `readonly`.
- `settings.company.write` e `legal.write` só para `admin`.
- `settings.email.write` para `admin` e `operator`.

O operador não recebe as permissões de nutrição: o ajuste é clínico.

### 5. Dados da empresa: tabela por mercado e cópia na fatura

Tabela `company_profiles` com chave `market`. Semente: os valores hoje impressos na fatura e nas prévias de e-mail.

`invoice-copy.js` mantém só a composição do texto: uma função `issuerFor(locale, profile)` gera a linha aprovada. `INVOICE_ISSUERS` deixa de ter dados.

`customer_invoices` ganha `issuer_snapshot` (JSON), gravado quando a fatura recebe o número. `invoice-document.js` lê só o snapshot. A migração preenche o snapshot das faturas existentes com a semente, que é exatamente o que elas imprimiram.

`company-address.js` passa a ler o perfil, e `BRAND.support` vem do perfil do mercado da carta. As OTP e os convites sem mercado usam o perfil US, como já usam o inglês por padrão.

### 6. Documentos legais: versões imutáveis

Tabela `legal_documents` (`market`, `kind`, `version`, `body_markdown`, `published_at`, `published_by`), única por (`market`, `kind`, `version`). Não há rascunho no banco: o painel edita o texto localmente e publica.

`legal-documents.js` deixa de ter constantes e ganha `currentVersion(market, kind)`, lida pelo repositório com cache.

Na loja, as páginas legais buscam o texto em runtime. O build pré-renderiza com a mesma rota e, sem a API, publica as páginas sem pré-renderização. É a mesma regra da fase 1 para receitas.

A semente copia os quatro `.md` atuais da loja para `helpers/seed-legal-documents.js`.

### 7. E-mails automáticos: tabela por mercado, lida a cada execução

Tabela `automated_email_settings` com chave `market`. Os jobs leem a linha do mercado no início de cada execução, sem cache, então desligar vale na execução seguinte em qualquer processo.

A migração lê `process.env` com os mesmos padrões de `env.js`. É a única migração que lê o ambiente, e isso fica registrado no seu comentário. Depois, `env.js` e os `.env*.example` perdem as variáveis.

### 8. Duas páginas no painel, menu com dois itens novos

- "Parâmetros nutricionais" (`/nutrition/settings`), no grupo Ferramentas: abas Fases da vida, Raças e Fatores.
- "Configurações" (`/config`), no grupo Administração: abas Empresa, Documentos legais e E-mails automáticos.

Cada aba aparece conforme a permissão de leitura do usuário. O detalhe fica no change irmão do painel.

## Risks / Trade-offs

- [Um fator publicado errado muda a porção de todos os clientes] → Rascunho com simulação, histórico read-only e republicação de um conjunto anterior como rascunho novo. A recomendação grava o conjunto usado, o que permite achar os clientes afetados.
- [Baixar um limite de fase dispara e-mails de mudança de fase para muitos clientes] → A prévia mostra a contagem antes de salvar; o painel exige confirmação acima de zero; o envio continua sujeito ao lote e ao limite diário.
- [Mudar os dados da empresa muda o texto da fatura sem novo PDF aprovado] → A composição aprovada fica no código; só os valores mudam. Faturas emitidas mantêm o snapshot. A skill `eden-invoice` deve ser atualizada para dizer que o emissor vem de `company_profiles`.
- [Migração lendo o ambiente pode semear valores diferentes por ambiente] → É o comportamento desejado: cada ambiente mantém o estado que tinha. O resultado da semente aparece no log da migração.
- [A loja fica sem texto legal se a API cair] → A página mostra o erro com link de contato. Na mesma situação, a loja também não faz cadastro nem checkout.

## Migration Plan

1. API: migrações com semente e as rotas novas. Os valores efetivos ficam iguais.
2. Conferir em QA: `npm run invoice:previews` comparado com o PDF aprovado, prévias de e-mail e simulações dos testes de nutrição iguais.
3. Painel: as duas páginas.
4. Loja: páginas legais e cadastro lendo da API; remover os `.md` legais e `documentVersions.ts`.
5. Remover as variáveis antigas dos ambientes.

Rollback: cada migração tem `down`. O snapshot do emissor é ignorado pelo código antigo. As variáveis de ambiente só são removidas no passo 5, então voltar a API antes disso restaura o comportamento anterior.
