# Ajustes no servidor / DNS (Cloudflare Radar + SSL)

O que já foi feito no repositório **não entra no ar** até o Caddy da VPS recarregar `infra/caddy/Caddyfile` e `infra/caddy/site/`.

O resto desta lista é painel DNS / Cloudflare / Hostinger. Não dá para resolver só com git.

Complementa `possiveis-solucoes.md` (filtro nos EUA) e o scan do [Cloudflare Radar](https://radar.cloudflare.com/pt-br/scan/e4392e89-206a-40f7-b590-f323da2b9503/related) em `https://edenbowls.com`.

---

## Já aplicado no repo (falta deploy)

Depois do pull na VPS, recarregar o proxy:

```bash
cd /caminho/do/eden-bowls-backend
docker compose -f docker-compose.proxy.yml up -d --force-recreate caddy
# ou, se o Caddy não for o compose:
docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile
```

O volume já monta `./infra/caddy/site` em `/srv/edenbowls`. Sem reload, o Radar continua vendo 404 em favicon / robots / sitemap e as fontes do Google.

Conferir depois do deploy:

```bash
curl -sI https://edenbowls.com/favicon.ico | head -n 8
curl -sI https://edenbowls.com/robots.txt | head -n 8
curl -sI https://edenbowls.com/sitemap.xml | head -n 8
curl -sI https://www.edenbowls.com/ | head -n 12
curl -sI https://edenbowls.com/ | grep -iE 'permissions-policy|cross-origin|link:|strict-transport'
```

Esperado:

| URL | Resultado |
|---|---|
| `/favicon.ico`, `/robots.txt`, `/sitemap.xml` | `200` |
| `https://www.edenbowls.com/` | `301` → `https://edenbowls.com/` |
| `https://www.edenbowls.com.br/` | `301` → `https://edenbowls.com.br/` |
| `/` | headers novos: `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `X-Permitted-Cross-Domain-Policies`, `Link: </sitemap.xml>; rel="sitemap"` |
| HTML da home | sem `fonts.googleapis.com` / `fonts.gstatic.com` |

QA (`qa.edenbowls.com`, `qa-admin`, `qa-api`) continua `Disallow: /` + `noindex`. Não mudar isso.

---

## Ordem no servidor / DNS

### 1. Deploy do Caddy + landing (obrigatório)

Sem isso, as correções do Radar (favicon, robots, sitemap, fontes locais, headers, canônico www) não existem em produção.

Não religar HTTP/3. Não trocar o certificado RSA Let's Encrypt. Não voltar o redirect HTTP→HTTPS para `308`. Ver `possiveis-solucoes.md`.

### 2. Cloudflare na frente do Caddy (maior impacto)

Já era a ação #1 contra o filtro Breezeline / sinkhole `18.204.152.241`.

- Conta Cloudflare nos dois TLDs (`edenbowls.com` e `edenbowls.com.br`)
- Nameservers da Cloudflare no registrador (isso também tira o `dns-parking.com`)
- Registros `A` / `CNAME` com **proxy laranja**
- SSL **Full (strict)** → origem `72.62.100.188` (Caddy com Let's Encrypt)
- Caddy continua na VPS; a Cloudflare só é o edge
- Conferir que `qa.edenbowls.com`, `qa-admin.edenbowls.com` e `qa-api.edenbowls.com` continuam resolvendo e com o proxy certo

Não apontar o proxy para HTTP-only (modo Flexible). Quebra HSTS e o certificado da origem.

### 3. Sair de `byte.dns-parking.com` / `pixel.dns-parking.com`

Confirmado em setembro/2026: esses NS ainda respondem a zona.

Scanner e filtro leem “parking” como domínio estacionado / risco. Se o passo 2 for feito, some sozinho. Se ficar na Hostinger, trocar para NS “normais” do domínio, sem a palavra *parking*.

### 4. DNSSEC

O Radar marcou **DNSSEC desativado** (sem RRSIG no `A`).

- Na Cloudflare: ativar DNSSEC e publicar o DS no registrador
- Nos NS atuais (`dns-parking.com`) pode simplesmente não existir a opção — por isso o passo 2/3 vem antes

Não ligar DNSSEC sem o DS certo no registrador: o domínio some do ar.

### 5. E-mail do domínio (MX + SPF + DKIM + DMARC)

Hoje MX e TXT estão vazios. Isso parece site incompleto / phishing.

```
MX     → provedor real (Google, Microsoft ou Hostinger Mail)
TXT    v=spf1 include:... -all
DKIM   → CNAME/TXT que o provedor pedir
TXT    v=DMARC1; p=none; rua=mailto:contato@edenbowls.com
```

Começar DMARC com `p=none`. Só endurecer (`quarantine` / `reject`) depois de ver os relatórios.

### 6. CAA

Restringir quem pode emitir certificado:

```
CAA 0 issue "letsencrypt.org"
```

Se o proxy da Cloudflare estiver ativo, incluir também o CAA deles (`letsencrypt.org` + `pki.goog` / `ssl.com` conforme o painel da Cloudflare mostrar). Sem isso, a Cloudflare pode falhar ao emitir o cert de borda.

### 7. Zona limpa — um A só

No painel (Hostinger hoje, Cloudflare depois):

- `@` → só `72.62.100.188` (ou o CNAME/A laranja da Cloudflare)
- `www` → CNAME para o apex
- Apagar qualquer resto para `18.204.152.241` (AWS / filtro) ou Heroku
- Sem AAAA enquanto não houver IPv6 estável na origem
- Desligar o app antigo na AWS se ainda responder — DNS residual continua gerando “erro de SSL”

### 8. HSTS preload (já no header, falta a lista)

O Caddy já manda `max-age=31536000; includeSubDomains; preload`. A lista do Chrome é outro passo: [hstspreload.org](https://hstspreload.org). Só submeter quando apex e `www` (e os QA, porque `includeSubDomains`) responderem HTTPS de forma estável.

### 9. (Opcional) PTR / rDNS

Hoje o reverso é `srv1612122.hstgr.cloud`. Um PTR `edenbowls.com` ajuda mais e-mail do que web. Só se a Hostinger permitir.

---

## Não fazer no servidor

| Ideia | Por quê |
|---|---|
| Religar HTTP/3 / UDP 443 | Já desligado de propósito (`ERR_QUIC_PROTOCOL_ERROR`). Persistência é o `reject-quic.service` |
| Trocar o certificado de novo | Já é RSA 2048 Let's Encrypt; o bloqueio dos EUA é DNS/filtro |
| `iptables-persistent` ou `ufw enable` agora | Remove ufw / fotografia regras do Docker; apaga o REJECT do QUIC |
| Publicar MCP, A2A, OAuth discovery, DNS-AID, `auth.md`, WebMCP | Checklist de “AI agent” do Radar. A landing não tem API/agente. Arquivo falso piora a reputação |
| `Clear-Site-Data` na home | Apaga storage do visitante |
| `Cross-Origin-Embedder-Policy` | Desnecessário na landing; só depois, com cuidado, se a loja precisar de isolation |
| Pedir à cliente “desligue o filtro” como solução oficial | No 5G já funciona; o objetivo é o domínio não cair na lista |

---

## Depois do DNS / Cloudflare

```bash
dig +short edenbowls.com NS
dig +short edenbowls.com A
dig +dnssec edenbowls.com A +noall +answer
dig +short edenbowls.com MX
dig +short edenbowls.com TXT
dig +short edenbowls.com CAA

# Fora da rede da cliente, o A não pode ser 18.204.152.241.
# Com Cloudflare no laranja, o A passa a ser anycast da CF, não o IP da Hostinger.
```

Na rede que ainda bloqueia (Breezeline WiFi+), repetir os testes de `possiveis-solucoes.md`:

```bash
dig @8.8.8.8 edenbowls.com A
curl -Iv https://edenbowls.com
curl -Iv --resolve edenbowls.com:443:72.62.100.188 https://edenbowls.com
```

---

## O que o Radar pediu e fica de fora de propósito

Nível 1 que importa: `robots.txt`, sitemap, headers de link de sitemap — isso está no repo e depende do deploy (seção 1).

O resto (catálogo de API, OpenID, MCP, A2A, markdown negotiation, DNS `_agents`) só faz sentido quando existir produto público para agente descobrir. Não criar esses arquivos na VPS “para passar no scan”.
