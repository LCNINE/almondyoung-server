import { isSafeDemoEnvironment } from './demo-stage.config';
import { validateAlmondyoungEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/core',
  AUTH_SECRET: 'secret',
  KAFKA_BROKERS: 'localhost:9092',
  FULFILLMENT_WORKFLOW_MODE: 'v2',
  FULFILLMENT_V2_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
};

describe('demo stage safety contract', () => {
  it('enables demo only for the exact stage, console, and mock integration triple', () => {
    expect(
      isSafeDemoEnvironment({
        APP_STAGE: 'demo',
        DEMO_CONSOLE_ENABLED: 'true',
        EXTERNAL_INTEGRATIONS_MODE: 'mock',
      }),
    ).toBe(true);
    expect(
      isSafeDemoEnvironment({ APP_STAGE: 'live', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'mock' }),
    ).toBe(false);
  });

  it.each([
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'real' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'false', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'live', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
  ])('fails unsafe demo configuration: %o', (unsafe) => {
    expect(() => validateAlmondyoungEnv({ ...base, ...unsafe })).toThrow(
      '[Almondyoung Server] Invalid environment variables',
    );
  });

  it('preserves ordinary non-demo startup without the demo variables', () => {
    expect(validateAlmondyoungEnv(base)).toMatchObject(base);
  });
});
