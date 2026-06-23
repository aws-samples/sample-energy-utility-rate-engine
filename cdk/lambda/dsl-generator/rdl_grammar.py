"""
RDL Grammar for Lark Parser

Defines the grammar for parsing Rate Definition Language (RDL) line-by-line.
Each line in the RDL grid is parsed independently as a single statement.
"""

# Line-by-line grammar - each RDL line is parsed as one statement
RDL_GRAMMAR = r"""
    ?start: statement

    // Statement types - one per line
    ?statement: comment
              | assignment
              | if_start
              | elseif_line
              | else_line
              | endif_line
              | for_start
              | endfor_line
              | output_stmt
              | error_stmt
              | debug_stmt
              | return_stmt

    // Comment line: // text
    comment: COMMENT

    // Variable assignment: var = expression
    assignment: IDENTIFIER "=" expression

    // Control flow - each on its own line
    if_start: "IF"i condition
    elseif_line: "ELSEIF"i condition
    else_line: "ELSE"i
    endif_line: "ENDIF"i

    // For loop start and end
    for_start: "FOR"i IDENTIFIER "IN"i expression
    endfor_line: "ENDFOR"i

    // Special statements - OUTPUT.INSERT(category, field, value)
    output_stmt: "OUTPUT"i "." output_method "(" expression "," expression "," expression ")"
    output_method: "INSERT"i | "ADD"i

    error_stmt: "ERROR"i "." "ADD"i "(" expression ")"

    debug_stmt: "DEBUG"i "." "INSERT"i "(" expression "," expression ")"

    return_stmt: "RETURN"i expression?

    // Conditions with proper precedence
    ?condition: or_expr

    ?or_expr: and_expr (or_op and_expr)*
    or_op: "OR"i | "||"

    ?and_expr: comparison (and_op comparison)*
    and_op: "AND"i | "&&"

    ?comparison: in_expr
               | cmp_expr

    in_expr: arith_expr "IN"i arith_expr

    cmp_expr: arith_expr (COMP_OP arith_expr)?

    // Arithmetic expressions with proper precedence
    ?arith_expr: term ((ADD_OP) term)*
    ADD_OP: "+" | "-"

    ?term: factor ((MUL_OP) factor)*
    MUL_OP: "*" | "/"

    ?factor: unary_expr

    ?unary_expr: "-" unary_expr -> neg
              | atom

    // Atoms - basic building blocks
    ?atom: NUMBER -> number
         | STRING -> string
         | array_literal
         | function_call
         | input_access
         | override_access
         | IDENTIFIER -> identifier
         | paren_expr

    // Parenthesized expression - preserves grouping
    paren_expr: "(" expression ")"

    // Array literal: [elem1, elem2, ...]
    array_literal: "[" [expression ("," expression)*] "]"

    // Function call: FUNC_NAME(arg1, arg2, ...)
    function_call: IDENTIFIER "(" [expression ("," expression)*] ")"

    // Input access: INPUT.FIELD_NAME
    input_access: "INPUT"i "." IDENTIFIER

    // Override access: OVERRIDE.FIELD_NAME (batch-level overrides)
    override_access: "OVERRIDE"i "." IDENTIFIER

    // Expression alias for compatibility
    ?expression: or_expr

    // Terminals
    IDENTIFIER: /[a-zA-Z_][a-zA-Z0-9_]*/
    NUMBER: /-?\d+\.?\d*/
    STRING: /"[^"]*"/ | /'[^']*'/
    COMP_OP: "<=" | ">=" | "==" | "!=" | "<" | ">"
    COMMENT: /\/\/.*/

    // Whitespace handling
    %import common.WS
    %ignore WS
"""
