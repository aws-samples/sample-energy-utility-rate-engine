import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { handler } from '../index';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Minimal API Gateway proxy event factory.
function event(overrides: Record<string, any> = {}): any {
  return {
    path: '/api/unknown',
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: null,
    pathParameters: null,
    body: null,
    requestContext: {},
    ...overrides,
  };
}

beforeEach(() => ddbMock.reset());

describe('API handler — routing', () => {
  it('returns 404 for an unknown route', async () => {
    const res = await handler(event({ path: '/api/does-not-exist' }));
    expect(res.statusCode).toBe(404);
  });
});

describe('API handler — custom functions (read-only)', () => {
  it('GET lists custom functions with rustCode and name->id', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ name: 'GET_SEASON', rustCode: 'fn get_season() {}', signature: 'GET_SEASON(date)' }],
    });
    const res = await handler(event({ path: '/api/custom-functions', httpMethod: 'GET' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.functions).toHaveLength(1);
    expect(body.functions[0].id).toBe('GET_SEASON');
    expect(body.functions[0].rustCode).toContain('get_season');
  });

  it('GET by id returns a single function', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { name: 'GET_SEASON', rustCode: 'fn get_season() {}' },
    });
    const res = await handler(
      event({
        path: '/api/custom-functions/GET_SEASON',
        httpMethod: 'GET',
        pathParameters: { id: 'GET_SEASON' },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toBe('GET_SEASON');
  });

  it('returns 404 when a function id is not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(
      event({
        path: '/api/custom-functions/NOPE',
        httpMethod: 'GET',
        pathParameters: { id: 'NOPE' },
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it('rejects writes with 405 (custom functions are read-only)', async () => {
    const res = await handler(
      event({ path: '/api/custom-functions', httpMethod: 'POST', body: '{}' }),
    );
    expect(res.statusCode).toBe(405);
  });
});

describe('API handler — factors', () => {
  it('GET returns factors for a scenario and strips the partition key', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          scenario: 'DEFAULT',
          factor_key: 'RES#CUSTOMER_CHARGE#2025-01-01',
          key1: 'RES',
          value: 10,
        },
      ],
    });
    const res = await handler(
      event({
        path: '/api/factors',
        httpMethod: 'GET',
        queryStringParameters: { scenario: 'DEFAULT' },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.factors).toHaveLength(1);
    expect(body.factors[0].id).toBe('RES#CUSTOMER_CHARGE#2025-01-01');
    expect(body.factors[0].scenario).toBeUndefined();
    expect(body.factors[0].value).toBe(10);
  });

  it('POST rejects a missing scenario with 400', async () => {
    const res = await handler(
      event({
        path: '/api/factors',
        httpMethod: 'POST',
        body: JSON.stringify({ factors: [] }),
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('POST rejects a non-array factors payload with 400', async () => {
    const res = await handler(
      event({
        path: '/api/factors',
        httpMethod: 'POST',
        body: JSON.stringify({ scenario: 'DEFAULT', factors: 'not-an-array' }),
      }),
    );
    expect(res.statusCode).toBe(400);
  });
});
