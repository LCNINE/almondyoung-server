import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { PurchaseOrderExpectedArrivalReader } from '../../procurement/services/purchase-order-expected-arrival.reader';
import { ExpectedArrivalsResponseDto } from '../dto/expected-arrivals.dto';

@Injectable()
export class ExpectedArrivalsReader {
  constructor(private readonly purchaseOrders: PurchaseOrderExpectedArrivalReader) {}

  /** 여러 문서를 합칠 자리(스펙 §9). 지금은 발주뿐이다 — 이동 지시서가 커널에 올라오면 여기 합류한다. */
  async listByWarehouse(warehouseId: string, tx?: DbTx): Promise<ExpectedArrivalsResponseDto> {
    const rows = await this.purchaseOrders.listByWarehouse(warehouseId, tx);
    const arrivals = rows.map((row) => ({
      source: 'purchase_order' as const,
      documentId: row.poId,
      type: row.type,
      supplier: row.supplier,
      expectedDate: row.expectedDate,
      totalOutstandingQuantity: row.totalOutstandingQuantity,
      lines: row.lines,
    }));
    return {
      warehouseId,
      totalDocuments: arrivals.length,
      totalOutstandingQuantity: arrivals.reduce((sum, arrival) => sum + arrival.totalOutstandingQuantity, 0),
      arrivals,
    };
  }
}
