"""Fixed evaluation cases for the contract-value agent.

Each case has a question and a set of checks against the agent's final
answer text. This is deliberately checking the FINAL ANSWER TEXT, not
just whether the right tool was called -- an agent that calls the right
tool but then reports the numbers wrong (as we saw happen: a small model
correctly retrieved a leaderboard but then transcribed 0.895 as "8.95%")
should fail the eval, not pass it.

Checks are simple and explicit on purpose: numbers that must appear
WITHIN TOLERANCE regardless of formatting (must_contain_number -- see
eval/run_eval.py's extract_numbers/contains_number, which normalize
"$504.75 million", "504.75M", and "504,750,000" to the same value), and
phrases that must or must not appear (to catch direction-of-interpretation
errors like calling an overpay a "surplus" in the good-value sense, or
fabricating data when a tool returns found=false).

Earlier versions of this file checked numbers as exact substrings
(must_contain=["504,750,000"]), which produced a long tail of false
FLAKY/FAIL results against fully correct answers that merely reformatted
a number ("$504.75 million" instead of "504,750,000", "19.7%" instead of
"19.699"). Prefer must_contain_number for any numeric fact; reserve
must_contain for actual words/phrases.

Ground truth values were pulled directly from the database
(market_model_predictions, contracts_2026, cap_hits) at harness-writing
time -- see the comment on each case for the source query. If the
underlying data changes (e.g. once nflverse publishes 2025 stats and
training_contracts grows), these cases will need to be regenerated, not
hand-tweaked -- a case that starts failing because the ANSWER changed
correctly is not a false failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EvalCase:
    id: str
    question: str
    category: str
    # Substrings that must all appear somewhere in the final answer
    # (case-insensitive). Use for NON-numeric facts/phrases -- for
    # numbers, prefer must_contain_number (see below), since models
    # legitimately reformat numbers ("$504.75 million" vs "504,750,000")
    # in ways exact substring matching can't handle.
    must_contain: list[str] = field(default_factory=list)
    # Numeric values that must appear somewhere in the answer, WITHIN
    # TOLERANCE, regardless of formatting -- "$504.75 million", "504.75M",
    # and "504,750,000" all extract to the same underlying number. Each
    # entry is (expected_value, relative_tolerance), e.g. (504750000, 0.01)
    # for 1% tolerance, or (19.699, 0.02) for a percentage figure that
    # might be reported as "19.7%" (rounded) or "19.699%" (exact).
    must_contain_number: list[tuple[float, float]] = field(default_factory=list)
    # Substrings that must NOT appear (case-insensitive). Use to catch
    # known failure modes: wrong direction of interpretation, fabricated
    # facts, or claims the data doesn't support.
    must_not_contain: list[str] = field(default_factory=list)
    # Which tool(s) the agent should have called at least once. An
    # answer can cite the right numbers by luck/memorization without
    # calling a tool -- for an agent whose whole premise is grounding in
    # retrieved data, that's still a failure worth catching.
    expected_tools: list[str] = field(default_factory=list)
    notes: str = ""


EVAL_CASES: list[EvalCase] = [
    # --- Contract fact lookups (no market model needed) ---
    EvalCase(
        id="contract_facts_mahomes",
        question="What is Patrick Mahomes' contract worth in total?",
        category="contract_facts",
        must_contain_number=[(504_750_000, 0.01)],
        expected_tools=["get_contract_details"],
        notes=(
            "contracts_2026: Mahomes, 8 yrs, $504,750,000 total value, signed "
            "2026. Not checking for '8' (contract length) as a number check: "
            "a bare small integer like 8 is too generic to be a meaningful "
            "signal (could spuriously match against unrelated small numbers "
            "in the answer) -- reserved for facts distinctive enough that a "
            "match actually demonstrates grounding."
        ),
    ),
    EvalCase(
        id="contract_facts_current_cap_hit",
        question="What is Patrick Mahomes' current cap hit in 2026?",
        category="contract_facts",
        must_contain_number=[(34_653_888, 0.01)],
        expected_tools=["get_contract_details"],
        notes="cap_hits: Mahomes 2026 cap_hit = $34,653,888 (11.51% of cap).",
    ),
    # --- Non-skill-position handling (should decline gracefully, not fabricate) ---
    EvalCase(
        id="non_skill_position_no_fabrication",
        question="Is there a market model valuation for Trent Williams?",
        category="grounding",
        must_contain=["no"],
        must_not_contain=["ratio is", "ratio of", "valuation is 0", "valuation is 1", "valuation is 2"],
        expected_tools=["get_surplus_value"],
        notes=(
            "Trent Williams is an offensive tackle -- get_surplus_value should "
            "return found=false. The agent must say so, not invent a number. "
            "must_not_contain targets phrases that would precede a fabricated "
            "ratio ('the ratio is X') rather than banning any string "
            "containing a bare digit-dot pattern like '2.' -- the earlier "
            "version banned '2.' outright and flagged a genuinely correct "
            "answer FLAKY for containing an unrelated '2.' substring (e.g. "
            "inside an unrelated sentence, not a fabricated number). Only "
            "requires 'no', not also 'not': a correct answer starting "
            "'No, there is no market model valuation...' does not contain "
            "the standalone word 'not' and was wrongly marked FLAKY for it."
        ),
    ),
    EvalCase(
        id="unknown_player_no_fabrication",
        question="What is the surplus value for Bartholomew Fizzlewick?",
        category="grounding",
        must_contain=["no"],
        must_not_contain=["ratio: 0.", "ratio: 1.", "ratio: 2.", "ratio: 3."],
        expected_tools=["get_surplus_value"],
        notes=(
            "Nonexistent player -- tests the agent doesn't invent a "
            "plausible-sounding answer for a name it doesn't recognize. "
            "Checking only for a bare 'no' plus a ban on any plausible "
            "fabricated ratio value, rather than exact phrasing: valid "
            "correct answers were observed phrased as 'No market-model "
            "surplus/deficit valuation is available...', 'There is no "
            "surplus value available...', etc. -- different wording, same "
            "correct substance. An exact-phrase match produced false FLAKY "
            "results against genuinely correct answers during harness "
            "development."
        ),
    ),
    # --- Surplus/deficit direction interpretation ---
    EvalCase(
        id="surplus_direction_overpay",
        question="Is Josh Allen's contract a good value for the Bills, or is he overpaid relative to his production?",
        category="surplus_direction",
        must_contain=["overpa"],
        must_contain_number=[(1.74, 0.03)],
        must_not_contain=["not good value\" is false", "is good value, not"],
        expected_tools=["get_surplus_value"],
        notes=(
            "market_model_predictions: Allen actual=19.699% predicted=11.33%, "
            "surplus_ratio=1.74 (>1 = team overpaying). This is the exact "
            "case where a model (ministral-3:3b) inverted the interpretation "
            "during manual testing -- calling an overpay a 'surplus' in the "
            "good sense. Checks only the ratio itself (the number every "
            "observed correct answer cites) rather than the actual/predicted "
            "cap percentages, which a correct answer may summarize via the "
            "ratio and interpretation text without restating both raw "
            "numbers. NOTE: this ground-truth ratio shifted from 1.29 to "
            "1.74 after the training set grew from 83 to 174 contracts "
            "(2025 stats became available via a corrected nflverse data "
            "source) and the model was refit -- update this value again "
            "whenever the model is retrained, per the module docstring."
        ),
    ),
    EvalCase(
        id="surplus_direction_good_value",
        question="Is Mac Jones's contract good value for his team?",
        category="surplus_direction",
        must_contain=["value"],
        must_contain_number=[(0.25, 0.05)],
        must_not_contain=["mac jones is overpaid", "team is overpaying mac jones"],
        expected_tools=["get_surplus_value"],
        notes=(
            "market_model_predictions: Mac Jones actual=1.506% predicted=7.909%, "
            "surplus_ratio=0.19 (<1 = team-friendly value contract). Checks "
            "only the ratio (0.19), not the raw actual/predicted cap "
            "percentages -- a correct answer may summarize via the ratio "
            "without restating both raw numbers. Checks the bare word "
            "'value' rather than the exact phrase 'good value': a fully "
            "correct answer was observed saying 'excellent value' instead, "
            "a valid synonym the exact-phrase check wrongly flagged FLAKY. "
            "Also bans specific wrong-direction claims rather than the word "
            "'overpaying' outright, since a thorough correct answer may use "
            "that word while explaining what the ratio does NOT mean."
        ),
    ),
    # --- Leaderboard direction (the sort= bug we found and fixed) ---
    EvalCase(
        id="leaderboard_best_value_direction",
        question="Who are the best value QB contracts right now?",
        category="leaderboard_direction",
        must_contain=["tua tagovailoa", "kyler murray"],
        must_not_contain=["gardner minshew", "jarrett stidham"],
        expected_tools=["get_surplus_leaderboard"],
        notes=(
            "'Best value' must retrieve LOW pay_vs_production_ratio (Tua "
            "Tagovailoa 0.058, Kyler Murray 0.094), not the biggest-overpay "
            "end of the list (Minshew 5.48, Stidham 4.55). This is the exact "
            "bug found in manual testing before sort='best_value'/"
            "'biggest_overpay' was added to the tool. NOTE: which specific "
            "players top this list shifts whenever the model is retrained "
            "on a different sample (it moved from Drew Lock/Mac Jones to "
            "Tua/Murray when the training set grew from 83 to 174 contracts) "
            "-- re-check with a fresh DuckDB query after any retrain rather "
            "than assuming these names are permanent."
        ),
    ),
    EvalCase(
        id="leaderboard_worst_value_direction",
        question="Which QB contracts have the team paying the most above what production justifies?",
        category="leaderboard_direction",
        must_contain=["gardner minshew"],
        must_not_contain=["tua tagovailoa", "kyler murray"],
        expected_tools=["get_surplus_leaderboard"],
        notes="Inverse of the above case -- checks 'biggest_overpay' sort direction independently.",
    ),
    # --- Low-confidence flagging (near-zero-production extreme ratios) ---
    EvalCase(
        id="low_confidence_flagged",
        question="What is Jarrett Stidham's pay-vs-production ratio, and how confident should I be in that number?",
        category="low_confidence",
        must_contain=["low", "confidence"],
        must_contain_number=[(4.55, 0.03)],
        expected_tools=["get_surplus_value"],
        notes=(
            "Stidham: surplus_ratio=4.55 (as of the 174-contract retrain; "
            "was 3.73 on the original 83-contract fit -- re-verify after any "
            "retrain) on only 2 trailing games / 0.5 fantasy points. The "
            "agent should surface the low_confidence flag and explain why "
            "(near-zero production denominator), not just report the "
            "extreme ratio at face value."
        ),
    ),
    # --- Stats lookups ---
    EvalCase(
        id="stats_lookup_most_recent_season",
        question="How many games did Christian McCaffrey play last season and what were his stats?",
        category="stats",
        must_contain_number=[(1202, 0.02), (924, 0.02)],
        expected_tools=["get_stats"],
        notes=(
            "get_stats defaults to the player's MOST RECENT season on "
            "record. seasonal_stats 2025: McCaffrey played a full healthy "
            "17 games, 1,202 rushing yards, 924 receiving yards. NOTE: this "
            "case previously targeted his injury-shortened 2024 season (4 "
            "games, 202 rush / 146 rec yards) when 2024 was the most recent "
            "data available -- once 2025 stats were added, 'last season' "
            "correctly started meaning 2025, and the eval case's ground "
            "truth had to move with it rather than the agent being wrong. "
            "Whenever a new season's data is added, re-verify which season "
            "is now 'most recent' for any case like this one."
        ),
    ),
    EvalCase(
        id="stats_lookup_rookie_no_data",
        question="What were Ashton Jeanty's stats before he signed his rookie contract?",
        category="stats",
        must_contain=["no", "rookie"],
        notes=(
            "Ashton Jeanty is a 2025 rookie -- no pre-draft NFL production "
            "exists in seasonal_stats. The agent should explain this is a "
            "rookie-contract case (slotted by draft position, not production "
            "history), not fabricate college stats or claim a valuation exists."
        ),
    ),
    # --- Multi-tool decomposition ---
    EvalCase(
        id="multi_tool_comparison",
        question="Compare Josh Allen's and Joe Burrow's contracts: who got the better deal for their team?",
        category="multi_step",
        must_contain=["allen", "burrow"],
        expected_tools=["get_surplus_value"],
        notes=(
            "Requires calling get_surplus_value for BOTH players (Allen "
            "surplus_ratio=1.292, Burrow=1.44) and comparing -- Burrow is the "
            "bigger overpay of the two. Tests whether the agent decomposes a "
            "comparison into multiple tool calls rather than answering from "
            "one lookup or memory. Deliberately not checking for the exact "
            "ratio strings ('1.292'/'1.44'): a correct answer may round "
            "differently (1.29 vs 1.292) or lead with a comparison table "
            "before the raw numbers -- verify tool calls and correctness by "
            "reading the transcript, not brittle substring matching, for "
            "this more open-ended case."
        ),
    ),
]
