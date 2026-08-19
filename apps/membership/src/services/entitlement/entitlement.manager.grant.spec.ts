import { EntitlementManager } from './entitlement.manager';

/**
 * 관리자 구독 지급(grantByDays)이 MembershipStatusChanged(ACTIVE) 를 지급 트랜잭션의
 * 아웃박스에 원자적으로 기록하는지 검증. 트랜잭션 밖 fire-and-forget 발행은 순간 실패 시
 * 영구 유실돼 Medusa 그룹 동기화가 누락된다.
 */
describe('EntitlementManager.grantByDays — 아웃박스 원자 기록', () => {
  function makeChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'innerJoin', 'orderBy', 'for']) {
      chain[m] = () => chain;
    }
    chain.limit = () => Promise.resolve(result);
    return chain;
  }

  it('지급 트랜잭션 객체(tx)로 MembershipStatusChanged(ACTIVE) 를 저장한다', async () => {
    const selectResults: unknown[][] = [
      [], // 활성 권한 없음
      [{ planId: 'p1', tierId: 't1' }], // 직전 계약의 플랜 재사용
    ];
    let insertSeq = 0;
    const tx = {
      select: () => makeChain(selectResults.shift() ?? []),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => Promise.resolve([{ id: `row-${++insertSeq}`, ...v }]),
        }),
      }),
    };
    const dbService = { db: { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } };
    const saveStatusChanged = jest.fn().mockResolvedValue(undefined);

    const manager = new EntitlementManager(dbService as never, { saveStatusChanged } as never);
    const result = await manager.grantByDays('u1', 30, 'memo', 'admin1');

    expect(saveStatusChanged).toHaveBeenCalledTimes(1);
    expect(saveStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        status: 'ACTIVE',
        contractId: result.contractId,
        planId: 'p1',
        tierId: 't1',
      }),
      tx,
    );
  });

  it('아웃박스 기록이 실패하면 지급 트랜잭션 전체가 실패한다', async () => {
    const selectResults: unknown[][] = [[], [{ planId: 'p1', tierId: 't1' }]];
    const tx = {
      select: () => makeChain(selectResults.shift() ?? []),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => Promise.resolve([{ id: 'row-1', ...v }]),
        }),
      }),
    };
    const dbService = { db: { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } };
    const saveStatusChanged = jest.fn().mockRejectedValue(new Error('outbox insert failed'));

    const manager = new EntitlementManager(dbService as never, { saveStatusChanged } as never);
    await expect(manager.grantByDays('u1', 30, null, 'admin1')).rejects.toThrow('outbox insert failed');
  });
});
