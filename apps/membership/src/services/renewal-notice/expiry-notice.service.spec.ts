import { ExpiryNoticeService } from './expiry-notice.service';
import { ExpiryNoticeTarget } from '../billing/billing.reader';

// 고지 발행의 계약을 검증한다:
// 1) 연락처가 없으면 마커를 남기지 않는다(다음 날 재시도돼야 함)
// 2) 이벤트와 마커가 같은 트랜잭션에 함께 들어간다
function makeService(
  targets: ExpiryNoticeTarget[],
  contacts: Map<string, { userId: string; email: string; username: string }>,
) {
  const enqueued: any[] = [];
  const markedIds: string[] = [];

  const tx = {
    update: () => ({
      set: (values: { expiryNoticeSentAt: Date }) => ({
        where: async () => {
          markedIds.push(String(values.expiryNoticeSentAt instanceof Date));
        },
      }),
    }),
  };

  const dbService = {
    db: { transaction: async (fn: (t: unknown) => Promise<void>) => fn(tx) },
  } as any;

  const billingReader = { findEntitlementsForExpiryNotice: jest.fn().mockResolvedValue(targets) } as any;
  const publisher = {
    saveExpiryUpcoming: jest.fn(async (payload) => {
      enqueued.push(payload);
    }),
  } as any;
  const userContactClient = { findContacts: jest.fn().mockResolvedValue(contacts) } as any;

  const service = new ExpiryNoticeService(dbService, billingReader, publisher, userContactClient);
  return { service, enqueued, markedIds, userContactClient };
}

const target: ExpiryNoticeTarget = {
  entitlementId: 'e1',
  userId: 'u1',
  endsAt: '2026-08-26',
};

describe('ExpiryNoticeService', () => {
  it('연락처가 있으면 이벤트를 발행하고 고지 마커를 남긴다', async () => {
    const contacts = new Map([['u1', { userId: 'u1', email: 'a@b.com', username: '홍길동' }]]);
    const { service, enqueued, markedIds } = makeService([target], contacts);

    const sent = await service.notifyForExpiryDate('2026-08-26');

    expect(sent).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].email).toBe('a@b.com');
    expect(enqueued[0].entitlementId).toBe('e1');
    expect(enqueued[0].expiresAt).toBe('2026-08-26');
    expect(enqueued[0].noticeDaysBefore).toBe(7);
    expect(markedIds).toHaveLength(1);
  });

  it('연락처가 없으면 발행도 마커도 남기지 않는다', async () => {
    const { service, enqueued, markedIds } = makeService([target], new Map());

    const sent = await service.notifyForExpiryDate('2026-08-26');

    expect(sent).toBe(0);
    expect(enqueued).toHaveLength(0);
    expect(markedIds).toHaveLength(0);
  });

  it('대상이 없으면 user-service 를 호출하지 않는다', async () => {
    const { service, userContactClient } = makeService([], new Map());
    expect(await service.notifyForExpiryDate('2026-08-26')).toBe(0);
    expect(userContactClient.findContacts).not.toHaveBeenCalled();
  });
});
