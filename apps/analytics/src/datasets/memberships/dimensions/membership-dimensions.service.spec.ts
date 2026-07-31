import { Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { MembershipDimensionsService } from './membership-dimensions.service';
import { dimCustomerMembership } from '../../../schema';
import type { MembershipFactResult } from '../facts/membership-types';

/**
 * Two mock flavours are used in this file:
 *
 * `makeService(latest)` — call-assertion mocks (jest.fn returning fixed values). Good for
 * pinning exactly which drizzle calls happened (insert vs update, with what payload/predicate)
 * for a single `applyStatusChanged` invocation, and for isolating one guard condition at a
 * time. `latest` models the row `SELECT ... ORDER BY validFrom DESC LIMIT 1` would return —
 * `null` (no prior row for this user), an open row (`validTo: null`), or a closed row.
 *
 * `makeStatefulService()` — a small in-memory fake of `dim_customer_membership` that actually
 * tracks rows across multiple `applyStatusChanged` calls, filters/orders/closes the way real
 * SQL would. Needed for the interval-transition sequence tests (ACTIVE → PAUSED → RESUMED,
 * etc.) where what matters is the *end state* after several events, not the shape of any
 * single call — and for the self-healing test, where the update must be shown to close *all*
 * open rows for the user, not just the one the guard reasoned about.
 */

function makeService(latest: { validFrom: Date; validTo: Date | null } | null = null) {
  const limit = jest.fn().mockResolvedValue(latest ? [latest] : []);
  const orderBy = jest.fn().mockReturnValue({ limit });
  const selectWhere = jest.fn().mockReturnValue({ orderBy });
  const from = jest.fn().mockReturnValue({ where: selectWhere });
  const select = jest.fn().mockReturnValue({ from });

  // Mirrors reality closely enough for call-assertion tests: if the latest row we handed
  // back from the SELECT is currently open, the blanket close below would close it (so
  // `returning()` yields one row); otherwise there's nothing open to close.
  const closedReturn = latest && latest.validTo === null ? [{ id: 'closed-1' }] : [];
  const returning = jest.fn().mockResolvedValue(closedReturn);
  const updateWhere = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });

  const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoNothing });
  const insert = jest.fn().mockReturnValue({ values });

  const executor = { select, insert, update };
  const run = jest.fn((fn: (e: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : fn(executor)));
  const dbService = { run };

  return {
    service: new MembershipDimensionsService(dbService as never),
    select,
    selectWhere,
    insert,
    values,
    update,
    set,
    updateWhere,
    returning,
  };
}

type FakeRow = { id: string; userId: string; tierId: string; validFrom: Date; validTo: Date | null };

function makeStatefulService() {
  const rows: FakeRow[] = [];
  let nextId = 0;

  const executor = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () =>
              [...rows]
                .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())
                .slice(0, 1)
                .map((r) => ({ validFrom: r.validFrom, validTo: r.validTo })),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (patch: { validTo: Date }) => ({
        where: () => ({
          returning: async () => {
            // Blanket close: every currently-open row for this fake's single user closes,
            // not just one — this is what makes the self-healing test meaningful.
            const open = rows.filter((r) => r.validTo === null);
            for (const row of open) {
              row.validTo = patch.validTo;
            }
            return open.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
    insert: () => ({
      values: (vals: { userId: string; tierId: string; validFrom: Date; validTo: null }) => ({
        onConflictDoNothing: async () => {
          const duplicate = rows.some(
            (r) => r.userId === vals.userId && r.validFrom.getTime() === vals.validFrom.getTime(),
          );
          if (!duplicate) {
            nextId += 1;
            rows.push({
              id: `row-${nextId}`,
              userId: vals.userId,
              tierId: vals.tierId,
              validFrom: vals.validFrom,
              validTo: null,
            });
          }
        },
      }),
    }),
  };

  const run = jest.fn((fn: (e: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : fn(executor)));
  const dbService = { run };

  return { service: new MembershipDimensionsService(dbService as never), rows };
}

function result(overrides: Partial<MembershipFactResult>): MembershipFactResult {
  return {
    claimed: true,
    userId: 'user-1',
    status: 'ACTIVE',
    tierId: 'tier-1',
    contractId: 'contract-1',
    occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

let warnSpy: jest.SpyInstance;
let debugSpy: jest.SpyInstance;

beforeEach(() => {
  // Keep jest output pristine — without this, every guard hit prints a Nest WARN/DEBUG
  // banner to the console. Also lets tests assert on what was logged where that matters.
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  debugSpy.mockRestore();
});

describe('MembershipDimensionsService — single-event behaviour', () => {
  it('ACTIVE 는 (이전 행이 없으면) 새 구간을 연다', async () => {
    const { service, insert, values, update } = makeService(null);

    await service.applyStatusChanged(
      result({
        userId: 'user-1',
        status: 'ACTIVE',
        tierId: 'tier-1',
        occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    );

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tierId: 'tier-1',
        validFrom: new Date('2026-07-01T00:00:00.000Z'),
        validTo: null,
      }),
    );
    // update is always attempted (blanket close is unconditional once the guards pass),
    // but with no prior row there is nothing to close.
    expect(update).toHaveBeenCalled();
  });

  it('RESUMED 도 (이전 행이 없으면) 새 구간을 연다', async () => {
    const { service, insert, values } = makeService(null);

    await service.applyStatusChanged(
      result({
        userId: 'user-1',
        status: 'RESUMED',
        tierId: 'tier-1',
        occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    );

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ validFrom: new Date('2026-07-01T00:00:00.000Z') }));
  });

  it('CANCELLED 는 열린 구간을 닫고 새 구간을 열지 않는다', async () => {
    const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
    const { service, insert, update, set, updateWhere } = makeService(latest);

    await service.applyStatusChanged(
      result({
        userId: 'user-1',
        status: 'CANCELLED',
        tierId: 'tier-1',
        occurredAt: new Date('2026-07-20T00:00:00.000Z'),
      }),
    );

    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ validTo: new Date('2026-07-20T00:00:00.000Z') }));
    expect(updateWhere).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(['PAUSED', 'CANCELLED', 'EXPIRED'])(
    '%s 는 모두 닫기 상태다 — 열린 구간을 닫고 새 구간을 열지 않는다',
    async (status) => {
      const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
      const { service, insert, update } = makeService(latest);

      await service.applyStatusChanged(result({ status, occurredAt: new Date('2026-07-20T00:00:00.000Z') }));

      expect(update).toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it('RECURRING_CANCELLED 는 열지도 닫지도 않는다 (차원 no-op)', async () => {
    // RECURRING_CANCELLED means "auto-renewal stopped, entitlement retained until the
    // period ends" — the contract stays ACTIVE (subscription.service.ts:65-67,
    // admin-members.reader.ts:255-261). Closing here would strip tier attribution from
    // every self-cancelling member for up to a full billing period — precisely the window
    // that holds their "use it before it expires" orders — and the later EXPIRED would find
    // no open interval to close, logging only at debug so the loss stays invisible.
    const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
    const { service, insert, update, select } = makeService(latest);

    await service.applyStatusChanged(
      result({ status: 'RECURRING_CANCELLED', occurredAt: new Date('2026-07-20T00:00:00.000Z') }),
    );

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    // Returns before the SELECT: there is nothing to decide, so nothing to read.
    expect(select).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('dimension-neutral'));
  });

  it('contractId 를 구간 행에 함께 기록한다', async () => {
    // dim_customer_membership.contract_id existed in the schema but nothing wrote it.
    // Plan 2's backfill keys memberships off contractId, so an interval without it cannot
    // be reconciled against the contract the backfill derived it from.
    const { service, values } = makeService(null);

    await service.applyStatusChanged(result({ status: 'ACTIVE', contractId: 'contract-42' }));

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ contractId: 'contract-42' }));
  });

  it('contractId 가 없는 이벤트는 null 로 기록한다 (contract 상 optional)', async () => {
    const { service, values } = makeService(null);

    await service.applyStatusChanged(result({ status: 'ACTIVE', contractId: null }));

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ contractId: null }));
  });

  it('tierId 가 없으면 (facts 단계에서 이미) UNKNOWN 으로 채워져 들어온다', async () => {
    const { service, values } = makeService(null);

    await service.applyStatusChanged(
      result({
        userId: 'user-2',
        status: 'ACTIVE',
        tierId: 'UNKNOWN',
        occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    );

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tierId: 'UNKNOWN' }));
  });

  it('닫기(update)는 특정 행 id 가 아니라 이 userId 의 열린 구간 전체(validTo IS NULL)를 대상으로 한다', async () => {
    // Pins Finding 2's fix: a regression back to `eq(id, open.id)` targeting would change
    // this predicate and fail this assertion, even though it wouldn't visibly break the
    // single-open-row tests above.
    const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
    const { service, updateWhere } = makeService(latest);

    await service.applyStatusChanged(
      result({ userId: 'user-1', status: 'CANCELLED', occurredAt: new Date('2026-07-20T00:00:00.000Z') }),
    );

    expect(updateWhere).toHaveBeenCalledWith(
      and(eq(dimCustomerMembership.userId, 'user-1'), isNull(dimCustomerMembership.validTo)),
    );
  });

  it('닫을 열린 구간이 없는 닫기 이벤트는 조용히 지나가지 않고 debug 로그를 남긴다', async () => {
    const { service } = makeService(null);

    await service.applyStatusChanged(result({ status: 'CANCELLED', occurredAt: new Date('2026-07-20T00:00:00.000Z') }));

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('had no open interval to close'));
  });
});

describe('MembershipDimensionsService — 열린 구간과 정확히 같은 occurredAt (닫기 vs 열기)', () => {
  it('닫기 상태는 zero-width 로 정상 처리한다 (중복이 아니다)', async () => {
    // Finding 1: equality with the open interval's validFrom must NOT be treated as "always
    // stale" — for a *closing* status this is a legitimate same-instant close, and skipping
    // it would leave the interval open forever.
    const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
    const { service, update, insert } = makeService(latest);

    await service.applyStatusChanged(result({ status: 'CANCELLED', occurredAt: latest.validFrom }));

    expect(update).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('열기 상태(중복 ACTIVE)는 건너뛴다', async () => {
    const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
    const { service, update, insert } = makeService(latest);

    await service.applyStatusChanged(result({ status: 'ACTIVE', occurredAt: latest.validFrom }));

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate opening'));
  });
});

describe('MembershipDimensionsService — out-of-order guard (isolated conditions)', () => {
  // Each test below varies exactly one thing relative to its neighbours: the relationship
  // between `result.occurredAt` and the known boundary (latest open interval's validFrom,
  // or latest closed interval's validTo). Deliberate — a test that combined "older" with
  // some other unrelated condition could stay green after deleting the guard, as long as
  // the other condition also blocked the call.

  it('열린 구간의 validFrom 보다 이전 occurredAt 이면 (out-of-order redelivery) update/insert 둘 다 건너뛴다', async () => {
    const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
    const { service, insert, update, select } = makeService(latest);

    // Late CANCELLED from *before* the currently open interval started.
    await service.applyStatusChanged(result({ status: 'CANCELLED', occurredAt: new Date('2026-06-15T00:00:00.000Z') }));

    expect(select).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('닫힌 구간의 validTo 보다 이전 occurredAt 이면 (그 구간 내부로 재전달) update/insert 둘 다 건너뛴다', async () => {
    // The interval-integrity half of the guard: overlap with an already-*closed* interval,
    // not just an open one. A late RESUMED landing inside [validFrom, validTo) of a closed
    // interval must not open a second, overlapping interval.
    const latest = { validFrom: new Date('2026-01-01T00:00:00.000Z'), validTo: new Date('2026-03-01T00:00:00.000Z') };
    const { service, insert, update } = makeService(latest);

    await service.applyStatusChanged(result({ status: 'RESUMED', occurredAt: new Date('2026-02-01T00:00:00.000Z') }));

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('열린 구간의 validFrom 보다 이후 occurredAt 이면 정상적으로 닫는다', async () => {
    const latest = { validFrom: new Date('2026-07-01T00:00:00.000Z'), validTo: null };
    const { service, update } = makeService(latest);

    await service.applyStatusChanged(result({ status: 'CANCELLED', occurredAt: new Date('2026-07-02T00:00:00.000Z') }));

    expect(update).toHaveBeenCalled();
  });

  it('이전 행이 아예 없으면 occurredAt 비교 없이 (opensInterval 이면) 바로 새 구간을 연다', async () => {
    const { service, insert, select } = makeService(null);

    await service.applyStatusChanged(result({ status: 'ACTIVE', occurredAt: new Date('2026-01-01T00:00:00.000Z') }));

    expect(select).toHaveBeenCalled();
    expect(insert).toHaveBeenCalled();
  });
});

describe('MembershipDimensionsService — interval-transition sequences', () => {
  it('ACTIVE → PAUSED → RESUMED 는 정확히 하나의 열린 구간만 남긴다', async () => {
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-1';

    await service.applyStatusChanged(
      result({ userId, status: 'ACTIVE', occurredAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
    await service.applyStatusChanged(
      result({ userId, status: 'PAUSED', occurredAt: new Date('2026-02-01T00:00:00.000Z') }),
    );
    await service.applyStatusChanged(
      result({ userId, status: 'RESUMED', occurredAt: new Date('2026-03-01T00:00:00.000Z') }),
    );

    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(1);
    expect(open[0].validFrom).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(open[0].validTo).toBeNull();

    expect(rows).toHaveLength(2);
    expect(rows[0].validFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(rows[0].validTo).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('ACTIVE → RECURRING_CANCELLED → EXPIRED 는 ACTIVE~EXPIRED 로 경계 지어진 닫힌 구간 하나만 남긴다', async () => {
    // The whole point of making RECURRING_CANCELLED neutral. Under the old "everything that
    // isn't opening is closing" rule this sequence produced an interval closed at
    // 2026-02-01 (the auto-renewal stop), silently dropping the member's tier for the
    // entire remaining period, and the EXPIRED that actually ended the membership found
    // nothing open to close. The assertion that matters is `validTo === EXPIRED's
    // timestamp`, not merely "one interval exists".
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-9';

    await service.applyStatusChanged(
      result({ userId, status: 'ACTIVE', occurredAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
    await service.applyStatusChanged(
      result({ userId, status: 'RECURRING_CANCELLED', occurredAt: new Date('2026-02-01T00:00:00.000Z') }),
    );
    await service.applyStatusChanged(
      result({ userId, status: 'EXPIRED', occurredAt: new Date('2026-03-01T00:00:00.000Z') }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].validFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(rows[0].validTo).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(rows.filter((r) => r.validTo === null)).toHaveLength(0);
  });

  it('RECURRING_CANCELLED 이후에도 열린 구간이 그대로 살아 있어 주문이 등급에 귀속된다', async () => {
    // The consequence the fix is really about: between the auto-renewal stop and the actual
    // expiry the member is still entitled, so orders in that window must still join to
    // their tier via `valid_to IS NULL`.
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-10';

    await service.applyStatusChanged(
      result({ userId, status: 'ACTIVE', occurredAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
    await service.applyStatusChanged(
      result({ userId, status: 'RECURRING_CANCELLED', occurredAt: new Date('2026-02-01T00:00:00.000Z') }),
    );

    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(1);
    expect(open[0].validFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('ACTIVE → CANCELLED 는 열린 구간을 0개로 남긴다', async () => {
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-2';

    await service.applyStatusChanged(
      result({ userId, status: 'ACTIVE', occurredAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
    await service.applyStatusChanged(
      result({ userId, status: 'CANCELLED', occurredAt: new Date('2026-01-20T00:00:00.000Z') }),
    );

    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].validFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(rows[0].validTo).toEqual(new Date('2026-01-20T00:00:00.000Z'));
  });

  it('열린 구간보다 이전 시각의 지연 CANCELLED 는 무시되고 열린 구간이 그대로 남는다 (out-of-order 재현)', async () => {
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-3';

    await service.applyStatusChanged(
      result({ userId, status: 'ACTIVE', occurredAt: new Date('2026-07-01T00:00:00.000Z') }),
    );
    // A CANCELLED from *last month*, redelivered late, arriving after this month's ACTIVE.
    await service.applyStatusChanged(
      result({ userId, status: 'CANCELLED', occurredAt: new Date('2026-06-15T00:00:00.000Z') }),
    );

    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(1);
    expect(open[0].validFrom).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    expect(rows).toHaveLength(1);
  });

  it('같은 occurredAt 을 가진 ACTIVE 이벤트 두 개는 이미 열린 구간을 닫지 않는다', async () => {
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-4';
    const t = new Date('2026-07-01T00:00:00.000Z');

    await service.applyStatusChanged(result({ userId, status: 'ACTIVE', occurredAt: t }));
    await service.applyStatusChanged(result({ userId, status: 'ACTIVE', occurredAt: t }));

    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(1);
    expect(open[0].validFrom).toEqual(t);
    expect(rows).toHaveLength(1);
  });

  it('같은 occurredAt 을 가진 ACTIVE → CANCELLED 는 zero-width 닫힌 구간을 남긴다 (Finding 1)', async () => {
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-6';
    const t = new Date('2026-07-01T00:00:00.000Z');

    await service.applyStatusChanged(result({ userId, status: 'ACTIVE', occurredAt: t }));
    await service.applyStatusChanged(result({ userId, status: 'CANCELLED', occurredAt: t }));

    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].validFrom).toEqual(t);
    expect(rows[0].validTo).toEqual(t);
  });

  it('구간이 닫힌 뒤 그 구간 내부 시각으로 지연 RESUMED 가 도착해도 겹치는 구간을 만들지 않는다 (Finding 3, DLQ 재전달 재현)', async () => {
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-7';

    await service.applyStatusChanged(
      result({ userId, status: 'ACTIVE', occurredAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
    await service.applyStatusChanged(
      result({ userId, status: 'CANCELLED', occurredAt: new Date('2026-03-01T00:00:00.000Z') }),
    );
    // Late RESUMED, redelivered via DLQ, landing *inside* the interval that already closed.
    await service.applyStatusChanged(
      result({ userId, status: 'RESUMED', occurredAt: new Date('2026-02-01T00:00:00.000Z') }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].validFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(rows[0].validTo).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(0);
  });

  it('열린 구간이 (사전 손상 등으로) 두 개 이상 존재해도 닫기는 전부를 대상으로 한다 (Finding 2, 자가치유)', async () => {
    const { service, rows } = makeStatefulService();
    const userId = 'user-seq-8';

    // Directly seed a corrupted pre-existing state: two open rows for the same user. The
    // guards above are designed to prevent this from happening going forward, but the close
    // statement itself must not assume it never will — it must heal this, not just close
    // whichever single row the guard reasoned about.
    rows.push(
      { id: 'row-1', userId, tierId: 'tier-1', validFrom: new Date('2026-01-01T00:00:00.000Z'), validTo: null },
      { id: 'row-2', userId, tierId: 'tier-1', validFrom: new Date('2026-02-01T00:00:00.000Z'), validTo: null },
    );

    await service.applyStatusChanged(
      result({ userId, status: 'CANCELLED', occurredAt: new Date('2026-03-01T00:00:00.000Z') }),
    );

    const open = rows.filter((r) => r.validTo === null);
    expect(open).toHaveLength(0);
    expect(rows.every((r) => r.validTo?.getTime() === new Date('2026-03-01T00:00:00.000Z').getTime())).toBe(true);
  });
});
