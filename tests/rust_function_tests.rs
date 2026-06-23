// Unit tests for the seed custom functions (the actual rustCode shipped in
// scripts/seed_data/custom_functions.json). This file contains ONLY the test
// module; the function bodies are prepended at build time by
// tests/test_rust_functions.py so these tests always exercise the real,
// deployed implementations (no drift).
//
// Expected values are hand-computed. Monetary rounding cases use 1/8-based
// amounts (0.125, 0.375) so that `amount * 100` is exactly representable in
// f64 and the .5 rounding boundary is deterministic.

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    // --- CALCULATE_TIERED (two-tier) ---
    #[test]
    fn tiered_below_limit() {
        assert!(approx(calculate_tiered(800.0, 1000.0, 0.10, 0.12), 80.0));
    }
    #[test]
    fn tiered_at_limit_boundary() {
        // usage == limit takes the tier-1-only branch
        assert!(approx(calculate_tiered(1000.0, 1000.0, 0.10, 0.12), 100.0));
    }
    #[test]
    fn tiered_above_limit() {
        // 1000*0.10 + 500*0.12 = 100 + 60 = 160
        assert!(approx(calculate_tiered(1500.0, 1000.0, 0.10, 0.12), 160.0));
    }

    // --- CALCULATE_TIERED_N (N-tier from JSON) ---
    const TIERS: &str =
        r#"[{"limit":500,"rate":0.05},{"limit":1000,"rate":0.08},{"limit":0,"rate":0.12}]"#;
    #[test]
    fn tiered_n_spans_three_tiers() {
        // 500*0.05 + 500*0.08 + 200*0.12 = 25 + 40 + 24 = 89
        assert!(approx(calculate_tiered_n(1200.0, TIERS), 89.0));
    }
    #[test]
    fn tiered_n_first_tier_only() {
        assert!(approx(calculate_tiered_n(300.0, TIERS), 15.0));
    }
    #[test]
    fn tiered_n_two_tiers() {
        // 500*0.05 + 200*0.08 = 25 + 16 = 41
        assert!(approx(calculate_tiered_n(700.0, TIERS), 41.0));
    }
    #[test]
    fn tiered_n_invalid_json_is_zero() {
        assert!(approx(calculate_tiered_n(1000.0, "not-json"), 0.0));
    }

    // --- ROUND_CENTS (all rounding modes) ---
    #[test]
    fn round_cents_half_up() {
        assert!(approx(round_cents(0.125, "HALF_UP"), 0.13)); // 12.5 -> 13
    }
    #[test]
    fn round_cents_half_down() {
        assert!(approx(round_cents(0.125, "HALF_DOWN"), 0.12)); // exactly .5 -> trunc
        assert!(approx(round_cents(0.126, "HALF_DOWN"), 0.13)); // .6 -> round up
    }
    #[test]
    fn round_cents_up() {
        assert!(approx(round_cents(0.124, "UP"), 0.13)); // ceil(12.4) -> 13
    }
    #[test]
    fn round_cents_down() {
        assert!(approx(round_cents(0.126, "DOWN"), 0.12)); // floor(12.6) -> 12
    }
    #[test]
    fn round_cents_bankers_to_even() {
        assert!(approx(round_cents(0.125, "BANKERS"), 0.12)); // 12.5 -> 12 (even)
        assert!(approx(round_cents(0.375, "BANKERS"), 0.38)); // 37.5 -> 38 (even)
    }

    // --- ROUND (round_decimals) ---
    #[test]
    fn round_two_decimals() {
        assert!(approx(round_decimals(3.14159, 2.0), 3.14));
    }
    #[test]
    fn round_zero_decimals_half_away() {
        assert!(approx(round_decimals(2.5, 0.0), 3.0));
    }

    // --- GET_SEASON (data-driven summer boundaries) ---
    #[test]
    fn season_summer_bounds() {
        // Summer = months 6-9 (June-September)
        assert_eq!(get_season("2025-06-01", 6.0, 9.0), "SUMMER");
        assert_eq!(get_season("2025-09-30", 6.0, 9.0), "SUMMER");
        assert_eq!(get_season("2025-07-15", 6.0, 9.0), "SUMMER");
    }
    #[test]
    fn season_winter_bounds() {
        assert_eq!(get_season("2025-05-31", 6.0, 9.0), "WINTER");
        assert_eq!(get_season("2025-10-01", 6.0, 9.0), "WINTER");
        assert_eq!(get_season("2025-01-15", 6.0, 9.0), "WINTER");
        assert_eq!(get_season("2025-12-25", 6.0, 9.0), "WINTER");
    }
    #[test]
    fn season_winter_peaking_utility() {
        // A winter-peaking utility defines "summer" (peak) as Nov-Mar (wraparound)
        assert_eq!(get_season("2025-12-15", 11.0, 3.0), "SUMMER");
        assert_eq!(get_season("2025-02-10", 11.0, 3.0), "SUMMER");
        assert_eq!(get_season("2025-07-15", 11.0, 3.0), "WINTER");
    }

    // --- CALCULATE_RATCHET (billing demand from trailing peaks) ---
    #[test]
    fn ratchet_floor_applies() {
        // 80% of max(120,135,110)=135 -> 108; current 90 < 108 -> 108
        assert!(approx(
            calculate_ratchet(90.0, "[120.0,135.0,110.0]", 0.80),
            108.0
        ));
    }
    #[test]
    fn ratchet_current_exceeds_floor() {
        // current 150 > 80% of 135 (=108) -> 150
        assert!(approx(
            calculate_ratchet(150.0, "[120.0,135.0,110.0]", 0.80),
            150.0
        ));
    }
    #[test]
    fn ratchet_empty_history_is_current() {
        assert!(approx(calculate_ratchet(90.0, "[]", 0.80), 90.0));
        assert!(approx(calculate_ratchet(90.0, "not-json", 0.80), 90.0));
    }

    // --- POWER_FACTOR_ADJ ---
    #[test]
    fn pf_penalty_below_target() {
        // 100 * (0.95/0.85) = 111.7647...
        assert!(approx(power_factor_adj(100.0, 0.85, 0.95), 100.0 * 0.95 / 0.85));
    }
    #[test]
    fn pf_no_penalty_at_or_above_target() {
        assert!(approx(power_factor_adj(100.0, 0.95, 0.95), 100.0));
        assert!(approx(power_factor_adj(100.0, 0.99, 0.95), 100.0));
    }
    #[test]
    fn pf_no_penalty_when_unset() {
        assert!(approx(power_factor_adj(100.0, 0.0, 0.95), 100.0));
    }

    // --- IS_EVENT_DAY (CPP) ---
    #[test]
    fn event_day_match() {
        assert!(approx(
            is_event_day("2025-07-18", r#"["2025-07-18","2025-08-02"]"#),
            1.0
        ));
    }
    #[test]
    fn event_day_no_match() {
        assert!(approx(
            is_event_day("2025-07-19", r#"["2025-07-18"]"#),
            0.0
        ));
        assert!(approx(is_event_day("2025-07-18", "[]"), 0.0));
        assert!(approx(is_event_day("2025-07-18", "bad-json"), 0.0));
    }

    // --- GET_DAY_TYPE ---
    #[test]
    fn day_type_weekday_and_weekend() {
        assert_eq!(get_day_type("2025-07-18"), "WEEKDAY"); // Friday
        assert_eq!(get_day_type("2025-07-19"), "WEEKEND"); // Saturday
        assert_eq!(get_day_type("2025-07-20"), "WEEKEND"); // Sunday
        assert_eq!(get_day_type("2025-07-21"), "WEEKDAY"); // Monday
    }

    // --- EXTRACT_MONTH ---
    #[test]
    fn extract_month_basic() {
        assert!(approx(extract_month("2025-07-15"), 7.0));
        assert!(approx(extract_month("2025-12-01"), 12.0));
    }

    // --- CLAMP ---
    #[test]
    fn clamp_within_range() {
        assert!(approx(clamp_f64(5.0, 1.0, 10.0), 5.0));
    }
    #[test]
    fn clamp_below_floor() {
        assert!(approx(clamp_f64(0.0, 1.0, 10.0), 1.0));
    }
    #[test]
    fn clamp_above_cap() {
        assert!(approx(clamp_f64(15.0, 1.0, 10.0), 10.0));
    }

    // --- MAX / MIN / ABS ---
    #[test]
    fn max_min_abs() {
        assert!(approx(max_f64(3.0, 7.0), 7.0));
        assert!(approx(min_f64(3.0, 7.0), 3.0));
        assert!(approx(abs_f64(-4.5), 4.5));
    }

    // --- ADD_YEARS (incl. leap-day fallback) ---
    #[test]
    fn add_years_basic() {
        assert_eq!(add_years("2023-01-15", 3.0), "2026-01-15");
    }
    #[test]
    fn add_years_negative() {
        assert_eq!(add_years("2026-06-15", -3.0), "2023-06-15");
    }
    #[test]
    fn add_years_leap_day_fallback() {
        // 2025 is not a leap year -> Feb 29 falls back to Feb 28
        assert_eq!(add_years("2024-02-29", 1.0), "2025-02-28");
    }

    // --- ADD_MONTHS (rollover, negative, day fallback) ---
    #[test]
    fn add_months_basic() {
        assert_eq!(add_months("2025-01-15", 1.0), "2025-02-15");
    }
    #[test]
    fn add_months_year_rollover() {
        assert_eq!(add_months("2025-12-15", 1.0), "2026-01-15");
    }
    #[test]
    fn add_months_negative_crosses_year() {
        // Jan 2025 minus 7 months = Jun 2024
        assert_eq!(add_months("2025-01-15", -7.0), "2024-06-15");
    }
    #[test]
    fn add_months_day_fallback() {
        // Feb has no 31st -> falls back to day 28
        assert_eq!(add_months("2025-01-31", 1.0), "2025-02-28");
    }

    // --- GET_TOU_PERIOD (incl. overnight wraparound) ---
    const TOU: &str = r#"[{"period":"ON_PEAK","start":14,"end":19},{"period":"SHOULDER","start":10,"end":14},{"period":"OFF_PEAK","start":0,"end":10}]"#;
    #[test]
    fn tou_on_peak_from_datetime() {
        assert_eq!(get_tou_period("2025-07-15 15:30", TOU), "ON_PEAK");
    }
    #[test]
    fn tou_off_peak_hour_only() {
        assert_eq!(get_tou_period("08", TOU), "OFF_PEAK");
    }
    #[test]
    fn tou_shoulder_hhmm() {
        assert_eq!(get_tou_period("12:00", TOU), "SHOULDER");
    }
    #[test]
    fn tou_unmatched_defaults_off_peak() {
        // hour 22 is in no window -> default OFF_PEAK
        assert_eq!(get_tou_period("22:00", TOU), "OFF_PEAK");
    }
    #[test]
    fn tou_overnight_wraparound() {
        let sched = r#"[{"period":"NIGHT","start":22,"end":6}]"#;
        assert_eq!(get_tou_period("23:00", sched), "NIGHT"); // hour >= start
        assert_eq!(get_tou_period("03:00", sched), "NIGHT"); // hour < end
        assert_eq!(get_tou_period("12:00", sched), "OFF_PEAK"); // neither -> default
    }
}
