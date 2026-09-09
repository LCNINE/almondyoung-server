/**
 * 리뷰 자격의 product_id 를 Medusa product id → PIM 마스터 id(UUID) 로 되맞춘다.
 *
 * 왜 필요한가: 리뷰는 PIM 마스터 id 로 키를 잡는다(reviews.product_id 는 uuid, 상품 상세도
 * `product.metadata.pimMasterId` 로 리뷰를 읽는다). 그런데 구매확정 워크플로는 Medusa 의
 * product_id(`prod_…`)를 그대로 자격에 넣고 있었다. 그 자격으로는 리뷰 작성 API 가 uuid 검증에서
 * 400 을 낸다 — 즉 그 주문들은 리뷰를 쓸 수 없다.
 *
 * 매핑 출처는 channel-adapter 의 `pim_medusa_mappings` 다. 두 DB 를 읽으므로 접속 문자열이 둘 필요하다.
 *
 *   UGC_DATABASE_URL=... CHANNEL_ADAPTER_DATABASE_URL=... npx tsx scripts/ops/backfill-review-eligibility-product-id.ts
 *
 * 기본은 **드라이런**이다. 실제로 쓰려면 `--apply` 를 준다.
 */
import postgres from 'postgres';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const apply = process.argv.includes('--apply');
  const ugcUrl = process.env.UGC_DATABASE_URL;
  const adapterUrl = process.env.CHANNEL_ADAPTER_DATABASE_URL;

  if (!ugcUrl || !adapterUrl) {
    throw new Error('UGC_DATABASE_URL 과 CHANNEL_ADAPTER_DATABASE_URL 이 모두 필요합니다.');
  }

  const ugc = postgres(ugcUrl, { max: 1 });
  const adapter = postgres(adapterUrl, { max: 1 });

  try {
    const rows = await ugc<Array<{ id: string; product_id: string }>>`
      select id, product_id from review_eligibilities
      where product_id not similar to '________-____-____-____-____________'
    `;

    const brokenIds = [...new Set(rows.map((row) => row.product_id))].filter((id) => !UUID_PATTERN.test(id));
    console.log(`uuid 가 아닌 product_id 를 가진 자격: ${rows.length}건 (상품 ${brokenIds.length}종)`);

    if (rows.length === 0) return;

    const mappings = await adapter<Array<{ pim_master_id: string; medusa_product_id: string }>>`
      select pim_master_id, medusa_product_id from pim_medusa_mappings
      where medusa_product_id in ${adapter(brokenIds)}
    `;

    const masterByProduct = new Map(mappings.map((row) => [row.medusa_product_id, row.pim_master_id]));
    const unresolved = brokenIds.filter((id) => !masterByProduct.has(id));

    console.log(`매핑을 찾은 상품: ${masterByProduct.size}종, 못 찾은 상품: ${unresolved.length}종`);
    if (unresolved.length > 0) {
      console.log('못 찾은 product_id:', unresolved.join(', '));
    }

    let updated = 0;
    for (const row of rows) {
      const masterId = masterByProduct.get(row.product_id);
      if (!masterId) continue;

      if (apply) {
        await ugc`update review_eligibilities set product_id = ${masterId}, updated_at = now() where id = ${row.id}`;
      }
      updated += 1;
    }

    console.log(apply ? `수정 완료: ${updated}건` : `드라이런 — 수정 대상 ${updated}건 (--apply 를 주면 실제로 씁니다)`);
  } finally {
    await ugc.end();
    await adapter.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
