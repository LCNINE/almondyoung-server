/**
 * 일회성 데이터 보정: 롤리킹 멤버십가 비공개 상품의 isMembershipOnly 플래그 정합화
 * (dev/live 모두 2026-06-12 적용 완료 — 재실행은 검증/재보정 용도)
 *
 * - Medusa `product.metadata.isMembershipOnly = true` (storefront 즉시 반영용)
 * - Core `product_master_versions.is_membership_only = true` (원장 — 다음 sync 때 덮어쓰기 방지)
 *
 * 대상은 Core masterId 정확 일치(allowlist)로만 선정한다 — masterId는 stage 간 동일하고,
 * Medusa product id는 stage별로 달라 신뢰할 수 없다. 제목 매칭은 사용하지 않는다.
 *
 * 기본은 dry-run (조회만). `--apply` 를 줘야 UPDATE 실행.
 * live stage 는 `--allow-live` 를 명시해야 실행된다.
 *
 * Usage:
 *   npx tsx scripts/fix-lolliking-membership-flag.ts --stage dev --deployment lcnine-services [--apply]
 *   npx tsx scripts/fix-lolliking-membership-flag.ts --stage live --deployment lcnine-services --allow-live [--apply]
 */
import postgres from 'postgres';
import { buildDatabaseUrl } from './seeding/lib/db-connection';
import { ensureInsideSstShell, parseCommonArgs } from './seeding/lib/sst-shell-relaunch';

// Core product_masters.id — dev/live 동일 (2026-06-12 양쪽에서 확인)
const PIM_MASTER_IDS: Record<string, string> = {
  '3f90ac4f-b5e8-4ca5-9401-288b51e8db1f': '롤리킹 글루',
  '356ea2f1-281a-4372-928c-cfd0cd57916d': '롤리킹 롯드',
  'ad8881bd-8c6f-4ae8-aa54-6fdcdf3df8b8': '롤리킹 속눈썹펌 세트',
  'acf4f184-2eae-4090-9956-2c05a59b5269': '롤리킹 펌제 1제 2제',
  '6aa73e4f-5308-4de1-9909-4b5b49dd4e14': '롤리킹 에센스 5ml',
};
const EXPECTED_COUNT = Object.keys(PIM_MASTER_IDS).length; // 5

async function main() {
  const args = parseCommonArgs(process.argv);
  const apply = process.argv.includes('--apply');

  const allowLive = process.argv.includes('--allow-live');
  if ((args.stage === 'live' || process.env.SST_STAGE === 'live') && !allowLive) {
    console.error('live stage 거부 — live 에 실행하려면 --allow-live 를 명시하세요.');
    process.exit(1);
  }

  await ensureInsideSstShell({ stage: args.stage, deployment: args.deployment });

  // uselibpqcompat 은 libpq(drizzle-kit) 전용 파라미터 — postgres.js 에선 서버가 거부하므로 제거
  const url = (db: string) => buildDatabaseUrl(db).replace('&uselibpqcompat=true', '');
  const medusa = postgres(url('medusa'), { max: 1 });
  const core = postgres(url('core'), { max: 1 });

  try {
    const masterIds = Object.keys(PIM_MASTER_IDS);

    console.log(`\n=== Medusa product 조회 (stage: ${process.env.SST_STAGE ?? args.stage}) ===`);
    const products = await medusa`
      SELECT id, title,
             metadata ->> 'pimMasterId'      AS pim_master_id,
             metadata ->> 'isMembershipOnly' AS is_membership_only
      FROM product
      WHERE metadata ->> 'pimMasterId' = ANY(${masterIds}) AND deleted_at IS NULL
      ORDER BY title
    `;
    for (const p of products) {
      console.log(
        `  ${p.id} | ${p.title} | isMembershipOnly=${p.is_membership_only} | pimMasterId=${p.pim_master_id}`,
      );
    }

    console.log(`\n=== Core product_master_versions 조회 ===`);
    const versions = await core`
      SELECT id, master_id, version, status, name, is_membership_only
      FROM product_master_versions
      WHERE master_id = ANY(${masterIds})
      ORDER BY master_id, version
    `;
    for (const v of versions) {
      console.log(
        `  ${v.master_id} v${v.version} (${v.status}) | ${v.name} | is_membership_only=${v.is_membership_only}`,
      );
    }

    // 가드: 기대 건수와 다르면 적용 거부 (대상 환경의 데이터 형상이 가정과 다름)
    if (products.length !== EXPECTED_COUNT) {
      console.error(
        `\n중단: Medusa 대상이 ${products.length}건 (기대 ${EXPECTED_COUNT}건). 환경 데이터를 먼저 확인하세요.`,
      );
      process.exit(1);
    }
    const mismatch = products.find((p) => PIM_MASTER_IDS[p.pim_master_id as string] !== p.title);
    if (mismatch) {
      console.error(
        `\n중단: masterId-제목 불일치 — ${mismatch.pim_master_id} 의 제목이 "${mismatch.title}" (기대 "${PIM_MASTER_IDS[mismatch.pim_master_id as string]}").`,
      );
      process.exit(1);
    }

    if (!apply) {
      console.log('\n[dry-run] --apply 를 주면 위 대상에 UPDATE 를 실행합니다.');
      return;
    }

    console.log('\n=== APPLY: Medusa metadata.isMembershipOnly=true ===');
    const updatedProducts = await medusa`
      UPDATE product
      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isMembershipOnly}', 'true'::jsonb)
      WHERE metadata ->> 'pimMasterId' = ANY(${masterIds}) AND deleted_at IS NULL
      RETURNING id, title, metadata ->> 'isMembershipOnly' AS is_membership_only
    `;
    for (const p of updatedProducts) {
      console.log(`  updated ${p.id} | ${p.title} | isMembershipOnly=${p.is_membership_only}`);
    }

    console.log('\n=== APPLY: Core is_membership_only=true (해당 master 전체 버전) ===');
    const updatedVersions = await core`
      UPDATE product_master_versions
      SET is_membership_only = true
      WHERE master_id = ANY(${masterIds})
      RETURNING master_id, version, status, name, is_membership_only
    `;
    for (const v of updatedVersions) {
      console.log(
        `  updated ${v.master_id} v${v.version} (${v.status}) | ${v.name} | is_membership_only=${v.is_membership_only}`,
      );
    }

    console.log(
      `\n완료: medusa products ${updatedProducts.length}건, core versions ${updatedVersions.length}건 업데이트.`,
    );
  } finally {
    await medusa.end();
    await core.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
