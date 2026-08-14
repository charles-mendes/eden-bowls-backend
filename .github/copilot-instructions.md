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

## Regras gerais
- Antes de implementar, analise a estrutura existente, identifique padroes, reutilize componentes e informe os arquivos que serao alterados ou criados.
- Nao crie nova arquitetura sem autorizacao.
- Manter CommonJS (usar require/module.exports).
- Evitar log de dados sensiveis; seguir redaction do logger.
- Reutilizar constantes de `src/core/constants.js` e repositorios existentes.
- Nao introduzir ESM, TypeScript ou frameworks novos sem solicitacao explicita.
- Alteracoes em regras de negocio devem ter testes conforme o impacto.
- Em fluxos assincronos, manter logs estruturados com `correlationId`, `cronId` ou `executionId`.

## Criterio de conclusao
- Implementacao concluida dentro do escopo, sem alterar banco, infraestrutura ou contratos publicos sem necessidade.
- Testes relevantes identificados e executados.
- Nenhuma cobertura removida para obter sucesso.