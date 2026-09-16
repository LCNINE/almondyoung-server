const EXTERNAL_CREDENTIALS = [
  'CAFE24_SERVICE_KEY',
  'CAFE24_CLIENT_ID',
  'CAFE24_CLIENT_SECRET',
  'KAKAO_CLIENT_ID',
  'KAKAO_CLIENT_SECRET',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
  'DATA_GO_KR_SERVICE_KEY',
];

export function validateDemoAuthEnvironment(config: Record<string, unknown>): void {
  if (config.APP_STAGE !== 'demo') return;
  if (config.EXTERNAL_INTEGRATIONS_MODE !== 'mock') {
    throw new Error('Demo authentication requires EXTERNAL_INTEGRATIONS_MODE=mock');
  }
  if (EXTERNAL_CREDENTIALS.some((key) => Boolean(config[key]))) {
    throw new Error('Demo authentication must not contain external business credentials');
  }
}

export function isDemoBlockedAuthPath(rawPath: string): boolean {
  const path = rawPath.split('?')[0].replace(/\/+$/, '');
  return [
    '/cafe24',
    '/auth/signup',
    '/auth/callback/signup',
    '/auth/kakao',
    '/auth/naver',
    '/auth/link',
    '/auth/social',
    '/auth/callback/social',
    '/auth/payment-handoff',
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
