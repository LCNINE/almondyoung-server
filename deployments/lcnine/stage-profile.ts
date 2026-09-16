export const DEMO_ACTIVE_SERVICES = [
  'core',
  'analytics',
  'channel-adapter',
  'notification',
  'file-service',
  'admin-web',
] as const;

export const DEMO_ACTIVE_SERVICE_DATABASES = [
  'core',
  'analytics',
  'channel_adapter',
  'notification',
  'file_service',
] as const;

const FULL_SERVICES = [
  'core',
  'analytics',
  'channel-adapter',
  'membership',
  'notification',
  'ugc-service',
  'search',
  'wallet',
  'file-service',
  'medusa',
  'admin-web',
  'wallet-web',
  'storefront',
] as const;

export function getLcnineStageProfile(stage: string) {
  const isLive = stage === 'live';
  const isDemo = stage === 'demo';
  const baseDomain = isDemo ? 'almondyoung-next.com' : isLive ? 'almondyoung.com' : 'lcnine-dev.com';
  const domain = (slug: string) => `${slug}.${isLive || isDemo ? '' : 'dev.'}${baseDomain}`;

  return {
    stage,
    isLive,
    isDemo,
    isDev: !isLive && !isDemo,
    baseDomain,
    domain,
    url: (slug: string) => `https://${domain(slug)}`,
    removal: isLive ? ('retain' as const) : ('remove' as const),
    protect: isLive || isDemo,
    services: isDemo ? DEMO_ACTIVE_SERVICES : FULL_SERVICES,
    resources: {
      redis: !isDemo,
      openSearch: !isDemo,
    },
    environment: isDemo
      ? {
          APP_STAGE: 'demo',
          DEMO_CONSOLE_ENABLED: 'true',
          EXTERNAL_INTEGRATIONS_MODE: 'mock',
        }
      : {
          APP_STAGE: stage,
          DEMO_CONSOLE_ENABLED: 'false',
          EXTERNAL_INTEGRATIONS_MODE: 'real',
        },
  };
}

export type LcnineStageProfile = ReturnType<typeof getLcnineStageProfile>;
