/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { DemoSharedInfra } from './demo-shared';

/** Demo-only runtime graph: logistics services, admin console and no real business integrations. */
export function setup(infra: DemoSharedInfra) {
  const { profile, db, dbUrl, domain, url, kafkaEnv, createService, createBundleService } = infra;
  if (!profile.isDemo) throw new Error('demo services may only be created for stage demo');

  const idpUserServiceUrl = aws.ssm.getParameterOutput({
    name: '/lcnine-auth/demo/user-service-url',
  }).value;
  const idpAuthWebUrl = aws.ssm.getParameterOutput({
    name: '/lcnine-auth/demo/auth-web-url',
  }).value;
  const idpAuthSecret = aws.ssm.getParameterOutput({
    name: '/lcnine-auth/demo/auth-secret',
    withDecryption: true,
  }).value;
  const notificationInternalKey = aws.ssm.getParameterOutput({
    name: '/lcnine-auth/demo/notification-internal-key',
    withDecryption: true,
  }).value;

  const channelAdapterInternalKey = new sst.Secret('ChannelAdapterInternalKey');
  const coreInternalKey = new sst.Secret('CoreInternalKey');
  const adminWebOidcClientSecret = new sst.Secret('AdminWebOidcClientSecret');
  // The provider sends ACL=public-read for public uploads, so keep ACL support only on
  // this public bucket. Private objects live in a different bucket with the default block.
  const publicFiles = new sst.aws.Bucket('DemoPublicFiles', {
    access: 'public',
    versioning: true,
    transform: {
      bucket: (args) => {
        args.objectOwnership = 'BucketOwnerPreferred';
      },
      publicAccessBlock: (args) => {
        args.blockPublicAcls = false;
        args.ignorePublicAcls = false;
      },
    },
  });
  const privateFiles = new sst.aws.Bucket('DemoPrivateFiles', { versioning: true });

  const withPrefix = (prefix: string, env: Record<string, $util.Output<string> | string>) =>
    Object.fromEntries(
      Object.entries({ ...profile.environment, ...env }).map(([key, value]) => [`${prefix}__${key}`, value]),
    );

  const analyticsEnv = withPrefix('ANALYTICS', {
    DATABASE_URL: dbUrl('analytics'),
    ...kafkaEnv('analytics', 'analytics-group'),
    AUTH_SECRET: idpAuthSecret,
    OIDC_ISSUER_URL: idpUserServiceUrl,
  });
  const channelAdapterEnv = withPrefix('CHANNEL_ADAPTER', {
    DATABASE_URL: dbUrl('channel_adapter'),
    ...kafkaEnv('channel-adapter', 'channel-adapter-group'),
    AUTH_SECRET: idpAuthSecret,
    OIDC_ISSUER_URL: idpUserServiceUrl,
    CHANNEL_ADAPTER_INTERNAL_KEY: channelAdapterInternalKey.value,
    CORE_INTERNAL_KEY: coreInternalKey.value,
    USER_SERVICE_URL: idpUserServiceUrl,
    PIM_API_URL: url('core'),
    SKIP_VARIANTS_WITHOUT_PRICE: 'true',
    INBOX_MAX_CONCURRENT_HANDLERS: '2',
    INBOX_HANDLER_START_INTERVAL_MS: '3000',
    INBOX_PROCESSING_LEASE_MS: '900000',
    INBOX_SHUTDOWN_DRAIN_MS: '25000',
  });
  const notificationEnv = withPrefix('NOTIFICATION', {
    DATABASE_URL: dbUrl('notification'),
    ...kafkaEnv('notification', 'notification-group'),
    AUTH_SECRET: idpAuthSecret,
    OIDC_ISSUER_URL: idpUserServiceUrl,
    NOTIFICATION_INTERNAL_KEY: notificationInternalKey,
  });

  createBundleService('ServicesBundleA', {
    link: [db],
    apps: [
      { slug: 'analytics', port: 3040, priority: 211 },
      { slug: 'channel-adapter', port: 3001, priority: 212 },
    ],
    environment: {
      BUNDLE_APPS: 'analytics,channel-adapter',
      ...analyticsEnv,
      ...channelAdapterEnv,
    },
  });
  createBundleService('ServicesBundleB', {
    link: [db],
    apps: [{ slug: 'notification', port: 3003, priority: 214 }],
    environment: {
      BUNDLE_APPS: 'notification',
      ...notificationEnv,
    },
  });

  createService('Core', {
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
      FULFILLMENT_WORKFLOW_MODE: 'v2',
      FULFILLMENT_V2_CUTOVER_AT: '2026-09-16T00:00:00.000Z',
      AUTH_SECRET: idpAuthSecret,
      JWT_ISSUER: 'almondyoung-auth',
      OIDC_ISSUER_URL: idpUserServiceUrl,
      CORE_INTERNAL_KEY: coreInternalKey.value,
      FILE_SERVICE_URL: url('file'),
    },
  });

  createService('FileService', {
    architecture: 'arm64',
    dockerfile: 'apps/file-service/Dockerfile',
    domainSlug: 'file',
    port: 3000,
    priority: 190,
    link: [db, publicFiles, privateFiles],
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
      DATABASE_URL: dbUrl('file_service'),
      ...kafkaEnv('file-service', 'file-service-group'),
      AUTH_SECRET: idpAuthSecret,
      OIDC_ISSUER_URL: idpUserServiceUrl,
      AWS_REGION: 'ap-northeast-2',
      AWS_S3_PUBLIC_BUCKET: publicFiles.name,
      AWS_S3_PRIVATE_BUCKET: privateFiles.name,
      STORAGE_PROVIDER: 'S3',
    },
  });

  new sst.aws.Nextjs('AdminWeb', {
    path: '../../../apps/admin-web',
    server: { architecture: 'arm64', timeout: '60 seconds' },
    domain: { name: domain('admin') },
    environment: {
      ...profile.environment,
      NEXT_PUBLIC_APP_STAGE: 'demo',
      AUTH_SECRET: idpAuthSecret,
      ALMONDYOUNG_API_URL: url('core'),
      USER_SERVICE_URL: idpUserServiceUrl,
      NOTIFICATION_SERVICE_URL: url('notification'),
      CHANNEL_ADAPTER_SERVICE_URL: url('channel-adapter'),
      CHANNEL_ADAPTER_INTERNAL_KEY: channelAdapterInternalKey.value,
      FILE_SERVICE_URL: url('file'),
      ANALYTICS_SERVICE_URL: url('analytics'),
      ADMIN_DOMAIN: domain('admin'),
      OIDC_ISSUER_URL: idpUserServiceUrl,
      OAUTH_ISSUER_URL: idpUserServiceUrl,
      OIDC_AUTHORIZATION_URL: $interpolate`${idpAuthWebUrl}/oauth/authorize`,
      OIDC_CLIENT_ID: 'admin-web',
      OIDC_CLIENT_SECRET: adminWebOidcClientSecret.value,
      OIDC_REDIRECT_URI: `${url('admin')}/auth/callback`,
      OIDC_POST_LOGOUT_REDIRECT_URI: `${url('admin')}/login`,
      OAUTH_JWKS_URL: $interpolate`${idpUserServiceUrl}/.well-known/jwks.json`,
      NEXT_PUBLIC_STOREFRONT_DEFAULT_COUNTRY: 'kr',
    },
  });
}
