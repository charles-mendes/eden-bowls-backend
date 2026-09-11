Como eu posso me passar que eu estou em boca raton para verificar erro de SSL Minha cliente esta reclamando de erro Mas no Brasil não da erro

Sim. E, no seu caso, testar como se estivesse em Boca Raton faz sentido, porque o problema pode estar relacionado ao caminho de rede, ISP, IPv6, CDN ou ao comportamento de algum dispositivo/cliente nos EUA — e não necessariamente ao certificado em si.

A melhor forma

1. Use uma VPN com saída nos EUA/Florida

Você pode usar uma VPN que tenha servidor na Flórida. Por exemplo, o Windscribe informa servidores em Miami, Orlando e Tampa.

Depois de conectar:

Conecte na VPN dos EUA.
Abra uma janela anônima do Chrome.
Acesse:
https://www.edenbowls.com.br
Teste também:
http://www.edenbowls.com.br
Veja exatamente qual erro aparece.

Importante: Miami/Tampa/Orlando não é exatamente Boca Raton. Para reproduzir o problema com maior fidelidade, o ideal é conseguir um IP realmente localizado em Boca Raton, de preferência residencial. Existem IPs identificados como Boca Raton que não são VPNs, por exemplo.

Mas eu faria um teste ainda melhor

O SSL Labs consegue analisar profundamente a configuração SSL/TLS do servidor público.

Faça o teste do domínio e veja principalmente:

TLS 1.2 / TLS 1.3
certificado e cadeia
SNI
IPv4 vs IPv6
compatibilidade com clientes antigos
protocolos/ciphers
handshake
redirecionamento HTTP → HTTPS
E tem um detalhe importante no seu caso

Como você comentou anteriormente sobre o Caddy retornando 308, eu investigaria não apenas o certificado, mas também:

Brasil

Cliente → ISP brasileiro → CDN/servidor → 308 → HTTPS

versus

EUA

Cliente → ISP americano → CDN/servidor → 308 → HTTPS

Pode existir diferença de comportamento dependendo do ISP, WebView, navegador, IPv6 ou algum intermediário.

Se você quiser, me passe o domínio que está dando problema e, se possível, um print do erro que sua cliente recebe. Aí consigo te dizer exatamente quais testes fazer para reproduzir o erro dos EUA, inclusive separando DNS/IPv4/IPv6/TLS/308/301.

Qual será que é Bocu Raton É US central , US East, US West, ?

Boca Raton fica na Flórida, na costa leste dos EUA, então entre essas opções:

🇺🇸 US East → é a correta
US Central → não
US West → não

Se a VPN/serviço oferecer regiões mais específicas, procure por Florida, Miami, Fort Lauderdale ou Orlando. Miami/Fort Lauderdale é especialmente próximo de Boca Raton.

Para testar seu SSL, eu escolheria US East primeiro.

Miami Snow, Miami vice, New York Empire, New Your Inside Job Eu to pegando o windscribe e queria um lugar mais pergto de Boca Raton mas estou com a versão gratis

Para o seu objetivo, entre esses servidores gratuitos do Windscribe, eu escolheria:

1. Miami Snow — melhor opção
2. Miami Vice — segunda opção
3. New York Empire
4. New York Inside Job

Boca Raton fica no sul da Flórida, então Miami é de longe a opção mais próxima das que você tem disponíveis.

Para testar o problema da sua cliente, conecte no Miami Snow e faça:

http://www.edenbowls.com.br
https://www.edenbowls.com.br

E teste também em Chrome normal e janela anônima.

Se o erro aparecer conectado ao Miami Snow, já temos uma pista muito boa de que o problema pode estar relacionado ao tráfego dos EUA.

Se quiser, também posso te passar 
um teste pelo terminal para verificar IPv4, IPv6, TLS e o redirect 308/301 enquanto você estiver conectado no Miami, que seria bem mais conclusivo.

Da uma olhada o que a minha ia retornou, após a analise

Testei agora os quatro nomes: edenbowls.com, www.edenbowls.com, edenbowls.com.br e www.edenbowls.com.br. O resultado é o mesmo nos dois TLDs. Do lado do servidor, TLS está saudável.

Resumo
ItemResultado	
TLS 1.3	Ok
TLS 1.2	Ok
TLS 1.1 / 1.0	Recusado (correto)
Certificado	RSA 2048, Let's Encrypt, válido até 30/11/2026
Cadeia	Completa, Verify return code: 0 (ok)
SNI	Obrigatório; sem SNI o handshake cai
IPv4	72.62.100.188 nos quatro nomes
IPv6	Sem registro AAAA
HTTP → HTTPS	301 para o mesmo host em HTTPS
HTTP/2 e HTTP/1.1	Os dois respondem 200
TLS e handshake

Handshake fecha em TLS 1.3 com TLS_AES_128_GCM_SHA256. Forçando TLS 1.2, fecha com ECDHE-RSA-AES128-GCM-SHA256. Nos dois casos a verificação da cadeia passa.

Ciphers TLS 1.2 aceitos:

ECDHE-RSA-AES128-GCM-SHA256
ECDHE-RSA-AES256-GCM-SHA384
ECDHE-RSA-CHACHA20-POLY1305

Recusados (também correto): CBC, SHA-1, RSA sem ECDHE, 3DES, RC4.

Certificado e cadeia

Cada host tem o próprio certificado RSA 2048, emitido em 01/09/2026:

Folha → Let's Encrypt YR1 ou YR2 (RSA)
Intermediária → ISRG Root YR (RSA 4096)
Root YR é cross-assinada pela ISRG Root X1 (a raiz antiga, presente na maioria dos sistemas desde ~2016)

O SAN de cada certificado cobre só aquele nome. edenbowls.com não inclui www, e vice-versa. Isso é normal: o Caddy emite um cert por hostname e o navegador manda SNI.

SNI

Com SNI certo, o certificado certo é servido.

Sem SNI, ou com SNI de outro site (google.com), o servidor responde TLS alert 80 e o handshake morre. Cliente antigo que não envia SNI não abre. Chrome, Edge, Firefox, Safari e celulares atuais sempre enviam.

IPv4 vs IPv6

Só IPv4. Não há AAAA. Isso é bom neste caso: não existe caminho IPv6 quebrado para o cliente cair e falhar.

HTTP → HTTPS

http://edenbowls.com/ e http://edenbowls.com.br/ (e /qa-app/) devolvem 301 Moved Permanently para o HTTPS do mesmo host. HTTPS devolve HTTP/2 200, HSTS de 1 ano com includeSubDomains; preload, e alt-svc: clear (HTTP/3 desligado).

Compatibilidade com cliente antigo

Funciona em: Chrome/Edge/Firefox/Safari atuais, Android 5+, iOS 9+, Windows 7/10/11 com atualização.

Não funciona em: Windows XP, Android 4, Java 6/7, qualquer cliente só TLS 1.0, ou cliente que não manda SNI.

Isso é o esperado de um Caddy moderno. A troca ECDSA → RSA já cobriu o caso mais comum de appliance antigo. O que ainda pode falhar é inspeção de TLS no Wi-Fi (o caso da Ana: fora do Wi-Fi funciona).

Conclusão: nos dois domínios, certificado, cadeia, TLS 1.2/1.3, cipher, redirect e IPv4 estão corretos. Não há falha de servidor para explicar o erro no Wi-Fi dos EUA.

A análise da sua IA está bem consistente, mas eu faria uma ressalva importante: ela demonstra que o servidor está saudável do ponto de vista de TLS, mas não prova que não exista um problema específico no caminho de rede dos EUA.

O ponto que mais me chama atenção é este:

“o que ainda pode falhar é inspeção de TLS no Wi-Fi (o caso da Ana: fora do Wi-Fi funciona)”

Isso muda bastante a investigação.

O que eu concluiria
Teste	Resultado	Interpretação
TLS 1.2	OK	Servidor compatível
TLS 1.3	OK	Servidor compatível
Certificado	OK	Não parece ser certificado inválido
Cadeia	OK	Não parece ser cadeia incompleta
IPv6	Não existe	Elimina uma classe comum de problemas
HTTP → HTTPS	301	Está correto
HTTPS	200	Servidor responde normalmente
SNI	OK em clientes modernos	Normal
Caddy	OK	Nada obviamente errado
Wi-Fi específico nos EUA	Ainda não explicado	Aqui está a investigação
Eu faria agora um teste decisivo

Como você já está usando Windscribe Miami, faça 4 combinações:

A. Windscribe Miami + Wi-Fi

Wi-Fi
  ↓
Windscribe Miami
  ↓
edenbowls.com

B. Windscribe Miami + internet do celular

4G/5G
  ↓
Windscribe Miami
  ↓
edenbowls.com

E depois, se possível:

C. Sem VPN + Wi-Fi

D. Sem VPN + 4G/5G

O resultado vai ajudar muito:

Se A falha e B funciona → problema provavelmente no Wi-Fi/rede local.
Se A e B funcionam, mas a cliente nos EUA falha → pode ser ISP/rede específica dela.
Se A e B falham → investigar rota/serviço nos EUA, embora o servidor esteja respondendo.
Se C falha e D funciona → praticamente aponta para o Wi-Fi/ISP.
Se tudo funciona para você → precisamos reproduzir o ambiente da cliente.
E tem uma coisa MUITO importante

Sua IA diz:

HTTP → HTTPS = 301

Isso é diferente daquele cenário que você havia comentado anteriormente de 308.

Se você realmente alterou o Caddy de 308 para 301, isso parece ter sido uma boa mudança para o teste, mas precisamos descobrir se esse era realmente o problema ou apenas uma hipótese.

Eu não mexeria mais no SSL/certificado agora. A evidência que você trouxe aponta que o TLS está funcionando.

Eu investigaria nesta ordem:

1. Wi-Fi da cliente
↓
2. ISP americano
↓
3. DNS
↓
4. Proxy/SSL inspection
↓
5. comportamento do navegador/WebView
↓
6. só depois servidor/Caddy

Se você me mandar o print exato do erro que a Ana recebe no Wi-Fi dos EUA, consigo analisar o erro e dizer qual dessas hipóteses é mais provável.

Como que eu faço isso ? Wi-Fi ↓ Windscribe Miami ↓ edenbowls.com

É bem simples. Você não precisa estar fisicamente em Boca Raton. A ideia é fazer seu computador usar o Wi-Fi normal, mas sair para a internet pelo servidor do Windscribe em Miami.

No Windows
Instale/abra o Windscribe.
No Windscribe, procure a localização Miami.
Entre em Miami Snow.
Conecte a VPN.
Confirme que aparece algo como Connected.

A conexão ficará aproximadamente:

Seu PC
   ↓
Seu Wi-Fi
   ↓
Windscribe VPN
   ↓
Servidor Windscribe — Miami, EUA
   ↓
edenbowls.com

Ou seja, para o site, sua conexão parecerá estar vindo de Miami, não do Brasil.

Como confirmar que funcionou

Antes de testar o Eden Bowls, abra:

What Is My IP Address

Veja se o país aparece como United States e, idealmente, a localização como Miami/Florida.

Depois abra:

https://www.edenbowls.com
https://www.edenbowls.com.br

E também:

http://www.edenbowls.com
http://www.edenbowls.com.br
Para investigar o SSL de verdade

Com o Miami Snow conectado, abra o PowerShell e rode:

curl.exe -I http://www.edenbowls.com

Depois:

curl.exe -I https://www.edenbowls.com

E:

curl.exe -I https://www.edenbowls.com.br

Isso vai mostrar se o acesso está chegando no servidor e qual é o 301/HTTPS.

Se você quiser, eu posso te passar 
um conjunto de 5 comandos PowerShell, na ordem exata, para você executar conectado ao Miami Snow e me mandar os resultados. Com eles conseguimos investigar DNS + IP + certificado + TLS + redirect e comparar com o que acontece no Brasil.

Me passe um conjunto de 5 comandos PowerShell para executar conectado ao Miami Snow e enviar os resultados

laro. Conecte primeiro no Windscribe → Miami Snow e depois abra o PowerShell.

Execute um por vez, na ordem abaixo, e me envie a saída completa de cada um.

1. Confirmar que você está saindo pelos EUA
curl.exe https://ipinfo.io/json

Quero verificar principalmente city, region, country e org.

2. Verificar DNS do domínio
Resolve-DnsName edenbowls.com

Depois:

Resolve-DnsName www.edenbowls.com

Aqui queremos confirmar para qual IP o domínio está resolvendo.

3. Testar o HTTP → HTTPS
curl.exe -I http://www.edenbowls.com

Queremos ver algo parecido com:

HTTP/1.1 301 Moved Permanently
Location: https://www.edenbowls.com/...
4. Testar HTTPS + certificado/handshake
curl.exe -Iv https://www.edenbowls.com

Esse é um dos mais importantes. Vai mostrar:

conexão TCP
TLS
certificado
SNI
TLS 1.2/1.3
HTTP/2
resposta do servidor
5. Testar diretamente o IP que sua IA encontrou

Como ela encontrou 72.62.100.188, execute:

curl.exe -Iv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com

Esse teste é particularmente interessante porque força:

www.edenbowls.com
        ↓
72.62.100.188

mas mantém o hostname/SNI correto.

Me mande os 5 resultados

Pode simplesmente copiar e colar tudo aqui, inclusive mensagens como:

* Connected
* TLSv1.3
* SSL certificate verify ok
* Request completely sent off

Não precisa esconder o IP público; ele não é uma senha nem uma credencial.

Com esses cinco testes, consigo comparar o comportamento a partir do Miami e verificar se temos evidência de problema em DNS, rota, TCP, TLS, certificado ou redirect.

PS C:\WINDOWS\System32> curl.exe -I http://www.edenbowls.com HTTP/1.1 301 Moved Permanently Date: Thu, 03 Sep 2026 23:04:35 GMT Location: https://www.edenbowls.com/ Server: Caddy PS C:\WINDOWS\System32> curl.exe -I http://www.edenbowls.com HTTP/1.1 301 Moved Permanently Date: Thu, 03 Sep 2026 23:04:45 GMT Location: https://www.edenbowls.com/ Server: Caddy PS C:\WINDOWS\System32> curl.exe -I https://www.edenbowls.com.br HTTP/1.1 200 OK Accept-Ranges: bytes Alt-Svc: clear Content-Length: 13502 Content-Security-Policy: upgrade-insecure-requests Content-Type: text/html; charset=utf-8 Etag: "dl4arehfzp50af2" Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT Referrer-Policy: strict-origin-when-cross-origin Server: Caddy Strict-Transport-Security: max-age=31536000; includeSubDomains; preload Vary: Accept-Encoding X-Content-Type-Options: nosniff X-Frame-Options: SAMEORIGIN Date: Thu, 03 Sep 2026 23:04:55 GMT PS C:\WINDOWS\System32> curl.exe https://ipinfo.io/json { "ip": "23.108.49.24", "city": "Miami", "region": "Florida", "country": "US", "loc": "25.7743,-80.1937", "org": "AS393886 Leaseweb USA, Inc.", "postal": "33101", "timezone": "America/New_York", "readme": "https://ipinfo.io/missingauth" } PS C:\WINDOWS\System32> Resolve-DnsName edenbowls.com Name Type TTL Section IPAddress ---- ---- --- ------- --------- edenbowls.com A 42 Answer 72.62.100.188 PS C:\WINDOWS\System32> Resolve-DnsName www.edenbowls.com Name Type TTL Section NameHost ---- ---- --- ------- -------- www.edenbowls.com CNAME 167 Answer edenbowls.com Name : edenbowls.com QueryType : A TTL : 34 Section : Answer IP4Address : 72.62.100.188 Name : edenbowls.com QueryType : SOA TTL : 335 Section : Authority NameAdministrator : dns.hostinger.com SerialNumber : 2026090301 TimeToZoneRefresh : 10000 TimeToZoneFailureRetry : 2400 TimeToExpiration : 604800 DefaultTTL : 600 PS C:\WINDOWS\System32> curl.exe -I http://www.edenbowls.com HTTP/1.1 301 Moved Permanently Date: Thu, 03 Sep 2026 23:06:45 GMT Location: https://www.edenbowls.com/ Server: Caddy PS C:\WINDOWS\System32> curl.exe -Iv https://www.edenbowls.com * Host www.edenbowls.com:443 was resolved. * IPv6: (none) * IPv4: 72.62.100.188 * Trying 72.62.100.188:443... * schannel: disabled automatic use of client certificate * ALPN: curl offers http/1.1 * ALPN: server accepted http/1.1 * Established connection to www.edenbowls.com (72.62.100.188 port 443) from 100.73.3.33 port 49191 * using HTTP/1.x > HEAD / HTTP/1.1 > Host: www.edenbowls.com > User-Agent: curl/8.21.0 > Accept: */* > * Request completely sent off * schannel: remote party requests renegotiation * schannel: renegotiating SSL/TLS connection * schannel: SSL/TLS connection renegotiated < HTTP/1.1 200 OK HTTP/1.1 200 OK < Accept-Ranges: bytes Accept-Ranges: bytes < Alt-Svc: clear Alt-Svc: clear < Content-Length: 13466 Content-Length: 13466 < Content-Security-Policy: upgrade-insecure-requests Content-Security-Policy: upgrade-insecure-requests < Content-Type: text/html; charset=utf-8 Content-Type: text/html; charset=utf-8 < Etag: "dl4arehfzp50ae2" Etag: "dl4arehfzp50ae2" < Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT < Referrer-Policy: strict-origin-when-cross-origin Referrer-Policy: strict-origin-when-cross-origin < Server: Caddy Server: Caddy < Strict-Transport-Security: max-age=31536000; includeSubDomains; preload Strict-Transport-Security: max-age=31536000; includeSubDomains; preload < Vary: Accept-Encoding Vary: Accept-Encoding < X-Content-Type-Options: nosniff X-Content-Type-Options: nosniff < X-Frame-Options: SAMEORIGIN X-Frame-Options: SAMEORIGIN < Date: Thu, 03 Sep 2026 23:07:03 GMT Date: Thu, 03 Sep 2026 23:07:03 GMT < * Connection #0 to host www.edenbowls.com:443 left intact PS C:\WINDOWS\System32> curl.exe -Iv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com * Added www.edenbowls.com:443:72.62.100.188 to DNS cache * Hostname www.edenbowls.com was found in DNS cache * Host www.edenbowls.com:443 was resolved. * IPv6: (none) * IPv4: 72.62.100.188 * Trying 72.62.100.188:443... * schannel: disabled automatic use of client certificate * ALPN: curl offers http/1.1 * ALPN: server accepted http/1.1 * Established connection to www.edenbowls.com (72.62.100.188 port 443) from 100.73.3.33 port 54751 * using HTTP/1.x > HEAD / HTTP/1.1 > Host: www.edenbowls.com > User-Agent: curl/8.21.0 > Accept: */* > * Request completely sent off * schannel: remote party requests renegotiation * schannel: renegotiating SSL/TLS connection * schannel: SSL/TLS connection renegotiated < HTTP/1.1 200 OK HTTP/1.1 200 OK < Accept-Ranges: bytes Accept-Ranges: bytes < Alt-Svc: clear Alt-Svc: clear < Content-Length: 13466 Content-Length: 13466 < Content-Security-Policy: upgrade-insecure-requests Content-Security-Policy: upgrade-insecure-requests < Content-Type: text/html; charset=utf-8 Content-Type: text/html; charset=utf-8 < Etag: "dl4arehfzp50ae2" Etag: "dl4arehfzp50ae2" < Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT < Referrer-Policy: strict-origin-when-cross-origin Referrer-Policy: strict-origin-when-cross-origin < Server: Caddy Server: Caddy < Strict-Transport-Security: max-age=31536000; includeSubDomains; preload Strict-Transport-Security: max-age=31536000; includeSubDomains; preload < Vary: Accept-Encoding Vary: Accept-Encoding < X-Content-Type-Options: nosniff X-Content-Type-Options: nosniff < X-Frame-Options: SAMEORIGIN X-Frame-Options: SAMEORIGIN < Date: Thu, 03 Sep 2026 23:07:36 GMT Date: Thu, 03 Sep 2026 23:07:36 GMT < * Connection #0 to host www.edenbowls.com:443 left intact PS C:\WINDOWS\System32>

Excelente. Esse teste ficou muito bom e já elimina várias hipóteses.

O que os seus resultados mostram

Você realmente está saindo pelo Miami:

IP público: 23.108.49.24
Cidade: Miami
Estado: Florida
País: US

Então o teste é válido para simular uma conexão americana.

E o mais importante:

Miami → DNS → 72.62.100.188 → TLS → Caddy → 200 OK

Tudo funcionou.

1. HTTP → HTTPS

Você recebeu:

HTTP/1.1 301 Moved Permanently
Location: https://www.edenbowls.com/
Server: Caddy

Perfeito. O redirect está funcionando.

2. HTTPS

Você recebeu:

* IPv6: (none)
* IPv4: 72.62.100.188
* Trying 72.62.100.188:443...
* Established connection
...
< HTTP/1.1 200 OK

Isso é muito importante.

Significa que, a partir de Miami, você conseguiu:

resolver o DNS;
conectar no IP;
estabelecer TCP;
negociar TLS;
completar renegociação TLS;
enviar HTTP;
receber 200 OK.
3. Certificado/TLS

Não apareceu nenhum erro de certificado.

Inclusive:

* schannel: remote party requests renegotiation
* schannel: renegotiating SSL/TLS connection
* schannel: SSL/TLS connection renegotiated

E depois:

HTTP/1.1 200 OK

Então não temos evidência de que o certificado esteja quebrado para clientes Windows modernos nos EUA.

4. O --resolve também funcionou

Esse teste:

curl.exe -Iv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com

também retornou 200 OK.

Isso é bom porque você confirmou diretamente:

www.edenbowls.com
       ↓
72.62.100.188
       ↓
TLS/SNI
       ↓
Caddy
       ↓
200 OK
Mas descobrimos uma coisa importante

Eu não encerraria a investigação ainda.

O seu teste mostra que:

Miami + Windscribe + Windows + curl consegue acessar o site normalmente.

Mas isso não significa que a rede da sua cliente em Boca Raton esteja funcionando.

A diferença pode ser:

VOCÊ
Brasil
 ↓
Wi-Fi
 ↓
Windscribe
 ↓
Miami
 ↓
Eden Bowls
 ✅

CLIENTE
Boca Raton
 ↓
Wi-Fi dela
 ↓
ISP dela
 ↓
??? 
 ↓
Eden Bowls
 ❌

E existe uma pista especialmente interessante:

* schannel: remote party requests renegotiation

Isso não é necessariamente um problema — a conexão terminou em 200 OK — mas eu gostaria de investigar se algum equipamento/rede está fazendo TLS inspection/proxy/interceptação.

Próximo teste que eu faria

Agora precisamos comparar Wi-Fi vs internet móvel, mas sem precisar da cliente.

No seu computador, faça:

Teste A — Miami Snow

Você já fez:

Wi-Fi brasileiro
      ↓
Windscribe Miami
      ↓
Eden Bowls
      ↓
200 OK
Teste B — desligue o Windscribe

Desconecte o Windscribe e rode:

curl.exe -Iv https://www.edenbowls.com

Me mande o resultado.

Teste C — testar DNS público

Sem Windscribe:

Resolve-DnsName www.edenbowls.com -Server 8.8.8.8

E:

Resolve-DnsName www.edenbowls.com -Server 1.1.1.1

Isso vai nos dizer se existe alguma diferença de resolução DNS.

E eu faria mais um teste muito importante

Rode:

curl.exe -Iv --tlsv1.2 https://www.edenbowls.com

Depois:

curl.exe -Iv --tlsv1.3 https://www.edenbowls.com

Assim conseguimos confirmar especificamente:

Miami → TLS 1.2 → ?
Miami → TLS 1.3 → ?
Minha avaliação neste momento

Servidor/Caddy: 🟢 aparentemente OK
Certificado: 🟢 aparentemente OK
TLS 1.2/1.3: 🟢 OK
DNS: 🟢 OK
IPv4: 🟢 OK
HTTP → HTTPS 301: 🟢 OK
Acesso a partir de Miami: 🟢 OK
Problema da cliente: 🔴 ainda não explicado

Portanto, eu não alteraria mais o certificado nem o Caddy neste momento. A próxima coisa que precisamos descobrir é o que existe de diferente na rede da cliente em Boca Raton.

Respondendo com resultado de comandos solicitados: Windows PowerShell Copyright (C) Microsoft Corporation. All rights reserved. PS C:\WINDOWS\System32> curl.exe -Iv https://www.edenbowls.com * Host www.edenbowls.com:443 was resolved. * IPv6: (none) * IPv4: 72.62.100.188 * Trying 72.62.100.188:443... * schannel: disabled automatic use of client certificate * ALPN: curl offers http/1.1 * ALPN: server accepted http/1.1 * Established connection to www.edenbowls.com (72.62.100.188 port 443) from 192.168.15.90 port 51745 * using HTTP/1.x > HEAD / HTTP/1.1 > Host: www.edenbowls.com > User-Agent: curl/8.21.0 > Accept: */* > * Request completely sent off * schannel: remote party requests renegotiation * schannel: renegotiating SSL/TLS connection * schannel: SSL/TLS connection renegotiated < HTTP/1.1 200 OK HTTP/1.1 200 OK < Accept-Ranges: bytes Accept-Ranges: bytes < Alt-Svc: clear Alt-Svc: clear < Content-Length: 13466 Content-Length: 13466 < Content-Security-Policy: upgrade-insecure-requests Content-Security-Policy: upgrade-insecure-requests < Content-Type: text/html; charset=utf-8 Content-Type: text/html; charset=utf-8 < Etag: "dl4arehfzp50ae2" Etag: "dl4arehfzp50ae2" < Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT < Referrer-Policy: strict-origin-when-cross-origin Referrer-Policy: strict-origin-when-cross-origin < Server: Caddy Server: Caddy < Strict-Transport-Security: max-age=31536000; includeSubDomains; preload Strict-Transport-Security: max-age=31536000; includeSubDomains; preload < Vary: Accept-Encoding Vary: Accept-Encoding < X-Content-Type-Options: nosniff X-Content-Type-Options: nosniff < X-Frame-Options: SAMEORIGIN X-Frame-Options: SAMEORIGIN < Date: Thu, 03 Sep 2026 23:11:08 GMT Date: Thu, 03 Sep 2026 23:11:08 GMT < * Connection #0 to host www.edenbowls.com:443 left intact PS C:\WINDOWS\System32> Resolve-DnsName www.edenbowls.com -Server 8.8.8.8 Name Type TTL Section NameHost ---- ---- --- ------- -------- www.edenbowls.com CNAME 300 Answer edenbowls.com Name : edenbowls.com QueryType : A TTL : 300 Section : Answer IP4Address : 72.62.100.188 Name : edenbowls.com QueryType : SOA TTL : 600 Section : Authority NameAdministrator : dns.hostinger.com SerialNumber : 2026090301 TimeToZoneRefresh : 10000 TimeToZoneFailureRetry : 2400 TimeToExpiration : 604800 DefaultTTL : 600 PS C:\WINDOWS\System32> Resolve-DnsName www.edenbowls.com -Server 1.1.1.1 Name Type TTL Section NameHost ---- ---- --- ------- -------- www.edenbowls.com CNAME 300 Answer edenbowls.com Name : edenbowls.com QueryType : A TTL : 300 Section : Answer IP4Address : 72.62.100.188 Name : edenbowls.com QueryType : SOA TTL : 600 Section : Authority NameAdministrator : dns.hostinger.com SerialNumber : 2026090301 TimeToZoneRefresh : 10000 TimeToZoneFailureRetry : 2400 TimeToExpiration : 604800 DefaultTTL : 600 PS C:\WINDOWS\System32> curl.exe -Iv --tlsv1.2 https://www.edenbowls.com * Host www.edenbowls.com:443 was resolved. * IPv6: (none) * IPv4: 72.62.100.188 * Trying 72.62.100.188:443... * schannel: disabled automatic use of client certificate * ALPN: curl offers http/1.1 * ALPN: server accepted http/1.1 * Established connection to www.edenbowls.com (72.62.100.188 port 443) from 192.168.15.90 port 54415 * using HTTP/1.x > HEAD / HTTP/1.1 > Host: www.edenbowls.com > User-Agent: curl/8.21.0 > Accept: */* > * Request completely sent off * schannel: remote party requests renegotiation * schannel: renegotiating SSL/TLS connection * schannel: SSL/TLS connection renegotiated < HTTP/1.1 200 OK HTTP/1.1 200 OK < Accept-Ranges: bytes Accept-Ranges: bytes < Alt-Svc: clear Alt-Svc: clear < Content-Length: 13466 Content-Length: 13466 < Content-Security-Policy: upgrade-insecure-requests Content-Security-Policy: upgrade-insecure-requests < Content-Type: text/html; charset=utf-8 Content-Type: text/html; charset=utf-8 < Etag: "dl4arehfzp50ae2" Etag: "dl4arehfzp50ae2" < Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT < Referrer-Policy: strict-origin-when-cross-origin Referrer-Policy: strict-origin-when-cross-origin < Server: Caddy Server: Caddy < Strict-Transport-Security: max-age=31536000; includeSubDomains; preload Strict-Transport-Security: max-age=31536000; includeSubDomains; preload < Vary: Accept-Encoding Vary: Accept-Encoding < X-Content-Type-Options: nosniff X-Content-Type-Options: nosniff < X-Frame-Options: SAMEORIGIN X-Frame-Options: SAMEORIGIN < Date: Thu, 03 Sep 2026 23:11:49 GMT Date: Thu, 03 Sep 2026 23:11:49 GMT < * Connection #0 to host www.edenbowls.com:443 left intact PS C:\WINDOWS\System32> curl.exe -Iv --tlsv1.3 https://www.edenbowls.com * Trying 72.62.100.188:443... * schannel: disabled automatic use of client certificate * ALPN: curl offers http/1.1 * ALPN: server accepted http/1.1 * Established connection to www.edenbowls.com (72.62.100.188 port 443) from 192.168.15.90 port 62435 * using HTTP/1.x > HEAD / HTTP/1.1 > Host: www.edenbowls.com > User-Agent: curl/8.21.0 > Accept: */* > * Request completely sent off * schannel: remote party requests renegotiation * schannel: renegotiating SSL/TLS connection * schannel: SSL/TLS connection renegotiated < HTTP/1.1 200 OK HTTP/1.1 200 OK < Accept-Ranges: bytes Accept-Ranges: bytes < Alt-Svc: clear Alt-Svc: clear < Content-Length: 13466 Content-Length: 13466 < Content-Security-Policy: upgrade-insecure-requests Content-Security-Policy: upgrade-insecure-requests < Content-Type: text/html; charset=utf-8 Content-Type: text/html; charset=utf-8 < Etag: "dl4arehfzp50ae2" Etag: "dl4arehfzp50ae2" < Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT Last-Modified: Tue, 01 Sep 2026 21:27:55 GMT < Referrer-Policy: strict-origin-when-cross-origin Referrer-Policy: strict-origin-when-cross-origin < Server: Caddy Server: Caddy < Strict-Transport-Security: max-age=31536000; includeSubDomains; preload Strict-Transport-Security: max-age=31536000; includeSubDomains; preload < Vary: Accept-Encoding Vary: Accept-Encoding < X-Content-Type-Options: nosniff X-Content-Type-Options: nosniff < X-Frame-Options: SAMEORIGIN X-Frame-Options: SAMEORIGIN < Date: Thu, 03 Sep 2026 23:11:56 GMT Date: Thu, 03 Sep 2026 23:11:56 GMT < * Connection #0 to host www.edenbowls.com:443 left intact PS C:\WINDOWS\System32>

Agora ficou ainda mais interessante, porque você fez os testes sem o Windscribe, diretamente pela sua rede brasileira.

Resultado

O acesso continua funcionando perfeitamente:

DNS
www.edenbowls.com
       ↓
72.62.100.188
       ↓
TCP 443
       ↓
TLS 1.2 / TLS 1.3
       ↓
Caddy
       ↓
HTTP 200 OK

E o DNS também está consistente:

Google DNS (8.8.8.8) → 72.62.100.188
Cloudflare (1.1.1.1) → 72.62.100.188

Então DNS não parece ser o problema.

E o teste mais importante

Você testou:

--tlsv1.2 → 200 OK
--tlsv1.3 → 200 OK

Portanto:

TLS 1.2 funciona.
TLS 1.3 funciona.

E nos dois casos o handshake chega até:

HTTP/1.1 200 OK
Mas encontrei uma coisa que merece atenção

Nos dois ambientes apareceu:

* schannel: remote party requests renegotiation
* schannel: renegotiating SSL/TLS connection
* schannel: SSL/TLS connection renegotiated

Isso aconteceu:

com Windscribe Miami;
sem Windscribe;
TLS 1.2;
TLS 1.3.

Então isso parece ser um comportamento do servidor/Caddy, e não algo específico da rede americana.

E como depois disso você recebe 200 OK, a renegociação não está impedindo o acesso pelo curl.

Minha conclusão agora

Eu colocaria as hipóteses assim:

Hipótese	Probabilidade agora
Certificado inválido	🔴 Muito baixa
TLS 1.2 incompatível	🔴 Muito baixa
TLS 1.3 incompatível	🔴 Muito baixa
DNS	🔴 Muito baixa
IPv6 quebrado	🔴 Muito baixa
Redirect 301	🟢 Funcionando
Caddy indisponível	🔴 Muito baixa
Problema específico do Wi-Fi/ISP da cliente	🟠 Alta
Proxy/SSL inspection na rede da cliente	🟠 Possível
Problema específico do navegador/WebView da cliente	🟠 Possível
O que falta para matar a dúvida

Precisamos reproduzir o ambiente da cliente, não apenas "uma conexão dos EUA".

O Windscribe Miami prova:

"Uma máquina nos EUA consegue acessar."

Mas não prova:

"A rede da cliente em Boca Raton consegue acessar."

São coisas diferentes.

Eu faria agora um teste bem específico

Se a sua cliente puder executar 3 comandos no computador dela, isso seria muito mais valioso que qualquer teste adicional seu.

Peça para ela abrir o PowerShell e executar:

Resolve-DnsName www.edenbowls.com

Depois:

Test-NetConnection www.edenbowls.com -Port 443

E:

curl.exe -Iv https://www.edenbowls.com

O terceiro é o principal.

Se ela tiver o erro no navegador, mande também um print do erro. A mensagem exata (por exemplo ERR_SSL_PROTOCOL_ERROR, ERR_CERT..., NET::ERR...) pode mudar completamente o diagnóstico.

Se você conseguir o print do erro da cliente, pode mandar aqui que eu cruzo com esses resultados e te digo o que eu investigaria no Caddy/servidor.

Opa estava conversando com minha cliente e ela tem Mac, poderia converter os comandos acima para serem rodados no mac

Sim. No Mac, ela pode usar o Terminal. Os comandos são praticamente os mesmos, mas eu usaria esta sequência mais simples para diagnosticar o problema:

1. Verificar o DNS
dig www.edenbowls.com

Ou, para consultar especificamente o Google:

dig @8.8.8.8 www.edenbowls.com

E Cloudflare:

dig @1.1.1.1 www.edenbowls.com

O esperado é aparecer:

72.62.100.188
2. Testar se a porta HTTPS está acessível
nc -vz www.edenbowls.com 443

O esperado é algo como:

Connection to www.edenbowls.com port 443 [tcp/https] succeeded!
3. Testar o HTTPS — este é o mais importante
curl -Iv https://www.edenbowls.com

Se funcionar, no final deve aparecer algo semelhante a:

HTTP/2 200

ou:

HTTP/1.1 200 OK
4. Testar especificamente TLS 1.2
curl -Iv --tlsv1.2 https://www.edenbowls.com
5. Testar especificamente TLS 1.3
curl -Iv --tlsv1.3 https://www.edenbowls.com
O que eu pediria para ela fazer

Para não complicar para a cliente, eu mandaria primeiro somente estes 3 comandos:

dig www.edenbowls.com
nc -vz www.edenbowls.com 443
curl -Iv https://www.edenbowls.com

E pediria para ela copiar e me enviar o resultado completo dos três.

O terceiro é especialmente importante porque consegue mostrar se a conexão TLS está falhando antes mesmo de chegar ao HTTP.

Se ela estiver usando o Wi-Fi onde o problema acontece, melhor ainda: faça os testes conectada nesse Wi-Fi. Isso nos ajuda a verificar se o problema está relacionado ao ISP/roteador/rede dela, em vez do servidor.

Last login: Sat Aug 29 00:25:35 on console diogobonatto@Mac ~ % dig www.edenbowls.com ; <<>> DiG 9.10.6 <<>> www.edenbowls.com ;; global options: +cmd ;; Got answer: ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 33191 ;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1 ;; OPT PSEUDOSECTION: ; EDNS: version: 0, flags:; udp: 1232 ;; QUESTION SECTION: ;www.edenbowls.com. IN A ;; ANSWER SECTION: www.edenbowls.com. 300 IN CNAME edenbowls.com. edenbowls.com. 10 IN A 18.204.152.241 ;; Query time: 128 msec ;; SERVER: 192.168.40.1#53(192.168.40.1) ;; WHEN: Thu Sep 03 20:01:42 EDT 2026 ;; MSG SIZE rcvd: 76 diogobonatto@Mac ~ % ; <<>> DiG 9.10.6 <<>> www.edenbowls.com ;; global options: +cmd ;; Got answer: ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 33191 ;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1 ;; OPT PSEUDOSECTION: ; EDNS: version: 0, flags:; udp: 1232 ;; QUESTION SECTION: ;www.edenbowls.com. IN A ;; ANSWER SECTION: www.edenbowls.com. 300 IN CNAME edenbowls.com. edenbowls.com. 10 IN A 18.204.152.241 ;; Query time: 128 msec ;; SERVER: 192.168.40.1#53(192.168.40.1) ;; WHEN: Thu Sep 03 20:01:42 EDT 2026 ;; MSG SIZE rcvd: 76 diogobonatto@Mac ~ % nc -vz www.edenbowls.com 443 Connection to www.edenbowls.com port 443 [tcp/https] succeeded! diogobonatto@Mac ~ % ;; QUESTION SECTION: ;www.edenbowls.com. IN A ;; ANSWER SECTION: www.edenbowls.com. 300 IN CNAME edenbowls.com. edenbowls.com. 10 IN A 18.204.152.241 ;; Query time: 128 msec ;; SERVER: 192.168.40.1#53(192.168.40.1) ;; WHEN: Thu Sep 03 20:01:42 EDT 2026 ;; MSG SIZE rcvd: 76 diogobonatto@Mac ~ % nc -vz www.edenbowls.com 443 Connection to www.edenbowls.com port 443 [tcp/https] succeeded! diogobonatto@Mac ~ % curl -Iv https://edenbowls.com * Host edenbowls.com:443 was resolved. * IPv6: (none) * IPv4: 18.204.152.241 * Trying 18.204.152.241:443... * Connected to edenbowls.com (18.204.152.241) port 443 * ALPN: curl offers h2,http/1.1 * (304) (OUT), TLS handshake, Client hello (1): * CAfile: /etc/ssl/cert.pem * CApath: none * LibreSSL/3.3.6: error:1404B42E:SSL routines:ST_CONNECT:tlsv1 alert protocol version * Closing connection curl: (35) LibreSSL/3.3.6: error:1404B42E:SSL routines:ST_CONNECT:tlsv1 alert protocol version diogobonatto@Mac ~ %

Achamos uma pista muito forte. O resultado do Mac da cliente é diferente do seu.

O principal problema

Na máquina dela:

www.edenbowls.com → edenbowls.com → 18.204.152.241

Enquanto nos seus testes anteriores:

www.edenbowls.com → 72.62.100.188

Ou seja, existem dois IPs diferentes sendo utilizados para edenbowls.com.

E isso explica perfeitamente um cenário em que:

no Brasil funciona;
para você funciona;
para a cliente nos EUA não funciona;
o navegador dela apresenta erro de SSL/TLS.

Além disso, o teste dela mostrou:

Connected to edenbowls.com (18.204.152.241) port 443
...
tlsv1 alert protocol version

Ela conseguiu chegar ao servidor na porta 443, mas o servidor em 18.204.152.241 rejeitou o protocolo TLS durante o handshake.

Portanto, neste momento eu NÃO mexeria no Caddy do 72.62.100.188.

Precisamos descobrir de onde está vindo esse 18.204.152.241.

Peça para ela executar:

dig @8.8.8.8 www.edenbowls.com

Depois:

dig @1.1.1.1 www.edenbowls.com

E:

dig @8.8.8.8 edenbowls.com

Se todos retornarem:

18.204.152.241

fica ainda mais claro que o DNS público está apontando para esse IP, enquanto o seu ambiente está recebendo 72.62.100.188.

Eu faria também este teste

Na máquina dela:

curl -Iv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com

Esse comando ignora o DNS e força o domínio a acessar o seu servidor 72.62.100.188.

Se retornar 200 OK, teremos uma evidência muito forte de que:

o problema não é o domínio/certificado em si, mas o fato de alguns clientes estarem chegando no IP 18.204.152.241.

O que provavelmente está acontecendo

Pode ser algo como:

Cliente no Brasil
       ↓
DNS
       ↓
72.62.100.188
       ↓
Caddy
       ↓
OK


Cliente nos EUA
       ↓
DNS
       ↓
18.204.152.241
       ↓
Outro servidor
       ↓
TLS error

E isso é bem mais importante do que a questão do 301 vs 308 que estávamos investigando anteriormente.

Me mande o resultado desses três dig e principalmente do curl --resolve. Com esses resultados dá para avançar bastante no diagnóstico.

diogobonatto@Mac ~ % dig @8.8.8.8 www.edenbowls.com ; <<>> DiG 9.10.6 <<>> @8.8.8.8 www.edenbowls.com ; (1 server found) ;; global options: +cmd ;; Got answer: ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 63107 ;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1 ;; OPT PSEUDOSECTION: ; EDNS: version: 0, flags:; udp: 512 ;; QUESTION SECTION: ;www.edenbowls.com. IN A ;; ANSWER SECTION: www.edenbowls.com. 300 IN CNAME edenbowls.com. edenbowls.com. 10 IN A 18.204.152.241 ;; Query time: 280 msec ;; SERVER: 8.8.8.8#53(8.8.8.8) ;; WHEN: Thu Sep 03 20:11:58 EDT 2026 ;; MSG SIZE rcvd: 76 diogobonatto@Mac ~ % diogobonatto@Mac ~ % dig @1.1.1.1 www.edenbowls.com ; <<>> DiG 9.10.6 <<>> @1.1.1.1 www.edenbowls.com ; (1 server found) ;; global options: +cmd ;; Got answer: ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 19715 ;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1 ;; OPT PSEUDOSECTION: ; EDNS: version: 0, flags:; udp: 1232 ;; QUESTION SECTION: ;www.edenbowls.com. IN A ;; ANSWER SECTION: www.edenbowls.com. 300 IN CNAME edenbowls.com. edenbowls.com. 10 IN A 18.204.152.241 ;; Query time: 238 msec ;; SERVER: 1.1.1.1#53(1.1.1.1) ;; WHEN: Thu Sep 03 20:12:59 EDT 2026 ;; MSG SIZE rcvd: 76 diogobonatto@Mac ~ % diogobonatto@Mac ~ % dig @8.8.8.8 edenbolws.com ; <<>> DiG 9.10.6 <<>> @8.8.8.8 edenbolws.com ; (1 server found) ;; global options: +cmd ;; Got answer: ;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 23434 ;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 1 ;; OPT PSEUDOSECTION: ; EDNS: version: 0, flags:; udp: 512 ;; QUESTION SECTION: ;edenbolws.com. IN A ;; AUTHORITY SECTION: com. 900 IN SOA a.gtld-servers.net. nstld.verisi gn-grs.com. 1788480785 1800 900 604800 900 ;; Query time: 176 msec ;; SERVER: 8.8.8.8#53(8.8.8.8) ;; WHEN: Thu Sep 03 20:13:43 EDT 2026 ;; MSG SIZE rcvd: 115 diogobonatto@Mac ~ % diogobonatto@Mac ~ % curl -lv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com * Added www.edenbowls.com:443:72.62.100.188 to DNS cache * Hostname www.edenbowls.com was found in DNS cache * Trying 72.62.100.188:443... * Connected to www.edenbowls.com (72.62.100.188) port 443 * ALPN: curl offers h2,http/1.1 * (304) (OUT), TLS handshake, Client hello (1): * CAfile: /etc/ssl/cert.pem * CApath: none * (304) (IN), TLS handshake, Server hello (2): * (304) (IN), TLS handshake, Unknown (8): * (304) (IN), TLS handshake, Certificate (11): * (304) (IN), TLS handshake, CERT verify (15): * (304) (IN), TLS handshake, Finished (20): * (304) (OUT), TLS handshake, Finished (20): * SSL connection using TLSv1.3 / AEAD-CHACHA20-POLY1305-SHA256 / [blank] / UNDEF * ALPN: server accepted h2 * Server certificate: * subject: CN=www.edenbowls.com * start date: Sep 1 22:24:56 2026 GMT * expire date: Nov 30 22:24:55 2026 GMT * subjectAltName: host "www.edenbowls.com" matched cert's "www.edenbowls.com" * issuer: C=US; O=Let's Encrypt; CN=YR1 * SSL certificate verify ok. * using HTTP/2 * [HTTP/2] [1] OPENED stream for https://www.edenbowls.com/ * [HTTP/2] [1] [:method: GET] * [HTTP/2] [1] [:scheme: https] * [HTTP/2] [1] [:authority: www.edenbowls.com] * [HTTP/2] [1] [:path: /] * [HTTP/2] [1] [user-agent: curl/8.7.1] * [HTTP/2] [1] [accept: /] > GET / HTTP/2 > Host: www.edenbowls.com > User-Agent: curl/8.7.1 > Accept: / > * Request completely sent off < HTTP/2 200 < accept-ranges: bytes < alt-svc: clear < content-security-policy: upgrade-insecure-requests < content-type: text/html; charset=utf-8 < etag: "dl4arehfzp50ae2" < last-modified: Tue, 01 Sep 2026 21:27:55 GMT < referrer-policy: strict-origin-when-cross-origin < server: Caddy < strict-transport-security: max-age=31536000; includeSubDomains; preload < vary: Accept-Encoding < x-content-type-options: nosniff < x-frame-options: SAMEORIGIN < content-length: 13466 < date: Fri, 04 Sep 2026 00:15:17 GMT < <!DOCTYPE html> <html lang="en"> <head> <meta charset="UTF-8" /> <meta name="viewport" content="width=device-width, initial-scale=1.0" /> <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests" /> <title>Eden Bowls — Real Food for Your Dog</title> <link rel="preconnect" href="https://fonts.googleapis.com" /> <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /> <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300;400;500;600;700&family=Tenor+Sans&display=swap" rel="stylesheet" /> <style> :root { --green-deep: #29362d; --ivory: #F7F2E8; --sand: #D9CBAF; --terracotta: #C4855A; --terracotta-lt: #D9A07A; --cream: #FAF8F4; --text-dark: #141A12; --ff-display: 'Tenor Sans', Georgia, serif; --ff-body: 'Quicksand', sans-serif; --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1); } *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: var(--ff-body); font-weight: 400; background: var(--cream); color: var(--text-dark); overflow-x: hidden; -webkit-font-smoothing: antialiased; } body::before { content: ''; position: fixed; inset: 0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E"); pointer-events: none; z-index: 9999; opacity: 0.45; } /* NAV */ nav { position:fixed; top:0; left:0; right:0; z-index:100; padding:24px 48px; display:flex; justify-content:space-between; align-items:center; } .nav-logo { display:flex; align-items:center; } .nav-logo svg { width:220px; height:auto; display:block; } .nav-badge { font-size:.7rem; font-weight:500; letter-spacing:.15em; text-transform:uppercase; color:var(--ivory); background:rgba(217,203,175,.12); border:1px solid rgba(217,203,175,.55); padding:6px 14px; border-radius:100px; } @media(max-width:600px){ nav { padding:18px 20px; } } /* HERO */ #hero { min-height:100svh; background:radial-gradient(ellipse 80% 60% at 20% 40%,rgba(41,54,45,.45) 0%,transparent 60%),radial-gradient(ellipse 60% 80% at 80% 60%,rgba(196,133,90,.12) 0%,transparent 55%),radial-gradient(ellipse 100% 100% at 50% 0%,rgba(41,54,45,.9) 0%,#151d18 100%); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:120px 24px 80px; position:relative; overflow:hidden; } .leaf { position:absolute; pointer-events:none; opacity:.12; } .leaf-1 { top:8%; left:-3%; width:320px; transform:rotate(-25deg); } .leaf-2 { bottom:5%; right:-4%; width:280px; transform:rotate(160deg); } .hero-tag { display:inline-flex; align-items:center; gap:8px; font-size:.72rem; font-weight:500; letter-spacing:.2em; text-transform:uppercase; color:#efbc98; background:rgba(196,133,90,.14); border:1px solid rgba(196,133,90,.62); border-radius:100px; padding:8px 20px; margin-bottom:40px; animation:fadeUp 1s var(--ease-out-expo) both; } .hero-tag::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--terracotta); animation:pulse 2s ease-in-out infinite; } @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)} } @keyframes fadeUp { from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)} } .hero-title { font-family:var(--ff-display); font-size:clamp(2.8rem,7vw,5rem); font-weight:300; letter-spacing:.02em; line-height:1.07; color:rgba(247,242,232,.96); text-shadow:0 6px 18px rgba(0,0,0,.22); max-width:840px; margin-bottom:28px; animation:fadeUp 1.1s .15s var(--ease-out-expo) both; } .hero-title em { font-style:italic; color:var(--terracotta-lt); } @media(max-width:600px){ nav { padding:18px 20px; } .nav-logo svg { width:160px; } .nav-badge { font-size:.62rem; letter-spacing:.12em; padding:6px 12px; } .hero-tag { font-size:.66rem; letter-spacing:.18em; padding:7px 16px; } .hero-title { font-size:clamp(2.2rem,11vw,3.2rem); line-height:1.12; max-width:330px; } .leaf { display:none } } </style> </head> <body> <nav id="navbar"> <div class="nav-logo" aria-label="Eden Bowls"> <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 746.32 249.37" role="img" aria-label="Eden Bowls logo"> <defs> <style> .cls-1 { fill: #ddd1c2; } .cls-2 { fill: #ab906b; } .cls-3 { fill: #7c8770; } .cls-4 { fill: #b08f66; } .cls-5 { fill: #e1d0c1; } </style> </defs> <g> <g> <path class="cls-4" d="M124.72,8.47c30.82,0,59.86,11.96,81.77,33.66,21.92,21.72,34.14,50.68,34.41,81.54.27,31.04-11.57,60.33-33.32,82.47-21.76,22.14-50.84,34.48-81.88,34.75-.34,0-.69,0-1.03,0-30.83,0-59.87-11.96-81.78-33.66-21.92-21.72-34.14-50.68-34.41-81.54-.27-31.04,11.57-60.33,33.32-82.47C63.56,21.09,92.64,8.75,123.68,8.48c.34,0,.69,0,1.03,0h0M124.71,0C124.34,0,123.97,0,123.61,0,54.75.6-.59,56.91,0,125.77c.59,68.49,56.3,123.61,124.66,123.61.36,0,.74,0,1.1,0,68.86-.6,124.2-56.9,123.6-125.76C248.78,55.11,193.07,0,124.71,0h0Z"/> <path class="cls-5" d="M78.72,184.17c4.95,5.31,14.68,9.51,22.89,9.51,10.78,0,20.11-5.49,30.32-12.13l1.54-1c4.11-2.68,8.27-5.39,12.61-7.71-3.56-6.39-5.37-14.24-5.37-23.51,0-12.09,3.05-30.48,29.46-50.55,25.6-19.45,29.73-29.4,19.24-46.29-1.9-3.05-5.51-3.53-9.92-1.33l-.59.3c-7.14,3.59-23.86,11.99-36.98,2.62-14.57-10.4-30.02-5.12-37.94-1.05-1.32.68-2.61,1.41-3.86,2.19-2.17,1.61-3.4,3.79-3.77,6.68-.94,7.38,4.11,18.88,13.19,30,12.97,15.9,16.7,37.06,9.98,56.62h0c-.53,1.55-2.25,2.34-3.77,1.73h0c-19.36-7.7-46.37-32.53-46.37-55.49,0-17.88,13.15-37.14,31.98-46.83,15.45-7.95,31.45-7.41,43.9,1.48,10.3,7.36,24.86.05,31.07-3.08l.6-.3c7.05-3.53,13.87-2.18,17.36,3.43,13.63,21.93,3.75,35.35-20.64,53.88-27.2,20.67-27.2,39.06-27.2,45.98,0,8.42,1.57,15.42,4.74,21.02,5.45-2.38,11.24-3.95,17.58-3.95,22.27,0,24.1,16.49,24.88,23.54l.15,1.33c.11.99-.66,1.85-1.66,1.85h-1.34c-19.35,0-33.31-5.28-41.5-15.5-4.25,2.24-8.42,4.96-12.69,7.74l-1.55,1.01c-10.99,7.14-21.1,13.05-33.45,13.05s-23.35-7.06-26.4-10.92M154.56,175.14c6.73,7.67,17.66,11.7,32.94,12.2-1.32-7.84-4.84-15.2-18.74-15.2-5.03,0-9.69,1.15-14.19,3ZM90.51,62.76c-9.4,9.11-15.42,21.06-15.42,32.02,0,14.72,17.22,38.59,39.9,48.94,4.75-16.82,1.14-34.63-9.92-48.18-9.61-11.78-14.96-23.87-14.57-32.78Z"/> <path class="cls-3" d="M65.23,183.3c-11.05.36-19.88-1.8-26.13-6.21-7.14-5.03-10.93-12.99-10.84-23.45,8.79.84,16.32,3.31,22.27,7.11,8.23,5.26,13.42,13.05,14.71,22.55Z"/> <path class="cls-3" d="M40.08,137.37c2.85,12.87,12.89,19.67,18.9,21.45,3.41-6.73,4.37-20.48,1.92-28.22-3.61-11.41-10.94-18.9-16.43-20.37-3.71,4.02-7.12,14.83-4.39,27.14Z"/> <path class="cls-3" d="M65.23,159.57c0,17.46,6.98,25.94,9.98,28.93,2.49-2,11.45-16.21,11.45-29.68,0-18.93-8.81-26.35-8.81-26.35,0,0-12.62,9.64-12.62,27.09Z"/> <g> <g> <path class="cls-1" d="M423.24,119.35V25.11c0-2.38,1.93-4.31,4.31-4.31h31.1c8.13,0,14.5,1.3,21.26,3.89,6.76,2.6,13.64,6.17,18.49,10.73,4.85,4.56,8.62,9.97,11.32,16.24,2.69,6.27,4.04,13.03,4.04,20.28s-1.4,14.47-4.19,20.79c-2.79,6.32-6.61,11.78-11.46,16.39-4.85,4.6-10.51,8.18-16.97,10.73-6.47,2.55-13.37,3.82-20.72,3.82h-32.87c-2.38,0-4.31-1.93-4.31-4.31ZM437.69,117.19h15.59c8.01,0,14.83-1.35,20.45-4.04,5.62-2.69,10.24-6.19,13.85-10.51,3.61-4.31,6.25-9.13,7.91-14.47,1.66-5.34,2.49-10.65,2.49-15.94,0-5.88-.98-11.54-2.93-16.97-1.96-5.44-4.82-10.23-8.58-14.4-3.76-4.16-8.43-7.47-14-9.92-5.57-2.45-11.97-3.67-19.2-3.67h-15.59v89.93Z"/> <path class="cls-1" d="M617.89,21.87v5.93c0,.59-.48,1.08-1.08,1.08h-51.97v36.88h44.48c.59,0,1.08.48,1.08,1.08v4.6c0,.59-.48,1.08-1.08,1.08h-44.48v43.05h51.97c.59,0,1.08.48,1.08,1.08v5.93c0,.59-.48,1.08-1.08,1.08h-61.03c-2.38,0-4.31-1.93-4.31-4.31V25.11c0-2.38,1.93-4.31,4.31-4.31h61.03c.59,0,1.08.48,1.08,1.08Z"/> <path class="cls-1" d="M383.68,21.87v5.93c0,.59-.48,1.08-1.08,1.08h-51.97v36.88h44.48c.59,0,1.08.48,1.08,1.08v4.6c0,.59-.48,1.08-1.08,1.08h-44.48v43.05h51.97c.59,0,1.08.48,1.08,1.08v5.93c0,.59-.48,1.08-1.08,1.08h-61.03c-2.38,0-4.31-1.93-4.31-4.31V25.11c0-2.38,1.93-4.31,4.31-4.31h61.03c.59,0,1.08.48,1.08,1.08Z"/> <path class="cls-1" d="M746.32,20.8v104.63h-.73l-81.55-80.38h-.59v78.62h-6.76V19.03h.74l81.55,80.38h.59V20.8h6.76Z"/> </g> <g> <g> <path class="cls-2" d="M380.36,177.05h18.75c2.6,0,4.86.39,6.79,1.16s3.5,1.76,4.73,2.96c1.23,1.2,2.14,2.52,2.74,3.97s.9,2.87.9,4.27c0,1.6-.35,3.11-1.05,4.53-.7,1.42-1.63,2.67-2.81,3.74-1.17,1.07-2.53,1.95-4.08,2.62-1.55.67-3.19,1.01-4.94,1.01v.3c1.1.05,2.54.22,4.34.52,1.8.3,3.54.9,5.24,1.8,1.7.9,3.17,2.2,4.42,3.89,1.25,1.7,1.87,3.97,1.87,6.81,0,1.8-.31,3.58-.94,5.35-.63,1.77-1.64,3.36-3.04,4.75-1.4,1.4-3.26,2.53-5.56,3.4-2.31.87-5.14,1.31-8.49,1.31h-18.86v-52.39ZM396.16,199.95c1.5,0,2.91-.25,4.23-.75,1.32-.5,2.49-1.2,3.52-2.1,1.02-.9,1.82-1.97,2.4-3.22.57-1.25.86-2.59.86-4.04,0-1.15-.2-2.29-.6-3.44-.4-1.15-1.04-2.17-1.91-3.07-.87-.9-2-1.62-3.37-2.17-1.37-.55-3.03-.82-4.98-.82h-9.13v19.61h8.98ZM398.06,226.15c1.6,0,3.12-.24,4.54-.71,1.43-.47,2.66-1.18,3.72-2.13,1.05-.95,1.89-2.1,2.52-3.44.63-1.35.94-2.89.94-4.64,0-1.6-.29-3.12-.86-4.57-.58-1.45-1.45-2.72-2.63-3.82-1.18-1.1-2.67-1.97-4.47-2.62-1.8-.65-3.93-.97-6.38-.97h-8.26v22.9h10.89Z"/> <path class="cls-2" d="M431.82,194.19c1.07-3.19,2.76-6.12,5.05-8.8,2.29-2.67,5.21-4.88,8.76-6.62,3.54-1.75,7.78-2.62,12.72-2.62s9.32.89,12.98,2.66c3.67,1.77,6.7,4,9.09,6.7,2.4,2.7,4.17,5.63,5.31,8.8,1.15,3.17,1.72,6.15,1.72,8.94,0,1.85-.26,3.79-.79,5.84-.52,2.05-1.3,4.08-2.32,6.1-1.02,2.02-2.33,3.94-3.93,5.76-1.6,1.82-3.48,3.43-5.65,4.83-2.17,1.4-4.62,2.51-7.33,3.33-2.72.82-5.75,1.24-9.09,1.24-4.94,0-9.18-.89-12.72-2.66-3.54-1.77-6.46-4-8.76-6.7-2.3-2.69-3.98-5.63-5.05-8.79s-1.61-6.15-1.61-8.94.54-5.86,1.61-9.06ZM439.16,212.86c1.07,2.92,2.54,5.43,4.42,7.52,1.87,2.1,4.08,3.73,6.62,4.9,2.54,1.17,5.31,1.76,8.31,1.76s5.73-.59,8.34-1.76c2.62-1.17,4.91-2.81,6.89-4.9,1.97-2.1,3.53-4.6,4.68-7.52,1.15-2.92,1.72-6.12,1.72-9.62s-.57-6.7-1.72-9.62c-1.15-2.92-2.71-5.43-4.68-7.52-1.97-2.1-4.27-3.73-6.89-4.9-2.62-1.17-5.4-1.76-8.34-1.76s-5.76.59-8.31,1.76c-2.54,1.17-4.75,2.81-6.62,4.9-1.87,2.1-3.34,4.6-4.42,7.52-1.07,2.92-1.61,6.12-1.61,9.62s.54,6.7,1.61,9.62Z"/> <path class="cls-2" d="M505.95,177.05l15.42,43.48h.3l14.89-43.48h3.22l14.59,43.71h.3l15.49-43.71h3.44l-18.56,52.39h-4.42l-13.85-40.94h-.37l-14.29,40.94h-4.49l-18.56-52.39h6.89Z"/> <path class="cls-2" d="M590.45,229.44v-52.39h6.81v48.27h27.02v4.12h-33.83Z"/> <path class="cls-2" d="M640,216.19c.05.85.25,1.88.6,3.11.35,1.22,1.02,2.41,2.02,3.56,1,1.15,2.44,2.13,4.34,2.96,1.9.82,4.42,1.24,7.56,1.24,3.94,0,7.1-.75,9.47-2.25,2.37-1.5,3.55-3.87,3.55-7.11,0-2.59-.75-4.66-2.25-6.21-1.5-1.55-3.38-2.86-5.65-3.93-2.27-1.07-4.73-2.03-7.37-2.88-2.64-.85-5.1-1.87-7.37-3.07-2.27-1.2-4.15-2.69-5.65-4.49-1.5-1.8-2.25-4.17-2.25-7.11,0-2.25.46-4.24,1.39-5.99.92-1.75,2.17-3.19,3.75-4.34,1.57-1.15,3.4-2.02,5.47-2.62s4.26-.9,6.56-.9,4.31.26,6.33.79c2.02.52,3.83,1.3,5.43,2.32,1.6,1.02,2.92,2.27,3.97,3.74,1.05,1.47,1.72,3.13,2.02,4.98h-5.1c-.4-2.94-1.74-5.1-4.01-6.47-2.27-1.37-5.04-2.06-8.28-2.06-1.95,0-3.67.24-5.17.71-1.5.48-2.76,1.1-3.79,1.87s-1.8,1.68-2.32,2.73c-.52,1.05-.79,2.17-.79,3.37,0,2.15.77,3.87,2.32,5.16,1.55,1.3,3.49,2.44,5.81,3.44,2.33,1,4.85,1.95,7.58,2.84,2.72.9,5.25,2.01,7.58,3.33,2.33,1.32,4.26,2.97,5.82,4.94,1.55,1.97,2.33,4.5,2.33,7.6,0,2.25-.45,4.29-1.35,6.14-.9,1.85-2.18,3.42-3.83,4.71-1.65,1.3-3.64,2.3-5.96,2.99-2.32.7-4.94,1.05-7.83,1.05s-5.47-.34-7.87-1.01c-2.4-.67-4.49-1.62-6.26-2.84-1.77-1.22-3.17-2.71-4.2-4.45-1.02-1.75-1.59-3.69-1.69-5.84h5.09Z"/> </g> <rect class="cls-2" x="694" y="199.34" width="52.31" height="6.04" rx="1" ry="1"/> <rect class="cls-2" x="317.26" y="199.35" width="52.31" height="6.04" rx="1" ry="1"/> </g> </g> </g> </g> </svg> </div> <div class="nav-badge">Launching Soon</div> </nav> <!-- HERO --> <section id="hero"> <svg class="leaf leaf-1" viewBox="0 0 200 300" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M100 290C100 290 10 200 10 100C10 50 55 10 100 10C145 10 190 50 190 100C190 200 100 290 100 290Z" fill="#29362d"/> <path d="M100 10L100 290" stroke="#1f2b24" stroke-width="2"/> <path d="M100 80C130 100 160 130 170 160" stroke="#1f2b24" stroke-width="1.5" stroke-linecap="round"/> </svg> <svg class="leaf leaf-2" viewBox="0 0 200 300" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M100 290C100 290 10 200 10 100C10 50 55 10 100 10C145 10 190 50 190 100C190 200 100 290 100 290Z" fill="#29362d"/> <path d="M100 10L100 290" stroke="#1f2b24" stroke-width="2"/> </svg> <div class="hero-tag">Coming Soon</div> <h1 class="hero-title">Real food for those<br>you love <em>unconditionally.</em></h1> </section> </body> </html> * Connection #0 to host www.edenbowls.com left intact

Agora temos uma evidência bem forte de onde está o problema.

O que os testes da cliente provaram

O DNS público, tanto Google quanto Cloudflare, está retornando:

www.edenbowls.com
        ↓
edenbowls.com
        ↓
18.204.152.241

E a conexão TCP na porta 443 funciona:

Connection to www.edenbowls.com port 443 succeeded!

Porém, quando ela tenta estabelecer TLS nesse IP:

LibreSSL/3.3.6:
tlsv1 alert protocol version

Ou seja, ela chega ao servidor, mas o TLS é rejeitado.

E o teste mais importante foi este:

curl -lv --resolve www.edenbowls.com:443:72.62.100.188 https://www.edenbowls.com

Resultado:

SSL connection using TLSv1.3
SSL certificate verify ok.
...
HTTP/2 200
Server: Caddy

Isso é praticamente um diagnóstico:

                 www.edenbowls.com
                         │
                         ▼
                      DNS
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       18.204.152.241         72.62.100.188
              │                     │
              │                     │
          TLS ERROR              TLS 1.3 OK
              │                     │
              X                     ✓
Portanto, o problema não parece ser o certificado atual

O servidor 72.62.100.188 está entregando:

certificado correto para www.edenbowls.com
Let's Encrypt
TLS 1.3
certificado válido
HTTP/2
HTTP 200

O problema é que o DNS público está levando a cliente para 18.204.152.241, e não para 72.62.100.188.

Agora eu faria UMA coisa antes de alterar qualquer configuração

No seu computador, rode:

dig @8.8.8.8 www.edenbowls.com

e:

dig @1.1.1.1 www.edenbowls.com

Porque anteriormente você estava recebendo:

72.62.100.188

e agora a cliente está recebendo:

18.204.152.241

Isso pode indicar que o DNS foi alterado recentemente, existe algum registro conflitante, ou há algum mecanismo de DNS diferente envolvido.

Também vale consultar diretamente os nameservers autoritativos:

dig NS edenbowls.com

Depois podemos consultar os nameservers que aparecerem.

E tem uma coisa importante

O teste dela contém:

edenbowls.com → 18.204.152.241

Esse IP parece ser um servidor diferente do seu Caddy em 72.62.100.188.

Então eu não mudaria TLS, certificado, 301/308 ou configuração do Caddy agora.

Primeiro precisamos descobrir por que edenbowls.com está apontando para 18.204.152.241 publicamente.

Se você me mandar o resultado de:

dig NS edenbowls.com

e, se possível, do seu próprio:

dig @8.8.8.8 www.edenbowls.com

eu consigo te dizer o próximo passo com bastante precisão.

Last login: Thu Sep 3 20:11:34 on ttys000 diogobonatto@Mac ~ % dig NS edenbowls.com ; <<>> DiG 9.10.6 <<>> NS edenbowls.com ;; global options: +cmd ;; Got answer: ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 9758 ;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1 ;; OPT PSEUDOSECTION: ; EDNS: version: 0, flags:; udp: 1232 ;; QUESTION SECTION: ;edenbowls.com. IN NS ;; ANSWER SECTION: edenbowls.com. 86400 IN NS byte.dns-parking.com. edenbowls.com. 86400 IN NS pixel.dns-parking.com. ;; Query time: 432 msec ;; SERVER: 192.168.40.1#53(192.168.40.1) ;; WHEN: Thu Sep 03 20:28:49 EDT 2026 ;; MSG SIZE rcvd: 93 diogobonatto@Mac ~ % diogobonatto@Mac ~ % dig @8.8.8.8 www.edenbowls.com ; <<>> DiG 9.10.6 <<>> @8.8.8.8 www.edenbowls.com ; (1 server found) ;; global options: +cmd ;; Got answer: ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 34064 ;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1 ;; OPT PSEUDOSECTION: ; EDNS: version: 0, flags:; udp: 512 ;; QUESTION SECTION: ;www.edenbowls.com. IN A ;; ANSWER SECTION: www.edenbowls.com. 300 IN CNAME edenbowls.com. edenbowls.com. 10 IN A 18.204.152.241 ;; Query time: 240 msec ;; SERVER: 8.8.8.8#53(8.8.8.8) ;; WHEN: Thu Sep 03 20:30:03 EDT 2026 ;; MSG SIZE rcvd: 76 diogobonatto@Mac ~ %

Perfeito. Agora temos uma confirmação importante.

O domínio está usando estes nameservers da Hostinger:

byte.dns-parking.com
pixel.dns-parking.com

E o DNS público está efetivamente respondendo:

www.edenbowls.com
        ↓ CNAME
edenbowls.com
        ↓ A
18.204.152.241

Isso significa que o DNS autoritativo atualmente está apontando edenbowls.com para 18.204.152.241.

O seu servidor Caddy, por outro lado, está em:

72.62.100.188

E nós já comprovamos que, quando forçamos o Mac a acessar 72.62.100.188, o HTTPS funciona perfeitamente:

TLSv1.3
SSL certificate verify ok
HTTP/2 200
Server: Caddy
O próximo passo é bem simples

Não altere o Caddy ainda.

Entre no painel DNS da Hostinger onde estão esses nameservers e procure os registros:

A     @
CNAME www

Provavelmente você encontrará algo parecido com:

@      A       18.204.152.241
www    CNAME   edenbowls.com

Se o servidor correto agora é o seu Caddy em 72.62.100.188, o esperado seria:

@      A       72.62.100.188
www    CNAME   edenbowls.com

Ou seja, o problema provavelmente está no registro A do domínio raiz.

Mas atenção

Antes de simplesmente trocar 18.204.152.241 por 72.62.100.188, eu verificaria o que é o 18.204.152.241.

Pode ser um servidor antigo da Eden Bowls, AWS, hospedagem anterior, landing page etc.

No Mac da cliente, ela pode executar:

curl -I http://18.204.152.241

e:

curl -kIv https://18.204.152.241

Mas, mais importante, você deveria olhar o DNS da Hostinger.

Se você me mandar um print da tela de DNS / DNS Zone da Hostinger do edenbowls.com, eu consigo olhar os registros e te dizer exatamente qual registro está causando isso e o que deve ser alterado.

Gerenciador DNS:

edenbowls.com

pixel.dns-parking.comsvg	byte.dns-parking.comsvg	svgativo	Editar DNS	svg
				

edenbowls.com.br

hermes.dns-parking.comsvg	<br><br>
artemis.dns-parking.com<br><br><br>
edenbowls.com
CNAME	www	0	edenbowls.com	300	svgsvg
	A	@	0	72.62.100.188	300<br><br>
edenbowls.com.br
CNAME	www	0	edenbowls.com.br	300	svgsvg
	A	@	0	72.62.100.188	300


Perfeito. Agora ficou claro: o DNS do edenbowls.com está configurado corretamente no painel da Hostinger.

Você tem:

Registro	Valor
@ → A	72.62.100.188
www → CNAME	edenbowls.com
TTL	300

Ou seja, não precisa alterar esses registros.

O ponto estranho é que o Mac do cliente está recebendo:

edenbowls.com → 18.204.152.241

enquanto a zona DNS que você mostrou diz:

edenbowls.com → 72.62.100.188

E isso explica perfeitamente o comportamento:

18.204.152.241
    ↓
TLSv1 alert protocol version
    ↓
ERRO

mas quando forçamos o IP correto:

72.62.100.188
    ↓
TLS 1.3
    ↓
Let's Encrypt válido
    ↓
HTTP/2 200
O que eu faria agora

No Mac do cliente, peça para executar:

dig @byte.dns-parking.com edenbowls.com A

e:

dig @pixel.dns-parking.com edenbowls.com A

Esse teste é importante, porque byte.dns-parking.com e pixel.dns-parking.com são os servidores DNS autoritativos do domínio.

O resultado esperado nos dois é:

edenbowls.com.    300    IN    A    72.62.100.188
Se os dois retornarem 72.62.100.188

Então o DNS autoritativo está correto, e provavelmente existe algum cache DNS/propagação inconsistente no caminho do cliente.

Nesse caso, podemos investigar o resolver 192.168.40.1 que apareceu no Mac:

dig @192.168.40.1 edenbowls.com A

e comparar com:

dig @8.8.8.8 edenbowls.com A
dig @1.1.1.1 edenbowls.com A
Se os autoritativos retornarem 18.204.152.241

Aí temos algo mais interessante: o painel da Hostinger está mostrando 72.62.100.188, mas os DNS autoritativos estão publicando outro IP. Nesse caso precisamos investigar a zona DNS efetivamente publicada.

Não altere o Caddy nem o certificado agora. O teste --resolve já demonstrou que o servidor 72.62.100.188 funciona corretamente a partir da rede do cliente. O problema está no caminho DNS → IP 18.204.152.241.