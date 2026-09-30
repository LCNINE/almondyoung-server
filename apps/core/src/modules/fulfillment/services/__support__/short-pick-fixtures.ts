import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { ShipmentShortPickResponseDto } from '../../dto/shipment-short-pick.dto';
import { PickableShipmentFixture, seedPickableShipment } from './logistics-fixtures';
import { assembleOutbound } from './simple-outbound-wiring';

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

/**
 * 결품 보고 직전 — 박스(A 3개, 픽스처 로케이션 L1 재고 3)의 배치(개별 피킹)를 시작하고 `picked` 개를 집는다.
 * `report(shortQty, key?)` 는 L1 결품을 보고한다. 매번 최신 버전들을 읽어 보내되, 같은 키를 다시 쓰면 처음 보낸 요청을
 * 그대로 다시 보낸다(멱등 재전송 = 같은 요청 — 보고가 세션 버전을 올리므로 다시 읽으면 요청 해시가 달라진다).
 */
export async function startedShortPickBox(
  tx: DbTx,
  picked = 0,
): Promise<{
  box: PickableShipmentFixture;
  wiring: ReturnType<typeof assembleOutbound>;
  sessionId: string;
  report: (shortQty: number, key?: string) => Promise<ShipmentShortPickResponseDto>;
}> {
  const box = await seedPickableShipment(tx, 3);
  const wiring = assembleOutbound(tx);
  const run = await wiring.picking.start(
    { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
    tx,
  );
  if (picked) {
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `pick-${randomUUID()}`,
        actorId: box.actorId,
        quantity: picked,
        from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: box.skuId,
          sourceLocationId: box.locationId,
          custodyType: 'WORKER',
          custodyRef: box.actorId,
          shipmentLineId: box.shipmentLineId,
        },
      },
      tx,
    );
  }
  const actor = { id: box.actorId, roles: ['master'] };
  const sent = new Map<string, Parameters<typeof wiring.shortPick.report>[1]>();
  const report = async (shortQty: number, key = `sp-${randomUUID()}`) => {
    let dto = sent.get(key);
    if (!dto) {
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, run.sessionId));
      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      dto = {
        workItemId: box.workItemId,
        expectedWorkItemLeaseVersion: workItem.leaseVersion,
        sessionId: session.id,
        expectedSessionVersion: session.version,
        expectedManifestVersion: shipment.manifestVersion,
        lines: [
          {
            shipmentLineId: line.id,
            sourceLocationId: box.locationId,
            expectedLineVersion: line.lineVersion,
            shortQty,
          },
        ],
        reason: 'inventory_shortage',
      };
      sent.set(key, dto);
    }
    return wiring.shortPick.report(box.shipmentId, dto, key, actor, tx);
  };
  return { box, wiring, sessionId: run.sessionId, report };
}
