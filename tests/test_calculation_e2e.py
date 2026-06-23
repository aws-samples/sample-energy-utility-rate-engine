"""
End-to-end calculation-correctness tests.

Generates the REAL Rust Lambda from the seed RDL + input validation + custom
functions, then appends a Rust test module that:
  1. Injects a known factor table directly into the thread-local FACTOR_CACHE
     and sets CACHE_LOADED=true, so GET_FACTOR never touches DynamoDB.
  2. Runs the generated `calculate_rate` against known inputs.
  3. Asserts exact bill line items / totals.

This validates that the generator produces Rust that COMPUTES correctly
(not just compiles), covering tiered energy, fuel, net-metering credit,
demand-charge capping (MIN), tax exemption, franchise fee, and minimum-bill
enforcement (MAX).

Expected values are hand-computed with clean arithmetic (no .5 rounding
boundaries); assertions use a 1-cent tolerance to absorb f64 noise.

Slow (compiles the full Lambda crate). Skips automatically if cargo is absent.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

import pytest

THIS_DIR = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(THIS_DIR, "..", "cdk", "lambda", "dsl-generator"))

from rdl_to_rust import generate_full_rust_code, CARGO_TOML_TEMPLATE  # noqa: E402

SEED = os.path.join(THIS_DIR, "..", "scripts", "seed_data")

# Rust test module appended to the generated main.rs. Injects factors into the
# crate-private FACTOR_CACHE and exercises calculate_rate end to end.
CALC_TESTS_RS = r"""
#[cfg(test)]
mod calc_e2e_tests {
    use super::*;

    fn seed_factors() {
        let f = |v: f64| vec![FactorEntry {
            start_date: "2000-01-01".to_string(),
            end_date: "9999-12-31".to_string(),
            value: v,
        }];
        FACTOR_CACHE.with(|c| {
            let mut m = c.borrow_mut();
            m.clear();
            m.insert("RES#CUSTOMER_CHARGE".to_string(), f(10.00));
            m.insert("RES#ENERGY_CHARGE#0".to_string(), f(0.10));
            m.insert("RES#ENERGY_CHARGE#1000".to_string(), f(0.12));
            m.insert("RES#FUEL_CHARGE".to_string(), f(0.05));
            m.insert("RES#DEMAND_CHARGE".to_string(), f(8.00));
            m.insert("RES#DEMAND_CAP".to_string(), f(100.00));
            m.insert("RES#MINIMUM_BILL".to_string(), f(50.00));
            m.insert("RES#NEM_EXPORT_CREDIT".to_string(), f(0.08));
            m.insert("COM#CUSTOMER_CHARGE".to_string(), f(25.00));
            m.insert("COM#ENERGY_CHARGE#0".to_string(), f(0.09));
            m.insert("COM#ENERGY_CHARGE#1000".to_string(), f(0.07)); // declining block
            m.insert("COM#FUEL_CHARGE".to_string(), f(0.05));
            m.insert("COM#DEMAND_CHARGE".to_string(), f(8.00));
            m.insert("COM#DEMAND_CAP".to_string(), f(100.00));
            m.insert("COM#MINIMUM_BILL".to_string(), f(20.00));
            m.insert("FRANCHISE#METRO".to_string(), f(0.06));
            m.insert("STATE_SALES_TAX".to_string(), f(0.07));
            m.insert("GROSS_RECEIPTS_TAX".to_string(), f(0.02));
            m.insert("SEASON#SUMMER_START_MONTH".to_string(), f(6.0));
            m.insert("SEASON#SUMMER_END_MONTH".to_string(), f(9.0));
            m.insert("COM#RATCHET_PCT".to_string(), f(0.80));
            m.insert("COM#TARGET_POWER_FACTOR".to_string(), f(0.95));
            m.insert("COM#CPP_ADDER".to_string(), f(2.50));
            m.insert("RIDER#STORM_RECOVERY".to_string(), f(0.00125));
            m.insert("RIDER#ENERGY_EFFICIENCY".to_string(), f(0.00089));
        });
        CACHE_LOADED.with(|l| *l.borrow_mut() = true);
    }

    fn run(input_json: serde_json::Value) -> CalculationResult {
        let input: CalculationInput = serde_json::from_value(input_json).unwrap();
        calculate_rate(&input, &OverrideInput::default(), serde_json::Value::Null)
    }

    fn field(r: &CalculationResult, name: &str) -> f64 {
        r.output
            .iter()
            .find(|o| o.field == name)
            .unwrap_or_else(|| panic!("output field '{}' not found", name))
            .value
    }

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.01
    }

    #[test]
    fn end_to_end_billing_scenarios() {
        seed_factors();

        // A: residential, taxable, 1500 kWh, no demand, no NEM.
        // customer 10 + energy (1000*0.10 + 500*0.12 = 160) + fuel (1500*0.05 = 75)
        // subtotal 245; franchise 245*0.06 = 14.70 -> 259.70
        // sales_tax 18.18 + grt 5.19 -> total 283.07
        let a = run(serde_json::json!({
            "RATE": "RES", "KWH": 1500.0, "KWD": 0.0, "BILL_DATE": "2025-07-15",
            "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE", "NET_METERING": "", "KWH_GENERATED": 0.0
        }));
        assert!(approx(field(&a, "customer_charge"), 10.00), "A customer_charge={}", field(&a, "customer_charge"));
        assert!(approx(field(&a, "energy_charge"), 160.00), "A energy_charge={}", field(&a, "energy_charge"));
        assert!(approx(field(&a, "fuel_charge"), 75.00), "A fuel_charge={}", field(&a, "fuel_charge"));
        assert!(approx(field(&a, "demand_charge"), 0.00), "A demand_charge={}", field(&a, "demand_charge"));
        assert!(approx(field(&a, "total"), 283.07), "A total={}", field(&a, "total"));

        // B: tax-exempt GOVERNMENT -> taxes zero, total == subtotal (259.70).
        let b = run(serde_json::json!({
            "RATE": "RES", "KWH": 1500.0, "KWD": 0.0, "BILL_DATE": "2025-07-15",
            "LOCALITY": "METRO", "TAX_CLASS": "GOVERNMENT", "NET_METERING": "", "KWH_GENERATED": 0.0
        }));
        assert!(approx(field(&b, "sales_tax"), 0.00), "B sales_tax={}", field(&b, "sales_tax"));
        assert!(approx(field(&b, "gross_receipts_tax"), 0.00), "B grt={}", field(&b, "gross_receipts_tax"));
        assert!(approx(field(&b, "total"), 259.70), "B total={}", field(&b, "total"));

        // C: net metering. energy 1000*0.10=100; fuel 50; subtotal 160;
        // nem credit 500*0.08=40 -> subtotal 120; franchise 7.20 -> 127.20;
        // tax 8.90 + 2.54 -> total 138.64
        let c = run(serde_json::json!({
            "RATE": "RES", "KWH": 1000.0, "KWD": 0.0, "BILL_DATE": "2025-07-15",
            "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE", "NET_METERING": "NEM", "KWH_GENERATED": 500.0
        }));
        assert!(approx(field(&c, "energy_charge"), 100.00), "C energy_charge={}", field(&c, "energy_charge"));
        assert!(approx(field(&c, "nem_export_credit"), 40.00), "C nem={}", field(&c, "nem_export_credit"));
        assert!(approx(field(&c, "total"), 138.64), "C total={}", field(&c, "total"));

        // D: commercial demand cap + declining-block energy. raw demand 50*8=400 capped to 100.
        // customer 25 + energy (1000*0.09 + 1000*0.07 = 160) + fuel 100 + demand 100 = 385;
        // franchise 23.10 -> 408.10; tax 28.57 + 8.16 -> total 444.83
        let d = run(serde_json::json!({
            "RATE": "COM", "KWH": 2000.0, "KWD": 50.0, "BILL_DATE": "2025-07-15",
            "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE", "NET_METERING": "", "KWH_GENERATED": 0.0
        }));
        assert!(approx(field(&d, "demand_charge"), 100.00), "D demand_charge={}", field(&d, "demand_charge"));
        assert!(approx(field(&d, "energy_charge"), 160.00), "D energy_charge={}", field(&d, "energy_charge"));
        assert!(approx(field(&d, "total"), 444.83), "D total={}", field(&d, "total"));

        // J: large commercial bill exercises the declining-block tier 2 across 40,000 kWh:
        // 1000*0.09 + 39000*0.07 = 90 + 2730 = 2820 (regression guard for the COM tier-2 rate).
        let j = run(serde_json::json!({
            "RATE": "COM", "KWH": 40000.0, "KWD": 0.0, "BILL_DATE": "2025-07-15",
            "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE", "NET_METERING": "", "KWH_GENERATED": 0.0
        }));
        assert!(approx(field(&j, "energy_charge"), 2820.00), "J energy_charge={}", field(&j, "energy_charge"));

        // E: minimum bill. tiny usage total 13.28 raised to RES minimum 50.00 via MAX.
        let e = run(serde_json::json!({
            "RATE": "RES", "KWH": 10.0, "KWD": 0.0, "BILL_DATE": "2025-07-15",
            "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE", "NET_METERING": "", "KWH_GENERATED": 0.0
        }));
        assert!(approx(field(&e, "total"), 50.00), "E total={}", field(&e, "total"));

        // F: demand ratchet. current 40 kW, history [100,120,90], 80% ratchet ->
        // billing demand = max(40, 0.80*120) = 96.
        let f_case = run(serde_json::json!({
            "RATE": "COM", "KWH": 2000.0, "KWD": 40.0, "KWD_HISTORY": "[100.0,120.0,90.0]",
            "BILL_DATE": "2025-07-15", "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE"
        }));
        assert!(approx(field(&f_case, "billing_demand"), 96.00), "F billing_demand={}", field(&f_case, "billing_demand"));

        // G: power factor. raw demand 10*8=80, actual PF 0.85 < target 0.95 ->
        // 80 * (0.95/0.85) = 89.41 (under the 100 cap).
        let g = run(serde_json::json!({
            "RATE": "COM", "KWH": 2000.0, "KWD": 10.0, "POWER_FACTOR": 0.85,
            "BILL_DATE": "2025-07-15", "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE"
        }));
        assert!(approx(field(&g, "demand_charge"), 80.0 * 0.95 / 0.85), "G demand_charge={}", field(&g, "demand_charge"));

        // H: critical peak pricing. bill date is a declared event day ->
        // CPP adder 2.50 * billing demand 10 = 25.00.
        let h = run(serde_json::json!({
            "RATE": "COM", "KWH": 2000.0, "KWD": 10.0, "BILL_DATE": "2025-07-18",
            "EVENT_DATES": "[\"2025-07-18\"]", "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE"
        }));
        assert!(approx(field(&h, "cpp_charge"), 25.00), "H cpp_charge={}", field(&h, "cpp_charge"));

        // I: per-kWh riders. 1000 kWh * (0.00125 + 0.00089) = 2.14.
        let i = run(serde_json::json!({
            "RATE": "RES", "KWH": 1000.0, "KWD": 0.0, "BILL_DATE": "2025-07-15",
            "LOCALITY": "METRO", "TAX_CLASS": "TAXABLE",
            "RIDERS": ["STORM_RECOVERY", "ENERGY_EFFICIENCY"]
        }));
        assert!(approx(field(&i, "rider_total"), 2.14), "I rider_total={}", field(&i, "rider_total"));
    }
}
"""


def _cargo_available() -> bool:
    return shutil.which("cargo") is not None


def test_calculation_correctness_e2e():
    if not _cargo_available():
        pytest.skip("cargo not available")

    with open(os.path.join(SEED, "rdl_lines.json")) as f:
        rdl_lines = json.load(f)[0]["lines"]
    with open(os.path.join(SEED, "input_validation.json")) as f:
        input_validation = json.load(f)
    with open(os.path.join(SEED, "custom_functions.json")) as f:
        custom_functions = json.load(f)

    main_rs = generate_full_rust_code(rdl_lines, input_validation, custom_functions)
    main_rs += "\n" + CALC_TESTS_RS

    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "src"))
        with open(os.path.join(tmp, "Cargo.toml"), "w") as f:
            f.write(CARGO_TOML_TEMPLATE)
        with open(os.path.join(tmp, "src", "main.rs"), "w") as f:
            f.write(main_rs)

        result = subprocess.run(
            ["cargo", "test"],
            cwd=tmp,
            capture_output=True,
            text=True,
            timeout=1200,
        )
        if result.returncode != 0:
            pytest.fail(
                "End-to-end calculation tests failed:\n"
                f"STDOUT:\n{result.stdout[-3000:]}\n"
                f"STDERR:\n{result.stderr[-3000:]}"
            )
