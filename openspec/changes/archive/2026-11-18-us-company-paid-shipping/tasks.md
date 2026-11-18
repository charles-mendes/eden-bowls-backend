# Tasks

Sibling changes: `us-company-paid-shipping` in `eden-bowls-admin` and `eden-bowls`. Deploy the API first. Independent of the Starter changes, but the Starter checkout uses the same rule.

## 1. Rule, settings and history

- [x] 1.1 Add `src/core/customer-shipping.js` with `customerShipping({ market, quote, chargeEnabled })`. Verify with `tests/customer-shipping.test.js`: US with charges off (charged 0, original and company cost kept), US with charges on, and BR with original and charged equal to the fee.
- [x] 1.2 Add migration `1700000000087-add-us-shipping-charge.js` (`shipping_us_settings.charge_shipping` 0) and register it in `src/infrastructure/db.js`. Read and save it in the shipping settings entity, repository, normalizer and validator, with 422 `invalid_charge_shipping`. Verify with a migration test and `npx jest --runTestsByPath tests/shipping-settings.repository.test.js tests/admin-shipping.service.test.js`: "Value after deploy" and "Restart" (value read back from the table).
- [x] 1.3 In `admin-shipping.service.js`, save the settings and, when `charge_shipping` changes, the `shipping.us.charge.enable` / `.disable` audit event in one transaction (`createIn`), and return `us.charge_shipping_history` from `listByActionPrefix`. Verify with `tests/admin-shipping.service.test.js` and the shipping settings route test: "US operator turns charges on" (with `operatorUsWriteUser`), "Brazil-only operator", "Same value saved again", and a failed audit insert leaving the setting unchanged.

## 2. Quote and checkout

- [x] 2.1 Return `original_amount`, `charged_amount` and `charge_enabled` from `POST /shipping/v1/calculate` for both markets. Verify with `tests/shipping.routes.test.js` and `tests/ups-shipping.test.js`: "Quote with charges off" and "BR quote" (original and charged equal).
- [x] 2.2 In `onboarding-shipping-select`, store the three fields, `company_cost` and `source`. In the checkout, send `charged_amount` to Stripe, write `shipping_waived` and `shipping_original_minor` in the subscription metadata and the ledger snapshot, store the charged amount (0 when waived) as the ledger shipping cost, and return `shipping_total` = `charged_amount`. Verify with `tests/onboarding-shipping-select.repository.test.js`, `tests/onboarding-subscription-checkout.service.test.js` and `tests/stripe-billing-client.test.js`: "Charges off", "Charges on", "US Starter with charges off", "Cost recorded", "BR checkout with US charges off", "BR order of two boxes" (one fee).
- [x] 2.3 Use `customerShipping` and the subscription's condition in the subscription preview, the sales tax quote, the edit preview and the edit commit. Verify with `npx jest --runTestsByPath tests/onboarding-subscription-preview.repository.test.js tests/onboarding-sales-tax-quote.service.test.js tests/subscriptions-edit-preview.repository.test.js tests/subscriptions-edit-commit.service.test.js`: "Switch turned on after a free checkout" (edit stays 0), "Switch turned off after a charged checkout", US tax without shipping when waived, and BR unchanged.

## 3. Renewals, invoice and admin

- [x] 3.1 In `stripe-webhook.service.js` `invoice.created`, skip the shipping item for a US subscription with `shipping_waived` true and log the info line. Verify with `tests/stripe-webhook.service.test.js`: "Free US subscription renews", "US subscription created before the change" and "BR renewal".
- [x] 3.2 In `src/core/invoice/invoice-document.js`, print `shippingFree` ("FREE" / "GRÁTIS", added to `invoice-copy.js`) on the shipping row when the ledger has `shipping_waived` true. Follow the `eden-invoice` skill and render the previews. Keep the PT label in `invoice-copy.js` even though no BR charge is free here. Verify with the invoice document tests: "US invoice with free shipping" (prints "FREE" in English), "US invoice with charged shipping", "BR invoice", and `node src/scripts/render-invoice-previews.js` showing the row unchanged in position.
- [x] 3.3 Show `company_shipping_cost` (amount, currency, source) and `shipping_waived` in the admin subscription detail presenter for US subscriptions. Verify with the admin subscription detail route test.

## 4. Docs and integration checks

- [x] 4.1 In `docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md` and `caixas-de-envio.md`, record the switch, its default, the history, that each subscription keeps its condition, the invoice "FREE" and `company_cost`, and that BR stays one fee per order. Verify that the docs name `charge_shipping`, `shipping_waived` and `company_cost`.
- [x] 4.2 Run `npx jest --changedSince=main` and verify every related test passes, with tests for both switch states. Run `npm run routes:manifest` and verify `docs/api-routes.json` has no diff.
