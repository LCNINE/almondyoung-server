import { SellableSettleGate } from './sellable-settle-gate';

const now = new Date('2026-11-10T01:00:00Z');
const settleMs = 300_000;

function makeGate(pendingVariantIds: string[]) {
  const where = jest.fn().mockResolvedValue(pendingVariantIds.map((aggregateId) => ({ aggregateId })));
  const db = { select: jest.fn(() => ({ from: jest.fn(() => ({ where })) })) };
  const config = { get: jest.fn().mockReturnValue(settleMs) };
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

  it('RESERVATION_PROJECTION_SETTLE_MS 기본값은 300000', () => {
    const config = { get: jest.fn((_k: string, d: number) => d) };
    const gate = new SellableSettleGate({ db: {} } as never, config as never);
    expect(config.get).toHaveBeenCalledWith('RESERVATION_PROJECTION_SETTLE_MS', 300000);
    expect(gate).toBeDefined();
  });
});
