curl --url ^"http://localhost:3000/api/v1/onboarding/subscription/checkout^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcxMDE0NDUsIm5iZiI6MTc4NzEwMTQ0NSwiZXhwIjoxNzg3MTAyMzQ1LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.iJW2dsg4bQXhM1bj9NN_-VvLCT_HVooOVmS8cp_gLPo^" ^
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
    "success": true,
    "data": {
        "order_id": 0,
        "order_key": "sub_sub_1U5wFCRhwGQO7Fk2LJKo9Gq7",
        "status": "incomplete",
        "total": 501.3,
        "subtotal": 557,
        "product_tax": 0,
        "shipping_total": 6.57,
        "shipping_tax": 0,
        "shipping_total_with_tax": 6.57,
        "currency": "BRL",
        "payment_url": "",
        "subscription_ids": [],
        "flexible_subscription_id": 0,
        "stripe_subscription_id": "sub_1U5wFCRhwGQO7Fk2LJKo9Gq7",
        "stripe_customer_id": "cus_V68WsBYmYMG9FP",
        "stripe_client_secret": "pi_3U5wFDRhwGQO7Fk21wiBUxiA_secret_BRmIBABuGPE27LdqakuuiZh6l",
        "stripe_payment_intent_id": "pi_3U5wFDRhwGQO7Fk21wiBUxiA",
        "stripe_subscription_status": "incomplete",
        "payment_state": "requires_confirmation",
        "has_payment_method": true,
        "reused": false,
        "billing": {
            "first_name": "fihe_sob_8835",
            "last_name": "",
            "email": "fihesob418@beiwoh.com",
            "phone": "",
            "company": ""
        },
        "checkout_mode": "subscription_first",
        "discount_eligibility": {
            "validated": true,
            "eligible": true,
            "reason": null
        },
        "discount_applied_percent": 10,
        "stripe_promotion_code_id": "promo_1TvSx0RhwGQO7Fk2XENgnUrf",
        "stripe_coupon_id": null,
        "stripe_discount_percent": 10,
        "stripe_discount_amount": 55,
        "stripe_discount_duration": "once",
        "discounts": [
            {
                "promotion_code": "promo_1TvSx0RhwGQO7Fk2XENgnUrf"
            }
        ],
        "attempt_id": "41c71550-7b81-428a-995c-597ba07a6934",
        "checkout_context_fingerprint": "0a78bd2ae8c70cced9481a30259d8039483b3f44a5030fd2ae588e11959c503c",
        "promotion_code_id": "promo_1TvSx0RhwGQO7Fk2XENgnUrf"
    }
}


curl --url ^"https://api.stripe.com/v1/payment_intents/pi_3U5wFDRhwGQO7Fk21wiBUxiA?is_stripe_sdk=false^&client_secret=pi_3U5wFDRhwGQO7Fk21wiBUxiA_secret_BRmIBABuGPE27LdqakuuiZh6l^&key=pk_test_51TObKdRhwGQO7Fk2nvHMzE105eJO6YhksWpzE4vSPKwWc7Xxs8062CpHZ1PyMpoqpVoWYIeDEjhYQoq4ytvv3vhl005Tg7xCzI^&_stripe_version=2026-03-25.dahlia^" ^
  -H ^"accept: application/json^" ^
  -H ^"accept-language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"content-type: application/x-www-form-urlencoded^" ^
  -H ^"origin: https://js.stripe.com^" ^
  -H ^"priority: u=1, i^" ^
  -H ^"referer: https://js.stripe.com/^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  -H ^"sec-fetch-dest: empty^" ^
  -H ^"sec-fetch-mode: cors^" ^
  -H ^"sec-fetch-site: same-site^" ^
  -H ^"user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^"

  Payload

  is_stripe_sdk=false&client_secret=pi_3U5wFDRhwGQO7Fk21wiBUxiA_secret_BRmIBABuGPE27LdqakuuiZh6l&key=pk_test_51TObKdRhwGQO7Fk2nvHMzE105eJO6YhksWpzE4vSPKwWc7Xxs8062CpHZ1PyMpoqpVoWYIeDEjhYQoq4ytvv3vhl005Tg7xCzI&_stripe_version=2026-03-25.dahlia

  Response

  {
  "id": "pi_3U5wFDRhwGQO7Fk21wiBUxiA",
  "object": "payment_intent",
  "allowed_payment_method_types": null,
  "amount": 50130,
  "amount_details": {
    "tip": {}
  },
  "automatic_payment_methods": null,
  "canceled_at": null,
  "cancellation_reason": null,
  "capture_method": "automatic",
  "client_secret": "pi_3U5wFDRhwGQO7Fk21wiBUxiA_secret_BRmIBABuGPE27LdqakuuiZh6l",
  "confirmation_method": "automatic",
  "created": 1787094995,
  "currency": "brl",
  "description": "Subscription creation",
  "excluded_payment_method_types": null,
  "last_payment_error": null,
  "livemode": false,
  "next_action": null,
  "payment_method": "pm_1U5wF3RhwGQO7Fk2FdPfz4ZS",
  "payment_method_configuration_details": null,
  "payment_method_types": [
    "card"
  ],
  "processing": null,
  "receipt_email": null,
  "setup_future_usage": "off_session",
  "shipping": null,
  "source": null,
  "status": "requires_confirmation"
}

curl --url ^"https://api.stripe.com/v1/payment_intents/pi_3U5wFDRhwGQO7Fk21wiBUxiA/confirm^" ^
  -H ^"accept: application/json^" ^
  -H ^"accept-language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"content-type: application/x-www-form-urlencoded^" ^
  -H ^"origin: https://js.stripe.com^" ^
  -H ^"priority: u=1, i^" ^
  -H ^"referer: https://js.stripe.com/^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  -H ^"sec-fetch-dest: empty^" ^
  -H ^"sec-fetch-mode: cors^" ^
  -H ^"sec-fetch-site: same-site^" ^
  -H ^"user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  --data-raw ^"payment_method=pm_1U5y2uRhwGQO7Fk2WrRvsdHS^&expected_payment_method_type=card^&use_stripe_sdk=true^&key=pk_test_51TObKdRhwGQO7Fk2nvHMzE105eJO6YhksWpzE4vSPKwWc7Xxs8062CpHZ1PyMpoqpVoWYIeDEjhYQoq4ytvv3vhl005Tg7xCzI^&_stripe_version=2026-03-25.dahlia^&client_attribution_metadata^[client_session_id^]=89ea0400-d1d7-4548-8f7e-ef00804a5eee^&client_attribution_metadata^[merchant_integration_source^]=l1^&client_secret=pi_3U5wFDRhwGQO7Fk21wiBUxiA_secret_BRmIBABuGPE27LdqakuuiZh6l^"

  Payload:
  payment_method=pm_1U5y2uRhwGQO7Fk2WrRvsdHS&expected_payment_method_type=card&use_stripe_sdk=true&key=pk_test_51TObKdRhwGQO7Fk2nvHMzE105eJO6YhksWpzE4vSPKwWc7Xxs8062CpHZ1PyMpoqpVoWYIeDEjhYQoq4ytvv3vhl005Tg7xCzI&_stripe_version=2026-03-25.dahlia&client_attribution_metadata[client_session_id]=89ea0400-d1d7-4548-8f7e-ef00804a5eee&client_attribution_metadata[merchant_integration_source]=l1&client_secret=pi_3U5wFDRhwGQO7Fk21wiBUxiA_secret_BRmIBABuGPE27LdqakuuiZh6l

  Response:
  {
  "id": "pi_3U5wFDRhwGQO7Fk21wiBUxiA",
  "object": "payment_intent",
  "allowed_payment_method_types": null,
  "amount": 50130,
  "amount_details": {
    "tip": {}
  },
  "automatic_payment_methods": null,
  "canceled_at": null,
  "cancellation_reason": null,
  "capture_method": "automatic",
  "client_secret": "pi_3U5wFDRhwGQO7Fk21wiBUxiA_secret_BRmIBABuGPE27LdqakuuiZh6l",
  "confirmation_method": "automatic",
  "created": 1787094995,
  "currency": "brl",
  "description": "Subscription creation",
  "excluded_payment_method_types": null,
  "last_payment_error": null,
  "livemode": false,
  "next_action": null,
  "payment_method": "pm_1U5y2uRhwGQO7Fk2WrRvsdHS",
  "payment_method_configuration_details": null,
  "payment_method_types": [
    "card"
  ],
  "processing": null,
  "receipt_email": null,
  "setup_future_usage": "off_session",
  "shipping": null,
  "source": null,
  "status": "succeeded"
}

curl --url 'http://localhost:3000/api/v1/onboarding/payment-intent/ack' \
  -H 'Accept: */*' \
  -H 'Accept-Language: en-US,en;q=0.9,pt;q=0.8' \
  -H 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcxMDE0NDUsIm5iZiI6MTc4NzEwMTQ0NSwiZXhwIjoxNzg3MTAyMzQ1LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.iJW2dsg4bQXhM1bj9NN_-VvLCT_HVooOVmS8cp_gLPo' \
  -H 'Connection: keep-alive' \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:5173' \
  -H 'Referer: http://localhost:5173/' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Site: same-site' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' \
  -H 'X-Eden-Country: BR' \
  -H 'sec-ch-ua: "Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  --data-raw '{"payment_intent_id":"pi_3U5wFDRhwGQO7Fk21wiBUxiA","payment_intent_status":"succeeded"}'

  Payload:
  {"payment_intent_id":"pi_3U5wFDRhwGQO7Fk21wiBUxiA","payment_intent_status":"succeeded"}

  Response:
  {
    "success": true,
    "data": {
        "order_id": 0,
        "stripe_payment_intent_id": "pi_3U5wFDRhwGQO7Fk21wiBUxiA",
        "stripe_payment_intent_status": "succeeded",
        "payment_state": "paid",
        "acked": true
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/payment-methods^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcxMDIxNjksIm5iZiI6MTc4NzEwMjE2OSwiZXhwIjoxNzg3MTAzMDY5LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.l4BNUJfu0Jisqrn--UyACTeXOImnJYxtjIDTZm3ObVs^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"If-None-Match: W/^\^"1a-s3B6blipWxCo2IriQlJeaz0uh7I^\^"^" ^
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

  Response:
  {
    "success": true,
    "data": [
        {
            "id": "pm_1U5y2uRhwGQO7Fk2WrRvsdHS",
            "brand": "visa",
            "last4": "4242",
            "exp_month": 4,
            "exp_year": 2027,
            "is_default": true
        },
        {
            "id": "pm_1U5xtARhwGQO7Fk28NKq8SEw",
            "brand": "visa",
            "last4": "4242",
            "exp_month": 4,
            "exp_year": 2027,
            "is_default": false
        },
        {
            "id": "pm_1U5xkBRhwGQO7Fk2NJuea4cY",
            "brand": "visa",
            "last4": "4242",
            "exp_month": 4,
            "exp_year": 2027,
            "is_default": false
        },
        {
            "id": "pm_1U5wF3RhwGQO7Fk2FdPfz4ZS",
            "brand": "visa",
            "last4": "4242",
            "exp_month": 1,
            "exp_year": 2027,
            "is_default": false
        }
    ]
}