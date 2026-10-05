import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { judgedRowsSql } from './order-progress.judge-sql';
import { OrderProgressOutcome, OrderProgressStage } from './order-progress.thresholds';

export type JudgedRow = {
  salesOrderId: string;
  salesChannel: string;
  stage: OrderProgressStage | null;
  state: string | null;
  outcome: OrderProgressOutcome | null;
  estimatedEnteredAt: string;
};

type RawJudged = {
  sales_order_id: string;
  sales_channel: string;
  stage: OrderProgressStage | null;
  state: string | null;
  outcome: OrderProgressOutcome | null;
  estimated_entered_at: string;
};

@Injectable()
export class OrderProgressReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 지정한 판매주문들을 판정한다. 투영에 쓰지 않는다 — 리컨실러·스펙이 «지금 판정»을 볼 때 쓴다. */
  async judge(salesOrderIds: string[], now: Date, tx?: DbTx): Promise<JudgedRow[]> {
    if (salesOrderIds.length === 0) return [];
    return this.dbService.run(async (trx) => {
      const scope = sql`SELECT unnest(ARRAY[${sql.join(
        salesOrderIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])`;
      const result = await trx.execute(judgedRowsSql(scope, now.toISOString()));
      // execute() 원시 결과 타이핑 — demand-series.writer.ts 와 같은 문서화된 캐스트.
      return (result as unknown as RawJudged[]).map((r) => ({
        salesOrderId: r.sales_order_id,
        salesChannel: r.sales_channel,
        stage: r.stage,
        state: r.state,
        outcome: r.outcome,
        estimatedEnteredAt: r.estimated_entered_at,
      }));
    }, tx);
  }
}
