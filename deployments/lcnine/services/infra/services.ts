/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { SharedInfra } from './shared';

export function setup(infra: SharedInfra) {
  const {
    isDev,
    vpc,
    cluster,
    db,
    dbUrl,
    baseDomain,
    domain,
    url,
    kafkaEnv,
    serviceDiscoveryName,
    setOtelExporterOtlpEndpoint,
    createService,
    createBundleService,
  } = infra;

  // storefront/auth-web 등이 BACKEND_DOMAIN + 서비스 서브도메인 규칙으로 백엔드 URL을 조립한다.
  // 즉 root는 stage에 따라 dev. 접두사가 붙는 형태와 동일해야 한다.
  const backendRootDomain = isDev ? `dev.${baseDomain}` : baseDomain;

  // storefront 정식 origin. live 에서는 apex(baseDomain)가 정식 도메인이고 www 는 거기로
  // 향하는 301 redirect 인데, CloudFront 의 apex redirect 는 query string 을 버린다
  // (확인: www/...?code&state → apex/... 로 query 유실). OAuth 콜백·revalidate POST 등
  // storefront 를 가리키는 내부 URL 이 www 를 거치면 ?code&state / body 가 사라지므로
  // 반드시 apex 로 직접 가리켜야 한다. dev 는 apex 가 공용 루트라 www 슬롯을 그대로 쓴다.
  const storefrontUrl = isDev ? url('www') : `https://${baseDomain}`;

  // ─── Secrets ───
  const authSecret = new sst.Secret('AuthSecret');
  const awsS3AccessKeyId = new sst.Secret('AwsS3AccessKeyId');
  const awsS3SecretAccessKey = new sst.Secret('AwsS3SecretAccessKey');

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
  const channelAdapterInternalKey = new sst.Secret('ChannelAdapterInternalKey');
  const medusaApiKey = new sst.Secret('MedusaApiKey');

  // Membership — 서버 간(internal) 라우트 인증 키 (channel-adapter/medusa → membership)
  const membershipInternalKey = new sst.Secret('MembershipInternalKey');

  // Notification
  const nhnAppKey = new sst.Secret('NhnAppKey');
  const nhnSecretKey = new sst.Secret('NhnSecretKey');
  const nhnSenderKey = new sst.Secret('NhnSenderKey');
  const resendApiKey = new sst.Secret('ResendApiKey');
  const resendWebhookSecret = new sst.Secret('ResendWebhookSecret');

  // Wallet
  const tossClientKey = new sst.Secret('TossClientKey');
  const tossSecretKey = new sst.Secret('TossSecretKey');
  const nicepayClientKey = new sst.Secret('NicepayClientKey');
  const nicepaySecretKey = new sst.Secret('NicepaySecretKey');
  const walletApiKey = new sst.Secret('WalletApiKey');
  const custKey = new sst.Secret('CustKey');
  const custId = new sst.Secret('CustId');
  const swKey = new sst.Secret('SwKey');
  // 무통장입금 안내 계좌 — 결제 화면 노출용. `sst secret set` 으로 stage 별 주입. 미설정 시 화면에 '-' 표시.
  const bankTransferBankName = new sst.Secret('BankTransferBankName', '');
  const bankTransferAccountNumber = new sst.Secret('BankTransferAccountNumber', '');
  const bankTransferAccountHolder = new sst.Secret('BankTransferAccountHolder', '');
  // 무통장입금 = 토스 가상계좌. bank: 토스에 넘길 두 자리 은행 코드(계약 은행), name: 고객 표시명.
  const tossVirtualAccountBank = new sst.Secret('TossVirtualAccountBank', '');
  const tossVirtualAccountBankName = new sst.Secret('TossVirtualAccountBankName', '');

  // Medusa
  const medusaJwtSecret = new sst.Secret('MedusaJwtSecret');
  const medusaCookieSecret = new sst.Secret('MedusaCookieSecret');
  // medusa-storefront RP 의 OIDC client_secret. user-service 시드 시 등록된 값과 동일해야 한다.
  const medusaOidcClientSecret = new sst.Secret('MedusaOidcClientSecret');
  // admin-web RP 의 OIDC client_secret. user-service 시드 시 등록된 값과 동일해야 한다.
  const adminWebOidcClientSecret = new sst.Secret('AdminWebOidcClientSecret');
  // wallet-web RP 의 OIDC client_secret. user-service 시드 시 등록된 값과 동일해야 한다.
  const walletWebOidcClientSecret = new sst.Secret('WalletWebOidcClientSecret');

  // Storefront
  const medusaPublishableKey = new sst.Secret('MedusaPublishableKey');
  const storefrontRevalidateSecret = new sst.Secret('StorefrontRevalidateSecret');

  // Grafana Cloud
  const grafanaCloudApiToken = new sst.Secret('GrafanaCloudApiToken');
  const grafanaCloudPrometheusRemoteWriteUrl = new sst.Secret(
    'GrafanaCloudPrometheusRemoteWriteUrl',
    'https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/push',
  );
  const grafanaCloudPrometheusUsername = new sst.Secret('GrafanaCloudPrometheusUsername', '3066614');
  const grafanaCloudTempoOtlpEndpoint = new sst.Secret(
    'GrafanaCloudTempoOtlpEndpoint',
    'tempo-prod-20-prod-ap-northeast-0.grafana.net:443',
  );
  const grafanaCloudTempoUsername = new sst.Secret('GrafanaCloudTempoUsername', '1523287');

  // Next.js(서버리스) 앱은 VPC 밖 Lambda 라 내부 Alloy(CloudMap)에 닿지 못한다.
  // → Grafana Cloud OTLP 게이트웨이로 직접 전송한다. 자격증명은 traces write-only 전용
  //   Access Policy 토큰을 따로 발급해 Alloy 의 풀스코프 토큰과 분리한다 (blast radius 격리).
  //   auth 헤더(Basic base64(instanceId:token))는 각 앱 instrumentation 에서 조립한다.
  const grafanaCloudOtlpEndpoint = new sst.Secret(
    'GrafanaCloudOtlpEndpoint',
    'https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp',
  );
  const grafanaCloudWebOtlpInstanceId = new sst.Secret('GrafanaCloudWebOtlpInstanceId');
  const grafanaCloudWebOtlpToken = new sst.Secret('GrafanaCloudWebOtlpToken');

  // Loki(로그). Alloy 가 OTLP 로그를 받아 Grafana Cloud Loki 의 OTLP 엔드포인트로 보낸다.
  // username 은 Loki 전용 instance ID(Tempo/Prometheus 와 다른 값) — Grafana Cloud 의
  // Loki "OTLP" 설정 화면에 표시됨. 비밀번호는 기존 GRAFANA_CLOUD_API_TOKEN 재사용
  // (Access Policy 에 logs:write scope 필요). endpoint 는 zone 을 모르므로 default 없이
  // 강제 set — 미설정 시 deploy 실패로 잘못된 곳에 silent 전송되는 사고를 막는다.
  const grafanaCloudLokiOtlpEndpoint = new sst.Secret('GrafanaCloudLokiOtlpEndpoint');
  const grafanaCloudLokiUsername = new sst.Secret('GrafanaCloudLokiUsername');

  const alloy = new sst.aws.Service('Observability', {
    cluster,
    cpu: '0.25 vCPU',
    memory: '0.5 GB',
    scaling: { min: 1, max: 1 },
    serviceRegistry: { port: 4318 },
    image: {
      context: '../../../',
      dockerfile: 'deployments/lcnine/services/observability/alloy/Dockerfile',
    },
    environment: {
      SST_STAGE: $app.stage,
      GRAFANA_CLOUD_API_TOKEN: grafanaCloudApiToken.value,
      GRAFANA_CLOUD_PROMETHEUS_REMOTE_WRITE_URL: grafanaCloudPrometheusRemoteWriteUrl.value,
      GRAFANA_CLOUD_PROMETHEUS_USERNAME: grafanaCloudPrometheusUsername.value,
      GRAFANA_CLOUD_TEMPO_OTLP_ENDPOINT: grafanaCloudTempoOtlpEndpoint.value,
      GRAFANA_CLOUD_TEMPO_USERNAME: grafanaCloudTempoUsername.value,
      GRAFANA_CLOUD_LOKI_OTLP_ENDPOINT: grafanaCloudLokiOtlpEndpoint.value,
      GRAFANA_CLOUD_LOKI_USERNAME: grafanaCloudLokiUsername.value,
      CORE_METRICS_TARGET: $interpolate`${serviceDiscoveryName('Core')}:3000`,
    },
    transform: {
      service: (args: Record<string, any>) => {
        args.networkConfiguration = vpc.privateSubnets.apply((subnets) =>
          vpc.securityGroups.apply((sgs) => ({
            assignPublicIp: false,
            subnets,
            securityGroups: sgs,
          })),
        );
      },
    },
  });

  setOtelExporterOtlpEndpoint($interpolate`http://${alloy.service}:4318`);

  // ═══════════════════════════════════════════
  //  Services
  // ═══════════════════════════════════════════

  // ═══════════════════════════════════════════
  //  ServicesBundle — 경량 서비스 6개를 Fargate 태스크 2개(3+3)에 통합 (비용 절감)
  // ═══════════════════════════════════════════
  // 개별 태스크 6개(Analytics/ChannelAdapter/Membership/Notification/UgcService/Search) 통합.
  // ECS service 는 LB 설정(타깃그룹)을 **최대 5개**만 허용 → 6개를 한 서비스에 못 붙인다.
  // 그래서 3+3 으로 나눈 태스크 2개(ServicesBundleA/B). 비용 동일: 2×(0.25vCPU/1GB)=0.5vCPU/2GB.
  // 각 태스크는 BUNDLE_APPS(dir 목록) env 로 담당 앱만 실행하고 같은 이미지/supervisor 를 공유한다.
  // 각 앱 env 를 `<PREFIX>__KEY` 로 병합 → 컨테이너 안 supervisor.mjs 가 프리픽스를 벗겨 앱별 프로세스에
  // 주입. 외부 URL/Kafka group/OTEL_SERVICE_NAME 전부 유지(클라 무변경).
  // priority 211~216: Pulumi 는 create-before-delete 라 현재 AWS 에 존재하는 어떤 룰과도 안 겹쳐야
  // 배포가 안 깨진다. 존재 목록 = 옛 개별서비스(110~200) + keeper(145/180/190/210) + 직전 실패 배포가
  // 남긴 partial ServicesBundle 룰(301~306, 타깃없어 503). 211~216 은 전부 비어있고 위치가 중요:
  //  - keeper 최대(210)보다 커서 배포 중 옛 서비스(110~200)가 healthy 로 계속 서빙(A/B 부팅 무중단).
  //  - 301~306(dead)보다 작아 옛것 삭제 시 dead partial 룰을 건너뛰고 A/B 로 seamless 전환(503 없음).
  // 각 룰은 고유 hostHeader 매칭이라 번호 자체의 순서 의미는 없고 "겹침 회피 + 위치"만 중요.
  // 문제 앱만 다시 개별 createService() 로 떼어내면 부분 롤백 가능 (docs 설계 §6).
  const withPrefix = (prefix: string, env: Record<string, $util.Output<string> | string>) =>
    Object.fromEntries(Object.entries(env).map(([k, v]) => [`${prefix}__${k}`, v]));

  // 멤버십 인보이스(선적용) 정기결제 게이트. 서버(membership)와 프론트(storefront)가 같은 값이어야
  // 반배포(프론트 ON·서버 OFF → PENDING 계좌 가입 400 전멸)를 피한다 — 한 상수에서 파생한다.
  // NEXT_PUBLIC_* 는 storefront 빌드타임 주입이므로 값 변경 시 storefront 재배포가 필요하다.
  // 활성화는 이 값을 'true' 로 바꾸는 것으로 일원화한다(현재 미개통).
  const invoiceBillingEnabled = 'true';

  // 앱별 env (프리픽스 부여). 태스크에는 담당 앱 것만 병합해 넘긴다.
  const analyticsEnv = withPrefix('ANALYTICS', {
    DATABASE_URL: dbUrl('analytics'),
    ...kafkaEnv('analytics', 'analytics-group'),
    AUTH_SECRET: authSecret.value,
    OIDC_ISSUER_URL: idpUserServiceUrl,
  });
  const channelAdapterEnv = withPrefix('CHANNEL_ADAPTER', {
    DATABASE_URL: dbUrl('channel_adapter'),
    ...kafkaEnv('channel-adapter', 'channel-adapter-group'),
    CHANNEL_ADAPTER_INTERNAL_KEY: channelAdapterInternalKey.value,
    MEMBERSHIP_INTERNAL_KEY: membershipInternalKey.value,
    MEDUSA_API_KEY: medusaApiKey.value,
    MEDUSA_API_URL: url('medusa'),
    MEDUSA_MEMBERSHIP_GROUP_ID: 'cusgroup_01KFZ12A1M344F6HKGDV35J28A',
    STOREFRONT_REVALIDATE_URL: $interpolate`${storefrontUrl}/api/revalidate`,
    STOREFRONT_REVALIDATE_SECRET: storefrontRevalidateSecret.value,
    ALMOND_AUTH_URL: 'https://asia-northeast3-almond-auth.cloudfunctions.net/api',
    MEMBERSHIP_SERVICE_URL: url('membership'),
    USER_SERVICE_URL: idpUserServiceUrl,
    PIM_API_URL: url('core'),
    NAVER_API_ENDPOINT: 'https://dummy.com',
    NAVER_CLIENT_ID: '1',
    NAVER_CLIENT_SECRET: '1',
    COUPANG_ACCESS_KEY: '1',
    COUPANG_SECRET_KEY: '1',
    COUPANG_VENDOR_ID: '1',
    SKIP_VARIANTS_WITHOUT_PRICE: 'true',
    // ⚠️ 이 값을 올리면 느려진다. 직관과 반대라 실측을 남긴다 (2026-07-22, live).
    //   동시성 1 / 10초 → 분당  6건, Medusa CPU 47~72%
    //   동시성 3 /  3초 → 분당 20건, Medusa CPU 90~93%  ← 포화
    //   동시성 2 /  3초 → 분당 40건, Medusa CPU 32%     ← 가장 빠르고 가장 안전
    // 처리량 상한을 정하는 건 이 설정이 아니라 Medusa 의 1 vCPU 다. 동시 3 이면 요청들이
    // 서로 CPU 를 뺏어 요청당 시간이 늘고 총량이 오히려 줄었다(혼잡 붕괴). Medusa 는
    // valkey 사이드카 탓에 scaling max 1 이라 스케일아웃으로 못 푼다.
    // 더 빠르게 하려면 여기가 아니라 Medusa 를 키우거나(valkey 분리 선행) 호출 수를 줄여야 한다.
    INBOX_MAX_CONCURRENT_HANDLERS: '2',
    INBOX_HANDLER_START_INTERVAL_MS: '3000',
    INBOX_PROCESSING_LEASE_MS: '900000',
    INBOX_SHUTDOWN_DRAIN_MS: '25000',
  });
  const membershipEnv = withPrefix('MEMBERSHIP', {
    DATABASE_URL: dbUrl('membership'),
    ...kafkaEnv('membership', 'membership-group'),
    WALLET_API_KEY: walletApiKey.value,
    WALLET_API_URL: url('wallet'),
    MEMBERSHIP_INTERNAL_KEY: membershipInternalKey.value,
    MEMBERSHIP_INVOICE_BILLING_ENABLED: invoiceBillingEnabled,
    OIDC_ISSUER_URL: idpUserServiceUrl,
  });
  const notificationEnv = withPrefix('NOTIFICATION', {
    DATABASE_URL: dbUrl('notification'),
    ...kafkaEnv('notification', 'notification-group'),
    NHN_API_URL: 'https://api-alimtalk.cloud.toast.com',
    NHN_APP_KEY: nhnAppKey.value,
    NHN_SECRET_KEY: nhnSecretKey.value,
    NHN_SENDER_KEY: nhnSenderKey.value,
    NHN_PLUS_FRIEND_ID: '@아몬드영',
    RESEND_API_KEY: resendApiKey.value,
    RESEND_BASE_URL: 'https://api.resend.com',
    RESEND_FROM: `noreply@mail.${baseDomain}`,
    RESEND_FROM_NAME: '아몬드영',
    RESEND_WEBHOOK_SECRET: resendWebhookSecret.value,
  });
  const ugcEnv = withPrefix('UGC', {
    DATABASE_URL: dbUrl('ugc'),
    ...kafkaEnv('ugc-service', 'ugc-service-group'),
    AUTH_SECRET: authSecret.value,
    JWT_ISSUER: 'almondyoung-auth',
    OIDC_ISSUER_URL: idpUserServiceUrl,
  });
  const searchEnv = withPrefix('SEARCH', {
    // search 백엔드는 Railway OpenSearch. AWS OpenSearch 도메인은 미사용으로 제거됨 (shared.ts 참조).
    OPENSEARCH_NODE: 'https://opensearch-development.up.railway.app',
    SEARCH_PRODUCTS_INDEX: 'search_products',
    ...kafkaEnv('search', 'search-indexer-group'),
  });

  // 태스크 A: analytics + channel-adapter + membership (타깃그룹 3개 ≤ 5)
  createBundleService('ServicesBundleA', {
    architecture: 'arm64',
    dockerfile: 'deployments/lcnine/services/bundle/Dockerfile',
    cpu: '0.25 vCPU',
    memory: '1 GB',
    scaling: { min: 1, max: 1 },
    link: [db],
    apps: [
      { slug: 'analytics', port: 3040, priority: 211 },
      { slug: 'channel-adapter', port: 3001, priority: 212 },
      { slug: 'membership', port: 3002, priority: 213 },
    ],
    environment: {
      BUNDLE_APPS: 'analytics,channel-adapter,membership',
      ...analyticsEnv,
      ...channelAdapterEnv,
      ...membershipEnv,
    },
  });

  // 태스크 B: notification + search + ugc (타깃그룹 3개 ≤ 5)
  createBundleService('ServicesBundleB', {
    architecture: 'arm64',
    dockerfile: 'deployments/lcnine/services/bundle/Dockerfile',
    cpu: '0.25 vCPU',
    memory: '1 GB',
    scaling: { min: 1, max: 1 },
    link: [db],
    apps: [
      { slug: 'notification', port: 3003, priority: 214 },
      { slug: 'search', port: 3004, priority: 215 },
      { slug: 'ugc', port: 3030, priority: 216 },
    ],
    environment: {
      BUNDLE_APPS: 'notification,search,ugc-service',
      ...notificationEnv,
      ...searchEnv,
      ...ugcEnv,
    },
  });

  createService('Core', {
    // arm64(Graviton) Fargate — 동일 성능에 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    architecture: 'arm64',
    dockerfile: 'apps/core/Dockerfile',
    domainSlug: 'core',
    port: 3000,
    priority: 145,
    link: [db],
    loadBalancerHealth: {
      '3000/http': {
        path: '/health',
        interval: '30 seconds',
        timeout: '5 seconds',
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      DATABASE_URL: dbUrl('core'),
      ...kafkaEnv('core', 'core-group'),
      // 출고 워크플로 스위치. 값은 `maintenance | v2` 뿐이고 **기본값이 없다** — 미설정이면 어느
      // 환경이든 startup 실패다 (apps/core/src/config/env.validation.ts). `legacy` 는 V1 출고 경로와
      // 함께 Task 25 에서 제거됐으므로 옛 값을 넣으면 부팅하지 않는다. 이 줄을 지워도 마찬가지다.
      // 전환에는 재배포가 필요하다 (FulfillmentWorkflowGate 가 생성자에서 한 번만 읽음).
      // 절차: docs/runbooks/outbound-v2-cutover.md
      FULFILLMENT_WORKFLOW_MODE: 'v2',
      // 불변 커토버 시각. 이 시각 **이후에 생성된 새 주문만** FO + 최초 Draft shipment 를 만든다.
      // 이전 주문은 Kafka 로 재전달돼도 backlog 를 만들지 않는다 (replay 가드 — 도메인 시각 기준이지
      // 재전달 시각 기준이 아니다). 그러므로 이 값을 과거로 늘리면 가드가 무력화된다.
      //
      // ⚠️ 배포 전 확정 필요: 한 번 정하면 바꾸지 않는다. 이 시각 이전에 들어온 주문은 FO 가 없고
      //    자동 backfill 도 하지 않으므로, 나중에 출고하려면 수동 예외 처리가 된다.
      FULFILLMENT_V2_CUTOVER_AT: '2026-07-16T00:00:00.000Z',
      AUTH_SECRET: authSecret.value,
      JWT_ISSUER: 'almondyoung-auth',
      // OIDC: storefront/admin-web 의 RS256 토큰 검증용.
      OIDC_ISSUER_URL: idpUserServiceUrl,
      // 고객 주문 취소 후 Wallet 자동 환불 연결
      WALLET_BASE_URL: url('wallet'),
      WALLET_API_KEY: walletApiKey.value,
      // 디지털 자산 다운로드: library ownership 다운로드 시 file-service signed URL 호출
      FILE_SERVICE_URL: url('file'),
    },
  });

  createService('Wallet', {
    // arm64(Graviton) Fargate — 동일 성능에 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    architecture: 'arm64',
    dockerfile: 'apps/wallet/Dockerfile',
    domainSlug: 'wallet',
    port: 3000,
    priority: 180,
    link: [db],
    loadBalancerHealth: {
      '3000/http': {
        // wallet 의 HealthController 는 @Controller('v1') prefix 로 /v1/health 에 노출됨.
        path: '/v1/health',
        interval: '30 seconds',
        timeout: '5 seconds',
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      DATABASE_URL: dbUrl('wallet'),
      ...kafkaEnv('wallet', 'wallet-group'),
      AUTH_SECRET: authSecret.value,
      USER_JWT_SECRET: authSecret.value,
      // OIDC: storefront 의 RS256 토큰 검증용 (마이페이지 포인트/빌링 등).
      OIDC_ISSUER_URL: idpUserServiceUrl,
      TOSS_CLIENT_KEY: tossClientKey.value,
      TOSS_SECRET_KEY: tossSecretKey.value,
      NICEPAY_CLIENT_KEY: nicepayClientKey.value,
      NICEPAY_SECRET_KEY: nicepaySecretKey.value,
      WALLET_API_KEY: walletApiKey.value,
      HYOSUNG_CMS_API_URL: isDev ? 'https://api-test.hyosungcms.co.kr' : 'https://api.hyosungcms.co.kr',
      HYOSUNG_CMS_ADD_URL: isDev ? 'https://add-test.hyosungcms.co.kr' : 'https://add.hyosungcms.co.kr',
      HYOSUNG_CMS_CUST_KEY: custKey.value,
      HYOSUNG_CMS_CUST_ID: custId.value,
      HYOSUNG_CMS_SW_KEY: swKey.value,
      SERVICE_NAME: 'wallet',
      CORS_ORIGINS: `*.${baseDomain}`,
      WALLET_MEDUSA_WEBHOOK_URL: `${url('medusa')}/hooks/payment/pp_almond-payment_almond-payment`,
      // 무통장입금 안내 계좌 — 결제 화면 노출용. 값은 `sst secret set` 으로 주입 (하단 선언부 참고).
      BANK_TRANSFER_BANK_NAME: bankTransferBankName.value,
      BANK_TRANSFER_ACCOUNT_NUMBER: bankTransferAccountNumber.value,
      BANK_TRANSFER_ACCOUNT_HOLDER: bankTransferAccountHolder.value,
      // 무통장입금 = 토스 가상계좌 발급/자동확인. bank 코드 미설정 시 provider 가 명확히 FAILED 반환.
      TOSS_VIRTUAL_ACCOUNT_BANK: tossVirtualAccountBank.value,
      TOSS_VIRTUAL_ACCOUNT_BANK_NAME: tossVirtualAccountBankName.value,
      // 무통장 입금 대기 만료 윈도우(시간). 미설정 시 코드 기본값 72h.
      // 입금확인을 수동으로 하고 주말/연휴가 있어, 입금했는데 자동취소되는 사고를 막기 위해 7일(168h)로 설정.
      WALLET_BANK_TRANSFER_DEPOSIT_WINDOW_HOURS: '168',
    },
  });

  createService('FileService', {
    // arm64(Graviton) Fargate — 동일 성능에 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    architecture: 'arm64',
    dockerfile: 'apps/file-service/Dockerfile',
    domainSlug: 'file',
    port: 3000,
    priority: 190,
    link: [db],
    environment: {
      DATABASE_URL: dbUrl('file_service'),
      ...kafkaEnv('file-service', 'file-service-group'),
      AUTH_SECRET: authSecret.value,
      // OIDC: storefront/admin-web 의 RS256 토큰 검증용.
      OIDC_ISSUER_URL: idpUserServiceUrl,
      AWS_ACCESS_KEY_ID: awsS3AccessKeyId.value,
      AWS_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
      AWS_REGION: 'ap-northeast-2',
      AWS_S3_PUBLIC_BUCKET: 'almondyoung-demo',
      AWS_S3_PRIVATE_BUCKET: 'almondyoung-demo',
      STORAGE_PROVIDER: 'S3',
    },
  });

  createService('Medusa', {
    // arm64(Graviton) Fargate — 동일 성능에 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    architecture: 'arm64',
    dockerfile: 'apps/medusa/Dockerfile',
    domainSlug: 'medusa',
    port: 9000,
    priority: 210,
    link: [db],
    // 운영 기본 용량. 백필/이벤트 대응 시 일시적으로 올리고, 끝나면 원복한다.
    // 0.5 → 1 vCPU: 스케일아웃(max 2) 대신 수직 확장. valkey 사이드카가 태스크 로컬
    // 상태(세션 + BullMQ 큐)라 태스크가 2개면 세션 공유가 깨지고 큐도 갈라진다.
    cpu: '1 vCPU',
    // 1 GB → 2 GB: valkey 사이드카(256MB cap) 동거분 확보. 메모리 0.5GB당 ~$1.5/월이라
    // ElastiCache 제거(-$17.5/월) 대비 미미. Medusa 단독 시절 1GB 로 돌았음을 참고.
    memory: '2 GB',
    // max 1 고정: valkey 가 사이드카인 한 스케일아웃 금지 (위 cpu 주석 참조).
    scaling: { min: 1, max: 1 },
    // ElastiCache 대체: 같은 태스크의 valkey 사이드카 (shared.ts 의 Redis 제거 주석 참조).
    // - noeviction: event-bus/workflow-engine 이 BullMQ 큐로 쓰므로 키 eviction 은 유실 사고.
    //   가득 차면 쓰기 에러가 나게 두는 편이 안전 (256MB, 데모 트래픽 기준 여유).
    // - appendonly no + save '': 디스크 영속 불필요 (재시작 유실 허용이 이 설계의 전제).
    sidecars: [
      {
        name: 'valkey',
        image: 'valkey/valkey:8-alpine',
        command: [
          'valkey-server',
          '--maxmemory',
          '256mb',
          '--maxmemory-policy',
          'noeviction',
          '--appendonly',
          'no',
          '--save',
          '',
        ],
      },
    ],
    buildArgs: {
      VITE_USER_SERVICE_URL: idpUserServiceUrl,
      MEDUSA_BACKEND_URL: url('medusa'),
    },
    loadBalancerHealth: {
      '9000/http': {
        path: '/health',
        interval: '30 seconds',
        timeout: '5 seconds',
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
      // product_sort_index.review_count 주기 동기화(sync-product-sort-index)가 ugc 리뷰 수를 읽는 소스.
      UGC_SOURCE_DB_URL: $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/ugc?sslmode=disable`,
      // valkey 사이드카 (같은 태스크, localhost). DB 인덱스 분리는 ElastiCache 시절과 동일.
      REDIS_URL: 'redis://localhost:6379/0',
      CACHE_REDIS_URL: 'redis://localhost:6379/1',
      MEDUSA_FF_CACHING: 'true',
      // Auth
      JWT_SECRET: medusaJwtSecret.value,
      COOKIE_SECRET: medusaCookieSecret.value,
      JWT_EXPIRES_IN: '30d',
      // TEMP(시연용): my-auth provider가 user-service 발급 토큰을 jwt.verify하므로
      // IdP 스택의 AUTH_SECRET과 동일한 값을 주입.
      AUTH_SECRET: idpAuthSecret,
      MEDUSA_API_KEY: medusaApiKey.value,
      // CORS
      STORE_CORS: [
        // 컷오버 후 storefront 정식 origin = apex(almondyoung.com). www 는 apex 로 301.
        storefrontUrl,
        url('www'),
        'http://localhost:8001',
      ].join(','),
      ADMIN_CORS: [url('medusa'), 'http://localhost:9000'].join(','),
      AUTH_CORS: [url('medusa'), storefrontUrl, url('www'), 'http://localhost:8001'].join(','),
      // Internal service URLs
      FRONTEND_URL: storefrontUrl,
      USER_SERVICE_URL: idpUserServiceUrl,
      MEDUSA_BACKEND_URL: url('medusa'),
      // OIDC: medusa-config.js 는 AUTH_WEB_URL 이 truthy 일 때만 user-service-sso provider 를 등록한다.
      // 아래 5개는 모두 set 되어야 storefront 의 /auth/customer/user-service-sso 가 동작.
      AUTH_WEB_URL: idpAuthWebUrl,
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OIDC_CLIENT_ID: 'medusa-storefront',
      OIDC_CLIENT_SECRET: medusaOidcClientSecret.value,
      OIDC_SCOPES: 'openid email profile',
      SSO_DEFAULT_CALLBACK_URL: $interpolate`${storefrontUrl}/kr/callback/oidc`,
      WALLET_BASE_URL: url('wallet'),
      WALLET_API_KEY: walletApiKey.value,
      ALMOND_PAYMENT_ENDPOINT: url('wallet'),
      MEMBERSHIP_SERVICE_URL: url('membership'),
      MEMBERSHIP_INTERNAL_KEY: membershipInternalKey.value,
      UGC_SERVICE_URL: url('ugc'),
      MEDUSA_MEMBERSHIP_GROUP_ID: 'cusgroup_01KFZ12A1M344F6HKGDV35J28A',
      // S3
      S3_FILE_URL: 'https://almondyoung-medusa-digital-asset.s3.ap-northeast-2.amazonaws.com',
      S3_ACCESS_KEY_ID: awsS3AccessKeyId.value,
      S3_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
      S3_REGION: 'ap-northeast-2',
      S3_BUCKET: 'almondyoung-medusa-digital-asset',
      // Admin & logging
      MEDUSA_ADMIN_ONBOARDING_TYPE: 'default',
      LOG_LEVEL: 'info',
    },
  });

  // ─── admin-web (Next.js / OpenNext, CloudFront) ───
  // admin-web 자체가 OIDC RP. 빌드 단계의 page-data collection 이 OIDC env 를 required 로 읽으므로,
  // 아래 7개 변수는 누락 시 OpenNext 빌드가 실패한다 (apps/admin-web/src/lib/auth/env.ts 참조).
  new sst.aws.Nextjs('AdminWeb', {
    path: '../../../apps/admin-web',
    // arm64(Graviton) Lambda — server 함수 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    // (image optimizer 는 SST 가 항상 arm64 로 빌드.)
    server: { architecture: 'arm64' },
    domain: { name: domain('admin') },
    environment: {
      AUTH_SECRET: authSecret.value,
      ALMONDYOUNG_API_URL: url('core'),
      MEDUSA_API_URL: url('medusa'),
      MEDUSA_API_KEY: medusaApiKey.value,
      USER_SERVICE_URL: idpUserServiceUrl,
      WALLET_SERVICE_URL: url('wallet'),
      MEMBERSHIP_SERVICE_URL: url('membership'),
      NOTIFICATION_SERVICE_URL: url('notification'),
      CHANNEL_ADAPTER_SERVICE_URL: url('channel-adapter'),
      FILE_SERVICE_URL: url('file'),
      UGC_SERVICE_URL: url('ugc'),
      ADMIN_DOMAIN: domain('admin'),
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OAUTH_ISSUER_URL: idpUserServiceUrl,
      OIDC_AUTHORIZATION_URL: $interpolate`${idpAuthWebUrl}/oauth/authorize`,
      OIDC_CLIENT_ID: 'admin-web',
      OIDC_CLIENT_SECRET: adminWebOidcClientSecret.value,
      OIDC_REDIRECT_URI: $interpolate`${url('admin')}/auth/callback`,
      OIDC_POST_LOGOUT_REDIRECT_URI: $interpolate`${url('admin')}/login`,
      OAUTH_JWKS_URL: $interpolate`${idpUserServiceUrl}/.well-known/jwks.json`,
      NEXT_PUBLIC_STOREFRONT_URL: storefrontUrl,
      NEXT_PUBLIC_STOREFRONT_DEFAULT_COUNTRY: 'kr',
      // OTEL: Lambda(VPC 밖)라 Alloy 우회, Grafana Cloud OTLP 게이트웨이로 직접 전송.
      OTEL_SERVICE_NAME: 'admin-web',
      OTEL_EXPORTER_OTLP_ENDPOINT: grafanaCloudOtlpEndpoint.value,
      GRAFANA_OTLP_INSTANCE_ID: grafanaCloudWebOtlpInstanceId.value,
      GRAFANA_OTLP_TOKEN: grafanaCloudWebOtlpToken.value,
    },
  });

  // ─── storefront IP 차단 (CloudFront Function) ───
  // 레거시 cafe24 상점/보안 설정에서 차단하던 IP를 뉴 아몬드영 스토어프론트에도 동일 적용.
  // 원래 WAF(WebACL + IPSet)였으나 고정비($5+룰$1)+요청당 과금으로 월 ~$20 → SST 가 어차피
  // 만드는 viewer-request CloudFront Function 에 코드 주입(injection)으로 대체 (요청 1M당
  // $0.10, 월 2M 무료). 차단 목록 변경 시 아래 배열만 수정해 재배포.
  const storefrontBlockedIps = ['211.252.157.13', '210.95.250.112', '210.90.35.236'];

  // 정부/공공 대역 통째 차단 (KRNIC whois 확인):
  //   152.99.0.0/16   NIRS(국가정보자원관리원) — 전통적 "정부망" 대표 대역
  //   125.60.0.0/18   NIRS 정부 공통망 (125.60.0.0 ~ 125.60.63.255, 3옥텟 ≤63)
  //   210.220.0.0/19  DACOM-PUBNETPLUS 공공기관 전용망 (210.220.0.0 ~ 210.220.31.255, 3옥텟 ≤31)
  // 식약처/환경부 등 중앙부처가 이 공통망 뒤로 나오므로 개별 IP 대신 대역으로 막는다.
  //
  // 차단된 IP는 console.log 로 남긴다 → CloudFront Function 로그는 us-east-1 CloudWatch
  // Logs 그룹 `/aws/cloudfront/function/<함수명>` 으로 자동 전송된다. 차단(403)된 요청만
  // 기록되므로 S3 액세스 로그(전체 트래픽) 없이도 "차단 IP 실제 유입" 여부를 조회 가능.
  const storefrontBlockIpInjection = `
  var __ip = event.viewer.ip;
  var __t = parseInt(__ip.split(".")[2], 10);
  var __blocked =
    ${JSON.stringify(storefrontBlockedIps)}.includes(__ip) ||
    (__ip.indexOf("152.99.") === 0) ||
    (__ip.indexOf("125.60.") === 0 && __t <= 63) ||
    (__ip.indexOf("210.220.") === 0 && __t <= 31);
  if (__blocked) {
    console.log("STOREFRONT_BLOCKED_IP " + __ip);
    return { statusCode: 403, statusDescription: "Forbidden" };
  }`;

  // ─── storefront 액세스 로그 (정부망 IP '발견'용, live 전용) ───
  // 위 차단 Function 은 "이미 막은 IP"만 CloudWatch 에 남긴다. 아직 blocklist 에 없는
  // 정부망(.go.kr 등) IP 를 새로 발견하려면 전체 트래픽의 client IP 가 필요 →
  // CloudFront 표준 액세스 로그를 S3 로 남긴다. 발견 워크플로:
  //   BUCKET=<이 버킷명> scripts/find-gov-ips.sh  → c-ip 를 역DNS 조회해 .go.kr PTR 만 추림
  //   → 후보 IP 의 /24 를 위 storefrontBlockedIps 에 추가 후 재배포.
  // dev(.dev.lcnine-dev.com)엔 정부기관이 올 일이 없어 !isDev 로만 켠다.
  // 표준 로깅은 CloudFront 가 ACL 로 객체를 전달하므로 버킷에 ACL 이 켜져 있어야 한다
  // (sst.aws.Bucket 은 BucketOwnerEnforced=ACL off) → raw BucketV2 + BucketOwnerPreferred.
  let storefrontCdnTransform: ((cdnArgs: Record<string, any>) => void) | undefined;
  if (!isDev) {
    const logBucket = new aws.s3.BucketV2('StorefrontAccessLogs', { forceDestroy: true });
    new aws.s3.BucketOwnershipControls('StorefrontAccessLogsOwnership', {
      bucket: logBucket.id,
      rule: { objectOwnership: 'BucketOwnerPreferred' },
    });
    // 발견 목적이라 장기보관 불필요 — 90일 후 만료로 저장비 방치 방지.
    new aws.s3.BucketLifecycleConfigurationV2('StorefrontAccessLogsLifecycle', {
      bucket: logBucket.id,
      rules: [{ id: 'expire', status: 'Enabled', expiration: { days: 90 } }],
    });
    storefrontCdnTransform = (cdnArgs) => {
      cdnArgs.transform = {
        ...(cdnArgs.transform ?? {}),
        distribution: (dArgs: Record<string, any>) => {
          dArgs.loggingConfig = {
            bucket: logBucket.bucketRegionalDomainName,
            prefix: 'storefront/',
            includeCookies: false,
          };
        },
      };
    };
  }

  // ─── storefront (Next.js / OpenNext, CloudFront) ───
  // Medusa STORE_CORS/AUTH_CORS에 이미 url("www")로 등록되어 있다.
  // 백엔드 서비스 URL은 storefront가 BACKEND_DOMAIN + 서비스 서브도메인 규칙으로 조립한다.
  new sst.aws.Nextjs('Storefront', {
    path: '../../../web/almondyoung-storefront',
    // arm64(Graviton) Lambda — server 함수 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    // (image optimizer 는 SST 가 항상 arm64 로 빌드.)
    server: { architecture: 'arm64' },
    // apex(almondyoung.com)를 정식 도메인으로, www 는 거기로 301 리다이렉트.
    // (site.ts canonical + sitemap 이 apex 기준이라 일치시킴.) dev 는 baseDomain 이
    // lcnine-dev.com 공용 루트라 점유하면 안 되므로 그대로 www 만 쓴다.
    domain: isDev
      ? { name: domain('www') }
      : {
          name: baseDomain,
          redirects: [
            domain('www'), // www.almondyoung.com → apex
            // 옛 도메인 흡수: almondyoung-next.com / www → almondyoung.com 로 301.
            // SST 가 리다이렉트용 ACM 인증서 + S3/CloudFront + Route53 레코드를
            // almondyoung-next.com zone 에 자동 생성한다 (경로 보존, 쿼리스트링 드롭).
            'almondyoung-next.com',
            'www.almondyoung-next.com',
          ],
          // 기존 hosted zone 에 ACM 검증 CNAME(www 인증서 잔재 등)이 이미 있어
          // Route53 record 생성이 충돌하므로 덮어쓰기 허용.
          dns: sst.aws.dns({ override: true }),
        },
    // viewer-request 함수에 IP 차단 코드 주입 → 정적 자산 포함 전체 behavior 에서 403.
    edge: {
      viewerRequest: { injection: storefrontBlockIpInjection },
    },
    // live 만: CloudFront 표준 액세스 로그 → S3 (정부망 IP 발견용, 위 블록 참조).
    ...(storefrontCdnTransform ? { transform: { cdn: storefrontCdnTransform } } : {}),
    environment: {
      // GA4 측정 ID — live 만 주입해 dev 트래픽이 운영 속성에 섞이지 않게 한다.
      ...(isDev ? {} : { NEXT_PUBLIC_GA_ID: 'G-QLQEGSPQP8' }),
      NEXT_PUBLIC_BASE_URL: storefrontUrl,
      NEXT_PUBLIC_DEFAULT_REGION: 'kr',
      NEXT_PUBLIC_WALLET_WEB_URL: url('wallet-web'),
      NEXT_PUBLIC_MEMBERSHIP_INVOICE_BILLING_ENABLED: invoiceBillingEnabled,
      NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID: 'cusgroup_01KFZ12A1M344F6HKGDV35J28A',
      NEXT_PUBLIC_BACKEND_DOMAIN: backendRootDomain,
      BACKEND_DOMAIN: backendRootDomain,
      NEXT_PUBLIC_USE_RAILWAY_BACKEND: 'true',
      USE_RAILWAY_BACKEND: 'true',
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
      PARENT_COOKIE_SECURE: 'true',
      PARENT_COOKIE_SAMESITE: 'lax',
      // 레거시 cafe24 마이페이지 redirect.
      NEXT_PUBLIC_LEGACY_ORDER_LIST_URL: 'https://lcnine.cafe24.com/myshop/order/list.html',
      NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL: 'https://lcnine.cafe24.com/myshop/mileage/historyList.html',
      // OTEL: Lambda(VPC 밖)라 Alloy 우회, Grafana Cloud OTLP 게이트웨이로 직접 전송.
      OTEL_SERVICE_NAME: 'almondyoung-storefront',
      OTEL_EXPORTER_OTLP_ENDPOINT: grafanaCloudOtlpEndpoint.value,
      GRAFANA_OTLP_INSTANCE_ID: grafanaCloudWebOtlpInstanceId.value,
      GRAFANA_OTLP_TOKEN: grafanaCloudWebOtlpToken.value,
    },
  });

  // ─── wallet-web (Next.js / OpenNext, CloudFront) ───
  // wallet-web 자체가 OIDC RP. admin-web 과 동일한 패턴으로 user-service 와 직접 OIDC code-exchange.
  // RP 코드: apps/wallet-web/lib/auth/*, app/login, app/auth/callback, app/api/auth/{refresh,signout}, middleware.ts.
  new sst.aws.Nextjs('WalletWeb', {
    path: '../../../apps/wallet-web',
    // arm64(Graviton) Lambda — server 함수 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    // (image optimizer 는 SST 가 항상 arm64 로 빌드.)
    server: { architecture: 'arm64' },
    domain: { name: domain('wallet-web') },
    environment: {
      NEXT_PUBLIC_WALLET_API_URL: url('wallet'),
      WALLET_API_URL: url('wallet'),
      WALLET_API_KEY: walletApiKey.value,
      TOSS_CLIENT_KEY: tossClientKey.value,
      // storefront 복귀 URL 오픈 리다이렉트 allowlist. CMS 등록/변경 후 returnUrl(=storefront 절대 URL)로
      // 복귀할 때 허용 origin 을 제한한다. Medusa STORE_CORS 와 동일한 신뢰 origin 을 유지하되,
      // live 는 apex(baseDomain)가 정식 도메인이고 www 는 거기로 301 redirect 라 apex origin 도 포함한다.
      WALLET_ALLOWED_RETURN_ORIGINS: [
        url('www'),
        ...(isDev ? [] : [`https://${baseDomain}`]),
        'http://localhost:8001',
      ].join(','),
      // OIDC (wallet-web RP). client_id 는 시더와 동일하게 'wallet-web'.
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OIDC_AUTHORIZATION_URL: $interpolate`${idpAuthWebUrl}/oauth/authorize`,
      OIDC_CLIENT_ID: 'wallet-web',
      OIDC_CLIENT_SECRET: walletWebOidcClientSecret.value,
      OIDC_REDIRECT_URI: $interpolate`${url('wallet-web')}/auth/callback`,
      OIDC_POST_LOGOUT_REDIRECT_URI: url('wallet-web'),
      OAUTH_JWKS_URL: $interpolate`${idpUserServiceUrl}/.well-known/jwks.json`,
      // 세션 쿠키는 host-only (admin-web 패턴). 다른 RP 와의 세션 공유는 IdP 레벨에서만
      // 일어나며 (auth-web hub 의 parent-domain idp 쿠키), wallet-web 은 자체 도메인에만 토큰을 박는다.
      // OTEL: Lambda(VPC 밖)라 Alloy 우회, Grafana Cloud OTLP 게이트웨이로 직접 전송.
      OTEL_SERVICE_NAME: 'wallet-web',
      OTEL_EXPORTER_OTLP_ENDPOINT: grafanaCloudOtlpEndpoint.value,
      GRAFANA_OTLP_INSTANCE_ID: grafanaCloudWebOtlpInstanceId.value,
      GRAFANA_OTLP_TOKEN: grafanaCloudWebOtlpToken.value,
    },
  });

  // ─── Railway 커스텀 도메인 (link.almondyoung.com) ───
  // SST 가 만드는 자원이 아니라 Railway 에 떠 있는 외부 서비스를 가리키는 DNS 만 여기서 소유한다.
  // Railway 프로젝트를 지우면 이 블록도 같이 지울 것.
  if (!isDev) {
    const zoneId = aws.route53.getZoneOutput({ name: baseDomain, privateZone: false }).zoneId;

    new aws.route53.Record('RailwayLinkCname', {
      zoneId,
      name: `link.${baseDomain}`,
      type: 'CNAME',
      ttl: 300,
      records: ['vuip635e.up.railway.app'],
      allowOverwrite: true,
    });

    // Railway 도메인 소유권 검증용. 검증이 끝나도 Railway 가 재확인하므로 지우지 말 것.
    new aws.route53.Record('RailwayLinkVerifyTxt', {
      zoneId,
      name: `_railway-verify.link.${baseDomain}`,
      type: 'TXT',
      ttl: 300,
      records: ['railway-verify=12d119033fd5d4cc58f221860d3ef098b307412ee63eb4c6c47d0a5842a77d22'],
      allowOverwrite: true,
    });

    // ─── Resend 발신 도메인 (mail.almondyoung.com) ───
    // notification 서비스가 RESEND_FROM=noreply@mail.<baseDomain> 로 발송한다 (위 notificationEnv).
    // 이 3개 레코드가 없으면 Resend 가 도메인 검증을 잃고 발송이 전부 거부되므로 코드와 함께 소유한다.
    // apex(almondyoung.com)용 Resend 레코드는 별도 수동 등록분이라 여기 없음 — 정리 시 같이 옮길 것.
    // DKIM 공개키는 Resend 가 도메인별로 발급한 고유값이라 도메인을 재생성하면 바뀐다.
    new aws.route53.Record('ResendMailDkim', {
      zoneId,
      name: `resend._domainkey.mail.${baseDomain}`,
      type: 'TXT',
      ttl: 300,
      records: [
        'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDVYvocLaRfOxlYYKHRsPV5j8L8U0Bs0gz7DfkxAhVXUy58NKX1D5JxO4HFUkC5YIvMxFOeAGD9kK0dYN9WREUTkngic94ddqL2y09F+8bXxWJveqyy4SxfvRrSPaboeNEFH4wHndddIc28MpT2GXVACtlFfRtLuWHe0yuk8FYCTQIDAQAB',
      ],
      allowOverwrite: true,
    });

    // 반송/피드백 수신용. feedback-smtp 호스트는 Resend 도메인의 리전에 묶인다 (현재 ap-northeast-1).
    new aws.route53.Record('ResendMailMx', {
      zoneId,
      name: `send.mail.${baseDomain}`,
      type: 'MX',
      ttl: 300,
      records: ['10 feedback-smtp.ap-northeast-1.amazonses.com'],
      allowOverwrite: true,
    });

    new aws.route53.Record('ResendMailSpf', {
      zoneId,
      name: `send.mail.${baseDomain}`,
      type: 'TXT',
      ttl: 300,
      records: ['v=spf1 include:amazonses.com ~all'],
      allowOverwrite: true,
    });
  }
}
