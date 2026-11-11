## Purpose

Defines how the packs of a paid cycle are split into shipping boxes, what each box weighs, and where the plan is shown, so the kitchen, the courier and UPS work from the same boxes.

## ADDED Requirements

### Requirement: A cycle's packs are split into boxes by count

The box plan of a cycle MUST use the packs the kitchen separates for it (every recipe and size, pets summed). With N packs and the saved `max_packs` of the Starter (S, 10 on deploy) and monthly (M, 30 on deploy) boxes: while N exceeds M, the plan MUST take a monthly box with M packs. The rest MUST go in a Starter box when it is S or fewer and in a monthly box otherwise. The scenarios use the deploy values. A cycle without packs MUST have an empty plan. The packs MUST be assigned heaviest first, so each box's content is known.

#### Scenario: Small order

- **WHEN** a cycle has 8 packs
- **THEN** the plan is one Starter box with 8 packs

#### Scenario: Just above the Starter

- **WHEN** a cycle has 12 packs
- **THEN** the plan is one monthly box with 12 packs

#### Scenario: Two pets

- **WHEN** a cycle has 45 packs
- **THEN** the plan is two monthly boxes, with 30 and 15 packs

#### Scenario: Exact fit

- **WHEN** a cycle has 40 packs
- **THEN** the plan is one monthly box with 30 packs and one Starter box with 10 packs

### Requirement: Each box has a real weight

A box's weight MUST be the grams of its packs, plus its empty weight, plus the dry ice per box for a US cycle (`us.package.dry_ice_kg`). A BR cycle MUST NOT add dry ice. The weight MUST be reported in kilograms and, for UPS, in pounds with one decimal place, rounded up.

#### Scenario: US monthly box of 500 g packs

- **WHEN** a US cycle has 30 packs of 500 g, the monthly box weighs 1.5 kg empty and dry ice is 0.5 kg
- **THEN** the box weighs 17.0 kg, sent to UPS as 37.5 lb

#### Scenario: BR order

- **WHEN** a BR cycle has 10 packs of 300 g and the Starter box weighs 1.0 kg empty
- **THEN** the box weighs 4.0 kg, with no dry ice

### Requirement: Queues show the box plan

Each production queue item and each courier delivery item (`GET /api/v1/admin/courier-deliveries` and the courier queue) MUST include `boxes`: a list with each box's `key`, `label`, `pack_count` and `weight_kg`, in plan order. A cycle with lines without a pack size MUST still return the boxes of its sized packs and MUST log the unsized lines, as the stock separation does.

#### Scenario: Production queue item

- **WHEN** an operator lists the production queue and a cycle has 45 packs
- **THEN** its item has two `boxes`, both `monthly`, with 30 and 15 packs

#### Scenario: Courier delivery item

- **WHEN** an operator lists the courier deliveries and a BR cycle has 12 packs
- **THEN** its item has one `boxes` entry, `monthly`, with 12 packs and no dry ice in its weight
