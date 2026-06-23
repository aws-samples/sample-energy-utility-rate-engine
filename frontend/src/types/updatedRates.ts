// Generic Rate Engine Types - Simplified for global utility support

// Basic Types
export type Scenario = string; // DEFAULT or custom scenario names

// Date Range Structure
export interface DateRange {
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD (9999-12-31 for current)
}

// Base Factor Structure
export interface BaseFactor {
  id: string;          // Unique identifier
  date_range: DateRange;
  value: number;       // The factor value (rate, price, etc.)
}

// Rate Factor - for utility rate components
export interface RateFactor extends BaseFactor {
  rate: string;        // Generic rate identifier (e.g., "RESIDENTIAL", "COMMERCIAL")
  charge_name: string; // Name of the charge (e.g., "CUSTOMER_CHARGE", "ENERGY_CHARGE")
  tier_threshold?: number; // Optional tier threshold for stepped rates
  scenario: Scenario;  // Which scenario this applies to
}

// Generic Factor - for general taxes and fees
export interface GenericFactor extends BaseFactor {
  name: string;        // Factor name (e.g., "GROSS_RECEIPTS_TAX", "STATE_SALES_TAX")
  scenario: Scenario;  // Which scenario this applies to
}

// Locality Factor - for location-based fees
export interface LocalityFactor extends BaseFactor {
  locality_id: string; // Location identifier
  factor_type: string; // Type of locality factor (e.g., "FRANCHISE_FEE")
  scenario: Scenario;  // Which scenario this applies to
}

// RDL Line for calculation editor
export interface RDLLine {
  id: string;           // Unique identifier
  code: string;         // Line of RDL code
  description: string;  // Human-readable description
  scenario: Scenario;   // Which scenario this applies to
  active: boolean;      // Whether this line is active
  order: number;        // Sort order
}

// Input Variable Type Definitions
export type InputDataType = 'string' | 'number' | 'date' | 'boolean' | 'array';

// Input Variable Validation Definition
export interface InputVariable {
  id: string;
  name: string;         // Input variable name (e.g., "KWH", "BILL_DATE")
  description: string;  // Human-readable description
  required: boolean;    // Whether this input is required
  dataType: InputDataType; // Data type for validation
  arrayType?: InputDataType; // For arrays, the type of array elements
  scenario: Scenario;   // Which scenario this applies to
}

// Factor Database
export interface FactorDatabase {
  rateFactors: RateFactor[];
  genericFactors: GenericFactor[];
  localityFactors: LocalityFactor[];
  rdlLines: RDLLine[];
  inputVariables: InputVariable[]; // Added input variables
}

// Calculation Input - Generic structure to work across all utilities
export interface CalculationInput {
  billing_date: string;
  rate: string;         // Generic rate identifier
  scenario?: Scenario;
  locality_id?: string; // Location identifier
  billing_determinants: Record<string, number>; // Generic key-value pairs for any determinant
}

// Calculation Output (matches Rust CalculationResult struct)
export interface CalculationOutput {
  status: string;
  output: Record<string, number>;
  errors?: string[];
  debug?: Record<string, any>;
  request?: any;
}

// Helper Functions
export function getFactorsForDate<T extends BaseFactor>(
  factors: T[],
  date: string,
  matcher: (factor: T) => boolean = () => true
): T[] {
  return factors.filter(factor => {
    const { start_date, end_date } = factor.date_range;
    return date >= start_date &&
           date <= end_date &&
           matcher(factor);
  });
}

// Get rate factors for a specific rate and charge
export function getRateFactors(
  factors: RateFactor[],
  date: string,
  rate: string,
  charge_name: string,
  scenario: Scenario = 'DEFAULT'
): RateFactor[] {
  return getFactorsForDate(
    factors,
    date,
    factor => factor.rate === rate &&
              factor.charge_name === charge_name &&
              factor.scenario === scenario
  );
}

// Get generic factors by name
export function getGenericFactors(
  factors: GenericFactor[],
  date: string,
  name: string,
  scenario: Scenario = 'DEFAULT'
): GenericFactor[] {
  return getFactorsForDate(
    factors,
    date,
    factor => factor.name === name && factor.scenario === scenario
  );
}

// Get locality factors
export function getLocalityFactors(
  factors: LocalityFactor[],
  date: string,
  locality_id: string,
  factor_type: string,
  scenario: Scenario = 'DEFAULT'
): LocalityFactor[] {
  return getFactorsForDate(
    factors,
    date,
    factor => factor.locality_id === locality_id &&
              factor.factor_type === factor_type &&
              factor.scenario === scenario
  );
}

// Generate a unique ID
export function generateUniqueId(): string {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

// Get RDL lines for a scenario
export function getRDLLines(
  lines: RDLLine[],
  scenario: Scenario = 'DEFAULT'
): RDLLine[] {
  return lines
    .filter(line => line.scenario === scenario)
    .sort((a, b) => a.order - b.order);
}