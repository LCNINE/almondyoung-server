import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { and, eq, gte, lte, isNull, or, desc, sql } from 'drizzle-orm';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto';
import { GetStockQueryDto } from './dto/get-stock-query.dto';
import { SkuService } from '../sku/sku.service';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

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


  //  새로운 재고 묶음(Stock Entry)을 생성
  //  SKU가 존재하지 않으면 자동으로 생성


  async createStockEntry(dto: CreateStockEntryDto, tx?: DbTx) {
    const db = tx || this.db;
    const { skuName, inventoryManagement, warehouseId, quantity, stockType, locationId, expiryDate, manufacturedAt, barcodeType, subBarcode, packingUnit, reason, orderId } = dto;

    // 1. SKU 조회 또는 생성
    let sku = await db.query.skus.findFirst({ where: eq(wmsTables.skus.name, skuName) });

    if (!sku) {
      this.logger.warn(`SKU with name '${skuName}' not found. Auto-creating SKU.`);
      // SKU 서비스의 내부 생성 메서드를 호출하여 SKU를 생성
      sku = await this.skuService._createSkuInternal({
        name: skuName,
        inventoryManagement: inventoryManagement ?? true,
      }, db);
    } else {
      if (!sku.inventoryManagement) {
        throw new BadRequestException(`기존 SKU ${sku.id}는 재고 관리 대상이 아닙니다.`);
      }
    }

    // 2. 초기 수량 유효성 검사
    if (quantity < 0) {
      throw new BadRequestException('초기 재고 항목 수량은 음수일 수 없습니다.');
    }

    // 3. 재고 생성 로직
    const execution = async (executor: DbTx) => {
      // 3-1. 재고 이벤트(stock_events) 레코드 생성
      if (!sku) {
        throw new Error('SKU 정보가 없습니다. 재고 이벤트 생성에 실패했습니다.');
      }
      const [creatingEvent] = await executor.insert(wmsTables.stockEvents).values({
        skuId: sku.id,
        warehouseId,
        locationId,
        eventType: 'IN',
        quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
        orderId,
        reason: reason || 'initial_stock_creation',
      }).returning();
      if (!creatingEvent) throw new Error('재고 생성 이벤트 생성에 실패했습니다.');

      // 3-2. 새로운 재고(stocks) 레코드 생성
      if (!sku) {
        throw new Error('SKU 정보가 없습니다. 재고 생성에 실패했습니다.');
      }
      const [newStock] = await executor.insert(wmsTables.stocks).values({
        skuId: sku.id, warehouseId, locationId, stockType, realQuantity: quantity,
        reservedQuantity: 0, availableQuantity: quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
        barcodeType, subBarcode, packingUnit, creatorEventId: creatingEvent.id,
      }).returning();
      if (!newStock) throw new Error('새 재고 항목 생성에 실패했습니다.');

      // 3-3. 생성된 재고 ID를 재고 이벤트에 다시 연결
      await executor.update(wmsTables.stockEvents)
        .set({ createsStockRowId: newStock.id, stockId: newStock.id })
        .where(eq(wmsTables.stockEvents.id, creatingEvent.id));

      // 3-4. 선판매 가능(preStockSellable) 상태 업데이트
      // SKU가 선판매 가능 상태이고, 이번 입고 수량이 0보다 클 때만 상태를 false로 변경
      if (sku.preStockSellable && quantity > 0) {
        await this.skuService._updatePreStockSellableInternal(sku.id, false, executor);
      }

      this.logger.log(`새 재고 항목 생성됨: ${newStock.id} for SKU ${sku.id}, 수량: ${quantity}.`);
      return newStock;
    };

    // 4. 트랜잭션 실행
    if (tx) {
      return execution(tx);
    } else {
      return this.db.transaction(execution);
    }
  }


  //  특정 재고 수량 조정


  async adjustStockQuantity(stockId: string, delta: number, reason: string, orderId?: string) {
    if (delta === 0) {
      this.logger.log(`재고 조정 ${stockId}에 대한 델타가 0입니다. 변경사항이 적용되지 않았습니다.`);
      return; // 변경 수량이 0이면 아무 작업도 하지 않음
    }
    if (!reason) {
      throw new BadRequestException('조정 사유가 필요합니다.');
    }

    return this.db.transaction(async (tx) => {
      // 1. 현재 활성 상태인 재고 레코드 조회
      const currentStock = await tx.query.stocks.findFirst({
        where: and(
          eq(wmsTables.stocks.id, stockId),
          isNull(wmsTables.stocks.destroyerEventId) // 만료되지 않은 레코드만 조회
        ),
      });

      if (!currentStock) {
        throw new NotFoundException(`ID ${stockId}의 활성 재고 항목을 찾을 수 없습니다.`);
      }

      // 2. SKU 유효성 검사
      const sku = await this.skuService.findSkuById(currentStock.skuId);
      if (!sku || !sku.inventoryManagement) {
        throw new BadRequestException(`SKU ${currentStock.skuId}가 물리적 재고 관리로 구성되지 않았습니다.`);
      }
      if (currentStock.stockType === 'infinite' && delta < 0) {
        throw new BadRequestException(`무한 재고 ID ${stockId}를 감소시킬 수 없습니다.`);
      }

      // 3. 조정 후 수량 계산 및 유효성 검사
      const newRealQuantity = currentStock.realQuantity + delta;
      if (newRealQuantity < 0) {
        throw new BadRequestException(`조정으로 인해 재고 ID ${stockId}의 실제 수량이 음수가 됩니다.`);
      }

      // 4. 재고 조정 이벤트 생성 (기존 레코드를 만료시키는 이벤트)
      const eventType = delta > 0 ? 'IN' : 'OUT';
      const [adjustingEvent] = await tx.insert(wmsTables.stockEvents).values({
        stockId: currentStock.id, skuId: currentStock.skuId, warehouseId: currentStock.warehouseId,
        locationId: currentStock.locationId, eventType: eventType, quantity: delta,
        expiryDate: currentStock.expiryDate, manufacturedAt: currentStock.manufacturedAt,
        orderId: orderId, reason: reason, expiresStockRowId: currentStock.id,
      }).returning();
      if (!adjustingEvent) throw new Error('재고 조정 이벤트 생성에 실패했습니다.');

      // 5. 기존 재고 레코드 만료 처리
      await tx.update(wmsTables.stocks)
        .set({ destroyerEventId: adjustingEvent.id })
        .where(eq(wmsTables.stocks.id, stockId));
      this.logger.debug(`이전 재고 항목 ${currentStock.id}가 조정으로 인해 만료되었습니다.`);

      // 6. 조정된 수량으로 새로운 재고 레코드 생성
      const newAvailableQuantity = this.calculateAvailableQuantity(newRealQuantity, currentStock.reservedQuantity);
      const [newStock] = await tx.insert(wmsTables.stocks).values({
        ...currentStock,
        id: undefined, // DB가 새로운 UUID를 생성하도록 id를 제거
        creatorEventId: adjustingEvent.id,
        destroyerEventId: null, // 새로운 레코드는 만료되지 않음
        realQuantity: newRealQuantity,
        availableQuantity: newAvailableQuantity,
      }).returning();
      if (!newStock) throw new Error('조정된 수량으로 새 재고 항목 생성에 실패했습니다.');
      this.logger.log(`조정된 수량으로 새 재고 항목 ${newStock.id} 생성됨: ${newRealQuantity}`);

      // 7. 조정 이벤트에 새로 생성된 재고 ID를 연결
      await tx.update(wmsTables.stockEvents)
        .set({ createsStockRowId: newStock.id, stockId: newStock.id })
        .where(eq(wmsTables.stockEvents.id, adjustingEvent.id));

      // 8. 선판매 가능(preStockSellable) 상태 업데이트
      // SKU가 선판매 가능 상태이고, 재고가 '증가'했으며, 결과 수량이 0보다 클 때 false로 변경
      if (sku.preStockSellable && delta > 0 && newRealQuantity > 0) {
        await this.skuService._updatePreStockSellableInternal(sku.id, false, tx);
      }

      return newStock;
    });
  }


  //  현재 or 특정 시점 재고 상태를 조회

  async getCurrentStock(query: GetStockQueryDto) {
    const { skuId, warehouseId, locationId, stockType, asOfTimestamp } = query;

    const stocks = await this.db.query.stocks.findMany({
      where: (s, { and, eq, isNull }) => and(
        skuId ? eq(s.skuId, skuId) : undefined,
        warehouseId ? eq(s.warehouseId, warehouseId) : undefined,
        locationId ? eq(s.locationId, locationId) : undefined,
        stockType ? eq(s.stockType, stockType) : undefined,
        isNull(s.destroyerEventId) // 만료되지 않은 활성 재고만 조회
      ),
      orderBy: (s, { asc }) => [asc(s.skuId), asc(s.warehouseId), asc(s.locationId), asc(s.creatorEventId)],
    });

    // 조회된 재고들을 SKU, 창고, 위치, 유통기한별로
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
        creatorEventId: stock.creatorEventId,
        subBarcode: stock.subBarcode,
        packingUnit: stock.packingUnit,
      });
      return acc;
    }, {});

    return Object.values(aggregatedStock);
  }


  //  특정 SKU의 재고 변경 이력(원장)을 조회

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