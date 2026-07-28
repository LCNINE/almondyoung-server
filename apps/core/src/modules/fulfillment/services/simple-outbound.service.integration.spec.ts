import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { SCOPE_AUTHORIZATION_DECISION_BRAND, ScopeAuthorizationDecision } from '@app/authorization';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { inRollbackTx, makeDb, PickableShipmentFixture, seedPickableShipment } from './__support__';
import { assembleSimpleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * seedPickableShipment 의 shipment 에 두 번째 SKU 라인을 덧붙인다 — settleIfFullyPicked 의
 * "라인 A 는 다 찼지만 라인 B 는 아직 → null(미완료)" 분기(리뷰 지적 6)는 라인이 하나뿐인
 * 픽스처로는 절대 밟히지 않는다. 공유 픽스처(seedPickableShipment)는 다른 스펙이 그 모양에
 * 기대므로 건드리지 않고, shipment-dispatch.integration.spec 의 addParallelShipmentLine 을
 * 모델로 이 스펙 안에서만 만든다. 서로 다른 SKU/바코드를 써서 두 스캔이 서로 다른 라인의
 * allocation 만 채우도록 한다(같은 SKU 였다면 한 스캔이 두 라인에 걸쳐 분배될 수 있어
 * 이 테스트가 검증하려는 "라인 하나만 완료" 상태를 결정적으로 만들 수 없다).
 */
async function addSecondSimpleOutboundLine(
  tx: DbTx,
  fixture: PickableShipmentFixture,
  qty: number,
): Promise<{ skuId: string; barcode: string; shipmentLineId: string }> {
  const [existingLine] = await tx
    .select({ fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId })
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
    .limit(1);
  const [existingItem] = await tx
    .select({
      fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
      salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
    })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.id, existingLine.fulfillmentOrderItemId))
    .limit(1);
  const [shipment] = await tx
    .select({ shippingProfileId: wmsTables.shipments.shippingProfileId })
    .from(wmsTables.shipments)
    .where(eq(wmsTables.shipments.id, fixture.shipmentId))
    .limit(1);

  const suffix = randomUUID();
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({
      name: 'Simple SKU (second line)',
      code: `SIMPLE2-${suffix}`,
      holderId: fixture.holderId,
      // assertPlanningEligibility 는 라인의 delivery profile 이 shipment 의 shippingProfileId 와
      // 같아야 한다 — 원 라인과 같은 profile 을 그대로 물려받는다.
      deliveryProfileId: shipment.shippingProfileId,
    })
    .returning();
  const barcode = `881${suffix.replaceAll('-', '').slice(0, 10)}`;
  await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
  await tx.insert(wmsTables.stockLedgers).values({
    skuId: sku.id,
    warehouseId: fixture.warehouseId,
    locationId: fixture.locationId,
    stockState: 'ON_HAND',
    qty,
  });

  const [salesOrderLine] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId: existingItem.salesOrderId,
      variantId: randomUUID(),
      productName: 'Simple product (second line)',
      quantity: qty,
      channelOrderItemId: `simple-item-2-${suffix}`,
      channelProductId: `simple-product-2-${suffix}`,
    })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: existingItem.fulfillmentOrderId,
      salesOrderId: existingItem.salesOrderId,
      salesOrderLineId: salesOrderLine.id,
      skuId: sku.id,
      qty,
      reservedQty: qty,
      status: 'processing',
    })
    .returning();
  const [line] = await tx
    .insert(wmsTables.shipmentLines)
    .values({
      shipmentId: fixture.shipmentId,
      fulfillmentOrderItemId: item.id,
      skuId: sku.id,
      qty,
      reservedQty: qty,
      inspectedQty: 0,
    })
    .returning();
  await tx.insert(wmsTables.stockReservations).values({
    targetType: 'SHIPMENT_LINE',
    targetId: line.id,
    shipmentLineId: line.id,
    skuId: sku.id,
    warehouseId: fixture.warehouseId,
    quantity: qty,
    status: 'confirmed',
    requestedAt: new Date(),
  });

  return { skuId: sku.id, barcode, shipmentLineId: line.id };
}

describeIfDb('SimpleOutboundService.prepare', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('plan·session 을 만들고 피커 claim 까지 세운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const context = await service.prepare(fixture.shipmentId, actor, `prep-${randomUUID()}`, tx);

      expect(context.batchId).toBe(fixture.batchId);
      expect(context.workItemId).toBe(fixture.workItemId);
      expect(context.planId).toBeTruthy();
      expect(context.sessionId).toBeTruthy();

      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId))
        .limit(1);
      expect(workItem.status).toBe('picking');
      expect(workItem.pickerId).toBe(actor.id);
      expect(context.leaseVersion).toBe(workItem.leaseVersion);

      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.planId, context.planId))
        .limit(1);
      expect(allocation.shipmentLineId).toBe(fixture.shipmentLineId);
      expect(allocation.sourceLocationId).toBe(fixture.locationId);
      expect(allocation.qty).toBe(fixture.qty);
    });
  });

  it('두 번 불러도 같은 plan·session 을 재사용한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const first = await service.prepare(fixture.shipmentId, actor, `prep-a-${randomUUID()}`, tx);
      const second = await service.prepare(fixture.shipmentId, actor, `prep-b-${randomUUID()}`, tx);

      expect(second.planId).toBe(first.planId);
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.leaseVersion).toBe(first.leaseVersion);
    });
  });

  it('배치에 없는 shipment 는 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      await tx
        .delete(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId));
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.prepare(
          fixture.shipmentId,
          { id: fixture.actorId, roles: ['logistics_worker'] },
          `prep-${randomUUID()}`,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_WORK_ITEM_MISSING' } });
    });
  });

  // 창고에 aggregate_then_sort/pick_to_tote 가 켜지면 관리자가 그 방식의 배치를 만들 수 있다.
  // 단순출고는 DiscretePickingStrategy 절차만 재현하므로 plan 을 만들기 전에 거절해야 한다.
  it('개별피킹이 아닌 배치는 409 SIMPLE_OUTBOUND_METHOD_UNSUPPORTED 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      // total_picking 을 쓰는 이유: ck_outbound_batches_cart_capacity 가 multi_order 에만
      // cart_capacity NOT NULL 을 요구하므로 한 컬럼만 바꾸면 되는 쪽을 고른다.
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: 'total_picking' })
        .where(eq(wmsTables.outboundBatches.id, fixture.batchId));
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.prepare(
          fixture.shipmentId,
          { id: fixture.actorId, roles: ['logistics_worker'] },
          `prep-${randomUUID()}`,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED' } });
    });
  });

  it('다른 작업자가 피킹 중이면 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      const other = randomUUID();
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({
          status: 'picking',
          pickerId: other,
          pickerClaimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          leaseVersion: 1,
        })
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId));
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.prepare(
          fixture.shipmentId,
          { id: fixture.actorId, roles: ['logistics_worker'] },
          `prep-${randomUUID()}`,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER' } });
    });
  });

  it('내 리스가 만료됐으면 조용히 재-claim 해 연장한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const first = await service.prepare(fixture.shipmentId, actor, `prep-a-${randomUUID()}`, tx);

      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId));

      const second = await service.prepare(fixture.shipmentId, actor, `prep-b-${randomUUID()}`, tx);

      expect(second.leaseVersion).toBeGreaterThan(first.leaseVersion);

      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId))
        .limit(1);
      expect(workItem.leaseExpiresAt).not.toBeNull();
      expect((workItem.leaseExpiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    });
  });

  // 리뷰 지적 3: ensurePlan 의 plan 멤버십 조회가 loadWorkItem 과 같은 넓은
  // PICKABLE_WORK_ITEM_STATUSES(ready_to_pack·packing 포함)를 쓰면, 같은 배치 안의
  // 다른 shipment 가 ready_to_pack 상태일 때 그 shipment 까지 plan 멤버십에 끼어든다.
  // DiscretePickingStrategy.assertPlanningEligibility 는 ACTIVE_WORK_ITEM_STATUSES
  // (queued·picking 만)로 멤버십을 정확히 비교하므로 불일치가 나 배치 전체가
  // PICKING_WORK_ITEM_MEMBERSHIP_MISMATCH 로 막힌다 — queued 하나만 있어도 스캔 불가.
  it('배치 안의 다른 shipment 가 ready_to_pack 이어도 queued 항목은 스캔할 수 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 1);
      const blocker = await seedPickableShipment(tx, 1);
      // blocker 의 work item 을 fixture 와 같은 배치로 옮기고 ready_to_pack 으로 둔다 —
      // "배치에 열린 plan 은 없지만 이미 ready_to_pack/packing 인 work item 이 있는" 상태를
      // 재현한다. batchId·shipmentId 만 FK 라 warehouse 가 달라도 이 이동 자체는 허용된다.
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({
          batchId: fixture.batchId,
          status: 'ready_to_pack',
          pickerId: blocker.actorId,
          pickerClaimedAt: new Date(Date.now() - 60_000),
          pickerReleasedAt: new Date(),
          leaseExpiresAt: null,
        })
        .where(eq(wmsTables.outboundBatchWorkItems.id, blocker.workItemId));

      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const state = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );

      expect(state.status).toBe('shipped');
    });
  });
});

describeIfDb('SimpleOutboundService.scan — 피킹', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('바코드 1개 스캔이 그 라인의 pickedQty 를 올린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);

      const state = await service.scan(
        fixture.shipmentId,
        {
          barcode: fixture.barcode,
          quantity: 1,
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: `scan-${randomUUID()}`,
        },
        tx,
      );

      expect(state.status).toBe('in_progress');
      expect(state.lines).toEqual([
        { shipmentLineId: fixture.shipmentLineId, skuId: fixture.skuId, qty: 2, pickedQty: 1, inspectedQty: 0 },
      ]);
    });
  });

  it('필요 수량을 넘는 스캔은 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      await expect(
        service.scan(
          fixture.shipmentId,
          { barcode: fixture.barcode, quantity: 3, actor, idempotencyKey: `scan-${randomUUID()}` },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_OVERSCAN' } });
    });
  });

  it('이 송장에 없는 바코드는 409 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const other = await seedPickableShipment(tx, 1);
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.scan(
          fixture.shipmentId,
          {
            barcode: other.barcode,
            quantity: 1,
            actor: { id: fixture.actorId, roles: ['logistics_worker'] },
            idempotencyKey: `scan-${randomUUID()}`,
          },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT' } });
    });
  });

  // 리뷰 지적 1: 바코드 해석이 검수(resolveInspectionLine)와 같은 공유 헬퍼를 쓰는지 —
  // 등록된 barcode 문자열이 아니라 SKU 의 UUID 자체(라벨이 QR 로 SKU id 를 인코딩한 경우)로
  // 스캔해도 등록 바코드 스캔과 같은 진행이 나와야 한다.
  it('등록 바코드 대신 SKU UUID 로 스캔해도 같은 pickedQty 로 성공한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);

      const state = await service.scan(
        fixture.shipmentId,
        {
          barcode: fixture.skuId,
          quantity: 1,
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: `scan-${randomUUID()}`,
        },
        tx,
      );

      expect(state.status).toBe('in_progress');
      expect(state.lines).toEqual([
        { shipmentLineId: fixture.shipmentLineId, skuId: fixture.skuId, qty: 2, pickedQty: 1, inspectedQty: 0 },
      ]);
    });
  });

  it('아무 것도 해석되지 않는 바코드는 SIMPLE_OUTBOUND_BARCODE_UNKNOWN 으로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.scan(
          fixture.shipmentId,
          {
            barcode: `no-such-barcode-${randomUUID()}`,
            quantity: 1,
            actor: { id: fixture.actorId, roles: ['logistics_worker'] },
            idempotencyKey: `scan-${randomUUID()}`,
          },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_BARCODE_UNKNOWN' } });
    });
  });

  // 리뷰 지적 2: 한 라인이 여러 소스 로케이션에서 나올 때 스캔 수량이 여러
  // picking_source_allocations 로 분배되는지 — seedPickableShipment 는 로케이션이
  // 하나뿐이라 이 분배 경로(free<=0 skip, Math.min 산술, 로케이션간 누적)를 어떤
  // 기존 테스트도 밟지 않는다. 공유 픽스처는 건드리지 않고 이 스펙 안에서만
  // 두 번째 로케이션·ledger·allocation·AT_SOURCE 커스터디를 직접 심는다.
  it('한 라인이 두 로케이션에 나뉘어 할당되면 스캔 하나가 두 할당을 모두 소진한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 3);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      // prepare() 먼저 호출해 plan/session 을 확보한다 — plan() 이 만든 단일
      // allocation(전체 qty=3, fixture.locationId)을 아래서 둘로 쪼갠다.
      const context = await service.prepare(fixture.shipmentId, actor, `prep-${randomUUID()}`, tx);

      const [originalAllocation] = await tx
        .select({ id: wmsTables.pickingSourceAllocations.id })
        .from(wmsTables.pickingSourceAllocations)
        .where(
          and(
            eq(wmsTables.pickingSourceAllocations.planId, context.planId),
            eq(wmsTables.pickingSourceAllocations.shipmentLineId, fixture.shipmentLineId),
          ),
        )
        .limit(1);

      // 원래 할당(qty=3)을 2로 줄여, 나머지 1은 두 번째 로케이션에서 나오도록 강제한다.
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 2 })
        .where(eq(wmsTables.pickingSourceAllocations.id, originalAllocation.id));
      // session.handedInQty(=3, prepare() 의 HAND_IN 이 기록)와 실제 AT_SOURCE 잔량
      // 합계가 어긋나면 assertConservation 이 막는다 — 새 로케이션에 얹는 1만큼
      // 원래 로케이션의 AT_SOURCE 를 줄여 총량 3을 그대로 지킨다(재고를 늘리는 게
      // 아니라 같은 재고를 두 로케이션으로 재배치하는 시나리오).
      await tx
        .update(wmsTables.batchInventorySessionBalances)
        .set({ qty: 2 })
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, context.sessionId),
            eq(wmsTables.batchInventorySessionBalances.sourceLocationId, fixture.locationId),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        );

      const [location2] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: fixture.warehouseId, code: `SPLIT-ZONE-${randomUUID()}`, locationType: 'zone' })
        .returning();
      const [ledger2] = await tx
        .insert(wmsTables.stockLedgers)
        .values({
          skuId: fixture.skuId,
          warehouseId: fixture.warehouseId,
          locationId: location2.id,
          stockState: 'ON_HAND',
          qty: 1,
        })
        .returning();
      await tx.insert(wmsTables.pickingSourceAllocations).values({
        planId: context.planId,
        shipmentLineId: fixture.shipmentLineId,
        sourceLocationId: location2.id,
        qty: 1,
        sourceStockVersion: ledger2.version,
      });
      // session start() 의 HAND_IN 은 prepare() 시점에 이미 돌아, 그때 있던 단일
      // allocation 만큼만 AT_SOURCE 커스터디를 심었다. 방금 추가한 두 번째
      // 로케이션 할당은 그 HAND_IN 을 다시 타지 않으므로, 같은 모양의 AT_SOURCE
      // 잔량을 이 스펙에서 직접 심어야 스캔이 거기서 꺼내갈 재고가 있다.
      await tx.insert(wmsTables.batchInventorySessionBalances).values({
        sessionId: context.sessionId,
        skuId: fixture.skuId,
        sourceLocationId: location2.id,
        custodyType: 'AT_SOURCE',
        qty: 1,
      });

      const state = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 3, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );

      // 이 라인이 유일한 라인이라 스캔 3개로 전량이 찬다 — Task 5 의 settleIfFullyPicked
      // 가 같은 스캔 안에서 완료·검수까지 이어붙이므로 inspectedQty 도 3으로 찬다.
      // 이 테스트의 본래 관심사(두 로케이션 분배)는 아래 balances 검증이 커버한다.
      expect(state.lines).toEqual([
        { shipmentLineId: fixture.shipmentLineId, skuId: fixture.skuId, qty: 3, pickedQty: 3, inspectedQty: 3 },
      ]);

      const balances = await tx
        .select({
          sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
          qty: wmsTables.batchInventorySessionBalances.qty,
        })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, context.sessionId),
            eq(wmsTables.batchInventorySessionBalances.shipmentLineId, fixture.shipmentLineId),
          ),
        );

      const bySourceLocation = new Map<string | null, number>();
      for (const row of balances) {
        bySourceLocation.set(row.sourceLocationId, (bySourceLocation.get(row.sourceLocationId) ?? 0) + row.qty);
      }
      expect(bySourceLocation.size).toBe(2);
      expect(bySourceLocation.get(fixture.locationId)).toBe(2);
      expect(bySourceLocation.get(location2.id)).toBe(1);
    });
  });
});

describeIfDb('SimpleOutboundService.scan — 완결', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('마지막 스캔에서 완료·검수·출고까지 한 번에 끝난다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const first = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-a-${randomUUID()}` },
        tx,
      );
      expect(first.status).toBe('in_progress');

      const second = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-b-${randomUUID()}` },
        tx,
      );

      expect(second.status).toBe('shipped');
      expect(second.dispatchAttemptId).not.toBeNull();
      expect(second.lines[0]).toMatchObject({ qty: 2, pickedQty: 2, inspectedQty: 2 });

      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipmentId))
        .limit(1);
      expect(shipment.status).toBe('shipped');

      // 리뷰 지적 5(design spec §9): 단순출고가 존재하는 이유 — 검수·완료 상태만 보고
      // 원장(SHIP 이벤트)과 예약 소진을 안 보면, 상태는 맞는데 재고가 안 빠지는
      // 회귀를 놓친다. assertOutboundV2Checkpoint 는 여러 shipment/holder 를 넘나드는
      // dispatch 시나리오용이라 이 단일 라인 픽스처엔 맞지 않아, 직접 단언한다.
      const shipEvents = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(
          and(
            eq(wmsTables.stockEvents.skuId, fixture.skuId),
            eq(wmsTables.stockEvents.transitionType, 'SHIP'),
            eq(wmsTables.stockEvents.fromWarehouseId, fixture.warehouseId),
          ),
        );
      expect(shipEvents).toHaveLength(1);
      expect(shipEvents[0].quantity).toBe(fixture.qty);

      const [reservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.shipmentLineId));
      expect(reservation.status).toBe('released');
    });
  });

  it('한 번 스캔으로 전량이면 그 스캔에서 바로 출고된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);

      const state = await service.scan(
        fixture.shipmentId,
        {
          barcode: fixture.barcode,
          quantity: 2,
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: `scan-${randomUUID()}`,
        },
        tx,
      );

      expect(state.status).toBe('shipped');
      expect(state.workItemStatus).toBe('completed');
    });
  });

  it('같은 idempotency-key 재요청은 이중 계상하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };
      const key = `scan-retry-${randomUUID()}`;

      const first = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: key },
        tx,
      );
      const replay = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: key },
        tx,
      );

      expect(replay).toEqual(first);
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
        .limit(1);
      expect(line.inspectedQty).toBe(0);
    });
  });
});

describeIfDb('SimpleOutboundService.forceComplete', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const authorization: ScopeAuthorizationDecision = {
    scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
    granted: true,
    [SCOPE_AUTHORIZATION_DECISION_BRAND]: true,
  };

  it('미피킹 수량을 강제로 채워 출고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );

      const state = await service.forceComplete(
        fixture.shipmentId,
        {
          reason: '재고 실물 확인 후 스캔 생략',
          actor,
          idempotencyKey: `force-${randomUUID()}`,
          authorization,
        },
        tx,
      );

      expect(state.status).toBe('shipped');
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
        .limit(1);
      expect(line.inspectedQty).toBe(2);
      expect(line.forced).toBe(true);

      // 리뷰 지적 5: forceComplete 도 scan 과 같은 dispatch 경로(inspectShipmentLines →
      // 자동 dispatch)를 타므로 같은 원장 효과를 낸다 — 스캔 생략 경로가 이 보장을
      // 우회하지 않는지 여기서도 직접 확인한다.
      const shipEvents = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(
          and(
            eq(wmsTables.stockEvents.skuId, fixture.skuId),
            eq(wmsTables.stockEvents.transitionType, 'SHIP'),
            eq(wmsTables.stockEvents.fromWarehouseId, fixture.warehouseId),
          ),
        );
      expect(shipEvents).toHaveLength(1);
      expect(shipEvents[0].quantity).toBe(fixture.qty);

      const [reservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.shipmentLineId));
      expect(reservation.status).toBe('released');
    });
  });

  it('강제출고 스코프가 없으면 403 이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 1);
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.forceComplete(
          fixture.shipmentId,
          {
            reason: '권한 없음 확인',
            actor: { id: fixture.actorId, roles: ['logistics_worker'] },
            idempotencyKey: `force-${randomUUID()}`,
            authorization: undefined,
          },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_DISPATCH_FORCE_FORBIDDEN' } });
    });
  });
});

describeIfDb('SimpleOutboundService.scan — 두 라인', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  // 리뷰 지적 6: 모든 기존 픽스처가 라인 하나뿐이라 settleIfFullyPicked 의
  // "라인 A 는 다 찼지만 라인 B 는 아직 → return null" 분기(completePick 을 막는
  // 그 자체)를 어떤 테스트도 밟지 않았다. 두 라인 shipment 로 그 분기를 직접 검증한다.
  it('한 라인만 다 찬 상태에서는 완료·출고되지 않고, 나머지 라인까지 차야 출고된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 1);
      const second = await addSecondSimpleOutboundLine(tx, fixture, 1);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const afterLineA = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-a-${randomUUID()}` },
        tx,
      );

      expect(afterLineA.status).toBe('in_progress');
      expect(afterLineA.workItemStatus).toBe('picking');
      const [shipmentAfterA] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipmentId))
        .limit(1);
      expect(shipmentAfterA.status).not.toBe('shipped');
      const [workItemAfterA] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId))
        .limit(1);
      // completePick 이 잘못 불렸다면 여기서 'ready_to_pack' 이 됐을 것이다.
      expect(workItemAfterA.status).toBe('picking');

      const afterLineB = await service.scan(
        fixture.shipmentId,
        { barcode: second.barcode, quantity: 1, actor, idempotencyKey: `scan-b-${randomUUID()}` },
        tx,
      );

      expect(afterLineB.status).toBe('shipped');
      const [shipmentAfterB] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipmentId))
        .limit(1);
      expect(shipmentAfterB.status).toBe('shipped');
    });
  });
});
