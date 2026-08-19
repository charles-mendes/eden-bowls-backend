Adicionei mais um cachorro

E fui para a tela de checkout

Onde ele deveria criar mais uma subscription para o novo cachorro

Um subscription por cachorro

Isso iria ajudar na criação e na edição da subscription

Mas ao tentar criar a segunda subscription deu erro

Segue curl, payload e response


curl --url ^"http://localhost:3000/api/v1/onboarding/shipping^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcxMDU0MzEsIm5iZiI6MTc4NzEwNTQzMSwiZXhwIjoxNzg3MTA2MzMxLCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.R63ydwgfmZ6YdqhdJOWEGyPiO8yO2XbKhw7rG6K4--c^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"Content-Type: application/json^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"X-Eden-Country: BR^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  --data-raw ^"^{^\^"rate_id^\^":^\^"distance_km:br-default^\^",^\^"method_id^\^":^\^"distance_km^\^",^\^"label^\^":^\^"Entrega Eden Bowl^\^",^\^"cost^\^":7,^\^"tax_total^\^":0,^\^"total^\^":7,^\^"instance_id^\^":0,^\^"delivery_days^\^":2,^\^"transit_business_days^\^":2,^\^"distance^\^":7.37,^\^"distance_source^\^":^\^"osrm^\^",^\^"per_km^\^":0.95,^\^"quoted_at^\^":^\^"2026-08-19T02:11:22.235Z^\^",^\^"zipcode^\^":^\^"83331-160^\^"^}^"

  Payload:
  {"rate_id":"distance_km:br-default","method_id":"distance_km","label":"Entrega Eden Bowl","cost":7,"tax_total":0,"total":7,"instance_id":0,"delivery_days":2,"transit_business_days":2,"distance":7.37,"distance_source":"osrm","per_km":0.95,"quoted_at":"2026-08-19T02:11:22.235Z","zipcode":"83331-160"}

  Response:
  {
    "success": true,
    "data": {
        "shipping": {
            "rate_id": "distance_km:br-default",
            "method_id": "distance_km",
            "instance_id": 0,
            "label": "Entrega Eden Bowl",
            "cost": 7,
            "tax_total": 0,
            "total": 7,
            "transit_business_days": 2,
            "delivery_days": 2,
            "delivery_days_min": 2,
            "delivery_days_max": 2,
            "estimate_label": "2 business days",
            "selected_at": "2026-08-19T02:11:22.235Z",
            "quoted_at": "2026-08-19T02:11:22.235Z",
            "distance": 7.37,
            "distance_source": "osrm",
            "per_km": 0.95,
            "zipcode": "83331-160",
            "snapshot": true
        }
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/subscription/checkout^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcxMDU0MzEsIm5iZiI6MTc4NzEwNTQzMSwiZXhwIjoxNzg3MTA2MzMxLCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.R63ydwgfmZ6YdqhdJOWEGyPiO8yO2XbKhw7rG6K4--c^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"Content-Type: application/json^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"X-Eden-Country: BR^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  --data-raw ^"^{^\^"billing^\^":^{^\^"email^\^":^\^"fihesob418^@beiwoh.com^\^",^\^"phone^\^":^\^"^\^",^\^"first_name^\^":^\^"fihe_sob_8835^\^",^\^"last_name^\^":^\^"^\^",^\^"company^\^":^\^"^\^"^},^\^"payment_method_id^\^":^\^"pm_1U5y2uRhwGQO7Fk2WrRvsdHS^\^"^}^"

  Payload:
  {"billing":{"email":"fihesob418@beiwoh.com","phone":"","first_name":"fihe_sob_8835","last_name":"","company":""},"payment_method_id":"pm_1U5y2uRhwGQO7Fk2WrRvsdHS"}

  Response:
  {
    "success": false,
    "message": "Checkout context does not match the existing subscription.",
    "details": {
        "code": "checkout_context_mismatch"
    }
}