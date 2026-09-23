/**
 * core 의 샵 매매 글을 ugc 로 옮긴다 (spec 2026-09-23 §9.3). 런북은 같은 폴더의 README.md.
 *
 *   TZ=UTC CORE_DATABASE_URL=... UGC_DATABASE_URL=... npx tsx scripts/ops/shop-listings-migrate/migrate.ts [--apply]
 *
 * 기본은 **드라이런**이다. `--apply` 를 줘야 쓴다.
 * 멱등하다 — id 기준 upsert, 조회수는 큰 쪽, 이미지는 행마다 다시 넣고, 조회 기록은 중복을 버린다.
 */
import postgres, { type Sql } from 'postgres';
import { UnsupportedHtmlError } from './html-to-markdown';
import { chunk, type CoreShopListingRow, transformListing, type UgcListingRow } from './transform';

export interface MigrationReport {
  listings: number;
  byStatus: Record<'published' | 'hidden', number>;
  images: number;
  views: number;
  samples: Array<{ id: string; slug: string; before: string; after: string }>;
}

/** 조회 기록 INSERT 한 문장의 행 수. 행당 파라미터 5개 → 25,000 개로 postgres.js 상한(65,534) 아래. */
const VIEWS_PER_INSERT = 5_000;

interface CoreViewRow {
  id: string;
  listing_id: string;
  visitor_hash: string;
  viewed_on: string;
  created_at: Date;
}

export async function runMigration(opts: {
  core: postgres.Sql;
  ugc: postgres.Sql;
  apply: boolean;
}): Promise<MigrationReport> {
  const { core, ugc, apply } = opts;

  // core 의 시각 컬럼은 timestamp(without tz) 다. postgres.js 는 그걸 `new Date(x)` 로 **로컬 시간**으로 읽어
  // KST 머신에서 9시간 밀린다. `at time zone 'UTC'` 로 timestamptz 로 바꿔 읽으면 오프셋이 붙어 모호하지 않다.
  const rows = await core<CoreShopListingRow[]>`
    select id, slug, title, content, region, business_type, deal_type, area_pyeong,
           deposit::float8 as deposit, monthly_rent::float8 as monthly_rent, key_money::float8 as key_money,
           thumbnail_file_id, images, is_active, view_count,
           created_at at time zone 'UTC' as created_at, updated_at at time zone 'UTC' as updated_at,
           created_by, updated_by
    from shop_listings
    where deleted_at is null
    order by created_at`;

  // 1) 전부 변환부터 — 하나라도 실패하면 아무것도 쓰지 않는다.
  const failures: string[] = [];
  const transformed: Array<{ listing: UgcListingRow; imageFileIds: string[]; before: string }> = [];
  for (const row of rows) {
    try {
      transformed.push({ ...transformListing(row), before: row.content });
    } catch (e) {
      if (!(e instanceof UnsupportedHtmlError)) throw e;
      failures.push(`${row.id} (${row.slug}): <${e.tag}>`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`변환할 수 없는 본문 ${failures.length}건 — 변환 규칙을 먼저 늘릴 것:\n${failures.join('\n')}`);
  }

  // 2) 전환 이후 재실행 방지 — ugc 에만 있는 글이 있으면 누군가 이미 ugc 에 쓰기 시작했다.
  const coreIds = new Set(rows.map((r) => r.id));
  const ugcIds = await ugc<{ id: string }[]>`select id from shop_listings`;
  const stray = ugcIds.filter((r) => !coreIds.has(r.id));
  if (stray.length > 0) {
    throw new Error(
      `ugc 에 core 에 없는 글이 ${stray.length}건 있다 — 전환 이후로 보인다. 재실행하면 ugc 쪽 수정을 덮는다. 중단.`,
    );
  }

  const views =
    rows.length === 0
      ? []
      : await core<CoreViewRow[]>`
          select id, listing_id, visitor_hash, viewed_on::text as viewed_on,
                 created_at at time zone 'UTC' as created_at
          from shop_listing_views where listing_id in ${core([...coreIds])}`;

  const report: MigrationReport = {
    listings: transformed.length,
    byStatus: {
      published: transformed.filter((t) => t.listing.status === 'published').length,
      hidden: transformed.filter((t) => t.listing.status === 'hidden').length,
    },
    images: transformed.reduce((n, t) => n + t.imageFileIds.length, 0),
    views: views.length,
    samples: transformed.slice(0, 3).map((t) => ({
      id: t.listing.id,
      slug: t.listing.slug,
      before: t.before.slice(0, 200),
      after: t.listing.content.slice(0, 200),
    })),
  };

  if (!apply || transformed.length === 0) return report;

  await ugc.begin(async (txRaw) => {
    // postgres.js 의 트랜잭션 타입은 태그드 템플릿 제네릭을 안 받는다 — 기존 ops 스크립트와
    // 같은 캐스팅을 쓴다 (scripts/ops/short-close-overdue-po-lines.ts). 런타임 표현은 동일하다.
    const tx = txRaw as unknown as Sql;
    for (const { listing, imageFileIds } of transformed) {
      await tx`
        insert into shop_listings ${tx(listing)}
        on conflict (id) do update set
          slug = excluded.slug,
          title = excluded.title,
          content = excluded.content,
          region = excluded.region,
          business_type = excluded.business_type,
          deal_type = excluded.deal_type,
          area_pyeong = excluded.area_pyeong,
          deposit = excluded.deposit,
          monthly_rent = excluded.monthly_rent,
          key_money = excluded.key_money,
          status = excluded.status,
          author_user_id = excluded.author_user_id,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at,
          view_count = greatest(shop_listings.view_count, excluded.view_count)`;

      await tx`delete from shop_listing_images where listing_id = ${listing.id}`;
      if (imageFileIds.length > 0) {
        await tx`
          insert into shop_listing_images ${tx(
            imageFileIds.map((fileId, order) => ({ listing_id: listing.id, file_id: fileId, order })),
          )}`;
      }
    }

    // 한 문장으로 넣으면 ~13k 행에서 MAX_PARAMETERS_EXCEEDED — 같은 트랜잭션 안에서 나눠 넣는다.
    for (const part of chunk(views, VIEWS_PER_INSERT)) {
      await tx`insert into shop_listing_views ${tx(part)} on conflict do nothing`;
    }
  });

  return report;
}

async function main(): Promise<void> {
  // 읽기는 위 SQL 에서 이미 TZ 와 무관하게 했다. 그래도 운영자 노트북(KST)에서 돌리는 스크립트라 한 겹 더 막는다.
  if (process.env.TZ !== 'UTC') {
    throw new Error('TZ=UTC 로 실행하세요 — core 의 timestamp(without tz) 를 로컬 시간으로 읽어 9시간 밀린다.');
  }
  const apply = process.argv.includes('--apply');
  const coreUrl = process.env.CORE_DATABASE_URL;
  const ugcUrl = process.env.UGC_DATABASE_URL;
  if (!coreUrl || !ugcUrl) {
    throw new Error('CORE_DATABASE_URL 과 UGC_DATABASE_URL 이 모두 필요합니다.');
  }

  const core = postgres(coreUrl, { max: 1 });
  const ugc = postgres(ugcUrl, { max: 1 });
  try {
    const report = await runMigration({ core, ugc, apply });
    console.log(`글 ${report.listings}건 (게시 ${report.byStatus.published} / 숨김 ${report.byStatus.hidden})`);
    console.log(`이미지 ${report.images}장, 조회 기록 ${report.views}행`);
    for (const s of report.samples) {
      console.log(`\n── ${s.slug} (${s.id})\n[전] ${s.before}\n[후] ${s.after}`);
    }
    console.log(apply ? '\n적용 완료.' : '\n드라이런 — 쓰지 않았다. --apply 를 주면 실제로 쓴다.');
  } finally {
    await core.end();
    await ugc.end();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
