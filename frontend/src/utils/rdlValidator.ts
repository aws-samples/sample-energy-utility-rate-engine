/**
 * RDL (Rate Definition Language) Validation Utilities
 *
 * This module contains validation functions for RDL syntax.
 * It is kept separate from UI components to allow for standalone testing.
 */

// RDL validation function
export const validateRDLCode = (code: string): { valid: boolean; message?: string } => {
  // Skip validation for group headers
  if (code.trim().startsWith('///')) {
    return { valid: true };
  }

  // Remove comments before validation
  const codeWithoutComments = code.replace(/\/\/.*$/gm, '').trim();

  if (codeWithoutComments.length === 0) {
    return { valid: true }; // Empty or comment-only lines are valid
  }

  // Check for LET statements (not allowed)
  if (codeWithoutComments.startsWith('LET ')) {
    return {
      valid: false,
      message: 'LET statements are not allowed. Just use direct assignment with "=" instead.'
    };
  }

  // Check for proper IF statement syntax
  if (codeWithoutComments.startsWith('IF ')) {
    // Make sure it has a condition after IF
    const conditionPattern = /^IF\s+(.+)$/;
    if (!conditionPattern.test(codeWithoutComments)) {
      return {
        valid: false,
        message: 'IF statements must have a condition: IF condition'
      };
    }
    return { valid: true };
  }

  // Check for ELSEIF syntax
  if (codeWithoutComments.startsWith('ELSEIF ')) {
    const conditionPattern = /^ELSEIF\s+(.+)$/;
    if (!conditionPattern.test(codeWithoutComments)) {
      return {
        valid: false,
        message: 'ELSEIF statements must have a condition: ELSEIF condition'
      };
    }
    return { valid: true };
  }

  // Check for ELSE syntax
  if (codeWithoutComments === 'ELSE') {
    return { valid: true };
  }

  // Check for ENDIF syntax
  if (codeWithoutComments === 'ENDIF') {
    return { valid: true };
  }

  // Check for proper FOR loop syntax
  if (codeWithoutComments.startsWith('FOR ')) {
    if (!codeWithoutComments.includes(' IN ')) {
      return {
        valid: false,
        message: 'FOR loops must use the format: FOR item IN collection'
      };
    }
    return { valid: true };
  }

  // Check for ENDFOR syntax
  if (codeWithoutComments === 'ENDFOR') {
    return { valid: true };
  }

  // Check for RETURN statement
  if (codeWithoutComments.startsWith('RETURN ')) {
    return { valid: true };
  }

  // Check for OUTPUT.INSERT() and OUTPUT.ADD() statements
  if (codeWithoutComments.startsWith('OUTPUT.INSERT(') || codeWithoutComments.startsWith('OUTPUT.ADD(')) {
    // Validate the format: OUTPUT.INSERT("category", "field", value) or OUTPUT.ADD("category", "field", value)
    const outputPattern = /^OUTPUT\.(INSERT|ADD)\s*\(\s*"[^"]+"\s*,\s*"[^"]+"\s*,\s*.+\s*\)$/;
    if (!outputPattern.test(codeWithoutComments)) {
      return {
        valid: false,
        message: 'OUTPUT statement must use format: OUTPUT.INSERT("category", "field", value)'
      };
    }
    return { valid: true };
  }

  // Check for ERROR.ADD() statements
  if (codeWithoutComments.startsWith('ERROR.ADD(')) {
    // Validate the format: ERROR.ADD(message)
    const errorPattern = /^ERROR\.ADD\s*\(\s*.+\s*\)$/;
    if (!errorPattern.test(codeWithoutComments)) {
      return {
        valid: false,
        message: 'ERROR statement must use format: ERROR.ADD("message") or ERROR.ADD(expression)'
      };
    }
    return { valid: true };
  }

  // Check for DEBUG.INSERT() statements
  if (codeWithoutComments.startsWith('DEBUG.INSERT(')) {
    // Validate the format: DEBUG.INSERT("key", value)
    const debugPattern = /^DEBUG\.INSERT\s*\(\s*"[^"]+"\s*,\s*.+\s*\)$/;
    if (!debugPattern.test(codeWithoutComments)) {
      return {
        valid: false,
        message: 'DEBUG statement must use format: DEBUG.INSERT("key", value)'
      };
    }
    return { valid: true };
  }

  // Validate assignment statements (variable = expression)
  // Must contain an assignment operator
  if (!codeWithoutComments.includes('=')) {
    return {
      valid: false,
      message: 'Invalid statement. Expected assignment (variable = expression) or control flow statement.'
    };
  }

  // Check for valid assignment syntax: identifier = expression
  const assignmentMatch = codeWithoutComments.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
  if (!assignmentMatch) {
    return {
      valid: false,
      message: 'Invalid assignment syntax. Use: variable_name = expression'
    };
  }

  const [, variableName, expression] = assignmentMatch;

  // Check variable name is valid identifier
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variableName)) {
    return {
      valid: false,
      message: 'Invalid variable name. Must start with letter or underscore.'
    };
  }

  // Check expression is not empty
  if (!expression || expression.trim().length === 0) {
    return {
      valid: false,
      message: 'Expression cannot be empty.'
    };
  }

  // Check for invalid expressions with multiple spaces between tokens (likely a typo)
  const multipleSpacesInExpression = /\w+\s{2,}\w+/.test(expression);
  if (multipleSpacesInExpression) {
    return {
      valid: false,
      message: 'Invalid expression format. Check for extra spaces between tokens.'
    };
  }

  // Check for basic syntax of expressions (approximate validation)
  const hasValidSyntax = /^[a-zA-Z0-9_\s+\-*/()[\]{}"',.><=>!&|]+$/.test(expression);
  if (!hasValidSyntax) {
    return {
      valid: false,
      message: 'Expression contains invalid syntax.'
    };
  }

  // Check for balanced parentheses
  let parenCount = 0;
  for (const char of expression) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) {
      return {
        valid: false,
        message: 'Unbalanced parentheses - extra closing parenthesis.'
      };
    }
  }
  if (parenCount !== 0) {
    return {
      valid: false,
      message: 'Unbalanced parentheses - missing closing parenthesis.'
    };
  }

  // Check for balanced quotes
  const doubleQuotes = (expression.match(/"/g) || []).length;
  if (doubleQuotes % 2 !== 0) {
    return {
      valid: false,
      message: 'Unbalanced double quotes.'
    };
  }

  // Check for invalid characters (basic check)
  if (/[#@$%^&\\|~`]/.test(expression)) {
    return {
      valid: false,
      message: 'Expression contains invalid characters.'
    };
  }

  return { valid: true };
};

// Calculate the indentation level for the code
export const getIndentationLevel = (codes: string[], index: number): number => {
  let level = 0;

  // Count block start/end keywords in previous lines
  for (let i = 0; i < index; i++) {
    const code = codes[i].trim();

    // Increase level for IF and FOR statements
    if (code.startsWith('IF ') || code.startsWith('FOR ')) {
      level++;
    }
    // Decrease level for ENDIF and ENDFOR
    else if (code === 'ENDIF' || code === 'ENDFOR') {
      level--;
    }
    // ELSE/ELSEIF don't change nesting depth
  }

  // Check if the CURRENT line is a block boundary (ELSE, ELSEIF, ENDIF, ENDFOR)
  // These should be displayed at one level less than the block body
  const currentCode = codes[index]?.trim() || '';
  if (currentCode === 'ELSE' ||
      currentCode.startsWith('ELSEIF ') ||
      currentCode === 'ENDIF' ||
      currentCode === 'ENDFOR') {
    level--;
  }

  return Math.max(0, level);
};