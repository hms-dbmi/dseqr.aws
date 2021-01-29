#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { DseqrAwsStack } from '../lib/dseqr-aws-stack';

const app = new cdk.App();
new DseqrAwsStack(app, 'DseqrAwsStack');
