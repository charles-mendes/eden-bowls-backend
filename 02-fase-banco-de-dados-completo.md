# Eden Bowls - Fase 2 - Projeto Completo de Banco de Dados (MySQL)

Escopo desta fase:

1. definir entidades do sistema
2. definir relacionamentos
3. definir indices
4. definir constraints
5. definir estrategia de migrations

Fora de escopo:

1. codigo da aplicacao
2. implementacao de repositories/services
3. scripts de deploy

## 1) Premissas e diretrizes

1. Banco oficial: MySQL 8.
2. Persistencia orientada a dominio, sem padroes de WordPress (meta/options/transients).
3. JSON apenas para snapshot e payload externo, nunca como substituto de coluna consultada frequentemente.
4. Todas as entidades criticas com created_at e updated_at.
5. Todas as operacoes sensiveis com rastreabilidade por correlation_id quando aplicavel.
6. Regras pendentes de negocio ficam configuraveis em tabela de configuracao (sem hardcode).

## 2) Convencoes de modelagem

1. Nome de tabela no plural e snake_case.
2. Chaves primarias em uuid (char(36)) para desacoplamento entre dominios.
3. Valores monetarios em decimal(12,2).
4. Datas em datetime(3) para precisao de eventos.
5. Status com enum quando fechado, varchar quando aberto a expansao controlada.
6. Soft delete apenas quando necessario (ex: pets, addresses).

## 3) Entidades por dominio

## 3.1 Identidade e acesso

### users

1. id (pk)
2. email (unique)
3. password_hash
4. status (pending, active, blocked)
5. email_verified_at nullable
6. last_login_at nullable
7. created_at
8. updated_at

### roles

1. id (pk)
2. code (unique) -> admin, operator, readonly, customer
3. name
4. created_at
5. updated_at

### permissions

1. id (pk)
2. resource
3. action
4. code (unique)
5. created_at

### role_permissions

1. id (pk)
2. role_id (fk)
3. permission_id (fk)
4. unique(role_id, permission_id)

### user_roles

1. id (pk)
2. user_id (fk)
3. role_id (fk)
4. unique(user_id, role_id)

### refresh_tokens

1. id (pk)
2. user_id (fk)
3. token_hash
4. family_id
5. revoked_at nullable
6. expires_at
7. created_at

### otp_challenges

1. id (pk)
2. user_id (fk)
3. otp_hash
4. purpose (register, password_reset)
5. attempts
6. resend_count
7. consumed_at nullable
8. expires_at
9. created_at
10. updated_at

## 3.2 Perfil de cliente

### user_profiles

1. user_id (pk, fk users.id)
2. full_name
3. phone
4. phone_country
5. avatar_url nullable
6. delivery_instructions nullable
7. created_at
8. updated_at

### user_addresses

1. id (pk)
2. user_id (fk)
3. type (billing, shipping)
4. is_default
5. country
6. state
7. city
8. postcode
9. address_1
10. address_2 nullable
11. deleted_at nullable
12. created_at
13. updated_at

## 3.3 Pets e onboarding

### breeds

1. id (pk)
2. species
3. name_pt
4. name_en
5. size nullable
6. created_at
7. updated_at

### pets

1. id (pk)
2. user_id nullable (fk users.id)
3. name
4. species
5. breed_id nullable (fk breeds.id)
6. sex nullable
7. birth_date nullable
8. weight_kg
9. neutered
10. activity_level
11. body_condition_score nullable
12. nutrition_goal nullable
13. restrictions_json nullable
14. deleted_at nullable
15. created_at
16. updated_at

### onboarding_sessions

1. id (pk)
2. status (started, in_progress, ready_for_checkout, completed, abandoned)
3. linked_user_id nullable (fk users.id)
4. locale
5. country
6. state nullable
7. token_hash
8. expires_at
9. created_at
10. updated_at

### onboarding_session_pets

1. id (pk)
2. session_id (fk)
3. pet_id (fk)
4. sort_order
5. created_at
6. unique(session_id, pet_id)

### onboarding_answers

1. id (pk)
2. session_id (fk)
3. step_key
4. answer_json
5. created_at
6. updated_at
7. unique(session_id, step_key)

## 3.4 Recomendacao e plano

### recommendation_runs

1. id (pk)
2. session_id (fk)
3. recommendation_version
4. market_country
5. currency
6. total_daily_grams
7. total_monthly_grams
8. created_at

### recommendation_pet_results

1. id (pk)
2. run_id (fk)
3. pet_id (fk)
4. daily_grams
5. monthly_grams
6. kcal_target nullable
7. factors_json nullable
8. created_at

### plan_snapshots

1. id (pk)
2. run_id (fk)
3. snapshot_hash (unique)
4. subtotal_amount
5. discount_amount
6. shipping_amount nullable
7. total_amount
8. currency
9. payload_json
10. created_at

## 3.5 Catalogo e precificacao

### categories

1. id (pk)
2. slug (unique)
3. name_pt
4. name_en
5. active
6. created_at
7. updated_at

### products

1. id (pk)
2. category_id (fk)
3. slug (unique)
4. name_pt
5. name_en
6. description_pt nullable
7. description_en nullable
8. active
9. created_at
10. updated_at

### product_variants

1. id (pk)
2. product_id (fk)
3. sku (unique)
4. flavor_key
5. weight_label
6. grams
7. active
8. created_at
9. updated_at

### product_market_config

1. id (pk)
2. product_id (fk)
3. market_country
4. currency
5. plan_days
6. is_plan_product
7. active
8. created_at
9. updated_at
10. unique(product_id, market_country, currency)

### variant_prices

1. id (pk)
2. variant_id (fk)
3. currency
4. regular_price
5. sale_price nullable
6. sale_from nullable
7. sale_to nullable
8. source
9. created_at
10. updated_at

### subscription_terms

1. id (pk)
2. market_country
3. months
4. discount_percent
5. active
6. effective_from
7. effective_to nullable
8. created_at
9. updated_at

## 3.6 Shipping

### shipping_quotes

1. id (pk)
2. session_id (fk)
3. provider (manual_local, usps, correios, melhor_envio, custom)
4. destination_country
5. destination_postcode
6. currency
7. subtotal
8. selected_rate_id nullable
9. expires_at
10. created_at

### shipping_quote_rates

1. id (pk)
2. quote_id (fk)
3. external_rate_id nullable
4. service_code
5. service_label
6. amount
7. eta_min_days nullable
8. eta_max_days nullable
9. raw_json nullable
10. created_at

## 3.7 Checkout e pedidos

### checkout_orders

1. id (pk)
2. session_id (fk)
3. user_id (fk)
4. plan_snapshot_id (fk)
5. status (draft, pending_payment, paid, failed, cancelled)
6. currency
7. subtotal
8. shipping_total
9. total
10. payment_state
11. metadata_json nullable
12. created_at
13. updated_at

### checkout_order_items

1. id (pk)
2. order_id (fk)
3. product_id (fk)
4. variant_id (fk)
5. quantity
6. unit_price
7. line_total
8. payload_json nullable
9. created_at

### checkout_shipping_selection

1. id (pk)
2. order_id (fk)
3. quote_id (fk)
4. rate_id (fk shipping_quote_rates.id)
5. label
6. cost
7. tax_total
8. total
9. raw_json nullable
10. created_at

### orders

1. id (pk)
2. checkout_order_id (fk)
3. user_id (fk)
4. status (new, confirmed, preparing, shipped, delivered, cancelled)
5. created_at
6. updated_at

### order_status_history

1. id (pk)
2. order_id (fk)
3. from_status nullable
4. to_status
5. reason nullable
6. changed_by_user_id nullable
7. created_at

## 3.8 Assinaturas e billing

### subscriptions

1. id (pk)
2. user_id (fk)
3. order_id (fk checkout_orders.id)
4. provider (stripe)
5. provider_subscription_id (unique)
6. status (active, paused, past_due, cancelled)
7. auto_renew
8. term_id (fk subscription_terms.id)
9. start_at
10. end_at nullable
11. next_billing_at nullable
12. next_shipment_at nullable
13. recurrence_json
14. plan_snapshot_json
15. created_at
16. updated_at

### subscription_items

1. id (pk)
2. subscription_id (fk)
3. variant_id (fk)
4. quantity
5. unit_price
6. line_total
7. created_at

### subscription_events

1. id (pk)
2. subscription_id (fk)
3. source (api, webhook, system)
4. event_type
5. payload_json nullable
6. created_at

### payment_attempts

1. id (pk)
2. subscription_id (fk)
3. invoice_ref nullable
4. attempt_number
5. status
6. failure_code nullable
7. next_retry_at nullable
8. created_at

### stripe_customers

1. id (pk)
2. user_id (fk)
3. stripe_customer_id (unique)
4. email
5. metadata_json nullable
6. created_at
7. updated_at

### stripe_payment_methods

1. id (pk)
2. stripe_customer_ref_id (fk stripe_customers.id)
3. stripe_payment_method_id (unique)
4. brand nullable
5. last4 nullable
6. exp_month nullable
7. exp_year nullable
8. is_default
9. created_at
10. updated_at

### stripe_product_price_map

1. id (pk)
2. variant_id (fk)
3. currency
4. stripe_product_id
5. stripe_price_id
6. fingerprint
7. synced_at
8. created_at
9. updated_at
10. unique(variant_id, currency)

### webhook_events

1. id (pk)
2. provider
3. event_id
4. event_type
5. payload_hash
6. state (processing, processed, failed)
7. attempts
8. next_retry_at nullable
9. correlation_id nullable
10. payload_json
11. error_message nullable
12. processed_at nullable
13. created_at
14. updated_at
15. unique(provider, event_id)

### idempotency_keys

1. id (pk)
2. scope
3. key
4. request_hash
5. response_json nullable
6. status_code nullable
7. expires_at
8. created_at
9. unique(scope, key)

## 3.9 Configuracao, auditoria e operacao

### business_rules_config

1. id (pk)
2. domain
3. key
4. market_country nullable
5. value_json
6. active
7. effective_from
8. effective_to nullable
9. created_at
10. updated_at
11. unique(domain, key, market_country, effective_from)

### audit_logs

1. id (pk)
2. actor_user_id nullable
3. actor_role nullable
4. action
5. resource
6. resource_id
7. before_json nullable
8. after_json nullable
9. correlation_id nullable
10. created_at

### email_messages

1. id (pk)
2. template_key
3. recipient_email
4. provider
5. status (queued, sent, failed)
6. error_message nullable
7. payload_json nullable
8. created_at
9. sent_at nullable

## 4) Relacionamentos principais

1. users 1:N user_addresses
2. users 1:1 user_profiles
3. users N:N roles (via user_roles)
4. onboarding_sessions 1:N onboarding_answers
5. onboarding_sessions N:N pets (via onboarding_session_pets)
6. onboarding_sessions 1:N recommendation_runs
7. recommendation_runs 1:N recommendation_pet_results
8. recommendation_runs 1:N plan_snapshots
9. checkout_orders N:1 onboarding_sessions
10. checkout_orders N:1 plan_snapshots
11. checkout_orders 1:N checkout_order_items
12. checkout_orders 1:1 orders
13. subscriptions N:1 checkout_orders
14. subscriptions 1:N subscription_items
15. subscriptions 1:N subscription_events
16. subscriptions 1:N payment_attempts
17. webhook_events relaciona por mapeamento com subscriptions/orders

## 5) Indices recomendados por caso de uso

## 5.1 Auth e seguranca

1. users(email)
2. refresh_tokens(user_id, expires_at)
3. otp_challenges(user_id, purpose, expires_at)

## 5.2 Onboarding e recomendacao

1. onboarding_sessions(status, expires_at, updated_at)
2. onboarding_session_pets(session_id, sort_order)
3. recommendation_runs(session_id, created_at)
4. plan_snapshots(snapshot_hash)

## 5.3 Catalogo e pricing

1. product_variants(product_id, active)
2. variant_prices(variant_id, currency, sale_from, sale_to)
3. subscription_terms(market_country, months, active, effective_from)

## 5.4 Checkout, pedidos e assinatura

1. checkout_orders(user_id, status, created_at)
2. orders(user_id, status, created_at)
3. subscriptions(user_id, status, next_billing_at)
4. subscription_events(subscription_id, created_at)
5. payment_attempts(subscription_id, status, next_retry_at)

## 5.5 Billing e operacao

1. webhook_events(provider, state, next_retry_at)
2. webhook_events(provider, event_id)
3. idempotency_keys(scope, key)
4. audit_logs(resource, resource_id, created_at)

## 6) Constraints de integridade recomendadas

1. variant_prices.regular_price >= 0
2. variant_prices.sale_price is null or sale_price <= regular_price
3. subscription_terms.discount_percent >= 0 and <= 100
4. checkout_orders.total = subtotal + shipping_total (validado por aplicacao + trigger opcional)
5. payment_attempts.attempt_number > 0
6. shipping_quotes.expires_at > created_at
7. unique de webhook por provider/event_id
8. unique de idempotencia por scope/key

## 7) Regras pendentes modeladas como configuracao

Pendencias nao bloqueantes ficam em business_rules_config:

1. desconto de 12 meses por mercado
2. politica de retry de pagamento
3. regra de proracao de upgrade/downgrade

Beneficio:

1. muda regra sem refatoracao estrutural
2. altera comportamento sem deploy de schema

## 8) Estrategia de migrations (sem codigo)

## 8.1 Ordem de migrations

1. M001: core auth (users, roles, permissions, user_roles, role_permissions, refresh_tokens, otp_challenges)
2. M002: perfil cliente (user_profiles, user_addresses)
3. M003: catalogo (categories, products, product_variants, product_market_config, variant_prices)
4. M004: onboarding (breeds, pets, onboarding_sessions, onboarding_session_pets, onboarding_answers)
5. M005: recomendacao (recommendation_runs, recommendation_pet_results, plan_snapshots)
6. M006: shipping (shipping_quotes, shipping_quote_rates)
7. M007: checkout e pedidos (checkout_orders, checkout_order_items, checkout_shipping_selection, orders, order_status_history)
8. M008: assinaturas e billing core (subscription_terms, subscriptions, subscription_items, subscription_events, payment_attempts)
9. M009: stripe (stripe_customers, stripe_payment_methods, stripe_product_price_map, webhook_events, idempotency_keys)
10. M010: operacao (business_rules_config, audit_logs, email_messages)

## 8.2 Politica de evolucao

1. migration sempre backward-compatible quando possivel
2. proibido drop de coluna em release sem janela de deprecacao
3. dados sensiveis com politica de retention definida por produto/compliance
4. seeds apenas para roles, permissions, termos iniciais e configuracoes base

## 9) Plano de seeds iniciais

1. roles:
   - admin
   - operator
   - readonly
   - customer
2. permissions por resource/action para admin e operator
3. subscription_terms com registros ativos por mercado (valores configuraveis)
4. business_rules_config com placeholders para:
   - retry_policy
   - proration_policy
   - discount_policy

## 10) Criterios de pronto da fase 2

1. entidades e relacionamentos revisados e aprovados
2. indices e constraints revisados para os fluxos criticos
3. ordem de migrations aprovada
4. seeds iniciais aprovados
5. regras pendentes documentadas como configuraveis
