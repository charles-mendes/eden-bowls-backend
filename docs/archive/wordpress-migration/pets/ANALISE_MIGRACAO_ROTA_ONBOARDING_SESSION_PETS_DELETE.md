# Analise Tecnica - Migracao da Rota Onboarding Delete Pet para Node.js

## Escopo

Rota atual no WordPress:

- DELETE /custom/v1/onboarding/session/:sessionId/pets/:petId

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (deletePetInApi)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/onboarding/ONBOARDING_RULES.md
- eden-bowls/src/pages/onboarding/Onboarding.tsx
- eden-bowls/src/pages/dashboard/pages/MyPets.tsx

## Responsabilidade da rota

A rota remove um pet do contexto de onboarding.

No WordPress isso nao e uma exclusao fisica imediata do snapshot principal. O comportamento padrao e marcar o pet como removido com `deleted_at`, `deleted_by_user_id` e `deleted_reason`, e depois salvar a sessao atualizada.

Se o pet nao existir na sessao informada, o backend tenta localizar o pet em outra sessao pertencente ao mesmo usuario autenticado e aplica a mesma exclusao suave na sessao proprietaria.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/pets/(?P<pet_id>[A-Za-z0-9-]+)
- Method: DELETE
- Callback: OnboardingApi::remove_pet
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Extrai `pet_id`
- Chama `OnboardingService::remove_pet(sessionId, petId)`
- Retorna envelope `{ success: true, data: result }` com status 200

### Regra de acesso importante

A rota exige acesso por sessao valida:

1. `x-session-token` e priorizado;
2. `Authorization: Bearer ...` pode ser usado;
3. o token precisa ser valido para a `session_id` solicitada.

Erros de acesso comuns:

- 401 session_unauthorized
- 403 session_forbidden
- 404 session_not_found
- 429 rate_limit

## Parametros recebidos

Path params:

- session_id: string
- pet_id: string

Headers:

- x-session-token (preferencial)
- Authorization: Bearer token (fallback para flows headless)

Body:

- nenhum

## Validacoes que devem existir

## 1) Validacao de sessao

- `session_id` obrigatorio
- sessao deve existir no repositório SQL ou no fallback legado

Erro:

- `session_not_found` -> 404

## 2) Validacao do pet alvo

A exclusao tenta primeiro localizar o pet dentro da sessao informada.

- se o pet existir na sessao, aplica soft delete
- se nao existir, tenta localizar o pet em outra sessao do mesmo usuario autenticado

Erros:

- `pet_not_found` -> 404

## 3) Validacao de usuario para fallback

Se o pet nao estiver na sessao alvo, o fallback para outra sessao so acontece quando:

- o usuario atual esta autenticado no WordPress;
- o usuario possui outras sessoes vinculadas;
- uma dessas sessoes contem o `petId` alvo.

Sem usuario autenticado, a rota falha com `pet_not_found`.

## Fluxo da requisicao

1. DELETE /pets/:petId chega na rota
2. permission callback valida sessao
3. controller chama `OnboardingService::remove_pet`
4. service carrega a sessao alvo
5. procura o pet no snapshot da sessao
6. se encontrar, marca o pet como removido com soft delete
7. se nao encontrar, e se o usuario estiver autenticado, busca o pet em outras sessoes do mesmo usuario
8. se achar em outra sessao, aplica o soft delete na sessao proprietaria
9. persiste a sessao atualizada
10. retorna `session` + `removed_pet`

## Estrutura de resposta

Envelope HTTP:

- success: true
- data: { session, removed_pet }

Campos relevantes no retorno:

- session.session_id
- session.pets
- removed_pet.id
- removed_pet.deleted_at
- removed_pet.deleted_by_user_id
- removed_pet.deleted_reason

O frontend normalmente nao consome esse payload para renderizar detalhes; ele apenas remove o pet do estado local.

## Regras de negocio escondidas no WordPress

1. Exclusao suave
- o pet nao e apagado fisicamente no snapshot; recebe marca de remocao.

2. Fallback para outras sessoes do usuario
- se o pet nao esta na sessao informada, o backend tenta localiza-lo em outras sessoes do mesmo usuario.

3. Auditoria de remocao
- a rota registra quem removeu (`deleted_by_user_id`) e o motivo (`user_request`).

4. Reuso de pets entre sessoes
- o mesmo `petId` pode existir em sessoes diferentes do mesmo usuario, e a rota sabe procurar a sessao proprietaria.

5. Cleanup de imagem ligada ao pet
- quando a imagem do pet e substituida em update, o backend evita apagar arquivo que ainda e referenciado por outros pets.
- a exclusao do pet deve respeitar a mesma logica de nao quebrar referencias de imagem compartilhada, se houver.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_hsr_onboarding_sessions
- leitura da sessao alvo
- escrita do aggregate atualizado com `pets[]`

2. wp_hsr_onboarding_pets
- persistencia auxiliar do snapshot de pets

3. wp_posts / wp_postmeta
- nao e usado diretamente no delete alvo, mas o fallback por outras sessoes depende de contexto de usuario e pode tocar pedidos em outros fluxos do onboarding

## Queries observadas

A rota usa principalmente:

- `repository->get(sessionId)`
- `find_pet_index($pets, $petId)`
- `repository->save(session)`
- busca de sessoes vinculadas ao usuario:
  - `SELECT session_id FROM wp_hsr_onboarding_sessions WHERE linked_user_id = %d ORDER BY updated_at DESC LIMIT 50`

## Custom Post Types

- nenhum CPT e criado por esta rota
- nao depende diretamente de `shop_order`

## Taxonomias

- nenhuma taxonomia usada nesta rota

## Campos personalizados relevantes

- `pets[]` no aggregate de sessao
- `deleted_at`
- `deleted_by_user_id`
- `deleted_reason`

## Plugins e dependencias

1. headless-secure-registration
- endpoint REST, service, repository e regras de onboarding

2. WordPress user/session state
- necessario para o fallback por outras sessoes do mesmo usuario

3. WooCommerce
- nao e usado para calcular a resposta desta rota

## Regras de preco, moeda e pais

Esta rota nao calcula preco, moeda, imposto ou frete.

- preco: nao aplicavel
- moeda: nao aplicavel
- pais: nao aplicavel diretamente

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- DELETE /custom/v1/onboarding/session/:sessionId/pets/:petId

Controller:
- OnboardingApi::remove_pet

Service:
- OnboardingService::remove_pet
- soft_delete_pet_from_session
- find_pet_in_user_sessions

Repository:
- OnboardingRepository::get
- OnboardingRepository::save

Banco/tabelas utilizadas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets

Regras de negocio:
- exclusao suave
- fallback para outra sessao do mesmo usuario
- auditoria da remocao
- preservacao de referencias de imagem quando aplicavel

Campos retornados:
- session
- removed_pet
- `removed_pet.deleted_at`
- `removed_pet.deleted_by_user_id`
- `removed_pet.deleted_reason`

## Node.js

Controller:
- OnboardingPetController.remove

Service:
- OnboardingPetService.removeForSession
- OnboardingPetService.softDeletePet
- OnboardingPetService.findPetInUserSessions

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.savePetsSnapshot
- OnboardingSessionRepository.findRecentSessionsByLinkedUser
- OnboardingPetRepository.findBySessionAndPetId

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity
- UserEntity (para validar autenticacao/ownership)

DTOs:

Entrada:
- RemoveOnboardingPetParamsDto
  - sessionId: string
  - petId: string

Saida:
- RemoveOnboardingPetResponseDto
  - session: OnboardingSessionDto
  - removedPet: OnboardingPetDto

Validacoes:
- sessionId obrigatorio
- petId obrigatorio
- token de sessao valido
- session existente
- pet existente na sessao alvo ou em outra sessao do mesmo usuario autenticado
- autorizacao de usuario para fallback entre sessoes

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe sessionId e petId
2. Guard valida sessao por token
3. Service carrega a sessao alvo
4. Service tenta localizar o pet na sessao
5. Se encontrado, aplica soft delete e persiste
6. Se nao encontrado, busca outras sessoes do mesmo usuario autenticado
7. Se achar o pet em outra sessao, aplica soft delete naquela sessao
8. Retorna DTO com sessao atualizada e pet removido

## Modelo de dados necessario no Node

Minimo para paridade:

1. onboarding_sessions
- session_id
- linked_user_id
- checkout_order_id opcional
- pets_json ou relacao com tabela de pets

2. onboarding_pets
- id/uuid
- session_id
- name
- breed
- age_years
- age_months
- age
- weight
- weight_kg
- weight_input
- weight_unit
- size
- activity_level
- pet_condition
- neutered
- image_url
- deleted_at
- deleted_by_user_id
- deleted_reason

3. users
- necessario para confirmar autenticacao e ownership no fallback

## Possiveis problemas na migracao

1. Esquecer o fallback por outras sessoes
- isso quebraria o comportamento de remover pets reaproveitados em contextos diferentes.

2. Implementar delete fisico ao inves de soft delete
- outras telas podem depender do snapshot historico.

3. Nao preservar `deleted_by_user_id`
- perde auditoria funcional da remocao.

4. Permitir fallback sem autenticacao
- abriria risco de apagar pets de outra sessao/usuario.

5. Ignorar o estado de imagem compartilhada
- pode apagar arquivo que ainda e referenciado por outro pet.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- apenas parsing de params e retorno HTTP

2. Service central
- localiza pet, aplica soft delete, resolve fallback por outra sessao do usuario

3. Repository dedicado
- busca de sessoes recentes por linked user
- persistencia atomica do snapshot

4. Politica de integridade
- nunca remover arquivo de imagem sem verificar referencias de outros pets

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. pet inexistente na sessao -> tenta fallback
3. fallback sem usuario autenticado -> 404
4. pet encontrado na sessao alvo -> soft delete com sucesso
5. pet encontrado em outra sessao do usuario -> soft delete na sessao proprietaria
6. `deleted_at` preenchido corretamente
7. `deleted_reason` = `user_request`
8. `deleted_by_user_id` preenchido com usuario atual
9. contrato de resposta com `session` + `removed_pet`

## Checklist de equivalencia

1. Endpoint DELETE equivalente preservado.
2. Permissao por sessao preservada.
3. Soft delete preservado.
4. Fallback para outra sessao do usuario preservado.
5. Auditoria de remocao preservada.
6. Resposta com `session` + `removed_pet` preservada.
7. Controller sem regra de negocio.
8. TypeORM em Repository/Entity.
9. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
