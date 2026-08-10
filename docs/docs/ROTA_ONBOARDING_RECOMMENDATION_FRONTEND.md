# Rota onboarding recommendation para o frontend

## Endpoint

GET /api/v1/onboarding/session/:sessionId/recommendation

## Objetivo

Retornar a recomendação nutricional da sessão de onboarding, incluindo a recomendação detalhada por pet, o packaging sugerido e um bloco simplificado para uso direto na UI.

## Requisitos de autenticação

A rota aceita um token de sessão por um dos headers abaixo:

- x-session-token
- Authorization: Bearer <token>

Se nenhum token for enviado, a resposta será:

```json
{
  "success": false,
  "message": "Session access token is required."
}
```

## Request

Não há body para esta rota. Basta chamar o endpoint com o sessionId da URL.

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "session_id": "session-123",
    "country": "US",
    "recommendations": [
      {
        "pet_id": "pet-1",
        "pet_name": "Milo",
        "energy_kcal_dia": 500,
        "quantidade_g_dia": 300,
        "porte": "medium",
        "especie": "dog"
      }
    ],
    "packaging": {
      "selected_frequency": "monthly",
      "period_days": 30,
      "suggested_frequency": "monthly",
      "suggested_period_days": 30,
      "package_sizes_grams": [300, 500],
      "total_target_grams": 300,
      "suggested_bags_by_size": {
        "300": 1,
        "500": 0
      }
    },
    "simplified": {
      "country": "US",
      "period_days": 30,
      "labels": {
        "daily": "Per day",
        "monthly": "Per month",
        "packs": "Packs"
      },
      "pets": [
        {
          "pet_id": "pet-1",
          "pet_name": "Milo",
          "daily": {
            "value": 200,
            "unit": "g",
            "grams": 200,
            "formatted": "200 g"
          },
          "monthly": {
            "value": 6000,
            "unit": "g",
            "grams": 6000,
            "formatted": "6,000 g"
          },
          "packs": {
            "count": 2,
            "pack_size_grams": 500,
            "pack_size_value": 2,
            "pack_size_unit": "pack",
            "formatted": "2 packs"
          }
        }
      ]
    },
    "version": "v1"
  }
}
```

## Campos principais retornados

- session_id: identificador da sessão de onboarding
- country: país inferido para a recomendação
- recommendations: lista detalhada da recomendação nutricional por pet
- packaging: sugestão de embalagens e frequência
- simplified: bloco resumido para exibição na UI
- version: versão do contrato

## Observações para o frontend

- Use esta rota para montar a tela de plano com dados de recomendação antes da confirmação do plano.
- O bloco simplified é o mais direto para renderizar consumo diário, mensal e número de packs.
- O bloco packaging pode ser usado para montar a experiência de escolha de frequência e tamanho das embalagens.

## Exemplo de uso no frontend

```ts
async function getRecommendation(sessionId: string, sessionToken: string) {
  const response = await fetch(`/api/v1/onboarding/session/${sessionId}/recommendation`, {
    method: 'GET',
    headers: {
      'x-session-token': sessionToken
    }
  });

  return response.json();
}
```
