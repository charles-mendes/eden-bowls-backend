# Deploy QA — subdomínios

Guia operacional para publicar o corte:

```text
edenbowls.com/qa-app    →  qa.edenbowls.com
edenbowls.com/qa-admin  →  qa-admin.edenbowls.com
edenbowls.com/qa-api    →  qa-api.edenbowls.com
```

Arquitetura: [edenbowls-qa-architecture.md](./edenbowls-qa-architecture.md).

HSTS da produção já usa `includeSubDomains`. Sem DNS + certificado válido nos três hosts, o navegador que já visitou `edenbowls.com` vai recusar HTTP e o Caddy não emite Let's Encrypt.

---

## 0. Pastas no VPS

Ajuste se o caminho local for outro. O restante do guia usa estes nomes:

```text
$BACKEND  →  pasta do eden-bowls-backend
$STORE    →  pasta do eden-bowls
$ADMIN    →  pasta do eden-bowls-admin
```

Confira os containers atuais antes de mexer:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Esperado hoje:

| Container | Porta no host |
|---|---|
| `eden-bowls-backend-qa` | `127.0.0.1:3000` |
| `eden-bowls-frontend-qa` | `127.0.0.1:4173` |
| `eden-bowls-admin-qa` | `127.0.0.1:4174` |
| `eden-bowls-mysql-qa` | `127.0.0.1:3310` |
| Caddy do `docker-compose.proxy.yml` | host network (80/443) |

Não apague o volume `eden-bowls-mysql-qa-data`. O banco continua o mesmo.

---

## 1. DNS (fazer antes do Caddy novo)

No provedor DNS de `edenbowls.com`, crie **três** registros apontando para o **mesmo IP do VPS** (o de `edenbowls.com`):

| Tipo | Nome | Valor |
|---|---|---|
| A | `qa` | `IP_DO_VPS` |
| A | `qa-admin` | `IP_DO_VPS` |
| A | `qa-api` | `IP_DO_VPS` |

Não altere o registro de `edenbowls.com` / `www`.

Espere propagar e confirme **de fora do servidor**:

```bash
dig +short qa.edenbowls.com
dig +short qa-admin.edenbowls.com
dig +short qa-api.edenbowls.com
```

Os três devem devolver o IP do VPS. Só então siga.

---

## 2. Atualizar o código no servidor

Em cada pasta, puxe a branch que contém este corte (Caddy, `.env.*.example`, `VITE_APP_BASE_PATH=/`).

```bash
cd "$BACKEND" && git pull
cd "$STORE"   && git pull
cd "$ADMIN"   && git pull
```

Arquivos que **já vêm do git** (não editar na mão no VPS, só puxar):

| Pasta | Arquivo | Papel |
|---|---|---|
| `$BACKEND` | `infra/caddy/Caddyfile` | Hosts novos + redirects `/qa-*` |
| `$BACKEND` | `docker-compose.qa.yml` | API + MySQL |
| `$BACKEND` | `docker-compose.proxy.yml` | Caddy público |
| `$STORE` | `docker-compose.frontend.yml` | Loja em `:4173` |
| `$STORE` | `Dockerfile` | Build com `VITE_QA_DEPLOY` |
| `$STORE` | `infra/caddy/Caddyfile.frontend` | `X-Robots-Tag` + `robots.txt` |
| `$ADMIN` | `docker-compose.admin.yml` | Admin em `:4174` |
| `$ADMIN` | `infra/caddy/Caddyfile.admin` | `X-Robots-Tag` + `robots.txt` |

Arquivos que **existem só no VPS** e precisam ser editados: seção 3.

---

## 3. O que alterar no servidor

Não commite `.env`. Edite os arquivos reais do VPS. Os `*.example` do git são o gabarito.

### 3.1 `$BACKEND/.env`

Copie o gabarito **só se o `.env` atual estiver muito defasado**. O caminho seguro é **editar o `.env` existente** e trocar só as chaves abaixo. Senhas, Stripe, SMTP e JWT **não** se regeneram neste deploy.

```bash
cd "$BACKEND"
cp .env .env.bak-$(date +%Y%m%d)
```

Altere:

```env
CORS_ORIGINS=https://qa.edenbowls.com,https://qa-admin.edenbowls.com

JWT_AUTH_ISSUER=https://qa-api.edenbowls.com

AUTH_REFRESH_COOKIE_PATH=/api/v1/auth
AUTH_REFRESH_COOKIE_SAME_SITE=lax
AUTH_REFRESH_COOKIE_SECURE=true
# Não criar AUTH_REFRESH_COOKIE_DOMAIN=.edenbowls.com
# Se essa linha existir, apague ou deixe vazia.

PROFILE_AVATAR_PUBLIC_BASE_URL=https://qa-api.edenbowls.com/avatars
FEEDBACK_PHOTO_PUBLIC_BASE_URL=https://qa-api.edenbowls.com/feedback-photos
```

Valores antigos que devem sumir:

```env
# CORS_ORIGINS=https://edenbowls.com,https://www.edenbowls.com
# JWT_AUTH_ISSUER=https://edenbowls.com/qa-api
# AUTH_REFRESH_COOKIE_PATH=/qa-api/api/v1/auth
# PROFILE_AVATAR_PUBLIC_BASE_URL=https://edenbowls.com/qa-api/avatars
# FEEDBACK_PHOTO_PUBLIC_BASE_URL=https://edenbowls.com/qa-api/feedback-photos
```

Não mexa em: `DB_*`, `MYSQL_ROOT_PASSWORD`, `JWT_AUTH_SECRET_KEY`, `AUTH_OTP_PEPPER`, `STRIPE_*`, `AUTH_SMTP_*`.

Gabarito completo: `$BACKEND/.env.qa.example`.

### 3.2 `$BACKEND/.env.proxy`

Quase sempre **não muda**. Upstreams continuam:

```env
API_UPSTREAM=127.0.0.1:3000
FRONTEND_UPSTREAM=127.0.0.1:4173
ADMIN_UPSTREAM=127.0.0.1:4174
LETSENCRYPT_EMAIL=seu-email@dominio
```

Confirme que o arquivo existe ao lado de `docker-compose.proxy.yml`. Gabarito: `$BACKEND/.env.proxy.example`.

O Caddy lê o `Caddyfile` do git via volume. Depois do `git pull`, o reload já pega os hosts novos. Não edite `/etc/caddy` dentro do container.

### 3.3 `$STORE/.env`

`VITE_*` entra na **imagem no build**. Sem `--build`, a loja continua chamando `/qa-api`.

```bash
cd "$STORE"
cp .env .env.bak-$(date +%Y%m%d)
```

Deixe assim (chave Stripe de **teste** que já usa hoje):

```env
VITE_API_BASE_URL=https://qa-api.edenbowls.com
VITE_AUTH_API_BASE_URL=
VITE_BREEDS_API_BASE_URL=
VITE_PRODUCTS_API_BASE_URL=
VITE_APP_BASE_PATH=/
VITE_SITE_URL=https://qa.edenbowls.com
VITE_QA_DEPLOY=true
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_STRIPE_US_AUTOMATIC_TAX=false
VITE_GA4_MEASUREMENT_ID_US=
VITE_GA4_MEASUREMENT_ID_BR=
VITE_GEO_SIM_FORCE_ENABLED=false
VITE_GEO_SIM_OVERLAY=false
```

Valores antigos:

```env
# VITE_API_BASE_URL=https://edenbowls.com/qa-api
# VITE_APP_BASE_PATH=/qa-app/
```

Gabarito: `$STORE/.env.qa.example`.

### 3.4 `$ADMIN/.env`

```bash
cd "$ADMIN"
cp .env .env.bak-$(date +%Y%m%d)
```

```env
VITE_ADMIN_API_BASE_URL=https://qa-api.edenbowls.com/api/v1
VITE_APP_BASE_PATH=/
```

Valores antigos:

```env
# VITE_ADMIN_API_BASE_URL=https://edenbowls.com/qa-api/api/v1
# VITE_APP_BASE_PATH=/qa-admin/
```

Gabarito: `$ADMIN/.env.qa.example`.

### 3.5 Stripe (painel, não é arquivo no VPS)

No dashboard Stripe **modo test**:

- Webhook: `https://qa-api.edenbowls.com/stripe/v1/webhook`  
  (não use mais `https://edenbowls.com/qa-api/stripe/v1/webhook`)
- Se gerar um endpoint novo, atualize `STRIPE_WEBHOOK_SECRET` em `$BACKEND/.env` e recrie só a API.

---

## 4. Ordem do deploy

DNS resolvendo → `.env` editados → rebuild das UIs → API → Caddy por último.

A API pode subir antes do Caddy novo (ela só escuta `127.0.0.1:3000`). O Caddy novo **não** deve subir se `qa`, `qa-admin` e `qa-api` ainda não resolvem: o Let's Encrypt falha e pode afetar o reload.

### 4.1 Loja

```bash
cd "$STORE"
docker compose --env-file .env -f docker-compose.frontend.yml up -d --build
curl -sI http://127.0.0.1:4173/ | head
```

Espere `HTTP/1.1 200` e `X-Robots-Tag: noindex, nofollow`.

### 4.2 Admin

```bash
cd "$ADMIN"
docker compose --env-file .env -f docker-compose.admin.yml up -d --build
curl -sI http://127.0.0.1:4174/ | head
```

### 4.3 API

Recria o container da API para ler o `.env` novo. O MySQL **não** precisa de `--build` se a imagem não mudou; o `up` abaixo reusa o volume.

```bash
cd "$BACKEND"
docker compose --env-file .env -f docker-compose.qa.yml up -d --build
curl -sS http://127.0.0.1:3000/health
```

Espere `{"status":"ok"}`.

Se quiser recarregar a API **sem** rebuild da imagem (só `.env`):

```bash
cd "$BACKEND"
docker compose --env-file .env -f docker-compose.qa.yml up -d --force-recreate --no-deps api
```

### 4.4 Caddy público

```bash
cd "$BACKEND"
docker compose --env-file .env.proxy -f docker-compose.proxy.yml up -d
```

Se o container já estava no ar e só o `Caddyfile` mudou:

```bash
cd "$BACKEND"
docker compose --env-file .env.proxy -f docker-compose.proxy.yml up -d --force-recreate
```

Acompanhe o certificado:

```bash
docker compose --env-file .env.proxy -f docker-compose.proxy.yml logs -f --tail=80
```

Procure emissão/renovação para `qa.edenbowls.com`, `qa-admin.edenbowls.com` e `qa-api.edenbowls.com`. Erro de challenge = DNS ainda errado ou 80/443 bloqueada.

---

## 5. Conferência

No VPS:

```bash
curl -sI http://127.0.0.1:4173/ | head
curl -sI http://127.0.0.1:4174/ | head
curl -sS http://127.0.0.1:3000/health
```

De uma máquina **externa** (não só localhost):

```bash
curl -sI https://qa.edenbowls.com/ | head
curl -sI https://qa-admin.edenbowls.com/ | head
curl -sS https://qa-api.edenbowls.com/health

curl -sI https://qa.edenbowls.com/robots.txt
curl -sI https://qa-admin.edenbowls.com/robots.txt
curl -sI https://qa-api.edenbowls.com/robots.txt

# Redirects antigos
curl -sI https://edenbowls.com/qa-app/ | head
curl -sI https://edenbowls.com/qa-admin/ | head
curl -sI https://edenbowls.com/qa-api/health | head
```

Checklist no navegador:

- [ ] `https://edenbowls.com` continua a página estática
- [ ] `https://qa.edenbowls.com` abre a loja na raiz (`/recipes`, `/checkout`)
- [ ] `https://qa-admin.edenbowls.com` abre o painel
- [ ] Login da loja e refresh de sessão funcionam
- [ ] Login do admin funciona
- [ ] Checkout de teste (Stripe test)
- [ ] `/qa-app/...` redireciona para `qa.edenbowls.com/...`
- [ ] Certificado válido nos três hosts (cadeado, sem aviso HSTS)

Se o login da loja falhar com cookie: confirme `AUTH_REFRESH_COOKIE_PATH=/api/v1/auth`, `SECURE=true` e que **não** existe `Domain=.edenbowls.com`.

Se a loja ainda chama `edenbowls.com/qa-api`: a imagem da loja foi reutilizada sem `--build`. Rode de novo o passo 4.1.

---

## 6. Comandos úteis

```bash
# Status
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# Logs
cd "$STORE"    && docker compose -f docker-compose.frontend.yml logs -f --tail=80
cd "$ADMIN"    && docker compose -f docker-compose.admin.yml logs -f --tail=80
cd "$BACKEND"  && docker compose --env-file .env -f docker-compose.qa.yml logs -f --tail=80 api
cd "$BACKEND"  && docker compose --env-file .env.proxy -f docker-compose.proxy.yml logs -f --tail=80

# Recriar só um serviço
cd "$STORE"    && docker compose --env-file .env -f docker-compose.frontend.yml up -d --build
cd "$ADMIN"    && docker compose --env-file .env -f docker-compose.admin.yml up -d --build
cd "$BACKEND"  && docker compose --env-file .env -f docker-compose.qa.yml up -d --force-recreate --no-deps api
cd "$BACKEND"  && docker compose --env-file .env.proxy -f docker-compose.proxy.yml up -d --force-recreate
```

Não use `docker compose down -v` no `docker-compose.qa.yml`: isso apaga o volume do MySQL.

---

## 7. Rollback rápido

1. Restaure os `.env` do backup (`*.bak-AAAAMMDD`).
2. Volte o git das três pastas para o commit anterior.
3. Rebuild loja + admin (`VITE_*` antigo entra de novo na imagem).
4. Recrie API e Caddy.

```bash
cd "$STORE"    && git checkout -- . && docker compose --env-file .env -f docker-compose.frontend.yml up -d --build
cd "$ADMIN"    && git checkout -- . && docker compose --env-file .env -f docker-compose.admin.yml up -d --build
cd "$BACKEND"  && git checkout -- . && docker compose --env-file .env -f docker-compose.qa.yml up -d --force-recreate --no-deps api
cd "$BACKEND"  && docker compose --env-file .env.proxy -f docker-compose.proxy.yml up -d --force-recreate
```

Os registros DNS `qa` / `qa-admin` / `qa-api` podem ficar. Sem o Caddy novo eles só não têm vhost.

---

## 8. Resumo do que muda no VPS

| Arquivo no servidor | Ação |
|---|---|
| `$BACKEND/.env` | Trocar CORS, issuer, cookie path, URLs de avatar/foto |
| `$BACKEND/.env.proxy` | Só conferir; upstreams iguais |
| `$STORE/.env` | API em `qa-api`, `BASE_PATH=/`, `VITE_QA_DEPLOY=true` |
| `$ADMIN/.env` | API em `qa-api`, `BASE_PATH=/` |
| `$BACKEND/infra/caddy/Caddyfile` | Já vem do git; reload do Caddy |
| Stripe webhook (dashboard) | Apontar para `https://qa-api.edenbowls.com/stripe/v1/webhook` |
| DNS | Criar `qa`, `qa-admin`, `qa-api` |

Nada para editar em `/srv/edenbowls` (página estática de produção).
