## MODIFIED Requirements

### Requirement: Queue cycles report stock coverage

Each production queue item MUST report `stockCoverage`: `covered`, `short` or `unknown` for cycles in `to_prepare` or `in_production`, and `null` otherwise. On-hand of each item MUST be allotted to those cycles in due order across the whole window, and a cycle is `short` when any of its lines is not fully allotted.

Each item MUST also report `stockShortages`: for a `short` cycle, one entry per stock item (flavor and pack size) whose line was not fully allotted, with `flavorKey`, `packSizeGrams`, the recipe name the stock screen shows, and `missing`, the packs left without stock; for any other cycle, an empty list.

#### Scenario: Earlier delivery takes the stock first

- **WHEN** an item has 5 on hand and two cycles of the window need 4 each, due tomorrow and in three days
- **THEN** the cycle due tomorrow is `covered` with no shortages, and the one due in three days is `short` with one shortage of that item and `missing` 3

#### Scenario: Two recipes short

- **WHEN** a cycle needs two recipes and neither has enough stock left after earlier cycles
- **THEN** its `stockShortages` lists both

#### Scenario: Line without pack size

- **WHEN** a cycle has a line without a pack size
- **THEN** its `stockCoverage` is `unknown`
