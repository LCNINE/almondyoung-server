# 샵 매매 core → ugc 이관 런북

spec: `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md` §9.

## 0. PR 1 배포 전 실측 (spec §9.5)

라이브 DB 는 `sst shell` 안에서 본다(`AWS_PROFILE` 을 export 하면 실패한다).

```bash
npx sst shell --stage live -- bash -c 'psql "$UGC_DATABASE_URL" -c "
  select rsm.role_name, s.key from auth.role_scope_mapping rsm
  join auth.scopes s on s.id = rsm.scope_id
  where s.key in (''admin:ugc:read'', ''admin:ugc:modify'') order by 1, 2"'
```

→ 이 역할들이 전환 후 샵 매매를 관리하게 된다(지금은 master·admin 만). 의도와 다르면 PR 2 머지 전에 매핑을 고친다.

```sql
-- core DB
select count(*) from shop_listings where deleted_at is null;
select count(*) from shop_listing_views;   -- 스크립트가 5,000 행씩 나눠 넣는다. 건수로 소요 시간을 가늠한다
select count(*) from shop_listings
 where deleted_at is null and thumbnail_file_id is not null
   and not (coalesce(images, '[]'::jsonb) ? thumbnail_file_id::text);
select id, slug from shop_listings
 where deleted_at is null and content ~ '<(?!/?(p|br)\y)[a-zA-Z]';
```

마지막 쿼리가 행을 내면 `html-to-markdown.ts` 규칙을 먼저 늘린다.
(네 쿼리 모두 로컬 `core` DB 에 실측 완료 — 2026-09-23. 마지막 쿼리는 Postgres ARE 에서 단어 경계가
`\b`(백스페이스 문자로 해석됨)가 아니라 `\y` 라 `\y` 를 쓴다. `\b` 로 쓰면 lookahead 가 항상
통과해 `<p>`·`<br>` 까지 「모르는 태그」로 오탐한다 — 실측 중 발견.)

## 1. PR 1 배포 (expand)

```bash
npm run db:migrate  -- --stage live --deployment lcnine-services --yes   # ugc 새 테이블
npm run db:seed:ref -- --stage live --deployment lcnine-services --yes   # file-service shop-listing-image
npx sst deploy --stage live
```

migrate 가 먼저다(expand). 배포 후 프론트는 아직 core 를 본다. 새 API 스모크:

```bash
curl -s https://ugc.almondyoung.com/shop-listings/public            # []
curl -s -o /dev/null -w '%{http_code}\n' https://ugc.almondyoung.com/shop-listings/mine   # 401
```

## 2. 복사

1. 관리자에게 **샵 매매 쓰기 동결**을 공지한다 (PR 2 배포 완료까지).
2. 드라이런 → 확인 → 적용:

```bash
npx sst shell --stage live -- bash -c \
  'TZ=UTC CORE_DATABASE_URL="$CORE_DATABASE_URL" UGC_DATABASE_URL="$UGC_DATABASE_URL" npx tsx scripts/ops/shop-listings-migrate/migrate.ts'
# 건수·샘플이 맞으면
npx sst shell --stage live -- bash -c \
  'TZ=UTC CORE_DATABASE_URL="$CORE_DATABASE_URL" UGC_DATABASE_URL="$UGC_DATABASE_URL" npx tsx scripts/ops/shop-listings-migrate/migrate.ts --apply'
```

`TZ=UTC` 는 필수다 — 없으면 스크립트가 멈춘다. core 의 시각 컬럼은 timestamp(without tz) 라 KST 노트북에서
로컬 시간으로 읽으면 작성일이 9시간 밀린다. 스크립트는 SQL 에서 `at time zone 'UTC'` 로 읽어 이미 막지만 한 겹 더 둔다.

(`sst shell` 이 내보내는 변수 이름이 다르면 `deployments/lcnine/services/infra/shared.ts` 의 `dbUrl()` 로 두 URL 을 만든다.)

3. 대조: 0 단계의 core 건수 = ugc `select count(*) from shop_listings`. 슬러그 몇 개를 `https://ugc.almondyoung.com/shop-listings/public/<slug>` 로 열어 본문 줄바꿈을 본다.

## 3. PR 2 배포 직전

같은 명령을 `--apply` 로 한 번 더 — 그사이 쌓인 조회수를 합친다. 스크립트는 ugc 에 core 에 없는 글이 생기면(= 전환 이후) 스스로 멈춘다.

## 롤백

PR 2 revert. core 의 옛 API·테이블은 PR 3·4 전까지 그대로다. 전환 뒤 ugc 에 새로 쓴 글은 core 에 없다.
