import { drizzle } from 'drizzle-orm/postgres-js';
import { ProductModel3dLoader } from './product-model3d.loader';

function transaction(rows: Array<{ fileId: string | null }>) {
  const database = drizzle.mock();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    select: (...args: any[]) => {
      const query = (database.select as any)(...args);
      const from = query.from.bind(query);
      query.from = (table: any) => {
        const builder = from(table);
        builder.then = (resolve: any, reject: any) => {
          queries.push(builder.toSQL());

          return Promise.resolve(rows).then(resolve, reject);
        };

        return builder;
      };

      return query;
    },
  };

  return { tx: tx as any, queries };
}

describe('ProductModel3dLoader', () => {
  const loader = new ProductModel3dLoader();

  it('returns the database-selected representative GLB', async () => {
    const { tx } = transaction([{ fileId: 'newest-approved' }]);

    await expect(loader.getFileId(tx, 'master', 'version')).resolves.toBe('newest-approved');
  });

  it('returns no model when no eligible SKU has an approved GLB', async () => {
    const { tx } = transaction([]);

    await expect(loader.getFileId(tx, 'master', 'version')).resolves.toBeUndefined();
  });

  it('queries only the requested version, active variants, live SKUs and approved files', async () => {
    const { tx, queries } = transaction([]);

    await loader.getFileId(tx, 'requested-master', 'requested-version');

    const { sql, params } = queries[0];
    expect(sql).toContain('inner join "product_matchings"');
    expect(sql).toContain('"product_matchings"."variant_id" = "product_variants"."id"');
    expect(sql).toContain('"product_variant_sku_links"."product_matching_id" = "product_matchings"."id"');
    expect(sql).toContain('"sku_3d_models"."sku_id" = "skus"."id"');
    expect(sql).toContain('"product_master_variants"."master_id" = $1');
    expect(sql).toContain('"product_master_variants"."version_id" = $2');
    expect(sql).toContain('"product_variants"."status" = $3');
    expect(sql).toContain('"skus"."is_deleted" = $4');
    expect(sql).toContain('"sku_3d_models"."status" = $5');
    expect(sql).toContain('"sku_3d_models"."glb_file_id" is not null');
    expect(params.slice(0, 5)).toEqual(['requested-master', 'requested-version', 'active', false, 'approved']);
  });

  it('selects first variant and newest approved SKU version in SQL, limiting history transfer to one row', async () => {
    const { tx, queries } = transaction([{ fileId: 'selected' }]);

    await loader.getFileId(tx, 'master', 'version');

    expect(queries[0].sql).toContain(
      'order by "product_variants"."display_order" asc, "product_variants"."id" asc, "sku_3d_models"."sku_id" asc, "sku_3d_models"."version" desc limit',
    );
    expect(queries[0].params.at(-1)).toBe(1);
  });
});
