# Design

## Context

- **Starter:** from change `starter-box-purchase`, a Starter is a Stripe subscription with `plan_kind: starter`, ending at its period end, with one paid cycle and a row in `starter_box_claims`.
- **Delivery dates:** the paid cycle stores `delivery_date` (expected) in `subscription_production_cycles`. A US delivery is confirmed by `ups_shipments.delivered_at` (UPS local time), a BR one by the courier delivery reaching `delivered` (`courier-timeline.js`).
- **Checkout reuse:** `collectSubscribedPetIds` counts pets of every ledger row in an active status, and `evaluateCheckoutReuse` refuses a settled checkout with a different fingerprint when no pet is uncovered (409 `checkout_context_mismatch`). A Starter would trigger both.
- **Eligibility:** `OnboardingDiscountEligibilityRepository.getEligibility` returns `HAS_ACTIVE_SUBSCRIPTION` while the Starter subscription is active, and nothing once it ends, so a customer who waits for the Starter to end would get the discount back.
- **Scheduled mail:** `plan_notices` is the pattern: hourly tick, own lock, 100 per tick, claim before send, retry next tick.

## Goals / Non-Goals

**Goals:**
- Day 1 has one definition, used by the checkout gate, the store, the invite and the Today alert.
- A Starter customer reaches the monthly checkout with the same pets and recipes, without touching the Starter.

**Non-Goals:**
- Ending the Starter subscription early when the monthly plan starts. It ends on its own and never charges.
- Moving the first monthly delivery to the end of the Starter's days. The client accepts both boxes close together.

## Decisions

1. **`starterDayOne({ cycle, shipment, courierDelivery, today, timeZone })` in `src/core/starter-day-one.js`**, pure: confirmed date first, then the expected date once it is today or earlier, else null. The checkout, the detail, the job and Today call it. The alternative, a stored Day 1 updated by webhooks and courier actions, would need writes in three flows and could drift.
2. **Pets of a `starter` row are left out of `collectSubscribedPetIds`, and a Starter checkout reference is never reused** by `evaluateCheckoutReuse` for a `subscription` checkout. The plan checkout then runs as for a customer adding a plan, with a new attempt and fingerprint.
3. **Eligibility checks paid Starter claims of the user or the email first and returns `STARTER_PURCHASED`**, before the existing checks, so the result does not change when the Starter subscription ends. The plan snapshot uses the same call, so `plan_terms` show 0 percent.
4. **The checkout gate (409 `starter_not_delivered`) applies when the customer has a paid Starter with no Day 1 and no other paid plan.** A customer with an older plan is not a Starter customer by decision 6 of `starter-box-purchase`.
5. **Prefill is returned by the subscription detail, and the store saves it through the existing plan selection route.** Pack counts are recalculated by the plan preview with the plan days, so no separate monthly calculation lives in the API for this. The alternative, a "start monthly" route, would add a route only to copy data the store already reads.
6. **The invite state lives on `starter_box_claims`** (`invite_sent_at`, `invite_day1`, `invite_day1_source`, `alert_resolved_at`). One row per Starter already exists, so no new table. The job claims the row before sending, like plan notices.
7. **Invite day = Day 1 + 4**, the client's "Day 5" with Day 1 as the delivery day. The send window is the whole day in the market's time zone, from the first tick of that day.
8. **Today alert = invite sent with source `expected` and no confirmation since.** It clears itself when the confirmation arrives, so an operator never has to close it by hand.

## Risks / Trade-offs

- [A courier who never marks deliveries keeps every BR Starter on "expected"] → That is what the alert is for. The count shows the backlog in Today.
- [The UPS `delivered_at` is local time while Day 1 uses the market time zone] → The date is taken in the US market time zone (the one the delivery calendar uses). An off-by-one near midnight moves the invite by a day at most.
- [A customer buys a monthly plan from another device before Day 1 through an old store build] → The API gate refuses it, whatever the store shows.

## Migration Plan

1. Migration `1700000000086` adds the invite columns to `starter_box_claims`. `down` drops them.
2. Deploy the API with the job, then the panel, then the store.
3. Rollback: revert the builds and run `down`. Invites already sent stay sent. Starter customers can still check out a plan, without the gate.
