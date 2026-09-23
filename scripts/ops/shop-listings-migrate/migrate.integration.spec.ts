import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { runMigration } from './migrate';

/**
 * 실행:
 *   CORE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core \
 *   UGC_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="shop-listings-migrate/migrate.integration"
 *
 * 로컬 core·ugc 는 다른 데이터가 있을 수 있다. 이 스펙은 자기가 넣은 id 만 보고, 끝나면 지운다.
 * 단 runMigration 은 core 의 살아 있는 행 **전부**를 옮기므로, core 에 다른 행이 있으면 그것도 ugc 에 들어간다
 * — 그래서 끝날 때 이 스펙이 옮긴 ugc 행을 core 기준으로 전부 지운다.
 */
const CORE = process.env.CORE_DATABASE_URL;
const UGC = process.env.UGC_DATABASE_URL;
const describeIfDbs = CORE && UGC ? describe : describe.skip;

describeIfDbs('runMigration (실 Postgres 두 개)', () => {
  jest.setTimeout(60_000);

  let core: postgres.Sql;
  let ugc: postgres.Sql;
  const id = randomUUID();
  const slug = `migrate-test-${id.slice(0, 8)}`;
  const thumb = randomUUID();
  const other = randomUUID();

  beforeAll(async () => {
    core = postgres(CORE as string, { max: 1 });
    ugc = postgres(UGC as string, { max: 1 });
    await core`
      insert into shop_listings (id, slug, title, content, region, business_type, deal_type,
        thumbnail_file_id, images, is_active, view_count, created_by, updated_by, created_at, updated_at)
      values (${id}, ${slug}, '이관 테스트', '<p>첫 줄<br>둘째 줄</p>', 'seoul', 'nail', 'transfer',
        ${thumb}, ${core.json([other])}, true, 7, ${randomUUID()}, null,
        '2026-09-07 01:00:00', '2026-09-08 02:30:00')`;
    await core`
      insert into shop_listing_views (id, listing_id, visitor_hash, viewed_on, created_at)
      values (${randomUUID()}, ${id}, ${'h'.repeat(64)}, '2026-09-01', '2026-09-01 03:15:00')`;
  });

  afterAll(async () => {
    const coreIds = (await core<{ id: string }[]>`select id from shop_listings where deleted_at is null`).map((r) => r.id);
    if (coreIds.length) await ugc`delete from shop_listings where id in ${ugc(coreIds)}`;
    await core`delete from shop_listing_views where listing_id = ${id}`;
    await core`delete from shop_listings where id = ${id}`;
    await core.end();
    await ugc.end();
  });

  it('드라이런은 아무것도 쓰지 않는다', async () => {
    const report = await runMigration({ core, ugc, apply: false });
    expect(report.listings).toBeGreaterThanOrEqual(1);
    expect(await ugc`select 1 from shop_listings where id = ${id}`).toHaveLength(0);
  });

  it('적용하면 행·이미지·조회 기록이 옮겨진다', async () => {
    await runMigration({ core, ugc, apply: true });

    const [row] = await ugc`select * from shop_listings where id = ${id}`;
    expect(row).toMatchObject({ slug, status: 'published', author_type: 'admin', view_count: 7, content: '첫 줄\n둘째 줄' });
    const images = await ugc`select file_id from shop_listing_images where listing_id = ${id} order by "order"`;
    expect(images.map((r) => r.file_id)).toEqual([thumb, other]);
    expect(await ugc`select 1 from shop_listing_views where listing_id = ${id}`).toHaveLength(1);
  });

  // core 의 timestamp(without tz) 를 로컬 시간으로 읽으면 KST 머신에서 9시간 밀린다.
  // 이 스펙을 `TZ=Asia/Seoul` 로 돌려도 초록이어야 한다 (README §2).
  it('시각이 벽시계 값 그대로 옮겨진다 — 실행 머신의 TZ 와 무관', async () => {
    const [row] = await ugc<{ created_at: string; updated_at: string }[]>`
      select created_at::text as created_at, updated_at::text as updated_at from shop_listings where id = ${id}`;
    expect(row).toEqual({ created_at: '2026-09-07 01:00:00', updated_at: '2026-09-08 02:30:00' });
    const [view] = await ugc<{ created_at: string }[]>`
      select created_at::text as created_at from shop_listing_views where listing_id = ${id}`;
    expect(view.created_at).toBe('2026-09-01 03:15:00');
  });

  it('두 번 돌려도 결과가 같고, 조회수는 큰 쪽을 남긴다', async () => {
    await ugc`update shop_listings set view_count = 9 where id = ${id}`;
    await runMigration({ core, ugc, apply: true });

    const [row] = await ugc`select view_count from shop_listings where id = ${id}`;
    expect(row.view_count).toBe(9);
    expect(await ugc`select 1 from shop_listing_images where listing_id = ${id}`).toHaveLength(2);
    expect(await ugc`select 1 from shop_listing_views where listing_id = ${id}`).toHaveLength(1);
  });

  it('ugc 에 core 에 없는 글이 있으면 중단한다 — 전환 이후 재실행 방지', async () => {
    const stray = randomUUID();
    await ugc`
      insert into shop_listings (id, slug, title, content, author_type, status)
      values (${stray}, ${`stray-${stray.slice(0, 8)}`}, 'ugc 에서 쓴 글', '본문', 'member', 'pending')`;
    try {
      await expect(runMigration({ core, ugc, apply: true })).rejects.toThrow(/전환 이후/);
    } finally {
      await ugc`delete from shop_listings where id = ${stray}`;
    }
  });

  it('변환 못 하는 행이 하나라도 있으면 아무것도 쓰지 않는다', async () => {
    const bad = randomUUID();
    await core`
      insert into shop_listings (id, slug, title, content, thumbnail_file_id, is_active)
      values (${bad}, ${`bad-${bad.slice(0, 8)}`}, '굵은 글', '<p><strong>x</strong></p>', ${randomUUID()}, true)`;
    try {
      await expect(runMigration({ core, ugc, apply: true })).rejects.toThrow(/strong/);
      expect(await ugc`select 1 from shop_listings where id = ${bad}`).toHaveLength(0);
    } finally {
      await core`delete from shop_listings where id = ${bad}`;
    }
  });
});
