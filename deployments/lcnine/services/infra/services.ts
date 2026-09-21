/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { SharedInfra } from './shared';

export function setup(infra: SharedInfra) {
  const {
    isDev,
    vpc,
    cluster,
    db,
    dbUrl,
    redis,
    redisUrl,
    opensearch,
    baseDomain,
    domain,
    url,
    kafkaEnv,
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

  // membership 갱신 사전 고지 크론이 user-service /users/internal/contacts 를 부를 때 쓰는 키.
  // SoT 는 auth 앱의 UserServiceInternalKey 시크릿 — 여기서 값을 따로 세팅하지 않는다.
  const idpUserServiceInternalKey = aws.ssm.getParameterOutput({
    name: `/lcnine-auth/${$app.stage}/user-service-internal-key`,
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

  // UGC — 서버 간(internal) 라우트 인증 키 (medusa 구매확정 → ugc 리뷰자격 등록)
  const ugcInternalKey = new sst.Secret('UgcInternalKey');

  // Search — 서버 간(internal) 라우트 인증 키 (medusa 주문/백필 → search 판매량 색인)
  // 아래 searchEnv 와 Medusa **양쪽**에 같은 값이 들어가야 한다. search 쪽 라우트는
  // 키가 비면 아예 잠기므로(fail-closed), 한쪽만 배포되면 판매량이 색인에 안 실린다 —
  // 장애는 아니고 랭킹의 판매량 항이 조용히 0 이 된다.
  const searchInternalKey = new sst.Secret('SearchInternalKey');

  // Core — 서버 간(internal) 라우트 인증 키 (channel-adapter 수집 게이트 → core /internal/channels/*)
  // 아래 Core 와 channelAdapterEnv **양쪽**에 같은 값이 들어가야 한다. 한쪽만 배포되면 401 이고,
  // 수집 게이트는 fail-closed 라 주문 수집이 멈춘다 (#654).
  const coreInternalKey = new sst.Secret('CoreInternalKey');

  // file-service — 서버 간 라우트 인증 키 (ai 의 고아 파일 수거 크론 → file-service /internal/files/*)
  // FileService 와 Ai 양쪽에 같은 값이 들어가야 한다. 한쪽만 배포되면 401 이고 수거가 멈춘다.
  const fileServiceInternalKey = new sst.Secret('FileServiceInternalKey');

  // Notification
  const nhnAppKey = new sst.Secret('NhnAppKey');
  const nhnSecretKey = new sst.Secret('NhnSecretKey');
  const nhnSenderKey = new sst.Secret('NhnSenderKey');
  const nhnSmsAppKey = new sst.Secret('NhnSmsAppKey');
  const nhnSmsSecretKey = new sst.Secret('NhnSmsSecretKey');
  // NHN 콘솔에 사전등록·승인된 발신번호. 하이픈 없이 (예: '18777184').
  const nhnSmsSendNo = new sst.Secret('NhnSmsSendNo');
  // 알림톡·SMS 웹훅이 공유하는 서명값. NHN 콘솔의 웹훅 설정에 넣은 값과 같아야 한다.
  const nhnWebhookSignature = new sst.Secret('NhnWebhookSignature');
  // 인증문자가 단말에 도달하지 못했을 때 대신 보내는 알림톡 템플릿 코드 (카카오 심사 통과 후 설정).
  const nhnVerificationTemplateCode = new sst.Secret('NhnVerificationTemplateCode');
  const notificationInternalKey = new sst.Secret('NotificationInternalKey');
  const resendApiKey = new sst.Secret('ResendApiKey');
  const resendWebhookSecret = new sst.Secret('ResendWebhookSecret');
  // 발송폰 오프라인·복구 알림을 받을 Google Chat 스페이스 웹훅. 비우면 오프라인 점검 크론이 돌지 않는다.
  const googleChatWebhookUrl = new sst.Secret('GoogleChatWebhookUrl', '');
  // 폰 문자(SMS Gate) 중계 계정. 비어 있으면 /sms-gate/* 가 503 이고 발송 큐도 돌지 않는다.
  const smsGateUsername = new sst.Secret('SmsGateUsername', '');
  const smsGatePassword = new sst.Secret('SmsGatePassword', '');
  // 중계 서버에 웹훅을 등록할 때 쓴 서명키와 같아야 한다. 라이브는 비어 있으면 수신 웹훅을 전부 거절한다.
  const smsGateWebhookSigningKey = new sst.Secret('SmsGateWebhookSigningKey', '');

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
  // ai 앱의 상품 상세설명 초안 생성용 Anthropic API key.
  const anthropicApiKey = new sst.Secret('AnthropicApiKey');
  // 검색어·상품명 임베딩용 OpenAI API key. 없으면 벡터 없이 키워드 검색만 동작한다.
  const openAiApiKey = new sst.Secret('OpenAiApiKey');
  // ai 앱의 어시스턴트(챗봇)용 OpenAI API key. 없으면 챗봇이 503 을 낸다.
  // 위 OpenAiApiKey(임베딩용)와 «다른 키»다 — 용도가 갈리므로 secret 도 나눈다.
  const productAiOpenAiApiKey = new sst.Secret('ProductAiOpenAiApiKey');

  // Storefront
  const medusaPublishableKey = new sst.Secret('MedusaPublishableKey');
  const storefrontRevalidateSecret = new sst.Secret('StorefrontRevalidateSecret');

  // GA4 Data API (유입 통계). 서비스 계정 JSON 원문을 통째로 담는다.
  const ga4ServiceAccount = new sst.Secret('Ga4ServiceAccount');

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
      // Cloud Map DNS 접미사. 서비스 이름만 앞에 붙이면 완성된다 (config.alloy 가 조립).
      // user-service 는 별도 SST 배포(lcnine-auth)지만 같은 네임스페이스에 등록돼 있어 닿는다.
      METRICS_DNS_SUFFIX_SERVICES: $interpolate`${$app.stage}.${$app.name}.${vpc.nodes.cloudmapNamespace.name}`,
      METRICS_DNS_SUFFIX_AUTH: $interpolate`${$app.stage}.lcnine-auth.${vpc.nodes.cloudmapNamespace.name}`,
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

  // 자동 리뷰 자격 발급 잡(apps/medusa/src/jobs/auto-review-eligibility.ts)의 유일한 스위치.
  // 'true' 가 아니면 잡은 후보를 세고 로그만 남긴다 — 처음 켜는 순간 창 안의 주문이 한꺼번에
  // 자격을 받으므로, 운영자가 «꺼진 채로 한 번 돌려 건수를 본 뒤» 켜라는 설계다.
  // 활성화는 이 값을 'true' 로 바꾸는 것으로 일원화한다.
  // 유예·창(ELIGIBILITY_{DELIVERED,SHIPPED,ORDER_AGE,WINDOW}_DAYS)은 코드 기본값(0·10·30·30)을 쓴다.
  const eligibilityAutoIssue = 'true';

  // 한 틱이 «보는» 주문 수 상한. 이건 정책이 아니라 실행시간 안전장치다 — 발급 루프가 직렬이라
  // (건당 query.graph 3 + ugc 왕복 1 + 표식 update 1) 상한이 없으면 한 회차가 무한정 길어진다.
  //
  // 🔴 상한은 «판정 전» 후보에 걸린다(`limit ?` 이 ELIGIBILITY_CANDIDATE_SQL 끝에 있다).
  // 후보에는 아직 유예가 안 찬 주문도 섞여 있으므로, 이 값은 «대상 수»가 아니라 «후보 수»에
  // 대고 읽어야 한다. 두 수는 잡이 남기는 로그 줄이 그대로 준다:
  //   [review-eligibility] … would issue for <대상> of <후보> scanned
  //
  // 이 값은 «상시» 크론의 값이다 — 하루에 새로 대상 밴드로 들어오는 양(= ORDER_AGE 일 전의
  // 하루 주문량)에 배수 여유를 둔 크기면 된다. 그 값이 바뀌면 위 로그 줄로 다시 재고 고친다.
  //
  // 🔴 처음 켤 때 밀려 있는 백로그는 이 값으로 소급하지 않는다 — 일회성 소급과 상시 크론은
  // 다른 관심사이고, 일회성 이벤트 크기를 상시 설정에 박으면 그 뒤로 영원히 남는다.
  // 소급은 운영자가 컨테이너에서 env 를 덮어 한 번 돌린다(발급은 source_event_id unique 라
  // 멱등이므로 몇 번 돌려도 결과가 같다):
  //   ELIGIBILITY_BATCH=<후보 수보다 큰 값> npx medusa exec ./src/scripts/auto-review-eligibility.ts
  // 그러면 로그가 그 자리에서 issued/failed 를 준다. 돌리지 않고 두어도 이 상한이 하루에
  // 한 틱씩 백로그를 줄여 간다.
  const eligibilityBatch = '200';

  // 앱별 env (프리픽스 부여). 태스크에는 담당 앱 것만 병합해 넘긴다.
  const analyticsEnv = withPrefix('ANALYTICS', {
    DATABASE_URL: dbUrl('analytics'),
    ...kafkaEnv('analytics', 'analytics-group'),
    AUTH_SECRET: authSecret.value,
    OIDC_ISSUER_URL: idpUserServiceUrl,
    // GA4 유입 통계용. 서비스 계정 JSON 원문 — @google-analytics/data 에
    // credentials 로 JSON.parse 해서 넘긴다. 속성 권한은 뷰어(읽기 전용).
    GA4_SERVICE_ACCOUNT: ga4ServiceAccount.value,
    GA4_PROPERTY_ID: 'properties/543601630',
  });
  const channelAdapterEnv = withPrefix('CHANNEL_ADAPTER', {
    DATABASE_URL: dbUrl('channel_adapter'),
    ...kafkaEnv('channel-adapter', 'channel-adapter-group'),
    // 전역 JwtAuthGuard/AdminRealmGuard 용 (위 notification 과 같은 이유).
    AUTH_SECRET: authSecret.value,
    OIDC_ISSUER_URL: idpUserServiceUrl,
    CHANNEL_ADAPTER_INTERNAL_KEY: channelAdapterInternalKey.value,
    MEMBERSHIP_INTERNAL_KEY: membershipInternalKey.value,
    // core 의 내부 라우트를 부를 때 싣는 키 (수집 게이트가 활성 판매채널을 조회한다 — #654).
    CORE_INTERNAL_KEY: coreInternalKey.value,
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
    INBOX_MAX_CONCURRENT_HANDLERS: '2',
    INBOX_HANDLER_START_INTERVAL_MS: '3000',
    INBOX_PROCESSING_LEASE_MS: '900000',
    INBOX_SHUTDOWN_DRAIN_MS: '25000',
    DEFERRED_REVALIDATE_FLUSH_MS: '60000',
    // 조상 재보장 메모의 항목 상한. 0 으로 두면 메모를 끈다 (킬스위치).
    CATEGORY_ANCESTOR_MEMO_MAX_ENTRIES: '5000',
  });
  const membershipEnv = withPrefix('MEMBERSHIP', {
    DATABASE_URL: dbUrl('membership'),
    ...kafkaEnv('membership', 'membership-group'),
    WALLET_API_KEY: walletApiKey.value,
    WALLET_API_URL: url('wallet'),
    MEMBERSHIP_INTERNAL_KEY: membershipInternalKey.value,
    MEMBERSHIP_INVOICE_BILLING_ENABLED: invoiceBillingEnabled,
    OIDC_ISSUER_URL: idpUserServiceUrl,
    // 갱신 사전 고지 크론이 수신자 이메일을 조회하는 경로.
    USER_SERVICE_URL: idpUserServiceUrl,
    USER_SERVICE_INTERNAL_KEY: idpUserServiceInternalKey,
  });
  const notificationEnv = withPrefix('NOTIFICATION', {
    DATABASE_URL: dbUrl('notification'),
    ...kafkaEnv('notification', 'notification-group'),
    // 전역 JwtAuthGuard/AdminRealmGuard 용. 둘 중 하나라도 없으면 부팅이 실패한다
    // (AuthorizationModule 의 AUTH_CONFIG 팩토리). 이 서비스는 그 전까지 인증이 아예 없었다.
    AUTH_SECRET: authSecret.value,
    OIDC_ISSUER_URL: idpUserServiceUrl,
    NHN_API_URL: 'https://api-alimtalk.cloud.toast.com',
    NHN_APP_KEY: nhnAppKey.value,
    NHN_SECRET_KEY: nhnSecretKey.value,
    NHN_SENDER_KEY: nhnSenderKey.value,
    NHN_PLUS_FRIEND_ID: '@아몬드영',
    // NHN Cloud SMS — 알림톡과 별개 상품이라 앱키·시크릿이 따로다. 셋이 다 차야 SMS 프로바이더가
    // 등록된다.
    NHN_SMS_API_URL: 'https://sms.api.nhncloudservice.com',
    NHN_SMS_APP_KEY: nhnSmsAppKey.value,
    NHN_SMS_SECRET_KEY: nhnSmsSecretKey.value,
    NHN_WEBHOOK_SIGNATURE: nhnWebhookSignature.value,
    NHN_VERIFICATION_TEMPLATE_CODE: nhnVerificationTemplateCode.value,
    NHN_SMS_SEND_NO: nhnSmsSendNo.value,
    // user-service 가 /internal/sms/send 를 부를 때 쓰는 키. auth 배포에도 같은 값이 필요하다.
    NOTIFICATION_INTERNAL_KEY: notificationInternalKey.value,
    RESEND_API_KEY: resendApiKey.value,
    RESEND_BASE_URL: 'https://api.resend.com',
    RESEND_FROM: `noreply@mail.${baseDomain}`,
    RESEND_FROM_NAME: '아몬드영',
    RESEND_WEBHOOK_SECRET: resendWebhookSecret.value,
    GOOGLE_CHAT_WEBHOOK_URL: googleChatWebhookUrl.value,
    SMS_GATE_BASE_URL: 'https://api.sms-gate.app/3rdparty/v1',
    SMS_GATE_USERNAME: smsGateUsername.value,
    SMS_GATE_PASSWORD: smsGatePassword.value,
    SMS_GATE_WEBHOOK_SIGNING_KEY: smsGateWebhookSigningKey.value,
    USER_SERVICE_URL: idpUserServiceUrl,
    USER_SERVICE_INTERNAL_KEY: idpUserServiceInternalKey,
    // 멤버십 갱신 고지 메일의 "멤버십 관리 · 해지하기" 링크 기준 도메인.
    STOREFRONT_URL: storefrontUrl,
  });
  // ─── 검색 백엔드 전환 스위치 (docs/runbooks/opensearch-railway-to-aws.md) ───
  // false → true 로 바꾸는 «한 줄» 이 컷오버다. 도메인 생성과 컷오버를 한 배포에 묶지 않는
  // 이유: nori 패키지 associate 가 plugin install + rolling restart 라 수십 분 걸리고, 그동안
  // 앱이 빈 도메인을 보면 검색이 0건이 된다. 도메인을 먼저 만들고 데이터를 옮긴 뒤 이 줄을
  // 바꿔 두 번째 배포를 한다.
  //
  // true 로 바꾼 뒤에도 Railway 를 며칠 살려 둘 것 — 되돌릴 유일한 경로이고 검색 이력
  // (search_query_events) 의 두 번째 사본이다.
  const useAwsOpenSearch = true;
  const searchBackendEnv = useAwsOpenSearch
    ? {
        // 자격증명은 SST 가 만드는 FGAC master user. Railway 를 쓰는 동안에는 이 두 값이
        // 비어 있었고, 공개 URL 에 무인증으로 붙고 있었다.
        OPENSEARCH_NODE: opensearch.url,
        OPENSEARCH_USERNAME: opensearch.username,
        OPENSEARCH_PASSWORD: opensearch.password,
      }
    : { OPENSEARCH_NODE: 'https://opensearch-development.up.railway.app' };

  const ugcEnv = withPrefix('UGC', {
    DATABASE_URL: dbUrl('ugc'),
    ...kafkaEnv('ugc-service', 'ugc-service-group'),
    AUTH_SECRET: authSecret.value,
    JWT_ISSUER: 'almondyoung-auth',
    OIDC_ISSUER_URL: idpUserServiceUrl,
    UGC_INTERNAL_KEY: ugcInternalKey.value,
  });
  const searchEnv = withPrefix('SEARCH', {
    ...searchBackendEnv,
    SEARCH_PRODUCTS_INDEX: 'search_products_v2',
    // 키워드 운영 상태(담당·메모) 테이블 — search 논리 DB (bootstrap 이 생성, migrate 가 적용)
    DATABASE_URL: dbUrl('search'),
    ...kafkaEnv('search', 'search-indexer-group'),
    // 관리자 키워드 통계 라우트의 JwtAuthGuard 용. 둘 중 하나라도 없으면 부팅이 실패한다
    // (AuthorizationModule 의 AUTH_CONFIG 팩토리). 이 서비스는 그 전까지 인증이 아예 없었다.
    AUTH_SECRET: authSecret.value,
    OIDC_ISSUER_URL: idpUserServiceUrl,
    OPENAI_API_KEY: openAiApiKey.value,
    SEARCH_INTERNAL_KEY: searchInternalKey.value,
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

  // ─── ai (어시스턴트 + 상품설명) ───
  // 번들에 넣지 않고 따로 띄운다 — 상품설명 초안이 이미지를 8장씩 base64 로 물고 있어
  // 메모리 스파이크가 크고, SSE 응답 하나가 40초까지 살아 있는다. 옆 앱과 1GB 를
  // 나눠 쓰면 그 스파이크가 남의 OOM 이 된다.
  createService('Ai', {
    architecture: 'arm64',
    dockerfile: 'apps/ai/Dockerfile',
    domainSlug: 'ai',
    port: 3070,
    // 명시하지 않으면 SST 기본값 0.5GB 라, 나눠 쓰기 싫어서 뺀 앱이 번들의 절반을 받는다.
    cpu: '0.25 vCPU',
    memory: '1 GB',
    priority: 148,
    link: [db],
    loadBalancerHealth: {
      '3070/http': {
        path: '/health',
        interval: '30 seconds',
        timeout: '5 seconds',
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
    environment: {
      ...kafkaEnv('ai', 'ai-consumer'),
      DATABASE_URL: dbUrl('ai'),
      AUTH_SECRET: authSecret.value,
      JWT_ISSUER: 'almondyoung-auth',
      // admin-web 이 넘겨 준 RS256 토큰을 검증한다.
      OIDC_ISSUER_URL: idpUserServiceUrl,
      // 도구가 부르는 곳. 인증은 부른 사람의 것을 그대로 싣는다.
      CORE_API_URL: url('core'),
      FILE_SERVICE_URL: url('file'),
      ANTHROPIC_API_KEY: anthropicApiKey.value,
      // 검색 임베딩용 OpenAiApiKey 와 다른 키다 — 용도가 갈리므로 secret 도 나눠 둔 것이다.
      OPENAI_API_KEY: productAiOpenAiApiKey.value,
      // 고아 파일 수거 크론이 쓴다. 사람 토큰이 없는 호출이라 공유 키로 부른다 —
      // 둘 중 하나가 없으면 크론이 아무것도 지우지 않고 에러만 찍는다.
      CORE_INTERNAL_KEY: coreInternalKey.value,
      FILE_SERVICE_INTERNAL_KEY: fileServiceInternalKey.value,
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
      // 서버 간 내부 라우트(`/internal/*`)를 여는 공유 키. 사람 JWT 가 없는 호출자(channel-adapter)가
      // 이 값을 Authorization 헤더로 보낸다. 미설정이면 InternalKeyGuard 가 전부 거부한다.
      CORE_INTERNAL_KEY: coreInternalKey.value,
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
      // CMS 계좌 심사 거절 통지가 수신자 이메일을 조회하는 경로.
      USER_SERVICE_URL: idpUserServiceUrl,
      USER_SERVICE_INTERNAL_KEY: idpUserServiceInternalKey,
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
      // ai 의 고아 파일 수거 크론이 /internal/files/* 를 부를 때 쓰는 키.
      FILE_SERVICE_INTERNAL_KEY: fileServiceInternalKey.value,
    },
  });

  // ─── Medusa — store / admin 두 서비스 (ADR-0037, #855) ───
  // 호스트는 medusa. 하나. ALB 룰은 `/admin/*` → MedusaAdmin(priority 205) 하나뿐이고 나머지
  // (/store, /auth, /hooks, /health, /app)는 아래 store 기본 타깃(priority 210)이 받는다.
  // 리소스 이름 'Medusa' 를 store 에 남긴 이유: ALB 타깃그룹·Cloud Map 이름(관측 discovery.dns)이
  // 교체 없이 유지된다. 롤백은 이 두 블록과 shared.ts 의 Redis 블록을 되돌리는 것.
  const medusaEnv = {
    DATABASE_URL: $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/medusa?sslmode=disable`,
    // product_sort_index.review_count 주기 동기화(sync-product-sort-index)가 ugc 리뷰 수를 읽는 소스.
    UGC_SOURCE_DB_URL: $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/ugc?sslmode=disable`,
    // 공유 ElastiCache Valkey (ADR-0037). DB 인덱스 분리는 사이드카 시절과 동일 (0: 이벤트버스·워크플로·락, 1: 캐시).
    REDIS_URL: redisUrl(0),
    CACHE_REDIS_URL: redisUrl(1),
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
    UGC_INTERNAL_KEY: ugcInternalKey.value,
    SEARCH_SERVICE_URL: url('search'),
    SEARCH_INTERNAL_KEY: searchInternalKey.value,
    MEDUSA_MEMBERSHIP_GROUP_ID: 'cusgroup_01KFZ12A1M344F6HKGDV35J28A',
    ELIGIBILITY_AUTO_ISSUE: eligibilityAutoIssue,
    ELIGIBILITY_BATCH: eligibilityBatch,
    // 타임세일 시작·종료 경계에서 storefront 캐시를 비우는 크론이 쓴다.
    // channel-adapter 와 같은 엔드포인트·시크릿을 공유한다.
    STOREFRONT_REVALIDATE_URL: $interpolate`${storefrontUrl}/api/revalidate`,
    STOREFRONT_REVALIDATE_SECRET: storefrontRevalidateSecret.value,
    // S3
    S3_FILE_URL: 'https://almondyoung-medusa-digital-asset.s3.ap-northeast-2.amazonaws.com',
    S3_ACCESS_KEY_ID: awsS3AccessKeyId.value,
    S3_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
    S3_REGION: 'ap-northeast-2',
    S3_BUCKET: 'almondyoung-medusa-digital-asset',
    // Admin & logging
    MEDUSA_ADMIN_ONBOARDING_TYPE: 'default',
    LOG_LEVEL: 'info',
  };

  const medusaCommon = {
    // arm64(Graviton) Fargate — 동일 성능에 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    architecture: 'arm64' as const,
    dockerfile: 'apps/medusa/Dockerfile',
    domainSlug: 'medusa',
    port: 9000,
    link: [db, redis],
    // Fargate 는 1 vCPU 에 최소 2 GB 를 요구한다 (1 GB 는 sst deploy 가 거부 — 2026-09-13 실측).
    // 0.5 vCPU / 1 GB 로 줄이면 CPU 병목인 Medusa 의 목적을 해치므로 1 vCPU / 2 GB 를 유지한다.
    // 백필/이벤트 대응 시 일시적으로 올리고, 끝나면 원복한다.
    cpu: '1 vCPU',
    memory: '2 GB',
    // 스케일아웃은 ADR-0037 의 목표가 아니다. 막던 사유(사이드카)는 사라졌으니 필요하면 store 만 올린다.
    scaling: { min: 1, max: 1 },
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
  };

  // store — 손님 읽기·체크아웃·결제 웹훅(/hooks). subscriber·job·BullMQ 워커를 띄우지 않는다.
  // migrate 는 admin 이 돈다 (Medusa schema migration 은 잠금이 없어 동시 실행이 경쟁한다).
  createService('Medusa', {
    ...medusaCommon,
    priority: 210,
    transform: {
      service: { healthCheckGracePeriodSeconds: 600 },
    },
    environment: {
      ...medusaEnv,
      MEDUSA_WORKER_MODE: 'server',
      MEDUSA_RUN_DB_MIGRATE: 'false',
    },
  });

  // admin — /admin/* API + 백그라운드 전부(subscriber·cron·워크플로 엔진). ECS Exec·백필은 여기.
  createService('MedusaAdmin', {
    ...medusaCommon,
    priority: 205,
    pathPattern: '/admin/*',
    transform: {
      service: {
        healthCheckGracePeriodSeconds: 600,
        // ECS Exec — 백필(`yarn medusa exec`) 을 컨테이너 안에서 직접 실행하기 위해 활성화.
        // SST 가 자동으로 task role 에 ssmmessages:* 권한 부여.
        enableExecuteCommand: true,
      },
    },
    environment: {
      ...medusaEnv,
      // baseEnv 가 domainSlug 로 넣는 OTEL_SERVICE_NAME('medusa') 을 덮어써 Grafana 에서 store 와 갈라 본다.
      // 닫기 판정이 «store 의» CPU·p95 라 구분이 필수다.
      OTEL_SERVICE_NAME: 'medusa-admin',
      MEDUSA_WORKER_MODE: 'shared',
    },
  });

  // ─── admin-web (Next.js / OpenNext, CloudFront) ───
  // admin-web 자체가 OIDC RP. 빌드 단계의 page-data collection 이 OIDC env 를 required 로 읽으므로,
  // 아래 7개 변수는 누락 시 OpenNext 빌드가 실패한다 (apps/admin-web/src/lib/auth/env.ts 참조).
  new sst.aws.Nextjs('AdminWeb', {
    path: '../../../apps/admin-web',
    // arm64(Graviton) Lambda — server 함수 ~20% 저렴. 문제 시 이 줄만 지우면 x86 복귀.
    // (image optimizer 는 SST 가 항상 arm64 로 빌드.)
    //
    // timeout 기본값은 20초라 AI 초안의 작성 단계(30초 안팎)가 잘린다. CloudFront 가
    // 60초에서 끊으므로 이 값이 올릴 수 있는 상한이고, 그래서 AI 초안은 이미지 분석과
    // 작성을 여러 호출로 쪼갠다 (features/mall/products-detail/.../ai-draft.ts).
    server: { architecture: 'arm64', timeout: '60 seconds' },
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
      ANALYTICS_SERVICE_URL: url('analytics'),
      SEARCH_SERVICE_URL: url('search'),
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
      // 타임세일이 멤버십용 price list 를 만들 때 거는 고객그룹 룰. 비면 멤버십 세일가를
      // 저장할 수 없다. NEXT_PUBLIC_ 이라 빌드 타임에 박히므로 값이 바뀌면 재빌드가 필요하다.
      NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID: 'cusgroup_01KFZ12A1M344F6HKGDV35J28A',
      // 메시지(폰 문자) 메뉴. notification 의 SMS Gate 시크릿과 같이 켜야 한다 — 한쪽만 켜면 메뉴가 503 이다.
      NEXT_PUBLIC_SMS_GATE_ENABLED: 'true',
      // AI 는 이제 별도 앱이다 — admin-web 은 프록시만 하므로 모델 키를 갖지 않는다.
      AI_SERVICE_URL: url('ai'),
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
        // viewer-request 함수가 붙이는 x-crawler 를 캐시 키에 포함.
        // 없으면 봇용(Set-Cookie 없는) 응답이 사람에게 그대로 나가 _medusa_cache_id 가
        // 영영 안 심기고, 장바구니 캐시 태그가 빈 문자열이 된다.
        serverCachePolicy: (pArgs: Record<string, any>) => {
          const k = pArgs.parametersInCacheKeyAndForwardedToOrigin;
          const items: string[] = k?.headersConfig?.headers?.items ?? [];
          if (!items.includes('x-crawler')) {
            k.headersConfig = {
              headerBehavior: 'whitelist',
              headers: { items: [...items, 'x-crawler'] },
            };
          }
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
      ...(isDev
        ? {}
        : {
            NEXT_PUBLIC_GA_ID: 'G-QLQEGSPQP8',
            NEXT_PUBLIC_CLARITY_ID: 'ybcljdgsqu',
          }),
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
