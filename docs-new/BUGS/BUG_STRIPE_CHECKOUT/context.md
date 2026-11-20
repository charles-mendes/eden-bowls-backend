curl --url ^"http://localhost:3000/api/v1/onboarding/subscription/checkout^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3OTUwNDY3MjksIm5iZiI6MTc5NTA0NjcyOSwiZXhwIjoxNzk1MDQ3NjI5LCJkYXRhIjp7InVzZXIiOnsiaWQiOjUzfX19.O_5lVv_a6yCjCLq65p8aIpk5wbtK-eZH14-HvJlwlZo^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"Content-Type: application/json^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 ^(Windows NT 10.0; Win64; x64^) AppleWebKit/537.36 ^(KHTML, like Gecko^) Chrome/158.0.0.0 Safari/537.36^" ^
  -H ^"X-Eden-Country: US^" ^
  -H ^"sec-ch-ua: ^\^"Chromium^\^";v=^\^"158^\^", ^\^"Not.A/Brand^\^";v=^\^"24^\^", ^\^"Google Chrome^\^";v=^\^"158^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  --data-raw ^"^{^\^"billing^\^":^{^\^"email^\^":^\^"operador.eua^@local.test^\^",^\^"phone^\^":^\^"^\^",^\^"first_name^\^":^\^"Operador^\^",^\^"last_name^\^":^\^"EUA^\^",^\^"company^\^":^\^"^\^"^},^\^"payment_method_id^\^":^\^"pm_1UdIwFLTXrRah8rpnVduP16M^\^",^\^"legal_consent^\^":^{^\^"accepted^\^":true,^\^"terms_version^\^":^\^"2026-10-22^\^",^\^"privacy_version^\^":^\^"2026-10-22^\^"^},^\^"renewal_consent^\^":^{^\^"accepted^\^":true,^\^"version^\^":^\^"2026-11-18^\^"^}^}^"

  Request URL
http://localhost:3000/api/v1/onboarding/subscription/checkout
Request method
POST
Status code
502 Bad Gateway
Remote address
[::1]:3000
Referrer policy
strict-origin-when-cross-origin
access-control-allow-credentials
true
access-control-allow-headers
Accept,Content-Type,Authorization,Origin,X-Requested-With,X-Eden-Country,X-Eden-Domain,baggage,sentry-trace
access-control-allow-methods
GET,POST,PUT,PATCH,DELETE,OPTIONS
access-control-allow-origin
http://localhost:5173
access-control-expose-headers
content-type
connection
keep-alive
content-length
146
content-security-policy
default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
content-type
application/json; charset=utf-8
cross-origin-opener-policy
same-origin
cross-origin-resource-policy
cross-origin
date
Thu, 19 Nov 2026 00:10:56 GMT
etag
W/"92-nzpXrWVDdLLEZZLsTStiOVa8K7M"
keep-alive
timeout=5
origin-agent-cluster
?1
ratelimit-limit
300
ratelimit-policy
300;w=60
ratelimit-remaining
294
ratelimit-reset
15
referrer-policy
no-referrer
vary
Origin
x-content-type-options
nosniff
x-dns-prefetch-control
off
x-download-options
noopen
x-frame-options
SAMEORIGIN
x-permitted-cross-domain-policies
none
x-xss-protection
0
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
en-US,en;q=0.9,pt;q=0.8
authorization
Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3OTUwNDY3MjksIm5iZiI6MTc5NTA0NjcyOSwiZXhwIjoxNzk1MDQ3NjI5LCJkYXRhIjp7InVzZXIiOnsiaWQiOjUzfX19.O_5lVv_a6yCjCLq65p8aIpk5wbtK-eZH14-HvJlwlZo
connection
keep-alive
content-length
316
content-type
application/json
host
localhost:3000
origin
http://localhost:5173
referer
http://localhost:5173/
sec-ch-ua
"Chromium";v="158", "Not.A/Brand";v="24", "Google Chrome";v="158"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-site
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36
x-eden-country
US

{"billing":{"email":"operador.eua@local.test","phone":"","first_name":"Operador","last_name":"EUA","company":""},"payment_method_id":"pm_1UdIwFLTXrRah8rpnVduP16M","legal_consent":{"accepted":true,"terms_version":"2026-10-22","privacy_version":"2026-10-22"},"renewal_consent":{"accepted":true,"version":"2026-11-18"}}

{
    "success": false,
    "message": "The requested Stripe resource was not found.",
    "details": {
        "code": "stripe_price_retrieve_failed",
        "stripe_account": "us"
    }
}