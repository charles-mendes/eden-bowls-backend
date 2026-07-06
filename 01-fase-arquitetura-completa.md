# Eden Bowls - Fase 1 - Arquitetura Completa (Sem Codigo)

Status:

1. Documento de arquitetura inicial criado com base oficial dos arquivos 00 a 15.
2. Sem implementacao de codigo nesta fase.
3. Pronto para aprovacao de arquitetura.

## 1) Diretrizes de arquitetura

1. Plataforma greenfield sem WordPress.
2. Backend Node centraliza toda regra de negocio.
3. Frontend React apenas consome API e renderiza interface.
4. Banco relacional MySQL como fonte oficial.
5. Redis para cache, locks, rate limiting e filas.
6. Arquitetura modular orientada a dominio, com baixo acoplamento.

## 2) Estrutura de pastas proposta

Raiz do projeto:

1. apps/
   - api/
   - web/
   - admin/
2. packages/
   - ui/
   - config/
   - contracts/
   - shared/
3. infra/
   - docker/
   - nginx/
   - scripts/
4. docs/
   - arquitetura/
   - api/
   - negocio/
5. tools/
   - quality/
   - dev/

Estrutura da API:

1. apps/api/src/app/
   - bootstrap
   - server
   - config
2. apps/api/src/modules/
   - auth/
   - users/
   - pets/
   - breeds/
   - onboarding/
   - recommendation/
   - catalog/
   - pricing/
   - shipping/
   - checkout/
   - subscriptions/
   - billing/
   - orders/
   - emails/
   - admin/
   - audit/
3. apps/api/src/infra/
   - db/
   - cache/
   - queue/
   - providers/
   - observability/
4. apps/api/src/shared/
   - errors/
   - http/
   - security/
   - validation/
   - types/
   - utils/

Estrutura Web (cliente):

1. apps/web/src/
   - app/
   - routes/
   - pages/
   - features/
   - components/
   - hooks/
   - services/
   - stores/
   - styles/
   - i18n/

Estrutura Admin:

1. apps/admin/src/
   - app/
   - routes/
   - pages/
   - features/
   - components/
   - hooks/
   - services/
   - stores/
   - styles/

## 3) Modulos e responsabilidades

## 3.1 Core de plataforma

1. app/bootstrap:
   - inicializacao de servidor
   - carga de configuracao e validacao de env
2. observability:
   - logs estruturados
   - metricas basicas
   - correlation id
3. security-core:
   - middlewares de seguranca
   - rate limit
   - hardening de headers

## 3.2 Modulos de negocio backend

1. auth:
   - registro, login, refresh, logout, OTP
   - sessao e revogacao de token
2. users:
   - perfil do cliente
   - endereco e dados de contato
3. pets:
   - CRUD de pets
   - dados nutricionais por pet
4. onboarding:
   - sessao onboarding
   - questionario
   - vinculo de conta
5. recommendation:
   - calculo nutricional
   - versionamento de algoritmo
   - snapshots por sessao e checkout
6. catalog:
   - produtos, variacoes, categorias, sabores
7. pricing:
   - preco por mercado/moeda
   - termos de assinatura (1,3,6,12)
8. shipping:
   - cotacao e selecao de frete
   - expiracao de quote
9. checkout:
   - order de checkout
   - idempotencia de criacao
10. subscriptions:
   - criar, pausar, reativar, cancelar, trocar plano
11. billing:
   - integracao Stripe
   - webhooks
   - retries controlados
12. orders:
   - pedido operacional e status de entrega
13. emails:
   - envio transacional por evento
14. admin:
   - endpoints de operacao e dashboard
15. audit:
   - trilha de alteracoes sensiveis

## 4) Camadas internas por modulo

Cada modulo backend segue:

1. controller:
   - entrada HTTP
   - mapeamento request/response
2. service:
   - casos de uso
   - regra de negocio
3. repository:
   - persistencia
   - queries e transacoes
4. dto:
   - contratos de entrada e saida
5. validators:
   - validacao sintatica e semantica
6. events:
   - publicacao de eventos internos

## 5) Dependencias e bibliotecas recomendadas

Backend:

1. runtime e linguagem:
   - Node.js LTS
   - TypeScript
2. framework:
   - NestJS (recomendado para organizacao modular e DI)
3. ORM e banco:
   - Prisma + MySQL
4. cache/fila:
   - Redis
   - BullMQ
5. auth e seguranca:
   - JWT
   - argon2
   - zod ou class-validator para DTO
6. observabilidade:
   - pino
   - prom-client
7. testes:
   - vitest
   - supertest

Frontend Web/Admin:

1. React + Vite
2. React Router
3. TanStack Query
4. Axios
5. Tailwind CSS
6. shadcn/ui como biblioteca base de componentes
7. Magic UI para componentes visuais premium
8. Aceternity UI para blocos visuais e layouts especiais
9. react-hook-form + zod para formularios

Diretriz de UI:

1. shadcn/ui como base funcional
2. Magic UI e Aceternity UI como complemento visual
3. componentes custom da marca Eden Bowls centralizados em packages/ui

## 6) Padroes arquiteturais adotados

1. Modular Monolith orientado a dominio.
2. Clean Architecture por modulo.
3. Service Layer para casos de uso.
4. Repository Pattern para persistencia.
5. Domain Events para desacoplamento interno.
6. API versionada em /api/v1.
7. Idempotency key para operacoes sensiveis.
8. Correlation id fim a fim.

## 7) Contratos e integracoes

Integracoes externas oficiais:

1. Stripe:
   - clientes
   - payment methods
   - subscriptions
   - webhooks
2. Frete BR:
   - go-live sem integracao automatica
   - operacao manual (regiao de Curitiba)
   - arquitetura preparada para Correios/Melhor Envio/transportadoras
3. Frete US:
   - USPS no go-live
   - arquitetura preparada para UPS/FedEx/DHL
4. Email transacional:
   - SES, SendGrid ou Mailgun

Fluxo de integracao padrao:

1. API recebe comando de negocio.
2. Service valida dominio e persiste estado local.
3. Evento interno dispara integracao assíncrona quando aplicavel.
4. Retorno de webhook reconcilia estado local com idempotencia.

## 8) Fronteiras frontend

Web Cliente (apps/web):

1. landing
2. catalogo
3. onboarding
4. checkout
5. area do cliente
6. assinatura
7. pedidos
8. perfil

Admin (apps/admin):

1. dashboard
2. onboarding 360
3. catalogo e precificacao
4. assinaturas
5. billing basico
6. pedidos
7. clientes
8. estoque basico

## 9) Nao escopo nesta fase

1. Nenhum codigo de implementacao.
2. Nenhuma migration executada.
3. Nenhuma rota codificada.
4. Nenhum componente frontend implementado.

## 10) Decisoes aprovadas para a fase 1

1. Framework backend final: NestJS.
2. Banco oficial: MySQL.
3. Frete BR no go-live: sem integracao automatica (operacao manual).
4. Frete US no go-live: USPS.
5. Papeis iniciais no admin: administrador, operador/suporte, somente leitura.

## 11) Pendencias de negocio (nao bloqueiam arquitetura)

1. Desconto oficial de 12 meses por mercado.
2. Politica final de retry de pagamento.
3. Regra final de proracao de upgrade/downgrade.

Diretriz de implementacao para pendencias:

1. nao interromper o desenvolvimento
2. implementar de forma configuravel por painel/admin
3. registrar como TODO de decisao de produto
4. evitar hardcode de regra comercial no codigo

Aplicacao tecnica obrigatoria desta diretriz:

1. tabela de configuracao de termos/descontos por mercado com vigencia
2. tabela/config de politica de retry por tipo de evento
3. politica de proracao parametrica por acao (upgrade/downgrade, imediata/proxima renovacao)
4. RBAC extensivel para novos papeis sem alteracao estrutural
