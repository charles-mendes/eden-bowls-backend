---
applyTo: "src/**/*.{js,cjs},tests/**/*.{js,cjs}"
description: "Use when changing backend services, routes, repositories, middleware, or tests and deciding the smallest appropriate Jest validation."
---

# Testes automatizados (Jest)

## Regra principal: nunca rodar tudo por padrao

Evite o fluxo:

```text
Alterou 1 arquivo
  → npm test
  → 50+ testes
  → a IA recebe centenas de linhas
```

Prefira:

```text
Alterou 1 arquivo
  → descobrir testes relacionados
  → rodar somente eles
  → se falhar → corrigir
  → so entao ampliar o escopo
```

Este backend usa Jest em Node, CommonJS. Os testes ficam em `tests/**/*.test.js`. Nao ha Vitest, Playwright nem arquivos `.spec.ts` neste repositorio.

Nao execute `npm test`, `npm run test:unit` nem `npm run test:integration` para uma alteracao pequena.

## Estrategia

Depois de alterar codigo:

1. Identifique o arquivo em `src/` e o teste correspondente em `tests/`.
2. Execute o recorte mais especifico (arquivo, `-t` ou `--findRelatedTests`).
3. Corrija falhas antes de avancar.
4. Amplie o escopo so se o recorte passou e o impacto exigir.

A ordem padrao e:

```text
Implementacao
  -> Jest do arquivo ou --findRelatedTests
  -> rotas Supertest relacionadas, quando a HTTP mudou
  -> repositorio / integracao MySQL, quando a persistencia mudou
  -> suite completa somente em alteracoes de alto impacto
```

## Mapa de arquivos

O teste nao fica ao lado do source. O nome em `tests/` espelha a camada:

| Alterou | Rode primeiro |
| --- | --- |
| `src/services/auth.service.js` | `tests/auth.service.test.js` |
| `src/api/routes/onboarding-pets-create.routes.js` | `tests/onboarding-pets-create.routes.test.js` |
| `src/infrastructure/repositories/products.repository.js` | `tests/products.repository.test.js` |
| `src/api/middleware/bearer-token.middleware.js` | `tests/bearer-token.middleware.test.js` |
| `src/core/jwt-token.js` | `tests/jwt-token.test.js` |
| SQL / TypeORM / migration | `tests/*.repository.test.js` e, se persistencia real, `tests/integration/` |

Uma mudanca de servico frequentemente puxa tambem o `*.routes.test.js` da mesma feature.

## Arquivo conhecido: --runTestsByPath

Melhor opcao quando voce ja sabe o spec:

```bash
npx jest --runTestsByPath tests/auth.service.test.js
npx jest --runTestsByPath tests/onboarding-pets-create.routes.test.js
```

`--runTestsByPath` nao faz glob. Use o caminho exato do arquivo de teste.

## Nome conhecido: -t

```bash
npx jest tests/onboarding-pets-create.routes.test.js -t "creates a pet for the authenticated user"
npx jest tests/auth.service.test.js -t "returns token payload"
```

## Source conhecido: --findRelatedTests

Jest segue os `require()` dos testes ate o arquivo alterado:

```text
src/services/auth.service.js
       ↓
Jest --findRelatedTests
       ↓
tests/auth.service.test.js
```

```bash
npx jest --findRelatedTests src/services/auth.service.js
npx jest --findRelatedTests src/api/routes/onboarding-pets-create.routes.js
npm run test:related -- src/services/auth.service.js
```

Passe o arquivo de **source**. Nao passe o arquivo de teste.

## Git: --changedSince

```bash
npx jest --changedSince=HEAD
npm run test:changed
npx jest --changedSince=main
```

`--changedSince=HEAD` cobre o trabalho ainda nao commitado. `--changedSince=main` cobre o diff da branch contra `main`.

## Integracao com MySQL

Os arquivos em `tests/integration/` ficam em `describe.skip` salvo `RUN_DB_INTEGRATION_TESTS=true`. Nao ligue essa flag para teste de servico, rota ou middleware.

```bash
RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/products.repository.integration.test.js
npm run test:integration
```

Use integracao quando a mudanca for SQL, TypeORM, tabela, migration ou contrato de persistencia que o unitario com mock nao cobre.

## Limites

- Jest de um arquivo ou `--findRelatedTests`: ate 60 segundos.
- Recorte de uma feature (service + routes + repository): ate 2 minutos.
- Integracao MySQL do arquivo afetado: ate 3 minutos.
- Suite completa (`npm test`): ate 10 minutos.

Se um teste ultrapassar significativamente o limite, investigue loop, timeout, banco indisponivel, mock quebrado ou `--runInBand` esquecido na suite. Nao aumente timeouts indiscriminadamente.

A suite completa usa `--runInBand` de proposito: um processo Node, sem workers. Nao adicione `--maxWorkers` para "acelerar" e nao serialize ainda mais um recorte de um arquivo.

## Alteracoes de alto impacto

Para autenticacao, refresh token, ownership, checkout, PaymentIntent, Stripe, subscriptions, middleware compartilhado, `src/app.js`, DataSource ou `jest.config.cjs`, execute as camadas relevantes (service, routes, repository) e considere `npm test`.

## O que nao fazer

- Nao desabilite testes, use `skip`/`only`, remova assertions ou aumente timeouts so para obter verde.
- Nao rode a suite para validar um `test()` novo: rode aquele arquivo.
- Nao use Playwright, Vitest nem `*.spec.ts` neste repositorio.
