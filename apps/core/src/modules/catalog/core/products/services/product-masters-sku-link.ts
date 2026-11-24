import { SQL, sql } from 'drizzle-orm';
import { productMasterVersions } from '../../../schema/catalog.schema';

export type SkuLinkState = 'linked' | 'unlinked' | 'void';
export type SkuLinkFilter = 'all' | SkuLinkState;

export type VariantSkuLink = { state: SkuLinkState; skuCount: number };

// 판정은 주문 라인과 같다 — 디지털을 먼저 보고(출고하지 않는다), 나머지는 lineResolvedSql 의 매칭 해결 규칙을 따른다.
// 목록에서 연결됐다고 보인 옵션이 주문에서 매칭 대기로 남으면 안 된다.
const stateOf = (pm: string, fulfillmentKind: SQL) => sql`
  CASE
    WHEN ${fulfillmentKind} = 'digital' THEN 'void'
  ${sql.raw(`
    WHEN ${pm}.status = 'matched' AND ${pm}.strategy = 'void' THEN 'void'
    WHEN ${pm}.status = 'matched' AND ${pm}.strategy = 'variant'
      AND EXISTS (SELECT 1 FROM product_variant_sku_links ${pm}_k WHERE ${pm}_k.product_matching_id = ${pm}.id)
      THEN 'linked'
    ELSE 'unlinked'
  `)}
  END
`;

const hasVariantIn = (state: SkuLinkState) => sql`
  EXISTS (
    SELECT 1
    FROM product_master_variants pmv_link
    LEFT JOIN product_matchings pm_link ON pm_link.variant_id = pmv_link.variant_id
    WHERE pmv_link.version_id = ${productMasterVersions.id}
      AND (${stateOf('pm_link', sql`${productMasterVersions.fulfillmentKind}`)}) = ${state}
  )
`;

export function buildSkuLinkFilterCondition(filter: SkuLinkState): SQL {
  if (filter === 'unlinked') return hasVariantIn('unlinked');

  if (filter === 'linked') return sql`NOT ${hasVariantIn('unlinked')} AND ${hasVariantIn('linked')}`;

  return sql`NOT ${hasVariantIn('unlinked')} AND NOT ${hasVariantIn('linked')} AND ${hasVariantIn('void')}`;
}

export function skuLinkRowsSql(versionIds: string[]): SQL {
  return sql`
    SELECT pmv.version_id AS "versionId",
           pmv.variant_id AS "variantId",
           (${stateOf('pm', sql.raw('pmv_version.fulfillment_kind'))}) AS "state",
           (SELECT count(*)::int FROM product_variant_sku_links k WHERE k.product_matching_id = pm.id) AS "skuCount"
    FROM product_master_variants pmv
    INNER JOIN product_master_versions pmv_version ON pmv_version.id = pmv.version_id
    LEFT JOIN product_matchings pm ON pm.variant_id = pmv.variant_id
    WHERE pmv.version_id IN (${sql.join(
      versionIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `;
}

export type SkuLinkRow = { versionId: string; variantId: string; state: SkuLinkState; skuCount: number };

export function summarizeSkuLinks(rows: SkuLinkRow[]) {
  const byVariant = new Map<string, VariantSkuLink>();
  const unlinkedCountByVersion = new Map<string, number>();

  for (const row of rows) {
    byVariant.set(row.variantId, { state: row.state, skuCount: row.state === 'linked' ? row.skuCount : 0 });

    if (row.state === 'unlinked') {
      unlinkedCountByVersion.set(row.versionId, (unlinkedCountByVersion.get(row.versionId) ?? 0) + 1);
    }
  }

  return { byVariant, unlinkedCountByVersion };
}

export function hasSkuBarcodeCondition(barcode: string): SQL {
  return sql`
    EXISTS (
      SELECT 1
      FROM product_master_variants pmv_bc
      INNER JOIN product_matchings pm_bc ON pm_bc.variant_id = pmv_bc.variant_id
      INNER JOIN product_variant_sku_links k_bc ON k_bc.product_matching_id = pm_bc.id
      INNER JOIN sku_barcodes sb ON sb.sku_id = k_bc.sku_id
      WHERE pmv_bc.version_id = ${productMasterVersions.id}
        AND sb.barcode = ${barcode}
    )
  `;
}
