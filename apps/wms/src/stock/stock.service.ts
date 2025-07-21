// apps/wms/src/stock/stock.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, gte, lte, isNull, or, desc, sql } from 'drizzle-orm';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto';
import { GetStockQueryDto } from './dto/get-stock-query.dto';
import { CreateInboundDto } from './dto/create-inbound.dto';
import { SkuService } from '../sku/sku.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { SkuCreationSource } from '../sku/dto/create-sku.dto';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
  ) { }

  private get db() {
    return this.dbService.db;
  }

  private calculateAvailableQuantity(realQuantity: number, reservedQuantity: number): number {
    return realQuantity - reservedQuantity;
  }

  // stock Entry생성
  async createStockEntry(dto: CreateStockEntryDto, tx?: DbTx) {
    const db = tx || this.db;
    const {
      variantId,
      skuName,
      inventoryManagement,
      warehouseId,
      quantity,
      stockType,
      locationId,
      expiryDate,
      manufacturedAt,
      barcodeType,
      subBarcode,
      packingUnit,
      reason,
      orderId
    } = dto;

    // 1. SKU 조회 또는 생성
    let sku = await db.query.skus.findFirst({ where: eq(wmsTables.skus.name, skuName) });

    if (!sku) {
      this.logger.warn(`SKU with name '${skuName}' not found. Auto-creating SKU.`);

      const creationSource = variantId
        ? SkuCreationSource.AUTO_MATCHING
        : SkuCreationSource.MANUAL_ENTRY;

      sku = await this.skuService._createSkuInternal({
        name: skuName,
        inventoryManagement: inventoryManagement ?? true,
        source: creationSource,
      }, db);
    } else {
      if (!sku.inventoryManagement) {
        throw new BadRequestException(`기존 SKU ${sku.id}는 재고 관리 대상이 아닙니다.`);
      }
    }

    if (quantity < 0) {
      throw new BadRequestException('초기 재고 항목 수량은 음수일 수 없습니다.');
    }

    // 재고 생성
    const execution = async (executor: DbTx) => {
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
        reason: reason || `initial_stock_creation${variantId ? `_for_variant_${variantId}` : ''}`,
      }).returning();
      if (!creatingEvent) throw new Error('재고 생성 이벤트 생성에 실패했습니다.');

      if (!sku) {
        throw new Error('SKU 정보가 없습니다. 재고 생성에 실패했습니다.');
      }
      const [newStock] = await executor.insert(wmsTables.stocks).values({
        skuId: sku.id,
        warehouseId,
        locationId,
        stockType,
        realQuantity: quantity,
        reservedQuantity: 0,
        availableQuantity: quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
        barcodeType,
        subBarcode,
        packingUnit,
        creatorEventId: creatingEvent.id,
      }).returning();
      if (!newStock) throw new Error('새 재고 항목 생성에 실패했습니다.');

      await executor.update(wmsTables.stockEvents)
        .set({ createsStockRowId: newStock.id, stockId: newStock.id })
        .where(eq(wmsTables.stockEvents.id, creatingEvent.id));

      // 선판매 가능(preStockSellable) 상태 업데이트
      // SKU가 선판매 가능 상태이고, 이번 입고 수량이 0보다 클 때만 상태를 false로 변경
      if (sku.preStockSellable && quantity > 0) {
        await this.skuService._updatePreStockSellableInternal(sku.id, false, executor);
      }

      this.logger.log(`새 재고 항목 생성됨: ${newStock.id} for SKU ${sku.id}, 수량: ${quantity}.`);

      return { ...newStock, variantId };
    };

    if (tx) {
      return execution(tx);
    } else {
      return this.db.transaction(execution);
    }
  }

  // 거래처로부터의 입고 처리
  async processInbound(dto: CreateInboundDto) {
    const { skuId, quantity, supplierType, warehouseId, locationId, expiryDate, manufacturedAt, reason, purchaseOrderId } = dto;

    const sku = await this.skuService.findSkuById(skuId);
    if (!sku) {
      throw new NotFoundException(`SKU ${skuId}를 찾을 수 없습니다.`);
    }

    if (!sku.inventoryManagement) {
      throw new BadRequestException(`SKU ${skuId}는 재고 관리 대상이 아닙니다.`);
    }

    return this.db.transaction(async (tx) => {
      // 창고 결정
      const targetWarehouseId = warehouseId || this.warehouseService.getDefaultWarehouseIdByType(supplierType);

      // 입고 이벤트 생성
      const eventType = supplierType === 'overseas' ? 'IN_OVERSEAS' : 'IN_DOMESTIC';
      const [inboundEvent] = await tx.insert(wmsTables.stockEvents).values({
        skuId,
        warehouseId: targetWarehouseId,
        locationId,
        eventType,
        quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
        orderId: purchaseOrderId,
        reason: `${supplierType} 거래처 입고 - ${reason}`,
      }).returning();

      // 새 재고 생성
      const [newStock] = await tx.insert(wmsTables.stocks).values({
        skuId,
        warehouseId: targetWarehouseId,
        locationId,
        stockType: 'physical',
        realQuantity: quantity,
        reservedQuantity: 0,
        availableQuantity: quantity,
        creatorEventId: inboundEvent.id,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null,
      }).returning();

      await tx.update(wmsTables.stockEvents)
        .set({ createsStockRowId: newStock.id, stockId: newStock.id })
        .where(eq(wmsTables.stockEvents.id, inboundEvent.id));

      // preStockSellable 상태 업데이트
      if (sku.preStockSellable && quantity > 0) {
        await this.skuService._updatePreStockSellableInternal(sku.id, false, tx);
      }

      this.logger.log(
        `입고 처리 완료: SKU ${sku.name}, 수량 ${quantity}, ` +
        `창고 ${targetWarehouseId}, 거래처 유형 ${supplierType}`
      );

      return newStock;
    });
  }

  // 출고 처리
  async processOutbound(stockId: string, quantity: number, reason: string, orderId?: string) {
    if (quantity <= 0) {
      throw new BadRequestException('출고 수량은 0보다 커야 합니다.');
    }

    return this.db.transaction(async (tx) => {
      // 현재 재고 확인
      const currentStock = await tx.query.stocks.findFirst({
        where: and(
          eq(wmsTables.stocks.id, stockId),
          isNull(wmsTables.stocks.destroyerEventId)
        ),
      });

      if (!currentStock) {
        throw new NotFoundException(`활성 재고 ${stockId}를 찾을 수 없습니다.`);
      }

      // 가용 재고 확인
      if (currentStock.availableQuantity < quantity) {
        throw new BadRequestException(
          `가용 재고(${currentStock.availableQuantity})가 출고 수량(${quantity})보다 적습니다.`
        );
      }

      // 출고 이벤트 생성
      const [outboundEvent] = await tx.insert(wmsTables.stockEvents).values({
        stockId: currentStock.id,
        skuId: currentStock.skuId,
        warehouseId: currentStock.warehouseId,
        locationId: currentStock.locationId,
        eventType: 'OUT_ORDER',
        quantity: -quantity,
        orderId,
        reason: `출고 - ${reason}`,
        expiresStockRowId: currentStock.id,
      }).returning();

      // 기존 재고 만료
      await tx.update(wmsTables.stocks)
        .set({ destroyerEventId: outboundEvent.id })
        .where(eq(wmsTables.stocks.id, stockId));

      // 남은 수량이 있으면 새 재고 생성
      const remainingQuantity = currentStock.realQuantity - quantity;
      if (remainingQuantity > 0) {
        const [newStock] = await tx.insert(wmsTables.stocks).values({
          ...currentStock,
          id: undefined,
          creatorEventId: outboundEvent.id,
          destroyerEventId: null,
          realQuantity: remainingQuantity,
          availableQuantity: currentStock.availableQuantity - quantity,
        }).returning();

        await tx.update(wmsTables.stockEvents)
          .set({ createsStockRowId: newStock.id })
          .where(eq(wmsTables.stockEvents.id, outboundEvent.id));

        this.logger.log(`출고 후 남은 재고: ${remainingQuantity}`);
      }

      this.logger.log(
        `출고 처리 완료: Stock ${stockId}, SKU ${currentStock.skuId}, ` +
        `수량 ${quantity}, 창고 ${currentStock.warehouseId}`
      );

      return {
        processedQuantity: quantity,
        remainingQuantity,
        orderId,
      };
    });
  }

  // 관리자 수동 조정
  async adjustStockManually(stockId: string, delta: number, reason: string) {
    if (delta === 0) {
      this.logger.log(`재고 조정 ${stockId}에 대한 델타가 0입니다. 변경사항이 적용되지 않았습니다.`);
      return;
    }

    return this.db.transaction(async (tx) => {
      // 현재 활성 상태인 재고 레코드 조회
      const currentStock = await tx.query.stocks.findFirst({
        where: and(
          eq(wmsTables.stocks.id, stockId),
          isNull(wmsTables.stocks.destroyerEventId)
        ),
      });

      if (!currentStock) {
        throw new NotFoundException(`ID ${stockId}의 활성 재고 항목을 찾을 수 없습니다.`);
      }

      const sku = await this.skuService.findSkuById(currentStock.skuId, tx);
      if (!sku || !sku.inventoryManagement) {
        throw new BadRequestException(`SKU ${currentStock.skuId}가 물리적 재고 관리로 구성되지 않았습니다.`);
      }

      // 조정 후 수량 계산
      const newRealQuantity = currentStock.realQuantity + delta;
      if (newRealQuantity < 0) {
        throw new BadRequestException(`조정으로 인해 재고 ID ${stockId}의 실제 수량이 음수가 됩니다.`);
      }

      // 재고 조정 이벤트 생성
      const eventType = 'ADJUST_MANUAL';
      const [adjustingEvent] = await tx.insert(wmsTables.stockEvents).values({
        stockId: currentStock.id,
        skuId: currentStock.skuId,
        warehouseId: currentStock.warehouseId,
        locationId: currentStock.locationId,
        eventType: eventType,
        quantity: delta,
        expiryDate: currentStock.expiryDate,
        manufacturedAt: currentStock.manufacturedAt,
        reason: `관리자 수동 조정 - ${reason}`,
        expiresStockRowId: currentStock.id,
      }).returning();

      // 기존 재고 레코드 만료 처리
      await tx.update(wmsTables.stocks)
        .set({ destroyerEventId: adjustingEvent.id })
        .where(eq(wmsTables.stocks.id, stockId));

      // 조정된 수량으로 새로운 재고 레코드 생성
      const newAvailableQuantity = this.calculateAvailableQuantity(newRealQuantity, currentStock.reservedQuantity);
      const [newStock] = await tx.insert(wmsTables.stocks).values({
        ...currentStock,
        id: undefined,
        creatorEventId: adjustingEvent.id,
        destroyerEventId: null,
        realQuantity: newRealQuantity,
        availableQuantity: newAvailableQuantity,
      }).returning();

      // 조정 이벤트에 새로 생성된 재고 ID를 연결
      await tx.update(wmsTables.stockEvents)
        .set({ createsStockRowId: newStock.id, stockId: newStock.id })
        .where(eq(wmsTables.stockEvents.id, adjustingEvent.id));

      // 선판매 가능(preStockSellable) 상태 업데이트
      if (sku.preStockSellable && delta > 0 && newRealQuantity > 0) {
        await this.skuService._updatePreStockSellableInternal(sku.id, false, tx);
      }

      this.logger.log(`관리자 수동 조정 완료: 재고 ${stockId}, 델타 ${delta}, 새 수량 ${newRealQuantity}`);
      return newStock;
    });
  }

  //  현재 or 특정 시점 재고 상태 조회
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

    // 조회된 재고들을 SKU, 창고, 위치, 유통기한별로 집계
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
    }, {} as Record<string, any>);

    return Object.values(aggregatedStock);
  }

  //  특정 SKU의 재고 변경 이력 조회
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

  async adjustStockQuantity(stockId: string, delta: number, reason: string, orderId?: string) {
    return this.adjustStockManually(stockId, delta, reason);
  }

  // SKU별 총 재고 조회 (모든 창고의 합계)
  async getTotalStockBySku(skuId: string): Promise<{
    skuId: string;
    totalRealQuantity: number;
    totalReservedQuantity: number;
    totalAvailableQuantity: number;
  }> {
    const stocks = await this.db.query.stocks.findMany({
      where: and(
        eq(wmsTables.stocks.skuId, skuId),
        isNull(wmsTables.stocks.destroyerEventId)
      ),
    });

    const total = stocks.reduce(
      (acc, stock) => ({
        totalRealQuantity: acc.totalRealQuantity + stock.realQuantity,
        totalReservedQuantity: acc.totalReservedQuantity + stock.reservedQuantity,
        totalAvailableQuantity: acc.totalAvailableQuantity + stock.availableQuantity,
      }),
      { totalRealQuantity: 0, totalReservedQuantity: 0, totalAvailableQuantity: 0 }
    );

    return {
      skuId,
      totalRealQuantity: total.totalRealQuantity,
      totalReservedQuantity: total.totalReservedQuantity,
      totalAvailableQuantity: total.totalAvailableQuantity,
    };
  }

  // 특정 창고의 SKU별 재고 조회
  async getStockBySkuAndWarehouse(skuId: string, warehouseId: string) {
    return this.db.query.stocks.findMany({
      where: and(
        eq(wmsTables.stocks.skuId, skuId),
        eq(wmsTables.stocks.warehouseId, warehouseId),
        isNull(wmsTables.stocks.destroyerEventId)
      ),
      with: {
        location: true,
      },
      orderBy: (stocks, { asc }) => [
        asc(stocks.expiryDate),
        asc(stocks.creatorEventId),
      ],
    });
  }
}