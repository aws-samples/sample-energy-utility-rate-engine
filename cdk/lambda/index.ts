import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, DeleteCommand, BatchWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Initialize other AWS clients
const sfnClient = new SFNClient({});
const s3Client = new S3Client({});

// Table names for each data type
const SCENARIOS_TABLE = process.env.SCENARIOS_TABLE || 'RateEngine-Scenarios';
const CALCULATION_RULES_TABLE = process.env.CALCULATION_RULES_TABLE || 'RateEngine-CalculationRules';
const CUSTOM_FUNCTIONS_TABLE = process.env.CUSTOM_FUNCTIONS_TABLE || 'RateEngine-CustomFunctions';
const FACTORS_TABLE = process.env.FACTORS_TABLE || 'RateEngine-Factors';
const INPUT_VALIDATION_TABLE = process.env.INPUT_VALIDATION_TABLE || 'RateEngine-InputValidation';
const DEPLOYMENTS_TABLE = process.env.DEPLOYMENTS_TABLE || 'RateEngine-Deployments';
const TEST_PAYLOADS_TABLE = process.env.TEST_PAYLOADS_TABLE || 'RateEngine-TestPayloads';

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN || '';
const BATCH_STATE_MACHINE_ARN = process.env.BATCH_STATE_MACHINE_ARN || '';
const BATCH_BUCKET = process.env.BATCH_BUCKET || '';
const AWS_REGION_NAME = process.env.AWS_REGION_NAME || process.env.AWS_REGION || 'us-east-1';

// Helper function for API responses
const createResponse = (statusCode: number, body: any): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify(body),
  };
};

// Helper function for error responses
const createErrorResponse = (statusCode: number, message: string): APIGatewayProxyResult => {
  return createResponse(statusCode, { error: message });
};

// Helper function to get user email from Cognito authorizer
const getUserEmail = (event: APIGatewayProxyEvent): string => {
  // Trust only the Cognito authorizer's verified claims. The API Gateway
  // authorizer validates the JWT signature before this handler runs, so the
  // claims are authoritative; never decode the raw token ourselves (that would
  // trust an unverified signature).
  const claims = event.requestContext?.authorizer?.claims;
  return claims?.email ?? 'system';
};

// Returns true if the batch's Step Functions execution has terminally failed.
// The execution is started with name === batchId, so its ARN is derivable from
// the state machine ARN (arn:...:stateMachine:Name -> arn:...:execution:Name:batchId).
const isBatchExecutionFailed = async (batchId: string): Promise<boolean> => {
  if (!BATCH_STATE_MACHINE_ARN) return false;
  const machineName = BATCH_STATE_MACHINE_ARN.split(':').pop();
  const executionArn = BATCH_STATE_MACHINE_ARN
    .replace(':stateMachine:', ':execution:')
    .replace(`:${machineName}`, `:${machineName}:${batchId}`);
  try {
    const { status } = await sfnClient.send(new DescribeExecutionCommand({ executionArn }));
    return status === 'FAILED' || status === 'TIMED_OUT' || status === 'ABORTED';
  } catch {
    return false;
  }
};

// RDL Line interface for type safety
interface RdlLine {
  id: string;
  order: number;
  code: string;
}

// Handle RDL-related requests
// RDL lines are stored as a single DynamoDB item per scenario with all lines in a JSON array
// This avoids the reordering complexity of having separate items per line
const handleRdl = async (event: APIGatewayProxyEvent, docClient: DynamoDBDocumentClient): Promise<APIGatewayProxyResult> => {
  const { httpMethod, body, queryStringParameters } = event;
  const userEmail = getUserEmail(event);

  try {
    // GET /api/rdl - Get all RDL lines for a scenario (single item)
    if (httpMethod === 'GET') {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      const result = await docClient.send(new GetCommand({
        TableName: CALCULATION_RULES_TABLE,
        Key: { scenario }
      }));

      if (!result.Item) {
        // Return empty lines array if no RDL exists for this scenario
        return createResponse(200, {
          scenario,
          lines: [],
          createdAt: null,
          updatedAt: null
        });
      }

      return createResponse(200, {
        scenario: result.Item.scenario,
        lines: result.Item.lines || [],
        createdAt: result.Item.createdAt,
        updatedAt: result.Item.updatedAt
      });
    }

    // PUT /api/rdl - Save all RDL lines for a scenario (replaces entire set)
    if (httpMethod === 'PUT') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { scenario, lines } = data;

      if (!scenario) {
        return createErrorResponse(400, 'Missing required field: scenario');
      }

      if (!Array.isArray(lines)) {
        return createErrorResponse(400, 'Lines must be an array');
      }

      // Validate and normalize lines
      const normalizedLines: RdlLine[] = lines.map((line: RdlLine, index: number) => ({
        id: line.id || `rdl${index + 1}`,
        order: line.order !== undefined ? line.order : index + 1,
        code: line.code || ''
      }));

      // Sort by order
      normalizedLines.sort((a, b) => a.order - b.order);

      const timestamp = new Date().toISOString();

      // Check if item exists to preserve createdAt
      const existingResult = await docClient.send(new GetCommand({
        TableName: CALCULATION_RULES_TABLE,
        Key: { scenario }
      }));

      const rdlItem = {
        scenario,
        lines: normalizedLines,
        createdAt: existingResult.Item?.createdAt || timestamp,
        createdBy: existingResult.Item?.createdBy || userEmail,
        updatedAt: timestamp,
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: CALCULATION_RULES_TABLE,
        Item: rdlItem
      }));

      return createResponse(200, {
        scenario: rdlItem.scenario,
        lines: rdlItem.lines,
        createdAt: rdlItem.createdAt,
        updatedAt: rdlItem.updatedAt
      });
    }

    // DELETE /api/rdl - Delete all RDL lines for a scenario
    if (httpMethod === 'DELETE') {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      await docClient.send(new DeleteCommand({
        TableName: CALCULATION_RULES_TABLE,
        Key: { scenario }
      }));

      return createResponse(200, { message: `RDL for scenario ${scenario} deleted successfully` });
    }

    return createErrorResponse(400, 'Invalid request');
  } catch (error) {
    console.error('Error in RDL handler:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};

// Factor interface
interface Factor {
  key1: string;
  key2?: string;
  key3?: string;
  key4?: string;
  key5?: string;
  value: number;
  start_date: string;
  end_date: string;
}

// Helper function to validate date format (YYYY-MM-DD)
const isValidDateFormat = (date: string): boolean => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(date)) return false;
  const d = new Date(date);
  return d instanceof Date && !isNaN(d.getTime());
};

// Helper function to check date range overlap
const hasDateOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
  const s1 = new Date(start1);
  const e1 = new Date(end1);
  const s2 = new Date(start2);
  const e2 = new Date(end2);

  return s1 <= e2 && s2 <= e1;
};

// Helper function to build factor_key (SK) from factor keys
// Format: non-empty keys joined by # + start_date at end
// This allows multiple date ranges for the same key combination
const buildFactorKey = (factor: Factor): string => {
  const parts = [factor.key1, factor.key2, factor.key3, factor.key4, factor.key5]
    .filter(k => k && k.trim() !== '');
  return `${parts.join('#')}#${factor.start_date}`;
};

// Handle Factors-related requests
const handleFactors = async (event: APIGatewayProxyEvent, docClient: DynamoDBDocumentClient): Promise<APIGatewayProxyResult> => {
  const { httpMethod, body, queryStringParameters } = event;
  const userEmail = getUserEmail(event);

  try {
    // GET /api/factors - List all factors for a scenario
    if (httpMethod === 'GET') {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      const result = await docClient.send(new QueryCommand({
        TableName: FACTORS_TABLE,
        KeyConditionExpression: 'scenario = :scenario',
        ExpressionAttributeValues: {
          ':scenario': scenario
        }
      }));

      // Transform items: use factor_key as id
      const factors = (result.Items || []).map(item => {
        const { scenario: _, factor_key, ...rest } = item;
        return { ...rest, id: factor_key };
      });

      return createResponse(200, { factors });
    }

    // POST /api/factors/upload - Bulk upsert factors from array
    if (httpMethod === 'POST') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { scenario, factors, replaceAll } = data;

      if (!scenario) {
        return createErrorResponse(400, 'Missing required field: scenario');
      }

      if (!Array.isArray(factors)) {
        return createErrorResponse(400, 'Factors must be an array');
      }

      // If replaceAll is true, delete all existing factors first
      if (replaceAll) {
        const existingResult = await docClient.send(new QueryCommand({
          TableName: FACTORS_TABLE,
          KeyConditionExpression: 'scenario = :scenario',
          ExpressionAttributeValues: {
            ':scenario': scenario
          }
        }));

        const existingFactors = existingResult.Items || [];

        if (existingFactors.length > 0) {
          // Delete in batches of 25
          const batchSize = 25;
          for (let i = 0; i < existingFactors.length; i += batchSize) {
            const batch = existingFactors.slice(i, i + batchSize);
            const deleteRequests = batch.map(item => ({
              DeleteRequest: {
                Key: {
                  scenario: item.scenario,
                  factor_key: item.factor_key
                }
              }
            }));

            await docClient.send(new BatchWriteCommand({
              RequestItems: {
                [FACTORS_TABLE]: deleteRequests
              }
            }));
          }
        }
      }

      // Validate all factors
      for (const factor of factors) {
        if (!factor.key1) {
          return createErrorResponse(400, 'Each factor must have key1');
        }

        if (typeof factor.value !== 'number') {
          return createErrorResponse(400, 'Factor value must be a number');
        }

        if (!factor.start_date || !isValidDateFormat(factor.start_date)) {
          return createErrorResponse(400, 'Factor start_date must be in YYYY-MM-DD format');
        }

        if (!factor.end_date || !isValidDateFormat(factor.end_date)) {
          return createErrorResponse(400, 'Factor end_date must be in YYYY-MM-DD format');
        }
      }

      // Check for overlapping date ranges within the same key combination
      const keyGroups: { [key: string]: Factor[] } = {};

      for (const factor of factors) {
        const keyCombo = `${factor.key1}#${factor.key2 || ''}#${factor.key3 || ''}#${factor.key4 || ''}#${factor.key5 || ''}`;
        if (!keyGroups[keyCombo]) {
          keyGroups[keyCombo] = [];
        }
        keyGroups[keyCombo].push(factor);
      }

      // Check for overlaps within each key group
      for (const [keyCombo, groupFactors] of Object.entries(keyGroups)) {
        for (let i = 0; i < groupFactors.length; i++) {
          for (let j = i + 1; j < groupFactors.length; j++) {
            if (hasDateOverlap(
              groupFactors[i].start_date,
              groupFactors[i].end_date,
              groupFactors[j].start_date,
              groupFactors[j].end_date
            )) {
              return createErrorResponse(400, `Date range overlap detected for keys: ${keyCombo}`);
            }
          }
        }
      }

      // Check for overlaps with existing factors in database (skip if replaceAll since we deleted them)
      if (!replaceAll) {
        const existingResult = await docClient.send(new QueryCommand({
          TableName: FACTORS_TABLE,
          KeyConditionExpression: 'scenario = :scenario',
          ExpressionAttributeValues: {
            ':scenario': scenario
          }
        }));

        const existingFactors = existingResult.Items || [];

        for (const factor of factors) {
          const keyCombo = `${factor.key1}#${factor.key2 || ''}#${factor.key3 || ''}#${factor.key4 || ''}#${factor.key5 || ''}`;

          for (const existing of existingFactors) {
            const existingKeyCombo = `${existing.key1}#${existing.key2 || ''}#${existing.key3 || ''}#${existing.key4 || ''}#${existing.key5 || ''}`;

            if (keyCombo === existingKeyCombo) {
              // Check if this is the same item (same start_date) - allow updating existing
              if (existing.start_date === factor.start_date) {
                continue;
              }

              // Check for overlap with different date ranges
              if (hasDateOverlap(
                factor.start_date,
                factor.end_date,
                existing.start_date,
                existing.end_date
              )) {
                return createErrorResponse(400, `Date range overlap with existing factor for keys: ${keyCombo}`);
              }
            }
          }
        }
      }

      // Use BatchWriteItem for bulk upsert (25 items per batch)
      const timestamp = new Date().toISOString();
      const batchSize = 25;
      const batches: Factor[][] = [];

      for (let i = 0; i < factors.length; i += batchSize) {
        batches.push(factors.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const writeRequests = batch.map(factor => ({
          PutRequest: {
            Item: {
              scenario,
              factor_key: buildFactorKey(factor),
              key1: factor.key1,
              key2: factor.key2 || '',
              key3: factor.key3 || '',
              key4: factor.key4 || '',
              key5: factor.key5 || '',
              value: factor.value,
              start_date: factor.start_date,
              end_date: factor.end_date,
              createdAt: timestamp,
              createdBy: userEmail,
              updatedAt: timestamp,
              updatedBy: userEmail
            }
          }
        }));

        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [FACTORS_TABLE]: writeRequests
          }
        }));
      }

      return createResponse(200, {
        message: `Successfully uploaded ${factors.length} factors`,
        count: factors.length
      });
    }

    // DELETE /api/factors - Delete all factors for a scenario
    if (httpMethod === 'DELETE') {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      // Query all factors for the scenario
      const result = await docClient.send(new QueryCommand({
        TableName: FACTORS_TABLE,
        KeyConditionExpression: 'scenario = :scenario',
        ExpressionAttributeValues: {
          ':scenario': scenario
        }
      }));

      const factors = result.Items || [];

      if (factors.length === 0) {
        return createResponse(200, { message: 'No factors to delete', count: 0 });
      }

      // Delete in batches of 25
      const batchSize = 25;
      const batches: any[][] = [];

      for (let i = 0; i < factors.length; i += batchSize) {
        batches.push(factors.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const deleteRequests = batch.map(item => ({
          DeleteRequest: {
            Key: {
              scenario: item.scenario,
              factor_key: item.factor_key
            }
          }
        }));

        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [FACTORS_TABLE]: deleteRequests
          }
        }));
      }

      return createResponse(200, {
        message: `Successfully deleted ${factors.length} factors for scenario ${scenario}`,
        count: factors.length
      });
    }

    return createErrorResponse(400, 'Invalid request');
  } catch (error) {
    console.error('Error in Factors handler:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};

// Handle Scenarios-related requests
const handleScenarios = async (event: APIGatewayProxyEvent, docClient: DynamoDBDocumentClient): Promise<APIGatewayProxyResult> => {
  const { httpMethod, pathParameters, body } = event;
  const id = pathParameters?.id;
  const userEmail = getUserEmail(event);

  try {
    // GET /api/scenarios - List all scenarios
    if (httpMethod === 'GET' && !id) {
      const result = await docClient.send(new ScanCommand({
        TableName: SCENARIOS_TABLE
      }));

      const scenarios = (result.Items || []).map(item => ({
        ...item,
        id: item.name
      }));

      return createResponse(200, { scenarios });
    }

    // GET /api/scenarios/{id} - Get a specific scenario
    if (httpMethod === 'GET' && id) {
      const result = await docClient.send(new GetCommand({
        TableName: SCENARIOS_TABLE,
        Key: { name: id }
      }));

      if (!result.Item) {
        return createErrorResponse(404, 'Scenario not found');
      }

      return createResponse(200, { ...result.Item, id: result.Item.name });
    }

    // POST /api/scenarios - Create a new scenario
    if (httpMethod === 'POST') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { name, description, isDefault, copyFrom } = data;

      if (!name) {
        return createErrorResponse(400, 'Scenario name is required');
      }

      const timestamp = new Date().toISOString();
      const scenario = {
        name,
        description: description || '',
        isDefault: isDefault || false,
        createdAt: timestamp,
        createdBy: userEmail,
        updatedAt: timestamp,
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: SCENARIOS_TABLE,
        Item: scenario,
        ConditionExpression: 'attribute_not_exists(#name)',
        ExpressionAttributeNames: { '#name': 'name' }
      }));

      // If copyFrom is specified, copy data from the source scenario
      if (copyFrom) {
        try {
          // Copy calculation rules (RDL)
          const rdlResult = await docClient.send(new GetCommand({
            TableName: CALCULATION_RULES_TABLE,
            Key: { scenario: copyFrom }
          }));

          if (rdlResult.Item && rdlResult.Item.lines) {
            await docClient.send(new PutCommand({
              TableName: CALCULATION_RULES_TABLE,
              Item: {
                scenario: name,
                lines: rdlResult.Item.lines,
                createdAt: timestamp,
                createdBy: userEmail,
                updatedAt: timestamp,
                updatedBy: userEmail
              }
            }));
          }

          // Copy input validation rules
          const inputValidationResult = await docClient.send(new QueryCommand({
            TableName: INPUT_VALIDATION_TABLE,
            KeyConditionExpression: 'scenario = :scenario',
            ExpressionAttributeValues: { ':scenario': copyFrom }
          }));

          if (inputValidationResult.Items && inputValidationResult.Items.length > 0) {
            // Batch write in chunks of 25
            const items = inputValidationResult.Items;
            for (let i = 0; i < items.length; i += 25) {
              const batch = items.slice(i, i + 25);
              const writeRequests = batch.map(item => ({
                PutRequest: {
                  Item: {
                    ...item,
                    scenario: name,
                    createdAt: timestamp,
                    createdBy: userEmail,
                    updatedAt: timestamp,
                    updatedBy: userEmail
                  }
                }
              }));

              await docClient.send(new BatchWriteCommand({
                RequestItems: {
                  [INPUT_VALIDATION_TABLE]: writeRequests
                }
              }));
            }
          }

          // Copy factors
          const factorsResult = await docClient.send(new QueryCommand({
            TableName: FACTORS_TABLE,
            KeyConditionExpression: 'scenario = :scenario',
            ExpressionAttributeValues: { ':scenario': copyFrom }
          }));

          if (factorsResult.Items && factorsResult.Items.length > 0) {
            // Batch write in chunks of 25
            const items = factorsResult.Items;
            for (let i = 0; i < items.length; i += 25) {
              const batch = items.slice(i, i + 25);
              const writeRequests = batch.map(item => ({
                PutRequest: {
                  Item: {
                    ...item,
                    scenario: name,
                    createdAt: timestamp,
                    createdBy: userEmail,
                    updatedAt: timestamp,
                    updatedBy: userEmail
                  }
                }
              }));

              await docClient.send(new BatchWriteCommand({
                RequestItems: {
                  [FACTORS_TABLE]: writeRequests
                }
              }));
            }
          }
        } catch (copyError) {
          console.error('Error copying scenario data:', copyError);
          // Don't fail the scenario creation, just log the error
        }
      }

      return createResponse(201, { ...scenario, id: name });
    }

    // PUT /api/scenarios/{id} - Update a specific scenario
    if (httpMethod === 'PUT' && id) {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { description, isDefault } = data;

      const getResult = await docClient.send(new GetCommand({
        TableName: SCENARIOS_TABLE,
        Key: { name: id }
      }));

      if (!getResult.Item) {
        return createErrorResponse(404, 'Scenario not found');
      }

      const updatedScenario = {
        ...getResult.Item,
        name: id,
        description: description !== undefined ? description : getResult.Item.description,
        isDefault: isDefault !== undefined ? isDefault : getResult.Item.isDefault,
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: SCENARIOS_TABLE,
        Item: updatedScenario
      }));

      return createResponse(200, { ...updatedScenario, id });
    }

    // DELETE /api/scenarios/{id} - Delete a specific scenario
    if (httpMethod === 'DELETE' && id) {
      await docClient.send(new DeleteCommand({
        TableName: SCENARIOS_TABLE,
        Key: { name: id }
      }));

      return createResponse(200, { message: `Scenario ${id} deleted successfully` });
    }

    return createErrorResponse(400, 'Invalid request');
  } catch (error) {
    console.error('Error in Scenarios handler:', error);
    if ((error as any).name === 'ConditionalCheckFailedException') {
      return createErrorResponse(409, 'Scenario already exists');
    }
    return createErrorResponse(500, 'Internal server error');
  }
};

// Handle InputValidation-related requests
const handleInputValidation = async (event: APIGatewayProxyEvent, docClient: DynamoDBDocumentClient): Promise<APIGatewayProxyResult> => {
  const { httpMethod, pathParameters, body, queryStringParameters } = event;
  const id = pathParameters?.id;
  const userEmail = getUserEmail(event);

  try {
    // GET /api/input-validation - List all input validation rules
    if (httpMethod === 'GET' && !id) {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      const result = await docClient.send(new QueryCommand({
        TableName: INPUT_VALIDATION_TABLE,
        KeyConditionExpression: 'scenario = :scenario',
        ExpressionAttributeValues: {
          ':scenario': scenario
        }
      }));

      const inputs = (result.Items || []).map(item => ({
        ...item,
        id: item.name
      }));

      return createResponse(200, { inputs });
    }

    // GET /api/input-validation/{id} - Get a specific input validation rule
    if (httpMethod === 'GET' && id) {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      const result = await docClient.send(new GetCommand({
        TableName: INPUT_VALIDATION_TABLE,
        Key: { scenario, name: id }
      }));

      if (!result.Item) {
        return createErrorResponse(404, 'Input validation rule not found');
      }

      return createResponse(200, { ...result.Item, id: result.Item.name });
    }

    // POST /api/input-validation - Create a new input validation rule
    if (httpMethod === 'POST') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { name, required, dataType, description, scenario } = data;

      if (!name || !dataType) {
        return createErrorResponse(400, 'Missing required fields: name, dataType');
      }

      const scenarioName = scenario || 'DEFAULT';
      const timestamp = new Date().toISOString();

      const inputRule = {
        scenario: scenarioName,
        name,
        required: required !== undefined ? required : false,
        dataType,
        description: description || '',
        createdAt: timestamp,
        createdBy: userEmail,
        updatedAt: timestamp,
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: INPUT_VALIDATION_TABLE,
        Item: inputRule
      }));

      return createResponse(201, { ...inputRule, id: name });
    }

    // PUT /api/input-validation/{id} - Update a specific input validation rule
    if (httpMethod === 'PUT' && id) {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { required, dataType, description, scenario } = data;
      const scenarioName = scenario || 'DEFAULT';

      const getResult = await docClient.send(new GetCommand({
        TableName: INPUT_VALIDATION_TABLE,
        Key: { scenario: scenarioName, name: id }
      }));

      if (!getResult.Item) {
        return createErrorResponse(404, 'Input validation rule not found');
      }

      const updatedRule = {
        ...getResult.Item,
        scenario: scenarioName,
        name: id,
        required: required !== undefined ? required : getResult.Item.required,
        dataType: dataType !== undefined ? dataType : getResult.Item.dataType,
        description: description !== undefined ? description : getResult.Item.description,
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: INPUT_VALIDATION_TABLE,
        Item: updatedRule
      }));

      return createResponse(200, { ...updatedRule, id });
    }

    // DELETE /api/input-validation/{id} - Delete a specific input validation rule
    if (httpMethod === 'DELETE' && id) {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      await docClient.send(new DeleteCommand({
        TableName: INPUT_VALIDATION_TABLE,
        Key: {
          scenario,
          name: id
        }
      }));

      return createResponse(200, { message: `Input validation rule ${id} deleted successfully` });
    }

    return createErrorResponse(400, 'Invalid request');
  } catch (error) {
    console.error('Error in InputValidation handler:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};

// Handle Custom Functions requests (read-only)
const handleCustomFunctions = async (event: APIGatewayProxyEvent, docClient: DynamoDBDocumentClient): Promise<APIGatewayProxyResult> => {
  const { httpMethod, pathParameters } = event;
  const id = pathParameters?.id;

  try {
    // GET /api/custom-functions - List all custom functions
    if (httpMethod === 'GET' && !id) {
      const result = await docClient.send(new ScanCommand({
        TableName: CUSTOM_FUNCTIONS_TABLE
      }));

      const functions = (result.Items || []).map(item => ({
        ...item,
        id: item.name
      }));

      return createResponse(200, { functions });
    }

    // GET /api/custom-functions/{id} - Get a specific custom function
    if (httpMethod === 'GET' && id) {
      const result = await docClient.send(new GetCommand({
        TableName: CUSTOM_FUNCTIONS_TABLE,
        Key: {
          name: id
        }
      }));

      if (!result.Item) {
        return createErrorResponse(404, 'Custom function not found');
      }

      return createResponse(200, { ...result.Item, id: result.Item.name });
    }

    // Only GET is allowed - custom functions are read-only
    return createErrorResponse(405, 'Method not allowed. Custom functions are read-only.');
  } catch (error) {
    console.error('Error in CustomFunctions handler:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};

// Handle Test Payloads requests
const handleTestPayloads = async (event: APIGatewayProxyEvent, docClient: DynamoDBDocumentClient): Promise<APIGatewayProxyResult> => {
  const { httpMethod, pathParameters, body, queryStringParameters } = event;
  const id = pathParameters?.id;
  const userEmail = getUserEmail(event);

  try {
    // GET /api/test-payloads - List all test payloads for a scenario
    if (httpMethod === 'GET' && !id) {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';

      const result = await docClient.send(new QueryCommand({
        TableName: TEST_PAYLOADS_TABLE,
        KeyConditionExpression: 'scenario = :scenario',
        ExpressionAttributeValues: {
          ':scenario': scenario
        }
      }));

      const payloads = (result.Items || []).map(item => ({
        ...item,
        id: item.name
      }));

      return createResponse(200, { payloads });
    }

    // GET /api/test-payloads/{id} - Get a specific test payload
    if (httpMethod === 'GET' && id) {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';
      const decodedId = decodeURIComponent(id);

      const result = await docClient.send(new GetCommand({
        TableName: TEST_PAYLOADS_TABLE,
        Key: { scenario, name: decodedId }
      }));

      if (!result.Item) {
        return createErrorResponse(404, 'Test payload not found');
      }

      return createResponse(200, { ...result.Item, id: result.Item.name });
    }

    // POST /api/test-payloads - Create a new test payload
    if (httpMethod === 'POST') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { name, payload, scenario } = data;

      if (!name || !payload) {
        return createErrorResponse(400, 'Missing required fields: name, payload');
      }

      const scenarioName = scenario || 'DEFAULT';
      const timestamp = new Date().toISOString();

      const testPayload = {
        scenario: scenarioName,
        name,
        payload, // JSON array of test inputs
        createdAt: timestamp,
        createdBy: userEmail,
        updatedAt: timestamp,
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: TEST_PAYLOADS_TABLE,
        Item: testPayload
      }));

      return createResponse(201, { ...testPayload, id: name });
    }

    // PUT /api/test-payloads/{id} - Update a specific test payload
    if (httpMethod === 'PUT' && id) {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { payload, scenario } = data;
      const scenarioName = scenario || 'DEFAULT';

      // Decode the URL-encoded id (API Gateway doesn't auto-decode path params)
      const decodedId = decodeURIComponent(id);

      const getResult = await docClient.send(new GetCommand({
        TableName: TEST_PAYLOADS_TABLE,
        Key: { scenario: scenarioName, name: decodedId }
      }));

      if (!getResult.Item) {
        return createErrorResponse(404, 'Test payload not found');
      }

      const updatedPayload = {
        ...getResult.Item,
        scenario: scenarioName,
        name: decodedId,
        payload: payload !== undefined ? payload : getResult.Item.payload,
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: TEST_PAYLOADS_TABLE,
        Item: updatedPayload
      }));

      return createResponse(200, { ...updatedPayload, id: decodedId });
    }

    // DELETE /api/test-payloads/{id} - Delete a specific test payload
    if (httpMethod === 'DELETE' && id) {
      const scenario = queryStringParameters?.scenario || 'DEFAULT';
      const decodedId = decodeURIComponent(id);

      await docClient.send(new DeleteCommand({
        TableName: TEST_PAYLOADS_TABLE,
        Key: {
          scenario,
          name: decodedId
        }
      }));

      return createResponse(200, { message: `Test payload ${decodedId} deleted successfully` });
    }

    return createErrorResponse(400, 'Invalid request');
  } catch (error) {
    console.error('Error in TestPayloads handler:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};

// Deployment status interface
interface DeploymentRecord {
  deploymentId: string;
  scenario: string;
  status: 'PENDING' | 'GENERATING' | 'BUILDING' | 'DEPLOYING' | 'SUCCEEDED' | 'FAILED';
  buildId?: string;
  lambdaArn?: string;
  error?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

// Handle Deploy-related requests
const handleDeploy = async (event: APIGatewayProxyEvent, docClient: DynamoDBDocumentClient): Promise<APIGatewayProxyResult> => {
  const { httpMethod, pathParameters, body } = event;
  const id = pathParameters?.id;
  const userEmail = getUserEmail(event);

  try {
    // GET /api/deploy/{id} - Get deployment status (reads directly from DynamoDB)
    // Status updates are handled by the Python Lambda and CodeBuild pipeline
    if (httpMethod === 'GET' && id) {
      const result = await docClient.send(new GetCommand({
        TableName: DEPLOYMENTS_TABLE,
        Key: {
          deploymentId: id
        }
      }));

      if (!result.Item) {
        return createErrorResponse(404, 'Deployment not found');
      }

      return createResponse(200, { ...result.Item, id: result.Item.deploymentId });
    }

    // GET /api/deploy?scenario=XXX - List deployments for a scenario
    if (httpMethod === 'GET' && !id) {
      const queryParams = event.queryStringParameters || {};
      const scenario = queryParams.scenario;

      if (!scenario) {
        return createErrorResponse(400, 'Missing required query parameter: scenario');
      }

      const result = await docClient.send(new ScanCommand({
        TableName: DEPLOYMENTS_TABLE,
        FilterExpression: 'scenario = :scenario',
        ExpressionAttributeValues: {
          ':scenario': scenario
        }
      }));

      // Sort by createdAt descending (most recent first)
      const deployments = (result.Items || []).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return createResponse(200, { deployments });
    }

    // POST /api/deploy - Start a new deployment
    // Creates deployment record and starts Step Functions execution
    if (httpMethod === 'POST') {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { scenario } = data;

      if (!scenario) {
        return createErrorResponse(400, 'Missing required field: scenario');
      }

      // Check if required environment variables are set
      if (!STATE_MACHINE_ARN) {
        return createErrorResponse(500, 'Deployment infrastructure not configured');
      }

      // Verify RDL exists for the scenario (generator will read full data from DynamoDB)
      const rdlResult = await docClient.send(new GetCommand({
        TableName: CALCULATION_RULES_TABLE,
        Key: {
          scenario
        }
      }));

      if (!rdlResult.Item || !rdlResult.Item.lines || rdlResult.Item.lines.length === 0) {
        return createErrorResponse(400, 'No RDL lines found for this scenario');
      }

      // Create deployment record with PENDING status
      const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = new Date().toISOString();

      const deploymentRecord: DeploymentRecord = {
        deploymentId,
        scenario,
        status: 'PENDING',
        createdAt: timestamp,
        createdBy: userEmail,
        updatedAt: timestamp,
        updatedBy: userEmail
      };

      await docClient.send(new PutCommand({
        TableName: DEPLOYMENTS_TABLE,
        Item: deploymentRecord
      }));

      // Start Step Functions execution for deployment pipeline
      // Only pass scenario and deploymentId - generator reads RDL/input validation from DynamoDB
      try {
        await sfnClient.send(new StartExecutionCommand({
          stateMachineArn: STATE_MACHINE_ARN,
          name: deploymentId,
          input: JSON.stringify({
            scenario,
            deploymentId
          })
        }));
      } catch (sfnError) {
        console.error('Error starting Step Functions execution:', sfnError);

        // Update deployment status to FAILED
        deploymentRecord.status = 'FAILED';
        deploymentRecord.error = 'Failed to start deployment pipeline';
        deploymentRecord.updatedAt = new Date().toISOString();
        deploymentRecord.updatedBy = userEmail;

        await docClient.send(new PutCommand({
          TableName: DEPLOYMENTS_TABLE,
          Item: deploymentRecord
        }));

        return createErrorResponse(500, 'Failed to start deployment');
      }

      return createResponse(202, {
        id: deploymentId,
        deploymentId,
        scenario,
        status: deploymentRecord.status,
        message: 'Deployment started'
      });
    }

    return createErrorResponse(400, 'Invalid request');
  } catch (error) {
    console.error('Error in Deploy handler:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};

// Handle Batch-related requests
const handleBatch = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { httpMethod, pathParameters, body, queryStringParameters } = event;
  const pathParts = event.path.split('/');
  // For proxy routes like /api/batch/{id}/status, extract batch ID from path
  // Path format: /api/batch/{batchId}/action or /api/batch/action
  const batchIndex = pathParts.indexOf('batch');
  const batchId = pathParameters?.id || (batchIndex >= 0 && pathParts.length > batchIndex + 1 ? pathParts[batchIndex + 1] : '');

  try {
    // POST /api/batch/upload-url - Get presigned URL for uploading a JSONL file
    if (httpMethod === 'POST' && event.path.includes('/upload-url')) {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { scenario, filename } = data;

      if (!scenario || !filename) {
        return createErrorResponse(400, 'Missing required fields: scenario, filename');
      }

      if (!BATCH_BUCKET) {
        return createErrorResponse(500, 'Batch processing not configured');
      }

      // Generate unique batch ID for this upload
      const batchJobId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const inputKey = `input/${batchJobId}/${filename}`;

      // Generate presigned PUT URL (valid for 5 minutes)
      const putCommand = new PutObjectCommand({
        Bucket: BATCH_BUCKET,
        Key: inputKey,
        ContentType: 'application/x-ndjson',
      });

      const uploadUrl = await getSignedUrl(s3Client, putCommand, { expiresIn: 300 });

      return createResponse(200, {
        uploadUrl,
        batchId: batchJobId,
        inputPrefix: `input/${batchJobId}/`,
        bucket: BATCH_BUCKET,
      });
    }

    // POST /api/batch/start - Start batch processing
    if (httpMethod === 'POST' && event.path.includes('/start')) {
      if (!body) {
        return createErrorResponse(400, 'Request body is required');
      }

      const data = JSON.parse(body);
      const { scenario, batchId: jobBatchId, override } = data;

      if (!scenario || !jobBatchId) {
        return createErrorResponse(400, 'Missing required fields: scenario, batchId');
      }

      if (!BATCH_STATE_MACHINE_ARN) {
        return createErrorResponse(500, 'Batch processing not configured');
      }

      // Start Step Functions execution
      // Always include override (default to empty object) - will be merged into each calculation input
      try {
        const sfnInput: Record<string, unknown> = {
          scenario,
          inputPrefix: `input/${jobBatchId}/`,
          override: (override && typeof override === 'object') ? override : {},
        };

        await sfnClient.send(new StartExecutionCommand({
          stateMachineArn: BATCH_STATE_MACHINE_ARN,
          name: jobBatchId,
          input: JSON.stringify(sfnInput),
        }));

        return createResponse(202, {
          batchId: jobBatchId,
          scenario,
          status: 'PROCESSING',
          message: 'Batch processing started',
          override: override || null,
        });
      } catch (sfnError) {
        console.error('Error starting batch execution:', sfnError);
        return createErrorResponse(500, 'Failed to start batch processing');
      }
    }

    // GET /api/batch/{batchId}/status - Get batch status from S3 summary
    if (httpMethod === 'GET' && event.path.includes('/status')) {
      const scenario = queryStringParameters?.scenario;

      if (!scenario) {
        return createErrorResponse(400, 'Missing required query parameter: scenario');
      }

      if (!BATCH_BUCKET) {
        return createErrorResponse(500, 'Batch processing not configured');
      }

      // List output prefixes to find the batch result
      // Output format: output/{scenario}/{timestamp}-{batchId}/summary.json
      try {
        const listCommand = new ListObjectsV2Command({
          Bucket: BATCH_BUCKET,
          Prefix: `output/${scenario}/`,
          Delimiter: '/',
        });

        const listResult = await s3Client.send(listCommand);
        const prefixes = listResult.CommonPrefixes || [];

        // Find the prefix containing our batchId
        const matchingPrefix = prefixes.find(p => p.Prefix?.includes(batchId));

        if (!matchingPrefix) {
          // Batch not complete yet - check if input files exist
          const inputCheck = await s3Client.send(new ListObjectsV2Command({
            Bucket: BATCH_BUCKET,
            Prefix: `input/${batchId}/`,
            MaxKeys: 1,
          }));

          if (inputCheck.Contents && inputCheck.Contents.length > 0) {
            const failed = await isBatchExecutionFailed(batchId);
            return createResponse(200, {
              batchId,
              scenario,
              status: failed ? 'FAILED' : 'PROCESSING',
              message: failed ? 'Batch processing failed' : 'Batch is still processing',
            });
          }

          return createErrorResponse(404, 'Batch not found');
        }

        // Try to get the summary file
        const summaryKey = `${matchingPrefix.Prefix}summary.json`;
        const getCommand = new GetObjectCommand({
          Bucket: BATCH_BUCKET,
          Key: summaryKey,
        });

        const summaryResult = await s3Client.send(getCommand);
        const summaryBody = await summaryResult.Body?.transformToString();

        if (!summaryBody) {
          const failed = await isBatchExecutionFailed(batchId);
          return createResponse(200, {
            batchId,
            scenario,
            status: failed ? 'FAILED' : 'PROCESSING',
            message: failed ? 'Batch processing failed' : 'Batch results being finalized',
          });
        }

        const summary = JSON.parse(summaryBody);
        return createResponse(200, {
          batchId,
          scenario,
          status: 'COMPLETED',
          ...summary,
          outputPrefix: matchingPrefix.Prefix,
        });
      } catch (err: any) {
        if (err.name === 'NoSuchKey') {
          const failed = await isBatchExecutionFailed(batchId);
          return createResponse(200, {
            batchId,
            scenario,
            status: failed ? 'FAILED' : 'PROCESSING',
            message: failed ? 'Batch processing failed' : 'Batch is still processing',
          });
        }
        throw err;
      }
    }

    // GET /api/batch/{batchId}/download-url - Get presigned download URL for results
    if (httpMethod === 'GET' && event.path.includes('/download-url')) {
      const scenario = queryStringParameters?.scenario;
      const filename = queryStringParameters?.filename;

      if (!scenario) {
        return createErrorResponse(400, 'Missing required query parameter: scenario');
      }

      if (!BATCH_BUCKET) {
        return createErrorResponse(500, 'Batch processing not configured');
      }

      // Find the output prefix for this batch
      const listCommand = new ListObjectsV2Command({
        Bucket: BATCH_BUCKET,
        Prefix: `output/${scenario}/`,
        Delimiter: '/',
      });

      const listResult = await s3Client.send(listCommand);
      const prefixes = listResult.CommonPrefixes || [];
      const matchingPrefix = prefixes.find(p => p.Prefix?.includes(batchId));

      if (!matchingPrefix) {
        return createErrorResponse(404, 'Batch results not found');
      }

      // If specific filename requested, download that; otherwise download summary
      const fileKey = filename
        ? `${matchingPrefix.Prefix}${filename}`
        : `${matchingPrefix.Prefix}summary.json`;

      // Generate presigned GET URL (valid for 15 minutes)
      const getCommand = new GetObjectCommand({
        Bucket: BATCH_BUCKET,
        Key: fileKey,
      });

      const downloadUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 900 });

      // Also list all output files for the batch
      const filesCommand = new ListObjectsV2Command({
        Bucket: BATCH_BUCKET,
        Prefix: matchingPrefix.Prefix,
      });

      const filesResult = await s3Client.send(filesCommand);
      const files = (filesResult.Contents || []).map(f => ({
        key: f.Key?.split('/').pop(),
        size: f.Size,
      }));

      return createResponse(200, {
        downloadUrl,
        filename: fileKey.split('/').pop(),
        files,
      });
    }

    return createErrorResponse(400, 'Invalid batch request');
  } catch (error) {
    console.error('Error in Batch handler:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};

// Main Lambda handler
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event));

  const { path, httpMethod } = event;

  try {
    // Extract original path from CloudFront if needed
    // When CloudFront routes /scenarios to /prod/api/scenarios, we need to handle both patterns
    const pathLower = path.toLowerCase();

    // Route based on path prefix, supporting both direct API calls and CloudFront routed paths
    if (pathLower.includes('/rdl') || pathLower.includes('/api/rdl')) {
      return handleRdl(event, docClient);
    }
    if (pathLower.includes('/factors') || pathLower.includes('/api/factors')) {
      return handleFactors(event, docClient);
    }
    if (pathLower.includes('/scenarios') || pathLower.includes('/api/scenarios')) {
      return handleScenarios(event, docClient);
    }
    if (pathLower.includes('/input-validation') || pathLower.includes('/api/input-validation')) {
      return handleInputValidation(event, docClient);
    }
    if (pathLower.includes('/custom-functions') || pathLower.includes('/api/custom-functions')) {
      return handleCustomFunctions(event, docClient);
    }
    if (pathLower.includes('/test-payloads') || pathLower.includes('/api/test-payloads')) {
      return handleTestPayloads(event, docClient);
    }
    if (pathLower.includes('/deploy') || pathLower.includes('/api/deploy')) {
      return handleDeploy(event, docClient);
    }
    if (pathLower.includes('/batch') || pathLower.includes('/api/batch')) {
      return handleBatch(event);
    }
    // Note: /calculate/{scenario} routes are handled directly by scenario-specific Lambdas
    // configured during deployment (see rdlToRustGenerator's configureApiGateway action)

    return createErrorResponse(404, 'Route not found');
  } catch (error) {
    console.error('Handler error:', error);
    return createErrorResponse(500, 'Internal server error');
  }
};