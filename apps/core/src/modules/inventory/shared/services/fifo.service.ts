import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema } from '../../schema/inventory.schema';
import { eq, and, gt } from 'drizzle-orm';

export interface FifoLocation {
  locationId: string;
  warehouseId: string;
  qty: number;
  fifoScore: number; // 높을수록 오래된 재고 (먼저 출고해야 함)
  lastReceivedAt: Date;
}

@Injectable()
export class FifoService {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * FIFO 순서로 재고 할당 위치들을 반환
   * @param skuId SKU ID
   * @param warehouseId 창고 ID
   * @param requiredQty 필요 수량
   * @returns 시간 순서로 정렬된 위치별 재고 정보
   */
  async getPickingLocations(skuId: string, warehouseId: string, requiredQty: number): Promise<FifoLocation[]> {
    // 해당 SKU의 재고가 있는 위치들 조회 (ON_HAND 상태만)
    const stockLedgers = await this.db.query.stockLedgers.findMany({
      where: and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        gt(wmsTables.stockLedgers.qty, 0),
      ),
      with: {
        location: true,
      },
    });

    if (stockLedgers.length === 0) {
      return [];
    }

    // 각 위치별로 가장 오래된 입고 시간 조회
    const fifoLocations: FifoLocation[] = [];

    for (const ledger of stockLedgers) {
      const oldestReceive = await this.db.query.stockEvents.findFirst({
        where: and(
          eq(wmsTables.stockEvents.skuId, skuId),
          eq(wmsTables.stockEvents.toWarehouseId, warehouseId),
          eq(wmsTables.stockEvents.toLocationId, ledger.locationId),
          eq(wmsTables.stockEvents.toState, 'ON_HAND'),
          eq(wmsTables.stockEvents.eventStatus, 'POSTED'),
        ),
        orderBy: (events, { asc }) => [asc(events.occurredAt)],
      });

      if (oldestReceive) {
        // FIFO 점수: 시간 기반 (오래될수록 높은 점수)
        const daysSinceReceived = (Date.now() - oldestReceive.occurredAt.getTime()) / (1000 * 60 * 60 * 24);

        fifoLocations.push({
          locationId: ledger.locationId,
          warehouseId: ledger.warehouseId,
          qty: ledger.qty,
          fifoScore: Math.floor(daysSinceReceived * 100), // 일 단위를 100배 해서 정수로
          lastReceivedAt: oldestReceive.occurredAt,
        });
      }
    }

    // FIFO 점수 순으로 정렬 (높은 점수 = 오래된 재고부터)
    fifoLocations.sort((a, b) => b.fifoScore - a.fifoScore);

    // 필요 수량만큼만 반환 (누적 수량 계산)
    const result: FifoLocation[] = [];
    let accumulatedQty = 0;

    for (const location of fifoLocations) {
      result.push(location);
      accumulatedQty += location.qty;

      if (accumulatedQty >= requiredQty) {
        break;
      }
    }

    return result;
  }

  /**
   * 특정 위치의 FIFO 점수 계산
   * @param skuId SKU ID
   * @param locationId 위치 ID
   * @returns FIFO 점수 (높을수록 오래된 재고)
   */
  async calculateFifoScore(skuId: string, locationId: string): Promise<number> {
    const oldestReceive = await this.db.query.stockEvents.findFirst({
      where: and(
        eq(wmsTables.stockEvents.skuId, skuId),
        eq(wmsTables.stockEvents.toLocationId, locationId),
        eq(wmsTables.stockEvents.toState, 'ON_HAND'),
        eq(wmsTables.stockEvents.eventStatus, 'POSTED'),
      ),
      orderBy: (events, { asc }) => [asc(events.occurredAt)],
    });

    if (!oldestReceive) {
      return 0;
    }

    // 시간 기반 점수 계산 (일 단위)
    const daysSinceReceived = (Date.now() - oldestReceive.occurredAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.floor(daysSinceReceived * 100);
  }

  /**
   * 위치별 FIFO 건강도 체크
   * @param warehouseId 창고 ID
   * @returns 오래된 재고 현황
   */
  async getFifoHealthCheck(warehouseId: string) {
    // 30일 이상 된 재고 조회
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const oldStockCount = await this.db.query.stockEvents.findMany({
      where: and(
        eq(wmsTables.stockEvents.toWarehouseId, warehouseId),
        eq(wmsTables.stockEvents.toState, 'ON_HAND'),
        eq(wmsTables.stockEvents.eventStatus, 'POSTED'),
      ),
      columns: {
        skuId: true,
        toLocationId: true,
        occurredAt: true,
      },
    });

    const oldStockLocations = oldStockCount.filter((event) => event.occurredAt < thirtyDaysAgo);

    return {
      totalLocations: oldStockCount.length,
      oldStockLocations: oldStockLocations.length,
      fifoCompliance:
        oldStockLocations.length === 0
          ? 100
          : Math.max(0, 100 - (oldStockLocations.length / oldStockCount.length) * 100),
      oldestStock: oldStockCount.length > 0 ? Math.min(...oldStockCount.map((e) => e.occurredAt.getTime())) : null,
    };
  }
}
