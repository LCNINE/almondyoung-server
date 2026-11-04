import { Test } from '@nestjs/testing';
import { DbService } from '@app/db';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NameMatchReader } from './name-match.reader';

const pending = (id: number, optionName = '단일옵션') => ({
  matchingId: `matching-${id}`,
  productName: ' BAG ',
  optionName,
  waitingOrder: id % 2 === 0,
});

describe('NameMatchReader', () => {
  const execute = jest.fn<Promise<unknown[]>, [SQL]>();
  let reader: NameMatchReader;

  beforeEach(async () => {
    execute.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        NameMatchReader,
        {
          provide: DbService,
          useValue: { run: (fn: (tx: { execute: typeof execute }) => Promise<unknown>) => fn({ execute }) },
        },
      ],
    }).compile();

    reader = module.get(NameMatchReader);
  });

  it('joins exact normalized names from the grouped SKU lookup and omits unmatched names', async () => {
    execute.mockResolvedValueOnce([pending(1), pending(2, ' Blue  Large '), pending(3, 'red')]);
    execute.mockResolvedValueOnce([
      { nameKey: 'bag', skuId: 'sku-1', skuName: 'BAG' },
      { nameKey: 'bag blue large', skuId: 'sku-2', skuName: 'bag Blue Large' },
    ]);

    expect(await reader.candidates()).toEqual([
      { ...pending(1), skuId: 'sku-1', skuName: 'BAG' },
      { ...pending(2, ' Blue  Large '), skuId: 'sku-2', skuName: 'bag Blue Large' },
    ]);
    expect(execute).toHaveBeenCalledTimes(2);

    const dialect = new PgDialect();
    const pendingQuery = dialect.sqlToQuery(execute.mock.calls[0][0]).sql;
    const skuQuery = dialect.sqlToQuery(execute.mock.calls[1][0]);

    expect(pendingQuery).toContain("version.status = 'active' AND version.deleted_at IS NULL");
    expect(pendingQuery).toContain("pm.status = 'pending' AND pm.is_resolved = false");
    expect(pendingQuery).toContain('vd.version_id = version.id');
    expect(pendingQuery).toContain('ORDER BY gd.sort_order');
    expect(pendingQuery).toContain("WHERE status = 'awaiting_matching'");
    expect(skuQuery.sql).toContain('WITH sku_names AS');
    expect(skuQuery.sql).toContain('WHERE is_deleted = false');
    expect(skuQuery.sql).toContain('HAVING count(*) = 1');
    expect(skuQuery.params).toEqual(expect.arrayContaining(['bag', 'bag blue large', 'bag red']));
  });

  it('skips the SKU query when no pending names exist', async () => {
    execute.mockResolvedValueOnce([]);

    expect(await reader.candidates()).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('counts waiting matchings once and returns only the first 20 examples', async () => {
    execute.mockResolvedValueOnce(Array.from({ length: 25 }, (_, id) => pending(id)));
    execute.mockResolvedValueOnce([{ nameKey: 'bag', skuId: 'sku-1', skuName: 'bag' }]);

    const preview = await reader.preview();

    expect(preview.candidates).toBe(25);
    expect(preview.waitingOrderCandidates).toBe(13);
    expect(preview.sample).toHaveLength(20);
    expect(preview.sample[0]).toEqual({
      matchingId: 'matching-0',
      productName: ' BAG ',
      optionName: '단일옵션',
      skuId: 'sku-1',
      skuName: 'bag',
    });
  });
});
