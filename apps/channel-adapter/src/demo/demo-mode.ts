export type DemoEnvironment = Record<string, unknown>;

export function isSafeDemoMode(env: DemoEnvironment = process.env): boolean {
  return env.APP_STAGE === 'demo' && env.DEMO_CONSOLE_ENABLED === 'true' && env.EXTERNAL_INTEGRATIONS_MODE === 'mock';
}

export function hasAnyDemoSetting(env: DemoEnvironment): boolean {
  return env.APP_STAGE === 'demo' || env.DEMO_CONSOLE_ENABLED === 'true' || env.EXTERNAL_INTEGRATIONS_MODE === 'mock';
}
