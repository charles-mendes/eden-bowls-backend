curl --url ^"http://localhost:3000/api/v1/subscriptions^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxNDE0OTMsIm5iZiI6MTc4ODE0MTQ5MywiZXhwIjoxNzg4MTQyMzkzLCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.9QZW2ZVPDM2bYp1dioXa237xV5Oenb77FJPbU_PgxQY^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"If-None-Match: W/^\^"33c-xIY2eOx5I+CUmzOtrbE9bzL3KDs^\^"^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^"


  {
    "success": true,
    "data": {
        "subscriptions": [
            {
                "subscription_id": "sub_1UAKToRhwGQO7Fk28wVNe4a9",
                "stripe_subscription_id": "sub_1UAKToRhwGQO7Fk28wVNe4a9",
                "legacy_subscription_id": null,
                "slug": "sub_1UAKToRhwGQO7Fk28wVNe4a9",
                "plan_label": "Plan #1",
                "status": "incomplete",
                "stripe_subscription_status": "incomplete",
                "contract_label": "Plan #1",
                "start_date": "2026-08-31T01:57:48.000Z",
                "end_date": null,
                "end_date_source": null,
                "current_period_start": "2026-08-31T01:57:48.000Z",
                "current_period_end": "2026-09-30T01:57:48.000Z",
                "next_billing_date": "2026-09-30T01:57:48.000Z",
                "next_billing_source": "stripe",
                "next_shipment_date": null,
                "next_shipment_source": null,
                "next_shipment_context": {
                    "shipping_window": "weekly"
                },
                "pets_names": [
                    "luna"
                ],
                "pet_ids": [
                    "526fb705-9da4-4d27-965e-da39a20d3b12"
                ],
                "packs_per_month": 10,
                "order_total_per_month": 437.5
            }
        ],
        "count": 1
    }
}


curl --url ^"http://localhost:3000/api/v1/onboarding/pets?country=BR^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxNDE0OTMsIm5iZiI6MTc4ODE0MTQ5MywiZXhwIjoxNzg4MTQyMzkzLCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.9QZW2ZVPDM2bYp1dioXa237xV5Oenb77FJPbU_PgxQY^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"If-None-Match: W/^\^"43-KX2c82VtyGlS7mMH6FSoj6jcYlQ^\^"^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"X-Eden-Country: BR^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^"

  {"success":true,"data":{"country":"BR","currency":"BRL","pets":[]}}