#!/usr/bin/env node
import * as cdk from "@aws-cdk/core";
import { DseqrAwsStack } from "../lib/dseqr-aws-stack";
import { DseqrAwsStackASG } from "../lib/dseqr-aws-stack-asg";

const app = new cdk.App();
new DseqrAwsStackASG(app, "DseqrAwsStackASG", { env: { region: "us-east-2" } });
