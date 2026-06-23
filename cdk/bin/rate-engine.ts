#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RateEngineStack } from '../lib/stacks/rate-engine-stack';

const app = new cdk.App();

// Define environment
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
};

// Deploy the unified stack
const stack = new RateEngineStack(app, 'RateEngineStack', { env });

// Add tags to all resources
cdk.Tags.of(app).add('project', 'rate-engine');
cdk.Tags.of(app).add('environment', 'dev');