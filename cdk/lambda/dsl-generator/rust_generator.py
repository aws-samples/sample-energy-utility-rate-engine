"""
Rust Code Generator - Converts RDL AST to Rust code using Jinja2 templates.

This module generates Rust Lambda code from the parsed AST nodes.
All function mappings are dynamically loaded from DynamoDB custom functions.
"""

import os
import re
from typing import List, Dict, Set, Optional
from jinja2 import Environment, FileSystemLoader, select_autoescape

from rdl_transformer import (
    Statement, Expression,
    Number, String, Identifier, InputAccess, OverrideAccess, ArrayLiteral, ParenExpr,
    BinaryOp, UnaryOp, InExpr, AndExpr, OrExpr, FunctionCall,
    Comment, Assignment, IfStart, ElseIfLine, ElseLine, EndIfLine,
    ForStart, EndForLine, OutputInsert, ErrorAdd, DebugInsert, ReturnStmt
)


class RustGenerator:
    """Generate Rust code from RDL AST nodes."""

    def __init__(self, template_dir: Optional[str] = None):
        """Initialize generator with template directory."""
        if template_dir is None:
            template_dir = os.path.join(os.path.dirname(__file__), 'templates')
        self.template_dir = template_dir
        self.env = Environment(
            loader=FileSystemLoader(template_dir),
            autoescape=select_autoescape(
                enabled_extensions=("html", "htm", "xml"),
                default=False,
            ),
            trim_blocks=True,
            lstrip_blocks=True
        )

        # State for code generation
        self.indent_level = 1
        self.declared_vars: Set[str] = set()
        self.outer_scope_vars: Set[str] = set()
        self.mutable_vars: Set[str] = set()  # Variables that are reassigned
        self.array_vars: Set[str] = set()
        self.string_vars: Set[str] = set()  # Variables that hold strings (from INPUT/OVERRIDE/functions)
        self.input_fields: Set[str] = set()
        self.input_field_types: Dict[str, str] = {}  # Field name -> dataType mapping
        # Dynamic function metadata from DynamoDB
        self.function_metadata: Dict[str, Dict] = {}

    def generate(self, statements: List[Statement],
                 input_validation: List[Dict],
                 custom_functions: List[Dict]) -> str:
        """Generate complete Rust Lambda code."""
        # Reset state
        self._reset_state()

        # Process input validation to get field names
        self._process_input_validation(input_validation)

        # Build function metadata from DynamoDB custom functions
        self._build_function_metadata(custom_functions)

        # Analyze variable scoping
        self._analyze_scoping(statements)

        # Generate code sections
        input_struct = self._generate_input_struct(input_validation)
        input_extractions = self._generate_input_extractions(input_validation)
        custom_funcs_rust = self._generate_custom_functions(custom_functions)
        outer_var_decls = self._generate_outer_var_declarations()
        rust_statements = self._generate_statements(statements)

        # Load and render main template
        template = self.env.get_template('main.rs.j2')
        return template.render(
            input_struct=input_struct,
            input_extractions=input_extractions,
            custom_functions=custom_funcs_rust,
            outer_var_declarations=outer_var_decls,
            statements=rust_statements
        )

    def _reset_state(self):
        """Reset generator state for new generation."""
        self.indent_level = 1
        self.declared_vars = {'output', 'errors', 'debug'}  # Template pre-declares these
        self.outer_scope_vars = set()
        self.mutable_vars = set()
        self.array_vars = set()
        self.string_vars = set()
        self.input_fields = set()
        self.input_field_types = {}
        self.function_metadata = {}

    def _build_function_metadata(self, custom_functions: List[Dict]):
        """Build function metadata from DynamoDB custom functions.

        Extracts the Rust function name from rustCode and maps parameter types
        for proper argument conversion during code generation.
        """
        for func in custom_functions:
            name = func.get('name', '').upper()
            if not name:
                continue

            # Extract Rust function name from rustCode
            rust_code = func.get('rustCode', '')
            rust_func_name = self._extract_rust_func_name(rust_code, func.get('name', ''))

            # Get parameter types for argument conversion
            parameters = func.get('parameters', [])
            param_types = [p.get('type', 'string') for p in parameters]

            self.function_metadata[name] = {
                'rust_name': f'helpers::{rust_func_name}',
                'param_types': param_types,
                'param_count': len(parameters)
            }

    def _extract_rust_func_name(self, rust_code: str, default_name: str) -> str:
        """Extract the Rust function name from rustCode."""
        # Match 'fn function_name(' pattern
        match = re.search(r'fn\s+(\w+)\s*\(', rust_code)
        if match:
            return match.group(1)
        # Fallback to lowercase of RDL name
        return default_name.lower()

    def _process_input_validation(self, input_validation: List[Dict]):
        """Extract input field names and types from validation rules."""
        for field in input_validation:
            name = field.get('name', '').lower()
            data_type = field.get('dataType', 'string')
            if name:
                self.input_fields.add(name)
                self.declared_vars.add(name)
                self.input_field_types[name] = data_type

    def _analyze_scoping(self, statements: List[Statement]):
        """Analyze which variables need outer scope declaration and mutability."""
        # Track variables assigned at different scope levels
        var_scopes: Dict[str, Set[int]] = {}
        # Track how many times each variable is assigned
        var_assignment_count: Dict[str, int] = {}
        current_scope = 0
        scope_stack = [0]

        for stmt in statements:
            if isinstance(stmt, (IfStart, ForStart)):
                current_scope += 1
                scope_stack.append(current_scope)
            elif isinstance(stmt, (EndIfLine, EndForLine)):
                if len(scope_stack) > 1:
                    scope_stack.pop()
                current_scope = scope_stack[-1]
            elif isinstance(stmt, (ElseLine, ElseIfLine)):
                pass  # Same scope level as IF

            # Track assignments
            if isinstance(stmt, Assignment):
                var_name = stmt.name
                if var_name not in var_scopes:
                    var_scopes[var_name] = set()
                var_scopes[var_name].add(scope_stack[-1])

                # Count assignments
                var_assignment_count[var_name] = var_assignment_count.get(var_name, 0) + 1

                # Check if assigned to array literal
                if isinstance(stmt.value, ArrayLiteral):
                    self.array_vars.add(var_name)

                # Check if assigned from a string-typed source
                if self._is_string_expression(stmt.value):
                    self.string_vars.add(var_name)

        # Variables assigned in inner scope (>0) need outer declaration
        for var_name, scopes in var_scopes.items():
            if var_name in self.input_fields:
                continue
            if var_name in {'output', 'errors', 'debug'}:
                continue
            if min(scopes) > 0 or len(scopes) > 1:
                self.outer_scope_vars.add(var_name)

        # Variables assigned more than once need to be mutable
        for var_name, count in var_assignment_count.items():
            if var_name in self.input_fields:
                continue
            if var_name in {'output', 'errors', 'debug'}:
                continue
            if count > 1:
                self.mutable_vars.add(var_name)

    def _is_string_expression(self, expr: Expression) -> bool:
        """Determine if an expression results in a String type."""
        if isinstance(expr, String):
            return True
        if isinstance(expr, OverrideAccess):
            # All OVERRIDE fields are strings
            return True
        if isinstance(expr, InputAccess):
            # Check the input field's dataType
            field_name = expr.field.lower()
            data_type = self.input_field_types.get(field_name, 'string')
            return data_type in ('string', 'date')
        if isinstance(expr, FunctionCall):
            # Check if function returns string based on metadata
            name_upper = expr.name.upper()
            if name_upper in self.function_metadata:
                # Functions that return strings: ADD_YEARS, ADD_MONTHS, GET_SEASON
                # Infer from param_types - functions taking date param and not returning f64
                rust_code = self.function_metadata.get(name_upper, {})
                # These functions are known to return String
                if name_upper in ('ADD_YEARS', 'ADD_MONTHS', 'GET_SEASON'):
                    return True
            return False
        return False

    def _generate_input_struct(self, input_validation: List[Dict]) -> str:
        """Generate CalculationInput struct."""
        lines = []
        lines.append('#[derive(Debug, Deserialize)]')
        lines.append('pub struct CalculationInput {')

        for field in input_validation:
            name = field.get('name', '').lower()
            original_name = field.get('name', '')
            data_type = field.get('dataType', 'string')

            rust_type = {
                'number': 'Option<f64>',
                'string': 'Option<String>',
                'date': 'Option<String>',
                'array': 'Option<Vec<String>>',
                'boolean': 'Option<bool>',
            }.get(data_type, 'Option<String>')

            lines.append(f'    #[serde(alias = "{original_name}")]')
            lines.append(f'    pub {name}: {rust_type},')

        lines.append('}')
        return '\n'.join(lines)

    def _generate_input_extractions(self, input_validation: List[Dict]) -> str:
        """Generate input extraction code."""
        lines = []
        for field in input_validation:
            name = field.get('name', '').lower()
            data_type = field.get('dataType', 'string')

            if data_type == 'number':
                lines.append(f'    let {name} = input.{name}.unwrap_or(0.0);')
            elif data_type == 'array':
                lines.append(f'    let {name} = input.{name}.clone().unwrap_or_default();')
            elif data_type == 'boolean':
                lines.append(f'    let {name} = input.{name}.unwrap_or(false);')
            else:  # string, date
                lines.append(f'    let {name} = input.{name}.clone().unwrap_or_default();')

        return '\n'.join(lines)

    def _generate_custom_functions(self, custom_functions: List[Dict]) -> str:
        """Generate custom functions Rust code.

        SECURITY: ``rustCode`` is trusted developer-supplied content read from the
        CustomFunctions DynamoDB table. It is spliced verbatim into the generated
        Rust crate, compiled, and deployed as a Lambda. This is intentional — custom
        functions ARE arbitrary Rust by design — but it means write access to the
        CustomFunctions table is equivalent to code-execution in the deployment
        pipeline. Restrict that table to trusted administrators only.
        """
        if not custom_functions:
            return '// No custom functions defined'

        rust_functions = []
        for func in custom_functions:
            rust_code = func.get('rustCode', '')
            if rust_code:
                # Normalize function declarations to pub fn
                rust_code = re.sub(r'\bpub\s+fn\s+', 'fn ', rust_code)
                rust_code = re.sub(
                    r'fn\s+(\w+)\s*\(\s*&self\s*,\s*',
                    r'fn \1(',
                    rust_code
                )
                rust_code = re.sub(
                    r'fn\s+(\w+)\s*\(\s*&self\s*\)',
                    r'fn \1()',
                    rust_code
                )
                rust_code = re.sub(r'\bfn\s+', 'pub fn ', rust_code)
                rust_functions.append(rust_code)

        return '\n\n    '.join(rust_functions)

    def _generate_outer_var_declarations(self) -> str:
        """Generate variable declarations for outer scope."""
        lines = []
        for var in sorted(self.outer_scope_vars):
            if var in self.array_vars:
                lines.append(f'    let mut {var}: Vec<String> = Vec::new();')
            elif var in self.string_vars:
                lines.append(f'    let mut {var}: String = String::new();')
            else:
                lines.append(f'    let mut {var}: f64 = 0.0;')
        return '\n'.join(lines)

    def _generate_statements(self, statements: List[Statement]) -> str:
        """Generate Rust code for all statements."""
        lines = []
        self.indent_level = 1

        for stmt in statements:
            if isinstance(stmt, Comment):
                continue  # Skip comments
            line = self._generate_statement(stmt)
            if line:
                lines.append(line)

        return '\n'.join(lines)

    def _generate_statement(self, stmt: Statement) -> str:
        """Generate Rust code for a single statement."""
        indent = '    ' * self.indent_level

        if isinstance(stmt, Assignment):
            return self._gen_assignment(stmt, indent)
        elif isinstance(stmt, IfStart):
            return self._gen_if_start(stmt, indent)
        elif isinstance(stmt, ElseIfLine):
            return self._gen_elseif(stmt, indent)
        elif isinstance(stmt, ElseLine):
            return self._gen_else(indent)
        elif isinstance(stmt, EndIfLine):
            return self._gen_endif(indent)
        elif isinstance(stmt, ForStart):
            return self._gen_for_start(stmt, indent)
        elif isinstance(stmt, EndForLine):
            return self._gen_endfor(indent)
        elif isinstance(stmt, OutputInsert):
            return self._gen_output_insert(stmt, indent)
        elif isinstance(stmt, ErrorAdd):
            return self._gen_error_add(stmt, indent)
        elif isinstance(stmt, DebugInsert):
            return self._gen_debug_insert(stmt, indent)
        elif isinstance(stmt, ReturnStmt):
            return ''  # Return handled at end of function

        return ''

    def _gen_assignment(self, stmt: Assignment, indent: str) -> str:
        """Generate assignment statement."""
        var_name = stmt.name
        value = self._gen_expression(stmt.value)

        # For string variables, we need to clone the value to avoid ownership issues
        # This applies when assigning from INPUT/OVERRIDE fields or string literals
        if var_name in self.string_vars:
            if isinstance(stmt.value, (InputAccess, OverrideAccess, Identifier)):
                # Clone the source string to avoid moving ownership
                value = f'{value}.clone()'

        if var_name in self.declared_vars or var_name in self.outer_scope_vars:
            # Already declared, just reassign
            return f'{indent}{var_name} = {value};'
        else:
            # First declaration - check if it needs to be mutable
            self.declared_vars.add(var_name)
            if var_name in self.mutable_vars:
                return f'{indent}let mut {var_name} = {value};'
            else:
                return f'{indent}let {var_name} = {value};'

    def _gen_if_start(self, stmt: IfStart, indent: str) -> str:
        """Generate IF start."""
        condition = self._gen_condition(stmt.condition)
        self.indent_level += 1
        return f'{indent}if {condition} {{'

    def _gen_elseif(self, stmt: ElseIfLine, indent: str) -> str:
        """Generate ELSEIF."""
        self.indent_level -= 1
        indent = '    ' * self.indent_level
        condition = self._gen_condition(stmt.condition)
        self.indent_level += 1
        return f'{indent}}} else if {condition} {{'

    def _gen_else(self, indent: str) -> str:
        """Generate ELSE."""
        self.indent_level -= 1
        indent = '    ' * self.indent_level
        self.indent_level += 1
        return f'{indent}}} else {{'

    def _gen_endif(self, indent: str) -> str:
        """Generate ENDIF."""
        self.indent_level -= 1
        indent = '    ' * self.indent_level
        return f'{indent}}}'

    def _gen_for_start(self, stmt: ForStart, indent: str) -> str:
        """Generate FOR start."""
        var = stmt.var
        collection = self._gen_expression(stmt.collection)
        self.indent_level += 1
        return f'{indent}for {var} in {collection}.iter() {{'

    def _gen_endfor(self, indent: str) -> str:
        """Generate ENDFOR."""
        self.indent_level -= 1
        indent = '    ' * self.indent_level
        return f'{indent}}}'

    def _gen_output_insert(self, stmt: OutputInsert, indent: str) -> str:
        """Generate OUTPUT.INSERT(category, field, value)."""
        category = self._gen_expression(stmt.category)
        field = self._gen_expression(stmt.field)
        value = self._gen_expression(stmt.value)
        return f'{indent}output.push(OutputItem {{ category: {category}.to_string(), field: {field}.to_string(), value: {value} }});'

    def _gen_error_add(self, stmt: ErrorAdd, indent: str) -> str:
        """Generate ERROR.ADD(message)."""
        message = self._gen_expression(stmt.message)
        return f'{indent}errors.push({message}.to_string());'

    def _gen_debug_insert(self, stmt: DebugInsert, indent: str) -> str:
        """Generate DEBUG.INSERT(key, value) - logs to stdout and debug map."""
        key = self._gen_expression(stmt.key)
        value = self._gen_expression(stmt.value)
        lines = [
            f'{indent}tracing::debug!("{{}}: {{}}", {key}, {value});',
            f'{indent}debug.insert({key}.to_string(), serde_json::json!({value}));'
        ]
        return '\n'.join(lines)

    def _gen_condition(self, expr: Expression) -> str:
        """Generate condition expression."""
        if isinstance(expr, InExpr):
            value = self._gen_expression(expr.value)
            array = self._gen_expression(expr.array)
            # For string contains, clone the value
            if '.as_str()' in value:
                value = value.replace('.as_str()', '.clone()')
            # For string literals in Vec<String>, convert to owned String
            elif value.startswith('"') and value.endswith('"'):
                value = f'{value}.to_string()'
            return f'{array}.contains(&{value})'

        return self._gen_expression(expr)

    def _gen_expression(self, expr: Expression) -> str:
        """Generate expression code."""
        if isinstance(expr, Number):
            value = expr.value
            # Format as Rust f64 literal - avoid scientific notation
            if isinstance(value, float):
                # Use fixed-point notation to avoid 1e-06 style output
                formatted = f'{value:.10f}'.rstrip('0').rstrip('.')
                if '.' not in formatted:
                    formatted += '.0'
                return formatted
            # Integer case
            return f'{value}.0'

        elif isinstance(expr, String):
            return f'"{expr.value}"'

        elif isinstance(expr, Identifier):
            return expr.name

        elif isinstance(expr, InputAccess):
            # INPUT.FIELD always maps to the extracted variable name (lowercase)
            # The variable is created by input extraction code from input_validation
            # If the field is missing from input_validation, Rust compile will catch it
            return expr.field.lower()

        elif isinstance(expr, OverrideAccess):
            # OVERRIDE.FIELD maps to override_field_name variable
            # These are extracted from the OverrideInput struct in the template
            return f"override_{expr.field.lower()}"

        elif isinstance(expr, ArrayLiteral):
            # Handle empty arrays
            if not expr.elements:
                return 'vec![]'
            elements = [self._gen_expression(e) for e in expr.elements]
            # Convert string literals to owned strings
            elements = [f'{e}.to_string()' if e.startswith('"') else e for e in elements]
            return f'vec![{", ".join(elements)}]'

        elif isinstance(expr, ParenExpr):
            # Preserve parentheses from source for correct operator precedence
            inner = self._gen_expression(expr.expr)
            return f'({inner})'

        elif isinstance(expr, BinaryOp):
            left = self._gen_expression(expr.left)
            right = self._gen_expression(expr.right)
            op = expr.op
            return f'{left} {op} {right}'

        elif isinstance(expr, UnaryOp):
            operand = self._gen_expression(expr.operand)
            return f'{expr.op}{operand}'

        elif isinstance(expr, AndExpr):
            left = self._gen_expression(expr.left)
            right = self._gen_expression(expr.right)
            return f'({left} && {right})'

        elif isinstance(expr, OrExpr):
            left = self._gen_expression(expr.left)
            right = self._gen_expression(expr.right)
            return f'({left} || {right})'

        elif isinstance(expr, InExpr):
            value = self._gen_expression(expr.value)
            array = self._gen_expression(expr.array)
            # For string literals in Vec<String>, convert to owned String
            if value.startswith('"') and value.endswith('"'):
                value = f'{value}.to_string()'
            return f'{array}.contains(&{value})'

        elif isinstance(expr, FunctionCall):
            return self._gen_function_call(expr)

        return str(expr)

    def _gen_function_call(self, func: FunctionCall) -> str:
        """Generate function call using dynamic metadata from DynamoDB."""
        name_upper = func.name.upper()
        args = [self._gen_expression(arg) for arg in func.args]

        # Look up function in dynamic metadata from DynamoDB
        if name_upper in self.function_metadata:
            meta = self.function_metadata[name_upper]
            rust_func = meta['rust_name']
            param_types = meta['param_types']

            # Convert arguments based on parameter types
            converted_args = []
            for i, arg in enumerate(args):
                param_type = param_types[i] if i < len(param_types) else 'f64'

                # String/date types need &str reference if not already a literal
                if param_type in ('string', 'date'):
                    if arg.startswith('"'):
                        # Already a string literal - &str
                        converted_args.append(arg)
                    else:
                        # Variable - need to borrow
                        converted_args.append(f'&{arg}')
                else:
                    # Numeric types pass directly
                    converted_args.append(arg)

            return f'{rust_func}({", ".join(converted_args)})'

        # Unknown function - pass through as-is (will cause compile error if invalid)
        return f'{func.name}({", ".join(args)})'
