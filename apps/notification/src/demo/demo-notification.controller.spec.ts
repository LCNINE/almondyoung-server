import { ConfigService } from '@nestjs/config';
import { DemoNotificationController } from './demo-notification.controller';

describe('demo delivery history', () => {
  it.each([
    { APP_STAGE: 'live', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'false', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'real' },
  ])('hides history before DB access when configuration is unsafe', async (env) => {
    const controller = new DemoNotificationController(new ConfigService(env), {} as any);
    await expect(controller.list()).rejects.toMatchObject({ status: 404 });
  });
});
