import { inArray } from 'drizzle-orm';
import { canonicalFulfillmentRequestHash } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-command.service';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS } from './constants';

// 이 파일이 쓰는 UUID 접두(019d000b~019d000d) 의 전체 할당 목록은 constants.ts 상단
// 레지스트리 참고 — 새 접두가 필요하면 그 레지스트리를 갱신할 것, 여기 다시 나열하지 않는다.
const BATCH_ID_PREFIX = '019d000b';
const WORK_ITEM_ID_PREFIX = '019d000c';
const WAYBILL_ID_PREFIX = '019d000d';

// bulk.ts 와 같은 이유로 각 세그먼트에 padStart 를 쓴다 — 리터럴 템플릿은 seq 자릿수가
// 늘어나는 순간 8-4-4-4-12 자릿수가 밀려 깨진다.
function seededId(prefix: string, index: number): string {
  const seq = String(index + 1).padStart(4, '0');
  return `${prefix}-${seq}-7000-a000-00000000${seq}`;
}

/**
 * planned shipment 를 **단순출고를 바로 시작할 수 있는 상태**로 올린다.
 *
 * 만드는 것은 세 가지뿐이다: 배치 1개(`created`) · work item N개(`queued`) · 운송장 N개(`registered`).
 *
 * plan·inventory session·피커 claim 은 **일부러 만들지 않는다.** `SimpleOutboundService.prepare()`
 * 가 `queued` work item 에서 그 셋을 직접 만드는 것이 실제 경로이고(PICKABLE_WORK_ITEM_STATUSES 에
 * `queued` 가 들어 있다), 시드가 미리 만들어두면 앱이 그 경로를 밟지 못해 정작 개발 중인 코드가
 * 검증되지 않는다.
 *
 * 상태 선택의 근거는 `shipment-dispatch.service.ts` 의 `lockAggregate` 다 — 거기서 active waybill
 * **정확히 1건**을 요구하므로(없으면 409 `SHIPMENT_INVOICE_NOT_READY`) 운송장 선발급이 전제다.
 * `registered` 가 active 이고, `pending` 은 active 로 쳐주지 않는다.
 *
 * 참조 구현: `apps/core/src/modules/fulfillment/services/__support__/logistics-fixtures.ts`
 * 의 `seedPickableShipment` — 통합 스펙이 쓰는 같은 상태를 랜덤 픽스처로 만든다.
 */
export async function seedOutboundReady(tx: DbTx, plannedShipmentIds: string[]): Promise<void> {
  if (plannedShipmentIds.length === 0) return;

  const shipments = await tx
    .select({
      id: wmsTables.shipments.id,
      manifestVersion: wmsTables.shipments.manifestVersion,
      recipientSnapshot: wmsTables.shipments.recipientSnapshot,
    })
    .from(wmsTables.shipments)
    .where(inArray(wmsTables.shipments.id, plannedShipmentIds));

  // 호출자가 넘긴 순서를 그대로 쓴다 — 운송장번호가 인덱스 파생이라, 조회 순서(비결정적)에
  // 기대면 DEV-WAYBILL-0001 이 리셋마다 다른 송장에 붙어 결정론 규약이 깨진다.
  const byId = new Map(shipments.map((shipment) => [shipment.id, shipment]));

  const batchId = seededId(BATCH_ID_PREFIX, 0);
  await tx.insert(wmsTables.outboundBatches).values({
    id: batchId,
    batchNumber: 'DEV-BATCH-0001',
    warehouseId: SEED_IDS.warehouseBucheon,
    // individual 만 단순출고가 다룰 수 있다 — SimpleOutboundService 의 assertBatchMethodSupported 가
    // 방식 이름이 아니라 거기서 파생되는 전략(discrete)을 보고 판정한다.
    pickingMethod: 'individual',
    status: 'created',
  });

  for (const [index, shipmentId] of plannedShipmentIds.entries()) {
    const shipment = byId.get(shipmentId);
    if (!shipment) throw new Error(`planned shipment 을 찾지 못했다: ${shipmentId}`);

    await tx.insert(wmsTables.outboundBatchWorkItems).values({
      id: seededId(WORK_ITEM_ID_PREFIX, index),
      batchId,
      shipmentId,
      status: 'queued',
      leaseVersion: 0,
    });

    await tx.insert(wmsTables.waybills).values({
      id: seededId(WAYBILL_ID_PREFIX, index),
      shipmentId,
      source: 'manual',
      carrier: 'HANJIN',
      status: 'registered',
      trackingNo: `DEV-WAYBILL-${String(index + 1).padStart(4, '0')}`,
      manifestVersion: shipment.manifestVersion,
      // shipment 의 recipientSnapshot 에서 계산해야 한다. salesOrder.shippingAddress 같은 다른
      // 출처에서 뽑으면 여기서는 통과하고 출고 시점에야 어긋나 실패한다.
      recipientHash: canonicalFulfillmentRequestHash(shipment.recipientSnapshot),
    });
  }
}
