import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';

/**
 * 결품 오퍼레이션 행 + source 멤버 — 세션·복구 스펙이 보고 명령 없이 부족 승인을 부를 때 쓴다(보고 명령이 만드는 모양 그대로).
 * 실제 보고(`ShipmentShortPickService.report`)는 이 행을 자기 트랜잭션에서 만든다.
 */
export async function seedShortPickOperation(
  tx: DbTx,
  input: {
    shipmentId: string;
    workItemId: string;
    sessionId: string;
    actorId: string;
    reason?: string;
    lines: Array<{ shipmentLineId: string; sourceLocationId: string; shortQty: number; allocationQty: number }>;
  },
): Promise<{ id: string; reason: string }> {
  const id = randomUUID();
  const reason = input.reason ?? 'inventory_shortage';
  await tx.insert(wmsTables.shipmentOperations).values({
    id,
    type: 'short_pick',
    status: 'pending',
    operatorId: input.actorId,
    reason,
    idempotencyKey: `short-pick-fixture-${id}`,
    requestHash: 'f'.repeat(64),
    beforeManifestSnapshot: {
      intent: {
        kind: 'short_pick',
        operationId: id,
        shipmentId: input.shipmentId,
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        actorId: input.actorId,
        reason,
        lines: input.lines,
      },
    },
  });
  await tx
    .insert(wmsTables.shipmentOperationMembers)
    .values({ operationId: id, shipmentId: input.shipmentId, role: 'source' });
  return { id, reason };
}

/** 같은 창고·SKU 의 다른 로케이션에 일반 재고를 둔다 — 재배정 후보. 코드는 픽스처 로케이션(`SIMPLE-ZONE-…`)보다 뒤(`SPARE-…`). */
export async function seedSpareStock(
  tx: DbTx,
  base: { skuId: string; warehouseId: string },
  qty: number,
  codePrefix = 'SPARE',
): Promise<{ locationId: string; code: string }> {
  const code = `${codePrefix}-${randomUUID()}`;
  const [location] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: base.warehouseId, code, locationType: 'zone' })
    .returning();
  await tx.insert(wmsTables.stockLedgers).values({
    skuId: base.skuId,
    warehouseId: base.warehouseId,
    locationId: location.id,
    stockState: 'ON_HAND',
    qty,
  });
  return { locationId: location.id, code };
}
