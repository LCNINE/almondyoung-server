import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';

/**
 * 창고 grain 가용재고의 유일한 정의.
 *
 * 정본 규칙 (CLAUDE.md · ADR-0001): 가용재고 = ON_HAND 원장 합 − confirmed 예약 합.
 * 다른 항(이동예정·입고예정 등)을 여기에 더하거나 빼지 않는다. 다른 관점이 필요하면
 * 조용한 변형이 아니라 이름 붙은 별도 판독으로 만든다.
 *
 * Nest 프로바이더가 아니라 순수 함수 leaf 다 — core↔store DI 순환을 피하려고
 * `shared/locks/reservation-invariant.ts` 가 이미 택한 형태를 따른다.
 */
export interface WarehouseAvailability {
  onHand: number;
  reserved: number;
  available: number;
}

/** 정본 산식. 음수를 clamp 하지 않는다 — 표시용 clamp 는 호출자 책임이다. */
export function computeAvailable(onHand: number, reserved: number): number {
  return onHand - reserved;
}

/** `removingQty` 만큼 ON_HAND 를 빼면 가용이 음수가 되는가. */
export function violatesAvailability(onHand: number, reserved: number, removingQty: number): boolean {
  return computeAvailable(onHand - removingQty, reserved) < 0;
}

interface AvailabilityRow {
  on_hand: number | string;
  reserved: number | string;
}

/**
 * 창고 grain ON_HAND 원장 합·confirmed 예약 합을 **단일 statement** 로 읽는다.
 *
 * 두 값을 각각 읽으면 READ COMMITTED 에서 그 사이에 SHIP 소진이 커밋될 수 있어
 * torn read(초과예약)가 난다. 한 statement 안의 두 스칼라 서브쿼리는 같은 스냅샷을 본다.
 */
export async function readWarehouseAvailability(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
): Promise<WarehouseAvailability> {
  // execute() 원시 결과 타이핑 — reservation-invariant.ts / ledger-reconciliation.service.ts 와
  // 동일한 문서화된 캐스트.
  const rows = (await trx.execute(sql`
    SELECT
      COALESCE((SELECT SUM(qty) FROM stock_ledgers
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND stock_state = 'ON_HAND'), 0) AS on_hand,
      COALESCE((SELECT SUM(quantity) FROM stock_reservations
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND status = 'confirmed'), 0) AS reserved
  `)) as unknown as AvailabilityRow[];

  const onHand = Number(rows[0]?.on_hand ?? 0);
  const reserved = Number(rows[0]?.reserved ?? 0);
  return { onHand, reserved, available: computeAvailable(onHand, reserved) };
}
