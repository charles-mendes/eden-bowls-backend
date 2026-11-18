# Spec Delta

## MODIFIED Requirements

### Requirement: A cycle's packs are split into boxes by count

The box plan of a cycle MUST use the packs the kitchen separates for it (every recipe and size, pets summed). The plan MUST be the most economical combination of boxes: the fewest boxes first, then the smallest boxes, because every extra box adds an empty box, dry ice in the US and a carrier package charge. With N packs and the saved `max_packs` of the Starter (S, 10 on deploy) and monthly (M, 30 on deploy) boxes: while N exceeds M, the plan MUST take a monthly box with M packs. The rest MUST go in a Starter box when it is S or fewer and in a monthly box otherwise. The scenarios use the deploy values. A cycle without packs MUST have an empty plan. The packs MUST be assigned heaviest first, so each box's content is known.

#### Scenario: Small order

- **WHEN** a cycle has 8 packs
- **THEN** the plan is one Starter box with 8 packs

#### Scenario: Just above the Starter

- **WHEN** a cycle has 12 packs
- **THEN** the plan is one monthly box with 12 packs, not two Starter boxes

#### Scenario: Two pets

- **WHEN** a cycle has 45 packs
- **THEN** the plan is two monthly boxes, with 30 and 15 packs

#### Scenario: Exact fit

- **WHEN** a cycle has 40 packs
- **THEN** the plan is one monthly box with 30 packs and one Starter box with 10 packs

### Requirement: Each box has a real weight

A box's weight MUST be the grams of its packs, plus its empty weight, plus the dry ice per box for a US cycle (`us.package.dry_ice_kg`). A BR cycle MUST NOT add dry ice. The weight MUST be reported in kilograms and, for UPS, in pounds with one decimal place, rounded up.

#### Scenario: US monthly box of 500 g packs

- **WHEN** a US cycle has 30 packs of 500 g, the monthly box weighs 0.6 kg empty and dry ice is 0.5 kg
- **THEN** the box weighs 16.1 kg, sent to UPS as 35.5 lb

#### Scenario: US Starter box of 500 g packs

- **WHEN** a US cycle has 10 packs of 500 g, the Starter box weighs 0.355 kg empty and dry ice is 0.5 kg
- **THEN** the box weighs 5.855 kg, sent to UPS as 13.0 lb

#### Scenario: BR order

- **WHEN** a BR cycle has 10 packs of 300 g and the Starter box weighs 0.355 kg empty
- **THEN** the box weighs 3.355 kg, with no dry ice
