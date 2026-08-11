import { RenewalNoticeService } from './renewal-notice.service';
import { RenewalNoticeTarget } from '../billing/billing.reader';

// 고지 발행의 세 가지 계약을 검증한다:
// 1) 연락처가 없으면 마커를 남기지 않는다(다음 날 재시도돼야 함)
// 2) 이벤트와 마커가 같은 트랜잭션에 함께 들어간다
// 3) nextPeriodEnd 는 결제 예정일 + durationDays 다
function makeService(targets: RenewalNoticeTarget[], contacts: Map<string, { userId: string; email: string; username: string }>) {
  const enqueued: any[] = [];
  const markers: any[] = [];

  const dbService = {
    db: { transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}) },
  } as any;

  const billingReader = { findContractsForRenewalNotice: jest.fn().mockResolvedValue(targets) } as any;
  const contractEventManager = {
    addEvent: jest.fn(async (_tx, contractId, eventType, metadata) => {
      markers.push({ contractId, eventType, metadata });
    }),
  } as any;
  const publisher = {
    saveRenewalUpcoming: jest.fn(async (payload) => {
      enqueued.push(payload);
    }),
  } as any;
  const userContactClient = { findContacts: jest.fn().mockResolvedValue(contacts) } as any;

  const service = new RenewalNoticeService(
    dbService,
    billingReader,
    contractEventManager,
    publisher,
    userContactClient,
  );
  return { service, enqueued, markers };
}

const target: RenewalNoticeTarget = {
  contractId: 'c1',
  userId: 'u1',
  nextBillingDate: '2026-08-18',
  amount: 9900,
  durationDays: 30,
  tierCode: 'BASIC',
  currentPeriodEnd: '2026-08-18',
};

describe('RenewalNoticeService', () => {
  it('연락처가 있으면 이벤트와 고지 마커를 함께 남긴다', async () => {
    const contacts = new Map([['u1', { userId: 'u1', email: 'a@b.com', username: '홍길동' }]]);
    const { service, enqueued, markers } = makeService([target], contacts);

    const sent = await service.notifyForBillingDate('2026-08-18');

    expect(sent).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].email).toBe('a@b.com');
    expect(enqueued[0].nextBillingDate).toBe('2026-08-18');
    // 30일 플랜 → 갱신 후 종료일은 결제일 + 30일
    expect(enqueued[0].nextPeriodEnd).toBe('2026-09-17');
    expect(enqueued[0].noticeDaysBefore).toBe(7);

    expect(markers).toHaveLength(1);
    expect(markers[0].eventType).toBe('RENEWAL_NOTICE_SENT');
    expect(markers[0].metadata.nextBillingDate).toBe('2026-08-18');
  });

  it('연락처가 없으면 발행도 마커도 남기지 않는다', async () => {
    const { service, enqueued, markers } = makeService([target], new Map());

    const sent = await service.notifyForBillingDate('2026-08-18');

    expect(sent).toBe(0);
    expect(enqueued).toHaveLength(0);
    expect(markers).toHaveLength(0);
  });

  it('대상이 없으면 user-service 를 호출하지 않는다', async () => {
    const { service } = makeService([], new Map());
    expect(await service.notifyForBillingDate('2026-08-18')).toBe(0);
  });
});
