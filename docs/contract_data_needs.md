# Contract-level data needed for point-in-time features

## What we have (cap_hits table, from Financials/Overview PDFs)
- player, team, position, age, cap_hit, cap_hit_pct
- Single snapshot: 2026 season only

## What's missing (blocks point-in-time regression)
The regression needs, per player's CURRENT contract:
- **Signing year** — when the contract was signed (not today)
- **Contract length** — total years
- **Total value / APY** — average per year, for context
- **Year-by-year cap hit schedule** — so we can pull "cap_hit_pct in the
  signing year" rather than "cap_hit_pct today" (a deal signed in 2022
  looks very different measured against 2022's cap vs. 2026's cap)

This typically lives on Spotrac's per-team "Contracts" or "Multi-Year"
page, separate from the "Overview/Financials" page we already exported.

## Point-in-time feature construction (once contract data exists)

For each player's current contract:
1. `signing_season` = year the contract was signed
2. `cap_hit_pct_at_signing` = (contract's cap hit in signing_season) /
   (league cap in signing_season) — NOT today's cap_hit_pct
3. `trailing_production_at_signing` = player's stats in the 1-3 seasons
   BEFORE signing_season (this is what a team was actually paying for)
4. `age_at_signing` = player's age in signing_season, not current age
5. Train: `cap_hit_pct_at_signing ~ trailing_production_at_signing +
   age_at_signing + position + contract_year`
6. Predict for any player: model-implied cap_hit_pct_at_signing given
   their actual trailing production
7. Surplus/deficit = actual - predicted (in cap-hit-pct terms, comparable
   across signing years since both sides are normalized by that year's
   cap)

## Rookie contracts (separate case, already partially unblocked)
Rookie-scale contracts are NOT market-negotiated — they're fixed by a
CBA-mandated slot scale tied to draft position. We already have
`entry_year` and `draft_number` from nfl_data_py's rosters table, which
is enough to identify players still on rookie deals and could support a
simpler "rookie slot value vs. actual production" comparison without
needing Spotrac's contract-level detail at all. This could ship in v1
even if veteran contract backfill is deferred.

## Next steps once contract PDFs are available
1. Inspect page layout the same way we did for Financials PDFs (word
   positions, section headers, column detection) before writing a parser
   — do not assume the layout matches the Financials pages.
2. Build `parse_spotrac_contracts_pdf.py` following the same
   coordinate-based extraction pattern.
3. Add a `contracts` table to the DuckDB build, keyed by player + signing
   season.
4. Extend `player_crosswalk` / `cap_hits_enriched` to join in contract
   signing-year context.
