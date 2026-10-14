import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CompositionItem, compositionItemsProblem } from './line-composition';

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

  /**
   * 운영자 지정(#1063 스펙 §7.1). 출처가 무엇이든 덮어쓴다 — «이 주문만 다르게»는 상품매칭에서 온 구성보다 우선한다.
   * 호출자가 판매주문을 잠갔다. 박스 맞추기는 호출자(LineCompositionEditManager)의 몫이다.
   */
  async assignByOperator(
    salesOrderLineId: string,
    items: readonly CompositionItem[],
    actorId: string,
    tx?: DbTx,
  ): Promise<void> {
    await this.dbService.run(async (trx) => {
      this.assertItems(salesOrderLineId, items);
      const now = new Date();
      const claimed = await trx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: 'operator', compositionSetAt: now, compositionSetBy: actorId, updatedAt: now })
        .where(eq(wmsTables.salesOrderLines.id, salesOrderLineId))
        .returning({ id: wmsTables.salesOrderLines.id });
      if (claimed.length === 0) throw new Error(`Line ${salesOrderLineId} is missing`);
      await this.replaceRows(trx, salesOrderLineId, items);
    }, tx);
  }

  /**
   * «기존 출고에도 적용»(#1063 스펙 §7.2) — 출처는 matching 그대로 두고 구성만 바꾼다. operator 라인은 일괄 적용이 건너뛰는
   * 대상이라, 여기까지 왔다면 호출자의 판정이 틀린 것이다 — 조용히 덮지 않고 던진다.
   */
  async replaceMatchingComposition(
    salesOrderLineId: string,
    items: readonly CompositionItem[],
    tx?: DbTx,
  ): Promise<void> {
    await this.dbService.run(async (trx) => {
      this.assertItems(salesOrderLineId, items);
      const now = new Date();
      const claimed = await trx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSetAt: now, compositionSetBy: null, updatedAt: now })
        .where(
          and(
            eq(wmsTables.salesOrderLines.id, salesOrderLineId),
            eq(wmsTables.salesOrderLines.compositionSource, 'matching'),
          ),
        )
        .returning({ id: wmsTables.salesOrderLines.id });
      if (claimed.length === 0) throw new Error(`Line ${salesOrderLineId} is not matching-frozen`);
      await this.replaceRows(trx, salesOrderLineId, items);
    }, tx);
  }

  private assertItems(salesOrderLineId: string, items: readonly CompositionItem[]): void {
    const problem = compositionItemsProblem(items);
    if (problem) throw new Error(`Refusing composition for line ${salesOrderLineId}: ${problem}`);
  }

  private async replaceRows(trx: DbTx, salesOrderLineId: string, items: readonly CompositionItem[]): Promise<void> {
    await trx
      .delete(wmsTables.salesOrderLineCompositions)
      .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, salesOrderLineId));
    await trx
      .insert(wmsTables.salesOrderLineCompositions)
      .values(items.map((item) => ({ salesOrderLineId, skuId: item.skuId, qtyPerUnit: item.qtyPerUnit })));
  }
}
