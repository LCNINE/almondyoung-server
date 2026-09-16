export function validateDemoConfig(config: {
  stage?: string;
  apiUrl: string;
  issuer: string;
  authorize: string;
}): void {
  if (config.stage !== 'demo') return;
  if (
    config.apiUrl !== 'https://core.almondyoung-next.com' ||
    config.issuer !== 'https://user.almondyoung-next.com' ||
    config.authorize !== 'https://auth.almondyoung-next.com/oauth/authorize'
  ) {
    throw new Error('Demo 앱은 demo API와 인증 서버만 사용할 수 있습니다.');
  }
}
