import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, and, sql, desc, SQL } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { PurchaseOrderResponse, PurchaseOrderStatus, PurchaseOrderType } from '../dto/purchase-order.dto';
import { SupplierResponseDto } from '../../suppliers/dto/supplier-response.dto';
import { purchaseOrderExpectedArrival } from '../../shared/dates/earliest-expected-date';

/**
 * 발주 조회. **읽기 전용** — 이 파일에 쓰기를 넣지 않는다.
 *
 * 헤더의 `expectedArrival` 은 컬럼이 아니라 **`ordered` 라인 ETA 의 MIN 파생**이다
 * (`purchaseOrderExpectedArrival`). 아직 실행 안 된 발주는 그래서 비어 있는 게 정상이다.
 * 산식을 바꾸려면 파리티 통합 스펙(헤더 ETA == 그 발주에서 파생된 입고 계획 예정일)을
 * 먼저 읽을 것 — 그게 이 값의 유일한 잠금장치다.
 *
 * 잠금 순서 불변식(PO 행 → 라인 행)은 쓰기 경로의 규약이라 여기엔 해당이 없다. 다만
 * **이 파일에 `.for('update')` 를 추가하는 순간 해당된다** — 그러면 Manager 로 옮길 것.
 */
@Injectable()
export class PurchaseOrderReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * 발주 조회
   */
  async findById(poId: string, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.dbService.run(async (trx: DbTx) => {
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!po) {
        throw new NotFoundError(`Purchase order with ID ${poId} not found`);
      }

      const lines = await trx
        .select({
          skuId: wmsTables.purchaseOrderLines.skuId,
          quantity: wmsTables.purchaseOrderLines.quantity,
          unitPrice: wmsTables.purchaseOrderLines.unitPrice,
          status: wmsTables.purchaseOrderLines.status,
          orderedQty: wmsTables.purchaseOrderLines.orderedQty,
          expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
          orderedAt: wmsTables.purchaseOrderLines.orderedAt,
          orderedBy: wmsTables.purchaseOrderLines.orderedBy,
          unavailableReason: wmsTables.purchaseOrderLines.unavailableReason,
          skuName: wmsTables.skus.name,
          skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true
                      LIMIT 1
                    )`,
        })
        .from(wmsTables.purchaseOrderLines)
        .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderLines.skuId, wmsTables.skus.id))
        .where(eq(wmsTables.purchaseOrderLines.poId, poId));

      const supplier = po.supplierId
        ? (() =>
            trx
              .select()
              .from(wmsTables.suppliers)
              .where(eq(wmsTables.suppliers.id, po.supplierId))
              .limit(1)
              .then((rows) => rows[0]))()
        : undefined;

      const supplierRow = await supplier;

      return {
        id: po.id,
        type: po.type as PurchaseOrderType,
        supplierId: po.supplierId,
        expectedArrival: purchaseOrderExpectedArrival(lines),
        status: po.status as PurchaseOrderStatus,
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          status: line.status,
          orderedQty: line.orderedQty,
          unitPrice: line.unitPrice,
          expectedArrival: line.expectedArrival,
          orderedAt: line.orderedAt,
          orderedBy: line.orderedBy,
          unavailableReason: line.unavailableReason,
          sku: {
            name: line.skuName ?? '삭제된 상품',
            barcode: line.skuBarcode ?? '',
          },
        })),
        supplier: supplierRow ? SupplierResponseDto.fromDbRow(supplierRow) : undefined,
      };
    }, tx);
  }

  /**
   * 발주 목록 조회
   */
  async findMany(
    status?: PurchaseOrderStatus,
    type?: PurchaseOrderType,
    limit = 50,
    offset = 0,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse[]> {
    const conditions: SQL[] = [];

    if (status) {
      conditions.push(eq(wmsTables.purchaseOrders.status, status));
    }

    if (type) {
      conditions.push(eq(wmsTables.purchaseOrders.type, type));
    }

    const purchaseOrders = await this.dbService.run(
      async (trx) =>
        trx
          .select()
          .from(wmsTables.purchaseOrders)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(wmsTables.purchaseOrders.createdAt))
          .limit(limit)
          .offset(offset),
      tx,
    );
    const results = [] as PurchaseOrderResponse[];
    for (const po of purchaseOrders) {
      const lines = await this.dbService.run(
        async (trx) =>
          trx
            .select({
              skuId: wmsTables.purchaseOrderLines.skuId,
              quantity: wmsTables.purchaseOrderLines.quantity,
              unitPrice: wmsTables.purchaseOrderLines.unitPrice,
              status: wmsTables.purchaseOrderLines.status,
              orderedQty: wmsTables.purchaseOrderLines.orderedQty,
              expectedArrival: wmsTables.purchaseOrderLines.expectedArrival,
              orderedAt: wmsTables.purchaseOrderLines.orderedAt,
              orderedBy: wmsTables.purchaseOrderLines.orderedBy,
              unavailableReason: wmsTables.purchaseOrderLines.unavailableReason,
              skuName: wmsTables.skus.name,
              skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true
                      LIMIT 1
                    )`,
            })
            .from(wmsTables.purchaseOrderLines)
            .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderLines.skuId, wmsTables.skus.id))
            .where(eq(wmsTables.purchaseOrderLines.poId, po.id)),
        tx,
      );

      const supplier = po.supplierId
        ? await this.dbService.run(async (trx) => {
            const [row] = await trx
              .select()
              .from(wmsTables.suppliers)
              .where(eq(wmsTables.suppliers.id, po.supplierId!))
              .limit(1);
            return row;
          }, tx)
        : undefined;

      results.push({
        id: po.id,
        type: po.type as PurchaseOrderType,
        supplierId: po.supplierId,
        expectedArrival: purchaseOrderExpectedArrival(lines),
        status: po.status as PurchaseOrderStatus,
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          status: line.status,
          orderedQty: line.orderedQty,
          unitPrice: line.unitPrice,
          expectedArrival: line.expectedArrival,
          orderedAt: line.orderedAt,
          orderedBy: line.orderedBy,
          unavailableReason: line.unavailableReason,
          sku: {
            name: line.skuName ?? '',
            barcode: line.skuBarcode ?? '',
          },
        })),
        supplier: supplier ? SupplierResponseDto.fromDbRow(supplier) : undefined,
      });
    }
    return results;
  }
}
