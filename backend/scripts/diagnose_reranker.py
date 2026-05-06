#!/usr/bin/env python3
"""Standalone cross-encoder diagnostic runner.

Runs the sentence-transformers cross-encoder in isolated child processes so
OpenMP or native crashes do not affect the main app process.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass


DEFAULT_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
DEFAULT_QUERY = "how much are functional fees at MUST"
DEFAULT_DOCS = [
    "Functional fees are part of the approved university fees schedule and are paid alongside tuition.",
    "The university annual report summarizes governance, finance, and outreach activities.",
]


@dataclass(frozen=True)
class ProbeConfig:
    name: str
    env: dict[str, str]


PROBE_CONFIGS = [
    ProbeConfig("baseline", {}),
    ProbeConfig("tokenizers_off", {"TOKENIZERS_PARALLELISM": "false"}),
    ProbeConfig(
        "omp_single_thread",
        {"TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "1"},
    ),
    ProbeConfig(
        "kmp_fork_false",
        {"TOKENIZERS_PARALLELISM": "false", "KMP_INIT_AT_FORK": "FALSE"},
    ),
]


def _child_payload(model_name: str, query: str, docs: list[str]) -> str:
    return textwrap.dedent(
        f"""
        import json
        import time

        started = time.perf_counter()
        from sentence_transformers import CrossEncoder

        load_started = time.perf_counter()
        model = CrossEncoder({model_name!r})
        load_ms = (time.perf_counter() - load_started) * 1000

        predict_started = time.perf_counter()
        scores = model.predict({[(query, doc) for doc in docs]!r})
        predict_ms = (time.perf_counter() - predict_started) * 1000

        payload = {{
            "status": "ok",
            "load_ms": round(load_ms, 2),
            "predict_ms": round(predict_ms, 2),
            "total_ms": round((time.perf_counter() - started) * 1000, 2),
            "scores": [float(score) for score in scores],
        }}
        print(json.dumps(payload))
        """
    )


def _run_probe(config: ProbeConfig, model_name: str, query: str, docs: list[str], timeout_s: int) -> dict:
    env = os.environ.copy()
    env.update(config.env)

    started = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, "-c", _child_payload(model_name, query, docs)],
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout_s,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

    result = {
        "probe": config.name,
        "env": config.env,
        "returncode": proc.returncode,
        "elapsed_ms": elapsed_ms,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }

    if proc.returncode == 0:
        try:
            result["payload"] = json.loads(proc.stdout.strip())
        except json.JSONDecodeError:
            result["payload_parse_error"] = True
    return result


def _run_all_probes(model_name: str, query: str, docs: list[str], timeout_s: int) -> int:
    print(f"python={sys.executable}")
    print(f"model={model_name}")
    print(f"query={query}")
    print(f"docs={len(docs)}")

    try:
        print(
            "versions="
            f"sentence-transformers:{importlib.metadata.version('sentence-transformers')} "
            f"transformers:{importlib.metadata.version('transformers')} "
            f"torch:{importlib.metadata.version('torch')} "
            f"huggingface-hub:{importlib.metadata.version('huggingface-hub')}"
        )
    except Exception as exc:
        print(f"version_check_error={exc}")

    failures = 0
    for config in PROBE_CONFIGS:
        print(f"\n== probe:{config.name} ==")
        try:
            result = _run_probe(config, model_name, query, docs, timeout_s)
        except subprocess.TimeoutExpired:
            failures += 1
            print(json.dumps({
                "probe": config.name,
                "env": config.env,
                "status": "timeout",
                "timeout_s": timeout_s,
            }))
            continue

        print(json.dumps(result, indent=2))
        if result["returncode"] != 0:
            failures += 1

    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnose local cross-encoder loading/prediction.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--query", default=DEFAULT_QUERY)
    parser.add_argument("--doc", action="append", dest="docs")
    parser.add_argument("--timeout", type=int, default=90, help="Per-probe timeout in seconds.")
    args = parser.parse_args()

    docs = args.docs or DEFAULT_DOCS
    return _run_all_probes(args.model, args.query, docs, args.timeout)


if __name__ == "__main__":
    raise SystemExit(main())
