import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DbService } from '@app/db';
import { channelAdapterSchema, medusaReservationReconcileRuns } from '../../schema';

export type ReconcileRunStatus = 'applied' | 'halted' | 'skipped' | 'running';
export type ReconcileExample = { lineItemId: string; current: number; target: number };
export type ReconcileRunResult = {
  status: Exclude<ReconcileRunStatus, 'running'>;
  candidates: number;
  /** 한도 판정에 센 고칠 줄(dry run 이 set 이라 한 줄). 멈춘 회차가 화면에 보이는 숫자다. */
  plannedFixes: number;
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

  /**
   * «확인했으니 고치기» 용 시작 — `staleBefore` 이후에 시작해 아직 `running` 인 회차가 없을 때만 행을 넣는다(한 문).
   * 있으면 null. `staleBefore` 보다 오래된 `running` 은 프로세스가 죽어 남은 행으로 보고 막지 않는다 —
   * 막으면 그런 행 하나가 고치기를 영영 잠근다. raw sql 의 Date 파라미터는 postgres.js 가 직렬화하지 못해 ISO 문자열로 넘긴다
   * (열 비교 `gt(t.startedAt, …)` 는 drizzle 이 열 타입으로 바꿔 준다).
   */
  async startIfIdle(startedAt: Date, forcedBy: string, staleBefore: Date): Promise<string | null> {
    const t = medusaReservationReconcileRuns;
    const rows = await this.dbService.db.execute<{ id: string }>(sql`
      INSERT INTO ${t} (${sql.identifier(t.id.name)}, ${sql.identifier(t.startedAt.name)}, ${sql.identifier(t.status.name)}, ${sql.identifier(t.forcedBy.name)})
      SELECT ${uuidv7()}::uuid, ${startedAt.toISOString()}::timestamptz, 'running', ${forcedBy}::text
      WHERE NOT EXISTS (
        SELECT 1 FROM ${t} WHERE ${and(eq(t.status, 'running'), gt(t.startedAt, staleBefore))}
      )
      RETURNING ${t.id}
    `);
    return rows[0]?.id ?? null;
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
