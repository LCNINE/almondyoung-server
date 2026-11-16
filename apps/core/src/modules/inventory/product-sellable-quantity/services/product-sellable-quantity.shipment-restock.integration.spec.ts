import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { mergedSchema } from '../../../../platform/database/merged-schema';
import {
  productMasters,
  productMasterVariants,
  productMasterVersions,
  productVariants,
} from '../../../catalog/schema/catalog.schema';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import { buildWiring, Database, inRollbackTx } from '../../inbound/services/__fixtures__/inbound-harness';
import { InboundShipmentSkuMatcherReader } from '../../inbound-shipment/services/inbound-shipment-sku-matcher.reader';
import { InboundShipmentDraftManager } from '../../inbound-shipment/services/inbound-shipment-draft.manager';
import { ListCell } from '../../inbound-shipment/services/inbound-shipment-list.parser';
import { restockToday } from './product-restock';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const HEADER = ['박스번호', 'NO', '제품명', '수량', '옵션', '바코드', '총수량', '비고'];
const cell = (text: string, value: string | number | null = text): ListCell => ({ text, value });
const FUTURE = '2099-12-01';
const PAST = '2000-01-01';

/** 선적이 스토어프론트 «입고 예정» 날짜의 후보가 되는 조건 — 설계 §6. */
describeIfDb('선적 입고예정 후보 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: Database;
  const ACTOR = randomUUID();

  beforeAll(() => {
    client = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: mergedSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function seed(tx: DbTx, sellable: boolean) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: randomUUID(), type: sellable ? 'domestic' : 'overseas', isSellable: sellable })
      .returning();
    const [holder] = await tx.insert(wmsTables.holders).values({ name: randomUUID() }).returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'ship-restock', code: randomUUID(), holderId: holder.id })
      .returning();
    const barcode = `8${Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, '0')}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode });
    const [master] = await tx.insert(productMasters).values({}).returning();
    const [version] = await tx
      .insert(productMasterVersions)
      .values({ masterId: master.id, status: 'active' })
      .returning();
    const [variant] = await tx.insert(productVariants).values({ variantName: 'ship-restock' }).returning();
    await tx
      .insert(productMasterVariants)
      .values({ masterId: master.id, versionId: version.id, variantId: variant.id });
    const [matching] = await tx
      .insert(wmsTables.productMatchings)
      .values({ variantId: variant.id, masterId: master.id, status: 'matched', strategy: 'variant', isResolved: true })
      .returning();
    await tx.insert(wmsTables.productVariantSkuLinks).values({ productMatchingId: matching.id, skuId: sku.id });
    return { warehouseId: warehouse.id, barcode, variantId: variant.id };
  }

  async function createShipment(
    tx: DbTx,
    f: { warehouseId: string; barcode: string },
    opts: { confirm: boolean; expectedArrival: string },
  ) {
    const wiring = buildWiring(db);
    const matcher = new InboundShipmentSkuMatcherReader(wiring.dbService as never);
    const drafts = new InboundShipmentDraftManager(wiring.dbService as never, matcher);
    const { shipmentId } = await drafts.createDraft(
      {
        warehouseId: f.warehouseId,
        name: `synthetic-${randomUUID().slice(0, 6)}`,
        expectedArrival: opts.expectedArrival,
        sourceFileId: null,
        sourceFileName: 'a.xlsx',
        list: {
          header: HEADER,
          rows: [
            {
              rowNumber: 1,
              cells: [
                cell('L1'),
                cell('1'),
                cell('prod'),
                cell('10', 10),
                cell('opt'),
                cell(f.barcode),
                cell('10', 10),
                cell(''),
              ],
            },
          ],
        },
      },
      ACTOR,
      tx,
    );
    if (opts.confirm) {
      await drafts.confirm(shipmentId, [], ACTOR, tx);
    }
    return shipmentId;
  }

  async function projectionOf(tx: DbTx, variantId: string) {
    const { sellable } = buildWiring(db);
    const [result] = await sellable.getByVariantIds([variantId], tx);
    return result;
  }

  it('confirmed shipment to a sellable warehouse gives the storefront date', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx, true);
      await createShipment(tx, f, { confirm: true, expectedArrival: FUTURE });
      const result = await projectionOf(tx, f.variantId);
      expect(result).toMatchObject({
        inboundDate: FUTURE,
        inboundApproximate: true,
        inboundSource: 'inbound_shipment',
      });
    });
  });

  it('shipment to a non-sellable warehouse gives no date', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx, false);
      await createShipment(tx, f, { confirm: true, expectedArrival: FUTURE });
      const result = await projectionOf(tx, f.variantId);
      expect(result.inboundDate ?? null).toBeNull();
    });
  });

  it('draft shipment gives no date', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx, true);
      await createShipment(tx, f, { confirm: false, expectedArrival: FUTURE });
      const result = await projectionOf(tx, f.variantId);
      expect(result.inboundDate ?? null).toBeNull();
    });
  });

  it('shipment with a past expected arrival gives no date', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx, true);
      expect(PAST < restockToday()).toBe(true);
      await createShipment(tx, f, { confirm: true, expectedArrival: PAST });
      const result = await projectionOf(tx, f.variantId);
      expect(result.inboundDate ?? null).toBeNull();
    });
  });
});
