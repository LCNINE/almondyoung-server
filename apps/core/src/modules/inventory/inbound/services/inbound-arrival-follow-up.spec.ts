import { InboundArrivalReservations } from '../kernel/inbound-arrival-reservations.port';
import { DbTx } from '../../schema/inventory.schema';
import { InboundArrivalFollowUp } from './inbound-arrival-follow-up';
import { InboundService } from './inbound.service';

class FakeReservations extends InboundArrivalReservations {
  readonly calls: Array<{ warehouseId: string; skuIds: readonly string[] }> = [];
  constructor(private readonly failure?: Error) {
    super();
  }
  retryForSkus(warehouseId: string, skuIds: readonly string[]): Promise<void> {
    this.calls.push({ warehouseId, skuIds });
    return this.failure ? Promise.reject(this.failure) : Promise.resolve();
  }
}

describe('InboundArrivalFollowUp', () => {
  it('중복 없는 상품으로 포트를 부른다', async () => {
    const reservations = new FakeReservations();
    await new InboundArrivalFollowUp(reservations).afterArrival('wh', ['a', 'a', 'b']);
    expect(reservations.calls).toEqual([{ warehouseId: 'wh', skuIds: ['a', 'b'] }]);
  });

  it('포트가 던져도 던지지 않는다', async () => {
    const reservations = new FakeReservations(new Error('lock timeout'));
    await expect(new InboundArrivalFollowUp(reservations).afterArrival('wh', ['a'])).resolves.toBeUndefined();
    expect(reservations.calls).toHaveLength(1);
  });
});

describe('InboundService 입고 뒤 예약 재시도 호출', () => {
  const RESULT = { receipt: { id: 'r' }, lines: [] };

  function build() {
    const reservations = new FakeReservations();
    // 멱등 래퍼만 세운다 — 본문(커널)은 통합 스펙이 본다. 나머지 의존성은 도달하지 않는다
    const idempotency = { withIdempotency: jest.fn().mockResolvedValue(RESULT) };
    const svc = new InboundService(
      {} as never,
      {} as never,
      {} as never,
      idempotency as never,
      {} as never,
      new InboundArrivalFollowUp(reservations),
    );
    return { svc, reservations };
  }

  const dto = {
    warehouseId: 'wh',
    idempotencyKey: 'k',
    items: [
      { skuId: 'a', quantity: 1 },
      { skuId: 'b', quantity: 2 },
    ],
  };

  it('tx 없이 간편입고하면 입고한 상품으로 afterArrival 을 부른다', async () => {
    const { svc, reservations } = build();
    await expect(svc.simpleInbound(dto)).resolves.toBe(RESULT);
    await expect(svc.simpleInboundFullscan(dto)).resolves.toBe(RESULT);
    await svc.individualInbound({ warehouseId: 'wh', idempotencyKey: 'k', skuId: 'c', quantity: 1 });
    expect(reservations.calls).toEqual([
      { warehouseId: 'wh', skuIds: ['a', 'b'] },
      { warehouseId: 'wh', skuIds: ['a', 'b'] },
      { warehouseId: 'wh', skuIds: ['c'] },
    ]);
  });

  it('바깥 tx 로 부르면 afterArrival 을 부르지 않는다', async () => {
    const { svc, reservations } = build();
    const outer = {} as DbTx;
    await expect(svc.simpleInbound(dto, outer)).resolves.toBe(RESULT);
    await svc.simpleInboundFullscan(dto, outer);
    await svc.individualInbound({ warehouseId: 'wh', idempotencyKey: 'k', skuId: 'c', quantity: 1 }, outer);
    expect(reservations.calls).toEqual([]);
  });
});
