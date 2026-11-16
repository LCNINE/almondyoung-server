import * as postgres from 'postgres';
import type { Sql } from 'postgres';
import { BUCHEON_RECEIVING_LOC_ID, BUCHEON_WAREHOUSE_ID, applyStockDelta } from '../stock-delta';
import {
  RECONCILE_SOURCE,
  handoverEventsExist,
  initRun,
  insertHandedOver,
  insertRun,
  loadCoreIndex,
  openRun,
  readCoreFigures,
  reconcileInitExists,
  reconcileTablesExist,
  replacePairs,
  resolveSalesOrders,
  singleRealLocation,
} from './reconcile-store';

/**
 * 셀메이트 저녁 맞추기 저장소(#1304). 모든 케이스는 트랜잭션 안에서 시드하고 끝에 던져 롤백한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'reconcile-store\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

async function seedWarehouse(tx: Sql): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO warehouses (name, type) VALUES (${'TEST-WH-' + uid()}, 'domestic') RETURNING id`;
  return row.id;
}

async function ensureBucheon(tx: Sql): Promise<void> {
  await tx`INSERT INTO warehouses (id, name, type) VALUES (${BUCHEON_WAREHOUSE_ID}, 'TEST-BUCHEON', 'domestic') ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO locations (id, warehouse_id, code, location_type, is_system, system_role)
    VALUES (${BUCHEON_RECEIVING_LOC_ID}, ${BUCHEON_WAREHOUSE_ID}, 'TEST-RECV', 'zone', true, 'inbound_default')
    ON CONFLICT (id) DO NOTHING`;
}

async function seedZone(tx: Sql, warehouseId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO locations (warehouse_id, code, location_type) VALUES (${warehouseId}, ${'TEST-Z-' + uid()}, 'zone') RETURNING id`;
  return row.id;
}

async function seedSku(tx: Sql): Promise<string> {
  const [holder] = await tx<{ id: string }[]>`INSERT INTO holders (name) VALUES ('TEST-HOLDER') RETURNING id`;
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO skus (holder_id, name, code) VALUES (${holder.id}, 'TEST-ITEM', ${'TEST-' + uid()}) RETURNING id`;
  return row.id;
}

async function seedLedger(tx: Sql, skuId: string, warehouseId: string, locationId: string, qty: number) {
  await tx`INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty)
    VALUES (${skuId}, ${warehouseId}, ${locationId}, 'ON_HAND', ${qty})`;
}

async function seedSalesOrder(tx: Sql, channelOrderId = 'TEST-ORD-' + uid()): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO sales_orders (channel_order_id, sales_channel, shipping_address, order_date)
    VALUES (${channelOrderId}, 'medusa', '{}'::json, now()) RETURNING id`;
  return row.id;
}

/** 판매주문 → FO → FO 항목 → 상자 → 상자 라인 → 예약 한 줄 */
async function seedReservation(
  tx: Sql,
  o: { skuId: string; salesOrderId: string; qty: number; status: 'confirmed' | 'pending' },
): Promise<void> {
  const [fo] = await tx<{ id: string }[]>`
    INSERT INTO fulfillment_orders (sales_order_id) VALUES (${o.salesOrderId}) RETURNING id`;
  const [item] = await tx<{ id: string }[]>`
    INSERT INTO fulfillment_order_items (fulfillment_order_id, sku_id, qty)
    VALUES (${fo.id}, ${o.skuId}, ${o.qty}) RETURNING id`;
  const [shipment] = await tx<{ id: string }[]>`
    INSERT INTO shipments (warehouse_id, opened_for_fulfillment_order_id)
    VALUES (${BUCHEON_WAREHOUSE_ID}, ${fo.id}) RETURNING id`;
  const [line] = await tx<{ id: string }[]>`
    INSERT INTO shipment_lines (shipment_id, fulfillment_order_item_id, sku_id, qty)
    VALUES (${shipment.id}, ${item.id}, ${o.skuId}, ${o.qty}) RETURNING id`;
  await tx`INSERT INTO stock_reservations (target_type, target_id, sku_id, warehouse_id, quantity, status, shipment_line_id)
    VALUES ('SHIPMENT_LINE', ${line.id}, ${o.skuId}, ${BUCHEON_WAREHOUSE_ID}, ${o.qty}, ${o.status}, ${line.id})`;
}

async function seedInitRun(tx: Sql, sha = 'a'.repeat(64)): Promise<string> {
  return insertRun(tx, {
    kind: 'init',
    status: 'closed',
    inputSha256: sha,
    inputSnapshotAt: new Date('2026-11-17T00:00:00Z'),
    cutoverAt: null,
    uploadFile: null,
  });
}

describeIfDb('reconcile-store (DB integration)', () => {
  jest.setTimeout(120_000);
  let sql: Sql;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 2, onnotice: () => undefined });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function rolledBack(fn: (tx: Sql) => Promise<void>): Promise<void> {
    // 시드·검증이 던진 진짜 오류가 Rollback 에 가려지지 않게, Rollback 만 정상 종료로 본다
    const outcome = await sql
      .begin(async (tx) => {
        await fn(tx as unknown as Sql);
        throw new Rollback();
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    if (!(outcome instanceof Rollback)) throw outcome ?? new Error('롤백되지 않았다');
  }

  it('테이블이 있고 출처 이름이 고정이다', async () => {
    expect(RECONCILE_SOURCE).toBe('sellmate-reconcile');
    expect(await reconcileTablesExist(sql)).toBe(true);
  });

  describe('readCoreFigures', () => {
    it('부천 ON_HAND 만 합친다(로케이션 2곳 합, 다른 창고 제외)', async () => {
      await rolledBack(async (tx) => {
        await ensureBucheon(tx);
        const other = await seedWarehouse(tx);
        const sku = await seedSku(tx);
        await seedLedger(tx, sku, BUCHEON_WAREHOUSE_ID, await seedZone(tx, BUCHEON_WAREHOUSE_ID), 3);
        await seedLedger(tx, sku, BUCHEON_WAREHOUSE_ID, await seedZone(tx, BUCHEON_WAREHOUSE_ID), 1);
        await seedLedger(tx, sku, other, await seedZone(tx, other), 9);

        const figures = await readCoreFigures(tx, [sku]);

        expect(figures.get(sku)).toEqual({ onHand: 4, reservedAll: 0, reservedHandedOver: 0 });
      });
    });

    it('confirmed 예약만 세고, 넘긴 주문 몫을 따로 센다', async () => {
      await rolledBack(async (tx) => {
        await ensureBucheon(tx);
        const sku = await seedSku(tx);
        const handed = await seedSalesOrder(tx);
        const normal = await seedSalesOrder(tx);
        const pending = await seedSalesOrder(tx);
        await seedReservation(tx, { skuId: sku, salesOrderId: handed, qty: 2, status: 'confirmed' });
        await seedReservation(tx, { skuId: sku, salesOrderId: normal, qty: 1, status: 'confirmed' });
        await seedReservation(tx, { skuId: sku, salesOrderId: pending, qty: 5, status: 'pending' });
        const runId = await seedInitRun(tx);
        await insertHandedOver(tx, runId, [{ salesOrderId: handed, displayId: 1, medusaOrderId: 'TEST-M-1' }]);

        const figures = await readCoreFigures(tx, [sku]);

        expect(figures.get(sku)).toEqual({ onHand: 0, reservedAll: 3, reservedHandedOver: 2 });
      });
    });

    it('빈 목록이면 빈 맵', async () => {
      expect((await readCoreFigures(sql, [])).size).toBe(0);
    });
  });

  describe('singleRealLocation', () => {
    it('비시스템 한 곳에만 있으면 그 id', async () => {
      await rolledBack(async (tx) => {
        await ensureBucheon(tx);
        const sku = await seedSku(tx);
        const loc = await seedZone(tx, BUCHEON_WAREHOUSE_ID);
        await seedLedger(tx, sku, BUCHEON_WAREHOUSE_ID, loc, 2);
        expect(await singleRealLocation(tx, sku)).toBe(loc);
      });
    });

    it('두 곳이면 null', async () => {
      await rolledBack(async (tx) => {
        await ensureBucheon(tx);
        const sku = await seedSku(tx);
        await seedLedger(tx, sku, BUCHEON_WAREHOUSE_ID, await seedZone(tx, BUCHEON_WAREHOUSE_ID), 2);
        await seedLedger(tx, sku, BUCHEON_WAREHOUSE_ID, await seedZone(tx, BUCHEON_WAREHOUSE_ID), 1);
        expect(await singleRealLocation(tx, sku)).toBeNull();
      });
    });

    it('입고기본존에만 있으면 null', async () => {
      await rolledBack(async (tx) => {
        await ensureBucheon(tx);
        const sku = await seedSku(tx);
        await seedLedger(tx, sku, BUCHEON_WAREHOUSE_ID, BUCHEON_RECEIVING_LOC_ID, 2);
        expect(await singleRealLocation(tx, sku)).toBeNull();
      });
    });

    it('재고가 없으면 null', async () => {
      await rolledBack(async (tx) => {
        await ensureBucheon(tx);
        expect(await singleRealLocation(tx, await seedSku(tx))).toBeNull();
      });
    });
  });

  it('applyStockDelta 는 upLocationId 가 있으면 그 로케이션에 늘린다', async () => {
    await rolledBack(async (tx) => {
      await ensureBucheon(tx);
      const sku = await seedSku(tx);
      const loc = await seedZone(tx, BUCHEON_WAREHOUSE_ID);

      await applyStockDelta(tx, { skuId: sku, delta: 2, source: RECONCILE_SOURCE, upLocationId: loc });

      const ledger = await tx`SELECT location_id, qty FROM stock_ledgers WHERE sku_id = ${sku}`;
      expect(ledger.map((r) => [r.location_id, r.qty])).toEqual([[loc, 2]]);
      const events = await tx`SELECT to_location_id, reason FROM stock_events WHERE sku_id = ${sku}`;
      expect(events.map((r) => [r.to_location_id, r.reason])).toEqual([[loc, RECONCILE_SOURCE]]);
    });
  });

  it('applyStockDelta 는 upLocationId 가 없으면 입고기본존에 늘린다(기존 동작)', async () => {
    await rolledBack(async (tx) => {
      await ensureBucheon(tx);
      const sku = await seedSku(tx);
      await applyStockDelta(tx, { skuId: sku, delta: 1, source: RECONCILE_SOURCE });
      const ledger = await tx`SELECT location_id FROM stock_ledgers WHERE sku_id = ${sku}`;
      expect(ledger.map((r) => r.location_id)).toEqual([BUCHEON_RECEIVING_LOC_ID]);
    });
  });

  it('loadCoreIndex 는 바코드의 ="…" 수식 껍질을 벗겨 키로 쓴다', async () => {
    await rolledBack(async (tx) => {
      const sku = await seedSku(tx);
      await tx`INSERT INTO sku_barcodes (sku_id, barcode) VALUES (${sku}, '="8800000000001"')`;

      const index = await loadCoreIndex(tx);

      expect(index.skuIdsByBarcode.get('8800000000001')).toEqual([sku]);
      expect([...index.skuIdByCode.values()]).toContain(sku);
    });
  });

  it('replacePairs 는 짝과 못 지은 품목을 통째로 바꾼다', async () => {
    await rolledBack(async (tx) => {
      const sku = await seedSku(tx);
      await replacePairs(
        tx,
        [
          {
            optionSerial: 'TEST-OPT-1',
            productSerial: 'TEST-P-1',
            name: 'TEST-ITEM',
            barcode: '8800000000001',
            skuId: sku,
            matchedBy: 'code',
          },
        ],
        [
          {
            optionSerial: 'TEST-OPT-2',
            productSerial: 'TEST-P-2',
            name: 'TEST-ITEM',
            barcode: '',
            skuId: null,
            reason: 'empty_barcode',
          },
        ],
      );
      await replacePairs(
        tx,
        [],
        [
          {
            optionSerial: 'TEST-OPT-3',
            productSerial: 'TEST-P-3',
            name: 'TEST-ITEM',
            barcode: '',
            skuId: null,
            reason: 'no_core_sku',
          },
        ],
      );
      const rows = await tx`SELECT option_serial, unpaired_reason FROM sellmate_item_pairs ORDER BY option_serial`;
      expect(rows.map((r) => [r.option_serial, r.unpaired_reason])).toEqual([['TEST-OPT-3', 'no_core_sku']]);
    });
  });

  it('handoverEventsExist 는 sellmate-handover 이벤트가 있어야 true', async () => {
    await rolledBack(async (tx) => {
      await ensureBucheon(tx);
      const sku = await seedSku(tx);
      expect(await handoverEventsExist(tx)).toBe(false);
      await applyStockDelta(tx, { skuId: sku, delta: 1, source: 'sellmate-handover' });
      expect(await handoverEventsExist(tx)).toBe(true);
    });
  });

  it('resolveSalesOrders 는 medusa 주문 id 로 판매주문을 찾는다', async () => {
    await rolledBack(async (tx) => {
      const so = await seedSalesOrder(tx, 'TEST-MEDUSA-ORDER-1');
      const map = await resolveSalesOrders(tx, ['TEST-MEDUSA-ORDER-1', 'TEST-MEDUSA-ORDER-2']);
      expect(map.get('TEST-MEDUSA-ORDER-1')).toBe(so);
      expect(map.has('TEST-MEDUSA-ORDER-2')).toBe(false);
    });
  });

  describe('run 행', () => {
    it('init 이 없으면 false, 넣으면 true', async () => {
      await rolledBack(async (tx) => {
        await tx`DELETE FROM sellmate_handed_over_orders`;
        await tx`DELETE FROM sellmate_reconcile_states`;
        await tx`DELETE FROM sellmate_reconcile_runs`;
        expect(await reconcileInitExists(tx)).toBe(false);
        expect(await initRun(tx)).toBeNull();
        await seedInitRun(tx);
        expect(await reconcileInitExists(tx)).toBe(true);
        expect((await initRun(tx))?.kind).toBe('init');
      });
    });

    it('init 은 두 번 넣을 수 없다', async () => {
      await rolledBack(async (tx) => {
        await tx`DELETE FROM sellmate_handed_over_orders`;
        await tx`DELETE FROM sellmate_reconcile_states`;
        await tx`DELETE FROM sellmate_reconcile_runs`;
        await seedInitRun(tx, 'a'.repeat(64));
        await tx`SAVEPOINT s`;
        await expect(seedInitRun(tx, 'b'.repeat(64))).rejects.toThrow();
        await tx`ROLLBACK TO SAVEPOINT s`;
      });
    });

    it('awaiting_close 는 하나만 둘 수 있고 openRun 이 그것을 돌려준다', async () => {
      await rolledBack(async (tx) => {
        await tx`DELETE FROM sellmate_handed_over_orders`;
        await tx`DELETE FROM sellmate_reconcile_states`;
        await tx`DELETE FROM sellmate_reconcile_runs`;
        const mk = (sha: string) =>
          insertRun(tx, {
            kind: 'apply',
            status: 'awaiting_close',
            inputSha256: sha,
            inputSnapshotAt: new Date('2026-11-17T00:00:00Z'),
            cutoverAt: null,
            uploadFile: 'TEST-upload.csv',
          });
        await mk('c'.repeat(64));
        expect((await openRun(tx))?.uploadFile).toBe('TEST-upload.csv');
        await tx`SAVEPOINT s`;
        await expect(mk('d'.repeat(64))).rejects.toThrow();
        await tx`ROLLBACK TO SAVEPOINT s`;
      });
    });
  });
});
