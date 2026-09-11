# Eden Bowls — Estratégia de Ambientes QA e Produção

## Objetivo

Definir uma estrutura simples, segura e profissional para o Eden Bowls, priorizando o ambiente de **QA** para desenvolvimento, validação e testes, enquanto o domínio principal permanece com uma página estática de apresentação.

O site de produção atualmente apresenta uma página estática de lançamento:

- https://edenbowls.com/
- Mensagem atual: **Launching Soon / Coming Soon**

As aplicações em desenvolvimento devem permanecer separadas dessa página pública.

O QA de hoje **não é um único site**. São três aplicações distintas no mesmo host, por path. Esta estratégia move cada uma para o próprio subdomínio.

---

## 1. Situação atual

O Caddy público em `edenbowls.com` encaminha três prefixos para três upstreams:

| Path público | Projeto | Upstream atual |
|---|---|---|
| `/` | Página estática | arquivos em `/srv/edenbowls` |
| `/qa-app/` | Loja (`eden-bowls`) | `127.0.0.1:4173` |
| `/qa-admin/` | Painel (`eden-bowls-admin`) | `127.0.0.1:4174` |
| `/qa-api/` | API (`eden-bowls-backend`) | API Node |

URLs atuais:

```text
https://edenbowls.com/              Página estática de produção
https://edenbowls.com/qa-app/       Loja de QA
https://edenbowls.com/qa-admin/     Painel de QA
https://edenbowls.com/qa-api/       API de QA
```

O painel **não** é uma rota da loja. São SPAs diferentes, com `VITE_APP_BASE_PATH` próprio (`/qa-app/` e `/qa-admin/`). A API compartilha o mesmo origin, com cookie de refresh em `/qa-api/api/v1/auth`.

Esse modelo funciona, mas mistura QA e produção no mesmo hostname. Cookie, CORS, SEO, cache e SSL ficam acoplados à página pública.

---

## 2. Estrutura recomendada

Um host por aplicação de QA. A produção deixa de conhecer esses paths, exceto por redirects temporários.

```text
https://edenbowls.com
    Ambiente de produção
    Página estática de lançamento
    Conteúdo público
    Indexável pelos mecanismos de busca

https://qa.edenbowls.com
    QA da loja (ex /qa-app/)
    Aplicação completa do cliente
    Dados e integrações de teste
    Não indexável
    Preferencialmente protegido por senha

https://qa-admin.edenbowls.com
    QA do painel (ex /qa-admin/)
    Back-office interno
    Não indexável
    Protegido por autenticação do painel
    Preferencialmente também protegido no proxy

https://qa-api.edenbowls.com
    QA da API (ex /qa-api/)
    Backend compartilhado pela loja e pelo painel
    Não indexável

localhost
    Ambiente local de desenvolvimento
    Execução dos três projetos na máquina do desenvolvedor
```

### URLs

| Ambiente | URL | Finalidade |
|---|---|---|
| Produção | `https://edenbowls.com` | Página estática pública |
| QA — loja | `https://qa.edenbowls.com` | Loja para testes e validação |
| QA — admin | `https://qa-admin.edenbowls.com` | Painel administrativo de teste |
| QA — API | `https://qa-api.edenbowls.com` | API de teste usada pelas duas UIs |
| Desenvolvimento local | `http://localhost` | Desenvolvimento e testes locais |

### O que não fazer

Não colocar o admin em `qa.edenbowls.com/admin`.

Isso recria o modelo atual (dois SPAs no mesmo host + `BASE_PATH`) e mistura o painel com a loja. O admin continua sendo o projeto `eden-bowls-admin`, em host próprio.

Não deixar a API em `edenbowls.com/qa-api` enquanto as UIs vão para subdomínio. Cookie, issuer, CORS e URLs públicas de avatar/fotos ficariam no meio do caminho.

---

## 3. Produção

O ambiente de produção continuará hospedando a página estática atual.

### Características

- Domínio principal: `edenbowls.com`
- Página de lançamento institucional
- Conteúdo público
- Sem funcionalidades experimentais
- Sem acesso a loja, admin ou API de QA
- Indexação permitida, caso desejado para a página de lançamento
- Certificado SSL válido
- Redirecionamento de HTTP para HTTPS

### Objetivo

Manter o domínio principal estável, simples e seguro enquanto loja, painel e API são desenvolvidos e validados no ambiente de QA.

As aplicações de QA não devem substituir ou interferir na página estática de produção.

---

## 4. Ambiente de QA

O QA é o ambiente principal de validação antes de qualquer publicação futura em produção. Ele é composto por **três hosts**, não por um.

### 4.1 Loja — `qa.edenbowls.com`

Projeto: `eden-bowls`.

- Onboarding, receitas, calculador, checkout, conta e assinatura
- Stripe em modo de teste
- `VITE_APP_BASE_PATH=/` (raiz do host, sem `/qa-app/`)
- Consome `https://qa-api.edenbowls.com`

```text
qa.edenbowls.com
├── /
├── /recipes
├── /recipes/beef
├── /recipes/chicken
├── /recipes/pork
├── /recipes/fish
├── /calculator
├── /checkout
└── /account
```

A estrutura exata das rotas pode variar conforme a loja. Não existe `/admin` neste host.

### 4.2 Painel — `qa-admin.edenbowls.com`

Projeto: `eden-bowls-admin`.

- Usuários, pedidos, onboarding operacional, catálogo, billing, nutrição
- Autenticação e permissões próprias do painel (`/admin/me`, papéis, `readonly`)
- `VITE_APP_BASE_PATH=/` (raiz do host, sem `/qa-admin/`)
- Consome `https://qa-api.edenbowls.com/api/v1`

```text
qa-admin.edenbowls.com
├── /
├── /users
├── /orders
└── /nutrition/simulate
```

A estrutura exata das rotas pode variar conforme o painel.

### 4.3 API — `qa-api.edenbowls.com`

Projeto: `eden-bowls-backend`.

- Backend compartilhado pela loja e pelo painel
- Banco, Stripe test, e-mails e webhooks de teste
- Sem prefixo `/qa-api` no path público
- Cookie de refresh em `/api/v1/auth`

### Características comuns do QA

- Funcionalidades em desenvolvimento
- Testes manuais e automatizados
- Dados fictícios ou de teste
- Não indexável pelos mecanismos de busca
- Preferencialmente protegido no proxy, além da autenticação de cada app

---

## 5. Por que utilizar subdomínios para QA?

Cada aplicação de QA passa a ter hostname próprio, separado do site público.

### Benefícios

#### Separação clara

```text
edenbowls.com            → Produção (página estática)
qa.edenbowls.com         → QA da loja
qa-admin.edenbowls.com   → QA do painel
qa-api.edenbowls.com     → QA da API
```

Desenvolvedores, clientes, negócio e QA identificam o ambiente pelo host, não por um path escondido no domínio institucional.

#### Menor risco de interferência

O QA pode ter configurações próprias de:

- Variáveis de ambiente
- Banco de dados
- Cache
- Virtual hosts no Caddy
- Cookies
- Autenticação
- CORS
- Integrações
- Serviços externos
- Logs
- Monitoramento

A página estática deixa de carregar regras de `/qa-app`, `/qa-admin` e `/qa-api`.

#### Maior flexibilidade

Loja, admin e API evoluem independentemente da página de produção.

Também será possível adicionar outros ambientes no futuro, caso necessário:

```text
dev.edenbowls.com
staging.edenbowls.com
```

Não é necessário criar esses ambientes agora. Os três hosts de QA já atendem ao cenário atual.

### Nomeação alternativa

Se preferirem “ambiente QA” como árvore, em vez de três irmãos:

```text
qa.edenbowls.com
admin.qa.edenbowls.com
api.qa.edenbowls.com
```

O comportamento é o mesmo. Exige DNS aninhado (`admin.qa`) ou wildcard `*.qa.edenbowls.com`.

A recomendação desta estratégia é o paralelo mais simples com os names atuais:

```text
/qa-app    → qa.edenbowls.com
/qa-admin  → qa-admin.edenbowls.com
/qa-api    → qa-api.edenbowls.com
```

---

## 6. Segurança do ambiente de QA

O ambiente de QA não deve ser tratado como um ambiente público comum. Loja, painel e API precisam de proteção.

### Recomendações

#### 6.1 Proteger o acesso

Sempre que possível, utilizar uma das opções em **loja e admin**:

- Autenticação básica no Caddy;
- Login obrigatório da aplicação;
- Restrição por IP, quando viável;
- VPN;
- Controle de acesso no proxy reverso.

A proteção no proxy é especialmente importante no painel (`qa-admin.edenbowls.com`), que concentra funções administrativas.

A API não precisa de página pública. Pode restringir origens via CORS e, se desejado, recusar acesso direto no proxy fora das origens da loja e do admin.

#### 6.2 Não utilizar dados reais

O ambiente de QA deve utilizar:

- Dados fictícios;
- Usuários de teste;
- Produtos de teste;
- Assinaturas de teste;
- Banco de dados separado;
- Chaves de API de teste;
- Contas Stripe em modo de teste.

Não devem ser utilizados dados reais de clientes no ambiente de QA sem uma justificativa, controle e proteção adequados.

#### 6.3 Separar variáveis de ambiente

Exemplo conceitual:

```env
# Produção
NODE_ENV=production
APP_URL=https://edenbowls.com
STRIPE_MODE=live

# QA — loja
VITE_APP_BASE_PATH=/
VITE_API_BASE_URL=https://qa-api.edenbowls.com

# QA — admin
VITE_APP_BASE_PATH=/
VITE_ADMIN_API_BASE_URL=https://qa-api.edenbowls.com/api/v1

# QA — API
CORS_ORIGINS=https://qa.edenbowls.com,https://qa-admin.edenbowls.com
JWT_AUTH_ISSUER=https://qa-api.edenbowls.com
AUTH_REFRESH_COOKIE_PATH=/api/v1/auth
AUTH_REFRESH_COOKIE_SAME_SITE=lax
AUTH_REFRESH_COOKIE_SECURE=true
PROFILE_AVATAR_PUBLIC_BASE_URL=https://qa-api.edenbowls.com/avatars
FEEDBACK_PHOTO_PUBLIC_BASE_URL=https://qa-api.edenbowls.com/feedback-photos
STRIPE_MODE=test
```

Os valores reais devem ser armazenados de forma segura, como em variáveis protegidas do servidor, secrets ou ferramentas de gerenciamento de configuração.

#### 6.4 CORS e cookies

Hoje loja, admin e API compartilham `edenbowls.com`. Por isso `CORS_ORIGINS` aponta para o domínio principal e o cookie usa path `/qa-api/api/v1/auth`.

Com subdomínios, as UIs e a API passam a ser **origens diferentes** no **mesmo site** (`edenbowls.com`):

- `SameSite=Lax` continua adequado;
- o cookie pode permanecer host-only em `qa-api.edenbowls.com` (as UIs não leem o cookie);
- CORS precisa listar as duas origens das UIs, com credenciais;
- não usar `Access-Control-Allow-Origin: *` nas rotas autenticadas.

Não é necessário `Domain=.edenbowls.com` no cookie de refresh. Isso evitaria vazar o cookie para a produção e para outros subdomínios.

---

## 7. SEO e indexação

A página de produção pode permanecer disponível para indexação.

Loja, admin e API de QA devem ser configurados para não aparecer nos resultados de busca.

### 7.1 Meta tag no QA

Adicionar no HTML da loja e do admin:

```html
<meta name="robots" content="noindex, nofollow">
```

### 7.2 Cabeçalho HTTP

Configurar nos três hosts de QA:

```http
X-Robots-Tag: noindex, nofollow
```

### 7.3 robots.txt

Cada host de QA pode utilizar:

```text
User-agent: *
Disallow: /
```

Exemplos:

```text
https://qa.edenbowls.com/robots.txt
https://qa-admin.edenbowls.com/robots.txt
https://qa-api.edenbowls.com/robots.txt
```

### Importante

O `robots.txt` não é um mecanismo de segurança. Ele apenas informa aos mecanismos de busca que o conteúdo não deve ser rastreado.

Por isso, o ideal é combinar:

1. `noindex`;
2. `X-Robots-Tag`;
3. `robots.txt`;
4. Proteção por senha ou autenticação, sobretudo no admin.

### 7.4 Sitemap

O sitemap de produção não deve incluir URLs do QA.

Exemplo correto:

```text
https://edenbowls.com/sitemap.xml
```

O sitemap não deve conter:

```text
https://qa.edenbowls.com/...
https://qa-admin.edenbowls.com/...
https://qa-api.edenbowls.com/...
https://edenbowls.com/qa-app/...
https://edenbowls.com/qa-admin/...
https://edenbowls.com/qa-api/...
```

---

## 8. DNS

Criar um registro para cada host de QA. O DNS do domínio principal não muda.

```text
qa.edenbowls.com
qa-admin.edenbowls.com
qa-api.edenbowls.com
```

### Exemplo com registro A

```text
Tipo: A
Nome: qa
Valor: IP_DO_SERVIDOR_DE_QA

Tipo: A
Nome: qa-admin
Valor: IP_DO_SERVIDOR_DE_QA

Tipo: A
Nome: qa-api
Valor: IP_DO_SERVIDOR_DE_QA
```

### Exemplo com registro CNAME

```text
Tipo: CNAME
Nome: qa
Valor: destino-do-servidor.example.com

Tipo: CNAME
Nome: qa-admin
Valor: destino-do-servidor.example.com

Tipo: CNAME
Nome: qa-api
Valor: destino-do-servidor.example.com
```

O tipo de registro deve ser escolhido conforme a arquitetura do servidor e do provedor DNS.

### Observações

- Os três subdomínios devem apontar para o ambiente correto;
- O DNS de QA não deve substituir o registro do domínio principal;
- O domínio principal deve continuar apontando para a página estática de produção;
- Deve ser configurado certificado SSL para os três hosts.

---

## 9. SSL/TLS

Os três hosts de QA devem utilizar HTTPS:

```text
https://qa.edenbowls.com
https://qa-admin.edenbowls.com
https://qa-api.edenbowls.com
```

Não é recomendado utilizar o QA permanentemente em HTTP, principalmente porque as aplicações envolvem:

- Login;
- Cookies;
- Sessões;
- Dados de usuários;
- Checkout;
- Integrações;
- APIs;
- Tokens;
- Formulários.

O Caddy de produção já envia HSTS com `includeSubDomains`. Navegadores que já visitaram `edenbowls.com` vão forçar HTTPS nesses subdomínios. O certificado precisa estar válido no dia do corte.

Opções de certificado:

- um certificado por host (`qa`, `qa-admin`, `qa-api`);
- ou wildcard `*.edenbowls.com`.

### Checklist de SSL

- [ ] Certificado válido para `qa.edenbowls.com`
- [ ] Certificado válido para `qa-admin.edenbowls.com`
- [ ] Certificado válido para `qa-api.edenbowls.com`
- [ ] Redirecionamento de HTTP para HTTPS nos três hosts
- [ ] Nenhum conteúdo misto
- [ ] Cadeia de certificados válida
- [ ] Teste em navegadores diferentes
- [ ] Teste em redes externas
- [ ] Verificação de compatibilidade com dispositivos móveis

---

## 10. Proxy (Caddy)

Hoje um único bloco de `edenbowls.com` faz `handle_path` para `/qa-app`, `/qa-admin` e `/qa-api`.

O alvo é um virtual host por hostname. A produção fica só com a página estática e, por um período, com redirects das URLs antigas.

```text
edenbowls.com            → página estática
                         → redirects temporários de /qa-app, /qa-admin e /qa-api

qa.edenbowls.com         → proxy 127.0.0.1:4173   (loja)
qa-admin.edenbowls.com   → proxy 127.0.0.1:4174   (admin)
qa-api.edenbowls.com     → proxy da API Node
```

Cada frontend volta a servir assets e rotas na raiz. O `handle_path` que remove o prefixo deixa de ser necessário nesses hosts.

### Redirects das URLs antigas

Enquanto existirem bookmarks, e-mails ou links internos:

```text
https://edenbowls.com/qa-app/*      →  https://qa.edenbowls.com/{path}
https://edenbowls.com/qa-admin/*    →  https://qa-admin.edenbowls.com/{path}
https://edenbowls.com/qa-api/*      →  https://qa-api.edenbowls.com/{path}
```

Depois da validação, esses redirects podem ser removidos para a produção voltar a ser apenas a página estática.

---

## 11. Fluxo de desenvolvimento

O fluxo recomendado é:

```text
Desenvolvimento local
        ↓
Deploy para QA (loja, admin e/ou API)
        ↓
Testes e validação
        ↓
Correções
        ↓
Nova validação
        ↓
Aprovação
        ↓
Publicação futura em produção
```

### Exemplo

```text
localhost
    ↓
qa.edenbowls.com
qa-admin.edenbowls.com
qa-api.edenbowls.com
    ↓
edenbowls.com
```

No cenário atual, a publicação em produção pode continuar limitada à página estática. O QA será utilizado para desenvolver e validar loja, painel e API.

---

## 12. Estratégia de deploy

O deploy deve ser separado por ambiente e, no QA, por aplicação.

### QA

O deploy para QA pode ocorrer com maior frequência:

- A cada funcionalidade concluída;
- A cada pull request aprovado;
- A cada versão de teste;
- Conforme a necessidade de validação.

Loja, admin e API podem ser publicados de forma independente, desde que as variáveis de URL, CORS e cookie estejam alinhadas.

### Produção

O deploy de produção deve ser mais controlado:

- Após validação no QA;
- Após aprovação da funcionalidade;
- Após revisão das variáveis de ambiente;
- Após validação de integrações;
- Após backup, quando aplicável;
- Após confirmação de que não haverá impacto na página estática.

---

## 13. Variáveis e integrações

As integrações devem ser separadas por ambiente.

| Recurso | Produção | QA |
|---|---|---|
| Banco de dados | Produção | Banco de teste |
| Stripe | Live | Test |
| E-mails | Produção | E-mails de teste |
| Webhooks | Produção | Webhooks de teste |
| Storage | Produção | Storage de teste |
| APIs externas | Produção | Sandbox, quando disponível |
| Logs | Produção | Logs de QA |
| Monitoramento | Produção | Monitoramento separado ou identificado |
| CORS | Origens de produção | `qa.edenbowls.com` e `qa-admin.edenbowls.com` |

### Atenção ao Stripe

O QA deve utilizar as chaves de teste:

```text
pk_test_...
sk_test_...
```

A produção deve utilizar as chaves live:

```text
pk_live_...
sk_live_...
```

As chaves nunca devem ser compartilhadas entre os ambientes.

Callbacks e webhooks do Stripe de QA devem apontar para `https://qa-api.edenbowls.com`, não para `https://edenbowls.com/qa-api`.

---

## 14. Migração a partir dos paths atuais

As URLs atuais não estão tecnicamente erradas. Elas fazem sentido quando o mesmo domínio hospeda tudo e o isolamento não é prioridade.

Para o Eden Bowls, os subdomínios são mais adequados porque o QA é um ambiente separado da página estática, e porque loja e admin já são aplicações distintas.

### De

```text
https://edenbowls.com/qa-app/
https://edenbowls.com/qa-admin/
https://edenbowls.com/qa-api/
```

### Para

```text
https://qa.edenbowls.com
https://qa-admin.edenbowls.com
https://qa-api.edenbowls.com
```

A migração deve ser feita somente depois de:

- Configurar o DNS dos três hosts;
- Configurar os virtual hosts no Caddy;
- Configurar o SSL dos três hosts;
- Ajustar `VITE_APP_BASE_PATH` para `/` na loja e no admin;
- Ajustar URLs da API, CORS, issuer e cookie;
- Validar rotas, assets, autenticação e integrações;
- Configurar `noindex` na loja, no admin e na API;
- Configurar redirects das URLs antigas;
- Confirmar que a produção continua exibindo só a página estática.

---

## 15. Checklist de implementação

### DNS

- [ ] Criar `qa.edenbowls.com`
- [ ] Criar `qa-admin.edenbowls.com`
- [ ] Criar `qa-api.edenbowls.com`
- [ ] Apontar os três subdomínios para o servidor correto
- [ ] Confirmar propagação DNS
- [ ] Validar resolução em redes diferentes

### Servidor / Caddy

- [ ] Virtual host da loja → upstream da loja
- [ ] Virtual host do admin → upstream do admin
- [ ] Virtual host da API → upstream da API
- [ ] Produção deixa de fazer `handle_path` de QA, salvo redirects
- [ ] Redirects de `/qa-app`, `/qa-admin` e `/qa-api`
- [ ] Separar variáveis de ambiente
- [ ] Separar logs
- [ ] Separar banco de dados, quando aplicável

### SSL

- [ ] Emitir certificado para os três hosts (ou wildcard)
- [ ] Configurar HTTPS
- [ ] Redirecionar HTTP para HTTPS
- [ ] Validar certificado externamente
- [ ] Confirmar compatibilidade com HSTS `includeSubDomains` da produção

### Aplicações

- [ ] Loja: `VITE_APP_BASE_PATH=/`
- [ ] Loja: `VITE_API_BASE_URL=https://qa-api.edenbowls.com`
- [ ] Admin: `VITE_APP_BASE_PATH=/`
- [ ] Admin: `VITE_ADMIN_API_BASE_URL=https://qa-api.edenbowls.com/api/v1`
- [ ] API: `CORS_ORIGINS` com loja e admin
- [ ] API: `JWT_AUTH_ISSUER=https://qa-api.edenbowls.com`
- [ ] API: `AUTH_REFRESH_COOKIE_PATH=/api/v1/auth`
- [ ] Atualizar URLs públicas de avatar e feedback
- [ ] Atualizar callbacks e webhooks
- [ ] Validar carregamento de assets
- [ ] Validar rotas internas da loja e do admin
- [ ] Validar autenticação da loja e do painel

### SEO

- [ ] `noindex, nofollow` na loja e no admin
- [ ] `X-Robots-Tag` nos três hosts
- [ ] `robots.txt` nos três hosts
- [ ] Remover QA do sitemap de produção
- [ ] Evitar links públicos desnecessários para o QA

### Segurança

- [ ] Proteger o acesso à loja e ao admin
- [ ] Não utilizar dados reais
- [ ] Utilizar Stripe em modo de teste
- [ ] Utilizar chaves de API de teste
- [ ] Revisar permissões administrativas
- [ ] Confirmar que o QA não acessa recursos de produção indevidamente
- [ ] Cookie de refresh sem `Domain=.edenbowls.com`

### Validação final

- [ ] Produção continua exibindo a página estática
- [ ] `qa.edenbowls.com` abre a loja
- [ ] `qa-admin.edenbowls.com` abre o painel
- [ ] `qa-api.edenbowls.com` responde health/API
- [ ] HTTPS funciona nos três hosts
- [ ] Login da loja funciona
- [ ] Login do admin funciona
- [ ] Rotas da loja e do admin funcionam na raiz
- [ ] Checkout de teste funciona
- [ ] Redirects das URLs antigas funcionam
- [ ] QA não aparece no Google
- [ ] Não há vazamento de dados entre QA e produção

---

## Conclusão

Para o cenário atual do Eden Bowls, a melhor organização é um host por aplicação de QA:

```text
https://edenbowls.com
    Página estática de produção

https://qa.edenbowls.com
    Loja de QA (ex /qa-app/)

https://qa-admin.edenbowls.com
    Painel de QA (ex /qa-admin/)

https://qa-api.edenbowls.com
    API de QA (ex /qa-api/)
```

Essa abordagem mantém a produção simples e estável, preserva a separação já existente entre loja e admin, e tira cookie, CORS e proxy do caminho da página pública.

As URLs `edenbowls.com/qa-app/`, `edenbowls.com/qa-admin/` e `edenbowls.com/qa-api/` podem continuar funcionando temporariamente via redirect. Os subdomínios são a opção recomendada para o ambiente de QA.
