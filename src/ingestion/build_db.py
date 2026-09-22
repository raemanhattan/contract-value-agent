"""Build the project's DuckDB database from parsed Spotrac cap-hit data and
nfl_data_py/nflverse rosters and stats.

Tables:
  cap_hits        -- one row per player-section-season from Spotrac PDFs
  rosters         -- one row per player-season from nfl_data_py (all positions,
                     used mainly for the name -> player_id crosswalk)
  seasonal_stats  -- one row per player-season, all positions, pulled
                     directly from nflverse's "stats_player" GitHub release
                     (see build_seasonal_stats_df below for why this bypasses
                     nfl_data_py's own import_seasonal_data()).
  contracts_2026  -- one row per active skill-position contract (QB/RB/WR/TE),
                     transcribed from Spotrac's league-wide contracts page
                     (spotrac.com/nfl/contracts, filtered by position).
                     Gives signing year, length, and value -- the contract-level
                     detail cap_hits alone doesn't have. Screenshots only (the
                     page truncates a clean PDF export), transcribed by hand
                     into data/processed/contracts_2026_raw.csv.

This is intentionally a small, denormalized set of tables rather than a
fully normalized schema -- the dataset is a few thousand rows, and the
point is fast iteration while building the market model and agent layer,
not enforcing referential integrity at this stage.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import nfl_data_py as nfl
import pandas as pd

from ingestion.parse_spotrac_pdf import parse_all

DB_PATH = Path("data/db/contract_value.duckdb")
CAP_DIR = Path("data/raw/cap/2026")
CONTRACTS_CSV = Path("data/processed/contracts_2026_raw.csv")

# nfl_data_py 0.3.3's import_seasonal_data()/import_weekly_data() hit a
# hardcoded URL under nflverse's OLD "player_stats" release tag, which
# nflverse stopped updating after the 2024 season (confirmed via GitHub
# API: that release's asset list tops out at player_stats_2024.parquet,
# and a direct HEAD request for player_stats_2025.parquet 404s). nfl_data_py
# itself hasn't been updated to follow nflverse's schema migration.
#
# nflverse migrated to a new "stats_player" release tag that DOES have
# 2025 data (confirmed present and current as of this build) plus every
# position, not just skill positions. Reading it directly via
# pandas.read_parquet() bypasses the stale nfl_data_py wrapper entirely.
STATS_PLAYER_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "stats_player/stats_player_reg_{year}.parquet"
)
STATS_YEARS = list(range(2015, 2026))
ROSTER_YEARS = list(range(2015, 2026))


def build_cap_hits_df() -> pd.DataFrame:
    rows = parse_all(CAP_DIR)
    return pd.DataFrame(
        [
            {
                "team": r.team,
                "season": r.season,
                "section": r.section,
                "rank": r.rank,
                "player": r.player,
                "position": r.position,
                "age": r.age,
                "cap_hit": r.cap_hit,
                "cap_hit_pct": r.cap_hit_pct,
            }
            for r in rows
        ]
    )


def build_rosters_df() -> pd.DataFrame:
    df = nfl.import_seasonal_rosters(ROSTER_YEARS)
    return df[
        [
            "season",
            "team",
            "position",
            "player_id",
            "player_name",
            "first_name",
            "last_name",
            "birth_date",
            "age",
            "years_exp",
            "college",
            "entry_year",
            "rookie_year",
            "draft_number",
            "pfr_id",
            "espn_id",
            "gsis_it_id",
        ]
    ].copy()


def build_seasonal_stats_df() -> pd.DataFrame:
    frames = []
    for year in STATS_YEARS:
        df = pd.read_parquet(STATS_PLAYER_URL.format(year=year))
        df["season"] = year
        df["season_type"] = "REG"
        frames.append(df)
    combined = pd.concat(frames, ignore_index=True)
    # Keep the same column subset the rest of the codebase (agent tools,
    # point-in-time feature construction) actually reads, rather than
    # carrying all 148 raw columns into the database.
    return combined[
        [
            "player_id",
            "season",
            "season_type",
            "position",
            "games",
            "completions",
            "attempts",
            "passing_yards",
            "passing_tds",
            "carries",
            "rushing_yards",
            "rushing_tds",
            "receptions",
            "targets",
            "receiving_yards",
            "receiving_tds",
            "fantasy_points_ppr",
        ]
    ].copy()


def main() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    print("Parsing Spotrac cap-hit PDFs...")
    cap_hits = build_cap_hits_df()
    print(f"  {len(cap_hits)} rows")

    print("Pulling nfl_data_py rosters...")
    rosters = build_rosters_df()
    print(f"  {len(rosters)} rows")

    print("Pulling nfl_data_py seasonal stats...")
    seasonal_stats = build_seasonal_stats_df()
    print(f"  {len(seasonal_stats)} rows")

    print("Loading transcribed contracts CSV...")
    contracts_2026 = pd.read_csv(CONTRACTS_CSV)
    print(f"  {len(contracts_2026)} rows")

    con = duckdb.connect(str(DB_PATH))

    con.execute("DROP TABLE IF EXISTS cap_hits")
    con.execute("CREATE TABLE cap_hits AS SELECT * FROM cap_hits")

    con.execute("DROP TABLE IF EXISTS rosters")
    con.execute("CREATE TABLE rosters AS SELECT * FROM rosters")

    con.execute("DROP TABLE IF EXISTS seasonal_stats")
    con.execute("CREATE TABLE seasonal_stats AS SELECT * FROM seasonal_stats")

    con.execute("DROP TABLE IF EXISTS contracts_2026")
    con.execute("CREATE TABLE contracts_2026 AS SELECT * FROM contracts_2026")

    con.execute("CREATE INDEX IF NOT EXISTS idx_cap_hits_player ON cap_hits(player)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_contracts_2026_player ON contracts_2026(player)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_rosters_player_name ON rosters(player_name)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_rosters_player_id ON rosters(player_id)")
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_seasonal_stats_player_id ON seasonal_stats(player_id)"
    )

    print("\nTables created:")
    for (table_name,) in con.execute("SHOW TABLES").fetchall():
        count = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        print(f"  {table_name}: {count} rows")

    con.close()
    print(f"\nDatabase written to {DB_PATH}")


if __name__ == "__main__":
    main()
