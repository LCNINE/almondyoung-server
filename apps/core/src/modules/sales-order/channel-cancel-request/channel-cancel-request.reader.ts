import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CHANNEL_CANCEL_REQUEST_REASON } from './channel-cancel-request.types';

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;
const t = wmsTables.salesOrderAmendments;
const isCancelRequest = eq(t.reasonCode, CHANNEL_CANCEL_REQUEST_REASON);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 취소 요청 행(`reason_code = 'CHANNEL_CANCEL_REQUEST'`) 조회. 상태 없음 — 모든 메서드가 트랜잭션을 받는다. */
@Injectable()
export class ChannelCancelRequestReader {
  async findBySourceKey(salesOrderId: string, sourceKey: string, tx: DbTx): Promise<AmendmentRow | null> {
    const [row] = await tx
      .select()
      .from(t)
      .where(
        and(
          eq(t.salesOrderId, salesOrderId),
          isCancelRequest,
          sql`${t.metadata}->'request'->>'sourceKey' = ${sourceKey}`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findOpen(salesOrderId: string, tx: DbTx, opts: { lock?: boolean } = {}): Promise<AmendmentRow | null> {
    const base = tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest, eq(t.status, 'requested')));
    const [row] = opts.lock ? await base.limit(1).for('update') : await base.limit(1);
    return row ?? null;
  }

  /** 정산 중인 요청(새 흐름, #1016 36번 재설계). 한 주문에 여럿일 수 있다 — 오래된 순 */
  async findSettling(salesOrderId: string, tx: DbTx, opts: { lock?: boolean } = {}): Promise<AmendmentRow[]> {
    const base = tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest, eq(t.status, 'settling')))
      .orderBy(asc(t.createdAt), asc(t.id));
    return opts.lock ? base.for('update') : base;
  }

  /** 사실의 requestId 는 밖에서 온 값이다 — uuid 가 아니면 조회하지 않는다(uuid 캐스트 오류로 DLQ 에 가지 않게). */
  async findById(id: string, tx: DbTx, opts: { lock?: boolean } = {}): Promise<AmendmentRow | null> {
    if (!UUID.test(id)) return null;
    const base = tx
      .select()
      .from(t)
      .where(and(eq(t.id, id), isCancelRequest));
    const [row] = opts.lock ? await base.limit(1).for('update') : await base.limit(1);
    return row ?? null;
  }

  async latestFor(salesOrderId: string, tx: DbTx | DbService<typeof wmsSchema>['db']): Promise<AmendmentRow | null> {
    const [row] = await tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(1);
    return row ?? null;
  }

  /** 새 흐름 요청 행(정산 중·끝남) — 최근 순. 정산 칸이 없는 옛 행은 부르는 쪽이 거른다 */
  async settlementRowsFor(salesOrderId: string, tx: DbTx | DbService<typeof wmsSchema>['db']): Promise<AmendmentRow[]> {
    return tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest, inArray(t.status, ['settling', 'applied'])))
      .orderBy(desc(t.createdAt), desc(t.id));
  }
}
