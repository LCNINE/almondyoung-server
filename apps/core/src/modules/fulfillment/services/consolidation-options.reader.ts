import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, SQL, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ConsolidationOptionDto,
  ConsolidationOptionShipmentDto,
  ConsolidationOptionsResponseDto,
  ConsolidationRecipientSnapshotDto,
} from '../dto/consolidation.dto';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import {
  classifyConsolidationOption,
  consolidationCustomerKey,
  customerContactName,
  customerPhoneDigits,
} from './consolidation-options';

type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
interface OptionLine {
  shipmentId: string;
  qty: number;
  salesOrderId: string | null;
  fulfillmentMode: string | null;
  skuStockType: string;
  skuName: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  displayOrderNo: string | null;
  channelOrderId: string | null;
}

interface ShipmentProgress {
  batchByShipment: Map<string, string>;
  trackingByShipment: Map<string, string>;
}

const OPTION_STATUSES: ShipmentRow['status'][] = ['draft', 'planned'];
const CLOSED_WORK_ITEM_STATUSES = ['excluded', 'completed'] as const;

function asRecipient(value: unknown): ConsolidationRecipientSnapshotDto {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

@Injectable()
export class ConsolidationOptionsReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async findOptions(shipmentId: string, tx?: DbTx): Promise<ConsolidationOptionsResponseDto> {
    return this.dbService.run(async (trx) => {
      const [source] = await trx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId))
        .limit(1);

      if (!source) throw new NotFoundError(`Shipment ${shipmentId} not found`);

      const sourceLines = await this.loadLines(trx, [source.id]);
      const sourceKey = consolidationCustomerKey(sourceLines);
      const candidateIds = await this.candidateIds(trx, source, sourceLines, sourceKey);
      const candidateLines = await this.loadLines(trx, candidateIds);
      const linesByShipment = new Map<string, OptionLine[]>();

      for (const line of candidateLines) {
        linesByShipment.set(line.shipmentId, [...(linesByShipment.get(line.shipmentId) ?? []), line]);
      }

      const candidates = candidateIds.length
        ? await trx
            .select()
            .from(wmsTables.shipments)
            .where(inArray(wmsTables.shipments.id, candidateIds))
            .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id))
        : [];
      const progress = await this.loadProgress(trx, [source.id, ...candidateIds]);

      const options: ConsolidationOptionDto[] = [];

      for (const candidate of candidates) {
        const lines = linesByShipment.get(candidate.id) ?? [];

        if (lines.length === 0) continue;

        // 창고가 직접 내보내지 않는 라인이 섞인 상자는 합포장 대상이 아니다.
        if (lines.some((line) => line.fulfillmentMode !== 'in_house' || line.skuStockType === 'drop_shipped')) continue;

        const optionKey = consolidationCustomerKey(lines);

        // DB 조건은 주문 하나만 맞으면 상자를 고르므로, 상자 전체의 고객 키로 다시 본다.
        if (sourceKey && optionKey && sourceKey !== optionKey) continue;

        const verdict = classifyConsolidationOption({
          sourceRecipient: source.recipientSnapshot,
          sourceCustomerKey: sourceKey,
          optionRecipient: candidate.recipientSnapshot,
          optionCustomerKey: optionKey,
        });

        options.push({ ...this.summary(candidate, lines, progress), ...verdict });
      }

      return { source: this.summary(source, sourceLines, progress), options };
    }, tx);
  }

  /**
   * 같은 창고·배송 프로필의 draft/planned 창고 상자 중 기준 상자의 고객 주문이 담긴 것.
   * customerId 가 있으면 그것으로, 없으면 정규화한 이름+전화로 DB 에서 고른다.
   * 기준 상자의 고객이 하나로 정해지지 않으면 전화만으로 넓게 모아 unknown_customer 로 보이게 한다.
   */
  private async candidateIds(
    trx: DbTx,
    source: ShipmentRow,
    sourceLines: OptionLine[],
    sourceKey: string | null,
  ): Promise<string[]> {
    if (!source.warehouseId || !source.shippingProfileId || sourceLines.length === 0) return [];

    const customerIds = uniqueInOrder(sourceLines.flatMap((line) => (line.customerId ? [line.customerId] : [])));
    const phones = uniqueInOrder(
      sourceLines.map((line) => customerPhoneDigits(line.customerPhone)).filter((digits) => digits !== ''),
    );
    const phoneDigits = sql<string>`regexp_replace(${wmsTables.salesOrders.customerPhone}, '\\D', '', 'g')`;
    // JS 의 trim + 공백 접기 + 소문자와 같은 정규화. 이름 비교도 DB 에서 끝내야 이름이 다른 손님을 읽지 않는다.
    const contactName = sql<string>`lower(regexp_replace(regexp_replace(${wmsTables.salesOrders.customerName}, '^\\s+|\\s+$', '', 'g'), '\\s+', ' ', 'g'))`;
    let customerFilter: SQL | undefined;

    if (customerIds.length > 0) {
      customerFilter = inArray(wmsTables.salesOrders.customerId, customerIds);
    } else if (sourceKey) {
      const [first] = sourceLines;

      customerFilter = and(
        isNull(wmsTables.salesOrders.customerId),
        eq(contactName, customerContactName(first.customerName)),
        eq(phoneDigits, customerPhoneDigits(first.customerPhone)),
      );
    } else if (phones.length > 0) {
      customerFilter = and(isNull(wmsTables.salesOrders.customerId), inArray(phoneDigits, phones));
    }

    if (!customerFilter) return [];

    const rows = await trx
      .selectDistinct({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .where(
        and(
          eq(wmsTables.shipments.warehouseId, source.warehouseId),
          eq(wmsTables.shipments.shippingProfileId, source.shippingProfileId),
          isNull(wmsTables.shipments.supplierId),
          inArray(wmsTables.shipments.status, OPTION_STATUSES),
          ne(wmsTables.shipments.id, source.id),
          customerFilter,
        ),
      )
      .orderBy(asc(wmsTables.shipments.id));

    return rows.map((row) => row.id);
  }

  private async loadLines(trx: DbTx, shipmentIds: string[]): Promise<OptionLine[]> {
    if (shipmentIds.length === 0) return [];

    return trx
      .select({
        shipmentId: wmsTables.shipmentLines.shipmentId,
        qty: wmsTables.shipmentLines.qty,
        salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
        fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
        skuStockType: wmsTables.skus.stockType,
        skuName: wmsTables.skus.name,
        customerId: wmsTables.salesOrders.customerId,
        customerName: wmsTables.salesOrders.customerName,
        customerPhone: wmsTables.salesOrders.customerPhone,
        displayOrderNo: wmsTables.salesOrders.displayOrderNo,
        channelOrderId: wmsTables.salesOrders.channelOrderId,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
      .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
      .orderBy(asc(wmsTables.shipmentLines.createdAt), asc(wmsTables.shipmentLines.id));
  }

  private async loadProgress(trx: DbTx, shipmentIds: string[]): Promise<ShipmentProgress> {
    const [workItems, waybills] = await Promise.all([
      trx
        .select({
          shipmentId: wmsTables.outboundBatchWorkItems.shipmentId,
          batchId: wmsTables.outboundBatchWorkItems.batchId,
        })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
            notInArray(wmsTables.outboundBatchWorkItems.status, [...CLOSED_WORK_ITEM_STATUSES]),
          ),
        ),
      trx
        .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
        .from(wmsTables.waybills)
        .where(
          and(
            inArray(wmsTables.waybills.shipmentId, shipmentIds),
            notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
          ),
        )
        .orderBy(desc(wmsTables.waybills.createdAt)),
    ]);
    const batchByShipment = new Map<string, string>();

    for (const row of workItems) {
      batchByShipment.set(row.shipmentId, row.batchId);
    }

    const trackingByShipment = new Map<string, string>();

    for (const row of waybills) {
      if (row.trackingNo && !trackingByShipment.has(row.shipmentId)) {
        trackingByShipment.set(row.shipmentId, row.trackingNo);
      }
    }

    return { batchByShipment, trackingByShipment };
  }

  private summary(
    shipment: ShipmentRow,
    lines: OptionLine[],
    progress: ShipmentProgress,
  ): ConsolidationOptionShipmentDto {
    const names = lines.map((line) => line.skuName);

    return {
      shipmentId: shipment.id,
      status: shipment.status,
      salesOrderNos: uniqueInOrder(
        lines.flatMap((line) => {
          const orderNo = line.displayOrderNo ?? line.channelOrderId;

          return orderNo ? [orderNo] : [];
        }),
      ),
      itemSummary: names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : (names[0] ?? ''),
      totalQty: lines.reduce((total, line) => total + line.qty, 0),
      recipientSnapshot: asRecipient(shipment.recipientSnapshot),
      batchId: progress.batchByShipment.get(shipment.id) ?? null,
      waybillTrackingNo: progress.trackingByShipment.get(shipment.id) ?? null,
      manifestVersion: shipment.manifestVersion,
      reservationVersion: shipment.reservationVersion,
      createdAt: shipment.createdAt,
    };
  }
}
