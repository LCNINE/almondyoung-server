import { ConflictException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentService } from './shipment.service';

/**
 * ShipmentService 단위 테스트 (mock db).
 *
 * 박스 lazy open(송장 스캔) / 검수 스캔 누적 + 전 라인 완료 시 consumeShipment 자동발사 /
 * 강제출고 override 의 오케스트레이션 결정을 고정한다. 실제 원장 차감·FIFO 는
 * OutboundConsumptionService(EU2) 가 책임지므로 여기선 consume 호출/미호출만 검증한다.
 */
describe('ShipmentService', () => {
  type FakeState = {
    shipments: Array<Record<string, any>>;
    shipmentLines: Array<Record<string, any>>;
    invoices: Array<Record<string, any>>;
    fulfillmentOrders: Array<Record<string, any>>;
    fulfillmentOrderItems: Array<Record<string, any>>;
    skus: Array<Record<string, any>>;
  };

  type FakeTx = {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    inserts: Array<{ table: unknown; values: Array<Record<string, any>> }>;
    updates: Array<{ table: unknown; set: Record<string, any> }>;
  };

  function makeTx(state: FakeState): FakeTx {
    let seq = 0;
    const rowsFor = (table: unknown): Array<Record<string, any>> => {
      if (table === wmsTables.shipments) return state.shipments;
      if (table === wmsTables.shipmentLines) return state.shipmentLines;
      if (table === wmsTables.invoices) return state.invoices;
      if (table === wmsTables.fulfillmentOrders) return state.fulfillmentOrders;
      if (table === wmsTables.fulfillmentOrderItems) return state.fulfillmentOrderItems;
      if (table === wmsTables.skus) return state.skus;
      return [];
    };

    const inserts: FakeTx['inserts'] = [];
    const updates: FakeTx['updates'] = [];

    const tx: FakeTx = {
      inserts,
      updates,
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          // .where() 어디서 끊겨도(.for('update').limit(n) 또는 그냥 await) 동작하는 result
          where: () => {
            const result: any = [...rowsFor(table)];
            result.for = () => result; // .for('update') → 같은 체이너블 배열
            result.limit = (n: number) => result.slice(0, n);
            return result;
          },
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (value: any) => {
          const values = Array.isArray(value) ? value : [value];
          inserts.push({ table, values });
          const inserted = values.map((v) => ({ id: `ins-${++seq}`, ...v }));
          rowsFor(table).push(...inserted);
          return {
            returning: () => inserted,
            onConflictDoNothing: () => Promise.resolve(undefined),
          };
        },
      })),
      update: jest.fn((table: unknown) => ({
        set: (values: any) => ({
          // predicate 는 mock 에서 무시 — set 페이로드만 캡처(서비스가 계산한 값 검증).
          where: () => {
            updates.push({ table, set: values });
            return Promise.resolve(undefined);
          },
        }),
      })),
    };
    return tx;
  }

  function makeService(state: FakeState) {
    const tx = makeTx(state);
    const db = { run: jest.fn((fn: (t: any) => any, aTx?: any) => fn(aTx ?? tx)) };
    const barcode = { parseBarcode: jest.fn() };
    const consume = { consumeShipment: jest.fn().mockResolvedValue(undefined) };

    const service = new ShipmentService(db as any, barcode as any, consume as any);
    return { service, tx, state, barcode, consume };
  }

  describe('openBoxByScan', () => {
    const baseState = (): FakeState => ({
      shipments: [],
      shipmentLines: [],
      // invoices select alias: { id, foId, status, shipmentId } 키로 저장 (mock 은 projection 무시).
      invoices: [{ id: 'inv-1', foId: 'fo-1', status: 'issued', shipmentId: null }],
      // fulfillmentOrders select alias: { id, warehouseId, mode }.
      fulfillmentOrders: [{ id: 'fo-1', warehouseId: 'wh-1', mode: 'normal' }],
      // fulfillmentOrderItems select alias: { id, skuId, qty, shippedQty }.
      fulfillmentOrderItems: [{ id: 'foi-1', skuId: 'sku-1', qty: 3, shippedQty: 0 }],
      skus: [],
    });

    it('issued 송장 스캔 → 박스 open + 송장 used 전이 + 라인 미러 + shipmentId 반환', async () => {
      const state = baseState();
      const { service, tx } = makeService(state);

      const result = await service.openBoxByScan('TRACK-1', 'op-1');

      // shipment insert(status:open, openedBy, openedForFulfillmentOrderId, warehouseId)
      const shipmentInsert = tx.inserts.find((i) => i.table === wmsTables.shipments);
      expect(shipmentInsert?.values[0]).toEqual(
        expect.objectContaining({
          status: 'open',
          openedBy: 'op-1',
          openedForFulfillmentOrderId: 'fo-1',
          warehouseId: 'wh-1',
        }),
      );
      // invoice update(status:used, shipmentId)
      const invoiceUpdate = tx.updates.find((u) => u.table === wmsTables.invoices);
      expect(invoiceUpdate?.set).toEqual(
        expect.objectContaining({ status: 'used', shipmentId: result.shipmentId }),
      );
      // shipment_line insert(FOI 미러, inspectedQty:0, forced:false)
      const lineInsert = tx.inserts.find((i) => i.table === wmsTables.shipmentLines);
      expect(lineInsert?.values).toEqual([
        expect.objectContaining({
          fulfillmentOrderItemId: 'foi-1',
          skuId: 'sku-1',
          qty: 3,
          inspectedQty: 0,
          forced: false,
        }),
      ]);
      expect(result.shipmentId).toBeTruthy();
    });

    it('이미 used 송장 → ConflictException', async () => {
      const state = baseState();
      state.invoices[0].status = 'used';
      const { service } = makeService(state);

      await expect(service.openBoxByScan('TRACK-1', 'op-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('FOI{qty:5, shippedQty:2} → line.qty = 잔량(3)', async () => {
      const state = baseState();
      state.fulfillmentOrderItems[0] = { id: 'foi-1', skuId: 'sku-1', qty: 5, shippedQty: 2 };
      const { service, tx } = makeService(state);

      await service.openBoxByScan('TRACK-1', 'op-1');

      const lineInsert = tx.inserts.find((i) => i.table === wmsTables.shipmentLines);
      expect(lineInsert?.values[0].qty).toBe(3);
    });

    it('FOI 가 전부 전량출고(미러 라인 0줄) → Conflict, shipment/invoice write 미발생 (좀비 박스 방어)', async () => {
      const state = baseState();
      // 모든 FOI 가 qty===shippedQty → 잔량 0 → 미러 대상 0줄.
      state.fulfillmentOrderItems[0] = { id: 'foi-1', skuId: 'sku-1', qty: 3, shippedQty: 3 };
      const { service, tx } = makeService(state);

      await expect(service.openBoxByScan('TRACK-1', 'op-1')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.inserts.find((i) => i.table === wmsTables.shipments)).toBeUndefined();
      expect(tx.updates.find((u) => u.table === wmsTables.invoices)).toBeUndefined();
      expect(tx.inserts.find((i) => i.table === wmsTables.shipmentLines)).toBeUndefined();
    });
  });

  describe('inspectScan', () => {
    it('미완료 라인 검수 1개 → inspectedQty 증가, 박스 미완료라 consume 미호출', async () => {
      const state: FakeState = {
        shipments: [{ id: 'ship-1', status: 'open' }],
        shipmentLines: [
          { id: 'sl-1', skuId: 'sku-1', qty: 3, inspectedQty: 0 },
          { id: 'sl-2', skuId: 'sku-2', qty: 1, inspectedQty: 0 },
        ],
        invoices: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [],
        skus: [],
      };
      const { service, tx, barcode, consume } = makeService(state);
      barcode.parseBarcode.mockReturnValue({ type: 'sku', id: 'sku-1' });

      await service.inspectScan('ship-1', 'SKU-sku-1');

      const lineUpdate = tx.updates.find((u) => u.table === wmsTables.shipmentLines);
      expect(lineUpdate?.set).toEqual(expect.objectContaining({ inspectedQty: 1 }));
      expect(consume.consumeShipment).not.toHaveBeenCalled();
    });

    it('마지막 1개 검수로 박스 전 라인 완료 → consumeShipment 자동발사(같은 tx)', async () => {
      const state: FakeState = {
        shipments: [{ id: 'ship-1', status: 'open' }],
        shipmentLines: [{ id: 'sl-1', skuId: 'sku-1', qty: 3, inspectedQty: 2 }],
        invoices: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [],
        skus: [],
      };
      const { service, tx, barcode, consume } = makeService(state);
      barcode.parseBarcode.mockReturnValue({ type: 'sku', id: 'sku-1' });

      await service.inspectScan('ship-1', 'SKU-sku-1');

      const lineUpdate = tx.updates.find((u) => u.table === wmsTables.shipmentLines);
      expect(lineUpdate?.set).toEqual(expect.objectContaining({ inspectedQty: 3 }));
      expect(consume.consumeShipment).toHaveBeenCalledWith('ship-1', tx);
    });

    it('박스가 open 이 아니면 ConflictException', async () => {
      const state: FakeState = {
        shipments: [{ id: 'ship-1', status: 'shipped' }],
        shipmentLines: [{ id: 'sl-1', skuId: 'sku-1', qty: 3, inspectedQty: 0 }],
        invoices: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [],
        skus: [],
      };
      const { service, barcode, consume } = makeService(state);
      barcode.parseBarcode.mockReturnValue({ type: 'sku', id: 'sku-1' });

      await expect(service.inspectScan('ship-1', 'SKU-sku-1')).rejects.toBeInstanceOf(ConflictException);
      expect(consume.consumeShipment).not.toHaveBeenCalled();
    });

    it('quantity 가 잔량을 초과해도 inspectedQty 는 qty 상한에서 멈춘다', async () => {
      const state: FakeState = {
        shipments: [{ id: 'ship-1', status: 'open' }],
        shipmentLines: [{ id: 'sl-1', skuId: 'sku-1', qty: 3, inspectedQty: 2 }],
        invoices: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [],
        skus: [],
      };
      const { service, tx, barcode } = makeService(state);
      barcode.parseBarcode.mockReturnValue({ type: 'sku', id: 'sku-1' });

      await service.inspectScan('ship-1', 'SKU-sku-1', 5);

      const lineUpdate = tx.updates.find((u) => u.table === wmsTables.shipmentLines);
      expect(lineUpdate?.set).toEqual(expect.objectContaining({ inspectedQty: 3 }));
    });
  });

  describe('forceShipment', () => {
    const lineUpdates = (tx: FakeTx) => tx.updates.filter((u) => u.table === wmsTables.shipmentLines);

    it('박스 전체 강제(foiId 미지정) → 전 라인 forced + inspectedQty=qty, consume 발사', async () => {
      const state: FakeState = {
        shipments: [{ id: 'ship-1', status: 'open' }],
        shipmentLines: [
          { id: 'sl-1', foiId: 'foi-1', qty: 3, inspectedQty: 0 },
          { id: 'sl-2', foiId: 'foi-2', qty: 1, inspectedQty: 0 },
        ],
        invoices: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [],
        skus: [],
      };
      const { service, tx, consume } = makeService(state);

      await service.forceShipment('ship-1', undefined, 'op-1');

      const updates = lineUpdates(tx);
      expect(updates).toHaveLength(2);
      expect(updates.map((u) => u.set)).toEqual([
        expect.objectContaining({ inspectedQty: 3, forced: true }),
        expect.objectContaining({ inspectedQty: 1, forced: true }),
      ]);
      expect(consume.consumeShipment).toHaveBeenCalledWith('ship-1', tx);
    });

    it('foiId 지정 → 그 라인만 강제, 나머지 미완료면 consume 미호출', async () => {
      const state: FakeState = {
        shipments: [{ id: 'ship-1', status: 'open' }],
        shipmentLines: [
          { id: 'sl-1', foiId: 'foi-1', qty: 3, inspectedQty: 0 },
          { id: 'sl-2', foiId: 'foi-2', qty: 1, inspectedQty: 0 },
        ],
        invoices: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [],
        skus: [],
      };
      const { service, tx, consume } = makeService(state);

      await service.forceShipment('ship-1', 'foi-1', 'op-1');

      const updates = lineUpdates(tx);
      expect(updates).toHaveLength(1);
      expect(updates[0].set).toEqual(expect.objectContaining({ inspectedQty: 3, forced: true }));
      expect(consume.consumeShipment).not.toHaveBeenCalled();
    });

    it('박스가 open 이 아니면 ConflictException', async () => {
      const state: FakeState = {
        shipments: [{ id: 'ship-1', status: 'shipped' }],
        shipmentLines: [{ id: 'sl-1', foiId: 'foi-1', qty: 3, inspectedQty: 0 }],
        invoices: [],
        fulfillmentOrders: [],
        fulfillmentOrderItems: [],
        skus: [],
      };
      const { service, consume } = makeService(state);

      await expect(service.forceShipment('ship-1', undefined, 'op-1')).rejects.toBeInstanceOf(ConflictException);
      expect(consume.consumeShipment).not.toHaveBeenCalled();
    });
  });
});
