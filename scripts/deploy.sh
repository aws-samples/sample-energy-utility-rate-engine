#!/bin/bash
# Deploy the Rate Engine to AWS
# Usage: ./scripts/deploy.sh [--seed-data]
set -e

SEED_DATA=false
[[ "$1" == "--seed-data" ]] && SEED_DATA=true

STACK_NAME="RateEngineStack"
ADMIN_EMAIL="admin@example.com"

# --- Helpers ---

step() { echo ""; echo "==> $1"; }
fail() { echo "ERROR: $1" >&2; exit 1; }

get_output() {
  aws cloudformation describe-stacks --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# --- Prerequisites ---

step "Checking prerequisites"
command -v node >/dev/null || fail "Node.js is not installed"
command -v aws >/dev/null  || fail "AWS CLI is not installed"
command -v python3 >/dev/null || fail "Python 3 is not installed"
aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured"
[ -d "./frontend" ] && [ -d "./cdk" ] || fail "Run this from the project root"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "us-east-1")
echo "  Account: $ACCOUNT  Region: $REGION"

# --- Build Lambda ---

step "Building API Lambda"
cd cdk/lambda
[ -d node_modules ] || npm install --silent
npm run build --silent
echo '{"type": "module"}' > dist/package.json
cd ../..

# --- Build Frontend ---

step "Building frontend"
cd frontend
[ -d node_modules ] || npm install --silent
npx vite build
cd ..

# --- Deploy CDK ---

step "Deploying CDK stack (this takes ~5 minutes)"
cd cdk
[ -d node_modules ] || npm install --silent
npx cdk deploy $STACK_NAME --require-approval never
cd ..

# --- Configure Frontend ---

step "Configuring frontend with Cognito IDs"
USER_POOL_ID=$(get_output UserPoolId)
CLIENT_ID=$(get_output UserPoolClientId)

cat > frontend/public/config.js << EOF
window.RATE_ENGINE_CONFIG = {
  API_ENDPOINT: "",
  REGION: "$REGION",
  USER_POOL_ID: "$USER_POOL_ID",
  USER_POOL_CLIENT_ID: "$CLIENT_ID"
};
EOF

# --- Upload Frontend to S3 ---

step "Uploading frontend to S3"
BUCKET=$(get_output BucketName)
aws s3 sync frontend/dist/ s3://$BUCKET/ --delete --quiet
# Overwrite config.js with the version that has real Cognito IDs
# (the dist/ copy was built before CDK created the user pool)
aws s3 cp frontend/public/config.js s3://$BUCKET/config.js --quiet

# --- Invalidate CloudFront ---

step "Invalidating CloudFront cache"
DIST_ID=$(get_output DistributionId)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*" > /dev/null

# --- Create Admin User ---

step "Creating admin user"
EXISTING=$(aws cognito-idp list-users --user-pool-id $USER_POOL_ID \
  --filter "email = \"$ADMIN_EMAIL\"" --query "Users[0].Username" --output text 2>/dev/null)

if [ "$EXISTING" = "None" ] || [ -z "$EXISTING" ]; then
  ADMIN_TEMP_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9!@#$%' < /dev/urandom | head -c 12)Aa1!"
  aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID \
    --username "$ADMIN_EMAIL" --temporary-password "$ADMIN_TEMP_PASSWORD" \
    --user-attributes Name=email,Value="$ADMIN_EMAIL" Name=email_verified,Value=true \
    > /dev/null
  aws cognito-idp admin-add-user-to-group --user-pool-id $USER_POOL_ID \
    --username "$ADMIN_EMAIL" --group-name Administrators 2>/dev/null || true
  ADMIN_CREATED=true
else
  echo "  Admin user already exists"
fi

# --- Seed Data ---

if [ "$SEED_DATA" = true ]; then
  step "Seeding DynamoDB tables"
  SEED_DIR="./scripts/seed_data"
  [ -d "$SEED_DIR" ] || fail "Seed data directory not found: $SEED_DIR"

  python3 << 'PYEOF'
import json, subprocess, sys, csv, os
from datetime import datetime

def get_output(key):
    r = subprocess.run(["aws", "cloudformation", "describe-stacks",
        "--stack-name", "RateEngineStack",
        "--query", f"Stacks[0].Outputs[?OutputKey=='{key}'].OutputValue",
        "--output", "text"], capture_output=True, text=True)
    return r.stdout.strip()

TABLES = {
    "scenarios": get_output("ScenariosTableName"),
    "rules": get_output("CalculationRulesTableName"),
    "functions": get_output("CustomFunctionsTableName"),
    "factors": get_output("FactorsTableName"),
    "validation": get_output("InputValidationTableName"),
    "deployments": get_output("DeploymentsTableName"),
    "payloads": get_output("TestPayloadsTableName"),
}
SEED = "./scripts/seed_data"
TS = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def to_ddb(v):
    if isinstance(v, str): return {"S": v}
    if isinstance(v, bool): return {"BOOL": v}
    if isinstance(v, (int, float)): return {"N": str(v)}
    if isinstance(v, list): return {"L": [to_ddb(i) for i in v]}
    if isinstance(v, dict): return {"M": {k: to_ddb(val) for k, val in v.items()}}
    if v is None: return {"NULL": True}
    return {"S": str(v)}

def put(table, item):
    ddb = {k: to_ddb(v) for k, v in item.items()}
    r = subprocess.run(["aws", "dynamodb", "put-item", "--table-name", table,
        "--item", json.dumps(ddb)], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  ERROR: {r.stderr}", file=sys.stderr); sys.exit(1)

def stamp(item):
    for k in ["PK", "SK", "id"]: item.pop(k, None)
    item.update(createdAt=TS, updatedAt=TS,
                createdBy=item.get("createdBy", "admin"),
                updatedBy=item.get("updatedBy", "admin"))
    return item

# Scenarios
data = json.load(open(f"{SEED}/scenarios.json"))
for s in data: put(TABLES["scenarios"], stamp(s))
print(f"  Scenarios: {len(data)}")

# RDL lines
data = json.load(open(f"{SEED}/rdl_lines.json"))
if not isinstance(data, list): data = [data]
for r in data: put(TABLES["rules"], stamp(r))
lines = sum(len(r.get("lines", [])) for r in data)
print(f"  RDL lines: {lines}")

# Custom functions
data = json.load(open(f"{SEED}/custom_functions.json"))
for f in data: put(TABLES["functions"], stamp(f))
print(f"  Custom functions: {len(data)}")

# Factors (CSV)
count = 0
with open(f"{SEED}/factors.csv") as f:
    for row in csv.DictReader(f):
        keys = [row[f"key{i}"] for i in range(1,6) if row.get(f"key{i}")]
        factor = {
            "scenario": row.get("scenario", "DEFAULT"),
            "factor_key": f"{'#'.join(keys)}#{row['start_date']}",
            "key1": row["key1"], "value": float(row["value"]),
            "start_date": row["start_date"], "end_date": row["end_date"],
            "createdAt": TS, "updatedAt": TS, "createdBy": "admin", "updatedBy": "admin",
        }
        for i in range(2, 6):
            if row.get(f"key{i}"): factor[f"key{i}"] = row[f"key{i}"]
        put(TABLES["factors"], factor)
        count += 1
print(f"  Factors: {count}")

# Input validation
data = json.load(open(f"{SEED}/input_validation.json"))
for iv in data:
    iv.setdefault("scenario", "DEFAULT"); put(TABLES["validation"], stamp(iv))
print(f"  Input validation rules: {len(data)}")

# Test payloads
data = json.load(open(f"{SEED}/test_payloads.json"))
for tp in data:
    tp.setdefault("scenario", "DEFAULT"); put(TABLES["payloads"], stamp(tp))
print(f"  Test payloads: {len(data)}")
PYEOF
fi

# --- Done ---

DIST_URL=$(get_output DistributionUrl)
step "Deployment complete!"
echo ""
echo "  Frontend:  $DIST_URL"
if [ "$ADMIN_CREATED" = true ]; then
  echo "  Admin:     $ADMIN_EMAIL"
  echo "  Password:  $ADMIN_TEMP_PASSWORD  (temporary — must be changed on first login)"
else
  echo "  Admin:     $ADMIN_EMAIL (already existed)"
fi
echo ""
echo "  Next: Log in, go to Scenarios, and click Deploy on the DEFAULT scenario."
echo "  The first Rust build takes ~7 minutes. Subsequent builds take ~2 minutes."
