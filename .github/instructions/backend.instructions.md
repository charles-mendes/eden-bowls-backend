---
applyTo: "src/api/**/*.{js,cjs},src/services/**/*.{js,cjs},src/infrastructure/**/*.{js,cjs},src/config/**/*.{js,cjs},src/core/**/*.{js,cjs},src/utils/**/*.{js,cjs}"
description: "Padroes para API, servicos, infraestrutura e operacao do backend."
---

# Backend

## API

- Todo endpoint de negocio novo deve usar o namespace versionado `/api/v1`.
- Nao criar rotas de negocio com prefixos legados como `/wp-json`, `/custom`, `/test` ou `/jobs`.
- Rotas de onboarding, subscriptions, checkout, frete e catalogo devem permanecer no namespace `/api/v1`.
- Rotas auxiliares de diagnostico, quando indispensaveis, devem ser versionadas e separadas do contrato de negocio.
- Preserve os health checks `/health`, `/readiness`, `/liveness`, `/health/detailed` e as metricas em `/metrics`.

## Camadas e observabilidade

- `src/index.js` inicializa a aplicacao, o banco e o modo de execucao.
- `src/api` contem HTTP; `src/services` contem regras de negocio e orquestracao; `src/infrastructure` contem acesso a dados, scheduler e event processor.
- Nao registre dados sensiveis; respeite o redaction do logger.
- Em fluxos assincronos, use logs estruturados com contexto de `correlationId` ou `executionId`.

## Dominio ecommerce

- Recursos de onboarding e subscriptions pertencem ao usuario autenticado e devem filtrar ownership diretamente no SQL/TypeORM.
- Checkout e ACK de PaymentIntent devem chamar `AuthService.assertCriticalOperationAllowed(userId)` imediatamente antes da operacao.
- Nao alterar contratos de Stripe, frete, checkout ou subscriptions ao corrigir uma rota de pets sem necessidade direta.
- Dockerfile e compose existentes devem ser preservados; nao alterar infraestrutura sem necessidade direta.