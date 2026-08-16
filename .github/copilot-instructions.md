# Copilot Instructions

## Objetivo do sistema
- Microsservico Node.js para para vender produtos de ecommerce, com checkout, calculo de frete, integracao com Stripe
- Mantem trilha de processamento e status em MySQL.

## Stack principal
- Runtime: Node.js 18+ (package define >=18.17).
- Linguagem/modulo: JavaScript com CommonJS (package type: commonjs).
- API HTTP: Express 5.
- Seguranca HTTP: Helmet + express-rate-limit.
- Validacao de configuracao: Zod.
- Logging: Pino (com pino-pretty em desenvolvimento).
- Data/horario: Luxon e date-fns.

## Ferramentas de busca (já instaladas)

`rg`, `fd`, `tree` e `ast-grep` já estão instalados no ambiente local. Os comandos já funcionam. Use-os no terminal antes de ler arquivos. Não instale, não peça instalação e não substitua por `grep`, `find` ou `ls -R`.

1. Conteúdo: `rg "<padrão>" src` (ou `tests`, `docs`). Exemplo: `rg "getPets|createPet|PetService" src`
2. Arquivos: `fd "pet"` ou `fd "\.test\.js$"`
3. Arquitetura: `tree -L 2 -I 'node_modules|dist|coverage|.git'`
4. Estrutura de código: `ast-grep -p '<padrão>' -l js src`. Procura AST, não texto. Exemplo: `ast-grep -p 'createPet($$$)' -l js src`

Leia um arquivo só depois de localizá-lo com `rg`/`fd`/`ast-grep`. Não abra dezenas de arquivos para descobrir estrutura, rotas, services, repositories, testes ou como um padrão de chamada é usado.

## Regras gerais
- Antes de implementar, analise a estrutura existente, identifique padroes, reutilize componentes e informe os arquivos que serao alterados ou criados.
- Nao crie nova arquitetura sem autorizacao.
- Manter CommonJS (usar require/module.exports).
- Evitar log de dados sensiveis; seguir redaction do logger.
- Reutilizar constantes de `src/core/constants.js` e repositorios existentes.
- Nao introduzir ESM, TypeScript ou frameworks novos sem solicitacao explicita.
- Alteracoes em regras de negocio devem ter testes conforme o impacto.
- Em fluxos assincronos, manter logs estruturados com `correlationId`, `cronId` ou `executionId`.

## Validacao obrigatoria

Nunca rode tudo por padrao. Evite o fluxo `alterou 1 arquivo → npm test → dezenas de testes → centenas de linhas de saida`.

Prefira:

```text
Alterou 1 arquivo
  → descobrir testes relacionados em tests/
  → rodar somente eles
  → se falhar → corrigir
  → so entao ampliar o escopo
```

- Apos alterar codigo, execute primeiro o teste Jest mais rapido e especifico.
- Testes unitarios e de rota (Supertest) ficam em `tests/*.test.js`. Integracao MySQL fica em `tests/integration/` e permanece skipada sem `RUN_DB_INTEGRATION_TESTS=true`.
- Nao execute `npm test`, `npm run test:unit` nem `npm run test:integration` apos uma alteracao pequena.
- Escale conforme o impacto: service → routes → repository → integracao MySQL → suite completa so em alto impacto.
- Informe ao final os arquivos alterados, testes executados, problemas encontrados e o status.

## Jest

A suite completa (`npm test`) usa `--runInBand`. O recorte nao precisa da suite:

```bash
npx jest --runTestsByPath tests/auth.service.test.js
npx jest tests/onboarding-pets-create.routes.test.js -t "creates a pet for the authenticated user"
npx jest --findRelatedTests src/services/auth.service.js
npx jest --changedSince=HEAD
```

`--findRelatedTests` recebe o source em `src/`. `--changedSince=main` cobre a branch contra `main`. `npm test` so em alteracao de alto impacto (auth, ownership, checkout, Stripe, middleware compartilhado, DataSource, Jest config).

## Criterio de conclusao
- Implementacao concluida dentro do escopo, sem alterar banco, infraestrutura ou contratos publicos sem necessidade.
- Testes relacionados identificados e executados (nao a suite completa, salvo alto impacto).
- Nenhuma cobertura removida para obter sucesso.