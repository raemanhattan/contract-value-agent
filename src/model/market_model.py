"""Point-in-time market model: log(cap_pct_at_signing) ~ production + age + position.

Trained on `training_contracts` (83 skill-position contracts signed
2023-2025 with resolved trailing production -- see build_features.py for
why the sample is this small and why it will grow once nflverse
publishes 2025 season stats).

Modeled in log space rather than on cap_pct_at_signing directly: a plain
linear model can (and did) predict negative cap percentages for very
low-production players, which is nonsensical -- cap share can't be
negative. Log-log also matches how pay scales with production in
practice (diminishing returns, multiplicative rather than additive), and
is standard for wage-type regressions.

Deliberately excludes contract length (`yrs`) as a feature: it's a
negotiation OUTCOME, not something a team uses to set the price, and
including it lets the model partly predict pay from itself. See project
notes for the discussion -- this keeps the residual interpretable as a
pure production-for-pay mismatch, matching the original spec's feature
list (production, age, position, contract year context).

Surplus/deficit = actual cap_pct_at_signing / model-predicted
cap_pct_at_signing (a ratio, since the model lives in log space). Above
1.0: player was paid MORE than their trailing production alone would
predict (a deficit for the team, often reflecting leverage/upside the
model can't see from one season of stats). Below 1.0: paid LESS than
production predicts (a team-friendly/value contract).
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

DB_PATH = Path("data/db/contract_value.duckdb")
MODEL_PATH = Path("data/db/market_model.pickle")

FORMULA = "log_cap_pct ~ log_ppr + age_at_signing + C(pos)"


def _add_derived_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["log_ppr"] = np.log1p(df["trailing_fantasy_points_ppr"].clip(lower=0))
    if "cap_pct_at_signing" in df.columns:
        df["log_cap_pct"] = np.log(df["cap_pct_at_signing"])
    return df


def fit_market_model(training_df: pd.DataFrame) -> sm.regression.linear_model.RegressionResultsWrapper:
    df = _add_derived_columns(training_df)
    return smf.ols(FORMULA, data=df).fit()


def predict_with_interval(
    model: sm.regression.linear_model.RegressionResultsWrapper,
    df: pd.DataFrame,
    alpha: float = 0.10,
) -> pd.DataFrame:
    """Predicted cap_pct_at_signing plus a prediction interval (not just a
    confidence interval on the mean) -- the spec calls for intervals, not
    point estimates, given the small-n regime. Predictions are made in log
    space then exponentiated back, which guarantees a positive cap_pct.
    """
    df = _add_derived_columns(df)
    pred = model.get_prediction(df)
    summary = pred.summary_frame(alpha=alpha)
    return pd.DataFrame(
        {
            "predicted_cap_pct": np.exp(summary["mean"]),
            "pred_lower": np.exp(summary["obs_ci_lower"]),
            "pred_upper": np.exp(summary["obs_ci_upper"]),
        },
        index=df.index,
    )


def main() -> None:
    con = duckdb.connect(str(DB_PATH))
    training_df = con.execute("SELECT * FROM training_contracts").fetchdf()

    model = fit_market_model(training_df)
    print(model.summary())

    predictions = predict_with_interval(model, training_df)
    result = pd.concat([training_df, predictions], axis=1)
    # Ratio, not a difference, since the model lives in log space: 1.5
    # means "paid 50% more than production alone predicts", 0.5 means
    # "paid half of what production alone predicts."
    result["surplus_ratio"] = result["cap_pct_at_signing"] / result["predicted_cap_pct"]

    con.execute("DROP TABLE IF EXISTS market_model_predictions")
    con.execute("CREATE TABLE market_model_predictions AS SELECT * FROM result")

    assert (result["predicted_cap_pct"] > 0).all(), "model produced a non-positive prediction"

    model.save(str(MODEL_PATH))
    print(f"fitted model saved to {MODEL_PATH} (for the API's peer-comparison scatter plot)")

    print("\nTop 5 biggest deficits for the team (paid above model prediction):")
    print(
        result.nlargest(5, "surplus_ratio")[
            ["player", "pos", "cap_pct_at_signing", "predicted_cap_pct", "surplus_ratio"]
        ]
    )

    print("\nTop 5 best value contracts (paid below model prediction):")
    print(
        result.nsmallest(5, "surplus_ratio")[
            ["player", "pos", "cap_pct_at_signing", "predicted_cap_pct", "surplus_ratio"]
        ]
    )

    con.close()
    print(f"\nmarket_model_predictions table written to {DB_PATH}")


if __name__ == "__main__":
    main()
