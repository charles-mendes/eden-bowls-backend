# Copilot Instructions

# Regras obrigatórias de arquitetura

## ORM obrigatório

Este projeto utiliza exclusivamente:

- TypeORM

É proibido utilizar:

- Prisma
- Sequelize
- Knex
- Drizzle ORM
- qualquer outro ORM

Todas as entidades, consultas e migrations devem ser implementadas utilizando TypeORM.

Exemplo obrigatório:

Entity:
src/infrastructure/entities

Repository:
src/infrastructure/repositories

DataSource:
src/infrastructure/db

Nunca criar:
- prisma/schema.prisma
- pasta prisma
- PrismaClient

# Antes de implementar qualquer código

Obrigatório:

1. Analisar a estrutura existente.
2. Identificar padrões já utilizados.
3. Reutilizar componentes existentes.
4. Informar quais arquivos serão criados/alterados.
5. Somente depois modificar o código.

Nunca criar uma nova arquitetura sem autorização.

Antes de sugerir mudancas, identifique tambem o componente alvo (api, scheduler, worker, service ou infraestrutura) e considere impacto nas feature flags ENABLE_BACKGROUND_JOBS e PRIME_ENABLE_UPDATE. Qualquer alteracao em processamento de eventos deve preservar idempotencia por correlation_id.

## Padrao obrigatorio de rotas HTTP

- Todo endpoint de negocio deste backend deve usar prefixo versionado `/api/v1`.
- Nao criar novas rotas com prefixos legados como `/wp-json`, `/custom`, `/test` ou `/jobs` para funcionalidades de negocio.
- Em evolucoes de API, manter consistencia de naming e versionamento no namespace `/api/v1`.


## Objetivo do sistema
- Microsservico Node.js para validacao de documentos academicos.
- Orquestra integracoes com Prime API, Azure Blob Storage, Azure Event Hub e servico corporativo de validacao.
- Mantem trilha de processamento e status em MySQL.

## Stack principal
- Runtime: Node.js 18+ (package define >=18.17).
- Linguagem/modulo: JavaScript com CommonJS (package type: commonjs).
- API HTTP: Express 5.
- Seguranca HTTP: Helmet + express-rate-limit.
- Validacao de configuracao: Zod.
- Logging: Pino (com pino-pretty em desenvolvimento).
- Data/horario: Luxon e date-fns.

## Arquitetura do projeto
- src/index.js: bootstrap da aplicacao, conexao com banco e inicializacao por modo.
- src/config: leitura e validacao de variaveis de ambiente.
- src/api: camada HTTP (rotas de API, jobs, testes, health/readiness/liveness/metrics).
- src/services: regras de negocio e orquestracao de integracoes.
- src/infrastructure: acesso a banco, entidades TypeORM, repositorios, scheduler e event processor.
- src/core: constantes, erros, helpers, logger e utilitarios centrais.
- src/utils: utilitarios auxiliares.
- tests: testes unitarios, integracao, API e e2e (estrutura por tipo).

## Modos de execucao
- MODE=all: sobe HTTP e prepara app completo.
- MODE=http: sobe apenas API HTTP.
- MODE=cron: sobe API e scheduler (jobs agendados), condicionado por ENABLE_BACKGROUND_JOBS.
- MODE=worker: sobe API e consumidor Event Hub, condicionado por ENABLE_BACKGROUND_JOBS e conexao DB.

## Banco de dados e ORM
- ORM: TypeORM 0.3.x com EntitySchema.
- Data source: src/infrastructure/db.js.
- Banco principal configurado no DataSource: MySQL (driver mysql2). Esta e a unica configuracao ativa.
- Entidades principais: DocumentDetails, ReturnDocument, TypeJob, JobDocumentCollectionLog, DocumentLogValidation, DocumentProcessErrorLog, PayloadDocument, RuntimeConfig.
- Padrao de acesso: repositorios em src/infrastructure/repositories.js.
- Observacao: as dependencias mssql e pg estao no package.json mas nao sao usadas pelo DataSource ativo; usar sintaxe MySQL para queries deste projeto (LIMIT, backticks para identificadores, etc.), nao T-SQL/Postgres.

## Integracoes externas
- Prime API (consulta/alteracao de situacao e documentos).
- Azure Blob Storage (armazenamento de documentos).
- Azure Event Hub + checkpoint store blob (consumo de eventos de retorno).
- Servico corporativo de validacao (autenticacao OAuth + envio de payload).

## Bibliotecas instaladas (resumo)
Dependencias de runtime:
- API/seguranca: express, helmet, express-rate-limit.
- Dados/ORM: typeorm, reflect-metadata, mssql, mysql2, pg.
- Azure: @azure/storage-blob, @azure/event-hubs, @azure/eventhubs-checkpointstore-blob.
- HTTP/utilitarios: axios, node-fetch, uuid, JSONStream, xlsx.
- Config/validacao: dotenv, zod.
- Observabilidade: pino, prom-client.
- Agendamento e data: node-cron, luxon, date-fns.

Dependencias de desenvolvimento:
- Testes: jest, supertest, @types/jest.
- Execucao local: nodemon, concurrently, cross-env, dotenv-cli.
- Logging local: pino-pretty.

## Convencoes importantes para contribuicao
- Manter CommonJS (usar require/module.exports).
- Preservar separacao por camadas (api -> services -> infrastructure).
- Evitar log de dados sensiveis; seguir redaction do logger.
- Reusar constantes de src/core/constants.js para status e mensagens.
- Para acesso a dados, priorizar repositorios TypeORM existentes.
- Alteracoes de regras de negocio devem vir com testes (unitarios/integracao conforme impacto).
- Em fluxos assincromos (scheduler/worker), manter logs estruturados com contexto (correlationId/cronId/executionId).

## Endpoints e operacao
- Health checks: /health, /readiness, /liveness, /health/detailed.
- Metricas: /metrics.
- Rotas de negocio: /api/v1/situacao, /api/v1/documentos, /api/v1/alterar-situacao-documento.
- Jobs manuais expostos por HTTP devem seguir namespace versionado: /api/v1/jobs/run-pipeline, /api/v1/jobs/sync-students, /api/v1/jobs/send-corporate, /api/v1/jobs/resend-pending-corporate.
- Rotas auxiliares de teste/diagnostico, quando necessarias, devem seguir namespace versionado: /api/v1/test/student-flow, /api/v1/test/query-students, /api/v1/test/send-to-corporate-v2.

## Comandos de desenvolvimento
- npm install
- npm run dev
- npm run dev:http
- npm run dev:worker
- npm run dev:all
- npm test
- npm run test:coverage
- npm run test:integration
- npm run test:unit

## Container e deploy
- Dockerfile multi-stage com alvos dev e prod.
- Compose com 3 servicos: api (MODE=http), cron (MODE=cron), worker (MODE=worker).
- Manifestos Kubernetes separados por componente em kubernetes/api, kubernetes/scheduler e kubernetes/worker.

## Regras adicionais para o Copilot
- Nao introduzir ESM, TypeScript ou frameworks novos sem solicitacao explicita.