"""Point-in-time feature construction for the contract-value market model.

For each contract in `contracts_2026` (skill positions only: QB/RB/WR/TE),
build the features a team actually had available when they signed the
player -- not today's numbers. Getting this wrong invalidates the whole
model (a deal signed in 2022's cap environment can't be judged by
2026-dollar production).

For each contract:
  - signing_season = Start Year (from the contracts table)
  - cap_pct_at_signing = average_salary / league cap in signing_season
    (APY as a proxy for the deal's cap-hit percentage; we don't have the
    year-by-year cap schedule, only current cap_hit and the contract's
    average annual value)
  - age_at_signing = already given directly in the contracts table
  - trailing_production = the player's fantasy_points_ppr in the season
    immediately before signing_season (their most recent full season of
    play before the team committed to this contract)

Players are matched to nfl_data_py's player_id via the existing
player_crosswalk view (name-based, ~82% match rate). Rows that don't
resolve to a player_id, or have no seasonal_stats row for the signing-1
season, are kept but flagged -- excluding them silently would bias the
sample toward players with cleaner data trails.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

from ingestion.nfl_salary_cap_by_year import NFL_SALARY_CAP_BY_YEAR

DB_PATH = Path("data/db/contract_value.duckdb")


def build_point_in_time_features(con: duckdb.DuckDBPyConnection) -> None:
    cap_year_values = ", ".join(
        f"({year}, {cap})" for year, cap in NFL_SALARY_CAP_BY_YEAR.items()
    )
    con.execute(f"""
        CREATE OR REPLACE TABLE nfl_salary_cap_by_year AS
        SELECT * FROM (VALUES {cap_year_values}) AS t(season, league_cap)
    """)

    con.execute("""
        CREATE OR REPLACE VIEW point_in_time_features AS
        SELECT
            c.player,
            c.pos,
            c.team_currently_with,
            c.age_at_signing,
            c.start_year AS signing_season,
            c.end_year,
            c.yrs,
            c.value AS contract_total_value,
            c.average_salary,
            cap.league_cap AS league_cap_at_signing,
            ROUND(100.0 * c.average_salary / cap.league_cap, 3) AS cap_pct_at_signing,
            pc.player_id,
            s.season AS trailing_stats_season,
            s.fantasy_points_ppr AS trailing_fantasy_points_ppr,
            s.games AS trailing_games,
            (pc.player_id IS NULL) AS missing_player_id,
            (pc.player_id IS NOT NULL AND s.player_id IS NULL) AS missing_trailing_stats
        FROM contracts_2026 c
        LEFT JOIN nfl_salary_cap_by_year cap ON cap.season = c.start_year
        LEFT JOIN player_crosswalk pc ON pc.player = c.player
        LEFT JOIN seasonal_stats s
            ON s.player_id = pc.player_id
            AND s.season = c.start_year - 1
            AND s.season_type = 'REG'
    """)


def main() -> None:
    con = duckdb.connect(str(DB_PATH))
    build_point_in_time_features(con)

    total = con.execute("SELECT COUNT(*) FROM point_in_time_features").fetchone()[0]
    missing_id = con.execute(
        "SELECT COUNT(*) FROM point_in_time_features WHERE missing_player_id"
    ).fetchone()[0]
    missing_stats = con.execute(
        "SELECT COUNT(*) FROM point_in_time_features WHERE missing_trailing_stats"
    ).fetchone()[0]
    usable = total - missing_id - missing_stats

    print(f"point_in_time_features: {total} contracts")
    print(f"  missing player_id crosswalk: {missing_id}")
    print(f"  resolved but missing trailing-season stats: {missing_stats}")
    print(f"  usable for regression (has trailing production): {usable}")

    print("\nBy position:")
    print(
        con.execute("""
            SELECT pos,
                   COUNT(*) AS total,
                   SUM(CASE WHEN NOT missing_player_id AND NOT missing_trailing_stats THEN 1 ELSE 0 END) AS usable
            FROM point_in_time_features
            GROUP BY pos
            ORDER BY pos
        """).fetchdf()
    )

    con.execute("""
        CREATE OR REPLACE TABLE training_contracts AS
        SELECT *
        FROM point_in_time_features
        WHERE NOT missing_player_id AND NOT missing_trailing_stats
    """)
    training_count = con.execute("SELECT COUNT(*) FROM training_contracts").fetchone()[0]
    print(f"\ntraining_contracts table written: {training_count} rows")

    con.close()


if __name__ == "__main__":
    main()
