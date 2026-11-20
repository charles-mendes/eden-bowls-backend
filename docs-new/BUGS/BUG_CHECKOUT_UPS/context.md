curl --url ^"http://localhost:3000/api/v1/onboarding/shipping^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3OTUwNDMxMjYsIm5iZiI6MTc5NTA0MzEyNiwiZXhwIjoxNzk1MDQ0MDI2LCJkYXRhIjp7InVzZXIiOnsiaWQiOjUzfX19.iGnA9SDyQkfc2BLUh9NKr4XvP0lzGrKvFvsdF4T4dFA^" ^
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
  --data-raw ^"^{^\^"rate_id^\^":^\^"fixed_us:default^\^",^\^"method_id^\^":^\^"fixed_us^\^",^\^"label^\^":^\^"FedEx 3^ 5 business days^\^",^\^"cost^\^":12.9,^\^"tax_total^\^":0,^\^"total^\^":12.9,^\^"instance_id^\^":0,^\^"delivery_days^\^":0,^\^"transit_business_days^\^":0,^\^"distance^\^":0,^\^"distance_source^\^":^\^"^\^",^\^"per_km^\^":0,^\^"quoted_at^\^":^\^"2026-11-18T23:08:42.209Z^\^",^\^"quote_token^\^":^\^"eyJjb3VudHJ5IjoiVVMiLCJ6aXBjb2RlIjoiMzM0MzIiLCJjb3N0IjoxMi45LCJkaXN0YW5jZSI6bnVsbCwiZGVsaXZlcnlfZGF5cyI6bnVsbCwiaWF0IjoxNzk1MDQzMzIyMjA5fQ.4qOroi10hKKHp6g9Vul8huIIzp7q4Lkg6RiX1kxnaw8^\^",^\^"zipcode^\^":^\^"33432^\^",^\^"original_amount^\^":12.9,^\^"charged_amount^\^":0,^\^"charge_enabled^\^":false,^\^"source^\^":^\^"fallback^\^"^}^"

  Request URL
http://localhost:3000/api/v1/onboarding/shipping
Request method
POST
Status code
200 OK
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
767
content-security-policy
default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
content-type
application/json; charset=utf-8
cross-origin-opener-policy
same-origin
cross-origin-resource-policy
cross-origin
date
Wed, 18 Nov 2026 23:10:01 GMT
etag
W/"2ff-yg4ZDIPWup5UGuFaRp54ElrZYo8"
keep-alive
timeout=5
origin-agent-cluster
?1
ratelimit-limit
300
ratelimit-policy
300;w=60
ratelimit-remaining
295
ratelimit-reset
21
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
Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3OTUwNDMxMjYsIm5iZiI6MTc5NTA0MzEyNiwiZXhwIjoxNzk1MDQ0MDI2LCJkYXRhIjp7InVzZXIiOnsiaWQiOjUzfX19.iGnA9SDyQkfc2BLUh9NKr4XvP0lzGrKvFvsdF4T4dFA
connection
keep-alive
content-length
574
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

{"rate_id":"fixed_us:default","method_id":"fixed_us","label":"FedEx 3–5 business days","cost":12.9,"tax_total":0,"total":12.9,"instance_id":0,"delivery_days":0,"transit_business_days":0,"distance":0,"distance_source":"","per_km":0,"quoted_at":"2026-11-18T23:08:42.209Z","quote_token":"eyJjb3VudHJ5IjoiVVMiLCJ6aXBjb2RlIjoiMzM0MzIiLCJjb3N0IjoxMi45LCJkaXN0YW5jZSI6bnVsbCwiZGVsaXZlcnlfZGF5cyI6bnVsbCwiaWF0IjoxNzk1MDQzMzIyMjA5fQ.4qOroi10hKKHp6g9Vul8huIIzp7q4Lkg6RiX1kxnaw8","zipcode":"33432","original_amount":12.9,"charged_amount":0,"charge_enabled":false,"source":"fallback"}

Response:

{
    "success": true,
    "data": {
        "shipping": {
            "rate_id": "fixed_us:default",
            "method_id": "fixed_us",
            "instance_id": 0,
            "label": "FedEx 3–5 business days",
            "cost": 12.9,
            "tax_total": 0,
            "total": 12.9,
            "transit_business_days": 0,
            "delivery_days": 0,
            "delivery_days_min": 0,
            "delivery_days_max": 0,
            "estimate_label": "Immediate",
            "selected_at": "2026-11-18T23:08:42.209Z",
            "quoted_at": "2026-11-18T23:08:42.209Z",
            "distance": 0,
            "distance_source": "manual",
            "per_km": 0,
            "zipcode": "33432",
            "quote_token": "eyJjb3VudHJ5IjoiVVMiLCJ6aXBjb2RlIjoiMzM0MzIiLCJjb3N0IjoxMi45LCJkaXN0YW5jZSI6bnVsbCwiZGVsaXZlcnlfZGF5cyI6bnVsbCwiaWF0IjoxNzk1MDQzMzIyMjA5fQ.4qOroi10hKKHp6g9Vul8huIIzp7q4Lkg6RiX1kxnaw8",
            "original_amount": 12.9,
            "charged_amount": 0,
            "charge_enabled": false,
            "company_cost": 12.9,
            "source": "fallback",
            "snapshot": true
        }
    }
}


Aqui nesse momento da erro no checkout:

Request URL
http://localhost:3000/api/v1/onboarding/subscription/checkout
Request method
POST
Status code
422 Unprocessable Entity
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
100
content-security-policy
default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
content-type
application/json; charset=utf-8
cross-origin-opener-policy
same-origin
cross-origin-resource-policy
cross-origin
date
Wed, 18 Nov 2026 23:10:01 GMT
etag
W/"64-V88paMcBZ7s2AsK3STodjqZ1gNY"
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
21
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
Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3OTUwNDMxMjYsIm5iZiI6MTc5NTA0MzEyNiwiZXhwIjoxNzk1MDQ0MDI2LCJkYXRhIjp7InVzZXIiOnsiaWQiOjUzfX19.iGnA9SDyQkfc2BLUh9NKr4XvP0lzGrKvFvsdF4T4dFA
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

{"billing":{"email":"operador.eua@local.test","phone":"","first_name":"Operador","last_name":"EUA","company":""},"payment_method_id":"pm_1UdHyJLTXrRah8rpkVYk9g7e","legal_consent":{"accepted":true,"terms_version":"2026-10-22","privacy_version":"2026-10-22"},"renewal_consent":{"accepted":true,"version":"2026-11-18"}}

Resposta:
{
    "success": false,
    "message": "delivery_area_unverified",
    "details": {
        "code": "delivery_area_unverified"
    }
}

