# Tasks

## 1. Claim release and in-process retry

- [ ] 1.1 Add `releaseUnsent(id)` on `SubscriptionMailClaimsRepository` that deletes the row only when `sent_at` is null, and verify `tests/subscription-mail-claims.repository.test.js` covers delete of an unsent row and no delete of a sent row
- [ ] 1.2 Change `sendClaimed` to try `sendMail` three times, call `markSent` only after success, call `releaseUnsent` after the last failure, and keep a sent claim as a duplicate that does not call SMTP. Verify `npx jest --runTestsByPath tests/transactional-mailer.test.js` covers order confirmed, the three-try failure, and the duplicate skip

## 2. Wire the existing templates

- [ ] 2.1 Add `notifyRenewal`, `notifyPaused`, `notifyResumed`, `notifyCancelled`, and `notifyPlanChanged` using the existing builders, `mail-context`, and template keys from design.md. Verify `npx jest --runTestsByPath tests/transactional-mailer.test.js` sends each letter once to the customer email and skips when the email is missing
- [ ] 2.2 Assert pt-BR and en-US subject, text, and html from the five builders. Verify `npx jest --runTestsByPath tests/email-templates.test.js`

## 3. Stripe events

- [ ] 3.1 From `invoice.paid`, send renewal for `subscription_cycle`, keep order confirmed plus admin mail for `subscription_create`, and send plan changed instead of those two when the invoice promotes a pending edit. Verify `npx jest --runTestsByPath tests/stripe-webhook.service.test.js`
- [ ] 3.2 Send payment failed only from `invoice.payment_failed`. Leave `payment_intent.payment_failed` and `payment_intent.succeeded` as checkout-state updates with no mail. Verify the same webhook test file
- [ ] 3.3 On `customer.subscription.updated`, mail pause, resume, and scheduled cancel only when `previous_attributes` crosses that edge. On `customer.subscription.deleted`, mail cancel only when no sent `cancelled` claim exists. Verify the same webhook test file

## 4. Plan edit and shipped

- [ ] 4.1 After an edit commit that is not payment pending, send plan changed and still return success if mail fails. Do not send it when `edit_payment_pending` is true. Verify `npx jest --runTestsByPath tests/subscriptions-edit-commit.repository.test.js`
- [ ] 4.2 Keep the UPS shipped letter on shipment create and do not send it from a production status update. Verify `npx jest --runTestsByPath tests/ups-shipment.service.test.js tests/admin-production.service.test.js`
