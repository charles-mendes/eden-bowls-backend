# Analise Tecnica - Migracao da Rota Onboarding Zipcode para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/zipcode

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (syncZipcodeToApi)

Arquivos principais analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/CHECKOUT_RULES.md

## Responsabilidade da rota

A rota salva o endereco (zipcode/CEP + cidade/estado + rua e campos auxiliares) dentro da sessao de onboarding.

Ela nao calcula frete nem imposto diretamente, mas prepara os dados que serao obrigatorios para:

1. shipping quote,
2. shipping selection,
3. checkout.

## Endpoint, Controller e permissao

### Endpoint WordPress

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/zipcode
- Method: POST
- Callback: OnboardingApi::set_zipcode
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Le `session_id` da URL.
- Extrai payload JSON/body.
- Chama `OnboardingService::set_zipcode(sessionId, payload)`.
- Retorna `{ success: true, data: session }`.

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body aceito (payload):

- zipcode ou postal_code
- country (BR|US)
- state
- city
- street ou address_line1
- number
- neighborhood
- complement ou address_line2
- phone
- phone_country (BR|US)
- delivery_instructions

No front atual, o payload enviado e:

- zipcode, country, state, city, street, number, neighborhood, complement, phone, phone_country, delivery_instructions.

## Validacoes que devem existir

## 1) Validacoes de acesso

- sessao/token validos via `require_valid_session_access`
- erros tipicos: 401/403/429

## 2) Validacoes de negocio no service

1. sessao existente
- erro: session_not_found
- status: 404

2. country obrigatorio e suportado
- erro: invalid_country (quando vazio)
- erro: unsupported_country (quando nao BR/US)
- status: 422

3. zipcode obrigatorio
- erro: invalid_zipcode
- status: 422

4. formato de zipcode por pais
- BR: somente 8 digitos
- US: 5 digitos ou ZIP+4 (#####-####)
- erro: invalid_zipcode
- status: 422

5. state e city obrigatorios
- erro: invalid_location
- status: 422

## Fluxo da requisicao

1. Request entra em POST /zipcode.
2. Permission callback valida sessao e token.
3. Controller chama service.set_zipcode.
4. Service carrega sessao.
5. Service normaliza country e zipcode.
6. Service valida formato de zipcode por pais.
7. Service valida `state` e `city`.
8. Service monta `session.zipcode` com campos normalizados e aliases.
9. Repository salva a sessao (`zipcode_json`).
10. Controller retorna sessao atualizada.

## Estrutura de resposta

Sucesso (200):

{
  "success": true,
  "data": {
    "session_id": "...",
    "zipcode": {
      "zipcode": "...",
      "postal_code": "...",
      "country": "BR|US",
      "state": "...",
      "city": "...",
      "street": "...",
      "number": "...",
      "neighborhood": "...",
      "complement": "...",
      "phone": "...",
      "phone_country": "BR|US|''",
      "delivery_instructions": "...",
      "address_line1": "...",
      "address_line2": "..."
    },
    "...restante da sessao...": "..."
  }
}

Erros principais:

- session_not_found (404)
- invalid_country (422)
- unsupported_country (422)
- invalid_zipcode (422)
- invalid_location (422)

## Regras de negocio escondidas no WordPress

1. Alias duplicados de endereco
- O service grava os dois formatos:
  - `zipcode` e `postal_code`
  - `street` e `address_line1`
  - `complement` e `address_line2`
- Isso e um contrato de compatibilidade com consumidores diferentes.

2. Normalizacao de zipcode depende de pais
- BR: remove nao digitos e valida 8.
- US: remove caracteres invalidos, mantem digitos e hifen, valida regex ZIP/ZIP+4.

3. `phone_country` tem whitelist
- so aceita BR/US; qualquer outro valor vira string vazia.

4. A rota retorna a sessao inteira
- Nao retorna apenas bloco de zipcode.

5. Dependencia indireta de checkout
- Checkout e shipping exigem que `session.zipcode` exista e esteja consistente.

## Banco, tabelas e consultas

## Tabelas usadas

1. wp_hsr_onboarding_sessions
- coluna: zipcode_json
- persistencia da estrutura de endereco

2. wp_hsr_onboarding_pets
- nao e alvo direto da regra de zipcode, mas o save da sessao reescreve pets por estrategia do repositorio

### Observacao importante de persistencia

`OnboardingRepository::save()` persiste o aggregate completo da sessao e depois executa replace dos pets.

Isso significa que uma alteracao de zipcode pode ter efeito colateral de regravacao dos pets (mesmo sem alteracao de pet).

## CPT, taxonomias e campos customizados

- Nao usa Custom Post Types nesta rota.
- Nao usa taxonomias nesta rota.
- Usa tabela custom + JSON (`zipcode_json`) em vez de post meta de CPT.

## Plugins e dependencias

1. headless-secure-registration
- define endpoint/service/repository e schema onboarding

2. WooCommerce (indireto)
- shipping/checkout dependem do endereco salvo

3. APIs externas (indireto via lookup)
- A rota /zipcode em si nao chama API externa.
- Rotas relacionadas usam ViaCEP e Zippopotam para lookup.

## Regras de preco, moeda e pais

A rota nao calcula preco/moeda diretamente.

Impacto indireto:

- `country` salvo em `zipcode_json` e usado em frete/imposto e fluxos posteriores.
- pais invalido nao passa pela validacao (somente BR/US).

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/zipcode

Controller:
- OnboardingApi::set_zipcode

Service:
- OnboardingService::set_zipcode
- normalize_country
- normalize_postal_code
- is_valid_postal_code

Repository:
- OnboardingRepository::get
- OnboardingRepository::save

Banco/tabelas:
- wp_hsr_onboarding_sessions (zipcode_json)

Regras de negocio:
- validacao de BR/US
- validacao de zipcode por pais
- persistencia de aliases de endereco

Campos retornados:
- sessao completa com bloco zipcode atualizado

## Node.js (proposto)

Controller:
- OnboardingZipcodeController.setZipcode

Service:
- OnboardingZipcodeService.setZipcode

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.saveZipcode

Entities/Models (TypeORM):
- OnboardingSessionEntity
  - sessionId
  - zipcodeJson
  - country
  - updatedAt

DTOs:

Entrada:
- SetZipcodeParamsDto
  - sessionId: string
- SetZipcodeRequestDto
  - zipcode/postalCode
  - country
  - state
  - city
  - street/addressLine1
  - number
  - neighborhood
  - complement/addressLine2
  - phone
  - phoneCountry
  - deliveryInstructions

Saida:
- SetZipcodeResponseDto
  - success: boolean
  - data: OnboardingSessionDto (ou ZipcodeSnapshotDto se optar por contrato novo)

Validacoes:
- sessao/token
- pais suportado (BR/US)
- zipcode requerido e valido por pais
- state/city requeridos
- saneamento e normalizacao de aliases

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- country
- zipcode_json (json/jsonb)
- updated_at

2. onboarding_pets
- manter separado, evitando rewrite desnecessario quando salvar zipcode

## Possiveis problemas na migracao

1. Quebra de contrato por retorno parcial
- hoje retorna sessao completa; retornar apenas zipcode pode quebrar clientes.

2. Divergencia de validacao US ZIP+4
- regex diferente pode aceitar/rejeitar indevidamente.

3. Perda de aliases
- remover `postal_code/address_line1/address_line2` pode quebrar fluxos legados.

4. Persistencia concorrente
- update do aggregate inteiro pode sobrescrever campos alterados por outra rota.

5. Dependencia indireta com shipping/checkout
- qualquer mudanca no formato de zipcode impacta calculo de frete/imposto.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- valida params/body
- delega ao service
- sem regra de negocio

2. Service
- carrega sessao
- normaliza/valida zipcode por pais
- monta estrutura canonicamente compativel com legado
- delega persistencia

3. Repository
- update parcial de `zipcode_json` com lock/controle de concorrencia
- evitar rewrite de pets sem necessidade

### Testes unitarios recomendados

1. Sessao inexistente -> 404
2. Country vazio/invalido -> 422
3. BR invalido (menos de 8 digitos) -> 422
4. US invalido (nao 5/9) -> 422
5. state/city ausentes -> 422
6. phone_country fora da whitelist -> salva como vazio
7. sucesso persiste aliases e retorna sessao

## Checklist de equivalencia

1. Endpoint POST equivalente mantido.
2. Autenticacao de sessao equivalente.
3. Validacoes BR/US equivalentes.
4. Contrato de campos aliases preservado.
5. Persistencia em zipcode_json preservada.
6. Controller sem regra de negocio.
7. TypeORM em Repository/Entity.
8. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
