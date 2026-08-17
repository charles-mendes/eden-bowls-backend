curl --url 'http://localhost:3000/api/v1/auth/refresh' \
  -X 'POST' \
  -H 'Accept: */*' \
  -H 'Accept-Language: en-US,en;q=0.9,pt;q=0.8' \
  -H 'Connection: keep-alive' \
  -H 'Content-Length: 0' \
  -b 'eden_refresh_token=mRLfkDxNSO7iq9LxGEVZt9iGiaz0LlntwAC2Ev57o5fWXU1dHTZBHD6BJ-cH1KvtJLV_VU9C55-k9_lROT3Bgw; wp-settings-time-9=1784164593; wp-settings-1=mfold%3Do%26libraryContent%3Dbrowse%26editor%3Dtinymce%26posts_list_mode%3Dlist%26wcsearchfilterhposadmin%3Dcustomers; wp-settings-time-1=1784677533; _ga=GA1.1.1261753414.1785107044; _ga_EQDN3BWDSD=GS2.1.s1786567942$o3$g0$t1786567942$j60$l0$h0' \
  -H 'Origin: http://localhost:5173' \
  -H 'Referer: http://localhost:5173/' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Site: same-site' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'sec-ch-ua: "Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"'

  Response:
  {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcwMDkzMjgsIm5iZiI6MTc4NzAwOTMyOCwiZXhwIjoxNzg3MDEwMjI4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.GJXXPzzvRZlpu4k7N3FHbXsGUQQjxu0JGDNnIMm0Ub4",
    "user_email": "fihesob418@beiwoh.com",
    "user_nicename": "fihe-sob-8835",
    "user_display_name": "fihe_sob_8835"
}

Cookie:
eden_refresh_token	8lJpfcvSSupP0GdSfz3-DeY6_Cy8z-If_d0ats7b0jTywofuE_kK4sw_3YRrZUJoPWrXZcRaK6X9rI9I8BJn6A	localhost	/api/v1/auth	30 days	165	✓		Lax			Medium

curl --url ^"http://localhost:3000/api/v1/subscriptions^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcwMDkzMjgsIm5iZiI6MTc4NzAwOTMyOCwiZXhwIjoxNzg3MDEwMjI4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.GJXXPzzvRZlpu4k7N3FHbXsGUQQjxu0JGDNnIMm0Ub4^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"If-None-Match: W/^\^"2fe-UjNVwMjHUJquNK33T0XYB3v3k58^\^"^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^"

  Response:
  {
    "success": true,
    "data": {
        "subscriptions": [
            {
                "subscription_id": "sub_123",
                "stripe_subscription_id": "sub_123",
                "legacy_subscription_id": null,
                "slug": "premium-plan",
                "plan_label": "Premium",
                "status": "active",
                "stripe_subscription_status": "active",
                "contract_label": "Premium Plan",
                "start_date": "2026-01-01T00:00:00.000Z",
                "end_date": null,
                "end_date_source": null,
                "current_period_start": "2026-08-01T00:00:00.000Z",
                "current_period_end": "2026-09-01T00:00:00.000Z",
                "next_billing_date": "2026-09-01T00:00:00.000Z",
                "next_billing_source": "stripe",
                "next_shipment_date": "2026-08-15T00:00:00.000Z",
                "next_shipment_source": "plan_selection",
                "next_shipment_context": {
                    "shipping_window": "weekly"
                },
                "pets_names": [
                    "Milo"
                ],
                "pet_ids": [
                    "pet_1"
                ],
                "packs_per_month": 2,
                "order_total_per_month": 60
            }
        ],
        "count": 1
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/pets?country=BR^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcwMDkzMjgsIm5iZiI6MTc4NzAwOTMyOCwiZXhwIjoxNzg3MDEwMjI4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.GJXXPzzvRZlpu4k7N3FHbXsGUQQjxu0JGDNnIMm0Ub4^" ^
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

  Body Request:
  country=BR

  Response:
  {
    "success": true,
    "data": {
        "country": "BR",
        "currency": "BRL",
        "pets": [
            {
                "id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                "name": "luna",
                "breed": "Maltês",
                "age_years": 2,
                "age_months": 0,
                "age": 2,
                "weight_input": 13,
                "weight_unit": "kg",
                "weight": 13,
                "size": "small",
                "activity_level": "high",
                "pet_condition": "overweight",
                "neutered": false,
                "image_url": ""
            }
        ]
    }
}

curl --url ^"http://localhost:3000/api/v1/products?category_slug=flavors^&country=BR^" ^
  -H ^"Accept: application/json^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Cache-Control: no-cache^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Pragma: no-cache^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^"

  Body Request:
  category_slug=flavors&country=BR

  Response:
  {
    "success": true,
    "data": {
        "country": "BR",
        "currency": "BRL",
        "category": {
            "id": 10,
            "slug": "flavors",
            "name": "Flavors"
        },
        "products": [
            {
                "product_id": 100,
                "name": "Flavors BR",
                "slug": "flavors-br",
                "country": "BR",
                "currency": "BRL",
                "days": 30,
                "tags": [
                    {
                        "id": 21,
                        "name": "beef",
                        "slug": "beef"
                    },
                    {
                        "id": 22,
                        "name": "fish",
                        "slug": "fish"
                    },
                    {
                        "id": 23,
                        "name": "pork",
                        "slug": "pork"
                    },
                    {
                        "id": 24,
                        "name": "turkey",
                        "slug": "turkey"
                    }
                ],
                "starting_price": 22.5,
                "variations": [
                    {
                        "variation_id": 1001,
                        "flavor": "Beef",
                        "weight": "300g",
                        "price": 25,
                        "currency": "BRL"
                    },
                    {
                        "variation_id": 1002,
                        "flavor": "Fish",
                        "weight": "300g",
                        "price": 35,
                        "currency": "BRL"
                    },
                    {
                        "variation_id": 1003,
                        "flavor": "Pork",
                        "weight": "300g",
                        "price": 25,
                        "currency": "BRL"
                    },
                    {
                        "variation_id": 1004,
                        "flavor": "Turkey",
                        "weight": "300g",
                        "price": 22.5,
                        "currency": "BRL"
                    },
                    {
                        "variation_id": 1005,
                        "flavor": "Beef",
                        "weight": "500g",
                        "price": 45,
                        "currency": "BRL"
                    },
                    {
                        "variation_id": 1006,
                        "flavor": "Fish",
                        "weight": "500g",
                        "price": 65,
                        "currency": "BRL"
                    },
                    {
                        "variation_id": 1007,
                        "flavor": "Pork",
                        "weight": "500g",
                        "price": 45,
                        "currency": "BRL"
                    },
                    {
                        "variation_id": 1008,
                        "flavor": "Turkey",
                        "weight": "500g",
                        "price": 42.5,
                        "currency": "BRL"
                    }
                ]
            }
        ],
        "empty": false
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/recommendation?country=BR^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcwMDkzMjgsIm5iZiI6MTc4NzAwOTMyOCwiZXhwIjoxNzg3MDEwMjI4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.GJXXPzzvRZlpu4k7N3FHbXsGUQQjxu0JGDNnIMm0Ub4^" ^
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
  --data-raw ^"^{^\^"country^\^":^\^"BR^\^",^\^"pets^\^":^[^{^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"13^\^",^\^"weight_unit^\^":^\^"kg^\^",^\^"neutered^\^":false,^\^"name^\^":^\^"luna^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"pet_id^\^":^\^"526fb705-9da4-4d27-965e-da39a20d3b12^\^"^}^]^}^"

  body request:
  {"country":"BR","pets":[{"age_years":"2","age_months":"0","weight":"13","weight_unit":"kg","neutered":false,"name":"luna","breed":"Maltês","size":"small","activity_level":"high","pet_condition":"overweight","pet_id":"526fb705-9da4-4d27-965e-da39a20d3b12"}]}

  Response:
  {
    "success": true,
    "data": {
        "country": "BR",
        "recommendations": [
            {
                "energia_kcal_dia": 582,
                "quantidade_g_dia": 162,
                "refeicoes": 2,
                "quantidade_por_refeicao": 81,
                "fator_aplicado": 85,
                "porte": "pequeno",
                "especie": "dog",
                "nem_kcal_kg": 3600,
                "decision_trace": [
                    "base:130",
                    "combination_override:NAO-ALTO-ACIMA:85"
                ],
                "display": {
                    "energy_label": "Energia",
                    "energy_unit": "kcal/dia",
                    "food_label": "Alimento",
                    "food_unit": "g/dia",
                    "meals_label": "Refeicoes/dia",
                    "per_meal_label": "Por refeicao",
                    "per_meal_unit": "g"
                },
                "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                "pet_name": "luna",
                "pet": {
                    "id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                    "name": "luna",
                    "type": "dog",
                    "age": 2,
                    "age_years": 2,
                    "age_months": 0,
                    "weight": 13,
                    "breed": "Maltês",
                    "size": "small",
                    "activity_level": "high",
                    "pet_condition": "overweight",
                    "weight_unit": "kg",
                    "neutered": false
                }
            }
        ],
        "packaging": {
            "selected_frequency": "monthly",
            "period_days": 30,
            "suggested_frequency": "monthly",
            "suggested_period_days": 30,
            "package_sizes_grams": [
                300,
                500
            ],
            "total_grams_per_day": 162,
            "total_target_grams": 4860,
            "suggested_bags_by_size": {
                "300": 0,
                "500": 10
            }
        },
        "simplified": {
            "country": "BR",
            "period_days": 30,
            "labels": {
                "daily": "Diário",
                "monthly": "Mensal",
                "packs": "Packs"
            },
            "pets": [
                {
                    "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                    "pet_name": "luna",
                    "daily": {
                        "value": 162,
                        "unit": "g/dia",
                        "grams": 162,
                        "formatted": "162 g/dia"
                    },
                    "monthly": {
                        "value": 4.86,
                        "unit": "kg/mês",
                        "grams": 4860,
                        "formatted": "4,86 kg/mês"
                    },
                    "packs": {
                        "count": 10,
                        "pack_size_grams": 500,
                        "pack_size_value": 500,
                        "pack_size_unit": "g",
                        "formatted": "10 packs de 500 g/mês"
                    }
                }
            ]
        },
        "version": "v1"
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/plan/snapshot?country=BR^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcwMDkzMjgsIm5iZiI6MTc4NzAwOTMyOCwiZXhwIjoxNzg3MDEwMjI4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.GJXXPzzvRZlpu4k7N3FHbXsGUQQjxu0JGDNnIMm0Ub4^" ^
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
  --data-raw ^"^{^\^"country^\^":^\^"BR^\^",^\^"pets^\^":^[^{^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"13^\^",^\^"weight_unit^\^":^\^"kg^\^",^\^"neutered^\^":false,^\^"name^\^":^\^"luna^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"pet_id^\^":^\^"526fb705-9da4-4d27-965e-da39a20d3b12^\^"^}^]^}^"

  body request:
  {"country":"BR","pets":[{"age_years":"2","age_months":"0","weight":"13","weight_unit":"kg","neutered":false,"name":"luna","breed":"Maltês","size":"small","activity_level":"high","pet_condition":"overweight","pet_id":"526fb705-9da4-4d27-965e-da39a20d3b12"}]}

  Response:

  {
    "success": true,
    "data": {
        "country": "BR",
        "currency": "BRL",
        "labels": {
            "daily": "Diário",
            "monthly": "Mensal",
            "packs": "Packs"
        },
        "consumption": {
            "labels": {
                "daily": "Diário",
                "monthly": "Mensal",
                "packs": "Packs"
            },
            "pets": [
                {
                    "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                    "pet_name": "luna",
                    "daily": {
                        "value": 162,
                        "unit": "g/dia",
                        "grams": 162,
                        "formatted": "162 g/dia"
                    },
                    "monthly": {
                        "value": 4.86,
                        "unit": "kg/mês",
                        "grams": 4860,
                        "formatted": "4,86 kg/mês"
                    },
                    "packs": {
                        "count": 10,
                        "pack_size_grams": 500,
                        "pack_size_value": 500,
                        "pack_size_unit": "g",
                        "formatted": "10 packs de 500 g/mês"
                    }
                }
            ]
        },
        "pets": [
            {
                "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                "pet_name": "luna",
                "daily": {
                    "value": 162,
                    "unit": "g/dia",
                    "grams": 162,
                    "formatted": "162 g/dia"
                },
                "monthly": {
                    "value": 4.86,
                    "unit": "kg/mês",
                    "grams": 4860,
                    "formatted": "4,86 kg/mês"
                },
                "packs": {
                    "count": 10,
                    "pack_size_grams": 500,
                    "pack_size_value": 500,
                    "pack_size_unit": "g",
                    "formatted": "10 packs de 500 g/mês"
                }
            }
        ],
        "flavor_options": [
            {
                "key": "beef",
                "label": "Bovino"
            },
            {
                "key": "fish",
                "label": "Peixe"
            },
            {
                "key": "pork",
                "label": "Porco"
            },
            {
                "key": "turkey",
                "label": "Peru"
            }
        ],
        "plan_terms": [
            {
                "subscription_term_months": 1,
                "discount_percent": 10
            },
            {
                "subscription_term_months": 3,
                "discount_percent": 25
            },
            {
                "subscription_term_months": 6,
                "discount_percent": 40
            }
        ]
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/discount/eligibility?country=BR^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcwMDkzMjgsIm5iZiI6MTc4NzAwOTMyOCwiZXhwIjoxNzg3MDEwMjI4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.GJXXPzzvRZlpu4k7N3FHbXsGUQQjxu0JGDNnIMm0Ub4^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"If-None-Match: W/^\^"48-KqDxcmWuhsx9I3DV3hAcSgo9b7g^\^"^" ^
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

  body request:
  country=BR

  Response:
  {"success":true,"data":{"validated":true,"eligible":true,"reason":null}}

  curl --url ^"http://localhost:3000/api/v1/onboarding/plan/preview^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODcwMDkzMjgsIm5iZiI6MTc4NzAwOTMyOCwiZXhwIjoxNzg3MDEwMjI4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjR9fX0.GJXXPzzvRZlpu4k7N3FHbXsGUQQjxu0JGDNnIMm0Ub4^" ^
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
  --data-raw ^"^{^\^"subscription_term_months^\^":1,^\^"country^\^":^\^"BR^\^",^\^"pets^\^":^[^{^\^"pet_name^\^":^\^"luna^\^",^\^"enabled^\^":true,^\^"selected_flavors^\^":^[^],^\^"flavor_weights^\^":^[^],^\^"pet_id^\^":^\^"526fb705-9da4-4d27-965e-da39a20d3b12^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"13^\^",^\^"weight_unit^\^":^\^"kg^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"neutered^\^":false^}^]^}^"

  Body Request:

  {"subscription_term_months":1,"country":"BR","pets":[{"pet_name":"luna","enabled":true,"selected_flavors":[],"flavor_weights":[],"pet_id":"526fb705-9da4-4d27-965e-da39a20d3b12","breed":"Maltês","age_years":"2","age_months":"0","weight":"13","weight_unit":"kg","size":"small","activity_level":"high","pet_condition":"overweight","neutered":false}]}

  Response:
  {
    "success": false,
    "message": "Plan preview payload is invalid.",
    "code": "invalid_plan_preview_payload",
    "data": {
        "status": 422,
        "errors": {
            "pets.0.selected_flavors": "At least one flavor is required."
        }
    }
}