# 샵 매매 core → ugc 이관 런북

spec: `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md` §9.

## 라이브 DB 에 붙는 법 (모든 절 공통)

`sst shell` 은 DB 를 URL 이 아니라 **리소스**(`SST_RESOURCE_Db` — 호스트·계정 JSON)로 준다. `$UGC_DATABASE_URL` 같은
변수는 없다. DB 는 VPC 안이라 **터널**이 떠 있어야 한다. `sst` 명령은 `deployments/lcnine/services` 에서 돈다.
`AWS_PROFILE` 을 export 하면 sst 가 자격증명을 못 읽는다(빼고 실행).

```bash
aws login --profile login                                         # 세션 12시간
cd deployments/lcnine/services && npx sst tunnel --stage live     # 별도 터미널에 띄워 둔다
```

psql 로 볼 때는 리소스에서 접속 정보를 꺼내 환경변수로만 넘긴다(비밀번호를 출력하지 않는다):

```bash
cat > /tmp/live-psql.sh <<'EOF'
eval "$(node -e 'const d=JSON.parse(process.env.SST_RESOURCE_Db);console.log(`export PGHOST=${d.host} PGPORT=${d.port} PGUSER=${d.username} PGPASSWORD=${JSON.stringify(d.password)} PGSSLMODE=require`)')"
psql -X -d "$1" -c "set default_transaction_read_only = on;" -c "$2"
EOF
cd deployments/lcnine/services && npx sst shell --stage live -- bash /tmp/live-psql.sh ugc "select 1"
```

## 0. PR 1 배포 전 실측 (spec §9.5)

위 `live-psql.sh` 로 돌린다 (첫 인자가 DB 이름).

```sql
-- ugc: 전환 후 샵 매매를 관리할 역할
select rsm.role_name, s.key from auth.role_scope_mapping rsm
  join auth.scopes s on s.id = rsm.scope_id
 where s.key in ('admin:ugc:read', 'admin:ugc:modify') order by 1, 2;

-- core
select count(*) from shop_listings where deleted_at is null;
select count(*) from shop_listing_views;   -- 스크립트가 5,000 행씩 나눠 넣는다
select count(*) from shop_listings
 where deleted_at is null and thumbnail_file_id is not null
   and not (coalesce(images, '[]'::jsonb) ? thumbnail_file_id::text);
select id, slug from shop_listings
 where deleted_at is null and content ~ '<(?!/?(p|br)\y)[a-zA-Z]';
```

마지막 쿼리가 행을 내면 `html-to-markdown.ts` 규칙을 먼저 늘린다. Postgres ARE 에서 단어 경계는 `\b`(백스페이스)가
아니라 `\y` 다 — `\b` 로 쓰면 `<p>`·`<br>` 까지 「모르는 태그」로 오탐한다.

**2026-09-24 라이브 실측:** ugc 에 `admin:ugc:*` 매핑 0행(= master 만 관리 가능) → `admin` 역할 매핑을 코드로 선언했다
(`apps/ugc-service/src/shared/auth/ugc-scopes.ts`, 부팅 때 정합화). core 살아 있는 글 112 · 조회 기록 2,760 ·
썸네일 불일치 0 · 허용 밖 태그 0 (쓰인 태그는 `p`·`br` 뿐).

## 1. PR 1 배포 (expand)

```bash
npm ci && npm ci --prefix apps/admin-web                                 # 로컬 의존성을 lock 에 맞춘다 — 아래 참고
npm run db:migrate  -- --stage live --deployment lcnine-services --yes   # ugc 새 테이블
npm run db:seed:ref -- --stage live --deployment lcnine-services --yes   # file-service shop-listing-image
npx sst deploy --stage live
```

migrate 가 먼저다(expand). `db:migrate` 는 드라이런이 없고 이 배포의 **모든** 서비스에 대기 중인 마이그를 적용하므로,
먼저 서비스별 journal 과 라이브 `drizzle.__drizzle_migrations` 를 대조해 대기 목록을 본다(2026-09-24 에는 ugc 1건뿐이었다).

`sst deploy` 는 **로컬 `node_modules` 로** Next 앱을 빌드한다. 2026-09-24 첫 배포는 로컬 `marked` 가 lock(18)보다 낡은
4.3.0 이라 AdminWeb 빌드가 타입 오류로 실패했고, Storefront·WalletWeb 만 먼저 나간 채 ECS 서비스는 갱신되지 않았다.
`npm ci` 뒤 재배포로 복구. 배포 직후 몇 분은 옛 태스크가 섞여 새 라우트가 404·401 로 번갈아 나온다 — 안정될 때까지 본다.

배포 후 프론트는 아직 core 를 본다. 새 API 스모크:

```bash
curl -s https://ugc.almondyoung.com/shop-listings/public            # []
curl -s -o /dev/null -w '%{http_code}\n' https://ugc.almondyoung.com/shop-listings/mine   # 401
```

**PR 1 배포 후 복사 전까지 라이브에서 매물을 만들지 말 것** — 스모크로 만든 글이 하나라도 있으면 복사 스크립트의
재실행 가드(「ugc 에 core 에 없는 글」)가 멈춘다. 멈추면 그 행을 확인하고 물리 삭제한 뒤 다시 돌린다.

## 2. 복사

1. 관리자에게 **샵 매매 쓰기 동결**을 공지한다 (PR 2 배포 완료까지).
2. 드라이런 → 확인 → 적용:

```bash
cd deployments/lcnine/services
npx sst shell --stage live -- bash -c 'cd ../../.. && TZ=UTC npx tsx scripts/ops/shop-listings-migrate/migrate.ts'
# 건수·샘플이 맞으면
npx sst shell --stage live -- bash -c 'cd ../../.. && TZ=UTC npx tsx scripts/ops/shop-listings-migrate/migrate.ts --apply'
```

스크립트는 `CORE_DATABASE_URL`·`UGC_DATABASE_URL` 이 없으면 `SST_RESOURCE_Db` 로 `core`·`ugc` DB 에 붙는다(로컬에선 두 URL 을 준다).
2026-09-24 라이브 드라이런: 글 112(게시 112) · 이미지 603 · 조회 기록 2,711 · 변환 실패 0.

`TZ=UTC` 는 필수다 — 없으면 스크립트가 멈춘다. core 의 시각 컬럼은 timestamp(without tz) 라 KST 노트북에서
로컬 시간으로 읽으면 작성일이 9시간 밀린다. 스크립트는 SQL 에서 `at time zone 'UTC'` 로 읽어 이미 막지만 한 겹 더 둔다.

관리자들이 빈 줄로 쓴 `<p>​</p>` 에는 폭 없는 공백(U+200B)이 들어 있다. 변환은 본문 전체에서 이 문자를 지운다
(spec §9.3). 그래서 그 문단은 빠지고 연속된 빈 줄은 문단 간격 한 번으로 합쳐진다 — 이관 글의 세로 간격이 원본보다
좁아지는 것은 의도한 결과다. 3 단계에서 렌더를 볼 때 이걸 결함으로 읽지 말 것.

3. 대조: 0 단계의 core 건수 = ugc `select count(*) from shop_listings`. 슬러그 몇 개를 `https://ugc.almondyoung.com/shop-listings/public/<slug>` 로 열어 본문 줄바꿈을 본다.

## 3. PR 2 배포 직전

같은 명령을 `--apply` 로 한 번 더 — 그사이 쌓인 조회수를 합친다. 스크립트는 ugc 에 core 에 없는 글이 생기면(= 전환 이후) 스스로 멈춘다.

같은 가드는 앞선 복사 뒤 core 에서 soft delete 된 글에도 걸린다 — core 쪽은 `deleted_at is null` 만 읽으므로 그 글이
「ugc 에만 있는 글」로 보인다. 쓰기 동결 중에는 생길 수 없는 일이지만, 멈췄다면 그 행이 동결 전 삭제인지 먼저 확인한다.

## 롤백

PR 2 revert. core 의 옛 API·테이블은 PR 3·4 전까지 그대로다. 전환 뒤 ugc 에 새로 쓴 글은 core 에 없다.
