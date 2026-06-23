import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { RateEngineStack } from '../lib/stacks/rate-engine-stack';

// Synthesize once. Disable asset bundling so synth is fast and does not run
// the Lambda bundlers (pip install, etc.) during tests.
function synth() {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new RateEngineStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return app.synth().getStackByName('TestStack').template;
}

const template = synth();

function resources(type: string): any[] {
  return Object.values(template.Resources ?? {}).filter((r: any) => r.Type === type);
}

// Flatten every IAM policy statement across IAM::Policy and inline Role policies.
function allPolicyStatements(): any[] {
  const out: any[] = [];
  const add = (doc: any) => {
    if (!doc?.Statement) return;
    const s = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
    out.push(...s);
  };
  for (const r of resources('AWS::IAM::Policy')) add(r.Properties?.PolicyDocument);
  for (const r of resources('AWS::IAM::Role')) {
    for (const p of r.Properties?.Policies ?? []) add(p.PolicyDocument);
  }
  return out;
}

describe('RateEngineStack — data stores', () => {
  it('creates exactly 7 DynamoDB tables', () => {
    expect(resources('AWS::DynamoDB::Table').length).toBe(7);
  });

  it('uses on-demand (PAY_PER_REQUEST) billing for every table', () => {
    for (const t of resources('AWS::DynamoDB::Table')) {
      expect(t.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    }
  });

  it('retains every table on stack deletion (DeletionPolicy: Retain)', () => {
    for (const t of resources('AWS::DynamoDB::Table')) {
      expect(t.DeletionPolicy).toBe('Retain');
    }
  });

  it('enables point-in-time recovery on the core data tables', () => {
    const coreTables = [
      'RateEngine-Scenarios',
      'RateEngine-CalculationRules',
      'RateEngine-Factors',
    ];
    for (const name of coreTables) {
      const t = resources('AWS::DynamoDB::Table').find(
        (r) => r.Properties.TableName === name,
      );
      expect(t, `table ${name} present`).toBeDefined();
      expect(
        t.Properties.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled,
        `PITR on ${name}`,
      ).toBe(true);
    }
  });
});

describe('RateEngineStack — authentication', () => {
  it('provisions a Cognito user pool', () => {
    expect(resources('AWS::Cognito::UserPool').length).toBeGreaterThanOrEqual(1);
  });

  it('disables self sign-up (admin-only user creation)', () => {
    const pools = resources('AWS::Cognito::UserPool');
    for (const p of pools) {
      expect(
        p.Properties.AdminCreateUserConfig?.AllowAdminCreateUserOnly,
      ).toBe(true);
    }
  });
});

describe('RateEngineStack — deployment pipeline', () => {
  it('provisions CodeBuild, Step Functions, CloudFront, and API Gateway', () => {
    expect(resources('AWS::CodeBuild::Project').length).toBeGreaterThanOrEqual(1);
    expect(resources('AWS::StepFunctions::StateMachine').length).toBeGreaterThanOrEqual(1);
    expect(resources('AWS::CloudFront::Distribution').length).toBeGreaterThanOrEqual(1);
    expect(resources('AWS::ApiGateway::RestApi').length).toBeGreaterThanOrEqual(1);
  });
});

describe('RateEngineStack — IAM least privilege', () => {
  // Service-level action wildcards on mutating services are the classic
  // least-privilege red flag the security review prohibits.
  const BANNED_ACTIONS = ['*', 'iam:*', 'lambda:*', 'dynamodb:*', 's3:*', 'sts:*'];

  it('grants no service-level wildcard actions', () => {
    const offending: string[] = [];
    for (const st of allPolicyStatements()) {
      if (st.Effect !== 'Allow') continue;
      const actions = Array.isArray(st.Action) ? st.Action : [st.Action];
      for (const a of actions) {
        if (typeof a === 'string' && BANNED_ACTIONS.includes(a)) offending.push(a);
      }
    }
    expect(offending).toEqual([]);
  });

  it('scopes iam:PassRole to a specific role (never "*")', () => {
    for (const st of allPolicyStatements()) {
      if (st.Effect !== 'Allow') continue;
      const actions = Array.isArray(st.Action) ? st.Action : [st.Action];
      if (!actions.includes('iam:PassRole')) continue;
      const res = Array.isArray(st.Resource) ? st.Resource : [st.Resource];
      for (const r of res) {
        expect(r).not.toBe('*');
      }
    }
  });
});
