import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
}
