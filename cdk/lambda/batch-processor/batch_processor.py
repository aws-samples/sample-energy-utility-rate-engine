"""
Batch Processor Lambda - Orchestrates batch rate calculations via Step Functions.

This Lambda supports two actions:
1. init: Lists JSONL files in input prefix and prepares batch job
2. finalize: Merges output files and creates summary

The actual file processing is done by the Calculator Lambda directly reading from S3.
"""

import json
import os
import uuid
import boto3
from datetime import datetime
from typing import Any

s3_client = boto3.client('s3')

BATCH_BUCKET = os.environ.get('BATCH_BUCKET', '')


def handler(event: dict, context: Any) -> dict:
    """Main handler - routes to appropriate action."""
    action = event.get('action', 'init')

    if action == 'init':
        return init_batch(event)
    elif action == 'finalize':
        return finalize_batch(event)
    else:
        raise ValueError(f"Unknown action: {action}")


def init_batch(event: dict) -> dict:
    """
    Initialize batch job - list input files and prepare job metadata.

    Input:
        scenario: str - The scenario to use for calculations
        inputPrefix: str - S3 prefix for input JSONL files (e.g., "input/batch-123/")
        override: dict (optional) - Override values to merge into each calculation input

    Output:
        batchId: str - Unique batch job ID
        scenario: str - The scenario name
        outputPrefix: str - S3 prefix for output files
        files: list - List of file definitions for Distributed Map
        override: dict (optional) - Passed through for calculator Lambda
    """
    scenario = event['scenario']
    input_prefix = event['inputPrefix'].rstrip('/') + '/'
    override = event.get('override')  # Optional override object

    # Extract batch ID from input prefix (e.g., "input/batch-1234567890-abc123/" -> "batch-1234567890-abc123")
    # This preserves the original batch ID so status API can find results
    prefix_parts = input_prefix.strip('/').split('/')
    if len(prefix_parts) >= 2:
        batch_id = prefix_parts[-1]  # Get the batch folder name
    else:
        batch_id = str(uuid.uuid4())[:8]

    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    output_prefix = f"output/{scenario}/{timestamp}-{batch_id}"

    # List all JSONL files in input prefix
    files = []
    paginator = s3_client.get_paginator('list_objects_v2')

    for page in paginator.paginate(Bucket=BATCH_BUCKET, Prefix=input_prefix):
        for obj in page.get('Contents', []):
            key = obj['Key']
            # Only process .jsonl files
            if key.endswith('.jsonl') or key.endswith('.json'):
                # Derive output key from input key
                filename = key.split('/')[-1]
                output_key = f"{output_prefix}/{filename}"

                files.append({
                    's3Input': f"s3://{BATCH_BUCKET}/{key}",
                    's3Output': f"s3://{BATCH_BUCKET}/{output_key}",
                    'inputKey': key,
                    'outputKey': output_key,
                })

    if not files:
        raise ValueError(f"No .jsonl or .json files found in s3://{BATCH_BUCKET}/{input_prefix}")

    # Limit batch size to prevent runaway costs and resource exhaustion
    MAX_BATCH_FILES = 100
    if len(files) > MAX_BATCH_FILES:
        raise ValueError(f"Batch size {len(files)} exceeds maximum of {MAX_BATCH_FILES} files. Split into smaller batches.")

    start_time = datetime.utcnow().isoformat() + 'Z'
    print(f"Initialized batch {batch_id}: {len(files)} files to process" +
          (f" with override: {override}" if override else ""))

    result = {
        'batchId': batch_id,
        'scenario': scenario,
        'outputPrefix': output_prefix,
        'fileCount': len(files),
        'files': files,
        'startTime': start_time,
        'override': override if override else {},  # Always include override (default to empty dict)
    }

    return result


def finalize_batch(event: dict) -> dict:
    """
    Finalize batch job - aggregate results and create summary.

    Input:
        scenario: str - The scenario used
        batchId: str - Batch job ID
        outputPrefix: str - S3 prefix for output files
        startTime: str - ISO format start time from init
        fileResults: list - Results from all file processors

    Output:
        summaryFile: str - S3 URI of summary JSON file
        totalRecords: int - Total records processed
        successCount: int - Total successful calculations
        errorCount: int - Total failed calculations
        processingTimeMs: int - Total processing time in milliseconds
    """
    scenario = event['scenario']
    batch_id = event['batchId']
    output_prefix = event['outputPrefix']
    start_time_str = event.get('startTime')
    file_results = event.get('fileResults', [])

    # Calculate processing time
    end_time = datetime.utcnow()
    processing_time_ms = 0
    if start_time_str:
        try:
            start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
            processing_time_ms = int((end_time - start_time.replace(tzinfo=None)).total_seconds() * 1000)
        except (ValueError, TypeError):
            pass

    # Aggregate statistics from file results
    total_records = 0
    total_success = 0
    total_failed = 0

    for result in file_results:
        total_records += result.get('recordsProcessed', 0)
        total_success += result.get('recordsSucceeded', 0)
        total_failed += result.get('recordsFailed', 0)

    # Create summary
    summary = {
        'batchId': batch_id,
        'scenario': scenario,
        'completedAt': datetime.utcnow().isoformat() + 'Z',
        'processingTimeMs': processing_time_ms,
        'totalRecords': total_records,
        'successCount': total_success,
        'errorCount': total_failed,
        'successRate': round(total_success / total_records * 100, 2) if total_records > 0 else 0,
        'filesProcessed': len(file_results),
        'outputPrefix': f"s3://{BATCH_BUCKET}/{output_prefix}/",
    }

    summary_file = f"{output_prefix}/summary.json"
    s3_client.put_object(
        Bucket=BATCH_BUCKET,
        Key=summary_file,
        Body=json.dumps(summary, indent=2).encode('utf-8'),
        ContentType='application/json',
    )

    print(f"Finalized batch {batch_id}: {total_records} records, {total_success} success, {total_failed} errors, {processing_time_ms}ms")

    return {
        'summaryFile': f"s3://{BATCH_BUCKET}/{summary_file}",
        'totalRecords': total_records,
        'successCount': total_success,
        'errorCount': total_failed,
        'successRate': summary['successRate'],
        'processingTimeMs': processing_time_ms,
    }
