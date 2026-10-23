import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  seedHolder,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
} from '../../fulfillment/services/__support__';
import { canonicalFulfillmentRequestHash } from '../../fulfillment/services/fulfillment-command.service';
import { seedChannelOrder, wireCancelRequest } from '../channel-cancel-request/__support__/cancel-request.fixtures';
import { ChannelCancelRequestService } from '../channel-cancel-request/channel-cancel-request.service';
import { WalletRefundClient } from './wallet-refund.client';
import { StoreSalesOrdersService } from './store-sales-orders.service';
import { CancellationRefundManager } from '../cancellation-refund/cancellation-refund.manager';
import { OrderCancellation } from '../order-cancellation/order-cancellation';
import { OrderCancellationReader } from '../order-cancellation/order-cancellation.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('셀프취소 판정 — 복구 중 상자 (DB integration, rollback-only, #1016 33번)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  // 취소 대기로 간 상자: 상자는 recovery_required, 예약 재계산이 FO 도 recovery_required 로 투영해 둔 상태
  async function seedOrderWithRecoveryBox(tx: DbTx, customerId: string) {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
    const [so] = await tx
      .update(wmsTables.salesOrders)
      .set({ customerId })
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId, warehouseId, status: 'recovery_required', totalItems: 1, totalQty: 1 })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fulfillmentOrder.id,
        salesOrderId,
        salesOrderLineId: lineIds[0],
        skuId,
        qty: 1,
        status: 'recovery_required',
      })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({ warehouseId, status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' })
      .returning();
    await tx
      .insert(wmsTables.shipmentLines)
      .values({ shipmentId: shipment.id, fulfillmentOrderItemId: item.id, skuId, qty: 1 });
    return { so, fulfillmentOrderId: fulfillmentOrder.id, shipmentId: shipment.id };
  }

  it('버튼은 숨고 사유는 already_processing, 요청은 400 으로 거절되며 상자·판매주문은 그대로다', async () => {
    await inRollbackTx(db, async (tx) => {
      const customerId = randomUUID();
      const { so, fulfillmentOrderId, shipmentId } = await seedOrderWithRecoveryBox(tx, customerId);
      const cancelRequests = {
        settlementFactsFor: jest.fn().mockResolvedValue([]),
        findBySourceKey: jest.fn().mockResolvedValue(null),
        precheck: jest.fn(),
        request: jest.fn(),
      };
      const printCancellation = { cancelForOrder: jest.fn() };
      const db = { db: tx, run: <T>(fn: (trx: typeof tx) => Promise<T>) => fn(tx) };
      const salesOrders = {};
      const printOrders = { forSalesOrder: () => Promise.resolve([]) };
      const service = new StoreSalesOrdersService(
        db as never,
        salesOrders as never,
        {} as WalletRefundClient,
        cancelRequests as never,
        printOrders as never,
        printCancellation as never,
        new OrderCancellation(
          db as never,
          salesOrders as never,
          cancelRequests as never,
          printOrders as never,
          printCancellation as never,
          {} as never,
          new OrderCancellationReader(),
          new CancellationRefundManager(db as never, salesOrders as never, {} as WalletRefundClient),
        ),
        new CancellationRefundManager(db as never, salesOrders as never, {} as WalletRefundClient),
      );

      const view = await service.getActionsByChannelOrder(so.channelOrderId, customerId);
      expect(view.availableActions).toEqual(['receipt']);
      expect(view.cancelUnavailableReason).toBe('already_processing');

      const error = await service
        .cancelRequestByChannelOrder(
          so.channelOrderId,
          customerId,
          {},
          { idempotencyKey: `self-cancel-${randomUUID()}`, actorId: customerId, actorRoles: [] },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe('처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.');
      expect(cancelRequests.precheck).not.toHaveBeenCalled();
      expect(cancelRequests.request).not.toHaveBeenCalled();
      expect(printCancellation.cancelForOrder).not.toHaveBeenCalled();

      const [shipment] = await tx
        .select({ status: wmsTables.shipments.status, recoveryCode: wmsTables.shipments.recoveryCode })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId));
      expect(shipment).toEqual({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      const [salesOrder] = await tx
        .select({ status: wmsTables.salesOrders.status })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, so.id));
      expect(salesOrder.status).toBe(so.status);
      const [fo] = await tx
        .select({ status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
      expect(fo.status).toBe('recovery_required');
    });
  });

  // 스펙 §6.10: 버튼 판정 → 요청 → 취소 요청 경로(ChannelCancelRequestManager)까지 실제로 탄다. 끝은 §6.1 과 같다.
  it('planned 상자만 있는 주문은 버튼이 보이고, 요청하면 송장 voided·상자 canceled·예약 0·판매주문 cancelled 로 끝난다', async () => {
    await inRollbackTx(db, async (tx) => {
      const customerId = randomUUID();
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await tx.update(wmsTables.salesOrders).set({ customerId }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      const boxLines = await tx
        .select({ id: wmsTables.shipmentLines.id, shipmentId: wmsTables.shipmentLines.shipmentId })
        .from(wmsTables.shipmentLines)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.salesOrderId, seed.salesOrderId));
      const shipmentIds = [...new Set(boxLines.map((line) => line.shipmentId))];
      expect(shipmentIds).toHaveLength(1);
      const [shipment] = await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned', plannedAt: new Date() })
        .where(eq(wmsTables.shipments.id, shipmentIds[0]))
        .returning();
      const [waybill] = await tx
        .insert(wmsTables.waybills)
        .values({
          shipmentId: shipment.id,
          source: 'manual',
          carrier: 'HANJIN',
          status: 'registered',
          trackingNo: `self-cancel-tracking-${randomUUID()}`,
          manifestVersion: shipment.manifestVersion,
          recipientHash: canonicalFulfillmentRequestHash(shipment.recipientSnapshot),
        })
        .returning();
      const db = { db: tx, run: <T>(fn: (trx: typeof tx) => Promise<T>) => fn(tx) };
      const cancelRequests = new ChannelCancelRequestService(w.dbService, w.manager, w.reader);
      const printOrders = { forSalesOrder: () => Promise.resolve([]) };
      const printCancellation = {
        cancelForOrder: jest.fn().mockResolvedValue({ vendorCancelled: [], locallyCancelled: [] }),
        noteSalesCancelFailed: jest.fn(),
      };
      const service = new StoreSalesOrdersService(
        db as never,
        w.salesOrders,
        {} as WalletRefundClient,
        cancelRequests,
        printOrders as never,
        printCancellation as never,
        new OrderCancellation(
          db as never,
          w.salesOrders,
          cancelRequests,
          printOrders as never,
          printCancellation as never,
          {} as never,
          new OrderCancellationReader(),
          new CancellationRefundManager(db as never, w.salesOrders, {} as WalletRefundClient),
        ),
        new CancellationRefundManager(db as never, w.salesOrders, {} as WalletRefundClient),
      );

      const before = await service.getActionsByChannelOrder(seed.externalOrderId, customerId);
      expect(before.availableActions).toContain('cancel');
      expect(before.cancelUnavailableReason).toBeUndefined();

      await service.cancelRequestByChannelOrder(
        seed.externalOrderId,
        customerId,
        {},
        { idempotencyKey: `self-cancel-${randomUUID()}`, actorId: customerId, actorRoles: [] },
      );

      const [salesOrder] = await tx
        .select({ status: wmsTables.salesOrders.status })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(salesOrder.status).toBe('cancelled');
      const [boxAfter] = await tx
        .select({ status: wmsTables.shipments.status, recoveryCode: wmsTables.shipments.recoveryCode })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipment.id));
      expect(boxAfter).toEqual({ status: 'canceled', recoveryCode: null });
      const [waybillAfter] = await tx
        .select({ status: wmsTables.waybills.status })
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.id, waybill.id));
      expect(waybillAfter.status).toBe('voided');
      const confirmed = await tx
        .select({ id: wmsTables.stockReservations.id })
        .from(wmsTables.stockReservations)
        .where(
          and(
            inArray(
              wmsTables.stockReservations.shipmentLineId,
              boxLines.map((line) => line.id),
            ),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      expect(confirmed).toEqual([]);
    });
  });
});
