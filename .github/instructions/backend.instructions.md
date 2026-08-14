---
applyTo: "src/api/**/*.{js,cjs},src/services/**/*.{js,cjs},src/infrastructure/**/*.{js,cjs},src/config/**/*.{js,cjs},src/core/**/*.{js,cjs},src/utils/**/*.{js,cjs}"
description: "Padroes para API, servicos, infraestrutura e operacao do backend."
---

# Backend

## API

- Todo endpoint de negocio novo deve usar o namespace versionado `/api/v1`.
- Nao criar rotas de negocio com prefixos legados como `/wp-json`, `/custom`, `/test` ou `/jobs`.
- Rotas existentes incluem `/api/v1/situacao`, `/api/v1/documentos` e `/api/v1/alterar-situacao-documento`.
- Jobs HTTP usam `/api/v1/jobs/...`; rotas auxiliares de diagnostico usam `/api/v1/test/...`.
- Preserve os health checks `/health`, `/readiness`, `/liveness`, `/health/detailed` e as metricas em `/metrics`.

## Camadas e observabilidade

- `src/index.js` inicializa a aplicacao, o banco e o modo de execucao.
- `src/api` contem HTTP; `src/services` contem regras de negocio e orquestracao; `src/infrastructure` contem acesso a dados, scheduler e event processor.
- Nao registre dados sensiveis; respeite o redaction do logger.
- Em scheduler/worker, use logs estruturados com contexto de `correlationId`, `cronId` e `executionId`.

## Operacao

- Compose: `api` usa `MODE=http`, `cron` usa `MODE=cron` e `worker` usa `MODE=worker`.
- Dockerfile e manifestos Kubernetes existentes devem ser preservados; nao alterar infraestrutura sem necessidade direta.