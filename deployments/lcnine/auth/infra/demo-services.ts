/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { IdpInfra } from './shared';

/** Demo-only IdP graph. External identity/business credentials are intentionally absent. */
export function setup(infra: IdpInfra) {
  const { db, dbUrl, baseDomain, domain, url, createBackendService, kafkaBrokers, profile } = infra;

  if (!profile.isDemo) throw new Error('demo auth services may only be created for stage demo');

  const authSecret = new sst.Secret('AuthSecret');
  const jwtRefreshSecret = new sst.Secret('JwtRefreshSecret');
  const jwtVerificationTokenSecret = new sst.Secret('JwtVerificationTokenSecret');
  const notificationInternalKey = new sst.Secret('NotificationInternalKey');
  const oauthInternalSecret = new sst.Secret('OauthInternalSecret');
  const userServiceInternalKey = new sst.Secret('UserServiceInternalKey');
  const oauthJwtPrivateKey = new sst.Secret('OauthJwtPrivateKey');
  const oauthJwtPublicKey = new sst.Secret('OauthJwtPublicKey');

  const uploads = new sst.aws.Bucket('DemoAuthUploads', {
    versioning: true,
  });

  const userServiceUrl = url('user');
  const authWebUrl = url('auth');

  createBackendService('UserService', {
    architecture: 'arm64',
    dockerfile: 'apps/user-service/Dockerfile',
    dockerContext: '../../../',
    port: 3000,
    serviceName: 'user-service',
    link: [db, uploads],
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
        `${userServiceUrl}/`,
        `${authWebUrl}/`,
        `${authWebUrl}/callback/signup`,
        `${url('admin')}/auth/callback`,
        'almondwms-demo://oauth/callback',
      ].join(','),
      CORS_ORIGIN_DOMAINS: [authWebUrl, url('admin')].join(','),
      AWS_REGION: 'ap-northeast-2',
      AWS_S3_BUCKET: uploads.name,
      OAUTH_INTERNAL_SECRET: oauthInternalSecret.value,
      USER_SERVICE_INTERNAL_KEY: userServiceInternalKey.value,
      OAUTH_JWT_PRIVATE_KEY: oauthJwtPrivateKey.value,
      OAUTH_JWT_PUBLIC_KEY: oauthJwtPublicKey.value,
      OAUTH_JWT_KID: 'lcnine-auth-demo-1',
      OAUTH_ISSUER_URL: userServiceUrl,
      OIDC_ISSUER_URL: userServiceUrl,
      NOTIFICATION_SERVICE_URL: url('notification'),
      NOTIFICATION_INTERNAL_KEY: notificationInternalKey.value,
    },
  });

  new sst.aws.Nextjs('AuthWeb', {
    path: '../../../web/auth-web',
    domain: { name: domain('auth') },
    environment: {
      ...profile.environment,
      USER_SERVICE_URL: userServiceUrl,
      PARENT_COOKIE_DOMAIN: `.${baseDomain}`,
      PARENT_COOKIE_SECURE: 'true',
      PARENT_COOKIE_SAMESITE: 'lax',
      ALLOWED_REDIRECT_HOSTS: `.${baseDomain}`,
      AUTH_WEB_ORIGIN: authWebUrl,
      OAUTH_INTERNAL_SECRET: oauthInternalSecret.value,
      DEV_TOOLS_ENABLED: 'false',
    },
  });

  new aws.ssm.Parameter('IdpUserServiceUrl', {
    name: '/lcnine-auth/demo/user-service-url',
    type: 'String',
    value: userServiceUrl,
  });
  new aws.ssm.Parameter('IdpAuthWebUrl', {
    name: '/lcnine-auth/demo/auth-web-url',
    type: 'String',
    value: authWebUrl,
  });
  new aws.ssm.Parameter('IdpAuthSecret', {
    name: '/lcnine-auth/demo/auth-secret',
    type: 'SecureString',
    value: authSecret.value,
  });
  new aws.ssm.Parameter('IdpUserServiceInternalKey', {
    name: '/lcnine-auth/demo/user-service-internal-key',
    type: 'SecureString',
    value: userServiceInternalKey.value,
  });
  new aws.ssm.Parameter('IdpNotificationInternalKey', {
    name: '/lcnine-auth/demo/notification-internal-key',
    type: 'SecureString',
    value: notificationInternalKey.value,
  });
  new aws.ssm.Parameter('IdpIssuerUrl', {
    name: '/lcnine-auth/demo/issuer-url',
    type: 'String',
    value: userServiceUrl,
  });
}
