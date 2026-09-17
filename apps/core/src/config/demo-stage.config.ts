export interface DemoEnvironment {
  APP_STAGE?: unknown;
  DEMO_CONSOLE_ENABLED?: unknown;
  EXTERNAL_INTEGRATIONS_MODE?: unknown;
}

/** The single configuration in which demo-only HTTP and external adapters may exist. */
export function isSafeDemoEnvironment(env: DemoEnvironment = process.env): boolean {
  return env.APP_STAGE === 'demo' && env.DEMO_CONSOLE_ENABLED === 'true' && env.EXTERNAL_INTEGRATIONS_MODE === 'mock';
}
