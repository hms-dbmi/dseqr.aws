import * as cdk from "@aws-cdk/core";
import * as acm from "@aws-cdk/aws-certificatemanager";
import * as route53 from "@aws-cdk/aws-route53";
import * as ec2 from "@aws-cdk/aws-ec2";

// Stack that emits zone, certificate, and vpc
// NOTE: max 20 certificates per 365 days
export class DseqrZoneStack extends cdk.Stack {
  public readonly certificate: acm.ICertificate;
  public readonly zone: route53.IHostedZone;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const zoneName = this.node.tryGetContext("domain_name");
    const hostedZoneId = this.node.tryGetContext("zone_id");
    const certificateArn = this.node.tryGetContext("cert_arn");

    // both zone name and id
    if (!zoneName || !hostedZoneId) {
      throw "must provide both domain_name and zone_id";
    }

    // import hosted zone
    const zone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        zoneName,
        hostedZoneId,
      }
    );

    // import/get ssl cert
    let certificate;
    if (certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(
        this,
        "Certificate",
        certificateArn
      );
    } else {
      certificate = new acm.Certificate(this, "Certificate", {
        domainName: "*." + zoneName,
        subjectAlternativeNames: [zoneName],
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }

    this.certificate = certificate;
    this.zone = zone;
  }
}
