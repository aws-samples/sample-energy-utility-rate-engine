"""
RDL Transformer - Converts Lark parse tree to typed AST nodes.

This module defines dataclasses for each AST node type and a Lark Transformer
that converts the parse tree into these typed nodes.
"""

from dataclasses import dataclass
from typing import List, Optional, Union
from lark import Transformer, v_args, Token


# ============================================================================
# AST Node Definitions
# ============================================================================

# Expression nodes
@dataclass
class Number:
    """Numeric literal"""
    value: float


@dataclass
class String:
    """String literal"""
    value: str


@dataclass
class Identifier:
    """Variable or function name"""
    name: str


@dataclass
class InputAccess:
    """Access to INPUT.FIELD"""
    field: str


@dataclass
class OverrideAccess:
    """Access to OVERRIDE.FIELD"""
    field: str


@dataclass
class ArrayLiteral:
    """Array literal: [elem1, elem2, ...]"""
    elements: List['Expression']


@dataclass
class ParenExpr:
    """Parenthesized expression: (expr)"""
    expr: 'Expression'


@dataclass
class BinaryOp:
    """Binary operation: left op right"""
    op: str
    left: 'Expression'
    right: 'Expression'


@dataclass
class UnaryOp:
    """Unary operation: op operand"""
    op: str
    operand: 'Expression'


@dataclass
class InExpr:
    """IN expression: value IN array"""
    value: 'Expression'
    array: 'Expression'


@dataclass
class AndExpr:
    """Logical AND: left && right"""
    left: 'Expression'
    right: 'Expression'


@dataclass
class OrExpr:
    """Logical OR: left || right"""
    left: 'Expression'
    right: 'Expression'


@dataclass
class FunctionCall:
    """Function call: name(args)"""
    name: str
    args: List['Expression']


# Statement nodes
@dataclass
class Comment:
    """Comment line: // text"""
    text: str


@dataclass
class Assignment:
    """Variable assignment: name = value"""
    name: str
    value: 'Expression'


@dataclass
class IfStart:
    """IF statement start: IF condition"""
    condition: 'Expression'


@dataclass
class ElseIfLine:
    """ELSEIF line: ELSEIF condition"""
    condition: 'Expression'


@dataclass
class ElseLine:
    """ELSE line"""
    pass


@dataclass
class EndIfLine:
    """ENDIF line"""
    pass


@dataclass
class ForStart:
    """FOR loop start: FOR var IN collection"""
    var: str
    collection: 'Expression'


@dataclass
class EndForLine:
    """ENDFOR line"""
    pass


@dataclass
class OutputInsert:
    """OUTPUT.INSERT(category, field, value)"""
    category: 'Expression'
    field: 'Expression'
    value: 'Expression'


@dataclass
class ErrorAdd:
    """ERROR.ADD(message)"""
    message: 'Expression'


@dataclass
class DebugInsert:
    """DEBUG.INSERT(key, value)"""
    key: 'Expression'
    value: 'Expression'


@dataclass
class ReturnStmt:
    """RETURN statement"""
    value: Optional['Expression']


# Type aliases for documentation
Expression = Union[
    Number, String, Identifier, InputAccess, ArrayLiteral, ParenExpr,
    BinaryOp, UnaryOp, InExpr, AndExpr, OrExpr, FunctionCall
]

Statement = Union[
    Comment, Assignment, IfStart, ElseIfLine, ElseLine, EndIfLine,
    ForStart, EndForLine, OutputInsert, ErrorAdd, DebugInsert, ReturnStmt
]


# ============================================================================
# Lark Transformer
# ============================================================================

class RDLTransformer(Transformer):
    """Transform Lark parse tree into typed AST nodes."""

    # --- Literals ---

    @v_args(inline=True)
    def number(self, token):
        """Parse number literal"""
        value = float(token)
        return Number(value)

    @v_args(inline=True)
    def string(self, token):
        """Parse string literal - remove quotes"""
        value = str(token)[1:-1]  # Strip quotes
        return String(value)

    @v_args(inline=True)
    def identifier(self, token):
        """Parse identifier"""
        return Identifier(str(token))

    # --- Expressions ---

    @v_args(inline=True)
    def input_access(self, field_token):
        """Parse INPUT.FIELD access"""
        return InputAccess(str(field_token))

    @v_args(inline=True)
    def override_access(self, field_token):
        """Parse OVERRIDE.FIELD access"""
        return OverrideAccess(str(field_token))

    def array_literal(self, items):
        """Parse array literal: [elem1, elem2, ...]"""
        # Filter out None values from optional empty element list
        return ArrayLiteral([item for item in items if item is not None])

    @v_args(inline=True)
    def paren_expr(self, expr):
        """Parse parenthesized expression: (expr)"""
        return ParenExpr(expr)

    def function_call(self, items):
        """Parse function call: name(args)"""
        name = str(items[0]) if isinstance(items[0], Token) else items[0].name
        # Filter out None values from optional empty argument list
        args = [arg for arg in items[1:] if arg is not None]
        return FunctionCall(name, args)

    @v_args(inline=True)
    def neg(self, operand):
        """Parse unary negation"""
        return UnaryOp('-', operand)

    def arith_expr(self, items):
        """Parse arithmetic expression with + and -"""
        if len(items) == 1:
            return items[0]

        # Process left to right
        result = items[0]
        i = 1
        while i < len(items):
            op = str(items[i])
            right = items[i + 1]
            result = BinaryOp(op, result, right)
            i += 2
        return result

    def term(self, items):
        """Parse term with * and /"""
        if len(items) == 1:
            return items[0]

        # Process left to right
        result = items[0]
        i = 1
        while i < len(items):
            op = str(items[i])
            right = items[i + 1]
            result = BinaryOp(op, result, right)
            i += 2
        return result

    @v_args(inline=True)
    def cmp_expr(self, left, op=None, right=None):
        """Parse comparison expression"""
        if op is None:
            return left
        return BinaryOp(str(op), left, right)

    @v_args(inline=True)
    def in_expr(self, value, array):
        """Parse IN expression: value IN array"""
        return InExpr(value, array)

    def and_expr(self, items):
        """Parse AND expression"""
        if len(items) == 1:
            return items[0]

        # Filter out 'and_op' tokens, keep expressions
        exprs = [item for item in items if not isinstance(item, Token)]
        if len(exprs) == 1:
            return exprs[0]

        result = exprs[0]
        for expr in exprs[1:]:
            result = AndExpr(result, expr)
        return result

    def or_expr(self, items):
        """Parse OR expression"""
        if len(items) == 1:
            return items[0]

        # Filter out 'or_op' tokens, keep expressions
        exprs = [item for item in items if not isinstance(item, Token)]
        if len(exprs) == 1:
            return exprs[0]

        result = exprs[0]
        for expr in exprs[1:]:
            result = OrExpr(result, expr)
        return result

    def or_op(self, items):
        """Discard OR operator token"""
        return Token('OR_OP', 'or')

    def and_op(self, items):
        """Discard AND operator token"""
        return Token('AND_OP', 'and')

    # --- Statements ---

    @v_args(inline=True)
    def comment(self, token):
        """Parse comment line"""
        text = str(token)
        # Remove the // prefix
        if text.startswith('//'):
            text = text[2:]
        return Comment(text.strip())

    @v_args(inline=True)
    def assignment(self, name_token, value):
        """Parse assignment: name = value"""
        name = str(name_token) if isinstance(name_token, Token) else name_token.name
        return Assignment(name, value)

    @v_args(inline=True)
    def if_start(self, condition):
        """Parse IF start"""
        return IfStart(condition)

    @v_args(inline=True)
    def elseif_line(self, condition):
        """Parse ELSEIF line"""
        return ElseIfLine(condition)

    def else_line(self, items):
        """Parse ELSE line"""
        return ElseLine()

    def endif_line(self, items):
        """Parse ENDIF line"""
        return EndIfLine()

    @v_args(inline=True)
    def for_start(self, var_token, collection):
        """Parse FOR start: FOR var IN collection"""
        var = str(var_token) if isinstance(var_token, Token) else var_token.name
        return ForStart(var, collection)

    def endfor_line(self, items):
        """Parse ENDFOR line"""
        return EndForLine()

    def output_stmt(self, items):
        """Parse OUTPUT.INSERT(category, field, value)"""
        # items may include: [method_result, category_expr, field_expr, value_expr]
        # Filter out None values from output_method
        exprs = [item for item in items if item is not None and not isinstance(item, Token)]
        if len(exprs) >= 3:
            category = exprs[0]
            field = exprs[1]
            value = exprs[2]
        else:
            # Fallback - shouldn't happen
            category = String("Other")
            field = items[-2] if len(items) >= 2 else String("")
            value = items[-1] if len(items) >= 1 else Number(0)
        return OutputInsert(category, field, value)

    def output_method(self, items):
        """Discard output method token"""
        return items[0] if items else None

    def error_stmt(self, items):
        """Parse ERROR.ADD(message)"""
        message = items[0]
        return ErrorAdd(message)

    def debug_stmt(self, items):
        """Parse DEBUG.INSERT(key, value)"""
        key = items[0]
        value = items[1]
        return DebugInsert(key, value)

    def return_stmt(self, items):
        """Parse RETURN statement"""
        value = items[0] if items else None
        return ReturnStmt(value)

    # --- Pass-through rules ---

    def condition(self, items):
        """Pass through condition"""
        return items[0]

    def comparison(self, items):
        """Pass through comparison"""
        return items[0]

    def factor(self, items):
        """Pass through factor"""
        return items[0]

    def unary_expr(self, items):
        """Pass through unary expression"""
        return items[0]

    def atom(self, items):
        """Pass through atom"""
        return items[0]

    def expression(self, items):
        """Pass through expression"""
        return items[0]

    def statement(self, items):
        """Pass through statement"""
        return items[0]

    def start(self, items):
        """Return the parsed statement"""
        return items[0] if items else None
