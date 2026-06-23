"""
RDL (Rate Definition Language) Generator Test Suite

Comprehensive tests for RDL parsing, Rust code generation, and compilation.
Covers all utility billing scenarios including:
- Tiered energy rates
- Demand charges
- Net metering / solar credits
- Time-of-use rates
- Taxes and fees
- Proration
- Minimum bills

Run: python3 -m pytest tests/test_dsl_generator.py -v
"""

import sys
import os
import subprocess
import tempfile
import shutil
import json
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'cdk', 'lambda', 'dsl-generator'))

from lark import Lark
from lark.exceptions import LarkError
from rdl_grammar import RDL_GRAMMAR
from rdl_transformer import (
    RDLTransformer, Comment, Assignment, IfStart, ElseIfLine, ElseLine,
    EndIfLine, ForStart, EndForLine, OutputInsert, ErrorAdd, DebugInsert,
    FunctionCall, InputAccess, OverrideAccess, Number, String, Identifier, ArrayLiteral
)
from rust_generator import RustGenerator
from rdl_to_rust import generate_full_rust_code, CARGO_TOML_TEMPLATE


# =============================================================================
# TEST INFRASTRUCTURE
# =============================================================================

parser = Lark(RDL_GRAMMAR, start='start', parser='lalr')
transformer = RDLTransformer()


def parse(rdl_code: str):
    """Parse RDL code and return AST."""
    tree = parser.parse(rdl_code)
    return transformer.transform(tree)


def to_rust(rdl_code: str) -> str:
    """Convert single RDL line to Rust code."""
    generator = RustGenerator()
    generator._reset_state()
    generator.function_metadata = {}
    stmt = parse(rdl_code)
    return generator._generate_statement(stmt).strip()


def generate_with_context(rdl_lines: list, input_validation: list = None, custom_functions: list = None) -> str:
    """Generate full Rust code with context."""
    lines = [{'code': code, 'active': True, 'order': i} for i, code in enumerate(rdl_lines)]
    return generate_full_rust_code(lines, input_validation or [], custom_functions or [])


# =============================================================================
# UNIT TESTS: ASSIGNMENTS
# =============================================================================

ASSIGNMENT_TESTS = [
    # Numbers
    ("value1 = 2", "let value1 = 2.0;", "Integer"),
    ("rate = 0.05", "let rate = 0.05;", "Decimal"),
    ("flag = -1", "let flag = -1.0;", "Negative"),
    ("x = 0", "let x = 0.0;", "Zero"),
    ("big = 999999999", "let big = 999999999.0;", "Large number"),

    # Strings
    ("name = \"test\"", 'let name = "test";', "String"),
    ('code = "RATE-1"', 'let code = "RATE-1";', "String with dash"),
    ('empty = ""', 'let empty = "";', "Empty string"),

    # Variables and expressions
    ("y = x", "let y = x;", "Variable to variable"),
    ("sum = a + b", "let sum = a + b;", "Addition"),
    ("diff = a - b", "let diff = a - b;", "Subtraction"),
    ("product = a * b", "let product = a * b;", "Multiplication"),
    ("quotient = a / b", "let quotient = a / b;", "Division"),
    ("x = -y", "let x = -y;", "Unary negation"),

    # Operator precedence
    ("result = a + b * c", "let result = a + b * c;", "Mult before add"),
    ("result = a * b + c", "let result = a * b + c;", "Mult then add"),

    # Parentheses (CRITICAL for billing calculations)
    ("x = (a + b)", "let x = (a + b);", "Simple parens"),
    ("x = (a + b) * c", "let x = (a + b) * c;", "Parens change precedence"),
    ("x = a * (b + c)", "let x = a * (b + c);", "Parens on right"),
    ("energy = (tier1 * rate1) + (tier2 * rate2)",
     "let energy = (tier1 * rate1) + (tier2 * rate2);", "Multiple groups"),
    ("x = ((a + b))", "let x = ((a + b));", "Nested parens"),

    # INPUT access
    ("kwh = INPUT.KWH", "let kwh = kwh;", "INPUT field"),
    ("prorated = charge * (INPUT.BILLING_DAYS / 30)",
     "let prorated = charge * (billing_days / 30.0);", "INPUT in expression"),

    # OVERRIDE access
    ("date = OVERRIDE.BILL_DATE", "let date = override_bill_date;", "OVERRIDE field"),
    ("offset = OVERRIDE.BILL_DATE_OFFSET_YEARS", "let offset = override_bill_date_offset_years;", "OVERRIDE numeric"),
    ("effective = OVERRIDE.CUSTOM_VALUE", "let effective = override_custom_value;", "OVERRIDE custom field"),

    # Arrays
    ("months = [1, 2, 3]", 'let months = vec![1.0, 2.0, 3.0];', "Numeric array"),
    ('codes = ["A", "B"]', 'let codes = vec!["A".to_string(), "B".to_string()];', "String array"),
    ("empty = []", "let empty = vec![];", "Empty array"),
]


@pytest.mark.parametrize("rdl,expected,desc", ASSIGNMENT_TESTS)
def test_assignment(rdl, expected, desc):
    assert to_rust(rdl) == expected, desc


# =============================================================================
# UNIT TESTS: CONTROL FLOW
# =============================================================================

CONTROL_FLOW_TESTS = [
    # Comparisons
    ("IF x > 10", "if x > 10.0 {", "Greater than"),
    ("IF x < 5", "if x < 5.0 {", "Less than"),
    ("IF x >= 10", "if x >= 10.0 {", "Greater or equal"),
    ("IF x <= 5", "if x <= 5.0 {", "Less or equal"),
    ("IF x == 0", "if x == 0.0 {", "Equals"),
    ("IF x != 0", "if x != 0.0 {", "Not equals"),

    # INPUT in conditions
    ("IF INPUT.KWH > 1000", "if kwh > 1000.0 {", "INPUT numeric"),
    ('IF INPUT.RATE == "RATE-1"', 'if rate == "RATE-1" {', "INPUT string"),

    # OVERRIDE in conditions
    ('IF OVERRIDE.BILL_DATE != ""', 'if override_bill_date != "" {', "OVERRIDE string comparison"),
    ("IF OVERRIDE.BILL_DATE_OFFSET_YEARS != 0", "if override_bill_date_offset_years != 0.0 {", "OVERRIDE numeric comparison"),

    # Logical operators
    ("IF x > 0 AND y > 0", "if (x > 0.0 && y > 0.0) {", "AND"),
    ("IF x > 0 OR y > 0", "if (x > 0.0 || y > 0.0) {", "OR"),

    # IN operator (array membership)
    ("IF x IN [1, 2, 3]", "if vec![1.0, 2.0, 3.0].contains(&x) {", "IN array"),
    ("IF code IN valid_codes", "if valid_codes.contains(&code) {", "IN variable"),

    # Control flow keywords
    ("ELSEIF x < 5", "} else if x < 5.0 {", "ELSEIF"),
    ("ELSE", "} else {", "ELSE"),
    ("ENDIF", "}", "ENDIF"),
]


@pytest.mark.parametrize("rdl,expected,desc", CONTROL_FLOW_TESTS)
def test_control_flow(rdl, expected, desc):
    assert to_rust(rdl) == expected, desc


# =============================================================================
# UNIT TESTS: FOR LOOPS
# =============================================================================

FOR_LOOP_TESTS = [
    ("FOR item IN items", "for item in items.iter() {", "FOR over variable"),
    ("FOR rider IN INPUT.RIDERS", "for rider in riders.iter() {", "FOR over INPUT"),
    ("ENDFOR", "}", "ENDFOR"),
]


@pytest.mark.parametrize("rdl,expected,desc", FOR_LOOP_TESTS)
def test_for_loop(rdl, expected, desc):
    assert to_rust(rdl) == expected, desc


# =============================================================================
# UNIT TESTS: OUTPUT/ERROR/DEBUG
# =============================================================================

OUTPUT_TESTS = [
    ('OUTPUT.INSERT("Base", "charge", x)',
     'output.push(OutputItem { category: "Base".to_string(), field: "charge".to_string(), value: x });',
     "OUTPUT.INSERT"),
    ('OUTPUT.ADD("Tax", "amount", 10)',
     'output.push(OutputItem { category: "Tax".to_string(), field: "amount".to_string(), value: 10.0 });',
     "OUTPUT.ADD"),
    ('ERROR.ADD("Missing factor")',
     'errors.push("Missing factor".to_string());',
     "ERROR.ADD"),
]


@pytest.mark.parametrize("rdl,expected,desc", OUTPUT_TESTS)
def test_output_error(rdl, expected, desc):
    assert to_rust(rdl) == expected, desc


# =============================================================================
# UNIT TESTS: FUNCTIONS
# =============================================================================

class TestFunctions:
    def test_function_parsing(self):
        result = parse('x = GET_FACTOR("RATE", "CHARGE", date)')
        assert isinstance(result.value, FunctionCall)
        assert result.value.name == "GET_FACTOR"
        assert len(result.value.args) == 3

    def test_function_no_args(self):
        result = to_rust("x = GET_NOW()")
        assert "GET_NOW()" in result

    def test_function_nested(self):
        result = to_rust("x = ROUND(MAX(a, b), 2)")
        assert "ROUND(MAX(a, b), 2.0)" in result

    def test_function_with_metadata(self):
        generator = RustGenerator()
        generator._reset_state()
        generator.function_metadata = {
            'GET_FACTOR': {
                'rust_name': 'helpers::get_factor',
                'param_types': ['string', 'string', 'date'],
                'param_count': 3
            }
        }
        stmt = parse('x = GET_FACTOR("RATE", "CHARGE", date)')
        result = generator._generate_statement(stmt).strip()
        assert "helpers::get_factor" in result


# =============================================================================
# UNIT TESTS: OVERRIDE ACCESS
# =============================================================================

class TestOverrideAccess:
    """Test OVERRIDE.* access for batch-level parameters."""

    def test_override_parsing(self):
        """Test parsing OVERRIDE.FIELD access."""
        result = parse("x = OVERRIDE.BILL_DATE")
        assert isinstance(result.value, OverrideAccess)
        assert result.value.field == "BILL_DATE"

    def test_override_rust_generation(self):
        """Test Rust code generation for OVERRIDE."""
        result = to_rust("x = OVERRIDE.BILL_DATE")
        assert result == "let x = override_bill_date;"

    def test_override_in_expression(self):
        """Test OVERRIDE in arithmetic expression."""
        result = to_rust("x = INPUT.KWH + OVERRIDE.ADJUSTMENT")
        assert "override_adjustment" in result

    def test_override_in_function_call(self):
        """Test OVERRIDE as function argument."""
        generator = RustGenerator()
        generator._reset_state()
        generator.function_metadata = {
            'ADD_YEARS': {
                'rust_name': 'helpers::add_years',
                'param_types': ['string', 'f64'],
                'param_count': 2
            }
        }
        stmt = parse("x = ADD_YEARS(INPUT.BILL_DATE, OVERRIDE.OFFSET)")
        result = generator._generate_statement(stmt).strip()
        assert "override_offset" in result


# =============================================================================
# UNIT TESTS: DATE FUNCTIONS
# =============================================================================

class TestDateFunctions:
    """Test ADD_YEARS and ADD_MONTHS date manipulation functions."""

    def test_add_years_generation(self):
        """Test ADD_YEARS function call generation."""
        generator = RustGenerator()
        generator._reset_state()
        generator.function_metadata = {
            'ADD_YEARS': {
                'rust_name': 'helpers::add_years',
                'param_types': ['string', 'f64'],
                'param_count': 2
            }
        }
        stmt = parse("x = ADD_YEARS(date, 1)")
        result = generator._generate_statement(stmt).strip()
        assert "helpers::add_years(&date, 1.0)" in result

    def test_add_months_generation(self):
        """Test ADD_MONTHS function call generation."""
        generator = RustGenerator()
        generator._reset_state()
        generator.function_metadata = {
            'ADD_MONTHS': {
                'rust_name': 'helpers::add_months',
                'param_types': ['string', 'f64'],
                'param_count': 2
            }
        }
        stmt = parse("x = ADD_MONTHS(date, 3)")
        result = generator._generate_statement(stmt).strip()
        assert "helpers::add_months(&date, 3.0)" in result

    def test_add_years_with_override(self):
        """Test ADD_YEARS with OVERRIDE parameter."""
        generator = RustGenerator()
        generator._reset_state()
        generator.function_metadata = {
            'ADD_YEARS': {
                'rust_name': 'helpers::add_years',
                'param_types': ['string', 'f64'],
                'param_count': 2
            }
        }
        stmt = parse("x = ADD_YEARS(INPUT.BILL_DATE, OVERRIDE.OFFSET)")
        result = generator._generate_statement(stmt).strip()
        assert "helpers::add_years(&bill_date, override_offset)" in result


# =============================================================================
# UNIT TESTS: COMMENTS
# =============================================================================

def test_comment():
    result = parse("// This is a comment")
    assert isinstance(result, Comment)
    assert to_rust("// comment") == ""


# =============================================================================
# UNIT TESTS: INVALID SYNTAX
# =============================================================================

class TestInvalidSyntax:
    def test_missing_equals(self):
        with pytest.raises(LarkError):
            parse("x 5")

    def test_unclosed_paren(self):
        with pytest.raises(LarkError):
            parse("x = (a + b")

    def test_unclosed_string(self):
        with pytest.raises(LarkError):
            parse('x = "hello')

    def test_if_without_condition(self):
        with pytest.raises(LarkError):
            parse("IF")


# =============================================================================
# UNIT TESTS: VARIABLE SCOPING & MUTABILITY
# =============================================================================

class TestScoping:
    def test_single_assignment_immutable(self):
        stmts = [parse("x = 5"), parse("y = 10")]
        gen = RustGenerator()
        gen._reset_state()
        gen._analyze_scoping(stmts)
        r1 = gen._generate_statement(stmts[0]).strip()
        r2 = gen._generate_statement(stmts[1]).strip()
        assert r1 == "let x = 5.0;"
        assert r2 == "let y = 10.0;"

    def test_reassigned_mutable(self):
        stmts = [parse("counter = 0"), parse("counter = counter + 1")]
        gen = RustGenerator()
        gen._reset_state()
        gen._analyze_scoping(stmts)
        r1 = gen._generate_statement(stmts[0]).strip()
        r2 = gen._generate_statement(stmts[1]).strip()
        assert "let mut counter" in r1
        assert r2 == "counter = counter + 1.0;"

    def test_outer_scope_vars(self):
        stmts = [
            parse("IF x > 0"),
            parse("charge = 100"),
            parse("ENDIF"),
        ]
        gen = RustGenerator()
        gen._reset_state()
        gen._analyze_scoping(stmts)
        assert "charge" in gen.outer_scope_vars


# =============================================================================
# BILLING SCENARIO TESTS
# =============================================================================

class TestBillingScenarios:
    """Test realistic utility billing calculation patterns."""

    def test_tiered_rate_structure(self):
        """Two-tier energy rate calculation."""
        stmts = [
            parse("kwh = INPUT.KWH"),
            parse("IF kwh <= 1000"),
            parse("charge = kwh * 0.10"),
            parse("ELSE"),
            parse("charge = 1000 * 0.10 + (kwh - 1000) * 0.12"),
            parse("ENDIF"),
        ]
        gen = RustGenerator()
        gen._reset_state()
        gen._analyze_scoping(stmts)
        assert "charge" in gen.outer_scope_vars

    def test_demand_charge_with_cap(self):
        """Demand charge with maximum cap."""
        rdl = "capped = MIN(demand * rate, max_cap)"
        result = to_rust(rdl)
        assert "MIN(demand * rate, max_cap)" in result

    def test_net_metering_credit(self):
        """Solar export credit calculation."""
        stmts = [
            parse("credit = 0"),
            parse('IF net_metering == "NEM"'),
            parse("IF kwh_generated > 0"),
            parse("credit = kwh_generated * export_rate"),
            parse("ENDIF"),
            parse("ENDIF"),
        ]
        gen = RustGenerator()
        gen._reset_state()
        gen._analyze_scoping(stmts)
        # credit assigned at outer scope AND inner scope
        assert "credit" in gen.outer_scope_vars

    def test_tax_exemption(self):
        """Tax exemption based on customer class."""
        rdl = 'IF INPUT.TAX_CLASS IN ["GOVERNMENT", "NONPROFIT"]'
        result = to_rust(rdl)
        assert 'vec!["GOVERNMENT".to_string(), "NONPROFIT".to_string()].contains' in result

    def test_proration(self):
        """Prorated charges for partial billing periods."""
        rdl = "prorated = charge * (billing_days / 30)"
        result = to_rust(rdl)
        assert "(billing_days / 30.0)" in result

    def test_minimum_bill(self):
        """Minimum bill enforcement."""
        rdl = "final = MAX(calculated, minimum)"
        result = to_rust(rdl)
        assert "MAX(calculated, minimum)" in result

    def test_franchise_fee(self):
        """Franchise fee as percentage of subtotal."""
        rdl = "franchise = subtotal * franchise_rate"
        result = to_rust(rdl)
        assert "subtotal * franchise_rate" in result

    def test_rounding(self):
        """Utility-specific rounding rules."""
        rdl = 'total = ROUND_CENTS(total, "HALF_UP")'
        result = to_rust(rdl)
        assert 'ROUND_CENTS(total, "HALF_UP")' in result

    def test_season_determination(self):
        """Summer/winter rate determination."""
        rdl = "season = GET_SEASON(INPUT.BILL_DATE)"
        result = to_rust(rdl)
        assert "GET_SEASON(bill_date)" in result

    def test_rider_iteration(self):
        """Iterating over account riders."""
        stmts = [
            parse("FOR rider IN INPUT.RIDERS"),
            parse("rider_charge = GET_FACTOR(rider, \"CHARGE\", date)"),
            parse("total = total + rider_charge"),
            parse("ENDFOR"),
        ]
        gen = RustGenerator()
        gen._reset_state()
        gen._analyze_scoping(stmts)
        r = gen._generate_statement(stmts[0]).strip()
        assert "for rider in riders.iter()" in r


# =============================================================================
# FULL CODE GENERATION TESTS
# =============================================================================

class TestFullGeneration:
    def test_minimal_rdl(self):
        result = generate_with_context(['x = 5', 'OUTPUT.INSERT("Test", "x", x)'])
        assert 'fn calculate_rate' in result
        assert 'let x = 5.0;' in result

    def test_inactive_lines_skipped(self):
        lines = [
            {'code': 'x = 5', 'active': True, 'order': 1},
            {'code': 'y = 10', 'active': False, 'order': 2},
        ]
        result = generate_full_rust_code(lines, [], [])
        assert 'let x = 5.0;' in result
        assert 'let y = 10.0;' not in result

    def test_group_headers_skipped(self):
        lines = [
            {'code': '///Section Header', 'active': True, 'order': 1},
            {'code': 'x = 5', 'active': True, 'order': 2},
        ]
        result = generate_full_rust_code(lines, [], [])
        assert '///Section' not in result

    def test_input_struct_generation(self):
        input_val = [
            {'name': 'KWH', 'dataType': 'number'},
            {'name': 'RATE', 'dataType': 'string'},
        ]
        result = generate_with_context(['x = INPUT.KWH'], input_val)
        assert 'pub kwh: Option<f64>' in result
        assert 'pub rate: Option<String>' in result

    def test_custom_functions_included(self):
        funcs = [{'name': 'MY_FUNC', 'rustCode': 'fn my_func(x: f64) -> f64 { x }'}]
        result = generate_with_context(['x = 5'], [], funcs)
        assert 'pub fn my_func' in result


# =============================================================================
# RUST COMPILATION TESTS
# =============================================================================

@pytest.fixture(scope="module")
def rust_available():
    """Check if Rust toolchain is available."""
    try:
        result = subprocess.run(['cargo', '--version'], capture_output=True, timeout=5)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


class TestRustCompilation:
    """Full system tests - generate Rust and verify it compiles."""

    def test_minimal_compiles(self, rust_available):
        if not rust_available:
            pytest.skip("Rust not available")

        rdl_lines = [
            {'code': 'x = 5', 'active': True, 'order': 1},
            {'code': 'y = x * 2', 'active': True, 'order': 2},
            {'code': 'OUTPUT.INSERT("Test", "result", y)', 'active': True, 'order': 3},
        ]
        self._compile_and_verify(rdl_lines, [], [])

    def test_control_flow_compiles(self, rust_available):
        if not rust_available:
            pytest.skip("Rust not available")

        rdl_lines = [
            {'code': 'result = 0', 'active': True, 'order': 1},
            {'code': 'IF kwh > 1000', 'active': True, 'order': 2},
            {'code': 'result = 100', 'active': True, 'order': 3},
            {'code': 'ELSE', 'active': True, 'order': 4},
            {'code': 'result = 50', 'active': True, 'order': 5},
            {'code': 'ENDIF', 'active': True, 'order': 6},
            {'code': 'OUTPUT.INSERT("Test", "result", result)', 'active': True, 'order': 7},
        ]
        input_val = [{'name': 'KWH', 'dataType': 'number'}]
        self._compile_and_verify(rdl_lines, input_val, [])

    def test_local_billing_rdl_compiles(self, rust_available):
        """Test that the local test_billing.json compiles."""
        if not rust_available:
            pytest.skip("Rust not available")

        test_dir = os.path.dirname(__file__)
        with open(os.path.join(test_dir, 'test_billing.json')) as f:
            data = json.load(f)

        rdl_lines = [{'code': l['code'], 'active': True, 'order': l['order']}
                     for l in data['rdl_lines']]
        self._compile_and_verify(rdl_lines, data['input_validation'], data['custom_functions'])

    def test_override_with_date_functions_compiles(self, rust_available):
        """Test OVERRIDE access with date functions compiles correctly.

        This tests the specific scenario where effective_date is a string variable
        assigned from INPUT.BILL_DATE, OVERRIDE.BILL_DATE, or ADD_YEARS().
        """
        if not rust_available:
            pytest.skip("Rust not available")

        rdl_lines = [
            {'code': 'effective_date = INPUT.BILL_DATE', 'active': True, 'order': 1},
            {'code': 'IF OVERRIDE.BILL_DATE != ""', 'active': True, 'order': 2},
            {'code': 'effective_date = OVERRIDE.BILL_DATE', 'active': True, 'order': 3},
            {'code': 'ELSEIF OVERRIDE.BILL_DATE_OFFSET_YEARS != 0', 'active': True, 'order': 4},
            {'code': 'effective_date = ADD_YEARS(INPUT.BILL_DATE, OVERRIDE.BILL_DATE_OFFSET_YEARS)', 'active': True, 'order': 5},
            {'code': 'ENDIF', 'active': True, 'order': 6},
            {'code': 'factor = GET_FACTOR("RATE", "CHARGE", "", "", "", effective_date)', 'active': True, 'order': 7},
            {'code': 'OUTPUT.INSERT("Test", "factor", factor)', 'active': True, 'order': 8},
        ]
        input_val = [
            {'name': 'BILL_DATE', 'dataType': 'date'},
        ]
        custom_funcs = [
            {
                'name': 'GET_FACTOR',
                'rustCode': 'fn get_factor(k1: &str, k2: &str, k3: &str, k4: &str, k5: &str, date: &str) -> f64 { load_factor_cache_once(); 0.0 }',
                'parameters': [
                    {'name': 'k1', 'type': 'string'},
                    {'name': 'k2', 'type': 'string'},
                    {'name': 'k3', 'type': 'string'},
                    {'name': 'k4', 'type': 'string'},
                    {'name': 'k5', 'type': 'string'},
                    {'name': 'date', 'type': 'date'},
                ]
            },
            {
                'name': 'ADD_YEARS',
                'rustCode': 'fn add_years(date: &str, years: f64) -> String { date.to_string() }',
                'parameters': [
                    {'name': 'date', 'type': 'string'},
                    {'name': 'years', 'type': 'f64'},
                ]
            },
        ]
        self._compile_and_verify(rdl_lines, input_val, custom_funcs)

    def test_full_billing_compiles(self, rust_available):
        """Test that the full billing RDL from seed data compiles."""
        if not rust_available:
            pytest.skip("Rust not available")

        test_dir = os.path.dirname(__file__)
        seed_dir = os.path.join(test_dir, '..', 'scripts', 'seed_data')

        with open(os.path.join(seed_dir, 'rdl_lines.json')) as f:
            rdl_data = json.load(f)
        with open(os.path.join(seed_dir, 'input_validation.json')) as f:
            input_val = json.load(f)
        with open(os.path.join(seed_dir, 'custom_functions.json')) as f:
            custom_funcs = json.load(f)

        # rdl_lines.json is an array of scenario objects: [{scenario, lines: [...]}]
        # Get the first (DEFAULT) scenario's lines
        rdl_lines = rdl_data[0]['lines']
        self._compile_and_verify(rdl_lines, input_val, custom_funcs)

    def _compile_and_verify(self, rdl_lines, input_validation, custom_functions):
        """Generate Rust code and verify it compiles."""
        # Generate code
        main_rs = generate_full_rust_code(rdl_lines, input_validation, custom_functions)

        # Create temp project
        with tempfile.TemporaryDirectory() as tmpdir:
            src_dir = os.path.join(tmpdir, 'src')
            os.makedirs(src_dir)

            # Write files
            with open(os.path.join(src_dir, 'main.rs'), 'w') as f:
                f.write(main_rs)
            with open(os.path.join(tmpdir, 'Cargo.toml'), 'w') as f:
                f.write(CARGO_TOML_TEMPLATE)

            # Compile (check only, don't build full binary)
            result = subprocess.run(
                ['cargo', 'check'],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode != 0:
                # Save for debugging
                debug_dir = os.path.join(os.path.dirname(__file__), 'failed_rust_output')
                os.makedirs(debug_dir, exist_ok=True)
                with open(os.path.join(debug_dir, 'main.rs'), 'w') as f:
                    f.write(main_rs)
                with open(os.path.join(debug_dir, 'error.txt'), 'w') as f:
                    f.write(result.stderr)

                pytest.fail(f"Rust compilation failed:\n{result.stderr[:2000]}")


# =============================================================================
# EDGE CASE TESTS
# =============================================================================

class TestEdgeCases:
    def test_very_small_decimal(self):
        result = to_rust("x = 0.000001")
        assert "1e-06" not in result  # No scientific notation

    def test_deeply_nested_parens(self):
        result = to_rust("x = (((a + b)))")
        assert "(((a + b)))" in result

    def test_mixed_and_or(self):
        result = to_rust("IF a > 0 AND b > 0 OR c > 0")
        assert "&&" in result
        assert "||" in result

    def test_underscore_variable(self):
        result = to_rust("_temp = 5")
        assert "let _temp = 5.0;" == result

    def test_all_caps_variable(self):
        result = to_rust("TOTAL = 100")
        assert "let TOTAL = 100.0;" == result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
