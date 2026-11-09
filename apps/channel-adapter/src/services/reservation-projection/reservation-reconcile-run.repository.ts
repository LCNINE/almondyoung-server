import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, medusaReservationReconcileRuns } from '../../schema';

export type ReconcileRunStatus = 'applied' | 'halted' | 'skipped' | 'running';
export type ReconcileExample = { lineItemId: string; current: number; target: number };
export type ReconcileRunResult = {
  status: Exclude<ReconcileRunStatus, 'running'>;
  candidates: number;
  fixes: number;
  fixFailures: number;
  deferred: number;
  unknown: number;
  oldestUnknownAt: Date | null;
  examples: ReconcileExample[];
  error: string | null;
};

export type ReconcileRunRow = typeof medusaReservationReconcileRuns.$inferSelect;

/** 예약 대사 회차 기록 (#1247). 시작할 때 `running` 으로 넣고 끝에 갱신한다 — 도는 중인 회차가 보이게. */
@Injectable()
export class ReservationReconcileRunRepository {
  constructor(private readonly dbService: DbService<typeof channelAdapterSchema>) {}

  async start(startedAt: Date, forcedBy: string | null): Promise<string> {
    const [row] = await this.dbService.db
      .insert(medusaReservationReconcileRuns)
      .values({ startedAt, status: 'running', forcedBy })
      .returning({ id: medusaReservationReconcileRuns.id });
    if (!row) throw new Error('대사 회차 행을 만들지 못했다');
    return row.id;
  }

  async finish(id: string, result: ReconcileRunResult): Promise<void> {
    await this.dbService.db
      .update(medusaReservationReconcileRuns)
      .set({ ...result, finishedAt: new Date() })
      .where(eq(medusaReservationReconcileRuns.id, id));
  }

  /** 멈췄고 아직 아무도 닫지 않은 회차 — 화면의 «확인 필요» 목록. */
  async listOpenHalted(): Promise<ReconcileRunRow[]> {
    return this.dbService.db
      .select()
      .from(medusaReservationReconcileRuns)
      .where(and(eq(medusaReservationReconcileRuns.status, 'halted'), isNull(medusaReservationReconcileRuns.closedAt)))
      .orderBy(desc(medusaReservationReconcileRuns.startedAt));
  }

  async latest(): Promise<ReconcileRunRow | null> {
    const [row] = await this.dbService.db
      .select()
      .from(medusaReservationReconcileRuns)
      .orderBy(desc(medusaReservationReconcileRuns.startedAt))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<ReconcileRunRow | null> {
    const [row] = await this.dbService.db
      .select()
      .from(medusaReservationReconcileRuns)
      .where(eq(medusaReservationReconcileRuns.id, id));
    return row ?? null;
  }

  /** 열린 halted 회차만 닫는다(조건부 UPDATE) — 동시에 둘이 닫으면 하나만 true. */
  async closeOpenHalted(id: string, closedBy: string, reason: string): Promise<boolean> {
    const rows = await this.dbService.db
      .update(medusaReservationReconcileRuns)
      .set({ closedAt: new Date(), closedBy, closeReason: reason })
      .where(
        and(
          eq(medusaReservationReconcileRuns.id, id),
          eq(medusaReservationReconcileRuns.status, 'halted'),
          isNull(medusaReservationReconcileRuns.closedAt),
        ),
      )
      .returning({ id: medusaReservationReconcileRuns.id });
    return rows.length > 0;
  }
}
