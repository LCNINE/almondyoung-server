#!/usr/bin/env ts-node
/**
 * sync-restock-to-medusa.ts
 *
 * core inbound_plans(입고예정) → Medusa variant.metadata.{inboundDate, inboundApproximate} 직접 동기화.
 * 스토어프론트가 품절 시 "○월 ○일 입고 예정" 표시에 사용 (restock-notice.tsx 가 이 키를 읽음).
 * import-inbound-plans.ts 로 입고예정을 core 에 넣은 뒤, 이 스크립트로 Medusa 에 반영한다.
 *
 * 입고예정일 = 해당 variant 구성 sku 들의 source plan 중 가장 이른 expected_date.
 * inboundApproximate = 해외 발주(po.type='foreign')면 true (한국 공급처는 정확).
 *
 * 기본 dry-run, --apply 로 실제 반영.
 *
 * ENV: CORE_DB_URL, MEDUSA_API_URL, MEDUSA_API_KEY
 *
 * 한계(ponytail): 현재 입고예정이 살아있는 variant 만 set 한다. 입고완료/취소로 예정이
 *   사라진 variant 의 stale inboundDate 는 지우지 않는다 — 필요해지면 --clear-stale 로 확장.
 *   storefront 캐시는 즉시 무효화하지 않으므로(TTL 후 반영), 급하면 해당 handle 을 revalidate.
 */
import * as postgresNs from 'postgres';
import Medusa from '@medusajs/js-sdk';

const postgres = (postgresNs as any).default ?? postgresNs;

interface RestockRow {
  master_id: string;
  variant_id: string;
  expected_date: string | Date;
  approximate: boolean;
}

// variant 구성 sku 들의 입고예정(source plan) 을 집계: 가장 이른 날짜 + 해외 여부.
const RESTOCK_SQL = `
  SELECT pmv.master_id, pm.variant_id,
         MIN(ip.expected_date) AS expected_date,
         bool_or(po.type = 'foreign') AS approximate
  FROM inbound_plan_items ipi
  JOIN inbound_plans ip ON ip.id = ipi.plan_id
  JOIN purchase_orders po ON po.id = ip.linked_purchase_order_id
  JOIN product_variant_sku_links pvsl ON pvsl.sku_id = ipi.sku_id
  JOIN product_matchings pm ON pm.id = pvsl.product_matching_id
  JOIN product_master_variants pmv ON pmv.variant_id = pm.variant_id
  WHERE ipi.status = 'pending'
    AND ip.plan_type = 'source'
    AND ip.expected_date IS NOT NULL
    AND (ipi.expected_qty - ipi.received_qty) > 0
  GROUP BY pmv.master_id, pm.variant_id
`;

async function main() {
  const apply = process.argv.includes('--apply');
  for (const key of ['CORE_DB_URL', 'MEDUSA_API_URL', 'MEDUSA_API_KEY']) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }

  const sdk = new Medusa({ baseUrl: process.env.MEDUSA_API_URL!, apiKey: process.env.MEDUSA_API_KEY });
  const client = postgres(process.env.CORE_DB_URL!, { max: 1, idle_timeout: 20, connect_timeout: 60 });

  try {
    const rows: RestockRow[] = await client.unsafe(RESTOCK_SQL);
    const masterCount = new Set(rows.map((r) => r.master_id)).size;
    console.log(`📦 입고예정 variant ${rows.length}건 (master ${masterCount}개)`);
    if (rows.length === 0) return;

    // masterId(=Medusa handle) 별 그룹핑
    const byMaster = new Map<string, RestockRow[]>();
    for (const row of rows) {
      const arr = byMaster.get(row.master_id) ?? [];
      arr.push(row);
      byMaster.set(row.master_id, arr);
    }

    let updatedVariants = 0;
    let productsHit = 0;
    let missingProducts = 0;
    let missingVariants = 0;

    for (const [masterId, group] of byMaster) {
      const { products } = await sdk.admin.product.list({
        handle: masterId,
        fields: 'id,variants.id,variants.metadata',
        limit: 1,
      });
      const product = products?.[0];
      if (!product) {
        missingProducts++;
        console.log(`  ⚠️ Medusa product 없음: handle=${masterId}`);
        continue;
      }
      productsHit++;

      const wantByVariant = new Map(group.map((r) => [r.variant_id, r]));
      const updates: Array<{ id: string; metadata: Record<string, unknown> }> = [];
      const matchedPimIds = new Set<string>();

      for (const variant of product.variants ?? []) {
        const prev = ((variant.metadata ?? {}) as Record<string, unknown>) || {};
        const pimVariantId = typeof prev.pimVariantId === 'string' ? prev.pimVariantId : null;
        const want = pimVariantId ? wantByVariant.get(pimVariantId) : undefined;
        if (!want || !pimVariantId) continue;
        matchedPimIds.add(pimVariantId);

        const inboundDate = new Date(want.expected_date).toISOString();
        const inboundApproximate = Boolean(want.approximate);
        if ((prev.inboundDate ?? null) === inboundDate && Boolean(prev.inboundApproximate) === inboundApproximate) {
          continue; // 이미 동일
        }
        updates.push({ id: variant.id, metadata: { ...prev, inboundDate, inboundApproximate } });
      }

      // core 엔 입고예정이 있는데 Medusa variant 를 못 찾은 경우 카운트
      missingVariants += group.length - matchedPimIds.size;

      if (updates.length === 0) continue;
      if (apply) {
        await sdk.admin.product.batchVariants(product.id, { update: updates });
      }
      updatedVariants += updates.length;
    }

    console.log(
      `${apply ? '✅ APPLIED' : '🔍 DRY-RUN'} — variant ${updatedVariants}건 metadata 갱신 예정, ` +
        `product ${productsHit}개 적중, product 미발견 ${missingProducts}개, variant 미매칭 ${missingVariants}건`,
    );
    if (!apply) console.log('   --apply 로 실제 반영.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
