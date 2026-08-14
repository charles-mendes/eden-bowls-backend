---
applyTo: "tests/**/*.{js,cjs},src/**/*.test.{js,cjs},src/**/*.spec.{js,cjs}"
description: "Estrategia e comandos de testes do backend."
---

# Testes

- Alteracoes de regras de negocio devem incluir testes unitarios ou de integracao conforme o impacto.
- Use Jest e Supertest conforme os padroes existentes.
- Testes unitarios: `npm run test:unit`.
- Testes de integracao: `npm run test:integration`.
- Suite completa: `npm test`.
- Cobertura: `npm run test:coverage`.
- Ao alterar autenticacao, ownership ou rotas, cubra tambem casos negativos, headers, status e resposta de erro.
- Nao desabilite testes, use `skip`/`only`, remova assertions ou aumente timeouts apenas para obter uma execucao verde.
- Apos alterar codigo, execute primeiro o teste mais rapido capaz de detectar o problema e depois escale a validacao conforme o impacto.