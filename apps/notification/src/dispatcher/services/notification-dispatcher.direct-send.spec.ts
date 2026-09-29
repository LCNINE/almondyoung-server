import { NotificationDispatcherService } from './notification-dispatcher.service';
import { TemplateVariableMapperService } from '../../shared/services/template-variable-mapper.service';
import { Channel, NotificationCategory, NotificationStatus } from '../../shared/enums';

// 큐 처리기가 등록돼 있지 않아 모든 알림이 이 직접 발송 경로로 나간다.
describe('NotificationDispatcherService 직접 발송 — 공급자 결과 기록', () => {
  const prevDevPhone = process.env.NOTIFICATION_DEV_PHONE;
  beforeAll(() => {
    process.env.NOTIFICATION_DEV_PHONE = '01000000000';
  });
  afterAll(() => {
    if (prevDevPhone === undefined) delete process.env.NOTIFICATION_DEV_PHONE;
    else process.env.NOTIFICATION_DEV_PHONE = prevDevPhone;
  });

  const setup = (sendResult: { success: boolean; error?: string }) => {
    const statusWrites: string[] = [];
    const row = { notificationId: 'n-1', userId: 'u1', payload: { phoneNumber: '01012345678' } };
    const db = {
      query: {
        templates: { findFirst: jest.fn(async () => undefined) },
        notifications: { findFirst: jest.fn(async () => row) },
      },
      insert: () => ({ values: () => ({ returning: async () => [row] }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if (typeof values.status === 'string') statusWrites.push(values.status);
          },
        }),
      }),
    };
    const provider = { send: jest.fn(async () => sendResult) };
    const dispatcher = new NotificationDispatcherService(
      { db } as never,
      null,
      new TemplateVariableMapperService(),
      { getAvailableProviderForChannel: async () => provider } as never,
      null as never,
      null as never,
    );
    const send = () =>
      dispatcher.send({
        userId: 'u1',
        channels: [Channel.SMS],
        category: NotificationCategory.TRANSACTIONAL,
        content: { SMS: { body: '본문' } },
        payload: { phoneNumber: '01012345678' },
      });
    return { send, statusWrites, provider };
  };

  it('공급자가 success:false 를 돌려주면 SENT 가 아니라 FAILED 로 적는다', async () => {
    const { send, statusWrites, provider } = setup({ success: false, error: 'rejected' });
    await send();

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(statusWrites).toContain(NotificationStatus.FAILED);
    expect(statusWrites).not.toContain(NotificationStatus.SENT);
  });

  it('공급자가 success:true 면 SENT 로 적는다', async () => {
    const { send, statusWrites } = setup({ success: true });
    await send();

    expect(statusWrites).toContain(NotificationStatus.SENT);
    expect(statusWrites).not.toContain(NotificationStatus.FAILED);
  });
});
