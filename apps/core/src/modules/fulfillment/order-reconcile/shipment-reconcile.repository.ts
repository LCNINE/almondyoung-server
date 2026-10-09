import { Injectable } from '@nestjs/common';
import { and, eq, inArray, lte, notInArray, or } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { toReconcilePrior } from './order-reconcile.repository';
import { ReconcileRuleRef } from './order-reconcile.rule';
import { DEPARTURE_GRACE_MIN, ReconcilePrior, ReconcileRecord } from './order-reconcile.state';

export type ShipmentReconcileCandidate = { shipmentId: string; prior: ReconcilePrior | null };

/**
 * 상자 규칙의 상태 저장소(스펙 D17). 칸 안인 상자는 틀이 상자별 판정에서 이미 골라 넘긴다 — 여기는 «볼 때가 됐나»와 기록만 한다.
 * 떠남·유예·등록 안 된 규칙 청소의 뜻은 OrderReconcileRepository 와 같다.
 */
@Injectable()
export class ShipmentReconcileRepository {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** orderedIds(칸 안 상자, 단계 진입 오래된 순) 중 행이 없거나 next_check_at 이 지난 것을 그 순서대로 limit 까지 */
  async candidates(
    rule: ReconcileRuleRef,
    orderedIds: readonly string[],
    now: Date,
    limit: number,
    tx?: DbTx,
  ): Promise<ShipmentReconcileCandidate[]> {
    if (orderedIds.length === 0) return [];
    const s = wmsTables.shipmentReconcileState;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(s)
        .where(and(eq(s.rule, rule.name), inArray(s.shipmentId, [...orderedIds])));
      const byId = new Map(rows.map((r) => [r.shipmentId, r]));
      const out: ShipmentReconcileCandidate[] = [];
      for (const shipmentId of orderedIds) {
        const row = byId.get(shipmentId);
        if (row && row.nextCheckAt.getTime() > now.getTime()) continue;
        out.push({ shipmentId, prior: row ? toReconcilePrior(row) : null });
        if (out.length >= limit) break;
      }
      return out;
    }, tx);
  }

  /**
   * 칸을 떠난 상자의 행을 지운다 — «해결됨». stillInIds = 지금 칸 안인 상자 전부. 막 act 했거나 실패한 행은
   * DEPARTURE_GRACE_MIN 동안 남긴다(order 저장소와 같은 이유).
   */
  async deleteDeparted(rule: ReconcileRuleRef, stillInIds: readonly string[], now: Date, tx?: DbTx): Promise<number> {
    const s = wmsTables.shipmentReconcileState;
    const graceFrom = new Date(now.getTime() - DEPARTURE_GRACE_MIN * 60_000);
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(s)
        .where(
          and(
            eq(s.rule, rule.name),
            or(notInArray(s.lastResult, ['acted', 'error']), lte(s.updatedAt, graceFrom)),
            // 남은 상자가 없으면 이 조건을 빼서 유예 밖 행을 모두 지운다
            stillInIds.length > 0 ? notInArray(s.shipmentId, [...stillInIds]) : undefined,
          ),
        )
        .returning({ shipmentId: s.shipmentId });
      return deleted.length;
    }, tx);
  }

  /** 등록되지 않은(이름을 바꿨거나 뺀) 규칙의 행을 지운다 — 남겨 두면 다시 볼 규칙이 없어 «자동 멈춤»이 영원히 남는다. */
  async deleteUnregistered(names: readonly string[], tx?: DbTx): Promise<number> {
    const s = wmsTables.shipmentReconcileState;
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(s)
        .where(names.length > 0 ? notInArray(s.rule, [...names]) : undefined)
        .returning({ shipmentId: s.shipmentId });
      return deleted.length;
    }, tx);
  }

  async save(rule: ReconcileRuleRef, shipmentId: string, record: ReconcileRecord, now: Date, tx?: DbTx): Promise<void> {
    const s = wmsTables.shipmentReconcileState;
    const values = {
      trackingRow: rule.row,
      fingerprint: record.fingerprint,
      mode: record.mode,
      attempts: record.attempts,
      lastResult: record.lastResult,
      lastError: record.lastError,
      nextCheckAt: record.nextCheckAt,
      gaveUpAt: record.gaveUpAt,
      updatedAt: now,
    };
    await this.dbService.run(
      (trx) =>
        trx
          .insert(s)
          .values({ rule: rule.name, shipmentId, firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: [s.rule, s.shipmentId], set: values }),
      tx,
    );
  }
}
