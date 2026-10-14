import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, type DbTx } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { isPreservedLastError, lateOrdnumError, PrintOrderRepository } from './print-order.repository';

interface Captured {
  set: Record<string, unknown>;
  where: SQL | undefined;
}

// update().set().where()[.returning()] 만 흉내내 쿼리 조각을 잡는다. 실제 실행은 통합 스펙이 본다
function capturingRepo(): { repo: PrintOrderRepository; captured: Captured[] } {
  const captured: Captured[] = [];
  const trx = {
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL | undefined) => {
          captured.push({ set, where });
          return Object.assign(Promise.resolve([]), { returning: () => Promise.resolve([{ id: 'x' }]) });
        },
      }),
    }),
  };
  // 이 가짜가 쓰는 건 run 하나뿐이다
  const dbService = {
    run: <T>(fn: (tx: DbTx) => Promise<T>) => fn(trx as unknown as DbTx),
  } as unknown as DbService<typeof wmsSchema>;
  return { repo: new PrintOrderRepository(dbService), captured };
}

const dialect = new PgDialect();
const render = (fragment: unknown): string => {
  if (!fragment || typeof fragment !== 'object' || !('getSQL' in fragment)) return String(fragment);
  // getSQL 이 있는 값만 여기 온다(SQL·SQL.Aliased 등 drizzle 조각)
  const q = dialect.sqlToQuery((fragment as SQL).getSQL());
  return `${q.sql} ${JSON.stringify(q.params)}`;
};

const PROTECTED_CHECK =
  /not \(starts_with\(coalesce\("print_orders"\."last_error", ''\), \$\d+\) OR starts_with\(coalesce\("print_orders"\."last_error", ''\), \$\d+\) OR starts_with\(coalesce\("print_orders"\."last_error", ''\), \$\d+\)\)/;

const snapshot: PrintOrderRow = {
  id: 'po-1',
  salesOrderId: 'so-1',
  salesOrderLineId: 'sol-1',
  almondDesignId: 'd-1',
  vendor: 'wowpress',
  status: 'failed',
  testMemo: false,
  vendorOrderNumber: null,
  attemptCount: 3,
  lastError: null,
  nextAttemptAt: new Date(),
  submittingAt: null,
  orderAttemptedAt: new Date(),
  carrier: null,
  trackingNumber: null,
  shippedAt: null,
  deliveredAt: null,
  testConfirmedAt: null,
  testConfirmedBy: null,
  testNote: null,
  cancelRefusedAt: null,
  cancelResolvedAt: null,
  cancelResolvedBy: null,
  salesCancelFailedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PrintOrderRepository protected-record guards (rendered SQL)', () => {
  it('takeOrderRight requires no protected record in the current last_error', async () => {
    const { repo, captured } = capturingRepo();
    await repo.takeOrderRight('po-1', new Date(), {});
    const where = render(captured[0]?.where);
    expect(where).toMatch(PROTECTED_CHECK);
    expect(where).toContain('"duplicate wowpress order suspected"');
    expect(where).toContain('"order sent, ordnum "');
    expect(where).toContain('"order placed after cancel"');
    expect(where).not.toContain('%');
  });

  it('compareAndSetUnprotected requires no protected record in the current last_error', async () => {
    const { repo, captured } = capturingRepo();
    await repo.compareAndSetUnprotected(snapshot, { status: 'pending' });
    expect(render(captured[0]?.where)).toMatch(PROTECTED_CHECK);
  });

  it('a new protected record clears the operator cancel resolution in the same update', async () => {
    const { repo, captured } = capturingRepo();
    await repo.recordFailure('po-1', 'duplicate wowpress order suspected: W-1 / W-2');
    const set = captured[0]?.set ?? {};
    expect(render(set.cancelResolvedAt)).toMatch(
      /CASE WHEN strpos\(coalesce\("print_orders"\."last_error", ''\), \$\d+\) = 0 THEN NULL ELSE "print_orders"\."cancel_resolved_at" END/,
    );
    expect(render(set.cancelResolvedBy)).toMatch(/THEN NULL ELSE "print_orders"\."cancel_resolved_by" END/);
  });

  it('flagLateOrdnum only touches cancel-flow rows, keeps cancelling, and writes a protected record', async () => {
    const { repo, captured } = capturingRepo();
    await repo.flagLateOrdnum('po-1', 'W-9');
    const { set, where } = captured[0] ?? { set: {}, where: undefined };
    expect(render(where)).toMatch(/"print_orders"\."status" in \(\$\d+, \$\d+, \$\d+\)/);
    expect(render(where)).toContain('["po-1","cancelling","cancelled","cancel_refused"]');
    expect(render(set.status)).toContain(
      `CASE WHEN "print_orders"."status" = 'cancelling' THEN "print_orders"."status" ELSE 'cancel_refused' END`,
    );
    expect(render(set.lastError)).toContain(lateOrdnumError('W-9'));
    expect(render(set.cancelResolvedAt)).toContain('THEN NULL');
  });

  it('markVendorCancelled requires no protected record in the current last_error', async () => {
    const { repo, captured } = capturingRepo();
    await repo.markVendorCancelled('po-1', 'W-1');
    expect(render(captured[0]?.where)).toMatch(PROTECTED_CHECK);
  });

  it('isPreservedLastError matches prefixes only', () => {
    expect(isPreservedLastError(lateOrdnumError('W-1'))).toBe(true);
    expect(isPreservedLastError('order sent, ordnum W-1 not saved — verify on WowPress')).toBe(true);
    expect(isPreservedLastError('duplicate wowpress order suspected: W-1 / W-2')).toBe(true);
    expect(isPreservedLastError('upload failed: file not saved')).toBe(false);
    expect(isPreservedLastError('order sent but not confirmed — verify on WowPress before retry')).toBe(false);
  });

  it('a new protected record on a cancelled row reopens it as cancel_refused in the same update', async () => {
    const { repo, captured } = capturingRepo();
    await repo.recordFailure('po-1', 'duplicate wowpress order suspected: W-1 / W-2');
    const set = captured[0]?.set ?? {};
    const reopens = `"print_orders"."status" = 'cancelled' AND strpos(coalesce("print_orders"."last_error", ''), $1) = 0`;
    expect(render(set.status)).toContain(`CASE WHEN ${reopens} THEN 'cancel_refused' WHEN`);
    expect(render(set.status)).toContain(`ELSE 'failed' END`);
    expect(render(set.cancelRefusedAt)).toContain(
      `CASE WHEN ${reopens} THEN now() ELSE "print_orders"."cancel_refused_at" END`,
    );
  });

  it('an ordinary error never reopens a cancelled row', async () => {
    const { repo, captured } = capturingRepo();
    await repo.recordFailure('po-1', 'quote failed');
    expect(render(captured[0]?.set.status)).toContain(`CASE WHEN false THEN 'cancel_refused'`);
  });

  it('an ordinary error leaves the operator cancel resolution alone', async () => {
    const { repo, captured } = capturingRepo();
    await repo.recordFailure('po-1', 'quote failed');
    expect(captured[0]?.set).not.toHaveProperty('cancelResolvedAt');
  });
});
