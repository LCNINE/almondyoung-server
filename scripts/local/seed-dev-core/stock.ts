import { InventoryCommandService } from '../../../apps/core/src/modules/inventory/core/services/inventory-command.service';
import { DbTx } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_RACK_LOCATIONS, SEED_SKUS } from './constants';

/**
 * 재고는 반드시 InventoryCommandService.receive 를 경유한다.
 * stock_events(원장) + stock_ledgers(투영) + 판매가능수량이 한 트랜잭션에서 함께 움직여야
 * 앱이 읽는 세계가 정합하다.
 *
 * 배치 규칙 (constants.ts 주석과 짝):
 *   index 0~1   → 재고 없음
 *   index 2~13  → 랙 1곳에 50개
 *   index 14~19 → 랙 2곳에 30 + 20개
 */
export async function seedStock(command: InventoryCommandService, tx: DbTx): Promise<void> {
  for (const [index, sku] of SEED_SKUS.entries()) {
    if (index < 2) continue;

    const placements =
      index < 14
        ? [{ location: SEED_RACK_LOCATIONS[index % SEED_RACK_LOCATIONS.length], quantity: 50 }]
        : [
            { location: SEED_RACK_LOCATIONS[index % SEED_RACK_LOCATIONS.length], quantity: 30 },
            { location: SEED_RACK_LOCATIONS[(index + 1) % SEED_RACK_LOCATIONS.length], quantity: 20 },
          ];

    for (const [placementIndex, placement] of placements.entries()) {
      await command.receive(
        {
          skuId: sku.id,
          toWarehouseId: SEED_IDS.warehouseBucheon,
          toLocationId: placement.location.id,
          quantity: placement.quantity,
          reason: 'DEV-SEED',
          // 결정론 규약 — 같은 리셋을 반복해도 같은 키가 나온다.
          idempotencyKey: `dev-seed-receive-${sku.code}-${placementIndex}`,
        },
        tx,
      );
    }
  }
}
