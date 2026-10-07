import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ReconcileRuleRef } from './order-reconcile.rule';
import {
  DEPARTURE_GRACE_MIN,
  ReconcilePrior,
  ReconcileRecord,
  isReconcileMode,
  isReconcileResult,
} from './order-reconcile.state';

export type ReconcileCandidate = { salesOrderId: string; prior: ReconcilePrior | null };

/** 리컨실러 상태 저장소(스펙 §4.3·§4.5). 후보 선택은 여기에만 있다 — 규칙은 후보 SQL 을 쓰지 않는다(§4.4-1). */
@Injectable()
export class OrderReconcileRepository {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 투영의 진행 중 행 중 규칙의 칸에 있고 볼 때가 된 주문. 종료(셀메이트 출고·취소 등)는 outcome 으로 이미 빠져 있다. */
  async candidates(rule: ReconcileRuleRef, now: Date, limit: number, tx?: DbTx): Promise<ReconcileCandidate[]> {
    const p = wmsTables.orderProgress;
    const s = wmsTables.orderReconcileState;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          salesOrderId: p.salesOrderId,
          fingerprint: s.fingerprint,
          mode: s.mode,
          attempts: s.attempts,
          lastResult: s.lastResult,
          lastError: s.lastError,
          gaveUpAt: s.gaveUpAt,
        })
        .from(p)
        .leftJoin(s, and(eq(s.rule, rule.name), eq(s.salesOrderId, p.salesOrderId)))
        .where(
          and(
            isNull(p.outcome),
            eq(p.stage, rule.situation.stage),
            inArray(p.state, [...rule.situation.states]),
            or(isNull(s.salesOrderId), lte(s.nextCheckAt, now)),
          ),
        )
        .orderBy(asc(p.stageEnteredAt), asc(p.salesOrderId))
        .limit(limit);
      return rows.map((r) => ({ salesOrderId: r.salesOrderId, prior: toPrior(r) }));
    }, tx);
  }

  /**
   * 그 규칙의 상황을 떠난 주문의 행을 지운다 — «해결됨». 지운 행 수를 낸다.
   * 막 act 했거나 실패한 행은 DEPARTURE_GRACE_MIN 동안 남긴다 — 깨운 직후의 잠깐을 떠남으로 보면 횟수가 리셋된다.
   */
  async deleteDeparted(rule: ReconcileRuleRef, now: Date, tx?: DbTx): Promise<number> {
    const p = wmsTables.orderProgress;
    const s = wmsTables.orderReconcileState;
    const graceFrom = new Date(now.getTime() - DEPARTURE_GRACE_MIN * 60_000);
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(s)
        .where(
          and(
            eq(s.rule, rule.name),
            or(notInArray(s.lastResult, ['acted', 'error']), lte(s.updatedAt, graceFrom)),
            sql`NOT EXISTS (
              SELECT 1 FROM ${p}
               WHERE ${p.salesOrderId} = ${s.salesOrderId}
                 AND ${p.outcome} IS NULL
                 AND ${p.stage} = ${rule.situation.stage}
                 AND ${inArray(p.state, [...rule.situation.states])}
            )`,
          ),
        )
        .returning({ salesOrderId: s.salesOrderId });
      return deleted.length;
    }, tx);
  }

  /** 등록되지 않은(이름을 바꿨거나 뺀) 규칙의 행을 지운다 — 남겨 두면 다시 볼 규칙이 없어 «자동 멈춤»이 영원히 남는다. */
  async deleteUnregistered(names: readonly string[], tx?: DbTx): Promise<number> {
    const s = wmsTables.orderReconcileState;
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(s)
        .where(names.length > 0 ? notInArray(s.rule, [...names]) : undefined)
        .returning({ salesOrderId: s.salesOrderId });
      return deleted.length;
    }, tx);
  }

  async save(rule: ReconcileRuleRef, salesOrderId: string, record: ReconcileRecord, now: Date, tx?: DbTx): Promise<void> {
    const s = wmsTables.orderReconcileState;
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
          .values({ rule: rule.name, salesOrderId, firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: [s.rule, s.salesOrderId], set: values }),
      tx,
    );
  }
}

function toPrior(r: {
  fingerprint: string | null;
  mode: string | null;
  attempts: number | null;
  lastResult: string | null;
  lastError: string | null;
  gaveUpAt: Date | null;
}): ReconcilePrior | null {
  // 모르는 모드·결과 값(손으로 고친 행 등)은 이전 상태가 없는 것으로 본다 — 처음부터 다시 센다
  if (r.fingerprint === null || r.mode === null || r.lastResult === null || r.attempts === null) return null;
  if (!isReconcileMode(r.mode) || !isReconcileResult(r.lastResult)) return null;
  return {
    fingerprint: r.fingerprint,
    mode: r.mode,
    attempts: r.attempts,
    lastResult: r.lastResult,
    lastError: r.lastError,
    gaveUpAt: r.gaveUpAt,
  };
}
