import * as ec2 from "@aws-cdk/aws-ec2";
import * as cdk from "@aws-cdk/core";
import * as spotone from "cdk-spot-one";
import * as fs from "fs";
import * as route53 from "@aws-cdk/aws-route53";
import * as efs from "@aws-cdk/aws-efs";

interface DseqrSpotProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fileSystem: efs.IFileSystem;
}

export class DseqrSpotStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: DseqrSpotProps) {
    super(scope, id, props);

    // user configurable parameters (e.g. cdk deploy -c instance_type="r5.large")
    const instanceType =
      this.node.tryGetContext("instance_type") || "r5.xlarge";
    const volumeSize = this.node.tryGetContext("volume_size") || 14;
    const keyName = this.node.tryGetContext("ssh_key_name");
    const zoneName = this.node.tryGetContext("domain_name");
    const hostedZoneId = this.node.tryGetContext("zone_id");
    const getCert = this.node.tryGetContext("get_cert") || false;
    const exampleData = this.node.tryGetContext("example_data") || true;

    const { vpc, fileSystem } = props;
    const spot_block_duration = spotone.BlockDuration.NONE;

    // check for ssh key
    if (typeof keyName == "undefined") {
      throw "ssh_key_name not provided";
    }

    // both zone name and id or neither
    if ((!zoneName && hostedZoneId) || (zoneName && !hostedZoneId)) {
      throw "must provide both domain_name and zone_id or neither";
    }

    // mount EFS on startup
    let additionalUserData = [
      "apt-get -y update",
      "apt-get -y upgrade",
      "apt-get -y install amazon-efs-utils",
      "apt-get -y install nfs-common",
      "file_system_id_1=" + fileSystem.fileSystemId,
      "efs_mount_point_1=/srv/drugseqr",
      'mkdir -p "${efs_mount_point_1}"',
      'test -f "/sbin/mount.efs" && echo "${file_system_id_1}:/ ${efs_mount_point_1} efs defaults,_netdev" >> /etc/fstab || ' +
        'echo "${file_system_id_1}.efs.' +
        cdk.Stack.of(this).region +
        '.amazonaws.com:/ ${efs_mount_point_1} nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0" >> /etc/fstab',
      "mount -a -t efs,nfs4 defaults",
    ];

    additionalUserData.push(
      `EXAMPLE_DATA=${exampleData}`,
      `GET_CERT=${getCert}`, // execute letsencrpyt cert?
      `HOST_URL=${zoneName}`,
      fs.readFileSync("lib/configure.sh", "utf8")
    ); // configure script)

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
