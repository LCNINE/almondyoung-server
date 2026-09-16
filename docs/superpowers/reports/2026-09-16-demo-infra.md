# Demo stage infrastructure report

## Result

The `demo` stage now has an explicit profile at `almondyoung-next.com`. Existing `live`, `dev`, and other preview-stage domains, logical resource names, and removal defaults are unchanged. Demo uses `removal: remove` with `protect: true`.

The deployment graph is intentionally smaller:

- platform: isolated VPC, NAT/bastion, Redpanda and EBS under the existing `lcnine-platform/demo` state/SSM namespace
- auth: user-service, auth-web, auth Postgres, and a demo-owned versioned public-read auth upload bucket
- services: Core, Analytics, Channel Adapter, Notification, File Service, Admin Web, services Postgres, one public file bucket and one private file bucket
- omitted: Medusa, storefront, wallet, wallet-web, membership, UGC, search, Redis/Valkey, OpenSearch, GA4 credentials, and all real business-provider credentials

The user-service upload implementation returns an unsigned S3 URL, so its isolated demo bucket has a public-read policy. Only authenticated user-service routes can upload or delete objects. Its CORS rule allows `GET`, `HEAD`, and `PUT` from the demo Admin Web and Auth Web origins.

The public and private File Service buckets are separate. The public bucket explicitly supports the provider's `public-read` ACL and a public read policy; the private bucket retains the default public-access block. Both allow `GET`, `HEAD`, and `PUT` from the demo Admin Web origin so browser uploads through presigned URLs work. Both services use ECS task-role permissions supplied by SST links, so AWS access-key secrets are absent.

Notification does not import its Bull-backed bulk module in the demo stage. Its dispatcher sends through the persisted mock provider directly when Redis is absent, so the retained Notification service has no implicit localhost Redis dependency.

Demo uses CloudWatch/ECS logs provided by the AWS resources. Grafana Cloud forwarding is not declared in the demo graph, which avoids requiring shared observability credentials. It can be added later with demo-specific write-only tokens.

## Environment contract

Every demo backend receives these exact values:

```text
APP_STAGE=demo
DEMO_CONSOLE_ENABLED=true
EXTERNAL_INTEGRATIONS_MODE=mock
```

Admin Web additionally receives:

```text
NEXT_PUBLIC_APP_STAGE=demo
```

Demo URLs are:

```text
https://admin.almondyoung-next.com
https://auth.almondyoung-next.com
https://user.almondyoung-next.com
https://core.almondyoung-next.com
https://file.almondyoung-next.com
https://channel-adapter.almondyoung-next.com
https://analytics.almondyoung-next.com
https://notification.almondyoung-next.com
```

Cookie parent domain and auth-web redirect host suffix are `.almondyoung-next.com`. The native OAuth callback in the auth redirect whitelist is `almondwms-demo://oauth/callback`. Auth developer tools are disabled.

OIDC audience validation is explicit in the retained services:

```text
analytics, channel-adapter, notification, admin-web: admin-web
core, file-service: admin-web,warehouse-app
```

The seeded confidential `admin-web` client accepts only `https://admin.almondyoung-next.com/auth/callback` and redirects logout only to `https://admin.almondyoung-next.com/login`. The seeded public `warehouse-app` client accepts `almondwms-demo://oauth/callback` and `http://127.0.0.1/callback` for its loopback listener. User-service validates issued token audiences against its internal audience or an active registered OAuth client.

## Secret inventory

Set only these secrets in `deployments/lcnine/auth` for stage `demo`:

```text
AuthSecret
JwtRefreshSecret
JwtVerificationTokenSecret
NotificationInternalKey
OauthInternalSecret
UserServiceInternalKey
OauthJwtPrivateKey
OauthJwtPublicKey
```

Set only these secrets in `deployments/lcnine/services` for stage `demo`:

```text
ChannelAdapterInternalKey
CoreInternalKey
AdminWebOidcClientSecret
```

`AdminWebOidcClientSecret` must equal the secret stored for the seeded `admin-web` OAuth client. The RSA secrets should be base64-encoded PEM values. Generate fresh demo values; do not copy live/dev secrets.

No S3 access keys, Cafe24/Kakao/Naver/Coupang credentials, carrier credentials, NHN/Resend credentials, payment credentials, GA4 service account, OpenAI/Anthropic key, Redis/OpenSearch secret, or Grafana credential is required.

## Bootstrap and deployment order

The first deployment can declare only infrastructure. This prevents a new ECS service from failing health checks before its logical database exists. `--infra-only` only changes local SST config evaluation for `sst shell`; it does not deploy a diff or remove already deployed application resources.

1. From `deployments/lcnine/platform`, deploy `npx sst deploy --stage demo`.
2. From `deployments/lcnine/auth`, set the eight auth secrets, then run `DEMO_INFRA_ONLY=true npx sst deploy --stage demo`.
3. From the repository root, run:

   ```bash
   npm run db:bootstrap -- --stage demo --deployment lcnine-auth --yes --infra-only
   npm run db:migrate -- --stage demo --deployment lcnine-auth --yes --infra-only
   npm run db:seed:ref -- --stage demo --deployment lcnine-auth --yes --infra-only
   ```

4. From `deployments/lcnine/auth`, run the full `npx sst deploy --stage demo`.
5. From `deployments/lcnine/services`, set the three service secrets, then run `DEMO_INFRA_ONLY=true npx sst deploy --stage demo`.
6. From the repository root, run:

   ```bash
   npm run db:bootstrap -- --stage demo --deployment lcnine-services --yes --infra-only
   npm run db:migrate -- --stage demo --deployment lcnine-services --yes --infra-only
   npm run db:seed:ref -- --stage demo --deployment lcnine-services --yes --infra-only
   npm run db:seed:demo -- --stage demo --deployment lcnine-services --group demo-logistics --yes --infra-only
   ```

7. From `deployments/lcnine/services`, run the full `npx sst deploy --stage demo`.

After the full deployments, ordinary `sst shell --stage demo` or seed commands without `--infra-only` evaluate the complete demo graph. Keeping `--infra-only` on a later shell command is also non-mutating; only a subsequent `sst deploy` with `DEMO_INFRA_ONLY=true` would propose removing application resources, and that must not be used after full deployment.

## Verification

Commands run locally without an AWS deployment:

```text
corepack yarn jest --runInBand scripts/seeding/lib/sst-shell-relaunch.spec.ts scripts/deployment/lcnine-stage-profile.spec.ts scripts/seeding/lib/service-registry.spec.ts
../../../node_modules/.bin/sst install                         # each of platform/auth/services
../../../node_modules/.bin/tsc --noEmit -p .sst/platform/tsconfig.json  # each deployment
git diff --check
```

The focused suites cover demo/live/dev URLs, unknown-stage defaults, removal/protection, resource/service selection, runtime environment contract, stage-aware DB registry selection, and infrastructure-only relaunch behavior.

The deployed environment shapes were also checked directly against the current user-service, Core, File Service, Channel Adapter, and Notification validators. All five accept the declared demo contract without provider, Redis, search, or commerce credentials. Static startup review confirmed that the platform broker SSM value and Redpanda advertised address are both `Redpanda.demo.lcnine-platform.sst:9092`; imported auth/services VPCs retain the same `sst` Cloud Map namespace, and the consumers intentionally select plaintext Kafka.

### Read-only deployed verification

After the root worker deployed the stage, read-only AWS and HTTPS checks confirmed:

- the auth and services ECS services each reached `desired=1`, `running=1`, `pending=0`, `rolloutState=COMPLETED`, with zero failed tasks
- sanitized current-task logs show successful Nest startup and Kafka consumer joins for User Service, Core, Analytics, Channel Adapter, Notification, and File Service; no Redis connection attempt or real provider initialization occurred
- the public health paths return `200` for User Service, Core, Analytics, Channel Adapter, and Notification; File Service's declared target health path is `/` and returns `200`
- unauthenticated Admin Web requests enter the expected OIDC redirect flow, while Auth Web `/signin` returns `200`
- a demo Resend webhook request with the required dummy headers returns `404` before signature parsing because Resend webhooks are disabled without a real verifier
- the deployed ECS and Lambda environment contracts contain the exact demo triple, the audience lists above, and no Redis, Medusa, search, GA4, Cafe24, Kakao/Naver client, NHN/Resend, or payment credential variables
- demo-tagged resources contain the isolated VPC, the auth and services RDS instances, and the auth/services ECS clusters; direct ElastiCache, OpenSearch, and OpenSearch Serverless queries return no demo resources

The deployed auth upload bucket allows public `GetObject`, denies insecure transport, and limits CORS to `GET`, `HEAD`, and `PUT` from the demo Admin/Auth origins. The File Service public bucket has the same methods from Admin Web, a public-read policy, and ACL support needed by the existing provider. The private bucket has the same upload CORS but all four S3 public-access-block flags enabled and no public allow statement. All three data buckets are versioned. The Auth Web and Admin Web asset buckets remain separate from uploaded data.

Commands used for the read-only verification were limited to `aws resourcegroupstaggingapi get-resources`, ECS list/describe operations, CloudWatch Logs read operations, S3 bucket CORS/policy/public-access/versioning reads, direct ElastiCache/OpenSearch collection listings, and HTTPS `GET`/disabled-webhook probes. Secret values and full ECS/Lambda environments were never printed.

The first services image build lost its BuildKit transport while compiling Core under ARM emulation. Demo-only Dockerfiles now compile Nest JavaScript on `$BUILDPLATFORM` and install production dependencies in the target ARM stage; the isolated retry built Core in 74 seconds. OpenNext also requires each web app's `node_modules` to be a real local directory during packaging: a workspace symlink produced a Lambda bundle without `next`, while copying the installed dependencies locally produced working Auth Web and Admin Web artifacts. Future deploy hosts must preserve that preflight until the packaging setup removes the symlink sensitivity.

No AWS mutation or deployment was performed by this worker. The root worker performed deployment, database bootstrap/migration/seeding, and authenticated acceptance. Physical scanner/printer behavior remains device acceptance work.
