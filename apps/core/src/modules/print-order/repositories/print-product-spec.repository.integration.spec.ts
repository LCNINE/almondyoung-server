import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { type WowpressLineSpec } from '../wowpress/wowpress.types';
import { PrintProductSpecRepository } from './print-product-spec.repository';

/**
 * 실 Postgres 로 검증한다. print_product_specs·print_template_products 마이그가 적용된 DB 가 필요하다.
 *   DATABASE_URL=postgresql://... npx jest --testPathPattern="print-product-spec.repository.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_PRINT_SPEC_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_PRINT_SPEC_DB=1 인데 DATABASE_URL 이 없습니다');
}

const specOf = (confirmed: boolean): WowpressLineSpec => ({
  prodno: 40001,
  jobpresetno: '1234',
  prsjob: [{ jobno: 1 }],
  awkjob: [],
  qtyPerUnit: 100,
  file: { format: 'jpg', dpi: 350 },
  design: { productId: 'design-product', widthMm: 90, heightMm: 50 },
  confirmed,
});

describeIfDb('PrintProductSpecRepository (실 Postgres)', () => {
  jest.setTimeout(60_000);

  const variantIds: string[] = [];
  const templateIds: string[] = [];

  let sql: postgres.Sql;
  let dbService: DbService<typeof wmsSchema>;
  let repo: PrintProductSpecRepository;

  const newVariant = (): string => {
    const id = randomUUID();
    variantIds.push(id);

    return id;
  };

  const inTx = <T>(fn: (tx: DbTx) => Promise<T>): Promise<T> => dbService.run(fn);

  beforeAll(() => {
    const connect = (postgres as unknown as { default?: typeof postgres }).default ?? postgres;
    sql = connect(DATABASE_URL as string);
    const db = drizzle(sql, { schema: wmsSchema });

    dbService = {
      db,
      run: async (fn: (tx: unknown) => Promise<unknown>, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
    } as unknown as DbService<typeof wmsSchema>;

    repo = new PrintProductSpecRepository(dbService);
  });

  afterAll(async () => {
    if (variantIds.length > 0) {
      await dbService.db
        .delete(wmsTables.printProductSpecs)
        .where(inArray(wmsTables.printProductSpecs.variantId, variantIds));
    }
    if (templateIds.length > 0) {
      await dbService.db
        .delete(wmsTables.printTemplateProducts)
        .where(inArray(wmsTables.printTemplateProducts.templateId, templateIds));
    }
    await sql.end();
  });

  it('returns null for a missing row', async () => {
    expect(await repo.findSpec(randomUUID())).toBeNull();
  });

  it('round-trips an inserted spec', async () => {
    const variantId = newVariant();
    const spec = specOf(false);

    await inTx((tx) => repo.insertSpecs([{ variantId, spec }], tx));

    expect(await repo.findSpec(variantId)).toEqual(spec);
  });

  it('reads back confirmed=false when the insert did not say otherwise', async () => {
    const variantId = newVariant();
    const spec = specOf(false);

    await inTx((tx) =>
      tx.insert(wmsTables.printProductSpecs).values({
        variantId,
        prodno: spec.prodno,
        jobpresetno: spec.jobpresetno,
        prsjob: spec.prsjob,
        awkjob: spec.awkjob,
        qtyPerUnit: spec.qtyPerUnit,
        fileFormat: spec.file.format,
        fileDpi: spec.file.dpi,
        designProductId: spec.design.productId,
        designWidthMm: spec.design.widthMm,
        designHeightMm: spec.design.heightMm,
      }),
    );

    expect((await repo.findSpec(variantId))?.confirmed).toBe(false);
  });

  it('confirmVariant sets confirmed with time and actor', async () => {
    const variantId = newVariant();
    await inTx((tx) => repo.insertSpecs([{ variantId, spec: specOf(false) }], tx));

    await repo.confirmVariant(variantId, 'actor-1');

    const [row] = await dbService.db
      .select()
      .from(wmsTables.printProductSpecs)
      .where(eq(wmsTables.printProductSpecs.variantId, variantId));
    expect(row?.confirmed).toBe(true);
    expect(row?.confirmedAt).toBeInstanceOf(Date);
    expect(row?.confirmedBy).toBe('actor-1');
  });

  it('confirmVariant on a variant without a row succeeds and creates no row', async () => {
    const variantId = newVariant();

    await expect(repo.confirmVariant(variantId, 'actor-1')).resolves.toBeUndefined();

    const rows = await dbService.db
      .select()
      .from(wmsTables.printProductSpecs)
      .where(eq(wmsTables.printProductSpecs.variantId, variantId));
    expect(rows).toHaveLength(0);
  });

  it('claimTemplate claims once and reports the original master afterwards', async () => {
    const templateId = randomUUID();
    templateIds.push(templateId);
    const first = randomUUID();

    expect(await inTx((tx) => repo.claimTemplate(templateId, first, tx))).toEqual({ claimed: true });
    expect(await inTx((tx) => repo.claimTemplate(templateId, randomUUID(), tx))).toEqual({
      claimed: false,
      masterId: first,
    });
  });

  it('findClaimedMaster reads the claimed master without claiming', async () => {
    const templateId = randomUUID();
    templateIds.push(templateId);
    const master = randomUUID();

    expect(await repo.findClaimedMaster(templateId)).toBeNull();

    await inTx((tx) => repo.claimTemplate(templateId, master, tx));

    expect(await repo.findClaimedMaster(templateId)).toBe(master);
  });

  it('assignClaimedMaster replaces the placeholder master of a claim', async () => {
    const templateId = randomUUID();
    templateIds.push(templateId);
    const real = randomUUID();

    await inTx(async (tx) => {
      await repo.claimTemplate(templateId, randomUUID(), tx);
      await repo.assignClaimedMaster(templateId, real, tx);
    });

    expect(await inTx((tx) => repo.claimTemplate(templateId, randomUUID(), tx))).toEqual({
      claimed: false,
      masterId: real,
    });
  });
});
