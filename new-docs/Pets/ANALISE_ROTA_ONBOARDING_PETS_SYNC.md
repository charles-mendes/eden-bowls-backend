# Analise Tecnica - Rota Onboarding Pets Sync (versao atual Node.js)

## Escopo

Rota atual no backend Node:

- POST /api/v1/onboarding/pets/sync

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (`syncPetsInApi`, usada por `syncLocalPetsToApi`)

Arquivos analisados:

- eden-bowls-backend/src/api/routes/onboarding-pets-sync.routes.js
- eden-bowls-backend/src/api/validators/onboarding-pets-sync.validator.js
- eden-bowls-backend/src/services/onboarding-pets-sync.service.js
- eden-bowls-backend/src/infrastructure/repositories/onboarding-pets-create.repository.js
- eden-bowls-backend/src/infrastructure/migrations/1700000000004-create-user-owned-onboarding-tables.js
- eden-bowls-backend/tests/onboarding-pets-sync.routes.test.js
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/onboarding/Onboarding.tsx
- eden-bowls/src/pages/plan/Plan.tsx

Esta rota nao existia no WordPress. Ela surgiu no modelo user-owned para sincronizar pets locais (ainda sem `petId`) de forma idempotente.

## Responsabilidade da rota

A rota faz upsert em lote dos pets do usuario autenticado.

Cada item chega com `local_id` gerado no frontend. O backend insere ou atualiza a linha correspondente em `onboarding_pets` e devolve o mapeamento `local_id -> id` para o front preencher `petId`.

## Endpoint, Controller e permissao

### Endpoint

- Path: /api/v1/onboarding/pets/sync
- Method: POST
- Registro: `registerOnboardingPetsSyncRoutes`

### Controller

- Exige `request.currentUser.id`
- Faz parse do body com `parseOnboardingPetsSyncInput`
- Chama `OnboardingPetsSyncService.syncPets({ userId, payload })`
- Retorna envelope `{ success: true, data }` com status 200

### Regra de acesso

Igual as demais rotas de pets:

- JWT Bearer obrigatorio
- 401 sem usuario autenticado
- 400 se o payload falhar o schema Zod

## Parametros recebidos

Headers:

- Authorization: Bearer token (obrigatorio)
- Content-Type: application/json

Body:

```json
{
  "pets": [
    {
      "local_id": "local-1",
      "name": "Luna",
      "breed": "Maltese",
      "age_years": 2,
      "age_months": 0,
      "weight": 13,
      "weight_unit": "kg",
      "size": "small",
      "activity_level": "high",
      "pet_condition": "overweight",
      "neutered": false
    }
  ]
}
```

Regras do schema:

- `pets` e array obrigatorio, minimo 1, maximo 20
- `local_id`: string obrigatoria, 1..36
- `name`: string obrigatoria, 1..120
- demais campos opcionais, com os mesmos enums das outras rotas

## Fluxo da requisicao

1. POST /api/v1/onboarding/pets/sync chega na rota
2. middleware JWT popula `request.currentUser`
3. validator exige 1..20 pets com `local_id` e `name`
4. service chama `OnboardingPetCreateRepository.syncPets`
5. para cada pet, o repository gera UUID se nao houver `pet_id`
6. executa INSERT ... ON DUPLICATE KEY UPDATE
7. o unique usado no conflito e (`user_id`, `local_id`)
8. em update, `deleted_at` volta para `NULL`
9. a resposta devolve `{ pets: [{ local_id, id }] }`

## Estrutura de resposta

```json
{
  "success": true,
  "data": {
    "pets": [
      {
        "local_id": "local-1",
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      }
    ]
  }
}
```

O frontend usa esse mapa para preencher `pet.petId`.

## Regras de negocio atuais

1. Idempotencia por `local_id`
- repetir o sync do mesmo pet local atualiza a linha em vez de criar outra.

2. Reativacao
- se o pet tinha `deleted_at`, o upsert zera essa coluna.

3. Defaults no repository
- `breed`: `''`
- `age_years` / `age_months` / `weight`: `0`
- `weight_unit`: `kg`
- `size`: `medium`
- `activity_level`: `medium`
- `pet_condition`: `ideal`
- `neutered`: `false`

4. Sem upload de imagem e sem conversao de peso.

## Relacao com as outras rotas de pets

- GET /pets lista os pets ativos depois do sync
- POST /pets cria um pet avulso, sem `local_id`
- PATCH /pets/:petId edita um pet ja persistido
- DELETE /pets/:petId faz soft delete; um sync posterior com o mesmo `local_id` pode reativa-lo

## Consumo no frontend

`syncLocalPetsToApi` separa pets com e sem `petId`. Os pendentes passam por `syncPetsInApi`.

Uso:

- Onboarding, ao continuar para `/plan`
- Plan, antes de preview/checkout quando ainda ha pet local

## Status

- Rota nova do modelo user-owned.
- Nao tem equivalente direto no WordPress.
- Documentacao incluida porque faz parte do fluxo atual de pets.
