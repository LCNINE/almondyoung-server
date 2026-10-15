import { eventNoticeKey } from './event-notice-key';

describe('eventNoticeKey', () => {
  it('messageId·eventKey·userId 로 키를 만든다', () => {
    expect(eventNoticeKey('m-1', 'USER_WELCOME', 'u-1')).toBe('event:m-1:USER_WELCOME:u-1');
  });

  // 빈 messageId 로 키를 만들면 `event:undefined:…` 하나가 그 유형의 이후 알림을 전부 «중복»으로 삼킨다.
  it('messageId 가 비면 키를 만들지 않는다', () => {
    expect(eventNoticeKey('', 'USER_WELCOME', 'u-1')).toBeUndefined();
    expect(eventNoticeKey(undefined as unknown as string, 'USER_WELCOME', 'u-1')).toBeUndefined();
  });
});
