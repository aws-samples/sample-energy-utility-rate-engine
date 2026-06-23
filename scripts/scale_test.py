#!/usr/bin/env python3
"""Benchmark the deployed Rust rate calculator at scale.

Generates synthetic JSONL batches (a RES/COM mix with varied usage and bill
dates), uploads them to the batch S3 bucket, and invokes the calculator Lambda
in S3-batch mode (``{s3Input, s3Output}``) across files concurrently. Reports
wall-clock throughput and Lambda compute cost derived from billed duration, then
projects the cost of a full rate case (entire customer base x N months).

Everything is resolved from the deployed CloudFormation stack, so this works in
any account/region without editing the script. Requires the AWS CLI configured
with credentials for the account where the stack is deployed, and a scenario
that has been deployed at least once (so its ``RateCalculator-<scenario>`` Lambda
exists).

Examples:
    # Run the standard ladder (10k -> 5M) and a rate-case projection
    python3 scripts/scale_test.py

    # One run of 1M records, 50k per file, 16 concurrent invocations
    python3 scripts/scale_test.py --records 1000000 --per-file 50000 --workers 16

    # Project a specific rate case from the largest measured run
    python3 scripts/scale_test.py --customers 5000000 --months 36

Note: this provisions no infrastructure and deletes its own S3 test data on
exit (use --keep-data to retain it). It does incur a small amount of Lambda and
S3 request cost — a full ladder run is well under one US dollar.
"""
import argparse
import base64
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

STACK_NAME = "RateEngineStack"
GB_S_PRICE = 0.0000133334  # AWS Lambda ARM64 (Graviton), us-east-1, per GB-second
REQ_PRICE = 0.20 / 1_000_000  # per request


def aws(args, **kw):
    return subprocess.run(["aws", *args], capture_output=True, text=True, **kw)


def stack_output(key, region):
    r = aws(["cloudformation", "describe-stacks", "--stack-name", STACK_NAME,
             "--region", region,
             "--query", f"Stacks[0].Outputs[?OutputKey=='{key}'].OutputValue",
             "--output", "text"])
    return r.stdout.strip()


def lambda_memory_gb(fn, region):
    r = aws(["lambda", "get-function-configuration", "--function-name", fn,
             "--region", region, "--query", "MemorySize", "--output", "text"])
    try:
        return int(r.stdout.strip()) / 1024
    except ValueError:
        return 2048 / 1024


def make_record(i):
    """One synthetic calculation input. Mixes RES and COM with varied usage/dates."""
    if i % 3 == 0:
        return {"RATE": "COM", "KWH": 20000 + (i % 50000), "KWD": 50 + (i % 200),
                "KWD_HISTORY": "[100.0,120.0,90.0]", "POWER_FACTOR": 0.88,
                "BILL_DATE": f"2025-{(i % 12) + 1:02d}-15", "TAX_CLASS": "TAXABLE",
                "LOCALITY": "SUBURBAN", "RIDERS": ["STORM_RECOVERY"]}
    return {"RATE": "RES", "KWH": 500 + (i % 2500), "KWD": 0,
            "BILL_DATE": f"2025-{(i % 12) + 1:02d}-15", "TAX_CLASS": "TAXABLE",
            "LOCALITY": "METRO", "RIDERS": []}


def upload_file(bucket, batch_id, idx, n, start, region):
    lines = "\n".join(json.dumps(make_record(start + j)) for j in range(n))
    key = f"input/{batch_id}/part-{idx:05d}.jsonl"
    p = aws(["s3", "cp", "-", f"s3://{bucket}/{key}", "--region", region],
            input=lines)
    if p.returncode != 0:
        raise RuntimeError(f"upload failed: {p.stderr}")
    return key


def invoke_file(fn, bucket, batch_id, idx, in_key, scenario, region):
    out_key = f"output/{batch_id}/part-{idx:05d}.jsonl"
    payload = {"s3Input": f"s3://{bucket}/{in_key}",
               "s3Output": f"s3://{bucket}/{out_key}", "scenario": scenario}
    pf, of = f"/tmp/_scale_in_{idx}.json", f"/tmp/_scale_out_{idx}.json"
    with open(pf, "w") as f:
        json.dump(payload, f)
    r = aws(["lambda", "invoke", "--function-name", fn, "--region", region,
             "--payload", f"fileb://{pf}", "--log-type", "Tail",
             "--cli-read-timeout", "650", "--query", "LogResult",
             "--output", "text", of])
    if r.returncode != 0:
        return {"file": idx, "error": r.stderr[:200]}
    billed = None
    try:
        for ln in base64.b64decode(r.stdout).decode("utf-8", "ignore").splitlines():
            if "Billed Duration" in ln:
                billed = float(ln.split("Billed Duration:")[1].split("ms")[0].strip())
    except Exception:
        pass
    out = json.load(open(of))
    return {"file": idx, "billed_ms": billed,
            "records": out.get("records_processed") or out.get("recordsProcessed")}


def delete_prefix(bucket, batch_id, region):
    for sub in ("input", "output"):
        aws(["s3", "rm", f"s3://{bucket}/{sub}/{batch_id}/", "--recursive",
             "--region", region])


def run(total, per_file, workers, fn, bucket, scenario, mem_gb, region, keep):
    n_files = (total + per_file - 1) // per_file
    batch_id = f"scaletest-{total}-{int(time.time())}"
    print(f"\n== {total:,} records | {per_file:,}/file | {n_files} files | {workers} workers ==")

    start, keys = 0, {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = []
        for fi in range(n_files):
            n = min(per_file, total - start)
            futs.append((fi, ex.submit(upload_file, bucket, batch_id, fi, n, start, region)))
            start += n
        for fi, fut in futs:
            keys[fi] = fut.result()

    t1 = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(invoke_file, fn, bucket, batch_id, fi, keys[fi], scenario, region)
                for fi in range(n_files)]
        for f in as_completed(futs):
            results.append(f.result())
    wall_s = time.time() - t1

    if not keep:
        delete_prefix(bucket, batch_id, region)

    ok = [r for r in results if r.get("billed_ms")]
    errs = [r for r in results if r.get("error")]
    recs = sum(r.get("records") or 0 for r in ok)
    gb_s = sum(r["billed_ms"] for r in ok) / 1000 * mem_gb
    cost = gb_s * GB_S_PRICE + len(ok) * REQ_PRICE

    print(f"  files ok: {len(ok)}  errors: {len(errs)}  records: {recs:,}")
    print(f"  wall-clock: {wall_s:.1f}s   compute: {gb_s:.1f} GB-s")
    if recs:
        print(f"  throughput: {recs / wall_s:,.0f} calc/sec")
        print(f"  cost: ${cost:.4f}  (${cost / recs * 1_000_000:.4f} per 1M)")
    if errs:
        print("  ERRORS:", errs[:3])
    return {"records": recs, "wall_s": round(wall_s, 1), "gb_s": round(gb_s, 1),
            "cost": round(cost, 4),
            "per_1M": round(cost / recs * 1_000_000, 4) if recs else None,
            "billed_s_per_1M": round(sum(r["billed_ms"] for r in ok) / 1000 / recs * 1_000_000, 1) if recs else None,
            "errors": len(errs)}


def project(stats, customers, months):
    n = customers * months
    per_1M = stats["per_1M"]
    billed_per_1M = stats["billed_s_per_1M"]
    print(f"\n== Rate-case projection: {customers:,} customers x {months} months "
          f"= {n:,} calculations ==")
    print(f"  (from measured ${per_1M:.4f}/1M and {billed_per_1M:.1f} compute-sec/1M)")
    print(f"  Lambda compute cost: ${n / 1_000_000 * per_1M:.2f}")
    billed_s = n / 1_000_000 * billed_per_1M
    for conc in (100, 1000, 3000):
        print(f"  wall-clock @ {conc:>4} concurrent Lambdas: ~{billed_s / conc / 60:.1f} min")


def main():
    ap = argparse.ArgumentParser(description="Benchmark the rate calculator at scale.")
    ap.add_argument("--scenario", default="DEFAULT")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--records", type=int, help="single run of N records (default: run a ladder)")
    ap.add_argument("--per-file", type=int, default=50000)
    ap.add_argument("--workers", type=int, default=16, help="concurrent invocations")
    ap.add_argument("--customers", type=int, default=5_000_000, help="rate-case projection")
    ap.add_argument("--months", type=int, default=36, help="rate-case projection")
    ap.add_argument("--keep-data", action="store_true", help="keep generated S3 data")
    args = ap.parse_args()

    fn = f"RateCalculator-{args.scenario}"
    bucket = stack_output("BatchBucketName", args.region)
    if not bucket:
        sys.exit(f"Could not resolve BatchBucketName from stack {STACK_NAME} "
                 f"in {args.region}. Is the stack deployed?")
    mem_gb = lambda_memory_gb(fn, args.region)
    print(f"calculator: {fn}  bucket: {bucket}  mem: {mem_gb * 1024:.0f}MB  region: {args.region}")

    if args.records:
        stats = run(args.records, args.per_file, args.workers, fn, bucket,
                    args.scenario, mem_gb, args.region, args.keep_data)
    else:
        ladder = [(10_000, 10_000), (100_000, 10_000),
                  (1_000_000, 50_000), (5_000_000, 50_000)]
        stats = None
        for total, per_file in ladder:
            stats = run(total, per_file, args.workers, fn, bucket,
                        args.scenario, mem_gb, args.region, args.keep_data)

    if stats and stats.get("per_1M"):
        project(stats, args.customers, args.months)


if __name__ == "__main__":
    main()
