#!/usr/bin/env node
import * as cdk from "@aws-cdk/core";
import { DseqrZoneStack } from "../lib/dseqr-zone";
import { DseqrSpotStack } from "../lib/dseqr-spot";
import { DseqrAsgStack } from "../lib/dseqr-asg";
import { DseqrCognitoStack } from "../lib/dseqr-cognito";
import { DseqrEfsStack } from "../lib/dseqr-efs";
import { DseqrVpcStack } from "../lib/dseqr-vpc";

const app = new cdk.App();
const env = { region: "us-east-2" };

// stacks for auto scaling group setup
const zoneStack = new DseqrZoneStack(app, "DseqrZoneStack", {
  env,
});
const VpcStack = new DseqrVpcStack(app, "VpcStack", { env });

const EfsStack = new DseqrEfsStack(app, "DseqrEfsStack", {
  vpc: VpcStack.vpc,
  env,
});

const cognitoStack = new DseqrCognitoStack(app, "DseqrCognitoStack", {
  env,
});

new DseqrAsgStack(app, "DseqrAsgStack", {
  zone: zoneStack.zone,
  certificate: zoneStack.certificate,
  vpc: VpcStack.vpc,
  userPool: cognitoStack.userPool,
  userPoolClient: cognitoStack.userPoolClient,
  userPoolClientSecret: cognitoStack.userPoolClientSecret,
  fileSystem: EfsStack.fileSystem,
  env,
});

// stacks for spot setup
new DseqrSpotStack(app, "DseqrSpotStack", {
  fileSystem: EfsStack.fileSystem,
  vpc: VpcStack.vpc,
  env,
});
