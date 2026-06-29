import { wmsTables } from '../../inventory/schema/inventory.schema';
import { OutboundConsumptionService } from './outbound-consumption.service';

/**
 * OutboundConsumptionService 단위 테스트 (mock db).
 * 실제 FIFO SQL·원장 차감·available 불변은 통합(`outbound-consumption.integration.spec.ts`,
 * dev 환경 부재로 보류)에서 검증. 여기서는 Phase 1 의 오케스트레이션 결정을 고정한다:
 *   - 상자 라인이 소진 단위 (FOI 가 아니라)
 *   - SHIP 이벤트가 한 journal 로 묶여 작업자(openedBy)에게 귀속
 *   - 라인별 idempotencyKey = ship:{shipmentId}:{lineId}:{locationId}
 */
describe('OutboundConsumptionService', () => {
  type FakeState = {
    shipments: Array<Record<string, any>>;
    fulfillmentOrders: Array<Record<string, any>>;
    fulfillmentOrderItems: Array<Record<string, any>>;
    shipmentLines: Array<Record<string, any>>;
    stockJournals: Array<Record<string, any>>;
  };

  function makeTx(state: FakeState) {
    const rowsFor = (table: unknown) => {
      if (table === wmsTables.shipments) return state.shipments;
      if (table === wmsTables.fulfillmentOrders) return state.fulfillmentOrders;
      if (table === wmsTables.fulfillmentOrderItems) return state.fulfillmentOrderItems;
      if (table === wmsTables.shipmentLines) return state.shipmentLines;
      if (table === wmsTables.stockJournals) return state.stockJournals;
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

    const service = new OutboundConsumptionService(
      db as any,
      locationStrategy as any,
      inventoryCommand as any,
      reservationLifecycle as any,
    );
    return { service, tx, state, locationStrategy, inventoryCommand, reservationLifecycle };
  }

  describe('ensureShipmentLines', () => {
    it('FOI 를 미러한 상자 라인을 만든다 (qty = shippedQty)', async () => {
      const state: FakeState = {
        shipments: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-1', skuId: 'sku-1', shippedQty: 3 },
          { id: 'foi-2', fulfillmentOrderId: 'fo-1', skuId: 'sku-2', shippedQty: 5 },
        ],
        shipmentLines: [],
        stockJournals: [],
      };
      const { service } = makeService(state);

      await service.ensureShipmentLines('ship-1', 'fo-1');

      expect(state.shipmentLines).toEqual([
        expect.objectContaining({ shipmentId: 'ship-1', fulfillmentOrderItemId: 'foi-1', skuId: 'sku-1', qty: 3 }),
        expect.objectContaining({ shipmentId: 'ship-1', fulfillmentOrderItemId: 'foi-2', skuId: 'sku-2', qty: 5 }),
      ]);
    });

    it('shippedQty<=0 인 FOI 는 라인을 만들지 않는다', async () => {
      const state: FakeState = {
        shipments: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: 'fo-1', skuId: 'sku-1', shippedQty: 0 }],
        shipmentLines: [],
        stockJournals: [],
      };
      const { service } = makeService(state);

      await service.ensureShipmentLines('ship-1', 'fo-1');

      expect(state.shipmentLines).toHaveLength(0);
    });
  });

  describe('consumeShipment', () => {
    const baseState = (): FakeState => ({
      shipments: [{ id: 'ship-1', fulfillmentOrderId: 'fo-1', openedBy: 'op-9' }],
      fulfillmentOrders: [{ id: 'fo-1', warehouseId: 'wh-1' }],
      fulfillmentOrderItems: [],
      shipmentLines: [{ id: 'sl-1', skuId: 'sku-1', qty: 3 }],
      stockJournals: [],
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
  });
});
