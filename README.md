## Deploying dseqr app

clone the repo and update `cdk.context.json` to reflect your
domain name, associated zone id, and ssh key name. Then run:

```bash
# install npm packages
npm install

cdk deploy DseqrAsgStack --require-approval=never
```

Wait 10 minutes, navigate to `yourdomain.com`, and you should have:

* fully functioning dseqr app served by `shinyproxy`
* SSL certificates (lock icon)
* A load balancer and auto-scaling group (up to four spot m5.xlarge)
* an EFS file system (7 day infrequent access policy)
* cognito layer for user management and authorization


No one using it?

```bash
# to delete all resources
cdk destroy --all
```

Notes:

* EFS is retained on `destroy` (retention policy doesn't seem to be respected)
* AWS can be a bit stingy about SSL certs (20 per year). They give
limit increases on request (I asked for 1000) but can take a while.
* node v15.6+ complains about empty zip for `lambda`. If this happens, delete the `cdk.out` folder, the assets in your S3 staging bucket, change node versions `nvm install --lts; nvm use --lts` and try again.

