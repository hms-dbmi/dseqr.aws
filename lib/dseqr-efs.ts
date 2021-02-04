import * as ec2 from "@aws-cdk/aws-ec2";
import * as cdk from "@aws-cdk/core";
import * as efs from "@aws-cdk/aws-efs";

interface DseqrEfsProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class DseqrEfsStack extends cdk.Stack {
  public readonly fileSystem: efs.IFileSystem;
  constructor(scope: cdk.App, id: string, props: DseqrEfsProps) {
    super(scope, id, props);

    let { vpc } = props;

    // user configurable parameters (e.g. cdk deploy -c instance_type="r5.large")
    const keepEFS = this.node.tryGetContext("keep_efs") || true;
    const fileSystemId = this.node.tryGetContext("efs_id");
    const EFSSecurityGroupId = this.node.tryGetContext("efs_sg_id");

    // both efs is and efs security group id or neither
    if (
      (!fileSystemId && EFSSecurityGroupId) ||
      (fileSystemId && !EFSSecurityGroupId)
    ) {
      throw "must provide both efs_id and efs_sg_id to use existing EFS";
    }

    // are we keeping EFS on cdk destroy? default is TRUE
    const removalPolicy = keepEFS
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // script that is run on startup

    // EFS setup (existing or new)
    let fileSystem;
    if (fileSystemId && EFSSecurityGroupId) {
      // import existing EFS
      fileSystem = efs.FileSystem.fromFileSystemAttributes(this, "EFS", {
        fileSystemId: "sdfs",
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "EFSSecurityGroup",
          EFSSecurityGroupId
        ),
      });
    } else {
      // new EFS to share between instances
      fileSystem = new efs.FileSystem(this, "EFS", {
        vpc,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS, // transition to infrequent access
        removalPolicy,
      });
      fileSystem.addAccessPoint("AcessPoint");
    }

    fileSystem.connections.allowDefaultPortFromAnyIpv4();

    this.fileSystem = fileSystem;
  }
}
