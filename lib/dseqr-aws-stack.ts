import * as ec2 from "@aws-cdk/aws-ec2";
import * as cdk from "@aws-cdk/core";
import * as spotone from "cdk-spot-one";
import * as fs from "fs";
import * as route53 from "@aws-cdk/aws-route53";

export class DseqrAwsStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // user configurable parameters (e.g. cdk deploy -c instance_type="r5.large")
    const instanceType =
      this.node.tryGetContext("instance_type") || "r5.xlarge";
    const volumeSize = this.node.tryGetContext("volume_size") || 50;
    const keyName = this.node.tryGetContext("ssh_key_name");
    const zoneName = this.node.tryGetContext("domain_name");
    const hostedZoneId = this.node.tryGetContext("zone_id");
    const spot_block_duration = spotone.BlockDuration.NONE;
    const vpc = spotone.VpcProvider.getOrCreate(this);

    // check for ssh key
    if (typeof keyName == "undefined") {
      throw "ssh_key_name not provided";
    }

    // both zone name and id or neither
    if ((!zoneName && hostedZoneId) || (zoneName && !hostedZoneId)) {
      throw "must provide both domain_name and zone_id or neither";
    }

    // script that is run on startup
    let additionalUserData = [fs.readFileSync("lib/configure.sh", "utf8")];

    // allow HTTP, HTTPS, and SSH
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
    });

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow inbound HTTPS"
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow inbound HTTP"
    );

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "Allow inbound SSH"
    );

    // create custom elastic ip so that can also associate with domain
    const eip = new ec2.CfnEIP(this, "EIP");

    // associate elastic ip with domain if provided
    if (typeof zoneName != "undefined" && typeof hostedZoneId != "undefined") {
      const zone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        {
          zoneName,
          hostedZoneId,
        }
      );

      new route53.ARecord(this, "ARecord", {
        zone: zone,
        target: route53.RecordTarget.fromIpAddresses(eip.ref),
      });

      // also replace drugseqr.com in userdata
      const regex = new RegExp(zoneName, "g");
      additionalUserData[0] = additionalUserData[0].replace(regex, "g");
    }

    // launch one spot instance
    const fleet = new spotone.SpotFleet(this, "SpotFleet", {
      vpc,
      blockDuration: spot_block_duration,
      eipAllocationId: eip.attrAllocationId,
      defaultInstanceType: new ec2.InstanceType(instanceType),
      keyName,
      customAmiId: "ami-0dd9f0e7df0f0a138",
      additionalUserData,
      securityGroup,
      blockDeviceMappings: [
        {
          deviceName: "/dev/sda1",
          ebs: {
            volumeSize,
          },
        },
      ],
    });

    const expireAfter = this.node.tryGetContext("expire_after");
    if (expireAfter) {
      fleet.expireAfter(cdk.Duration.hours(expireAfter));
    }
  }
}
