import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { PurchaseOrderExpectedArrivalReader } from '../../procurement/services/purchase-order-expected-arrival.reader';
import {
  outstandingShipmentLineWhere,
  outstandingShipmentQtySql,
} from '../../inbound-shipment/services/inbound-shipment-outstanding.sql';
import {
  ExpectedArrivalDto,
  ExpectedArrivalsResponseDto,
  InboundShipmentExpectedArrivalDto,
} from '../dto/expected-arrivals.dto';

@Injectable()
export class ExpectedArrivalsReader {
  constructor(
    private readonly purchaseOrders: PurchaseOrderExpectedArrivalReader,
    // 선적 모듈의 Nest provider 를 빌리지 않는다(모듈 순환 회피) — Task 1 의 SQL 조각만 쓴다.
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * 여러 문서를 합칠 자리(스펙 §9·§10). 발주는 늘 나가고, 선적은 `includeShipments` 일 때만 더한다 —
   * 옛 앱은 모든 줄을 발주 화면으로 잇기 때문이다.
   */
  async listByWarehouse(
    warehouseId: string,
    opts: { includeShipments: boolean },
    tx?: DbTx,
  ): Promise<ExpectedArrivalsResponseDto> {
    const rows = await this.purchaseOrders.listByWarehouse(warehouseId, tx);
    const orders: ExpectedArrivalDto[] = rows.map((row) => ({
      source: 'purchase_order' as const,
      documentId: row.poId,
      type: row.type,
      supplier: row.supplier,
      expectedDate: row.expectedDate,
      totalOutstandingQuantity: row.totalOutstandingQuantity,
      lines: row.lines,
    }));
    const shipments = opts.includeShipments ? await this.listShipments(warehouseId, tx) : [];
    const arrivals = [...orders, ...shipments].sort(compareArrivals);
    return {
      warehouseId,
      totalDocuments: arrivals.length,
      totalOutstandingQuantity: arrivals.reduce((sum, arrival) => sum + arrival.totalOutstandingQuantity, 0),
      arrivals,
    };
  }

  private listShipments(warehouseId: string, tx?: DbTx): Promise<InboundShipmentExpectedArrivalDto[]> {
    return this.dbService.run(async (trx) => {
      const shipment = wmsTables.inboundShipments;
      const line = wmsTables.inboundShipmentLines;
      const box = wmsTables.inboundShipmentBoxes;
      const open = await trx
        .select({
          id: shipment.id,
          name: shipment.name,
          expectedDate: shipment.expectedArrival,
          outstanding: sql<number>`SUM(${outstandingShipmentQtySql()})::int`,
        })
        .from(line)
        .innerJoin(shipment, eq(shipment.id, line.shipmentId))
        .where(and(eq(shipment.warehouseId, warehouseId), outstandingShipmentLineWhere()))
        .groupBy(shipment.id, shipment.name, shipment.expectedArrival);
      if (open.length === 0) return [];

      const boxRows = await trx
        .select({
          shipmentId: box.shipmentId,
          stockBoxes: sql<number>`COUNT(*)::int`,
          receivedBoxes: sql<number>`COUNT(*) FILTER (WHERE ${box.status} = 'received')::int`,
        })
        .from(box)
        .where(
          and(
            inArray(
              box.shipmentId,
              open.map((o) => o.id),
            ),
            eq(box.disposition, 'stock'),
          ),
        )
        .groupBy(box.shipmentId);
      const boxesOf = new Map(boxRows.map((b) => [b.shipmentId, b]));

      return open.map((o) => ({
        source: 'inbound_shipment' as const,
        documentId: o.id,
        name: o.name,
        expectedDate: o.expectedDate,
        totalOutstandingQuantity: Number(o.outstanding),
        receivedBoxes: boxesOf.get(o.id)?.receivedBoxes ?? 0,
        stockBoxes: boxesOf.get(o.id)?.stockBoxes ?? 0,
      }));
    }, tx);
  }
}

/** 예정일 오름차순, 날짜 없는 것은 뒤, 같으면 문서 id. */
function compareArrivals(a: ExpectedArrivalDto, b: ExpectedArrivalDto): number {
  if (a.expectedDate !== b.expectedDate) {
    if (a.expectedDate === null) return 1;
    if (b.expectedDate === null) return -1;
    return a.expectedDate < b.expectedDate ? -1 : 1;
  }
  return a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0;
}
