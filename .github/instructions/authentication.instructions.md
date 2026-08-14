---
applyTo: "src/**/*auth*.js,src/**/*Auth*.js,src/api/**/*.{js,cjs},src/services/**/*.{js,cjs},tests/**/*auth*.js,tests/**/*Auth*.js"
description: "Autenticacao, refresh token e ownership de recursos."
---

# Autenticacao e ownership

- Nao criar, restaurar ou aceitar `sessionId`, `session_token`, `x-session-token` ou rotas `/api/v1/onboarding/session/...`.
- Access JWT deve usar `HS256` explicitamente, com algoritmo fixado na verificacao; nunca confie no algoritmo informado pelo token nao verificado.
- Access JWT tem TTL de 15 minutos.
- Refresh token deve ser opaco, aleatorio, rotativo e persistido somente como hash SHA-256 via TypeORM/MySQL.
- Envie refresh token somente em cookie `HttpOnly` com `Path=/api/v1/auth`.
- Refresh/logout exigem origin permitido e `X-Requested-With: XMLHttpRequest`. CORS com credenciais usa apenas origins exatas configuradas.
- `Secure=false` so e permitido em development/test localhost.
- Rotacao deve ser atomica. O token substituido permite um replay por no maximo 5 segundos; reuso posterior revoga a familia e registra log/metrica sem material do token.
- Troca/reset de senha, comprometimento, suspensao e banimento revogam todas as familias de refresh do usuario.
- Queries de onboarding e subscriptions devem filtrar `user_id` diretamente no SQL/TypeORM; nunca busque e filtre ownership em memoria.
- Checkout, ACK de PaymentIntent e acoes de subscription devem chamar `AuthService.assertCriticalOperationAllowed(userId)` imediatamente antes da operacao.
- Teste casos negativos de IDOR, incluindo IDs de pet e payment intent de outro usuario.