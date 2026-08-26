import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockReorderSuggestion } from '../dto/purchase-order.dto';

/**
 * 재주문 제안 리더 (읽기 전용, 협력자 0).
 *
 * ⚠️ 지금 산식은 임시다 — 안전재고를 리터럴 10 으로, 제안량을 `20 - available` 로 박아둔다.
 * 부천(판매 창고) 관점에서 중국 재고·발주 잔량·이동 중 물량이 셋 다 제대로 안 보이는 문제까지
 * 묶어 **#743 이 재설계한다.** `InboundPipelineReader` 가 그 세 구간(①발주 잔량 ②이동 대기
 * ③이동 중)을 이미 계산하고 있는데 여기서 쓰지 않는 것이 #743 의 핵심이다.
 *
 * 이 파일이 #743 의 작업 대상이라 독립 파일로 둔다.
 */
@Injectable()
export class ReorderSuggestionReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * 재주문 제안 조회
   * 안전재고 미만으로 떨어진 상품 목록
   */
  async getSuggestions(warehouseId?: string, tx?: DbTx): Promise<StockReorderSuggestion[]> {
    // stockSummary view에서 안전재고 미만 상품 조회
    // 현재는 단순히 availableQty < 10인 상품을 반환 (향후 안전재고 설정 기능 추가 시 개선)

    const query = sql`
            SELECT
                s.id as sku_id,
                s.name as sku_name,
                COALESCE(ss.available_qty, 0) as current_stock,
                10 as safety_stock,  -- 임시 값
                (10 - COALESCE(ss.available_qty, 0)) as shortfall,
                GREATEST(20 - COALESCE(ss.available_qty, 0), 0) as suggested_order,
                COALESCE(ss.on_order_qty, 0) as on_order_qty,
                COALESCE(ss.in_transfer_qty, 0) as in_transfer_qty
            FROM skus s
            LEFT JOIN stock_summary_view ss ON s.id = ss.sku_id
            WHERE COALESCE(ss.available_qty, 0) < 10
            ${warehouseId ? sql`AND ss.warehouse_id = ${warehouseId}` : sql``}
            ORDER BY shortfall DESC
            LIMIT 100
        `;

    interface ReorderSuggestionRow {
      sku_id: string;
      sku_name: string;
      current_stock: number;
      safety_stock: number;
      shortfall: number;
      suggested_order: number;
      on_order_qty: number;
      in_transfer_qty: number;
    }

    const results = await this.dbService.run(async (trx) => trx.execute(query), tx);
    const rows = results as unknown as ReorderSuggestionRow[];

    return rows.map((row) => ({
      skuId: row.sku_id,
      skuName: row.sku_name,
      currentStock: row.current_stock,
      safetyStock: row.safety_stock,
      shortfall: row.shortfall,
      suggestedOrder: row.suggested_order,
      onOrderQty: row.on_order_qty,
      inTransferQty: row.in_transfer_qty,
    }));
  }
}
