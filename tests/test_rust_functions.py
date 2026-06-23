"""
Unit tests for the seed custom functions.

Builds a minimal Rust crate from the ACTUAL rustCode in
scripts/seed_data/custom_functions.json (the code that gets injected into the
generated Lambda) and runs `cargo test` against the hand-verified assertions in
tests/rust_function_tests.rs. Because the function bodies come straight from the
seed file, these tests can never drift from the deployed implementations.

GET_FACTOR (needs the DynamoDB-backed cache) and DEBUG_LOG (needs tracing) are
excluded — GET_FACTOR's behavior is covered by the end-to-end calculation tests.

Skips automatically if cargo is not installed.
"""
import json
import os
import shutil
import subprocess
import tempfile

import pytest

THIS_DIR = os.path.dirname(__file__)
SEED = os.path.join(THIS_DIR, "..", "scripts", "seed_data", "custom_functions.json")
TESTS_RS = os.path.join(THIS_DIR, "rust_function_tests.rs")

# Pure functions safe to test standalone (no DynamoDB / no tracing).
PURE_FUNCTIONS = {
    "ROUND_CENTS", "MAX", "MIN", "GET_SEASON", "EXTRACT_MONTH",
    "CALCULATE_TIERED", "ABS", "ROUND", "ADD_YEARS", "ADD_MONTHS",
    "CALCULATE_TIERED_N", "GET_TOU_PERIOD", "CLAMP",
    "CALCULATE_RATCHET", "POWER_FACTOR_ADJ", "IS_EVENT_DAY", "GET_DAY_TYPE",
}

CARGO_TOML = """[package]
name = "rate_functions_test"
version = "0.1.0"
edition = "2021"

[dependencies]
serde_json = "1.0"
chrono = "0.4"
"""


def _cargo_available() -> bool:
    return shutil.which("cargo") is not None


def _load_pure_function_bodies():
    with open(SEED) as f:
        funcs = json.load(f)
    bodies = []
    found = set()
    for fn in funcs:
        if fn["name"] in PURE_FUNCTIONS:
            code = fn["rustCode"].lstrip()
            if code.startswith("fn "):
                code = "pub " + code  # callable from the tests module
            bodies.append(code)
            found.add(fn["name"])
    missing = PURE_FUNCTIONS - found
    assert not missing, f"Pure functions missing from seed data: {missing}"
    return bodies


def test_custom_functions_unit():
    """Compile the seed custom functions and run their unit tests."""
    if not _cargo_available():
        pytest.skip("cargo not available")

    bodies = _load_pure_function_bodies()
    with open(TESTS_RS) as f:
        tests_module = f.read()

    lib_rs = "#![allow(dead_code)]\n\n" + "\n\n".join(bodies) + "\n\n" + tests_module

    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "src"))
        with open(os.path.join(tmp, "Cargo.toml"), "w") as f:
            f.write(CARGO_TOML)
        with open(os.path.join(tmp, "src", "lib.rs"), "w") as f:
            f.write(lib_rs)

        result = subprocess.run(
            ["cargo", "test"],
            cwd=tmp,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            pytest.fail(
                "Rust custom-function tests failed:\n"
                f"STDOUT:\n{result.stdout[-3000:]}\n"
                f"STDERR:\n{result.stderr[-2000:]}"
            )
