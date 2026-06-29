import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../schema/inventory.schema';
import { AllocationChunk, fifoAllocate } from './fifo-allocate';

/**
 * 출고 소진 시 "어느 로케이션에서 차감할 것인가" 를 정하는 교체 가능한 전략(seam).
 *
 * 지금은 FIFO (`FifoLocationStrategy`), 나중에 토탈피킹이 잡은 실제 피킹-로케이션
 * 어댑터로 교체 가능 (ADR-0027 결정 4 / RFC 종결 seam). 이 seam 이 토탈피킹을
 * 비차단 제약으로 흡수한다.
 */
export interface LocationResolutionStrategy {
  resolve(skuId: string, warehouseId: string, quantity: number, tx: DbTx): Promise<AllocationChunk[]>;
}

export const LOCATION_RESOLUTION_STRATEGY = Symbol('LOCATION_RESOLUTION_STRATEGY');

/**
 * FIFO 어댑터 — (sku, warehouse) 의 raw ON_HAND `stock_ledgers` 행을 읽어
 * fifoRank(nulls last) → updatedAt 순으로 그리디 할당한다.
 *
 * ⚠️ `AllocationStrategyService.getAvailableLocations` 를 쓰지 않는다 — 그건
 * available(=on_hand−reserved) 를 보므로, 예약을 동시에 소진하는 이 경로에서 쓰면
 * 이중 차감된다. 여기서는 raw ON_HAND 만 본다.
 */
@Injectable()
export class FifoLocationStrategy implements LocationResolutionStrategy {
  async resolve(skuId: string, warehouseId: string, quantity: number, tx: DbTx): Promise<AllocationChunk[]> {
    const rows = await tx
      .select({
        locationId: wmsTables.stockLedgers.locationId,
        qty: wmsTables.stockLedgers.qty,
        fifoRank: wmsTables.locations.fifoRank,
        updatedAt: wmsTables.stockLedgers.updatedAt,
      })
      .from(wmsTables.stockLedgers)
      .innerJoin(wmsTables.locations, eq(wmsTables.stockLedgers.locationId, wmsTables.locations.id))
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          gte(wmsTables.stockLedgers.qty, 1),
        ),
      )
      .orderBy(asc(wmsTables.locations.fifoRank), asc(wmsTables.stockLedgers.updatedAt));

    return fifoAllocate(rows, quantity);
  }
}
