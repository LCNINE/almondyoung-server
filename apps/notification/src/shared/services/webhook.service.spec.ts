import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DbService } from '@app/db';
import { notificationTables } from '../../../database/schemas/notification-schema';
import type { AlertService } from './alert.service';
import type { VerificationFallbackService } from '../../provider/services/verification-fallback.service';
import { WebhookService } from './webhook.service';

const safeDemoEnvironment = {
  APP_STAGE: 'demo',
  DEMO_CONSOLE_ENABLED: 'true',
  EXTERNAL_INTEGRATIONS_MODE: 'mock',
};

function createService(environment: Record<string, string>) {
  return new WebhookService(
    {} as DbService<typeof notificationTables>,
    new ConfigService(environment),
    {} as AlertService,
    {} as VerificationFallbackService,
  );
}

describe('WebhookService demo boundary', () => {
  it('starts without a Resend webhook secret only in the exact safe demo environment', () => {
    expect(() => createService(safeDemoEnvironment)).not.toThrow();
  });

  it('rejects Resend webhook handling before parsing or verification in demo', async () => {
    const service = createService(safeDemoEnvironment);

    await expect(
      service.handleResendWebhook('not-json', {
        'svix-id': 'demo-id',
        'svix-timestamp': '0',
        'svix-signature': 'demo-signature',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    { APP_STAGE: 'live', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'false', EXTERNAL_INTEGRATIONS_MODE: 'mock' },
    { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'real' },
  ])('keeps the Resend secret fail-fast outside exact safe demo mode', (environment) => {
    expect(() => createService(environment)).toThrow('RESEND_WEBHOOK_SECRET');
  });
});
