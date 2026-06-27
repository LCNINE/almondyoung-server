import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq, and, gte, sql, desc, asc, sum } from 'drizzle-orm';

/**
 * 할당 전략 타입
 */
export type AllocationStrategy = 'FIFO' | 'LOCATION_PRIORITY' | 'MULTI_WAREHOUSE' | 'CLOSEST_EXPIRY';

/**
 * 할당 가능 위치 정보
 */
export interface AvailableLocation {
  warehouseId: string;
  warehouseName?: string;
  locationId: string;
  locationCode?: string;
  zone?: string;
  availableQuantity: number;
  updatedAt?: Date; // FIFO용 (stock ledger last update)
  expiryDate?: Date; // FEFO용
  priority?: number; // 위치 우선순위
}

/**
 * 할당 요청
 */
export interface AllocationRequest {
  skuId: string;
  requestedQuantity: number;
  warehouseId?: string; // 특정 창고 지정 (optional)
  preferredLocationIds?: string[]; // 선호 위치 (optional)
  strategy?: AllocationStrategy;
  allowPartial?: boolean; // 부분 할당 허용 여부
}

/**
 * 할당 결과
 */
export interface AllocationResult {
  skuId: string;
  totalAllocated: number;
  isPartial: boolean;
  allocations: Array<{
    warehouseId: string;
    locationId: string;
    quantity: number;
    locationCode?: string;
  }>;
  message?: string;
}

@Injectable()
export class AllocationStrategyService {
  private readonly logger = new Logger(AllocationStrategyService.name);

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 메인 할당 메소드 - 전략에 따라 최적의 위치 선택
   */
  async allocateStock(request: AllocationRequest, tx?: DbTx): Promise<AllocationResult> {
    return this.dbService.run(async (trx) => {
      const strategy = request.strategy || 'FIFO';

      this.logger.log(
        `Allocating ${request.requestedQuantity} units of SKU ${request.skuId} using ${strategy} strategy`,
      );

      // 1. 사용 가능한 위치 조회
      const availableLocations = await this.getAvailableLocations(request.skuId, request.warehouseId, trx);

      if (availableLocations.length === 0) {
        throw new ConflictException(`No available stock for SKU ${request.skuId}`);
      }

      // 2. 전략에 따라 위치 정렬
      const sortedLocations = this.sortLocationsByStrategy(availableLocations, strategy);

      // 3. 선호 위치가 있으면 우선 배치
      const prioritizedLocations = request.preferredLocationIds
        ? this.prioritizeLocations(sortedLocations, request.preferredLocationIds)
        : sortedLocations;

      // 4. 할당 수행
      const allocations: AllocationResult['allocations'] = [];
      let remaining = request.requestedQuantity;

      for (const location of prioritizedLocations) {
        if (remaining <= 0) break;

        const allocateQty = Math.min(location.availableQuantity, remaining);

        allocations.push({
          warehouseId: location.warehouseId,
          locationId: location.locationId,
          quantity: allocateQty,
          locationCode: location.locationCode,
        });

        remaining -= allocateQty;
      }

      const totalAllocated = allocations.reduce((sum, a) => sum + a.quantity, 0);
      const isPartial = totalAllocated < request.requestedQuantity;

      if (isPartial && !request.allowPartial) {
        throw new ConflictException(
          `Insufficient stock. Requested: ${request.requestedQuantity}, Available: ${totalAllocated}`,
        );
      }

      this.logger.log(
        `Allocated ${totalAllocated}/${request.requestedQuantity} units across ${allocations.length} locations`,
      );

      return {
        skuId: request.skuId,
        totalAllocated,
        isPartial,
        allocations,
        message: isPartial
          ? `Partial allocation: ${totalAllocated}/${request.requestedQuantity} units`
          : 'Full allocation successful',
      };
    }, tx);
  }

  /**
   * FIFO 전략으로 재고 할당
   */
  async allocateByFIFO(
    skuId: string,
    requestedQuantity: number,
    warehouseId?: string,
    tx?: DbTx,
  ): Promise<AllocationResult> {
    return this.allocateStock(
      {
        skuId,
        requestedQuantity,
        warehouseId,
        strategy: 'FIFO',
        allowPartial: false,
      },
      tx,
    );
  }

  /**
   * 위치 우선순위 전략으로 재고 할당
   */
  async allocateByLocationPriority(
    skuId: string,
    requestedQuantity: number,
    preferredLocationIds: string[],
    warehouseId?: string,
    tx?: DbTx,
  ): Promise<AllocationResult> {
    return this.allocateStock(
      {
        skuId,
        requestedQuantity,
        warehouseId,
        preferredLocationIds,
        strategy: 'LOCATION_PRIORITY',
        allowPartial: false,
      },
      tx,
    );
  }

  /**
   * 다중 창고 최적화 할당
   */
  async allocateMultiWarehouse(
    skuId: string,
    requestedQuantity: number,
    allowPartial: boolean = true,
    tx?: DbTx,
  ): Promise<AllocationResult> {
    return this.allocateStock(
      {
        skuId,
        requestedQuantity,
        strategy: 'MULTI_WAREHOUSE',
        allowPartial,
      },
      tx,
    );
  }

  /**
   * 유통기한 우선 할당 (FEFO - First Expire, First Out)
   */
  async allocateByClosestExpiry(
    skuId: string,
    requestedQuantity: number,
    warehouseId?: string,
    tx?: DbTx,
  ): Promise<AllocationResult> {
    return this.allocateStock(
      {
        skuId,
        requestedQuantity,
        warehouseId,
        strategy: 'CLOSEST_EXPIRY',
        allowPartial: false,
      },
      tx,
    );
  }

  /**
   * 사용 가능한 위치 및 재고 조회
   */
  private async getAvailableLocations(
    skuId: string,
    warehouseId: string | undefined,
    tx: DbTx,
  ): Promise<AvailableLocation[]> {
    const { stockLedgers, stockReservations, locations, warehouses } = wmsTables;

    // 1. ON_HAND 재고 조회
    const ledgerConditions = [
      eq(stockLedgers.skuId, skuId),
      eq(stockLedgers.stockState, 'ON_HAND'),
      gte(stockLedgers.qty, 1), // 재고가 있는 것만
    ];

    if (warehouseId) {
      ledgerConditions.push(eq(stockLedgers.warehouseId, warehouseId));
    }

    const ledgerResults = await tx
      .select({
        warehouseId: stockLedgers.warehouseId,
        locationId: stockLedgers.locationId,
        quantity: stockLedgers.qty,
        updatedAt: stockLedgers.updatedAt,
      })
      .from(stockLedgers)
      .where(and(...ledgerConditions));

    if (ledgerResults.length === 0) {
      return [];
    }

    // 2. 예약된 수량 조회
    const reservedByLocation = await tx
      .select({
        warehouseId: stockReservations.warehouseId,
        // locationId는 예약 테이블에 없으므로 warehouse 레벨로 집계
        totalReserved: sum(stockReservations.quantity),
      })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.skuId, skuId),
          eq(stockReservations.status, 'confirmed'),
          warehouseId ? eq(stockReservations.warehouseId, warehouseId) : undefined,
        ),
      )
      .groupBy(stockReservations.warehouseId);

    const reservedMap = new Map<string, number>();
    for (const r of reservedByLocation) {
      reservedMap.set(r.warehouseId, Number(r.totalReserved || 0));
    }

    // 3. 위치 정보 조회 (선택적)
    const locationIds = ledgerResults.map((l) => l.locationId);
    const locationDetails = await tx.query.locations.findMany({
      where: sql`${locations.id} = ANY(${locationIds})`,
    });

    const locationMap = new Map(locationDetails.map((l) => [l.id, l]));

    // 4. 창고 정보 조회
    const warehouseIds = [...new Set(ledgerResults.map((l) => l.warehouseId))];
    const warehouseDetails = await tx.query.warehouses.findMany({
      where: sql`${warehouses.id} = ANY(${warehouseIds})`,
    });

    const warehouseMap = new Map(warehouseDetails.map((w) => [w.id, w]));

    // 5. Available 계산 (위치별로 예약 차감)
    const availableLocations: AvailableLocation[] = [];

    for (const ledger of ledgerResults) {
      const reservedInWarehouse = reservedMap.get(ledger.warehouseId) || 0;

      // 간단한 비례 배분 (실제로는 더 정교한 로직 필요)
      const totalInWarehouse = ledgerResults
        .filter((l) => l.warehouseId === ledger.warehouseId)
        .reduce((sum, l) => sum + l.quantity, 0);

      const reservedRatio = totalInWarehouse > 0 ? reservedInWarehouse / totalInWarehouse : 0;
      const reservedInLocation = Math.floor(ledger.quantity * reservedRatio);

      const availableQty = ledger.quantity - reservedInLocation;

      if (availableQty > 0) {
        const location = locationMap.get(ledger.locationId);
        const warehouse = warehouseMap.get(ledger.warehouseId);

        availableLocations.push({
          warehouseId: ledger.warehouseId,
          warehouseName: warehouse?.name,
          locationId: ledger.locationId,
          locationCode: location?.code || `LOC-${ledger.locationId.slice(-8)}`,
          zone: location?.displayName || undefined,
          availableQuantity: availableQty,
          updatedAt: ledger.updatedAt,
          priority: 0, // Default priority
        });
      }
    }

    return availableLocations;
  }

  /**
   * 전략에 따라 위치 정렬
   */
  private sortLocationsByStrategy(locations: AvailableLocation[], strategy: AllocationStrategy): AvailableLocation[] {
    const sorted = [...locations];

    switch (strategy) {
      case 'FIFO':
        // 가장 오래된 재고 우선 (updatedAt 오름차순)
        sorted.sort((a, b) => {
          const dateA = a.updatedAt?.getTime() || 0;
          const dateB = b.updatedAt?.getTime() || 0;
          return dateA - dateB;
        });
        break;

      case 'LOCATION_PRIORITY':
        // 우선순위 높은 위치 우선
        sorted.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        break;

      case 'MULTI_WAREHOUSE':
        // 재고가 많은 창고 우선
        sorted.sort((a, b) => b.availableQuantity - a.availableQuantity);
        break;

      case 'CLOSEST_EXPIRY':
        // 유통기한 가까운 것 우선 (expiryDate 오름차순)
        sorted.sort((a, b) => {
          const dateA = a.expiryDate?.getTime() || Number.MAX_SAFE_INTEGER;
          const dateB = b.expiryDate?.getTime() || Number.MAX_SAFE_INTEGER;
          return dateA - dateB;
        });
        break;

      default:
        // Default: FIFO
        sorted.sort((a, b) => {
          const dateA = a.updatedAt?.getTime() || 0;
          const dateB = b.updatedAt?.getTime() || 0;
          return dateA - dateB;
        });
    }

    return sorted;
  }

  /**
   * 선호 위치를 최우선으로 배치
   */
  private prioritizeLocations(locations: AvailableLocation[], preferredLocationIds: string[]): AvailableLocation[] {
    const preferred: AvailableLocation[] = [];
    const others: AvailableLocation[] = [];

    for (const location of locations) {
      if (preferredLocationIds.includes(location.locationId)) {
        preferred.push(location);
      } else {
        others.push(location);
      }
    }

    return [...preferred, ...others];
  }

  /**
   * 특정 SKU의 총 할당 가능 수량 조회
   */
  async getTotalAvailableQuantity(skuId: string, warehouseId?: string, tx?: DbTx): Promise<number> {
    const db = tx ?? this.db;

    const { stockLedgers, stockReservations } = wmsTables;

    // 1. ON_HAND 재고
    const onHandConditions = [eq(stockLedgers.skuId, skuId), eq(stockLedgers.stockState, 'ON_HAND')];

    if (warehouseId) {
      onHandConditions.push(eq(stockLedgers.warehouseId, warehouseId));
    }

    const onHandResult = await db
      .select({ total: sum(stockLedgers.qty) })
      .from(stockLedgers)
      .where(and(...onHandConditions));

    const onHand = Number(onHandResult[0]?.total || 0);

    // 2. 예약된 수량
    const reservedConditions = [eq(stockReservations.skuId, skuId), eq(stockReservations.status, 'confirmed')];

    if (warehouseId) {
      reservedConditions.push(eq(stockReservations.warehouseId, warehouseId));
    }

    const reservedResult = await db
      .select({ total: sum(stockReservations.quantity) })
      .from(stockReservations)
      .where(and(...reservedConditions));

    const reserved = Number(reservedResult[0]?.total || 0);

    return onHand - reserved;
  }

  /**
   * 창고별 할당 가능 수량 조회
   */
  async getAvailableQuantityByWarehouse(
    skuId: string,
    tx?: DbTx,
  ): Promise<Array<{ warehouseId: string; warehouseName: string; availableQuantity: number }>> {
    const db = tx ?? this.db;

    const { stockLedgers, stockReservations, warehouses } = wmsTables;

    // 1. 창고별 ON_HAND 재고
    const onHandByWarehouse = await db
      .select({
        warehouseId: stockLedgers.warehouseId,
        totalOnHand: sum(stockLedgers.qty),
      })
      .from(stockLedgers)
      .where(and(eq(stockLedgers.skuId, skuId), eq(stockLedgers.stockState, 'ON_HAND')))
      .groupBy(stockLedgers.warehouseId);

    // 2. 창고별 예약 수량
    const reservedByWarehouse = await db
      .select({
        warehouseId: stockReservations.warehouseId,
        totalReserved: sum(stockReservations.quantity),
      })
      .from(stockReservations)
      .where(and(eq(stockReservations.skuId, skuId), eq(stockReservations.status, 'confirmed')))
      .groupBy(stockReservations.warehouseId);

    const reservedMap = new Map<string, number>();
    for (const r of reservedByWarehouse) {
      reservedMap.set(r.warehouseId, Number(r.totalReserved || 0));
    }

    // 3. 창고 정보 조회
    const warehouseIds = onHandByWarehouse.map((o) => o.warehouseId);
    const warehouseDetails = await db.query.warehouses.findMany({
      where: sql`${warehouses.id} = ANY(${warehouseIds})`,
    });

    const warehouseMap = new Map(warehouseDetails.map((w) => [w.id, w]));

    // 4. 결과 조합
    return onHandByWarehouse.map((onHand) => {
      const warehouse = warehouseMap.get(onHand.warehouseId);
      const reserved = reservedMap.get(onHand.warehouseId) || 0;
      const available = Number(onHand.totalOnHand || 0) - reserved;

      return {
        warehouseId: onHand.warehouseId,
        warehouseName: warehouse?.name || 'Unknown',
        availableQuantity: Math.max(0, available),
      };
    });
  }
}
