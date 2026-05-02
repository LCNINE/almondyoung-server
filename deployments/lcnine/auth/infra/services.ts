/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { IdpInfra } from "./shared";

export function setup(infra: IdpInfra) {
  const { db, dbUrl, baseDomain, domain, url, createBackendService, kafkaBrokers } = infra;

  // ─── Secrets ───
  // 루트 앱에서 쓰던 값과 별개로 IdP 앱 stage에 각각 `sst secret set` 해야 한다.
  const authSecret = new sst.Secret("AuthSecret");
  const jwtRefreshSecret = new sst.Secret("JwtRefreshSecret");
  const jwtVerificationTokenSecret = new sst.Secret("JwtVerificationTokenSecret");

  // 초기 구축 단계에서는 OAuth 핵심 경로만 열어둔다. Kakao/Twilio/Cafe24/S3는
  // 해당 기능을 실제로 dev에서 검증할 때 주석 해제하고 Secret을 세팅한다.
  // const kakaoClientId = new sst.Secret("KakaoClientId");
  // const kakaoClientSecret = new sst.Secret("KakaoClientSecret");

  // const twilioAccountSid = new sst.Secret("TwilioAccountSid");
  // const twilioAuthToken = new sst.Secret("TwilioAuthToken");

  // const cafe24ClientId = new sst.Secret("Cafe24ClientId");
  // const cafe24ClientSecret = new sst.Secret("Cafe24ClientSecret");
  // const cafe24ServiceKey = new sst.Secret("Cafe24ServiceKey");

  // const awsS3AccessKeyId = new sst.Secret("AwsS3AccessKeyId");
  // const awsS3SecretAccessKey = new sst.Secret("AwsS3SecretAccessKey");

  // Kafka는 lcnine-platform이 VPC 내부 Redpanda를 PLAINTEXT로 제공 → API key/secret 불필요.

  // OAuth IdP 전용
  // 클라이언트 등록 정보(clientId/secret/redirectUris/scopes)는 user-service `oauth_clients` 테이블이 SoT.
  // env JSON(OAUTH_CLIENTS / OAUTH_ALLOWED_CLIENTS)과 시연용 bypass 플래그는 제거됨.
  const oauthInternalSecret = new sst.Secret("OauthInternalSecret");

  // ─── user-service 호스트는 id.<base>, auth-web은 auth.<base> ───
  const userServiceUrl = url("id");
  const authWebUrl = url("auth");

  // ─── user-service ───
  // Dockerfile이 libs/, packages/, apps/user-service/ 를 복사하므로 context는 모노레포 루트.
  createBackendService("UserService", {
    dockerfile: "apps/user-service/Dockerfile",
    dockerContext: "../../../",
    port: 3000,
    serviceName: "user-service",
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
      DATABASE_URL: dbUrl("user_service"),
      // platform이 제공하는 VPC 내부 Redpanda. kafka-config.util은 API key/SASL 미지정 시
      // plaintext로 자동 fallback하므로 브로커 주소만 주입하면 됨.
      KAFKA_BROKERS: kafkaBrokers,
      KAFKA_CLIENT_ID_PREFIX: "user-service",
      KAFKA_GROUP_ID: "user-service",
      AUTH_SECRET: authSecret.value,
      JWT_REFRESH_SECRET: jwtRefreshSecret.value,
      JWT_VERIFICATION_TOKEN_SECRET: jwtVerificationTokenSecret.value,
      COOKIE_DOMAIN: `.${baseDomain}`,
      FRONTEND_URL: authWebUrl,
      SIGNUP_CALLBACK_URL: `${authWebUrl}/callback/signup`,
      USER_SERVICE_URL: userServiceUrl,
      REDIRECT_URL_WHITELIST: [
        "http://localhost:8000/callback/signup",
        "http://localhost:8000/",
        "http://localhost:8000",
        `${userServiceUrl}/`,
        `${authWebUrl}/`,
        `${authWebUrl}/callback/signup`,
        "http://localhost:8080/",
      ].join(","),
      CORS_ORIGIN_DOMAINS: [
        authWebUrl,
        "http://localhost:8000",
        url("medusa"),
        // NOTE: fastify-cors의 origin 배열은 와일드카드를 지원하지 않으므로
        // 필요한 서브도메인은 여기에 명시적으로 추가할 것.
      ].join(","),
      // AWS_REGION/BUCKET은 env.validation에서 required라 남김. 실제 키 없이도
      // ECS task role fallback 경로로 동작하므로 ACCESS_KEY 쌍은 생략.
      AWS_REGION: "ap-northeast-2",
      AWS_S3_BUCKET: "almondyoung",
      OAUTH_INTERNAL_SECRET: oauthInternalSecret.value,
      // ─── 기능별 Secret 미세팅 상태 (후속 활성화 시 주석 해제) ───
      // KAKAO_CLIENT_ID: kakaoClientId.value,
      // KAKAO_CLIENT_SECRET: kakaoClientSecret.value,
      // KAKAO_CALLBACK_URL: `${userServiceUrl}/auth/kakao/callback`,
      // TWILIO_ACCOUNT_SID: twilioAccountSid.value,
      // TWILIO_AUTH_TOKEN: twilioAuthToken.value,
      // TWILIO_PHONE_NUMBER: "+15856342856",
      // CAFE24_CLIENT_ID: cafe24ClientId.value,
      // CAFE24_CLIENT_SECRET: cafe24ClientSecret.value,
      // CAFE24_SERVICE_KEY: cafe24ServiceKey.value,
      // CAFE24_MALL_ID: "lcnine",
      // BIZNO_URL: "https://bizno.net/article",
      // AWS_ACCESS_KEY_ID: awsS3AccessKeyId.value,
      // AWS_SECRET_ACCESS_KEY: awsS3SecretAccessKey.value,
    },
  });

  // ─── auth-web (Nextjs / OpenNext, CloudFront) ───
  // 자체 CloudFront 배포이므로 ALB와 충돌 없음.
  new sst.aws.Nextjs("AuthWeb", {
    path: "../../../web/auth-web",
    domain: { name: domain("auth") },
    environment: {
      USER_SERVICE_URL: userServiceUrl,
      PARENT_COOKIE_DOMAIN: `.${baseDomain}`,
      PARENT_COOKIE_SECURE: "true",
      PARENT_COOKIE_SAMESITE: "lax",
      ALLOWED_REDIRECT_HOSTS: `.${baseDomain}`,
      AUTH_WEB_ORIGIN: authWebUrl,
      OAUTH_INTERNAL_SECRET: oauthInternalSecret.value,
    },
  });

  // ─── Cross-stack exports via SSM Parameter Store ───
  // consumer 앱(루트 almondyoung-server 등)은 aws.ssm.getParameterOutput()으로 읽는다.
  new aws.ssm.Parameter("IdpUserServiceUrl", {
    name: `/lcnine-auth/${$app.stage}/user-service-url`,
    type: "String",
    value: userServiceUrl,
  });

  new aws.ssm.Parameter("IdpAuthWebUrl", {
    name: `/lcnine-auth/${$app.stage}/auth-web-url`,
    type: "String",
    value: authWebUrl,
  });

  // TEMP(시연용): user-service의 AUTH_SECRET을 SecureString으로 cross-stack export.
  // df 스택의 Medusa가 같은 시크릿으로 JWT를 검증할 수 있도록 한다.
  new aws.ssm.Parameter("IdpAuthSecret", {
    name: `/lcnine-auth/${$app.stage}/auth-secret`,
    type: "SecureString",
    value: authSecret.value,
  });

  new aws.ssm.Parameter("IdpIssuerUrl", {
    name: `/lcnine-auth/${$app.stage}/issuer-url`,
    type: "String",
    value: userServiceUrl,
  });
}
