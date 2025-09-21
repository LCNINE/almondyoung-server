import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { sql, eq, and } from 'drizzle-orm';

// stockSummary view의 결과 타입
export type StockSummaryViewResult = {
  skuId: string;
  warehouseId: string;
  skuName: string | null;
  warehouseName: string | null;
  onHandQty: number;
  defectiveQty: number;
  inTransferQty: number;
  reservedQty: number;
  availableQty: number;
  inboundPendingQty: number;
  onOrderQty: number;
  transferPendingQty: number;
  projectedAvailableQty: number;
  lastCalculatedAt: Date;
};

// 기존 호환성을 위한 알리아스
export type StockSummaryRow = StockSummaryViewResult & {
  // 기존 필드명들을 새 필드명으로 매핑
  currentQuantity: number;  // onHandQty + defectiveQty + inTransferQty
  availableQuantity: number; // availableQty
  reservedQuantity: number;  // reservedQty
  inboundPendingQuantity: number; // inboundPendingQty
  outboundPendingQuantity: number; // onOrderQty
  movingQuantity: number; // inTransferQty
  defectiveQuantity: number; // defectiveQty
  returnPendingQuantity: number; // transferPendingQty
  lastUpdated: Date; // lastCalculatedAt
};

@Injectable()
export class StockSummaryViewService {
  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  // PostgreSQL VIEW를 직접 쿼리하는 메서드
  private async queryStockSummaryView(whereClause?: string, params: any[] = []): Promise<StockSummaryViewResult[]> {
    const query = `
      SELECT
        s.id as sku_id,
        w.id as warehouse_id,
        s.name as sku_name,
        w.name as warehouse_name,

        -- 물리적 재고
        COALESCE(on_hand.qty, 0) as on_hand_qty,
        COALESCE(defective.qty, 0) as defective_qty,
        COALESCE(in_transfer.qty, 0) as in_transfer_qty,

        -- 예약 상태
        COALESCE(reserved.qty, 0) as reserved_qty,
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) as available_qty,

        -- 예정 상태
        COALESCE(inbound_pending.qty, 0) as inbound_pending_qty,
        0 as on_order_qty,
        0 as transfer_pending_qty,

        -- 계산된 전망
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) + COALESCE(inbound_pending.qty, 0) as projected_available_qty,

        NOW() as last_calculated_at

      FROM skus s
      CROSS JOIN warehouses w
      LEFT JOIN (
          SELECT sku_id, warehouse_id, SUM(qty) as qty
          FROM stock_ledgers
          WHERE stock_state = 'ON_HAND'
          GROUP BY sku_id, warehouse_id
      ) on_hand ON s.id = on_hand.sku_id AND w.id = on_hand.warehouse_id
      LEFT JOIN (
          SELECT sku_id, warehouse_id, SUM(qty) as qty
          FROM stock_ledgers
          WHERE stock_state = 'DEFECTIVE'
          GROUP BY sku_id, warehouse_id
      ) defective ON s.id = defective.sku_id AND w.id = defective.warehouse_id
      LEFT JOIN (
          SELECT sku_id, warehouse_id, SUM(qty) as qty
          FROM stock_ledgers
          WHERE stock_state = 'IN_TRANSFER'
          GROUP BY sku_id, warehouse_id
      ) in_transfer ON s.id = in_transfer.sku_id AND w.id = in_transfer.warehouse_id
      LEFT JOIN (
          SELECT sku_id, warehouse_id, SUM(quantity) as qty
          FROM stock_reservations
          WHERE status = 'confirmed'
          GROUP BY sku_id, warehouse_id
      ) reserved ON s.id = reserved.sku_id AND w.id = reserved.warehouse_id
      LEFT JOIN (
          SELECT ipi.sku_id, ip.warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
          FROM inbound_plan_items ipi
          INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
          WHERE ipi.status = 'pending'
          GROUP BY ipi.sku_id, ip.warehouse_id
      ) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.warehouse_id
      ${whereClause ? `WHERE ${whereClause}` : ''}
    `;

    const result = await this.db.execute(sql.raw(query));
    return result.rows as StockSummaryViewResult[];
  }

  // 기존 인터페이스 호환성을 위한 wrapper 메서드들
  async findMany(options?: {
    where?: { skuId?: string; warehouseId?: string }
  }): Promise<StockSummaryRow[]> {
    let whereClause = '';
    const params: any[] = [];

    if (options?.where?.skuId && options?.where?.warehouseId) {
      whereClause = 's.id = $1 AND w.id = $2';
      params.push(options.where.skuId, options.where.warehouseId);
    } else if (options?.where?.skuId) {
      whereClause = 's.id = $1';
      params.push(options.where.skuId);
    } else if (options?.where?.warehouseId) {
      whereClause = 'w.id = $1';
      params.push(options.where.warehouseId);
    }

    const results = await this.queryStockSummaryView(whereClause, params);
    return results.map(this.mapToLegacyFormat);
  }

  async findFirst(options: {
    where: { skuId: string; warehouseId: string }
  }): Promise<StockSummaryRow | null> {
    const whereClause = 's.id = $1 AND w.id = $2';
    const params = [options.where.skuId, options.where.warehouseId];

    const results = await this.queryStockSummaryView(whereClause, params);
    return results.length > 0 ? this.mapToLegacyFormat(results[0]) : null;
  }

  // 새 형식을 기존 형식으로 매핑
  private mapToLegacyFormat(result: StockSummaryViewResult): StockSummaryRow {
    return {
      ...result,
      // 기존 필드명 매핑
      currentQuantity: result.onHandQty + result.defectiveQty + result.inTransferQty,
      availableQuantity: result.availableQty,
      reservedQuantity: result.reservedQty,
      inboundPendingQuantity: result.inboundPendingQty,
      outboundPendingQuantity: result.onOrderQty,
      movingQuantity: result.inTransferQty,
      defectiveQuantity: result.defectiveQty,
      returnPendingQuantity: result.transferPendingQty,
      lastUpdated: result.lastCalculatedAt,
    };
  }
}