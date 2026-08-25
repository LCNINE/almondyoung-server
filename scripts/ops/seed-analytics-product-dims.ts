/**
 * analytics 상품 dim 시딩 — core 카탈로그에서 이름을 읽어 dim 테이블을 채운다.
 *
 * dim_product_masters·dim_product_variants 는 상품 이벤트로 유지되는데, 집계 가동 이전에
 * 발행된 상품은 이벤트를 받은 적이 없어 이름이 비어 있다(화면에 UUID 노출).
 * dim_product_categories 의 category_name 은 이벤트에 아예 없어 이 스크립트가 유일한 공급원이다.
 *
 * 이벤트 소비와의 경합 규칙: **비어 있는 것만 채운다.**
 *  - master/variant: 없는 행은 insert, 있는 행은 name 이 NULL 일 때만 update.
 *    이벤트가 이미 쓴 최신 상태를 절대 덮어쓰지 않는다.
 *  - category 매핑: 없는 (master, category) 행만 insert.
 *  - category_name: core 가 유일한 canonical 원본이므로 항상 갱신한다.
 *
 * 실행 (dry-run 이 기본 — --apply 없이는 아무것도 쓰지 않는다):
 *
 *   npx tsx scripts/ops/seed-analytics-product-dims.ts --stage dev --deployment lcnine-services [--apply] [--allow-live]
 *
 * 로컬(도커) DB:
 *
 *   ANALYTICS_DATABASE_URL=... CORE_DATABASE_URL=... npx tsx scripts/ops/seed-analytics-product-dims.ts [--apply]
 */
import postgres, { Sql } from 'postgres';
import { ensureInsideSstShell, parseCommonArgs } from '../seeding/lib/sst-shell-relaunch';

const argvFlags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const args = parseCommonArgs(process.argv);
const APPLY = argvFlags.has('--apply');
const HAS_ENV_URLS = !!process.env.ANALYTICS_DATABASE_URL;

if ((args.stage === 'live' || process.env.SST_STAGE === 'live') && !argvFlags.has('--allow-live')) {
  console.error('live stage 는 --allow-live 없이 거부합니다. 실행은 운영자가 결정합니다.');
  process.exit(1);
}

function sstCredentials() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- sst shell 안에서만 로드
  const { Resource } = require('sst') as { Resource: Record<string, any> };
  const name = ['Db', 'IdpDb'].find((n) => process.env[`SST_RESOURCE_${n}`]);
  if (!name) throw new Error('sst shell 밖입니다 — SST_RESOURCE_* 가 없습니다.');
  const db = Resource[name];
  return { host: db.host as string, port: db.port as number, user: db.username as string, password: db.password as string };
}

function connect(dbName: string, envUrl?: string): Sql {
  if (envUrl) return postgres(envUrl, { max: 2 });
  const creds = sstCredentials();
  return postgres({ ...creds, database: dbName, ssl: 'require', max: 2 });
}

interface MasterRow {
  master_id: string;
  version_id: string;
  name: string;
}

interface VariantRow {
  master_id: string;
  version_id: string;
  variant_id: string;
  variant_name: string | null;
  is_default: boolean;
  status: string;
}

interface CategoryLinkRow {
  master_id: string;
  category_id: string;
  is_primary: boolean;
}

interface CategoryNameRow {
  category_id: string;
  name: string;
}

interface DerivedNameRow {
  variant_id: string;
  derived_name: string;
}

async function main() {
  if (!HAS_ENV_URLS) {
    await ensureInsideSstShell({ stage: args.stage, deployment: args.deployment });
  }

  const core = connect('core', process.env.CORE_DATABASE_URL);
  const analytics = connect('analytics', process.env.ANALYTICS_DATABASE_URL);
  const mode = APPLY ? 'APPLY' : 'DRY-RUN';
  console.log(`[${mode}] core → analytics 상품 dim 시딩`);

  try {
    // 마스터별 대표 버전: active 우선, 없으면(미발행) 최신 버전. 삭제된 마스터는 제외.
    const masters = await core<MasterRow[]>`
      SELECT DISTINCT ON (v.master_id)
             v.master_id::text AS master_id, v.id::text AS version_id, v.name
      FROM product_master_versions v
      JOIN product_masters m ON m.id = v.master_id AND m.deleted_at IS NULL
      ORDER BY v.master_id, (v.status = 'active') DESC, v.version DESC`;
    const versionIds = masters.map((m) => m.version_id);
    const masterById = new Map(masters.map((m) => [m.master_id, m]));

    // 대표 버전에 매달린 variant 들 (이름·기본품목 여부·상태)
    const variants: VariantRow[] = versionIds.length
      ? await core<VariantRow[]>`
          SELECT mv.master_id::text AS master_id, mv.version_id::text AS version_id,
                 pv.id::text AS variant_id, pv.variant_name, pv.is_default, pv.status
          FROM product_master_variants mv
          JOIN product_variants pv ON pv.id = mv.variant_id
          WHERE mv.version_id = ANY(${versionIds})`
      : [];

    // 수동 이름이 없는 옵션 조합 variant 는 옵션값 표시명을 이어 붙여 이름을 만든다 (예: "1제 / 2제").
    // 이 값은 core 에서도 화면 조립으로만 존재해 이벤트·수동이름 어느 쪽으로도 안 들어온다.
    const derivedNames: DerivedNameRow[] = versionIds.length
      ? await core<DerivedNameRow[]>`
          SELECT mv.variant_id::text AS variant_id,
                 string_agg(d.display_name, ' / ' ORDER BY d.sort_order, d.display_name) AS derived_name
          FROM product_master_variants mv
          JOIN variant_option_values vov ON vov.variant_id = mv.variant_id
          JOIN product_option_value_displays d
            ON d.option_value_id = vov.option_value_id
           AND d.version_id = mv.version_id
           AND d.master_id = mv.master_id
           AND d.locale = 'ko-KR'
          WHERE mv.version_id = ANY(${versionIds})
          GROUP BY mv.variant_id`
      : [];
    const derivedNameByVariant = new Map(derivedNames.map((row) => [row.variant_id, row.derived_name]));
    const effectiveVariantName = (v: VariantRow): string | null =>
      v.variant_name ?? derivedNameByVariant.get(v.variant_id) ?? null;

    // 대표 버전의 카테고리 매핑 + 카테고리명
    const categoryLinks: CategoryLinkRow[] = versionIds.length
      ? await core<CategoryLinkRow[]>`
          SELECT mc.master_id::text AS master_id, mc.category_id::text AS category_id, mc.is_primary
          FROM product_master_categories mc
          WHERE mc.version_id = ANY(${versionIds})`
      : [];
    const categoryNames = await core<CategoryNameRow[]>`SELECT id::text AS category_id, name FROM product_categories`;

    console.log(
      `원본: masters ${masters.length} / variants ${variants.length} / ` +
        `category links ${categoryLinks.length} / categories ${categoryNames.length}`,
    );

    // ── dim_product_masters: 없는 행 insert, 있는 행은 name NULL 만 채움 ──
    const existingMasters = await analytics`SELECT master_id, name FROM dim_product_masters`;
    const existingMasterMap = new Map(existingMasters.map((r) => [r.master_id as string, r.name as string | null]));
    const masterInserts = masters.filter((m) => !existingMasterMap.has(m.master_id));
    const masterNameFills = masters.filter(
      (m) => existingMasterMap.has(m.master_id) && existingMasterMap.get(m.master_id) == null,
    );
    console.log(`dim_product_masters: insert ${masterInserts.length}, name 채움 ${masterNameFills.length}`);

    // ── dim_product_variants: 없는 행 insert, 있는 행은 variant_name NULL 만 채움 ──
    const existingVariants = await analytics`SELECT variant_id, variant_name FROM dim_product_variants`;
    const existingVariantMap = new Map(
      existingVariants.map((r) => [r.variant_id as string, r.variant_name as string | null]),
    );
    const variantInserts = variants.filter((v) => !existingVariantMap.has(v.variant_id));
    const variantNameFills = variants.filter(
      (v) =>
        effectiveVariantName(v) != null &&
        existingVariantMap.has(v.variant_id) &&
        existingVariantMap.get(v.variant_id) == null,
    );
    console.log(`dim_product_variants: insert ${variantInserts.length}, name 채움 ${variantNameFills.length}`);

    // ── dim_product_categories: 없는 (master, category) 매핑 insert + 이름 전체 갱신 ──
    const existingLinks = await analytics`SELECT master_id, category_id FROM dim_product_categories`;
    const existingLinkSet = new Set(existingLinks.map((r) => `${r.master_id}|${r.category_id}`));
    const linkInserts = categoryLinks.filter((l) => !existingLinkSet.has(`${l.master_id}|${l.category_id}`));
    console.log(`dim_product_categories: 매핑 insert ${linkInserts.length}, 이름 갱신 대상 ${categoryNames.length}종`);

    if (!APPLY) {
      console.log('dry-run 종료 — 반영하려면 --apply');
      return;
    }

    for (const m of masterInserts) {
      await analytics`
        INSERT INTO dim_product_masters (master_id, name, active_version_id, is_active)
        VALUES (${m.master_id}, ${m.name}, ${m.version_id}, true)
        ON CONFLICT (master_id) DO NOTHING`;
    }
    for (const m of masterNameFills) {
      await analytics`
        UPDATE dim_product_masters SET name = ${m.name}, updated_at = now()
        WHERE master_id = ${m.master_id} AND name IS NULL`;
    }

    for (const v of variantInserts) {
      const master = masterById.get(v.master_id as string);
      await analytics`
        INSERT INTO dim_product_variants (variant_id, master_id, version_id, variant_name, is_default, status)
        VALUES (${v.variant_id}, ${v.master_id}, ${master?.version_id ?? v.version_id}, ${effectiveVariantName(v)},
                ${v.is_default}, ${v.status})
        ON CONFLICT (variant_id) DO NOTHING`;
    }
    for (const v of variantNameFills) {
      await analytics`
        UPDATE dim_product_variants SET variant_name = ${effectiveVariantName(v)}, updated_at = now()
        WHERE variant_id = ${v.variant_id} AND variant_name IS NULL`;
    }

    for (const l of linkInserts) {
      await analytics`
        INSERT INTO dim_product_categories (id, master_id, category_id, is_primary)
        VALUES (gen_random_uuid(), ${l.master_id}, ${l.category_id}, ${l.is_primary})
        ON CONFLICT (master_id, category_id) DO NOTHING`;
    }
    for (const c of categoryNames) {
      await analytics`
        UPDATE dim_product_categories SET category_name = ${c.name}, updated_at = now()
        WHERE category_id = ${c.category_id}
          AND (category_name IS DISTINCT FROM ${c.name})`;
    }

    console.log('반영 완료');
  } finally {
    await core.end();
    await analytics.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
