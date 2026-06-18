/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { IdpInfra } from './shared';

export function setup(infra: IdpInfra) {
  const { db, dbUrl, baseDomain, domain, url, createBackendService, kafkaBrokers } = infra;

  // ─── Secrets ───
  // 루트 앱에서 쓰던 값과 별개로 IdP 앱 stage에 각각 `sst secret set` 해야 한다.
  const authSecret = new sst.Secret('AuthSecret');
  const jwtRefreshSecret = new sst.Secret('JwtRefreshSecret');
  const jwtVerificationTokenSecret = new sst.Secret('JwtVerificationTokenSecret');

  // 초기 구축 단계에서는 OAuth 핵심 경로만 열어둔다. Kakao/Twilio/Cafe24/S3는
  // 해당 기능을 실제로 dev에서 검증할 때 주석 해제하고 Secret을 세팅한다.
  // const kakaoClientId = new sst.Secret("KakaoClientId");
  // const kakaoClientSecret = new sst.Secret("KakaoClientSecret");

  const twilioAccountSid = new sst.Secret('TwilioAccountSid');
  const twilioAuthToken = new sst.Secret('TwilioAuthToken');
  const twilioServiceId = new sst.Secret('TwilioServiceId');

  // const cafe24ClientId = new sst.Secret("Cafe24ClientId");
  // const cafe24ClientSecret = new sst.Secret("Cafe24ClientSecret");
  // const cafe24ServiceKey = new sst.Secret("Cafe24ServiceKey");

  // const awsS3AccessKeyId = new sst.Secret("AwsS3AccessKeyId");
  // const awsS3SecretAccessKey = new sst.Secret("AwsS3SecretAccessKey");

  // Kafka는 lcnine-platform이 VPC 내부 Redpanda를 PLAINTEXT로 제공 → API key/secret 불필요.

  // OAuth IdP 전용
  // 클라이언트 등록 정보(clientId/secret/redirectUris/scopes)는 user-service `oauth_clients` 테이블이 SoT.
  // env JSON(OAUTH_CLIENTS / OAUTH_ALLOWED_CLIENTS)과 시연용 bypass 플래그는 제거됨.
  const oauthInternalSecret = new sst.Secret('OauthInternalSecret');
  // RS256 access token 서명용 PEM keypair. 미설정 시 user-service 부팅이 실패하므로
  // 신규 stage 부트스트랩 시 반드시 set 해야 한다. user-service env.validation 은 raw PEM /
  // base64-encoded PEM 둘 다 받지만, transport 안전을 위해 base64 방식을 권장한다.
  //   openssl genpkey -algorithm RSA -out priv.pem -pkeyopt rsa_keygen_bits:2048
  //   openssl pkey -in priv.pem -pubout -out pub.pem
  //   sst secret set OauthJwtPrivateKey "$(base64 -w0 < priv.pem)" --stage <stage>
  //   sst secret set OauthJwtPublicKey  "$(base64 -w0 < pub.pem)"  --stage <stage>
  const oauthJwtPrivateKey = new sst.Secret('OauthJwtPrivateKey');
  const oauthJwtPublicKey = new sst.Secret('OauthJwtPublicKey');

  // ─── user-service 호스트는 user.<base>, auth-web은 auth.<base> ───
  const userServiceUrl = url('user');
  const authWebUrl = url('auth');

  // ─── user-service ───
  // Dockerfile이 libs/, packages/, apps/user-service/ 를 복사하므로 context는 모노레포 루트.
  createBackendService('UserService', {
    dockerfile: 'apps/user-service/Dockerfile',
    dockerContext: '../../../',
    port: 3000,
    serviceName: 'user-service',
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
      DATABASE_URL: dbUrl('user_service'),
      // platform이 제공하는 VPC 내부 Redpanda. kafka-config.util은 API key/SASL 미지정 시
      // plaintext로 자동 fallback하므로 브로커 주소만 주입하면 됨.
      KAFKA_BROKERS: kafkaBrokers,
      KAFKA_CLIENT_ID_PREFIX: 'user-service',
      KAFKA_GROUP_ID: 'user-service',
      AUTH_SECRET: authSecret.value,
      JWT_REFRESH_SECRET: jwtRefreshSecret.value,
      JWT_VERIFICATION_TOKEN_SECRET: jwtVerificationTokenSecret.value,
      COOKIE_DOMAIN: `.${baseDomain}`,
      FRONTEND_URL: authWebUrl,
      AUTH_WEB_ORIGIN: authWebUrl,
      SIGNUP_CALLBACK_URL: `${authWebUrl}/callback/signup`,
      USER_SERVICE_URL: userServiceUrl,
      REDIRECT_URL_WHITELIST: [
        'http://localhost:8000/callback/signup',
        'http://localhost:8000/',
        'http://localhost:8000',
        `${userServiceUrl}/`,
        `${authWebUrl}/`,
        `${authWebUrl}/callback/signup`,
        'http://localhost:8080/',
      ].join(','),
      CORS_ORIGIN_DOMAINS: [
        authWebUrl,
        'http://localhost:8000',
        url('medusa'),
        // Cafe24 migrator 페이지(almondyoung.com)에서 /cafe24/member-info 호출
        'https://almondyoung.com',
        'https://www.almondyoung.com',
        // NOTE: fastify-cors의 origin 배열은 와일드카드를 지원하지 않으므로
        // 필요한 서브도메인은 여기에 명시적으로 추가할 것.
      ].join(','),
      // AWS_REGION/BUCKET은 env.validation에서 required라 남김. 실제 키 없이도
      // ECS task role fallback 경로로 동작하므로 ACCESS_KEY 쌍은 생략.
      AWS_REGION: 'ap-northeast-2',
      AWS_S3_BUCKET: 'almondyoung',
      OAUTH_INTERNAL_SECRET: oauthInternalSecret.value,
      // RS256 OAuth access token 서명. JWKS 도 같은 public key 로 노출됨(/.well-known/jwks.json).
      // KID 회전 시엔 새 keypair set + KID 변경 후 배포 → 충분한 expose 기간 후 구 키 제거.
      OAUTH_JWT_PRIVATE_KEY: oauthJwtPrivateKey.value,
      OAUTH_JWT_PUBLIC_KEY: oauthJwtPublicKey.value,
      OAUTH_JWT_KID: `lcnine-auth-${$app.stage}-1`,
      OAUTH_ISSUER_URL: userServiceUrl,
      // ─── 기능별 Secret 미세팅 상태 (후속 활성화 시 주석 해제) ───
      // KAKAO_CLIENT_ID: kakaoClientId.value,
      // KAKAO_CLIENT_SECRET: kakaoClientSecret.value,
      // KAKAO_CALLBACK_URL: `${userServiceUrl}/auth/kakao/callback`,
      TWILIO_ACCOUNT_SID: twilioAccountSid.value,
      TWILIO_AUTH_TOKEN: twilioAuthToken.value,
      TWILIO_PHONE_NUMBER: '+15856342856',
      TWILIO_SERVICE_ID: twilioServiceId.value,
      // CAFE24_CLIENT_ID: cafe24ClientId.value,
      // CAFE24_CLIENT_SECRET: cafe24ClientSecret.value,
      // CAFE24_SERVICE_KEY: cafe24ServiceKey.value,
      // CAFE24_MALL_ID: "lcnine",
      BIZNO_URL: 'https://bizno.net/article',
      // AWS_ACCESS_KEY_ID: awsS3AccessKeyId.value,
      // AWS_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
    },
  });

  // ─── auth-web (Nextjs / OpenNext, CloudFront) ───
  // 자체 CloudFront 배포이므로 ALB와 충돌 없음.
  new sst.aws.Nextjs('AuthWeb', {
    path: '../../../web/auth-web',
    domain: { name: domain('auth') },
    environment: {
      USER_SERVICE_URL: userServiceUrl,
      PARENT_COOKIE_DOMAIN: `.${baseDomain}`,
      PARENT_COOKIE_SECURE: 'true',
      PARENT_COOKIE_SAMESITE: 'lax',
      ALLOWED_REDIRECT_HOSTS: `.${baseDomain}`,
      AUTH_WEB_ORIGIN: authWebUrl,
      OAUTH_INTERNAL_SECRET: oauthInternalSecret.value,
      // /dev/oidc-clients 등 개발자용 도구 라우트 활성화 플래그.
      // 원래는 isDev 일 때만 켜지만, 현재는 live 에서도 임시로 OIDC client 관리 UI 가 필요해
      // 모든 stage 에서 강제로 "true" 로 둔다. 정식화 또는 별도 admin 화면으로 이전 후
      // `isDev ? "true" : ""` 로 되돌릴 것.
      DEV_TOOLS_ENABLED: 'true', // TEMP(live 임시 개방): 위 주석 참고하여 dev-only 로 환원할 것.
    },
  });

  // ─── Cross-stack exports via SSM Parameter Store ───
  // consumer 앱(루트 core 등)은 aws.ssm.getParameterOutput()으로 읽는다.
  new aws.ssm.Parameter('IdpUserServiceUrl', {
    name: `/lcnine-auth/${$app.stage}/user-service-url`,
    type: 'String',
    value: userServiceUrl,
  });

  new aws.ssm.Parameter('IdpAuthWebUrl', {
    name: `/lcnine-auth/${$app.stage}/auth-web-url`,
    type: 'String',
    value: authWebUrl,
  });

  // TEMP(시연용): user-service의 AUTH_SECRET을 SecureString으로 cross-stack export.
  // df 스택의 Medusa가 같은 시크릿으로 JWT를 검증할 수 있도록 한다.
  new aws.ssm.Parameter('IdpAuthSecret', {
    name: `/lcnine-auth/${$app.stage}/auth-secret`,
    type: 'SecureString',
    value: authSecret.value,
  });

  new aws.ssm.Parameter('IdpIssuerUrl', {
    name: `/lcnine-auth/${$app.stage}/issuer-url`,
    type: 'String',
    value: userServiceUrl,
  });
}
