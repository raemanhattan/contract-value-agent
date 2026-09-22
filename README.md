# Contract Value and Performance Analysis Agent

An agentic system that answers roster and contract questions with cited
evidence, built on top of a market model that estimates what a player's
production was worth at the time they signed.

## Concept

Two layers:

1. **Analytical layer** — a market model regressing cap-hit percentage on
   production metrics, age, position, and contract year, trained on
   historical signings. Surplus/deficit value is the residual between
   actual and model-predicted cap hit.
2. **Agent layer** — exposes the market model plus stats/news retrieval
   as tools to an LLM agent, which decomposes natural-language questions
   and returns memos with sourced claims.

**Critical constraint:** contracts must be evaluated against conditions
at signing, not today. Point-in-time feature construction is built in
from the start.

## Scope: NFL first, NBA second

Building NFL end-to-end first (data → model → agent → eval → UI), then
adding NBA as a second league behind the same interface. League-specific
logic (target variable definition, data sources, feature sets) lives in
`src/leagues/<league>/` so NBA can be added without reworking the core
pipeline.

NBA's cap structure (max contracts, cap holds, Bird rights) doesn't map
cleanly onto NFL's cap-hit-percentage framing, so the exact NBA target
variable is deferred until NFL is validated.

## Data sources

- **NFL performance stats:** pulled directly from nflverse's `stats_player`
  GitHub release (`pandas.read_parquet()` against
  `github.com/nflverse/nflverse-data/releases/download/stats_player/...`),
  **not** via `nfl_data_py.import_seasonal_data()`. That function hits a
  different, older release tag (`player_stats`) that nflverse stopped
  updating after the 2024 season — confirmed via the GitHub releases API
  that the tag's asset list tops out at `player_stats_2024.parquet`, and
  a direct request for `player_stats_2025.parquet` 404s. `nfl_data_py`
  0.3.3 hasn't been updated to follow nflverse's schema migration. The
  `stats_player` tag has 2025 data and covers every position, not just
  skill positions. Historical depth back to 1999; roster/player-ID
  crosswalk still comes from `nfl_data_py.import_seasonal_rosters()`,
  which does track the current schema correctly.
- **NFL cap/contract data:** Spotrac team financial PDFs (32 teams,
  2026 season), manually exported. Dropped into
  `data/raw/cap/2026/*.pdf`. Historical years to be backfilled once the
  parser and schema are validated against this year's data.

## Build order

1. **Data ingestion** — parse the 32 Spotrac PDFs into structured
   cap-hit data; pull matching nfl_data_py stats; resolve player
   identity across the two sources (name matching, since Spotrac and
   nfl_data_py won't share a common ID).
2. **Market model** — point-in-time features, regression on cap-hit %,
   residual = surplus/deficit. Can't be meaningfully trained/validated
   until enough historical signing years exist (Phase 2 backfill beyond
   the current 2026 snapshot).
3. **Agent layer** — Claude Agent SDK, typed tools
   (`get_surplus_value`, `get_contract_details`, `get_stats`, ...).
   Decomposes natural-language questions into tool calls, returns memos
   with cited numbers.
4. **Eval harness (before any UI)** — a fixed set of ~20-40 scouting/
   valuation questions with known-correct answers. Reports pass rate
   and failure analysis. This is what separates a credible agent from a
   demo — build it before UI work starts.
5. **Deliverable UI** — query interface, contract visualization
   (production trajectory vs. dollars committed across contract years,
   marking the crossover where a deal turns negative), league-wide
   surplus leaderboard.

## Database

DuckDB (`data/db/contract_value.duckdb`), rebuilt from source data by
`src/ingestion/build_db.py`. Chosen over Postgres for this stage: the
dataset is a few thousand rows, there's no multi-user/hosting need yet,
and DuckDB gives real SQL (for the agent's tools) with zero server setup.
The `.duckdb` file itself is not checked into git (derived data); rerun
the build script to regenerate it.

Tables:
- `cap_hits` — one row per player-section-season, parsed from the
  Spotrac PDFs (`src/ingestion/parse_spotrac_pdf.py`).
- `rosters` — one row per player-season from `nfl_data_py`
  (`import_seasonal_rosters`), all positions. Used mainly for the
  player-name -> `player_id` crosswalk.
- `seasonal_stats` — one row per player-season from `nfl_data_py`
  (`import_seasonal_data`). Skill positions only (QB/RB/WR/TE) — this
  source does not cover OL/DL/LB/etc., which is a known gap for the
  market model (see Status below).

- `contracts_2026` — one row per active skill-position contract
  (QB/RB/WR/TE), transcribed from Spotrac's league-wide contracts page
  (filtered by position). Gives signing year, length, and value/APY —
  contract-level detail `cap_hits` alone doesn't have. The page only
  offers a clean PDF export with dollar columns truncated, so this was
  captured as 21 screenshots and transcribed by hand into
  `data/processed/contracts_2026_raw.csv` (368 rows, validated: no
  duplicate player/position pairs, only 1 name fails to match any
  `cap_hits` row at all).

Views (`src/ingestion/create_views.sql`):
- `player_crosswalk` — one row per distinct Spotrac player name, with
  their most recent matching `player_id` from `rosters` (exact
  name-match; ~82% resolve as of the 2026 snapshot).
- `cap_hits_enriched` — `cap_hits` joined to the crosswalk.

`point_in_time_features` view and `training_contracts` table
(`src/model/build_features.py`):
- For each contract: `signing_season` (Start Year), `cap_pct_at_signing`
  (average salary ÷ that season's league cap — a public, non-scraped
  reference table in `src/ingestion/nfl_salary_cap_by_year.py`,
  cross-validated against our own parsed `cap_hit`/`cap_hit_pct`), and
  `trailing_fantasy_points_ppr` (the player's production in the season
  *before* signing, not today's stats).
- `training_contracts` keeps only rows with both a resolved `player_id`
  and trailing-season stats: **83 of 368 contracts**. The rest are
  excluded for two different reasons — rookies (no pre-draft trailing
  stats, a separate valuation case handled differently, not a bug) and,
  more significantly, **every contract signed in 2026 (162 of 368)**,
  because nflverse has not yet published 2025 season stats. This isn't
  fixable by better code; it resolves once nflverse publishes that data.

Rebuild from scratch:

```
PYTHONPATH=src .venv/bin/python3 src/ingestion/build_db.py
duckdb data/db/contract_value.duckdb < src/ingestion/create_views.sql
PYTHONPATH=src .venv/bin/python3 src/model/build_features.py
PYTHONPATH=src .venv/bin/python3 src/model/market_model.py
```

## Directory layout

```
contract-value-agent/
  data/
    raw/
      cap/2026/         <- the 32 Spotrac team PDFs
      stats/            <- (reserved; nfl_data_py is pulled live, not cached to disk yet)
    processed/          <- reserved for point-in-time feature tables
    db/
      contract_value.duckdb   <- built by build_db.py, not checked into git
  src/
    ingestion/          <- PDF parsing, nfl_data_py pulls, DB build, crosswalk views
    leagues/            <- league-specific interfaces (nfl/, later nba/)
    model/              <- point-in-time feature construction, regression
    agent/              <- Claude Agent SDK tools and agent loop
    eval/               <- fixed Q&A eval harness
```

## Market model

`src/model/market_model.py`, trained on `training_contracts` (174 rows
as of the `stats_player` data-source fix — was 83 before nflverse's 2025
stats became reachable; re-run `build_db.py` + `build_features.py` +
`market_model.py` in sequence to refresh, and see the note in
`src/eval/cases.py` about re-verifying hardcoded eval ground truth after
any retrain, since coefficients and per-player ratios shift).

```
log(cap_pct_at_signing) ~ log1p(trailing_fantasy_points_ppr) + age_at_signing + C(position)
```

- **Modeled in log space**, not on `cap_pct_at_signing` directly: a
  plain linear fit produced negative predicted cap% for very
  low-production players, which is nonsensical. Log-log guarantees
  positive predictions and matches how pay actually scales with
  production (diminishing returns, multiplicative not additive) —
  standard for wage-type regressions.
- **Contract length (`yrs`) deliberately excluded.** It's a strong
  predictor (R² rises from 0.71 to 0.80 if included) but it's a
  negotiation *outcome*, not something a team uses to set the price —
  including it would let the model partly predict pay from itself and
  muddy the residual's interpretation as a pure production-for-pay
  mismatch.
- **Surplus is a ratio**, not a percentage-point difference (since the
  model lives in log space): `surplus_ratio = actual cap_pct_at_signing
  / predicted cap_pct_at_signing`. Above 1.0 = paid more than trailing
  production alone predicts; below 1.0 = paid less.
- R² = 0.599 on 174 training contracts (was 0.655 on 83 before the
  training set roughly doubled — a lower R² on a larger, more
  representative sample is expected and healthy, not a regression). All
  coefficients have the expected sign and are statistically significant
  (production positive, age negative, QB pays the most at equal
  production, RB the least). Live values always available via
  `GET /api/model-info`.
- **Known caveat, shipped intentionally rather than patched around:**
  surplus ratios for near-zero-production players (e.g. a backup QB with
  under 1 trailing fantasy point) can be mathematically extreme (3-4x)
  purely because the log transform amplifies ratios near a tiny
  denominator — the model has essentially no signal to predict from at
  that end. These are real numbers, not bugs, but low-confidence ones;
  a "meaningful snaps" leaderboard view should filter on
  `trailing_games` or `trailing_fantasy_points_ppr` rather than trust
  the raw ratio at the extremes.

Sanity-checked against known 2023-2025 signings: Dak Prescott, Lamar
Jackson, Justin Herbert, and Joe Burrow's extensions all correctly show
surplus_ratio > 1 (paid above what their trailing production alone would
predict — consistent with the real-world "market reset" dynamics of
elite QB deals), while Drew Lock, Mac Jones, and Mason Rudolph's
prove-it deals correctly show surplus_ratio well under 1.

## Agent layer

`src/agent/tools.py` + `src/agent/run.py`. Four typed tools backed by
SQL against the DuckDB database: `get_contract_details`,
`get_surplus_value`, `get_stats`, `get_surplus_leaderboard`. The agent
loop is provider-agnostic — `AGENT_BACKEND=ollama` (local, free, for
dev) or `AGENT_BACKEND=anthropic` (Claude, for the eval run that
matters and the final demo) share the same tool code and schemas.

**Local model choice:** tested `ministral-3:3b`, `qwen3.5:9b`, and
`qwen3.5:4b`. Ministral fabricated entire tool results (wrong team,
invented dollar figures) presented as if a real tool call had returned
them — a serious grounding failure, not a formatting quirk, and not
usable even for dev iteration. Both Qwen sizes reliably call tools and
ground answers in the real results; 4b is the default (comparable
reliability to 9b, meaningfully faster once warm). Ollama models can
default to a huge context window (observed: 262144 on qwen3.5:9b),
which makes Ollama allocate a large KV cache before generating even one
token and adds tens of seconds of latency regardless of prompt size —
`OLLAMA_NUM_CTX = 4096` is forced explicitly to avoid this.

**Two real bugs found via manual testing, fixed in the tools themselves
(not just prompted around):**
1. `get_surplus_leaderboard` only sorted one direction, so a "best
   value" question silently retrieved the biggest-overpay end of the
   list. Fixed with an explicit `sort="best_value"|"biggest_overpay"`
   parameter — the tool now says directly what each ordering means
   rather than expecting the model to reason about ascending/descending.
2. The `surplus_ratio` field name and "ratio > 1" convention were prone
   to misreading (a small model called an overpay a "surplus" in the
   good sense). Renamed to `pay_vs_production_ratio`, added an explicit
   `team_is_overpaying` boolean, and the tool's own text states the
   direction twice in different phrasing.

## Eval harness

`src/eval/cases.py` (12 fixed Q&A cases with known-correct answers) +
`src/eval/run_eval.py` (runner). Built before any UI work, per the
original spec — "this is what separates a credible agent from a demo."

- **Each case runs 3x** (`--repeats`), not once: LLM sampling means the
  same question can be answered correctly one run and incorrectly the
  next. A per-case pass RATE, not a single pass/fail, is the honest way
  to report this — and it surfaces genuine flakiness as a finding in
  its own right.
- **Retries on transient backend errors** (observed during development:
  an Ollama 500 "unexpected EOF" mid-run) so one infrastructure hiccup
  doesn't crash the whole harness run.
- **Numeric checks use a tolerance-based extractor**
  (`extract_numbers`/`contains_number`), not exact substrings. This
  was the single highest-leverage fix during harness development: a
  long tail of false FLAKY/FAIL results turned out to be fully correct
  answers that merely reformatted a number ("$504.75 million" vs
  "504,750,000", "19.7%" vs "19.699") — exact substring matching cannot
  tell those apart from a real error. Phrase checks (`must_contain`)
  are reserved for actual words, not numbers.
- **Categories deliberately target failure modes found in manual
  testing**, not just happy-path lookups: grounding (does the agent
  fabricate an answer for an unknown/uncovered player instead of saying
  so), surplus-direction interpretation (the exact bug where a model
  called an overpay a "surplus"), leaderboard sort direction (the exact
  bug where "best value" retrieved the wrong end of the list),
  low-confidence flagging, and multi-tool decomposition.

Current result (qwen3.5:4b, 3 repeats): **36/36 attempts passed (100%),
12/12 cases fully passing, zero flakiness.** Run it:

```
PYTHONPATH=src .venv/bin/python3 src/eval/run_eval.py --backend ollama --model qwen3.5:4b
```

## Frontend

`frontend/` — Next.js dashboard (App Router), styled as a real sports
analytics site (dark header, KPI strip, condensed display type) rather
than a generic SaaS-card layout. Talks to the FastAPI backend at
`NEXT_PUBLIC_API_BASE` (`.env.local`, defaults to `localhost:8000`).

- `/` — dashboard: KPI strip (live from `/api/model-info`), the
  methodology panel (plain-English explanation + an expandable "show
  the math" section with the real fitted formula, R², and every
  coefficient as a plain-English sentence with its p-value), the query
  interface, and the full player table (search, position filter,
  best-value/biggest-overpay sort, verdict badges).
- `/player/[name]` — a real route per player (not an inline
  expand/collapse): header card with verdict badge, contract stat
  strip, a full multi-season career stats table (`stats_history` from
  `/api/player/{name}`, all years on record — not just the season used
  for the model's trailing-production feature), and the peer-comparison
  scatter chart with that player's own point starred and labeled.
- `PeerComparisonChart` — production-vs-pay scatter with the model's
  fitted curve. Every dot is clickable (navigates to that player) and
  shows a name label on hover; the 6 highest-production dots per
  position are always labeled so the chart isn't unreadable at a
  glance. Hover state is self-managed (React state + explicit
  `onMouseEnter`/`onMouseLeave` on each dot) rather than relying on
  recharts' built-in `<Tooltip>`, which didn't reliably fire over a
  fully custom SVG point shape.

Run: `cd frontend && npm run dev` (with the API running separately via
`PYTHONPATH=src .venv/bin/uvicorn api.main:app --port 8000`).

## Status

Data ingestion, the market model, the agent, the eval harness, and the
dashboard UI are functional end-to-end:
- Spotrac PDF parser extracts all 32 teams cleanly (2,105 player-season
  rows, names normalized, validated against known players).
- Contracts data (368 skill-position contracts) transcribed and loaded.
- DuckDB database built with `cap_hits`, `rosters`, `seasonal_stats`,
  `contracts_2026` tables, a `player_id` crosswalk view (~82% match rate
  by exact name), point-in-time feature construction, and a trained
  market model with predictions persisted to `market_model_predictions`.
- Full-stack dashboard (FastAPI + Next.js) live locally, all three
  original deliverables implemented as real UI: query interface,
  per-player contract visualization, league-wide leaderboard.

**Known gap, scoped for v1:** `seasonal_stats` was scoped to skill
positions only in the original build. **Update:** the corrected
`stats_player` data source (see Data sources above) actually covers
every position, not just QB/RB/WR/TE — so O-line/D-line valuation is no
longer blocked by a data-availability gap, just by the market model's
current formula/scope. Extending the model to other positions is a
straightforward phase-2 extension now, not a new data-sourcing project.

**Resolved:** the earlier "nflverse hasn't published 2025 stats" gap
was actually a stale-URL bug in `nfl_data_py` itself, not a real
data-availability gap — nflverse migrated to a new release tag
(`stats_player`) that `nfl_data_py` 0.3.3 never picked up. Reading that
release directly unblocked 2025 stats, growing the usable training set
from 83 to 174 contracts (91 of the 162 previously-unpriced 2026
signings are now priced; the rest are mostly rookies with no prior NFL
stats to train on, not a pipeline problem).

Next: NBA as a second league behind the same pluggable interface, per
the original scope decision; O-line/D-line valuation as a phase-2
extension now that stats coverage supports it.
