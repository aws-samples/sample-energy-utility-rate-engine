import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'path';

export class RateEngineStack extends cdk.Stack {
  public readonly apiEndpoint: string;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ===== DATABASE RESOURCES =====
    // Individual tables for each data type (easier for end users to understand and manage)

    // Scenarios table - stores scenario metadata
    const scenariosTable = new dynamodb.Table(this, 'ScenariosTable', {
      tableName: 'RateEngine-Scenarios',
      partitionKey: {
        name: 'name',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Calculation Rules table - stores RDL lines per scenario
    const calculationRulesTable = new dynamodb.Table(this, 'CalculationRulesTable', {
      tableName: 'RateEngine-CalculationRules',
      partitionKey: {
        name: 'scenario',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Custom Functions table - stores function definitions (read-only, seeded once)
    const customFunctionsTable = new dynamodb.Table(this, 'CustomFunctionsTable', {
      tableName: 'RateEngine-CustomFunctions',
      partitionKey: {
        name: 'name',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Factors table - stores rate factors with 5-key design
    const factorsTable = new dynamodb.Table(this, 'FactorsTable', {
      tableName: 'RateEngine-Factors',
      partitionKey: {
        name: 'scenario',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'factor_key',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Input Validation table - stores input validation rules per scenario
    const inputValidationTable = new dynamodb.Table(this, 'InputValidationTable', {
      tableName: 'RateEngine-InputValidation',
      partitionKey: {
        name: 'scenario',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'name',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Deployments table - stores deployment history
    const deploymentsTable = new dynamodb.Table(this, 'DeploymentsTable', {
      tableName: 'RateEngine-Deployments',
      partitionKey: {
        name: 'deploymentId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Test Payloads table - stores test calculation payloads per scenario
    const testPayloadsTable = new dynamodb.Table(this, 'TestPayloadsTable', {
      tableName: 'RateEngine-TestPayloads',
      partitionKey: {
        name: 'scenario',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'name',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ===== AUTHENTICATION RESOURCES =====
    // Create the Cognito User Pool with email-based authentication
    // Note: Using a new logical ID (UserPoolV2) to force recreation after deletion
    const userPool = new cognito.UserPool(this, 'UserPoolV2', {
      selfSignUpEnabled: false, // No self-registration as per requirements

      // Set a unique name to identify this user pool
      userPoolName: 'RateEngineUserPool-V2',

      // Use email as username - this is the correct property in CDK v2
      signInAliases: {
        email: true,
        username: false, // Explicitly disable username sign-in
      },

      autoVerify: {
        email: true, // Auto-verify email addresses
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      // Set to DESTROY to allow easy recreation during development
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a User Pool Client for the frontend application
    const userPoolClient = userPool.addClient('RateEngineWebClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      generateSecret: false, // No client secret for browser-based applications
    });

    // Create admin group
    const adminGroup = new cognito.CfnUserPoolGroup(this, 'AdminGroupV2', {
      userPoolId: userPool.userPoolId,
      groupName: 'Administrators',
      description: 'Group for rate engine administrators with full access',
    });

    // Create read-only group
    const readOnlyGroup = new cognito.CfnUserPoolGroup(this, 'ReadOnlyGroupV2', {
      userPoolId: userPool.userPoolId,
      groupName: 'ReadOnly',
      description: 'Group for users with read-only access',
    });

    // ===== API RESOURCES =====
    // Create a single Lambda function for all API routes
    const handler = new lambda.Function(this, 'RateEngineHandler', {
      functionName: 'RateEngine-ApiHandler',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/dist')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        SCENARIOS_TABLE: scenariosTable.tableName,
        CALCULATION_RULES_TABLE: calculationRulesTable.tableName,
        CUSTOM_FUNCTIONS_TABLE: customFunctionsTable.tableName,
        FACTORS_TABLE: factorsTable.tableName,
        INPUT_VALIDATION_TABLE: inputValidationTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        TEST_PAYLOADS_TABLE: testPayloadsTable.tableName,
      },
    });

    // Grant the Lambda function read/write permissions to all tables
    scenariosTable.grantReadWriteData(handler);
    calculationRulesTable.grantReadWriteData(handler);
    customFunctionsTable.grantReadData(handler); // Read-only for custom functions
    factorsTable.grantReadWriteData(handler);
    inputValidationTable.grantReadWriteData(handler);
    deploymentsTable.grantReadWriteData(handler);
    testPayloadsTable.grantReadWriteData(handler);

    // Create a separate Lambda for deployment operations to avoid resource policy size limits
    const deployHandler = new lambda.Function(this, 'DeployHandler', {
      functionName: 'RateEngine-DeployHandler',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/dist')),
      timeout: cdk.Duration.minutes(5), // Longer timeout for deployment operations
      memorySize: 512,
      environment: {
        SCENARIOS_TABLE: scenariosTable.tableName,
        CALCULATION_RULES_TABLE: calculationRulesTable.tableName,
        CUSTOM_FUNCTIONS_TABLE: customFunctionsTable.tableName,
        FACTORS_TABLE: factorsTable.tableName,
        INPUT_VALIDATION_TABLE: inputValidationTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
      },
    });

    // Grant deployment handler access to all tables
    scenariosTable.grantReadWriteData(deployHandler);
    calculationRulesTable.grantReadWriteData(deployHandler);
    customFunctionsTable.grantReadData(deployHandler);
    factorsTable.grantReadWriteData(deployHandler);
    inputValidationTable.grantReadWriteData(deployHandler);
    deploymentsTable.grantReadWriteData(deployHandler);

    // ===== DEPLOYMENT PIPELINE RESOURCES =====
    // S3 bucket for build artifacts
    const artifactBucket = new s3.Bucket(this, 'BuildArtifactBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          prefix: 'builds/',
        },
      ],
    });

    // CodeBuild project for Rust compilation
    // Note: SCENARIO, DEPLOYMENT_ID, SOURCE_TIMESTAMP are passed via environmentVariablesOverride at build start
    const rustBuildProject = new codebuild.Project(this, 'RustBuildProject', {
      projectName: 'RateEngineRustBuild',
      description: 'Compiles RDL-generated Rust code to Lambda deployment package',
      source: codebuild.Source.s3({
        bucket: artifactBucket,
        path: 'buildspec/', // Buildspec will download actual source from S3 dynamically
      }),
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: codebuild.ComputeType.MEDIUM, // 7GB RAM, 4 vCPUs - faster parallel compilation
        environmentVariables: {
          ARTIFACT_BUCKET: {
            value: artifactBucket.bucketName,
          },
          AWS_ACCOUNT_ID: {
            value: this.account,
          },
          FACTORS_TABLE: {
            value: factorsTable.tableName,
          },
          // Fixed paths for caching - CodeBuild cache requires consistent paths
          CARGO_HOME: {
            value: '/root/.cargo',
          },
          RUSTUP_HOME: {
            value: '/root/.rustup',
          },
          // Use fixed target directory for caching compiled dependencies
          CARGO_TARGET_DIR: {
            value: '/root/cargo-target',
          },
        },
      },
      // Enable S3 caching for Rust toolchain and dependencies
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: 'codebuild-cache',
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        env: {
          variables: {
            RUST_BACKTRACE: '1',
          },
        },
        phases: {
          install: {
            'runtime-versions': {
              python: '3.13',
            },
            commands: [
              // Only install Rust if not cached
              'if [ ! -f "$CARGO_HOME/bin/cargo" ]; then curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable; fi',
              'export PATH="$CARGO_HOME/bin:$PATH"',
              // Only install cargo-lambda if not cached
              'if ! command -v cargo-lambda &> /dev/null; then pip3 install cargo-lambda; fi',
            ],
          },
          build: {
            commands: [
              'export PATH="$CARGO_HOME/bin:$PATH"',
              'aws s3 sync s3://$ARTIFACT_BUCKET/$SCENARIO/$SOURCE_TIMESTAMP/source/rate_calculator/ ./rate_calculator/',
              'cd rate_calculator',
              // CARGO_TARGET_DIR env var tells cargo to use cached target directory
              'cargo lambda build --release --arm64',
              'cargo lambda deploy --binary-path $CARGO_TARGET_DIR/lambda/rate_calculator/bootstrap --iam-role arn:aws:iam::$AWS_ACCOUNT_ID:role/RateCalculatorExecutionRole --s3-bucket $ARTIFACT_BUCKET --s3-key $SCENARIO/$SOURCE_TIMESTAMP/artifacts/bootstrap.zip --description "Deployment $DEPLOYMENT_ID" --log-retention 30 --memory-size 2048 --timeout 600 --tag scenario=$SCENARIO --tag deployment=$DEPLOYMENT_ID --tag timestamp=$SOURCE_TIMESTAMP --env-var FACTORS_TABLE=$FACTORS_TABLE --env-var SCENARIO=$SCENARIO RateCalculator-$SCENARIO',
            ],
          },
          post_build: {
            commands: [
              'echo "Deployed Lambda: RateCalculator-$SCENARIO"',
            ],
          },
        },
        cache: {
          paths: [
            '/root/.cargo/**/*',
            '/root/.rustup/**/*',
            '/root/.local/**/*',  // pip installs cargo-lambda here
            '/root/cargo-target/**/*',  // Compiled dependencies - BIGGEST cache savings
          ],
        },
      }),
      timeout: cdk.Duration.minutes(30),
    });

    // Grant CodeBuild access to S3
    artifactBucket.grantReadWrite(rustBuildProject);

    // Create IAM role for the deploy orchestrator Lambda
    const deployOrchestratorRole = new iam.Role(this, 'DeployOrchestratorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant permissions to start CodeBuild, access S3, update Lambda, and read/write DynamoDB
    deployOrchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
      resources: [rustBuildProject.projectArn],
    }));

    deployOrchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${artifactBucket.bucketArn}/*`],
    }));

    deployOrchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'lambda:CreateFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:GetFunction',
        'lambda:InvokeFunction',
      ],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:RateCalculator-*`],
    }));

    deploymentsTable.grantReadWriteData(deployOrchestratorRole);

    // Add deployment-related environment variables to the deploy handler Lambda
    deployHandler.addEnvironment('ARTIFACT_BUCKET', artifactBucket.bucketName);
    deployHandler.addEnvironment('CODEBUILD_PROJECT', rustBuildProject.projectName);
    deployHandler.addEnvironment('AWS_REGION_NAME', this.region);

    // Create managed policy for deployment operations
    // Note: API Gateway permissions are added after api is created below
    const deploymentPolicy = new iam.ManagedPolicy(this, 'DeploymentPolicy', {
      managedPolicyName: 'RateEngineDeploymentPolicy',
      statements: [
        new iam.PolicyStatement({
          actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
          resources: [rustBuildProject.projectArn],
        }),
        new iam.PolicyStatement({
          actions: [
            'lambda:CreateFunction',
            'lambda:UpdateFunctionCode',
            'lambda:UpdateFunctionConfiguration',
            'lambda:GetFunction',
            'lambda:InvokeFunction',
            'lambda:AddPermission',
            'lambda:RemovePermission',
          ],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:RateCalculator-*`],
        }),
        new iam.PolicyStatement({
          actions: ['iam:PassRole'],
          resources: [`arn:aws:iam::${this.account}:role/RateCalculatorExecutionRole`],
        }),
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`${artifactBucket.bucketArn}/*`],
        }),
        new iam.PolicyStatement({
          actions: ['s3:ListBucket'],
          resources: [artifactBucket.bucketArn],
        }),
      ],
    });

    // Attach managed policy to deploy handler Lambda role
    deployHandler.role?.addManagedPolicy(deploymentPolicy);

    // Create execution role for dynamically created calculation Lambdas
    const calculatorExecutionRole = new iam.Role(this, 'RateCalculatorExecutionRole', {
      roleName: 'RateCalculatorExecutionRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant calculator Lambda read access to Factors table for rate data lookups
    factorsTable.grantReadData(calculatorExecutionRole);

    // Grant CodeBuild permission to pass the calculator role
    rustBuildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [calculatorExecutionRole.roleArn],
    }));

    // Grant CodeBuild permission to create/update Lambda functions (least privilege - no delete, no permission management)
    // Note: PublishVersion is required by cargo-lambda deploy (it publishes a version after creating/updating)
    rustBuildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'lambda:CreateFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:GetFunction',
        'lambda:GetFunctionConfiguration',
        'lambda:PublishVersion',
        'lambda:TagResource',
      ],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:RateCalculator-*`],
    }));

    // Grant CodeBuild permission to read Factors table
    factorsTable.grantReadData(rustBuildProject);

    // Grant CodeBuild permission to manage CloudWatch Logs for Lambda functions (required for --log-retention)
    rustBuildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:PutRetentionPolicy',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/RateCalculator-*`],
    }));

    // ===== STEP FUNCTIONS DEPLOYMENT PIPELINE =====
    // Lambda for RDL-to-Rust code generation (invoked by Step Functions)
    // Note: If deploying from a machine without Docker, pre-bundle dependencies first:
    //   pip install -r cdk/lambda/dsl-generator/requirements.txt -t cdk/lambda/dsl-generator-bundle
    //   cp cdk/lambda/dsl-generator/*.py cdk/lambda/dsl-generator-bundle/
    //   cp -r cdk/lambda/dsl-generator/templates cdk/lambda/dsl-generator-bundle/
    const rdlToRustGenerator = new lambda.Function(this, 'RdlToRustGenerator', {
      functionName: 'RateEngine-RdlToRustGenerator',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/dsl-generator'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_13.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output',
          ],
          local: {
            tryBundle(outputDir: string) {
              try {
                const { execSync } = require('child_process');
                execSync(`pip3 install -r ${path.join(__dirname, '../../lambda/dsl-generator/requirements.txt')} -t ${outputDir} --quiet`);
                execSync(`cp ${path.join(__dirname, '../../lambda/dsl-generator')}/*.py ${outputDir}/`);
                execSync(`cp -r ${path.join(__dirname, '../../lambda/dsl-generator/templates')} ${outputDir}/`);
                return true;
              } catch {
                return false;
              }
            },
          },
        },
      }),
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        ARTIFACT_BUCKET: artifactBucket.bucketName,
        CALCULATION_RULES_TABLE: calculationRulesTable.tableName,
        CUSTOM_FUNCTIONS_TABLE: customFunctionsTable.tableName,
        INPUT_VALIDATION_TABLE: inputValidationTable.tableName,
        DEPLOYMENTS_TABLE: deploymentsTable.tableName,
        CODEBUILD_PROJECT: rustBuildProject.projectName,
      },
    });

    // Grant RDL-to-Rust generator permissions
    artifactBucket.grantReadWrite(rdlToRustGenerator);
    calculationRulesTable.grantReadData(rdlToRustGenerator);
    customFunctionsTable.grantReadData(rdlToRustGenerator);
    inputValidationTable.grantReadData(rdlToRustGenerator);
    deploymentsTable.grantReadWriteData(rdlToRustGenerator);

    // Step 1: Update status to GENERATING
    const setGeneratingStatus = new tasks.DynamoUpdateItem(this, 'SetGeneratingStatus', {
      table: deploymentsTable,
      key: {
        deploymentId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.deploymentId')),
      },
      updateExpression: 'SET #status = :status, updatedAt = :ts',
      expressionAttributeNames: {
        '#status': 'status',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('GENERATING'),
        ':ts': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });

    // Step 2: Invoke RDL-to-Rust generator Lambda
    // Generator reads RDL lines and input validation directly from DynamoDB
    const generateRustCode = new tasks.LambdaInvoke(this, 'GenerateRustCode', {
      lambdaFunction: rdlToRustGenerator,
      payload: sfn.TaskInput.fromObject({
        scenario: sfn.JsonPath.stringAt('$.scenario'),
        deploymentId: sfn.JsonPath.stringAt('$.deploymentId'),
      }),
      resultPath: '$.generateResult',
    });

    // Step 3: Update status to BUILDING
    const setBuildingStatus = new tasks.DynamoUpdateItem(this, 'SetBuildingStatus', {
      table: deploymentsTable,
      key: {
        deploymentId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.deploymentId')),
      },
      updateExpression: 'SET #status = :status, updatedAt = :ts',
      expressionAttributeNames: {
        '#status': 'status',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('BUILDING'),
        ':ts': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });

    // Step 4: Start CodeBuild and wait for completion
    const startCodeBuild = new tasks.CodeBuildStartBuild(this, 'StartCodeBuild', {
      project: rustBuildProject,
      integrationPattern: sfn.IntegrationPattern.RUN_JOB, // Wait for build to complete
      environmentVariablesOverride: {
        SCENARIO: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: sfn.JsonPath.stringAt('$.scenario'),
        },
        DEPLOYMENT_ID: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: sfn.JsonPath.stringAt('$.deploymentId'),
        },
        SOURCE_TIMESTAMP: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: sfn.JsonPath.stringAt('$.generateResult.Payload.timestamp'),
        },
      },
      resultPath: '$.buildResult',
    });

    // Step 5: Update status to SUCCEEDED
    const setSucceededStatus = new tasks.DynamoUpdateItem(this, 'SetSucceededStatus', {
      table: deploymentsTable,
      key: {
        deploymentId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.deploymentId')),
      },
      updateExpression: 'SET #status = :status, updatedAt = :ts',
      expressionAttributeNames: {
        '#status': 'status',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('SUCCEEDED'),
        ':ts': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });

    // Error handler: Update status to FAILED
    const setFailedStatus = new tasks.DynamoUpdateItem(this, 'SetFailedStatus', {
      table: deploymentsTable,
      key: {
        deploymentId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.deploymentId')),
      },
      updateExpression: 'SET #status = :status, #error = :error, updatedAt = :ts',
      expressionAttributeNames: {
        '#status': 'status',
        '#error': 'error',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('FAILED'),
        ':error': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.error.Cause')),
        ':ts': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
    });

    // Step 5.5: Configure API Gateway (invoke rdlToRustGenerator with action='configureApiGateway')
    const configureApiGateway = new tasks.LambdaInvoke(this, 'ConfigureApiGateway', {
      lambdaFunction: rdlToRustGenerator,
      payload: sfn.TaskInput.fromObject({
        action: 'configureApiGateway',
        scenario: sfn.JsonPath.stringAt('$.scenario'),
        deploymentId: sfn.JsonPath.stringAt('$.deploymentId'),
      }),
      resultPath: '$.apiGatewayResult',
    });

    // Build the state machine chain
    const deploymentChain = setGeneratingStatus
      .next(generateRustCode)
      .next(setBuildingStatus)
      .next(startCodeBuild)
      .next(configureApiGateway)
      .next(setSucceededStatus);

    // Add error handling
    const definition = deploymentChain.toSingleState('DeploymentWorkflow', {
      resultPath: sfn.JsonPath.DISCARD,
    });

    definition.addCatch(setFailedStatus, {
      resultPath: '$.error',
    });

    // Create the Step Functions state machine
    const deploymentStateMachine = new sfn.StateMachine(this, 'DeploymentStateMachine', {
      stateMachineName: 'RateEngine-DeploymentPipeline',
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(45),
    });

    // Grant the deploy handler permission to start the state machine
    deploymentStateMachine.grantStartExecution(deployHandler);
    deployHandler.addEnvironment('STATE_MACHINE_ARN', deploymentStateMachine.stateMachineArn);

    // Create an authorizer using the Cognito User Pool
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'RateEngineAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // Create the API Gateway REST API
    const api = new apigateway.RestApi(this, 'RateEngineApi', {
      restApiName: 'Rate Engine API',
      description: 'API for the Rate Engine application',
      // SECURITY NOTE: For production, restrict allowOrigins to your CloudFront domain
      // e.g., allowOrigins: ['https://your-domain.cloudfront.net']
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.seconds(300),
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
      // Fix for the breaking change in RestApi with CognitoUserPoolsAuthorizer
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer
      }
    });

    // Define API resources
    const apiResource = api.root.addResource('api');

    // RDL endpoints - uses PUT/DELETE on base resource (no {id}) since all lines stored as single item
    const rdlResource = apiResource.addResource('rdl');
    this.addRdlRoutes(rdlResource, handler, authorizer);

    // Factors endpoints
    const factorsResource = apiResource.addResource('factors');
    factorsResource.addMethod('GET', new apigateway.LambdaIntegration(handler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const uploadResource = factorsResource.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(handler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    factorsResource.addMethod('DELETE', new apigateway.LambdaIntegration(handler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Scenarios endpoints
    const scenariosResource = apiResource.addResource('scenarios');
    this.addRoutes(scenariosResource, handler, authorizer);

    // Input validation endpoints
    const inputValidationResource = apiResource.addResource('input-validation');
    this.addRoutes(inputValidationResource, handler, authorizer);

    // Custom functions endpoints (read-only)
    const customFunctionsResource = apiResource.addResource('custom-functions');
    this.addReadOnlyRoutes(customFunctionsResource, handler, authorizer);

    // Test payloads endpoints
    const testPayloadsResource = apiResource.addResource('test-payloads');
    this.addRoutes(testPayloadsResource, handler, authorizer);

    // Deploy endpoints - deployment pipeline management (uses separate Lambda)
    const deployResource = apiResource.addResource('deploy');
    deployResource.addMethod('GET', new apigateway.LambdaIntegration(deployHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    deployResource.addMethod('POST', new apigateway.LambdaIntegration(deployHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    const deployIdResource = deployResource.addResource('{id}');
    deployIdResource.addMethod('GET', new apigateway.LambdaIntegration(deployHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Batch endpoints - batch file processing via S3 and Step Functions
    // Use deployHandler Lambda (which has fewer routes) to avoid policy size limit on main handler
    const batchResource = apiResource.addResource('batch');
    batchResource.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(deployHandler),
      anyMethod: true,
      defaultMethodOptions: {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      },
    });

    // Calculate endpoint - base resource for scenario-specific calculation Lambdas
    // Scenario-specific resources (e.g., /calculate/DEFAULT) are added dynamically during deployment
    // Each deployed scenario gets its own child resource that directly invokes its Rust Lambda
    const calculateResource = apiResource.addResource('calculate');

    // Add API Gateway management permissions to deployment policy
    // This allows the deployment process to create scenario-specific resources under /calculate
    deploymentPolicy.addStatements(new iam.PolicyStatement({
      actions: [
        'apigateway:GET',
        'apigateway:POST',
        'apigateway:PUT',
        'apigateway:DELETE',
        'apigateway:PATCH',
      ],
      resources: [
        `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/*`,
      ],
    }));

    // Add environment variables to deploy handler for API Gateway configuration
    deployHandler.addEnvironment('API_GATEWAY_ID', api.restApiId);
    deployHandler.addEnvironment('CALCULATE_RESOURCE_ID', calculateResource.resourceId);
    deployHandler.addEnvironment('AUTHORIZER_ID', authorizer.authorizerId);

    // Add rdlToRustGenerator environment variables for API Gateway integration step
    rdlToRustGenerator.addEnvironment('API_GATEWAY_ID', api.restApiId);
    rdlToRustGenerator.addEnvironment('CALCULATE_RESOURCE_ID', calculateResource.resourceId);
    rdlToRustGenerator.addEnvironment('AUTHORIZER_ID', authorizer.authorizerId);

    // Grant rdlToRustGenerator API Gateway management permissions
    rdlToRustGenerator.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'apigateway:GET',
        'apigateway:POST',
        'apigateway:PUT',
        'apigateway:DELETE',
        'apigateway:PATCH',
      ],
      resources: [
        `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/*`,
      ],
    }));

    // Grant rdlToRustGenerator permission to add Lambda invoke permissions
    rdlToRustGenerator.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:AddPermission', 'lambda:RemovePermission'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:RateCalculator-*`],
    }));

    // ===== BATCH PROCESSING INFRASTRUCTURE =====
    // S3 bucket for batch input/output files
    const batchBucket = new s3.Bucket(this, 'BatchBucket', {
      bucketName: `rate-engine-batch-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          prefix: 'input/',
        },
        {
          expiration: cdk.Duration.days(30),
          prefix: 'output/',
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // Grant calculator Lambda S3 access for batch processing
    // The dynamically deployed RateCalculator-* Lambda reads/writes directly from S3
    batchBucket.grantReadWrite(calculatorExecutionRole);

    // Lambda for batch chunk processing - reads chunk of JSONL, invokes calculation Lambda
    const batchProcessor = new lambda.Function(this, 'BatchProcessor', {
      functionName: 'RateEngine-BatchProcessor',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'batch_processor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/batch-processor')),
      timeout: cdk.Duration.minutes(10), // Longer timeout for processing chunks
      memorySize: 1024,
      environment: {
        BATCH_BUCKET: batchBucket.bucketName,
      },
    });

    // Grant batch processor permissions
    batchBucket.grantReadWrite(batchProcessor);
    batchProcessor.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:RateCalculator-*`],
    }));

    // Step Functions for batch processing workflow
    // Step 1: Initialize batch job - list files in input prefix
    const initBatchJob = new tasks.LambdaInvoke(this, 'InitBatchJob', {
      lambdaFunction: batchProcessor,
      payload: sfn.TaskInput.fromObject({
        action: 'init',
        scenario: sfn.JsonPath.stringAt('$.scenario'),
        inputPrefix: sfn.JsonPath.stringAt('$.inputPrefix'),
        override: sfn.JsonPath.objectAt('$.override'),
      }),
      resultPath: '$.initResult',
      resultSelector: {
        'batchId.$': '$.Payload.batchId',
        'scenario.$': '$.Payload.scenario',
        'outputPrefix.$': '$.Payload.outputPrefix',
        'fileCount.$': '$.Payload.fileCount',
        'files.$': '$.Payload.files',
        'startTime.$': '$.Payload.startTime',
        'override.$': '$.Payload.override',
      },
    });

    // Step 2: Process each file - invoke calculator Lambda directly with S3 input/output
    // Use CallAwsService for dynamic Lambda function name based on scenario
    const processFile = new tasks.CallAwsService(this, 'ProcessFile', {
      service: 'lambda',
      action: 'invoke',
      parameters: {
        'FunctionName.$': "States.Format('RateCalculator-{}', $.scenario)",
        'Payload.$': "States.JsonToString($)",
      },
      iamResources: [`arn:aws:lambda:${this.region}:${this.account}:function:RateCalculator-*`],
      resultSelector: {
        'response.$': 'States.StringToJson($.Payload)',
      },
      resultPath: '$.lambdaResult',
    });

    // Extract result from Lambda response for cleaner output
    const extractResult = new sfn.Pass(this, 'ExtractResult', {
      parameters: {
        'status.$': '$.lambdaResult.response.status',
        'recordsProcessed.$': '$.lambdaResult.response.recordsProcessed',
        'recordsSucceeded.$': '$.lambdaResult.response.recordsSucceeded',
        'recordsFailed.$': '$.lambdaResult.response.recordsFailed',
        's3Output.$': '$.lambdaResult.response.s3Output',
      },
    });

    // Map state to process files in parallel
    // Pass override through if present - it will be merged into each calculation input
    const processAllFiles = new sfn.Map(this, 'ProcessAllFiles', {
      itemsPath: '$.initResult.files',
      itemSelector: {
        'scenario.$': '$.initResult.scenario',
        's3Input.$': '$$.Map.Item.Value.s3Input',
        's3Output.$': '$$.Map.Item.Value.s3Output',
        'override.$': '$.initResult.override',
      },
      maxConcurrency: 10, // Process up to 10 files in parallel
      resultPath: '$.fileResults',
    });
    processAllFiles.itemProcessor(processFile.next(extractResult));

    // Step 3: Finalize batch job - aggregate results and create summary
    const finalizeBatchJob = new tasks.LambdaInvoke(this, 'FinalizeBatchJob', {
      lambdaFunction: batchProcessor,
      payload: sfn.TaskInput.fromObject({
        action: 'finalize',
        scenario: sfn.JsonPath.stringAt('$.initResult.scenario'),
        batchId: sfn.JsonPath.stringAt('$.initResult.batchId'),
        outputPrefix: sfn.JsonPath.stringAt('$.initResult.outputPrefix'),
        startTime: sfn.JsonPath.stringAt('$.initResult.startTime'),
        fileResults: sfn.JsonPath.listAt('$.fileResults'),
      }),
      resultPath: '$.finalResult',
    });

    // Build batch processing chain
    const batchChain = initBatchJob
      .next(processAllFiles)
      .next(finalizeBatchJob);

    // Create batch processing state machine
    const batchStateMachine = new sfn.StateMachine(this, 'BatchStateMachine', {
      stateMachineName: 'RateEngine-BatchProcessing',
      definitionBody: sfn.DefinitionBody.fromChainable(batchChain),
      timeout: cdk.Duration.hours(2), // Allow up to 2 hours for large batches
    });

    // Grant batch state machine permission to invoke calculator Lambda
    batchStateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:RateCalculator-*`],
    }));

    // Grant deploy handler permission to start batch state machine
    batchStateMachine.grantStartExecution(deployHandler);
    deployHandler.addEnvironment('BATCH_STATE_MACHINE_ARN', batchStateMachine.stateMachineArn);
    deployHandler.addEnvironment('BATCH_BUCKET', batchBucket.bucketName);
    batchBucket.grantReadWrite(deployHandler);

    // Grant handler permission to generate presigned URLs for batch uploads
    batchBucket.grantReadWrite(handler);
    handler.addEnvironment('BATCH_BUCKET', batchBucket.bucketName);
    handler.addEnvironment('BATCH_STATE_MACHINE_ARN', batchStateMachine.stateMachineArn);
    batchStateMachine.grantStartExecution(handler);
    // Allow the handler to detect terminally-failed batch executions for status reporting
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:DescribeExecution'],
      resources: [`arn:aws:states:${this.region}:${this.account}:execution:${batchStateMachine.stateMachineName}:*`],
    }));

    // Save the API endpoint URL
    this.apiEndpoint = api.url;

    // ===== HOSTING RESOURCES =====
    // Create an S3 bucket to store the static website content
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
    });

    // Create a CloudFront origin access identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: 'Allow CloudFront to access the website bucket',
    });

    // Grant read access to the origin access identity
    websiteBucket.grantRead(originAccessIdentity);

    // Store the API endpoint URL
    this.apiEndpoint = api.url;

    // CloudFront Function for SPA routing - rewrites non-file requests to index.html
    // This replaces errorResponses which interfered with API error handling
    const spaRoutingFunction = new cloudfront.Function(this, 'SpaRoutingFunction', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // If the URI has a file extension, pass through (static assets)
  if (uri.includes('.')) {
    return request;
  }

  // For all other requests (SPA routes), serve index.html
  request.uri = '/index.html';
  return request;
}
      `),
      comment: 'SPA routing - serves index.html for non-file requests',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // Create the CloudFront distribution
    // NOTE: errorResponses removed - they intercept API errors (403/404) and serve HTML instead of JSON
    // SPA routing is now handled by the CloudFront Function above
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(websiteBucket, {
          originAccessIdentity,
        }),
        compress: true,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{
          function: spaRoutingFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        // API routes - all frontend API calls use /api/* prefix
        '/api/*': {
          origin: new origins.HttpOrigin(`${api.restApiId}.execute-api.${this.region}.amazonaws.com`, {
            originPath: '/prod', // API Gateway stage name
          }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      // NOTE: This sample uses the default *.cloudfront.net certificate, whose TLS
      // policy is fixed by AWS (cfn_nag W70). To enforce a minimum of TLS 1.2, add a
      // custom domain + ACM certificate and set
      // `minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021`.
    });

    // ===== STACK OUTPUTS =====
    // Table outputs
    new cdk.CfnOutput(this, 'ScenariosTableName', {
      value: scenariosTable.tableName,
      description: 'The name of the Scenarios DynamoDB table',
      exportName: 'RateEngineScenariosTable',
    });

    new cdk.CfnOutput(this, 'CalculationRulesTableName', {
      value: calculationRulesTable.tableName,
      description: 'The name of the Calculation Rules DynamoDB table',
      exportName: 'RateEngineCalculationRulesTable',
    });

    new cdk.CfnOutput(this, 'CustomFunctionsTableName', {
      value: customFunctionsTable.tableName,
      description: 'The name of the Custom Functions DynamoDB table',
      exportName: 'RateEngineCustomFunctionsTable',
    });

    new cdk.CfnOutput(this, 'FactorsTableName', {
      value: factorsTable.tableName,
      description: 'The name of the Factors DynamoDB table',
      exportName: 'RateEngineFactorsTable',
    });

    new cdk.CfnOutput(this, 'InputValidationTableName', {
      value: inputValidationTable.tableName,
      description: 'The name of the Input Validation DynamoDB table',
      exportName: 'RateEngineInputValidationTable',
    });

    new cdk.CfnOutput(this, 'DeploymentsTableName', {
      value: deploymentsTable.tableName,
      description: 'The name of the Deployments DynamoDB table',
      exportName: 'RateEngineDeploymentsTable',
    });

    new cdk.CfnOutput(this, 'TestPayloadsTableName', {
      value: testPayloadsTable.tableName,
      description: 'The name of the Test Payloads DynamoDB table',
      exportName: 'RateEngineTestPayloadsTable',
    });

    // Auth outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'The ID of the Cognito User Pool',
      exportName: 'RateEngineUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'The ID of the Cognito User Pool Client',
      exportName: 'RateEngineUserPoolClientId',
    });

    // API output
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'The endpoint URL of the API Gateway',
      exportName: 'RateEngineApiEndpoint',
    });

    // Distribution output
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'The URL of the CloudFront distribution',
      exportName: 'RateEngineDistributionUrl',
    });

    // Bucket output
    new cdk.CfnOutput(this, 'BucketName', {
      value: websiteBucket.bucketName,
      description: 'The name of the S3 bucket',
      exportName: 'RateEngineBucketName',
    });

    // Distribution ID output
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'The ID of the CloudFront distribution',
      exportName: 'RateEngineDistributionId',
    });

    // Artifact bucket output
    new cdk.CfnOutput(this, 'ArtifactBucketName', {
      value: artifactBucket.bucketName,
      description: 'The name of the build artifact S3 bucket',
      exportName: 'RateEngineArtifactBucket',
    });

    // CodeBuild project output
    new cdk.CfnOutput(this, 'CodeBuildProjectName', {
      value: rustBuildProject.projectName,
      description: 'The name of the CodeBuild project',
      exportName: 'RateEngineCodeBuildProject',
    });

    // Deployment state machine output
    new cdk.CfnOutput(this, 'DeploymentStateMachineArn', {
      value: deploymentStateMachine.stateMachineArn,
      description: 'The ARN of the deployment Step Functions state machine',
      exportName: 'RateEngineDeploymentStateMachineArn',
    });

    // RDL-to-Rust generator Lambda output
    new cdk.CfnOutput(this, 'RdlToRustGeneratorArn', {
      value: rdlToRustGenerator.functionArn,
      description: 'The ARN of the RDL-to-Rust generator Lambda',
      exportName: 'RateEngineRdlToRustGeneratorArn',
    });

    // Batch processing outputs
    new cdk.CfnOutput(this, 'BatchBucketName', {
      value: batchBucket.bucketName,
      description: 'The name of the batch processing S3 bucket',
      exportName: 'RateEngineBatchBucket',
    });

    new cdk.CfnOutput(this, 'BatchStateMachineArn', {
      value: batchStateMachine.stateMachineArn,
      description: 'The ARN of the batch processing Step Functions state machine',
      exportName: 'RateEngineBatchStateMachineArn',
    });

  }

  // Helper method to add standard CRUD routes to a resource
  private addRoutes(
    resource: apigateway.Resource,
    handler: lambda.Function,
    authorizer: apigateway.CognitoUserPoolsAuthorizer
  ) {
    const authOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // GET method for listing items
    resource.addMethod('GET', new apigateway.LambdaIntegration(handler), authOptions);

    // POST method for creating items
    resource.addMethod('POST', new apigateway.LambdaIntegration(handler), authOptions);

    // Add item-specific resource with PUT/DELETE methods
    const itemResource = resource.addResource('{id}');

    // GET method for retrieving a specific item
    itemResource.addMethod('GET', new apigateway.LambdaIntegration(handler), authOptions);

    // PUT method for updating a specific item
    itemResource.addMethod('PUT', new apigateway.LambdaIntegration(handler), authOptions);

    // DELETE method for removing a specific item
    itemResource.addMethod('DELETE', new apigateway.LambdaIntegration(handler), authOptions);
  }

  // Helper method for read-only routes (GET only)
  private addReadOnlyRoutes(
    resource: apigateway.Resource,
    handler: lambda.Function,
    authorizer: apigateway.CognitoUserPoolsAuthorizer
  ) {
    const authOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // GET method for listing items
    resource.addMethod('GET', new apigateway.LambdaIntegration(handler), authOptions);

    // Add item-specific resource with GET method only
    const itemResource = resource.addResource('{id}');
    itemResource.addMethod('GET', new apigateway.LambdaIntegration(handler), authOptions);
  }

  // Helper method for RDL routes - PUT/DELETE on base resource since all lines stored as single item
  private addRdlRoutes(
    resource: apigateway.Resource,
    handler: lambda.Function,
    authorizer: apigateway.CognitoUserPoolsAuthorizer
  ) {
    const authOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // GET method for retrieving all RDL lines for a scenario
    resource.addMethod('GET', new apigateway.LambdaIntegration(handler), authOptions);

    // PUT method for saving all RDL lines for a scenario
    resource.addMethod('PUT', new apigateway.LambdaIntegration(handler), authOptions);

    // DELETE method for removing all RDL lines for a scenario
    resource.addMethod('DELETE', new apigateway.LambdaIntegration(handler), authOptions);
  }
}