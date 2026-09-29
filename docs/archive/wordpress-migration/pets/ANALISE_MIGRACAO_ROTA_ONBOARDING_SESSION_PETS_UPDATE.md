# Analise Tecnica - Migracao da Rota Onboarding Update Pet para Node.js

## Escopo

Rota atual no WordPress:

- PATCH /custom/v1/onboarding/session/:sessionId/pets/:petId
- POST /custom/v1/onboarding/session/:sessionId/pets/:petId (usado pelo frontend quando ha upload de imagem)

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (updatePetInApi)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-request-validator.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/onboarding/ONBOARDING_RULES.md
- eden-bowls/src/pages/onboarding/Onboarding.tsx
- eden-bowls/src/pages/plan/Plan.tsx
- eden-bowls/src/pages/checkout/Checkout.tsx

## Responsabilidade da rota

A rota atualiza um pet existente dentro da sessao de onboarding.

Ela faz a leitura do snapshot da sessao, localiza o pet por `petId`, aplica os campos enviados, revalida o dominio do pet, normaliza peso/unidade/porte e persiste a sessao atualizada.

Se a atualizacao incluir imagem nova, a rota tambem processa upload local e remove a imagem antiga quando ela nao estiver sendo usada por outros pets.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/pets/(?P<pet_id>[A-Za-z0-9-]+)
- Method: PATCH e POST
- Callback: OnboardingApi::update_pet
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Extrai `pet_id`
- Extrai payload JSON ou multipart
- Se houver arquivo `image`, processa upload local
- Chama `OnboardingService::update_pet(sessionId, petId, payload)`
- Se ocorrer erro, remove upload temporario da imagem vinda no payload
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
- Content-Type: application/json ou multipart/form-data

Body aceito pelo backend:

- name?: string
- breed?: string
- age_years?: string | number
- age_months?: string | number
- weight?: string | number
- weight_unit?: 'kg' | 'lb'
- size?: 'small' | 'medium' | 'large'
- activity_level?: 'low' | 'medium' | 'high'
- pet_condition?: 'underweight' | 'ideal' | 'overweight'
- neutered?: boolean
- image_url?: string
- image?: file multipart (quando o front envia POST com arquivo)

Aliases aceitos no backend:

- `ageYears`
- `ageMonths`
- `weightUnit`
- `activityLevel`
- `weightCondition`

## Validacoes que devem existir

## 1) Validacao de sessao

- `session_id` obrigatorio
- sessao deve existir no repositório SQL ou no fallback legado

Erro:

- `session_not_found` -> 404

## 2) Validacao do pet alvo

- `pet_id` obrigatorio
- pet precisa existir dentro da sessao alvo

Erro:

- `pet_not_found` -> 404

## 3) Validacao de payload nao vazio

- ao menos um campo deve ser enviado para atualizacao

Erro:

- `invalid_pet_update` -> 422

## 4) Validacao de dominio do pet

Quando presentes, os campos sao revalidados com as mesmas regras da criacao:

- `name` nao pode ficar vazio
- `breed` nao pode ficar vazio
- `age_years` precisa ser inteiro entre 0 e 30
- `age_months` precisa ser inteiro entre 0 e 11
- `weight` precisa ser numerico e valido
- `weight_unit` precisa ser `kg` ou `lb`
- `size` precisa ser `small`, `medium` ou `large`
- `activity_level` precisa ser `low`, `medium` ou `high`
- `pet_condition` precisa ser `underweight`, `ideal` ou `overweight`
- `neutered` precisa ser boolean

Erros tipicos:

- `invalid_pet_name`
- `invalid_pet_breed`
- `invalid_pet_age_years`
- `invalid_pet_age_months`
- `invalid_pet_weight`
- `invalid_pet_weight_unit`
- `invalid_pet_size`
- `invalid_pet_activity_level`
- `invalid_pet_condition`
- `invalid_pet_neutered`

## 5) Validacao de unidade de peso por pais

A atualizacao precisa respeitar o pais da sessao:

- US -> `lb`
- BR -> `kg`

Erro:

- `invalid_pet_weight_unit` -> 422

## 6) Validacao de upload de imagem

Se a atualizacao usar multipart com arquivo `image`:

- o upload precisa ser valido
- nao pode ser vazio
- precisa respeitar extensao/MIME aceitos
- precisa obedecer limite de tamanho

Erros comuns:

- `invalid_pet_image`
- `invalid_pet_image_size`
- `invalid_pet_image_format`

## Fluxo da requisicao

1. PATCH ou POST em /pets/:petId chega na rota
2. permission callback valida sessao
3. controller extrai payload e, se houver, processa arquivo `image`
4. service carrega a sessao
5. localiza o pet pelo `petId`
6. rejeita se payload estiver vazio
7. aplica campos enviados no pet existente
8. revalida o dominio normalizado do pet
9. converte peso para kg para armazenamento interno
10. se `breed` mudou e `size` nao foi enviado, limpa `size` para recomputar depois
11. se `image_url` foi enviado vazio, remove o valor
12. persiste a sessao atualizada no repository
13. se a imagem antiga mudou e nao e usada por outros pets, remove upload local antigo
14. retorna `session` + `pet`

## Estrutura de resposta

Envelope HTTP:

- success: true
- data: { session, pet }

Campos relevantes no retorno:

- session.session_id
- session.pets
- pet.id
- pet.name
- pet.breed
- pet.type
- pet.age_years
- pet.age_months
- pet.age
- pet.weight_input
- pet.weight_unit
- pet.weight_kg
- pet.weight
- pet.size
- pet.activity_level
- pet.pet_condition
- pet.neutered
- pet.image_url

O frontend consome principalmente:

- `imageUrl` a partir de `pet.image_url`

## Regras de negocio escondidas no WordPress

1. Atualizacao parcial
- a rota nao exige corpo completo; atualiza apenas os campos enviados.

2. `breed` altera o porte
- se `breed` for alterado e `size` nao vier no payload, o backend limpa `size` para recalculo.

3. Peso interno sempre em kg
- mesmo que o input esteja em lb, o backend armazena o equivalente em `weight` e `weight_kg`.

4. `weight_input` preserva o valor de entrada
- isso permite restaurar o valor exibido no formulario.

5. `image_url` pode ser removido explicitamente
- se o payload trouxer `image_url` vazio, o campo e apagado.

6. Limpeza da imagem antiga
- se uma nova imagem substituir a anterior e a URL antiga nao for usada por outro pet, o backend remove o arquivo local.

7. Backend aceita PATCH sem upload e POST com upload
- o frontend usa POST quando precisa contornar limitacao de multipart no PATCH.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_hsr_onboarding_sessions
- leitura e escrita da sessao com `pets[]`

2. wp_hsr_onboarding_pets
- persistencia auxiliar da mesma estrutura de pets da sessao

3. wp_hsr_breeds
- usado para inferir o tamanho quando `size` for recalcualdo/omitido

## Queries observadas

A rota usa principalmente:

- `repository->get(sessionId)`
- `find_pet_index($pets, $petId)`
- `repository->save(session)`
- leitura do breeds repository para resolucao de tamanho

## Custom Post Types

- nenhum CPT e criado por esta rota
- nao depende diretamente de `shop_order`

## Taxonomias

- nenhuma taxonomia usada nesta rota

## Campos personalizados relevantes

- `pets[]` no aggregate de sessao
- `image_url`
- `weight_input`
- `weight_unit`
- `weight_kg`
- `deleted_at` nao e alterado aqui, mas aparece em outros fluxos do pet

## Plugins e dependencias

1. headless-secure-registration
- endpoint REST, service, repository e validacoes de onboarding

2. Breeds repository/importer
- inferencia de porte por raca

3. WordPress media/file handling
- upload e remocao de arquivos locais

4. WooCommerce
- nao e usado para calcular a resposta desta rota

## Regras de preco, moeda e pais

Esta rota nao calcula preco, moeda, imposto ou frete.

A unica regra de pais relevante e a unidade de peso:

- US -> `lb`
- BR -> `kg`

## Mapeamento da migracao WordPress -> Node.js

## WordPress

Endpoint:
- PATCH /custom/v1/onboarding/session/:sessionId/pets/:petId
- POST /custom/v1/onboarding/session/:sessionId/pets/:petId

Controller:
- OnboardingApi::update_pet

Service:
- OnboardingService::update_pet
- validate_pet_fields
- validate_weight_unit_for_country
- convert_weight_to_kg
- resolve_pet_size
- delete_local_upload_by_url

Repository:
- OnboardingRepository::get
- OnboardingRepository::save

Banco/tabelas utilizadas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets
- wp_hsr_breeds

Regras de negocio:
- atualizacao parcial
- validação forte do pet atualizado
- peso normalizado por pais
- upload opcional de imagem
- limpeza da imagem antiga quando substituida

Campos retornados:
- session
- pet
- `pet.image_url`

## Node.js

Controller:
- OnboardingPetController.update

Service:
- OnboardingPetService.updateForSession
- OnboardingPetService.normalizeUpdateInput
- OnboardingPetService.validatePetInput
- OnboardingPetService.resolveSizeFromBreed
- OnboardingPetService.replacePetImage
- OnboardingPetService.cleanupOrphanImage

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.updatePetSnapshot
- OnboardingPetRepository.findBySessionAndPetId
- BreedRepository.findSizeByName

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity
- BreedEntity

DTOs:

Entrada:
- UpdateOnboardingPetParamsDto
  - sessionId: string
  - petId: string
- UpdateOnboardingPetRequestDto
  - name?: string
  - breed?: string
  - ageYears?: number
  - ageMonths?: number
  - weight?: number
  - weightUnit?: 'kg' | 'lb'
  - size?: 'small' | 'medium' | 'large'
  - activityLevel?: 'low' | 'medium' | 'high'
  - petCondition?: 'underweight' | 'ideal' | 'overweight'
  - neutered?: boolean
  - imageUrl?: string

Saida:
- UpdateOnboardingPetResponseDto
  - session: OnboardingSessionDto
  - pet: OnboardingPetDto

Validacoes:
- sessionId obrigatorio
- petId obrigatorio
- token de sessao valido
- pet existente na sessao
- payload nao vazio
- campos atualizados ainda precisam ser validos
- unidade de peso compativel com pais
- imagem opcional com regras de upload

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe sessionId, petId e payload
2. Guard valida sessao por token
3. Service carrega sessao e encontra o pet
4. Service aplica somente os campos enviados
5. Service revalida o pet consolidado
6. Se houver imagem nova, troca a imagem e remove a antiga quando seguro
7. Service persiste a sessao atualizada
8. Controller retorna DTO normalizado

## Modelo de dados necessario no Node

Minimo para paridade:

1. onboarding_sessions
- session_id
- pets_json ou relacao com tabela de pets
- country
- linked_user_id opcional
- checkout_order_id opcional

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
- deleted_at opcional
- deleted_by_user_id opcional
- deleted_reason opcional

3. breeds
- nome
- tamanho

## Possiveis problemas na migracao

1. Regressao no upload de imagem
- se o Node nao suportar multipart no update, a UX do frontend quebra em edicao com foto.

2. Limpeza indevida de arquivo
- apagar imagem antiga sem verificar referencia em outros pets pode gerar link quebrado.

3. Perda do comportamento PATCH parcial
- exigir payload completo alteraria o formulario atual.

4. Divergencia de normalizacao de peso
- `weight_input`, `weight` e `weight_kg` precisam continuar coerentes.

5. Porte por raca esquecido
- se `breed` mudar e `size` nao for recalculado/limpo, a exibicao pode ficar inconsistente.

6. Resposta diferente da esperada
- o front consome `imageUrl` a partir de `pet.image_url`.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- apenas parsing de params/body/multipart e retorno HTTP

2. Service central
- encontra pet, aplica patch parcial, valida consolidado, trata troca de imagem

3. Repository dedicado
- leitura/escrita atomica do aggregate da sessao e do pet

4. Handler de upload
- storage seguro, com validacao de mime e tamanho

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. pet inexistente -> 404
3. payload vazio -> 422
4. idade invalida -> 422
5. unidade de peso incompatível -> 422
6. patch parcial sem imagem -> atualiza e retorna sucesso
7. update com imagem -> troca URL e limpa arquivo anterior quando possivel
8. `breed` alterado sem `size` -> `size` e limpo/recomputado
9. `image_url` vazio remove imagem
10. contrato de resposta com `session` + `pet`

## Checklist de equivalencia

1. Endpoint PATCH equivalente preservado.
2. Suporte ao POST com multipart preservado.
3. Permissao por sessao preservada.
4. Atualizacao parcial preservada.
5. Validacao forte do consolidado preservada.
6. Conversao de peso por pais preservada.
7. Troca e limpeza de imagem preservadas.
8. Resposta com `session` + `pet` preservada.
9. Controller sem regra de negocio.
10. TypeORM em Repository/Entity.
11. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
