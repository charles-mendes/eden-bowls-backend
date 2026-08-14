---
applyTo: "src/**/*.{js,cjs}"
description: "Arquitetura, ORM e limites de runtime do backend."
---

# Arquitetura e ORM

- Preserve a separacao `api -> services -> infrastructure`.
- Use exclusivamente TypeORM 0.3.x com `EntitySchema` para entidades, consultas, repositorios e migrations.
- Entidades ficam em `src/infrastructure/entities`, repositorios em `src/infrastructure/repositories` e o DataSource em `src/infrastructure/db.js`.
- Nunca criar Prisma, Sequelize, Knex, Drizzle, `prisma/schema.prisma`, pasta `prisma` ou `PrismaClient`.
- O banco ativo e MySQL via `mysql2`; use sintaxe MySQL (`LIMIT`, backticks etc.), mesmo que `mssql` e `pg` estejam instalados.
- Para persistencia nova, reutilize os repositorios TypeORM existentes.

## Modos e flags

- `MODE=all`: HTTP e aplicacao completa.
- `MODE=http`: somente API HTTP.
- `MODE=cron`: API e scheduler, condicionado por `ENABLE_BACKGROUND_JOBS`.
- `MODE=worker`: API e consumidor Event Hub, condicionado por `ENABLE_BACKGROUND_JOBS` e conexao com o banco.
- Antes de alterar processamento, identifique o componente alvo e preserve o impacto esperado de `ENABLE_BACKGROUND_JOBS` e `PRIME_ENABLE_UPDATE`.
- Processamento de eventos deve continuar idempotente por `correlation_id`.

## Stack e integracoes

- Runtime Node.js 18+ com CommonJS.
- API Express 5; seguranca HTTP com Helmet e express-rate-limit.
- Configuracao com Zod; logs com Pino; datas com Luxon/date-fns.
- Integracoes: Prime API, Azure Blob Storage, Azure Event Hub/checkpoint store e servico corporativo de validacao.