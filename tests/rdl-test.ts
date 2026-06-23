/**
 * Rate Definition Language (RDL) Test Suite
 *
 * This file contains test cases for validating the RDL syntax and validation rules.
 * Each test case includes a description, the RDL code to test, and the expected validation result.
 *
 * Usage:
 * 1. Run these tests after any changes to the RDL validation logic
 * 2. Add new test cases when new syntax features are added
 * 3. Make sure all tests pass before deploying changes
 *
 * Run with: npm run test:rdl (from project root)
 */

// Import the validation function from the utility module (no CSS dependencies)
import { validateRDLCode } from '../frontend/src/utils/rdlValidator';

// Test case structure
interface RDLTestCase {
  description: string;
  code: string;
  expectedValid: boolean;
}

// Test cases grouped by category
const testCases: Record<string, RDLTestCase[]> = {
  // Basic syntax
  basic: [
    {
      description: "Empty line is valid",
      code: "",
      expectedValid: true
    },
    {
      description: "Comment only line is valid",
      code: "// This is a comment",
      expectedValid: true
    },
    {
      description: "Simple assignment",
      code: "x = 5",
      expectedValid: true
    },
  ],

  // Variable assignments
  assignments: [
    {
      description: "Valid variable name",
      code: "total_charge = 10.50",
      expectedValid: true
    },
    {
      description: "Invalid variable name with special characters",
      code: "total$charge = 10.50",
      expectedValid: false
    },
    {
      description: "LET statement is not allowed",
      code: "LET x = 5",
      expectedValid: false
    },
  ],

  // Conditionals
  conditionals: [
    {
      description: "IF statement",
      code: "IF x > 10",
      expectedValid: true
    },
    {
      description: "ELSEIF statement",
      code: "ELSEIF x < 5",
      expectedValid: true
    },
    {
      description: "ELSE statement",
      code: "ELSE",
      expectedValid: true
    },
    {
      description: "ENDIF statement",
      code: "ENDIF",
      expectedValid: true
    },
    {
      description: "Complex conditional expression",
      code: "IF (x > 10) && (y < 20)",
      expectedValid: true
    },
    {
      description: "IN operator with array literal",
      code: "IF month IN [6, 7, 8]",
      expectedValid: true
    },
  ],

  // Loops
  loops: [
    {
      description: "FOR loop",
      code: "FOR item IN collection",
      expectedValid: true
    },
    {
      description: "FOR loop missing IN keyword",
      code: "FOR item collection",
      expectedValid: false
    },
    {
      description: "ENDFOR statement",
      code: "ENDFOR",
      expectedValid: true
    },
  ],

  // INPUT object
  input: [
    {
      description: "INPUT.KWH usage",
      code: "usage = INPUT.KWH",
      expectedValid: true
    },
    {
      description: "INPUT.BILL_DATE usage",
      code: "date = INPUT.BILL_DATE",
      expectedValid: true
    },
    {
      description: "INPUT.RATE usage",
      code: "rate = INPUT.RATE",
      expectedValid: true
    },
    {
      description: "INPUT.RIDERS with IN operator",
      code: "IF \"TAX_EXEMPT\" IN INPUT.RIDERS",
      expectedValid: true
    },
  ],

  // Function calls
  functions: [
    {
      description: "GET_FACTOR with string literals",
      code: "customer_charge = GET_FACTOR(\"RESIDENTIAL\", \"CUSTOMER_CHARGE\", date)",
      expectedValid: true
    },
    {
      description: "GET_FACTOR with INPUT parameters",
      code: "customer_charge = GET_FACTOR(INPUT.RATE, \"CUSTOMER_CHARGE\", INPUT.BILL_DATE)",
      expectedValid: true
    },
    {
      description: "GET_GENERIC_FACTOR",
      code: "tax_rate = GET_GENERIC_FACTOR(\"STATE_TAX\", INPUT.BILL_DATE)",
      expectedValid: true
    },
    {
      description: "GET_LOCALITY_FACTOR",
      code: "fee = GET_LOCALITY_FACTOR(INPUT.LOCALITY_ID, \"FRANCHISE_FEE\", INPUT.BILL_DATE)",
      expectedValid: true
    },
  ],

  // Return statements
  returns: [
    {
      description: "RETURN statement",
      code: "RETURN total",
      expectedValid: true
    },
    {
      description: "RETURN statement with expression",
      code: "RETURN subtotal + tax",
      expectedValid: true
    },
  ],

  // Complex examples - testing individual lines as they appear in the editor
  complex: [
    {
      description: "IF with comparison operator",
      code: "IF INPUT.KWH > 1000",
      expectedValid: true
    },
    {
      description: "Tier assignment with multiplication",
      code: "tier1 = 1000 * tier1_rate",
      expectedValid: true
    },
    {
      description: "Tier assignment with parentheses",
      code: "tier2 = (INPUT.KWH - 1000) * tier2_rate",
      expectedValid: true
    },
    {
      description: "IF with equality operator",
      code: "IF INPUT.RATE == \"COMMERCIAL\"",
      expectedValid: true
    },
    {
      description: "Demand charge with comparison",
      code: "IF INPUT.KWD > 100",
      expectedValid: true
    },
    {
      description: "FOR loop over INPUT array",
      code: "FOR rider IN INPUT.RIDERS",
      expectedValid: true
    },
    {
      description: "IF with string comparison",
      code: "IF rider == \"FUEL\"",
      expectedValid: true
    },
    {
      description: "Complex expression with multiple operators",
      code: "rider_sum = rider_sum + INPUT.KWH * fuel_rate",
      expectedValid: true
    },
  ]
};

// Run all tests
function runTests(): boolean {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests: { category: string; test: RDLTestCase; result: any }[] = [];

  console.log("Running RDL syntax tests...\n");

  // Process each test category
  for (const [category, tests] of Object.entries(testCases)) {
    console.log(`=== ${category.toUpperCase()} ===`);

    // Run each test in the category
    for (const test of tests) {
      totalTests++;
      const result = validateRDLCode(test.code);
      const passed = result.valid === test.expectedValid;

      if (passed) {
        passedTests++;
        console.log(`  ✓ ${test.description}`);
      } else {
        failedTests.push({ category, test, result });
        console.log(`  ✗ ${test.description}`);
        console.log(`    Expected: ${test.expectedValid}, Actual: ${result.valid}`);
        if (result.message) {
          console.log(`    Error: ${result.message}`);
        }
      }
    }
    console.log("");
  }

  // Print summary
  console.log("=== TEST SUMMARY ===");
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests.length}`);

  // Print failed tests
  if (failedTests.length > 0) {
    console.log("\n=== FAILED TESTS ===");
    for (const { category, test, result } of failedTests) {
      console.log(`Category: ${category}`);
      console.log(`Description: ${test.description}`);
      console.log(`Code: ${test.code.trim()}`);
      console.log(`Expected: ${test.expectedValid}, Actual: ${result.valid}`);
      if (result.message) {
        console.log(`Error: ${result.message}`);
      }
      console.log("");
    }
    return false;
  }

  console.log("\n✅ All tests passed!");
  return true;
}

// Execute the tests and exit with appropriate code
const success = runTests();
process.exit(success ? 0 : 1);