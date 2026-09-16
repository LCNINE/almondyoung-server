import { validateChannelAdapterEnv } from '../config/env.validation';
import { isSafeDemoMode } from './demo-mode';

const base = {
  DATABASE_URL: 'postgresql://localhost/channel_adapter',
  AUTH_SECRET: 'test-secret',
  KAFKA_CLIENT_ID_PREFIX: 'channel-adapter',
  KAFKA_BROKERS: 'localhost:9092',
  KAFKA_GROUP_ID: 'channel-adapter-test',
};

describe('channel-adapter demo mode', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts only the complete fail-closed demo environment contract', () => {
    const config = {
      ...base,
      APP_STAGE: 'demo',
      DEMO_CONSOLE_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_MODE: 'mock',
    };

    expect(validateChannelAdapterEnv(config)).toMatchObject(config);
    expect(isSafeDemoMode(config)).toBe(true);
  });

  it.each([
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'real' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'false', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'live', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
  ])('rejects unsafe or ambiguous demo configuration: %o', (demoConfig) => {
    expect(() => validateChannelAdapterEnv({ ...base, ...demoConfig })).toThrow(
      '[Channel Adapter] Invalid environment variables',
    );
  });

  it('preserves a fully configured non-demo real-integration environment', () => {
    const config = {
      ...base,
      APP_STAGE: 'live',
      DEMO_CONSOLE_ENABLED: 'false',
      EXTERNAL_INTEGRATIONS_MODE: 'real',
      NAVER_API_ENDPOINT: 'https://naver.example.com',
      NAVER_CLIENT_ID: 'naver-client',
      NAVER_CLIENT_SECRET: 'naver-secret',
      COUPANG_ACCESS_KEY: 'coupang-access',
      COUPANG_SECRET_KEY: 'coupang-secret',
      COUPANG_VENDOR_ID: 'vendor',
      MEDUSA_API_URL: 'https://medusa.example.com',
      MEDUSA_API_KEY: 'medusa-key',
    };

    expect(validateChannelAdapterEnv(config)).toMatchObject(config);
    expect(isSafeDemoMode(config)).toBe(false);
  });
});
