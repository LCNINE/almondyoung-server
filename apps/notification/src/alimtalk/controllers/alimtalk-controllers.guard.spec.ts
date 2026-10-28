import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AlimtalkAutoNoticesController } from './alimtalk-auto-notices.controller';
import { AlimtalkCampaignsController } from './alimtalk-campaigns.controller';
import { AlimtalkTemplatesController } from './alimtalk-templates.controller';

const metadataOf = (controller: { prototype: object }, method: string, key: string): unknown => {
  const handler: unknown = Reflect.get(controller.prototype, method);
  return typeof handler === 'function' ? Reflect.getMetadata(key, handler) : undefined;
};

describe('알림톡 라우트 권한', () => {
  it.each([
    [AlimtalkTemplatesController, 'create', 'messaging.template.write'],
    [AlimtalkTemplatesController, 'update', 'messaging.template.write'],
    [AlimtalkTemplatesController, 'comment', 'messaging.template.write'],
    [AlimtalkTemplatesController, 'testSend', 'messaging.message.send'],
    [AlimtalkCampaignsController, 'create', 'messaging.message.bulk_send'],
    [AlimtalkCampaignsController, 'stop', 'messaging.message.bulk_send'],
    [AlimtalkAutoNoticesController, 'link', 'messaging.template.write'],
    [AlimtalkAutoNoticesController, 'unlink', 'messaging.template.write'],
  ])('카카오에 쓰거나 실제로 보내는 %p.%s 는 권한 %s 로만 판정한다', (controller, method, permission) => {
    expect(metadataOf(controller, method, REQUIRED_PERMISSIONS_KEY)).toEqual([permission]);
    expect(metadataOf(controller, method, GUARDS_METADATA)).toBeUndefined();
  });
});
