import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AlimtalkAutoNoticesController } from './alimtalk-auto-notices.controller';
import { AlimtalkCampaignsController } from './alimtalk-campaigns.controller';
import { AlimtalkTemplatesController } from './alimtalk-templates.controller';

const guarded = (controller: { prototype: object }, method: string): boolean => {
  const handler: unknown = Reflect.get(controller.prototype, method);
  return typeof handler === 'function' && (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).length > 0;
};

describe('알림톡 라우트 권한', () => {
  it.each([
    [AlimtalkTemplatesController, 'create'],
    [AlimtalkTemplatesController, 'update'],
    [AlimtalkTemplatesController, 'comment'],
    [AlimtalkTemplatesController, 'testSend'],
    [AlimtalkCampaignsController, 'create'],
    [AlimtalkCampaignsController, 'stop'],
    [AlimtalkAutoNoticesController, 'link'],
    [AlimtalkAutoNoticesController, 'unlink'],
  ])('카카오에 쓰거나 실제로 보내는 %p.%s 는 역할 가드를 단다', (controller, method) => {
    expect(guarded(controller, method)).toBe(true);
  });
});
