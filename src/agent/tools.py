"""Agent tools: typed functions backed by SQL against the project's DuckDB
database. Each tool is a plain Python function plus a JSON-schema
description, kept independent of any specific LLM SDK's tool-calling
format -- the agent loop (agent/run.py) adapts these to whichever
backend (Anthropic or Ollama) is active.

Only skill positions (QB/RB/WR/TE) have a market-model valuation --
other positions can still get contract facts via get_contract_details,
just without get_surplus_value.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb

DB_PATH = Path("data/db/contract_value.duckdb")


def _connect() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(DB_PATH), read_only=True)


def get_contract_details(player: str) -> dict[str, Any]:
    """Look up a player's current contract facts: team, position, signing
    year, length, total value, average salary, and current cap hit.
    """
    con = _connect()
    try:
        contract = con.execute(
            """
            SELECT player, pos, team_currently_with, age_at_signing,
                   start_year, end_year, yrs, value, average_salary
            FROM contracts_2026
            WHERE lower(player) = lower(?)
            """,
            [player],
        ).fetchdf()

        cap_hit = con.execute(
            """
            SELECT team, season, section, cap_hit, cap_hit_pct
            FROM cap_hits
            WHERE lower(player) = lower(?)
            ORDER BY season DESC
            LIMIT 1
            """,
            [player],
        ).fetchdf()
    finally:
        con.close()

    if contract.empty and cap_hit.empty:
        return {"found": False, "player": player}

    result: dict[str, Any] = {"found": True, "player": player}
    if not contract.empty:
        row = contract.iloc[0]
        result["contract"] = {
            "position": row["pos"],
            "team": row["team_currently_with"],
            "age_at_signing": int(row["age_at_signing"]),
            "start_year": int(row["start_year"]),
            "end_year": int(row["end_year"]),
            "length_years": int(row["yrs"]),
            "total_value": int(row["value"]),
            "average_salary": int(row["average_salary"]),
        }
    if not cap_hit.empty:
        row = cap_hit.iloc[0]
        result["current_cap_hit"] = {
            "team": row["team"],
            "season": int(row["season"]),
            "roster_section": row["section"],
            "cap_hit": int(row["cap_hit"]),
            "cap_hit_pct": float(row["cap_hit_pct"]),
        }
    return result


def get_surplus_value(player: str) -> dict[str, Any]:
    """Look up the market model's surplus/deficit valuation for a player,
    if one exists. Only covers skill positions (QB/RB/WR/TE) with a
    resolved trailing-production feature -- see the model's known-gaps
    notes for why many 2026 signings aren't covered yet.
    """
    con = _connect()
    try:
        row = con.execute(
            """
            SELECT player, pos, signing_season, age_at_signing,
                   trailing_fantasy_points_ppr, trailing_games,
                   cap_pct_at_signing, predicted_cap_pct,
                   pred_lower, pred_upper, surplus_ratio
            FROM market_model_predictions
            WHERE lower(player) = lower(?)
            """,
            [player],
        ).fetchdf()
    finally:
        con.close()

    if row.empty:
        return {
            "found": False,
            "player": player,
            "note": (
                "No market-model valuation available. This means either the "
                "player isn't a skill position (QB/RB/WR/TE), their contract "
                "couldn't be matched to trailing production stats (common for "
                "rookies, or any 2026 signing since nflverse hasn't published "
                "2025 season stats yet), or the player name wasn't found."
            ),
        }

    r = row.iloc[0]
    low_confidence = r["trailing_games"] < 8 or r["trailing_fantasy_points_ppr"] < 20
    return {
        "found": True,
        "player": r["player"],
        "position": r["pos"],
        "signing_season": int(r["signing_season"]),
        "age_at_signing": int(r["age_at_signing"]),
        "trailing_production": {
            "fantasy_points_ppr": float(r["trailing_fantasy_points_ppr"]),
            "games": int(r["trailing_games"]),
        },
        "actual_cap_pct_at_signing": round(float(r["cap_pct_at_signing"]), 3),
        "model_predicted_cap_pct": round(float(r["predicted_cap_pct"]), 3),
        "prediction_interval_90pct": [
            round(float(r["pred_lower"]), 3),
            round(float(r["pred_upper"]), 3),
        ],
        "pay_vs_production_ratio": round(float(r["surplus_ratio"]), 3),
        "team_is_overpaying": bool(r["surplus_ratio"] > 1),
        "interpretation": (
            f"pay_vs_production_ratio = {round(float(r['surplus_ratio']), 3)}. "
            + (
                "This is ABOVE 1.0: the team is paying MORE than the player's "
                "trailing production alone would justify. That is bad value "
                "for the team (an overpay), not a 'surplus' in the sense of "
                "being good value."
                if r["surplus_ratio"] > 1
                else "This is BELOW 1.0: the team is paying LESS than the "
                "player's trailing production alone would justify. That is "
                "GOOD value for the team (a team-friendly contract)."
            )
        ),
        "low_confidence": bool(low_confidence),
        "low_confidence_note": (
            "Trailing production was low (<8 games or <20 fantasy points) -- "
            "the model has very little signal here, and this ratio can be "
            "mathematically extreme without being meaningful."
            if low_confidence
            else None
        ),
    }


def get_stats(player: str, season: int | None = None) -> dict[str, Any]:
    """Look up a player's season stats (skill positions only). Defaults to
    their most recent available season if none is specified.
    """
    con = _connect()
    try:
        player_id_row = con.execute(
            "SELECT player_id FROM player_crosswalk WHERE lower(player) = lower(?)",
            [player],
        ).fetchdf()
        if player_id_row.empty or player_id_row.iloc[0]["player_id"] is None:
            return {"found": False, "player": player, "note": "no player_id crosswalk match"}
        player_id = player_id_row.iloc[0]["player_id"]

        query = """
            SELECT season, completions, attempts, passing_yards, passing_tds,
                   carries, rushing_yards, rushing_tds,
                   receptions, targets, receiving_yards, receiving_tds,
                   fantasy_points_ppr, games
            FROM seasonal_stats
            WHERE player_id = ? AND season_type = 'REG'
        """
        params: list[Any] = [player_id]
        if season is not None:
            query += " AND season = ?"
            params.append(season)
        query += " ORDER BY season DESC LIMIT 1"

        stats = con.execute(query, params).fetchdf()
    finally:
        con.close()

    if stats.empty:
        return {
            "found": False,
            "player": player,
            "season": season,
            "note": "no seasonal stats row (position may not be covered, or season out of range)",
        }

    row = stats.iloc[0]
    return {
        "found": True,
        "player": player,
        "season": int(row["season"]),
        "games": int(row["games"]),
        "passing": {
            "completions": int(row["completions"]),
            "attempts": int(row["attempts"]),
            "yards": float(row["passing_yards"]),
            "tds": int(row["passing_tds"]),
        },
        "rushing": {
            "carries": int(row["carries"]),
            "yards": float(row["rushing_yards"]),
            "tds": int(row["rushing_tds"]),
        },
        "receiving": {
            "receptions": int(row["receptions"]),
            "targets": int(row["targets"]),
            "yards": float(row["receiving_yards"]),
            "tds": int(row["receiving_tds"]),
        },
        "fantasy_points_ppr": float(row["fantasy_points_ppr"]),
    }


def get_surplus_leaderboard(
    position: str | None = None, sort: str = "best_value", limit: int = 10
) -> dict[str, Any]:
    """League-wide surplus/deficit leaderboard, optionally filtered by
    position.

    sort="best_value" (the default): players paid LEAST relative to their
    trailing production, i.e. team-friendly value contracts, first.
    sort="biggest_overpay": players paid MOST relative to their trailing
    production first (the team is arguably overpaying them).

    A model calling this tool should not need to reason about ascending
    vs. descending sort order itself -- the two named options say
    directly what each ordering means.
    """
    if sort not in ("best_value", "biggest_overpay"):
        return {"error": f"sort must be 'best_value' or 'biggest_overpay', got {sort!r}"}

    order_direction = "ASC" if sort == "best_value" else "DESC"

    con = _connect()
    try:
        query = f"""
            SELECT player, pos, signing_season, cap_pct_at_signing,
                   predicted_cap_pct, surplus_ratio, trailing_games,
                   trailing_fantasy_points_ppr
            FROM market_model_predictions
        """
        params: list[Any] = []
        if position is not None:
            query += " WHERE pos = ?"
            params.append(position.upper())
        query += f" ORDER BY surplus_ratio {order_direction} LIMIT ?"
        params.append(limit)

        rows = con.execute(query, params).fetchdf()
    finally:
        con.close()

    return {
        "position_filter": position,
        "sort": sort,
        "sort_meaning": (
            "ascending pay_vs_production_ratio: best value (team-friendly) contracts first"
            if sort == "best_value"
            else "descending pay_vs_production_ratio: biggest overpays (worst value for the team) first"
        ),
        "count": len(rows),
        "leaderboard": [
            {
                "player": r["player"],
                "position": r["pos"],
                "signing_season": int(r["signing_season"]),
                "pay_vs_production_ratio": round(float(r["surplus_ratio"]), 3),
                "team_is_overpaying": bool(r["surplus_ratio"] > 1),
                "actual_cap_pct": round(float(r["cap_pct_at_signing"]), 3),
                "predicted_cap_pct": round(float(r["predicted_cap_pct"]), 3),
                "low_confidence": bool(
                    r["trailing_games"] < 8 or r["trailing_fantasy_points_ppr"] < 20
                ),
            }
            for _, r in rows.iterrows()
        ],
    }


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "get_contract_details",
        "description": (
            "Look up a player's current contract facts: team, position, "
            "signing year, contract length, total value, average salary, "
            "and current cap hit. Works for any position, not just skill "
            "positions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player": {"type": "string", "description": "Player's full name"},
            },
            "required": ["player"],
        },
    },
    {
        "name": "get_surplus_value",
        "description": (
            "Get the market model's surplus/deficit valuation for a player: "
            "whether they're paid more or less than their trailing production "
            "alone would predict. Only covers QB/RB/WR/TE with resolved "
            "trailing-production data -- returns found=false with an "
            "explanation otherwise."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player": {"type": "string", "description": "Player's full name"},
            },
            "required": ["player"],
        },
    },
    {
        "name": "get_stats",
        "description": (
            "Look up a player's season statistics (skill positions only: "
            "QB/RB/WR/TE). Defaults to their most recent available season."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player": {"type": "string", "description": "Player's full name"},
                "season": {
                    "type": "integer",
                    "description": "Specific season year, e.g. 2024. Omit for most recent.",
                },
            },
            "required": ["player"],
        },
    },
    {
        "name": "get_surplus_leaderboard",
        "description": (
            "League-wide pay-vs-production leaderboard, optionally filtered by "
            "position (QB, RB, WR, TE). Use sort='best_value' for players the "
            "team is getting the most value from (paid least relative to "
            "production) -- this is what 'best value contracts' means. Use "
            "sort='biggest_overpay' for the opposite: players paid the most "
            "relative to their production."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "position": {
                    "type": "string",
                    "description": "Filter to one position: QB, RB, WR, or TE. Omit for all.",
                },
                "sort": {
                    "type": "string",
                    "enum": ["best_value", "biggest_overpay"],
                    "description": (
                        "'best_value': team-friendly contracts first (default). "
                        "'biggest_overpay': contracts where the team is paying "
                        "the most above what production justifies, first."
                    ),
                },
                "limit": {
                    "type": "integer",
                    "description": "Max rows to return (default 10).",
                },
            },
            "required": [],
        },
    },
]

TOOL_FUNCTIONS = {
    "get_contract_details": get_contract_details,
    "get_surplus_value": get_surplus_value,
    "get_stats": get_stats,
    "get_surplus_leaderboard": get_surplus_leaderboard,
}
