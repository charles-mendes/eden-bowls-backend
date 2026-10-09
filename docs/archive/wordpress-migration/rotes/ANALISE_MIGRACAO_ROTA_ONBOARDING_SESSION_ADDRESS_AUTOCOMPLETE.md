# Analise Tecnica - Migracao da Rota Onboarding Address Autocomplete para Node.js

## Escopo

Rota atual no WordPress:

- POST /custom/v1/onboarding/session/:sessionId/address/autocomplete

Origem no front-end:

- eden-bowls/src/services/onboardingApi.ts (autocompleteAddressInApi)

Arquivos analisados:

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- eden-bowls/src/services/onboardingApi.ts
- eden-bowls/src/pages/checkout/CHECKOUT_RULES.md

Observacao importante:

- No pedido apareceu GET, mas a implementacao real e POST.

## Responsabilidade da rota

A rota sugere enderecos com base em texto digitado pelo usuario para acelerar o preenchimento no checkout.

Ela e uma consulta de suporte a UX:

1. nao persiste endereco,
2. nao calcula frete/preco,
3. devolve status funcional + lista de sugestoes.

## Endpoint, Controller e permissao

### Endpoint WordPress

- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/address/autocomplete
- Method: POST
- Callback: OnboardingApi::autocomplete_address
- Permission callback: OnboardingApi::require_valid_session_access

### Controller

- Extrai `session_id` da URL
- Aplica rate limit especifico (`address_autocomplete`, 60 req / 300s por sessao)
- Extrai payload
- Chama `OnboardingService::autocomplete_address(sessionId, payload)`
- Retorna `{ success: true, data: result }` com status 200

## Parametros recebidos

Path params:

- session_id: string

Headers:

- x-session-token (preferencial)
- ou Authorization: Bearer <session-token>

Body esperado:

- query: string
- country?: US | BR
- zipcode?: string
- state?: string
- city?: string

## Validacoes que devem existir

## 1) Validacoes de acesso

- sessao/token validos
- rate limit por sessao para autocomplete
- erros tipicos: 401/403/429

## 2) Validacoes de negocio

1. sessao existente
- erro: session_not_found
- status: 404

2. country efetivo
- normaliza `payload.country` (ou usa `session.country`)
- se vazio, fallback para `US`

3. pais suportado no autocomplete
- somente `US` e suportado atualmente
- se `country != US`, retorna estado funcional `unsupported_country` (nao erro HTTP)

4. tamanho minimo da query
- minimo de 4 caracteres (`mb_strlen(query) < 4`)
- retorna estado funcional `incomplete`

5. provider externo
- erro de rede/HTTP nao-200 no provider -> estado funcional `error`
- retorno vazio -> estado funcional `not_found`
- retorno com sugestoes -> estado funcional `found`

## Fluxo da requisicao

1. Request entra em POST /address/autocomplete
2. Permission callback valida sessao/token
3. Controller aplica rate limit de autocomplete
4. Service busca sessao
5. Service define country efetivo (payload -> session -> fallback US)
6. Se country nao for US, retorna `unsupported_country`
7. Service valida comprimento minimo de query
8. Service chama provider US (`autocomplete_address_us`)
9. Service normaliza e deduplica sugestoes
10. Service retorna `found` ou `not_found` (ou `error`)

## Estrutura de resposta

Resposta de sucesso HTTP 200 com `data`:

{
  "status": "incomplete|found|not_found|error|unsupported_country",
  "country": "US|BR|''",
  "query": "string",
  "suggestions": [
    {
      "id": "string",
      "label": "string",
      "street": "string",
      "city": "string",
      "state": "string",
      "zipcode": "string",
      "country": "US",
      "neighborhood": "string",
      "complement": ""
    }
  ],
  "message": "string opcional"
}

Observacoes:

- `country` pode voltar `BR` no estado `unsupported_country`, mas sugestoes ficam vazias.
- Front usa esse contrato para renderizar lista e preencher endereco ao selecionar item.

## Regras de negocio escondidas no WordPress

1. Autocomplete limitado a US
- Mesmo com onboarding BR ativo, retorno e `unsupported_country`.

2. Fallback de country para US
- Se nao vier country e sessao nao tiver country valido, assume US.

3. Query enriquecida antes da busca
- Service concatena `query + city + state + zipcode` para melhorar relevancia.

4. Provider externo especifico
- Usa Nominatim (OpenStreetMap) com:
  - countrycodes=us
  - addressdetails=1
  - format=jsonv2
  - limit=6

5. Normalizacao de campos de estado e CEP
- tenta `state_code`, fallback por `ISO3166-2-lvl4`
- normaliza zipcode para padrao US (5 ou ZIP+4)

6. Filtro de qualidade dos resultados
- descarta sugestoes sem `street`, `city`, `state` ou `zipcode`

7. Deduplicacao por label
- remove entradas repetidas com mesma label

## Banco, tabelas e consultas

## Tabelas usadas

1. wp_hsr_onboarding_sessions
- apenas leitura para validar existencia de sessao e obter `session.country` como fallback

## Escrita em banco

- nao ha persistencia nesta rota

## Consultas custom SQL

- nao ha query SQL direta nesta rota alem do carregamento de sessao via repository

## CPT, taxonomias e campos customizados

- Nao usa CPT.
- Nao usa taxonomias.
- Nao grava campos custom.

## Plugins e dependencias

1. headless-secure-registration
- endpoint/controller/service/repository

2. Dependencia externa HTTP
- Nominatim OpenStreetMap (autocomplete de endereco US)

3. Front-end checkout
- usa a rota para sugestoes e preenchimento assistido

## Regras de preco, moeda e pais

- Essa rota nao calcula preco nem moeda.
- Pais afeta fortemente o comportamento:
  - apenas US retorna sugestoes
  - BR resulta em `unsupported_country`

## Mapeamento de migracao WordPress -> Node.js

## WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:sessionId/address/autocomplete

Controller:
- OnboardingApi::autocomplete_address

Service:
- OnboardingService::autocomplete_address
- autocomplete_address_us

Repository:
- OnboardingRepository::get

Banco/tabelas:
- wp_hsr_onboarding_sessions (leitura)

Regras de negocio:
- rate limit dedicado
- country fallback para US
- suporte apenas US
- status funcional de resposta

Campos retornados:
- status, country, query, suggestions[], message

## Node.js (proposto)

Controller:
- OnboardingAddressAutocompleteController.autocomplete

Service:
- OnboardingAddressAutocompleteService.autocomplete

Repository:
- OnboardingSessionRepository.findBySessionId

Entities/Models (TypeORM):
- OnboardingSessionEntity (leitura de country/contexto)

DTOs:

Entrada:
- AutocompleteAddressParamsDto
  - sessionId: string
- AutocompleteAddressRequestDto
  - query: string
  - country?: 'US' | 'BR'
  - zipcode?: string
  - state?: string
  - city?: string

Saida:
- AutocompleteAddressResponseDto
  - status: 'incomplete'|'found'|'not_found'|'error'|'unsupported_country'
  - country: 'US'|'BR'|''
  - query: string
  - suggestions: AddressAutocompleteSuggestionDto[]
  - message?: string

Validacoes:
- sessao/token
- rate limit
- query minima
- regra de pais suportado
- saneamento e normalizacao do provider

## Modelo de dados necessario no Node

Minimo para equivalencia:

1. onboarding_sessions
- session_id PK
- country
- locale

Nao requer tabela adicional para persistencia da propria rota.

## Possiveis problemas na migracao

1. Quebra de contrato se retornar 4xx para casos de negocio
- front espera status funcional em 200 (`unsupported_country`, `incomplete`, `not_found`).

2. Divergencia na regra de pais
- se Node habilitar BR sem ajuste de UI/regra, comportamento muda.

3. Dependencia externa sem mitigacao
- sem timeout/retry curto, UX pode degradar por latencia do provider.

4. Normalizacao inconsistente de estado/zip
- pode gerar sugestoes de baixa qualidade e falhas no preenchimento.

5. Ausencia de deduplicacao
- lista de sugestoes pode vir ruidosa e repetir itens.

## Sugestao de implementacao (sem codigo)

Arquitetura obrigatoria:

- Controller -> Service -> Repository -> Entity
- TypeORM obrigatorio
- Nao usar Prisma

### Design recomendado

1. Controller
- valida params/body
- aplica guard de sessao e rate limit
- delega ao service

2. Service
- resolve country efetivo
- aplica regras de negocio (`unsupported_country`, query minima)
- chama adapter externo US
- normaliza/deduplica sugestoes
- retorna DTO funcional

3. Repository
- valida sessao e contexto basico

4. Adapter externo
- NominatimAddressAutocompleteProvider
- timeout curto, user-agent configurado, tratamento de falhas para `status=error`

### Testes unitarios recomendados

1. Sessao inexistente -> 404
2. Country BR -> status unsupported_country
3. Query com <4 chars -> status incomplete
4. Provider com erro -> status error
5. Provider vazio -> status not_found
6. Provider com dados validos -> status found
7. Deduplicacao por label
8. Normalizacao de state/zipcode US

## Checklist de equivalencia

1. Endpoint POST equivalente preservado.
2. Sessao/token e rate limit equivalentes.
3. Semantica de status funcional em 200 preservada.
4. Suporte US-only preservado (enquanto regra vigente).
5. Estrutura de sugestao compativel com front atual.
6. Controller sem regra de negocio.
7. TypeORM em repository/entity.
8. Nenhum uso de Prisma.

## Status

- Analise tecnica concluida.
- Documentacao .md criada.
- Nenhuma implementacao Node foi gerada ainda, conforme solicitado.
