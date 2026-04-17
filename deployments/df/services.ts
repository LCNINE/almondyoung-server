/// <reference path="../../.sst/platform/config.d.ts" />

import type { SharedInfra } from "../../infra/shared";

export function setup(infra: SharedInfra) {
  const { vpc, db, redis, dbUrl, redisUrl, baseDomain, url, createService } = infra;

  // ─── Kafka (MSK Serverless — IAM auth via ECS task role) ───
  const mskCluster = new aws.msk.ServerlessCluster("MskCluster", {
    clusterName: `${$app.name}-${$app.stage}`,
    vpcConfigs: [{
      subnetIds: vpc.privateSubnets,
      securityGroupIds: vpc.securityGroups,
    }],
    clientAuthentication: {
      sasl: { iam: { enabled: true } },
    },
  });

  // raw Pulumi 리소스를 SST link로 사용하기 위한 등록.
  // link: [mskCluster]을 받은 서비스의 task role에 아래 IAM 권한이 자동 부착된다.
  // ServerlessCluster ARN: arn:aws:kafka:{region}:{account}:cluster/{name}/{uuid}-s1
  // topic/group ARN: 같은 prefix에서 :cluster/ → :topic/ or :group/ 치환 후 /* 추가.
  sst.Linkable.wrap(aws.msk.ServerlessCluster, (cluster) => ({
    properties: { brokers: cluster.bootstrapBrokersSaslIam },
    include: [
      sst.aws.permission({
        actions: [
          "kafka-cluster:Connect",
          "kafka-cluster:DescribeCluster",
          "kafka-cluster:DescribeClusterDynamicConfiguration",
          "kafka-cluster:DescribeTopic",
          "kafka-cluster:DescribeTopicDynamicConfiguration",
          "kafka-cluster:ReadData",
          "kafka-cluster:WriteData",
          "kafka-cluster:CreateTopic",
          "kafka-cluster:AlterTopic",
          "kafka-cluster:AlterTopicDynamicConfiguration",
          "kafka-cluster:DescribeGroup",
          "kafka-cluster:AlterGroup",
        ],
        resources: [
          cluster.arn,
          cluster.arn.apply((arn) => `${arn.replace(":cluster/", ":topic/")}/*`),
          cluster.arn.apply((arn) => `${arn.replace(":cluster/", ":group/")}/*`),
        ],
      }),
    ],
  }));

  const kafkaEnv = (prefix: string, groupId: string) => ({
    KAFKA_BROKERS: mskCluster.bootstrapBrokersSaslIam,
    KAFKA_SASL_MECHANISM: "aws-iam",
    KAFKA_CLIENT_ID_PREFIX: prefix,
    KAFKA_GROUP_ID: groupId,
  });

  // ─── S3 Buckets (ECS task role auth — no explicit keys) ───
  const publicBucket = new sst.aws.Bucket("PublicBucket");
  const privateBucket = new sst.aws.Bucket("PrivateBucket");
  const medusaAssetBucket = new sst.aws.Bucket("MedusaAssetBucket");

  // ─── Secrets (DF deployment) ───
  const authSecret = new sst.Secret("AuthSecret");

  // User Service
  const jwtRefreshSecret = new sst.Secret("JwtRefreshSecret");
  const jwtVerificationTokenSecret = new sst.Secret("JwtVerificationTokenSecret");

  // Channel Adapter
  const channelAdapterInternalKey = new sst.Secret("ChannelAdapterInternalKey");
  const medusaApiKey = new sst.Secret("MedusaApiKey");

  // Wallet
  const walletApiKey = new sst.Secret("WalletApiKey");

  // Medusa
  const medusaJwtSecret = new sst.Secret("MedusaJwtSecret");
  const medusaCookieSecret = new sst.Secret("MedusaCookieSecret");

  // ═══════════════════════════════════════════
  //  Services (df 환경: Pim/Wms 없음, almondyoung-server 포함)
  // ═══════════════════════════════════════════

  createService("AlmondyoungServer", {
    dockerfile: "apps/almondyoung-server/Dockerfile",
    domainSlug: "api",
    port: 3000,
    priority: 90,
    link: [db, mskCluster],
    environment: {
      DATABASE_URL: dbUrl("core"),
      ...kafkaEnv("almondyoung-server", "almondyoung-server-group"),
      AUTH_SECRET: authSecret.value,
      JWT_ISSUER: "almondyoung-auth",
    },
  });

  createService("UserService", {
    dockerfile: "apps/user-service/Dockerfile",
    domainSlug: "user",
    port: 3000,
    priority: 100,
    link: [db, publicBucket, mskCluster],
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
      BIZNO_URL: "https://bizno.net/article",
      CORS_ORIGIN_DOMAINS: [
        url("www"),
        url("medusa"),
        url("admin"),
        "http://localhost:8000",
      ].join(","),
      AWS_REGION: "ap-northeast-2",
      AWS_S3_BUCKET: publicBucket.name,
    },
  });

  // createService("Analytics", {
  //   dockerfile: "apps/analytics/Dockerfile",
  //   domainSlug: "analytics",
  //   port: 3040,
  //   priority: 110,
  //   link: [db, mskCluster],
  //   environment: {
  //     DATABASE_URL: dbUrl("analytics"),
  //     ...kafkaEnv("analytics", "analytics-group"),
  //     AUTH_SECRET: authSecret.value,
  //   },
  // });

  createService("ChannelAdapter", {
    dockerfile: "apps/channel-adapter/Dockerfile",
    domainSlug: "channel-adapter",
    port: 3000,
    priority: 120,
    link: [db, mskCluster],
    environment: {
      DATABASE_URL: dbUrl("channel_adapter"),
      ...kafkaEnv("channel-adapter", "channel-adapter-group"),
      CHANNEL_ADAPTER_INTERNAL_KEY: channelAdapterInternalKey.value,
      MEDUSA_API_KEY: medusaApiKey.value,
      MEDUSA_API_URL: url("medusa"),
      MEDUSA_MEMBERSHIP_GROUP_ID: "cusgroup_01KFZ12A1M344F6HKGDV35J28A",
      ALMOND_AUTH_URL: "https://asia-northeast3-almond-auth.cloudfunctions.net/api",
      USER_SERVICE_URL: url("user"),
      NAVER_API_ENDPOINT: "https://dummy.com",
      NAVER_CLIENT_ID: "1",
      NAVER_CLIENT_SECRET: "1",
      COUPANG_ACCESS_KEY: "1",
      COUPANG_SECRET_KEY: "1",
      COUPANG_VENDOR_ID: "1",
      SKIP_VARIANTS_WITHOUT_PRICE: "true",
    },
  });

  // createService("Membership", {
  //   dockerfile: "apps/membership/Dockerfile",
  //   domainSlug: "membership",
  //   port: 3000,
  //   priority: 130,
  //   link: [db, mskCluster],
  //   environment: {
  //     DATABASE_URL: dbUrl("membership"),
  //     ...kafkaEnv("membership", "membership-group"),
  //     WALLET_API_KEY: walletApiKey.value,
  //     WALLET_API_URL: url("wallet"),
  //   },
  // });

  // createService("UgcService", {
  //   dockerfile: "apps/ugc-service/Dockerfile",
  //   domainSlug: "ugc",
  //   port: 3030,
  //   priority: 160,
  //   link: [db, mskCluster],
  //   environment: {
  //     DATABASE_URL: dbUrl("ugc"),
  //     ...kafkaEnv("ugc-service", "ugc-service-group"),
  //     AUTH_SECRET: authSecret.value,
  //     JWT_ISSUER: "almondyoung-auth",
  //   },
  // });

  createService("Wallet", {
    dockerfile: "apps/wallet/Dockerfile",
    domainSlug: "wallet",
    port: 3000,
    priority: 180,
    link: [db, mskCluster],
    environment: {
      DATABASE_URL: dbUrl("wallet"),
      ...kafkaEnv("wallet", "wallet-group"),
      AUTH_SECRET: authSecret.value,
      USER_JWT_SECRET: authSecret.value,
      WALLET_API_KEY: walletApiKey.value,
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
    link: [db, publicBucket, privateBucket, mskCluster],
    environment: {
      DATABASE_URL: dbUrl("file_service"),
      ...kafkaEnv("file-service", "file-service-group"),
      AUTH_SECRET: authSecret.value,
      AWS_REGION: "ap-northeast-2",
      AWS_S3_PUBLIC_BUCKET: publicBucket.name,
      AWS_S3_PRIVATE_BUCKET: privateBucket.name,
      STORAGE_PROVIDER: "S3",
    },
  });

  // createService("Search", {
  //   dockerfile: "apps/search/Dockerfile",
  //   domainSlug: "search",
  //   port: 3000,
  //   priority: 200,
  //   environment: {
  //     OPENSEARCH_NODE: "https://opensearch-demo.up.railway.app",
  //     SEARCH_PRODUCTS_INDEX: "search_products",
  //   },
  // });

  createService("Medusa", {
    dockerfile: "apps/medusa/Dockerfile",
    domainSlug: "medusa",
    port: 9000,
    priority: 210,
    link: [db, redis, medusaAssetBucket],
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
      JWT_SECRET: medusaJwtSecret.value,
      COOKIE_SECRET: medusaCookieSecret.value,
      JWT_EXPIRES_IN: "30d",
      AUTH_SECRET: authSecret.value,
      MEDUSA_API_KEY: medusaApiKey.value,
      // CORS
      STORE_CORS: url("www"),
      ADMIN_CORS: [url("medusa"), "http://localhost:9000"].join(","),
      AUTH_CORS: [url("medusa"), url("www")].join(","),
      // Internal service URLs
      FRONTEND_URL: url("www"),
      USER_SERVICE_URL: url("user"),
      MEDUSA_BACKEND_URL: url("medusa"),
      WALLET_BASE_URL: url("wallet"),
      WALLET_API_KEY: walletApiKey.value,
      ALMOND_PAYMENT_ENDPOINT: url("wallet"),
      MEMBERSHIP_SERVICE_URL: url("membership"),
      UGC_SERVICE_URL: url("ugc"),
      MEDUSA_MEMBERSHIP_GROUP_ID: "cusgroup_01KFZ12A1M344F6HKGDV35J28A",
      // S3 (task role auth — no explicit keys)
      S3_FILE_URL: $interpolate`https://${medusaAssetBucket.name}.s3.ap-northeast-2.amazonaws.com`,
      S3_REGION: "ap-northeast-2",
      S3_BUCKET: medusaAssetBucket.name,
      // Admin & logging
      MEDUSA_ADMIN_ONBOARDING_TYPE: "default",
      LOG_LEVEL: "debug",
    },
  });
}
