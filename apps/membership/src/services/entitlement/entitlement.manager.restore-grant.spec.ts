import { EntitlementManager } from './entitlement.manager';

describe('EntitlementManager.restoreTakenOverGrant', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T03:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function makeChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'innerJoin', 'orderBy', 'for']) {
      chain[m] = () => chain;
    }
    chain.limit = () => Promise.resolve(result);
    return chain;
  }

  function setup(selectResults: unknown[][], onFirstSelect?: () => void) {
    const inserted: Array<Record<string, unknown>> = [];
    let insertSeq = 0;
    let fired = false;
    const tx = {
      select: jest.fn(() => {
        if (onFirstSelect && !fired) {
          fired = true;
          onFirstSelect();
        }
        return makeChain(selectResults.shift() ?? []);
      }),
      insert: jest.fn(() => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          return { returning: () => Promise.resolve([{ id: `row-${++insertSeq}`, ...v }]) };
        },
      })),
    };
    const dbService = { run: (fn: (t: unknown) => Promise<unknown>, outer?: unknown) => fn(outer ?? tx) };
    const saveStatusChanged = jest.fn().mockResolvedValue(undefined);
    const manager = new EntitlementManager(dbService as never, { saveStatusChanged } as never);
    return { manager, tx, inserted };
  }

  const contract = { id: 'c-new', userId: 'u1', billingDate: '2026-11-15' as string | null };

  it('이어받기 계약이고 유료 시작 전이면 billingDate − 오늘 만큼 지급한다', async () => {
    const { manager, tx, inserted } = setup([
      [{ id: 1 }], // SUPERSEDED_BY_SUBSCRIPTION 이벤트
      [], // 활성 권한 없음
      [{ planId: 'p1', tierId: 't1' }], // 직전 계약 플랜
    ]);

    const days = await manager.restoreTakenOverGrant(tx as never, contract);

    expect(days).toBe(20);
    expect(inserted.find((v) => 'endsAt' in v)).toMatchObject({ endsAt: '2026-11-15' });
  });

  it('조회 중 UTC 자정을 넘겨도 종료일은 billingDate 그대로다', async () => {
    jest.setSystemTime(new Date('2026-10-26T23:59:59.999Z'));
    const { manager, tx, inserted } = setup([[{ id: 1 }], [], [{ planId: 'p1', tierId: 't1' }]], () =>
      jest.setSystemTime(new Date('2026-10-27T00:00:00.500Z')),
    );

    const days = await manager.restoreTakenOverGrant(tx as never, contract);

    expect(days).toBe(20);
    expect(inserted.find((v) => 'endsAt' in v)).toMatchObject({ startsAt: '2026-10-26', endsAt: '2026-11-15' });
  });

  it('grantByDays 는 조회 중 자정을 넘겨도 startsAt 과 endsAt 이 같은 기준일에서 나온다', async () => {
    jest.setSystemTime(new Date('2026-10-26T23:59:59.999Z'));
    const { manager, inserted } = setup([[], [{ planId: 'p1', tierId: 't1' }]], () =>
      jest.setSystemTime(new Date('2026-10-27T00:00:00.500Z')),
    );

    await manager.grantByDays('u1', 1, null, 'admin1');

    expect(inserted.find((v) => 'endsAt' in v)).toMatchObject({ startsAt: '2026-10-26', endsAt: '2026-10-27' });
  });

  it('billingDate 가 오늘이면 0 을 반환하고 아무것도 쓰지 않는다', async () => {
    const { manager, tx } = setup([[{ id: 1 }]]);

    const days = await manager.restoreTakenOverGrant(tx as never, { ...contract, billingDate: '2026-10-26' });

    expect(days).toBe(0);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('이어받기 계약이 아니면 0 을 반환하고 아무것도 쓰지 않는다', async () => {
    const { manager, tx } = setup([[]]);

    const days = await manager.restoreTakenOverGrant(tx as never, contract);

    expect(days).toBe(0);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('billingDate 가 null 이면 0', async () => {
    const { manager, tx } = setup([[{ id: 1 }]]);

    const days = await manager.restoreTakenOverGrant(tx as never, { ...contract, billingDate: null });

    expect(days).toBe(0);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
