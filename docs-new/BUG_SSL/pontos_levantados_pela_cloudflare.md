Foi feito o scan pela seguinte rota

http://radar.cloudflare.com/pt-br/scan/e4392e89-206a-40f7-b590-f323da2b9503/related

que seria o site CloudFlare Radar

E segue o que ele levantou em formato texto


Verificar o que pode ser ajustado

E trazer alguma recomandação que necessite de alguma configuração ou configuração mais aprofundada

O link testado foi

https://edenbowls.com/


Violações de segurança · 2 encontrada(s)
Solicitações ou recursos que ofendem as políticas de segurança
Violação	Tipo	Informações
Recurso
https://edenbowls.com/
Descrição
Access to font at 'https://fonts.gstatic.com/s/quicksand/v37/6xKtdSZaM9iE8KbpRA_hK1QN.woff2' from origin 'https://edenbowls.com' has been blocked by CORS policy: Request header field signature-agent is not allowed by Access-Control-Allow-Headers in preflight response.
Compartilhamento de recursos entre origens	Controla quais origens externas têm permissão para carregar recursos.

Clique para saber mais...
Recurso
https://edenbowls.com/
Descrição
Access to font at 'https://fonts.gstatic.com/s/tenorsans/v21/bx6ANxqUneKx06UkIXISn3V4Cg.woff2' from origin 'https://edenbowls.com' has been blocked by CORS policy: Request header field signature-agent is not allowed by Access-Control-Allow-Headers in preflight response.
Compartilhamento de recursos entre origens

Registros de DNS · 1 encontrado(s)
Os registros de DNS fornecem informações sobre um domínio, incluindo o endereço de IP ao qual ele está associado
Tipo	Nome	Conteúdo	DNSSEC
A	edenbowls.com	72.62.100.188	
Desativado


Mensagens de registro do console · 5 encontrada(s)
Mensagens registradas no console web
Nível	Origem	Mensagem
Erro	Segurança	
URL
https://edenbowls.com/
Texto
Access to font at 'https://fonts.gstatic.com/s/quicksand/v37/6xKtdSZaM9iE8KbpRA_hK1QN.woff2' from origin 'https://edenbowls.com' has been blocked by CORS policy: Request header field signature-agent is not allowed by Access-Control-Allow-Headers in preflight response.
Erro	Rede	
URL
https://fonts.gstatic.com/s/quicksand/v37/6xKtdSZaM9iE8KbpRA_hK1QN.woff2
Texto
Failed to load resource: net::ERR_FAILED
Erro	Segurança	
URL
https://edenbowls.com/
Texto
Access to font at 'https://fonts.gstatic.com/s/tenorsans/v21/bx6ANxqUneKx06UkIXISn3V4Cg.woff2' from origin 'https://edenbowls.com' has been blocked by CORS policy: Request header field signature-agent is not allowed by Access-Control-Allow-Headers in preflight response.
Erro	Rede	
URL
https://fonts.gstatic.com/s/tenorsans/v21/bx6ANxqUneKx06UkIXISn3V4Cg.woff2
Texto
Failed to load resource: net::ERR_FAILED
Erro	Rede	
URL
https://edenbowls.com/favicon.ico
Texto
Failed to load resource: the server responded with a status of 404 (Not Found)

Cabeçalhos de segurança · 5 encontrado(s)
Cabeçalhos de resposta HTTP que podem aumentar a segurança de um aplicativo webSaiba mais...
Nome	Valor	Suporte	Info
Strict-Transport-Security	max-age=31536000; includeSubDomains; preload	
Bom
Declarar que um site só pode ser acessado por meio de uma conexão segura (HTTPS).

Clique para saber mais...
X-Frame-Options	SAMEORIGIN	
Bom
Indicar se um navegador deve ter permissão para renderizar uma página em <frame>, <iframe>, <embed> ou <object>.

Clique para saber mais...
X-Content-Type-Options	nosniff	
Bom
Indicar que os tipos MIME anunciados nos cabeçalhos Content-Type devem ser seguidos e não alterados.

Clique para saber mais...
Content-Security-Policy	upgrade-insecure-requests	
Bom
Controlar os recursos que o agente do usuário pode carregar para uma determinada página.

Clique para saber mais...
Referrer-Policy	strict-origin-when-cross-origin	
Bom
Controlar a quantidade de informações de referência que devem ser incluídas nas solicitações.

Clique para saber mais...
Clear-Site-Data	—	
Bom
Controlar os dados armazenados por um navegador cliente quanto às suas origens.

Clique para saber mais...
X-Permitted-Cross-Domain-Policies	—	
Bom
Controlar se um cliente web, como Adobe Flash Player ou Adobe Acrobat, tem permissão para controlar dados entre domínios.

Clique para saber mais...
Permissions-Policy	—	
Recente
Permitir e negar o uso de recursos do navegador em um documento ou iframe.

Clique para saber mais...
Cross-Origin-Embedder-Policy	—	
Recente
Configurar a incorporação de recursos de origem cruzada no documento.

Clique para saber mais...
Cross-Origin-Opener-Policy	—	
Recente
Garantir que um documento de nível superior não compartilhe um grupo de contexto de navegação com documentos de origem cruzada.

Clique para saber mais...
Cross-Origin-Resource-Policy	—	
Recente
Solicitar que o navegador bloqueie solicitações de origem cruzada/entre sites no-cors para o recurso fornecido.

Clique para saber mais...
X-XSS-Protection	—	
Descontinuado
Descontinuado Impede o carregamento de páginas quando detectam ataques refletidos de cross-site scripting (XSS).

Clique para saber mais...
Feature-Policy	—	
Descontinuado
Descontinuado Substituído pelo cabeçalho Permissions-Policy.

Clique para saber mais...
Expect-CT	—	
Descontinuado
Descontinuado Optar por relatar e/ou aplicar requisitos de transparência de certificados.

Clique para saber mais...
Public-Key-Pins	—	
Descontinuado
Descontinuado Permitir que sites HTTPS resistam à falsificação de invasores usando certificados emitidos incorretamente ou fraudulentos.

Clique para saber mais...

Capacidade de descoberta
0/4 aprovado
Reprovado
robots.txt
Objetivo
Publish /robots.txt with clear crawl rules
Resultado
robots.txt not found
Evidência
GET /robots.txt
404
Server returned 404 -- robots.txt not found
Conclusion
robots.txt not found (404, soft-404, or HTML response)
Como resolver

Copiar
Create /robots.txt at the site root with explicit User-agent directives and allow/disallow rules for key paths. Ensure it is plain text and returns 200.
rfc-editor.org
Habilidade
Reprovado
Mapa do site
Objetivo
Publish a sitemap and reference it from robots.txt
Resultado
sitemap.xml not found
Evidência
GET /sitemap.xml
404
https://edenbowls.com/sitemap.xml returned 404
GET /sitemap-index.xml
404
https://edenbowls.com/sitemap-index.xml returned 404
GET /sitemap_index.xml
404
https://edenbowls.com/sitemap_index.xml returned 404
GET /sitemap.xml.gz
404
https://edenbowls.com/sitemap.xml.gz returned 404
Conclusion
sitemap.xml not found at any expected location
Como resolver

Copiar
Generate /sitemap.xml listing canonical URLs, keep it updated on publish, and reference it from /robots.txt.
sitemaps.org
Habilidade
Reprovado
Cabeçalhos de links
Objetivo
Include Link response headers for agent discovery (RFC 8288)
Resultado
No Link headers found on target page
Evidência
GET /
200
No Link header present in response
Conclusion
No Link headers found on target page
Como resolver

Copiar
Add Link response headers to your homepage that point agents to useful resources. For example: Link: </.well-known/api-catalog>; rel="api-catalog" to advertise your API catalog, or Link: </docs/api>; rel="service-doc" for API documentation. See RFC 8288 for the Link header format and IANA Link Relations for registered relation types.
rfc-editor.org
rfc-editor.org
Habilidade
Reprovado
DNS for AI Discovery (DNS-AID)
Objetivo
Publish DNS for AI Discovery (DNS-AID) SVCB/HTTPS records for DNS-based agent discovery
Resultado
DNS for AI Discovery (DNS-AID) well-known entrypoint records not found
Evidência
DoH SVCB _index._agents.edenbowls.com
200
No SVCB answers (NXDOMAIN)
Corpo da resposta
DoH HTTPS _index._agents.edenbowls.com
200
No HTTPS answers (NXDOMAIN)
Corpo da resposta
DoH SVCB _a2a._agents.edenbowls.com
200
No SVCB answers (NXDOMAIN)
Corpo da resposta
DoH HTTPS _a2a._agents.edenbowls.com
200
No HTTPS answers (NXDOMAIN)
Corpo da resposta
DoH SVCB _mcp._agents.edenbowls.com
200
No SVCB answers (NXDOMAIN)
Corpo da resposta
DoH HTTPS _mcp._agents.edenbowls.com
200
No HTTPS answers (NXDOMAIN)
Corpo da resposta
DoH TXT _index._agents.edenbowls.com
200
No TXT answers (NXDOMAIN)
Corpo da resposta
Parse DNS for AI Discovery (DNS-AID) SVCB/HTTPS records
No DNS for AI Discovery (DNS-AID) SVCB or HTTPS records found at well-known entrypoints
Conclusion
DNS for AI Discovery (DNS-AID) well-known entrypoint records not found
Como resolver

Copiar
Publish DNS for AI Discovery (DNS-AID) records under your domain, for example _index._agents.example.com or _a2a._agents.example.com, using ServiceMode SVCB/HTTPS records with alpn and endpoint parameters. Sign the public discovery zone with DNSSEC so validating resolvers return authenticated data.
datatracker.ietf.org
rfc-editor.org
Habilidade
Acessibilidade do conteúdo
0/1 aprovado
Reprovado
Negociação de Markdown
Objetivo
Support Accept: text/markdown content negotiation for machine-readable content
Resultado
Site does not support Markdown for Agents
Como resolver

Copiar
Implement content negotiation so requests with Accept: text/markdown return a markdown representation while HTML remains the default for browsers.
developers.cloudflare.com
Habilidade
Controle de acesso de bots
0/2 aprovado
Neutro
Aut. para bots da web
Reprovado
Regras para crawlers de IA
Objetivo
Add User-agent rules for AI crawlers like GPTBot, Claude-Web, and others
Resultado
Cannot check AI rules without robots.txt
Evidência
GET /robots.txt
404
Server returned 404 -- robots.txt not found
Conclusion
Cannot check AI rules without robots.txt
Como resolver

Copiar
Add explicit User-agent entries for AI crawlers (GPTBot, OAI-SearchBot, Claude-Web, Google-Extended) with allow/disallow rules that match your policy.
rfc-editor.org
developers.cloudflare.com
Habilidade
Reprovado
Sinais de conteúdo
Objetivo
Declare AI content usage preferences with Content Signals in robots.txt
Resultado
Cannot check Content Signals without robots.txt
Evidência
GET /robots.txt
404
Server returned 404 -- robots.txt not found
Conclusion
Cannot check Content Signals without robots.txt
Como resolver

Copiar
Add Content-Signal directives to your robots.txt declaring preferences for ai-train, search, and ai-input. For example:
Content-Signal: ai-train=no, search=yes, ai-input=no
contentsignals.org
datatracker.ietf.org
Habilidade
Descoberta de protocolo
0/9 aprovado
Reprovado
Catálogo de APIs
Objetivo
Publish an API catalog for automated API discovery (RFC 9727)
Resultado
API Catalog not found
Evidência
GET /.well-known/api-catalog
404
Server returned 404 -- API Catalog not found
Conclusion
API Catalog not found
Como resolver

Copiar
Create /.well-known/api-catalog returning application/linkset+json with a "linkset" array. Each entry should include an "anchor" URL for the API and link relations for service-desc (OpenAPI spec), service-doc (documentation), and status (health endpoint). See RFC 9727 Appendix A for examples.
rfc-editor.org
rfc-editor.org
Habilidade
Reprovado
Descoberta OAuth/OIDC
Objetivo
Publish OAuth/OIDC discovery metadata so agents can authenticate with your APIs
Resultado
No OAuth/OIDC discovery metadata found
Evidência
GET /.well-known/openid-configuration
404
openid-configuration returned 404
GET /.well-known/oauth-authorization-server
404
oauth-authorization-server returned 404
Conclusion
No OAuth/OIDC discovery metadata found at either well-known path
Como resolver

Copiar
If your site has protected APIs, publish /.well-known/openid-configuration (for OpenID Connect) or /.well-known/oauth-authorization-server (for pure OAuth 2.0) with your issuer, authorization_endpoint, token_endpoint, jwks_uri, and grant_types_supported. This allows AI agents to programmatically discover how to authenticate.
openid.net
rfc-editor.org
Habilidade
Reprovado
Recurso protegido por OAuth
Objetivo
Publish OAuth Protected Resource Metadata so agents can discover how to authenticate
Resultado
No OAuth Protected Resource Metadata found
Evidência
GET /.well-known/oauth-protected-resource
404
Returned 404
GET /
200
Target resource returned 200 (no WWW-Authenticate header)
Conclusion
No OAuth Protected Resource Metadata found
Como resolver

Copiar
Publish /.well-known/oauth-protected-resource with your resource identifier, authorization_servers (list of OAuth/OIDC issuer URLs that can issue tokens for this resource), and scopes_supported. This tells agents how to obtain access tokens for your protected APIs. You can also return a WWW-Authenticate header with a resource_metadata parameter on 401 responses to enable dynamic discovery.
rfc-editor.org
Habilidade
Reprovado
Auth.md
Objetivo
Publish Auth.md metadata for agent registration
Resultado
auth.md not found
Evidência
GET /auth.md
404
Server returned 404 - auth.md not found
Conclusion
auth.md not found
Como resolver

Copiar
Serve /auth.md at the site root with agent registration instructions, publish /.well-known/oauth-protected-resource, and include an agent_auth block in /.well-known/oauth-authorization-server with register_uri, supported identity types, credential types, and claim/revocation URLs where applicable.
workos.com
github.com
Habilidade
Reprovado
Cartão de servidor MCP
Objetivo
Publish an MCP Server Card for agent discovery
Resultado
MCP Server Card not found
Evidência
GET /.well-known/mcp/server-card.json
404
/.well-known/mcp/server-card.json returned 404
GET /.well-known/mcp/server-cards.json
404
/.well-known/mcp/server-cards.json returned 404
GET /.well-known/mcp.json
404
/.well-known/mcp.json returned 404
Conclusion
MCP Server Card not found at any candidate path
Como resolver

Copiar
Serve an MCP Server Card (SEP-1649) at /.well-known/mcp/server-card.json with serverInfo (name, version), transport endpoint, and capabilities. The schema is being standardized at https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127
github.com
Habilidade
Reprovado
Cartão de agente A2A
Objetivo
Publish an A2A Agent Card for agent-to-agent discovery
Resultado
A2A Agent Card not found
Evidência
GET /.well-known/agent-card.json
404
Server returned 404 -- A2A Agent Card not found
Conclusion
A2A Agent Card not found
Como resolver

Copiar
Serve an A2A Agent Card (JSON) at /.well-known/agent-card.json describing your agent. Include name, version, description, supportedInterfaces (with service URL and transport protocol), capabilities, and skills (each with id, name, description). This enables other AI agents to discover and interact with your agent via the A2A protocol.
a2a-protocol.org
a2a-protocol.org
Habilidade
Reprovado
Habilidades do agente
Objetivo
Publish an agent skills discovery index
Resultado
Agent Skills index not found
Evidência
GET /.well-known/agent-skills/index.json
404
v0.2.0 path returned 404 — trying legacy path
GET /.well-known/skills/index.json
404
Server returned 404 — Agent Skills index not found
Conclusion
Agent Skills index not found
Como resolver

Copiar
Publish a skills discovery index at /.well-known/agent-skills/index.json (per the Agent Skills Discovery RFC v0.2.0). Include a $schema field, and a skills array where each entry has name, type ("skill-md" or "archive"), description, url, and a sha256 digest for integrity verification.
github.com
agentskills.io
Habilidade
Reprovado
WebMCP
Objetivo
Support WebMCP to expose site tools to AI agents via the browser
Resultado
No WebMCP tools detected on page load
Como resolver

Copiar
Implement the WebMCP API by calling navigator.modelContext.registerTool() for each tool that exposes your site's key actions to AI agents. Each tool needs a name, description, inputSchema (JSON Schema), and an execute callback function. Use an AbortController signal to unregister tools when no longer needed.
webmachinelearning.github.io
developer.chrome.com
Habilidade
Reprovado
ARD (Agentic Resource Discovery)
Objetivo
Publish an ARD (Agentic Resource Discovery) manifest so agents can discover your site's capabilities (MCP servers, A2A agents, OpenAPI schemas, and more)
Resultado
ARD capability manifest not found
Evidência
Extract <link rel="ai-catalog"> from page head
No catalog links found
GET /.well-known/ai-catalog.json
404
Server returned 404 -- ai-catalog.json not found
DoH TXT _catalog._agents.edenbowls.com
200
No TXT answers (NXDOMAIN)
Corpo da resposta
DoH SRV _search._agents.edenbowls.com
200
No SRV answers (NXDOMAIN)
Corpo da resposta
Conclusion
ARD capability manifest not found
Como resolver

Copiar
Serve /.well-known/ai-catalog.json at the origin root with Content-Type: application/json and Access-Control-Allow-Origin: *. Include specVersion, a host object, and an entries array. Give each entry a urn:air:<your-domain>:<namespace>:<name> identifier, a displayName, an IANA media type in "type", and exactly one of url or data. Add 2-5 representativeQueries per entry so registries can build semantic embeddings, and a trustManifest when you need verifiable publisher identity.
agenticresourcediscovery.org
github.com
github.com
Habilidade
Comércio
0/0 aprovado
Neutro
Protocolo x402
Neutro
Machine Payment Protocol (MPP)
Neutro
Universal Commerce Protocol (UCP)
Neutro
Agentic Commerce Protocol (ACP)
Neutro
Protocolo de pagamentos de agentes (AP2)
Alcançar o nível 1 — Basic Web Presence
Implemente o seguinte para avançar para o próximo nível.
robots.txt
Publish /robots.txt with clear crawl rules
rfc-editor.org
Mapa do site
Publish a sitemap and reference it from robots.txt
sitemaps.org
Cabeçalhos de links
Include Link response headers for agent discovery (RFC 8288)
rfc-editor.org
rfc-editor.org