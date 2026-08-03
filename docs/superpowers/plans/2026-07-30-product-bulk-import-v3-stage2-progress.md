# 대량등록 v3 — 2단계: 진행률 API + admin-web 폴링 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세션 진행 조회를 "행 전체를 2초마다"에서 "단계별 집계를 2초마다"로 바꾼다 — 세션 크기와 무관한 고정 비용 엔드포인트 `GET /product-imports/:id/progress` 를 만들고 admin-web 폴링을 그쪽으로 옮긴다.

**Architecture:** core 는 세션 1행 + `product_import_items` 의 `(status, publish_status)` 조합별 `GROUP BY` 2개 쿼리만 돌리고, 순수 빌더가 그것을 화면 단계(`commit`·`publish`)별 `done/total/failed` 로 환산한다. 카운터 컬럼을 읽지 않고 **매번 집계**하므로 워커가 중단돼도 드리프트가 없다. admin-web 은 `useImportProgress` 로 폴링하고, 행 목록(`GET /product-imports/:id`)은 사용자가 펼칠 때만 조회한다.

**Tech Stack:** NestJS 11 + Drizzle ORM(postgres.js), Next.js(admin-web) + TanStack Query v5, Jest(ts-jest).

## Global Constraints

- **마이그레이션 없음.** 이 단계는 기존 컬럼만 읽는다. 스키마 변경은 v3 1단계(완료, `739949ad8`)와 4단계(미착수)에만 있다.
- **배포 결합:** core → admin-web 같은 `sst deploy`. 롤링 창에서 새 admin-web 이 옛 core 태스크를 만나 `/progress` 가 404 날 수 있으므로 **모든 화면 경로는 progress 없이도 렌더돼야 한다**(세션 카운터 폴백).
- **레이어 규칙(CLAUDE.md):** Controller → Service → Reader/Builder → DB. Service 는 2-3줄 위임만. Reader 는 `trx.select().from().where()` 만 쓰고 `db.query.*`·`with` 관계·`any`/`as` 캐스팅 금지. DB 주입은 `@InjectDb()` + `DbService<PimSchema>`.
- **도메인 예외:** `@app/shared` 의 `NotFoundError` 등. `HttpException` 을 서비스/리더에서 던지지 않는다.
- **`@ApiProperty({ type: 'object' })` 금지** — 중첩 DTO 는 별도 클래스로 정의한다.
- **주석·사용자 문구는 한국어.** 기존 파일의 밀도(왜 그렇게 했는지를 적는 주석)를 따른다.
- **검증 스코프:** 레포 전역 jest/tsc/eslint 는 상시 debt 이므로 권위가 아니다. 이 계획의 게이트는 아래 4개다.
  - `npx jest apps/core/src/modules/catalog/operations/import` → 기준선 **133 passed, 19 skipped**(lease 통합 스펙이 `DATABASE_URL` 없이 스킵)
  - `npx jest apps/admin-web/src/lib/services/products apps/admin-web/src/features/mall/product-imports` → 기준선 **18 passed**
  - `npm run type-check:scoped` → 기준선 **exit 0** (`tsconfig.spec-scope.json` 이 import 폴더 전체를 이미 포함하므로 새 파일은 자동 포함)
  - `cd apps/admin-web && npx tsc --noEmit` → 기준선 **exit 0**
- **워크트리 준비:** 브랜치 `feat/product-bulk-import-v3-progress` (base `739949ad8`). 루트 `npm install` 과 `apps/admin-web` 의 `npm install` 이 **둘 다** 끝나 있어야 한다 — admin-web 의 `queries.spec.ts` 가 `@tanstack/react-query` 를 실제로 require 한다.

## 참조 스펙

`docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` §2.9(폴링 비용), §2.10(`failedCount` 오염), §3.5(진행률 설계), §6(단계 분할).

---

## File Structure

### core (`apps/core/src/modules/catalog/operations/import/`)

| 파일 | 책임 |
|---|---|
| `dto/import-progress.dto.ts` (신규) | `ImportProgressDto`·`ImportProgressStageDto` — swagger 노출 응답 계약 |
| `dto/index.ts` (수정) | 배럴에 신규 DTO 추가 |
| `services/product-import-progress.builder.ts` (신규) | **순수 함수.** 세션 행 + 조합별 카운트 → 단계별 진행률. DB 접근 없음 |
| `services/product-import-progress.builder.spec.ts` (신규) | 분모·분자 규칙 단위 테스트 |
| `services/product-import-session.reader.ts` (수정) | `getProgressCounts()` — 세션 1행 + `GROUP BY` 1회 |
| `services/product-import-session.reader.spec.ts` (수정) | 세션 부재 시 `NotFoundError` + 목 하네스에 `groupBy` 추가 |
| `services/product-import.service.ts` (수정) | `getProgress()` 위임 + 빌더 주입 |
| `services/product-import.service.spec.ts` (수정) | 리더→빌더 합성 테스트 + `makeService()` 생성자 인자 갱신 |
| `product-import.controller.ts` (수정) | `GET :sessionId/progress` |
| `product-import.module.ts` (수정) | 빌더 provider 등록 |
| `services/product-import-progress.integration.spec.ts` (신규) | 실 Postgres 에 대고 `GROUP BY` SQL 검증 |

### admin-web (`apps/admin-web/src/`)

| 파일 | 책임 |
|---|---|
| `lib/types/dto/product-import.ts` (수정) | `ImportProgressDto` 미러 타입 |
| `lib/api/domains/products/product-import.client.ts` (수정) | `getProgress()` |
| `lib/services/products/query-keys.ts` (수정) | `productImportProgress(sessionId)` |
| `lib/services/products/query-keys.spec.ts` (수정) | 키 형태 단언 |
| `lib/services/products/import-progress.ts` (신규) | **순수 헬퍼** — `isProgressRunning`·`isImportRunning`·`stagePercent`·`visibleStages`·`importCounts` |
| `lib/services/products/import-progress.spec.ts` (신규) | 위 헬퍼 단위 테스트 |
| `lib/services/products/index.ts` (수정) | 배럴에 `import-progress` 추가 |
| `lib/services/products/queries.ts` (수정) | `useImportProgress` 신설, `useImportSession` 에서 폴링 제거 |
| `features/mall/product-imports/session-detail/progress-panel.tsx` (신규) | 단계 바 렌더 |
| `features/mall/product-imports/session-detail/index.tsx` (수정) | progress 주도로 재배선 + 행 목록 접기 |

**왜 순수 헬퍼를 별도 파일로 빼는가.** 루트 jest 의 `testRegex` 는 `.spec.ts$` 라 `.tsx` 컴포넌트는 아예 수집되지 않는다. 로직을 `.ts` 로 빼야 테스트가 가능하다. 그리고 그 파일은 **런타임 `@/` import 를 가지면 안 된다** — 루트 tsconfig 에 `@/*` 별칭이 없어 jest 가 해석하지 못한다. 타입 전용 import 는 `isolatedModules: true` 로 지워지므로 안전하다(선례: `wizard/can-commit.ts`).

---

## Task 1: 진행률 빌더(순수) + 응답 DTO

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/dto/import-progress.dto.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/dto/index.ts`

**Interfaces:**
- Consumes: `productImportSessions`·`productImportItems` (from `apps/core/src/modules/catalog/schema/catalog.schema.ts`) — 타입만.
- Produces:
  - `type ImportProgressStageKey = 'commit' | 'publish'`
  - `class ImportProgressStageDto { key; label; status; done; total; failed; error }`
  - `class ImportProgressDto { sessionId; fileName; canceled; cancelRequestedAt; totalRows; invalidCount; stages }`
  - `type ProgressSessionRow` — `Pick<SessionRow, 'id'|'fileName'|'totalRows'|'invalidCount'|'commitStatus'|'publishStatus'|'commitError'|'publishError'|'cancelRequestedAt'>`
  - `interface ImportItemStatusCount { status; publishStatus; count }`
  - `class ProductImportProgressBuilder { build(session: ProgressSessionRow, itemCounts: ImportItemStatusCount[]): ImportProgressDto }`

### 배경 — 왜 분모에 뺄셈이 들어가는가

`product_import_items.status` 는 **접수 시점 검증실패**와 **워커의 생성 실패**를 둘 다 `'failed'` 로 적는다(`product-import.manager.ts:63`, `product-import-job.manager.ts:361` 부근). `publish_status='skipped'` 까지 같아서 상태만으로는 갈리지 않는다. v3 1단계가 세션에 얼려 둔 `invalid_count` 를 빼야 "생성 대상 행 수"와 "생성 실패 수"가 나온다.

| 단계 | total | done | failed |
|---|---|---|---|
| commit | `totalRows - invalidCount` | `created + (failedRows - invalidCount)` | `failedRows - invalidCount` |
| publish | `status='created'` 행 수 | `publish_status ∈ {published, failed}` | `publish_status='failed'` |

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.spec.ts`:

```ts
import {
  ProductImportProgressBuilder,
  type ImportItemStatusCount,
  type ProgressSessionRow,
} from './product-import-progress.builder';
import type { ImportProgressDto } from '../dto/import-progress.dto';

const session = (over: Partial<ProgressSessionRow> = {}): ProgressSessionRow => ({
  id: 'sess-1',
  fileName: 'f.xlsx',
  totalRows: 10,
  invalidCount: 2,
  commitStatus: 'running',
  publishStatus: 'idle',
  commitError: null,
  publishError: null,
  cancelRequestedAt: null,
  ...over,
});

const c = (
  status: ImportItemStatusCount['status'],
  publishStatus: ImportItemStatusCount['publishStatus'],
  count: number,
): ImportItemStatusCount => ({ status, publishStatus, count });

const stageOf = (dto: ImportProgressDto, key: string) => dto.stages.find((s) => s.key === key)!;

describe('ProductImportProgressBuilder', () => {
  const builder = new ProductImportProgressBuilder();

  it('commit 분모에서 접수 시점 검증실패 행을 뺀다', () => {
    // 10행 중 2행이 접수 시점 검증실패. 남은 8행 중 3행이 생성됐고 5행이 대기 중.
    const dto = builder.build(session(), [
      c('failed', 'skipped', 2),
      c('created', 'pending', 3),
      c('pending', 'pending', 5),
    ]);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 8, done: 3, failed: 0 });
  });

  it('생성 실패는 검증실패를 뺀 나머지다 — 두 종류가 한 칸에 섞이지 않는다', () => {
    // failed 4행 = 검증실패 2 + 생성실패 2
    const dto = builder.build(session(), [c('failed', 'skipped', 4), c('created', 'pending', 6)]);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 8, done: 8, failed: 2 });
  });

  it('invalidCount 가 null 인 옛 세션은 검증실패를 가르지 않고 현행 표시로 폴백한다', () => {
    const dto = builder.build(session({ invalidCount: null }), [
      c('failed', 'skipped', 4),
      c('created', 'published', 6),
    ]);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 10, done: 10, failed: 4 });
    expect(dto.invalidCount).toBeNull();
  });

  it('publish 분모는 생성된 행 수이고 skipped 행은 들어가지 않는다', () => {
    const dto = builder.build(session({ commitStatus: 'completed', publishStatus: 'running' }), [
      c('failed', 'skipped', 2),
      c('created', 'published', 3),
      c('created', 'failed', 1),
      c('created', 'pending', 4),
    ]);

    // 생성 8행이 분모. published 3 + failed 1 = 4 처리됨.
    expect(stageOf(dto, 'publish')).toMatchObject({ total: 8, done: 4, failed: 1 });
  });

  it('레인 상태와 오류를 단계에 그대로 싣는다', () => {
    const dto = builder.build(
      session({
        commitStatus: 'failed',
        commitError: '10회 연속 실패',
        publishStatus: 'canceled',
        publishError: null,
      }),
      [],
    );

    expect(stageOf(dto, 'commit')).toMatchObject({ status: 'failed', error: '10회 연속 실패' });
    expect(stageOf(dto, 'publish')).toMatchObject({ status: 'canceled', error: null });
  });

  it('취소 요청이 있으면 canceled 가 true 다', () => {
    const at = new Date('2026-07-30T00:00:00.000Z');
    const dto = builder.build(session({ cancelRequestedAt: at }), []);

    expect(dto.canceled).toBe(true);
    expect(dto.cancelRequestedAt).toBe(at);
  });

  it('행이 하나도 없으면 분모가 0 이다', () => {
    const dto = builder.build(session({ totalRows: 0, invalidCount: 0 }), []);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 0, done: 0, failed: 0 });
    expect(stageOf(dto, 'publish')).toMatchObject({ total: 0, done: 0, failed: 0 });
  });

  it('failed 행이 invalidCount 보다 적어도 음수로 새지 않는다', () => {
    const dto = builder.build(session({ invalidCount: 5 }), [
      c('failed', 'skipped', 1),
      c('created', 'pending', 4),
    ]);

    expect(stageOf(dto, 'commit').failed).toBe(0);
  });

  it('세션 식별 정보를 그대로 통과시킨다', () => {
    const dto = builder.build(session(), []);

    expect(dto).toMatchObject({ sessionId: 'sess-1', fileName: 'f.xlsx', totalRows: 10, invalidCount: 2 });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.spec.ts
```

Expected: FAIL — `Cannot find module './product-import-progress.builder'`

- [ ] **Step 3: DTO 를 만든다**

`apps/core/src/modules/catalog/operations/import/dto/import-progress.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

/**
 * 화면 단계 키. 워커 **레인**과 1:1 이 아니다 — 레인은 claim·lease·굶주림의 단위고
 * 단계는 사람이 이해하는 단위다. v3 4단계에서 이미지 레인 하나가 'probe'·'fetch'
 * 두 단계로 갈라져 여기 붙는다(스펙 §3.5). 그래서 화면은 이 배열을 순회해 그리고,
 * 단계 개수를 코드에 박지 않는다.
 */
export type ImportProgressStageKey = 'commit' | 'publish';

export class ImportProgressStageDto {
  @ApiProperty({ enum: ['commit', 'publish'] })
  key: ImportProgressStageKey;

  @ApiProperty({ description: '관리자 화면에 그대로 노출되는 단계 이름' })
  label: string;

  @ApiProperty({ enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'] })
  status: string;

  @ApiProperty({ description: '처리가 끝난 행 수(성공 + 실패)' })
  done: number;

  @ApiProperty({ description: '이 단계의 분모. 0 이면 화면이 단계를 접는다.' })
  total: number;

  @ApiProperty({ description: 'done 에 포함돼 있는 실패 행 수' })
  failed: number;

  @ApiProperty({ required: false, nullable: true, description: '해당 레인의 잡 오류 메시지' })
  error: string | null;
}

export class ImportProgressDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '행 목록을 안 불러도 화면 상단을 그릴 수 있게 함께 싣는다.',
  })
  fileName: string | null;

  @ApiProperty({ description: '취소된 세션이면 true. 남은 단계는 더 나아가지 않는다.' })
  canceled: boolean;

  @ApiProperty({ required: false, nullable: true })
  cancelRequestedAt: Date | null;

  @ApiProperty({ description: '워크북 전체 행 수(접수 시점 검증실패 포함)' })
  totalRows: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '접수 시점 검증실패 행 수. v3 1단계 이전 세션은 null 이다.',
  })
  invalidCount: number | null;

  @ApiProperty({ type: [ImportProgressStageDto] })
  stages: ImportProgressStageDto[];
}
```

- [ ] **Step 4: 빌더를 만든다**

`apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { productImportSessions, productImportItems } from '../../../schema/catalog.schema';
import { ImportProgressDto, ImportProgressStageDto } from '../dto/import-progress.dto';

type SessionRow = typeof productImportSessions.$inferSelect;
type ItemRow = typeof productImportItems.$inferSelect;

/** 진행률 계산이 실제로 읽는 세션 열만. 전체 행도 구조적으로 대입 가능하다. */
export type ProgressSessionRow = Pick<
  SessionRow,
  | 'id'
  | 'fileName'
  | 'totalRows'
  | 'invalidCount'
  | 'commitStatus'
  | 'publishStatus'
  | 'commitError'
  | 'publishError'
  | 'cancelRequestedAt'
>;

/** `(status, publish_status)` 조합별 행 수. 조합은 3×4 로 상한이 12행이다. */
export interface ImportItemStatusCount {
  status: ItemRow['status'];
  publishStatus: ItemRow['publishStatus'];
  count: number;
}

/**
 * 세션 집계 → 화면 단계별 진행률. DB 접근이 없는 순수 변환이라 단위테스트가 쉽다
 * (ProductImportPricingBuilder 와 같은 자리).
 *
 * **카운터 컬럼(createdCount·publishedCount)을 읽지 않는다.** 그것들은 워커가 +1 로
 * 올리는 값이라 슬라이스가 중단되면 실제와 어긋난다. 매번 집계하면 드리프트가 없다.
 */
@Injectable()
export class ProductImportProgressBuilder {
  build(session: ProgressSessionRow, itemCounts: ImportItemStatusCount[]): ImportProgressDto {
    const sum = (predicate: (row: ImportItemStatusCount) => boolean): number =>
      itemCounts.reduce((acc, row) => (predicate(row) ? acc + row.count : acc), 0);

    const createdRows = sum((row) => row.status === 'created');
    const failedRows = sum((row) => row.status === 'failed');

    // invalid_count 는 v3 1단계에서 생긴 컬럼이라 그 이전 세션은 null 이다. 0 으로 두면
    // failedRows 가 통째로 '생성 실패' 로 보이는데, 그게 바로 화면의 현행 폴백 표시
    // (검증실패/생성실패를 가르지 않고 failedCount 만 보여주는 것)와 같은 결과다.
    // 옛 세션은 이미 동기 경로로 끝나 있어 진행률을 볼 일도 거의 없다.
    const invalidCount = session.invalidCount ?? 0;

    // 뺄셈이 음수가 될 수는 없다 — failedRows 는 접수 시점에 invalidCount 로 시작해
    // failItem 이 더하기만 한다. 그래도 clamp 하는 이유는, 손으로 고친 행 하나가
    // 진행률 바를 음수로 만들어 화면 전체를 깨뜨리는 것보다 0 으로 보이는 편이 낫기 때문이다.
    const commitFailed = Math.max(0, failedRows - invalidCount);
    const commitTotal = Math.max(0, session.totalRows - invalidCount);

    const publishFailed = sum((row) => row.status === 'created' && row.publishStatus === 'failed');
    const publishPublished = sum((row) => row.status === 'created' && row.publishStatus === 'published');

    const stages: ImportProgressStageDto[] = [
      {
        key: 'commit',
        label: '상품 생성',
        status: session.commitStatus,
        done: createdRows + commitFailed,
        total: commitTotal,
        failed: commitFailed,
        error: session.commitError,
      },
      {
        key: 'publish',
        label: '게시',
        status: session.publishStatus,
        // 게시 대상은 생성에 성공한 행뿐이다. 검증실패·생성실패 행은 publish_status 가
        // 'skipped' 라 분모에 들어가면 영영 100% 가 되지 않는다.
        done: publishPublished + publishFailed,
        total: createdRows,
        failed: publishFailed,
        error: session.publishError,
      },
    ];

    return {
      sessionId: session.id,
      fileName: session.fileName,
      canceled: Boolean(session.cancelRequestedAt),
      cancelRequestedAt: session.cancelRequestedAt,
      totalRows: session.totalRows,
      invalidCount: session.invalidCount,
      stages,
    };
  }
}
```

- [ ] **Step 5: 배럴에 DTO 를 추가한다**

`apps/core/src/modules/catalog/operations/import/dto/index.ts` 를 아래로 바꾼다:

```ts
export * from './import.types';
export * from './import-response.dto';
export * from './import-progress.dto';
```

- [ ] **Step 6: 테스트 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.spec.ts
```

Expected: PASS (9 tests)

- [ ] **Step 7: 타입 게이트**

```bash
npm run type-check:scoped
```

Expected: exit 0, 출력 없음

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/dto/import-progress.dto.ts \
        apps/core/src/modules/catalog/operations/import/dto/index.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.spec.ts
git commit -m "feat(product-import): 진행률 단계 집계 빌더와 응답 DTO"
```

---

## Task 2: `/progress` 엔드포인트 (리더 → 서비스 → 컨트롤러)

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.controller.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.module.ts`

**Interfaces:**
- Consumes: Task 1 의 `ProductImportProgressBuilder`, `ImportProgressDto`, `ImportItemStatusCount`.
- Produces:
  - `ProductImportSessionReader.getProgressCounts(sessionId: string, tx?: DbTransaction): Promise<{ session: SessionRow; itemCounts: ImportItemStatusCount[] }>`
  - `ProductImportService.getProgress(sessionId: string): Promise<ImportProgressDto>`
  - `GET /product-imports/:sessionId/progress` → `ImportProgressDto`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (리더)**

`product-import-session.reader.spec.ts` 의 목 하네스에 `groupBy` 를 더하고 테스트를 추가한다.

먼저 `makeDb` 의 체인에 한 줄 추가(기존 5-15행):

```ts
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    groupBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    then: (resolve: (v: any) => void) => resolve(rows),
  };
```

파일 끝에 추가:

```ts
describe('ProductImportSessionReader.getProgressCounts', () => {
  it('세션이 없으면 NotFoundError — 집계 쿼리까지 가지 않는다', async () => {
    const optionReadLoader = { getVariantOptionValues: jest.fn() } as any;
    const reader = new ProductImportSessionReader(makeDb([]), optionReadLoader);
    await expect(reader.getProgressCounts('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 (서비스)**

`product-import.service.spec.ts` 를 세 군데 고친다.

(1) import 에 빌더를 더한다:

```ts
import { ProductImportProgressBuilder } from './product-import-progress.builder';
```

(2) `makeService()` 의 reader 목에 `getProgressCounts` 를 더하고 빌더를 생성자에 넘긴다:

```ts
function makeService() {
  const reader = {
    loadCategoryTree: jest.fn(async () => []),
    getSession: jest.fn(),
    getProgressCounts: jest.fn(),
  } as any;
  const manager = {
    acceptCommit: jest.fn(async () => ({
      sessionId: 's1',
      status: 'queued' as const,
      totalRows: 1,
      queuedCount: 1,
      invalidCount: 0,
    })),
  } as any;
  const variantCodeChecker = { check: jest.fn(async () => undefined) } as any;
  const service = new ProductImportService(
    new ProductImportParser(),
    new ProductImportNormalizer(),
    new ProductImportValidator(),
    reader,
    manager,
    variantCodeChecker,
    // 순수 변환이라 목이 아니라 진짜를 넣는다 — 합성이 실제로 맞물리는지까지 본다.
    new ProductImportProgressBuilder(),
  );
  return { service, reader, manager, variantCodeChecker };
}
```

(3) 파일 끝에 테스트를 더한다:

```ts
describe('ProductImportService.getProgress', () => {
  it('세션 집계를 단계별 진행률로 돌려준다 — 행 목록은 싣지 않는다', async () => {
    const { service, reader } = makeService();
    reader.getProgressCounts.mockResolvedValue({
      session: {
        id: 'sess-1',
        fileName: 'f.xlsx',
        totalRows: 5,
        invalidCount: 1,
        commitStatus: 'completed',
        publishStatus: 'running',
        commitError: null,
        publishError: null,
        cancelRequestedAt: null,
      },
      itemCounts: [
        { status: 'failed', publishStatus: 'skipped', count: 1 },
        { status: 'created', publishStatus: 'published', count: 3 },
        { status: 'created', publishStatus: 'pending', count: 1 },
      ],
    });

    const progress = await service.getProgress('sess-1');

    expect(reader.getProgressCounts).toHaveBeenCalledWith('sess-1');
    expect(progress).toMatchObject({ sessionId: 'sess-1', fileName: 'f.xlsx', canceled: false, invalidCount: 1 });
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 4, done: 4, failed: 0 });
    expect(progress.stages.find((s) => s.key === 'publish')).toMatchObject({ total: 4, done: 3, failed: 0 });
    expect(progress).not.toHaveProperty('items');
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.spec.ts \
         apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts
```

Expected: FAIL — `reader.getProgressCounts is not a function`, `Expected 7 arguments, but got 7`(런타임에는 `service.getProgress is not a function`)

- [ ] **Step 4: 리더에 집계 메서드를 더한다**

`product-import-session.reader.ts` 의 import 에 빌더 타입을 더한다:

```ts
import type { ImportItemStatusCount } from './product-import-progress.builder';
```

`getSession()` 바로 아래(89행 뒤)에 추가한다:

```ts
  /**
   * 진행률 집계에 필요한 것만 읽는다 — 세션 1행 + 아이템 `(status, publish_status)`
   * 조합별 행 수. 조합은 3×4 로 상한이 12행이라 **세션 크기와 무관한 고정 비용**이다.
   *
   * getSession() 을 2초마다 부르던 폴링을 이쪽으로 옮기는 것이 v3 2단계다 — 1,000행
   * 세션이면 2초마다 1,000행이 오갔다(스펙 §2.9).
   */
  async getProgressCounts(
    sessionId: string,
    tx?: DbTransaction,
  ): Promise<{ session: SessionRow; itemCounts: ImportItemStatusCount[] }> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);

      const grouped = await trx
        .select({
          status: productImportItems.status,
          publishStatus: productImportItems.publishStatus,
          value: count(),
        })
        .from(productImportItems)
        .where(eq(productImportItems.sessionId, sessionId))
        .groupBy(productImportItems.status, productImportItems.publishStatus);

      return {
        session,
        itemCounts: grouped.map((row) => ({
          status: row.status,
          publishStatus: row.publishStatus,
          // count() 는 드라이버에 따라 bigint 문자열로 올라온다 — getSessions 도 같은 이유로 Number() 를 씌운다.
          count: Number(row.value),
        })),
      };
    }, tx);
  }
```

`count` 는 이미 `drizzle-orm` 에서 import 돼 있다(4행). 추가 import 불필요.

- [ ] **Step 5: 서비스에 위임을 더한다**

`product-import.service.ts`:

(1) import 두 줄 추가:

```ts
import { ProductImportProgressBuilder } from './product-import-progress.builder';
```

그리고 DTO import 목록(10-18행)에 `ImportProgressDto` 를 더한다:

```ts
import {
  ValidatePreviewDto,
  ValidatePreviewRowDto,
  CommitAcceptedDto,
  SessionSummaryDto,
  SessionDetailDto,
  PublishAcceptedDto,
  CancelAcceptedDto,
} from '../dto/import-response.dto';
import { ImportProgressDto } from '../dto/import-progress.dto';
```

(2) 생성자 마지막에 빌더를 더한다:

```ts
  constructor(
    private readonly parser: ProductImportParser,
    private readonly normalizer: ProductImportNormalizer,
    private readonly validator: ProductImportValidator,
    private readonly reader: ProductImportSessionReader,
    private readonly manager: ProductImportManager,
    private readonly variantCodeChecker: ProductImportVariantCodeChecker,
    private readonly progressBuilder: ProductImportProgressBuilder,
  ) {}
```

(3) `getSession()` 아래에 메서드를 더한다:

```ts
  /**
   * 단계별 집계만 돌려준다 — 행 목록이 없어 응답 크기가 세션 크기와 무관하다.
   * admin-web 의 폴링 대상은 getSession 이 아니라 이쪽이다.
   */
  async getProgress(sessionId: string): Promise<ImportProgressDto> {
    const { session, itemCounts } = await this.reader.getProgressCounts(sessionId);
    return this.progressBuilder.build(session, itemCounts);
  }
```

- [ ] **Step 6: 컨트롤러에 라우트를 더한다**

`product-import.controller.ts` 의 DTO import(18행)에 `ImportProgressDto` 를 더한다:

```ts
import {
  ValidatePreviewDto,
  CommitAcceptedDto,
  SessionDetailDto,
  PublishAcceptedDto,
  CancelAcceptedDto,
  ImportProgressDto,
} from './dto';
```

그리고 **`@Get(':sessionId')` 핸들러 바로 위에** 추가한다:

```ts
  // `:sessionId` 보다 먼저 선언한다. 두 세그먼트 경로라 실제로는 겹치지 않지만,
  // 파라미터 라우트 뒤에 구체 경로를 두는 습관은 wildcard 가 하나만 끼어들어도 깨진다.
  @Get(':sessionId/progress')
  @ApiOperation({
    summary: '세션 진행률(단계별 집계). 행 목록이 없어 응답이 세션 크기와 무관하다 — 폴링은 이쪽으로 한다.',
  })
  @ApiResponse({ status: 200, type: ImportProgressDto })
  async getProgress(@Param('sessionId') sessionId: string): Promise<ImportProgressDto> {
    return this.service.getProgress(sessionId);
  }
```

- [ ] **Step 7: 모듈에 빌더를 등록한다**

`product-import.module.ts` 에 import 한 줄과 provider 한 줄을 더한다:

```ts
import { ProductImportProgressBuilder } from './services/product-import-progress.builder';
```

providers 배열의 `ProductImportPricingBuilder` 다음 줄에:

```ts
    ProductImportProgressBuilder,
```

- [ ] **Step 8: 테스트 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/import
```

Expected: PASS — **144 passed, 19 skipped** (기준선 133 + Task 1 빌더 9 + 리더 1 + 서비스 1). 판정 기준은 **실패 0** 이다.

- [ ] **Step 9: 타입 게이트**

```bash
npm run type-check:scoped
```

Expected: exit 0

- [ ] **Step 10: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(product-import): GET /product-imports/:id/progress — 단계별 집계 엔드포인트"
```

---

## Task 3: 실 Postgres 통합 테스트 (GROUP BY SQL 검증)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-progress.integration.spec.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: Task 2 의 `ProductImportSessionReader.getProgressCounts`, Task 1 의 `ProductImportProgressBuilder`.
- Produces: `npm run test:product-import-progress:integration`

### 왜 필요한가

목 하네스는 `.groupBy()` 를 호출해도 `then` 이 같은 배열을 돌려준다 — **GROUP BY 가 SQL 에 실리지 않아도 초록**이다. 그리고 `count()` 가 드라이버에서 문자열로 올라오면 `+` 가 문자열 연결이 되어 진행률이 `"03"` 같은 값이 된다. 둘 다 목으로는 절대 보이지 않는다. lease 통합 스펙이 같은 이유로 존재한다(그 파일 22-38행 주석 참조).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/catalog/operations/import/services/product-import-progress.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { catalogSchema, type PimSchema } from '../../../schema/catalog.schema';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportProgressBuilder } from './product-import-progress.builder';
import type { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';

/**
 * 진행률 집계를 **진짜 Postgres** 에 대고 구동한다.
 *
 * 목 하네스는 `.groupBy()` 를 삼켜도 같은 배열을 돌려주므로 GROUP BY 가 SQL 에
 * 실리지 않아도 초록이고, `count()` 가 bigint 문자열로 올라오는 것도 보이지 않는다.
 * 여기서는 실제 SQL 이 실제 행에 어떻게 작용하는지만 본다.
 *
 * **격리**: 일회용 스키마를 만들고 커넥션의 search_path 를 거기로 돌린다
 * (선례: product-import-job-lease.integration.spec.ts:31-38).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_PRODUCT_IMPORT_PROGRESS_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the product import progress integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('product import 진행률 집계 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `pi_progress_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let reader: ProductImportSessionReader;
  const builder = new ProductImportProgressBuilder();

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    // public 의 실제 DDL 을 복제한다 — 손으로 옮겨 적은 테이블에 대고 통과하는
    // 테스트는 아무 것도 증명하지 못한다.
    await admin.unsafe(`CREATE TABLE product_import_sessions (LIKE public.product_import_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_items (LIKE public.product_import_items INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    const db = drizzle(client, { schema: catalogSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as never)),
    } as unknown as DbService<PimSchema>;
    // 진행률 경로는 옵션 조합을 읽지 않는다 — OptionReadLoader 는 한 번도 호출되지 않는다.
    reader = new ProductImportSessionReader(dbService, undefined as unknown as OptionReadLoader);
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([client?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM product_import_sessions`;
  });

  async function seedSession(totalRows: number, invalidCount: number | null): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO product_import_sessions
             (id, file_name, total_rows, invalid_count, status, commit_status, publish_status)
      VALUES (${id}, ${'it-progress-' + id}, ${totalRows}, ${invalidCount},
              'completed', 'completed', 'running')
    `;
    return id;
  }

  /**
   * enum 값을 **SQL 리터럴**로 적는다. 일회용 스키마의 search_path 에 public 이 없어
   * `::product_import_item_status` 캐스트는 해석되지 않고, 리터럴로 두면 Postgres 가
   * 컬럼 타입으로 알아서 강제한다. 값이 전부 이 스펙이 만든 상수라 unsafe 로 충분하다.
   */
  async function seedItems(
    sessionId: string,
    rows: Array<{ status: string; publishStatus: string; count: number }>,
  ): Promise<void> {
    const values: string[] = [];
    let rowNumber = 1;
    for (const row of rows) {
      for (let i = 0; i < row.count; i += 1) {
        values.push(
          `('${randomUUID()}', '${sessionId}', ${rowNumber}, 'P${rowNumber}', '${row.status}', '${row.publishStatus}')`,
        );
        rowNumber += 1;
      }
    }
    if (values.length === 0) return;
    await admin.unsafe(
      `INSERT INTO product_import_items (id, session_id, row_number, product_key, status, publish_status)
       VALUES ${values.join(', ')}`,
    );
  }

  it('조합별 집계가 실제 행 분포와 일치하고, count 가 숫자로 돌아온다', async () => {
    const sessionId = await seedSession(10, 2);
    await seedItems(sessionId, [
      { status: 'failed', publishStatus: 'skipped', count: 2 }, // 접수 시점 검증실패
      { status: 'failed', publishStatus: 'skipped', count: 1 }, // 생성 실패
      { status: 'created', publishStatus: 'published', count: 4 },
      { status: 'created', publishStatus: 'failed', count: 1 },
      { status: 'created', publishStatus: 'pending', count: 2 },
    ]);

    const { session, itemCounts } = await reader.getProgressCounts(sessionId);

    // GROUP BY 가 SQL 에 실리지 않았다면 행 10개가 그대로 올라온다.
    expect(itemCounts).toHaveLength(4);
    for (const row of itemCounts) {
      expect(typeof row.count).toBe('number');
    }

    const progress = builder.build(session, itemCounts);
    // 검증실패 2 는 commit 분모에서 빠지고, 남은 failed 1 이 생성 실패다.
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 8, done: 8, failed: 1 });
    // 게시 분모는 생성 7행. published 4 + failed 1 = 5 처리됨.
    expect(progress.stages.find((s) => s.key === 'publish')).toMatchObject({ total: 7, done: 5, failed: 1 });
  });

  it('다른 세션의 행을 섞어 세지 않는다', async () => {
    const mine = await seedSession(2, 0);
    const theirs = await seedSession(3, 0);
    await seedItems(mine, [{ status: 'created', publishStatus: 'pending', count: 2 }]);
    await seedItems(theirs, [{ status: 'failed', publishStatus: 'skipped', count: 3 }]);

    const { session, itemCounts } = await reader.getProgressCounts(mine);
    const progress = builder.build(session, itemCounts);

    expect(itemCounts).toEqual([{ status: 'created', publishStatus: 'pending', count: 2 }]);
    // 남의 세션 실패 3행이 섞였다면 total 이 5, failed 가 3 이 된다.
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 2, done: 2, failed: 0 });
  });

  it('행이 하나도 없어도 죽지 않고 분모 0 을 돌려준다', async () => {
    const sessionId = await seedSession(0, 0);

    const { session, itemCounts } = await reader.getProgressCounts(sessionId);
    const progress = builder.build(session, itemCounts);

    expect(itemCounts).toEqual([]);
    expect(progress.stages.every((s) => s.total === 0 && s.done === 0)).toBe(true);
  });

  it('invalid_count 가 null 인 옛 세션도 그대로 읽힌다', async () => {
    const sessionId = await seedSession(3, null);
    await seedItems(sessionId, [
      { status: 'failed', publishStatus: 'skipped', count: 1 },
      { status: 'created', publishStatus: 'published', count: 2 },
    ]);

    const { session, itemCounts } = await reader.getProgressCounts(sessionId);
    const progress = builder.build(session, itemCounts);

    expect(progress.invalidCount).toBeNull();
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 3, done: 3, failed: 1 });
  });

  it('없는 세션은 NotFoundError', async () => {
    await expect(reader.getProgressCounts(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: npm 스크립트를 더한다**

`package.json` 의 `"test:product-import-lease:integration"` 줄(70행) **바로 아래**에 추가한다:

```json
    "test:product-import-progress:integration": "REQUIRE_PRODUCT_IMPORT_PROGRESS_DB=1 jest --runInBand apps/core/src/modules/catalog/operations/import/services/product-import-progress.integration.spec.ts",
```

- [ ] **Step 3: DB 없이 스킵되는지 먼저 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/import/services/product-import-progress.integration.spec.ts
```

Expected: `1 skipped` — `DATABASE_URL` 이 없으면 통째로 스킵돼야 한다(CI 가 이 규약에 의존한다).

- [ ] **Step 4: 실제 DB 로 돌린다**

`apps/core/.env` 의 `DATABASE_URL` 을 쓰거나 로컬 Postgres 를 띄운다. **`public` 스키마에 `product_import_sessions`·`product_import_items` 가 실재해야 한다**(`LIKE public.…` 으로 DDL 을 복제하기 때문). dev DB 로 충분하다.

```bash
DATABASE_URL="<dev core DB URL>" npm run test:product-import-progress:integration
```

Expected: PASS (5 tests)

`DATABASE_URL` 을 구할 수 없어 이 단계를 건너뛴다면 **건너뛴 사실을 보고에 명시한다** — "통합 테스트 통과"라고 말하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-progress.integration.spec.ts package.json
git commit -m "test(product-import): 진행률 GROUP BY 집계 실 Postgres 통합 테스트"
```

---

## Task 4: admin-web 데이터 계층 (타입 · 클라이언트 · 쿼리키 · 훅 · 순수 헬퍼)

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/product-import.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/product-import.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.ts`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.spec.ts`
- Create: `apps/admin-web/src/lib/services/products/import-progress.ts`
- Create: `apps/admin-web/src/lib/services/products/import-progress.spec.ts`
- Modify: `apps/admin-web/src/lib/services/products/index.ts`
- Modify: `apps/admin-web/src/lib/services/products/queries.ts`

**Interfaces:**
- Consumes: Task 2 의 `GET /product-imports/:id/progress` 응답 계약.
- Produces:
  - `interface ImportProgressStage { key; label; status; done; total; failed; error }`
  - `interface ImportProgressDto { sessionId; fileName; canceled; cancelRequestedAt; totalRows; invalidCount; stages }`
  - `productImportClient.getProgress(sessionId): Promise<ImportProgressDto>`
  - `productQueryKeys.productImportProgress(sessionId)`
  - `isProgressRunning(progress?): boolean`
  - `isImportRunning(progress?, session?): boolean`
  - `stagePercent(stage): number`
  - `visibleStages(progress): ImportProgressStage[]`
  - `importCounts(progress?, session?): ImportCounts | null`
  - `useImportProgress(sessionId)`
  - `useImportSession(sessionId, enabled?)` — **시그니처 변경**

- [ ] **Step 1: 실패하는 테스트를 쓴다 (순수 헬퍼)**

`apps/admin-web/src/lib/services/products/import-progress.spec.ts`:

```ts
import {
  importCounts,
  isImportRunning,
  isProgressRunning,
  stagePercent,
  visibleStages,
} from './import-progress';
import type {
  ImportProgressDto,
  ImportProgressStage,
  SessionSummaryDto,
} from '@/lib/types/dto/product-import';

const stage = (over: Partial<ImportProgressStage> = {}): ImportProgressStage => ({
  key: 'commit',
  label: '상품 생성',
  status: 'running',
  done: 3,
  total: 10,
  failed: 0,
  error: null,
  ...over,
});

const progress = (over: Partial<ImportProgressDto> = {}): ImportProgressDto => ({
  sessionId: 's1',
  fileName: 'f.xlsx',
  canceled: false,
  cancelRequestedAt: null,
  totalRows: 12,
  invalidCount: 2,
  stages: [
    stage({ key: 'commit', done: 6, total: 10, failed: 1 }),
    stage({ key: 'publish', label: '게시', status: 'idle', done: 0, total: 5, failed: 0 }),
  ],
  ...over,
});

const session = (over: Partial<SessionSummaryDto> = {}): SessionSummaryDto => ({
  id: 's1',
  fileName: 'f.xlsx',
  totalRows: 12,
  createdCount: 5,
  failedCount: 3,
  status: 'completed',
  createdAt: '2026-07-30T00:00:00.000Z',
  commitStatus: 'completed',
  publishStatus: 'idle',
  publishedCount: 0,
  publishFailedCount: 0,
  commitError: null,
  publishError: null,
  invalidCount: 2,
  cancelRequestedAt: null,
  ...over,
});

describe('isProgressRunning', () => {
  it('진행 중인 단계가 하나라도 있으면 true', () => {
    expect(isProgressRunning(progress())).toBe(true);
  });
  it('모든 단계가 끝났으면 false — 폴링이 멈춘다', () => {
    expect(
      isProgressRunning(
        progress({ stages: [stage({ status: 'completed' }), stage({ key: 'publish', status: 'canceled' })] }),
      ),
    ).toBe(false);
  });
  it('queued 도 진행 중이다', () => {
    expect(isProgressRunning(progress({ stages: [stage({ status: 'queued' })] }))).toBe(true);
  });
  it('progress 가 없으면 false', () => {
    expect(isProgressRunning(undefined)).toBe(false);
  });
});

describe('isImportRunning', () => {
  it('progress 가 있으면 그쪽이 진실이다', () => {
    expect(isImportRunning(progress({ stages: [stage({ status: 'completed' })] }), session({ commitStatus: 'running' }))).toBe(false);
  });
  it('progress 가 없으면 세션 레인 상태로 폴백한다 — 롤링 배포 창', () => {
    expect(isImportRunning(undefined, session({ commitStatus: 'running' }))).toBe(true);
    expect(isImportRunning(undefined, session({ publishStatus: 'queued' }))).toBe(true);
    expect(isImportRunning(undefined, session())).toBe(false);
  });
  it('둘 다 없으면 false', () => {
    expect(isImportRunning(undefined, undefined)).toBe(false);
  });
});

describe('stagePercent', () => {
  it('done/total 을 반올림한 퍼센트', () => {
    expect(stagePercent(stage({ done: 1, total: 3 }))).toBe(33);
  });
  it('분모가 0 이면 0% 다 — 아직 분모가 없다는 뜻이지 완료가 아니다', () => {
    expect(stagePercent(stage({ done: 0, total: 0 }))).toBe(0);
  });
  it('100 을 넘지 않는다', () => {
    expect(stagePercent(stage({ done: 12, total: 10 }))).toBe(100);
  });
});

describe('visibleStages', () => {
  it('분모 0 인 단계는 접는다 — 이미지 없는 워크북의 probe/fetch 가 여기 걸린다', () => {
    const dto = progress({ stages: [stage({ key: 'commit', total: 10 }), stage({ key: 'publish', total: 0 })] });
    expect(visibleStages(dto).map((s) => s.key)).toEqual(['commit']);
  });
});

describe('importCounts', () => {
  it('progress 가 있으면 집계에서 뽑는다', () => {
    const counts = importCounts(progress(), undefined);
    expect(counts).toEqual({
      totalRows: 12,
      created: 5, // commit.done 6 - commit.failed 1
      createdFailed: 1,
      invalid: 2,
      published: 0,
      publishFailed: 0,
    });
  });

  it('progress 가 없으면 세션 카운터로 폴백한다', () => {
    const counts = importCounts(undefined, session());
    expect(counts).toEqual({
      totalRows: 12,
      created: 5,
      createdFailed: 1, // failedCount 3 - invalidCount 2
      invalid: 2,
      published: 0,
      publishFailed: 0,
    });
  });

  it('invalidCount 가 null 인 옛 세션은 두 종류를 가르지 않는다', () => {
    const counts = importCounts(undefined, session({ invalidCount: null }));
    expect(counts).toMatchObject({ invalid: null, createdFailed: 3 });
  });

  it('둘 다 없으면 null', () => {
    expect(importCounts(undefined, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/admin-web/src/lib/services/products/import-progress.spec.ts
```

Expected: FAIL — `Cannot find module './import-progress'`

- [ ] **Step 3: 미러 타입을 더한다**

`apps/admin-web/src/lib/types/dto/product-import.ts` 의 `SessionListResponse` 아래(파일 끝)에 추가한다:

```ts
/**
 * 진행률 화면의 단계 키. 워커 레인과 1:1 이 아니다 — v3 4단계에서 이미지 레인이
 * 'probe'|'fetch' 두 단계로 갈라져 여기 붙는다. 화면은 stages 배열을 순회해 그리므로
 * 그때 admin-web 은 이 유니온만 넓히면 된다.
 */
export type ImportProgressStageKey = 'commit' | 'publish';

export interface ImportProgressStage {
  key: ImportProgressStageKey;
  label: string;
  status: ImportJobStatus;
  done: number;
  total: number;
  failed: number;
  error: string | null;
}

/**
 * GET /product-imports/:id/progress — 행 목록 없이 단계별 집계만. 응답이 세션 크기와
 * 무관하게 작아 **폴링 대상은 이쪽**이다(세션 상세는 펼칠 때만 부른다).
 */
export interface ImportProgressDto {
  sessionId: string;
  fileName: string | null;
  canceled: boolean;
  cancelRequestedAt: string | null; // JSON 직렬화 결과(백엔드 Date → string)
  totalRows: number;
  invalidCount: number | null;
  stages: ImportProgressStage[];
}
```

- [ ] **Step 4: 클라이언트에 메서드를 더한다**

`apps/admin-web/src/lib/api/domains/products/product-import.client.ts` 의 타입 import 목록에 `ImportProgressDto` 를 더하고, `getSession` 아래에 추가한다:

```ts
  getProgress: async (sessionId: string): Promise<ImportProgressDto> => {
    const res = await client.get(`${BASE}/${sessionId}/progress`);
    return res.data;
  },
```

- [ ] **Step 5: 쿼리 키를 더한다**

`apps/admin-web/src/lib/services/products/query-keys.ts` 의 `productImport` 아래(171행 뒤)에 추가한다:

```ts
  // productImport(sessionId) 의 **하위 키**다 — 기존 뮤테이션들의
  // invalidateQueries({ queryKey: productImport(sessionId) }) 가 접두사 일치로
  // 진행률도 함께 무효화한다(mutations.ts 를 고칠 필요가 없는 이유).
  productImportProgress: (sessionId: string) =>
    [...productQueryKeys.productImport(sessionId), 'progress'] as const,
```

`query-keys.spec.ts` 의 `describe('productImports query keys', ...)` 안에 단언을 더한다:

```ts
  it('진행률 키는 세션 키의 하위 키다 — 접두사 무효화가 함께 걸린다', () => {
    expect(productQueryKeys.productImportProgress('s1')).toEqual([
      'product-imports',
      's1',
      'progress',
    ]);
  });
```

- [ ] **Step 6: 순수 헬퍼를 만든다**

`apps/admin-web/src/lib/services/products/import-progress.ts`:

```ts
// src/lib/services/products/import-progress.ts
// 대량등록 진행률 순수 헬퍼. **런타임 import 를 두지 않는다** — 루트 tsconfig 에 `@/*`
// 별칭이 없어 루트 jest 가 해석하지 못한다. 타입 전용 import 는 isolatedModules 로
// 지워지므로 안전하다(선례: wizard/can-commit.ts).

import type {
  ImportProgressDto,
  ImportProgressStage,
  SessionSummaryDto,
} from '@/lib/types/dto/product-import';

const RUNNING: ReadonlySet<string> = new Set(['queued', 'running']);

/** 한 단계라도 진행 중이면 true. 폴링 유지 조건이다. */
export function isProgressRunning(progress: ImportProgressDto | undefined): boolean {
  if (!progress) return false;
  return progress.stages.some((s) => RUNNING.has(s.status));
}

/**
 * 화면용 진행 여부. progress 가 있으면 그쪽이 진실이고, 없으면 세션 레인 상태로
 * 폴백한다 — 롤링 배포 중 옛 core 태스크는 /progress 를 모른다(404).
 */
export function isImportRunning(
  progress: ImportProgressDto | undefined,
  session: SessionSummaryDto | undefined
): boolean {
  if (progress) return isProgressRunning(progress);
  if (!session) return false;
  return RUNNING.has(session.commitStatus) || RUNNING.has(session.publishStatus);
}

/** 진행률 바 퍼센트. 분모 0 은 100% 가 아니라 0% 다 — 아직 분모가 없다는 뜻이다. */
export function stagePercent(stage: ImportProgressStage): number {
  if (stage.total <= 0) return 0;
  return Math.min(100, Math.round((stage.done / stage.total) * 100));
}

/**
 * 분모가 0 인 단계는 접는다. 이미지 없는 워크북의 probe/fetch(v3 4단계)와 아직
 * 생성된 행이 없어 게시 대상이 0 인 publish 가 여기 걸린다.
 *
 * 다만 분모 0 이어도 status: 'failed' 거나 error 가 실려 있으면 접지 않는다 — 전 행
 * 검증실패이거나 0행 세션에서 레인이 10회 연속 실패해 failed 로 확정된 경우 분모가
 * 끝까지 0 인 채로 남는다. 그때 접어버리면 이 오류가 화면 어디에도 안 뜬다(폴백
 * 오류 배너는 progress 자체가 없을 때만 뜬다) — 실패를 보여주는 쪽이 접는 것보다
 * 우선한다.
 */
export function visibleStages(progress: ImportProgressDto): ImportProgressStage[] {
  return progress.stages.filter((s) => s.total > 0 || s.error !== null || s.status === 'failed');
}

export interface ImportCounts {
  totalRows: number;
  created: number;
  createdFailed: number;
  /** null 이면 접수 시점 검증실패를 가를 수 없는 옛 세션이다. */
  invalid: number | null;
  published: number;
  publishFailed: number;
}

/**
 * 화면 상단 요약 숫자. progress 가 진실이다 — 매번 집계하므로 워커가 중단돼도
 * 세션 카운터처럼 드리프트하지 않는다. progress 가 없을 때만 세션 카운터로 폴백한다.
 */
export function importCounts(
  progress: ImportProgressDto | undefined,
  session: SessionSummaryDto | undefined
): ImportCounts | null {
  if (progress) {
    const commit = progress.stages.find((s) => s.key === 'commit');
    const publish = progress.stages.find((s) => s.key === 'publish');
    return {
      totalRows: progress.totalRows,
      created: (commit?.done ?? 0) - (commit?.failed ?? 0),
      createdFailed: commit?.failed ?? 0,
      invalid: progress.invalidCount,
      published: (publish?.done ?? 0) - (publish?.failed ?? 0),
      publishFailed: publish?.failed ?? 0,
    };
  }
  if (!session) return null;
  return {
    totalRows: session.totalRows,
    created: session.createdCount,
    // `== null` 은 의도적이다 — 컬럼 도입 이전 세션(null)과 롤링 배포 중 옛 태스크의
    // 응답(undefined)을 함께 현행 표시로 폴백시킨다.
    createdFailed:
      session.invalidCount == null
        ? session.failedCount
        : session.failedCount - session.invalidCount,
    invalid: session.invalidCount,
    published: session.publishedCount,
    publishFailed: session.publishFailedCount,
  };
}
```

- [ ] **Step 7: 배럴에 추가한다**

`apps/admin-web/src/lib/services/products/index.ts` 의 `export * from './transformers';` 위에 추가한다:

```ts
// 대량등록 진행률 순수 헬퍼
export * from './import-progress';
```

- [ ] **Step 8: 헬퍼 테스트 통과를 확인한다**

```bash
npx jest apps/admin-web/src/lib/services/products
```

Expected: PASS — `import-progress.spec.ts` 15 tests + `query-keys.spec.ts` 1 추가. 이 스코프 합계 **34 passed**(기준선 18 + 16)

- [ ] **Step 9: 쿼리 훅을 고친다**

`apps/admin-web/src/lib/services/products/queries.ts`:

(1) 33행의 `import type { ImportJobStatus } from '@/lib/types/dto/product-import';` 를 **지운다** — 유일한 사용처(659행 `useImportSession` 의 `refetchInterval`)가 아래에서 사라진다.

(2) `productQueryKeys` import 아래에 헬퍼 import 를 더한다:

```ts
import { isProgressRunning } from './import-progress';
```

(3) 638행 이후의 대량등록 블록 중 `useImportSession` 를 아래로 **교체**한다(`useImportSessions` 는 그대로 둔다):

```ts
/**
 * 임포트 세션 상세(행 목록 포함). **폴링하지 않는다** — 1,000행 세션이면 2초마다
 * 1,000행이 오갔다(v3 스펙 §2.9). 진행률은 useImportProgress 가 집계 응답으로 본다.
 * 행 목록은 사용자가 펼칠 때만 필요하므로 호출부가 enabled 로 켠다.
 */
export const useImportSession = (sessionId: string, enabled = true) => {
  return useQuery({
    queryKey: productQueryKeys.productImport(sessionId),
    queryFn: () => products.productImport.getSession(sessionId),
    enabled: !!sessionId && enabled,
  });
};

/**
 * 세션 진행률(단계별 집계). 응답이 세션 크기와 무관하게 작아 **폴링은 이쪽**이다.
 * 진행 중인 단계가 하나도 없으면 false 가 되어 폴링이 멈춘다 — 완료된 세션 화면을
 * 열어두어도 요청이 계속 나가지 않는다.
 */
export const useImportProgress = (sessionId: string) => {
  return useQuery({
    queryKey: productQueryKeys.productImportProgress(sessionId),
    queryFn: () => products.productImport.getProgress(sessionId),
    enabled: !!sessionId,
    // 롤링 배포 중 옛 core 태스크는 이 엔드포인트를 모른다(404). 재시도로 화면을
    // 붙잡아두지 말고 곧장 세션 카운터 폴백으로 넘긴다(importCounts).
    retry: false,
    // data 가 아직 없는 동안(초기 로드 · 404 · 일시적 5xx)에도 계속 두드려야 한다.
    // retry: false 라 이 인터벌이 재시도 역할을 대신한다 — 그러지 않으면 첫 요청이
    // 한 번만 실패해도 data 가 영영 undefined 로 남아 인터벌이 걸리지 않고, 화면이
    // 마운트 동안 영구히 멈춘다. data 가 있는 동안 두드리면 롤링 배포 창이 끝나는
    // 순간 진행률 패널이 리로드 없이 스스로 살아난다.
    refetchInterval: (query) =>
      query.state.data === undefined || isProgressRunning(query.state.data) ? 2000 : false,
  });
};
```

- [ ] **Step 10: 타입 게이트와 테스트**

```bash
npx jest apps/admin-web/src/lib/services/products apps/admin-web/src/features/mall/product-imports
cd apps/admin-web && npx tsc --noEmit
```

Expected: jest PASS(실패 0), tsc exit 0

> `useImportSession` 의 호출부는 `session-detail/index.tsx` 하나뿐이고 인자를 하나만 넘기므로 기본값 `enabled = true` 로 여기서는 아직 깨지지 않는다.

- [ ] **Step 11: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/product-import.ts \
        apps/admin-web/src/lib/api/domains/products/product-import.client.ts \
        apps/admin-web/src/lib/services/products
git commit -m "feat(admin-web): 임포트 진행률 훅·순수 헬퍼 추가, 세션 상세 폴링 제거"
```

---

## Task 5: 세션 상세 화면 재배선

**Files:**
- Create: `apps/admin-web/src/features/mall/product-imports/session-detail/progress-panel.tsx`
- Modify: `apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx`

**Interfaces:**
- Consumes: Task 4 의 `useImportProgress`, `useImportSession(sessionId, enabled)`, `importCounts`, `isImportRunning`, `stagePercent`, `visibleStages`, `productQueryKeys.productImport`.
- Produces: `<ProgressPanel progress={...} />`

### 화면 규칙

- 단계 바는 `progress` 가 있을 때만 그린다. 없으면(롤링 배포 창) 기존 세션 카운터 표시로 폴백하고 잡 오류 배너를 대신 띄운다.
- 행 목록은 **접혀 있는 것이 기본**이다. 펼칠 때 `getSession` 이 처음 나간다.
- 진행이 멈추는 순간 행 목록 캐시를 한 번 무효화한다 — 펼쳐 둔 채 완료를 지켜본 사용자가 옛 목록을 보고 있지 않게.

- [ ] **Step 1: 단계 바 컴포넌트를 만든다**

`apps/admin-web/src/features/mall/product-imports/session-detail/progress-panel.tsx`:

```tsx
'use client';

import { Progress } from '@/components/ui/progress';
import { stagePercent, visibleStages } from '@/lib/services/products';
import type { ImportProgressDto } from '@/lib/types/dto/product-import';

const STATUS_LABEL: Record<string, string> = {
  idle: '대기',
  queued: '큐 대기',
  running: '진행 중',
  completed: '완료',
  failed: '실패',
  canceled: '취소됨',
};

interface Props {
  progress: ImportProgressDto;
}

export function ProgressPanel({ progress }: Props) {
  const stages = visibleStages(progress);

  if (stages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        진행할 단계가 없습니다 — 등록 대상 행이 없는 세션입니다.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {stages.map((stage) => (
        <div key={stage.key} className="space-y-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{stage.label}</span>
            <span className="text-muted-foreground">
              {stage.done}/{stage.total}
              {stage.failed > 0 && (
                <span className="ml-2 text-destructive">실패 {stage.failed}</span>
              )}
              <span className="ml-2">{STATUS_LABEL[stage.status] ?? stage.status}</span>
            </span>
          </div>
          <Progress value={stagePercent(stage)} />
          {stage.error && <p className="text-xs text-destructive">{stage.error}</p>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 세션 상세를 재배선한다**

`apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx` 전체를 아래로 교체한다:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import {
  importCounts,
  isImportRunning,
  productQueryKeys,
  useCancelSession,
  useImportProgress,
  useImportSession,
  usePublishSession,
} from '@/lib/services/products';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { ProgressPanel } from './progress-panel';

interface Props {
  sessionId: string;
}

export function SessionDetail({ sessionId }: Props) {
  const progressQuery = useImportProgress(sessionId);
  const progress = progressQuery.data;

  const [itemsOpen, setItemsOpen] = useState(false);
  // 행 목록은 세션 하나에 수천 행이라 폴링 대상이 아니다(v3 스펙 §2.9) — 사용자가
  // 펼칠 때만 가져온다. 다만 progress 가 404 인 롤링 배포 창에서는 화면이 통째로
  // 빌 수 없으므로 그때도 세션을 불러 폴백 표시에 쓴다.
  const { data: session } = useImportSession(sessionId, itemsOpen || progressQuery.isError);

  const publish = usePublishSession();
  const cancel = useCancelSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const running = isImportRunning(progress, session);
  const counts = importCounts(progress, session);
  // `Boolean()` 인 이유: 롤링 배포 중 옛 core 태스크는 cancelRequestedAt 키를 아예 안
  // 실어 보낸다(undefined). `!== null` 이면 그 창에서 정상 세션이 전부 취소된 것으로
  // 보이고 게시 버튼이 잠긴다. 백엔드 renewLease 도 같은 이유로 Boolean() 을 쓴다.
  const canceled = progress ? progress.canceled : Boolean(session?.cancelRequestedAt);
  const canceledAt = progress?.cancelRequestedAt ?? session?.cancelRequestedAt ?? null;
  const fileName = progress?.fileName ?? session?.fileName ?? null;
  // 취소는 진행 중인 레인이 있을 때만 의미가 있다 — 서버도 같은 조건으로 409 를 던진다.
  const cancellable = !canceled && running;

  // 진행이 멈추는 순간 한 번만 행 목록을 새로 고친다 — 펼쳐 둔 채 완료를 지켜본
  // 사용자가 옛 목록을 보고 있지 않게. exact 로 좁혀 진행률 키는 건드리지 않는다.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.productImport(sessionId),
        exact: true,
      });
    }
    wasRunning.current = running;
  }, [running, queryClient, sessionId]);

  function handlePublish() {
    publish.mutate(sessionId, {
      onSuccess: (res) => {
        toast.info(`${res.targetCount}건 게시를 접수했습니다.`);
      },
      onError: (error) => {
        toast.error(getServerDenyMessage(error, '게시 접수 중 오류가 발생했습니다.'));
      },
    });
  }

  function handleCancel() {
    setConfirmOpen(false);
    cancel.mutate(sessionId, {
      onSuccess: () => {
        toast.info('세션을 취소했습니다. 이미 생성된 상품은 그대로 남습니다.');
      },
      onError: (error) => {
        toast.error(getServerDenyMessage(error, '취소 중 오류가 발생했습니다.'));
      },
    });
  }

  if (!counts) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="대량등록 세션 상세"
          subtitle={
            `${fileName ?? '(파일명 없음)'} · 생성 ${counts.created}/${counts.totalRows}` +
            // invalid 가 null 인 옛 세션은 두 종류가 섞인 실패 수만 보여준다(폴백).
            (counts.invalid == null
              ? ` (실패 ${counts.createdFailed})`
              : ` (검증실패 ${counts.invalid} · 생성실패 ${counts.createdFailed})`) +
            ` · 게시 ${counts.published} (실패 ${counts.publishFailed})`
          }
          right={
            <div className="flex items-center gap-2">
              {cancellable && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmOpen(true)}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? '취소하는 중...' : '작업 취소'}
                </Button>
              )}
              <Button onClick={handlePublish} disabled={publish.isPending || running || canceled}>
                {canceled ? '취소됨' : running ? '진행 중...' : '세션 일괄 게시'}
              </Button>
            </div>
          }
        />

        {progress && (
          <div className="px-6 pb-4">
            <ProgressPanel progress={progress} />
          </div>
        )}

        {canceled && (
          <div className="mx-6 mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700">
            <p>
              {canceledAt && `${new Date(canceledAt).toLocaleString('ko-KR')} 에 `}
              취소된 세션입니다. 이미 생성·게시된 상품은 되돌아오지 않으니 아래 목록에서
              확인 후 직접 정리해 주세요.
            </p>
            <p className="mt-1">
              다시 등록하려면 워크북을 새로 업로드해 주세요 — 취소된 세션은 재개되지 않습니다.
            </p>
          </div>
        )}

        {/* progress 가 있으면 잡 오류는 단계 바가 들고 있다. 이 배너는 롤링 배포 창의 폴백이다. */}
        {!progress && session && (session.commitError || session.publishError) && (
          <div className="mx-6 mb-2 space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {session.commitError && <p>생성 잡 오류: {session.commitError}</p>}
            {session.publishError && <p>게시 잡 오류: {session.publishError}</p>}
          </div>
        )}

        <div className="p-6 pt-2">
          <div className="mb-2 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setItemsOpen((open) => !open)}>
              {itemsOpen ? '행 목록 접기' : `행 목록 펼치기 (${counts.totalRows}행)`}
            </Button>
            {itemsOpen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  queryClient.invalidateQueries({
                    queryKey: productQueryKeys.productImport(sessionId),
                    exact: true,
                  })
                }
              >
                새로고침
              </Button>
            )}
          </div>

          {itemsOpen &&
            (session ? (
              <div className="overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="p-2">행</th>
                      <th className="p-2">productKey</th>
                      <th className="p-2">생성</th>
                      <th className="p-2">게시</th>
                      <th className="p-2">상품 / 오류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.items.map((i) => (
                      <tr key={i.rowNumber} className="border-t align-top">
                        <td className="p-2">{i.rowNumber}</td>
                        <td className="p-2">{i.productKey}</td>
                        <td className="p-2">
                          {i.status === 'created' ? (
                            <span className="text-green-600">생성</span>
                          ) : i.status === 'pending' ? (
                            <span className="text-muted-foreground">대기</span>
                          ) : (
                            <span className="text-destructive">실패</span>
                          )}
                        </td>
                        <td className="p-2">
                          {i.publishStatus === 'published' ? (
                            <span className="text-green-600">게시</span>
                          ) : i.publishStatus === 'failed' ? (
                            <span className="text-destructive" title={i.publishError}>
                              실패
                            </span>
                          ) : i.publishStatus === 'skipped' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="text-muted-foreground">대기</span>
                          )}
                        </td>
                        <td className="p-2">
                          {i.status === 'created' && i.masterId ? (
                            <div className="flex flex-col gap-y-1">
                              <Link
                                href={`/mall/products-list/${i.masterId}`}
                                className="text-primary underline"
                              >
                                상품 상세
                              </Link>
                              {i.publishError && (
                                <span className="text-xs text-destructive">{i.publishError}</span>
                              )}
                            </div>
                          ) : i.status === 'pending' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="text-destructive">{i.errorMessage}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">행 목록을 불러오는 중...</p>
            ))}
        </div>
      </Container>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 세션의 작업을 멈출까요?</AlertDialogTitle>
            <AlertDialogDescription>
              진행 중인 상품 생성·게시가 멈춥니다.{' '}
              <strong>이미 생성되거나 게시된 상품은 되돌아오지 않습니다.</strong> 취소한
              세션은 다시 이어서 진행할 수 없고, 다시 등록하려면 워크북을 새로 올려야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>작업 취소</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: 타입 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: exit 0

- [ ] **Step 4: 전체 스코프 테스트**

```bash
npx jest apps/core/src/modules/catalog/operations/import \
         apps/admin-web/src/lib/services/products \
         apps/admin-web/src/features/mall/product-imports
npm run type-check:scoped
```

Expected: core **144 passed, 24 skipped**(19 + 진행률 통합 5) · admin-web **34 passed** · `type-check:scoped` exit 0. 판정 기준은 **실패 0** 이다.

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/product-imports/session-detail
git commit -m "feat(admin-web): 세션 상세를 진행률 집계 기반으로 재배선 + 행 목록 지연 로드"
```

---

## Task 6: 수동 스모크 + 스펙 문서 갱신

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` (§6 표의 2단계 상태 표기)

- [ ] **Step 1: dev 에서 스모크한다**

두 프로세스를 띄운다:

```bash
npm run start:main:dev        # core (apps/core/.env 로딩)
npm run start:admin-web:dev   # admin-web
```

`/mall/product-imports/new` 에서 유효 3행 + 무효 1행짜리 워크북을 올려 커밋하고, 세션 상세에서 다음을 눈으로 확인한다.

| 확인 | 기대 |
|---|---|
| 브라우저 네트워크 탭 | 2초마다 나가는 요청이 `/progress` 하나이고 응답 본문이 1KB 미만이다. `GET /product-imports/:id` 는 나가지 않는다 |
| 단계 바 | "상품 생성" 분모가 **3**(=4행 − 검증실패 1)이다. 4 가 아니다 |
| 상단 요약 | `검증실패 1 · 생성실패 0` 로 갈려 보인다 |
| 생성 완료 후 | 폴링이 멈춘다(요청이 더 안 나간다). "게시" 단계 분모가 3 으로 나타난다 |
| 일괄 게시 | 폴링이 다시 시작되고 게시 바가 찬다 |
| 행 목록 | 접혀 있고, 펼치면 그때 `GET /product-imports/:id` 가 **한 번** 나간다 |
| 취소 | 진행 중 "작업 취소" → 단계 상태가 `취소됨` 으로 바뀌고 폴링이 멈춘다 |

- [ ] **Step 2: 스펙 문서의 단계 표를 갱신한다**

`docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` §6 표의 2단계 행 끝에 상태를 적는다:

```
| **2** | 진행률 API + admin-web 폴링 전환 | core → admin-web (같은 `sst deploy`) — **구현 완료(2026-07-30)** |
```

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md
git commit -m "docs: v3 2단계 구현 완료 표기"
```

---

## 배포 선행조건

- **마이그레이션 없음.** 이 단계는 기존 컬럼만 읽는다.
- **신규 시크릿·env 없음.**
- **배포 순서: core 먼저, admin-web 나중.** 같은 `sst deploy` 로 묶어도 되지만, 새 admin-web 이 옛 core 를 만나면 `/progress` 가 404 다. 화면은 폴백하도록 만들어져 있어 깨지지는 않지만(진행률 바가 안 보이고 세션 카운터 표시로 되돌아간다), core 를 먼저 올리면 그 창 자체가 없다.
- **롤백 안전.** admin-web 만 되돌리면 옛 화면이 `GET /product-imports/:id` 폴링으로 돌아간다 — 그 엔드포인트는 그대로 살아 있다.

## 설계 결정 기록 (스펙과 달라진 지점)

| 결정 | 스펙 | 이 계획 | 이유 |
|---|---|---|---|
| 단계 개수 | §3.5 예시는 4단계(probe·fetch·commit·publish) | 2단계(commit·publish)만 발행 | `product_import_images` 가 4단계에 생긴다. 화면이 `stages` 배열을 순회해 그리므로 4단계에서 항목만 늘리면 admin-web 은 유니온 타입만 넓히면 된다 |
| 단계별 `error` | 예시 JSON 에 없음 | `ImportProgressStageDto.error` 추가 | 잡 오류(`commitError`·`publishError`)를 보려고 `getSession` 을 폴링하면 이 단계의 목적이 무너진다 |
| `fileName` | 예시 JSON 에 없음 | 응답에 포함 | 행 목록을 지연 로드하면 화면 상단 파일명이 없어진다. 세션 1행을 이미 읽고 있어 비용이 0 이다 |
| 쿼리 수 | §3.5 "쿼리 3개" | 2개 | 3번째가 `images GROUP BY status` 인데 그 테이블이 4단계에 생긴다 |

## Self-Review 메모

- 스펙 §3.5 의 요구는 전부 커버된다: 집계 전용 엔드포인트(Task 2), 단계별 분모표 그대로 구현(Task 1), 드리프트 없는 매번 집계(Task 1 빌더 주석), `invalid_count` 뺄셈(Task 1), 4단계↔3레인 층 분리(`stages` 배열), `refetchInterval` 을 progress 로 이동(Task 4), `GET /product-imports/:id` 를 폴링 대상에서 제외(Task 4·5).
- 타입 일관성: `ImportProgressStageKey`·`ImportProgressStage(Dto)`·`ImportProgressDto` 의 필드 이름이 core DTO 와 admin-web 미러 타입에서 동일하다. `getProgressCounts` 는 Task 2 에서 정의하고 Task 3·5 에서 같은 이름으로 쓴다.
- 남는 것(이 계획 범위 밖): 세션 **목록** 화면은 여전히 `getSessions` 가 전체 세션 행을 돌려준다 — 행 목록이 아니라 세션 요약이라 크기가 문제 되지 않는다. v2 5단계(InboxWorker 배치 claim)와 v3 3·4단계는 그대로 남는다.
