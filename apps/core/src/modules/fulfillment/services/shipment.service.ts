import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { OutboundConsumptionService } from './outbound-consumption.service';

/**
 * 박스(shipment) 수명주기의 작업자 동작 진입점 (Cluster A, EU3).
 *
 * 박스는 **송장 스캔으로 lazy 하게** 태어난다(`openBoxByScan`). 검수 스캔(`inspectScan`)이
 * `shipment_line.inspectedQty` 를 올리고, 박스의 전 라인이 검수 완료되면 같은 트랜잭션 안에서
 * EU2 의 `consumeShipment` 가 자동 발사돼 출고가 전체 종결된다. `forceShipment` 는 그 자동완료의
 * 유일한 override — 미검수 라인을 강제로 충족 처리하고 종결시킨다.
 *
 * 종결 오케스트레이션(원장 차감·예약 소진·이벤트 발행)은 `OutboundConsumptionService` 가 갖는다.
 * 이 서비스는 박스/라인 상태 전이와 자동완료 판정만 책임진다.
 */
@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly barcode: BarcodeService,
    private readonly outboundConsumption: OutboundConsumptionService,
  ) {}

  /**
   * 송장(운송장번호) 스캔으로 박스를 lazy 하게 open 한다.
   *
   * 흐름: issued 송장 잠금·조회 → FO(warehouseId/mode) 조회 → shipment{status:'open'} insert →
   * invoice 를 박스에 매고 status='used' 전이 → FO 의 미출고 FOI 를 shipment_line 으로 미러
   * (qty = 잔량 = qty - shippedQty). drop_ship FO·warehouse 부재·이미 사용/무효 송장은 거부.
   */
  async openBoxByScan(trackingNo: string, operatorId?: string, tx?: DbTx): Promise<{ shipmentId: string }> {
    return this.db.run(async (trx) => {
      const [invoice] = await trx
        .select({
          id: wmsTables.invoices.id,
          foId: wmsTables.invoices.issuedForFulfillmentOrderId,
          status: wmsTables.invoices.status,
          shipmentId: wmsTables.invoices.shipmentId,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.trackingNo, trackingNo))
        .for('update')
        .limit(1);
      if (!invoice) {
        throw new NotFoundException(`운송장번호 ${trackingNo} 송장 없음`);
      }
      if (invoice.status !== 'issued') {
        throw new ConflictException(`송장 ${trackingNo} 는 이미 ${invoice.status} 상태 (박스 open 불가)`);
      }

      const [fo] = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          warehouseId: wmsTables.fulfillmentOrders.warehouseId,
          mode: wmsTables.fulfillmentOrders.fulfillmentMode,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, invoice.foId))
        .limit(1);
      if (!fo?.warehouseId) {
        throw new ConflictException(`FO ${invoice.foId} 에 warehouseId 없음 (박스 open 불가)`);
      }
      if (fo.mode === 'drop_ship') {
        throw new ConflictException(`drop_ship FO 는 박스 스캔 경로를 타지 않습니다`);
      }

      // 좀비 박스 방어: shipment insert **전에** 미러 잔량을 계산한다. 한 FO 에 issued 송장이 둘
      // 이상이거나 이미 전량출고된 FO 면 미러 대상이 0줄이 되는데, 그때 shipment insert + invoice
      // 'used' 마킹이 일어나면 라인 없는 open 박스가 좀비로 남는다. 0줄이면 write 전에 거부.
      const items = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          qty: wmsTables.fulfillmentOrderItems.qty,
          shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
      const residual = items
        .map((it) => ({ fulfillmentOrderItemId: it.id, skuId: it.skuId, qty: it.qty - it.shippedQty }))
        .filter((l) => l.qty > 0);
      if (residual.length === 0) {
        throw new ConflictException(`FO ${fo.id} 에 출고할 잔량이 없어 박스 open 불가 (이미 전량 출고?)`);
      }

      const [shipment] = await trx
        .insert(wmsTables.shipments)
        .values({
          status: 'open',
          openedBy: operatorId ?? null,
          openedForFulfillmentOrderId: fo.id,
          warehouseId: fo.warehouseId,
          openedAt: new Date(),
        })
        .returning({ id: wmsTables.shipments.id });
      await trx
        .update(wmsTables.invoices)
        .set({ shipmentId: shipment.id, status: 'used' })
        .where(eq(wmsTables.invoices.id, invoice.id));

      const lines = residual.map((l) => ({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: l.fulfillmentOrderItemId,
        skuId: l.skuId,
        qty: l.qty,
        inspectedQty: 0,
        forced: false,
      }));
      await trx
        .insert(wmsTables.shipmentLines)
        .values(lines)
        .onConflictDoNothing({
          target: [wmsTables.shipmentLines.shipmentId, wmsTables.shipmentLines.fulfillmentOrderItemId],
        });
      this.logger.log(`Opened box ${shipment.id} for FO ${fo.id} (${lines.length} line(s)) via scan ${trackingNo}`);
      return { shipmentId: shipment.id };
    }, tx);
  }

  /**
   * 박스에 담긴 라인을 바코드 스캔으로 검수한다.
   *
   * 박스를 잠그고 바코드→skuId 를 해석해 같은 sku 라인 중 **미완료 우선**으로 `inspectedQty`
   * 를 quantity 만큼 올린다(qty 상한). 박스의 전 라인이 검수 완료되면 같은 트랜잭션 안에서
   * `consumeShipment` 를 자동 발사해 출고를 전체 종결한다.
   */
  async inspectScan(
    shipmentId: string,
    barcode: string,
    quantity = 1,
    operatorId?: string,
    tx?: DbTx,
  ): Promise<void> {
    return this.db.run(async (trx) => {
      await this.loadOpenBox(trx, shipmentId, '검수');

      const skuId = await this.resolveSkuFromBarcode(barcode, trx);
      const lines = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          skuId: wmsTables.shipmentLines.skuId,
          qty: wmsTables.shipmentLines.qty,
          inspectedQty: wmsTables.shipmentLines.inspectedQty,
        })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
      // 같은 sku 라인 중 미완료(가장 덜 채워진) 우선.
      const target = lines
        .filter((l) => l.skuId === skuId)
        .sort((a, b) => a.inspectedQty - a.qty - (b.inspectedQty - b.qty))[0];
      if (!target) {
        throw new ConflictException(`박스 ${shipmentId} 에 sku ${skuId} 라인 없음`);
      }

      const next = Math.min(target.qty, target.inspectedQty + quantity);
      await trx
        .update(wmsTables.shipmentLines)
        .set({ inspectedQty: next })
        .where(eq(wmsTables.shipmentLines.id, target.id));
      this.logger.log(
        `검수 스캔 box=${shipmentId} sku=${skuId} → line ${target.id} inspectedQty=${next}/${target.qty} by ${operatorId ?? 'unknown'}`,
      );

      const fresh = lines.map((l) => (l.id === target.id ? { ...l, inspectedQty: next } : l));
      await this.maybeAutoComplete(trx, shipmentId, fresh);
    }, tx);
  }

  /**
   * 강제출고 — 자동완료 판정의 유일한 override.
   *
   * 박스를 잠그고 대상 라인(`foiId` 지정 시 그 라인, 미지정 시 전 라인)의 `inspectedQty` 를
   * qty 로 채우고 `forced=true` 로 마킹한다. 그 결과 박스 전 라인이 완료되면 `consumeShipment`
   * 로 종결한다(부분 강제 후 잔여 미완료가 있으면 종결하지 않음).
   */
  async forceShipment(shipmentId: string, foiId: string | undefined, operatorId?: string, tx?: DbTx): Promise<void> {
    return this.db.run(async (trx) => {
      await this.loadOpenBox(trx, shipmentId, '강제출고');

      const lines = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          foiId: wmsTables.shipmentLines.fulfillmentOrderItemId,
          qty: wmsTables.shipmentLines.qty,
          inspectedQty: wmsTables.shipmentLines.inspectedQty,
        })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
      const targets = foiId ? lines.filter((l) => l.foiId === foiId) : lines;
      if (targets.length === 0) {
        throw new ConflictException(`박스 ${shipmentId} 에 대상 라인 없음`);
      }
      this.logger.warn(`FORCED SHIPMENT box=${shipmentId} foi=${foiId ?? 'ALL'} by ${operatorId ?? 'unknown'}`);
      for (const t of targets) {
        await trx
          .update(wmsTables.shipmentLines)
          .set({ inspectedQty: t.qty, forced: true })
          .where(eq(wmsTables.shipmentLines.id, t.id));
      }
      const updated = lines.map((l) => (targets.some((t) => t.id === l.id) ? { ...l, inspectedQty: l.qty } : l));
      await this.maybeAutoComplete(trx, shipmentId, updated);
    }, tx);
  }

  /**
   * 박스를 `FOR UPDATE` 로 잠그고 open 상태인지 가드한다 (inspectScan/forceShipment 공용).
   * 없으면 NotFound, open 이 아니면 `${action} 불가` Conflict.
   */
  private async loadOpenBox(trx: DbTx, shipmentId: string, action: string): Promise<{ id: string; status: string }> {
    const [box] = await trx
      .select({ id: wmsTables.shipments.id, status: wmsTables.shipments.status })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .for('update')
      .limit(1);
    if (!box) {
      throw new NotFoundException(`Shipment ${shipmentId} not found`);
    }
    if (box.status !== 'open') {
      throw new ConflictException(`박스 ${shipmentId} 는 ${box.status} 상태 (${action} 불가)`);
    }
    return box;
  }

  /**
   * 박스 전 라인이 검수 완료(`inspectedQty >= qty`)면 같은 tx 안에서 `consumeShipment` 를
   * 자동 발사해 출고를 전체 종결한다 (inspectScan 의 `fresh`, forceShipment 의 `updated` 를 받음).
   */
  private async maybeAutoComplete(
    trx: DbTx,
    shipmentId: string,
    projectedLines: Array<{ qty: number; inspectedQty: number }>,
  ): Promise<void> {
    if (projectedLines.every((l) => l.inspectedQty >= l.qty)) {
      this.logger.log(`박스 ${shipmentId} 전 라인 검수완료 → consumeShipment 자동발사`);
      await this.outboundConsumption.consumeShipment(shipmentId, trx);
    }
  }

  private async resolveSkuFromBarcode(barcode: string, trx: DbTx): Promise<string> {
    const parsed = this.barcode.parseBarcode(barcode);
    if (parsed.type === 'sku') {
      return parsed.id;
    }
    if (parsed.type === 'unknown') {
      const [row] = await trx
        .select({ id: wmsTables.skus.id })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.code, parsed.id))
        .limit(1);
      if (!row) {
        throw new NotFoundException(`바코드 ${barcode} 에 해당하는 SKU 없음`);
      }
      return row.id;
    }
    throw new BadRequestException(`검수 스캔에 쓸 수 없는 바코드: ${barcode}`);
  }
}
