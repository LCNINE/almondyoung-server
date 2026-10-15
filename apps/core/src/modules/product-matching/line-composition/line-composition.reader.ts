import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { DbTx, SalesOrderLine, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ProductSkuMappingService } from '../services/product-sku-mapping.service';
import {
  CompositionItem,
  isDigitalFulfillmentLine,
  isOutsourcedLine,
  LineCompositionResolution,
  resolveLineComposition,
} from './line-composition';
import { selectFrozenCompositions } from './frozen-compositions';
import { sumCancelledByLine } from './partial-cancellation';

export interface ResolvedSalesOrderLine {
  line: SalesOrderLine;
  /** 주문 수량 − 부분 취소. 0 이하면 FO 대상이 아니다 */
  fulfillableQuantity: number;
  resolution: LineCompositionResolution;
}

/**
 * 주문 하나의 라인 전부를 읽어 «적용 구성»을 판정한다(#1063 스펙 §5.1). FO 생성과 리컨실러가 이 리더만 부른다 —
 * 둘이 라인·유효 수량을 각자 읽으면 «워커는 풀리는데 리컨실러는 안 풀림» 같은 엇갈림이 생긴다.
 */
@Injectable()
export class LineCompositionReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSkuMapping: ProductSkuMappingService,
  ) {}

  async resolveForOrder(salesOrderId: string, tx?: DbTx): Promise<ResolvedSalesOrderLine[]> {
    return this.dbService.run(async (trx) => {
      const lines = await trx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
      if (lines.length === 0) return [];

      const frozenByLine = await selectFrozenCompositions(
        trx,
        lines.map((line) => line.id),
      );

      const cancellations = await trx
        .select({ metadata: wmsTables.salesOrderCancellations.metadata })
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
      const cancelledByLine = sumCancelledByLine(cancellations.map((c) => c.metadata));

      const resolved: ResolvedSalesOrderLine[] = [];
      for (const line of lines) {
        // 굳힌 라인·디지털 라인은 상품매칭을 읽지 않는다 — 판정에 안 쓰는 조회를 줄인다
        const needsMatching = line.compositionSource === null && !isDigitalFulfillmentLine(line) && !isOutsourcedLine(line);
        const matching = needsMatching ? await this.productSkuMapping.getByVariant(line.variantId, trx) : null;
        resolved.push({
          line,
          fulfillableQuantity: line.quantity - (cancelledByLine.get(line.id) ?? 0),
          resolution: resolveLineComposition(line, frozenByLine.get(line.id) ?? [], matching),
        });
      }
      return resolved;
    }, tx);
  }
}
