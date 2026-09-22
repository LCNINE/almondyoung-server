import { MembershipEventConsumer } from './membership-event.consumer';
import { UserEventConsumer } from './user-event.consumer';
import { notifyMember } from './notify-member';
import { markAdvertisementEmail } from '../services/notification-dispatcher.service';

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

describe('광고성 알림', () => {
  function adDeps(marketingConsent: boolean) {
    const send = jest.fn().mockResolvedValue({ notificationIds: [] });
    const eventMappings = {
      getEventMapping: jest.fn().mockResolvedValue({ ...active('PROMOTION_AD'), category: 'MARKETING' }),
    };
    const contacts = {
      findContacts: jest.fn().mockResolvedValue(
        new Map([
          ['user-1', { userId: 'user-1', email: 'member@example.com', username: '홍길동', phoneNumber: null, marketingConsent }],
        ]),
      ),
    };
    const logger = { warn: jest.fn(), log: jest.fn() };
    return { send, deps: { dispatcher: { send }, eventMappings, contacts, logger } as never };
  }

  const input = { eventKey: 'PROMOTION_AD', userId: 'user-1', payload: {}, variables: () => ({}) };

  it('광고성 정보 수신에 동의하지 않은 회원에게는 보내지 않는다', async () => {
    const d = adDeps(false);
    await notifyMember(d.deps, input);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('동의한 회원에게는 보낸다', async () => {
    const d = adDeps(true);
    await notifyMember(d.deps, input);
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('광고 메일은 제목에 (광고)를 한 번만 붙이고 수신 설정 안내를 덧붙인다', () => {
    const marked = markAdvertisementEmail('[아몬드영] 쿠폰이 곧 만료됩니다', '<p>본문</p>');
    expect(marked.subject).toBe('(광고) [아몬드영] 쿠폰이 곧 만료됩니다');
    expect(marked.body).toContain('/mypage/account/profile#marketing-consent');
    expect(markAdvertisementEmail(marked.subject, '<p>본문</p>').subject).toBe(marked.subject);
    expect(markAdvertisementEmail(undefined, '<p>본문</p>').subject).toBe('(광고) [아몬드영] 혜택 소식');
    expect(markAdvertisementEmail('  ', '<p>본문</p>').subject).toBe('(광고) [아몬드영] 혜택 소식');
  });
});
