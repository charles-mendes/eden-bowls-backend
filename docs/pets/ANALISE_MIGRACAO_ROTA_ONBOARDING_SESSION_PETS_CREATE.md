# Analise Tecnica - Migracao da Rota Onboarding Create Pet para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/pets

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (createPetInApi)

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

A rota cria um novo pet dentro da sessao de onboarding.

Ela normaliza os dados recebidos do frontend, valida o dominio do pet, converte peso para kg no armazenamento interno, gera um `id` UUID para o pet e persiste o snapshot na sessao SQL do onboarding.

Se a requisicao incluir imagem, a rota tambem faz upload local e grava `image_url` no pet.

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/pets
- Method: POST
- Callback: OnboardingApi::add_pet
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Extrai payload via JSON, body params ou multipart
- Se houver arquivo `image`, processa o upload local
- Chama `OnboardingService::add_pet(sessionId, payload)`
- Retorna envelope `{ success: true, data: result }` com status 200

### Regra de acesso importante

A rota exige acesso por sessao valida, nao apenas autenticacao de usuario:

1. `x-session-token` e priorizado;
2. `Authorization: Bearer ...` pode ser usado quando necessario;
3. o token precisa ser valido para a `session_id` solicitada.

Erros de acesso comuns:

- 401 session_unauthorized
- 403 session_forbidden
- 404 session_not_found
- 429 rate_limit

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- Authorization: Bearer token (fallback para flows headless)
- Content-Type: application/json ou multipart/form-data

Body esperado pelo frontend:

- name: string
- breed: string
- age_years: string | number
- age_months: string | number
- weight: string | number
- weight_unit: 'kg' | 'lb'
- size: 'small' | 'medium' | 'large'
- activity_level: 'low' | 'medium' | 'high'
- pet_condition: 'underweight' | 'ideal' | 'overweight'
- neutered: boolean
- image?: file multipart

Campos derivados do front:

- `createPetInApi` envia `FormData` quando houver foto
- `buildPetFormData` usa o campo `image` para upload
- `buildPetPayload` envia os mesmos campos sem arquivo quando for JSON

## Validacoes que devem existir

## 1) Validacao de sessao

- `session_id` obrigatorio
- sessao deve existir no repositório SQL ou no fallback legado

Erro:

- `session_not_found` -> 404

## 2) Validacao de dominio do pet

1. `name` obrigatorio
- erro: `invalid_pet_name`
- status: 422
- field: `name`

2. `breed` obrigatorio
- erro: `invalid_pet_breed`
- status: 422
- field: `breed`

3. `age_years` obrigatorio e inteiro
- faixa: 0..30
- erro: `invalid_pet_age_years`
- field: `age_years`

4. `age_months` obrigatorio e inteiro
- faixa: 0..11
- erro: `invalid_pet_age_months`
- field: `age_months`

5. `weight` obrigatorio e numerico
- faixa de peso calculado em kg: 0.1..200
- erro: `invalid_pet_weight`
- field: `weight`

6. `weight_unit` obrigatorio
- valores aceitos: `kg` ou `lb`
- erro: `invalid_pet_weight_unit`
- field: `weight_unit`

7. `weight_unit` precisa respeitar o pais da sessao
- US -> `lb`
- BR -> `kg`
- erro: `invalid_pet_weight_unit`

8. `size` obrigatorio
- valores: `small`, `medium`, `large`
- erro: `invalid_pet_size`
- field: `size`

9. `activity_level` obrigatorio
- valores: `low`, `medium`, `high`
- erro: `invalid_pet_activity_level`
- field: `activity_level`

10. `pet_condition` obrigatorio
- valores: `underweight`, `ideal`, `overweight`
- erro: `invalid_pet_condition`
- field: `pet_condition`

11. `neutered` obrigatorio
- precisa ser boolean
- erro: `invalid_pet_neutered`
- field: `neutered`

## 3) Validacao de upload de imagem

Se o form incluir arquivo `image`:

- precisa haver `tmp_name`
- upload nao pode ter erro do PHP
- tamanho deve ser valido
- formato precisa ser suportado

Regras observadas no plugin:

- extensoes aceitas: PNG, JPG, WEBP
- MIME aceitos compatíveis com esses formatos
- upload invalidado quando o arquivo esta vazio ou excede limite maximo

Erros comuns:

- `invalid_pet_image`
- `invalid_pet_image_size`
- `invalid_pet_image_format`
- `unauthorized_pet_image_upload` quando tentativa de upload ocorre sem autenticacao adequada

## 4) Validacao de normalizacao interna

- `age` tambem e salvo como alias de `age_years`
- `weight_input` preserva o valor original enviado
- `weight_kg` e derivado de `weight` + `weight_unit`
- `size` pode ser inferido de raca quando vazio, usando repositório de breeds

## Fluxo da requisicao

1. POST /pets chega na rota
2. permission callback valida sessao
3. controller extrai payload e, se houver, processa arquivo `image`
4. service carrega a sessao
5. valida name, breed, idade, peso, unidade, porte, atividade, condicao e castracao
6. valida unidade de peso contra o pais da sessao
7. converte peso para kg para armazenamento interno
8. gera `id` UUID do pet
9. monta snapshot do pet com campos normalizados
10. adiciona o pet em `session.pets`
11. persiste a sessao no repository
12. retorna `session` + `pet`

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
- pet.image_url (quando houver upload)

O frontend consome principalmente:

- `petId` a partir de `pet.id`
- `imageUrl` a partir de `pet.image_url`

## Regras de negocio escondidas no WordPress

1. O pet sempre nasce com `type = dog`
- mesmo que o frontend nao envie esse campo.

2. O backend gera o UUID do pet
- o frontend nao define `id`.

3. Conversao de peso e dependente do pais
- BR trabalha com kg
- US trabalha com lb no input, mas persiste o equivalente em kg em `weight` e `weight_kg`

4. `weight_input` preserva o valor original
- isso permite reexibir a unidade original no frontend.

5. `size` pode ser inferido de breed
- se o tamanho nao vier no payload, o backend tenta resolver via breeds repository.

6. Upload de imagem e local ao ambiente WordPress
- a URL resultante e gravada em `image_url` e pode ser removida/atualizada depois.

7. A sessao e o aggregate principal
- o pet nao e uma linha independente no fluxo de consumo da UI; ele e salvo dentro do snapshot da sessao e em tabelas auxiliares de onboarding.

## Banco, queries, CPT, taxonomias e campos customizados

## Banco/tabelas utilizadas

1. wp_hsr_onboarding_sessions
- leitura da sessao
- escrita do aggregate atualizado com `pets[]`

2. wp_hsr_onboarding_pets
- persistencia auxiliar de pets por sessao/usuario

3. wp_hsr_breeds
- usado indiretamente para inferir `size` quando o payload nao informa

4. wp_posts / wp_postmeta
- nao utilizados diretamente nesta rota, mas podem influenciar resolucao de contexto em outros fluxos

## Queries observadas

A criacao de pet usa principalmente:

- `repository->get(sessionId)`
- `repository->save(session)`
- leitura auxiliar do breeds repository para inferir porte

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
- `deleted_at` nao se aplica na criacao, mas aparece em fluxos de remocao/merge

## Plugins e dependencias

1. headless-secure-registration
- endpoint REST, service, repository e validacoes de onboarding

2. Breeds repository/importer
- inferencia de porte por raca

3. WordPress media/file handling
- upload de imagem via `wp_handle_sideload` / processamento de arquivo temporario

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
- POST /custom/v1/onboarding/session/:sessionId/pets

Controller:
- OnboardingApi::add_pet

Service:
- OnboardingService::add_pet
- validate_pet_fields
- validate_weight_unit_for_country
- convert_weight_to_kg
- resolve_pet_size

Repository:
- OnboardingRepository::get
- OnboardingRepository::save

Banco/tabelas utilizadas:
- wp_hsr_onboarding_sessions
- wp_hsr_onboarding_pets
- wp_hsr_breeds

Regras de negocio:
- UUID gerado no backend
- validacao forte do dominio do pet
- peso normalizado por pais
- upload opcional de imagem
- snapshot persistido na sessao

Campos retornados:
- session
- pet
- `pet.id`
- `pet.image_url`

## Node.js

Controller:
- OnboardingPetController.create

Service:
- OnboardingPetService.createForSession
- OnboardingPetService.normalizePetInput
- OnboardingPetService.validatePetInput
- OnboardingPetService.resolveSizeFromBreed
- OnboardingPetService.storePetImage (se houver upload)

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.updatePetsSnapshot
- OnboardingPetRepository.insert
- BreedRepository.findSizeByName

Entities/Models (TypeORM):
- OnboardingSessionEntity
- OnboardingPetEntity
- BreedEntity

DTOs:

Entrada:
- CreateOnboardingPetParamsDto
  - sessionId: string
- CreateOnboardingPetRequestDto
  - name: string
  - breed: string
  - ageYears: number
  - ageMonths: number
  - weight: number
  - weightUnit: 'kg' | 'lb'
  - size: 'small' | 'medium' | 'large'
  - activityLevel: 'low' | 'medium' | 'high'
  - petCondition: 'underweight' | 'ideal' | 'overweight'
  - neutered: boolean

Saida:
- CreateOnboardingPetResponseDto
  - session: OnboardingSessionDto
  - pet: OnboardingPetDto

Validacoes:
- sessionId obrigatorio
- token de sessao valido
- name e breed obrigatorios
- idade em anos/meses dentro da faixa
- peso numerico dentro da faixa
- unidade de peso compativel com pais
- size/activityLevel/petCondition/neutered validos
- arquivo de imagem opcional com limite e mime corretos

## Fluxo da requisicao no Node (sugestao)

1. Controller recebe sessionId e payload
2. Guard valida sessao por token
3. Service carrega sessao
4. Service normaliza campo por campo
5. Se houver imagem, processa upload em storage controlado
6. Valida regras de negocio e country-specific weight unit
7. Gera id do pet e monta entity/DTO
8. Persiste pet e atualiza snapshot da sessao
9. Retorna session + pet

## Modelo de dados necessario no Node

Minimo para paridade:

1. onboarding_sessions
- session_id
- pets_json ou relacionamento com tabela de pets
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
- name
- size

## Possiveis problemas na migracao

1. Perda da normalizacao por pais
- se Node nao respeitar `kg`/`lb`, o peso e a exibicao da UI podem ficar inconsistentes.

2. Upload multipart quebrado
- precisa suportar upload de imagem sem depender de PATCH; o front usa POST para upload por compatibilidade com PHP.

3. Regra de tamanho por raca perdida
- se o Node nao consultar um catalogo de breeds, o tamanho manual pode ficar vazio ou errado.

4. Contrato de resposta divergente
- o front espera `pet.id` e `pet.image_url` dentro de `data`.

5. Validacao mais fraca que o WP
- aceitar estados invalidos de idade/peso/condicao gera regressao silenciosa.

6. Snapshot inconsistente
- se persistir apenas em tabela de pet e nao atualizar a sessao, outras telas podem nao refletir o novo pet.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Node.js + TypeScript
- Express
- TypeORM
- Controller -> Service -> Repository -> Entity
- sem Prisma

### Design recomendado

1. Controller fino
- apenas parsing de body/multipart e retorno HTTP
- nenhuma regra de negocio

2. Service central
- valida e normaliza o pet
- resolve tamanho por breed
- converte peso para kg
- decide como persistir imagem

3. Repository dedicado
- atualiza sessao e persiste pet de forma atomica
- isola consultas de breed por nome

4. Handler de upload
- storage controlado e seguro, com validacao de tipo e tamanho

### Testes unitarios recomendados

1. sessao inexistente -> 404
2. name vazio -> 422
3. breed vazio -> 422
4. idade fora da faixa -> 422
5. peso invalido -> 422
6. unidade de peso incompatível com pais -> 422
7. size invalido -> 422
8. image invalida -> 422
9. criacao com sucesso BR -> armazena kg e retorna id
10. criacao com sucesso US -> converte lb para kg e retorna imageUrl quando houver upload

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Permissao por sessao preservada.
3. Validacao forte de pet preservada.
4. Conversao de peso por pais preservada.
5. Upload de imagem preservado.
6. Geracao de UUID no backend preservada.
7. Persistencia no snapshot da sessao preservada.
8. Resposta com session + pet preservada.
9. Controller sem regra de negocio.
10. TypeORM em Repository/Entity.
11. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
