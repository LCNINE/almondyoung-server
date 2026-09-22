import { MembershipEventConsumer } from './membership-event.consumer';
import { UserEventConsumer } from './user-event.consumer';

const active = (eventKey: string, isActive = true) => ({
  eventKey,
  isActive,
  defaultChannels: ['EMAIL'],
  category: 'SYSTEM',
  templateKey: `${eventKey}_EMAIL`,
  priority: 'NORMAL',
});

function deps(contactEmail?: string) {
  const send = jest.fn().mockResolvedValue({ notificationIds: [] });
  const getEventMapping = jest.fn((key: string) => Promise.resolve(active(key)));
  const contacts = {
    findContacts: jest
      .fn()
      .mockResolvedValue(
        contactEmail
          ? new Map([
              [
                'user-1',
                {
                  userId: 'user-1',
                  email: contactEmail,
                  username: '홍길동',
                  phoneNumber: null,
                  marketingConsent: false,
                },
              ],
            ])
          : new Map(),
      ),
  };
  return { send, getEventMapping, contacts, args: [{ send }, { getEventMapping }, contacts] as never[] };
}

const envelope = { correlationId: 'c-1' } as never;

describe('회원 가입·탈퇴 알림', () => {
  it('가입하면 활성 회원 메일로 환영 메일을 보낸다', async () => {
    const d = deps('member@example.com');
    const consumer = new UserEventConsumer(...(d.args as [never, never, never]));

    await consumer.onUserCreated(envelope, { userId: 'user-1', email: 'member@example.com', name: '홍길동' });

    expect(d.getEventMapping).toHaveBeenCalledWith('USER_WELCOME');
    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ email: 'member@example.com' }) }),
    );
  });

  it('탈퇴 메일은 연락처 조회 없이 이벤트에 실린 익명화 전 메일로 보낸다', async () => {
    const d = deps();
    const consumer = new UserEventConsumer(...(d.args as [never, never, never]));

    await consumer.onUserDeleted(envelope, { userId: 'user-1', email: 'left@example.com', name: '홍길동' });

    expect(d.contacts.findContacts).not.toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'USER_WITHDRAWN',
        payload: expect.objectContaining({ email: 'left@example.com' }),
      }),
    );
  });

  it('메일이 없는 탈퇴 이벤트(재발행 백필)는 보내지 않는다', async () => {
    const d = deps();
    const consumer = new UserEventConsumer(...(d.args as [never, never, never]));

    await consumer.onUserDeleted(envelope, { userId: 'user-1' });

    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('멤버십 가입·해지 알림', () => {
  const change = { userId: 'user-1', occurredAt: '2026-09-22T01:00:00.000Z' };

  it.each([
    [{ status: 'ACTIVE', reasonCode: 'SUBSCRIBED' }, 'MEMBERSHIP_JOINED'],
    [{ status: 'CANCELLED', reasonCode: 'USER_REQUESTED' }, 'MEMBERSHIP_CANCELLED'],
    [{ status: 'RECURRING_CANCELLED' }, 'MEMBERSHIP_CANCELLED'],
  ])('%o 는 %s', async (override, eventKey) => {
    const d = deps('member@example.com');
    const consumer = new MembershipEventConsumer(...(d.args as [never, never, never]));

    await consumer.onStatusChanged(envelope, { ...change, ...override } as never);

    expect(d.getEventMapping).toHaveBeenCalledWith(eventKey);
  });

  it('예약 해지는 종료일 안내를 싣고, 즉시 해지는 비운다', async () => {
    const d = deps('member@example.com');
    const consumer = new MembershipEventConsumer(...(d.args as [never, never, never]));

    await consumer.onStatusChanged(envelope, {
      ...change,
      status: 'RECURRING_CANCELLED',
      periodEndsAt: '2026-10-22T00:00:00.000Z',
    } as never);
    await consumer.onStatusChanged(envelope, { ...change, status: 'CANCELLED' } as never);

    const [scheduled, immediate] = d.send.mock.calls.map(([dto]) => dto.variables.periodNotice);
    expect(scheduled).toContain('종료일까지는');
    expect(immediate).toBe('');
  });

  it('갱신 성공·해지 취소(사유 없는 ACTIVE)와 만료는 보내지 않는다', async () => {
    const d = deps('member@example.com');
    const consumer = new MembershipEventConsumer(...(d.args as [never, never, never]));

    await consumer.onStatusChanged(envelope, { ...change, status: 'ACTIVE' } as never);
    await consumer.onStatusChanged(envelope, { ...change, status: 'EXPIRED' } as never);

    expect(d.send).not.toHaveBeenCalled();
  });

  it('탈퇴로 연락처가 없으면 강제 해지 메일을 보내지 않는다', async () => {
    const d = deps();
    const consumer = new MembershipEventConsumer(...(d.args as [never, never, never]));

    await consumer.onStatusChanged(envelope, { ...change, status: 'CANCELLED', reasonCode: 'ADMIN_FORCED' } as never);

    expect(d.send).not.toHaveBeenCalled();
  });
});
