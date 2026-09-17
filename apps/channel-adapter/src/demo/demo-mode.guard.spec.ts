import { ForbiddenException } from '@nestjs/common';
import { DemoModeGuard } from './demo-mode.guard';

describe('DemoModeGuard', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('blocks the demo route outside the exact safe demo environment', () => {
    process.env.APP_STAGE = 'live';
    process.env.DEMO_CONSOLE_ENABLED = 'false';
    process.env.EXTERNAL_INTEGRATIONS_MODE = 'real';

    expect(() => new DemoModeGuard().canActivate()).toThrow(ForbiddenException);
  });

  it('allows the route only for demo with mock external integrations', () => {
    process.env.APP_STAGE = 'demo';
    process.env.DEMO_CONSOLE_ENABLED = 'true';
    process.env.EXTERNAL_INTEGRATIONS_MODE = 'mock';

    expect(new DemoModeGuard().canActivate()).toBe(true);
  });
});
