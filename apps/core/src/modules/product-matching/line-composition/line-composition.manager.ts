import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CompositionItem } from './line-composition';

/**
 * 라인 구성(sales_order_lines.composition_* 와 sales_order_line_compositions)을 쓰는 유일한 자리(#1063 스펙 §4.3).
 * «출처가 있으면 행이 1개 이상»은 테이블을 건너는 조건이라 DB 가 못 지킨다 — 쓰는 곳을 여기 하나로 묶어 지킨다.
 */
@Injectable()
export class LineCompositionManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * FO 생성이 그 순간의 상품매칭을 라인에 굳힌다. 호출자는 판매주문을 이미 잠갔다 — 그래서 출처 NULL 조건이 0행이면
   * 경합이 아니라 «리더가 follow 라고 한 라인이 이미 굳어 있다»는 결함이다. 조용히 넘기면 FO 항목과 라인 구성이 갈린다.
   */
  async freezeFromMatching(
    entries: ReadonlyArray<{ salesOrderLineId: string; items: readonly CompositionItem[] }>,
    tx?: DbTx,
  ): Promise<void> {
    await this.dbService.run(async (trx) => {
      const now = new Date();
      for (const entry of entries) {
        if (entry.items.length === 0) {
          throw new Error(`Refusing to freeze an empty composition for line ${entry.salesOrderLineId}`);
        }
        const claimed = await trx
          .update(wmsTables.salesOrderLines)
          .set({ compositionSource: 'matching', compositionSetAt: now, compositionSetBy: null, updatedAt: now })
          .where(
            and(
              eq(wmsTables.salesOrderLines.id, entry.salesOrderLineId),
              isNull(wmsTables.salesOrderLines.compositionSource),
            ),
          )
          .returning({ id: wmsTables.salesOrderLines.id });
        if (claimed.length === 0) {
          throw new Error(`Line ${entry.salesOrderLineId} is already frozen or missing`);
        }
        await trx.insert(wmsTables.salesOrderLineCompositions).values(
          entry.items.map((item) => ({
            salesOrderLineId: entry.salesOrderLineId,
            skuId: item.skuId,
            qtyPerUnit: item.qtyPerUnit,
          })),
        );
      }
    }, tx);
  }
}
