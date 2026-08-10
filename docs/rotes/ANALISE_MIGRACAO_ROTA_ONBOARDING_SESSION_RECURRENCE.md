# Analise Tecnica - Migracao da Rota Onboarding Recurrence para Node.js

## Escopo

Rota analisada no WordPress:

- POST /custom/v1/onboarding/session/:session_id/recurrence

Observacao importante:

- No pedido foi citado GET, mas a implementacao real e o cliente usam POST.
- Registro da rota: pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- Consumo no front-end: eden-bowls/src/services/onboardingApi.ts

## Responsabilidade da rota

A rota persiste a recorrencia de entrega/consumo da sessao de onboarding e normaliza o valor de frequencia para um dominio canonico usado por outros fluxos:

- weekly
- biweekly
- monthly

A rota tambem deriva e salva period_days:

- weekly -> 7
- biweekly -> 14
- monthly -> 30

Esse dado impacta diretamente o calculo de quantidade de gramas, recomendacao de pacotes, resumo simplificado e metadados sincronizados na conta do usuario em etapas posteriores.

## Fluxo da requisicao (WordPress atual)

1. Router (register_rest_route)
- Namespace: custom/v1
- Path: /onboarding/session/(?P<session_id>[A-Za-z0-9_-]+)/recurrence
- Method: CREATABLE (POST)
- Callback: OnboardingApi::set_recurrence
- Permission callback: OnboardingApi::require_valid_session_access

2. Autorizacao e protecoes
- Extrai session_id da URL.
- Aplica rate limit de autenticacao por sessao.
- Exige token de sessao via header x-session-token ou Authorization: Bearer <token>.
- Valida assinatura/expiracao/vinculo do token com session_id (SessionTokenService::validate).

3. Controller
- OnboardingApi::set_recurrence extrai payload JSON/body params.
- Chama OnboardingService::set_recurrence(sessionId, payload).

4. Service (regra de negocio)
- Busca sessao no repositorio.
- Normaliza frequency.
- Rejeita valor invalido com status 422.
- Resolve period_days pela frequencia canonica.
- Persiste session.recurrence = { frequency, period_days, updated_at }.

5. Persistencia
- OnboardingRepository::save atualiza tabela customizada hsr_onboarding_sessions (coluna recurrence_json).
- Reescreve pets na hsr_onboarding_pets (estrategia de replace total no save da sessao).
- Mantem transient por compatibilidade legada.

6. Resposta
- HTTP 200
- Envelope: { success: true, data: { session_id, recurrence } }

## Parametros de entrada

Path params:

- session_id: string (regex [A-Za-z0-9_-]+)

Headers:

- x-session-token: token de sessao (preferencial)
- ou Authorization: Bearer <session-token>

Body esperado:

- frequency: string

Valores aceitos na pratica (com aliases):

- weekly, semanal, 6 month, 6 months -> weekly
- biweekly, fortnightly, quinzenal, 3 month, 3 months -> biweekly
- monthly, mensal, 1 month, 1 months -> monthly

## Validacoes existentes

Validacoes de acesso:

1. session_id obrigatorio
- Erro: session_forbidden
- Status: 403

2. rate limiting de auth
- Erro: rate_limit
- Status: 429

3. token de sessao obrigatorio
- Erro: session_unauthorized/session_token_missing
- Status: 401

4. token invalido/expirado/sessao divergente
- Erros: session_token_invalid, session_token_expired, session_forbidden
- Status: 401 ou 403

Validacoes de negocio:

1. sessao existente
- Erro: session_not_found
- Status: 404

2. frequencia valida
- Erro: invalid_recurrence_frequency
- Status: 422
- Mensagem: Frequency must be weekly, biweekly, monthly, 1 month, 3 months, or 6 months.

## Estrutura de resposta

Sucesso (200):

{
  "success": true,
  "data": {
    "session_id": "...",
    "recurrence": {
      "frequency": "weekly|biweekly|monthly",
      "period_days": 7|14|30,
      "updated_at": "ISO-8601"
    }
  }
}

Erros:

- Em WP REST, erros voltam como WP_Error com codigo/mensagem/status.
- O contrato de erro nao segue sempre o mesmo envelope success/data.

## Banco, entidades e componentes usados

### Tabelas

1. wp_hsr_onboarding_sessions
- PK: session_id
- Coluna usada pela rota: recurrence_json (longtext JSON)
- Outras colunas relevantes no aggregate: questionnaire_json, plan_selection_json, locale, country, state, linked_user_id

2. wp_hsr_onboarding_pets
- Nao e alvo direto da regra de recorrencia, mas e regravada em save(session) por estrategia do repositorio.

### CPT / taxonomias / campos customizados

- Nao ha uso de Custom Post Type para essa rota.
- Nao ha taxonomia diretamente envolvida nesta operacao.
- Campo customizado em WP aqui significa JSON dentro de tabela customizada (recurrence_json), nao post meta de CPT.

### Plugins/dependencias relevantes

1. headless-secure-registration
- Define endpoint, service, repositorio, schema e token de sessao.

2. WooCommerce (dependencia indireta)
- A recorrencia influencia fluxos de recomendacao/checkout que dependem de dados WooCommerce em outras etapas.

3. Front-end eden-bowls
- Chama a rota com valores 6 months, 3 months, 1 month.
- Depende do alias map para funcionar sem erro 422.

## Regras de negocio escondidas (criticas para migracao)

1. Alias semantico de prazo de assinatura para frequencia operacional
- 6 months nao significa ciclo de cobranca de 6 meses nesta rota.
- 6 months e convertido para weekly (period_days=7).
- 3 months e convertido para biweekly (period_days=14).
- 1 month e convertido para monthly (period_days=30).

2. period_days e derivado, nao informado pelo cliente
- O cliente envia frequency.
- O backend calcula period_days.

3. Fallback de frequencia em fluxos posteriores
- Se recurrence estiver ausente, o sistema tenta usar menu_selection.frequency legado.
- Se nada existir, assume biweekly.

4. Acoplamento com recomendacao de embalagem
- period_days afeta total_required_grams = total_grams_per_day * period_days.
- Isso impacta pacote sugerido e combinacoes de sacos.

5. Contrato de token hibrido
- Header x-session-token e preferido para sessao.
- Authorization pode carregar JWT de usuario em fluxos headless.

## Regras de preco, moeda e pais (impacto indireto)

A rota recurrence nao calcula preco diretamente, mas altera a base para calculos posteriores:

1. Pais/mercado
- Sessao guarda country/locale.
- Fluxos de plano inferem mercado BR/US.

2. Moeda
- BR -> BRL
- US/default -> USD

3. Preco final
- Vem de plan selection/snapshot/preview e catalogo.
- Recurrence influencia quantidade alvo para compor itens e totais, mas nao aplica desconto de assinatura sozinha.

## Mapeamento de migracao WordPress -> Node.js

### WordPress

Endpoint:
- POST /custom/v1/onboarding/session/:session_id/recurrence

Controller/Endpoint:
- OnboardingApi::set_recurrence

Service:
- OnboardingService::set_recurrence
- normalize_recurrence_frequency
- resolve_packaging_period_days_from_frequency

Repository:
- OnboardingRepository::get
- OnboardingRepository::save

Banco/tabelas:
- wp_hsr_onboarding_sessions.recurrence_json
- wp_hsr_onboarding_pets (regravacao colateral no save)

Regras de negocio:
- Normalizacao de aliases
- Derivacao de period_days
- Persistencia no aggregate da sessao

Campos retornados:
- session_id
- recurrence.frequency
- recurrence.period_days
- recurrence.updated_at

### Node.js (proposto)

Controller:
- OnboardingSessionRecurrenceController.setRecurrence

Service:
- OnboardingSessionRecurrenceService.setRecurrence
- normalizeRecurrenceFrequency
- resolvePeriodDaysFromFrequency

Repository:
- OnboardingSessionRepository.findBySessionId
- OnboardingSessionRepository.updateRecurrence

Entities/Models (TypeORM):
- OnboardingSessionEntity
  - sessionId
  - recurrenceJson (json/jsonb)
  - updatedAt

DTOs:
- SetRecurrenceRequestDto
  - frequency: string
- SetRecurrenceResponseDto
  - sessionId: string
  - recurrence: { frequency: 'weekly'|'biweekly'|'monthly'; periodDays: 7|14|30; updatedAt: string }

Validacoes:
- Param sessionId obrigatorio e padrao permitido
- Token de sessao valido e vinculado ao sessionId
- Frequency obrigatoria e reconhecida no mapa de aliases
- Sessao existente

## Modelo de dados necessario no Node

Sugestao minima para equivalencia:

1. onboarding_sessions
- session_id varchar(64) PK
- recurrence_json jsonb null
- locale varchar(16)
- country char(2)
- state varchar(32)
- updated_at timestamp

2. onboarding_session_tokens (se separar do mecanismo atual)
- token_id / jti
- session_id
- exp
- revoked_at

Observacao:

- Se optar por token stateless HMAC/JWT sem tabela de token, manter a validacao de vinculo sid==sessionId e expiracao.

## Possiveis problemas na migracao

1. Quebra silenciosa do front atual
- O front envia 6 months/3 months/1 month.
- Se o Node aceitar apenas weekly/biweekly/monthly, retorna 422.

2. Divergencia de significado de recorrencia
- Time de produto pode interpretar 6 months como ciclo de assinatura trimestral/semestral.
- No legado isso e alias operacional de entrega/consumo.

3. Diferenca de erro HTTP/contrato
- WP usa WP_Error com formatos variados.
- Node deve definir contrato estavel para nao quebrar parser do front.

4. Rate limit ausente
- Remocao do rate limiter de auth aumenta risco de abuso.

5. Compatibilidade de token
- Mudar regra de assinatura/TTL sem estrategia de transicao invalida sessoes ativas.

6. Persistencia parcial
- Em WP, save(session) persiste aggregate completo.
- Em Node, update parcial mal desenhado pode apagar campos concorrentes.

## Sugestao de implementacao (sem codigo)

### Arquitetura obrigatoria

Controller -> Service -> Repository -> Entity

Sem regra de negocio no Controller.

### Contrato HTTP sugerido

Manter endpoint equivalente na fase de transicao:

- POST /api/v1/onboarding/sessions/:sessionId/recurrence

Request:

- headers: x-session-token
- body: { frequency: string }

Response 200:

- { success: true, data: { session_id, recurrence } }

### Desenho de camadas

1. Controller
- Extrai sessionId e body.
- Envia para DTO de entrada.
- Delega para service.
- Converte resultado para DTO de saida.

2. Service
- Valida frequencia via normalizador.
- Carrega sessao.
- Monta recurrence canonica.
- Persiste e retorna view model.

3. Repository (TypeORM)
- Busca sessao por sessionId.
- Atualiza recurrenceJson e updatedAt em transacao curta.

4. Entity
- Coluna recurrenceJson com tipo json/jsonb.
- Conversao para objeto de dominio no repository/service.

### Testes unitarios recomendados

1. normalizeRecurrenceFrequency
- weekly/semanal/6 months -> weekly
- biweekly/3 months -> biweekly
- monthly/1 month -> monthly
- invalido -> erro

2. setRecurrence
- sessao inexistente -> 404
- frequencia invalida -> 422
- sucesso -> grava periodDays coerente e updatedAt

3. Auth guard de sessao
- token ausente -> 401
- token expirado -> 401
- sid divergente -> 403

## Checklist de equivalencia para aprovacao

1. Endpoint continua aceitando aliases legacy.
2. frequency persistida sempre canonica.
3. period_days calculado no backend.
4. Mesma semantica de status HTTP (401/403/404/422/429/200).
5. Mesmo envelope de sucesso para compatibilidade.
6. Sem logica de negocio no Controller.
7. TypeORM usado em todas as camadas de dados.
8. Sem Prisma.

## Referencias de codigo analisadas

- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-api.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-service.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-repository.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-onboarding-schema.php
- pawbowl-wp/wp/wp-content/plugins/headless-secure-registration/src/class-session-token-service.php
- eden-bowls/src/services/onboardingApi.ts
- pawbowl-wp/artefatos/swagger-pawbowl.yaml
