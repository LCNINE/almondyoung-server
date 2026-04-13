/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "almondyoung-server",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: { region: "ap-northeast-2" },
      },
    };
  },
  async run() {
    const isDev = $app.stage !== "production";

    const vpc = new sst.aws.Vpc("Vpc", {
      bastion: isDev,
    });
    const cluster = new sst.aws.Cluster("Cluster", { vpc });

    // ─── Database ───
    const db = new sst.aws.Postgres("Db", {
      vpc,
      scaling: { min: "0.5 ACU", max: "2 ACU" },
    });

    const dbUrl = (dbName: string) =>
      $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${dbName}?sslmode=require`;

    // ─── Redis (ElastiCache Serverless) ───
    const redis = new sst.aws.Redis("Redis", { vpc });
    const redisUrl = (dbIndex: number) =>
      $interpolate`redis://${redis.host}:${redis.port}/${dbIndex}`;

    // ─── Domain helper ───
    const baseDomain = "lcnine-dev.com";
    const domain = (slug: string) =>
      isDev ? `${slug}.dev.${baseDomain}` : `${slug}.${baseDomain}`;
    const url = (slug: string) => `https://${domain(slug)}`;

    // ─── Shared secrets ───
    const kafkaApiKey = new sst.Secret("KafkaApiKey");
    const kafkaApiSecret = new sst.Secret("KafkaApiSecret");
    const authSecret = new sst.Secret("AuthSecret");
    const awsS3AccessKeyId = new sst.Secret("AwsS3AccessKeyId");
    const awsS3SecretAccessKey = new sst.Secret("AwsS3SecretAccessKey");

    // ─── User Service secrets ───
    const kakaoClientId = new sst.Secret("KakaoClientId");
    const kakaoClientSecret = new sst.Secret("KakaoClientSecret");
    const jwtRefreshSecret = new sst.Secret("JwtRefreshSecret");
    const jwtVerificationTokenSecret = new sst.Secret("JwtVerificationTokenSecret");
    const twilioAccountSid = new sst.Secret("TwilioAccountSid");
    const twilioAuthToken = new sst.Secret("TwilioAuthToken");
    const cafe24ClientId = new sst.Secret("Cafe24ClientId");
    const cafe24ClientSecret = new sst.Secret("Cafe24ClientSecret");
    const cafe24ServiceKey = new sst.Secret("Cafe24ServiceKey");

    // ─── Channel Adapter secrets ───
    const channelAdapterInternalKey = new sst.Secret("ChannelAdapterInternalKey");
    const medusaApiKey = new sst.Secret("MedusaApiKey");

    // ─── Notification secrets ───
    const nhnAppKey = new sst.Secret("NhnAppKey");
    const nhnSecretKey = new sst.Secret("NhnSecretKey");
    const nhnSenderKey = new sst.Secret("NhnSenderKey");
    const resendApiKey = new sst.Secret("ResendApiKey");
    const resendWebhookSecret = new sst.Secret("ResendWebhookSecret");

    // ─── Wallet secrets ───
    const tossClientKey = new sst.Secret("TossClientKey");
    const tossSecretKey = new sst.Secret("TossSecretKey");
    const nicepayClientKey = new sst.Secret("NicepayClientKey");
    const nicepaySecretKey = new sst.Secret("NicepaySecretKey");
    const walletApiKey = new sst.Secret("WalletApiKey");
    const custKey = new sst.Secret("CustKey");
    const swKey = new sst.Secret("SwKey");

    // ─── PIM secrets ───
    const elasticsearchPassword = new sst.Secret("ElasticsearchPassword");

    // ─── Medusa secrets ───
    const medusaJwtSecret = new sst.Secret("MedusaJwtSecret");
    const medusaCookieSecret = new sst.Secret("MedusaCookieSecret");

    // ─── Common env builders ───
    const kafkaEnv = (prefix: string, groupId: string) => ({
      KAFKA_BROKERS: "pkc-e82om.ap-northeast-2.aws.confluent.cloud:9092",
      KAFKA_API_KEY: kafkaApiKey.value,
      KAFKA_API_SECRET: kafkaApiSecret.value,
      KAFKA_CLIENT_ID_PREFIX: prefix,
      KAFKA_GROUP_ID: groupId,
    });

    const baseEnv = (serviceName: string) => ({
      NODE_ENV: "production",
      OTEL_SERVICE_NAME: serviceName,
    });

    // ─── Service helper ───
    const createService = (
      name: string,
      opts: {
        dockerfile: string;
        domainSlug: string;
        port: number;
        environment: Record<string, $util.Output<string> | string>;
        buildArgs?: Record<string, $util.Output<string> | string>;
        link?: sst.Linkable[];
      },
    ) =>
      new sst.aws.Service(name, {
        cluster,
        link: opts.link,
        loadBalancer: {
          domain: domain(opts.domainSlug),
          rules: [
            { listen: "80/http", redirect: "443/https" },
            { listen: "443/https", forward: `${opts.port}/http` },
          ],
        },
        image: {
          context: ".",
          dockerfile: opts.dockerfile,
          args: opts.buildArgs,
        },
        environment: {
          ...baseEnv(opts.domainSlug),
          PORT: String(opts.port),
          ...opts.environment,
        },
      });

    // ═══════════════════════════════════════════
    //  Services
    // ═══════════════════════════════════════════

    createService("UserService", {
      dockerfile: "apps/user-service/Dockerfile",
      domainSlug: "user",
      port: 3000,
      link: [db],
      environment: {
        DATABASE_URL: dbUrl("user_service"),
        ...kafkaEnv("user-service", "user-service"),
        AUTH_SECRET: authSecret.value,
        JWT_REFRESH_SECRET: jwtRefreshSecret.value,
        JWT_VERIFICATION_TOKEN_SECRET: jwtVerificationTokenSecret.value,
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
        KAKAO_CLIENT_ID: kakaoClientId.value,
        KAKAO_CLIENT_SECRET: kakaoClientSecret.value,
        KAKAO_CALLBACK_URL: `${url("user")}/auth/kakao/callback`,
        TWILIO_ACCOUNT_SID: twilioAccountSid.value,
        TWILIO_AUTH_TOKEN: twilioAuthToken.value,
        TWILIO_PHONE_NUMBER: "+15856342856",
        CAFE24_CLIENT_ID: cafe24ClientId.value,
        CAFE24_CLIENT_SECRET: cafe24ClientSecret.value,
        CAFE24_SERVICE_KEY: cafe24ServiceKey.value,
        BIZNO_URL: "https://bizno.net/article",
        CORS_ORIGIN_DOMAINS: [
          url("www"),
          url("medusa"),
          "http://localhost:8000",
          "https://almondyoung.com",
          "https://www.almondyoung.com",
        ].join(","),
        AWS_ACCESS_KEY_ID: awsS3AccessKeyId.value,
        AWS_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
        AWS_REGION: "ap-northeast-2",
        AWS_S3_BUCKET: "almondyoung",
        CAFE24_MALL_ID: "lcnine",
      },
    });

    createService("Analytics", {
      dockerfile: "apps/analytics/Dockerfile",
      domainSlug: "analytics",
      port: 3040,
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
      link: [db],
      environment: {
        DATABASE_URL: dbUrl("channel_adapter"),
        ...kafkaEnv("channel-adapter", "channel-adapter-group"),
        CHANNEL_ADAPTER_INTERNAL_KEY: channelAdapterInternalKey.value,
        MEDUSA_API_KEY: medusaApiKey.value,
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

    createService("Pim", {
      dockerfile: "apps/pim/Dockerfile",
      domainSlug: "pim",
      port: 3000,
      link: [db],
      environment: {
        DATABASE_URL: dbUrl("pim"),
        ...kafkaEnv("pim", "pim-group"),
        AUTH_SECRET: authSecret.value,
        ELASTICSEARCH_NODE: "https://elasticsearch-demo.up.railway.app",
        ELASTICSEARCH_USERNAME: "elastic",
        ELASTICSEARCH_PASSWORD: elasticsearchPassword.value,
      },
    });

    createService("UgcService", {
      dockerfile: "apps/ugc-service/Dockerfile",
      domainSlug: "ugc",
      port: 3030,
      link: [db],
      environment: {
        DATABASE_URL: dbUrl("ugc"),
        ...kafkaEnv("ugc-service", "ugc-service-group"),
        AUTH_SECRET: authSecret.value,
        JWT_ISSUER: "almondyoung-auth",
      },
    });

    createService("Wms", {
      dockerfile: "apps/wms/Dockerfile",
      domainSlug: "wms",
      port: 3000,
      link: [db],
      environment: {
        DATABASE_URL: dbUrl("wms"),
        ...kafkaEnv("wms", "wms-group"),
        AUTH_SECRET: authSecret.value,
      },
    });

    createService("Wallet", {
      dockerfile: "apps/wallet/Dockerfile",
      domainSlug: "wallet",
      port: 3000,
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
      environment: {
        OPENSEARCH_NODE: "https://opensearch-demo.up.railway.app",
        SEARCH_PRODUCTS_INDEX: "search_products",
      },
    });

    createService("Medusa", {
      dockerfile: "apps/medusa/Dockerfile",
      domainSlug: "medusa",
      port: 9000,
      link: [db, redis],
      buildArgs: {
        VITE_USER_SERVICE_URL: url("user"),
      },
      environment: {
        DATABASE_URL: dbUrl("medusa"),
        REDIS_URL: redisUrl(0),
        CACHE_REDIS_URL: redisUrl(1),
        MEDUSA_FF_CACHING: "true",
        // Auth
        JWT_SECRET: medusaJwtSecret.value,
        COOKIE_SECRET: medusaCookieSecret.value,
        JWT_EXPIRES_IN: "30d",
        AUTH_SECRET: authSecret.value,
        MEDUSA_API_KEY: medusaApiKey.value,
        // CORS
        STORE_CORS: [url("www"), "https://almondyoung.com", "https://www.almondyoung.com"].join(","),
        ADMIN_CORS: [url("medusa"), "http://localhost:9000"].join(","),
        AUTH_CORS: [url("medusa"), url("www"), "https://almondyoung.com", "https://www.almondyoung.com"].join(","),
        // Internal service URLs
        FRONTEND_URL: url("www"),
        USER_SERVICE_URL: url("user"),
        MEDUSA_BACKEND_URL: url("medusa"),
        WALLET_BASE_URL: url("wallet"),
        WALLET_API_KEY: walletApiKey.value,
        WMS_API_URL: url("wms"),
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
  },
});
