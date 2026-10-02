# 관리자 수기 리뷰 작성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리테일팀이 admin-web 폼으로 다른 채널의 고객 후기를 한 건씩 옮겨 적으면, 기존 이관분과 같은 모양(회원 없음·권한 없음·출처 `admin-manual`)의 리뷰가 생긴다.

**Architecture:** ugc-service 에 `POST /reviews/admin/reviews` 를 더하고 `ReviewsService.createByAdmin` 이 한 트랜잭션에서 리뷰·미디어를 넣은 뒤 커밋 후 평점 통계를 발행한다. 스키마 변경은 입력자 감사용 nullable 컬럼 하나다. admin-web 은 `/cs/reviews/new` 폼·마스터 상품 선택기·목록 라벨/탭을 더하고, 판정 로직은 `.ts` 순수 함수로 빼서 테스트한다.

**Tech Stack:** NestJS 11 (Fastify) · Drizzle ORM (postgres.js) · class-validator/class-transformer · Jest(ts-jest) · Next.js admin-web · TanStack Query · axios

**Spec:** `docs/superpowers/specs/2026-09-30-admin-manual-review-design.md`

## Global Constraints

- 출처값은 `'admin-manual'` 하나. 리터럴은 `apps/ugc-service/src/source-system.ts` 에만 둔다(`source-system.spec.ts` 가 사본을 막는다).
- 새 행: `user_id` NULL · `review_permission_id` NULL · `legacy_author_name`=작성자명 · `created_at`=원 작성일 · `legacy_imported_at`=now · `created_by_admin_user_id`=호출 관리자.
- 보상 판정·보상 원장 기록을 하지 않는다. 권한 행을 만들지 않는다.
- 권한은 기존 `admin:ugc:modify` 그대로. `ugc-scopes.ts` 는 바꾸지 않는다.
- 상품 존재 검증은 하지 않는다(서버는 UUID 형식만).
- 작성자명 1~100자(trim 후). 별점 1~5 정수. 본문 공백만은 거부. 미디어 최대 `MAX_REVIEW_MEDIA_COUNT`=5, 중복 금지.
- `writtenAt` 은 **시각+오프셋**이 있는 ISO 8601. 미래 시각은 400. admin-web 은 `YYYY-MM-DDT00:00:00+09:00` 으로 보낸다.
- 스키마 변경은 expand: 배포는 `db:migrate` → `sst deploy` 순서.
- 공개 `ReviewResponseDto` 에 `sourceSystem`·`createdByAdminUserId` 를 넣지 않는다(관리자 응답에만).
- 다른 팀원의 admin 권한 이관분(7,488건)과 그 공정은 건드리지 않는다.
- 기준선: `npm run type-check` 0 · 루트 `npx jest` 실패 0 · `cd apps/admin-web && npx tsc --noEmit` 0.
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL` 을 단다.

## Review Focus

1. **공백만 있는 작성자명·본문** — 폼과 서버 모두 거절해야 한다(스토어프론트에 빈 이름·빈 본문이 뜨면 안 된다). → Task 2 DTO 스펙, Task 6 폼 스펙.
2. **오프셋 없는 `writtenAt`(`2026-09-01`)** — UTC 자정으로 해석돼 KST 09:00 이 된다. 서버가 거절해야 한다. → Task 2 DTO 스펙.
3. **KST 날짜 경계** — 브라우저 시간대가 KST 가 아니거나 UTC 15:00 전후일 때 「오늘」·미래 판정이 하루 어긋나면 안 된다. → Task 6 `kstToday` 경계 스펙.
4. **탭 전환 시 남은 필터** — 「관리자 권한」 탭에서 「관리자 수기 작성」 탭으로 가면 `provider=admin` 이 남아 0건이 되면 안 된다. → Task 6 탭 스펙.
5. **저장 버튼 연타** — 같은 리뷰가 두 건 생기면 안 된다. 컴포넌트 테스트가 불가능한 앱이라(스펙 §7) 저장 중 버튼 비활성으로 막고 Task 9 수동 스모크에서 확인한다.

---

### Task 1: 출처 상수와 입력자 컬럼 (스키마 + 마이그레이션)

**Files:**
- Modify: `apps/ugc-service/src/source-system.ts`
- Modify: `apps/ugc-service/src/__tests__/source-system.spec.ts`
- Modify: `apps/ugc-service/src/db/schema.ts` (`reviews` 의 `legacyPayload` 바로 아래)
- Create (generated): `apps/ugc-service/src/db/<timestamp>_add-review-created-by-admin.sql`, `apps/ugc-service/src/db/meta/*`

**Interfaces:**
- Produces: `ADMIN_MANUAL_SOURCE_SYSTEM: 'admin-manual'` (from `apps/ugc-service/src/source-system`), `reviews.createdByAdminUserId: uuid | null` (→ `ReviewEntity.createdByAdminUserId: string | null`)

- [ ] **Step 1: Write the failing test**

`apps/ugc-service/src/__tests__/source-system.spec.ts` 를 아래로 바꾼다(기존 두 테스트는 보존, grep 을 헬퍼로 뺀다):

```ts
import { execFileSync } from 'child_process';
import * as path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { reviews } from '../db/schema';
import { ADMIN_MANUAL_SOURCE_SYSTEM, isLegacySource, isOwnSource, OWN_SOURCE_SYSTEM } from '../source-system';

/**
 * 「자체 작성인가」의 정의가 여러 파일로 복제되는 것을 막는다.
 *
 * 이 값은 한때 여섯 곳에 리터럴로 흩어져 있었다(목록 쿼리·베스트 선정·권한 발급·스키마 기본값·통계).
 * 흩어진 정의는 한 곳만 고쳐도 나머지가 조용히 옛 뜻으로 남고, 그 나머지가 세는 쿼리면
 * 화면 숫자만 틀린 채 오류도 로그도 남지 않는다.
 */
describe('출처 판정의 정본', () => {
  const appRoot = path.resolve(__dirname, '..');
  const canonicalFile = path.join(appRoot, 'source-system.ts');

  const hitsOutsideCanonical = (literal: string) =>
    execFileSync('grep', ['-rn', '--include=*.ts', `'${literal}'`, appRoot], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.startsWith(`${canonicalFile}:`))
      .filter((line) => !/\.spec\.ts:/.test(line));

  it("'almondyoung' 리터럴은 정본 파일 밖의 소스에 없다", () => {
    expect(hitsOutsideCanonical(OWN_SOURCE_SYSTEM)).toEqual([]);
  });

  it("'admin-manual' 리터럴도 정본 파일 밖의 소스에 없다", () => {
    expect(hitsOutsideCanonical(ADMIN_MANUAL_SOURCE_SYSTEM)).toEqual([]);
  });

  it('관리자 수기 출처는 자체 작성이 아니고, 컬럼 길이(30)에 들어간다', () => {
    expect(ADMIN_MANUAL_SOURCE_SYSTEM).not.toBe(OWN_SOURCE_SYSTEM);
    expect(ADMIN_MANUAL_SOURCE_SYSTEM.length).toBeLessThanOrEqual(30);
  });

  it('두 술어는 서로의 여집합이다 — 어느 행도 양쪽에 들거나 어디에도 안 들지 않는다', () => {
    const db = drizzle({} as never);
    const own = db.select().from(reviews).where(isOwnSource(reviews.sourceSystem)).toSQL();
    const legacy = db.select().from(reviews).where(isLegacySource(reviews.sourceSystem)).toSQL();

    expect(own.sql).toContain('=');
    expect(legacy.sql).toContain('<>');
    expect(own.params).toEqual([OWN_SOURCE_SYSTEM]);
    expect(legacy.params).toEqual([OWN_SOURCE_SYSTEM]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/ugc-service/src/__tests__/source-system.spec.ts`
Expected: FAIL — TS 에러 `Module '"../source-system"' has no exported member 'ADMIN_MANUAL_SOURCE_SYSTEM'` (ts-jest 는 transpile-only 라 런타임 `undefined` 로 두 번째·세 번째 테스트가 실패할 수도 있다 — 어느 쪽이든 FAIL).

- [ ] **Step 3: Add the constant**

`apps/ugc-service/src/source-system.ts` 의 `OWN_SOURCE_SYSTEM` 선언 바로 아래에 추가:

```ts
/**
 * 관리자가 admin-web 에서 한 건씩 옮겨 적은 리뷰의 출처값(리테일팀). 다른 채널 고객 후기의 이관이라
 * 자체 작성이 아니다 — `isOwnSource` 에 걸리지 않으므로 통계는 이관분으로 세고 베스트·보상 후보에서 빠진다.
 */
export const ADMIN_MANUAL_SOURCE_SYSTEM = 'admin-manual';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/ugc-service/src/__tests__/source-system.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Add the column to the schema**

`apps/ugc-service/src/db/schema.ts` `reviews` 테이블에서 `legacyPayload: jsonb('legacy_payload'),` 바로 아래에 추가:

```ts

    /**
     * 관리자 수기 작성분의 입력자(user-service `users.id`). 회원 작성·이관분은 NULL.
     * FK 없음 — 사용자는 다른 서비스 소유다. 이 컬럼으로 조회하지 않아 인덱스도 없다.
     */
    createdByAdminUserId: uuid('created_by_admin_user_id'),
```

- [ ] **Step 6: Generate the migration**

Run (저장소 루트): `npm run db:generate:ugc-service -- --name add-review-created-by-admin`
Expected: `apps/ugc-service/src/db/<timestamp>_add-review-created-by-admin.sql` 생성, 내용이 **정확히 한 문장**:

```sql
ALTER TABLE "reviews" ADD COLUMN "created_by_admin_user_id" uuid;
```

다른 문장이 섞여 나오면(스냅샷 드리프트) 커밋하지 말고 생성물을 지우고 멈춰서 보고한다. 서브에이전트 환경에서 `db:generate` 가 실패하면 오케스트레이터에게 넘긴다(과거에 서브에이전트가 이 명령을 못 돌린 적이 있다).

- [ ] **Step 7: Type-check**

Run: `npm run type-check`
Expected: 에러 0. `ReviewEntity` 에 필드가 늘어 리뷰 행 리터럴을 타입 단언 없이 만드는 스펙이 있으면 여기서 드러난다 — 그 리터럴에 `createdByAdminUserId: null` 을 더해 고친다.

- [ ] **Step 8: Commit**

```bash
git add apps/ugc-service/src/source-system.ts apps/ugc-service/src/__tests__/source-system.spec.ts apps/ugc-service/src/db/schema.ts apps/ugc-service/src/db/*_add-review-created-by-admin.sql apps/ugc-service/src/db/meta
git commit -m "feat(ugc): 관리자 수기 리뷰의 출처값과 입력자 컬럼을 둔다

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 2: 관리자 작성 요청 DTO

**Files:**
- Modify: `apps/ugc-service/src/reviews/dto/create-review.dto.ts`
- Test: `apps/ugc-service/src/reviews/dto/admin-create-review.dto.spec.ts`

**Interfaces:**
- Produces: `class AdminCreateReviewDto { productId: string; authorName: string; writtenAt: string; rating: number; content: string; mediaFileIds?: string[] }` exported from `apps/ugc-service/src/reviews/dto/create-review.dto.ts`. `authorName` 은 trim 된 값으로 들어온다(`transform: true` — `apps/ugc-service/src/main.ts:25`).

- [ ] **Step 1: Write the failing test**

`apps/ugc-service/src/reviews/dto/admin-create-review.dto.spec.ts`:

```ts
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminCreateReviewDto } from './create-review.dto';

const valid = {
  productId: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  authorName: '홍길동',
  writtenAt: '2026-09-01T00:00:00+09:00',
  rating: 5,
  content: '향이 좋아요.',
};

async function check(input: Record<string, unknown>) {
  const dto = plainToInstance(AdminCreateReviewDto, input);
  const errors = await validate(dto);
  return { dto, failed: errors.map((e) => e.property) };
}

describe('AdminCreateReviewDto', () => {
  it('정상 입력은 통과한다', async () => {
    expect((await check(valid)).failed).toEqual([]);
  });

  it('작성자명은 앞뒤 공백을 걷어서 받는다', async () => {
    const { dto, failed } = await check({ ...valid, authorName: '  홍길동 ' });
    expect(failed).toEqual([]);
    expect(dto.authorName).toBe('홍길동');
  });

  it.each([['   '], [''], ['가'.repeat(101)]])('작성자명 %j 는 거절한다', async (authorName) => {
    expect((await check({ ...valid, authorName })).failed).toEqual(['authorName']);
  });

  it('작성자명 100자는 통과한다', async () => {
    expect((await check({ ...valid, authorName: '가'.repeat(100) })).failed).toEqual([]);
  });

  it.each([['   '], [''], ['\n\t']])('본문 %j 는 거절한다', async (content) => {
    expect((await check({ ...valid, content })).failed).toEqual(['content']);
  });

  it.each([[0], [6], [4.5], ['5']])('별점 %j 는 거절한다', async (rating) => {
    expect((await check({ ...valid, rating })).failed).toEqual(['rating']);
  });

  it.each([['2026-09-01'], ['2026-09-01T00:00:00'], ['not-a-date'], ['2026-02-30T00:00:00+09:00']])(
    '오프셋 없는·잘못된 작성 시각 %j 는 거절한다',
    async (writtenAt) => {
      expect((await check({ ...valid, writtenAt })).failed).toEqual(['writtenAt']);
    },
  );

  it('UTC 표기(Z)는 통과한다', async () => {
    expect((await check({ ...valid, writtenAt: '2026-08-31T15:00:00.000Z' })).failed).toEqual([]);
  });

  it('상품 ID 는 UUID 여야 한다', async () => {
    expect((await check({ ...valid, productId: 'prod_01ABC' })).failed).toEqual(['productId']);
  });

  it('미디어는 5장까지', async () => {
    const five = Array.from({ length: 5 }, () => randomUUID());
    expect((await check({ ...valid, mediaFileIds: five })).failed).toEqual([]);
    expect((await check({ ...valid, mediaFileIds: [...five, randomUUID()] })).failed).toEqual(['mediaFileIds']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/ugc-service/src/reviews/dto/admin-create-review.dto.spec.ts`
Expected: FAIL — `AdminCreateReviewDto` 가 undefined 라 `plainToInstance` 가 던지거나 전 테스트 실패.

- [ ] **Step 3: Implement the DTO**

`apps/ugc-service/src/reviews/dto/create-review.dto.ts` 의 import 두 줄을 바꾸고 파일 끝에 클래스를 추가한다:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_REVIEW_MEDIA_COUNT } from '../constants';
```

```ts
/**
 * 관리자(리테일팀)가 다른 채널의 고객 후기를 옮겨 적을 때의 입력.
 * 작성 권한(`eligibilityId`)이 없다 — 이 리뷰는 회원 명의가 아니다.
 */
export class AdminCreateReviewDto {
  @ApiProperty({ description: '상품(마스터) ID (UUID)', example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a' })
  @IsUUID()
  productId: string;

  @ApiProperty({ description: '원 작성자명. 쇼핑몰에는 마스킹되어 보인다', maxLength: 100, example: '홍길동' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  authorName: string;

  @ApiProperty({
    description: '원 작성 시각 (ISO 8601, 시각과 오프셋 필수). 미래 시각은 거절한다',
    example: '2026-09-01T00:00:00+09:00',
  })
  @IsISO8601({ strict: true })
  // 날짜만 오면 UTC 자정으로 해석돼 KST 09:00 이 된다 — 시각과 오프셋을 강제한다.
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message: 'writtenAt must include time and UTC offset',
  })
  writtenAt: string;

  @ApiProperty({ description: '평점', minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: '리뷰 본문', example: '향이 좋아요.' })
  @IsString()
  @Matches(/\S/, { message: 'content must not be blank' })
  content: string;

  @ApiPropertyOptional({
    description: '첨부 미디어 파일 ID 목록 (file-service review-media)',
    type: [String],
    maxItems: MAX_REVIEW_MEDIA_COUNT,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_MEDIA_COUNT)
  @IsUUID('all', { each: true })
  mediaFileIds?: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/ugc-service/src/reviews/dto/admin-create-review.dto.spec.ts`
Expected: PASS. `'2026-02-30T00:00:00+09:00'` 이 통과해 버리면 `@IsISO8601({ strict: true })` 가 붙었는지 확인한다.

- [ ] **Step 5: Commit**

```bash
git add apps/ugc-service/src/reviews/dto/create-review.dto.ts apps/ugc-service/src/reviews/dto/admin-create-review.dto.spec.ts
git commit -m "feat(ugc): 관리자 리뷰 작성 요청 DTO — 작성자명·원 작성 시각을 받는다

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 3: `ReviewsService.createByAdmin`

**Files:**
- Modify: `apps/ugc-service/src/reviews/services/reviews.service.ts` (import 줄 3곳 + **클래스 맨 끝**에 메서드)
- Test: `apps/ugc-service/src/reviews/services/__tests__/admin-create-review.spec.ts`

**Interfaces:**
- Consumes: `ADMIN_MANUAL_SOURCE_SYSTEM` (Task 1), `AdminCreateReviewDto` (Task 2), `reviews.createdByAdminUserId` (Task 1)
- Produces: `ReviewsService.createByAdmin(adminUserId: string, dto: AdminCreateReviewDto, tx?: DbTransaction): Promise<ReviewWithMediaEntity>` — 반환 엔티티의 `permission` 은 `null`.

**왜 클래스 맨 끝인가:** `scripts/security/idor-reviewed.spec.ts` 가 이 파일의 줄번호(429·647·703·829)를 증거 좌표로 들고 있고 ±5줄만 허용한다. 중간에 메서드를 넣으면 전체 jest 가 빨개진다. import 는 기존 줄에 합쳐 **새 줄은 하나만** 늘린다.

- [ ] **Step 1: Write the failing test**

`apps/ugc-service/src/reviews/services/__tests__/admin-create-review.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { ReviewsService } from '../reviews.service';
import { ADMIN_MANUAL_SOURCE_SYSTEM } from '../../../source-system';

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];

type Row = Record<string, unknown>;

/**
 * 리뷰 insert 는 행을 돌려주고, 미디어 insert(배열)는 모으기만 한다.
 * select 는 커밋 후 통계 집계용이다 — 상품 집계(groupBy)와 전체 평균 둘 다 받는다.
 */
function makeService() {
  const reviewRows: Row[] = [];
  const mediaRows: Row[][] = [];

  const tx = {
    insert: () => ({
      values: (values: Row | Row[]) => {
        if (Array.isArray(values)) {
          mediaRows.push(values);
          return Promise.resolve();
        }
        reviewRows.push(values);
        return { returning: () => Promise.resolve([{ id: REVIEW_ID, ...values }]) };
      },
    }),
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve([{ reviewCount: 1, ratingSum: 5 }]), {
            groupBy: () => Promise.resolve([{ rating: 5, count: 1 }]),
          }),
      }),
    }),
  };

  const permissionService = { consume: jest.fn(), linkConsumedReview: jest.fn() };
  const rewardGrantService = { evaluateForNewReview: jest.fn(), recordSkippedForNewReview: jest.fn() };
  const rewardPublisher = { enqueueEarnPointsCommand: jest.fn() };
  const statsPublisher = { publishProductReviewStatsChanged: jest.fn().mockResolvedValue(undefined) };

  const service = new ReviewsService(
    { db: { transaction: (fn: (t: never) => unknown) => fn(tx as never) } } as never,
    permissionService as never,
    rewardGrantService as never,
    rewardPublisher as never,
    statsPublisher as never,
    { get: () => undefined } as never,
  );

  return { service, tx, reviewRows, mediaRows, permissionService, rewardGrantService, rewardPublisher, statsPublisher };
}

const dto = {
  productId: PRODUCT_ID,
  authorName: '홍길동',
  writtenAt: '2026-09-01T00:00:00+09:00',
  rating: 5,
  content: '향이 좋아요.',
  mediaFileIds: MEDIA,
};

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('ReviewsService.createByAdmin — 관리자 수기 작성은 이관분과 같은 모양이다', () => {
  it('회원·권한 없이, 출처·작성자명·원 작성일·입력자를 채워 넣는다', async () => {
    const { service, reviewRows } = makeService();

    const created = await service.createByAdmin(ADMIN_ID, dto);

    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]).toEqual(
      expect.objectContaining({
        userId: null,
        reviewPermissionId: null,
        productId: PRODUCT_ID,
        rating: 5,
        content: '향이 좋아요.',
        sourceSystem: ADMIN_MANUAL_SOURCE_SYSTEM,
        legacyAuthorName: '홍길동',
        createdByAdminUserId: ADMIN_ID,
        createdAt: new Date('2026-08-31T15:00:00.000Z'),
      }),
    );
    expect(reviewRows[0].legacyImportedAt).toBeInstanceOf(Date);
    expect(created).toEqual(
      expect.objectContaining({ id: REVIEW_ID, permission: null, mediaFileIds: MEDIA, adminComment: null }),
    );
  });

  it('미디어를 받은 순서대로 넣는다', async () => {
    const { service, mediaRows } = makeService();

    await service.createByAdmin(ADMIN_ID, dto);

    expect(mediaRows).toEqual([
      [
        { reviewId: REVIEW_ID, fileId: MEDIA[0], order: 0 },
        { reviewId: REVIEW_ID, fileId: MEDIA[1], order: 1 },
      ],
    ]);
  });

  it('작성 권한도 보상도 건드리지 않는다 — 줄 회원이 없다', async () => {
    const { service, permissionService, rewardGrantService, rewardPublisher } = makeService();

    await service.createByAdmin(ADMIN_ID, dto);

    expect(permissionService.consume).not.toHaveBeenCalled();
    expect(permissionService.linkConsumedReview).not.toHaveBeenCalled();
    expect(rewardGrantService.evaluateForNewReview).not.toHaveBeenCalled();
    expect(rewardGrantService.recordSkippedForNewReview).not.toHaveBeenCalled();
    expect(rewardPublisher.enqueueEarnPointsCommand).not.toHaveBeenCalled();
  });

  it('미래 작성 시각은 넣기 전에 거절한다', async () => {
    const { service, reviewRows } = makeService();
    const future = new Date(Date.now() + 60_000).toISOString();

    await expect(service.createByAdmin(ADMIN_ID, { ...dto, writtenAt: future })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(reviewRows).toHaveLength(0);
  });

  it('같은 미디어를 두 번 붙이면 넣기 전에 거절한다', async () => {
    const { service, reviewRows } = makeService();

    await expect(
      service.createByAdmin(ADMIN_ID, { ...dto, mediaFileIds: [MEDIA[0], MEDIA[0]] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(reviewRows).toHaveLength(0);
  });

  it('바깥 트랜잭션이 없으면 커밋 뒤 상품 평점 통계를 발행한다', async () => {
    const { service, statsPublisher } = makeService();

    await service.createByAdmin(ADMIN_ID, dto);
    await flushAsync();

    expect(statsPublisher.publishProductReviewStatsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ productId: PRODUCT_ID, reviewCount: 1 }),
    );
  });

  it('바깥 트랜잭션 안이면 발행을 호출자에게 맡긴다', async () => {
    const { service, tx, statsPublisher } = makeService();

    await service.createByAdmin(ADMIN_ID, dto, tx as never);
    await flushAsync();

    expect(statsPublisher.publishProductReviewStatsChanged).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/ugc-service/src/reviews/services/__tests__/admin-create-review.spec.ts`
Expected: FAIL — `service.createByAdmin is not a function`.

- [ ] **Step 3: Update imports (no net line shift beyond +1)**

`apps/ugc-service/src/reviews/services/reviews.service.ts`:

3번째 줄 `import { DbService, InjectDb } from '@app/db';` 바로 아래에 **한 줄** 추가:

```ts
import { BadRequestError } from '@app/shared';
```

기존 줄 두 개를 **그 자리에서** 바꾼다(줄 수 불변):

```ts
import { ADMIN_MANUAL_SOURCE_SYSTEM, OWN_SOURCE_SYSTEM } from '../../source-system';
import { AdminCreateReviewDto, CreateReviewDto } from '../dto/create-review.dto';
```

- [ ] **Step 4: Append the method at the end of the class**

파일 마지막 `}`(클래스 닫는 괄호) **바로 앞**에 추가:

```ts

  /**
   * 관리자(리테일팀)가 다른 채널의 고객 후기를 한 건씩 옮겨 적는다.
   *
   * 기존 이관분(smartstore·almondyoung-legacy)과 같은 모양으로 쓴다 — 회원 명의도 작성 권한도 없다.
   * 회원이 없으니 회원용 수정·삭제의 소유자 조건을 아무도 통과하지 못하고, 출처가 자체 작성이 아니라
   * 통계는 이관분으로 세며 베스트·보상 후보에서 빠진다. 보상 판정을 부르지 않는 것도 같은 이유다 —
   * 줄 회원이 없다.
   *
   * 이 메서드가 클래스 맨 끝에 있는 것은 `scripts/security/idor-reviewed.spec.ts` 가 이 파일의
   * 줄번호를 증거 좌표로 들고 있어서다. 위쪽에 넣으면 그 좌표가 밀린다.
   */
  async createByAdmin(
    adminUserId: string,
    dto: AdminCreateReviewDto,
    tx?: DbTransaction,
  ): Promise<ReviewWithMediaEntity> {
    const writtenAt = new Date(dto.writtenAt);
    if (Number.isNaN(writtenAt.getTime()) || writtenAt.getTime() > Date.now()) {
      throw new BadRequestError('writtenAt must not be in the future');
    }
    const mediaFileIds = this.normalizeMediaFileIds(dto.mediaFileIds);

    const result = await this.inTx(async (tx) => {
      const [review] = await tx
        .insert(reviews)
        .values({
          userId: null,
          productId: dto.productId,
          rating: dto.rating,
          content: dto.content,
          sourceSystem: ADMIN_MANUAL_SOURCE_SYSTEM,
          reviewPermissionId: null,
          legacyAuthorName: dto.authorName,
          legacyImportedAt: new Date(),
          createdByAdminUserId: adminUserId,
          createdAt: writtenAt,
        })
        .returning();

      await this.insertReviewMedia(review.id, mediaFileIds, tx);

      return {
        ...review,
        permission: null,
        mediaFileIds,
        helpfulCount: 0,
        likeCount: 0,
        dislikeCount: 0,
        adminComment: null,
      };
    }, tx);

    if (!tx) {
      this.publishStatsAfterCommit(dto.productId);
    }

    return result;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest apps/ugc-service/src/reviews/services/__tests__/admin-create-review.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Verify the IDOR coordinate guard and neighbors**

Run: `npx jest scripts/security apps/ugc-service/src/reviews`
Expected: PASS. `predicate 가 … 주변 ±5줄에 없음` 이 나오면 import 를 한 줄보다 많이 늘린 것이다 — Step 3 으로 돌아간다.

- [ ] **Step 7: Commit**

```bash
git add apps/ugc-service/src/reviews/services/reviews.service.ts apps/ugc-service/src/reviews/services/__tests__/admin-create-review.spec.ts
git commit -m "feat(ugc): 관리자가 리뷰를 이관분과 같은 모양으로 적는다 (createByAdmin)

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 4: 관리자 엔드포인트 · 응답 필드 · 출처 필터

**Files:**
- Modify: `apps/ugc-service/src/reviews/dto/admin-review-response.dto.ts`
- Modify: `apps/ugc-service/src/reviews/mappers/review.mapper.ts`
- Modify: `apps/ugc-service/src/reviews/dto/review-list-query.dto.ts` (`AdminReviewListQueryDto`)
- Modify: `apps/ugc-service/src/reviews/services/reviews.service.ts` (`listAllForAdmin` 안, `source` 조건 블록 바로 아래 — 829행보다 아래라 IDOR 좌표 무관)
- Modify: `apps/ugc-service/src/reviews/controllers/reviews.controller.ts`
- Test: `apps/ugc-service/src/reviews/mappers/review.mapper.spec.ts`, `apps/ugc-service/src/reviews/services/__tests__/admin-review-source-filter.spec.ts`

**Interfaces:**
- Consumes: `ReviewsService.createByAdmin` (Task 3), `AdminCreateReviewDto` (Task 2)
- Produces: `POST /reviews/admin/reviews` → 201 `AdminReviewResponseDto`; `AdminReviewResponseDto.sourceSystem: string`, `.createdByAdminUserId: string | null`; `GET /reviews/admin/reviews?sourceSystem=<정확 일치>`

- [ ] **Step 1: Write the failing mapper test**

`apps/ugc-service/src/reviews/mappers/review.mapper.spec.ts` 끝에 추가:

```ts
describe('admin review source fields', () => {
  const entity = {
    id: 'review',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    sourceSystem: 'admin-manual',
    createdByAdminUserId: 'admin-1',
    permission: null,
  } as ReviewWithMediaEntity;

  it('출처와 입력자는 관리자 응답에만 실린다', () => {
    const admin = ReviewMapper.toAdminResponse(entity);
    expect(admin.sourceSystem).toBe('admin-manual');
    expect(admin.createdByAdminUserId).toBe('admin-1');

    const pub = ReviewMapper.toResponse(entity);
    expect(pub).not.toHaveProperty('sourceSystem');
    expect(pub).not.toHaveProperty('createdByAdminUserId');
  });

  it('입력자가 없으면 null 이다 (undefined 가 아니다)', () => {
    const admin = ReviewMapper.toAdminResponse({ ...entity, createdByAdminUserId: null });
    expect(admin.createdByAdminUserId).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing filter test**

`apps/ugc-service/src/reviews/services/__tests__/admin-review-source-filter.spec.ts` 의 마지막 `it.each(['true', 'false'])(...)` 블록 뒤, `describe` 닫기 전에 추가:

```ts
  it('sourceSystem 은 source_system 정확 일치로 건다', async () => {
    const { columns, operators } = await runQuery({ sourceSystem: 'admin-manual' });
    expect(columns).toContain('source_system');
    expect(operators).toContain('=');
    expect(operators).toContain('admin-manual');
    expect(operators).not.toContain('<>');
  });

  it('sourceSystem 미지정이면 source_system 조건을 걸지 않는다', async () => {
    const { columns } = await runQuery({ provider: 'unassigned' });
    expect(columns).not.toContain('source_system');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest apps/ugc-service/src/reviews/mappers/review.mapper.spec.ts apps/ugc-service/src/reviews/services/__tests__/admin-review-source-filter.spec.ts`
Expected: FAIL — `admin.sourceSystem` 이 undefined, `columns` 에 `source_system` 없음.

- [ ] **Step 4: Implement response fields and mapper**

`apps/ugc-service/src/reviews/dto/admin-review-response.dto.ts` 의 `AdminReviewResponseDto` 를:

```ts
export class AdminReviewResponseDto extends ReviewResponseDto {
  @ApiProperty({ type: AdminReviewPermissionDto, nullable: true })
  permission: AdminReviewPermissionDto | null;

  @ApiProperty({
    description: '출처. almondyoung=자체 작성, admin-manual=관리자 수기 작성, 그 밖=다른 사이트 이관',
    example: 'admin-manual',
  })
  sourceSystem: string;

  @ApiProperty({ description: '관리자 수기 작성분의 입력자 ID. 그 밖은 null', nullable: true })
  createdByAdminUserId: string | null;
}
```

`apps/ugc-service/src/reviews/mappers/review.mapper.ts` 의 `toAdminResponse` 를:

```ts
  static toAdminResponse(entity: ReviewWithMediaEntity): AdminReviewResponseDto {
    return {
      ...ReviewMapper.toResponse(entity),
      permission: entity.permission ?? null,
      sourceSystem: entity.sourceSystem,
      createdByAdminUserId: entity.createdByAdminUserId ?? null,
    };
  }
```

- [ ] **Step 5: Implement the list filter**

`apps/ugc-service/src/reviews/dto/review-list-query.dto.ts` 의 `AdminReviewListQueryDto` 에서 `batchId` 필드 바로 아래에 추가:

```ts

  @ApiPropertyOptional({ description: '출처 정확 일치 (예: admin-manual)', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  sourceSystem?: string;
```

`apps/ugc-service/src/reviews/services/reviews.service.ts` `listAllForAdmin` 안의 다음 블록 바로 아래에:

```ts
      if (query.source === 'own') {
        conditions.push(eq(reviews.sourceSystem, OWN_SOURCE_SYSTEM));
      } else if (query.source === 'legacy') {
        conditions.push(ne(reviews.sourceSystem, OWN_SOURCE_SYSTEM));
      }
```

추가:

```ts

      if (query.sourceSystem) {
        conditions.push(eq(reviews.sourceSystem, query.sourceSystem));
      }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest apps/ugc-service/src/reviews/mappers/review.mapper.spec.ts apps/ugc-service/src/reviews/services/__tests__/admin-review-source-filter.spec.ts`
Expected: PASS

- [ ] **Step 7: Add the endpoint**

`apps/ugc-service/src/reviews/controllers/reviews.controller.ts`:

import 줄 `import { CreateReviewDto } from '../dto/create-review.dto';` 를:

```ts
import { AdminCreateReviewDto, CreateReviewDto } from '../dto/create-review.dto';
```

`// ─── 관리자용 조회 ───` 주석 **바로 위**에 추가:

```ts
  // ─── 관리자용 작성 ───

  @Post('admin/reviews')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '리뷰 수기 작성 (관리자) — 다른 채널 고객 후기를 옮겨 적는다' })
  @ApiBody({ type: AdminCreateReviewDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: '작성 성공', type: AdminReviewResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: '입력 오류 (미래 작성일·빈 본문 등)' })
  async createByAdmin(
    @User('userId') adminUserId: string,
    @Body() dto: AdminCreateReviewDto,
  ): Promise<AdminReviewResponseDto> {
    const review = await this.reviewsService.createByAdmin(adminUserId, dto);
    return ReviewMapper.toAdminResponse(review);
  }

```

그리고 `@Get('admin/reviews')` 의 `@ApiQuery` 목록에서 `source` 항목 아래에 추가:

```ts
  @ApiQuery({ name: 'sourceSystem', description: '출처 정확 일치 (예: admin-manual)', required: false, type: String })
```

- [ ] **Step 8: Verify route audit and type-check**

Run: `npm run type-check && npx jest scripts/security apps/ugc-service`
Expected: type-check 에러 0, jest PASS. 새 라우트는 `@RequireScopes` 가 있어 IDOR 대상이 아니므로 `idor-reviewed.spec.ts` 명단을 바꿀 필요가 없다 — 만약 「unlisted」 에 `ugc-service POST /reviews/admin/reviews` 가 나오면 멈추고 보고한다(스코프 데코레이터가 안 붙은 것이다).

추가 확인: `node scripts/security/route-authz-audit.js ugc-service | grep "admin/reviews"` 출력의 POST 줄이 인가 표기가 있는 쪽으로 분류되는지 본다.

- [ ] **Step 9: Commit**

```bash
git add apps/ugc-service/src/reviews
git commit -m "feat(ugc): POST /reviews/admin/reviews 와 관리자 응답의 출처·입력자, sourceSystem 필터

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 5: 실 DB 통합 스펙

**Files:**
- Test: `apps/ugc-service/src/reviews/services/admin-create-review.integration.spec.ts`

**Interfaces:**
- Consumes: `ReviewsService.createByAdmin`, `getReviewForAdmin`, `listAllForAdmin` (with `sourceSystem`), `listByProduct`, `getRatingSummary`, `update`, `remove`

- [ ] **Step 1: Prepare a migrated local DB**

로컬 `ugc` DB 는 다른 브랜치 마이그레이션 잔재로 `drizzle-kit migrate` 가 조용히 실패할 수 있다. 전용 임시 DB 를 쓴다:

```bash
psql postgresql://postgres:postgres@localhost:5432/postgres -c "DROP DATABASE IF EXISTS ugc_admin_manual_it" -c "CREATE DATABASE ugc_admin_manual_it"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc_admin_manual_it npx drizzle-kit migrate --config apps/ugc-service/src/db/drizzle.config.ts
psql postgresql://postgres:postgres@localhost:5432/ugc_admin_manual_it -Atc "select column_name from information_schema.columns where table_name='reviews' and column_name='created_by_admin_user_id'"
```

Expected: 마지막 줄이 `created_by_admin_user_id`. (`drizzle.config.ts` 의 dotenv 는 이미 있는 `DATABASE_URL` 을 덮지 않는다.) 접속 정보가 다르면 `apps/ugc-service/.env` 의 계정으로 바꾼다.

- [ ] **Step 2: Write the integration spec**

`apps/ugc-service/src/reviews/services/admin-create-review.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import { reviewMedia, reviews, ugcServiceSchema, type UgcServiceSchema } from '../../db/schema';
import { ADMIN_MANUAL_SOURCE_SYSTEM } from '../../source-system';
import { ReviewsService } from './reviews.service';

/**
 * 관리자 수기 리뷰가 실 DB 에서 «이관분과 같은 모양»으로 동작하는지.
 *
 * 실행:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc_admin_manual_it \
 *     npx jest --runInBand --testPathPattern="admin-create-review.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('관리자 수기 리뷰 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const productId = randomUUID();
  const adminId = randomUUID();
  const createdIds: string[] = [];

  let sql: postgres.Sql;
  let service: ReviewsService;
  let rewardGrantService: { evaluateForNewReview: jest.Mock; recordSkippedForNewReview: jest.Mock };

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    const db = drizzle(sql, { schema: ugcServiceSchema });
    rewardGrantService = { evaluateForNewReview: jest.fn(), recordSkippedForNewReview: jest.fn() };
    service = new ReviewsService(
      { db } as never,
      { consume: jest.fn(), linkConsumedReview: jest.fn() } as never,
      rewardGrantService as never,
      { enqueueEarnPointsCommand: jest.fn() } as never,
      { publishProductReviewStatsChanged: jest.fn().mockResolvedValue(undefined) } as never,
      { get: () => undefined } as never,
    );
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      const db = drizzle(sql, { schema: ugcServiceSchema });
      await db.delete(reviewMedia).where(inArray(reviewMedia.reviewId, createdIds));
      await db.delete(reviews).where(inArray(reviews.id, createdIds));
    }
    await sql.end();
  });

  const create = async (overrides: Partial<{ rating: number; writtenAt: string }> = {}) => {
    const review = await service.createByAdmin(adminId, {
      productId,
      authorName: '홍길동',
      writtenAt: overrides.writtenAt ?? '2020-01-15T00:00:00+09:00',
      rating: overrides.rating ?? 4,
      content: '다른 채널에서 옮겨 온 후기',
      mediaFileIds: [randomUUID()],
    });
    createdIds.push(review.id);
    return review;
  };

  it('저장한 원 작성 시각이 그대로 돌아온다 (timestamp 왕복)', async () => {
    const { id } = await create();
    const stored = await service.getReviewForAdmin(id);

    expect(stored.createdAt.toISOString()).toBe('2020-01-14T15:00:00.000Z');
    expect(stored.userId).toBeNull();
    expect(stored.reviewPermissionId).toBeNull();
    expect(stored.sourceSystem).toBe(ADMIN_MANUAL_SOURCE_SYSTEM);
    expect(stored.createdByAdminUserId).toBe(adminId);
    expect(stored.legacyAuthorName).toBe('홍길동');
    expect(stored.legacyImportedAt).toBeInstanceOf(Date);
    expect(stored.mediaFileIds).toHaveLength(1);
    expect(rewardGrantService.evaluateForNewReview).not.toHaveBeenCalled();
    expect(rewardGrantService.recordSkippedForNewReview).not.toHaveBeenCalled();
  });

  it('공개 상품 리뷰 목록과 평점 요약에 일반 리뷰처럼 잡힌다', async () => {
    await create({ rating: 2 });

    const list = await service.listByProduct({ productId } as never);
    expect(list.data.map((r) => r.id)).toEqual(expect.arrayContaining(createdIds));

    const summary = await service.getRatingSummary(productId);
    expect(summary.totalCount).toBe(createdIds.length);
  });

  it('관리자 목록에서 sourceSystem 으로 모아 볼 수 있다', async () => {
    const page = await service.listAllForAdmin({
      sourceSystem: ADMIN_MANUAL_SOURCE_SYSTEM,
      productId,
      limit: 50,
    } as never);
    expect(page.data.map((r) => r.id).sort()).toEqual([...createdIds].sort());
  });

  it('어떤 회원도 회원용 수정·삭제로 건드릴 수 없다', async () => {
    const [id] = createdIds;
    const someone = randomUUID();

    await expect(service.update(someone, id, { content: '바꿔치기' } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(someone, id)).rejects.toBeInstanceOf(NotFoundException);

    const after = await service.getReviewForAdmin(id);
    expect(after.content).toBe('다른 채널에서 옮겨 온 후기');
    expect(after.deletedAt).toBeNull();
  });
});
```

- [ ] **Step 3: Run it against the migrated DB**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc_admin_manual_it npx jest --runInBand --testPathPattern="admin-create-review.integration"`
Expected: PASS (4 tests). `update` 가 `NotFoundException` 대신 다른 예외를 던지면 그 서비스 코드를 읽고 기대값을 실제 계약에 맞춘다 — 핵심은 «행이 바뀌지 않았다»(마지막 두 expect)이고 그것은 바꾸지 않는다.

- [ ] **Step 4: Confirm it is skipped by the default gate**

Run: `npx jest apps/ugc-service/src/reviews/services/admin-create-review.integration.spec.ts`
Expected: `skipped` (DATABASE_URL 미설정). 스펙 안에서 `dotenv.config()` 를 부르지 않는다(`scripts/jest/no-self-loaded-env-in-specs.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/ugc-service/src/reviews/services/admin-create-review.integration.spec.ts
git commit -m "test(ugc): 관리자 수기 리뷰의 실 DB 왕복·공개 노출·회원 접근 차단

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 6: admin-web 계약 · 순수 함수 (라벨 · 폼 · 탭)

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/review.ts`
- Modify: `apps/admin-web/src/lib/api/domains/review/index.ts`
- Modify: `apps/admin-web/src/lib/api/domains/files/upload.client.ts`
- Modify: `apps/admin-web/src/lib/services/review/mutations.ts`
- Create: `apps/admin-web/src/features/cs/review/lib/review-provenance.ts`
- Create: `apps/admin-web/src/features/cs/review/lib/admin-review-form.ts`
- Create: `apps/admin-web/src/features/cs/review/lib/review-tabs.ts`
- Test: `apps/admin-web/src/features/cs/review/lib/review-provenance.spec.ts`, `admin-review-form.spec.ts`, `review-tabs.spec.ts`

**Interfaces:**
- Consumes: `POST /reviews/admin/reviews`, `sourceSystem` 필터, 응답 `sourceSystem`·`createdByAdminUserId` (Task 4)
- Produces:
  - `ReviewDto.sourceSystem?: string`, `ReviewDto.createdByAdminUserId?: string | null`, `ReviewListQuery.sourceSystem?: string`
  - `interface AdminCreateReviewDto { productId: string; authorName: string; writtenAt: string; rating: number; content: string; mediaFileIds: string[] }` (in `lib/types/dto/review.ts`)
  - `reviewApi.createByAdmin(dto: AdminCreateReviewDto): Promise<ReviewDto>`
  - `useCreateAdminReview()` → `useMutation<ReviewDto, unknown, AdminCreateReviewDto>`
  - `REVIEW_MEDIA_CONTEXT_ID = 'review-media'`
  - `ADMIN_MANUAL_SOURCE_SYSTEM`, `ADMIN_MANUAL_LABEL`, `reviewAuthorityLabel(review)`
  - `ADMIN_REVIEW_MAX_MEDIA`, `ADMIN_REVIEW_AUTHOR_MAX`, `type AdminReviewFormValues`, `type AdminReviewField`, `kstToday(now)`, `toWrittenAtIso(date)`, `emptyAdminReviewForm(now)`, `buildAdminReviewPayload(values, now)`
  - `REVIEW_TABS`, `activeReviewTab(params)`, `nextReviewTabParams(params, key)`

admin-web 스펙은 `npm run test:admin-web`(루트 jest 의 admin-web 전용 설정)으로 돈다. **스펙은 `@/` 별칭을 못 쓴다** — 순수 모듈과 스펙은 상대 경로로만 import 한다.

- [ ] **Step 1: Write the failing tests**

`apps/admin-web/src/features/cs/review/lib/review-provenance.spec.ts`:

```ts
import { ADMIN_MANUAL_LABEL, ADMIN_MANUAL_SOURCE_SYSTEM, reviewAuthorityLabel } from './review-provenance';

describe('reviewAuthorityLabel', () => {
  it('관리자 수기 작성분은 권한이 없어도 「관리자 수기 작성」이다', () => {
    expect(reviewAuthorityLabel({ sourceSystem: ADMIN_MANUAL_SOURCE_SYSTEM, permission: null })).toBe(
      ADMIN_MANUAL_LABEL,
    );
  });

  it('그 밖은 기존 권한 라벨을 그대로 쓴다', () => {
    const permission = { id: 'p', batchId: null, grantedReason: null };
    expect(reviewAuthorityLabel({ sourceSystem: 'almondyoung', permission: { ...permission, provider: 'admin' } })).toBe(
      '관리자 권한',
    );
    expect(reviewAuthorityLabel({ sourceSystem: 'almondyoung', permission: { ...permission, provider: 'order' } })).toBe(
      '주문 권한',
    );
    expect(reviewAuthorityLabel({ sourceSystem: 'smartstore', permission: null })).toBe('권한 미연결');
  });

  it('출처를 모르는 응답(상태 변경 응답 등)도 권한 라벨로 떨어진다', () => {
    expect(reviewAuthorityLabel({ permission: undefined })).toBe('권한 미연결');
  });
});
```

`apps/admin-web/src/features/cs/review/lib/admin-review-form.spec.ts`:

```ts
import {
  ADMIN_REVIEW_AUTHOR_MAX,
  buildAdminReviewPayload,
  emptyAdminReviewForm,
  kstToday,
  toWrittenAtIso,
  type AdminReviewFormValues,
} from './admin-review-form';

const NOW = new Date('2026-09-30T03:00:00.000Z'); // KST 2026-09-30 12:00

const filled = (over: Partial<AdminReviewFormValues> = {}): AdminReviewFormValues => ({
  productId: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  authorName: '홍길동',
  writtenDate: '2026-09-01',
  rating: 5,
  content: '향이 좋아요.',
  mediaFileIds: [],
  ...over,
});

describe('kstToday', () => {
  it('UTC 15:00 이 KST 날짜 경계다', () => {
    expect(kstToday(new Date('2026-09-30T14:59:59.999Z'))).toBe('2026-09-30');
    expect(kstToday(new Date('2026-09-30T15:00:00.000Z'))).toBe('2026-10-01');
  });
});

describe('toWrittenAtIso', () => {
  it('달력 날짜를 KST 자정 시각으로 보낸다', () => {
    expect(toWrittenAtIso('2026-09-01')).toBe('2026-09-01T00:00:00+09:00');
  });
});

describe('emptyAdminReviewForm', () => {
  it('작성일 기본값은 KST 오늘이다', () => {
    expect(emptyAdminReviewForm(NOW)).toEqual({
      productId: null,
      authorName: '',
      writtenDate: '2026-09-30',
      rating: null,
      content: '',
      mediaFileIds: [],
    });
  });
});

describe('buildAdminReviewPayload', () => {
  it('정상 입력은 서버 계약 모양으로 바꾼다 (작성자명 trim, 본문은 그대로)', () => {
    expect(buildAdminReviewPayload(filled({ authorName: '  홍길동 ', content: ' 원문 그대로 ' }), NOW)).toEqual({
      ok: true,
      payload: {
        productId: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
        authorName: '홍길동',
        writtenAt: '2026-09-01T00:00:00+09:00',
        rating: 5,
        content: ' 원문 그대로 ',
        mediaFileIds: [],
      },
    });
  });

  it.each<[string, Partial<AdminReviewFormValues>, string]>([
    ['상품 미선택', { productId: null }, 'productId'],
    ['작성자명 공백', { authorName: '   ' }, 'authorName'],
    ['작성자명 초과', { authorName: '가'.repeat(ADMIN_REVIEW_AUTHOR_MAX + 1) }, 'authorName'],
    ['작성일 비어 있음', { writtenDate: '' }, 'writtenDate'],
    ['작성일 미래(KST 내일)', { writtenDate: '2026-10-01' }, 'writtenDate'],
    ['별점 미선택', { rating: null }, 'rating'],
    ['본문 공백', { content: ' \n ' }, 'content'],
    ['사진 6장', { mediaFileIds: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'mediaFileIds'],
  ])('%s → %s 에서 멈춘다', (_label, over, field) => {
    const result = buildAdminReviewPayload(filled(over), NOW);
    expect(result).toEqual(expect.objectContaining({ ok: false, field }));
  });

  it('작성일이 KST 오늘이면 통과한다', () => {
    expect(buildAdminReviewPayload(filled({ writtenDate: '2026-09-30' }), NOW).ok).toBe(true);
  });
});
```

`apps/admin-web/src/features/cs/review/lib/review-tabs.spec.ts`:

```ts
import { activeReviewTab, nextReviewTabParams } from './review-tabs';

describe('review tabs', () => {
  it('sourceSystem=admin-manual 이면 수기 작성 탭이 활성이다', () => {
    expect(activeReviewTab(new URLSearchParams('sourceSystem=admin-manual'))).toBe('admin-manual');
    expect(activeReviewTab(new URLSearchParams('provider=order'))).toBe('order');
    expect(activeReviewTab(new URLSearchParams(''))).toBe('');
  });

  it('수기 작성 탭으로 가면 권한·배치·페이지 필터를 비운다', () => {
    const next = nextReviewTabParams(new URLSearchParams('provider=admin&batchId=b1&page=3&q=향'), 'admin-manual');
    expect(next.get('sourceSystem')).toBe('admin-manual');
    expect(next.get('provider')).toBeNull();
    expect(next.get('batchId')).toBeNull();
    expect(next.get('page')).toBeNull();
    expect(next.get('q')).toBe('향');
  });

  it('권한 탭으로 가면 출처 필터를 비운다', () => {
    const next = nextReviewTabParams(new URLSearchParams('sourceSystem=admin-manual'), 'order');
    expect(next.get('provider')).toBe('order');
    expect(next.get('sourceSystem')).toBeNull();
  });

  it('전체 탭은 둘 다 비운다', () => {
    const next = nextReviewTabParams(new URLSearchParams('provider=admin&sourceSystem=admin-manual'), '');
    expect(next.get('provider')).toBeNull();
    expect(next.get('sourceSystem')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:admin-web -- apps/admin-web/src/features/cs/review/lib`
Expected: FAIL — `Cannot find module './review-provenance'` 등.

- [ ] **Step 3: Extend DTO types**

`apps/admin-web/src/lib/types/dto/review.ts`:

`ReviewDto` 인터페이스 안 `adminComment: AdminCommentDto | null;` 아래에 추가:

```ts
  /** 관리자 응답에만 온다. almondyoung=자체 작성, admin-manual=관리자 수기 작성, 그 밖=이관 */
  sourceSystem?: string;
  /** 관리자 수기 작성분의 입력자 ID. 관리자 응답에만 온다 */
  createdByAdminUserId?: string | null;
```

`ReviewListQuery` 안 `source?: ReviewSourceOption;` 아래에 추가:

```ts
  /** 출처 정확 일치 (예: admin-manual) */
  sourceSystem?: string;
```

`ReviewDto` 인터페이스 바로 아래에 추가:

```ts
/** POST /reviews/admin/reviews 요청 — 다른 채널 고객 후기를 옮겨 적는다 */
export interface AdminCreateReviewDto {
  productId: string;
  authorName: string;
  /** ISO 8601, 오프셋 포함 (예: 2026-09-01T00:00:00+09:00) */
  writtenAt: string;
  rating: number;
  content: string;
  mediaFileIds: string[];
}
```

- [ ] **Step 4: Implement the pure modules**

`apps/admin-web/src/features/cs/review/lib/review-provenance.ts`:

```ts
import { REVIEW_PROVIDER_LABELS, type ReviewDto } from '../../../../lib/types/dto/review';

/** ugc-service `source-system.ts` 의 `ADMIN_MANUAL_SOURCE_SYSTEM` 과 같은 값 */
export const ADMIN_MANUAL_SOURCE_SYSTEM = 'admin-manual';
export const ADMIN_MANUAL_LABEL = '관리자 수기 작성';

/**
 * 목록·상세의 「작성 권한」 칸. 관리자 수기 작성분은 권한 행이 없어 provider 로는 「권한 미연결」이
 * 되는데, 그러면 오래된 이관분과 섞여 리테일팀이 자기 입력분을 못 알아본다 — 출처로 먼저 가른다.
 */
export function reviewAuthorityLabel(review: Pick<ReviewDto, 'permission' | 'sourceSystem'>): string {
  if (review.sourceSystem === ADMIN_MANUAL_SOURCE_SYSTEM) return ADMIN_MANUAL_LABEL;
  return REVIEW_PROVIDER_LABELS[review.permission?.provider ?? 'unassigned'];
}
```

`apps/admin-web/src/features/cs/review/lib/admin-review-form.ts`:

```ts
import type { AdminCreateReviewDto } from '../../../../lib/types/dto/review';

/** ugc-service `MAX_REVIEW_MEDIA_COUNT` 와 같다 */
export const ADMIN_REVIEW_MAX_MEDIA = 5;
/** `reviews.legacy_author_name` 길이 */
export const ADMIN_REVIEW_AUTHOR_MAX = 100;

export type AdminReviewFormValues = {
  productId: string | null;
  authorName: string;
  /** KST 달력 날짜 YYYY-MM-DD */
  writtenDate: string;
  rating: number | null;
  content: string;
  mediaFileIds: string[];
};

export type AdminReviewField = keyof AdminReviewFormValues;

export type BuildAdminReviewResult =
  | { ok: true; payload: AdminCreateReviewDto }
  | { ok: false; field: AdminReviewField; message: string };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 브라우저 시간대와 무관하게 KST 달력 날짜를 낸다 */
export function kstToday(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 날짜만 보내면 서버가 UTC 자정으로 읽는다 — KST 자정 시각으로 보낸다 */
export function toWrittenAtIso(date: string): string {
  return `${date}T00:00:00+09:00`;
}

export function emptyAdminReviewForm(now: Date): AdminReviewFormValues {
  return { productId: null, authorName: '', writtenDate: kstToday(now), rating: null, content: '', mediaFileIds: [] };
}

const fail = (field: AdminReviewField, message: string): BuildAdminReviewResult => ({ ok: false, field, message });

export function buildAdminReviewPayload(values: AdminReviewFormValues, now: Date): BuildAdminReviewResult {
  if (!values.productId) return fail('productId', '상품을 선택해 주세요.');

  const authorName = values.authorName.trim();
  if (!authorName) return fail('authorName', '작성자명을 입력해 주세요.');
  if (authorName.length > ADMIN_REVIEW_AUTHOR_MAX) {
    return fail('authorName', `작성자명은 ${ADMIN_REVIEW_AUTHOR_MAX}자까지 입력할 수 있어요.`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.writtenDate)) return fail('writtenDate', '작성일을 선택해 주세요.');
  if (values.writtenDate > kstToday(now)) return fail('writtenDate', '작성일은 오늘 이후로 정할 수 없어요.');

  const { rating } = values;
  if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return fail('rating', '별점을 선택해 주세요.');
  }

  if (!values.content.trim()) return fail('content', '리뷰 내용을 입력해 주세요.');

  if (values.mediaFileIds.length > ADMIN_REVIEW_MAX_MEDIA) {
    return fail('mediaFileIds', `사진은 ${ADMIN_REVIEW_MAX_MEDIA}장까지 올릴 수 있어요.`);
  }

  return {
    ok: true,
    payload: {
      productId: values.productId,
      authorName,
      writtenAt: toWrittenAtIso(values.writtenDate),
      rating,
      content: values.content,
      mediaFileIds: values.mediaFileIds,
    },
  };
}
```

`apps/admin-web/src/features/cs/review/lib/review-tabs.ts`:

```ts
import { ADMIN_MANUAL_LABEL, ADMIN_MANUAL_SOURCE_SYSTEM } from './review-provenance';

type TabParam = 'provider' | 'sourceSystem';

export const REVIEW_TABS: ReadonlyArray<{ key: string; label: string; param?: TabParam }> = [
  { key: '', label: '전체' },
  { key: 'order', label: '주문 권한 리뷰', param: 'provider' },
  { key: 'admin', label: '관리자 권한 리뷰', param: 'provider' },
  { key: 'unassigned', label: '권한 미연결', param: 'provider' },
  { key: ADMIN_MANUAL_SOURCE_SYSTEM, label: ADMIN_MANUAL_LABEL, param: 'sourceSystem' },
];

export function activeReviewTab(params: URLSearchParams): string {
  if (params.get('sourceSystem') === ADMIN_MANUAL_SOURCE_SYSTEM) return ADMIN_MANUAL_SOURCE_SYSTEM;
  return params.get('provider') ?? '';
}

/**
 * 탭은 권한(provider)과 출처(sourceSystem) 두 축에 걸친다. 한쪽 탭으로 옮길 때 다른 축 값이 남으면
 * 두 조건이 AND 로 걸려 0건이 된다 — 탭 전환은 두 축과 배치·페이지를 모두 비우고 하나만 다시 건다.
 */
export function nextReviewTabParams(params: URLSearchParams, key: string): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.delete('provider');
  next.delete('sourceSystem');
  next.delete('batchId');
  next.delete('page');

  const tab = REVIEW_TABS.find((t) => t.key === key);
  if (tab?.param) next.set(tab.param, tab.key);
  return next;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:admin-web -- apps/admin-web/src/features/cs/review/lib`
Expected: PASS (3 suites)

- [ ] **Step 6: Wire API, upload context, mutation**

`apps/admin-web/src/lib/api/domains/files/upload.client.ts` 의 `SHOP_LISTING_IMAGE_CONTEXT_ID` 줄 아래에 추가:

```ts
/** file-service `review-media` 컨텍스트 (image/*·video/*, 공개). 관리자 수기 리뷰 사진에 쓴다 */
export const REVIEW_MEDIA_CONTEXT_ID = 'review-media';
```

`apps/admin-web/src/lib/api/domains/review/index.ts`: import 목록에 `AdminCreateReviewDto,` 를 더하고(`AdminCommentDto,` 다음 줄), `reviewApi` 객체의 `getReview` 다음에 추가:

```ts

  // 리뷰 수기 작성 (관리자) — 다른 채널 고객 후기를 옮겨 적는다
  createByAdmin: async (dto: AdminCreateReviewDto): Promise<ReviewDto> => {
    const response: AxiosResponse<ReviewDto> = await client.post(
      `${UGC_SERVICE_BASE_URL}/reviews/admin/reviews`,
      dto
    );
    return response.data;
  },
```

`apps/admin-web/src/lib/services/review/mutations.ts`: import 목록에 `AdminCreateReviewDto,` 를 더하고 파일 끝에 추가:

```ts

export const useCreateAdminReview = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: AdminCreateReviewDto) => reviewApi.createByAdmin(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewQueryKeys.all });
    },
  });
};
```

- [ ] **Step 7: Type-check admin-web**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0 (CI 는 admin-web tsc 를 돌리지 않는다 — 여기서 직접 본다).

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/lib apps/admin-web/src/features/cs/review/lib
git commit -m "feat(admin-web): 관리자 수기 리뷰 API 계약과 라벨·폼·탭 판정 함수

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 7: 사진 여러 장 입력을 공용으로 옮기고 장수 상한을 받는다

**Files:**
- Move: `apps/admin-web/src/features/mall/shop-listings/components/image-gallery-field/` → `apps/admin-web/src/components/common/image-gallery-field/` (`index.tsx`, `crop-dialog.tsx`)
- Modify: `apps/admin-web/src/components/common/image-gallery-field/index.tsx`
- Modify: `apps/admin-web/src/features/mall/shop-listings/components/shop-listing-form/index.tsx:42`

**Interfaces:**
- Produces: `ImageGalleryField({ value: string[]; onChange: (ids: string[]) => void; contextId: string; disabled?: boolean; maxImages?: number })` from `@/components/common/image-gallery-field`. `maxImages` 기본값 15(기존 동작).

- [ ] **Step 1: Move the component**

```bash
git mv apps/admin-web/src/features/mall/shop-listings/components/image-gallery-field apps/admin-web/src/components/common/image-gallery-field
```

`crop-dialog.tsx` 는 `@/` 별칭만 쓰므로 수정 불필요.

- [ ] **Step 2: Fix the one importer**

`apps/admin-web/src/features/mall/shop-listings/components/shop-listing-form/index.tsx` 42행:

```ts
import { ImageGalleryField } from '@/components/common/image-gallery-field';
```

- [ ] **Step 3: Add the `maxImages` prop**

`apps/admin-web/src/components/common/image-gallery-field/index.tsx`:

상수 줄을 이름만 바꾼다:

```ts
/** 사고 방지용 기본 상한. 샵 매매 권장은 8~10장이라 여기에 닿을 일은 거의 없다. */
const DEFAULT_MAX_IMAGES = 15;
```

`Props` 에 추가:

```ts
  /** 올릴 수 있는 최대 장수. 리뷰는 5장 */
  maxImages?: number;
```

함수 시그니처를 `export function ImageGalleryField({ value, onChange, contextId, disabled, maxImages = DEFAULT_MAX_IMAGES }: Props) {` 로 바꾸고, 본문의 `MAX_IMAGES` 참조 **여섯 곳**(현 43·45·51·125·130·137행 — room 계산, 두 토스트 문구, 두 비활성 조건, `{value.length}/{…}` 표시)을 모두 `maxImages` 로 바꾼다. `MAX_BYTES` 는 그대로 둔다.

Run: `grep -n "MAX_IMAGES" apps/admin-web/src/components/common/image-gallery-field/index.tsx`
Expected: `DEFAULT_MAX_IMAGES` 두 줄(선언·기본값)만 남는다.

- [ ] **Step 4: Type-check and existing admin-web tests**

Run: `cd apps/admin-web && npx tsc --noEmit && cd ../.. && npm run test:admin-web`
Expected: tsc 0, 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/admin-web/src/components/common/image-gallery-field apps/admin-web/src/features/mall/shop-listings
git commit -m "refactor(admin-web): 사진 여러 장 입력을 공용으로 옮기고 장수 상한을 받는다

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 8: 리뷰 작성 화면 (`/cs/reviews/new`)

**Files:**
- Create: `apps/admin-web/src/features/cs/review/components/review-product-picker/index.tsx`
- Create: `apps/admin-web/src/features/cs/review/components/admin-review-create-form/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/cs/reviews/new/page.tsx`
- Modify: `apps/admin-web/src/features/cs/review/template/index.tsx` (헤더 버튼 — 탭 교체는 Task 9)

**Interfaces:**
- Consumes: `useMastersSummary(query: MastersQuery)` → `{ data?: { data: MasterSummaryDto[] } }` (`MasterSummaryDto.masterId|name|thumbnail|productCode`), `useCreateAdminReview` · `REVIEW_MEDIA_CONTEXT_ID` · 폼 순수 함수 (Task 6), `ImageGalleryField` (Task 7)
- Produces: `ReviewProductPicker({ value: PickedProduct | null; onChange: (p: PickedProduct | null) => void; invalid?: boolean })`, `type PickedProduct = { id: string; name: string; thumbnail: string | null }`, `AdminReviewCreateForm()`

**중요:** 리뷰의 `productId` 는 **core 마스터 상품 UUID** 다(리뷰 상세가 `useMastersByIdsSuspense` 로 조회한다). 타임세일·쿠폰의 선택기는 **Medusa 상품 ID** 를 쓰므로 재사용하면 안 된다.

이 앱은 컴포넌트 테스트가 불가능하다(판정은 Task 6 순수 함수가 맡는다). 검증은 tsc + Task 10 수동 스모크다.

- [ ] **Step 1: Product picker**

`apps/admin-web/src/features/cs/review/components/review-product-picker/index.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMastersSummary } from '@/lib/services/products/queries';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { cn } from '@/lib/utils';

export type PickedProduct = { id: string; name: string; thumbnail: string | null };

const PAGE_SIZE = 10;

function Thumb({ fileId, name }: { fileId: string | null; name: string }) {
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded border bg-muted">
      <Image
        unoptimized
        src={resolvePublicFileUrl(fileId) ?? '/placeholder.svg'}
        alt={name}
        width={48}
        height={48}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

/**
 * 리뷰를 달 상품(core 마스터)을 고른다. 리뷰의 productId 는 마스터 UUID 라 Medusa 상품 선택기를 쓰면 안 된다.
 */
export function ReviewProductPicker({
  value,
  onChange,
  invalid,
}: {
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
  invalid?: boolean;
}) {
  const [keyword, setKeyword] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, isFetching, isError } = useMastersSummary({ q: submitted || undefined, limit: PAGE_SIZE, page: 1 });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="flex min-w-0 items-center gap-3">
          <Thumb fileId={value.thumbnail} name={value.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{value.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{value.id}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
          다른 상품 선택
        </Button>
      </div>
    );
  }

  const products = data?.data ?? [];

  return (
    <div className={cn('flex flex-col gap-2 rounded-md', invalid && 'ring-2 ring-destructive ring-offset-2')}>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(keyword.trim());
        }}
      >
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="상품명·품번으로 검색"
          aria-label="상품 검색"
        />
        <Button type="submit" variant="outline" disabled={isFetching}>
          <Search className="h-4 w-4" />
          검색
        </Button>
      </form>
      {isError ? (
        <p className="text-sm text-destructive">상품을 불러오지 못했어요. 다시 검색해 주세요.</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">{isFetching ? '불러오는 중…' : '검색 결과가 없어요.'}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {products.map((product) => (
            <li key={product.masterId} className="flex items-center justify-between gap-3 p-2">
              <div className="flex min-w-0 items-center gap-3">
                <Thumb fileId={product.thumbnail} name={product.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.productCode ?? product.masterId}</p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  onChange({ id: product.masterId, name: product.name, thumbnail: product.thumbnail })
                }
              >
                선택
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`useMastersSummary` 의 반환 필드명(`isError`, `data.data`)이나 `MastersQuery.q` 가 다르면 `lib/services/products/queries.ts:115` 와 `lib/types/dto/products.ts:135` 를 보고 맞춘다. 검색어가 비면 최근 상품 10개가 보인다(의도).

- [ ] **Step 2: Create form**

`apps/admin-web/src/features/cs/review/components/admin-review-create-form/index.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { StarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ImageGalleryField } from '@/components/common/image-gallery-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REVIEW_MEDIA_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import { useCreateAdminReview } from '@/lib/services/review';
import { cn } from '@/lib/utils';
import {
  ADMIN_REVIEW_AUTHOR_MAX,
  ADMIN_REVIEW_MAX_MEDIA,
  buildAdminReviewPayload,
  emptyAdminReviewForm,
  kstToday,
  type AdminReviewField,
  type AdminReviewFormValues,
} from '../../lib/admin-review-form';
import { ReviewProductPicker, type PickedProduct } from '../review-product-picker';

const invalidRing = 'ring-2 ring-destructive ring-offset-2';

function serverMessage(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const message: unknown = error.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : null;
}

export function AdminReviewCreateForm() {
  const router = useRouter();
  const createMutation = useCreateAdminReview();
  const [values, setValues] = useState<AdminReviewFormValues>(() => emptyAdminReviewForm(new Date()));
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [invalid, setInvalid] = useState<AdminReviewField | null>(null);

  const set = <K extends AdminReviewField>(key: K, value: AdminReviewFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (invalid === key) setInvalid(null);
  };

  const pickProduct = (next: PickedProduct | null) => {
    setProduct(next);
    set('productId', next?.id ?? null);
  };

  const handleSave = async () => {
    const built = buildAdminReviewPayload(values, new Date());
    if (!built.ok) {
      setInvalid(built.field);
      toast.error(built.message);
      return;
    }
    setInvalid(null);

    try {
      const created = await createMutation.mutateAsync(built.payload);
      toast.success('리뷰를 등록했어요. 쇼핑몰 상품 리뷰에 바로 보여요.');
      router.push(`/cs/reviews/${created.id}`);
    } catch (error) {
      toast.error(serverMessage(error) ?? '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  const saving = createMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>리뷰 작성</CardTitle>
        <p className="text-sm text-muted-foreground">
          다른 채널에서 받은 고객 후기를 옮겨 적습니다. 쇼핑몰에는 일반 리뷰와 똑같이 보입니다.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <Label>상품</Label>
          <ReviewProductPicker value={product} onChange={pickProduct} invalid={invalid === 'productId'} />
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="review-author">작성자명</Label>
          <Input
            id="review-author"
            value={values.authorName}
            maxLength={ADMIN_REVIEW_AUTHOR_MAX}
            onChange={(event) => set('authorName', event.target.value)}
            className={cn(invalid === 'authorName' && invalidRing)}
          />
          <p className="text-xs text-muted-foreground">
            원문 이름 그대로 입력하세요. 쇼핑몰에는 가려져 표시됩니다(예: 홍길동 → 홍**).
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="review-date">작성일</Label>
          <Input
            id="review-date"
            type="date"
            value={values.writtenDate}
            max={kstToday(new Date())}
            onChange={(event) => set('writtenDate', event.target.value)}
            className={cn('w-48', invalid === 'writtenDate' && invalidRing)}
          />
          <p className="text-xs text-muted-foreground">원래 채널에서 작성된 날짜입니다. 리뷰 목록이 이 날짜 순으로 정렬됩니다.</p>
        </section>

        <section className="flex flex-col gap-2">
          <Label>별점</Label>
          <div
            role="radiogroup"
            aria-label="별점"
            className={cn('flex w-fit gap-1 rounded-md', invalid === 'rating' && invalidRing)}
          >
            {[1, 2, 3, 4, 5].map((score) => {
              const filled = values.rating !== null && score <= values.rating;
              return (
                <button
                  key={score}
                  type="button"
                  role="radio"
                  aria-checked={values.rating === score}
                  aria-label={`${score}점`}
                  onClick={() => set('rating', score)}
                  className="p-1"
                >
                  <StarIcon
                    className={cn('h-7 w-7', filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40')}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="review-content">리뷰 내용</Label>
          <Textarea
            id="review-content"
            rows={8}
            value={values.content}
            onChange={(event) => set('content', event.target.value)}
            className={cn(invalid === 'content' && invalidRing)}
          />
        </section>

        <section className={cn('flex flex-col gap-2 rounded-md', invalid === 'mediaFileIds' && invalidRing)}>
          <ImageGalleryField
            value={values.mediaFileIds}
            onChange={(next) => set('mediaFileIds', next)}
            contextId={REVIEW_MEDIA_CONTEXT_ID}
            maxImages={ADMIN_REVIEW_MAX_MEDIA}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">사진은 {ADMIN_REVIEW_MAX_MEDIA}장까지, 동영상은 올릴 수 없어요.</p>
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/cs/reviews')} disabled={saving}>
            취소
          </Button>
          {/* 저장 중 비활성 — 연타로 같은 리뷰가 두 건 생기지 않게 */}
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

`ImageGalleryField` 가 자체 `Label` 을 그리면 위 `<p>` 안내문만 남기고 중복 제목은 추가하지 않는다. `Card`·`CardTitle` 의 export 이름이 다르면 `components/ui/card.tsx` 를 보고 맞춘다.

- [ ] **Step 3: Route page**

`apps/admin-web/src/app/(admin)/cs/reviews/new/page.tsx`:

```tsx
import RouteGuard from '@/components/layout/route-guard';
import { AdminReviewCreateForm } from '@/features/cs/review/components/admin-review-create-form';

export default function ReviewCreatePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[960px] flex-col gap-y-2 p-3">
        <AdminReviewCreateForm />
      </div>
    </RouteGuard>
  );
}
```

`new` 는 정적 세그먼트라 형제 `[id]` 보다 먼저 매칭된다.

- [ ] **Step 4: Header button**

`apps/admin-web/src/features/cs/review/template/index.tsx`: `import Link from 'next/link';` 를 추가하고 `<Header title="리뷰 관리" />` 를:

```tsx
      <Header
        title="리뷰 관리"
        right={
          <Button asChild size="sm">
            <Link href="/cs/reviews/new">리뷰 작성</Link>
          </Button>
        }
      />
```

- [ ] **Step 5: Type-check**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/features/cs/review apps/admin-web/src/app/\(admin\)/cs/reviews/new
git commit -m "feat(admin-web): 리뷰 수기 작성 화면 — 마스터 상품 선택·작성자명·작성일·별점·사진

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 9: 목록·상세에 「관리자 수기 작성」 표시

**Files:**
- Modify: `apps/admin-web/src/features/cs/review/template/index.tsx`
- Modify: `apps/admin-web/src/hooks/table/query/use-review-table-query.tsx`
- Modify: `apps/admin-web/src/hooks/table/columns/use-review-table-columns.tsx:41-51`
- Modify: `apps/admin-web/src/features/cs/review/components/review-detail/index.tsx`

**Interfaces:**
- Consumes: `REVIEW_TABS`, `activeReviewTab`, `nextReviewTabParams`, `reviewAuthorityLabel` (Task 6), `ReviewListQuery.sourceSystem` (Task 6)

- [ ] **Step 1: Tabs use the pure functions**

`apps/admin-web/src/features/cs/review/template/index.tsx` 에서 `PROVIDER_TABS` 상수를 지우고 import 를 추가:

```ts
import { REVIEW_TABS, activeReviewTab, nextReviewTabParams } from '../lib/review-tabs';
```

컴포넌트 본문의 `provider`·`selectProvider` 를:

```ts
  const active = activeReviewTab(params);

  const selectTab = (key: string) => {
    const next = nextReviewTabParams(params, key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
```

`<nav>` 안의 map 을:

```tsx
        {REVIEW_TABS.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={active === tab.key ? 'default' : 'outline'}
            aria-pressed={active === tab.key}
            onClick={() => selectTab(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
```

`<nav aria-label="리뷰 작성 권한">` 은 `aria-label="리뷰 구분"` 으로, 안내문을 다음으로 바꾼다:

```tsx
      <p className="px-4 pb-3 text-sm text-muted-foreground">
        작성 권한과 공개 상태는 별도입니다. 권한 미연결에는 기존 이관 리뷰 등이 포함되고, 관리자가 이 화면에서
        직접 적은 리뷰는 「관리자 수기 작성」에 모입니다.
      </p>
```

- [ ] **Step 2: Query hook passes `sourceSystem`**

`apps/admin-web/src/hooks/table/query/use-review-table-query.tsx`: `useQueryParams` 키 배열의 `'source',` 다음에 `'sourceSystem',` 을, 구조분해의 `source,` 다음에 `sourceSystem,` 을, `searchParams` 의 `source: …,` 다음 줄에 `sourceSystem,` 을 추가한다.

- [ ] **Step 3: Table column label**

`apps/admin-web/src/hooks/table/columns/use-review-table-columns.tsx` 의 `permission` 컬럼 cell 을:

```tsx
        cell: ({ row }) => <span>{reviewAuthorityLabel(row.original)}</span>,
```

그리고 import 추가: `import { reviewAuthorityLabel } from '@/features/cs/review/lib/review-provenance';`. `REVIEW_PROVIDER_LABELS` import 가 더 이상 안 쓰이면 지운다.

- [ ] **Step 4: Detail rows**

`apps/admin-web/src/features/cs/review/components/review-detail/index.tsx`:

import 추가: `import { reviewAuthorityLabel } from '../../lib/review-provenance';` — `REVIEW_PROVIDER_LABELS` 가 안 쓰이게 되면 import 에서 뺀다.

`rows` 배열의 `작성 권한` 항목을:

```tsx
    { key: '작성 권한', value: reviewAuthorityLabel(data) },
    {
      key: '입력한 관리자',
      value: data.createdByAdminUserId ? (
        <Suspense fallback={<Skeleton className="w-24 h-4" />}>
          <ReviewAuthorName userId={data.createdByAdminUserId} />
        </Suspense>
      ) : null,
    },
```

(`value` 가 null 이면 기존 렌더가 `-` 로 그린다.)

- [ ] **Step 5: Type-check and admin-web tests**

Run: `cd apps/admin-web && npx tsc --noEmit && cd ../.. && npm run test:admin-web`
Expected: tsc 0, PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/features/cs/review apps/admin-web/src/hooks/table
git commit -m "feat(admin-web): 리뷰 목록·상세에 관리자 수기 작성 라벨·탭·입력자

Claude-Session: https://claude.ai/code/session_01G56LzSXQB5nAEyNFwZwkSL"
```

---

### Task 10: 전체 게이트와 수동 스모크

**Files:** 없음 (검증만). 결과를 PR 본문에 적는다.

- [ ] **Step 1: Root gates**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: type-check 0, jest 실패 0 (`--maxWorkers=2` 는 로컬 OOM 회피). 실패가 있으면 이 브랜치가 만든 것인지 `git stash` 없이 develop 과 비교하지 말고 실패 스펙을 직접 읽어 판단한다 — 기준선은 0 이다.

- [ ] **Step 2: admin-web gates**

Run: `cd apps/admin-web && npx tsc --noEmit && cd ../.. && npm run test:admin-web`
Expected: 0 / PASS.

- [ ] **Step 3: Integration spec once more**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc_admin_manual_it npx jest --runInBand --testPathPattern="admin-create-review.integration"`
Expected: PASS. 끝나면 `psql postgresql://postgres:postgres@localhost:5432/postgres -c "DROP DATABASE ugc_admin_manual_it"`.

- [ ] **Step 4: Manual smoke (로컬 E2E — 브라우저 로그인은 사람이 한다)**

로컬 `ugc` DB 에 마이그레이션을 적용한 뒤(`npm run db:setup -- --stage dev --deployment lcnine-services` 또는 로컬 절차) `npm run start:all:local` → admin 계정으로 admin-web 로그인(사람). 확인 항목:

1. 리뷰 관리 헤더의 [리뷰 작성] → `/cs/reviews/new`.
2. 상품 검색 → 선택 → 「다른 상품 선택」으로 되돌리기가 된다.
3. 비워 두고 저장 → 상품 칸이 빨갛게 표시되고 「상품을 선택해 주세요.」.
4. 작성자명 `홍길동`, 작성일 지난달 날짜, 별점 4, 본문, 사진 2장 → 저장 → 상세로 이동.
5. **저장 버튼을 빠르게 두 번 누른다** → 리뷰가 한 건만 생긴다(목록에서 확인).
6. 상세: 작성 권한 「관리자 수기 작성」, 입력한 관리자 = 내 계정 이름, 작성일 = 고른 날짜.
7. 목록 「관리자 수기 작성」 탭 → 방금 쓴 리뷰만. 「관리자 권한 리뷰」 탭 → 수기 탭 순서로 눌러도 0건이 되지 않는다.
8. 스토어프론트 그 상품 리뷰 → 작성자 `홍**`, 작성일 = 고른 날짜, 사진 2장, 평점 요약 반영.
9. 관리자 삭제 → 스토어프론트에서 사라지고 평점 요약이 되돌아간다.

- [ ] **Step 5: Report**

게이트 출력과 스모크 1~9 결과(통과/실패와 스크린샷 여부)를 정리한다. 배포 절차는 스펙 §8: **ugc `db:migrate` → `sst deploy`**, 배포 전 `npm ci && npm ci --prefix apps/admin-web`.
