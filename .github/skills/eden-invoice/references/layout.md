# Invoice layout (approved PDF → points)

Measured from the approved PDF. Letter is 612 × 792 pt (US), A4 595.28 × 841.89 pt (BR). `W` is the content width (page width − 100). All values are in points from the top-left corner; the renderer uses the same names.

## Colors

| Token | Hex | Used for |
| --- | --- | --- |
| paper | `#FFFBF4` | page background |
| ink | `#212E25` | values, headline, table text |
| muted | `#5C6758` | invoice number line, "From", service period, notes text, footer |
| clay | `#B08F66` | small caps labels, rule under the header, notes left bar, footer email |
| moss | `#7B876F` | "PAY ONLINE" button |
| parchment | `#F5EFE2` | button text |
| rule | `#E3DBC6` | thin separators |
| tableRule | `#6F766A` | rule under the table header |
| panel / panelBorder | `#F4EFE3` / `#D9D1B9` | summary panel, notes panel, rule under "Amount due" |
| badge / badgeText | `#FBE9C9` / `#7E5E36` | status pill when payment is due |
| paidBadge / paidBadgeText | `#E5E9DD` / `#55614A` | status pill when paid |

## Fonts

| Use | Font | Size |
| --- | --- | --- |
| Title INVOICE / FATURA | Tenor Sans | 23, character spacing 4, right aligned |
| Summary headline | Tenor Sans | 16 |
| Total label / Total value | Tenor Sans | 10 / 14 |
| Small caps labels | Quicksand Regular | 6.8, character spacing 1.5, clay |
| Dates (meta values) | Quicksand Regular | 10 |
| Addresses, table, totals | Quicksand Regular | 9 |
| Service period | Quicksand Regular | 7.5, muted |
| Amount due row | Quicksand SemiBold | 9 |
| Notes text | Quicksand Regular | 8.5, line gap 3 |
| Footer | Quicksand Regular | 7 |

## Blocks, top to bottom

1. **Header**: logo at (50, 43), height 40 (ratio 900:317). Title top 46, number line top 73 (8.5 pt, spacing 0.6), status pill top 93, height 17, radius 8.5, 22 pt wider than its text, right aligned. Clay rule 1 pt at y 124.
2. **Parties** (top 143): column x at 50, 50 + 0.346 W, 50 + 0.69 W. Left column: issue date label, value 16 pt below, second label 41 pt below the first. Bill to / Ship to: label, then lines every 14.2 pt. Thin rule 12 pt under the tallest column.
3. **Summary panel**: 18 pt under that rule, full width, min height 67, radius 8. Headline at +19 / +20 inside, "From: Eden Bowls" under it. Pay button 92 × 28, radius 4, vertically centered, 20 pt from the right edge, only when the invoice is open and Stripe has a hosted URL (it links there).
4. **Table**: header labels 19 pt under the panel; QTY right edge 50 + 0.62 W, UNIT PRICE right edge 50 + 0.86 W, AMOUNT right edge at the right margin. Header rule 15 pt below the labels. Rows: 12 pt padding, description, 5 pt, service period, 13 pt padding, thin rule.
5. **Totals**: from x 50 + 0.48 W to the right margin, 25 pt per row (Total 33 pt), thin rule under each row, panelBorder rule under Amount due.
6. **Notes panel**: 22 pt under the totals, full width, clay bar 2.5 pt on the left, label at +13, text at +25, 12 pt bottom padding.
7. **Footer**: rule 69 pt above the bottom, issuer line +12, "Questions…" line +24 with the email in clay (mailto link), "Page x of y" right aligned on the same line. Drawn on every page.

## Pagination

Content stops 10 pt above the footer rule. A row that does not fit opens a new page that repeats the header block (logo, title, number, pill, rule) and the table header. Totals or notes that do not fit open a page with the header block only.
