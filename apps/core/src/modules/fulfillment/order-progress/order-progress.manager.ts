import { Injectable } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { candidateIdsSql, judgedRowsSql } from './order-progress.judge-sql';

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/**
 * 진행 투영 갱신(스펙 §5.2). 후보 → 판정 → upsert 를 한 문장으로 한다 — 원천은 읽기만 하고 잠그지 않는다.
 * 단계가 같으면 stage_entered_at 을 유지한다(세부 상태 변화로 시계를 되돌리지 않는다, 스펙 D5).
 * 목록 API 커서가 밀리초라 투영에 쓰는 시각은 전부 밀리초로 자른다.
 */
@Injectable()
export class OrderProgressManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async refresh(now: Date, tx?: DbTx): Promise<{ upserted: number }> {
    return this.dbService.run(async (trx) => {
      const result = await trx.execute(
        sql.raw(`SELECT to_char(max(evaluated_at) AT TIME ZONE 'UTC', ${ISO}) AS since FROM order_progress`),
      );
      const since = (result as unknown as { since: string | null }[])[0]?.since ?? null;
      return this.refreshScope(candidateIdsSql(since), now, trx);
    }, tx);
  }

  async refreshScope(scope: SQL, now: Date, tx?: DbTx): Promise<{ upserted: number }> {
    const nowIso = now.toISOString();
    const at = sql`${nowIso}::timestamptz`;
    return this.dbService.run(async (trx) => {
      const result = await trx.execute(sql`
        INSERT INTO order_progress AS p
          (sales_order_id, sales_channel, ordered_at, stage, state, stage_entered_at, outcome, closed_at, evaluated_at)
        SELECT j.sales_order_id, j.sales_channel::sales_channel, date_trunc('milliseconds', j.ordered_at), j.stage, j.state,
               j.estimated_entered_at::timestamptz, j.outcome,
               CASE WHEN j.outcome IS NULL THEN NULL ELSE ${at} END,
               ${at}
          FROM (${judgedRowsSql(scope, nowIso)}) j
        ON CONFLICT (sales_order_id) DO UPDATE SET
          stage = EXCLUDED.stage,
          state = EXCLUDED.state,
          stage_entered_at = CASE WHEN p.stage IS NOT DISTINCT FROM EXCLUDED.stage THEN p.stage_entered_at ELSE ${at} END,
          outcome = EXCLUDED.outcome,
          closed_at = CASE
                        WHEN EXCLUDED.outcome IS NULL THEN NULL
                        WHEN p.outcome IS NOT DISTINCT FROM EXCLUDED.outcome THEN p.closed_at
                        ELSE ${at}
                      END,
          evaluated_at = EXCLUDED.evaluated_at
      `);
      // postgres.js 결과의 count = 영향받은 행 수
      return { upserted: (result as unknown as { count: number }).count ?? 0 };
    }, tx);
  }
}
