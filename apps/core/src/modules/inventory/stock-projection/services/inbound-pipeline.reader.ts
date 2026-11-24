import { Injectable } from '@nestjs/common';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import {
  outstandingShipmentLineWhere,
  outstandingShipmentQtySql,
} from '../../inbound-shipment/services/inbound-shipment-outstanding.sql';
import { PurchaseOrderExpectedArrivalReader } from '../../procurement/services/purchase-order-expected-arrival.reader';

export interface InboundPipelineRow {
  skuId: string;
  onOrderQty: number;
  onOrderEta: Date | null;
  /** 창고 불문 실발주 라인 잔량. 전사 축(#743)이 쓴다. 판매창고행 = onOrderTotalQty − onOrderQty. */
  onOrderTotalQty: number;
  /** 판매창고행 발주의 가장 이른 예정일 (date 문자열). 없으면 null. */
  onOrderToSellableEta: string | null;
  awaitingTransferQty: number;
  inTransitQty: number;
  inTransitEta: Date | null;
  /** 외부 선적 «오는 중» 합(창고 불문). 전사 축(#1240)이 쓴다. */
  inboundShipmentQty: number;
  /** 그중 도착 창고가 판매 창고인 것. 판매 창고 축이 쓴다. */
  inboundShipmentToSellableQty: number;
  /** 판매 창고행 중 가장 이른 expected_arrival (date 문자열). 없으면 null. */
  inboundShipmentEta: string | null;
}

interface ShipmentRemainder {
  total: number;
  toSellable: number;
  eta: string | null;
}

interface QtyWithEta {
  qty: number;
  eta: Date | null;
}

/**
 * 대상 창고(판매 창고) 관점의 공급 파이프라인.
 *
 * ① 발주 잔량   — 비판매 창고로 입고 예정인 남은 수량이 있는 실발주 라인
 * ② 이동 대기   — 비판매 창고 ON_HAND (아직 선적되지 않음)
 * ③ 이동 중     — 선적됐으나 도착·분실 정산이 남은 지시서 잔량
 *
 * ②를 빼면 "재고 0, 입고예정 0" 으로 보여 중복 발주가 난다 — ②는 부천 판매가능수량에도
 * 없고(중국은 비판매 창고), 입고예정에도 없고, 발주는 이미 완료 상태라 어디에도 안 보인다.
 * 예정일이 없는 단계는 숨기지 않고 null 로 낸다 — 숨기면 그 구간이 다시 사각지대가 된다.
 *
 * ②와 ③은 겹치지 않는다: 선적된 물량은 이미 IN_TRANSFER 로 옮겨져 ON_HAND 에서 빠졌다.
 *
 * `onOrderTotalQty` — 창고 불문 실발주 라인 잔량. ①의 비판매 조건을 지운 전사 축(#743)용
 * 별도 항목이다. 판매창고행 = `onOrderTotalQty` − ①(`onOrderQty`).
 *
 * 알려진 범위 한계: `toWarehouseId` 로 좁혀지는 것은 ③뿐이다. ①②는 비판매 창고 전체의 합이라
 * 판매 창고가 하나(부천)일 때만 "이 창고의 예정 물량" 과 같다. 둘 이상이 되면 같은 수량이 모든
 * 판매 창고에 중복 표시된다 — ①은 계획의 destination_warehouse_id 로 좁힐 여지가 있지만, ②는
 * 이동 지시서가 생기기 전 구간이라 목적지 링크 자체가 없어 구조적으로 좁힐 수 없다.
 */
@Injectable()
export class InboundPipelineReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly transferReader: WarehouseTransferReader,
    private readonly purchaseOrders: PurchaseOrderExpectedArrivalReader,
  ) {}

  /** 요청한 SKU 마다 한 행. 파이프라인이 비어 있는 SKU 도 0 으로 낸다 — 빠지면 화면이 그 칸을 못 그린다. */
  async read(tx: DbTx, input: { skuIds: string[]; toWarehouseId: string }): Promise<InboundPipelineRow[]> {
    const skuIds = [...new Set(input.skuIds)];
    if (skuIds.length === 0) return [];

    return this.dbService.run(async (trx) => {
      const onOrder = await this.readOnOrder(trx, skuIds);
      const onOrderTotal = await this.readOnOrderTotal(trx, skuIds);
      const awaiting = await this.readAwaitingTransfer(trx, skuIds);
      const inTransit = await this.readInTransit(trx, skuIds, input.toWarehouseId);
      const shipments = await this.readInboundShipments(trx, skuIds);

      return skuIds.map((skuId) => ({
        skuId,
        onOrderQty: onOrder.get(skuId)?.qty ?? 0,
        onOrderEta: onOrder.get(skuId)?.eta ?? null,
        onOrderTotalQty: onOrderTotal.get(skuId)?.qty ?? 0,
        onOrderToSellableEta: onOrderTotal.get(skuId)?.sellableEta ?? null,
        awaitingTransferQty: awaiting.get(skuId) ?? 0,
        inTransitQty: inTransit.get(skuId)?.qty ?? 0,
        inTransitEta: inTransit.get(skuId)?.eta ?? null,
        inboundShipmentQty: shipments.get(skuId)?.total ?? 0,
        inboundShipmentToSellableQty: shipments.get(skuId)?.toSellable ?? 0,
        inboundShipmentEta: shipments.get(skuId)?.eta ?? null,
      }));
    }, tx);
  }

  /**
   * ④ 선적 «오는 중» (#1240). 잔량 식·열린 줄 조건은 `inbound-shipment-outstanding.sql` 이 소유한다.
   * 예정 지난 선적도 센다(늦을 뿐 오고 있다). 예정일은 판매 창고행의 가장 이른 것.
   */
  private async readInboundShipments(trx: DbTx, skuIds: string[]): Promise<Map<string, ShipmentRemainder>> {
    const line = wmsTables.inboundShipmentLines;
    const shipment = wmsTables.inboundShipments;
    const qty = outstandingShipmentQtySql();
    const toSellable = inSellableWarehouse(shipment.warehouseId);

    const rows = await trx
      .select({
        skuId: line.skuId,
        total: sql<number>`COALESCE(SUM(${qty}), 0)::int`,
        toSellable: sql<number>`COALESCE(SUM(CASE WHEN ${toSellable} THEN ${qty} ELSE 0 END), 0)::int`,
        eta: sql<string | null>`MIN(CASE WHEN ${toSellable} THEN ${shipment.expectedArrival} END)::text`,
      })
      .from(line)
      .innerJoin(shipment, eq(shipment.id, line.shipmentId))
      .where(and(outstandingShipmentLineWhere(), inArray(line.skuId, skuIds)))
      .groupBy(line.skuId);

    const bySku = new Map<string, ShipmentRemainder>();
    for (const row of rows) {
      if (!row.skuId) continue;
      bySku.set(row.skuId, { total: Number(row.total), toSellable: Number(row.toSellable), eta: row.eta });
    }
    return bySku;
  }

  /** ① 아직 중국에도 안 들어온 발주 잔량. 예정일은 가장 이른 라인 ETA. */
  private async readOnOrder(trx: DbTx, skuIds: string[]): Promise<Map<string, QtyWithEta>> {
    return this.purchaseOrders.sumOutstandingBySku(skuIds, 'non_sellable_source', trx);
  }

  /**
   * 전 창고 실발주 라인 잔량. ①과 달리 판매 창고행(국내 직행 발주)도 센다 — 전사 축은
   * "회사가 이미 산 것" 전부가 필요하다. ①의 비판매 조건을 지우는 게 아니라 항목을 하나 더 낸다.
   */
  private async readOnOrderTotal(
    trx: DbTx,
    skuIds: string[],
  ): Promise<Map<string, { qty: number; sellableEta: string | null }>> {
    return this.purchaseOrders.sumOutstandingBySku(skuIds, 'all', trx);
  }

  /** ② 비판매 창고에 도착해 있으나 아직 이동 지시서에 실리지 않은 물량. 예정일이라 할 것이 없다. */
  private async readAwaitingTransfer(trx: DbTx, skuIds: string[]): Promise<Map<string, number>> {
    const ledgers = wmsTables.stockLedgers;

    const rows = await trx
      .select({
        skuId: ledgers.skuId,
        qty: sql<number>`SUM(${ledgers.qty})::int`,
      })
      .from(ledgers)
      .where(
        and(
          eq(ledgers.stockState, 'ON_HAND'),
          not(inSellableWarehouse(ledgers.warehouseId)),
          inArray(ledgers.skuId, skuIds),
        ),
      )
      .groupBy(ledgers.skuId);

    return new Map(rows.map((row) => [row.skuId, Number(row.qty)]));
  }

  /**
   * ③ 떠났으나 아직 도착·분실 정산이 안 된 잔량.
   *
   * 잔량 식(shipped − received − lost)은 `WarehouseTransferReader.findOutstanding` 이
   * 소유한다 — 여기서 같은 뺄셈을 다시 쓰면 두 벌이 갈라진다. 열린 지시서 라인만 도는
   * 조회라 여기서 창고·SKU 로 좁혀도 비용이 문제되지 않는다.
   */
  private async readInTransit(trx: DbTx, skuIds: string[], toWarehouseId: string): Promise<Map<string, QtyWithEta>> {
    const wanted = new Set(skuIds);
    const outstanding = await this.transferReader.findOutstanding(trx);

    const bySku = new Map<string, QtyWithEta>();
    for (const line of outstanding) {
      if (line.toWarehouseId !== toWarehouseId || !wanted.has(line.skuId)) continue;
      const current = bySku.get(line.skuId) ?? { qty: 0, eta: null };
      bySku.set(line.skuId, {
        qty: current.qty + line.outstandingQty,
        // 가장 이른 도착 예정일. ETA 가 없는 지시서는 예정일을 늦추지 않는다.
        eta: earliest(current.eta, line.eta),
      });
    }
    return bySku;
  }
}

function earliest(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}
