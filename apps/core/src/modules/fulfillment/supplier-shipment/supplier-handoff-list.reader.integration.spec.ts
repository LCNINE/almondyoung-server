import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { SupplierHandoffListReader } from './supplier-handoff-list.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SupplierHandoffListReader (K3 PR7, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let reader: SupplierHandoffListReader;

  beforeAll(() => {
    reader = new SupplierHandoffListReader(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function item(tx: DbTx, w: f.World) {
    const order = await f.seedOrder(tx);
    return (await f.seedFo(tx, w, order)).foItemId;
  }

  it('최근 묶음이 먼저, 묶음별 열린·발송 상자와 못 보냄 라인을 센다(취소 상자·다른 입점사 제외)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const a = await f.seedDirectSupplier(tx);
      const b = await f.seedDirectSupplier(tx);
      const older = await f.seedHandoff(tx, a, new Date('2026-10-01T00:00:00Z'));
      const newer = await f.seedHandoff(tx, a, new Date('2026-10-02T00:00:00Z'));
      await f.seedHandoff(tx, b, new Date('2026-10-03T00:00:00Z'));

      await f.seedBox(tx, w, [await item(tx, w)], { status: 'draft', supplierId: a, supplierHandoffId: older });
      await f.seedBox(tx, w, [await item(tx, w), await item(tx, w)], {
        status: 'draft',
        supplierId: a,
        supplierHandoffId: newer,
        unfulfillable: { lineIndex: 0, reason: '품절', at: new Date() },
      });
      await f.seedBox(tx, w, [await item(tx, w)], {
        status: 'shipped',
        shippedAt: new Date(),
        supplierId: a,
        supplierHandoffId: newer,
      });
      await f.seedBox(tx, w, [await item(tx, w)], { status: 'canceled', supplierId: a, supplierHandoffId: newer });

      const rows = await reader.recent(a, tx);

      expect(rows.map((r) => r.handoffId)).toEqual([newer, older]);
      expect(rows[0]).toMatchObject({
        createdBy: 'op-operator',
        openShipments: 1,
        shippedShipments: 1,
        unfulfillableLines: 1,
      });
      expect(rows[1]).toMatchObject({ openShipments: 1, shippedShipments: 0, unfulfillableLines: 0 });
    });
  });

  it('상자가 없는 묶음도 0 으로 나온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await f.seedDirectSupplier(tx);
      const h = await f.seedHandoff(tx, a);
      expect(await reader.recent(a, tx)).toEqual([
        expect.objectContaining({ handoffId: h, openShipments: 0, shippedShipments: 0, unfulfillableLines: 0 }),
      ]);
    });
  });

  it('최근 50개까지만', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await f.seedDirectSupplier(tx);
      for (let i = 0; i < 52; i++) await f.seedHandoff(tx, a, new Date(Date.UTC(2026, 0, 1, 0, i)));
      expect(await reader.recent(a, tx)).toHaveLength(50);
    });
  });
});
