import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { sql } from 'drizzle-orm';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { matchingNameKey, NAME_WHITESPACE, NameMatchCandidate } from './name-match';

// SKU 이름은 "상품명 [옵션]" 으로 저장한다. 주문 쪽 키는 "상품명 옵션" 이라 끝의 괄호를 벗겨 같은 키로 맞춘다.
const matchingSkuName = sql.raw(
  `CASE WHEN option_key <> '' AND right(name, length(option_key) + 3) = ' [' || option_key || ']'
    THEN left(name, length(name) - length(option_key) - 3) || ' ' || option_key ELSE name END`,
);

@Injectable()
export class NameMatchReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async candidates(): Promise<NameMatchCandidate[]> {
    return this.dbService.run(async (trx) => {
      const pending = await trx.execute<{
        matchingId: string;
        productName: string;
        optionName: string;
        waitingOrder: boolean;
      }>(sql`
        WITH waiting_variants AS (
          SELECT DISTINCT jsonb_array_elements_text(waiting_variant_ids) AS variant_id
          FROM fulfillment_order_creation_backlogs
          WHERE status = 'awaiting_matching'
        )
        SELECT pm.id AS "matchingId", version.name AS "productName",
          coalesce(string_agg(vd.display_name, ' ' ORDER BY gd.sort_order, pov.option_group_id),
            variant.variant_name, '') AS "optionName",
          (waiting.variant_id IS NOT NULL) AS "waitingOrder"
        FROM product_matchings pm
        JOIN product_variants variant ON variant.id = pm.variant_id
        JOIN product_master_variants mv ON mv.variant_id = variant.id
        JOIN product_master_versions version ON version.id = mv.version_id
          AND version.status = 'active' AND version.deleted_at IS NULL
        JOIN product_masters master ON master.id = version.master_id AND master.deleted_at IS NULL
        LEFT JOIN variant_option_values vov ON vov.variant_id = variant.id
        LEFT JOIN product_option_values pov ON pov.id = vov.option_value_id
        LEFT JOIN product_option_value_displays vd ON vd.option_value_id = pov.id
          AND vd.version_id = version.id AND vd.locale = 'ko-KR'
        LEFT JOIN product_option_group_displays gd ON gd.option_group_id = pov.option_group_id
          AND gd.version_id = version.id AND gd.locale = 'ko-KR'
        LEFT JOIN waiting_variants waiting ON waiting.variant_id = variant.id::text
        WHERE pm.status = 'pending' AND pm.is_resolved = false
        GROUP BY pm.id, version.id, variant.id, waiting.variant_id
        ORDER BY pm.id
      `);

      const keys = [...new Set(pending.map((row) => matchingNameKey(row.productName, row.optionName)))].filter(Boolean);

      if (keys.length === 0) return [];

      const skus = await trx.execute<{ nameKey: string; skuId: string; skuName: string }>(sql`
        WITH sku_names AS (
          SELECT btrim(regexp_replace(lower(${matchingSkuName}), ${NAME_WHITESPACE}, ' ', 'g')) AS name_key,
            min(id::text) AS sku_id, min(name) AS sku_name
          FROM skus
          WHERE is_deleted = false
          GROUP BY name_key
          HAVING count(*) = 1
        )
        SELECT name_key AS "nameKey", sku_id AS "skuId", sku_name AS "skuName"
        FROM sku_names
        WHERE name_key IN (${sql.join(
          keys.map((key) => sql`${key}`),
          sql`, `,
        )})
      `);
      const skuByName = new Map(skus.map((sku) => [sku.nameKey, sku]));
      const candidates = new Map<string, NameMatchCandidate>();

      for (const row of pending) {
        const sku = skuByName.get(matchingNameKey(row.productName, row.optionName));

        if (sku) {
          candidates.set(row.matchingId, { ...row, skuId: sku.skuId, skuName: sku.skuName });
        }
      }

      return [...candidates.values()];
    });
  }

  async preview() {
    const candidates = await this.candidates();

    return {
      candidates: candidates.length,
      waitingOrderCandidates: candidates.filter((candidate) => candidate.waitingOrder).length,
      sample: candidates.slice(0, 20).map(({ waitingOrder, ...candidate }) => candidate),
    };
  }
}
