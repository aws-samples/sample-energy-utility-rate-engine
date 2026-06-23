# Batch Processing & Rate-Case Modeling at Scale

This guide describes how to leverage the Rate Engine for large-scale rate case analysis, enabling utilities to project revenue impacts and customer bill changes when evaluating new rate structures.

## Why This Matters

Rate cases and large-scale bill modeling are traditionally slow and expensive: months of spreadsheet work, third-party consultants, and billing-system logic that takes several change cycles to update. Because the same logic lives in three or four disconnected systems, the "estimate" a customer sees, the number the rates department models, and the bill the customer of record produces rarely agree to the penny.

This engine collapses that into a single source of truth. Rate logic authored once in RDL serves both the real-time API and large-scale batch runs, so the projection a customer sees on the website and the rate-case exhibit filed with the regulator come from the *exact same compiled code*.

**What makes large-scale modeling cheap and fast here:**

- **Stateless calculations.** Every billing determinant is supplied at calculation time — the engine performs no customer-data lookups mid-calculation (only rate-factor lookups against configuration). Each calculation is an independent, pure function of its inputs.
- **Compiled Rust.** Each bill executes in ~1 ms warm on ARM64 Lambda, using a few tens of MB of memory.
- **Embarrassingly parallel.** With no shared state or bottleneck, throughput scales almost linearly with concurrency — add workers, get proportionally more calculations per second.

A full rate-case sweep of the entire customer base over several years becomes a one-time, predictable spend of a few dollars in compute, completing in minutes rather than weeks.

## Measured Performance

Measured against the deployed `RateCalculator-DEFAULT` Rust Lambda (ARM64, 2048 MB, `provided.al2023`) in `us-east-1`, with billed duration read from the CloudWatch `REPORT` line. Reproduce with [`scripts/scale_test.py`](../scripts/scale_test.py).

**Single calculation:** ~1.1 ms warm execution, ~216 ms billed cold start (one-time), 40 MB peak memory of 2048 MB provisioned, to-the-penny accurate.

**Batch throughput** (run from a laptop with only 16 concurrent invocations — a client-side limit, not a Lambda limit):

| Records | Wall-clock | Throughput | Compute cost |
|---------|-----------|------------|--------------|
| 10,000 | 1.9 s | ~5,200 calc/sec | <\$0.01 |
| 100,000 | 3.9 s | ~26,000 calc/sec | <\$0.01 |
| 1,000,000 | 10.2 s | ~98,000 calc/sec | \$0.0014 |
| 5,000,000 | 41.1 s | ~122,000 calc/sec | \$0.0065 |

Compute cost holds steady at **~\$0.0013 per 1M calculations** as volume grows. Extrapolated to full rate-case workloads (easily reached with higher concurrency):

| Rate-case workload | Calculations | Lambda compute cost | Wall-clock @ 1,000 concurrency |
|--------------------|-------------|---------------------|-------------------------------|
| 5M customers × 1 month | 5,000,000 | ~\$0.01 | seconds |
| 5M customers × 12 months | 60,000,000 | ~\$0.08 | ~50 s |
| **5M customers × 36 months** | **180,000,000** | **~\$0.23** | **~1.5 min** |

## What is a Rate Case?

A **rate case** is a regulatory proceeding where utilities propose changes to their rate structures. Key analyses include:

- **Revenue Impact**: How will total revenue change under proposed rates?
- **Customer Bill Impact**: How will individual customer bills be affected?
- **Rate Class Analysis**: Which customer segments see increases vs. decreases?

Utilities typically need to calculate bills for millions of customers across multiple years to support rate case filings.

## Analysis Approach

The Rate Engine supports rate case analysis through **scenario comparison** combined with **date overrides** that project historical usage data to future rate periods.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Rate Case Analysis Workflow                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Historical Billing Determinants (2022-2024)                        │
│  (Customer ID, Rate Code, kWh, kW, Date, Locality...)               │
│                    │                                                │
│                    ▼                                                │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │              Batch Overrides                            │        │
│  │  • BILL_DATE_OFFSET_YEARS: 3  (project to 2025-2027)   │        │
│  │  • Or BILL_DATE: "2026-01-15" (specific date)          │        │
│  └─────────────────────────────────────────────────────────┘        │
│                    │                                                │
│         ┌─────────┴─────────┐                                       │
│         │                   │                                       │
│         ▼                   ▼                                       │
│  ┌─────────────┐     ┌─────────────┐                                │
│  │  CURRENT    │     │  PROPOSED   │                                │
│  │   RATES     │     │   RATES     │                                │
│  │  Scenario   │     │  Scenario   │                                │
│  └─────────────┘     └─────────────┘                                │
│         │                   │                                       │
│         └─────────┬─────────┘                                       │
│                   │                                                 │
│                   ▼                                                 │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │         Analyze with Athena & QuickSight               │        │
│  │  • Revenue by rate class                                │        │
│  │  • Customer bill impact distribution                    │        │
│  │  • Monthly/yearly trends                                │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Date Overrides for Projections

The Rate Engine supports **batch-level overrides** that apply to all calculations in a batch job. This is essential for rate case analysis where you need to project historical usage patterns to future rate periods.

### Available Overrides

| Override | Type | Description |
|----------|------|-------------|
| `BILL_DATE` | string | Override all bill dates with a specific date (e.g., "2026-01-15") |
| `BILL_DATE_OFFSET_YEARS` | number | Offset all bill dates by N years (e.g., 3 to project 2022→2025) |
| `BILL_DATE_OFFSET_MONTHS` | number | Offset all bill dates by N months |

### How It Works

The RDL calculation logic determines the **effective date** for factor lookups:

```
effective_date = INPUT.BILL_DATE
IF OVERRIDE.BILL_DATE != ""
  effective_date = OVERRIDE.BILL_DATE
ELSEIF OVERRIDE.BILL_DATE_OFFSET_YEARS != 0
  effective_date = ADD_YEARS(INPUT.BILL_DATE, OVERRIDE.BILL_DATE_OFFSET_YEARS)
ELSEIF OVERRIDE.BILL_DATE_OFFSET_MONTHS != 0
  effective_date = ADD_MONTHS(INPUT.BILL_DATE, OVERRIDE.BILL_DATE_OFFSET_MONTHS)
ENDIF

// All GET_FACTOR calls use effective_date for rate lookups
customer_charge = GET_FACTOR(INPUT.RATE, "CUSTOMER_CHARGE", "", "", "", effective_date)
```

This means:
1. Historical usage data retains its original seasonality and consumption patterns
2. Rate factor lookups use the **projected date** to retrieve future rates
3. The same input data can be run against multiple scenarios and time periods

### Projection Examples

**Project 3 Years Forward**:
- Input: Customer bill from January 2023 with 1,500 kWh
- Override: `BILL_DATE_OFFSET_YEARS: 3`
- Result: Calculation uses rates effective January 2026

**Test Specific Rate Effective Date**:
- Input: Any historical usage data
- Override: `BILL_DATE: "2026-07-01"` (proposed rate effective date)
- Result: All calculations use rates effective July 1, 2026

## Scale Considerations

### Typical Rate Case Volumes

| Utility Size | Customers | Time Period | Total Calculations |
|--------------|-----------|-------------|-------------------|
| Small | 100,000 | 72 months | 7.2 million |
| Medium | 1,000,000 | 72 months | 72 million |
| Large | 5,000,000 | 72 months | 360 million |
| Very Large | 10,000,000 | 72 months | 720 million |

### Processing Time Estimates

With the batch processing architecture (ARM64 Lambda, 2048MB memory):

| Calculations | Files (50k/file) | Time @ 10 concurrent | Time @ 100 concurrent |
|--------------|------------------|---------------------|----------------------|
| 7.2M | 144 | ~1 min | ~15 sec |
| 72M | 1,440 | ~7 min | ~1 min |
| 360M | 7,200 | ~35 min | ~4 min |
| 720M | 14,400 | ~70 min | ~8 min |

## Architecture Scaling

### Current Configuration

The default batch processing configuration:
- **Concurrency**: 10 simultaneous Lambda invocations
- **Timeout**: 2 hours per batch job
- **File Size**: 50,000 records per JSONL file

### Recommended Changes for Large Scale

For rate case volumes exceeding 100M calculations:

```typescript
// cdk/lib/stacks/rate-engine-stack.ts

// Increase parallel processing
const processAllFiles = new sfn.Map(this, 'ProcessAllFiles', {
  maxConcurrency: 100,  // Increase from 10
  // ...
});

// Extend timeout for large jobs
const batchStateMachine = new sfn.StateMachine(this, 'BatchStateMachine', {
  timeout: cdk.Duration.hours(6),  // Increase from 2
  // ...
});
```

### Lambda Concurrency Limits

Ensure your AWS account has sufficient Lambda concurrent execution quota:
- Default quota: 1,000 concurrent executions
- Request increase via AWS Support for large-scale processing
- Consider reserved concurrency for predictable performance

## Data Preparation

### Billing Determinant Structure

Prepare input data with one record per customer-month:

```json
{
  "CUSTOMER_ID": "CUST-0000001",
  "RATE": "RES",
  "BILL_YEAR": 2024,
  "BILL_MONTH": 6,
  "KWH": 1250,
  "KWD": 8.5,
  "BILLING_DAYS": 30,
  "LOCALITY": "METRO",
  "TAX_CLASS": "TAXABLE",
  "NET_METERING": false,
  "KWH_GENERATED": 0
}
```

### Input File Organization

Partition data into manageable files:

```
s3://rate-engine-batch-{account}-{region}/
└── input/
    └── rate-case-2025/
        ├── batch-000001.jsonl  (50,000 records)
        ├── batch-000002.jsonl  (50,000 records)
        ├── batch-000003.jsonl  (50,000 records)
        └── ... (as many as needed)
```

**Best Practices**:
- Keep files under 50MB (~50k records)
- Use consistent naming for easy tracking
- Include all customer-months in each file (don't split by customer)

### Customer Mix

For representative analysis, include realistic customer distribution:

| Rate Class | Typical Mix | Example Rates |
|------------|-------------|---------------|
| Residential | 70-80% | RES |
| Small Commercial | 15-20% | COM |
| Large Commercial | 3-5% | COM |
| Industrial | 1-2% | COM |

## Scenario Management

### Creating Scenarios

1. **CURRENT_RATES Scenario**: Clone your production rate factors
2. **PROPOSED_RATES Scenario**: Create new scenario with proposed rate values

Both scenarios use the **same RDL calculation logic** but different factor values in DynamoDB.

### Factor Table Setup

For the proposed rates scenario, update factors in `RateEngine-Factors`:

```
Scenario: PROPOSED_RATES
Factor Key: RES#CUSTOMER_CHARGE####2025-01-01
Value: 10.50  (increased from 9.48)

Scenario: PROPOSED_RATES
Factor Key: RES#ENERGY_CHARGE_STEP_1####2025-01-01
Value: 0.0750  (increased from 0.0706)
```

### Running Both Scenarios

Execute batch processing for each scenario with the same input data. Use **overrides** to project historical data to future rate periods:

```bash
# Scenario 1: Current Rates - project historical data 3 years forward
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:REGION:ACCOUNT:stateMachine:RateEngine-BatchProcessing" \
  --name "rate-case-current-$(date +%s)" \
  --input '{
    "scenario": "CURRENT_RATES",
    "inputPrefix": "input/rate-case-2025/",
    "overrides": {
      "BILL_DATE_OFFSET_YEARS": 3
    }
  }'

# Scenario 2: Proposed Rates - same projection with proposed rate factors
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:REGION:ACCOUNT:stateMachine:RateEngine-BatchProcessing" \
  --name "rate-case-proposed-$(date +%s)" \
  --input '{
    "scenario": "PROPOSED_RATES",
    "inputPrefix": "input/rate-case-2025/",
    "overrides": {
      "BILL_DATE_OFFSET_YEARS": 3
    }
  }'
```

**Alternative: Test a specific rate effective date**:
```bash
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:REGION:ACCOUNT:stateMachine:RateEngine-BatchProcessing" \
  --name "rate-case-july2026-$(date +%s)" \
  --input '{
    "scenario": "PROPOSED_RATES",
    "inputPrefix": "input/rate-case-2025/",
    "overrides": {
      "BILL_DATE": "2026-07-01"
    }
  }'
```

## Analytics Integration

### Output Structure

Batch processing creates JSONL output files:

```
s3://rate-engine-batch-{account}-{region}/
└── output/
    ├── CURRENT_RATES/
    │   └── 20250115-143000-batch-abc123/
    │       ├── batch-000001.jsonl
    │       ├── batch-000002.jsonl
    │       └── summary.json
    └── PROPOSED_RATES/
        └── 20250115-150000-batch-def456/
            ├── batch-000001.jsonl
            ├── batch-000002.jsonl
            └── summary.json
```

### Querying with Amazon Athena

#### Create Database

```sql
CREATE DATABASE rate_engine_analytics;
```

#### Create Table for JSONL Output

```sql
CREATE EXTERNAL TABLE rate_engine_analytics.batch_results (
  input struct<
    CUSTOMER_ID:string,
    RATE:string,
    BILL_YEAR:int,
    BILL_MONTH:int,
    KWH:double,
    KWD:double,
    BILLING_DAYS:int,
    LOCALITY:string,
    TAX_CLASS:string
  >,
  result struct<
    status:string,
    output:array<struct<category:string,field:string,value:double>>,
    errors:array<string>
  >
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json' = 'true')
LOCATION 's3://rate-engine-batch-{account}-{region}/output/';
```

#### Sample Queries

**Total Revenue by Scenario and Rate Class**:
```sql
SELECT
  '$path' as scenario_path,
  input.RATE as rate_code,
  COUNT(*) as customer_months,
  SUM(
    REDUCE(result.output, 0.0,
      (s, x) -> IF(x.field = 'total', x.value, s),
      s -> s)
  ) as total_revenue
FROM rate_engine_analytics.batch_results
WHERE result.status = 'success'
GROUP BY '$path', input.RATE
ORDER BY scenario_path, rate_code;
```

**Average Bill by Rate Class**:
```sql
SELECT
  input.RATE as rate_code,
  AVG(
    REDUCE(result.output, 0.0,
      (s, x) -> IF(x.field = 'total', x.value, s),
      s -> s)
  ) as avg_bill
FROM rate_engine_analytics.batch_results
WHERE result.status = 'success'
  AND "$path" LIKE '%CURRENT_RATES%'
GROUP BY input.RATE;
```

### Parquet Optimization (Optional)

For very large datasets, converting to Parquet improves query performance:

**Benefits**:
- 5-10x faster queries (columnar storage)
- 75% smaller storage (compression)
- Lower Athena costs (less data scanned)

**Conversion Approach**:
```python
import pyarrow as pa
import pyarrow.parquet as pq
import json

# Read JSONL, flatten nested structure, write partitioned Parquet
# Partition by: scenario/year/month for efficient querying
```

### QuickSight Dashboards

Connect QuickSight to Athena for visualization:

1. **Create Data Source**: Connect to Athena database
2. **Create Dataset**: Use custom SQL or table
3. **Build Visualizations**:

**Recommended Dashboard Views**:

| View | Visualization | Purpose |
|------|---------------|---------|
| Revenue Summary | KPI cards | Total revenue current vs proposed |
| Revenue by Rate Class | Bar chart | Compare by RES, COM, etc. |
| Bill Impact Distribution | Histogram | % customers by increase bucket |
| Monthly Trend | Line chart | Revenue over time by scenario |
| Geographic Impact | Map/Table | Impact by locality |

## Cost Estimation

### Lambda Processing Costs

| Calculations | Lambda Time | Est. Cost |
|--------------|-------------|-----------|
| 7.2M | ~5 min | ~\$0.50 |
| 72M | ~50 min | ~\$5 |
| 360M | ~4 hours | ~\$25 |
| 720M | ~8 hours | ~\$50 |

*Based on ARM64, 2048MB memory, ~0.5s per 50k records*

### Storage Costs (S3)

| Data Size | Monthly Cost |
|-----------|--------------|
| 10 GB | \$0.23 |
| 100 GB | \$2.30 |
| 1 TB | \$23.00 |

### Athena Query Costs

- **Cost**: \$5.00 per TB scanned
- **Optimization**: Parquet format reduces scans by 75%+
- **Tip**: Use partitioning to limit data scanned

### QuickSight Costs

| License Type | Monthly Cost |
|--------------|--------------|
| Author | \$18/user |
| Reader | \$0.30/session (max \$5/month) |

## Industry Context

### Common Rate Case KPIs

| Metric | Description |
|--------|-------------|
| Revenue Requirement | Total revenue needed to cover costs |
| Revenue Change | \$ and % change from current to proposed |
| Bill Impact Distribution | % customers by impact bucket |
| Rate Class Cross-Subsidization | Whether rate classes pay fair share |
| COSS Alignment | Rates aligned to cost of service |

### Regulatory Considerations

- **Test Year**: Historical year used as basis for projections
- **Rate Base**: Utility assets on which returns are earned
- **Revenue Requirement**: Total revenue needed including ROE
- **Billing Determinants**: Usage data used for calculations

## Best-Fit Rate Analysis

The same batch mechanism that compares one customer base across two scenarios can compare **one customer across many rate classes** to find the rate that minimizes their bill. This is useful for customer self-service ("which rate should I be on?") and is sometimes **mandated**: regulators may require a utility to notify customers when they would be materially better off on a different rate based on historical consumption.

The approach is to run each customer's historical usage against every eligible rate, then pick the lowest annual total:

1. **Fan out by rate.** For each customer-month of historical usage, emit one calculation record per eligible rate class (e.g., the same usage as `RES`, `RES_TOU`, and `RES_EV`).
2. **Calculate all candidates.** Run the batch — every (customer, month, rate) combination is an independent calculation.
3. **Aggregate per customer.** Sum each candidate rate's annual total per customer and select the minimum.
4. **Report the delta.** Surface customers whose current rate exceeds their best-fit rate by more than a threshold — the population a utility may be required to notify.

Because each calculation is stateless and cheap, evaluating an entire customer base against several candidate rates is the same order of cost as a single-scenario rate case — multiplied only by the number of candidate rates. Time-of-use and EV rates, where the "best" choice depends heavily on a customer's load shape, are the most common best-fit targets.

## Next Steps

1. **Prepare Data**: Extract 3 years of historical billing determinants from your CIS/billing system
2. **Create Scenarios**: Set up CURRENT_RATES and PROPOSED_RATES with appropriate factors
3. **Configure Overrides**: Determine projection strategy (offset years or specific effective date)
4. **Scale Infrastructure**: Adjust concurrency and timeouts as needed for your data volume
5. **Run Analysis**: Execute batch processing for both scenarios with date overrides
6. **Query Results**: Use Athena to compare revenue and bill impacts across scenarios
7. **Build Dashboards**: Create QuickSight visualizations for stakeholder review
8. **Iterate**: Adjust proposed rates based on impact analysis and re-run
