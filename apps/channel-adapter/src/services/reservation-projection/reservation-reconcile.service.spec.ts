import type { MedusaClient } from '../../adapters/medusa/medusa.client';
import type { CoreLineReservationStateClient } from '../clients/core-line-reservation-state.client';
import type { ReservationCutoverRepository } from './reservation-cutover.repository';
import type { ReservationProjectionService } from './reservation-projection.service';
import type { ReservationReconcileRunRepository } from './reservation-reconcile-run.repository';
import type { ConfigService } from '@nestjs/config';
import { ReservationReconcileService } from './reservation-reconcile.service';
import { parseMaxFixes } from './reservation-reconcile.job';
import { reservationTarget } from './reservation-target';

class TestableService extends ReservationReconcileService {
  clock = new Date('2026-11-09T04:30:00Z');
  sleeps: number[] = [];
  order: string[] = [];
  protected now(): Date {
    return new Date(this.clock);
  }
  protected async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.order.push('sleep');
    this.clock = new Date(this.clock.getTime() + ms);
  }
}

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

function build(opts: { cutover?: Date | null; blocked?: string[]; settle?: string } = {}) {
  const medusa = {
    listLineItemReservations: jest.fn(),
    setLineItemReservations: jest.fn(),
  };
  const dryAsSet = async (items: { lineItemId: string; quantity: number }[]) =>
    items.map((it) => ({ lineItemId: it.lineItemId, outcome: 'set', quantityBefore: 0, quantityAfter: it.quantity }));
  medusa.setLineItemReservations.mockImplementation(async (items: { lineItemId: string; quantity: number }[]) =>
    dryAsSet(items),
  );
  const core = { candidates: jest.fn(), states: jest.fn() };
  const runs = { start: jest.fn().mockResolvedValue('run1'), finish: jest.fn().mockResolvedValue(undefined) };
  const projection = {
    toWrites: jest.fn(
      async (
        lines: { channelOrderItemId: string | null; demand: number; heldUnits: number; variantId: string }[],
        _asOf?: Date,
        _now?: Date,
      ) =>
        lines
          .filter((l) => l.channelOrderItemId !== null)
          .map((l) => ({
            lineItemId: l.channelOrderItemId as string,
            quantity: reservationTarget(l),
            allowDecrease: !(opts.blocked ?? []).includes(l.variantId),
          })),
    ),
  };
  const cutover = { get: jest.fn().mockResolvedValue(opts.cutover === undefined ? T : opts.cutover) };
  const service = new TestableService(
    cutover as unknown as ReservationCutoverRepository,
    medusa as unknown as MedusaClient,
    core as unknown as CoreLineReservationStateClient,
    projection as unknown as ReservationProjectionService,
    runs as unknown as ReservationReconcileRunRepository,
    { get: (_k: string, d?: unknown) => opts.settle ?? d } as unknown as ConfigService,
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

  type Item = { lineItemId: string; quantity: number };
  type Res = { lineItemId: string; outcome: string; quantityBefore: number; quantityAfter: number };
  const res = (it: Item, outcome: string, before = 1): Res => ({
    lineItemId: it.lineItemId,
    outcome,
    quantityBefore: before,
    quantityAfter: it.quantity,
  });
  /** dry: 계획 결과, write: 실제 쓰기 결과(없으면 모두 set). */
  function mockMedusa(
    medusa: { setLineItemReservations: jest.Mock },
    fns: { dry?: (items: Item[]) => Res[]; write?: (items: Item[], call: number) => Res[] | Error } = {},
  ) {
    let writeCall = 0;
    medusa.setLineItemReservations.mockImplementation(async (items: Item[], opts?: { dryRun?: boolean }) => {
      if (opts?.dryRun) return (fns.dry ?? ((x: Item[]) => x.map((it) => res(it, 'set'))))(items);
      const out = (fns.write ?? ((x: Item[]) => x.map((it) => res(it, 'set'))))(items, writeCall++);
      if (out instanceof Error) throw out;
      return out;
    });
  }
  const writeCalls = (medusa: { setLineItemReservations: jest.Mock }) =>
    medusa.setLineItemReservations.mock.calls.filter((c) => !c[1]?.dryRun);
  const dryCalls = (medusa: { setLineItemReservations: jest.Mock }) =>
    medusa.setLineItemReservations.mock.calls.filter((c) => c[1]?.dryRun);

  function seed(
    t: ReturnType<typeof build>,
    ids: string[],
    opts: { current?: number; target?: number; extraLines?: ReturnType<typeof line>[] } = {},
  ) {
    t.medusa.listLineItemReservations.mockResolvedValue({
      reservations: ids.map((id) => mres(id, opts.current ?? 1)),
      nextAfterId: null,
    });
    t.core.candidates.mockResolvedValue([]);
    t.core.states.mockImplementation(async (_c: string, req: string[]) => ({
      lines: [...ids.map((id) => line(id, opts.target ?? 2)), ...(opts.extraLines ?? [])].filter((l) =>
        req.includes(l.channelOrderItemId as string),
      ),
      unknown: [],
    }));
  }

  it('고칠 줄 ≤ 한도 → 200줄씩 쓰고 set/error/deferred/not_found 를 센다, 같은 줄은 안 보냄', async () => {
    const t = build();
    const ids = Array.from({ length: 250 }, (_, i) => `i${i}`);
    seed(t, [...ids, 'same'], { current: 1 });
    // same: 현재 1 목표 2 가 되지 않게 따로 맞춘다
    t.medusa.listLineItemReservations.mockResolvedValue({
      reservations: [...ids.map((id) => mres(id, 1)), mres('same', 2)],
      nextAfterId: null,
    });
    mockMedusa(t.medusa, {
      write: (items) =>
        items.map((it, idx) => res(it, idx === 0 ? 'error' : idx === 1 ? 'deferred' : idx === 2 ? 'not_found' : 'set')),
    });
    const rec = await t.service.run({ limit: 1000 });
    expect(writeCalls(t.medusa).map((c) => c[0].length)).toEqual([200, 50]);
    expect(dryCalls(t.medusa).map((c) => c[0].length)).toEqual([200, 50]);
    // 첫 묶음: error1 deferred1 not_found1 set197, 둘째 묶음 같은 규칙: set47
    expect(rec).toMatchObject({ status: 'applied', fixes: 244, fixFailures: 4, deferred: 2 });
  });

  it('쓰기 결과에서 빠진 줄은 실패로 센다', async () => {
    const t = build();
    seed(t, ['a', 'b', 'c']);
    mockMedusa(t.medusa, { write: (items) => items.slice(0, 1).map((it) => res(it, 'set')) });
    const rec = await t.service.run({ limit: 10 });
    expect(rec).toMatchObject({ fixes: 1, fixFailures: 2 });
  });

  it('쓰기 묶음이 던지면 그 묶음을 실패로 세고 다음 묶음을 계속한다', async () => {
    const t = build();
    seed(
      t,
      Array.from({ length: 250 }, (_, i) => `i${i}`),
    );
    mockMedusa(t.medusa, {
      write: (items, call) => (call === 0 ? new Error('timeout') : items.map((it) => res(it, 'set'))),
    });
    const rec = await t.service.run({ limit: 1000 });
    expect(rec).toMatchObject({ status: 'applied', fixes: 50, fixFailures: 200 });
  });

  it('고칠 줄 > 한도 → halted, 실제 쓰기 0, 예시 최대 10줄', async () => {
    const t = build();
    seed(
      t,
      Array.from({ length: 15 }, (_, i) => `i${i}`),
    );
    mockMedusa(t.medusa);
    const rec = await t.service.run({ limit: 5 });
    expect(rec.status).toBe('halted');
    expect(writeCalls(t.medusa)).toHaveLength(0);
    expect(rec.examples).toHaveLength(10);
    expect(rec.examples[0]).toEqual({ lineItemId: 'i0', current: 1, target: 2 });
  });

  it('dry run 이 set 이 아니라고 한 줄(not_managed·deferred·unchanged)은 한도에 세지 않고 not_managed 는 보내지 않는다', async () => {
    const t = build();
    seed(t, ['m1', 'm2', 'd1', 'u1', 'ok']);
    mockMedusa(t.medusa, {
      dry: (items) =>
        items.map((it) =>
          res(
            it,
            it.lineItemId.startsWith('m')
              ? 'not_managed'
              : it.lineItemId === 'd1'
                ? 'deferred'
                : it.lineItemId === 'u1'
                  ? 'unchanged'
                  : 'set',
          ),
        ),
    });
    const rec = await t.service.run({ limit: 1 });
    expect(rec.status).toBe('applied');
    expect(
      writeCalls(t.medusa)[0][0]
        .map((i: Item) => i.lineItemId)
        .sort(),
    ).toEqual(['d1', 'ok']);
  });

  it('dry run 이 not_found 라고 한 줄은 보내지 않고 fix_failures 로 센다', async () => {
    const t = build();
    seed(t, ['gone', 'ok']);
    mockMedusa(t.medusa, {
      dry: (items) => items.map((it) => res(it, it.lineItemId === 'gone' ? 'not_found' : 'set')),
    });
    const rec = await t.service.run({ limit: 10 });
    expect(writeCalls(t.medusa)[0][0].map((i: Item) => i.lineItemId)).toEqual(['ok']);
    expect(rec).toMatchObject({ status: 'applied', fixes: 1, fixFailures: 1 });
  });

  it('기다리는 사이 다른 쓰기가 줄을 바꿨으면(dry quantityBefore ≠ 처음 읽은 값) 보내지 않고 deferred 로 센다', async () => {
    const t = build();
    seed(t, ['moved', 'ok']);
    mockMedusa(t.medusa, { dry: (items) => items.map((it) => res(it, 'set', it.lineItemId === 'moved' ? 7 : 1)) });
    const rec = await t.service.run({ limit: 10 });
    expect(writeCalls(t.medusa)[0][0].map((i: Item) => i.lineItemId)).toEqual(['ok']);
    expect(rec).toMatchObject({ status: 'applied', fixes: 1, deferred: 1 });
  });

  it('기다리는 사이 core 가 예약을 풀어 목표가 올랐으면(held 1→0, 목표 1→2) Medusa 2 를 1 로 줄이지 않는다', async () => {
    const t = build();
    t.medusa.listLineItemReservations.mockResolvedValue({
      reservations: [mres('a', 2), mres('ok', 1)],
      nextAfterId: null,
    });
    t.core.candidates.mockResolvedValue([]);
    let released = false;
    t.core.states.mockImplementation(async (_c: string, req: string[]) => ({
      lines: [
        { ...line('a', 2), heldUnits: released ? 0 : 1 }, // 처음 읽을 땐 목표 1, 다시 읽으면 2
        line('ok', 2),
      ].filter((l) => req.includes(l.channelOrderItemId as string)),
      unknown: [],
    }));
    const realSleep = t.service['sleep'].bind(t.service);
    t.service['sleep'] = async (ms: number) => {
      await realSleep(ms);
      released = true; // 정착 대기 중에 core 가 예약을 풀었다
    };
    mockMedusa(t.medusa, { dry: (items) => items.map((it) => res(it, 'set', it.lineItemId === 'a' ? 2 : 1)) });
    const rec = await t.service.run({ limit: 10 });
    const sent = t.medusa.setLineItemReservations.mock.calls.flatMap((c) => c[0] as Item[]);
    expect(sent.find((i) => i.lineItemId === 'a')).toBeUndefined(); // dry run 에도 실제 쓰기에도 없다
    expect(writeCalls(t.medusa)[0][0].map((i: Item) => i.lineItemId)).toEqual(['ok']);
    expect(rec).toMatchObject({ status: 'applied', fixes: 1, deferred: 1 });
    // 다시 읽기는 고칠 줄(diff)만, 정착 대기 뒤에
    expect(t.core.states.mock.calls[1][1].sort()).toEqual(['a', 'ok']);
  });

  it('기다린 뒤 core 다시 읽기가 던지면 skipped·쓰기 0', async () => {
    const t = build();
    seed(t, ['a']);
    const first = t.core.states.getMockImplementation() as (c: string, req: string[]) => Promise<unknown>;
    t.core.states.mockImplementationOnce(first).mockRejectedValueOnce(new Error('core 재조회 실패'));
    mockMedusa(t.medusa);
    const rec = await t.service.run({ limit: 10 });
    expect(rec.status).toBe('skipped');
    expect(rec.error).toContain('core 재조회 실패');
    expect(t.medusa.setLineItemReservations).not.toHaveBeenCalled();
  });

  it('다시 읽을 때 core 가 모르게 된 줄은 쓰지 않고 deferred 로 센다', async () => {
    const t = build();
    seed(t, ['a', 'b']);
    let calls = 0;
    const first = t.core.states.getMockImplementation() as (
      c: string,
      req: string[],
    ) => Promise<{ lines: { channelOrderItemId: string | null }[]; unknown: string[] }>;
    t.core.states.mockImplementation(async (c: string, req: string[]) => {
      const out = await first(c, req);
      calls += 1;
      return calls === 1 ? out : { lines: out.lines.filter((l) => l.channelOrderItemId !== 'b'), unknown: ['b'] };
    });
    mockMedusa(t.medusa);
    const rec = await t.service.run({ limit: 10 });
    expect(writeCalls(t.medusa)[0][0].map((i: Item) => i.lineItemId)).toEqual(['a']);
    expect(rec).toMatchObject({ status: 'applied', fixes: 1, deferred: 1 });
  });

  it('dry run 응답에 줄이 빠졌으면 skipped·쓰기 0', async () => {
    const t = build();
    seed(t, ['a', 'b']);
    mockMedusa(t.medusa, { dry: (items) => items.slice(0, 1).map((it) => res(it, 'set')) });
    const rec = await t.service.run({ limit: 10 });
    expect(rec.status).toBe('skipped');
    expect(rec.error).toContain('dry run');
    expect(writeCalls(t.medusa)).toHaveLength(0);
  });

  it('halted 예시의 current 는 dry run 이 본 실제 값', async () => {
    const t = build();
    seed(t, ['a', 'b']);
    mockMedusa(t.medusa, { dry: (items) => items.map((it) => res(it, 'set', 1)) });
    const rec = await t.service.run({ limit: 1 });
    expect(rec.status).toBe('halted');
    expect(rec.examples[0]).toEqual({ lineItemId: 'a', current: 1, target: 2 });
  });

  it('dry run 이 던지면 skipped·실제 쓰기 0', async () => {
    const t = build();
    seed(t, ['a']);
    t.medusa.setLineItemReservations.mockRejectedValue(new Error('dry down'));
    const rec = await t.service.run({ limit: 10 });
    expect(rec.status).toBe('skipped');
    expect(rec.error).toContain('dry down');
    expect(writeCalls(t.medusa)).toHaveLength(0);
  });

  it('limit null(강제) → 한도 무시, forced_by 기록', async () => {
    const t = build();
    seed(
      t,
      Array.from({ length: 15 }, (_, i) => `i${i}`),
    );
    mockMedusa(t.medusa);
    const rec = await t.service.run({ limit: null, forcedBy: 'admin-1' });
    expect(rec.status).toBe('applied');
    expect(t.runs.start).toHaveBeenCalledWith(expect.any(Date), 'admin-1');
  });

  it('감소 게이트: 읽은 시각 readAt 에서 정착 지연만큼 기다린 뒤 실제 시계로 toWrites', async () => {
    const t = build();
    seed(t, ['a']);
    mockMedusa(t.medusa);
    const start = t.service.clock.getTime();
    await t.service.run({ limit: 10 });
    expect(t.service.sleeps).toEqual([301000]);
    const [, asOf, now] = t.projection.toWrites.mock.calls[0] as [unknown, Date, Date];
    expect(asOf.getTime()).toBe(start);
    expect(now.getTime()).toBe(start + 301000);
  });

  it('RESERVATION_PROJECTION_SETTLE_MS 설정을 따르고 무효값은 기본값', async () => {
    const a = build({ settle: '1000' });
    seed(a, ['a']);
    mockMedusa(a.medusa);
    await a.service.run({ limit: 10 });
    expect(a.service.sleeps).toEqual([2000]);
    const b = build({ settle: '0' });
    seed(b, ['a']);
    mockMedusa(b.medusa);
    await b.service.run({ limit: 10 });
    expect(b.service.sleeps).toEqual([301000]);
  });

  it('T 이전 주문 줄은 건드리지 않는다', async () => {
    const t = build();
    t.medusa.listLineItemReservations.mockResolvedValue({ reservations: [mres('old', 1)], nextAfterId: null });
    t.core.candidates.mockResolvedValue([]);
    t.core.states.mockResolvedValue({ lines: [{ ...line('old', 3), orderedAt: '2026-10-01T00:00:00Z' }], unknown: [] });
    await t.service.run({ limit: 10 });
    expect(t.projection.toWrites).toHaveBeenCalledWith([], expect.any(Date), expect.any(Date));
    expect(t.medusa.setLineItemReservations).not.toHaveBeenCalled();
  });
});

describe('core 후보 시작 시각 = max(T, now − 30일)', () => {
  it('now − 30일 이 T 보다 이르면 T', async () => {
    const t = build(); // clock 11-09, T 11-01
    t.medusa.listLineItemReservations.mockResolvedValue({ reservations: [], nextAfterId: null });
    t.core.candidates.mockResolvedValue([]);
    t.core.states.mockResolvedValue({ lines: [], unknown: [] });
    await t.service.run({ limit: 10 });
    expect(t.core.candidates.mock.calls[0][1]).toEqual(T);
  });

  it('now − 30일 이 T 보다 늦으면 now − 30일', async () => {
    const t = build();
    t.service.clock = new Date('2026-12-15T04:30:00Z');
    t.medusa.listLineItemReservations.mockResolvedValue({ reservations: [], nextAfterId: null });
    t.core.candidates.mockResolvedValue([]);
    t.core.states.mockResolvedValue({ lines: [], unknown: [] });
    await t.service.run({ limit: 10 });
    expect(t.core.candidates.mock.calls[0][1]).toEqual(new Date('2026-11-15T04:30:00Z'));
    expect(t.medusa.listLineItemReservations.mock.calls[0][0].orderCreatedFrom).toEqual(T);
  });
});

describe('parseMaxFixes', () => {
  it.each([
    [undefined, 200],
    ['', 200],
    ['abc', 200],
    ['0', 200],
    ['-5', 200],
    ['1.5', 200],
    ['50', 50],
    [75, 75],
  ])('%p → %p', (raw, expected) => {
    expect(parseMaxFixes(raw as string | number | undefined)).toBe(expected);
  });
});
