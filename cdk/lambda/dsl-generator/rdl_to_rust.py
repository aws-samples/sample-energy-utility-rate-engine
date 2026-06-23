#!/usr/bin/env python3
"""
RDL to Rust Generator for AWS Lambda Deployment
Converts Rate Definition Language (RDL) to compilable Rust Lambda code.

This module uses Lark parser for proper DSL parsing and Jinja2 templates
for Rust code generation. All code generation is driven by data from DynamoDB.
"""

import json
import sys
import os
import logging
from typing import List, Dict, Any, Optional

from lark import Lark
from lark.exceptions import LarkError

from rdl_grammar import RDL_GRAMMAR
from rdl_transformer import RDLTransformer, Statement
from rust_generator import RustGenerator

logger = logging.getLogger(__name__)

# Cargo.toml template for the generated Rust project
CARGO_TOML_TEMPLATE = '''[package]
name = "rate_calculator"
version = "0.1.0"
edition = "2021"

[dependencies]
aws-config = { version = "1.1", features = ["behavior-version-latest"] }
aws-sdk-dynamodb = "1.15"
aws-sdk-s3 = "1.15"
chrono = "0.4"
futures = "0.3"
lambda_runtime = "0.8"
once_cell = "1.19"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
tracing = { version = "0.1", features = ["log"] }
tracing-subscriber = { version = "0.3", default-features = false, features = ["fmt"] }
'''


def _normalize_input_validation(raw_input_validation: List[Dict]) -> List[Dict]:
    """
    Normalize input validation data structure from DynamoDB.

    DynamoDB may return input validation in different formats:
    - Nested: [{ "fields": [...] }]
    - Flat: [{ "name": "...", "dataType": "..." }, ...]

    Returns a flat list of field definitions.
    """
    if not raw_input_validation:
        return []

    if isinstance(raw_input_validation, list) and len(raw_input_validation) > 0:
        first_item = raw_input_validation[0]
        if 'fields' in first_item:
            # Nested structure from DynamoDB
            return first_item['fields']
        elif 'name' in first_item:
            # Already flat structure
            return raw_input_validation

    return []


def parse_rdl_line(parser: Lark, transformer: RDLTransformer, code: str) -> Optional[Statement]:
    """
    Parse a single RDL line into an AST node.

    Args:
        parser: Lark parser instance
        transformer: RDL transformer instance
        code: The RDL code line to parse

    Returns:
        Parsed AST node or None if line is empty/comment-only
    """
    code = code.strip()
    if not code:
        return None

    try:
        tree = parser.parse(code)
        return transformer.transform(tree)
    except LarkError as e:
        logger.warning(f"Failed to parse RDL line: {code[:50]}... Error: {e}")
        raise


def generate_full_rust_code(rdl_lines: List[Dict],
                            input_validation: List[Dict],
                            custom_functions: List[Dict]) -> str:
    """
    Generate complete Rust Lambda code from DynamoDB data.

    This is the main entry point called by handler.py. The function signature
    is maintained for backward compatibility.

    Args:
        rdl_lines: List of RDL line objects with 'code', 'active', 'order' fields
        input_validation: List of input validation rules from DynamoDB
        custom_functions: List of custom function definitions from DynamoDB

    Returns:
        Complete main.rs content ready for compilation
    """
    # Normalize input validation format
    input_fields = _normalize_input_validation(input_validation)

    # Sort lines by order and filter active only, excluding group headers (lines starting with ///)
    active_lines = [
        line for line in rdl_lines
        if line.get('active', True) and not line.get('code', '').strip().startswith('///')
    ]
    active_lines.sort(key=lambda x: x.get('order', 0))

    # Initialize parser and transformer
    parser = Lark(RDL_GRAMMAR, parser='lalr')
    transformer = RDLTransformer()

    # Parse each line into AST nodes
    statements: List[Statement] = []
    for line in active_lines:
        code = line.get('code', '').strip()
        if not code:
            continue

        try:
            ast_node = parse_rdl_line(parser, transformer, code)
            if ast_node is not None:
                statements.append(ast_node)
        except LarkError as e:
            logger.error(f"Parse error on line {line.get('order', '?')}: {e}")
            raise ValueError(f"RDL parse error on line {line.get('order', '?')}: {code[:50]}...")

    # Generate Rust code using Jinja2 templates
    generator = RustGenerator()
    return generator.generate(statements, input_fields, custom_functions)


def generate_project(rdl_input_path: str, output_dir: str) -> None:
    """
    Generate a complete Rust Lambda project from RDL input file.

    This is a CLI utility for generating projects from JSON input files.

    Args:
        rdl_input_path: Path to the RDL input JSON file
        output_dir: Directory to write the Rust project
    """
    # Load RDL input
    with open(rdl_input_path, 'r') as f:
        rdl_data = json.load(f)

    rdl_lines = rdl_data.get('rdlLines', [])
    raw_input_validation = rdl_data.get('inputValidation', [])
    custom_functions = rdl_data.get('customFunctions', [])
    scenario = rdl_data.get('scenario', 'DEFAULT')

    # Generate complete Rust code
    main_rs = generate_full_rust_code(rdl_lines, raw_input_validation, custom_functions)

    # Create output directory structure
    src_dir = os.path.join(output_dir, 'src')
    os.makedirs(src_dir, exist_ok=True)

    # Write main.rs
    with open(os.path.join(src_dir, 'main.rs'), 'w') as f:
        f.write(main_rs)

    # Write Cargo.toml
    with open(os.path.join(output_dir, 'Cargo.toml'), 'w') as f:
        f.write(CARGO_TOML_TEMPLATE)

    print(f"Generated Rust project for scenario: {scenario}")
    print(f"Output directory: {output_dir}")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python rdl_to_rust.py <rdl_input.json> <output_dir>")
        sys.exit(1)

    rdl_input_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(rdl_input_path):
        print(f"Error: Input file not found: {rdl_input_path}")
        sys.exit(1)

    generate_project(rdl_input_path, output_dir)
