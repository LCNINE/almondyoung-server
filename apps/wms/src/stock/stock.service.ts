import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { and, eq, gte, lte, isNull, or, desc, sql } from 'drizzle-orm';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto';
import { GetStockQueryDto } from './dto/get-stock-query.dto';
import { SkuService } from '../sku/sku.service';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly db: TypedDatabase<typeof wmsTables>,
    private readonly skuService: SkuService,
  ) { }

  private calculateAvailableQuantity(realQuantity: number, reservedQuantity: number): number {
    return realQuantity - reservedQuantity;
  }

  async createStockEntry(dto: CreateStockEntryDto) {
    const { variantId, skuName, warehouseId, quantity, stockType, locationId, expiryDate, manufacturedAt, barcodeType, subBarcode, packingUnit, reason, orderId } = dto;

    // todo : pim에서 자동매칭시 프로덕트 매칭이 되기 전에 inventoryManagement의 값을 확인해야함.

    // 1. WMS 내부 `SKU` 레코드를 찾거나 생성 (`stock`이 생길 때 `sku`가 생긴다!)
    // `variantId`는 PIM의 개념이며, WMS 내부 `SKU`는 `skus.id`로 식별
    let sku = await this.db.query.skus.findFirst({ where: eq(wmsTables.skus.name, skuName) }); // 이름으로 SKU를 찾거나

    if (!sku) {
      // `name`은 `dto.skuName`에서 받고, `inventoryManagement`는 `true`로 설정합니다.
      this.logger.warn(`SKU with name '${skuName}' not found in WMS. Auto-creating SKU record for stock entry.`);

      sku = await this.skuService._createSkuInternal({
        name: skuName,
        inventoryManagement: true,
      });
      // `productMatching`과의 연결 (productVariantSkuLinks)은 `ProductMatchingService`의 책임
      // `product_matchings`의 `isResolved`, `preStockSellable` 업데이트도 `ProductMatchingService`의 책임

    } else {
      // `inventoryManagement`가 `true`인지 다시 한번 확인
      if (!sku.inventoryManagement) {
        this.logger.error(`기존 SKU ${sku.id} (이름: ${sku.name})는 재고 관리 대상이 아닙니다. 재고 항목 생성이 시도되었습니다. 데이터 불일치.`);
        throw new BadRequestException(`기존 SKU ${sku.id}는 재고 관리 대상이 아닙니다.`);
      }
    }

    // 3. 재고 항목 수량 검증: 0개 재고 생성은 허용 (선판매 목적), 음수는 불가
    if (quantity < 0) {
      throw new BadRequestException('초기 재고 항목 수량은 음수일 수 없습니다.');
    }

    // `stocks` 로우 생성 및 이벤트 발행 로직
    return this.db.transaction(async (tx) => {
      // 4. `stock_events` 레코드 먼저 생성 (`createsStockRowId`에 연결될 이벤트 ID)
      const [creatingEvent] = await tx.insert(wmsTables.stockEvents).values({
        skuId: sku.id,
        warehouseId,
        locationId,
        eventType: 'IN', // '판매등록' 시점의 초기 재고 생성도 'IN' 이벤트로 기록
        quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
        orderId,
        reason: reason || 'sales_registration_initial_stock',
      }).returning();

      if (!creatingEvent) {
        throw new Error('재고 생성 이벤트 생성에 실패했습니다.');
      }

      // 5. 새로운 `stocks` 레코드 생성 
      const [newStock] = await tx.insert(wmsTables.stocks).values({
        skuId: sku.id,
        warehouseId,
        locationId,
        stockType,
        realQuantity: quantity,
        reservedQuantity: 0, // 초기 생성 시 예약 재고는 0
        availableQuantity: quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
        barcodeType,
        subBarcode,
        packingUnit,
        creatorEventId: creatingEvent.id,
      }).returning();

      if (!newStock) {
        throw new Error('새 재고 항목 생성에 실패했습니다.');
      }

      // 6. 생성 이벤트에 `stocks.id` 연결
      await tx.update(wmsTables.stockEvents)
        .set({ createsStockRowId: newStock.id })
        .where(eq(wmsTables.stockEvents.id, creatingEvent.id));

      // 7. 재고 변경 이벤트 발행

      // 8. `preStockSellable` 플래그를 `false`로 전환 (SKU 자체의 플래그)
      // `SKU`가 `inventoryManagement=true` 이고 `preStockSellable=true`인 경우에만 전환
      // 첫 입고 트랜잭션에서만 발생
      if (sku.inventoryManagement && sku.preStockSellable) {
        await this.skuService._updatePreStockSellableInternal(sku.id, false);
      }

      this.logger.log(`새 재고 항목 생성됨: ${newStock.id} for SKU ${sku.id} (name: ${sku.name}), 수량: ${quantity}. PIM 판매등록에 따른 초기 재고.`);
      return newStock;
    });
  }

  async adjustStockQuantity(stockId: string, delta: number, reason: string, orderId?: string) {
    if (delta === 0) {
      this.logger.log(`재고 조정 ${stockId}에 대한 델타가 0입니다. 변경사항이 적용되지 않았습니다.`);
      return;
    }
    if (!reason) {
      throw new BadRequestException('조정 사유가 필요합니다.');
    }

    return this.db.transaction(async (tx) => {
      // 1. 기존 `stocks` 레코드 조회
      const currentStock = await tx.query.stocks.findFirst({
        where: and(
          eq(wmsTables.stocks.id, stockId),
          isNull(wmsTables.stocks.expiredAt) // 만료되지 않은 활성 재고만 조회
        ),
      });

      if (!currentStock) {
        throw new NotFoundException(`ID ${stockId}의 활성 재고 항목을 찾을 수 없습니다.`);
      }

      // 2. 재고 유형 및 관리 여부 검증
      const sku = await this.skuService.findSkuById(currentStock.skuId);
      if (!sku || !sku.inventoryManagement) {
        this.logger.error(`재고 ${stockId}에 연결된 SKU ${currentStock.skuId}가 물리적 재고 관리로 구성되지 않았습니다. 데이터 불일치.`);
        throw new BadRequestException(`SKU ${currentStock.skuId}가 물리적 재고 관리로 구성되지 않았습니다. 재고를 조정할 수 없습니다.`);
      }
      if (currentStock.stockType === 'infinite' && delta < 0) {
        throw new BadRequestException(`무한 재고 ID ${stockId}를 감소시킬 수 없습니다.`);
      }
      if (currentStock.realQuantity + delta < 0) {
        throw new BadRequestException(`조정으로 인해 재고 ID ${stockId}의 실제 수량이 음수가 됩니다. 현재: ${currentStock.realQuantity}, 델타: ${delta}`);
      }

      // 3. `stock_events` 레코드 먼저 생성 (이전 row를 만료시킬 이벤트)
      // eventTypeEnum이 wmsTables에 직접 없으므로, 별도로 enum을 정의하거나 import해야 함
      // export const eventTypeEnum = pgEnum('event_type', ['IN', 'OUT', 'ADJUST', 'MOVE', 'RESERVE', 'CONFIRM', 'RELEASE', 'CANCEL']);
      // todo : 이벤트 타입 추가
      type EventType = 'IN' | 'OUT' | 'ADJUST';
      let eventType: EventType;
      if (delta > 0) eventType = 'IN';
      else if (delta < 0) eventType = 'OUT';
      else eventType = 'ADJUST'; // 델타가 0이면서 호출된 경우

      const [adjustingEvent] = await tx.insert(wmsTables.stockEvents).values({
        stockId: currentStock.id,
        skuId: currentStock.skuId,
        warehouseId: currentStock.warehouseId,
        locationId: currentStock.locationId,
        eventType: eventType,
        quantity: delta,
        expiryDate: currentStock.expiryDate,
        manufacturedAt: currentStock.manufacturedAt,
        orderId: orderId,
        reason: reason,
        expiresStockRowId: currentStock.id, // 이전 stocks row를 만료시킴
      }).returning();

      if (!adjustingEvent) {
        throw new Error('재고 조정 이벤트 생성에 실패했습니다.');
      }

      // 4. 기존 `stocks` 레코드 만료 처리
      const [expiredStock] = await tx.update(wmsTables.stocks)
        .set({ destroyerEventId: adjustingEvent.id }) // destroyerEventId 연결
        .where(eq(wmsTables.stocks.id, stockId))
        .returning();

      if (!expiredStock) {
        throw new Error('이전 재고 항목 만료에 실패했습니다.');
      }
      this.logger.debug(`이전 재고 항목 ${expiredStock.id}가 조정으로 인해 만료되었습니다.`);


      // 5. 새로운 `stocks` 레코드 생성 (조정된 수량 반영)
      const newRealQuantity = currentStock.realQuantity + delta;
      const newAvailableQuantity = this.calculateAvailableQuantity(newRealQuantity, currentStock.reservedQuantity);

      const [newStock] = await tx.insert(wmsTables.stocks).values({
        skuId: currentStock.skuId,
        warehouseId: currentStock.warehouseId,
        locationId: currentStock.locationId,
        stockType: currentStock.stockType,
        realQuantity: newRealQuantity,
        reservedQuantity: currentStock.reservedQuantity, // 예약 재고는 그대로 유지
        availableQuantity: newAvailableQuantity,
        expiryDate: currentStock.expiryDate,
        manufacturedAt: currentStock.manufacturedAt,
        barcodeType: currentStock.barcodeType,
        subBarcode: currentStock.subBarcode,
        packingUnit: currentStock.packingUnit,
        creatorEventId: adjustingEvent.id, // 새 stocks row를 생성한 이벤트 ID 연결
      }).returning();

      if (!newStock) {
        throw new Error('조정된 수량으로 새 재고 항목 생성에 실패했습니다.');
      }
      this.logger.log(`조정된 수량으로 새 재고 항목 ${newStock.id} 생성됨: ${newRealQuantity}`);

      // 6. adjustingEvent에 새로 생성된 stocks.id 연결 (back-reference)
      await tx.update(wmsTables.stockEvents)
        .set({ createsStockRowId: newStock.id, stockId: newStock.id }) // 이벤트의 stockId도 새 row로 업데이트
        .where(eq(wmsTables.stockEvents.id, adjustingEvent.id));

      // 7. 재고 변경 이벤트 발행

      return newStock;
    });
  }


  // =========================================================================
  // Stock Query / Reporting
  // =========================================================================

  async getCurrentStock(query: GetStockQueryDto) {
    const { skuId, warehouseId, locationId, stockType, asOfTimestamp } = query;

    const queryTimestamp = asOfTimestamp ? new Date(asOfTimestamp) : new Date();

    const stocks = await this.db.query.stocks.findMany({
      where: (s, { and, eq, isNull, lte, or: drizzleOr, gte: drizzleGte }) => and(
        skuId ? eq(s.skuId, skuId) : undefined,
        warehouseId ? eq(s.warehouseId, warehouseId) : undefined,
        locationId ? eq(s.locationId, locationId) : undefined,
        stockType ? eq(s.stockType, stockType) : undefined,
        lte(s.createdAt, queryTimestamp),
        drizzleOr(isNull(s.expiredAt), gte(s.expiredAt, queryTimestamp)),
        sql`${s.realQuantity} > 0`,
      ),
      orderBy: (s, { asc }) => [asc(s.skuId), asc(s.warehouseId), asc(s.locationId), asc(s.createdAt)],
    });

    const aggregatedStock = stocks.reduce((acc, stock) => {
      const key = `${stock.skuId}-${stock.warehouseId}-${stock.locationId || 'null'}-${stock.expiryDate?.toISOString() || 'null'}`;
      if (!acc[key]) {
        acc[key] = {
          skuId: stock.skuId,
          warehouseId: stock.warehouseId,
          locationId: stock.locationId,
          expiryDate: stock.expiryDate?.toISOString(),
          stockType: stock.stockType,
          realQuantity: 0,
          reservedQuantity: 0,
          availableQuantity: 0,
          stockRows: [],
        };
      }
      acc[key].realQuantity += stock.realQuantity;
      acc[key].reservedQuantity += stock.reservedQuantity;
      acc[key].availableQuantity += stock.availableQuantity;
      acc[key].stockRows.push({
        id: stock.id,
        realQuantity: stock.realQuantity,
        reservedQuantity: stock.reservedQuantity,
        availableQuantity: stock.availableQuantity,
        createdAt: stock.createdAt.toISOString(),
        expiredAt: stock.expiredAt?.toISOString(),
        subBarcode: stock.subBarcode,
        packingUnit: stock.packingUnit,
      });
      return acc;
    }, {});

    return Object.values(aggregatedStock);
  }

  async getStockHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
    const history = await this.db.query.stockEvents.findMany({
      where: (event, { and, eq, gte, lte }) => and(
        eq(event.skuId, skuId),
        warehouseId ? eq(event.warehouseId, warehouseId) : undefined,
        startDate ? gte(event.eventTimestamp, new Date(startDate)) : undefined,
        endDate ? lte(event.eventTimestamp, new Date(new Date(endDate).setHours(23, 59, 59, 999))) : undefined,
      ),
      orderBy: (event, { asc }) => [asc(event.eventTimestamp)],
    });
    return history;
  }
}