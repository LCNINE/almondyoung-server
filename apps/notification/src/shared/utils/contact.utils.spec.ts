import { getContactForChannel } from './contact.utils';
import { Channel } from '../enums';

describe('getContactForChannel', () => {
  const profile = {
    userId: 'u1',
    email: 'customer@example.com',
    phoneNumber: '010-1234-5678',
    pushToken: 'fcm-token',
  };

  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('운영에서는 실제 고객 연락처를 그대로 반환한다', () => {
    process.env.NODE_ENV = 'production';

    expect(getContactForChannel(profile, Channel.EMAIL)).toBe('customer@example.com');
    expect(getContactForChannel(profile, Channel.SMS)).toBe('010-1234-5678');
    expect(getContactForChannel(profile, Channel.PUSH)).toBe('fcm-token');
  });

  it('운영이 아니면 실제 고객 연락처를 절대 반환하지 않는다', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NOTIFICATION_DEV_EMAIL;
    delete process.env.NOTIFICATION_DEV_PHONE;

    expect(getContactForChannel(profile, Channel.EMAIL)).toBeNull();
    expect(getContactForChannel(profile, Channel.SMS)).toBeNull();
    expect(getContactForChannel(profile, Channel.KAKAO)).toBeNull();
    expect(getContactForChannel(profile, Channel.PUSH)).toBeNull();
  });

  it('운영이 아닐 때 개발자 연락처가 지정돼 있으면 그쪽으로 치환한다', () => {
    process.env.NODE_ENV = 'development';
    process.env.NOTIFICATION_DEV_EMAIL = 'dev@lcnine.kr';
    process.env.NOTIFICATION_DEV_PHONE = '010-0000-0000';

    expect(getContactForChannel(profile, Channel.EMAIL)).toBe('dev@lcnine.kr');
    expect(getContactForChannel(profile, Channel.KAKAO)).toBe('010-0000-0000');
    // 푸시는 대체 토큰이 없으므로 항상 스킵
    expect(getContactForChannel(profile, Channel.PUSH)).toBeNull();
  });

  it('연락처가 없으면 환경과 무관하게 null', () => {
    process.env.NODE_ENV = 'development';
    process.env.NOTIFICATION_DEV_EMAIL = 'dev@lcnine.kr';

    expect(getContactForChannel({ userId: 'u2' }, Channel.EMAIL)).toBeNull();
  });
});
