"""Provider-agnostic agent loop: decomposes a natural-language question
into tool calls against the DuckDB-backed tools in agent/tools.py, and
returns a final answer grounded in the tool results.

Two backends:
  - "ollama"    -- local models via the Ollama HTTP API (free, for dev
                   iteration). Set OLLAMA_MODEL to choose the model.
  - "anthropic" -- Claude via the API (used for the real eval harness run
                   and the final demo, where quality matters more than
                   cost).

Swapping backends is a one-line change (the AGENT_BACKEND env var), not
a rewrite -- both paths share the same tool schemas and the same
tool-execution code in agent/tools.py.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from agent.tools import TOOL_FUNCTIONS, TOOL_SCHEMAS

SYSTEM_PROMPT = """You are a contract-value analyst for NFL players. You have \
tools to look up contract details, market-model surplus/deficit valuations, \
season stats, and league-wide leaderboards. Decompose the user's question into \
the tool calls needed to answer it, then write a short memo-style answer that \
cites the specific numbers your tools returned. Never state a number you did \
not get from a tool call. If a tool returns found=false, say so plainly rather \
than guessing."""


@dataclass
class AgentResult:
    answer: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def _execute_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    fn = TOOL_FUNCTIONS.get(name)
    if fn is None:
        return {"error": f"unknown tool: {name}"}
    try:
        return fn(**arguments)
    except TypeError as e:
        return {"error": f"bad arguments for {name}: {e}"}


def _run_anthropic(question: str, model: str, max_turns: int) -> AgentResult:
    import anthropic

    client = anthropic.Anthropic()
    messages: list[dict[str, Any]] = [{"role": "user", "content": question}]
    tool_calls: list[dict[str, Any]] = []

    for _ in range(max_turns):
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOL_SCHEMAS,
            messages=messages,
        )

        if response.stop_reason != "tool_use":
            text = "".join(b.text for b in response.content if b.type == "text")
            return AgentResult(answer=text, tool_calls=tool_calls)

        messages.append({"role": "assistant", "content": response.content})
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            result = _execute_tool(block.name, block.input)
            tool_calls.append({"tool": block.name, "arguments": block.input, "result": result})
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                }
            )
        messages.append({"role": "user", "content": tool_results})

    return AgentResult(answer="(reached max tool-call turns without a final answer)", tool_calls=tool_calls)


def _ollama_tool_schemas() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": s["name"],
                "description": s["description"],
                "parameters": s["input_schema"],
            },
        }
        for s in TOOL_SCHEMAS
    ]


# Some Ollama models (observed with qwen3.5:9b) default to a huge context
# window (256k+) that makes Ollama allocate a large KV cache before
# generating even one token, adding tens of seconds of latency per call
# regardless of prompt size. Force a small window explicitly -- our
# prompts plus tool schemas are nowhere near this.
OLLAMA_NUM_CTX = 4096


def _run_ollama(question: str, model: str, max_turns: int) -> AgentResult:
    import ollama

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    tool_calls: list[dict[str, Any]] = []
    tools = _ollama_tool_schemas()

    for turn in range(max_turns):
        is_last_turn = turn == max_turns - 1
        # On the final allowed turn, withhold tool access so the model is
        # forced to answer in plain text from whatever it already has,
        # instead of requesting yet another tool call and running out the
        # clock with no final answer at all (observed: a model calling
        # tool after tool without ever concluding within max_turns).
        response = ollama.chat(
            model=model,
            messages=messages,
            tools=None if is_last_turn else tools,
            options={"num_ctx": OLLAMA_NUM_CTX},
        )
        message = response["message"]

        requested = message.get("tool_calls") or []
        if not requested:
            return AgentResult(answer=message.get("content", ""), tool_calls=tool_calls)

        messages.append(message)
        for call in requested:
            name = call["function"]["name"]
            arguments = call["function"]["arguments"]
            if isinstance(arguments, str):
                arguments = json.loads(arguments)
            result = _execute_tool(name, arguments)
            tool_calls.append({"tool": name, "arguments": arguments, "result": result})
            messages.append(
                {
                    "role": "tool",
                    "content": json.dumps(result),
                }
            )

    return AgentResult(answer="(reached max tool-call turns without a final answer)", tool_calls=tool_calls)


def ask(question: str, backend: str | None = None, model: str | None = None, max_turns: int = 6) -> AgentResult:
    backend = backend or os.environ.get("AGENT_BACKEND", "ollama")
    if backend == "anthropic":
        model = model or os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
        return _run_anthropic(question, model, max_turns)
    elif backend == "ollama":
        # ministral-3:3b (3.8B) supports tool-calling but was observed to
        # fabricate entire tool results (wrong teams, invented dollar
        # figures) without actually invoking a tool, presented as if it
        # had -- a serious grounding failure, not just a formatting quirk.
        # qwen3.5:9b reliably calls tools and grounds its answer in the
        # real results. qwen3.5:4b tests just as reliably grounded and
        # noticeably faster (single-digit seconds warm vs 9b's ~15s), so
        # it's the default for the dev iteration loop.
        model = model or os.environ.get("OLLAMA_MODEL", "qwen3.5:4b")
        return _run_ollama(question, model, max_turns)
    else:
        raise ValueError(f"unknown backend: {backend}")


if __name__ == "__main__":
    import sys

    q = sys.argv[1] if len(sys.argv) > 1 else "Is Josh Allen's contract a good value?"
    result = ask(q)
    print("=== Tool calls ===")
    for tc in result.tool_calls:
        print(f"  {tc['tool']}({tc['arguments']}) -> {json.dumps(tc['result'])[:200]}")
    print("\n=== Answer ===")
    print(result.answer)
