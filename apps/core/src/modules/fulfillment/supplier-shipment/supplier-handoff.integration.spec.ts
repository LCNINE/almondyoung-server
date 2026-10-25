import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { SupplierHandoffService, supplierSheetFileName } from './supplier-handoff.service';
import { SUPPLIER_SHEET_COLUMNS } from './supplier-sheet.columns';
import { SupplierHandoffEmptyError, SupplierHandoffRecipientIncompleteError } from './supplier-shipment.errors';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describe('supplierSheetFileName', () => {
  it('KST yyyyMMdd-HHmm — UTC 15:30 은 다음 날 00:30', () => {
    expect(supplierSheetFileName('입점사 A', new Date('2026-10-25T15:30:00.000Z'))).toBe(
      '직배_입점사 A_20261026-0030.xlsx',
    );
  });
  it('파일명에 못 쓰는 글자는 _ 로', () => {
    expect(supplierSheetFileName('a/b:c', new Date('2026-10-25T03:00:00.000Z'))).toBe('직배_a_b_c_20261025-1200.xlsx');
  });
});

describeIfDb('넘김과 직배 시트 (K3 PR5, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let service: SupplierHandoffService;

  beforeAll(() => {
    service = new SupplierHandoffService(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function item(tx: DbTx, w: f.World, productName: string) {
    const order = await f.seedOrder(tx);
    await tx
      .update(wmsTables.salesOrders)
      .set({ displayOrderNo: `NO-${productName}` })
      .where(eq(wmsTables.salesOrders.id, order.salesOrderId));
    const fo = await f.seedFo(tx, w, order);
    return { ...order, foItemId: fo.foItemId };
  }

  async function recipient(tx: DbTx, shipmentId: string, name: string) {
    await tx
      .update(wmsTables.shipments)
      .set({
        recipientSnapshot: {
          recipientName: name,
          phone: '010-1111-2222',
          postalCode: '04524',
          roadAddress: '서울 중구 세종대로 110',
          detailAddress: '3층',
          deliveryNote: '문 앞',
        },
        entrancePassword: '#1234',
      })
      .where(eq(wmsTables.shipments.id, shipmentId));
  }

  async function world(tx: DbTx) {
    const w = await f.seedWorld(tx);
    await tx.update(wmsTables.skus).set({ name: 'p1' }).where(eq(wmsTables.skus.id, w.skuId));
    const a = await f.seedDirectSupplier(tx);
    const b = await f.seedDirectSupplier(tx);
    await tx.insert(wmsTables.skuSuppliers).values({ skuId: w.skuId, supplierId: a, supplierSku: 'A-SKU-1' });
    const i1 = await item(tx, w, 'p1');
    const i2 = await item(tx, w, 'p2'); // recovery
    const i3 = await item(tx, w, 'p3'); // 이미 넘김
    const i4 = await item(tx, w, 'p4'); // B
    const open = await f.seedBox(tx, w, [i1.foItemId], { status: 'draft', supplierId: a });
    const recovering = await f.seedBox(tx, w, [i2.foItemId], { status: 'draft', supplierId: a, recoveryCode: 'X' });
    const oldHandoff = await f.seedHandoff(tx, a);
    const handed = await f.seedBox(tx, w, [i3.foItemId], {
      status: 'draft',
      supplierId: a,
      supplierHandoffId: oldHandoff,
    });
    const other = await f.seedBox(tx, w, [i4.foItemId], { status: 'draft', supplierId: b });
    await recipient(tx, open.shipmentId, '홍길동');
    return { w, a, b, i1, open, recovering, handed, other, oldHandoff };
  }

  const handoffOf = async (tx: DbTx, id: string) =>
    (
      await tx
        .select({ h: wmsTables.shipments.supplierHandoffId })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, id))
    )[0].h;

  it('넘김은 A 의 넘기지 않은 정상 상자 하나에만 새 묶음을 찍고 그 줄만 시트에', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      const sheet = await service.handOff(x.a, 'op-1', tx);

      expect(sheet.supplierId).toBe(x.a);
      expect(sheet.columns).toEqual(SUPPLIER_SHEET_COLUMNS);
      expect(sheet.rows).toHaveLength(1);
      expect(sheet.rows[0]).toMatchObject({
        rowKey: x.i1.foItemId,
        orderNo: 'NO-p1',
        productName: 'p1',
        supplierSku: 'A-SKU-1',
        qty: 1,
        recipientName: '홍길동',
        recipientPhone: '010-1111-2222',
        entrancePassword: '#1234',
        deliveryMemo: '문 앞',
        carrier: '',
        trackingNo: '',
        unfulfillableReason: '',
        salesOrderId: x.i1.salesOrderId,
      });
      expect(sheet.rows[0].address).toContain('세종대로 110');
      expect(sheet.rows[0].address).toContain('3층');
      expect(sheet.fileName).toMatch(/^직배_.+_\d{8}-\d{4}\.xlsx$/);

      expect(await handoffOf(tx, x.open.shipmentId)).toBe(sheet.handoffId);
      expect(await handoffOf(tx, x.recovering.shipmentId)).toBeNull();
      expect(await handoffOf(tx, x.handed.shipmentId)).toBe(x.oldHandoff);
      expect(await handoffOf(tx, x.other.shipmentId)).toBeNull();
      const [h] = await tx
        .select()
        .from(wmsTables.supplierHandoffs)
        .where(eq(wmsTables.supplierHandoffs.id, sheet.handoffId));
      expect(h).toMatchObject({ supplierId: x.a, createdBy: 'op-1' });
    });
  });

  it('넘길 상자가 없으면 SUPPLIER_HANDOFF_EMPTY', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await service.handOff(x.a, 'op-1', tx);
      await expect(service.handOff(x.a, 'op-1', tx)).rejects.toBeInstanceOf(SupplierHandoffEmptyError);
    });
  });

  it('다시 받기는 같은 줄, 못 보냄 사유가 채워져 있고, 발송된 상자는 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      const first = await service.handOff(x.a, 'op-1', tx);
      await tx
        .update(wmsTables.shipmentLines)
        .set({
          unfulfillableReason: '품절',
          unfulfillableReportedAt: new Date(),
          unfulfillableReportedBy: 'op-supplier',
        })
        .where(eq(wmsTables.shipmentLines.shipmentId, x.open.shipmentId));

      const again = await service.sheet(first.handoffId, tx);
      expect(again.fileName).toBe(first.fileName);
      expect(again.rows.map((r) => r.rowKey)).toEqual([x.i1.foItemId]);
      expect(again.rows[0].unfulfillableReason).toBe('품절');

      await tx
        .update(wmsTables.shipments)
        .set({ status: 'shipped', shippedAt: new Date() })
        .where(eq(wmsTables.shipments.id, x.open.shipmentId));
      expect((await service.sheet(first.handoffId, tx)).rows).toEqual([]);
    });
  });

  it('수령인이 불완전한 상자는 넘기지 않고 skippedShipments 에 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      const i5 = await item(tx, x.w, 'p5');
      const bad = await f.seedBox(tx, x.w, [i5.foItemId], { status: 'draft', supplierId: x.a }); // 스냅샷 없음

      const sheet = await service.handOff(x.a, 'op-1', tx);

      expect(sheet.rows.map((r) => r.rowKey)).toEqual([x.i1.foItemId]);
      expect(sheet.skippedShipments).toEqual([{ shipmentId: bad.shipmentId, reason: 'RECIPIENT_INCOMPLETE' }]);
      expect(await handoffOf(tx, x.open.shipmentId)).toBe(sheet.handoffId);
      expect(await handoffOf(tx, bad.shipmentId)).toBeNull();
    });
  });

  it('후보가 전부 수령인 불완전이면 SUPPLIER_HANDOFF_RECIPIENT_INCOMPLETE 이고 묶음을 만들지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const a = await f.seedDirectSupplier(tx);
      const it1 = await item(tx, w, 'q1');
      const bad = await f.seedBox(tx, w, [it1.foItemId], { status: 'draft', supplierId: a });

      await expect(service.handOff(a, 'op-1', tx)).rejects.toThrow(SupplierHandoffRecipientIncompleteError);
      await expect(service.handOff(a, 'op-1', tx)).rejects.toThrow(bad.shipmentId);
      expect(await handoffOf(tx, bad.shipmentId)).toBeNull();
      const made = await tx
        .select()
        .from(wmsTables.supplierHandoffs)
        .where(eq(wmsTables.supplierHandoffs.supplierId, a));
      expect(made).toEqual([]);
    });
  });

  it('다시 받기: 이 묶음을 가리켜도 recovery_code 상자는 빠지고, 수령인 불완전 상자는 skipped', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      const first = await service.handOff(x.a, 'op-1', tx);
      await tx
        .update(wmsTables.shipments)
        .set({ supplierHandoffId: first.handoffId })
        .where(eq(wmsTables.shipments.id, x.recovering.shipmentId));
      const i6 = await item(tx, x.w, 'p6');
      const bad = await f.seedBox(tx, x.w, [i6.foItemId], {
        status: 'draft',
        supplierId: x.a,
        supplierHandoffId: first.handoffId,
      });

      const again = await service.sheet(first.handoffId, tx);
      expect(again.rows.map((r) => r.rowKey)).toEqual([x.i1.foItemId]);
      expect(again.skippedShipments).toEqual([{ shipmentId: bad.shipmentId, reason: 'RECIPIENT_INCOMPLETE' }]);
    });
  });

  it('다른 입점사와의 sku_suppliers 는 공급사 상품코드에 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await tx.insert(wmsTables.skuSuppliers).values({ skuId: x.w.skuId, supplierId: x.b, supplierSku: 'B-SKU-9' });
      const sheet = await service.handOff(x.a, 'op-1', tx);
      expect(sheet.rows[0].supplierSku).toBe('A-SKU-1');
    });
  });

  it('없는 묶음은 404', async () => {
    await inRollbackTx(db, async (tx) => {
      await expect(service.sheet(randomUUID(), tx)).rejects.toThrow(/not found/i);
    });
  });
});
