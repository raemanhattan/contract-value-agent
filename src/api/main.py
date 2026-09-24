"""FastAPI backend for the Contract Value and Performance Analysis Agent.

Endpoints matching the original deliverables plus the peer-comparison
scatter added after early UI feedback (numbers alone -- "ratio 3.73" --
didn't convey the story; seeing a player's dot against real peers with
the model's fitted curve does):
  POST /api/ask           -- natural-language query interface (the agent)
  GET  /api/leaderboard   -- league-wide surplus/deficit leaderboard
  GET  /api/player/{name} -- one player's contract + market-model detail
  GET  /api/scatter/{pos} -- all training contracts at this position
                             (production vs. pay) plus the model's fitted
                             curve, for the peer-comparison chart

Run: PYTHONPATH=src .venv/bin/uvicorn api.main:app --reload --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent.run import ask as agent_ask
from agent.tools import get_contract_details, get_stats, get_surplus_value
from model.market_model import MODEL_PATH, predict_with_interval

DB_PATH = Path("data/db/contract_value.duckdb")

_market_model: sm.regression.linear_model.RegressionResultsWrapper | None = None


def _load_market_model() -> sm.regression.linear_model.RegressionResultsWrapper:
    global _market_model
    if _market_model is None:
        _market_model = sm.load(str(MODEL_PATH))
    return _market_model

app = FastAPI(title="Contract Value Agent API")

# CORS_ALLOWED_ORIGINS is a comma-separated list -- the portfolio shell's
# origin and this app's own standalone frontend origin both need to be
# listed in production, since they're different hosts.
_default_origins = "http://localhost:3000,http://localhost:3001"
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _connect() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(DB_PATH), read_only=True)


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str
    tool_calls: list[dict[str, Any]]


@app.post("/api/ask", response_model=AskResponse)
def ask(request: AskRequest) -> AskResponse:
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    result = agent_ask(request.question)
    return AskResponse(answer=result.answer, tool_calls=result.tool_calls)


@app.get("/api/leaderboard")
def leaderboard(
    position: str | None = Query(default=None, description="QB, RB, WR, or TE"),
    sort: str = Query(default="best_value", pattern="^(best_value|biggest_overpay)$"),
    limit: int = Query(default=25, ge=1, le=200),
) -> dict[str, Any]:
    order_direction = "ASC" if sort == "best_value" else "DESC"
    con = _connect()
    try:
        query = "SELECT * FROM market_model_predictions"
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
        "count": len(rows),
        "players": [
            {
                "player": r["player"],
                "position": r["pos"],
                "team": r["team_currently_with"],
                "signing_season": int(r["signing_season"]),
                "age_at_signing": int(r["age_at_signing"]),
                "actual_cap_pct": round(float(r["cap_pct_at_signing"]), 3),
                "predicted_cap_pct": round(float(r["predicted_cap_pct"]), 3),
                "pred_lower": round(float(r["pred_lower"]), 3),
                "pred_upper": round(float(r["pred_upper"]), 3),
                "pay_vs_production_ratio": round(float(r["surplus_ratio"]), 3),
                "team_is_overpaying": bool(r["surplus_ratio"] > 1),
                "trailing_fantasy_points_ppr": float(r["trailing_fantasy_points_ppr"]),
                "trailing_games": int(r["trailing_games"]),
                "low_confidence": bool(
                    r["trailing_games"] < 8 or r["trailing_fantasy_points_ppr"] < 20
                ),
            }
            for _, r in rows.iterrows()
        ],
    }


def _stats_history(player: str) -> list[dict[str, Any]]:
    """Every season of stats on record for this player (all years the
    stats_player source has, not just the one season get_stats returns),
    for the player page's career stats table.
    """
    con = _connect()
    try:
        player_id_row = con.execute(
            "SELECT player_id FROM player_crosswalk WHERE lower(player) = lower(?)",
            [player],
        ).fetchdf()
        if player_id_row.empty or player_id_row.iloc[0]["player_id"] is None:
            return []
        player_id = player_id_row.iloc[0]["player_id"]

        rows = con.execute(
            """
            SELECT season, games, completions, attempts, passing_yards, passing_tds,
                   carries, rushing_yards, rushing_tds,
                   receptions, targets, receiving_yards, receiving_tds,
                   fantasy_points_ppr
            FROM seasonal_stats
            WHERE player_id = ? AND season_type = 'REG'
            ORDER BY season DESC
            """,
            [player_id],
        ).fetchdf()
    finally:
        con.close()

    return [
        {
            "season": int(r["season"]),
            "games": int(r["games"]),
            "passing_yards": float(r["passing_yards"]),
            "passing_tds": int(r["passing_tds"]),
            "rushing_yards": float(r["rushing_yards"]),
            "rushing_tds": int(r["rushing_tds"]),
            "receptions": int(r["receptions"]),
            "receiving_yards": float(r["receiving_yards"]),
            "receiving_tds": int(r["receiving_tds"]),
            "fantasy_points_ppr": float(r["fantasy_points_ppr"]),
        }
        for _, r in rows.iterrows()
    ]


@app.get("/api/player/{name}")
def player_detail(name: str) -> dict[str, Any]:
    contract = get_contract_details(name)
    surplus = get_surplus_value(name)
    stats = get_stats(name)
    stats_history = _stats_history(name)

    if not contract.get("found") and not surplus.get("found"):
        raise HTTPException(status_code=404, detail=f"no data found for player: {name}")

    return {
        "player": name,
        "contract": contract,
        "surplus": surplus,
        "stats": stats,
        "stats_history": stats_history,
    }


@app.get("/api/scatter/{position}")
def scatter(position: str) -> dict[str, Any]:
    position = position.upper()
    if position not in ("QB", "RB", "WR", "TE"):
        raise HTTPException(status_code=400, detail="position must be one of QB, RB, WR, TE")

    con = _connect()
    try:
        rows = con.execute(
            "SELECT * FROM market_model_predictions WHERE pos = ?", [position]
        ).fetchdf()
    finally:
        con.close()

    if rows.empty:
        return {"position": position, "points": [], "fitted_curve": []}

    # The fitted curve: predicted cap% across a range of trailing production
    # values, holding age fixed at this position's median signing age (the
    # model also depends on age, so a 2D curve needs one age to plot
    # against). This is what turns "ratio 3.73" into something visual: a
    # player's own dot sitting above or below this line among real peers.
    median_age = float(rows["age_at_signing"].median())
    max_ppr = float(rows["trailing_fantasy_points_ppr"].max())
    curve_ppr = np.linspace(0, max(max_ppr * 1.1, 50), 40)
    curve_df = pd.DataFrame(
        {
            "trailing_fantasy_points_ppr": curve_ppr,
            "age_at_signing": median_age,
            "pos": position,
        }
    )
    model = _load_market_model()
    curve_pred = predict_with_interval(model, curve_df)

    return {
        "position": position,
        "median_age_at_signing": median_age,
        "points": [
            {
                "player": r["player"],
                "trailing_fantasy_points_ppr": float(r["trailing_fantasy_points_ppr"]),
                "actual_cap_pct": round(float(r["cap_pct_at_signing"]), 3),
                "age_at_signing": int(r["age_at_signing"]),
                "signing_season": int(r["signing_season"]),
                "team_is_overpaying": bool(r["surplus_ratio"] > 1),
                "low_confidence": bool(
                    r["trailing_games"] < 8 or r["trailing_fantasy_points_ppr"] < 20
                ),
            }
            for _, r in rows.iterrows()
        ],
        "fitted_curve": [
            {
                "trailing_fantasy_points_ppr": round(float(x), 1),
                "predicted_cap_pct": round(float(y), 3),
            }
            for x, y in zip(curve_ppr, curve_pred["predicted_cap_pct"])
        ],
    }


@app.get("/api/model-info")
def model_info() -> dict[str, Any]:
    """Real statistics from the fitted market model, for the dashboard's
    methodology section -- every number here comes directly from the
    trained statsmodels result, not hardcoded or approximated.
    """
    model = _load_market_model()
    con = _connect()
    try:
        total_contracts = con.execute("SELECT COUNT(*) FROM contracts_2026").fetchone()[0]
        by_pos = con.execute(
            "SELECT pos, COUNT(*) FROM training_contracts GROUP BY pos ORDER BY pos"
        ).fetchall()
        not_yet_priced = con.execute(
            "SELECT COUNT(*) FROM point_in_time_features "
            "WHERE missing_player_id OR missing_trailing_stats"
        ).fetchone()[0]
    finally:
        con.close()

    coefficients = {
        name: {"estimate": round(float(val), 4), "p_value": round(float(model.pvalues[name]), 6)}
        for name, val in model.params.items()
    }

    return {
        "formula": "log(cap_pct_at_signing) ~ log(1 + trailing_fantasy_points) + age_at_signing + position",
        "r_squared": round(float(model.rsquared), 3),
        "training_sample_size": int(model.nobs),
        "training_sample_by_position": {pos: int(n) for pos, n in by_pos},
        "total_contracts_in_dataset": int(total_contracts),
        "contracts_not_yet_priced": int(not_yet_priced),
        "coefficients": coefficients,
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
