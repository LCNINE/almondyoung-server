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
    const { skuId, warehouseId, quantity, stockType, locationId, expiryDate, manufacturedAt, barcodeType, subBarcode, packingUnit, reason, orderId } = dto;

    let sku = await this.skuService.findSkuById(skuId);
    if (!sku) {
      this.logger.warn(`SKU ${skuId} not found. Auto-creating SKU record for stock entry.`);
      sku = await this.skuService._createSkuInternal({
        id: skuId,
        code: skuId, // 자동 생성된 SKU의 코드로 skuId 사용
        name: `TEMP SKU (${skuId})`, // 임시 이름
        defaultBarcode: `TEMP_${skuId}`, // 임시 바코드
        inventoryManagement: true, // 재고 항목 생성 시 물리적 재고 관리를 위해 true로 설정
      });
    } else {
      // 이미 SKU가 있지만 inventoryManagement이 false라면, 물리 재고 생성 불가
      if (!sku.inventoryManagement && stockType === 'physical') {
        throw new BadRequestException(`SKU ${skuId} is not configured for physical inventory management. Cannot create physical stock entry.`);
      }
    }

    // 재고 항목 수량 검증: 0개 재고 생성은 허용 (선판매 목적), 음수는 불가
    if (quantity < 0) {
      throw new BadRequestException('초기 재고 항목 수량은 음수일 수 없습니다.');
    }

    return this.db.transaction(async (tx) => {
      // 1. stock_events 레코드 먼저 생성 (createsStockRowId에 연결될 이벤트 ID)
      const [creatingEvent] = await tx.insert(wmsTables.stockEvents).values({
        skuId,
        warehouseId,
        locationId,
        eventType: 'IN',
        quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
        orderId,
        reason: reason || 'initial_entry',
      }).returning();

      if (!creatingEvent) {
        throw new Error('재고 생성 이벤트 생성에 실패했습니다.');
      }

      // 2. 새로운 stocks 레코드 생성 (UUID V7 사용)
      const [newStock] = await tx.insert(wmsTables.stocks).values({
        skuId,
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
        creatorEventId: creatingEvent.id, // 생성 이벤트 ID 연결
      }).returning();

      if (!newStock) {
        throw new Error('새 재고 항목 생성에 실패했습니다.');
      }

      // 참고: createsStockRowId 컬럼이 스키마에 존재하지 않아 이 업데이트를 제거함
      // await tx.update(wmsTables.stockEvents)
      //   .set({ createsStockRowId: newStock.id })
      //   .where(eq(wmsTables.stockEvents.id, creatingEvent.id));

      this.logger.log(`새 재고 항목 생성됨: ${newStock.id} for SKU ${skuId}, 수량: ${quantity}`);
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
      // 1. 기존 stocks 레코드 조회
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
        throw new BadRequestException(`SKU ${currentStock.skuId}가 물리적 재고 관리로 구성되지 않았습니다. 재고를 조정할 수 없습니다.`);
      }
      if (currentStock.stockType === 'infinite' && delta < 0) {
        throw new BadRequestException(`무한 재고 ID ${stockId}를 감소시킬 수 없습니다.`);
      }
      if (currentStock.realQuantity + delta < 0) {
        throw new BadRequestException(`조정으로 인해 재고 ID ${stockId}의 실제 수량이 음수가 됩니다. 현재: ${currentStock.realQuantity}, 델타: ${delta}`);
      }

      // 3. stock_events 레코드 먼저 생성 (이전 row를 만료시킬 이벤트)
      let eventType: 'IN' | 'OUT' | 'ADJUST';
      if (delta > 0) eventType = 'IN'; // 증가 조정
      else if (delta < 0) eventType = 'OUT'; // 감소 조정
      else eventType = 'ADJUST'; // 델타가 0이면서 호출된 경우 (예: 메타데이터만 변경 시)

      const [adjustingEvent] = await tx.insert(wmsTables.stockEvents).values({
        skuId: currentStock.skuId,
        warehouseId: currentStock.warehouseId,
        locationId: currentStock.locationId,
        eventType: eventType,
        quantity: delta,
        expiryDate: currentStock.expiryDate,
        manufacturedAt: currentStock.manufacturedAt,
        orderId: orderId,
        reason: reason,
      }).returning();

      if (!adjustingEvent) {
        throw new Error('재고 조정 이벤트 생성에 실패했습니다.');
      }

      // 4. 기존 stocks 레코드 만료 처리
      const [expiredStock] = await tx.update(wmsTables.stocks)
        .set({ expiredAt: new Date(), destroyerEventId: adjustingEvent.id }) // destroyerEventId 연결
        .where(eq(wmsTables.stocks.id, stockId))
        .returning();

      if (!expiredStock) {
        throw new Error('이전 재고 항목 만료에 실패했습니다.');
      }
      this.logger.debug(`이전 재고 항목 ${expiredStock.id}가 조정으로 인해 만료되었습니다.`);


      // 5. 새로운 stocks 레코드 생성 (조정된 수량 반영)
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
      // await tx.update(wmsTables.stockEvents)
      //   .set({ createsStockRowId: newStock.id, stockId: newStock.id }) // 이벤트의 stockId도 새 row로 업데이트
      //   .where(eq(wmsTables.stockEvents.id, adjustingEvent.id));

      // 7. 재고 변경 이벤트 발행
      // await this.eventPublisher.publishEvent('stock.updated', {
      //   skuId: newStock.skuId,
      //   warehouseId: newStock.warehouseId,
      //   realQuantity: newStock.realQuantity,
      //   reservedQuantity: newStock.reservedQuantity,
      //   availableQuantity: newStock.availableQuantity,
      //   expiryDate: newStock.expiryDate?.toISOString(),
      //   locationId: newStock.locationId,
      //   triggeringEventId: adjustingEvent.id,
      // });

      return newStock;
    });
  }



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