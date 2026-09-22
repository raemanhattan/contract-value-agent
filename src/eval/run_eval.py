"""Run the fixed eval cases against the agent and report pass rate +
failure analysis. Built before any UI work, per the project's original
build order -- this is what separates a credible agent from a demo.

Each case runs multiple times (default 3): LLM sampling means the same
question can be answered correctly one run and incorrectly the next, so
a single pass/fail per case would be misleading. A per-case pass RATE
(e.g. 2/3) is the honest way to report this, and it's also what
surfaces genuine flakiness as a finding in its own right rather than
noise to explain away.

Transient failures (e.g. an Ollama server error mid-run, observed during
harness development: "unexpected EOF, status 500") are retried a few
times before being recorded as a failed attempt -- a crashed harness run
is a worse outcome than one recorded failure.

Usage:
    PYTHONPATH=src .venv/bin/python3 src/eval/run_eval.py
    PYTHONPATH=src .venv/bin/python3 src/eval/run_eval.py --backend anthropic
    PYTHONPATH=src .venv/bin/python3 src/eval/run_eval.py --repeats 5
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from dataclasses import dataclass, field

from agent.run import ask
from eval.cases import EVAL_CASES, EvalCase

MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 3

# Matches a number optionally preceded by $ and followed by a scale word
# (million/billion/M/B) or a percent sign, e.g.:
#   "504,750,000"  "$504.75 million"  "$504.75M"  "19.7%"  "1.292"
_NUMBER_RE = re.compile(
    r"\$?\s*(-?\d[\d,]*\.?\d*)\s*(million|billion|thousand|[mMbBkK])?\s*(%|percent)?"
)
_SCALE_WORDS = {
    "million": 1_000_000,
    "billion": 1_000_000_000,
    "thousand": 1_000,
    "m": 1_000_000,
    "b": 1_000_000_000,
    "k": 1_000,
}


def extract_numbers(text: str) -> list[float]:
    """Pull every plausible numeric value out of free text, normalizing
    scale words/suffixes ("$504.75 million" -> 504750000.0) and percent
    signs (kept as the bare percentage figure, e.g. "19.7%" -> 19.7, since
    that's how ground-truth percentages are stored in this project).
    """
    numbers: list[float] = []
    for match in _NUMBER_RE.finditer(text):
        digits, scale_word, _percent = match.groups()
        if not digits or digits in ("-", "."):
            continue
        try:
            value = float(digits.replace(",", ""))
        except ValueError:
            continue
        if scale_word:
            value *= _SCALE_WORDS.get(scale_word.lower(), 1)
        numbers.append(value)
    return numbers


def contains_number(text: str, expected: float, tolerance: float) -> bool:
    for value in extract_numbers(text):
        if expected == 0:
            if abs(value) <= tolerance:
                return True
        elif abs(value - expected) / abs(expected) <= tolerance:
            return True
    return False


@dataclass
class AttemptResult:
    passed: bool
    answer: str
    tools_called: list[str]
    failures: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass
class CaseSummary:
    case: EvalCase
    attempts: list[AttemptResult] = field(default_factory=list)

    @property
    def pass_count(self) -> int:
        return sum(1 for a in self.attempts if a.passed)

    @property
    def total(self) -> int:
        return len(self.attempts)

    @property
    def all_passed(self) -> bool:
        return self.total > 0 and self.pass_count == self.total

    @property
    def flaky(self) -> bool:
        return 0 < self.pass_count < self.total


def score_case(case: EvalCase, answer: str, tools_called: list[str]) -> tuple[bool, list[str]]:
    answer_lower = answer.lower()
    failures: list[str] = []

    for substring in case.must_contain:
        if substring.lower() not in answer_lower:
            failures.append(f"missing required text: {substring!r}")

    for expected_value, tolerance in case.must_contain_number:
        if not contains_number(answer, expected_value, tolerance):
            failures.append(
                f"missing required number: {expected_value} (±{tolerance:.0%}) -- "
                f"found: {extract_numbers(answer)}"
            )

    for substring in case.must_not_contain:
        if substring.lower() in answer_lower:
            failures.append(f"contains forbidden text: {substring!r}")

    for tool_name in case.expected_tools:
        if tool_name not in tools_called:
            failures.append(f"did not call expected tool: {tool_name!r} (called: {tools_called})")

    return not failures, failures


def run_one_attempt(case: EvalCase, backend: str | None, model: str | None) -> AttemptResult:
    last_error: Exception | None = None
    for attempt_num in range(MAX_RETRIES + 1):
        try:
            agent_result = ask(case.question, backend=backend, model=model)
            tools_called = [tc["tool"] for tc in agent_result.tool_calls]
            passed, failures = score_case(case, agent_result.answer, tools_called)
            return AttemptResult(
                passed=passed,
                answer=agent_result.answer,
                tools_called=tools_called,
                failures=failures,
            )
        except Exception as e:  # noqa: BLE001 -- transient backend errors, retry then record
            last_error = e
            if attempt_num < MAX_RETRIES:
                print(
                    f"      (attempt {attempt_num + 1} errored: {e}; retrying)",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY_SECONDS)

    return AttemptResult(
        passed=False,
        answer="",
        tools_called=[],
        failures=[f"agent call failed after {MAX_RETRIES + 1} attempts: {last_error}"],
        error=str(last_error),
    )


def run_all(backend: str | None, model: str | None, repeats: int) -> list[CaseSummary]:
    summaries: list[CaseSummary] = []
    for case in EVAL_CASES:
        summary = CaseSummary(case=case)
        for run_idx in range(repeats):
            print(f"  running: {case.id} ({run_idx + 1}/{repeats}) ...", file=sys.stderr)
            attempt = run_one_attempt(case, backend, model)
            summary.attempts.append(attempt)
            print(f"    {'PASS' if attempt.passed else 'FAIL'}", file=sys.stderr)
        summaries.append(summary)
    return summaries


def print_report(summaries: list[CaseSummary]) -> None:
    total_attempts = sum(s.total for s in summaries)
    total_passed = sum(s.pass_count for s in summaries)
    fully_passing_cases = sum(1 for s in summaries if s.all_passed)
    flaky_cases = [s for s in summaries if s.flaky]

    print(f"\n{'=' * 70}")
    print(
        f"EVAL RESULTS: {total_passed}/{total_attempts} attempts passed "
        f"({100 * total_passed / total_attempts:.0f}%) | "
        f"{fully_passing_cases}/{len(summaries)} cases fully passing"
    )
    if flaky_cases:
        print(f"FLAKY (inconsistent across repeats): {len(flaky_cases)} case(s)")
    print(f"{'=' * 70}\n")

    by_category: dict[str, list[CaseSummary]] = {}
    for s in summaries:
        by_category.setdefault(s.case.category, []).append(s)

    for category, cat_summaries in sorted(by_category.items()):
        cat_fully_passing = sum(1 for s in cat_summaries if s.all_passed)
        print(f"[{category}] {cat_fully_passing}/{len(cat_summaries)} cases fully passing")
        for s in cat_summaries:
            if s.all_passed:
                status = "PASS"
            elif s.flaky:
                status = "FLAKY"
            else:
                status = "FAIL"
            print(f"  {status}  {s.case.id}  ({s.pass_count}/{s.total})")
            if status != "PASS":
                print(f"        question: {s.case.question}")
                for i, attempt in enumerate(s.attempts):
                    if not attempt.passed:
                        print(f"        attempt {i + 1} failures:")
                        for failure in attempt.failures:
                            print(f"          - {failure}")
                        if attempt.answer:
                            print(f"          answer: {attempt.answer[:250]}")
        print()

    if fully_passing_cases < len(summaries):
        print("Failure analysis:")
        for s in summaries:
            if not s.all_passed:
                all_failures = {f for a in s.attempts for f in a.failures}
                print(f"  {s.case.id} ({s.case.category}) [{s.pass_count}/{s.total}]: {'; '.join(all_failures)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["ollama", "anthropic"], default=None)
    parser.add_argument("--model", default=None)
    parser.add_argument(
        "--repeats",
        type=int,
        default=3,
        help="Times to run each case (default 3, to distinguish real failures from LLM sampling noise).",
    )
    args = parser.parse_args()

    summaries = run_all(args.backend, args.model, args.repeats)
    print_report(summaries)

    fully_passing = sum(1 for s in summaries if s.all_passed)
    sys.exit(0 if fully_passing == len(summaries) else 1)


if __name__ == "__main__":
    main()
