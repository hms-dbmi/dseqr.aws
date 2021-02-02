import * as ec2 from "@aws-cdk/aws-ec2";
import * as cdk from "@aws-cdk/core";
import * as fs from "fs";
import * as route53 from "@aws-cdk/aws-route53";
import * as autoscaling from "@aws-cdk/aws-autoscaling";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";
import * as acm from "@aws-cdk/aws-certificatemanager";
import * as alias from "@aws-cdk/aws-route53-targets";
import * as efs from "@aws-cdk/aws-efs";
import * as cognito from "@aws-cdk/aws-cognito";

export class DseqrAwsStackASG extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // user configurable parameters (e.g. cdk deploy -c instance_type="r5.large")
    const instanceType =
      this.node.tryGetContext("instance_type") || "r5.xlarge";
    const volumeSize = this.node.tryGetContext("volume_size") || 16;
    const keyName = this.node.tryGetContext("ssh_key_name");
    const zoneName = this.node.tryGetContext("domain_name");
    const hostedZoneId = this.node.tryGetContext("zone_id");
    const keepEFS = this.node.tryGetContext("keep_efs") || 1;
    const fileSystemId = this.node.tryGetContext("efs_id");
    const EFSSecurityGroupId = this.node.tryGetContext("efs_sg_id");

    // check for ssh key
    if (typeof keyName == "undefined") {
      throw "ssh_key_name not provided";
    }

    // both zone name and id
    if (!zoneName || !hostedZoneId) {
      throw "must provide both domain_name and zone_id to setup existing domain";
    }

    // both efs is and efs security group id or neither
    if (
      (!fileSystemId && EFSSecurityGroupId) ||
      (fileSystemId && !EFSSecurityGroupId)
    ) {
      throw "must provide both efs_id and efs_sg_id to use existing EFS";
    }

    // are we keeping EFS on cdk destroy? default is TRUE
    const removalPolicy =
      keepEFS == 1 ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // script that is run on startup

    // VPC
    const vpc = new ec2.Vpc(this, "VPC", { natGateways: 0 });

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

    // get ssl certificate for domain name
    const zone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        zoneName,
        hostedZoneId,
      }
    );

    const cert = new acm.Certificate(this, "Certificate", {
      domainName: zoneName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const userData = ec2.UserData.forLinux();

    // add EFS mount to userData
    userData.addCommands(
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
      "mount -a -t efs,nfs4 defaults"
    );

    // also replace drugseqr.com in configuration script
    let startupScript = fs.readFileSync("lib/configure.sh", "utf8");
    const regex = new RegExp(zoneName, "g");
    startupScript = startupScript.replace(regex, "g");
    userData.addCommands(startupScript);

    // allow SSH onto instances
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
    });

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "Allow inbound SSH"
    );

    //  create autoscaling group
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, "ASG", {
      vpc,
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: new ec2.GenericLinuxImage({
        "us-east-2": "ami-0dd9f0e7df0f0a138",
      }),
      minCapacity: 2,
      maxCapacity: 4,
      userData,
      associatePublicIpAddress: true,
      securityGroup,
      keyName,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      spotPrice: "0.192", // m5.xlarge on demand price
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: autoscaling.BlockDeviceVolume.ebs(volumeSize),
        },
      ],
    });

    autoScalingGroup.scaleOnCpuUtilization("ScaleToCPU", {
      targetUtilizationPercent: 70,
    });

    // create a load balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, "LB", {
      vpc,
      internetFacing: true,
    });

    // redirect to 443
    lb.addRedirect();

    // listen on 443
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [cert],
    });

    listener.connections.allowDefaultPortFromAnyIpv4("Open to the world");

    // send to port 80 on instances (nginx passes on)
    listener.addTargets("Targets", {
      port: 80,
      targets: [autoScalingGroup],
      stickinessCookieDuration: cdk.Duration.days(3), // requests from same session to same instance
    });

    // add A record for domain to direct to load balencer
    new route53.ARecord(this, "ARecord", {
      zone: zone,
      target: route53.RecordTarget.fromAlias(new alias.LoadBalancerTarget(lb)),
    });
  }
}
