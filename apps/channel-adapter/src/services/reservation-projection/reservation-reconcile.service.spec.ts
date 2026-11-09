import type { MedusaClient } from '../../adapters/medusa/medusa.client';
import type { CoreLineReservationStateClient } from '../clients/core-line-reservation-state.client';
import type { ReservationCutoverRepository } from './reservation-cutover.repository';
import type { ReservationProjectionService } from './reservation-projection.service';
import type { ReservationReconcileRunRepository } from './reservation-reconcile-run.repository';
import { ReservationReconcileService } from './reservation-reconcile.service';

const T = new Date('2026-11-01T00:00:00Z');

const line = (id: string | null, demand: number, variantId = 'v1') => ({
  salesOrderLineId: `l-${id}`,
  channelOrderItemId: id,
  variantId,
  ordered: demand,
  canceledBeforeShipment: 0,
  demand,
  heldUnits: 0,
  salesOrderId: 'so1',
  orderedAt: '2026-11-05T00:00:00Z',
});

function build(opts: { cutover?: Date | null; blocked?: string[] } = {}) {
  const medusa = {
    listLineItemReservations: jest.fn(),
    setLineItemReservations: jest.fn(),
  };
  const core = { candidates: jest.fn(), states: jest.fn() };
  const runs = { start: jest.fn().mockResolvedValue('run1'), finish: jest.fn().mockResolvedValue(undefined) };
  const projection = {
    toWrites: jest.fn(async (lines: { channelOrderItemId: string | null; demand: number; variantId: string }[]) =>
      lines
        .filter((l) => l.channelOrderItemId !== null)
        .map((l) => ({
          lineItemId: l.channelOrderItemId as string,
          quantity: l.demand,
          allowDecrease: !(opts.blocked ?? []).includes(l.variantId),
        })),
    ),
  };
  const cutover = { get: jest.fn().mockResolvedValue(opts.cutover === undefined ? T : opts.cutover) };
  const service = new ReservationReconcileService(
    cutover as unknown as ReservationCutoverRepository,
    medusa as unknown as MedusaClient,
    core as unknown as CoreLineReservationStateClient,
    projection as unknown as ReservationProjectionService,
    runs as unknown as ReservationReconcileRunRepository,
  );
  return { service, medusa, core, runs, projection };
}

const mres = (lineItemId: string, quantity: number, at = '2026-11-05T00:00:00Z') => ({
  id: `r-${lineItemId}`,
  lineItemId,
  quantity,
  orderCreatedAt: new Date(at),
});

describe('ReservationReconcileService', () => {
  it('T 없음 → 회차 기록도 호출도 없다', async () => {
    const { service, medusa, core, runs } = build({ cutover: null });
    const rec = await service.run({ limit: 10 });
    expect(rec.id).toBeNull();
    expect(runs.start).not.toHaveBeenCalled();
    expect(medusa.listLineItemReservations).not.toHaveBeenCalled();
    expect(core.candidates).not.toHaveBeenCalled();
  });

  it('후보는 Medusa 전 페이지 ∪ core 후보, core 쪽은 max(T, now-30일) 부터', async () => {
    const { service, medusa, core } = build();
    medusa.listLineItemReservations
      .mockResolvedValueOnce({ reservations: [mres('a', 1)], nextAfterId: 'r-a' })
      .mockResolvedValueOnce({ reservations: [mres('b', 1)], nextAfterId: null });
    core.candidates.mockResolvedValue(['b', 'c']);
    core.states.mockResolvedValue({ lines: [], unknown: [] });
    const rec = await service.run({ limit: 10 });
    expect(rec.candidates).toBe(3);
    expect(medusa.listLineItemReservations.mock.calls[0][0].orderCreatedFrom).toEqual(T);
    expect(medusa.listLineItemReservations.mock.calls[1][0].afterId).toBe('r-a');
    const from: Date = core.candidates.mock.calls[0][1];
    expect(from).toEqual(T); // now-30일(10-10)이 T(11-01)보다 이르므로 T
    expect(core.states.mock.calls[0][1].sort()).toEqual(['a', 'b', 'c']);
  });

  it('core 조회 두 번째 묶음 실패 → 쓰기 0, skipped, error', async () => {
    const { service, medusa, core, runs } = build();
    medusa.listLineItemReservations.mockResolvedValue({
      reservations: Array.from({ length: 201 }, (_, i) => mres(`i${i}`, 1)),
      nextAfterId: null,
    });
    core.candidates.mockResolvedValue([]);
    core.states.mockResolvedValueOnce({ lines: [line('i0', 3)], unknown: [] }).mockRejectedValueOnce(new Error('boom'));
    const rec = await service.run({ limit: 10 });
    expect(rec.status).toBe('skipped');
    expect(rec.error).toContain('boom');
    expect(medusa.setLineItemReservations).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith('run1', expect.objectContaining({ status: 'skipped' }));
  });

  it('Medusa 읽기 실패도 skipped·쓰기 0', async () => {
    const { service, medusa } = build();
    medusa.listLineItemReservations.mockRejectedValue(new Error('down'));
    const rec = await service.run({ limit: 10 });
    expect(rec.status).toBe('skipped');
    expect(medusa.setLineItemReservations).not.toHaveBeenCalled();
  });

  it('core 가 모르는 줄은 쓰지 않고 unknown·oldest_unknown_at 만 기록', async () => {
    const { service, medusa, core } = build();
    medusa.listLineItemReservations.mockResolvedValue({
      reservations: [mres('x', 2, '2026-11-03T00:00:00Z'), mres('y', 2, '2026-11-02T00:00:00Z'), mres('a', 1)],
      nextAfterId: null,
    });
    core.candidates.mockResolvedValue([]);
    core.states.mockResolvedValue({ lines: [line('a', 1)], unknown: ['x', 'y'] });
    const rec = await service.run({ limit: 10 });
    expect(medusa.setLineItemReservations).not.toHaveBeenCalled();
    expect(rec.unknown).toBe(2);
    expect(rec.oldestUnknownAt).toEqual(new Date('2026-11-02T00:00:00Z'));
  });

  it('고칠 줄 ≤ 한도 → 200줄씩 쓰고 set/error/deferred 를 센다, 같은 줄은 안 보냄', async () => {
    const { service, medusa, core } = build();
    const ids = Array.from({ length: 250 }, (_, i) => `i${i}`);
    medusa.listLineItemReservations.mockResolvedValue({
      reservations: [...ids.map((id) => mres(id, 1)), mres('same', 5)],
      nextAfterId: null,
    });
    core.candidates.mockResolvedValue([]);
    core.states.mockImplementation(async (_c: string, req: string[]) => ({
      lines: [...ids.map((id) => line(id, 2)), line('same', 5)].filter((l) => req.includes(l.channelOrderItemId as string)),
      unknown: [],
    }));
    medusa.setLineItemReservations.mockImplementation(async (items: { lineItemId: string }[]) =>
      items.map((it, idx) => ({
        lineItemId: it.lineItemId,
        outcome: idx === 0 ? 'error' : idx === 1 ? 'deferred' : idx === 2 ? 'not_managed' : 'set',
        quantityBefore: 1,
        quantityAfter: 2,
      })),
    );
    const rec = await service.run({ limit: 1000 });
    expect(medusa.setLineItemReservations).toHaveBeenCalledTimes(2);
    expect(medusa.setLineItemReservations.mock.calls[0][0]).toHaveLength(200);
    expect(medusa.setLineItemReservations.mock.calls[1][0]).toHaveLength(50);
    expect(rec).toMatchObject({ status: 'applied', fixes: 244, fixFailures: 2, deferred: 2 });
  });

  it('쓰기 묶음이 던지면 그 묶음을 실패로 세고 다음 묶음을 계속한다', async () => {
    const { service, medusa, core } = build();
    const ids = Array.from({ length: 250 }, (_, i) => `i${i}`);
    medusa.listLineItemReservations.mockResolvedValue({ reservations: ids.map((id) => mres(id, 1)), nextAfterId: null });
    core.candidates.mockResolvedValue([]);
    core.states.mockImplementation(async (_c: string, req: string[]) => ({
      lines: ids.filter((id) => req.includes(id)).map((id) => line(id, 2)),
      unknown: [],
    }));
    medusa.setLineItemReservations
      .mockRejectedValueOnce(new Error('timeout'))
      .mockImplementationOnce(async (items: { lineItemId: string }[]) =>
        items.map((it) => ({ lineItemId: it.lineItemId, outcome: 'set', quantityBefore: 1, quantityAfter: 2 })),
      );
    const rec = await service.run({ limit: 1000 });
    expect(rec).toMatchObject({ status: 'applied', fixes: 50, fixFailures: 200 });
  });

  it('고칠 줄 > 한도 → halted, 쓰기 0, 예시 최대 10줄', async () => {
    const { service, medusa, core } = build();
    const ids = Array.from({ length: 15 }, (_, i) => `i${i}`);
    medusa.listLineItemReservations.mockResolvedValue({ reservations: ids.map((id) => mres(id, 1)), nextAfterId: null });
    core.candidates.mockResolvedValue([]);
    core.states.mockResolvedValue({ lines: ids.map((id) => line(id, 2)), unknown: [] });
    const rec = await service.run({ limit: 5 });
    expect(rec.status).toBe('halted');
    expect(medusa.setLineItemReservations).not.toHaveBeenCalled();
    expect(rec.examples).toHaveLength(10);
    expect(rec.examples[0]).toEqual({ lineItemId: 'i0', current: 1, target: 2 });
  });

  it('limit null(강제) → 한도 무시, forced_by 기록', async () => {
    const { service, medusa, core, runs } = build();
    const ids = Array.from({ length: 15 }, (_, i) => `i${i}`);
    medusa.listLineItemReservations.mockResolvedValue({ reservations: ids.map((id) => mres(id, 1)), nextAfterId: null });
    core.candidates.mockResolvedValue([]);
    core.states.mockResolvedValue({ lines: ids.map((id) => line(id, 2)), unknown: [] });
    medusa.setLineItemReservations.mockImplementation(async (items: { lineItemId: string }[]) =>
      items.map((it) => ({ lineItemId: it.lineItemId, outcome: 'set', quantityBefore: 1, quantityAfter: 2 })),
    );
    const rec = await service.run({ limit: null, forcedBy: 'admin-1' });
    expect(rec.status).toBe('applied');
    expect(runs.start).toHaveBeenCalledWith(expect.any(Date), 'admin-1');
  });

  it('막혀서 deferred 될 감소 줄은 한도에 넣지 않지만 쓰기에는 보낸다', async () => {
    const { service, medusa, core } = build({ blocked: ['vb'] });
    medusa.listLineItemReservations.mockResolvedValue({
      reservations: [mres('d1', 5), mres('d2', 5), mres('up', 1)],
      nextAfterId: null,
    });
    core.candidates.mockResolvedValue([]);
    core.states.mockResolvedValue({ lines: [line('d1', 1, 'vb'), line('d2', 1, 'vb'), line('up', 2)], unknown: [] });
    medusa.setLineItemReservations.mockImplementation(async (items: { lineItemId: string }[]) =>
      items.map((it) => ({
        lineItemId: it.lineItemId,
        outcome: it.lineItemId === 'up' ? 'set' : 'deferred',
        quantityBefore: 1,
        quantityAfter: 1,
      })),
    );
    const rec = await service.run({ limit: 1 });
    expect(rec).toMatchObject({ status: 'applied', fixes: 1, deferred: 2 });
  });

  it('T 이전 주문 줄은 건드리지 않는다', async () => {
    const { service, medusa, core, projection } = build();
    medusa.listLineItemReservations.mockResolvedValue({ reservations: [mres('old', 1)], nextAfterId: null });
    core.candidates.mockResolvedValue([]);
    core.states.mockResolvedValue({ lines: [{ ...line('old', 3), orderedAt: '2026-10-01T00:00:00Z' }], unknown: [] });
    await service.run({ limit: 10 });
    expect(projection.toWrites).toHaveBeenCalledWith([], expect.any(Date), expect.any(Date));
    expect(medusa.setLineItemReservations).not.toHaveBeenCalled();
  });
});
