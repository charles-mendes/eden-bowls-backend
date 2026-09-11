# Eden Bowls — possíveis soluções (SSL / filtro nos EUA)

Documento gerado a partir da investigação de setembro/2026. Serve para decidir o que já está feito e o que ainda vale aplicar.

## O problema

Clientes nos Estados Unidos (Boca Raton / Breezeline WiFi+) relatam erro ao abrir `edenbowls.com` / `www.edenbowls.com` / `qa-app`:

- aviso de conexão insegura (`http://`)
- `ERR_QUIC_PROTOCOL_ERROR`
- `ERR_SSL_PROTOCOL_ERROR`
- página **Access to this website is blocked** (Safari “Not Secure”)

No Brasil e no **5G da própria cliente** o site abre. Forçar o IP do Caddy no Mac dela também abre:

```bash
curl -Iv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com
# TLS 1.3 + Let's Encrypt + HTTP/2 200
```

## Causa raiz (evidência)

Não é o certificado do Caddy.

Na rede Wi-Fi da cliente, o DNS devolveu outro servidor:

```
www.edenbowls.com  →  CNAME  edenbowls.com
edenbowls.com      →  A      18.204.152.241
```

`18.204.152.241` é EC2 da AWS em Ashburn (`ec2-18-204-152-241.compute-1.amazonaws.com`). Não fala HTTPS de verdade (`tlsv1 alert protocol version`) e em HTTP mostra página de **bloqueio de filtro**. Casa com Breezeline WiFi+ (Plume/Shield): proteção contra malware/phishing que desvia o DNS para um sinkhole.

O servidor correto:

| Item | Valor |
|---|---|
| IP | `72.62.100.188` |
| Hostname | `srv1612122.hstgr.cloud` |
| Onde | VPS Hostinger (Boston) |
| Stack | Caddy (`h1`/`h2`), cert RSA 2048 Let's Encrypt |
| Zona Hostinger | `@` → `72.62.100.188`, `www` → CNAME, TTL 300 |
| NS | `byte.dns-parking.com`, `pixel.dns-parking.com` |

Autoritativos e resolvers públicos (fora daquela rede) já respondem só `72.62.100.188`. Google Safe Browsing não marca o site. A landing é HTML estático, sem WordPress e sem `<script>`.

```
Wi-Fi / filtro (Breezeline WiFi+)
        ↓
edenbowls.com → 18.204.152.241  (página de bloqueio)
        ↓
"Access blocked" + Not Secure

5G / --resolve 72.62.100.188
        ↓
Caddy → TLS 1.3 → site abre
```

---

## Já aplicado no servidor

Não repetir. Cada nova troca de TLS gera sinal de “site instável” para filtro.

| # | O que | Por quê | Estado |
|---|---|---|---|
| 1 | `Content-Security-Policy: upgrade-insecure-requests` (header + meta) | Sobe recurso `http://` para HTTPS | Feito |
| 2 | HSTS `max-age=31536000; includeSubDomains; preload` | Força HTTPS depois da 1ª visita | Feito; preload do Chrome ainda em aprovação (semanas) |
| 3 | Redirect HTTP → HTTPS de `308` para `301` | Alguns ISP/WebViews dos EUA não seguem `308` | Feito |
| 4 | HTTP/3 desligado no Caddy (`protocols h1 h2`) + `Alt-Svc: clear` | Chrome tentava QUIC e falhava (`ERR_QUIC_PROTOCOL_ERROR`) | Feito |
| 5 | Firewall: `REJECT` UDP/443 (ICMP port unreachable) via `reject-quic.service` | Chrome desiste do QUIC na hora e cai para HTTP/2 | Feito; persiste no boot. **Não** instalar `iptables-persistent` (remove o ufw / conflita com Docker) |
| 6 | Certificado ECDSA (ZeroSSL) → **RSA 2048** (Let's Encrypt) | Compatibilidade com appliance antigo de inspeção TLS | Feito (válido até 30/11/2026) |

Checagem atual do Caddy (quatro nomes: apex/www `.com` e `.com.br`):

- TLS 1.2 e 1.3 ok; TLS 1.0/1.1 recusados
- Cadeia RSA completa (`YR1`/`YR2` → Root YR cross-assinada por ISRG X1)
- SNI obrigatório (sem SNI = alert 80)
- Sem AAAA (só IPv4) — evita IPv6 quebrado
- HTTP/2 e HTTP/1.1 respondem `200`

---

## Soluções ainda possíveis

Ordenadas por impacto no filtro dos EUA. A 1 é a que mais reduz bloqueio tipo Breezeline.

### 1. Cloudflare na frente do Caddy (maior impacto)

O filtro deixa de ver o IP da Hostinger (faixa de VPS “barata”) e passa a ver IP anycast da Cloudflare, já em allowlist.

- Nameservers da Cloudflare no domínio
- `A`/`CNAME` com **proxy laranja**
- SSL **Full (strict)** apontando para o Caddy em `72.62.100.188`
- Não desligar o Caddy; ele continua sendo a origem
- Cuidado para não quebrar `/qa-app`, `/qa-api`, `/qa-admin`

Aplicar em `edenbowls.com` e `edenbowls.com.br`.

### 2. Sair dos nameservers `dns-parking.com`

`byte.dns-parking.com` / `pixel.dns-parking.com` parecem domínio estacionado. Scanner e filtro tratam isso como risco.

- Se for para a Cloudflare, some sozinho
- Se ficar na Hostinger: nameservers “normais” do domínio, sem a palavra *parking*

### 3. Completar DNS de e-mail (MX + SPF + DKIM + DMARC)

Hoje o domínio não tem MX, SPF nem DMARC. Isso parece site incompleto / phishing.

```
MX     → provedor real (Google, Microsoft ou Hostinger Mail)
TXT    v=spf1 ... -all
DKIM   → do provedor
TXT    v=DMARC1; p=none; rua=mailto:contato@...
```

`p=none` no começo; só endurecer depois de ver os relatórios.

### 4. Um canônico só (www ou apex)

Hoje `edenbowls.com` e `www.edenbowls.com` servem `200` os dois. Escolher um e redirecionar o outro com `301`.

### 5. Garantir que não existe A antigo

No painel Hostinger, um único `A` em `@` → `72.62.100.188`. Apagar qualquer resto apontando para `18.204.152.241` (ou Heroku). Desligar o app antigo na AWS/Heroku se ainda existir — enquanto aquele IP responder, DNS residual continua gerando “erro de SSL”.

### 6. Parar de alterar TLS / protocolo

Não trocar certificado de novo, não religar HTTP/3, não voltar para `308`. Deixar RSA + HTTP/2 + `301` + HSTS.

### 7. Pedir revisão de falso positivo

O Google Safe Browsing já está limpo. Ainda vale:

- [Google Safe Browsing — report error](https://safebrowsing.google.com/safebrowsing/report_error/)
- Microsoft SmartScreen
- Suporte Breezeline / app WiFi+ (Shield), se o bloqueio continuar naquela casa

### 8. Sinais de empresa real no site

Landing “Coming soon” sem contato aciona mais filtro. Incluir página de contato, identificação da empresa e política de privacidade.

### 9. CAA

Restringir emissão de certificado:

```
CAA 0 issue "letsencrypt.org"
```

Se usar Cloudflare, incluir o CAA deles.

### 10. (Opcional) PTR / rDNS

Hoje o reverso é `srv1612122.hstgr.cloud`. Um PTR `edenbowls.com` ajuda mais e-mail do que filtro web. Só se a Hostinger permitir.

---

## O que **não** resolver

| Ideia | Por quê não |
|---|---|
| Trocar o certificado outra vez | Já é RSA Let's Encrypt; o bloqueio é DNS/filtro |
| Plugin de “segurança” / scan WordPress | O site não é WordPress |
| Instalar `iptables-persistent` | O apt remove o `ufw` e fotografa regras do Docker; a persistência do UDP/443 já é o `reject-quic.service` |
| Ativar o `ufw` agora | Está `inactive`; `ufw enable` reconstrói o netfilter e apaga a regra do INPUT até o próximo boot |
| Pedir à cliente “desligue o filtro” como solução oficial | No 5G funciona porque o filtro não está no caminho; o objetivo é o domínio não cair na lista |

---

## Testes para confirmar (rede da cliente)

Ainda no Wi-Fi ruim:

```bash
dig @byte.dns-parking.com edenbowls.com A
dig @8.8.8.8 edenbowls.com A
dig @192.168.40.1 edenbowls.com A
curl -Iv https://www.edenbowls.com
curl -Iv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com
```

Esperado:

- autoritativo → `72.62.100.188`
- se `192.168.40.1` ou `8.8.8.8` (nessa rede) → `18.204.152.241`, o roteador/filtro está sequestrando DNS
- `--resolve` para `72.62.100.188` → `HTTP/2 200`

---

## Ordem sugerida

1. **Cloudflare** em proxy Full (strict) nos dois TLDs — uma ação, maior ganho.
2. MX + SPF + DKIM + DMARC.
3. Conferir zona: um único A, sem IP antigo.
4. Canônico www↔apex.
5. Contato / privacidade no site.
6. Revisões de falso positivo só se o Wi-Fi da Breezeline continuar bloqueando depois da Cloudflare.

Nenhum filtro residencial zera 100%. Cloudflare + DNS de e-mail + nameserver sem “parking” + configuração estável é o combo que mais reduz esse bloqueio.
