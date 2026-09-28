# 샵 매매 ugc 이전 — PR 1 (expand) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ugc-service 에 샵 매매 도메인(스키마·API·탈퇴 컨슈머·판정기 포트)을 새로 세우고, file-service 에 전용 업로드 컨텍스트를, 그리고 core → ugc 멱등 복사 스크립트를 만든다. 프론트는 이 PR 에서 건드리지 않는다.

**Architecture:** `apps/ugc-service/src/shop-listings/` 에 core 의 shop-listings 레이어(Controller → Service → Reader/Manager)를 옮겨 세우고, 상태 전이·자동 판정·slug 같은 규칙은 순수 함수 파일로 뺀다. 컨트롤러는 공개·회원·관리자 셋으로 나눠 `author_type` 을 라우트가 정하게 한다. 복사 스크립트는 `scripts/ops/shop-listings-migrate/` 에 순수 변환부와 IO 부를 분리한다.

**Tech Stack:** NestJS 11 (Fastify), drizzle-orm + postgres.js, class-validator, `@app/authorization`(JwtAuthGuard·ScopeGuard), `@app/events`(`@On`), Jest(ts-jest, UTC), `npx tsx` 스크립트.

**Spec:** `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md`

## Global Constraints

- 레이어: Controller → Service(메서드당 2-3줄, 매핑만) → Reader/Manager. Service 는 drizzle·`HttpException` 을 import 하지 않는다.
- 예외는 `@app/shared` 의 `NotFoundError`(404)·`BadRequestError`(400)·`ConflictError`(409). Nest 예외 클래스 금지(컨트롤러 경계 입력 검사 제외).
- 트랜잭션은 `this.db.run(fn, tx)` 하나로 전파. `inTx` 헬퍼·`this.db.db.transaction` 직접 호출 금지. private 헬퍼는 `trx: UgcTx` 를 필수 인자로 받는다.
- `any`·`as` 캐스팅 금지(스펙 파일의 테스트 더블 제외).
- 스키마 변경은 `npm run db:generate:ugc-service -- --name <kebab>` 로만. schema.ts + 생성 SQL + `src/db/meta/` 를 **한 커밋**에.
- `drizzle-kit generate` 는 서브에이전트가 못 돌린다(대화형 TTY). **Task 1 의 generate 단계는 메인 세션이 직접 실행한다.**
- 상태 값: `pending` | `published` | `rejected` | `hidden` | `closed`. 공개 노출은 `published`·`closed` 뿐.
- 동시 게시 한도: 회원당 `pending + published` 3건.
- 이미지: 글당 1~15장, 썸네일 = `order = 0`.
- 본문: 마크다운, 최대 10,000자, 공백만이면 400.
- 전화번호: 하이픈·공백 제거 후 `^0\d{8,10}$`. 회원 글 필수, 관리자 글 선택.
- 오픈채팅 URL: `https://open.kakao.com/` 로 시작, 최대 255자.
- 판정기 실패(타임아웃 1초·예외·`null`) = `pending`.
- 공개 응답(목록·상세)에 연락처를 넣지 않는다. 연락처는 로그인 필요 라우트로만.
- 본문 줄바꿈: 렌더러(PR 2)가 `remark-breaks` 로 단일 `\n` 을 `<br>` 로 그린다. 이관 변환기는 `<br>` 를 `\n` 하나로 낸다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0.
- 통합 스펙은 `describeIfDb` 가드. 스펙 안에서 `dotenv.config()` 금지. 로컬 DB: `postgresql://postgres:postgres@localhost:5432/ugc`, `…/core` (`npm run db:migrate:local` 이 둘 다 마이그한다).

---

## File Structure

**Create — `apps/ugc-service/src/shop-listings/`**

| 파일 | 책임 |
|---|---|
| `shop-listing.constants.ts` | enum 값 목록, 한도·길이 상수, slug 패턴 |
| `shop-listing.util.ts` | `slugify`·`hashVisitor`·`kstToday`·`stripPhoneSeparators` (순수) |
| `shop-listing.transitions.ts` | `nextStatus`·`countsTowardLimit`·`entersLimit` (순수 상태 전이) |
| `classifier/shop-listing-classifier.ts` | 판정기 포트·DI 토큰·`NullShopListingClassifier` |
| `classifier/auto-decision.ts` | `decide`·`classifySafely`·`autoDecisionPolicyFromEnv` (순수 + 타임아웃) |
| `types.ts` | 엔티티 타입 |
| `dto/*.ts` | 요청·응답 DTO |
| `mappers/shop-listing.mapper.ts` | 엔티티 → 응답 DTO |
| `shop-listing.reader.ts` | 조회 전부 |
| `shop-listing-moderation.manager.ts` | 승인·거절·숨김·해제 + 판정 이력 기록 |
| `shop-listing.manager.ts` | 회원·관리자 작성/수정/거래완료/삭제, 탈퇴 처리 |
| `shop-listing-view.manager.ts` | 조회수 비콘 |
| `shop-listings.service.ts` | 얇은 포트 |
| `controllers/public-shop-listings.controller.ts` | `shop-listings/public/*` |
| `controllers/member-shop-listings.controller.ts` | `shop-listings/*` |
| `controllers/admin-shop-listings.controller.ts` | `admin/shop-listings/*` |
| `consumers/user-permanent-deleted.consumer.ts` | 탈퇴 → 연락처 NULL + soft delete |
| `shop-listings.module.ts` | 배선 |

**Create — `scripts/ops/shop-listings-migrate/`**: `html-to-markdown.ts`, `transform.ts`, `migrate.ts`, `README.md` (+ 스펙들)

**Modify**
- `apps/ugc-service/src/db/schema.ts` — 테이블 4개·enum 4개
- `apps/ugc-service/src/ugc-service.module.ts` — 모듈 import, scope 설명
- `apps/file-service/src/database/default-file-contexts.ts` — `shop-listing-image`
- `scripts/security/idor-reviewed.spec.ts`, `scripts/security/route-authz-audit.spec.ts` — 등록
- `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md` — 계획 작성 중 확정한 4건 반영

---

### Task 0: spec 보정 (계획 작성 중 확정한 4건)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md`

- [ ] **Step 1: §7.4 관리자 라우트에 거래완료 전환 추가**

`- POST /:id/approve, …` 줄 바로 아래에 추가:

```markdown
- `POST /:id/close`, `POST /:id/reopen` — 관리자 글·회원 글의 거래완료 전환(§5). 한도 검사 없음
```

- [ ] **Step 2: §8.1 본문 렌더 목록에 줄바꿈 규칙 추가**

`- 링크는 rel=…` 줄 아래에 추가:

```markdown
  - `remark-breaks` 를 더해 단일 줄바꿈을 `<br>` 로 그린다. 표준 마크다운은 단일 줄바꿈을 공백으로 합쳐, 이관 글의 `<br>` 와 회원이 textarea 에서 친 Enter 가 모두 사라진다.
```

- [ ] **Step 3: §9.3 복사 스크립트 보정**

`- 변환:` 목록의 썸네일 줄을 다음으로 바꾼다:

```markdown
  - `thumbnail_file_id` + `images` → `shop_listing_images`. 썸네일을 `order = 0` 으로 두고 나머지 `images` 를 순서대로 잇는다(썸네일이 `images` 안 다른 자리에 있으면 앞으로 옮긴다). 중복 fileId 는 한 번만.
```

`- --dry-run: …` 줄을 다음으로 바꾼다:

```markdown
- 기본 실행은 **드라이런**이다(저장소의 `scripts/ops/backfill-*.ts` 관례). 건수·상태별 분포·변환 샘플을 출력하고 쓰지 않는다. `--apply` 를 줘야 쓴다.
- **전환 이후 재실행 방지:** ugc 에 core 에 없는 id 가 하나라도 있으면(= 회원·관리자가 ugc 에 새로 쓴 글이 있으면) 중단한다. 재실행이 ugc 쪽 수정을 core 원본으로 덮는 사고를 막는다.
```

§9.4 의 `복사 --dry-run → 실행` 을 `복사(드라이런) → --apply` 로 바꾼다.

- [ ] **Step 4: §11.3 보안 레지스트리에 ALLOWED 추가**

`- route-authz-audit 통과 …` 줄을 다음으로 바꾼다:

```markdown
- `route-authz-audit.spec.ts` 의 `ALLOWED` 에 `POST /shop-listings/public/:slug/view` 를 이유와 함께 등록한다 — ugc 의 무인증 쓰기 라우트는 이것 하나다.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md
git commit -m "docs(spec): 샵 매매 ugc 이전 — 관리자 거래완료·줄바꿈·복사 재실행 가드·비콘 허용 보정"
```

---

### Task 1: 상수와 스키마 + 마이그레이션

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listing.constants.ts`
- Create: `apps/ugc-service/src/shop-listings/types.ts`
- Modify: `apps/ugc-service/src/db/schema.ts` (import 블록, 파일 끝 `ugcServiceSchema` 앞)
- Create (generated): `apps/ugc-service/src/db/<timestamp>_add-shop-listings.sql`, `apps/ugc-service/src/db/meta/*`
- Test: `apps/ugc-service/src/shop-listings/__tests__/shop-listing-schema.spec.ts`

**Interfaces:**
- Produces: `SHOP_LISTING_REGIONS`, `SHOP_LISTING_BUSINESS_TYPES`, `SHOP_LISTING_DEAL_TYPES`, `SHOP_LISTING_STATUSES`, `PUBLIC_SHOP_LISTING_STATUSES`, `SHOP_LISTING_AUTHOR_TYPES`, `ShopListingStatus`, `ShopListingAuthorType`, `MEMBER_ACTIVE_LISTING_LIMIT`, `MAX_SHOP_LISTING_IMAGES`, `MAX_SHOP_LISTING_CONTENT_LENGTH`, `SHOP_LISTING_SLUG_PATTERN`, `SHOP_LISTING_ADVISORY_LOCK_CLASS`; drizzle 테이블 `shopListings`, `shopListingImages`, `shopListingModerations`, `shopListingViews`; 타입 `ShopListingEntity`, `ShopListingInsert`, `ShopListingModerationEntity`, `ShopListingWithImages`.

- [ ] **Step 1: 상수 파일 작성**

`apps/ugc-service/src/shop-listings/shop-listing.constants.ts`:

```ts
/** 값 목록은 core `apps/core/src/modules/catalog/core/shop-listings/shop-listing.constants.ts` 에서 옮겼다. */
export const SHOP_LISTING_REGIONS = [
  'seoul',
  'gyeonggi',
  'incheon',
  'busan',
  'daegu',
  'gwangju',
  'daejeon',
  'ulsan',
  'sejong',
  'gangwon',
  'chungbuk',
  'chungnam',
  'jeonbuk',
  'jeonnam',
  'gyeongbuk',
  'gyeongnam',
  'jeju',
] as const;
export type ShopListingRegion = (typeof SHOP_LISTING_REGIONS)[number];

export const SHOP_LISTING_BUSINESS_TYPES = [
  'nail',
  'lash',
  'semi-permanent',
  'skincare',
  'hair',
  'waxing',
  'tattoo',
  'etc',
] as const;
export type ShopListingBusinessType = (typeof SHOP_LISTING_BUSINESS_TYPES)[number];

/** transfer = 양도(권리금 받고 넘김), lease = 임대(자리만 빌려줌) */
export const SHOP_LISTING_DEAL_TYPES = ['transfer', 'lease'] as const;
export type ShopListingDealType = (typeof SHOP_LISTING_DEAL_TYPES)[number];

/**
 * 한 축으로 둔다 — 검토 상태·거래 상태·노출 여부를 따로 두면 조합이 폭발한다.
 * 전이 규칙은 `shop-listing.transitions.ts` 가 정본이다.
 */
export const SHOP_LISTING_STATUSES = ['pending', 'published', 'rejected', 'hidden', 'closed'] as const;
export type ShopListingStatus = (typeof SHOP_LISTING_STATUSES)[number];

/** 공개 API 가 노출하는 상태. closed 는 「거래완료」 배지로 남는다. */
export const PUBLIC_SHOP_LISTING_STATUSES = ['published', 'closed'] as const satisfies readonly ShopListingStatus[];

export const SHOP_LISTING_AUTHOR_TYPES = ['admin', 'member'] as const;
export type ShopListingAuthorType = (typeof SHOP_LISTING_AUTHOR_TYPES)[number];

export const SHOP_LISTING_MODERATION_DECIDERS = ['admin', 'classifier'] as const;
export const SHOP_LISTING_MODERATION_DECISIONS = ['approved', 'rejected', 'pending', 'hidden', 'unhidden'] as const;
export type ShopListingModerationDecision = (typeof SHOP_LISTING_MODERATION_DECISIONS)[number];

/** 회원당 pending + published 합계 상한. */
export const MEMBER_ACTIVE_LISTING_LIMIT = 3;
export const MAX_SHOP_LISTING_IMAGES = 15;
export const MAX_SHOP_LISTING_CONTENT_LENGTH = 10_000;

/** 동시 게시 한도 검사를 직렬화하는 advisory lock 의 클래스 키. 다른 락과 겹치지 않게 두 인자 형식을 쓴다. */
export const SHOP_LISTING_ADVISORY_LOCK_CLASS = 7301;

// 한글 완성형은 코드포인트로 escape 한다 — 리터럴로 쓰면 겉보기 같은 CJK 문자가 섞인다.
const HANGUL = '\\uAC00-\\uD7A3';
export const SHOP_LISTING_SLUG_PATTERN = new RegExp(`^[a-z0-9${HANGUL}]+(?:-[a-z0-9${HANGUL}]+)*$`);
```

- [ ] **Step 2: schema.ts 에 테이블 추가**

`apps/ugc-service/src/db/schema.ts` 의 `drizzle-orm/pg-core` import 목록에 `bigint`, `date`, `real` 을 더하고, 파일 상단 import 끝에 추가:

```ts
import { v7 as uuidv7 } from 'uuid';
import {
  SHOP_LISTING_AUTHOR_TYPES,
  SHOP_LISTING_MODERATION_DECIDERS,
  SHOP_LISTING_MODERATION_DECISIONS,
  SHOP_LISTING_STATUSES,
} from '../shop-listings/shop-listing.constants';
```

`export const ugcServiceSchema = {` 바로 위에 추가:

```ts
// ===== SHOP LISTINGS (샵 매매) — core 에서 이전 (spec 2026-09-23) =====
export const shopListingStatusEnum = pgEnum('shop_listing_status', SHOP_LISTING_STATUSES);
export const shopListingAuthorTypeEnum = pgEnum('shop_listing_author_type', SHOP_LISTING_AUTHOR_TYPES);
export const shopListingModerationDeciderEnum = pgEnum(
  'shop_listing_moderation_decider',
  SHOP_LISTING_MODERATION_DECIDERS,
);
export const shopListingModerationDecisionEnum = pgEnum(
  'shop_listing_moderation_decision',
  SHOP_LISTING_MODERATION_DECISIONS,
);

export const shopListings = pgTable(
  'shop_listings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    slug: varchar('slug', { length: 120 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    /** 마크다운. 원시 HTML 은 렌더러가 이스케이프한다. */
    content: text('content').notNull(),
    region: varchar('region', { length: 20 }),
    businessType: varchar('business_type', { length: 20 }),
    dealType: varchar('deal_type', { length: 20 }),
    areaPyeong: integer('area_pyeong'),
    /** 원 단위. null 이면 「협의」. */
    deposit: bigint('deposit', { mode: 'number' }),
    monthlyRent: bigint('monthly_rent', { mode: 'number' }),
    keyMoney: bigint('key_money', { mode: 'number' }),
    /** 숫자만. 공개 응답에 넣지 않는다 — 로그인 라우트로만 나간다. */
    contactPhone: varchar('contact_phone', { length: 20 }),
    kakaoOpenChatUrl: varchar('kakao_open_chat_url', { length: 255 }),
    authorType: shopListingAuthorTypeEnum('author_type').notNull(),
    authorUserId: uuid('author_user_id'),
    status: shopListingStatusEnum('status').notNull(),
    rejectReason: text('reject_reason'),
    /** 가장 최근 pending 진입 시각. 검토 대기열 정렬 기준. */
    submittedAt: timestamp('submitted_at'),
    viewCount: integer('view_count').notNull().default(0),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('shop_listings_slug_unique')
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
    index('shop_listings_status').on(table.status),
    index('shop_listings_author_user_id').on(table.authorUserId),
    index('shop_listings_created_at').on(table.createdAt),
    index('shop_listings_deleted_at').on(table.deletedAt),
    index('shop_listings_region').on(table.region),
    index('shop_listings_business_type').on(table.businessType),
    index('shop_listings_deal_type').on(table.dealType),
  ],
);

/** review_media 와 같은 모양. order = 0 이 썸네일이다. */
export const shopListingImages = pgTable(
  'shop_listing_images',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => shopListings.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').notNull(),
    order: integer('order').notNull(),
    ...timestampColumns,
  },
  (table) => [
    primaryKey({ columns: [table.listingId, table.fileId], name: 'shop_listing_images_pkey' }),
    uniqueIndex('shop_listing_images_listing_order_unique').on(table.listingId, table.order),
    index('shop_listing_images_file_id').on(table.fileId),
  ],
);

/** 판정 이력. 추가만 한다. Jev 임계값을 재는 정답셋이 된다. */
export const shopListingModerations = pgTable(
  'shop_listing_moderations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => shopListings.id, { onDelete: 'cascade' }),
    decidedBy: shopListingModerationDeciderEnum('decided_by').notNull(),
    decision: shopListingModerationDecisionEnum('decision').notNull(),
    label: varchar('label', { length: 40 }),
    confidence: real('confidence'),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id'),
    titleSnapshot: varchar('title_snapshot', { length: 255 }).notNull(),
    contentSnapshot: text('content_snapshot').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('shop_listing_moderations_listing_created').on(table.listingId, table.createdAt)],
);

export const shopListingViews = pgTable(
  'shop_listing_views',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => shopListings.id, { onDelete: 'cascade' }),
    /** 방문자 IP + 매물 id 해시. 원본 IP 는 저장하지 않는다. */
    visitorHash: varchar('visitor_hash', { length: 64 }).notNull(),
    /** KST 날짜. 같은 방문자·같은 매물·같은 날은 1행만 남는다. */
    viewedOn: date('viewed_on').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('shop_listing_views_per_day_unique').on(table.listingId, table.visitorHash, table.viewedOn),
  ],
);
```

`ugcServiceSchema` 객체 끝(`answers,` 다음)에 추가:

```ts
  shopListings,
  shopListingImages,
  shopListingModerations,
  shopListingViews,
```

- [ ] **Step 3: 타입 파일 작성**

`apps/ugc-service/src/shop-listings/types.ts`:

```ts
import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { shopListingModerations, shopListings } from '../db/schema';

export type ShopListingEntity = InferSelectModel<typeof shopListings>;
export type ShopListingInsert = InferInsertModel<typeof shopListings>;
export type ShopListingModerationEntity = InferSelectModel<typeof shopListingModerations>;

/** 이미지는 order 오름차순 fileId 배열로 붙는다. [0] 이 썸네일. */
export type ShopListingWithImages = ShopListingEntity & { imageFileIds: string[] };
```

- [ ] **Step 4: 스키마 가드 스펙 작성**

`apps/ugc-service/src/shop-listings/__tests__/shop-listing-schema.spec.ts`:

```ts
import { getTableConfig } from 'drizzle-orm/pg-core';
import { shopListingImages, shopListings, ugcServiceSchema } from '../../db/schema';
import { PUBLIC_SHOP_LISTING_STATUSES, SHOP_LISTING_STATUSES } from '../shop-listing.constants';

describe('샵 매매 스키마', () => {
  it('ugcServiceSchema 에 네 테이블이 등록돼 있다 — 빠지면 DbService 가 못 본다', () => {
    expect(Object.keys(ugcServiceSchema)).toEqual(
      expect.arrayContaining(['shopListings', 'shopListingImages', 'shopListingModerations', 'shopListingViews']),
    );
  });

  it('slug unique 는 살아 있는 행에만 걸린다 — 삭제된 글의 slug 를 재사용할 수 있어야 한다', () => {
    const slugIndex = getTableConfig(shopListings).indexes.find((i) => i.config.name === 'shop_listings_slug_unique');
    expect(slugIndex?.config.unique).toBe(true);
    expect(slugIndex?.config.where).toBeDefined();
  });

  it('이미지 순서는 글 안에서 유일하다', () => {
    const orderIndex = getTableConfig(shopListingImages).indexes.find(
      (i) => i.config.name === 'shop_listing_images_listing_order_unique',
    );
    expect(orderIndex?.config.unique).toBe(true);
  });

  it('공개 상태는 전체 상태의 부분집합이다', () => {
    for (const status of PUBLIC_SHOP_LISTING_STATUSES) {
      expect(SHOP_LISTING_STATUSES).toContain(status);
    }
  });
});
```

- [ ] **Step 5: 스펙 실행**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing-schema.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: 마이그레이션 생성 (메인 세션이 직접)**

Run: `npm run db:generate:ugc-service -- --name add-shop-listings`
Expected: `apps/ugc-service/src/db/<timestamp>_add-shop-listings.sql` 생성. 대화형 질문이 나오면 전부 「create」(새 테이블·enum 이므로 rename 이 아니다).

생성된 SQL 을 열어 확인: `CREATE TYPE` 4개, `CREATE TABLE` 4개, FK 3개(`ON DELETE cascade`), partial unique index 1개(`WHERE "shop_listings"."deleted_at" is null`). **`DROP`·`ALTER … DROP` 이 있으면 중단하고 schema.ts 를 고친다.**

- [ ] **Step 7: 로컬 DB 에 적용**

Run: `npm run db:migrate:local`
Expected: ugc 에 새 마이그 적용, 실패 0.

- [ ] **Step 8: type-check**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 9: Commit (schema + SQL + meta 한 커밋)**

```bash
git add apps/ugc-service/src/shop-listings/shop-listing.constants.ts apps/ugc-service/src/shop-listings/types.ts \
  apps/ugc-service/src/shop-listings/__tests__/shop-listing-schema.spec.ts \
  apps/ugc-service/src/db/schema.ts apps/ugc-service/src/db/*_add-shop-listings.sql apps/ugc-service/src/db/meta/
git commit -m "feat(ugc): 샵 매매 테이블 4개를 추가한다 (expand)"
```

---

### Task 2: 순수 유틸 (slug·조회수 해시·KST 날짜·전화번호)

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listing.util.ts`
- Test: `apps/ugc-service/src/shop-listings/__tests__/shop-listing.util.spec.ts`

**Interfaces:**
- Produces: `slugify(raw: string): string`, `hashVisitor(ip: string, listingId: string): string`, `kstToday(now?: Date): string`, `stripPhoneSeparators(value: unknown): unknown`

- [ ] **Step 1: 실패하는 스펙 작성** (core `shop-listing.manager.spec.ts` 의 slug·해시·날짜 케이스를 옮긴다)

`apps/ugc-service/src/shop-listings/__tests__/shop-listing.util.spec.ts`:

```ts
import { hashVisitor, kstToday, slugify, stripPhoneSeparators } from '../shop-listing.util';

describe('slugify', () => {
  it('소문자로 바꾸고 허용 밖 문자를 하이픈 하나로 접는다', () => {
    expect(slugify('  Gangnam NAIL  Shop!! ')).toBe('gangnam-nail-shop');
  });

  it('한글은 남긴다', () => {
    expect(slugify('강남 네일샵 양도합니다')).toBe('강남-네일샵-양도합니다');
  });

  it('양 끝 하이픈을 지운다', () => {
    expect(slugify('--abc--')).toBe('abc');
  });

  it('100자로 자른다', () => {
    expect(slugify('a'.repeat(150))).toHaveLength(100);
  });

  it('남는 게 없으면 빈 문자열', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('hashVisitor', () => {
  it('같은 IP 라도 매물이 다르면 해시가 다르다 — 매물 간 방문자 대조를 막는다', () => {
    expect(hashVisitor('1.2.3.4', 'a')).not.toBe(hashVisitor('1.2.3.4', 'b'));
  });

  it('64자 hex', () => {
    expect(hashVisitor('1.2.3.4', 'a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('kstToday', () => {
  it('UTC 15:00 은 KST 다음날이다', () => {
    expect(kstToday(new Date('2026-09-23T15:00:00.000Z'))).toBe('2026-09-24');
  });

  it('UTC 14:59 는 KST 같은 날이다', () => {
    expect(kstToday(new Date('2026-09-23T14:59:59.000Z'))).toBe('2026-09-23');
  });
});

describe('stripPhoneSeparators', () => {
  it('하이픈·공백을 지운다', () => {
    expect(stripPhoneSeparators(' 010-1234 5678 ')).toBe('01012345678');
  });

  it('문자열이 아니면 그대로 둔다 — 타입 검증은 class-validator 몫이다', () => {
    expect(stripPhoneSeparators(123)).toBe(123);
    expect(stripPhoneSeparators(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing.util.spec.ts`
Expected: FAIL — `Cannot find module '../shop-listing.util'`

- [ ] **Step 3: 구현**

`apps/ugc-service/src/shop-listings/shop-listing.util.ts`:

```ts
import { createHash } from 'node:crypto';

// 한글 완성형은 코드포인트로 escape 한다 — 리터럴로 쓰면 겉보기 같은 CJK 문자가 섞여 한글이 통째로 지워진다.
const SLUG_STRIP = new RegExp('[^a-z0-9\\uAC00-\\uD7A3]+', 'g');

export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(SLUG_STRIP, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** IP 를 그대로 두지 않는다. 매물 id 를 섞어 매물 간 방문자 대조도 막는다. */
export function hashVisitor(ip: string, listingId: string): string {
  return createHash('sha256').update(`${ip}|${listingId}`).digest('hex').slice(0, 64);
}

/** viewed_on 은 KST 기준 날짜다. 런타임은 UTC 라 직접 더한다. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** DTO `@Transform` 용. 문자열만 다듬고 나머지는 검증기에 넘긴다. */
export function stripPhoneSeparators(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing.util.spec.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ugc-service/src/shop-listings/shop-listing.util.ts apps/ugc-service/src/shop-listings/__tests__/shop-listing.util.spec.ts
git commit -m "feat(ugc): 샵 매매 slug·조회수 해시·전화번호 유틸을 옮긴다"
```

---

### Task 3: 상태 전이 (순수 함수)

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listing.transitions.ts`
- Test: `apps/ugc-service/src/shop-listings/__tests__/shop-listing.transitions.spec.ts`

**Interfaces:**
- Consumes: `ShopListingStatus` (Task 1)
- Produces: `type ShopListingAction = 'member_edit' | 'close' | 'reopen' | 'approve' | 'reject' | 'hide' | 'unhide'`, `nextStatus(current: ShopListingStatus, action: ShopListingAction): ShopListingStatus` (허용 안 되면 `ConflictError`), `countsTowardLimit(status): boolean`, `entersLimit(from, to): boolean`

- [ ] **Step 1: 실패하는 스펙 작성** — spec §5 표를 그대로 옮긴다

`apps/ugc-service/src/shop-listings/__tests__/shop-listing.transitions.spec.ts`:

```ts
import { ConflictError } from '@app/shared';
import { SHOP_LISTING_STATUSES, type ShopListingStatus } from '../shop-listing.constants';
import {
  countsTowardLimit,
  entersLimit,
  nextStatus,
  type ShopListingAction,
} from '../shop-listing.transitions';

/** spec §5 의 허용 전이 전부. 여기 없는 (상태, 동작) 조합은 모두 거부돼야 한다. */
const ALLOWED: Array<[ShopListingStatus, ShopListingAction, ShopListingStatus]> = [
  ['pending', 'member_edit', 'pending'],
  ['published', 'member_edit', 'pending'],
  ['closed', 'member_edit', 'pending'],
  ['rejected', 'member_edit', 'pending'],
  ['pending', 'approve', 'published'],
  ['pending', 'reject', 'rejected'],
  ['published', 'hide', 'hidden'],
  ['closed', 'hide', 'hidden'],
  ['hidden', 'unhide', 'published'],
  ['published', 'close', 'closed'],
  ['closed', 'reopen', 'published'],
];

const ACTIONS: ShopListingAction[] = ['member_edit', 'close', 'reopen', 'approve', 'reject', 'hide', 'unhide'];

describe('nextStatus', () => {
  it.each(ALLOWED)('%s --%s--> %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  const denied = SHOP_LISTING_STATUSES.flatMap((from) =>
    ACTIONS.filter((action) => !ALLOWED.some(([f, a]) => f === from && a === action)).map(
      (action) => [from, action] as const,
    ),
  );

  it.each(denied)('%s 에서 %s 는 ConflictError', (from, action) => {
    expect(() => nextStatus(from, action)).toThrow(ConflictError);
  });

  it('숨김 글은 회원이 수정해 숨김을 풀 수 없다', () => {
    expect(() => nextStatus('hidden', 'member_edit')).toThrow(ConflictError);
  });
});

describe('동시 게시 한도', () => {
  it('pending 과 published 만 센다', () => {
    expect(SHOP_LISTING_STATUSES.filter(countsTowardLimit)).toEqual(['pending', 'published']);
  });

  it('세지 않는 상태에서 세는 상태로 들어갈 때만 한도를 검사한다', () => {
    expect(entersLimit('closed', 'published')).toBe(true);
    expect(entersLimit('rejected', 'pending')).toBe(true);
    expect(entersLimit('published', 'pending')).toBe(false);
    expect(entersLimit('pending', 'rejected')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing.transitions.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`apps/ugc-service/src/shop-listings/shop-listing.transitions.ts`:

```ts
import { ConflictError } from '@app/shared';
import { type ShopListingStatus } from './shop-listing.constants';

/** 관리자 수정·삭제는 상태를 바꾸지 않으므로 여기 없다. */
export type ShopListingAction = 'member_edit' | 'close' | 'reopen' | 'approve' | 'reject' | 'hide' | 'unhide';

const TRANSITIONS: Record<ShopListingAction, Partial<Record<ShopListingStatus, ShopListingStatus>>> = {
  // hidden 은 없다 — 수정으로 관리자 숨김을 우회하지 못하게 한다. 삭제는 허용된다.
  member_edit: { pending: 'pending', published: 'pending', closed: 'pending', rejected: 'pending' },
  approve: { pending: 'published' },
  reject: { pending: 'rejected' },
  hide: { published: 'hidden', closed: 'hidden' },
  unhide: { hidden: 'published' },
  close: { published: 'closed' },
  reopen: { closed: 'published' },
};

export function nextStatus(current: ShopListingStatus, action: ShopListingAction): ShopListingStatus {
  const next = TRANSITIONS[action][current];
  if (!next) {
    throw new ConflictError(`이 글은 지금 상태(${current})에서 ${action} 할 수 없습니다.`);
  }
  return next;
}

export function countsTowardLimit(status: ShopListingStatus): boolean {
  return status === 'pending' || status === 'published';
}

export function entersLimit(from: ShopListingStatus, to: ShopListingStatus): boolean {
  return !countsTowardLimit(from) && countsTowardLimit(to);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing.transitions.spec.ts`
Expected: PASS (11 허용 + 24 거부 + 3 = 38 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ugc-service/src/shop-listings/shop-listing.transitions.ts apps/ugc-service/src/shop-listings/__tests__/shop-listing.transitions.spec.ts
git commit -m "feat(ugc): 샵 매매 상태 전이를 한 표로 고정한다"
```

---

### Task 4: 판정기 포트와 자동 판정

**Files:**
- Create: `apps/ugc-service/src/shop-listings/classifier/shop-listing-classifier.ts`
- Create: `apps/ugc-service/src/shop-listings/classifier/auto-decision.ts`
- Test: `apps/ugc-service/src/shop-listings/__tests__/auto-decision.spec.ts`

**Interfaces:**
- Produces:
  - `interface ShopListingClassifierInput { title: string; content: string; region: string | null; businessType: string | null; dealType: string | null; deposit: number | null; monthlyRent: number | null; keyMoney: number | null }`
  - `interface ShopListingClassification { label: 'shop_listing' | 'not_shop_listing'; confidence: number }`
  - `interface ShopListingClassifier { classify(input: ShopListingClassifierInput): Promise<ShopListingClassification | null> }`
  - `const SHOP_LISTING_CLASSIFIER: unique symbol`, `class NullShopListingClassifier`
  - `interface AutoDecisionPolicy { enabled: boolean; approveThreshold: number; rejectThreshold: number }`, `const SHOP_LISTING_AUTO_DECISION_POLICY: unique symbol`
  - `type AutoDecision = 'published' | 'rejected' | 'pending'`
  - `decide(result: ShopListingClassification | null, policy: AutoDecisionPolicy): AutoDecision`
  - `classifySafely(classifier, input, timeoutMs?: number): Promise<ShopListingClassification | null>`
  - `autoDecisionPolicyFromEnv(env?: NodeJS.ProcessEnv): AutoDecisionPolicy`
  - `CLASSIFIER_REJECT_REASON: string`

- [ ] **Step 1: 실패하는 스펙 작성**

`apps/ugc-service/src/shop-listings/__tests__/auto-decision.spec.ts`:

```ts
import {
  autoDecisionPolicyFromEnv,
  classifySafely,
  decide,
  type AutoDecisionPolicy,
} from '../classifier/auto-decision';
import {
  NullShopListingClassifier,
  type ShopListingClassifier,
  type ShopListingClassifierInput,
} from '../classifier/shop-listing-classifier';

const ON: AutoDecisionPolicy = { enabled: true, approveThreshold: 0.9, rejectThreshold: 0.8 };
const OFF: AutoDecisionPolicy = { ...ON, enabled: false };

const INPUT: ShopListingClassifierInput = {
  title: '강남 네일샵 양도',
  content: '본문',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  deposit: null,
  monthlyRent: null,
  keyMoney: null,
};

describe('decide', () => {
  it.each([
    ['shop_listing', 0.9, 'published'],
    ['shop_listing', 0.89, 'pending'],
    ['not_shop_listing', 0.8, 'rejected'],
    ['not_shop_listing', 0.79, 'pending'],
  ] as const)('%s @ %s → %s', (label, confidence, expected) => {
    expect(decide({ label, confidence }, ON)).toBe(expected);
  });

  it('결과가 없으면 pending', () => {
    expect(decide(null, ON)).toBe('pending');
  });

  it('플래그가 꺼져 있으면 확신도와 무관하게 pending — 섀도 모드', () => {
    expect(decide({ label: 'shop_listing', confidence: 1 }, OFF)).toBe('pending');
    expect(decide({ label: 'not_shop_listing', confidence: 1 }, OFF)).toBe('pending');
  });
});

describe('classifySafely', () => {
  it('NullShopListingClassifier 는 null', async () => {
    await expect(classifySafely(new NullShopListingClassifier(), INPUT)).resolves.toBeNull();
  });

  it('판정기가 던지면 null — 글쓰기를 막지 않는다', async () => {
    const failing: ShopListingClassifier = { classify: () => Promise.reject(new Error('503')) };
    await expect(classifySafely(failing, INPUT)).resolves.toBeNull();
  });

  it('타임아웃을 넘기면 null', async () => {
    const slow: ShopListingClassifier = {
      classify: () =>
        new Promise((resolve) => setTimeout(() => resolve({ label: 'shop_listing', confidence: 1 }), 50)),
    };
    await expect(classifySafely(slow, INPUT, 10)).resolves.toBeNull();
  });

  it('제때 오면 그 결과', async () => {
    const fast: ShopListingClassifier = {
      classify: () => Promise.resolve({ label: 'shop_listing', confidence: 0.97 }),
    };
    await expect(classifySafely(fast, INPUT)).resolves.toEqual({ label: 'shop_listing', confidence: 0.97 });
  });
});

describe('autoDecisionPolicyFromEnv', () => {
  it('기본은 꺼짐', () => {
    expect(autoDecisionPolicyFromEnv({}).enabled).toBe(false);
  });

  it('"on" 일 때만 켜진다', () => {
    expect(autoDecisionPolicyFromEnv({ SHOP_LISTING_AUTO_DECISION: 'on' }).enabled).toBe(true);
    expect(autoDecisionPolicyFromEnv({ SHOP_LISTING_AUTO_DECISION: 'true' }).enabled).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/auto-decision.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 포트 구현**

`apps/ugc-service/src/shop-listings/classifier/shop-listing-classifier.ts`:

```ts
/**
 * 「샵 매매 글이 맞는가」 판정기의 포트. 공급사(Jev 등) SDK 타입을 여기 노출하지 않는다 —
 * 판정기를 갈 때 어댑터 하나만 바꾸면 되게 한다.
 */
export interface ShopListingClassifierInput {
  title: string;
  content: string;
  region: string | null;
  businessType: string | null;
  dealType: string | null;
  deposit: number | null;
  monthlyRent: number | null;
  keyMoney: number | null;
}

export interface ShopListingClassification {
  label: 'shop_listing' | 'not_shop_listing';
  /** 0~1, 보정된 확신도. */
  confidence: number;
}

export interface ShopListingClassifier {
  /** 판정할 수 없으면 null. */
  classify(input: ShopListingClassifierInput): Promise<ShopListingClassification | null>;
}

export const SHOP_LISTING_CLASSIFIER = Symbol('SHOP_LISTING_CLASSIFIER');

/** v1 — Jev 키가 나오기 전까지 모든 회원 글을 관리자 대기로 보낸다. */
export class NullShopListingClassifier implements ShopListingClassifier {
  classify(): Promise<ShopListingClassification | null> {
    return Promise.resolve(null);
  }
}
```

- [ ] **Step 4: 자동 판정 구현**

`apps/ugc-service/src/shop-listings/classifier/auto-decision.ts`:

```ts
import {
  type ShopListingClassification,
  type ShopListingClassifier,
  type ShopListingClassifierInput,
} from './shop-listing-classifier';

export interface AutoDecisionPolicy {
  /** 꺼져 있으면 판정 결과를 이력에 남기기만 하고 상태는 항상 pending (섀도 모드). */
  enabled: boolean;
  approveThreshold: number;
  rejectThreshold: number;
}

export const SHOP_LISTING_AUTO_DECISION_POLICY = Symbol('SHOP_LISTING_AUTO_DECISION_POLICY');

export type AutoDecision = 'published' | 'rejected' | 'pending';

/** 자동 거절 시 회원에게 보이는 사유. */
export const CLASSIFIER_REJECT_REASON = '샵 매매 글로 보기 어려워 게시되지 않았습니다. 내용을 고쳐 다시 제출해 주세요.';

export function decide(result: ShopListingClassification | null, policy: AutoDecisionPolicy): AutoDecision {
  if (!result || !policy.enabled) return 'pending';
  if (result.label === 'shop_listing' && result.confidence >= policy.approveThreshold) return 'published';
  if (result.label === 'not_shop_listing' && result.confidence >= policy.rejectThreshold) return 'rejected';
  return 'pending';
}

/** 판정기 장애가 글쓰기를 막지 않게 한다 — 실패·타임아웃은 null(= pending). */
export async function classifySafely(
  classifier: ShopListingClassifier,
  input: ShopListingClassifierInput,
  timeoutMs = 1_000,
): Promise<ShopListingClassification | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([classifier.classify(input).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 임계값은 Jev 섀도 모드에서 관리자 판정과 대조해 정한다(spec §6.3). 그 전까지 켜지 않으므로
 * 기본값은 보수적으로 둔다.
 */
export function autoDecisionPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): AutoDecisionPolicy {
  return {
    enabled: env.SHOP_LISTING_AUTO_DECISION === 'on',
    approveThreshold: 0.95,
    rejectThreshold: 0.95,
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/auto-decision.spec.ts`
Expected: PASS (12 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/ugc-service/src/shop-listings/classifier apps/ugc-service/src/shop-listings/__tests__/auto-decision.spec.ts
git commit -m "feat(ugc): 샵 매매 판정기 포트와 자동 판정 규칙을 둔다 (v1 은 전부 관리자 대기)"
```

---

### Task 5: DTO 와 매퍼

**Files:**
- Create: `apps/ugc-service/src/shop-listings/dto/shop-listing-request.dto.ts`
- Create: `apps/ugc-service/src/shop-listings/dto/shop-listing-response.dto.ts`
- Create: `apps/ugc-service/src/shop-listings/dto/index.ts`
- Create: `apps/ugc-service/src/shop-listings/mappers/shop-listing.mapper.ts`
- Test: `apps/ugc-service/src/shop-listings/__tests__/shop-listing-request.dto.spec.ts`
- Test: `apps/ugc-service/src/shop-listings/__tests__/shop-listing.mapper.spec.ts`

**Interfaces:**
- Consumes: 상수(Task 1), `stripPhoneSeparators`(Task 2), `ShopListingWithImages`·`ShopListingModerationEntity`(Task 1)
- Produces:
  - 요청: `MemberShopListingDto`(contactPhone 필수), `AdminShopListingDto`(slug?·contactPhone?), `RejectShopListingDto { reason }`, `AdminShopListingListQueryDto { status?; authorType?; q? }`
  - 공통 필드(두 요청 DTO 에 중복 선언): `title, content, region, businessType, dealType, areaPyeong?, deposit?, monthlyRent?, keyMoney?, imageFileIds, kakaoOpenChatUrl?`
  - 응답: `PublicShopListingResponseDto`, `ShopListingContactResponseDto`, `MyShopListingResponseDto`, `AdminShopListingResponseDto`, `AdminShopListingDetailResponseDto`, `ShopListingModerationResponseDto`
  - `ShopListingMapper.toPublicDto / toMineDto / toAdminDto / toAdminDetailDto / toContactDto / toModerationDto`

> 두 요청 DTO 가 필드를 상속으로 공유하지 않는 이유: class-validator 는 부모 데코레이터를 자식에 합친다. 부모에 `@IsOptional() contactPhone` 이 있으면 자식에서 필수로 다시 선언해도 `IsOptional` 이 살아 있어 빈 값이 통과한다.

- [ ] **Step 1: 실패하는 DTO 스펙 작성**

`apps/ugc-service/src/shop-listings/__tests__/shop-listing-request.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminShopListingDto, MemberShopListingDto } from '../dto';

const IMAGE = '019166f0-0000-7000-8000-000000000001';

const VALID = {
  title: '강남 네일샵 양도',
  content: '역 5분 거리입니다.',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  imageFileIds: [IMAGE],
  contactPhone: '010-1234-5678',
};

function withoutPhone(body: typeof VALID): Omit<typeof VALID, 'contactPhone'> {
  const copy: Partial<typeof VALID> = { ...body };
  delete copy.contactPhone;
  return copy as Omit<typeof VALID, 'contactPhone'>;
}

async function errorsOf<T extends object>(cls: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

describe('MemberShopListingDto', () => {
  it('정상 입력은 통과하고 전화번호의 하이픈이 빠진다', async () => {
    const dto = plainToInstance(MemberShopListingDto, VALID);
    expect(await validate(dto)).toEqual([]);
    expect(dto.contactPhone).toBe('01012345678');
  });

  it('회원 글은 전화번호가 필수다', async () => {
    expect(await errorsOf(MemberShopListingDto, withoutPhone(VALID))).toContain('contactPhone');
  });

  it('0 으로 시작하지 않는 번호는 거부', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, contactPhone: '1012345678' })).toContain('contactPhone');
  });

  it('공백뿐인 본문은 거부', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, content: '  \n ' })).toContain('content');
  });

  it('본문 10,000자 초과는 거부', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, content: 'a'.repeat(10_001) })).toContain('content');
  });

  it('이미지는 1~15장, 중복 불가', async () => {
    expect(await errorsOf(MemberShopListingDto, { ...VALID, imageFileIds: [] })).toContain('imageFileIds');
    expect(await errorsOf(MemberShopListingDto, { ...VALID, imageFileIds: [IMAGE, IMAGE] })).toContain('imageFileIds');
    const sixteen = Array.from({ length: 16 }, (_, i) => `019166f0-0000-7000-8000-${String(i).padStart(12, '0')}`);
    expect(await errorsOf(MemberShopListingDto, { ...VALID, imageFileIds: sixteen })).toContain('imageFileIds');
  });

  it('오픈채팅은 open.kakao.com 만', async () => {
    expect(
      await errorsOf(MemberShopListingDto, { ...VALID, kakaoOpenChatUrl: 'https://evil.example/open.kakao.com/' }),
    ).toContain('kakaoOpenChatUrl');
    expect(await errorsOf(MemberShopListingDto, { ...VALID, kakaoOpenChatUrl: 'https://open.kakao.com/o/abc' })).toEqual(
      [],
    );
  });
});

describe('AdminShopListingDto', () => {
  it('관리자 글은 전화번호가 없어도 된다', async () => {
    expect(await errorsOf(AdminShopListingDto, withoutPhone(VALID))).toEqual([]);
  });

  it('slug 형식을 검사한다', async () => {
    expect(await errorsOf(AdminShopListingDto, { ...VALID, slug: 'Bad Slug' })).toContain('slug');
    expect(await errorsOf(AdminShopListingDto, { ...VALID, slug: '강남-네일' })).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing-request.dto.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 요청 DTO 구현**

`apps/ugc-service/src/shop-listings/dto/shop-listing-request.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_SHOP_LISTING_CONTENT_LENGTH,
  MAX_SHOP_LISTING_IMAGES,
  SHOP_LISTING_AUTHOR_TYPES,
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  SHOP_LISTING_SLUG_PATTERN,
  SHOP_LISTING_STATUSES,
  type ShopListingAuthorType,
  type ShopListingBusinessType,
  type ShopListingDealType,
  type ShopListingRegion,
  type ShopListingStatus,
} from '../shop-listing.constants';
import { stripPhoneSeparators } from '../shop-listing.util';

const PHONE_PATTERN = /^0\d{8,10}$/;
const PHONE_MESSAGE = '전화번호는 0 으로 시작하는 9~11자리 숫자여야 합니다.';
const KAKAO_OPEN_CHAT_PATTERN = /^https:\/\/open\.kakao\.com\//;
const NOT_BLANK = /\S/;

// 두 DTO 가 필드를 상속으로 공유하지 않는다 — class-validator 가 부모의 @IsOptional 을 자식에 합쳐
// 「회원은 전화번호 필수」가 조용히 무력화된다. 필드를 고칠 땐 두 클래스를 같이 고칠 것.

export class MemberShopListingDto {
  @ApiProperty({ example: '강남 네일샵 양도합니다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '본문 (마크다운)', maxLength: MAX_SHOP_LISTING_CONTENT_LENGTH })
  @IsString()
  @MaxLength(MAX_SHOP_LISTING_CONTENT_LENGTH)
  @Matches(NOT_BLANK, { message: '본문을 입력해주세요.' })
  content: string;

  @ApiProperty({ enum: SHOP_LISTING_REGIONS })
  @IsIn(SHOP_LISTING_REGIONS)
  region: ShopListingRegion;

  @ApiProperty({ enum: SHOP_LISTING_BUSINESS_TYPES })
  @IsIn(SHOP_LISTING_BUSINESS_TYPES)
  businessType: ShopListingBusinessType;

  @ApiProperty({ enum: SHOP_LISTING_DEAL_TYPES })
  @IsIn(SHOP_LISTING_DEAL_TYPES)
  dealType: ShopListingDealType;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  areaPyeong?: number | null;

  @ApiProperty({ required: false, nullable: true, description: '보증금(원). 비우면 협의' })
  @IsOptional()
  @IsInt()
  @Min(0)
  deposit?: number | null;

  @ApiProperty({ required: false, nullable: true, description: '월세(원). 비우면 협의' })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRent?: number | null;

  @ApiProperty({ required: false, nullable: true, description: '권리금(원). 비우면 협의' })
  @IsOptional()
  @IsInt()
  @Min(0)
  keyMoney?: number | null;

  @ApiProperty({ type: [String], description: 'file-service fileId. 첫 장이 썸네일. 1~15장' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHOP_LISTING_IMAGES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  imageFileIds: string[];

  @ApiProperty({ example: '010-1234-5678', description: '하이픈·공백은 서버가 제거한다' })
  @Transform(({ value }) => stripPhoneSeparators(value))
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  contactPhone: string;

  @ApiProperty({ required: false, nullable: true, example: 'https://open.kakao.com/o/abcdef' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(KAKAO_OPEN_CHAT_PATTERN, { message: '카카오 오픈채팅 주소(https://open.kakao.com/…)만 넣을 수 있습니다.' })
  kakaoOpenChatUrl?: string | null;
}

export class AdminShopListingDto {
  @ApiProperty({ required: false, description: '비우면 제목에서 자동 생성. 수정 시 보내면 다시 만든다' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SHOP_LISTING_SLUG_PATTERN, { message: '주소는 한글, 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.' })
  slug?: string;

  @ApiProperty({ example: '강남 네일샵 양도합니다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '본문 (마크다운)', maxLength: MAX_SHOP_LISTING_CONTENT_LENGTH })
  @IsString()
  @MaxLength(MAX_SHOP_LISTING_CONTENT_LENGTH)
  @Matches(NOT_BLANK, { message: '본문을 입력해주세요.' })
  content: string;

  @ApiProperty({ enum: SHOP_LISTING_REGIONS })
  @IsIn(SHOP_LISTING_REGIONS)
  region: ShopListingRegion;

  @ApiProperty({ enum: SHOP_LISTING_BUSINESS_TYPES })
  @IsIn(SHOP_LISTING_BUSINESS_TYPES)
  businessType: ShopListingBusinessType;

  @ApiProperty({ enum: SHOP_LISTING_DEAL_TYPES })
  @IsIn(SHOP_LISTING_DEAL_TYPES)
  dealType: ShopListingDealType;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  areaPyeong?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  deposit?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRent?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  keyMoney?: number | null;

  @ApiProperty({ type: [String], description: 'file-service fileId. 첫 장이 썸네일. 1~15장' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHOP_LISTING_IMAGES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  imageFileIds: string[];

  @ApiProperty({ required: false, nullable: true, description: '관리자 글은 선택' })
  @IsOptional()
  @Transform(({ value }) => stripPhoneSeparators(value))
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  contactPhone?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(KAKAO_OPEN_CHAT_PATTERN, { message: '카카오 오픈채팅 주소(https://open.kakao.com/…)만 넣을 수 있습니다.' })
  kakaoOpenChatUrl?: string | null;
}

export class RejectShopListingDto {
  @ApiProperty({ description: '회원에게 보이는 거절 사유', maxLength: 500 })
  @IsString()
  @Matches(NOT_BLANK, { message: '거절 사유를 입력해주세요.' })
  @MaxLength(500)
  reason: string;
}

export class AdminShopListingListQueryDto {
  @ApiProperty({ required: false, enum: SHOP_LISTING_STATUSES })
  @IsOptional()
  @IsIn(SHOP_LISTING_STATUSES)
  status?: ShopListingStatus;

  @ApiProperty({ required: false, enum: SHOP_LISTING_AUTHOR_TYPES })
  @IsOptional()
  @IsIn(SHOP_LISTING_AUTHOR_TYPES)
  authorType?: ShopListingAuthorType;

  @ApiProperty({ required: false, description: '제목 부분일치' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
```

> 회원이 `slug` 를 보내도 `MemberShopListingDto` 에 선언이 없으므로 전역 `ValidationPipe({ whitelist: true })` 가 벗긴다(`apps/ugc-service/src/main.ts`). 매니저도 회원 경로에서는 `dto.slug` 를 읽지 않는다.

- [ ] **Step 4: 응답 DTO 구현**

`apps/ugc-service/src/shop-listings/dto/shop-listing-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import {
  SHOP_LISTING_AUTHOR_TYPES,
  SHOP_LISTING_MODERATION_DECISIONS,
  SHOP_LISTING_STATUSES,
  type ShopListingAuthorType,
  type ShopListingModerationDecision,
  type ShopListingStatus,
} from '../shop-listing.constants';

/** 공개 목록·상세. 연락처와 작성자는 넣지 않는다. */
export class PublicShopListingResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: '본문 (마크다운)' }) content: string;
  @ApiProperty({ nullable: true }) region: string | null;
  @ApiProperty({ nullable: true }) businessType: string | null;
  @ApiProperty({ nullable: true }) dealType: string | null;
  @ApiProperty({ nullable: true }) areaPyeong: number | null;
  @ApiProperty({ nullable: true }) deposit: number | null;
  @ApiProperty({ nullable: true }) monthlyRent: number | null;
  @ApiProperty({ nullable: true }) keyMoney: number | null;
  @ApiProperty({ nullable: true, description: 'imageFileIds[0]. 목록 카드·OG 이미지' }) thumbnailFileId: string | null;
  @ApiProperty({ type: [String], description: '순서 = 노출 순서' }) imageFileIds: string[];
  @ApiProperty({ enum: SHOP_LISTING_STATUSES, description: 'published 또는 closed(거래완료)' })
  status: ShopListingStatus;
  @ApiProperty() viewCount: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class ShopListingContactResponseDto {
  @ApiProperty({ nullable: true, description: '숫자만' }) contactPhone: string | null;
  @ApiProperty({ nullable: true }) kakaoOpenChatUrl: string | null;
}

/** 작성 회원 본인에게. 상태·거절 사유·연락처를 포함한다. */
export class MyShopListingResponseDto extends PublicShopListingResponseDto {
  @ApiProperty({ nullable: true, description: 'status 가 rejected 일 때만 값이 있다' }) rejectReason: string | null;
  @ApiProperty({ nullable: true }) contactPhone: string | null;
  @ApiProperty({ nullable: true }) kakaoOpenChatUrl: string | null;
  @ApiProperty({ nullable: true }) submittedAt: string | null;
}

export class AdminShopListingResponseDto extends MyShopListingResponseDto {
  @ApiProperty({ enum: SHOP_LISTING_AUTHOR_TYPES }) authorType: ShopListingAuthorType;
  @ApiProperty({ nullable: true }) authorUserId: string | null;
}

export class ShopListingModerationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['admin', 'classifier'] }) decidedBy: 'admin' | 'classifier';
  @ApiProperty({ enum: SHOP_LISTING_MODERATION_DECISIONS }) decision: ShopListingModerationDecision;
  @ApiProperty({ nullable: true }) label: string | null;
  @ApiProperty({ nullable: true }) confidence: number | null;
  @ApiProperty({ nullable: true }) reason: string | null;
  @ApiProperty({ nullable: true }) actorUserId: string | null;
  @ApiProperty() createdAt: string;
}

export class AdminShopListingDetailResponseDto extends AdminShopListingResponseDto {
  @ApiProperty({ type: [ShopListingModerationResponseDto], description: '최신순' })
  moderations: ShopListingModerationResponseDto[];
}
```

`apps/ugc-service/src/shop-listings/dto/index.ts`:

```ts
export * from './shop-listing-request.dto';
export * from './shop-listing-response.dto';
```

- [ ] **Step 5: DTO 스펙 통과 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing-request.dto.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: 매퍼 스펙 작성**

`apps/ugc-service/src/shop-listings/__tests__/shop-listing.mapper.spec.ts`:

```ts
import { ShopListingMapper } from '../mappers/shop-listing.mapper';
import { type ShopListingWithImages } from '../types';

const BASE: ShopListingWithImages = {
  id: 'l-1',
  slug: 'gangnam',
  title: '강남',
  content: '본문',
  region: 'seoul',
  businessType: 'nail',
  dealType: 'transfer',
  areaPyeong: 10,
  deposit: null,
  monthlyRent: null,
  keyMoney: null,
  contactPhone: '01012345678',
  kakaoOpenChatUrl: null,
  authorType: 'member',
  authorUserId: 'u-1',
  status: 'published',
  rejectReason: '예전 사유',
  submittedAt: new Date('2026-09-23T00:00:00.000Z'),
  viewCount: 3,
  updatedBy: null,
  deletedAt: null,
  deletedBy: null,
  createdAt: new Date('2026-09-23T00:00:00.000Z'),
  updatedAt: new Date('2026-09-23T00:00:00.000Z'),
  imageFileIds: ['f-0', 'f-1'],
};

describe('ShopListingMapper', () => {
  it('공개 DTO 에는 연락처·작성자가 없다', () => {
    const dto = ShopListingMapper.toPublicDto(BASE);
    expect(dto).not.toHaveProperty('contactPhone');
    expect(dto).not.toHaveProperty('kakaoOpenChatUrl');
    expect(dto).not.toHaveProperty('authorUserId');
    expect(dto).not.toHaveProperty('authorType');
  });

  it('썸네일은 첫 이미지다', () => {
    expect(ShopListingMapper.toPublicDto(BASE).thumbnailFileId).toBe('f-0');
    expect(ShopListingMapper.toPublicDto({ ...BASE, imageFileIds: [] }).thumbnailFileId).toBeNull();
  });

  it('거절 사유는 rejected 일 때만 내보낸다 — 승인 후에 옛 사유가 남아 보이지 않게', () => {
    expect(ShopListingMapper.toMineDto(BASE).rejectReason).toBeNull();
    expect(ShopListingMapper.toMineDto({ ...BASE, status: 'rejected' }).rejectReason).toBe('예전 사유');
  });
});
```

- [ ] **Step 7: 매퍼 구현**

`apps/ugc-service/src/shop-listings/mappers/shop-listing.mapper.ts`:

```ts
import {
  type AdminShopListingDetailResponseDto,
  type AdminShopListingResponseDto,
  type MyShopListingResponseDto,
  type PublicShopListingResponseDto,
  type ShopListingContactResponseDto,
  type ShopListingModerationResponseDto,
} from '../dto';
import { type ShopListingModerationEntity, type ShopListingWithImages } from '../types';

export class ShopListingMapper {
  static toPublicDto(e: ShopListingWithImages): PublicShopListingResponseDto {
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      content: e.content,
      region: e.region,
      businessType: e.businessType,
      dealType: e.dealType,
      areaPyeong: e.areaPyeong,
      deposit: e.deposit,
      monthlyRent: e.monthlyRent,
      keyMoney: e.keyMoney,
      thumbnailFileId: e.imageFileIds[0] ?? null,
      imageFileIds: e.imageFileIds,
      status: e.status,
      viewCount: e.viewCount,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  static toMineDto(e: ShopListingWithImages): MyShopListingResponseDto {
    return {
      ...ShopListingMapper.toPublicDto(e),
      rejectReason: e.status === 'rejected' ? e.rejectReason : null,
      contactPhone: e.contactPhone,
      kakaoOpenChatUrl: e.kakaoOpenChatUrl,
      submittedAt: e.submittedAt?.toISOString() ?? null,
    };
  }

  static toAdminDto(e: ShopListingWithImages): AdminShopListingResponseDto {
    return { ...ShopListingMapper.toMineDto(e), authorType: e.authorType, authorUserId: e.authorUserId };
  }

  static toAdminDetailDto(
    e: ShopListingWithImages,
    moderations: ShopListingModerationEntity[],
  ): AdminShopListingDetailResponseDto {
    return { ...ShopListingMapper.toAdminDto(e), moderations: moderations.map(ShopListingMapper.toModerationDto) };
  }

  static toContactDto(e: Pick<ShopListingWithImages, 'contactPhone' | 'kakaoOpenChatUrl'>): ShopListingContactResponseDto {
    return { contactPhone: e.contactPhone, kakaoOpenChatUrl: e.kakaoOpenChatUrl };
  }

  static toModerationDto(m: ShopListingModerationEntity): ShopListingModerationResponseDto {
    return {
      id: m.id,
      decidedBy: m.decidedBy,
      decision: m.decision,
      label: m.label,
      confidence: m.confidence,
      reason: m.reason,
      actorUserId: m.actorUserId,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/__tests__/shop-listing.mapper.spec.ts apps/ugc-service/src/shop-listings/__tests__/shop-listing-request.dto.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/ugc-service/src/shop-listings/dto apps/ugc-service/src/shop-listings/mappers \
  apps/ugc-service/src/shop-listings/__tests__/shop-listing-request.dto.spec.ts apps/ugc-service/src/shop-listings/__tests__/shop-listing.mapper.spec.ts
git commit -m "feat(ugc): 샵 매매 요청·응답 DTO 와 매퍼 — 공개 응답에서 연락처를 뺀다"
```

---

### Task 6: Reader

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listing.reader.ts`
- Test: Task 7·8 의 통합 스펙이 함께 검증한다(Reader 단독 목 테스트는 SQL 을 검증하지 못한다).

**Interfaces:**
- Consumes: 테이블(Task 1), `PUBLIC_SHOP_LISTING_STATUSES`, `MEMBER_ACTIVE_LISTING_LIMIT` 는 쓰지 않음
- Produces (전부 `tx?: UgcTx` 마지막 인자):
  - `listPublic(): Promise<ShopListingWithImages[]>`
  - `findPublicBySlug(slug): Promise<ShopListingWithImages>` — 없으면 `NotFoundError`
  - `findContactBySlug(slug): Promise<Pick<ShopListingEntity, 'contactPhone' | 'kakaoOpenChatUrl'>>` — 없으면 `NotFoundError`
  - `listByAuthor(userId): Promise<ShopListingWithImages[]>`
  - `findOwned(id, userId): Promise<ShopListingWithImages>` — 남의 글·삭제 글은 `NotFoundError`
  - `listForAdmin(query: AdminShopListingListQueryDto): Promise<ShopListingWithImages[]>`
  - `findForAdmin(id): Promise<ShopListingWithImages>` — 삭제 글은 `NotFoundError`
  - `listModerations(listingId): Promise<ShopListingModerationEntity[]>` — 최신순
  - `slugTaken(slug, excludeId: string | null): Promise<boolean>`
  - `countActiveByAuthor(userId): Promise<number>`

- [ ] **Step 1: 구현**

`apps/ugc-service/src/shop-listings/shop-listing.reader.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import {
  shopListingImages,
  shopListingModerations,
  shopListings,
  type UgcServiceSchema,
  type UgcTx,
} from '../db/schema';
import { type AdminShopListingListQueryDto } from './dto';
import { PUBLIC_SHOP_LISTING_STATUSES } from './shop-listing.constants';
import { type ShopListingEntity, type ShopListingModerationEntity, type ShopListingWithImages } from './types';

@Injectable()
export class ShopListingReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async listPublic(tx?: UgcTx): Promise<ShopListingWithImages[]> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select()
        .from(shopListings)
        .where(and(inArray(shopListings.status, [...PUBLIC_SHOP_LISTING_STATUSES]), isNull(shopListings.deletedAt)))
        .orderBy(desc(shopListings.createdAt));
      return this.attachImages(trx, rows);
    }, tx);
  }

  async findPublicBySlug(slug: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(shopListings)
        .where(this.publicSlugCondition(slug))
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${slug}`);
      const [withImages] = await this.attachImages(trx, [row]);
      return withImages;
    }, tx);
  }

  async findContactBySlug(
    slug: string,
    tx?: UgcTx,
  ): Promise<Pick<ShopListingEntity, 'contactPhone' | 'kakaoOpenChatUrl'>> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ contactPhone: shopListings.contactPhone, kakaoOpenChatUrl: shopListings.kakaoOpenChatUrl })
        .from(shopListings)
        .where(this.publicSlugCondition(slug))
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${slug}`);
      return row;
    }, tx);
  }

  async listByAuthor(userId: string, tx?: UgcTx): Promise<ShopListingWithImages[]> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select()
        .from(shopListings)
        .where(and(eq(shopListings.authorUserId, userId), isNull(shopListings.deletedAt)))
        .orderBy(desc(shopListings.createdAt));
      return this.attachImages(trx, rows);
    }, tx);
  }

  /** 남의 글·삭제된 글은 존재를 숨기고 404 — 소유권은 WHERE 에서 판정한다. */
  async findOwned(id: string, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(shopListings)
        .where(and(eq(shopListings.id, id), eq(shopListings.authorUserId, userId), isNull(shopListings.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${id}`);
      const [withImages] = await this.attachImages(trx, [row]);
      return withImages;
    }, tx);
  }

  async listForAdmin(query: AdminShopListingListQueryDto, tx?: UgcTx): Promise<ShopListingWithImages[]> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [isNull(shopListings.deletedAt)];
      if (query.status) conditions.push(eq(shopListings.status, query.status));
      if (query.authorType) conditions.push(eq(shopListings.authorType, query.authorType));
      if (query.q) conditions.push(ilike(shopListings.title, `%${query.q}%`));

      // 검토 대기열은 오래 기다린 순서대로 본다.
      const order = query.status === 'pending' ? asc(shopListings.submittedAt) : desc(shopListings.createdAt);

      const rows = await trx
        .select()
        .from(shopListings)
        .where(and(...conditions))
        .orderBy(order);
      return this.attachImages(trx, rows);
    }, tx);
  }

  async findForAdmin(id: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(shopListings)
        .where(and(eq(shopListings.id, id), isNull(shopListings.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${id}`);
      const [withImages] = await this.attachImages(trx, [row]);
      return withImages;
    }, tx);
  }

  async listModerations(listingId: string, tx?: UgcTx): Promise<ShopListingModerationEntity[]> {
    return this.db.run(async (trx) => {
      return trx
        .select()
        .from(shopListingModerations)
        .where(eq(shopListingModerations.listingId, listingId))
        .orderBy(desc(shopListingModerations.createdAt));
    }, tx);
  }

  async slugTaken(slug: string, excludeId: string | null, tx?: UgcTx): Promise<boolean> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [eq(shopListings.slug, slug), isNull(shopListings.deletedAt)];
      if (excludeId) conditions.push(ne(shopListings.id, excludeId));
      const [row] = await trx
        .select({ id: shopListings.id })
        .from(shopListings)
        .where(and(...conditions))
        .limit(1);
      return row !== undefined;
    }, tx);
  }

  /** 동시 게시 한도의 분자. 호출자는 advisory lock 을 잡은 트랜잭션에서 부른다. */
  async countActiveByAuthor(userId: string, tx?: UgcTx): Promise<number> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ n: count() })
        .from(shopListings)
        .where(
          and(
            eq(shopListings.authorUserId, userId),
            inArray(shopListings.status, ['pending', 'published']),
            isNull(shopListings.deletedAt),
          ),
        );
      return row?.n ?? 0;
    }, tx);
  }

  private publicSlugCondition(slug: string): SQL | undefined {
    return and(
      eq(shopListings.slug, slug),
      inArray(shopListings.status, [...PUBLIC_SHOP_LISTING_STATUSES]),
      isNull(shopListings.deletedAt),
    );
  }

  private async attachImages(trx: UgcTx, rows: ShopListingEntity[]): Promise<ShopListingWithImages[]> {
    if (rows.length === 0) return [];
    const images = await trx
      .select({ listingId: shopListingImages.listingId, fileId: shopListingImages.fileId })
      .from(shopListingImages)
      .where(
        inArray(
          shopListingImages.listingId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(shopListingImages.listingId), asc(shopListingImages.order));

    const byListing = new Map<string, string[]>();
    for (const image of images) {
      const list = byListing.get(image.listingId) ?? [];
      list.push(image.fileId);
      byListing.set(image.listingId, list);
    }
    return rows.map((r) => ({ ...r, imageFileIds: byListing.get(r.id) ?? [] }));
  }
}
```

- [ ] **Step 2: type-check**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 3: Commit**

```bash
git add apps/ugc-service/src/shop-listings/shop-listing.reader.ts
git commit -m "feat(ugc): 샵 매매 Reader — 소유권은 WHERE 에서, 이미지는 한 번에 붙인다"
```

---

### Task 7: 판정 이력 Manager (승인·거절·숨김·해제)

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.ts`
- Create: `apps/ugc-service/src/shop-listings/__tests__/shop-listing-test-db.ts` (통합 스펙 공용 헬퍼)
- Test: `apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.integration.spec.ts`

**Interfaces:**
- Consumes: `ShopListingReader.findForAdmin`(Task 6), `nextStatus`(Task 3), `AutoDecision`·`ShopListingClassification`(Task 4)
- Produces:
  - `approve(id, adminId, tx?): Promise<ShopListingWithImages>`
  - `reject(id, reason, adminId, tx?): Promise<ShopListingWithImages>`
  - `hide(id, adminId, tx?)`, `unhide(id, adminId, tx?)` — 반환 동일
  - `recordClassification(trx: UgcTx, listing: Pick<ShopListingEntity, 'id' | 'title' | 'content'>, result: ShopListingClassification | null, decision: AutoDecision): Promise<void>` — `result` 가 null 이면 아무것도 안 쓴다
  - `updateStatusGuarded(trx, id, expected: ShopListingStatus, patch): Promise<ShopListingEntity>` — 상태가 그사이 바뀌었으면 `ConflictError` (Task 8 도 쓴다)
  - 테스트 헬퍼: `makeTestDb(url)`, `insertListing(db, overrides)`, `cleanup(db, ids)`

- [ ] **Step 1: 통합 스펙 공용 헬퍼 작성**

`apps/ugc-service/src/shop-listings/__tests__/shop-listing-test-db.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import {
  shopListingImages,
  shopListings,
  ugcServiceSchema,
  type UgcServiceSchema,
} from '../../db/schema';
import { type ShopListingInsert } from '../types';

export type TestDrizzle = ReturnType<typeof drizzle<UgcServiceSchema>>;

export function makeTestDb(url: string): { sql: postgres.Sql; db: TestDrizzle; dbService: DbService<UgcServiceSchema> } {
  const sql = postgres(url, { max: 6 });
  const db = drizzle(sql, { schema: ugcServiceSchema });
  // 기존 ugc 통합 스펙과 같은 모양의 더블 — run 의 전파 규칙만 흉내 낸다.
  const dbService = {
    db,
    run: (fn: (trx: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
  } as unknown as DbService<UgcServiceSchema>;
  return { sql, db, dbService };
}

export async function insertListing(db: TestDrizzle, overrides: Partial<ShopListingInsert> = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(shopListings).values({
    id,
    slug: `test-${id}`,
    title: '테스트 매물',
    content: '본문',
    region: 'seoul',
    businessType: 'nail',
    dealType: 'transfer',
    authorType: 'member',
    authorUserId: randomUUID(),
    status: 'pending',
    contactPhone: '01012345678',
    submittedAt: new Date(),
    ...overrides,
  });
  await db.insert(shopListingImages).values({ listingId: id, fileId: randomUUID(), order: 0 });
  return id;
}

/** 이미지·판정 이력·조회 기록은 FK cascade 로 같이 지워진다. */
export async function cleanup(db: TestDrizzle, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(shopListings).where(inArray(shopListings.id, ids));
}
```

- [ ] **Step 2: 실패하는 통합 스펙 작성**

`apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { shopListingModerations, shopListings } from '../db/schema';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingReader } from './shop-listing.reader';
import { cleanup, insertListing, makeTestDb, type TestDrizzle } from './__tests__/shop-listing-test-db';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="shop-listing-moderation.manager.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShopListingModerationManager (실 Postgres)', () => {
  jest.setTimeout(60_000);

  const adminId = randomUUID();
  const created: string[] = [];
  let sqlClient: ReturnType<typeof makeTestDb>['sql'];
  let db: TestDrizzle;
  let manager: ShopListingModerationManager;

  beforeAll(() => {
    const t = makeTestDb(DATABASE_URL as string);
    sqlClient = t.sql;
    db = t.db;
    manager = new ShopListingModerationManager(t.dbService, new ShopListingReader(t.dbService));
  });

  afterAll(async () => {
    await cleanup(db, created);
    await sqlClient.end();
  });

  const listing = async (status: 'pending' | 'published' | 'hidden' | 'closed' | 'rejected') => {
    const id = await insertListing(db, { status });
    created.push(id);
    return id;
  };

  const moderationsOf = (id: string) =>
    db.select().from(shopListingModerations).where(eq(shopListingModerations.listingId, id));

  it('승인하면 published 가 되고 관리자 판정이 스냅샷과 함께 남는다', async () => {
    const id = await listing('pending');
    const result = await manager.approve(id, adminId);

    expect(result.status).toBe('published');
    const [m] = await moderationsOf(id);
    expect(m).toMatchObject({ decidedBy: 'admin', decision: 'approved', actorUserId: adminId, titleSnapshot: '테스트 매물' });
  });

  it('거절하면 사유가 글과 이력 양쪽에 남는다', async () => {
    const id = await listing('pending');
    const result = await manager.reject(id, '연락처가 가짜입니다', adminId);

    expect(result).toMatchObject({ status: 'rejected', rejectReason: '연락처가 가짜입니다' });
    const [m] = await moderationsOf(id);
    expect(m).toMatchObject({ decision: 'rejected', reason: '연락처가 가짜입니다' });
  });

  it('숨김과 해제', async () => {
    const id = await listing('closed');
    expect((await manager.hide(id, adminId)).status).toBe('hidden');
    expect((await manager.unhide(id, adminId)).status).toBe('published');
    expect((await moderationsOf(id)).map((m) => m.decision).sort()).toEqual(['hidden', 'unhidden']);
  });

  it('허용되지 않는 전이는 409', async () => {
    const id = await listing('published');
    await expect(manager.approve(id, adminId)).rejects.toThrow(ConflictError);
  });

  it('삭제된 글은 404', async () => {
    const id = await listing('pending');
    await db.update(shopListings).set({ deletedAt: new Date() }).where(eq(shopListings.id, id));
    await expect(manager.approve(id, adminId)).rejects.toThrow(NotFoundError);
  });

  it('읽은 뒤 상태가 바뀌었으면 409 — 관리자 승인과 회원 수정이 겹치는 경우', async () => {
    const id = await listing('pending');
    await expect(
      db.transaction(async (trx) => {
        await manager.updateStatusGuarded(trx, id, 'published', { status: 'hidden' });
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('판정기 결과가 없으면 이력을 남기지 않는다', async () => {
    const id = await listing('pending');
    await db.transaction((trx) => manager.recordClassification(trx, { id, title: 't', content: 'c' }, null, 'pending'));
    expect(await moderationsOf(id)).toHaveLength(0);
  });

  it('판정기 결과는 라벨·확신도와 함께 남는다 — 섀도 모드의 정답셋', async () => {
    const id = await listing('pending');
    await db.transaction((trx) =>
      manager.recordClassification(
        trx,
        { id, title: 't', content: 'c' },
        { label: 'shop_listing', confidence: 0.42 },
        'pending',
      ),
    );
    const [m] = await moderationsOf(id);
    expect(m).toMatchObject({ decidedBy: 'classifier', decision: 'pending', label: 'shop_listing' });
    expect(m.confidence).toBeCloseTo(0.42);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listing-moderation.manager.integration"`
Expected: FAIL — `Cannot find module './shop-listing-moderation.manager'`

- [ ] **Step 4: 구현**

`apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { shopListingModerations, shopListings, type UgcServiceSchema, type UgcTx } from '../db/schema';
import { type AutoDecision } from './classifier/auto-decision';
import { type ShopListingClassification } from './classifier/shop-listing-classifier';
import { type ShopListingModerationDecision, type ShopListingStatus } from './shop-listing.constants';
import { ShopListingReader } from './shop-listing.reader';
import { nextStatus, type ShopListingAction } from './shop-listing.transitions';
import { type ShopListingEntity, type ShopListingInsert, type ShopListingWithImages } from './types';

type AdminModerationAction = Extract<ShopListingAction, 'approve' | 'reject' | 'hide' | 'unhide'>;

const DECISION_OF: Record<AdminModerationAction, ShopListingModerationDecision> = {
  approve: 'approved',
  reject: 'rejected',
  hide: 'hidden',
  unhide: 'unhidden',
};

const AUTO_DECISION_OF: Record<AutoDecision, ShopListingModerationDecision> = {
  published: 'approved',
  rejected: 'rejected',
  pending: 'pending',
};

@Injectable()
export class ShopListingModerationManager {
  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly reader: ShopListingReader,
  ) {}

  approve(id: string, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.moderate(id, 'approve', adminId, null, tx);
  }

  reject(id: string, reason: string, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.moderate(id, 'reject', adminId, reason.trim(), tx);
  }

  hide(id: string, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.moderate(id, 'hide', adminId, null, tx);
  }

  unhide(id: string, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.moderate(id, 'unhide', adminId, null, tx);
  }

  /** 판정기 결과를 이력에 남긴다. 결과가 없으면(= v1 NullClassifier·장애) 남길 것이 없다. */
  async recordClassification(
    trx: UgcTx,
    listing: Pick<ShopListingEntity, 'id' | 'title' | 'content'>,
    result: ShopListingClassification | null,
    decision: AutoDecision,
  ): Promise<void> {
    if (!result) return;
    await trx.insert(shopListingModerations).values({
      listingId: listing.id,
      decidedBy: 'classifier',
      decision: AUTO_DECISION_OF[decision],
      label: result.label,
      confidence: result.confidence,
      titleSnapshot: listing.title,
      contentSnapshot: listing.content,
    });
  }

  /**
   * 상태를 읽은 값 그대로일 때만 바꾼다(CAS). 관리자 판정과 회원 수정이 겹치면 늦은 쪽이 409 를 받는다.
   * advisory lock 은 작성자 단위라 관리자 동작을 막지 못하므로 이 가드가 필요하다.
   */
  async updateStatusGuarded(
    trx: UgcTx,
    id: string,
    expected: ShopListingStatus,
    patch: Partial<ShopListingInsert>,
  ): Promise<ShopListingEntity> {
    const [updated] = await trx
      .update(shopListings)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(shopListings.id, id), eq(shopListings.status, expected), isNull(shopListings.deletedAt)))
      .returning();
    if (!updated) {
      throw new ConflictError('글의 상태가 그사이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.');
    }
    return updated;
  }

  private moderate(
    id: string,
    action: AdminModerationAction,
    adminId: string,
    reason: string | null,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const current = await this.reader.findForAdmin(id, trx);
      const status = nextStatus(current.status, action);

      const updated = await this.updateStatusGuarded(trx, id, current.status, {
        status,
        updatedBy: adminId,
        ...(action === 'reject' ? { rejectReason: reason } : {}),
      });

      await trx.insert(shopListingModerations).values({
        listingId: id,
        decidedBy: 'admin',
        decision: DECISION_OF[action],
        reason,
        actorUserId: adminId,
        titleSnapshot: current.title,
        contentSnapshot: current.content,
      });

      return { ...updated, imageFileIds: current.imageFileIds };
    }, tx);
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listing-moderation.manager.integration"`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.ts \
  apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.integration.spec.ts \
  apps/ugc-service/src/shop-listings/__tests__/shop-listing-test-db.ts
git commit -m "feat(ugc): 샵 매매 승인·거절·숨김과 판정 이력 — 상태 CAS 로 겹침을 막는다"
```

---

### Task 8: 작성·수정 Manager (회원·관리자·탈퇴)

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listing.manager.ts`
- Test: `apps/ugc-service/src/shop-listings/shop-listing.manager.integration.spec.ts`

**Interfaces:**
- Consumes: `ShopListingReader`(Task 6), `ShopListingModerationManager.recordClassification`·`updateStatusGuarded`(Task 7), `classifySafely`·`decide`·`CLASSIFIER_REJECT_REASON`·토큰(Task 4), `nextStatus`·`entersLimit`(Task 3), `slugify`(Task 2), DTO(Task 5)
- Produces:
  - 회원: `createByMember(dto: MemberShopListingDto, userId, tx?)`, `updateByMember(id, dto, userId, tx?)`, `closeByMember(id, userId, tx?)`, `reopenByMember(id, userId, tx?)` → `Promise<ShopListingWithImages>`; `deleteByMember(id, userId, tx?): Promise<void>`
  - 관리자: `createByAdmin(dto: AdminShopListingDto, adminId, tx?)`, `updateByAdmin(id, dto, adminId, tx?)`, `setDealStatusByAdmin(id, action: 'close' | 'reopen', adminId, tx?)` → `Promise<ShopListingWithImages>`; `deleteByAdmin(id, adminId, tx?): Promise<void>`
  - 탈퇴: `withdrawAuthor(userId, tx?): Promise<number>`

- [ ] **Step 1: 실패하는 통합 스펙 작성**

`apps/ugc-service/src/shop-listings/shop-listing.manager.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { shopListings } from '../db/schema';
import { type AutoDecisionPolicy } from './classifier/auto-decision';
import { NullShopListingClassifier, type ShopListingClassifier } from './classifier/shop-listing-classifier';
import { type AdminShopListingDto, type MemberShopListingDto } from './dto';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';
import { cleanup, makeTestDb, type TestDrizzle } from './__tests__/shop-listing-test-db';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="shop-listing.manager.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const OFF: AutoDecisionPolicy = { enabled: false, approveThreshold: 0.9, rejectThreshold: 0.9 };

function memberDto(overrides: Partial<MemberShopListingDto> = {}): MemberShopListingDto {
  return {
    title: `강남 네일샵 ${randomUUID().slice(0, 8)}`,
    content: '역 5분 거리',
    region: 'seoul',
    businessType: 'nail',
    dealType: 'transfer',
    imageFileIds: [randomUUID(), randomUUID()],
    contactPhone: '01012345678',
    ...overrides,
  };
}

describeIfDb('ShopListingManager (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sqlClient: ReturnType<typeof makeTestDb>['sql'];
  let db: TestDrizzle;
  let t: ReturnType<typeof makeTestDb>;
  const authors: string[] = [];

  const build = (classifier: ShopListingClassifier = new NullShopListingClassifier(), policy = OFF) => {
    const reader = new ShopListingReader(t.dbService);
    const moderation = new ShopListingModerationManager(t.dbService, reader);
    return new ShopListingManager(t.dbService, reader, moderation, classifier, policy);
  };

  const newAuthor = () => {
    const id = randomUUID();
    authors.push(id);
    return id;
  };

  beforeAll(() => {
    t = makeTestDb(DATABASE_URL as string);
    sqlClient = t.sql;
    db = t.db;
  });

  afterAll(async () => {
    const rows = await db
      .select({ id: shopListings.id })
      .from(shopListings)
      .where(inArray(shopListings.authorUserId, authors));
    await cleanup(
      db,
      rows.map((r) => r.id),
    );
    await sqlClient.end();
  });

  it('회원 글은 v1 에서 pending 으로 들어가고 이미지 순서가 보존된다', async () => {
    const userId = newAuthor();
    const dto = memberDto();
    const created = await build().createByMember(dto, userId);

    expect(created).toMatchObject({ status: 'pending', authorType: 'member', authorUserId: userId });
    expect(created.imageFileIds).toEqual(dto.imageFileIds);
    expect(created.submittedAt).toBeInstanceOf(Date);
  });

  it('동시 게시 한도: 병렬 4건 → 3건만 성공', async () => {
    const userId = newAuthor();
    const manager = build();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => manager.createByMember(memberDto(), userId)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
  });

  it('남의 글은 수정·거래완료·삭제 모두 404', async () => {
    const owner = newAuthor();
    const other = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), owner);

    await expect(manager.updateByMember(created.id, memberDto(), other)).rejects.toThrow(NotFoundError);
    await expect(manager.closeByMember(created.id, other)).rejects.toThrow(NotFoundError);
    await expect(manager.deleteByMember(created.id, other)).rejects.toThrow(NotFoundError);
  });

  it('승인된 글을 회원이 고치면 pending 으로 내려가고 slug 는 그대로다', async () => {
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'published' }).where(eq(shopListings.id, created.id));

    const updated = await manager.updateByMember(created.id, memberDto({ title: '완전히 다른 제목' }), userId);

    expect(updated.status).toBe('pending');
    expect(updated.slug).toBe(created.slug);
    expect(updated.title).toBe('완전히 다른 제목');
  });

  it('숨김 글은 회원이 고칠 수 없지만 지울 수는 있다', async () => {
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'hidden' }).where(eq(shopListings.id, created.id));

    await expect(manager.updateByMember(created.id, memberDto(), userId)).rejects.toThrow(ConflictError);
    await expect(manager.deleteByMember(created.id, userId)).resolves.toBeUndefined();
  });

  it('회원이 지우면 연락처가 즉시 비워진다', async () => {
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto({ kakaoOpenChatUrl: 'https://open.kakao.com/o/x' }), userId);

    await manager.deleteByMember(created.id, userId);

    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, created.id));
    expect(row).toMatchObject({ contactPhone: null, kakaoOpenChatUrl: null, deletedBy: userId });
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it('거래완료 → 재개 시 한도를 검사한다', async () => {
    const userId = newAuthor();
    const manager = build();
    const first = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'published' }).where(eq(shopListings.id, first.id));
    await manager.closeByMember(first.id, userId);
    await manager.createByMember(memberDto(), userId);
    await manager.createByMember(memberDto(), userId);
    await manager.createByMember(memberDto(), userId);

    await expect(manager.reopenByMember(first.id, userId)).rejects.toThrow(ConflictError);
  });

  it('자동 판정이 켜져 있고 확신도가 높으면 바로 게시되고 이력이 남는다', async () => {
    const userId = newAuthor();
    const confident: ShopListingClassifier = {
      classify: () => Promise.resolve({ label: 'shop_listing', confidence: 0.99 }),
    };
    const created = await build(confident, { ...OFF, enabled: true }).createByMember(memberDto(), userId);

    expect(created.status).toBe('published');
  });

  it('관리자 글은 바로 published, 전화번호 없이도 된다', async () => {
    const adminId = newAuthor();
    const dto: AdminShopListingDto = {
      ...memberDto(),
      contactPhone: null,
      slug: `관리자-${randomUUID().slice(0, 8)}`,
    };
    const created = await build().createByAdmin(dto, adminId);

    expect(created).toMatchObject({ status: 'published', authorType: 'admin', slug: dto.slug, contactPhone: null });
  });

  it('관리자 수정은 상태를 바꾸지 않는다', async () => {
    const adminId = newAuthor();
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), userId);

    const updated = await manager.updateByAdmin(created.id, memberDto({ title: '관리자가 고친 제목' }), adminId);

    expect(updated).toMatchObject({ status: 'pending', title: '관리자가 고친 제목', slug: created.slug });
  });

  it('탈퇴하면 그 회원의 글 전부 연락처가 비고 공개에서 빠진다 — 두 번 불러도 같다', async () => {
    const userId = newAuthor();
    const manager = build();
    const a = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'published' }).where(eq(shopListings.id, a.id));

    expect(await manager.withdrawAuthor(userId)).toBe(1);
    await manager.withdrawAuthor(userId);

    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, a.id));
    expect(row).toMatchObject({ contactPhone: null, kakaoOpenChatUrl: null });
    expect(row.deletedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listing.manager.integration"`
Expected: FAIL — `Cannot find module './shop-listing.manager'`

- [ ] **Step 3: 구현**

`apps/ugc-service/src/shop-listings/shop-listing.manager.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { shopListingImages, shopListings, type UgcServiceSchema, type UgcTx } from '../db/schema';
import {
  type AutoDecision,
  type AutoDecisionPolicy,
  CLASSIFIER_REJECT_REASON,
  classifySafely,
  decide,
  SHOP_LISTING_AUTO_DECISION_POLICY,
} from './classifier/auto-decision';
import {
  SHOP_LISTING_CLASSIFIER,
  type ShopListingClassifier,
  type ShopListingClassifierInput,
} from './classifier/shop-listing-classifier';
import { type AdminShopListingDto, type MemberShopListingDto } from './dto';
import { MEMBER_ACTIVE_LISTING_LIMIT, SHOP_LISTING_ADVISORY_LOCK_CLASS } from './shop-listing.constants';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingReader } from './shop-listing.reader';
import { entersLimit, nextStatus } from './shop-listing.transitions';
import { slugify } from './shop-listing.util';
import { type ShopListingEntity, type ShopListingWithImages } from './types';

type ListingFields = Pick<
  MemberShopListingDto,
  | 'title'
  | 'content'
  | 'region'
  | 'businessType'
  | 'dealType'
  | 'areaPyeong'
  | 'deposit'
  | 'monthlyRent'
  | 'keyMoney'
  | 'kakaoOpenChatUrl'
>;

@Injectable()
export class ShopListingManager {
  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly reader: ShopListingReader,
    private readonly moderation: ShopListingModerationManager,
    @Inject(SHOP_LISTING_CLASSIFIER) private readonly classifier: ShopListingClassifier,
    @Inject(SHOP_LISTING_AUTO_DECISION_POLICY) private readonly policy: AutoDecisionPolicy,
  ) {}

  // ─── 회원 ───

  async createByMember(dto: MemberShopListingDto, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    // 판정기는 트랜잭션 밖에서 부른다 — 외부 호출 동안 커넥션·락을 쥐지 않는다.
    const classification = await classifySafely(this.classifier, toClassifierInput(dto));
    const decision = decide(classification, this.policy);

    return this.db.run(async (trx) => {
      await this.lockAuthor(trx, userId);
      await this.assertWithinLimit(trx, userId);

      const [created] = await trx
        .insert(shopListings)
        .values({
          ...fieldsOf(dto),
          slug: await this.resolveSlug(dto.title, null, trx),
          contactPhone: dto.contactPhone,
          authorType: 'member',
          authorUserId: userId,
          updatedBy: userId,
          ...statusPatchFor(decision),
          submittedAt: new Date(),
        })
        .returning();

      await this.replaceImages(trx, created.id, dto.imageFileIds);
      await this.moderation.recordClassification(trx, created, classification, decision);
      return { ...created, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  async updateByMember(
    id: string,
    dto: MemberShopListingDto,
    userId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    const classification = await classifySafely(this.classifier, toClassifierInput(dto));
    const decision = decide(classification, this.policy);

    return this.db.run(async (trx) => {
      await this.lockAuthor(trx, userId);
      const current = await this.reader.findOwned(id, userId, trx);
      nextStatus(current.status, 'member_edit'); // hidden 이면 409

      if (entersLimit(current.status, decision)) {
        await this.assertWithinLimit(trx, userId);
      }

      // slug 는 바꾸지 않는다 — 이미 색인·공유된 URL 을 깨지 않는다.
      const updated = await this.moderation.updateStatusGuarded(trx, id, current.status, {
        ...fieldsOf(dto),
        contactPhone: dto.contactPhone,
        updatedBy: userId,
        ...statusPatchFor(decision),
        submittedAt: new Date(),
      });

      await this.replaceImages(trx, id, dto.imageFileIds);
      await this.moderation.recordClassification(trx, updated, classification, decision);
      return { ...updated, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  closeByMember(id: string, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.setDealStatusByMember(id, 'close', userId, tx);
  }

  reopenByMember(id: string, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.setDealStatusByMember(id, 'reopen', userId, tx);
  }

  async deleteByMember(id: string, userId: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const now = new Date();
      const [deleted] = await trx
        .update(shopListings)
        .set({ ...CLEARED_CONTACT, deletedAt: now, deletedBy: userId, updatedAt: now })
        .where(and(eq(shopListings.id, id), eq(shopListings.authorUserId, userId), isNull(shopListings.deletedAt)))
        .returning({ id: shopListings.id });
      if (!deleted) throw new NotFoundError(`Shop listing not found: ${id}`);
    }, tx);
  }

  // ─── 관리자 ───

  async createByAdmin(dto: AdminShopListingDto, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [created] = await trx
        .insert(shopListings)
        .values({
          ...fieldsOf(dto),
          slug: await this.resolveSlug(dto.slug || dto.title, null, trx),
          contactPhone: dto.contactPhone ?? null,
          authorType: 'admin',
          authorUserId: adminId,
          updatedBy: adminId,
          status: 'published',
        })
        .returning();

      await this.replaceImages(trx, created.id, dto.imageFileIds);
      return { ...created, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  /** 관리자 수정은 재검토하지 않는다 — 상태를 그대로 둔다. */
  async updateByAdmin(
    id: string,
    dto: AdminShopListingDto,
    adminId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const current = await this.reader.findForAdmin(id, trx);
      const slug = dto.slug === undefined ? current.slug : await this.resolveSlug(dto.slug, id, trx);

      const [updated] = await trx
        .update(shopListings)
        .set({
          ...fieldsOf(dto),
          slug,
          contactPhone: dto.contactPhone ?? null,
          updatedBy: adminId,
          updatedAt: new Date(),
        })
        .where(and(eq(shopListings.id, id), isNull(shopListings.deletedAt)))
        .returning();
      if (!updated) throw new NotFoundError(`Shop listing not found: ${id}`);

      await this.replaceImages(trx, id, dto.imageFileIds);
      return { ...updated, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  /** 관리자는 한도에 걸리지 않는다. */
  async setDealStatusByAdmin(
    id: string,
    action: 'close' | 'reopen',
    adminId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const current = await this.reader.findForAdmin(id, trx);
      const updated = await this.moderation.updateStatusGuarded(trx, id, current.status, {
        status: nextStatus(current.status, action),
        updatedBy: adminId,
      });
      return { ...updated, imageFileIds: current.imageFileIds };
    }, tx);
  }

  async deleteByAdmin(id: string, adminId: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const now = new Date();
      const [deleted] = await trx
        .update(shopListings)
        .set({ ...CLEARED_CONTACT, deletedAt: now, deletedBy: adminId, updatedAt: now })
        .where(and(eq(shopListings.id, id), isNull(shopListings.deletedAt)))
        .returning({ id: shopListings.id });
      if (!deleted) throw new NotFoundError(`Shop listing not found: ${id}`);
    }, tx);
  }

  // ─── 탈퇴 ───

  /**
   * 영구 삭제된 회원의 글: 연락처를 비우고 감춘다. 이미 지워진 글의 연락처도 비운다.
   * 멱등 — 재전송돼도 결과가 같다. 반환값은 이번에 새로 감춘 글 수.
   */
  async withdrawAuthor(userId: string, tx?: UgcTx): Promise<number> {
    return this.db.run(async (trx) => {
      const now = new Date();
      const hidden = await trx
        .update(shopListings)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(shopListings.authorUserId, userId),
            eq(shopListings.authorType, 'member'),
            isNull(shopListings.deletedAt),
          ),
        )
        .returning({ id: shopListings.id });

      await trx
        .update(shopListings)
        .set(CLEARED_CONTACT)
        .where(and(eq(shopListings.authorUserId, userId), eq(shopListings.authorType, 'member')));

      return hidden.length;
    }, tx);
  }

  // ─── 내부 ───

  private async setDealStatusByMember(
    id: string,
    action: 'close' | 'reopen',
    userId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      await this.lockAuthor(trx, userId);
      const current = await this.reader.findOwned(id, userId, trx);
      const status = nextStatus(current.status, action);
      if (entersLimit(current.status, status)) {
        await this.assertWithinLimit(trx, userId);
      }
      const updated = await this.moderation.updateStatusGuarded(trx, id, current.status, {
        status,
        updatedBy: userId,
      });
      return { ...updated, imageFileIds: current.imageFileIds };
    }, tx);
  }

  /** 같은 회원의 작성·재개를 직렬화한다. 트랜잭션이 끝나면 풀린다. */
  private async lockAuthor(trx: UgcTx, userId: string): Promise<void> {
    await trx.execute(sql`select pg_advisory_xact_lock(${SHOP_LISTING_ADVISORY_LOCK_CLASS}, hashtext(${userId}))`);
  }

  private async assertWithinLimit(trx: UgcTx, userId: string): Promise<void> {
    const active = await this.reader.countActiveByAuthor(userId, trx);
    if (active >= MEMBER_ACTIVE_LISTING_LIMIT) {
      throw new ConflictError(
        `검토 중이거나 게시 중인 매물은 ${MEMBER_ACTIVE_LISTING_LIMIT}건까지입니다. 거래완료 처리하거나 지운 뒤 다시 등록해 주세요.`,
      );
    }
  }

  private async replaceImages(trx: UgcTx, listingId: string, fileIds: string[]): Promise<void> {
    await trx.delete(shopListingImages).where(eq(shopListingImages.listingId, listingId));
    await trx.insert(shopListingImages).values(fileIds.map((fileId, order) => ({ listingId, fileId, order })));
  }

  private async resolveSlug(raw: string, excludeId: string | null, trx: UgcTx): Promise<string> {
    const base = slugify(raw);
    if (!base) {
      throw new BadRequestError('주소를 만들 수 없습니다. 제목에 한글이나 영문을 넣어주세요.');
    }
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      if (!(await this.reader.slugTaken(candidate, excludeId, trx))) return candidate;
    }
    throw new ConflictError(`같은 주소가 너무 많습니다: ${base}`);
  }
}

const CLEARED_CONTACT = { contactPhone: null, kakaoOpenChatUrl: null } as const;

function fieldsOf(dto: ListingFields): Pick<
  ShopListingEntity,
  | 'title'
  | 'content'
  | 'region'
  | 'businessType'
  | 'dealType'
  | 'areaPyeong'
  | 'deposit'
  | 'monthlyRent'
  | 'keyMoney'
  | 'kakaoOpenChatUrl'
> {
  return {
    title: dto.title.trim(),
    content: dto.content,
    region: dto.region,
    businessType: dto.businessType,
    dealType: dto.dealType,
    areaPyeong: dto.areaPyeong ?? null,
    deposit: dto.deposit ?? null,
    monthlyRent: dto.monthlyRent ?? null,
    keyMoney: dto.keyMoney ?? null,
    kakaoOpenChatUrl: dto.kakaoOpenChatUrl ?? null,
  };
}

function statusPatchFor(decision: AutoDecision): Pick<ShopListingEntity, 'status' | 'rejectReason'> {
  return { status: decision, rejectReason: decision === 'rejected' ? CLASSIFIER_REJECT_REASON : null };
}

function toClassifierInput(dto: ListingFields): ShopListingClassifierInput {
  return {
    title: dto.title,
    content: dto.content,
    region: dto.region,
    businessType: dto.businessType,
    dealType: dto.dealType,
    deposit: dto.deposit ?? null,
    monthlyRent: dto.monthlyRent ?? null,
    keyMoney: dto.keyMoney ?? null,
  };
}
```

> `statusPatchFor` 는 회원 수정 시 이전 `rejectReason` 을 `null` 로 되돌린다(재제출하면 옛 거절 사유가 사라진다). 매퍼도 `rejected` 일 때만 사유를 내보내므로 두 겹으로 막힌다.

- [ ] **Step 4: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listing.manager.integration"`
Expected: PASS (11 tests)

- [ ] **Step 5: type-check**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 6: Commit**

```bash
git add apps/ugc-service/src/shop-listings/shop-listing.manager.ts apps/ugc-service/src/shop-listings/shop-listing.manager.integration.spec.ts
git commit -m "feat(ugc): 샵 매매 회원·관리자 작성과 탈퇴 처리 — 한도는 작성자 advisory lock 으로 직렬화"
```

---

### Task 9: 조회수 Manager

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listing-view.manager.ts`
- Test: `apps/ugc-service/src/shop-listings/shop-listing-view.manager.integration.spec.ts`

**Interfaces:**
- Consumes: `hashVisitor`·`kstToday`(Task 2)
- Produces: `recordView(slug: string, visitorIp: string, tx?: UgcTx): Promise<void>` — 없는·비공개 slug 는 조용히 무시

- [ ] **Step 1: 실패하는 통합 스펙 작성**

`apps/ugc-service/src/shop-listings/shop-listing-view.manager.integration.spec.ts`:

```ts
import { eq } from 'drizzle-orm';
import { shopListings } from '../db/schema';
import { ShopListingViewManager } from './shop-listing-view.manager';
import { cleanup, insertListing, makeTestDb, type TestDrizzle } from './__tests__/shop-listing-test-db';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="shop-listing-view.manager.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShopListingViewManager (실 Postgres)', () => {
  const created: string[] = [];
  let t: ReturnType<typeof makeTestDb>;
  let db: TestDrizzle;
  let manager: ShopListingViewManager;

  beforeAll(() => {
    t = makeTestDb(DATABASE_URL as string);
    db = t.db;
    manager = new ShopListingViewManager(t.dbService);
  });

  afterAll(async () => {
    await cleanup(db, created);
    await t.sql.end();
  });

  const viewCount = async (id: string) =>
    (await db.select({ n: shopListings.viewCount }).from(shopListings).where(eq(shopListings.id, id)))[0].n;

  it('같은 방문자의 같은 날 재조회는 한 번만 센다', async () => {
    const id = await insertListing(db, { status: 'published' });
    created.push(id);
    const [{ slug }] = await db.select({ slug: shopListings.slug }).from(shopListings).where(eq(shopListings.id, id));

    await manager.recordView(slug, '1.2.3.4');
    await manager.recordView(slug, '1.2.3.4');
    await manager.recordView(slug, '5.6.7.8');

    expect(await viewCount(id)).toBe(2);
  });

  it('비공개 글은 세지 않는다', async () => {
    const id = await insertListing(db, { status: 'pending' });
    created.push(id);
    const [{ slug }] = await db.select({ slug: shopListings.slug }).from(shopListings).where(eq(shopListings.id, id));

    await manager.recordView(slug, '1.2.3.4');

    expect(await viewCount(id)).toBe(0);
  });

  it('없는 slug 는 조용히 무시한다 — 봇이 던진 경로로 404 를 만들지 않는다', async () => {
    await expect(manager.recordView('no-such-slug-xyz', '1.2.3.4')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listing-view.manager.integration"`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`apps/ugc-service/src/shop-listings/shop-listing-view.manager.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { shopListings, shopListingViews, type UgcServiceSchema, type UgcTx } from '../db/schema';
import { PUBLIC_SHOP_LISTING_STATUSES } from './shop-listing.constants';
import { hashVisitor, kstToday } from './shop-listing.util';

@Injectable()
export class ShopListingViewManager {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  /**
   * 조회수 +1. 같은 방문자·같은 매물·같은 날은 unique 제약이 걸러내므로,
   * 로그 행이 실제로 새로 생겼을 때만 카운터를 올린다.
   */
  async recordView(slug: string, visitorIp: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const [listing] = await trx
        .select({ id: shopListings.id })
        .from(shopListings)
        .where(
          and(
            eq(shopListings.slug, slug),
            inArray(shopListings.status, [...PUBLIC_SHOP_LISTING_STATUSES]),
            isNull(shopListings.deletedAt),
          ),
        )
        .limit(1);
      if (!listing) return;

      const inserted = await trx
        .insert(shopListingViews)
        .values({ listingId: listing.id, visitorHash: hashVisitor(visitorIp, listing.id), viewedOn: kstToday() })
        .onConflictDoNothing()
        .returning({ id: shopListingViews.id });
      if (inserted.length === 0) return;

      await trx
        .update(shopListings)
        .set({ viewCount: sql`${shopListings.viewCount} + 1` })
        .where(eq(shopListings.id, listing.id));
    }, tx);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listing-view.manager.integration"`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ugc-service/src/shop-listings/shop-listing-view.manager.ts apps/ugc-service/src/shop-listings/shop-listing-view.manager.integration.spec.ts
git commit -m "feat(ugc): 샵 매매 조회수 비콘을 옮긴다"
```

---

### Task 10: Service·컨트롤러·모듈 배선 + 보안 레지스트리

**Files:**
- Create: `apps/ugc-service/src/shop-listings/shop-listings.service.ts`
- Create: `apps/ugc-service/src/shop-listings/controllers/public-shop-listings.controller.ts`
- Create: `apps/ugc-service/src/shop-listings/controllers/member-shop-listings.controller.ts`
- Create: `apps/ugc-service/src/shop-listings/controllers/admin-shop-listings.controller.ts`
- Create: `apps/ugc-service/src/shop-listings/shop-listings.module.ts`
- Modify: `apps/ugc-service/src/ugc-service.module.ts` (imports 배열, scopes 설명)
- Modify: `scripts/security/route-authz-audit.spec.ts:19` (`ALLOWED`)
- Modify: `scripts/security/idor-reviewed.spec.ts` (`IDOR_REVIEWED` 에 8건, 대상 수 테스트 2곳)

**Interfaces:**
- Consumes: Task 5~9 전부
- Produces: HTTP 라우트(spec §7 + Task 0 의 관리자 close/reopen), `ShopListingsModule`

- [ ] **Step 1: Service 작성**

`apps/ugc-service/src/shop-listings/shop-listings.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  type AdminShopListingDetailResponseDto,
  type AdminShopListingDto,
  type AdminShopListingListQueryDto,
  type AdminShopListingResponseDto,
  type MemberShopListingDto,
  type MyShopListingResponseDto,
  type PublicShopListingResponseDto,
  type ShopListingContactResponseDto,
} from './dto';
import { ShopListingMapper } from './mappers/shop-listing.mapper';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingViewManager } from './shop-listing-view.manager';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';

@Injectable()
export class ShopListingsService {
  constructor(
    private readonly reader: ShopListingReader,
    private readonly manager: ShopListingManager,
    private readonly moderation: ShopListingModerationManager,
    private readonly views: ShopListingViewManager,
  ) {}

  // 공개
  async listPublic(): Promise<PublicShopListingResponseDto[]> {
    return (await this.reader.listPublic()).map(ShopListingMapper.toPublicDto);
  }
  async getPublic(slug: string): Promise<PublicShopListingResponseDto> {
    return ShopListingMapper.toPublicDto(await this.reader.findPublicBySlug(slug));
  }
  async getContact(slug: string): Promise<ShopListingContactResponseDto> {
    return ShopListingMapper.toContactDto(await this.reader.findContactBySlug(slug));
  }
  recordView(slug: string, visitorIp: string): Promise<void> {
    return this.views.recordView(slug, visitorIp);
  }

  // 회원
  async listMine(userId: string): Promise<MyShopListingResponseDto[]> {
    return (await this.reader.listByAuthor(userId)).map(ShopListingMapper.toMineDto);
  }
  async getMine(id: string, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.reader.findOwned(id, userId));
  }
  async createByMember(dto: MemberShopListingDto, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.createByMember(dto, userId));
  }
  async updateByMember(id: string, dto: MemberShopListingDto, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.updateByMember(id, dto, userId));
  }
  async closeByMember(id: string, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.closeByMember(id, userId));
  }
  async reopenByMember(id: string, userId: string): Promise<MyShopListingResponseDto> {
    return ShopListingMapper.toMineDto(await this.manager.reopenByMember(id, userId));
  }
  deleteByMember(id: string, userId: string): Promise<void> {
    return this.manager.deleteByMember(id, userId);
  }

  // 관리자
  async listForAdmin(query: AdminShopListingListQueryDto): Promise<AdminShopListingResponseDto[]> {
    return (await this.reader.listForAdmin(query)).map(ShopListingMapper.toAdminDto);
  }
  async getForAdmin(id: string): Promise<AdminShopListingDetailResponseDto> {
    const [listing, moderations] = await Promise.all([this.reader.findForAdmin(id), this.reader.listModerations(id)]);
    return ShopListingMapper.toAdminDetailDto(listing, moderations);
  }
  async createByAdmin(dto: AdminShopListingDto, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.manager.createByAdmin(dto, adminId));
  }
  async updateByAdmin(id: string, dto: AdminShopListingDto, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.manager.updateByAdmin(id, dto, adminId));
  }
  async setDealStatusByAdmin(id: string, action: 'close' | 'reopen', adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.manager.setDealStatusByAdmin(id, action, adminId));
  }
  async approve(id: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.approve(id, adminId));
  }
  async reject(id: string, reason: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.reject(id, reason, adminId));
  }
  async hide(id: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.hide(id, adminId));
  }
  async unhide(id: string, adminId: string): Promise<AdminShopListingResponseDto> {
    return ShopListingMapper.toAdminDto(await this.moderation.unhide(id, adminId));
  }
  deleteByAdmin(id: string, adminId: string): Promise<void> {
    return this.manager.deleteByAdmin(id, adminId);
  }
}
```

- [ ] **Step 2: 공개 컨트롤러 작성**

`apps/ugc-service/src/shop-listings/controllers/public-shop-listings.controller.ts`:

```ts
import { Controller, Get, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { PublicShopListingResponseDto, ShopListingContactResponseDto } from '../dto';
import { ShopListingsService } from '../shop-listings.service';

@ApiTags('Shop Listings (public)')
@Controller('shop-listings/public')
export class PublicShopListingsController {
  constructor(private readonly service: ShopListingsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '샵 매매 공개 목록', description: 'published·closed 를 최신순으로. 연락처는 없다.' })
  @ApiResponse({ status: 200, type: [PublicShopListingResponseDto] })
  list(): Promise<PublicShopListingResponseDto[]> {
    return this.service.listPublic();
  }

  @Public()
  @Get(':slug')
  @ApiParam({ name: 'slug' })
  @ApiOperation({ summary: '샵 매매 공개 상세' })
  @ApiResponse({ status: 200, type: PublicShopListingResponseDto })
  @ApiResponse({ status: 404 })
  get(@Param('slug') slug: string): Promise<PublicShopListingResponseDto> {
    return this.service.getPublic(slug);
  }

  /**
   * 로그인한 사람에게만. 공개 목록·상세에 섞으면 로그인 여부로 응답이 갈려 스토어프론트의
   * 한 벌 캐시(ADR-0038)를 못 쓴다. 크롤러는 구조적으로 여기 닿지 못한다.
   */
  @Get(':slug/contact')
  @ApiBearerAuth()
  @ApiParam({ name: 'slug' })
  @ApiOperation({ summary: '샵 매매 연락처 (로그인 필요)' })
  @ApiResponse({ status: 200, type: ShopListingContactResponseDto })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 404 })
  contact(@Param('slug') slug: string): Promise<ShopListingContactResponseDto> {
    return this.service.getContact(slug);
  }

  @Public()
  @Post(':slug/view')
  @HttpCode(204)
  @ApiParam({ name: 'slug' })
  @ApiOperation({
    summary: '샵 매매 조회수 +1',
    description: '상세 페이지가 캐시된 서버 컴포넌트라 브라우저가 세션당 1회 부른다. 없는 slug 는 조용히 무시한다.',
  })
  @ApiHeader({
    name: 'x-visitor-ip',
    required: false,
    description: '스토어프론트 서버액션이 대신 부르므로 소켓 IP 는 스토어프론트 것이다.',
  })
  async view(
    @Param('slug') slug: string,
    @Headers('x-visitor-ip') visitorIp: string | undefined,
    @Ip() socketIp: string,
  ): Promise<void> {
    await this.service.recordView(slug, visitorIp?.trim() || socketIp);
  }
}
```

- [ ] **Step 3: 회원 컨트롤러 작성**

`apps/ugc-service/src/shop-listings/controllers/member-shop-listings.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { MemberShopListingDto, MyShopListingResponseDto } from '../dto';
import { ShopListingsService } from '../shop-listings.service';

/** 로그인 회원 누구나(전역 JwtAuthGuard). 작성자는 토큰에서만 온다 — DTO 에 작성자 필드가 없다. */
@ApiTags('Shop Listings (member)')
@ApiBearerAuth()
@Controller('shop-listings')
export class MemberShopListingsController {
  constructor(private readonly service: ShopListingsService) {}

  @Post()
  @ApiOperation({ summary: '내 매물 등록', description: '검토 대기로 들어간다. 검토 중+게시 중 3건까지.' })
  @ApiBody({ type: MemberShopListingDto })
  @ApiResponse({ status: 201, type: MyShopListingResponseDto })
  @ApiResponse({ status: 409, description: '동시 게시 한도 초과' })
  create(@Body() dto: MemberShopListingDto, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.createByMember(dto, userId);
  }

  @Get('mine')
  @ApiOperation({ summary: '내 매물 목록 (상태·거절 사유 포함)' })
  @ApiResponse({ status: 200, type: [MyShopListingResponseDto] })
  listMine(@User('userId') userId: string): Promise<MyShopListingResponseDto[]> {
    return this.service.listMine(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: '내 매물 단건 (수정 폼용)' })
  @ApiResponse({ status: 200, type: MyShopListingResponseDto })
  @ApiResponse({ status: 404, description: '없거나 내 글이 아님' })
  get(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.getMine(id, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: '내 매물 수정', description: '다시 검토 대기로 내려간다. slug 는 바뀌지 않는다.' })
  @ApiBody({ type: MemberShopListingDto })
  @ApiResponse({ status: 200, type: MyShopListingResponseDto })
  @ApiResponse({ status: 409, description: '숨김 처리된 글 / 한도 초과 / 상태 경합' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemberShopListingDto,
    @User('userId') userId: string,
  ): Promise<MyShopListingResponseDto> {
    return this.service.updateByMember(id, dto, userId);
  }

  @Post(':id/close')
  @ApiOperation({ summary: '거래완료로 표시' })
  @ApiResponse({ status: 201, type: MyShopListingResponseDto })
  close(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.closeByMember(id, userId);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: '거래완료 해제' })
  @ApiResponse({ status: 201, type: MyShopListingResponseDto })
  reopen(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.reopenByMember(id, userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '내 매물 삭제', description: '연락처는 즉시 지워진다.' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<void> {
    await this.service.deleteByMember(id, userId);
  }
}
```

- [ ] **Step 4: 관리자 컨트롤러 작성**

`apps/ugc-service/src/shop-listings/controllers/admin-shop-listings.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, User } from '@app/authorization';
import {
  AdminShopListingDetailResponseDto,
  AdminShopListingDto,
  AdminShopListingListQueryDto,
  AdminShopListingResponseDto,
  RejectShopListingDto,
} from '../dto';
import { ShopListingsService } from '../shop-listings.service';

@ApiTags('Shop Listings (admin)')
@ApiBearerAuth()
@Controller('admin/shop-listings')
export class AdminShopListingsController {
  constructor(private readonly service: ShopListingsService) {}

  @Get()
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '매물 목록 (관리자)', description: 'status=pending 이면 제출 오래된 순' })
  @ApiResponse({ status: 200, type: [AdminShopListingResponseDto] })
  list(@Query() query: AdminShopListingListQueryDto): Promise<AdminShopListingResponseDto[]> {
    return this.service.listForAdmin(query);
  }

  @Get(':id')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '매물 상세 + 판정 이력 (관리자)' })
  @ApiResponse({ status: 200, type: AdminShopListingDetailResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminShopListingDetailResponseDto> {
    return this.service.getForAdmin(id);
  }

  @Post()
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '매물 등록 (관리자) — 바로 게시' })
  @ApiBody({ type: AdminShopListingDto })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  create(@Body() dto: AdminShopListingDto, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.createByAdmin(dto, adminId);
  }

  @Put(':id')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '매물 수정 (관리자) — 상태 유지' })
  @ApiBody({ type: AdminShopListingDto })
  @ApiResponse({ status: 200, type: AdminShopListingResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminShopListingDto,
    @User('userId') adminId: string,
  ): Promise<AdminShopListingResponseDto> {
    return this.service.updateByAdmin(id, dto, adminId);
  }

  @Post(':id/approve')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '승인' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  approve(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.approve(id, adminId);
  }

  @Post(':id/reject')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '거절 (사유 필수)' })
  @ApiBody({ type: RejectShopListingDto })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectShopListingDto,
    @User('userId') adminId: string,
  ): Promise<AdminShopListingResponseDto> {
    return this.service.reject(id, dto.reason, adminId);
  }

  @Post(':id/hide')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '숨김' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  hide(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.hide(id, adminId);
  }

  @Post(':id/unhide')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '숨김 해제' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  unhide(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.unhide(id, adminId);
  }

  @Post(':id/close')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '거래완료로 표시 (관리자)' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  close(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.setDealStatusByAdmin(id, 'close', adminId);
  }

  @Post(':id/reopen')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '거래완료 해제 (관리자)' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  reopen(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.setDealStatusByAdmin(id, 'reopen', adminId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '매물 삭제 (관리자)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<void> {
    await this.service.deleteByAdmin(id, adminId);
  }
}
```

- [ ] **Step 5: 모듈 작성 (컨슈머는 Task 11 에서 추가)**

`apps/ugc-service/src/shop-listings/shop-listings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UgcEventsModule } from '../ugc-events.module';
import { autoDecisionPolicyFromEnv, SHOP_LISTING_AUTO_DECISION_POLICY } from './classifier/auto-decision';
import { NullShopListingClassifier, SHOP_LISTING_CLASSIFIER } from './classifier/shop-listing-classifier';
import { AdminShopListingsController } from './controllers/admin-shop-listings.controller';
import { MemberShopListingsController } from './controllers/member-shop-listings.controller';
import { PublicShopListingsController } from './controllers/public-shop-listings.controller';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingViewManager } from './shop-listing-view.manager';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';
import { ShopListingsService } from './shop-listings.service';

@Module({
  imports: [UgcEventsModule],
  controllers: [PublicShopListingsController, MemberShopListingsController, AdminShopListingsController],
  providers: [
    ShopListingsService,
    ShopListingReader,
    ShopListingManager,
    ShopListingModerationManager,
    ShopListingViewManager,
    // v1: Jev 키가 나오기 전까지 모든 회원 글을 관리자 대기로 보낸다 (spec §6).
    { provide: SHOP_LISTING_CLASSIFIER, useClass: NullShopListingClassifier },
    { provide: SHOP_LISTING_AUTO_DECISION_POLICY, useFactory: () => autoDecisionPolicyFromEnv() },
  ],
})
export class ShopListingsModule {}
```

- [ ] **Step 6: 루트 모듈에 등록**

`apps/ugc-service/src/ugc-service.module.ts`:
- import 추가: `import { ShopListingsModule } from './shop-listings/shop-listings.module';`
- `imports` 배열의 `QnaModule,` 다음 줄에 `ShopListingsModule,`
- scopes 설명을 바꾼다:

```ts
        { key: 'admin:ugc:read', category: 'admin', description: '관리자 - UGC 조회 (리뷰, Q&A, 샵 매매 목록 조회)' },
        { key: 'admin:ugc:modify', category: 'admin', description: '관리자 - UGC 관리 (리뷰 댓글, Q&A 답변, 샵 매매 작성·검토)' },
```

- [ ] **Step 7: 비콘을 무인증 쓰기 허용 목록에 등록**

`scripts/security/route-authz-audit.spec.ts:19` 를 다음으로 바꾼다:

```ts
const ALLOWED: Record<string, string> = {
  'POST /shop-listings/public/:slug/view':
    '샵 매매 조회수 비콘. 스토어프론트 캐시 페이지가 브라우저에서 부른다(로그인 무관). 쓰는 것은 방문자 해시 1행과 카운터뿐이고, (매물·방문자·KST 날짜) unique 로 같은 방문자는 하루 1회만 센다. 비공개·없는 slug 는 조용히 무시한다.',
};
```

- [ ] **Step 8: 보안 스펙 실행 — 새 대상 확인**

Run: `npx jest scripts/security`
Expected: FAIL — `idor-reviewed.spec.ts` 의 「대상 집합과 명단이 정확히 일치한다」가 `unlisted` 에 아래 8개를 출력하고, 대상 수 테스트 두 개가 각각 +8 차이로 실패한다.

```
ugc-service DELETE /shop-listings/:id
ugc-service GET /shop-listings/:id
ugc-service GET /shop-listings/mine
ugc-service GET /shop-listings/public/:slug/contact
ugc-service POST /shop-listings
ugc-service POST /shop-listings/:id/close
ugc-service POST /shop-listings/:id/reopen
ugc-service PUT /shop-listings/:id
```

8개가 아니면 멈추고 원인을 찾는다(관리자 라우트가 섞였다면 `@RequireScopes` 누락이다).

- [ ] **Step 9: IDOR 명단에 8건 등록**

증거 좌표는 grep 으로 구한다:

```bash
grep -n "eq(shopListings.authorUserId, userId)" apps/ugc-service/src/shop-listings/shop-listing.reader.ts apps/ugc-service/src/shop-listings/shop-listing.manager.ts
grep -n "async findContactBySlug\|const conditions: SQL\[\] = \[isNull(shopListings.deletedAt)\]" apps/ugc-service/src/shop-listings/shop-listing.reader.ts
```

`scripts/security/idor-reviewed.spec.ts` 의 `IDOR_REVIEWED` 에서 `'ugc-service DELETE /reviews/:id'` 항목 **앞**(키 알파벳 순)에 다음을 넣는다. `<L…>` 는 위 grep 결과의 줄 번호로 채운다 — 각 predicate 는 해당 줄 ±5줄 안에 있어야 한다.

```ts
  'ugc-service DELETE /shop-listings/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.manager.ts:<L deleteByMember 의 where 줄>',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'soft delete UPDATE 의 WHERE 에 작성자 조건. 0행이면 404(존재 은닉).',
  },
  'ugc-service GET /shop-listings/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:<L findOwned 의 where 줄>',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'findOwned — SELECT WHERE 에 작성자 조건. userId 는 @User(\'userId\') 토큰값.',
  },
  'ugc-service GET /shop-listings/mine': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:<L listByAuthor 의 where 줄>',
    predicate: 'eq(shopListings.authorUserId, userId)',
  },
  'ugc-service GET /shop-listings/public/:slug/contact': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:<L findContactBySlug 선언 줄>',
    predicate: '',
    note: '소유자 자원이 아니다 — 공개(published·closed) 매물의 연락처를 로그인 회원 누구에게나 보여주는 것이 설계다(spec §7.2). 비공개 상태는 404.',
  },
  'ugc-service POST /shop-listings': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/shop-listings/controllers/member-shop-listings.controller.ts:<L create 줄>',
    predicate: '',
    note: '생성 — 대상 id 가 없다. 작성자는 토큰(@User(\'userId\'))에서만 오고 DTO 에 작성자 필드가 없다.',
  },
  'ugc-service POST /shop-listings/:id/close': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:<L findOwned 의 where 줄>',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'setDealStatusByMember 가 findOwned 로 먼저 소유권을 확인한다(남의 글 404).',
  },
  'ugc-service POST /shop-listings/:id/reopen': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:<L findOwned 의 where 줄>',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'close 와 같은 경로.',
  },
  'ugc-service PUT /shop-listings/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:<L findOwned 의 where 줄>',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'updateByMember 가 findOwned 로 소유권 확인 후 상태 CAS UPDATE.',
  },
```

> `<L …>` 는 플레이스홀더가 아니라 **이 단계에서 grep 으로 채우는 값**이다(코드를 쓰기 전에는 줄 번호를 알 수 없다). 첫 grep 은 여러 줄을 보여준다 — reader 의 `findOwned`·`listByAuthor`·`countActiveByAuthor`, manager 의 `deleteByMember`·`withdrawAuthor`. 각 항목에는 **그 라우트가 실제로 지나는 메서드 안의 줄**을 쓴다. `POST /shop-listings` 의 줄은 `grep -n "  create(" apps/ugc-service/src/shop-listings/controllers/member-shop-listings.controller.ts` 로 구한다.

- [ ] **Step 10: 대상 수 갱신**

같은 파일의 `IDOR 검사 대상 집합` describe 에서 세 숫자를 Step 8 이 보고한 실제 값으로 바꾼다(각각 이전 값 + 8). 예: `toHaveLength(115)` → `toHaveLength(123)`, `.size).toBe(115)` → `.size).toBe(123)`, `.size).toBe(114)` → `.size).toBe(122)`. 주석의 숫자는 그대로 둔다(역사 기록).

- [ ] **Step 11: 보안 스펙 통과 확인**

Run: `npx jest scripts/security`
Expected: PASS

- [ ] **Step 12: 앱 부팅 확인**

Run: `npm run start:ugc-service:dev` (다른 터미널, `apps/ugc-service/.env` 필요)
그 뒤:

```bash
curl -s localhost:3030/shop-listings/public | head -c 200; echo
curl -s -o /dev/null -w '%{http_code}\n' localhost:3030/shop-listings/mine
curl -s -o /dev/null -w '%{http_code}\n' localhost:3030/admin/shop-listings
```

Expected: `[]`, `401`, `401`. (포트는 `.env` 의 `PORT`; 없으면 3031.)

- [ ] **Step 13: 전체 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 에러 0, 실패 0

- [ ] **Step 14: Commit**

```bash
git add apps/ugc-service/src/shop-listings apps/ugc-service/src/ugc-service.module.ts \
  scripts/security/route-authz-audit.spec.ts scripts/security/idor-reviewed.spec.ts
git commit -m "feat(ugc): 샵 매매 공개·회원·관리자 API 를 연다 (프론트는 아직 core 를 본다)"
```

---

### Task 11: 탈퇴 컨슈머

**Files:**
- Create: `apps/ugc-service/src/shop-listings/consumers/user-permanent-deleted.consumer.ts`
- Modify: `apps/ugc-service/src/shop-listings/shop-listings.module.ts` (`controllers` 배열)
- Test: `apps/ugc-service/src/shop-listings/consumers/user-permanent-deleted.consumer.spec.ts`

**Interfaces:**
- Consumes: `ShopListingManager.withdrawAuthor(userId): Promise<number>` (Task 8)
- Produces: `ShopListingUserPermanentDeletedConsumer` (클래스 이름에 도메인을 넣는다 — 나중에 리뷰·Q&A 컨슈머가 같은 앱에 생겨도 이름이 겹치지 않게)

- [ ] **Step 1: 실패하는 스펙 작성**

`apps/ugc-service/src/shop-listings/consumers/user-permanent-deleted.consumer.spec.ts`:

```ts
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ShopListingManager } from '../shop-listing.manager';
import { ShopListingsModule } from '../shop-listings.module';
import { ShopListingUserPermanentDeletedConsumer } from './user-permanent-deleted.consumer';

describe('ShopListingUserPermanentDeletedConsumer', () => {
  const makeConsumer = () => {
    const manager = { withdrawAuthor: jest.fn().mockResolvedValue(1) };
    return {
      manager,
      consumer: new ShopListingUserPermanentDeletedConsumer(manager as unknown as ShopListingManager),
    };
  };

  it('영구 삭제된 회원의 매물을 감춘다', async () => {
    const { consumer, manager } = makeConsumer();
    await consumer.onUserPermanentDeleted({ userId: 'u-1', deletedAt: new Date().toISOString() });
    expect(manager.withdrawAuthor).toHaveBeenCalledWith('u-1');
  });

  // 빈 userId 로 부르면 WHERE 가 아무 행도 못 고르지만, 애초에 부르지 않는다.
  it('userId 가 없으면 아무것도 하지 않는다', async () => {
    const { consumer, manager } = makeConsumer();
    await consumer.onUserPermanentDeleted({ userId: '', deletedAt: new Date().toISOString() });
    expect(manager.withdrawAuthor).not.toHaveBeenCalled();
  });

  // @On 컨슈머는 controllers 에 있어야 구독된다. providers 에 두면 에러 없이 조용히 안 돈다.
  it('모듈의 controllers 에 등록돼 있다', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ShopListingsModule) ?? [];
    expect(controllers).toContain(ShopListingUserPermanentDeletedConsumer);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/consumers`
Expected: FAIL — module not found

- [ ] **Step 3: 컨슈머 구현**

`apps/ugc-service/src/shop-listings/consumers/user-permanent-deleted.consumer.ts`:

```ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventPayloadOf } from '@packages/event-contracts/types';
import { ShopListingManager } from '../shop-listing.manager';

/**
 * 회원 영구 삭제 → 그 회원의 샵 매매 글에서 연락처(개인정보)를 지우고 감춘다.
 *
 * `author_user_id` 에 FK 가 없어(논리 DB 가 갈린다) cascade 가 오지 않는다. 그 자리를 메운다.
 * 물리 삭제는 하지 않는다(spec §10) — 본문과 판정 이력 스냅샷은 남는다.
 * 선례: apps/ai/src/assistant/consumers/user-permanent-deleted.consumer.ts
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class ShopListingUserPermanentDeletedConsumer {
  private readonly logger = new Logger(ShopListingUserPermanentDeletedConsumer.name);

  constructor(private readonly manager: ShopListingManager) {}

  @On(USER_STREAM, 'UserPermanentDeleted')
  async onUserPermanentDeleted(
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserPermanentDeleted'>,
  ): Promise<void> {
    const { userId } = payload;
    if (!userId) return;

    const hidden = await this.manager.withdrawAuthor(userId);
    this.logger.log(`[UserPermanentDeleted] 샵 매매 감춤: userId=${userId} listings=${hidden}`);
  }
}
```

- [ ] **Step 4: 모듈에 등록**

`apps/ugc-service/src/shop-listings/shop-listings.module.ts`:
- import 추가: `import { ShopListingUserPermanentDeletedConsumer } from './consumers/user-permanent-deleted.consumer';`
- `controllers` 배열 끝에 `ShopListingUserPermanentDeletedConsumer` 추가

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/ugc-service/src/shop-listings/consumers`
Expected: PASS (3 tests)

- [ ] **Step 6: 이벤트 계약 가드 확인**

Run: `npx jest --testPathPattern="event-contracts|events" --maxWorkers=2`
Expected: PASS. (ugc 가 `USER_STREAM` 을 새로 구독한다. 구독 집합을 스냅샷하는 가드가 있으면 여기서 실패하므로, 실패 메시지가 가리키는 명단에 `ugc-service ← USER_STREAM.UserPermanentDeleted` 를 추가한다.)

- [ ] **Step 7: Commit**

```bash
git add apps/ugc-service/src/shop-listings/consumers apps/ugc-service/src/shop-listings/shop-listings.module.ts
git commit -m "feat(ugc): 회원 영구 삭제 시 샵 매매 연락처를 지우고 글을 감춘다"
```

---

### Task 12: file-service 전용 업로드 컨텍스트

**Files:**
- Modify: `apps/file-service/src/database/default-file-contexts.ts` (`notice-content-image` 항목 다음)
- Test: `apps/file-service/src/database/__tests__/shop-listing-file-context.spec.ts`

**Interfaces:**
- Produces: file context id `shop-listing-image` (PR 2 의 admin-web·스토어프론트가 쓴다)

- [ ] **Step 1: 실패하는 스펙 작성**

`apps/file-service/src/database/__tests__/shop-listing-file-context.spec.ts`:

```ts
import { FILE_CONTEXTS as SEEDS } from '../default-file-contexts';

describe('shop-listing-image 컨텍스트', () => {
  const context = SEEDS.find((c) => c.id === 'shop-listing-image');

  it('존재한다 — 없으면 PR 2 의 업로드가 전부 404', () => {
    expect(context).toBeDefined();
  });

  it('공개 이미지, 10MB', () => {
    expect(context).toMatchObject({
      allowPublic: true,
      allowPrivate: false,
      allowedMimeTypes: ['image/*'],
      maxFileSize: 10 * 1024 * 1024,
      pathPrefix: 'shop-listings/images',
      isActive: true,
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/file-service/src/database/__tests__/shop-listing-file-context.spec.ts`
Expected: FAIL — `expect(received).toBeDefined()`

- [ ] **Step 3: 시드 추가**

`default-file-contexts.ts` 의 `notice-content-image` 객체 닫는 `},` 바로 뒤에:

```ts
  {
    id: 'shop-listing-image',
    name: 'Shop Listing Image',
    description: '샵 매매 글 사진 (관리자·회원 업로드). 첫 장이 썸네일',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 10485760,
    pathPrefix: 'shop-listings/images',
    isActive: true,
  },
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/file-service/src/database`
Expected: PASS (기존 `file-size-schema.spec.ts` 포함)

- [ ] **Step 5: 로컬 시드 반영**

Run: `npx tsx scripts/local/seed-file-contexts.ts`
Expected: `shop-listing-image` 가 upsert 됐다는 출력(또는 오류 0).

- [ ] **Step 6: Commit**

```bash
git add apps/file-service/src/database/default-file-contexts.ts apps/file-service/src/database/__tests__/shop-listing-file-context.spec.ts
git commit -m "feat(file-service): 샵 매매 사진 전용 업로드 컨텍스트를 둔다 (db:seed:ref 필요)"
```

---

### Task 13: HTML → 마크다운 변환기와 행 변환 (순수)

**Files:**
- Create: `scripts/ops/shop-listings-migrate/html-to-markdown.ts`
- Create: `scripts/ops/shop-listings-migrate/transform.ts`
- Test: `scripts/ops/shop-listings-migrate/html-to-markdown.spec.ts`
- Test: `scripts/ops/shop-listings-migrate/transform.spec.ts`

**Interfaces:**
- Produces:
  - `class UnsupportedHtmlError extends Error { tag: string }`
  - `htmlToMarkdown(html: string): string`
  - `interface CoreShopListingRow { id; slug; title; content; region; business_type; deal_type; area_pyeong; deposit; monthly_rent; key_money; thumbnail_file_id; images: string[] | null; is_active; view_count; created_at: Date; updated_at: Date; created_by; updated_by }` (컬럼 전부 snake_case, nullable 은 `| null`)
  - `interface UgcListingRow { id; slug; title; content; region; business_type; deal_type; area_pyeong; deposit; monthly_rent; key_money; contact_phone: null; kakao_open_chat_url: null; author_type: 'admin'; author_user_id; status: 'published' | 'hidden'; view_count; updated_by; created_at; updated_at }`
  - `transformListing(row: CoreShopListingRow): { listing: UgcListingRow; imageFileIds: string[] }`

- [ ] **Step 1: 변환기 실패 스펙 작성**

`scripts/ops/shop-listings-migrate/html-to-markdown.spec.ts`:

```ts
import { htmlToMarkdown, UnsupportedHtmlError } from './html-to-markdown';

describe('htmlToMarkdown', () => {
  it('문단은 빈 줄로 나눈다', () => {
    expect(htmlToMarkdown('<p>첫 문단</p><p>둘째 문단</p>')).toBe('첫 문단\n\n둘째 문단');
  });

  it('<br> 은 줄바꿈 하나 (렌더러가 remark-breaks 로 그린다)', () => {
    expect(htmlToMarkdown('<p>한 줄<br>두 줄<br/>세 줄<br />네 줄</p>')).toBe('한 줄\n두 줄\n세 줄\n네 줄');
  });

  it('빈 문단은 버린다', () => {
    expect(htmlToMarkdown('<p>a</p><p></p><p><br></p><p>b</p>')).toBe('a\n\nb');
  });

  it('속성이 붙은 <p> 도 문단이다', () => {
    expect(htmlToMarkdown('<p style="text-align: center">가운데</p>')).toBe('가운데');
  });

  it('엔티티를 푼다', () => {
    expect(htmlToMarkdown('<p>&lt;보증금&gt; 1,000 &amp; 월세 &quot;50&quot; &#39;협의&#39;&nbsp;끝 &#8361; &#x20A9;</p>')).toBe(
      '<보증금> 1,000 & 월세 "50" \'협의\' 끝 ₩ ₩',
    );
  });

  it('줄 머리의 # 과 > 는 이스케이프한다 — 제목·인용으로 바뀌지 않게', () => {
    expect(htmlToMarkdown('<p>#1 매물<br>> 참고</p>')).toBe('\\#1 매물\n\\> 참고');
  });

  it('허용 밖 태그를 만나면 태그 이름과 함께 실패한다 — 조용히 버리지 않는다', () => {
    expect(() => htmlToMarkdown('<p><strong>굵게</strong></p>')).toThrow(UnsupportedHtmlError);
    try {
      htmlToMarkdown('<p><a href="x">링크</a></p>');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedHtmlError);
      expect((e as UnsupportedHtmlError).tag).toBe('a');
    }
  });

  it('<p> 밖의 맨 텍스트도 받는다', () => {
    expect(htmlToMarkdown('그냥 텍스트')).toBe('그냥 텍스트');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest scripts/ops/shop-listings-migrate/html-to-markdown.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 변환기 구현**

`scripts/ops/shop-listings-migrate/html-to-markdown.ts`:

```ts
/**
 * core 샵 매매 본문(tiptap HTML)을 마크다운으로 옮긴다. 2026-09-07 실측으로 본문 태그는 <p>·<br> 뿐이었다.
 * 그 밖의 태그는 **실패**시킨다 — 모르는 태그를 조용히 벗기면 서식이 사라진 걸 아무도 모른다.
 */
export class UnsupportedHtmlError extends Error {
  constructor(readonly tag: string) {
    super(`지원하지 않는 태그: <${tag}>`);
    this.name = 'UnsupportedHtmlError';
  }
}

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ALLOWED_TAGS = new Set(['p', 'br']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+|#39);/g, (whole, body: string) => {
    if (body in NAMED_ENTITIES) return NAMED_ENTITIES[body];
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return whole;
  });
}

/** 줄 머리의 # 과 > 만 막는다. 목록(- , 1. )은 의도일 가능성이 높아 그대로 둔다. */
function escapeLineStarts(line: string): string {
  return line.replace(/^(\s*)([#>])/, '$1\\$2');
}

export function htmlToMarkdown(html: string): string {
  for (const match of html.matchAll(TAG)) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) throw new UnsupportedHtmlError(tag);
  }

  const paragraphs = html
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/<\/p>/i)
    .map((chunk) => chunk.replace(/<p\b[^>]*>/gi, ''))
    .map((chunk) => decodeEntities(chunk))
    .map((chunk) =>
      chunk
        .split('\n')
        .map((line) => escapeLineStarts(line.trimEnd()))
        .join('\n')
        .trim(),
    )
    .filter((chunk) => chunk.length > 0);

  return paragraphs.join('\n\n');
}
```

- [ ] **Step 4: 변환기 통과 확인**

Run: `npx jest scripts/ops/shop-listings-migrate/html-to-markdown.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 행 변환 실패 스펙 작성**

`scripts/ops/shop-listings-migrate/transform.spec.ts`:

```ts
import { type CoreShopListingRow, transformListing } from './transform';

const ROW: CoreShopListingRow = {
  id: '019166f0-0000-7000-8000-00000000aaaa',
  slug: '강남-네일샵',
  title: '강남 네일샵',
  content: '<p>본문</p>',
  region: 'seoul',
  business_type: 'nail',
  deal_type: 'transfer',
  area_pyeong: 10,
  deposit: 1000,
  monthly_rent: null,
  key_money: null,
  thumbnail_file_id: 't',
  images: ['a', 't', 'b'],
  is_active: true,
  view_count: 42,
  created_at: new Date('2026-08-13T00:00:00.000Z'),
  updated_at: new Date('2026-08-14T00:00:00.000Z'),
  created_by: 'admin-1',
  updated_by: 'admin-2',
};

describe('transformListing', () => {
  it('id·slug·조회수·작성 시각을 보존한다', () => {
    const { listing } = transformListing(ROW);
    expect(listing).toMatchObject({
      id: ROW.id,
      slug: ROW.slug,
      view_count: 42,
      created_at: ROW.created_at,
      updated_at: ROW.updated_at,
    });
  });

  it('작성자는 관리자, 연락처는 비운다', () => {
    const { listing } = transformListing(ROW);
    expect(listing).toMatchObject({
      author_type: 'admin',
      author_user_id: 'admin-1',
      updated_by: 'admin-2',
      contact_phone: null,
      kakao_open_chat_url: null,
    });
  });

  it('is_active → published / hidden', () => {
    expect(transformListing(ROW).listing.status).toBe('published');
    expect(transformListing({ ...ROW, is_active: false }).listing.status).toBe('hidden');
  });

  it('본문은 마크다운으로', () => {
    expect(transformListing(ROW).listing.content).toBe('본문');
  });

  it('썸네일을 맨 앞으로 옮기고 나머지 순서를 지킨다', () => {
    expect(transformListing(ROW).imageFileIds).toEqual(['t', 'a', 'b']);
  });

  it('썸네일이 images 에 없으면 앞에 끼운다', () => {
    expect(transformListing({ ...ROW, images: ['a', 'b'] }).imageFileIds).toEqual(['t', 'a', 'b']);
  });

  it('썸네일이 없으면 images 그대로, images 가 null 이면 빈 배열', () => {
    expect(transformListing({ ...ROW, thumbnail_file_id: null }).imageFileIds).toEqual(['a', 't', 'b']);
    expect(transformListing({ ...ROW, thumbnail_file_id: null, images: null }).imageFileIds).toEqual([]);
  });

  it('중복 fileId 는 한 번만', () => {
    expect(transformListing({ ...ROW, images: ['a', 'a', 't'] }).imageFileIds).toEqual(['t', 'a']);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx jest scripts/ops/shop-listings-migrate/transform.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 7: 행 변환 구현**

`scripts/ops/shop-listings-migrate/transform.ts`:

```ts
import { htmlToMarkdown } from './html-to-markdown';

/** core `shop_listings` 한 행 (postgres.js 가 돌려주는 snake_case 그대로). */
export interface CoreShopListingRow {
  id: string;
  slug: string;
  title: string;
  content: string;
  region: string | null;
  business_type: string | null;
  deal_type: string | null;
  area_pyeong: number | null;
  deposit: number | null;
  monthly_rent: number | null;
  key_money: number | null;
  thumbnail_file_id: string | null;
  images: string[] | null;
  is_active: boolean;
  view_count: number;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

/** ugc `shop_listings` 에 넣을 한 행. */
export interface UgcListingRow {
  id: string;
  slug: string;
  title: string;
  content: string;
  region: string | null;
  business_type: string | null;
  deal_type: string | null;
  area_pyeong: number | null;
  deposit: number | null;
  monthly_rent: number | null;
  key_money: number | null;
  contact_phone: null;
  kakao_open_chat_url: null;
  author_type: 'admin';
  author_user_id: string | null;
  status: 'published' | 'hidden';
  view_count: number;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export function transformListing(row: CoreShopListingRow): { listing: UgcListingRow; imageFileIds: string[] } {
  return {
    listing: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      content: htmlToMarkdown(row.content),
      region: row.region,
      business_type: row.business_type,
      deal_type: row.deal_type,
      area_pyeong: row.area_pyeong,
      deposit: row.deposit,
      monthly_rent: row.monthly_rent,
      key_money: row.key_money,
      contact_phone: null,
      kakao_open_chat_url: null,
      author_type: 'admin',
      author_user_id: row.created_by,
      status: row.is_active ? 'published' : 'hidden',
      view_count: row.view_count,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    imageFileIds: orderImages(row.thumbnail_file_id, row.images ?? []),
  };
}

/** 썸네일이 곧 order 0 이다. core 는 썸네일을 따로 들고 있었으므로 앞으로 옮긴다. */
function orderImages(thumbnail: string | null, images: string[]): string[] {
  const ordered = thumbnail ? [thumbnail, ...images] : images;
  return [...new Set(ordered)];
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx jest scripts/ops/shop-listings-migrate`
Expected: PASS (16 tests)

- [ ] **Step 9: Commit**

```bash
git add scripts/ops/shop-listings-migrate/html-to-markdown.ts scripts/ops/shop-listings-migrate/html-to-markdown.spec.ts \
  scripts/ops/shop-listings-migrate/transform.ts scripts/ops/shop-listings-migrate/transform.spec.ts
git commit -m "feat(ops): 샵 매매 이관 변환 — 모르는 HTML 태그는 조용히 벗기지 않고 실패한다"
```

---

### Task 14: 복사 스크립트 (IO) + 멱등성 통합 스펙 + 런북

**Files:**
- Create: `scripts/ops/shop-listings-migrate/migrate.ts`
- Create: `scripts/ops/shop-listings-migrate/README.md`
- Test: `scripts/ops/shop-listings-migrate/migrate.integration.spec.ts`

**Interfaces:**
- Consumes: `transformListing`, `UnsupportedHtmlError` (Task 13)
- Produces:
  - `interface MigrationReport { listings: number; byStatus: Record<'published' | 'hidden', number>; images: number; views: number; samples: Array<{ id: string; slug: string; before: string; after: string }> }`
  - `runMigration(opts: { core: postgres.Sql; ugc: postgres.Sql; apply: boolean }): Promise<MigrationReport>` — 변환 실패가 하나라도 있으면 쓰기 전에 throw, ugc 에 core 에 없는 id 가 있으면 throw

- [ ] **Step 1: 실패하는 통합 스펙 작성**

`scripts/ops/shop-listings-migrate/migrate.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import postgres from 'postgres';
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
        thumbnail_file_id, images, is_active, view_count, created_by, updated_by)
      values (${id}, ${slug}, '이관 테스트', '<p>첫 줄<br>둘째 줄</p>', 'seoul', 'nail', 'transfer',
        ${thumb}, ${core.json([other])}, true, 7, ${randomUUID()}, null)`;
    await core`
      insert into shop_listing_views (id, listing_id, visitor_hash, viewed_on)
      values (${randomUUID()}, ${id}, ${'h'.repeat(64)}, '2026-09-01')`;
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
```

- [ ] **Step 2: 실패 확인**

Run: `CORE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core UGC_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listings-migrate/migrate.integration"`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`scripts/ops/shop-listings-migrate/migrate.ts`:

```ts
/**
 * core 의 샵 매매 글을 ugc 로 옮긴다 (spec 2026-09-23 §9.3). 런북은 같은 폴더의 README.md.
 *
 *   CORE_DATABASE_URL=... UGC_DATABASE_URL=... npx tsx scripts/ops/shop-listings-migrate/migrate.ts [--apply]
 *
 * 기본은 **드라이런**이다. `--apply` 를 줘야 쓴다.
 * 멱등하다 — id 기준 upsert, 조회수는 큰 쪽, 이미지는 행마다 다시 넣고, 조회 기록은 중복을 버린다.
 */
import postgres from 'postgres';
import { UnsupportedHtmlError } from './html-to-markdown';
import { type CoreShopListingRow, transformListing, type UgcListingRow } from './transform';

export interface MigrationReport {
  listings: number;
  byStatus: Record<'published' | 'hidden', number>;
  images: number;
  views: number;
  samples: Array<{ id: string; slug: string; before: string; after: string }>;
}

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

  const rows = await core<CoreShopListingRow[]>`
    select id, slug, title, content, region, business_type, deal_type, area_pyeong,
           deposit::float8 as deposit, monthly_rent::float8 as monthly_rent, key_money::float8 as key_money,
           thumbnail_file_id, images, is_active, view_count, created_at, updated_at, created_by, updated_by
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
          select id, listing_id, visitor_hash, viewed_on::text as viewed_on, created_at
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

  await ugc.begin(async (tx) => {
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

    if (views.length > 0) {
      await tx`insert into shop_listing_views ${tx(views)} on conflict do nothing`;
    }
  });

  return report;
}

async function main(): Promise<void> {
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
```

- [ ] **Step 4: 통과 확인**

Run: `CORE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core UGC_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx jest --runInBand --testPathPattern="shop-listings-migrate/migrate.integration"`
Expected: PASS (5 tests)

- [ ] **Step 5: 로컬 드라이런**

Run: `CORE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core UGC_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc npx tsx scripts/ops/shop-listings-migrate/migrate.ts`
Expected: 건수·샘플 출력, 마지막 줄 `드라이런 — 쓰지 않았다.` 로컬 core 에 변환 못 하는 본문이 있으면 그 목록으로 실패 — 라이브 전에 규칙을 늘릴 신호다.

- [ ] **Step 6: 런북 작성**

`scripts/ops/shop-listings-migrate/README.md`:

````markdown
# 샵 매매 core → ugc 이관 런북

spec: `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md` §9.

## 0. PR 1 배포 전 실측 (spec §9.5)

라이브 DB 는 `sst shell` 안에서 본다(`AWS_PROFILE` 을 export 하면 실패한다).

```bash
npx sst shell --stage live -- bash -c 'psql "$UGC_DATABASE_URL" -c "
  select r.name, s.key from auth.role_scopes rs
  join auth.roles r on r.id = rs.role_id join auth.scopes s on s.id = rs.scope_id
  where s.key in (''admin:ugc:read'', ''admin:ugc:modify'') order by 1, 2"'
```

→ 이 역할들이 전환 후 샵 매매를 관리하게 된다(지금은 master·admin 만). 의도와 다르면 PR 2 머지 전에 매핑을 고친다.
(테이블·컬럼 이름이 다르면 `libs/authorization/src` 의 drizzle 스키마에서 확인한다.)

```sql
-- core DB
select count(*) from shop_listings where deleted_at is null;
select count(*) from shop_listings
 where deleted_at is null and thumbnail_file_id is not null
   and not (coalesce(images, '[]'::jsonb) ? thumbnail_file_id::text);
select id, slug from shop_listings
 where deleted_at is null and content ~ '<(?!/?(p|br)\b)[a-zA-Z]';
```

마지막 쿼리가 행을 내면 `html-to-markdown.ts` 규칙을 먼저 늘린다.

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
  'CORE_DATABASE_URL="$CORE_DATABASE_URL" UGC_DATABASE_URL="$UGC_DATABASE_URL" npx tsx scripts/ops/shop-listings-migrate/migrate.ts'
# 건수·샘플이 맞으면
npx sst shell --stage live -- bash -c \
  'CORE_DATABASE_URL="$CORE_DATABASE_URL" UGC_DATABASE_URL="$UGC_DATABASE_URL" npx tsx scripts/ops/shop-listings-migrate/migrate.ts --apply'
```

(`sst shell` 이 내보내는 변수 이름이 다르면 `deployments/lcnine/services/infra/shared.ts` 의 `dbUrl()` 로 두 URL 을 만든다.)

3. 대조: 0 단계의 core 건수 = ugc `select count(*) from shop_listings`. 슬러그 몇 개를 `https://ugc.almondyoung.com/shop-listings/public/<slug>` 로 열어 본문 줄바꿈을 본다.

## 3. PR 2 배포 직전

같은 명령을 `--apply` 로 한 번 더 — 그사이 쌓인 조회수를 합친다. 스크립트는 ugc 에 core 에 없는 글이 생기면(= 전환 이후) 스스로 멈춘다.

## 롤백

PR 2 revert. core 의 옛 API·테이블은 PR 3·4 전까지 그대로다. 전환 뒤 ugc 에 새로 쓴 글은 core 에 없다.
````

- [ ] **Step 7: 전체 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 에러 0, 실패 0 (통합 스펙은 env 없으면 skip)

- [ ] **Step 8: Commit**

```bash
git add scripts/ops/shop-listings-migrate/migrate.ts scripts/ops/shop-listings-migrate/migrate.integration.spec.ts \
  scripts/ops/shop-listings-migrate/README.md
git commit -m "feat(ops): 샵 매매 core → ugc 멱등 복사 스크립트와 런북"
```

---

### Task 15: 마무리 검증과 후속 이슈

**Files:** 없음 (검증·이슈)

- [ ] **Step 1: 통합 스펙 일괄 실행**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
  npx jest --runInBand --testPathPattern="shop-listing.*integration"
CORE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core \
UGC_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
  npx jest --runInBand --testPathPattern="shop-listings-migrate/migrate.integration"
```

Expected: 전부 PASS

- [ ] **Step 2: 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 에러 0, 실패 0

- [ ] **Step 3: 로컬 API 스모크 (토큰은 로컬 E2E 환경에서 로그인한 쿠키의 accessToken)**

```bash
TOKEN=<회원 accessToken>
ADMIN=<master accessToken>
BASE=http://localhost:3030
IMG=$(uuidgen)

# 회원 작성 → pending
ID=$(curl -s -X POST $BASE/shop-listings -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"title\":\"스모크 매물\",\"content\":\"본문\",\"region\":\"seoul\",\"businessType\":\"nail\",\"dealType\":\"transfer\",\"imageFileIds\":[\"$IMG\"],\"contactPhone\":\"010-1234-5678\"}" | jq -r .id)
curl -s $BASE/shop-listings/mine -H "Authorization: Bearer $TOKEN" | jq '.[0].status'        # "pending"
curl -s $BASE/shop-listings/public | jq 'map(select(.id=="'$ID'")) | length'                 # 0

# 관리자 승인 → 공개, 연락처는 공개 응답에 없음
curl -s -X POST $BASE/admin/shop-listings/$ID/approve -H "Authorization: Bearer $ADMIN" | jq .status   # "published"
SLUG=$(curl -s $BASE/shop-listings/public | jq -r 'map(select(.id=="'$ID'"))[0].slug')
curl -s $BASE/shop-listings/public/$SLUG | jq 'has("contactPhone")'                          # false
curl -s -o /dev/null -w '%{http_code}\n' $BASE/shop-listings/public/$SLUG/contact            # 401
curl -s $BASE/shop-listings/public/$SLUG/contact -H "Authorization: Bearer $TOKEN" | jq .contactPhone  # "01012345678"
```

Expected: 주석의 값. 다르면 해당 Task 로 돌아간다.

- [ ] **Step 4: 후속 이슈 발행 (spec §10 의 알고 두는 잔여)**

```bash
gh issue create --repo LCNINE/almondyoung-server \
  --title "[ugc] 리뷰·Q&A 가 회원 영구 삭제(UserPermanentDeleted)를 처리하지 않는다" \
  --label needs-triage \
  --body "$(cat <<'EOF'
ugc-service 의 리뷰(`reviews`)·Q&A(`questions`) 는 `user_id` 에 FK 가 없고(논리 DB 가 갈린다) `UserPermanentDeleted` 를 소비하지 않는다. 영구 삭제된 회원의 글이 그대로 남는다.

- 소비 현황 도출: `grep -rn "UserPermanentDeleted" apps/*/src --include=*.ts | grep -v spec`
- 선례: `apps/ai/src/assistant/consumers/user-permanent-deleted.consumer.ts`, `apps/ugc-service/src/shop-listings/consumers/user-permanent-deleted.consumer.ts`
- 샵 매매 이전(spec `docs/superpowers/specs/2026-09-23-shop-listings-to-ugc-design.md` §10) 중 발견. 이번 범위 밖으로 분리했다.

결정할 것: 감춤만 할지, 익명화할지, 물리 삭제할지(리뷰는 상품 평점 집계에 들어간다).
EOF
)"
```

- [ ] **Step 5: PR 생성 전 확인**

- `git log --oneline develop..HEAD` 가 Task 0~14 의 커밋을 보여주는지
- 배포 순서(README §1)와 배포 전 실측(README §0)이 PR 본문에 들어갈 준비가 됐는지

PR 생성·푸시는 사용자 확인 후에 한다.
