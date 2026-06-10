/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { SharedInfra } from "./shared";

export function setup(infra: SharedInfra) {
  const { isDev, db, redis, opensearch, dbUrl, redisUrl, baseDomain, domain, url, kafkaEnv, createService } = infra;

  // storefront/auth-web 등이 BACKEND_DOMAIN + 서비스 서브도메인 규칙으로 백엔드 URL을 조립한다.
  // 즉 root는 stage에 따라 dev. 접두사가 붙는 형태와 동일해야 한다.
  const backendRootDomain = isDev ? `dev.${baseDomain}` : baseDomain;

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

  // storefront가 미인증 보호경로 redirect 대상으로 쓰는 auth-web origin.
  const idpAuthWebUrl = aws.ssm.getParameterOutput({
    name: `/lcnine-auth/${$app.stage}/auth-web-url`,
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
  const custId = new sst.Secret("CustId");
  const swKey = new sst.Secret("SwKey");
  // 무통장입금 안내 계좌 — 결제 화면 노출용. `sst secret set` 으로 stage 별 주입. 미설정 시 화면에 '-' 표시.
  const bankTransferBankName = new sst.Secret("BankTransferBankName", "");
  const bankTransferAccountNumber = new sst.Secret("BankTransferAccountNumber", "");
  const bankTransferAccountHolder = new sst.Secret("BankTransferAccountHolder", "");

  // Medusa
  const medusaJwtSecret = new sst.Secret("MedusaJwtSecret");
  const medusaCookieSecret = new sst.Secret("MedusaCookieSecret");
  // medusa-storefront RP 의 OIDC client_secret. user-service 시드 시 등록된 값과 동일해야 한다.
  const medusaOidcClientSecret = new sst.Secret("MedusaOidcClientSecret");
  // admin-web RP 의 OIDC client_secret. user-service 시드 시 등록된 값과 동일해야 한다.
  const adminWebOidcClientSecret = new sst.Secret("AdminWebOidcClientSecret");
  // wallet-web RP 의 OIDC client_secret. user-service 시드 시 등록된 값과 동일해야 한다.
  const walletWebOidcClientSecret = new sst.Secret("WalletWebOidcClientSecret");

  // Storefront
  const medusaPublishableKey = new sst.Secret("MedusaPublishableKey");
  const storefrontRevalidateSecret = new sst.Secret("StorefrontRevalidateSecret");

  // ═══════════════════════════════════════════
  //  Services
  // ═══════════════════════════════════════════

  createService("Analytics", {
    dockerfile: "apps/analytics/Dockerfile",
    domainSlug: "analytics",
    port: 3040,
    priority: 110,
    link: [db],
    loadBalancerHealth: {
      "3040/http": {
        path: "/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      DATABASE_URL: dbUrl("analytics"),
      ...kafkaEnv("analytics", "analytics-group"),
      AUTH_SECRET: authSecret.value,
      // OIDC: storefront/admin-web 의 RS256 토큰 검증용. JWKS endpoint 는 라이브러리가 자동 파생.
      OIDC_ISSUER_URL: idpUserServiceUrl,
    },
  });

  createService("ChannelAdapter", {
    dockerfile: "apps/channel-adapter/Dockerfile",
    domainSlug: "channel-adapter",
    port: 3000,
    priority: 120,
    link: [db],
    loadBalancerHealth: {
      "3000/http": {
        path: "/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      DATABASE_URL: dbUrl("channel_adapter"),
      // 2026-05-27: this is the intended durable consumer group for channel-adapter.
      // Existing Kafka backlog is disposable, so no offset migration is required.
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
    loadBalancerHealth: {
      "3000/http": {
        path: "/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      DATABASE_URL: dbUrl("membership"),
      ...kafkaEnv("membership", "membership-group"),
      WALLET_API_KEY: walletApiKey.value,
      WALLET_API_URL: url("wallet"),
      // OIDC: storefront 의 RS256 토큰 검증용. (이전엔 hardcoded default 에 의존했지만 정식화됨.)
      OIDC_ISSUER_URL: idpUserServiceUrl,
    },
  });

  createService("Notification", {
    dockerfile: "apps/notification/Dockerfile",
    domainSlug: "notification",
    port: 3000,
    priority: 140,
    link: [db],
    loadBalancerHealth: {
      "3000/http": {
        path: "/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
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
    dockerfile: "apps/core/Dockerfile",
    domainSlug: "core",
    port: 3000,
    priority: 145,
    link: [db],
    loadBalancerHealth: {
      "3000/http": {
        path: "/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      DATABASE_URL: dbUrl("core"),
      ...kafkaEnv("core", "core-group"),
      AUTH_SECRET: authSecret.value,
      JWT_ISSUER: "almondyoung-auth",
      // OIDC: storefront/admin-web 의 RS256 토큰 검증용.
      OIDC_ISSUER_URL: idpUserServiceUrl,
      // 고객 주문 취소 후 Wallet 자동 환불 연결
      WALLET_BASE_URL: url("wallet"),
      WALLET_API_KEY: walletApiKey.value,
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
      // OIDC: storefront 의 RS256 토큰 검증용.
      OIDC_ISSUER_URL: idpUserServiceUrl,
    },
  });

  createService("Wallet", {
    dockerfile: "apps/wallet/Dockerfile",
    domainSlug: "wallet",
    port: 3000,
    priority: 180,
    link: [db],
    loadBalancerHealth: {
      "3000/http": {
        // wallet 의 HealthController 는 @Controller('v1') prefix 로 /v1/health 에 노출됨.
        path: "/v1/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      DATABASE_URL: dbUrl("wallet"),
      ...kafkaEnv("wallet", "wallet-group"),
      AUTH_SECRET: authSecret.value,
      USER_JWT_SECRET: authSecret.value,
      // OIDC: storefront 의 RS256 토큰 검증용 (마이페이지 포인트/빌링 등).
      OIDC_ISSUER_URL: idpUserServiceUrl,
      TOSS_CLIENT_KEY: tossClientKey.value,
      TOSS_SECRET_KEY: tossSecretKey.value,
      NICEPAY_CLIENT_KEY: nicepayClientKey.value,
      NICEPAY_SECRET_KEY: nicepaySecretKey.value,
      WALLET_API_KEY: walletApiKey.value,
      HYOSUNG_CMS_API_URL: isDev ? "https://api-test.hyosungcms.co.kr" : "https://api.hyosungcms.co.kr",
      HYOSUNG_CMS_ADD_URL: isDev ? "https://add-test.hyosungcms.co.kr" : "https://add.hyosungcms.co.kr",
      HYOSUNG_CMS_CUST_KEY: custKey.value,
      HYOSUNG_CMS_CUST_ID: custId.value,
      HYOSUNG_CMS_SW_KEY: swKey.value,
      SERVICE_NAME: "wallet",
      CORS_ORIGINS: `*.${baseDomain}`,
      WALLET_MEDUSA_WEBHOOK_URL: `${url("medusa")}/hooks/payment/pp_almond-payment_almond-payment`,
      // 무통장입금 안내 계좌 — 결제 화면 노출용. 값은 `sst secret set` 으로 주입 (하단 선언부 참고).
      BANK_TRANSFER_BANK_NAME: bankTransferBankName.value,
      BANK_TRANSFER_ACCOUNT_NUMBER: bankTransferAccountNumber.value,
      BANK_TRANSFER_ACCOUNT_HOLDER: bankTransferAccountHolder.value,
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
      // OIDC: storefront/admin-web 의 RS256 토큰 검증용.
      OIDC_ISSUER_URL: idpUserServiceUrl,
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
    loadBalancerHealth: {
      "3000/http": {
        path: "/health",
        interval: "30 seconds",
        timeout: "5 seconds",
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      // TEMP: AWS OpenSearch(VPC) 연결 트러블슈팅 동안 Railway 자체호스팅 인스턴스로 폴백.
      //       복구되면 opensearch.url/username/password 로 되돌릴 것.
      OPENSEARCH_NODE: "https://opensearch-development.up.railway.app",
      SEARCH_PRODUCTS_INDEX: "search_products",
      ...kafkaEnv("search", "search-indexer-group"),
    },
  });

  createService("Medusa", {
    dockerfile: "apps/medusa/Dockerfile",
    domainSlug: "medusa",
    port: 9000,
    priority: 210,
    link: [db, redis],
    // 백필 / 트래픽 대응을 위한 scaling. 끝나면 본 블록을 제거(또는 SST 기본값으로
    // 되돌리기) 후 sst deploy 로 원복할 것 — 비용 누적 방지.
    cpu: "1 vCPU",
    memory: "2 GB",
    scaling: { min: 2, max: 4 },
    buildArgs: {
      VITE_USER_SERVICE_URL: idpUserServiceUrl,
      MEDUSA_BACKEND_URL: url("medusa"),
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
        // ECS Exec — 백필(`yarn medusa exec`) 을 컨테이너 안에서 직접 실행하기 위해 활성화.
        // SST 가 자동으로 task role 에 ssmmessages:* 권한 부여.
        enableExecuteCommand: true,
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
      STORE_CORS: [url("www"), "https://almondyoung.com", "https://www.almondyoung.com", "http://localhost:8001"].join(","),
      ADMIN_CORS: [url("medusa"), "http://localhost:9000"].join(","),
      AUTH_CORS: [url("medusa"), url("www"), "https://almondyoung.com", "https://www.almondyoung.com", "http://localhost:8001"].join(","),
      // Internal service URLs
      FRONTEND_URL: url("www"),
      USER_SERVICE_URL: idpUserServiceUrl,
      MEDUSA_BACKEND_URL: url("medusa"),
      // OIDC: medusa-config.js 는 AUTH_WEB_URL 이 truthy 일 때만 user-service-sso provider 를 등록한다.
      // 아래 5개는 모두 set 되어야 storefront 의 /auth/customer/user-service-sso 가 동작.
      AUTH_WEB_URL: idpAuthWebUrl,
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OIDC_CLIENT_ID: "medusa-storefront",
      OIDC_CLIENT_SECRET: medusaOidcClientSecret.value,
      OIDC_SCOPES: "openid email profile",
      SSO_DEFAULT_CALLBACK_URL: $interpolate`${url("www")}/kr/callback/oidc`,
      WALLET_BASE_URL: url("wallet"),
      WALLET_API_KEY: walletApiKey.value,
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
  // admin-web 자체가 OIDC RP. 빌드 단계의 page-data collection 이 OIDC env 를 required 로 읽으므로,
  // 아래 7개 변수는 누락 시 OpenNext 빌드가 실패한다 (apps/admin-web/src/lib/auth/env.ts 참조).
  new sst.aws.Nextjs("AdminWeb", {
    path: "../../../apps/admin-web",
    domain: { name: domain("admin") },
    environment: {
      AUTH_SECRET: authSecret.value,
      ALMONDYOUNG_API_URL: url("core"),
      MEDUSA_API_URL: url("medusa"),
      MEDUSA_API_KEY: medusaApiKey.value,
      USER_SERVICE_URL: idpUserServiceUrl,
      WALLET_SERVICE_URL: url("wallet"),
      MEMBERSHIP_SERVICE_URL: url("membership"),
      NOTIFICATION_SERVICE_URL: url("notification"),
      CHANNEL_ADAPTER_SERVICE_URL: url("channel-adapter"),
      ADMIN_DOMAIN: domain("admin"),
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OAUTH_ISSUER_URL: idpUserServiceUrl,
      OIDC_AUTHORIZATION_URL: $interpolate`${idpAuthWebUrl}/oauth/authorize`,
      OIDC_CLIENT_ID: "admin-web",
      OIDC_CLIENT_SECRET: adminWebOidcClientSecret.value,
      OIDC_REDIRECT_URI: $interpolate`${url("admin")}/auth/callback`,
      OIDC_POST_LOGOUT_REDIRECT_URI: $interpolate`${url("admin")}/login`,
      OAUTH_JWKS_URL: $interpolate`${idpUserServiceUrl}/.well-known/jwks.json`,
      NEXT_PUBLIC_STOREFRONT_URL: url("www"),
      NEXT_PUBLIC_STOREFRONT_DEFAULT_COUNTRY: "kr",
    },
  });

  // ─── storefront (Next.js / OpenNext, CloudFront) ───
  // Medusa STORE_CORS/AUTH_CORS에 이미 url("www")로 등록되어 있다.
  // 백엔드 서비스 URL은 storefront가 BACKEND_DOMAIN + 서비스 서브도메인 규칙으로 조립한다.
  new sst.aws.Nextjs("Storefront", {
    path: "../../../web/almondyoung-storefront",
    domain: { name: domain("www") },
    environment: {
      NEXT_PUBLIC_BASE_URL: url("www"),
      NEXT_PUBLIC_DEFAULT_REGION: "kr",
      NEXT_PUBLIC_WALLET_WEB_URL: url("wallet-web"),
      NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID: "cusgroup_01KFZ12A1M344F6HKGDV35J28A",
      NEXT_PUBLIC_BACKEND_DOMAIN: backendRootDomain,
      BACKEND_DOMAIN: backendRootDomain,
      NEXT_PUBLIC_USE_RAILWAY_BACKEND: "true",
      USE_RAILWAY_BACKEND: "true",
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: medusaPublishableKey.value,
      REVALIDATE_SECRET: storefrontRevalidateSecret.value,
      // 인증 일원화: auth-web origin + user-service 직접 호출(server-side).
      AUTH_WEB_ORIGIN: idpAuthWebUrl,
      USER_SERVICE_URL: idpUserServiceUrl,
      // restore-token 라우트: OIDC refresh_token grant 로 user-service 토큰 회전.
      // OIDC_CLIENT_ID는 코드 기본값 "medusa-storefront" 사용.
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OIDC_CLIENT_SECRET: medusaOidcClientSecret.value,
      // 형제 서브도메인 간 세션 공유 (auth-web과 동일 값이어야 함).
      PARENT_COOKIE_DOMAIN: `.${baseDomain}`,
      PARENT_COOKIE_SECURE: "true",
      PARENT_COOKIE_SAMESITE: "lax",
      // 레거시 cafe24 마이페이지 redirect.
      NEXT_PUBLIC_LEGACY_ORDER_LIST_URL:
        "https://almondyoung.com/myshop/order/list.html",
      NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL:
        "https://almondyoung.com/myshop/mileage/historyList.html",
    },
  });

  // ─── wallet-web (Next.js / OpenNext, CloudFront) ───
  // wallet-web 자체가 OIDC RP. admin-web 과 동일한 패턴으로 user-service 와 직접 OIDC code-exchange.
  // RP 코드: apps/wallet-web/lib/auth/*, app/login, app/auth/callback, app/api/auth/{refresh,signout}, middleware.ts.
  new sst.aws.Nextjs("WalletWeb", {
    path: "../../../apps/wallet-web",
    domain: { name: domain("wallet-web") },
    environment: {
      NEXT_PUBLIC_WALLET_API_URL: url("wallet"),
      WALLET_API_URL: url("wallet"),
      WALLET_API_KEY: walletApiKey.value,
      TOSS_CLIENT_KEY: tossClientKey.value,
      // OIDC (wallet-web RP). client_id 는 시더와 동일하게 'wallet-web'.
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OIDC_AUTHORIZATION_URL: $interpolate`${idpAuthWebUrl}/oauth/authorize`,
      OIDC_CLIENT_ID: "wallet-web",
      OIDC_CLIENT_SECRET: walletWebOidcClientSecret.value,
      OIDC_REDIRECT_URI: $interpolate`${url("wallet-web")}/auth/callback`,
      OIDC_POST_LOGOUT_REDIRECT_URI: url("wallet-web"),
      OAUTH_JWKS_URL: $interpolate`${idpUserServiceUrl}/.well-known/jwks.json`,
      // 세션 쿠키는 host-only (admin-web 패턴). 다른 RP 와의 세션 공유는 IdP 레벨에서만
      // 일어나며 (auth-web hub 의 parent-domain idp 쿠키), wallet-web 은 자체 도메인에만 토큰을 박는다.
    },
  });
}
