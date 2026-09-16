import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { inventorySchema } from '../inventory/schema/inventory.schema';
import { DEMO_LOGISTICS_FIXTURE_VERSION } from '@app/shared/demo-logistics.fixture';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  search: z.string().trim().max(200).default(''),
  variantIds: z
    .string()
    .optional()
    .transform((value) => (value ? [...new Set(value.split(','))] : []))
    .pipe(z.array(z.string().uuid()).max(100)),
  randomSeed: z.string().uuid().optional(),
  availableOnly: z.enum(['true', 'false']).optional(),
});
export function parseDemoCatalogQuery(query: Record<string, unknown> = {}) {
  const result = querySchema.safeParse(query);
  if (!result.success) throw new BadRequestException('상품 검색 조건을 확인해 주세요.');
  return result.data;
}
export type DemoCatalogQuery = ReturnType<typeof parseDemoCatalogQuery>;
export interface DemoCatalogItem {
  variantId: string;
  masterId: string;
  versionId: string;
  skuId: string;
  sku: string;
  productName: string;
  unitPrice: number;
  availableQuantity: number;
  components: { skuId: string; quantity: number; availableQuantity: number }[];
}

/** Demo catalog is read from the actual product graph, including bundle component stock. */
@Injectable()
export class DemoCatalogService {
  constructor(@InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>) {}

  async catalog(query: DemoCatalogQuery = parseDemoCatalogQuery()) {
    const variantFilter = query.variantIds.length
      ? sql`AND v.id IN (${sql.join(
          query.variantIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    // Treat search text literally: staff often scan barcodes or paste SKU punctuation.
    const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const searchFilter = query.search
      ? sql`AND (
      mv.name ILIKE ${pattern} OR v.variant_name ILIKE ${pattern} OR v.variant_code ILIKE ${pattern}
      OR EXISTS (SELECT 1 FROM product_variant_sku_links sl JOIN skus ss ON ss.id = sl.sku_id
        LEFT JOIN sku_barcodes b ON b.sku_id = ss.id
        WHERE sl.product_matching_id = m.id
          AND (ss.code ILIKE ${pattern} OR ss.name ILIKE ${pattern} OR b.barcode ILIKE ${pattern}))
    )`
      : sql``;
    const cte = sql`
      WITH active_variants AS (
        SELECT DISTINCT ON (v.id) v.id AS variant_id, mv.master_id, mv.id AS version_id,
          coalesce(nullif(v.variant_name, ''), mv.name) AS product_name, m.id AS matching_id,
          greatest(0, coalesce(pc.base_price, mv.market_price, mv.supply_price, 10000))::float8 AS unit_price
        FROM product_variants v
        JOIN product_master_variants link ON link.variant_id = v.id
        JOIN product_master_versions mv ON mv.id = link.version_id AND mv.master_id = link.master_id
        JOIN product_masters master ON master.id = mv.master_id AND master.deleted_at IS NULL
        JOIN product_matchings m ON m.variant_id = v.id AND (m.master_id = master.id OR m.master_id IS NULL)
        LEFT JOIN product_variant_price_cache pc ON pc.variant_id = v.id AND pc.version_id = mv.id
        WHERE v.status = 'active' AND mv.status = 'active' AND mv.fulfillment_kind = 'physical'
          AND m.is_resolved AND m.status = 'matched' ${variantFilter} ${searchFilter}
        ORDER BY v.id, mv.version DESC, mv.id
      ), available_stock AS (
        SELECT ss.sku_id, greatest(0, sum(ss.available_qty))::int AS available
        FROM stock_summary_view ss JOIN warehouses w ON w.id = ss.warehouse_id AND w.is_sellable
        GROUP BY ss.sku_id
      ), candidates AS (
        SELECT a.variant_id AS "variantId", a.master_id AS "masterId", a.version_id AS "versionId",
          a.product_name AS "productName", a.unit_price AS "unitPrice",
          (array_agg(s.id ORDER BY s.code, s.id))[1] AS "skuId",
          string_agg(s.code, ' + ' ORDER BY s.code, s.id) AS sku,
          min(floor(coalesce(stock.available, 0)::numeric / nullif(l.quantity, 0)))::int AS "availableQuantity",
          jsonb_agg(jsonb_build_object('skuId', s.id, 'quantity', l.quantity,
            'availableQuantity', coalesce(stock.available, 0)) ORDER BY s.id) AS components
        FROM active_variants a
        JOIN product_variant_sku_links l ON l.product_matching_id = a.matching_id
        JOIN skus s ON s.id = l.sku_id
        LEFT JOIN delivery_profiles dp ON dp.id = s.delivery_profile_id
        LEFT JOIN available_stock stock ON stock.sku_id = s.id
        GROUP BY a.variant_id, a.master_id, a.version_id, a.product_name, a.unit_price
        HAVING bool_and(NOT s.is_deleted AND s.stock_type = 'physical' AND l.quantity > 0
          AND coalesce(dp.carrier_account_ref = 'demo-mock', false))
      ), filtered AS (SELECT * FROM candidates ${query.availableOnly === 'true' ? sql`WHERE "availableQuantity" > 0` : sql``})
    `;
    const ordering = query.randomSeed
      ? sql`md5("variantId"::text || ${query.randomSeed}), "variantId"`
      : sql`"productName", "variantId"`;
    return this.dbService.run(async (trx) => {
      const rows = await trx.execute<{ items: DemoCatalogItem[]; total: number }>(sql`${cte}
        SELECT (SELECT count(*)::int FROM filtered) AS total,
          coalesce((SELECT jsonb_agg(page_rows) FROM (
            SELECT * FROM filtered ORDER BY ${ordering}
            LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
          ) page_rows), '[]'::jsonb) AS items
      `);
      return { fixtureVersion: DEMO_LOGISTICS_FIXTURE_VERSION, ...rows[0], page: query.page, limit: query.limit };
    });
  }

  async coverage() {
    return this.dbService.run(async (trx) => {
      const [counts] = await trx.execute(sql`
        SELECT count(*)::int AS "totalSkus", count(*) FILTER (WHERE NOT is_deleted)::int AS "activeSkus",
          count(*) FILTER (WHERE NOT is_deleted AND stock_type = 'physical')::int AS "physicalSkus",
          count(*) FILTER (WHERE NOT is_deleted AND NOT EXISTS (
            SELECT 1 FROM sku_suppliers sp WHERE sp.sku_id = skus.id))::int AS "withoutSupplier",
          count(*) FILTER (WHERE NOT is_deleted AND NOT EXISTS (
            SELECT 1 FROM sku_barcodes b WHERE b.sku_id = skus.id))::int AS "withoutBarcode"
        FROM skus
      `);
      const [table] = await trx.execute<{ exists: boolean }>(
        sql`SELECT to_regclass('public.demo_catalog_imports') IS NOT NULL AS exists`,
      );
      let imported: {
        sourceSkuCount: number;
        importedSkuCount: number;
        missingSkuCount: number;
        importedAt: string;
        snapshotId: string;
      } | null = null;
      if (table.exists) {
        const [latest] = await trx.execute<NonNullable<typeof imported>>(sql`
          SELECT jsonb_array_length(source_sku_ids) AS "sourceSkuCount",
            jsonb_array_length(imported_sku_ids) AS "importedSkuCount",
            jsonb_array_length(report->'missingSourceSkuIds') AS "missingSkuCount",
            imported_at::text AS "importedAt", snapshot_id AS "snapshotId"
          FROM demo_catalog_imports ORDER BY imported_at DESC LIMIT 1
        `);
        imported = latest ?? null;
      }
      return { ...counts, imported };
    });
  }
}
