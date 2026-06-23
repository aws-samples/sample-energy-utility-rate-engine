"""
Lambda handler for RDL to Rust code generation and API Gateway configuration.
Invoked by Step Functions as part of the deployment pipeline.
"""
import json
import logging
import boto3
import os
import re
import time
from rdl_to_rust import generate_full_rust_code, CARGO_TOML_TEMPLATE

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Scenario names become Lambda function names and API Gateway path segments,
# so they must be restricted to a safe character set.
SCENARIO_NAME_PATTERN = re.compile(r'^[A-Za-z0-9_-]{1,64}$')


def validate_scenario_name(scenario):
    """Reject scenario names that aren't safe for AWS resource names/paths."""
    if not isinstance(scenario, str) or not SCENARIO_NAME_PATTERN.fullmatch(scenario):
        raise ValueError(
            f"Invalid scenario name {scenario!r}: must match [A-Za-z0-9_-]{{1,64}}"
        )

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
apigateway = boto3.client('apigateway')
lambda_client = boto3.client('lambda')


def configure_api_gateway(scenario, deployment_id):
    """
    Configure API Gateway to route /calculate/{scenario} to the deployed Lambda.

    Creates or updates:
    1. API Gateway resource /calculate/{scenario}
    2. POST method with Lambda proxy integration
    3. Lambda invoke permission for API Gateway
    4. Deploys the API Gateway stage
    """
    api_gateway_id = os.environ.get('API_GATEWAY_ID')
    calculate_resource_id = os.environ.get('CALCULATE_RESOURCE_ID')
    authorizer_id = os.environ.get('AUTHORIZER_ID')
    region = os.environ.get('AWS_REGION', 'us-east-1')
    account_id = boto3.client('sts').get_caller_identity()['Account']

    if not api_gateway_id or not calculate_resource_id:
        raise ValueError("API_GATEWAY_ID and CALCULATE_RESOURCE_ID environment variables required")

    lambda_function_name = f"RateCalculator-{scenario}"
    lambda_arn = f"arn:aws:lambda:{region}:{account_id}:function:{lambda_function_name}"

    logger.info(f"Configuring API Gateway for scenario: {scenario}")
    logger.info(f"  API Gateway ID: {api_gateway_id}")
    logger.info(f"  Calculate Resource ID: {calculate_resource_id}")
    logger.info(f"  Lambda ARN: {lambda_arn}")

    # Check if scenario resource already exists (paginate — an API can have >500 resources)
    scenario_resource_id = None
    for page in apigateway.get_paginator('get_resources').paginate(restApiId=api_gateway_id):
        for resource in page.get('items', []):
            if resource.get('pathPart') == scenario and resource.get('parentId') == calculate_resource_id:
                scenario_resource_id = resource['id']
                logger.info(f"  Found existing resource for {scenario}: {scenario_resource_id}")
                break
        if scenario_resource_id:
            break

    # Create resource if it doesn't exist
    if not scenario_resource_id:
        logger.info(f"  Creating new resource for {scenario}")
        create_response = apigateway.create_resource(
            restApiId=api_gateway_id,
            parentId=calculate_resource_id,
            pathPart=scenario
        )
        scenario_resource_id = create_response['id']
        logger.info(f"  Created resource: {scenario_resource_id}")

    # Check if POST method exists
    try:
        apigateway.get_method(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='POST'
        )
        method_exists = True
        logger.info("  POST method already exists, updating integration")
    except apigateway.exceptions.NotFoundException:
        method_exists = False
        logger.info("  POST method does not exist, creating")

    # Create or update the POST method
    if not method_exists:
        # Create POST method with Cognito authorization
        apigateway.put_method(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='POST',
            authorizationType='COGNITO_USER_POOLS',
            authorizerId=authorizer_id,
            requestParameters={}
        )
        logger.info("  Created POST method with Cognito authorization")

    # Set up Lambda proxy integration
    integration_uri = f"arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{lambda_arn}/invocations"
    apigateway.put_integration(
        restApiId=api_gateway_id,
        resourceId=scenario_resource_id,
        httpMethod='POST',
        type='AWS_PROXY',
        integrationHttpMethod='POST',
        uri=integration_uri
    )
    logger.info(f"  Configured Lambda proxy integration: {integration_uri}")

    # Add method response for 200
    try:
        apigateway.put_method_response(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='POST',
            statusCode='200',
            responseParameters={
                'method.response.header.Access-Control-Allow-Origin': False
            }
        )
    except apigateway.exceptions.ConflictException:
        pass  # Response already exists

    # Add CORS OPTIONS method if it doesn't exist
    try:
        apigateway.get_method(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='OPTIONS'
        )
    except apigateway.exceptions.NotFoundException:
        # Create OPTIONS method for CORS
        apigateway.put_method(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='OPTIONS',
            authorizationType='NONE',
            requestParameters={}
        )
        apigateway.put_integration(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='OPTIONS',
            type='MOCK',
            requestTemplates={'application/json': '{"statusCode": 200}'}
        )
        apigateway.put_method_response(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='OPTIONS',
            statusCode='200',
            responseParameters={
                'method.response.header.Access-Control-Allow-Headers': False,
                'method.response.header.Access-Control-Allow-Methods': False,
                'method.response.header.Access-Control-Allow-Origin': False
            }
        )
        apigateway.put_integration_response(
            restApiId=api_gateway_id,
            resourceId=scenario_resource_id,
            httpMethod='OPTIONS',
            statusCode='200',
            responseParameters={
                'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
                'method.response.header.Access-Control-Allow-Origin': "'*'"
            }
        )
        logger.info("  Created OPTIONS method for CORS")

    # Add Lambda invoke permission for API Gateway
    statement_id = f"apigateway-{scenario}-invoke"
    source_arn = f"arn:aws:execute-api:{region}:{account_id}:{api_gateway_id}/*/POST/api/calculate/{scenario}"

    try:
        lambda_client.remove_permission(
            FunctionName=lambda_function_name,
            StatementId=statement_id
        )
        logger.info(f"  Removed existing Lambda permission: {statement_id}")
    except lambda_client.exceptions.ResourceNotFoundException:
        pass

    lambda_client.add_permission(
        FunctionName=lambda_function_name,
        StatementId=statement_id,
        Action='lambda:InvokeFunction',
        Principal='apigateway.amazonaws.com',
        SourceArn=source_arn
    )
    logger.info(f"  Added Lambda permission for API Gateway: {source_arn}")

    # Deploy the API Gateway stage
    apigateway.create_deployment(
        restApiId=api_gateway_id,
        stageName='prod',
        description=f'Deployment for scenario {scenario} - {deployment_id}'
    )
    logger.info("  Deployed API Gateway stage: prod")

    return {
        'scenario': scenario,
        'deploymentId': deployment_id,
        'apiGatewayResourceId': scenario_resource_id,
        'lambdaArn': lambda_arn
    }


def handler(event, context):
    """
    Main handler - routes to appropriate function based on action.
    Called by Step Functions deployment state machine.

    Actions:
    - (default): Generate Rust code from RDL lines and upload to S3
    - configureApiGateway: Configure API Gateway for the deployed Lambda
    """
    action = event.get('action', 'generateRustCode')
    scenario = event['scenario']
    deployment_id = event['deploymentId']

    validate_scenario_name(scenario)

    if action == 'configureApiGateway':
        return configure_api_gateway(scenario, deployment_id)

    # Get table names from environment variables
    calculation_rules_table_name = os.environ['CALCULATION_RULES_TABLE']
    custom_functions_table_name = os.environ['CUSTOM_FUNCTIONS_TABLE']
    input_validation_table_name = os.environ['INPUT_VALIDATION_TABLE']

    calculation_rules_table = dynamodb.Table(calculation_rules_table_name)
    custom_functions_table = dynamodb.Table(custom_functions_table_name)
    input_validation_table = dynamodb.Table(input_validation_table_name)

    # Read RDL lines from CalculationRules table
    logger.info(f"Reading RDL lines from CalculationRules table for scenario: {scenario}")
    rdl_response = calculation_rules_table.get_item(
        Key={'scenario': scenario}
    )
    rdl_item = rdl_response.get('Item', {})
    rdl_lines = rdl_item.get('lines', [])

    if not rdl_lines:
        raise ValueError(f"No RDL lines found for scenario: {scenario}")

    # Read input validation rules from InputValidation table
    logger.info(f"Reading input validation rules from InputValidation table for scenario: {scenario}")
    input_response = input_validation_table.query(
        KeyConditionExpression='scenario = :scenario',
        ExpressionAttributeValues={
            ':scenario': scenario
        }
    )
    input_validation = input_response.get('Items', [])

    # Read custom functions from CustomFunctions table (paginate — scan caps at 1 MB/page)
    logger.info("Reading custom functions from CustomFunctions table")
    custom_functions = []
    scan_kwargs = {}
    while True:
        functions_response = custom_functions_table.scan(**scan_kwargs)
        custom_functions.extend(functions_response.get('Items', []))
        last_key = functions_response.get('LastEvaluatedKey')
        if not last_key:
            break
        scan_kwargs['ExclusiveStartKey'] = last_key

    bucket = os.environ['ARTIFACT_BUCKET']
    timestamp = int(time.time())

    # Log start of processing
    total_lines = len(rdl_lines)
    active_lines = sum(1 for line in rdl_lines if line.get('active', True))
    logger.info(f"Starting RDL to Rust generation for deployment {deployment_id}")
    logger.info(f"  Scenario: {scenario}")
    logger.info(f"  Total RDL lines: {total_lines}")
    logger.info(f"  Active RDL lines: {active_lines}")
    logger.info(f"  Input validation rules: {len(input_validation)}")
    logger.info(f"  Custom functions: {len(custom_functions)}")

    # Log custom function names
    for func in custom_functions:
        logger.info(f"    - {func.get('name', 'UNKNOWN')}")

    # Log RDL line details
    for i, line in enumerate(rdl_lines):
        status = "ACTIVE" if line.get('active', True) else "INACTIVE"
        code_preview = line.get('code', '')[:50]
        if len(line.get('code', '')) > 50:
            code_preview += '...'
        logger.info(f"  Line {i+1} [{status}]: {code_preview}")

    # Generate complete Rust code from DynamoDB data
    logger.info("Generating Rust code from DynamoDB data...")
    main_rs = generate_full_rust_code(rdl_lines, input_validation, custom_functions)

    # Log generated code stats
    total_rust_lines = main_rs.count('\n') + 1
    main_rs_size = len(main_rs.encode('utf-8'))
    logger.info(f"Rust code generation complete:")
    logger.info(f"  Total main.rs: {total_rust_lines} lines ({main_rs_size:,} bytes)")

    # Upload to S3 with timestamp for audit trail
    # Structure: SCENARIO/TIMESTAMP/source/rate_calculator and SCENARIO/TIMESTAMP/artifacts/
    s3_prefix = f'{scenario}/{timestamp}/source/rate_calculator'
    logger.info(f"Uploading to S3 bucket: {bucket}")
    logger.info(f"  S3 prefix: {s3_prefix}")

    s3.put_object(
        Bucket=bucket,
        Key=f'{s3_prefix}/src/main.rs',
        Body=main_rs.encode('utf-8')
    )
    logger.info(f"  Uploaded: {s3_prefix}/src/main.rs ({main_rs_size:,} bytes)")

    cargo_size = len(CARGO_TOML_TEMPLATE.encode('utf-8'))
    s3.put_object(
        Bucket=bucket,
        Key=f'{s3_prefix}/Cargo.toml',
        Body=CARGO_TOML_TEMPLATE.encode('utf-8')
    )
    logger.info(f"  Uploaded: {s3_prefix}/Cargo.toml ({cargo_size:,} bytes)")

    # CodeBuild requires at least one file at its S3 source path
    # Upload a placeholder to satisfy this requirement
    s3.put_object(
        Bucket=bucket,
        Key='buildspec/placeholder.txt',
        Body=b'CodeBuild source placeholder - actual code is downloaded from source/{scenario}/{timestamp}/'
    )
    logger.info("  Uploaded: buildspec/placeholder.txt")

    # Log summary
    logger.info("=" * 60)
    logger.info(f"RDL to Rust generation COMPLETE for {deployment_id}")
    logger.info(f"  Scenario: {scenario}")
    logger.info(f"  RDL lines processed: {active_lines} active / {total_lines} total")
    logger.info(f"  Rust code generated: {total_rust_lines} lines")
    logger.info(f"  Timestamp: {timestamp}")
    logger.info(f"  S3 location: s3://{bucket}/{s3_prefix}/")
    logger.info("=" * 60)

    # Return data for Step Functions to pass to CodeBuild
    return {
        'scenario': scenario,
        'deploymentId': deployment_id,
        'timestamp': str(timestamp),
        'stats': {
            'rdlLinesTotal': total_lines,
            'rdlLinesActive': active_lines,
            'inputValidationRules': len(input_validation),
            'rustLinesGenerated': total_rust_lines,
            'mainRsBytes': main_rs_size
        }
    }
