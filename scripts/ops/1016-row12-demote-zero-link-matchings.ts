// scripts/ops/1016-row12-demote-zero-link-matchings.ts
/**
 * #1016 12번 행 일회성 정리(스펙 2026-10-08 §5.7) — «matched + variant + 링크 0개» 매칭을 pending 으로 되돌린다.
 *
 * 배경: void→variant 전략 변경과 빈 링크 upsert 가 이 상태를 만들었다(10-08 라이브 20건, 08-06~09-22, 열린 주문 0).
 * 판매·출고에선 미매칭처럼 동작하는데 화면엔 «매칭됨»이라 매칭 작업 목록에 안 나온다. 두 길은 12번 PR 이 막았다.
 * 판매 사유는 MATCHING_LINK_MISSING → MATCHING_PENDING 으로 바뀌지만 둘 다 «재고 무관 판매»라 스토어프론트는 그대로다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-row12-demote-zero-link-matchings.ts          # 조회만 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-row12-demote-zero-link-matchings.ts --apply  # 실제 적용
 * 적용 뒤 반드시 (저장소 루트에서):
 *   VARIANT_IDS=$(paste -sd, apps/core/tmp/1016-row12-demoted-variant-ids.txt) bash scripts/sellmate/run.sh live recalc-sellable .
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import { Resource } from 'sst';

const APPLY = process.argv.includes('--apply');
const OUT = path.resolve(__dirname, '../../apps/core/tmp/1016-row12-demoted-variant-ids.txt');

type TargetRow = { id: string; variant_id: string; updated_at: Date; open_orders: number };

async function main() {
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). 647 스크립트와 같은 이유로 캐스팅한다.
  const Db = (Resource as unknown as { Db: { host: string; port: number; username: string; password: string } }).Db;
  const sql = postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'core',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });

  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    const targets = await sql<TargetRow[]>`
      SELECT pm.id, pm.variant_id, pm.updated_at,
             (SELECT count(*)::int FROM sales_order_lines sol
                JOIN sales_orders so ON so.id = sol.sales_order_id
               WHERE sol.variant_id = pm.variant_id AND so.status IN ('pending', 'confirmed')) AS open_orders
        FROM product_matchings pm
       WHERE pm.status = 'matched' AND pm.strategy = 'variant'
         AND NOT EXISTS (SELECT 1 FROM product_variant_sku_links l WHERE l.product_matching_id = pm.id)
       ORDER BY pm.updated_at`;

    console.log(`대상: ${targets.length}건`);
    for (const t of targets) {
      console.log(`  ${t.variant_id}  수정 ${t.updated_at.toISOString()}  열린 주문 ${t.open_orders}`);
    }

    if (!APPLY) {
      console.log('\n조회만 했다. 적용하려면 --apply 를 붙일 것.');
      return;
    }
    if (targets.length === 0) {
      console.log('\n되돌릴 것이 없다.');
      return;
    }

    // 위에서 센 바로 그 id 들만, 조건을 다시 걸어 — 그 사이 링크가 붙은 행은 건드리지 않는다
    const ids = targets.map((t) => t.id);
    const updated = await sql<{ variant_id: string }[]>`
      UPDATE product_matchings pm
         SET status = 'pending', strategy = NULL, is_resolved = false, updated_at = now()
       WHERE pm.id = ANY(${ids})
         AND pm.status = 'matched' AND pm.strategy = 'variant'
         AND NOT EXISTS (SELECT 1 FROM product_variant_sku_links l WHERE l.product_matching_id = pm.id)
      RETURNING pm.variant_id`;

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, updated.map((r) => r.variant_id).join('\n') + '\n');
    console.log(`\n되돌림: ${updated.length}건 → ${OUT}`);
    console.log('이어서 recalc-sellable 을 돌릴 것(파일 머리 주석).');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
