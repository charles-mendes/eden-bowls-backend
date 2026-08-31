curl --url ^"http://localhost:3000/api/v1/auth/token^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"Content-Type: application/json^" ^
  -b ^"wp-settings-time-9=1784164593; wp-settings-1=mfold^%^3Do^%^26libraryContent^%^3Dbrowse^%^26editor^%^3Dtinymce^%^26posts_list_mode^%^3Dlist^%^26wcsearchfilterhposadmin^%^3Dcustomers; wp-settings-time-1=1784677533; _ga=GA1.1.1261753414.1785107044; _ga_EQDN3BWDSD=GS2.1.s1786567942^$o3^$g0^$t1786567942^$j60^$l0^$h0^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"X-Requested-With: XMLHttpRequest^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  --data-raw ^"^{^\^"username^\^":^\^"charlesmendes9^@gmail.com^\^",^\^"password^\^":^\^"doKrYbpRESGh4G^\^"^}^"

  {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk",
    "user_email": "charlesmendes9@gmail.com",
    "user_nicename": "charlesmendes9",
    "user_display_name": "Charles Mendes"
}

curl --url ^"http://localhost:3000/api/v1/onboarding/recommendation?country=BR^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"country^\^":^\^"BR^\^",^\^"pets^\^":^[^{^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"28.66^\^",^\^"weight_unit^\^":^\^"lb^\^",^\^"neutered^\^":false,^\^"name^\^":^\^"luna^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"pet_id^\^":^\^"526fb705-9da4-4d27-965e-da39a20d3b12^\^"^},^{^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"28.66^\^",^\^"weight_unit^\^":^\^"lb^\^",^\^"neutered^\^":false,^\^"name^\^":^\^"tobby^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"pet_id^\^":^\^"6bb99e76-16ad-44ab-9ac2-e3dbfd779d8e^\^"^}^]^}^"

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
                    "weight_unit": "lb",
                    "neutered": false
                }
            },
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
                "pet_id": "6bb99e76-16ad-44ab-9ac2-e3dbfd779d8e",
                "pet_name": "tobby",
                "pet": {
                    "id": "6bb99e76-16ad-44ab-9ac2-e3dbfd779d8e",
                    "name": "tobby",
                    "type": "dog",
                    "age": 2,
                    "age_years": 2,
                    "age_months": 0,
                    "weight": 13,
                    "breed": "Maltês",
                    "size": "small",
                    "activity_level": "high",
                    "pet_condition": "overweight",
                    "weight_unit": "lb",
                    "neutered": false
                }
            }
        ],
        "packaging": {
            "selected_frequency": "monthly",
            "period_days": 30,
            "suggested_frequency": "biweekly",
            "suggested_period_days": 14,
            "package_sizes_grams": [
                300,
                500
            ],
            "total_grams_per_day": 324,
            "total_target_grams": 9720,
            "suggested_bags_by_size": {
                "300": 0,
                "500": 20
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
                },
                {
                    "pet_id": "6bb99e76-16ad-44ab-9ac2-e3dbfd779d8e",
                    "pet_name": "tobby",
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
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"country^\^":^\^"BR^\^",^\^"pets^\^":^[^{^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"28.66^\^",^\^"weight_unit^\^":^\^"lb^\^",^\^"neutered^\^":false,^\^"name^\^":^\^"luna^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"pet_id^\^":^\^"526fb705-9da4-4d27-965e-da39a20d3b12^\^"^},^{^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"28.66^\^",^\^"weight_unit^\^":^\^"lb^\^",^\^"neutered^\^":false,^\^"name^\^":^\^"tobby^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"pet_id^\^":^\^"6bb99e76-16ad-44ab-9ac2-e3dbfd779d8e^\^"^}^]^}^"

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
                },
                {
                    "pet_id": "6bb99e76-16ad-44ab-9ac2-e3dbfd779d8e",
                    "pet_name": "tobby",
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
            },
            {
                "pet_id": "6bb99e76-16ad-44ab-9ac2-e3dbfd779d8e",
                "pet_name": "tobby",
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
                "key": "frango",
                "label": "Frango"
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

curl --url ^"http://localhost:3000/api/v1/onboarding/pets?country=BR^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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

  curl --url ^"http://localhost:3000/api/v1/onboarding/plan-selection^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"subscription_term_months^\^":1,^\^"country^\^":^\^"BR^\^",^\^"pets^\^":^[^{^\^"pet_name^\^":^\^"luna^\^",^\^"enabled^\^":true,^\^"selected_flavors^\^":^[^\^"frango^\^",^\^"bovino^\^"^],^\^"flavor_weights^\^":^[5,5^],^\^"pet_id^\^":^\^"526fb705-9da4-4d27-965e-da39a20d3b12^\^",^\^"breed^\^":^\^"Malt^ s^\^",^\^"age_years^\^":^\^"2^\^",^\^"age_months^\^":^\^"0^\^",^\^"weight^\^":^\^"28.66^\^",^\^"weight_unit^\^":^\^"lb^\^",^\^"size^\^":^\^"small^\^",^\^"activity_level^\^":^\^"high^\^",^\^"pet_condition^\^":^\^"overweight^\^",^\^"neutered^\^":false^}^]^}^"

  {
    "success": true,
    "data": {
        "plan_selection": {
            "subscription_term_months": 1,
            "catalog_pricing": {
                "currency": "BRL",
                "subtotal": 437.5,
                "discounted_first_month_total": 437.5,
                "line_items": [
                    {
                        "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                        "pet_name": "luna",
                        "flavor": "frango",
                        "quantity": 5,
                        "pack_size_grams": 500,
                        "pack_size_label": "500 g",
                        "variation_id": 1008,
                        "product_id": 100,
                        "currency": "BRL",
                        "unit_price": 42.5,
                        "line_total": 212.5
                    },
                    {
                        "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                        "pet_name": "luna",
                        "flavor": "bovino",
                        "quantity": 5,
                        "pack_size_grams": 500,
                        "pack_size_label": "500 g",
                        "variation_id": 1005,
                        "product_id": 100,
                        "currency": "BRL",
                        "unit_price": 45,
                        "line_total": 225
                    }
                ]
            },
            "flavors_by_pet": [
                {
                    "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                    "pet_name": "luna",
                    "flavors": {
                        "frango": 5,
                        "bovino": 5
                    }
                }
            ],
            "pets": [
                {
                    "pet_name": "luna",
                    "enabled": true,
                    "selected_flavors": [
                        "frango",
                        "bovino"
                    ],
                    "flavor_weights": [
                        5,
                        5
                    ],
                    "pet_id": "526fb705-9da4-4d27-965e-da39a20d3b12",
                    "breed": "Maltês",
                    "age_years": "2",
                    "age_months": "0",
                    "weight": "28.66",
                    "weight_unit": "lb",
                    "size": "small",
                    "activity_level": "high",
                    "pet_condition": "overweight",
                    "neutered": false
                }
            ],
            "country": "BR",
            "currency": "BRL",
            "validated_with": {
                "recommendation_version": "v1",
                "validated_at": "2026-08-31T01:33:08.263Z"
            },
            "updated_at": "2026-08-31T01:33:08.264Z"
        }
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/recurrence^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"frequency^\^":^\^"1 month^\^"^}^"

  {
    "success": true,
    "data": {
        "recurrence": {
            "frequency": "monthly",
            "period_days": 30,
            "updated_at": "2026-08-31T01:33:08.307Z"
        }
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/zipcode/lookup^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"Content-Type: application/json^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  --data-raw ^"^{^\^"zipcode^\^":^\^"83331-160^\^",^\^"country^\^":^\^"BR^\^"^}^"

  {
    "success": true,
    "data": {
        "status": "found",
        "country": "BR",
        "zipcode_input": "83331160",
        "zipcode": "83331160",
        "is_complete": true,
        "state": "PR",
        "city": "Pinhais",
        "street": "Rua Aristeu de Castro Fernandes",
        "neighborhood": "Maria Antonieta",
        "complement": "",
        "message": "Address found."
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/address^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"zipcode^\^":^\^"83331-160^\^",^\^"country^\^":^\^"BR^\^",^\^"state^\^":^\^"PR^\^",^\^"city^\^":^\^"Pinhais^\^",^\^"street^\^":^\^"Rua Aristeu de Castro Fernandes^\^",^\^"number^\^":^\^"941^\^",^\^"neighborhood^\^":^\^"Maria Antonieta^\^",^\^"complement^\^":^\^"Sobrado^\^",^\^"phone^\^":^\^"^\^",^\^"phone_country^\^":^\^"^\^",^\^"delivery_instructions^\^":^\^"^\^"^}^"

  {
    "success": true,
    "data": {
        "zipcode": {
            "zipcode": "83331160",
            "postal_code": "83331160",
            "country": "BR",
            "state": "PR",
            "city": "Pinhais",
            "street": "Rua Aristeu de Castro Fernandes",
            "number": "941",
            "neighborhood": "Maria Antonieta",
            "complement": "Sobrado",
            "phone": "",
            "phone_country": "",
            "delivery_instructions": "",
            "address_line1": "Rua Aristeu de Castro Fernandes",
            "address_line2": "Sobrado"
        }
    }
}

curl --url ^"http://localhost:3000/shipping/v1/calculate^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Connection: keep-alive^" ^
  -H ^"Content-Type: application/json^" ^
  -H ^"Origin: http://localhost:5173^" ^
  -H ^"Referer: http://localhost:5173/^" ^
  -H ^"Sec-Fetch-Dest: empty^" ^
  -H ^"Sec-Fetch-Mode: cors^" ^
  -H ^"Sec-Fetch-Site: same-site^" ^
  -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36^" ^
  -H ^"sec-ch-ua: ^\^"Not=A?Brand^\^";v=^\^"99^\^", ^\^"Google Chrome^\^";v=^\^"151^\^", ^\^"Chromium^\^";v=^\^"151^\^"^" ^
  -H ^"sec-ch-ua-mobile: ?0^" ^
  -H ^"sec-ch-ua-platform: ^\^"Windows^\^"^" ^
  --data-raw ^"^{^\^"zipCode^\^":^\^"83331-160^\^",^\^"country^\^":^\^"BR^\^"^}^"

  {
    "success": true,
    "data": {
        "distance": 7.37,
        "shipping": 7,
        "delivery_days": 2,
        "currency": "BRL",
        "distance_source": "osrm",
        "quoted_at": "2026-08-31T01:33:33.178Z",
        "label": "Entrega Eden Bowl",
        "distribution_center": {
            "name": "CD",
            "version": "1"
        },
        "breakdown": {
            "per_km": 0.95,
            "distance_km": 7.37,
            "road_factor": 1.3,
            "minimum_applied": false,
            "maximum_applied": false,
            "raw": 7
        },
        "destination": {
            "zipcode": "83331-160",
            "city": "Pinhais",
            "state": "PR"
        }
    }
}

curl --url ^"http://localhost:3000/api/v1/onboarding/shipping^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"rate_id^\^":^\^"distance_km:br-default^\^",^\^"method_id^\^":^\^"distance_km^\^",^\^"label^\^":^\^"Entrega Eden Bowl^\^",^\^"cost^\^":7,^\^"tax_total^\^":0,^\^"total^\^":7,^\^"instance_id^\^":0,^\^"delivery_days^\^":2,^\^"transit_business_days^\^":2,^\^"distance^\^":7.37,^\^"distance_source^\^":^\^"osrm^\^",^\^"per_km^\^":0.95,^\^"quoted_at^\^":^\^"2026-08-31T01:33:33.178Z^\^",^\^"zipcode^\^":^\^"83331-160^\^"^}^"

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
            "selected_at": "2026-08-31T01:33:33.178Z",
            "quoted_at": "2026-08-31T01:33:33.178Z",
            "distance": 7.37,
            "distance_source": "osrm",
            "per_km": 0.95,
            "zipcode": "83331-160",
            "snapshot": true
        }
    }
}

curl --url ^"https://api.stripe.com/v1/payment_methods^" ^
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
  --data-raw ^"type=card^&billing_details^[email^]=charlesmendes9^%^40gmail.com^&billing_details^[name^]=Charles+Mendes^&billing_details^[address^]^[postal_code^]=83331-160^&billing_details^[address^]^[country^]=BR^&card^[number^]=4242424242424242^&card^[cvc^]=123^&card^[exp_month^]=04^&card^[exp_year^]=27^&guid=NA^&muid=NA^&sid=NA^&payment_user_agent=stripe.js^%^2Fb0f5e7abe5^%^3B+stripe-js-v3^%^2Fb0f5e7abe5^%^3B+card-element^&referrer=http^%^3A^%^2F^%^2Flocalhost^%^3A5173^&time_on_page=69578^&client_attribution_metadata^[client_session_id^]=99b06b50-fa41-4d8b-b3af-b647bd961da5^&client_attribution_metadata^[merchant_integration_source^]=elements^&client_attribution_metadata^[merchant_integration_subtype^]=card-element^&client_attribution_metadata^[merchant_integration_version^]=2017^&client_attribution_metadata^[wallet_config_id^]=e8c50807-f182-4946-8f97-08cce7cbe45b^&key=pk_test_51TObKdRhwGQO7Fk2nvHMzE105eJO6YhksWpzE4vSPKwWc7Xxs8062CpHZ1PyMpoqpVoWYIeDEjhYQoq4ytvv3vhl005Tg7xCzI^&_stripe_version=2026-03-25.dahlia^&radar_options^[hcaptcha_token^]=20000000-aaaa-bbbb-cccc-000000000002^"

  {
  "id": "pm_1UAK6ZRhwGQO7Fk2M7FOqZRZ",
  "object": "payment_method",
  "allow_redisplay": "unspecified",
  "billing_details": {
    "address": {
      "city": null,
      "country": "BR",
      "line1": null,
      "line2": null,
      "postal_code": "83331-160",
      "state": null
    },
    "email": "charlesmendes9@gmail.com",
    "name": "Charles Mendes",
    "phone": null,
    "tax_id": null
  },
  "card": {
    "brand": "visa",
    "checks": {
      "address_line1_check": null,
      "address_postal_code_check": null,
      "cvc_check": null
    },
    "country": "US",
    "display_brand": "visa",
    "exp_month": 4,
    "exp_year": 2027,
    "funding": "credit",
    "generated_from": null,
    "last4": "4242",
    "networks": {
      "available": [
        "visa"
      ],
      "preferred": null
    },
    "regulated_status": "unregulated",
    "three_d_secure_usage": {
      "supported": true
    },
    "wallet": null
  },
  "created": 1788140027,
  "customer": null,
  "customer_account": null,
  "livemode": false,
  "radar_options": {},
  "shared_payment_granted_token": null,
  "type": "card"
}

curl --url ^"http://localhost:3000/api/v1/onboarding/shipping^" ^
  -H ^"Accept: */*^" ^
  -H ^"Accept-Language: en-US,en;q=0.9,pt;q=0.8^" ^
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"rate_id^\^":^\^"distance_km:br-default^\^",^\^"method_id^\^":^\^"distance_km^\^",^\^"label^\^":^\^"Entrega Eden Bowl^\^",^\^"cost^\^":7,^\^"tax_total^\^":0,^\^"total^\^":7,^\^"instance_id^\^":0,^\^"delivery_days^\^":2,^\^"transit_business_days^\^":2,^\^"distance^\^":7.37,^\^"distance_source^\^":^\^"osrm^\^",^\^"per_km^\^":0.95,^\^"quoted_at^\^":^\^"2026-08-31T01:33:33.178Z^\^",^\^"zipcode^\^":^\^"83331-160^\^"^}^"

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
            "selected_at": "2026-08-31T01:33:33.178Z",
            "quoted_at": "2026-08-31T01:33:33.178Z",
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
  -H ^"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJpYXQiOjE3ODgxMzk5ODgsIm5iZiI6MTc4ODEzOTk4OCwiZXhwIjoxNzg4MTQwODg4LCJkYXRhIjp7InVzZXIiOnsiaWQiOjV9fX0.TCo9uNDOoui18-OZri67nMrdFVL3u_myZ0O9GgEcGIk^" ^
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
  --data-raw ^"^{^\^"billing^\^":^{^\^"email^\^":^\^"charlesmendes9^@gmail.com^\^",^\^"phone^\^":^\^"^\^",^\^"first_name^\^":^\^"Charles^\^",^\^"last_name^\^":^\^"Mendes^\^",^\^"company^\^":^\^"^\^"^},^\^"payment_method_id^\^":^\^"pm_1UAK6ZRhwGQO7Fk2M7FOqZRZ^\^"^}^"


  {
    "success": false,
    "message": "Onboarding checkout is incomplete.",
    "details": {
        "code": "session_incomplete",
        "missing": [
            "pets"
        ]
    }
}