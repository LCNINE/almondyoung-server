import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FULFILLMENT_EVENTS } from '../events';
import { OutboundConsumptionService } from './outbound-consumption.service';

/**
 * OutboundConsumptionService 단위 테스트 (mock db).
 * 실제 FIFO SQL·원장 차감·available 불변은 통합(`outbound-consumption.integration.spec.ts`,
 * dev 환경 부재로 보류)에서 검증. 여기서는 종결 seam(EU2)의 오케스트레이션 결정을 고정한다:
 *   - 상자 라인이 소진 단위 (FOI 가 아니라)
 *   - SHIP 이벤트가 한 journal 로 묶여 작업자(openedBy)에게 귀속
 *   - 라인별 idempotencyKey = ship:{shipmentId}:{lineId}:{locationId}
 *   - FOI.shippedQty 누적 + FOI/박스 status 전이 + FulfillmentShipped 이벤트 발행
 *   - 박스가 이미 'shipped' 면 멱등 early-return (원장 무영향)
 */
describe('OutboundConsumptionService', () => {
  type FakeState = {
    shipments: Array<Record<string, any>>;
    fulfillmentOrders: Array<Record<string, any>>;
    fulfillmentOrderItems: Array<Record<string, any>>;
    shipmentLines: Array<Record<string, any>>;
    stockJournals: Array<Record<string, any>>;
    invoices: Array<Record<string, any>>;
    salesOrders: Array<Record<string, any>>;
  };

  function makeTx(state: FakeState) {
    const rowsFor = (table: unknown) => {
      if (table === wmsTables.shipments) return state.shipments;
      if (table === wmsTables.fulfillmentOrders) return state.fulfillmentOrders;
      if (table === wmsTables.fulfillmentOrderItems) return state.fulfillmentOrderItems;
      if (table === wmsTables.shipmentLines) return state.shipmentLines;
      if (table === wmsTables.stockJournals) return state.stockJournals;
      if (table === wmsTables.invoices) return state.invoices;
      if (table === wmsTables.salesOrders) return state.salesOrders;
      return [];
    };

    const tx: any = {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => {
            const result: any = [...rowsFor(table)];
            result.limit = (n: number) => result.slice(0, n);
            return result;
          },
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (value: any) => {
          const values = Array.isArray(value) ? value : [value];
          const apply = () => {
            if (table === wmsTables.shipmentLines) {
              const inserted = values.map((v, i) => ({ id: `sl-ins-${state.shipmentLines.length + i + 1}`, ...v }));
              state.shipmentLines.push(...inserted);
              return inserted;
            }
            if (table === wmsTables.stockJournals) {
              const inserted = values.map((v, i) => ({ id: `journal-${state.stockJournals.length + i + 1}`, ...v }));
              state.stockJournals.push(...inserted);
              return inserted;
            }
            return [];
          };
          const onConflictDoNothing = () => {
            const inserted = apply();
            const thenable: any = Promise.resolve(inserted);
            thenable.returning = () => Promise.resolve(inserted);
            return thenable;
          };
          return { onConflictDoNothing };
        },
      })),
      update: jest.fn((table: unknown) => ({
        set: (values: any) => ({
          // predicate 는 mock 에서 무시 — 해당 테이블의 모든 행을 갱신(테스트는 행 1개씩).
          where: () => {
            for (const row of rowsFor(table)) Object.assign(row, values);
            return Promise.resolve(undefined);
          },
        }),
      })),
    };
    return tx;
  }

  function makeService(
    state: FakeState,
    chunks: Array<{ locationId: string; qty: number }> = [{ locationId: 'loc-1', qty: 1 }],
  ) {
    const tx = makeTx(state);
    const db = { run: jest.fn((fn: (t: any) => any, aTx?: any) => fn(aTx ?? tx)) };
    const locationStrategy = { resolve: jest.fn().mockResolvedValue(chunks) };
    const inventoryCommand = { ship: jest.fn().mockResolvedValue({ eventId: 'evt' }) };
    const reservationLifecycle = { consumeFulfillmentOrderReservations: jest.fn().mockResolvedValue(undefined) };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const service = new OutboundConsumptionService(
      db as any,
      locationStrategy as any,
      inventoryCommand as any,
      reservationLifecycle as any,
      outbox as any,
    );
    return { service, tx, state, locationStrategy, inventoryCommand, reservationLifecycle, outbox };
  }

  describe('consumeShipment', () => {
    const baseState = (): FakeState => ({
      // shipment select 의 alias(foId/warehouseId/status/openedBy)를 키로 저장 (mock 은 projection 무시).
      shipments: [{ id: 'ship-1', foId: 'fo-1', warehouseId: 'wh-1', openedBy: 'op-9', status: 'open' }],
      fulfillmentOrders: [{ id: 'fo-1', salesOrderId: 'so-1', status: 'open' }],
      fulfillmentOrderItems: [{ id: 'foi-1', qty: 3, shippedQty: 0, status: 'pending' }],
      shipmentLines: [{ id: 'sl-1', foiId: 'foi-1', skuId: 'sku-1', qty: 3 }],
      stockJournals: [],
      invoices: [{ id: 'inv-1', shipmentId: 'ship-1', status: 'used', trackingNo: 'TRACK-1', carrier: 'CJ' }],
      salesOrders: [{ id: 'so-1', channelOrderId: 'co-1' }],
    });

    it('상자 라인을 작업자(openedBy)에게 귀속된 한 journal 로 묶어 SHIP 한다', async () => {
      const state = baseState();
      const { service, inventoryCommand } = makeService(state, [{ locationId: 'loc-1', qty: 3 }]);

      await service.consumeShipment('ship-1');

      // journal 1건: SHIPMENT 출처 + 작업자 귀속
      expect(state.stockJournals).toEqual([
        expect.objectContaining({
          sourceType: 'SHIPMENT',
          sourceId: 'ship-1',
          actorId: 'op-9',
          idempotencyKey: 'ship:ship-1',
        }),
      ]);
      const journalId = state.stockJournals[0].id;
      // SHIP 이 그 journal 로 묶이고, 라인 단위 멱등키를 쓴다.
      expect(inventoryCommand.ship).toHaveBeenCalledTimes(1);
      expect(inventoryCommand.ship).toHaveBeenCalledWith(
        expect.objectContaining({
          skuId: 'sku-1',
          warehouseId: 'wh-1',
          locationId: 'loc-1',
          quantity: 3,
          idempotencyKey: 'ship:ship-1:sl-1:loc-1',
          journalId,
        }),
        expect.anything(),
      );
    });

    it('예약을 소진한다 (환원 아님)', async () => {
      const state = baseState();
      const { service, reservationLifecycle } = makeService(state, [{ locationId: 'loc-1', qty: 3 }]);

      await service.consumeShipment('ship-1');

      expect(reservationLifecycle.consumeFulfillmentOrderReservations).toHaveBeenCalledWith('fo-1', expect.anything());
    });

    it('openedBy 가 없으면 actorId 는 null (무귀속)', async () => {
      const state = baseState();
      state.shipments[0].openedBy = null;
      const { service } = makeService(state, [{ locationId: 'loc-1', qty: 3 }]);

      await service.consumeShipment('ship-1');

      expect(state.stockJournals[0]).toEqual(expect.objectContaining({ actorId: null }));
    });

    it('FOI.shippedQty 를 누적하고(0→3) qty 충족 시 FOI/박스 status 를 shipped 로 전이한다', async () => {
      const state = baseState();
      const { service } = makeService(state, [{ locationId: 'loc-1', qty: 3 }]);

      await service.consumeShipment('ship-1');

      expect(state.fulfillmentOrderItems[0].shippedQty).toBe(3);
      expect(state.fulfillmentOrderItems[0].status).toBe('shipped');
      expect(state.shipments[0].status).toBe('shipped');
      expect(state.shipments[0].shippedAt).toBeInstanceOf(Date);
      expect(state.fulfillmentOrders[0].status).toBe('shipped');
    });

    it('FulfillmentShipped 이벤트를 발행한다 (active invoice 의 trackingNo/carrier 사용)', async () => {
      const state = baseState();
      const { service, outbox } = makeService(state, [{ locationId: 'loc-1', qty: 3 }]);

      await service.consumeShipment('ship-1');

      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: FULFILLMENT_EVENTS.SHIPPED,
          aggregateType: 'fulfillment',
          aggregateId: 'fo-1',
          payload: expect.objectContaining({
            fulfillmentId: 'fo-1',
            orderId: 'so-1',
            channelOrderId: 'co-1',
            trackingInfo: expect.objectContaining({ carrier: 'CJ', trackingNumber: 'TRACK-1' }),
            shippedItems: [expect.objectContaining({ fulfillmentItemId: 'foi-1', skuId: 'sku-1', shippedQty: 3 })],
          }),
        }),
        expect.anything(),
      );
    });

    it('박스가 이미 shipped 면 멱등 early-return — 원장/예약/이벤트 무영향', async () => {
      const state = baseState();
      state.shipments[0].status = 'shipped';
      const { service, inventoryCommand, reservationLifecycle, outbox } = makeService(state, [
        { locationId: 'loc-1', qty: 3 },
      ]);

      await service.consumeShipment('ship-1');

      expect(inventoryCommand.ship).not.toHaveBeenCalled();
      expect(reservationLifecycle.consumeFulfillmentOrderReservations).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(state.stockJournals).toHaveLength(0);
    });
  });
});
