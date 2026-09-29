# Analise Tecnica - Migracao da Rota Onboarding Zipcode Lookup para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/zipcode/lookup

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (lookupZipcodeInApi)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/CHECKOUT_RULES.md

## Responsabilidade da rota

A rota realiza lookup de CEP/ZIP para preencher automaticamente dados de endereco (state/city/street/neighborhood/complement) e devolve um estado funcional para UX de formulario.

Ela nao persiste endereco na sessao. A persistencia ocorre em outra rota (`/zipcode`).

## Endpoint, Controller e permissao

### Endpoint

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/zipcode/lookup
- Method: POST
- Callback: OnboardingApi::lookup_zipcode
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id`
- Aplica rate limit especifico para lookup (`zipcode_lookup`, 30 req / 300s por sessao)
- Extrai payload
- Chama `OnboardingService::lookup_zipcode(sessionId, payload)`
- Retorna envelope `{ success: true, data: ... }` em 200

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body:

- zipcode (ou postal_code)
- country opcional (US|BR)

## Validacoes que devem existir

## 1) Validacoes de acesso

- sessao/token validos
- rate limit por sessao para lookup
- erros tipicos: 401/403/429

## 2) Validacoes de negocio

1. sessao deve existir
- erro: session_not_found
- status: 404

2. country efetivo
- se payload.country for BR/US, usa ele
- senao, tenta inferir pelo tamanho numerico do input:
  - 5 ou 9 digitos -> US
  - >= 8 digitos -> BR
  - caso contrario -> vazio

3. caracteres invalidos no postal input
- se houver caracteres fora de [0-9, hifen, espaco], retorna estado `invalid`
- nao gera WP_Error

4. completude do postal code
- BR completo: 8 digitos
- US completo: 5 ou 9 digitos
- incompleto retorna estado `incomplete`

5. resultado de lookup
- erro de infraestrutura/provider -> estado `error`
- nao encontrado -> estado `not_found`
- encontrado mas sem state/city -> `not_found`
- encontrado completo -> `found`

## Fluxo da requisicao

1. Request entra em POST /zipcode/lookup
2. Permission callback valida sessao/token
3. Rate limit `zipcode_lookup` e aplicado
4. Service carrega sessao
5. Service normaliza input de zipcode e resolve country efetivo
6. Service valida caracteres e completude
7. Se completo, consulta provider por pais:
   - BR -> ViaCEP
   - US -> Zippopotam
8. Service normaliza campos retornados
9. Retorna objeto de estado funcional (`found`, `not_found`, `incomplete`, `invalid`, `error`)

## Estrutura de resposta

Resposta de sucesso HTTP 200 sempre envelopada, com `data` no formato:

{
  "status": "idle|typing|incomplete|invalid|searching|found|not_found|error",
  "country": "US|BR|''",
  "zipcode_input": "string",
  "zipcode": "string normalizada",
  "is_complete": true|false,
  "state": "string",
  "city": "string",
  "street": "string",
  "neighborhood": "string",
  "complement": "string",
  "message": "string opcional"
}

Observacao:

- No backend, esta rota usa principalmente `incomplete|invalid|found|not_found|error`.
- `idle|typing|searching` sao estados de UI definidos no front-end.

## Regras de negocio escondidas no WordPress

1. Lookup retorna estados de dominio, nao erro HTTP para casos comuns
- Postal invalido/incompleto/nao encontrado retorna 200 com `status` funcional.

2. Country inferido implicitamente
- Mesmo sem `country`, a rota tenta inferir BR/US pelo input.

3. Normalizacao de saida por pais
- BR: formata como XXXXX-XXX quando possivel.
- US: formata ZIP/ZIP+4 quando possivel.

4. Provider por pais
- BR usa ViaCEP: https://viacep.com.br/ws/{cep}/json/
- US usa Zippopotam: https://api.zippopotam.us/us/{zip5}

5. Tratamento de falha externa degradado para estado `error`
- Erros externos nao quebram contrato HTTP principal, preservam payload de status.

6. Nao persiste em banco
- Diferente de `/zipcode`, lookup e apenas leitura/consulta externa.

## Banco, tabelas e consultas

## Tabelas usadas

1. wp_hsr_onboarding_sessions
- leitura da sessao para validar existencia e contexto
- sem escrita nesta rota

2. wp_hsr_onboarding_pets
- nao usado

Consultas SQL diretas:

- nao ha queries SQL custom nesta rota alem do get da sessao via repository.

## CPT, taxonomias e campos customizados

- Nao usa CPT.
- Nao usa taxonomias.
- Nao grava campos custom nesta rota.

## Plugins e dependencias

1. headless-secure-registration
- endpoint/controller/service/repository

2. Dependencias externas HTTP
- ViaCEP (BR)
- Zippopotam (US)

3. Front-end
- checkout usa esse retorno para gatear preenchimento e submit de endereco.

## Regras de preco, moeda e pais

- A rota nao calcula preco nem moeda.
- Pais e central na logica: define regex/normalizacao e provider de lookup.
- Country permitido no contrato efetivo: BR/US (ou vazio quando nao inferivel).

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/zipcode/lookup

Controller:
- OnboardingApi::lookup_zipcode

Service:
- OnboardingService::lookup_zipcode
- infer_lookup_country_from_postal_input
- normalize_lookup_postal_input
- is_lookup_postal_complete
- lookup_zipcode_br
- lookup_zipcode_us

Repository:
- OnboardingRepository::get

Banco/tabelas:
- wp_hsr_onboarding_sessions (leitura)

Regras de negocio:
- rate limit de lookup
- inferencia de pais
- retornos por status funcional
- fallback robusto para erros externos

Campos retornados:
- status, country, zipcode_input, zipcode, is_complete, state, city, street, neighborhood, complement, message

## Node.js (proposto)

Controller:
- OnboardingZipcodeLookupController.lookup

Service:
- OnboardingZipcodeLookupService.lookup

Repository:
- OnboardingSessionRepository.findBySessionId

Entities/Models (TypeORM):
- OnboardingSessionEntity (apenas leitura para validar sessao)

DTOs:

Entrada:
- LookupZipcodeParamsDto
  - sessionId: string
- LookupZipcodeRequestDto
  - zipcode?: string
  - postalCode?: string
  - country?: 'US' | 'BR'

Saida:
- LookupZipcodeResponseDto
  - status: 'incomplete'|'invalid'|'found'|'not_found'|'error'
  - country: 'US'|'BR'|''
  - zipcodeInput: string
  - zipcode: string
  - isComplete: boolean
  - state: string
  - city: string
  - street: string
  - neighborhood: string
  - complement: string
  - message?: string

Validacoes:
- sessao/token
- rate limit por sessao
- saneamento de zipcode
- inferencia/validacao de pais
- contratos de retorno por estado

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- country
- locale
- updated_at

Nao precisa gravar endereco nesta rota.

## Possiveis problemas na migracao

1. Quebra de UX se trocar 200 status funcional por 4xx
- front espera estados `incomplete|invalid|found|not_found|error` no payload.

2. Divergencia de normalizacao BR/US
- regex e formatacao diferentes alteram comportamento de autocompletar.

3. Timeouts/rede com providers externos
- sem timeout curto e fallback, endpoint pode degradar UX.

4. Inconsistencia de country inferido
- heuristica de inferencia deve ser igual para evitar regressao.

5. Rate limit ausente
- sem throttle, risco de abuso e bloqueio por provider externo.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- valida params/body
- aplica guard de sessao e rate limit
- delega para service

2. Service
- resolve country/input
- valida caracteres/completude
- consulta provider por pais
- mapeia para DTO funcional

3. Repository
- valida existencia de sessao

4. Adapters externos
- CepLookupProviderBr (ViaCEP)
- ZipLookupProviderUs (Zippopotam)
- ambos com timeout, retry limitado e tratamento de erro padrao

### Testes unitarios recomendados

1. Sessao inexistente -> 404
2. Input com caracteres invalidos -> status invalid
3. Input incompleto -> status incomplete
4. BR encontrado -> status found com state/city
5. US nao encontrado -> status not_found
6. Provider indisponivel -> status error
7. Inferencia de pais sem payload.country
8. Rate limit excedido -> 429

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Autenticacao de sessao equivalente.
3. Rate limit de lookup equivalente.
4. Estados funcionais de resposta preservados.
5. Inferencia e normalizacao de BR/US preservadas.
6. Sem persistencia nesta rota.
7. Controller sem regra de negocio.
8. TypeORM em repository/entity.
9. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
