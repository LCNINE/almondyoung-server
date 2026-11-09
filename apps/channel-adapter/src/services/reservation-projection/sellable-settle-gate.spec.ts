import { SellableSettleGate } from './sellable-settle-gate';

const now = new Date('2026-11-10T01:00:00Z');
const settleMs = 300_000;

function makeGate(pendingVariantIds: string[]) {
  const where = jest.fn().mockResolvedValue(pendingVariantIds.map((aggregateId) => ({ aggregateId })));
  const db = { select: jest.fn(() => ({ from: jest.fn(() => ({ where })) })) };
  const config = { get: jest.fn().mockReturnValue(settleMs) };
  // 단위 스펙은 select 체인 스텁만 필요하다 — 실 DbService 대신 `as never` 로 넘긴다
  const gate = new SellableSettleGate({ db } as never, config as never);
  return { gate, db, where };
}

describe('SellableSettleGate.blockedVariantIds', () => {
  it('정착 지연 안이면 DB 를 보지 않고 전부 막는다', async () => {
    const { gate, db } = makeGate([]);
    const asOf = new Date(now.getTime() - settleMs + 1);
    await expect(gate.blockedVariantIds(['v1', 'v2'], asOf, now)).resolves.toEqual(new Set(['v1', 'v2']));
    expect(db.select).not.toHaveBeenCalled();
  });

  it('지연 밖이면 처리 안 된 inbox 행이 있는 variant 만 막는다', async () => {
    const { gate } = makeGate(['v2']);
    const asOf = new Date(now.getTime() - settleMs);
    await expect(gate.blockedVariantIds(['v1', 'v2'], asOf, now)).resolves.toEqual(new Set(['v2']));
  });

  it('variant 가 없으면 DB 를 보지 않는다', async () => {
    const { gate, db } = makeGate([]);
    await expect(gate.blockedVariantIds([], new Date(0), now)).resolves.toEqual(new Set());
    expect(db.select).not.toHaveBeenCalled();
  });

  it('asOf 가 Invalid Date 면 DB 를 보지 않고 전부 막는다', async () => {
    const { gate, db } = makeGate([]);
    await expect(gate.blockedVariantIds(['v1'], new Date('nope'), now)).resolves.toEqual(new Set(['v1']));
    expect(db.select).not.toHaveBeenCalled();
  });

  it.each(['', 'abc', '0', '-5', 0, -1])('설정값 %p 는 기본 300000 으로 되돌린다', async (bad) => {
    const where = jest.fn().mockResolvedValue([]);
    const db = { select: jest.fn(() => ({ from: jest.fn(() => ({ where })) })) };
    const gate = new SellableSettleGate({ db } as never, { get: jest.fn().mockReturnValue(bad) } as never);
    // 299초 전 스냅샷: 기본 지연(300초) 안이라 막혀야 한다 (지연 0 으로 열리면 DB 를 본다)
    const asOf = new Date(now.getTime() - 299_000);
    await expect(gate.blockedVariantIds(['v1'], asOf, now)).resolves.toEqual(new Set(['v1']));
    expect(db.select).not.toHaveBeenCalled();
  });
});
