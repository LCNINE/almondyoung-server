import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, not, or, sql, type SQL } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow, type PrintOrderStatus } from '../schema/print-order.schema';

export const DUPLICATE_ORDER_ERROR_PREFIX = 'duplicate wowpress order suspected';
export const UNSAVED_ORDNUM_ERROR_PREFIX = 'order sent, ordnum ';
export const LATE_ORDNUM_ERROR_PREFIX = 'order placed after cancel';
// 와우프레스에 우리가 모르는 주문이 살아 있을 수 있다는 기록. 덮지 않고, 재전송·취소 마무리를 막는다
const PRESERVED_ERROR_PREFIXES = [DUPLICATE_ORDER_ERROR_PREFIX, UNSAVED_ORDNUM_ERROR_PREFIX, LATE_ORDNUM_ERROR_PREFIX];
const TRACKED_STATUSES: PrintOrderStatus[] = ['submitted', 'shipped'];
// 택배는 출고완료(80)에서 끝나 shipped 에 머문다. 송장이 잡힌 뒤 이 기간만 배송완료(85)를 더 본다
export const SHIPPED_TRACKING_WINDOW_MS = 14 * 24 * 60 * 60_000;
const CANCEL_FLOW_STATUSES: PrintOrderStatus[] = ['cancelling', 'cancelled', 'cancel_refused'];

export function lateOrdnumError(ordnum: string): string {
  return `${LATE_ORDNUM_ERROR_PREFIX}: ${ordnum} — verify on WowPress`;
}

export function isPreservedLastError(lastError: string | null): boolean {
  return lastError !== null && PRESERVED_ERROR_PREFIXES.some((prefix) => lastError.startsWith(prefix));
}

// 중복 의심·번호 미저장 기록은 덮지 않는다. 새 값도 그런 기록이면 뒤에 덧붙인다
export function mergeLastError(current: string | null, next: string | null): string | null {
  if (!isPreservedLastError(current)) return next;
  if (current === null || next === null || !isPreservedLastError(next) || current.includes(next)) return current;
  return `${current} | ${next}`;
}

// isPreservedLastError 의 SQL 짝. 현재 행 값 기준이라 읽은 뒤 늦게 기록된 증거도 잡는다
export function hasPreservedLastError(): SQL {
  const t = wmsTables.printOrders;
  const matches = PRESERVED_ERROR_PREFIXES.map((prefix) => sql`starts_with(coalesce(${t.lastError}, ''), ${prefix})`);
  return sql`(${sql.join(matches, sql` OR `)})`;
}

// ponytail: 날짜로 붙잡는다. 취소 이벤트가 끝내 처리되지 않으면 운영자 재시도 전까지 발주되지 않는 쪽이 안전하다
export const PRINT_HELD_FOR_CANCEL_UNTIL = new Date('9999-12-31T00:00:00Z');

export interface PrintOrderLineContext {
  line: { id: string; variantId: string; quantity: number };
  order: { channelOrderId: string; customerId: string | null; shippingAddress: unknown };
}

@Injectable()
export class PrintOrderRepository {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  claimDueBatch(now: Date, tx?: DbTx): Promise<PrintOrderRow[]> {
    const t = wmsTables.printOrders;
    return this.dbService.run(async (trx) => {
      const [oldest] = await trx
        .select({ salesOrderId: t.salesOrderId })
        .from(t)
        .where(and(eq(t.status, 'pending'), lte(t.nextAttemptAt, now)))
        .orderBy(asc(t.createdAt))
        .limit(1);
      if (!oldest) return [];

      // 판매주문 단위로 직렬화해 같은 주문이 두 묶음으로 갈리지 않게 한다
      const locked = await trx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('print-order-claim'), hashtext(${oldest.salesOrderId})) AS locked`,
      );
      if (!locked[0]?.locked) return [];

      // 잠글 행을 먼저 따로 고른다. UPDATE … IN (SELECT … LIMIT … SKIP LOCKED) 는 안쪽 SELECT 가 다시 실행될 때마다
      // 다른 행을 집어 limit 을 넘겼다. 고른 행은 이 트랜잭션이 끝날 때까지 잠겨 있다
      const due = await trx
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.salesOrderId, oldest.salesOrderId), eq(t.status, 'pending'), lte(t.nextAttemptAt, now)))
        .orderBy(asc(t.createdAt))
        .for('update', { skipLocked: true });
      if (due.length === 0) return [];

      return trx
        .update(t)
        .set({ status: 'submitting', submittingAt: now, updatedAt: now })
        .where(
          and(
            inArray(
              t.id,
              due.map((row) => row.id),
            ),
            eq(t.status, 'pending'),
          ),
        )
        .returning();
    }, tx);
  }

  async saveVendorBox(
    id: string,
    patch: { vendorBoxNumber: string | null; vendorShippingFee: number | null },
    tx?: DbTx,
  ): Promise<void> {
    const t = wmsTables.printOrders;
    const set: Partial<Pick<PrintOrderRow, 'vendorBoxNumber' | 'vendorShippingFee'>> = {};
    if (patch.vendorBoxNumber !== null) set.vendorBoxNumber = patch.vendorBoxNumber;
    if (patch.vendorShippingFee !== null) set.vendorShippingFee = patch.vendorShippingFee;
    if (Object.keys(set).length === 0) return;

    await this.dbService.run(
      (trx) =>
        trx
          .update(t)
          .set({ ...set, updatedAt: new Date() })
          .where(eq(t.id, id)),
      tx,
    );
  }

  trackable(limit: number, tx?: DbTx): Promise<PrintOrderRow[]> {
    const t = wmsTables.printOrders;
    const shippedSince = new Date(Date.now() - SHIPPED_TRACKING_WINDOW_MS);
    return this.dbService.run(
      (trx) =>
        trx
          .select()
          .from(t)
          .where(
            and(
              inArray(t.status, TRACKED_STATUSES),
              isNotNull(t.vendorOrderNumber),
              or(eq(t.status, 'submitted'), isNull(t.shippedAt), gte(t.shippedAt, shippedSince)),
            ),
          )
          .orderBy(asc(t.updatedAt))
          .limit(limit),
      tx,
    );
  }

  staleSubmitting(olderThan: Date, tx?: DbTx): Promise<PrintOrderRow[]> {
    const t = wmsTables.printOrders;
    return this.dbService.run(
      (trx) =>
        trx
          .select()
          .from(t)
          .where(and(eq(t.status, 'submitting'), lt(t.submittingAt, olderThan))),
      tx,
    );
  }

  async update(id: string, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<void> {
    const t = wmsTables.printOrders;
    await this.dbService.run((trx) => trx.update(t).set(this.withPreservedLastError(patch)).where(eq(t.id, id)), tx);
  }

  // 보존할 오류는 항상 남기되, 취소 흐름이 잡은 행의 상태는 failed 로 덮지 않는다.
  // 취소를 마친 행에 새 보호 증거가 붙으면 살아 있는 주문이 있을 수 있으므로 같은 UPDATE 에서 cancel_refused 로 올려 보드에 띄운다
  async recordFailure(id: string, lastError: string, tx?: DbTx): Promise<void> {
    const t = wmsTables.printOrders;
    const reopens = isPreservedLastError(lastError)
      ? sql`${t.status} = 'cancelled' AND strpos(coalesce(${t.lastError}, ''), ${lastError}) = 0`
      : sql`false`;
    const status = sql<PrintOrderStatus>`CASE WHEN ${reopens} THEN 'cancel_refused' WHEN ${inArray(t.status, CANCEL_FLOW_STATUSES)} THEN ${t.status} ELSE 'failed' END`;
    const cancelRefusedAt = sql<Date>`CASE WHEN ${reopens} THEN now() ELSE ${t.cancelRefusedAt} END`;
    await this.dbService.run(
      (trx) =>
        trx
          .update(t)
          .set({ ...this.withPreservedLastError({ lastError }), status, cancelRefusedAt })
          .where(eq(t.id, id)),
      tx,
    );
  }

  // 주문 응답보다 취소 흐름이 먼저 행을 가져갔으면 받은 번호를 보존 기록으로 남기고 보드에 띄운다(cancelling 은 그대로)
  async flagLateOrdnum(id: string, ordnum: string, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    const status = sql<PrintOrderStatus>`CASE WHEN ${t.status} = 'cancelling' THEN ${t.status} ELSE 'cancel_refused' END`;
    const rows = await this.dbService.run(
      (trx) =>
        trx
          .update(t)
          .set({
            ...this.withPreservedLastError({ lastError: lateOrdnumError(ordnum), cancelRefusedAt: new Date() }),
            status,
          })
          .where(and(eq(t.id, id), inArray(t.status, CANCEL_FLOW_STATUSES)))
          .returning({ id: t.id }),
      tx,
    );
    return rows.length > 0;
  }

  async touch(id: string, tx?: DbTx): Promise<void> {
    const t = wmsTables.printOrders;
    await this.dbService.run(
      (trx) =>
        trx
          .update(t)
          .set({ updatedAt: new Date() })
          .where(and(eq(t.id, id), inArray(t.status, TRACKED_STATUSES))),
      tx,
    );
  }

  // 조회하는 사이 취소 흐름이 상태를 바꿨으면 0행이다. 송장으로 취소 상태를 덮지 않는다
  updateTracked(id: string, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(and(eq(t.id, id), inArray(t.status, TRACKED_STATUSES)), patch, tx);
  }

  async updateOwned(id: string, claimedAt: Date, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(and(eq(t.id, id), eq(t.status, 'submitting'), eq(t.submittingAt, claimedAt)), patch, tx);
  }

  takeOrderRight(id: string, claimedAt: Date, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(
      and(
        eq(t.id, id),
        eq(t.status, 'submitting'),
        eq(t.submittingAt, claimedAt),
        isNull(t.orderAttemptedAt),
        isNull(t.vendorOrderNumber),
        not(hasPreservedLastError()),
      ),
      { ...patch, orderAttemptedAt: new Date() },
      tx,
    );
  }

  saveVendorOrderNumber(id: string, vendorOrderNumber: string, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(and(eq(t.id, id), isNull(t.vendorOrderNumber)), { vendorOrderNumber }, tx);
  }

  async findVendorOrderNumber(id: string, tx?: DbTx): Promise<string | null> {
    const t = wmsTables.printOrders;
    const [row] = await this.dbService.run(
      (trx) => trx.select({ vendorOrderNumber: t.vendorOrderNumber }).from(t).where(eq(t.id, id)),
      tx,
    );
    return row?.vendorOrderNumber ?? null;
  }

  updateStale(id: string, olderThan: Date, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(and(eq(t.id, id), eq(t.status, 'submitting'), lt(t.submittingAt, olderThan)), patch, tx);
  }

  // 읽은 뒤 상태·주문번호·주문권이 그대로일 때만 쓴다. 제출 워커와 겹치면 0행이다
  compareAndSet(snapshot: PrintOrderRow, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(
      and(
        eq(t.id, snapshot.id),
        eq(t.status, snapshot.status),
        snapshot.vendorOrderNumber === null
          ? isNull(t.vendorOrderNumber)
          : eq(t.vendorOrderNumber, snapshot.vendorOrderNumber),
        snapshot.orderAttemptedAt === null ? isNull(t.orderAttemptedAt) : isNotNull(t.orderAttemptedAt),
      ),
      patch,
      tx,
    );
  }

  // 운영자 조치용. 읽은 뒤 누구도 손대지 않았을 때만 쓴다(updated_at 은 항상 JS 시각이라 밀리초까지 같다)
  updateIfUntouched(snapshot: PrintOrderRow, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(
      and(eq(t.id, snapshot.id), eq(t.status, snapshot.status), eq(t.updatedAt, snapshot.updatedAt)),
      patch,
      tx,
    );
  }

  confirmTest(id: string, actorId: string, note: string, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(
      and(eq(t.id, id), isNull(t.testConfirmedAt)),
      { testConfirmedAt: new Date(), testConfirmedBy: actorId, testNote: note },
      tx,
    );
  }

  // compareAndSet 과 같되, 그 사이 중복 의심·번호 미저장 기록이 생긴 행은 건드리지 않는다
  compareAndSetUnprotected(snapshot: PrintOrderRow, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.updateWhere(
      and(
        eq(t.id, snapshot.id),
        eq(t.status, snapshot.status),
        snapshot.vendorOrderNumber === null
          ? isNull(t.vendorOrderNumber)
          : eq(t.vendorOrderNumber, snapshot.vendorOrderNumber),
        snapshot.orderAttemptedAt === null ? isNull(t.orderAttemptedAt) : isNotNull(t.orderAttemptedAt),
        not(hasPreservedLastError()),
      ),
      patch,
      tx,
    );
  }

  // 취소 시도 중으로 표시된 지 오래된 행을 다시 집는다. 그 사이 누가 손댔으면 updated_at 이 달라 0행이다
  async reclaimCancelling(snapshot: PrintOrderRow, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    // 같은 밀리초에 두 번 집어도 값이 달라지게 읽은 값보다 반드시 뒤로 민다
    const updatedAt = new Date(Math.max(Date.now(), snapshot.updatedAt.getTime() + 1));
    const rows = await this.dbService.run(
      (trx) =>
        trx
          .update(t)
          .set({ updatedAt })
          .where(and(eq(t.id, snapshot.id), eq(t.status, 'cancelling'), eq(t.updatedAt, snapshot.updatedAt)))
          .returning({ id: t.id }),
      tx,
    );
    return rows.length > 0;
  }

  markVendorCancelled(id: string, vendorOrderNumber: string, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    // 취소 중에 다른 주문의 증거가 기록됐으면 cancelled 로 넘기지 않는다(호출자가 거절로 돌린다)
    return this.updateWhere(
      and(eq(t.id, id), eq(t.vendorOrderNumber, vendorOrderNumber), not(hasPreservedLastError())),
      { status: 'cancelled', cancelResolvedAt: null, cancelResolvedBy: null },
      tx,
    );
  }

  async findById(id: string, tx?: DbTx): Promise<PrintOrderRow | null> {
    const t = wmsTables.printOrders;
    const [row] = await this.dbService.run((trx) => trx.select().from(t).where(eq(t.id, id)), tx);
    return row ?? null;
  }

  // 판매주문 취소와 같은 트랜잭션에서, 아직 주문권을 쓰지 않은 대기 행을 발주 워커가 집지 못하게 미룬다.
  // 취소 처리(cancelForOrder)는 nextAttemptAt 을 보지 않으므로 그대로 취소·운영자 확인으로 넘긴다
  async holdUnsentForCancel(salesOrderId: string, lineIds: string[] | undefined, tx: DbTx): Promise<void> {
    const t = wmsTables.printOrders;
    await tx
      .update(t)
      .set({ nextAttemptAt: PRINT_HELD_FOR_CANCEL_UNTIL, updatedAt: new Date() })
      .where(
        and(
          eq(t.salesOrderId, salesOrderId),
          lineIds ? inArray(t.salesOrderLineId, lineIds) : undefined,
          eq(t.status, 'pending'),
          isNull(t.orderAttemptedAt),
          isNull(t.vendorOrderNumber),
        ),
      );
  }

  async lineQuantities(salesOrderId: string, lineIds: string[], tx?: DbTx): Promise<Map<string, number>> {
    if (lineIds.length === 0) return new Map();
    const lines = wmsTables.salesOrderLines;
    const rows = await this.dbService.run(
      (trx) =>
        trx
          .select({ id: lines.id, quantity: lines.quantity })
          .from(lines)
          .where(and(eq(lines.salesOrderId, salesOrderId), inArray(lines.id, lineIds))),
      tx,
    );
    return new Map(rows.map((r) => [r.id, r.quantity]));
  }

  private updateWhere(where: SQL | undefined, patch: Partial<PrintOrderRow>, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    return this.dbService.run(async (trx) => {
      const rows = await trx.update(t).set(this.withPreservedLastError(patch)).where(where).returning({ id: t.id });
      return rows.length > 0;
    }, tx);
  }

  // mergeLastError 와 같은 규칙을 현재 행 값 기준으로 SQL 에서 적용한다
  private withPreservedLastError(patch: Partial<PrintOrderRow>) {
    const t = wmsTables.printOrders;
    const set = { ...patch, updatedAt: new Date() };
    if (patch.lastError === undefined) return set;
    const next = patch.lastError;
    const preserved = hasPreservedLastError();
    const nextPreserved = next !== null && isPreservedLastError(next);
    const appended = nextPreserved
      ? sql`CASE WHEN strpos(${t.lastError}, ${next}) > 0 THEN ${t.lastError} ELSE ${t.lastError} || ${` | ${next}`} END`
      : sql`${t.lastError}`;
    const lastError = sql`CASE WHEN ${preserved} THEN ${appended} ELSE ${next}::text END`;
    if (!nextPreserved) return { ...set, lastError };
    // 새 증거가 생기면 운영자의 취소 마무리는 더는 유효하지 않다. 이미 있던 같은 기록이면 그대로 둔다
    const isNew = sql`strpos(coalesce(${t.lastError}, ''), ${next}) = 0`;
    return {
      ...set,
      lastError,
      cancelResolvedAt: sql`CASE WHEN ${isNew} THEN NULL ELSE ${t.cancelResolvedAt} END`,
      cancelResolvedBy: sql`CASE WHEN ${isNew} THEN NULL ELSE ${t.cancelResolvedBy} END`,
    };
  }

  findLineContext(salesOrderLineId: string, tx?: DbTx): Promise<PrintOrderLineContext | null> {
    const lines = wmsTables.salesOrderLines;
    const orders = wmsTables.salesOrders;
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({
          id: lines.id,
          variantId: lines.variantId,
          quantity: lines.quantity,
          channelOrderId: orders.channelOrderId,
          customerId: orders.customerId,
          shippingAddress: orders.shippingAddress,
        })
        .from(lines)
        .innerJoin(orders, eq(orders.id, lines.salesOrderId))
        .where(eq(lines.id, salesOrderLineId));
      if (!row) return null;
      return {
        line: { id: row.id, variantId: row.variantId, quantity: row.quantity },
        order: { channelOrderId: row.channelOrderId, customerId: row.customerId, shippingAddress: row.shippingAddress },
      };
    }, tx);
  }
}
