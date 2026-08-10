# Rota onboarding session core para o frontend

## Objetivo

Fornecer os endpoints iniciais do fluxo de onboarding para criar uma sessão, consultar o estado atual, atualizar o token de sessão e vincular uma conta ao processo.

## Base da rota

Todas as rotas abaixo usam o prefixo:

```txt
/api/v1/onboarding/session
```

## Regras de autenticação

- A rota de criação da sessão pode ser chamada sem autenticação.
- As rotas de consulta, refresh e account-link aceitam um token de sessão por um dos headers abaixo:
  - x-session-token
  - Authorization: Bearer <token>

Se o header não for enviado, a API retornará um erro 401 com a mensagem:

```json
{
  "success": false,
  "message": "Session access token is required."
}
```

---

## 1) Criar uma nova sessão de onboarding

### Endpoint

```http
POST /api/v1/onboarding/session/start
```

### Body

```json
{
  "locale": "en",
  "country": "US",
  "state": "CA",
  "plan_id": "plan-1"
}
```

### Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session": {
      "session_id": "session_123",
      "status": "active"
    },
    "session_token": "session-token-123",
    "token_type": "Bearer",
    "expires_in": 172800,
    "expires_at": "2026-08-10T00:00:00.000Z"
  }
}
```

### Exemplo no frontend

```ts
async function startOnboardingSession(payload: Record<string, unknown>) {
  const response = await fetch('/api/v1/onboarding/session/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return response.json();
}
```

---

## 2) Buscar o snapshot da sessão

### Endpoint

```http
GET /api/v1/onboarding/session/:sessionId
```

### Headers

```http
x-session-token: <token>
```

ou

```http
Authorization: Bearer <token>
```

### Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session_123",
    "status": "active",
    "pets": [],
    "questionnaire": {},
    "recurrence": {},
    "plan_selection": {},
    "shipping": {},
    "zipcode": null,
    "locale": "en",
    "country": "US",
    "state": "CA",
    "created_at": "2026-08-01T00:00:00.000Z",
    "updated_at": "2026-08-01T00:00:00.000Z"
  }
}
```

### Exemplo no frontend

```ts
async function getSessionSnapshot(sessionId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    }
  });

  return response.json();
}
```

---

## 3) Renovar o token da sessão

### Endpoint

```http
POST /api/v1/onboarding/session/:sessionId/token/refresh
```

### Headers

```http
x-session-token: <token>
```

### Body

```json
{
  "refresh_token": "refresh-token-123"
}
```

### Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session_123",
    "session_token": "session-token-456",
    "token_type": "Bearer",
    "expires_in": 172800,
    "expires_at": "2026-08-10T00:00:00.000Z"
  }
}
```

### Exemplo no frontend

```ts
async function refreshSessionToken(sessionId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/token/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify({ refresh_token: 'refresh-token-123' })
  });

  return response.json();
}
```

---

## 4) Vincular uma conta à sessão

### Endpoint

```http
POST /api/v1/onboarding/session/:sessionId/account-link
```

### Headers

```http
x-session-token: <token>
```

### Body

```json
{
  "account_id": "account_123"
}
```

### Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session_123",
    "status": "linked",
    "linked_user_id": "user_123",
    "pets": [],
    "merge_summary": {
      "linked": true,
      "pet_count": 0
    }
  }
}
```

### Exemplo no frontend

```ts
async function linkAccountToSession(sessionId: string, sessionToken: string, accountId: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/account-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify({ account_id: accountId })
  });

  return response.json();
}
```

---

## Observações para o frontend

- Guarde o `session_token` retornado no início do onboarding e use-o nas próximas chamadas.
- A rota de refresh é útil para manter a sessão viva sem exigir novo login.
- A rota de `account-link` deve ser usada quando o usuário já estiver autenticado e quiser vincular a conta ao processo de onboarding.
- Em caso de erro, a API retorna `success: false` e uma mensagem descritiva.
