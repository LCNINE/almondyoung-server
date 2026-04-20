/// <reference path="../../.sst/platform/config.d.ts" />

import * as fs from "node:fs";
import * as path from "node:path";
import type { SharedInfra } from "../../infra/shared";

export function setup(infra: SharedInfra) {
  const { vpc, db, redis, dbUrl, redisUrl, baseDomain, url, domain, createService } = infra;

  // ─── Kafka (Redpanda, 단일 노드, EC2 + EBS 영속) ───
  // df 스테이지 비용 절감용. plaintext, VPC 내부 전용. Kafka wire-compatible.
  // Fargate/EFS는 Seastar AIO 미지원이라 불가 → EC2(t4g.micro) + EBS(gp3)로 영속.
  // 인스턴스 교체 시에도 EBS 재부착으로 데이터 유지. DNS는 Cloud Map A record로 등록.

  // Amazon Linux 2023 ARM64 최신 AMI
  const redpandaAmi = aws.ec2.getAmi({
    mostRecent: true,
    owners: ["amazon"],
    filters: [
      { name: "name", values: ["al2023-ami-*-arm64"] },
      { name: "virtualization-type", values: ["hvm"] },
    ],
  });

  // SSM 접근용 IAM role (SSH 키 없이 세션 매니저로 접속 가능)
  const redpandaRole = new aws.iam.Role("RedpandaRole", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { Service: "ec2.amazonaws.com" },
        Action: "sts:AssumeRole",
      }],
    }),
  });
  new aws.iam.RolePolicyAttachment("RedpandaRoleSsm", {
    role: redpandaRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });
  const redpandaInstanceProfile = new aws.iam.InstanceProfile("RedpandaInstanceProfile", {
    role: redpandaRole.name,
  });

  // 공용 subnet[0] 사용 (Docker Hub에서 redpanda 이미지 pull 필요).
  // SG 규칙은 VPC CIDR 내부 ingress만 허용하므로 public IP여도 9092는 외부 차단.
  // EBS는 AZ 귀속이므로 인스턴스도 동일 AZ에 고정.
  const redpandaSubnetId = vpc.nodes.publicSubnets.apply((s) => s[0].id);
  const redpandaAz = vpc.nodes.publicSubnets.apply((s) => s[0].availabilityZone);

  // 영속용 EBS (인스턴스와 별개 리소스 → 인스턴스 교체 시 보존)
  const redpandaEbs = new aws.ebs.Volume("RedpandaData", {
    availabilityZone: redpandaAz,
    size: 10,
    type: "gp3",
    encrypted: true,
  });

  // Redpanda advertise용 Cloud Map DNS (기존 SST 네임스페이스 "sst" 재사용)
  const redpandaDiscovery = new aws.servicediscovery.Service("RedpandaDiscovery", {
    name: `Redpanda.${$app.stage}.${$app.name}`,
    namespaceId: vpc.nodes.cloudmapNamespace.id,
    dnsConfig: {
      namespaceId: vpc.nodes.cloudmapNamespace.id,
      dnsRecords: [{ ttl: 60, type: "A" }],
      routingPolicy: "MULTIVALUE",
    },
  });
  const redpandaDns = `Redpanda.${$app.stage}.${$app.name}.sst`;
  const redpandaBrokers = `${redpandaDns}:9092`;

  // user_data: 외부 스크립트 로드 후 advertise DNS 치환.
  // 스크립트 내용이 바뀌면 userDataReplaceOnChange로 인스턴스 재생성됨.
  // SST는 services.ts를 .sst/platform에 복사한 뒤 실행하므로 __dirname/import.meta.url이
  // 원본 위치를 가리키지 않는다. sst.config.ts가 있는 프로젝트 루트($cli.paths.root)를 기준으로 해석.
  const redpandaUserData = fs
    .readFileSync(path.join($cli.paths.root, "redpanda.cloud-init.sh"), "utf8")
    .replace(/__REDPANDA_ADVERTISE_DNS__/g, redpandaDns);

  const redpandaInstance = new aws.ec2.Instance("Redpanda", {
    ami: redpandaAmi.then((a) => a.id),
    instanceType: "t4g.micro",
    subnetId: redpandaSubnetId,
    availabilityZone: redpandaAz,
    vpcSecurityGroupIds: vpc.securityGroups,
    associatePublicIpAddress: true,
    iamInstanceProfile: redpandaInstanceProfile.name,
    userData: redpandaUserData,
    userDataReplaceOnChange: true,
    // AL2023 AMI 스냅샷이 30GB라 그 이하로 못 줄임.
    rootBlockDevice: { volumeSize: 30, volumeType: "gp3", encrypted: true },
    tags: { Name: `${$app.name}-${$app.stage}-redpanda` },
  });

  new aws.ec2.VolumeAttachment("RedpandaDataAttach", {
    deviceName: "/dev/sdf",
    volumeId: redpandaEbs.id,
    instanceId: redpandaInstance.id,
    stopInstanceBeforeDetaching: true,
  });

  // 인스턴스의 private IP를 Cloud Map에 등록 → redpandaDns 해석 가능
  new aws.servicediscovery.Instance("RedpandaDiscoveryInstance", {
    instanceId: "redpanda-0",
    serviceId: redpandaDiscovery.id,
    attributes: {
      AWS_INSTANCE_IPV4: redpandaInstance.privateIp,
    },
  });

  const kafkaEnv = (prefix: string, groupId: string) => ({
    KAFKA_BROKERS: redpandaBrokers,
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
    link: [db],
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
    link: [db, publicBucket],
    environment: {
      DATABASE_URL: dbUrl("user_service"),
      ...kafkaEnv("user-service", "user-service"),
      AUTH_SECRET: authSecret.value,
      JWT_REFRESH_SECRET: jwtRefreshSecret.value,
      JWT_VERIFICATION_TOKEN_SECRET: jwtVerificationTokenSecret.value,
      COOKIE_DOMAIN: `.${baseDomain}`,
      FRONTEND_URL: url("www"),
      // 이메일 인증 링크는 auth-web의 callback 페이지로 향한다.
      SIGNUP_CALLBACK_URL: `${url("auth")}/callback/signup`,
      USER_SERVICE_URL: url("user"),
      REDIRECT_URL_WHITELIST: [
        "http://localhost:8000/callback/signup",
        "http://localhost:8000/",
        "http://localhost:8000",
        `${url("user")}/`,
        `${url("www")}/`,
        `${url("auth")}/`,
        `${url("auth")}/callback/signup`,
        "http://localhost:8080/",
      ].join(","),
      BIZNO_URL: "https://bizno.net/article",
      CORS_ORIGIN_DOMAINS: [
        url("www"),
        url("medusa"),
        url("admin"),
        url("auth"),
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
    link: [db],
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
    link: [db, publicBucket, privateBucket],
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
      AUTH_WEB_URL: url("auth"),
      SSO_DEFAULT_CALLBACK_URL: $interpolate`${url("www")}/kr/auth/callback`,
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

  // ═══════════════════════════════════════════
  //  Frontends (serverless Next.js via OpenNext)
  // ═══════════════════════════════════════════

  // auth-web: 계정 허브. user-service와 서버 사이드로만 통신한다.
  // parent 도메인(.${baseDomain}) 쿠키는 auth-web이 직접 심는다.
  new sst.aws.Nextjs("AuthWeb", {
    path: "../../web/auth-web",
    domain: { name: domain("auth") },
    environment: {
      USER_SERVICE_URL: url("user"),
      PARENT_COOKIE_DOMAIN: `.${baseDomain}`,
      PARENT_COOKIE_SECURE: "true",
      PARENT_COOKIE_SAMESITE: "lax",
      ALLOWED_REDIRECT_HOSTS: `.${baseDomain}`,
    },
  });

  // wallet-web: 결제/지갑 프론트엔드.
  new sst.aws.Nextjs("WalletWeb", {
    path: "../../apps/wallet-web",
    domain: { name: domain("wallet-web") },
    environment: {
      NEXT_PUBLIC_WALLET_API_URL: url("wallet"),
      USER_SERVICE_URL: url("user"),
      COOKIE_DOMAIN: `.${baseDomain}`,
    },
  });

  // df-admin: Vite 기반 SPA 어드민.
  new sst.aws.StaticSite("DfAdmin", {
    path: "../../web/df-admin",
    domain: { name: domain("admin") },
    build: {
      command: "npm run build",
      output: "dist",
    },
  });

  // df-storefront: Medusa 기반 storefront. www 서브도메인으로 배포.
  new sst.aws.Nextjs("Storefront", {
    path: "../../web/df-storefront",
    domain: { name: domain("www") },
    environment: {
      USERS_SERVICE_URL: url("user"),
      COOKIE_DOMAIN: `.${baseDomain}`,
      MEDUSA_BACKEND_URL: url("medusa"),
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY:
        "pk_af4d36c57b3ad7eef7f337c2f69809dbbaddef6667446ffd1fd3d95b40ad118a",
      NEXT_PUBLIC_WALLET_WEB_URL: url("wallet-web"),
      NEXT_PUBLIC_DEFAULT_REGION: "kr",
    },
  });
}
