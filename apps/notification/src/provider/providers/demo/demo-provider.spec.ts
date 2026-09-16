import { NHNTemplateService } from '../../../template/services/nhn-template.service';
import { ConfigService } from '@nestjs/config';
import { ProviderFactory } from '../../factories/provider.factory';
import { validateNotificationEnv } from '../../../config/env.validation';

describe('demo notification boundary', () => {
  const config = { APP_STAGE: 'demo', EXTERNAL_INTEGRATIONS_MODE: 'mock' };
  it.each(['Resend Email', 'NHN SMS', 'NHN KakaoTalk', 'FCM Push'])(
    'records a simulated %s outcome without real provider setup',
    async (name) => {
      const provider = new ProviderFactory(new ConfigService(config)).create(name, 'provider-id', {});
      expect(provider).not.toBeNull();
      expect(await provider!.isAvailable()).toBe(true);
      const result = await provider!.send({
        to: 'demo@example.invalid',
        content: '시연 알림',
        metadata: { notificationId: 'n1' },
      });
      expect(result.success).toBe(true);
      expect(result.providerResponse).toMatchObject({ simulated: true, stage: 'demo', content: '시연 알림' });
      expect(
        await provider!.send({ to: 'demo@example.invalid', content: '시연 알림', metadata: { notificationId: 'n1' } }),
      ).toEqual(result);
    },
  );
  it('blocks NHN template transport even when credentials are supplied', async () => {
    const templates = new NHNTemplateService(
      new ConfigService({ ...config, NHN_APP_KEY: 'unused', NHN_SECRET_KEY: 'unused', NHN_SENDER_KEY: 'unused' }),
    );
    await expect(templates.getCategories()).rejects.toThrow('시연 환경');
  });
  it('rejects demo startup without explicitly mocked integrations', () => {
    expect(() => validateNotificationEnv({ DATABASE_URL: 'postgresql://localhost/test', APP_STAGE: 'demo' })).toThrow();
  });
});
