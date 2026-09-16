# Demo stage infrastructure report

## Result

The `demo` stage now has an explicit profile at `almondyoung-next.com`. Existing `live`, `dev`, and other preview-stage domains, logical resource names, and removal defaults are unchanged. Demo uses `removal: remove` with `protect: true`.

The deployment graph is intentionally smaller:

- platform: isolated VPC, NAT/bastion, Redpanda and EBS under the existing `lcnine-platform/demo` state/SSM namespace
- auth: user-service, auth-web, auth Postgres, and a demo-owned versioned auth upload bucket
- services: Core, Analytics, Channel Adapter, Notification, File Service, Admin Web, services Postgres, one public file bucket and one private file bucket
- omitted: Medusa, storefront, wallet, wallet-web, membership, UGC, search, Redis/Valkey, OpenSearch, GA4 credentials, and all real business-provider credentials

The public and private File Service buckets are separate. The public bucket explicitly supports the provider's `public-read` ACL and a public read policy; the private bucket retains the default public-access block. Both services use ECS task-role permissions supplied by SST links, so AWS access-key secrets are absent.

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

No AWS preview/diff or deployment was performed by this worker. Deployed health checks, DNS/certificate validation, DB migration execution, authenticated flow acceptance, device OAuth, and physical scanner/printer checks remain integration/deployment tasks.
