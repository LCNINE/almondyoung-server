/// <reference path="../.sst/platform/config.d.ts" />

import type { SharedInfra } from "./shared";

export function setup(infra: SharedInfra) {
  const { db, redis, dbUrl, redisUrl, baseDomain, url, kafkaEnv, createService, secrets: s } = infra;

  // ═══════════════════════════════════════════
  //  Services
  // ═══════════════════════════════════════════

  createService("UserService", {
    dockerfile: "apps/user-service/Dockerfile",
    domainSlug: "user",
    port: 3000,
    priority: 100,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("user_service"),
      ...kafkaEnv("user-service", "user-service"),
      AUTH_SECRET: s.authSecret.value,
      JWT_REFRESH_SECRET: s.jwtRefreshSecret.value,
      JWT_VERIFICATION_TOKEN_SECRET: s.jwtVerificationTokenSecret.value,
      COOKIE_DOMAIN: `.${baseDomain}`,
      FRONTEND_URL: url("www"),
      SIGNUP_CALLBACK_URL: `${url("www")}/callback/signup`,
      USER_SERVICE_URL: url("user"),
      REDIRECT_URL_WHITELIST: [
        "http://localhost:8000/callback/signup",
        "http://localhost:8000/",
        "http://localhost:8000",
        `${url("user")}/`,
        `${url("www")}/`,
        "http://localhost:8080/",
      ].join(","),
      KAKAO_CLIENT_ID: s.kakaoClientId.value,
      KAKAO_CLIENT_SECRET: s.kakaoClientSecret.value,
      KAKAO_CALLBACK_URL: `${url("user")}/auth/kakao/callback`,
      TWILIO_ACCOUNT_SID: s.twilioAccountSid.value,
      TWILIO_AUTH_TOKEN: s.twilioAuthToken.value,
      TWILIO_PHONE_NUMBER: "+15856342856",
      CAFE24_CLIENT_ID: s.cafe24ClientId.value,
      CAFE24_CLIENT_SECRET: s.cafe24ClientSecret.value,
      CAFE24_SERVICE_KEY: s.cafe24ServiceKey.value,
      BIZNO_URL: "https://bizno.net/article",
      CORS_ORIGIN_DOMAINS: [
        url("www"),
        url("medusa"),
        "http://localhost:8000",
        "https://almondyoung.com",
        "https://www.almondyoung.com",
      ].join(","),
      AWS_ACCESS_KEY_ID: s.awsS3AccessKeyId.value,
      AWS_SECRET_ACCESS_KEY: s.awsS3SecretAccessKey.value,
      AWS_REGION: "ap-northeast-2",
      AWS_S3_BUCKET: "almondyoung",
      CAFE24_MALL_ID: "lcnine",
    },
  });

  createService("Analytics", {
    dockerfile: "apps/analytics/Dockerfile",
    domainSlug: "analytics",
    port: 3040,
    priority: 110,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("analytics"),
      ...kafkaEnv("analytics", "analytics-group"),
      AUTH_SECRET: s.authSecret.value,
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
      CHANNEL_ADAPTER_INTERNAL_KEY: s.channelAdapterInternalKey.value,
      MEDUSA_API_KEY: s.medusaApiKey.value,
      MEDUSA_API_URL: url("medusa"),
      MEDUSA_MEMBERSHIP_GROUP_ID: "cusgroup_01KFZ12A1M344F6HKGDV35J28A",
      ALMOND_AUTH_URL: "https://asia-northeast3-almond-auth.cloudfunctions.net/api",
      USER_SERVICE_URL: url("user"),
      PIM_API_URL: url("pim"),
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
      WALLET_API_KEY: s.walletApiKey.value,
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
      NHN_APP_KEY: s.nhnAppKey.value,
      NHN_SECRET_KEY: s.nhnSecretKey.value,
      NHN_SENDER_KEY: s.nhnSenderKey.value,
      NHN_PLUS_FRIEND_ID: "@아몬드영",
      RESEND_API_KEY: s.resendApiKey.value,
      RESEND_BASE_URL: "https://api.resend.com",
      RESEND_FROM: `noreply@mail.${baseDomain}`,
      RESEND_FROM_NAME: "아몬드영",
      RESEND_WEBHOOK_SECRET: s.resendWebhookSecret.value,
    },
  });

  createService("Pim", {
    dockerfile: "apps/pim/Dockerfile",
    domainSlug: "pim",
    port: 3000,
    priority: 150,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("pim"),
      ...kafkaEnv("pim", "pim-group"),
      AUTH_SECRET: s.authSecret.value,
      ELASTICSEARCH_NODE: "https://elasticsearch-demo.up.railway.app",
      ELASTICSEARCH_USERNAME: "elastic",
      ELASTICSEARCH_PASSWORD: s.elasticsearchPassword.value,
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
      AUTH_SECRET: s.authSecret.value,
      JWT_ISSUER: "almondyoung-auth",
    },
  });

  createService("Wms", {
    dockerfile: "apps/wms/Dockerfile",
    domainSlug: "wms",
    port: 3000,
    priority: 170,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl("wms"),
      ...kafkaEnv("wms", "wms-group"),
      AUTH_SECRET: s.authSecret.value,
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
      AUTH_SECRET: s.authSecret.value,
      USER_JWT_SECRET: s.authSecret.value,
      TOSS_CLIENT_KEY: s.tossClientKey.value,
      TOSS_SECRET_KEY: s.tossSecretKey.value,
      NICEPAY_CLIENT_KEY: s.nicepayClientKey.value,
      NICEPAY_SECRET_KEY: s.nicepaySecretKey.value,
      WALLET_API_KEY: s.walletApiKey.value,
      CUST_KEY: s.custKey.value,
      SW_KEY: s.swKey.value,
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
      AUTH_SECRET: s.authSecret.value,
      AWS_ACCESS_KEY_ID: s.awsS3AccessKeyId.value,
      AWS_SECRET_ACCESS_KEY: s.awsS3SecretAccessKey.value,
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
      VITE_USER_SERVICE_URL: url("user"),
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
      JWT_SECRET: s.medusaJwtSecret.value,
      COOKIE_SECRET: s.medusaCookieSecret.value,
      JWT_EXPIRES_IN: "30d",
      AUTH_SECRET: s.authSecret.value,
      MEDUSA_API_KEY: s.medusaApiKey.value,
      // CORS
      STORE_CORS: [url("www"), "https://almondyoung.com", "https://www.almondyoung.com"].join(","),
      ADMIN_CORS: [url("medusa"), "http://localhost:9000"].join(","),
      AUTH_CORS: [url("medusa"), url("www"), "https://almondyoung.com", "https://www.almondyoung.com"].join(","),
      // Internal service URLs
      FRONTEND_URL: url("www"),
      USER_SERVICE_URL: url("user"),
      MEDUSA_BACKEND_URL: url("medusa"),
      WALLET_BASE_URL: url("wallet"),
      WALLET_API_KEY: s.walletApiKey.value,
      WMS_API_URL: url("wms"),
      ALMOND_PAYMENT_ENDPOINT: url("wallet"),
      MEMBERSHIP_SERVICE_URL: url("membership"),
      UGC_SERVICE_URL: url("ugc"),
      MEDUSA_MEMBERSHIP_GROUP_ID: "cusgroup_01KFZ12A1M344F6HKGDV35J28A",
      // S3
      S3_FILE_URL: "https://almondyoung-medusa-digital-asset.s3.ap-northeast-2.amazonaws.com",
      S3_ACCESS_KEY_ID: s.awsS3AccessKeyId.value,
      S3_SECRET_ACCESS_KEY: s.awsS3SecretAccessKey.value,
      S3_REGION: "ap-northeast-2",
      S3_BUCKET: "almondyoung-medusa-digital-asset",
      // Admin & logging
      MEDUSA_ADMIN_ONBOARDING_TYPE: "default",
      LOG_LEVEL: "debug",
    },
  });
}
