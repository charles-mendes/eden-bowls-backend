# Spec Delta

## Purpose

Defines what the admin NF-e API accepts from the panel: the filters of the note list and the corrections an operator makes to a note's customer data, and what each correction leaves in the audit log.

## ADDED Requirements

### Requirement: NF-e list accepts several statuses

`GET /api/v1/admin/nfe` MUST accept `status` as one status or up to three statuses separated by commas, and MUST return the notes in any of them, with `total` and pagination over the same filter. An unknown status in the list MUST be refused with `422` and code `invalid_status`. A single status MUST behave as today.

#### Scenario: Notes that need action

- **WHEN** an operator calls `GET /api/v1/admin/nfe?status=blocked_missing_document,rejected,error`
- **THEN** the response lists only notes in those three statuses and `total` counts them

#### Scenario: Unknown status in the list

- **WHEN** the query is `status=rejected,xyz`
- **THEN** the response is `422` with code `invalid_status`

### Requirement: NF-e customer correction records its reason

`PATCH /api/v1/admin/nfe/:id/customer` MUST accept an optional `reason` of 3 to 255 characters after trimming and MUST store it in the `nfe.customer.update` audit event. A `reason` outside that length MUST be refused with `422` and code `invalid_nfe_customer`. Without `reason`, the correction MUST behave as today.

#### Scenario: Correction with a reason

- **WHEN** an operator corrects a note's CPF with `reason: "CPF digitado errado no checkout"`
- **THEN** the note is updated and the `nfe.customer.update` audit event carries that reason

#### Scenario: Correction without a reason

- **WHEN** the body has no `reason`
- **THEN** the note is updated as today and the audit event has no reason
