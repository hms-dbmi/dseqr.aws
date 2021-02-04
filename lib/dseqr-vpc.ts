import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";

export class DseqrVpcStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "VPC", { natGateways: 0 });
  }
}
