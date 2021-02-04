import * as cdk from "@aws-cdk/core";
import * as cognito from "@aws-cdk/aws-cognito";
import * as cr from "@aws-cdk/custom-resources";

export class DseqrCognitoStack extends cdk.Stack {
  public readonly userPoolClientSecret: string;
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // user configurable parameters (e.g. cdk deploy -c instance_type="r5.large")
    const userPoolId = this.node.tryGetContext("userpool_id");
    const userPoolClientId = this.node.tryGetContext("userpool_client_id");
    const zoneName = this.node.tryGetContext("domain_name");
    const hostedZoneId = this.node.tryGetContext("zone_id");

    // both zone name and id
    if (!zoneName || !hostedZoneId) {
      throw "must provide both domain_name and zone_id";
    }

    // both efs is and efs security group id or neither
    if (
      (userPoolId && !userPoolClientId) ||
      (!userPoolId && userPoolClientId)
    ) {
      throw "must provide both userpool_id and userpool_client_id to use existing user pool";
    }

    // cognito for authentication
    let userPool;
    let userPoolClient;
    if (userPoolId && userPoolClientId) {
      // use existing pool/client
      userPool = cognito.UserPool.fromUserPoolId(
        this,
        "dseqr-userpool",
        userPoolId
      );

      userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
        this,
        "dseqr-app-client",
        userPoolClientId
      );
    } else {
      // create new pool/client
      userPool = new cognito.UserPool(this, "userpool", {
        userPoolName: "dseqr-userpool",
        signInCaseSensitive: false,
        selfSignUpEnabled: true,
        signInAliases: { email: true },
        autoVerify: { email: true },
      });

      userPoolClient = userPool.addClient("dseqr-app-client", {
        oAuth: {
          callbackUrls: [`https://${zoneName}/login/oauth2/code/shinyproxy`],
          logoutUrls: [`https://${zoneName}`],
        },
        generateSecret: true,
      });
    }

    // This doesn't work: lambda empty zip error
    const describeCognitoUserPoolClient = new cr.AwsCustomResource(
      this,
      "DescribeCognitoUserPoolClient",
      {
        resourceType: "Custom::DescribeCognitoUserPoolClient",
        onCreate: {
          region: "us-east-2",
          service: "CognitoIdentityServiceProvider",
          action: "describeUserPoolClient",
          parameters: {
            UserPoolId: userPool.userPoolId,
            ClientId: userPoolClient.userPoolClientId,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            userPoolClient.userPoolClientId
          ),
        },
        // TODO: can we restrict this policy more?
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      }
    );

    const userPoolClientSecret = describeCognitoUserPoolClient.getResponseField(
      "UserPoolClient.ClientSecret"
    );

    this.userPoolClientSecret = userPoolClientSecret;
    this.userPool = userPool;
    this.userPoolClient = userPoolClient;

    // might need with "seperate deployment": https://stackoverflow.com/questions/63675330/aws-cdk-access-resource-from-other-stack
    // new cdk.CfnOutput(this, "UserPoolClientSecret", {
    //   value: userPoolClientSecret,
    // });
  }
}
