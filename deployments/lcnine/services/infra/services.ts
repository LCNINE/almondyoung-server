/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { SharedInfra } from "./shared";

export function setup(infra: SharedInfra) {
  const { db, redis, dbUrl, redisUrl, baseDomain, domain, url, kafkaEnv, createService } = infra;

  // ─── Secrets ───
  const authSecret = new sst.Secret("AuthSecret");
  const awsS3AccessKeyId = new sst.Secret("AwsS3AccessKeyId");
  const awsS3SecretAccessKey = new sst.Secret("AwsS3SecretAccessKey");

  // ─── IdP (lcnine-auth) 앱이 publish한 SSM Parameter 조회 ───
  // user-service는 deployments/lcnine/auth/ 의 별도 SST 앱으로 분리되어 있으므로 URL을
  // hardcoded가 아니라 cross-stack으로 읽어 온다. stage 이름은 두 앱이 동일하게 운용한다고 가정.
  const idpUserServiceUrl = aws.ssm.getParameterOutput({
    name: `/lcnine-auth/${$app.stage}/user-service-url`,
  }).value;

  // TEMP(시연용): IdP 스택의 AUTH_SECRET을 가져와 user-service 발급 JWT를
  // 검증하는 서비스(예: Medusa my-auth provider)가 같은 시크릿으로 verify할 수 있게 함.
  const idpAuthSecret = aws.ssm.getParameterOutput({
    name: `/lcnine-auth/${$app.stage}/auth-secret`,
    withDecryption: true,
  }).value;

  // Channel Adapter
  const channelAdapterInternalKey = new sst.Secret("ChannelAdapterInternalKey");
  const medusaApiKey = new sst.Secret("MedusaApiKey");

  // Notification
  const nhnAppKey = new sst.Secret("NhnAppKey");
  const nhnSecretKey = new sst.Secret("NhnSecretKey");
  const nhnSenderKey = new sst.Secret("NhnSenderKey");
  const resendApiKey = new sst.Secret("ResendApiKey");
  const resendWebhookSecret = new sst.Secret("ResendWebhookSecret");

  // Wallet
  const tossClientKey = new sst.Secret("TossClientKey");
  const tossSecretKey = new sst.Secret("TossSecretKey");
  const nicepayClientKey = new sst.Secret("NicepayClientKey");
  const nicepaySecretKey = new sst.Secret("NicepaySecretKey");
  const walletApiKey = new sst.Secret("WalletApiKey");
  const custKey = new sst.Secret("CustKey");
  const swKey = new sst.Secret("SwKey");

  // Medusa
  const medusaJwtSecret = new sst.Secret("MedusaJwtSecret");
  const medusaCookieSecret = new sst.Secret("MedusaCookieSecret");

  // ═══════════════════════════════════════════
  //  Services
  // ═══════════════════════════════════════════

  createService("Analytics", {
    dockerfile: "apps/analytics/Dockerfile",
    domainSlug: "analytics",
    port: 3040,
    priority: 110,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("analytics"),
      ...kafkaEnv("analytics", "analytics-group"),
      AUTH_SECRET: authSecret.value,
    },
  });

  createService("ChannelAdapter", {
    dockerfile: "apps/channel-adapter/Dockerfile",
    domainSlug: "channel-adapter",
    port: 3000,
    priority: 120,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("channel_adapter"),
      ...kafkaEnv("channel-adapter", "channel-adapter-group"),
      CHANNEL_ADAPTER_INTERNAL_KEY: channelAdapterInternalKey.value,
      MEDUSA_API_KEY: medusaApiKey.value,
      MEDUSA_API_URL: url("medusa"),
      MEDUSA_MEMBERSHIP_GROUP_ID: "cusgroup_01KFZ12A1M344F6HKGDV35J28A",
      ALMOND_AUTH_URL: "https://asia-northeast3-almond-auth.cloudfunctions.net/api",
      USER_SERVICE_URL: idpUserServiceUrl,
      PIM_API_URL: url("core"),
      NAVER_API_ENDPOINT: "https://dummy.com",
      NAVER_CLIENT_ID: "1",
      NAVER_CLIENT_SECRET: "1",
      COUPANG_ACCESS_KEY: "1",
      COUPANG_SECRET_KEY: "1",
      COUPANG_VENDOR_ID: "1",
      SKIP_VARIANTS_WITHOUT_PRICE: "true",
    },
  });

  createService("Membership", {
    dockerfile: "apps/membership/Dockerfile",
    domainSlug: "membership",
    port: 3000,
    priority: 130,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("membership"),
      ...kafkaEnv("membership", "membership-group"),
      WALLET_API_KEY: walletApiKey.value,
      WALLET_API_URL: url("wallet"),
    },
  });

  createService("Notification", {
    dockerfile: "apps/notification/Dockerfile",
    domainSlug: "notification",
    port: 3000,
    priority: 140,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("notification"),
      ...kafkaEnv("notification", "notification-group"),
      NHN_API_URL: "https://api-alimtalk.cloud.toast.com",
      NHN_APP_KEY: nhnAppKey.value,
      NHN_SECRET_KEY: nhnSecretKey.value,
      NHN_SENDER_KEY: nhnSenderKey.value,
      NHN_PLUS_FRIEND_ID: "@아몬드영",
      RESEND_API_KEY: resendApiKey.value,
      RESEND_BASE_URL: "https://api.resend.com",
      RESEND_FROM: `noreply@mail.${baseDomain}`,
      RESEND_FROM_NAME: "아몬드영",
      RESEND_WEBHOOK_SECRET: resendWebhookSecret.value,
    },
  });

  createService("Core", {
    dockerfile: "apps/almondyoung-server/Dockerfile",
    domainSlug: "core",
    port: 3000,
    priority: 145,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("core"),
      ...kafkaEnv("almondyoung-server", "almondyoung-server-group"),
      AUTH_SECRET: authSecret.value,
      JWT_ISSUER: "almondyoung-auth",
    },
  });

  createService("UgcService", {
    dockerfile: "apps/ugc-service/Dockerfile",
    domainSlug: "ugc",
    port: 3030,
    priority: 160,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("ugc"),
      ...kafkaEnv("ugc-service", "ugc-service-group"),
      AUTH_SECRET: authSecret.value,
      JWT_ISSUER: "almondyoung-auth",
    },
  });

  createService("Wallet", {
    dockerfile: "apps/wallet/Dockerfile",
    domainSlug: "wallet",
    port: 3000,
    priority: 180,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("wallet"),
      ...kafkaEnv("wallet", "wallet-group"),
      AUTH_SECRET: authSecret.value,
      USER_JWT_SECRET: authSecret.value,
      TOSS_CLIENT_KEY: tossClientKey.value,
      TOSS_SECRET_KEY: tossSecretKey.value,
      NICEPAY_CLIENT_KEY: nicepayClientKey.value,
      NICEPAY_SECRET_KEY: nicepaySecretKey.value,
      WALLET_API_KEY: walletApiKey.value,
      CUST_KEY: custKey.value,
      SW_KEY: swKey.value,
      SERVICE_NAME: "wallet",
      CORS_ORIGINS: `*.${baseDomain}`,
      WALLET_MEDUSA_WEBHOOK_URL: `${url("medusa")}/hooks/payment/pp_almond-payment_almond-payment`,
    },
  });

  createService("FileService", {
    dockerfile: "apps/file-service/Dockerfile",
    domainSlug: "file",
    port: 3000,
    priority: 190,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("file_service"),
      ...kafkaEnv("file-service", "file-service-group"),
      AUTH_SECRET: authSecret.value,
      AWS_ACCESS_KEY_ID: awsS3AccessKeyId.value,
      AWS_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
      AWS_REGION: "ap-northeast-2",
      AWS_S3_PUBLIC_BUCKET: "almondyoung-demo",
      AWS_S3_PRIVATE_BUCKET: "almondyoung-demo",
      STORAGE_PROVIDER: "S3",
    },
  });

  createService("Search", {
    dockerfile: "apps/search/Dockerfile",
    domainSlug: "search",
    port: 3000,
    priority: 200,
    environment: {
      OPENSEARCH_NODE: "https://opensearch-demo.up.railway.app",
      SEARCH_PRODUCTS_INDEX: "search_products",
    },
  });

  createService("Medusa", {
    dockerfile: "apps/medusa/Dockerfile",
    domainSlug: "medusa",
    port: 9000,
    priority: 210,
    link: [db, redis],
    buildArgs: {
      VITE_USER_SERVICE_URL: idpUserServiceUrl,
    },
    loadBalancerHealth: {
      "9000/http": {
        path: "/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    transform: {
      service: {
        healthCheckGracePeriodSeconds: 600,
      },
    },
    environment: {
      DATABASE_URL: $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/medusa?sslmode=disable`,
      REDIS_URL: redisUrl(0),
      CACHE_REDIS_URL: redisUrl(1),
      MEDUSA_FF_CACHING: "true",
      // Auth
      JWT_SECRET: medusaJwtSecret.value,
      COOKIE_SECRET: medusaCookieSecret.value,
      JWT_EXPIRES_IN: "30d",
      // TEMP(시연용): my-auth provider가 user-service 발급 토큰을 jwt.verify하므로
      // IdP 스택의 AUTH_SECRET과 동일한 값을 주입.
      AUTH_SECRET: idpAuthSecret,
      MEDUSA_API_KEY: medusaApiKey.value,
      // CORS
      STORE_CORS: [url("www"), "https://almondyoung.com", "https://www.almondyoung.com"].join(","),
      ADMIN_CORS: [url("medusa"), "http://localhost:9000"].join(","),
      AUTH_CORS: [url("medusa"), url("www"), "https://almondyoung.com", "https://www.almondyoung.com"].join(","),
      // Internal service URLs
      FRONTEND_URL: url("www"),
      USER_SERVICE_URL: idpUserServiceUrl,
      MEDUSA_BACKEND_URL: url("medusa"),
      WALLET_BASE_URL: url("wallet"),
      WALLET_API_KEY: walletApiKey.value,
      WMS_API_URL: url("core"),
      ALMOND_PAYMENT_ENDPOINT: url("wallet"),
      MEMBERSHIP_SERVICE_URL: url("membership"),
      UGC_SERVICE_URL: url("ugc"),
      MEDUSA_MEMBERSHIP_GROUP_ID: "cusgroup_01KFZ12A1M344F6HKGDV35J28A",
      // S3
      S3_FILE_URL: "https://almondyoung-medusa-digital-asset.s3.ap-northeast-2.amazonaws.com",
      S3_ACCESS_KEY_ID: awsS3AccessKeyId.value,
      S3_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
      S3_REGION: "ap-northeast-2",
      S3_BUCKET: "almondyoung-medusa-digital-asset",
      // Admin & logging
      MEDUSA_ADMIN_ONBOARDING_TYPE: "default",
      LOG_LEVEL: "debug",
    },
  });

  // ─── admin-web (Next.js / OpenNext, CloudFront) ───
  new sst.aws.Nextjs("AdminWeb", {
    path: "../../../apps/admin-web",
    domain: { name: domain("admin") },
    environment: {
      AUTH_SECRET: authSecret.value,
      ALMONDYOUNG_API_URL: url("core"),
      USER_SERVICE_URL: idpUserServiceUrl,
      WALLET_SERVICE_URL: url("wallet"),
      MEMBERSHIP_SERVICE_URL: url("membership"),
      NOTIFICATION_SERVICE_URL: url("notification"),
      CHANNEL_ADAPTER_SERVICE_URL: url("channel-adapter"),
      ADMIN_DOMAIN: domain("admin"),
    },
  });

  // ─── wallet-web (Next.js / OpenNext, CloudFront) ───
  new sst.aws.Nextjs("WalletWeb", {
    path: "../../../apps/wallet-web",
    domain: { name: domain("wallet-web") },
    environment: {
      NEXT_PUBLIC_WALLET_API_URL: url("wallet"),
      WALLET_API_URL: url("wallet"),
      WALLET_API_KEY: walletApiKey.value,
      USER_SERVICE_URL: idpUserServiceUrl,
      COOKIE_DOMAIN: `.${baseDomain}`,
      TOSS_CLIENT_KEY: tossClientKey.value,
    },
  });
}
