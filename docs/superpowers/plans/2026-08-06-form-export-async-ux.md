# 양식 생성 비동기 UX 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 양식 생성을 "사용자가 자리를 뜬다"를 전제로 한 비동기 작업으로 다시 배선한다 — 목록으로 되찾고, 중복 요청을 합치고, 실패를 수 분 안에 정직하게 알린다.

**Architecture:** 서버는 목록 API·중복 제거·재시도 분리를 더한다. 재시도 단축의 전제조건인 `recordJobError` 토큰 CAS 가 종료 보장을 깨므로, 그 구멍은 `claim()` 이 재클레임 시점에 실패를 세서 막는다. 화면은 모달을 없애고 `/mall/bulk-sessions` 를 두 탭으로 나눠 목록에서 이어받는다.

**Tech Stack:** NestJS · Drizzle ORM(postgres.js) · Jest · Next.js(App Router) · TanStack Query · shadcn/ui

**설계 근거:** `docs/superpowers/specs/2026-08-06-form-export-async-ux-design.md`

## Global Constraints

- **마이그레이션 0건.** 새 컬럼·새 테이블을 만들지 않는다. `requested_master_ids`·`consecutive_failures`·`lease_token`·`created_at`·`expires_at` 이 이미 전부 있다.
- **`DEFAULT_EXPORT_LEASE_MS = 1_800_000` 을 바꾸지 않는다.** 이 값은 조립 중 점유 보호용이고, 낮추면 이중 조립 → 영구 고아 xlsx 다.
- **트랜잭션 규약(ADR-0025):** public 메서드는 `tx?: DbTransaction` 을 마지막 인자로, 내부는 `this.db.run(async (trx) => {...}, tx)`. per-class `inTx` 헬퍼를 새로 만들지 않는다.
- **도메인 예외는 `@app/shared`** (`NotFoundError`·`ConflictError`·`BadRequestError`). 서비스/매니저에서 `HttpException` 계열을 import 하지 않는다.
- **`any` 금지, `as` 캐스팅은 문서화된 정당화가 있을 때만.** `res.json()` 등 `unknown` 은 `in` 연산자 narrowing 으로 좁힌다.
- **admin-web 은 컴포넌트 테스트가 불가능하다.** 판정 로직은 반드시 `.ts` 순수 함수로 분리하고 `.spec.ts` 를 붙인다. 컴포넌트에 남은 로직은 검증되지 않는다.
- **목록 응답 필드명은 `data`** 다(`items` 아님) — `BulkSessionItemListDto` 선례.
- **검증 스코프:** 저장소 전역 `npm run lint`·전역 jest·`nest build core` 는 상시 debt 다. 각 태스크는 **변경 범위로 스코프한 명령**만 돌리고 신규 error 0 을 확인한다.
- **커밋 메시지는 한국어**, 본문 끝에 `Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5`.

---

## File Structure

**서버 (`apps/core/src/modules/catalog/operations/bulk-session/`)**

| 파일 | 책임 |
|---|---|
| `pagination.ts` (신규) | `parsePage`/`parseLimit` — 두 컨트롤러가 공유하는 페이지 파싱 규칙 |
| `pagination.spec.ts` (신규) | 위 순수 함수 회귀 |
| `bulk-session.controller.ts` (수정) | 지역 `parsePage`/`parseLimit` 제거하고 공용 모듈 사용 |
| `form-export.controller.ts` (수정) | `@Get()` 목록 · `@Post(':exportId/retry')` 추가 |
| `dto/form-export-response.dto.ts` (수정) | `FormExportSummaryDto`·`FormExportListDto` 추가, `reused`·`consecutiveFailures` 필드 추가 |
| `services/form-export.service.ts` (수정) | `list`·`retry` 포트 추가 |
| `services/form-export.manager.ts` (수정) | `accept` 중복 제거 · `list` · `retry` |
| `services/form-export-job.manager.ts` (수정) | `claim` 실패 카운트 · `recordJobError` CAS + 짧은 재시도 |
| `services/form-export-job.worker.ts` (수정) | `recordJobError` 에 `leaseToken` 전달 |

**화면 (`apps/admin-web/src/`)**

| 파일 | 책임 |
|---|---|
| `lib/types/dto/form-export.ts` (수정) | `FormExportSummary`·`FormExportList`·`reused`·`consecutiveFailures` |
| `lib/api/domains/products/form-export.client.ts` (수정) | `list`·`retry` |
| `lib/services/products/form-export.ts` (수정) | `useFormExportList`·`useRetryFormExport`, 단건 폴링 훅 제거 |
| `lib/services/products/form-export-model.ts` (신규) | 행 상태 판정 · 목록 폴링 간격 (순수) |
| `lib/services/products/form-export-model.spec.ts` (신규) | 위 회귀 |
| `features/mall/bulk-sessions/lib/tab-param.ts` (신규) | `?tab=` 파싱 (순수) |
| `features/mall/bulk-sessions/lib/tab-param.spec.ts` (신규) | 위 회귀 |
| `features/mall/bulk-sessions/index.tsx` (신규) | 두 탭 컨테이너 |
| `features/mall/bulk-sessions/form-export-list/index.tsx` (신규) | 「양식 생성」 탭 |
| `features/mall/bulk-sessions/session-list/index.tsx` (수정) | 빈 양식 버튼을 양식 탭으로 내보냄 |
| `app/(admin)/mall/bulk-sessions/page.tsx` (수정) | 탭 컨테이너를 렌더 |
| `features/mall/products-list/components/table/index.tsx` (수정) | 모달 제거, 새 탭 열기 |
| `features/mall/products-list/components/form-export-modal/` (삭제) | 3개 파일 전부 |

---

## Task 1: 페이지 파싱 헬퍼 공용화

`parsePage`/`parseLimit` 은 지금 `bulk-session.controller.ts:41-47` 의 **모듈 지역 함수**다. 양식 목록이 같은 규칙을 써야 하므로 복제하지 말고 추출한다. `parseImageLimit`(`:50`)은 상한이 달라 그대로 둔다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/pagination.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/pagination.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts:41-47`

**Interfaces:**
- Produces: `parsePage(page: string): number` · `parseLimit(limit: string): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`pagination.spec.ts`:

```typescript
import { parseLimit, parsePage } from './pagination';

describe('페이지 파라미터 파싱', () => {
  it('빈 값·쓰레기 값은 기본값으로 떨어진다', () => {
    expect(parsePage('')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parseLimit('')).toBe(20);
    expect(parseLimit('abc')).toBe(20);
  });

  it('page 는 1 미만으로 내려가지 않는다', () => {
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-5')).toBe(1);
    expect(parsePage('3')).toBe(3);
  });

  it('limit 은 1~100 으로 잘린다', () => {
    expect(parseLimit('0')).toBe(1);
    expect(parseLimit('500')).toBe(100);
    expect(parseLimit('50')).toBe(50);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx jest --testPathPattern='bulk-session/pagination'`
Expected: FAIL — `Cannot find module './pagination'`

- [ ] **Step 3: 구현한다**

`pagination.ts`:

```typescript
/**
 * 일괄 세션·양식 생성 두 컨트롤러가 공유하는 페이지 파라미터 파싱.
 *
 * bulk-session.controller.ts 의 모듈 지역 함수였던 것을 양식 목록(GET /product-forms)이
 * 같은 규칙을 쓰게 되면서 여기로 옮겼다. 이미지 목록의 parseImageLimit 은 상한이 달라
 * (행이 훨씬 가벼워 1000) 그대로 컨트롤러에 남긴다.
 */
export function parsePage(page: string): number {
  return Math.max(1, Number.parseInt(page, 10) || 1);
}

export function parseLimit(limit: string): number {
  return Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern='bulk-session/pagination'`
Expected: PASS (3 tests)

- [ ] **Step 5: 컨트롤러를 공용 모듈로 갈아끼운다**

`bulk-session.controller.ts` — `parsePage`/`parseLimit` 두 함수 정의(`:41-47`)를 지우고 import 를 더한다. `parseImageLimit` 은 남긴다.

```typescript
import { parsePage, parseLimit } from './pagination';
```

- [ ] **Step 6: 기존 스위트가 여전히 초록인지 확인**

Run: `npx jest --testPathPattern='bulk-session'`
Expected: PASS — 기존 통과 수 유지, 신규 실패 0

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/pagination.ts \
        apps/core/src/modules/catalog/operations/bulk-session/pagination.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts
git commit -m "$(cat <<'EOF'
refactor(bulk-session): 페이지 파라미터 파싱을 공용 모듈로 추출

양식 생성 목록(GET /product-forms)이 세션 목록과 같은 파싱 규칙을 써야
하는데, parsePage/parseLimit 이 bulk-session.controller.ts 의 모듈 지역
함수라 그대로 두면 복제된다. parseImageLimit 은 상한이 달라 남긴다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 2: 목록 API + `consecutiveFailures` 노출

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/dto/form-export-response.dto.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.service.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/form-export.controller.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.spec.ts`

**Interfaces:**
- Consumes: `parsePage`/`parseLimit` (Task 1)
- Produces:
  - `FormExportManager.list(userId: string, page: number, limit: number, tx?: DbTransaction): Promise<FormExportListDto>`
  - `FormExportService.list(userId: string, page: number, limit: number): Promise<FormExportListDto>`
  - `FormExportSummaryDto` — `{ exportId, status, requestedCount, productCount, errorMessage, consecutiveFailures, downloadable, createdAt, expiresAt }`
  - `FormExportListDto` — `{ data: FormExportSummaryDto[], total, page, limit }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`form-export.manager.spec.ts` 에 describe 를 더한다. 이 파일의 기존 `harness()` 는 단건 조회용이라, 목록은 `select().from().where().orderBy().limit().offset()` 과 `count` 를 함께 흉내내야 한다 — 기존 `chain()` 을 확장하지 말고 이 describe 전용 페이크를 새로 쓴다(기존 테스트가 쓰는 모양을 건드리면 그쪽이 깨진다).

```typescript
describe('FormExportManager.list', () => {
  interface ListTrx {
    select: (fields?: unknown) => {
      from: () => {
        where: () => {
          orderBy: () => { limit: () => { offset: () => Promise<Record<string, unknown>[]> } };
        } & Promise<Record<string, unknown>[]>;
      };
    };
  }

  function listHarness(rows: Record<string, unknown>[], total: number) {
    const calls: { orderBy: number } = { orderBy: 0 };
    const page = Promise.resolve(rows);
    const trx: ListTrx = {
      select: (fields?: unknown) => ({
        from: () => {
          // count 질의는 select({ value: count() }) 로 필드를 넘긴다 — 그걸로 갈라낸다.
          const isCount = fields !== undefined;
          const whereResult = Object.assign(
            isCount ? Promise.resolve([{ value: total }]) : page,
            {
              orderBy: () => {
                calls.orderBy += 1;
                return { limit: () => ({ offset: () => page }) };
              },
            },
          );
          return { where: () => whereResult };
        },
      }),
    };
    return { trx, calls };
  }

  it('본인 잡만, 최신순으로, 페이지를 잘라 돌려준다', async () => {
    const { trx, calls } = listHarness(
      [
        {
          id: 'E2',
          status: 'completed',
          requestedMasterIds: ['m1', 'm2'],
          productCount: 2,
          errorMessage: null,
          consecutiveFailures: 0,
          fileId: 'F1',
          createdAt: new Date('2026-08-06T00:00:00Z'),
          expiresAt: new Date('2026-09-05T00:00:00Z'),
        },
      ],
      7,
    );
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );

    const result = await manager.list('U1', 2, 20);

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(20);
    expect(calls.orderBy).toBe(1);
    expect(result.data).toEqual([
      {
        exportId: 'E2',
        status: 'completed',
        requestedCount: 2,
        productCount: 2,
        errorMessage: null,
        consecutiveFailures: 0,
        downloadable: true,
        createdAt: '2026-08-06T00:00:00.000Z',
        expiresAt: '2026-09-05T00:00:00.000Z',
      },
    ]);
  });

  it('fileId 가 없으면 completed 여도 downloadable 이 아니다', async () => {
    const { trx } = listHarness(
      [
        {
          id: 'E3',
          status: 'completed',
          requestedMasterIds: ['m1'],
          productCount: 0,
          errorMessage: null,
          consecutiveFailures: 0,
          fileId: null,
          createdAt: new Date('2026-08-06T00:00:00Z'),
          expiresAt: new Date('2026-09-05T00:00:00Z'),
        },
      ],
      1,
    );
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );

    const result = await manager.list('U1', 1, 20);

    expect(result.data[0].downloadable).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx jest --testPathPattern='form-export.manager' -t 'FormExportManager.list'`
Expected: FAIL — `manager.list is not a function`

- [ ] **Step 3: DTO 를 더한다**

`dto/form-export-response.dto.ts` 에 추가하고, 기존 `FormExportStatusDto` 에 `consecutiveFailures` 를 더한다:

```typescript
export class FormExportSummaryDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'failed'] })
  status: 'queued' | 'running' | 'completed' | 'failed';
  @ApiProperty({ description: '요청한 상품 수' }) requestedCount: number;
  @ApiProperty({ description: '실제로 프리필된 상품 수' }) productCount: number;
  @ApiProperty({ required: false, nullable: true }) errorMessage: string | null;
  @ApiProperty({ description: '연속 실패 횟수. running 인데 0 보다 크면 재시도 대기 중이다' })
  consecutiveFailures: number;
  @ApiProperty() downloadable: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty() expiresAt: string;
}

export class FormExportListDto {
  @ApiProperty({ type: [FormExportSummaryDto] }) data: FormExportSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
```

`FormExportStatusDto` 에 한 줄 추가:

```typescript
  @ApiProperty({ description: '연속 실패 횟수. running 인데 0 보다 크면 재시도 대기 중이다' })
  consecutiveFailures: number;
```

`dto/index.ts` 에 두 클래스를 내보낸다.

- [ ] **Step 4: 매니저에 `list` 를 더하고 `getStatus` 에 필드를 싣는다**

`form-export.manager.ts` — import 에 `and`·`desc`·`count` 를 더한다.

```typescript
  /**
   * 내 양식 생성 목록. 남의 잡은 애초에 SELECT 에 들어오지 않는다 —
   * getStatus 가 소유권 실패를 404 로 합치는 것과 같은 이유로, 목록도 본인 것만 본다.
   */
  async list(userId: string, page: number, limit: number, tx?: DbTransaction): Promise<FormExportListDto> {
    return this.db.run(async (trx) => {
      const owned = eq(productFormExports.requestedBy, userId);

      const rows = await trx
        .select()
        .from(productFormExports)
        .where(owned)
        .orderBy(desc(productFormExports.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const [totalRow] = await trx.select({ value: count() }).from(productFormExports).where(owned);

      return {
        data: rows.map((row) => ({
          exportId: row.id,
          status: row.status,
          requestedCount: row.requestedMasterIds.length,
          productCount: row.productCount,
          errorMessage: row.errorMessage,
          consecutiveFailures: row.consecutiveFailures,
          downloadable: row.status === 'completed' && row.fileId !== null,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        })),
        total: totalRow?.value ?? 0,
        page,
        limit,
      };
    }, tx);
  }
```

`getStatus` 의 반환 객체에 한 줄 추가: `consecutiveFailures: row.consecutiveFailures,`

- [ ] **Step 5: 서비스·컨트롤러를 잇는다**

`form-export.service.ts`:

```typescript
  list(userId: string, page: number, limit: number): Promise<FormExportListDto> {
    return this.manager.list(userId, page, limit);
  }
```

`form-export.controller.ts` — **`@Get('blank')` 보다 위**에 둔다(루트 경로라 충돌하지는 않지만, 선언 순서를 읽는 사람이 헷갈리지 않게 목록을 맨 앞에 둔다):

```typescript
  @Get()
  @ApiOperation({ summary: '내 양식 생성 목록(페이지)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: FormExportListDto })
  async list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @User() user: { userId: string },
  ): Promise<FormExportListDto> {
    return this.service.list(user.userId, parsePage(page), parseLimit(limit));
  }
```

`Query`·`ApiQuery` import 와 `parsePage`/`parseLimit` import 를 더한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx jest --testPathPattern='form-export.manager'`
Expected: PASS — 기존 테스트 + 신규 2건

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session
git commit -m "$(cat <<'EOF'
feat(form-export): 내 양식 생성 목록 API + 연속 실패 횟수 노출

모달을 닫으면 exportId 가 유실되고 목록 API 가 없어, 완성된 xlsx 가
30일 TTL 동안 아무도 못 받는 고아로 남았다. GET /product-forms 를 세션
목록과 같은 관례(page/limit, { data, total, page, limit })로 더한다.

consecutiveFailures 를 함께 실어, 화면이 status=running 인데 0 보다 큰
경우를 "재시도 대기 중"으로 구분할 수 있게 한다 — 상태 enum 을 늘리지
않으므로 서버 상태 기계는 그대로다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 3: 중복 요청 제거

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.ts:26-46` (`accept`)
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/dto/form-export-response.dto.ts` (`FormExportAcceptedDto.reused`)
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.spec.ts`

**Interfaces:**
- Produces: `FormExportAcceptedDto` 에 `reused: boolean` 추가. `accept` 시그니처는 그대로.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
describe('FormExportManager.accept 중복 제거', () => {
  function acceptHarness(inFlight: Record<string, unknown>[]) {
    const inserted: Record<string, unknown>[] = [];
    const trx = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(inFlight) }) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => {
            inserted.push(v);
            return Promise.resolve([{ id: 'NEW', ...v }]);
          },
        }),
      }),
    };
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );
    return { manager, inserted };
  }

  it('같은 집합의 진행 중 잡이 있으면 그것을 돌려주고 새로 만들지 않는다', async () => {
    const { manager, inserted } = acceptHarness([
      { id: 'E1', status: 'running', requestedMasterIds: ['m1', 'm2'] },
    ]);

    const result = await manager.accept(['m1', 'm2'], 'U1');

    expect(result).toEqual({ exportId: 'E1', status: 'running', requestedCount: 2, reused: true });
    expect(inserted).toHaveLength(0);
  });

  it('순서만 다른 같은 집합도 재사용한다', async () => {
    const { manager, inserted } = acceptHarness([
      { id: 'E1', status: 'queued', requestedMasterIds: ['m2', 'm1'] },
    ]);

    const result = await manager.accept(['m1', 'm2'], 'U1');

    expect(result.exportId).toBe('E1');
    expect(result.reused).toBe(true);
    expect(inserted).toHaveLength(0);
  });

  it('중복된 masterId 를 제거한 뒤 비교한다', async () => {
    const { manager } = acceptHarness([
      { id: 'E1', status: 'running', requestedMasterIds: ['m1', 'm2'] },
    ]);

    const result = await manager.accept(['m1', 'm2', 'm2'], 'U1');

    expect(result.reused).toBe(true);
    expect(result.requestedCount).toBe(2);
  });

  it('집합이 다르면 새 잡을 만든다', async () => {
    const { manager, inserted } = acceptHarness([
      { id: 'E1', status: 'running', requestedMasterIds: ['m1'] },
    ]);

    const result = await manager.accept(['m1', 'm2'], 'U1');

    expect(result.exportId).toBe('NEW');
    expect(result.reused).toBe(false);
    expect(inserted).toHaveLength(1);
  });

  it('진행 중 잡이 없으면 새 잡을 만든다', async () => {
    const { manager, inserted } = acceptHarness([]);

    const result = await manager.accept(['m1'], 'U1');

    expect(result).toEqual({ exportId: 'NEW', status: 'queued', requestedCount: 1, reused: false });
    expect(inserted).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx jest --testPathPattern='form-export.manager' -t '중복 제거'`
Expected: FAIL — 첫 케이스가 `exportId: 'NEW'`, `reused: undefined` 로 나온다

- [ ] **Step 3: 구현한다**

`FormExportAcceptedDto` 를 고친다 — `status` 는 재사용 시 `running` 일 수 있으므로 유니온을 넓힌다:

```typescript
export class FormExportAcceptedDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued', 'running'] }) status: 'queued' | 'running';
  @ApiProperty({ description: '요청한 상품 수' }) requestedCount: number;
  @ApiProperty({ description: '진행 중인 같은 요청을 재사용했으면 true' }) reused: boolean;
}
```

`accept` 를 고친다:

```typescript
  async accept(masterIds: string[], userId: string, tx?: DbTransaction): Promise<FormExportAcceptedDto> {
    const unique = [...new Set(masterIds)];

    return this.db.run(async (trx) => {
      // 진행 중인 같은 요청이 있으면 그것을 돌려준다. 워커가 인스턴스당 한 번에 잡
      // 하나만 처리하는 직렬 큐라, 중복 잡은 남의 대기시간을 직접 늘린다.
      //
      // SQL 배열 동등 비교(requested_master_ids = ...)를 쓰지 않는 이유: 그러려면 저장 시
      // 정렬이 전제인데 기존 행들은 정렬돼 있지 않아 영영 매칭되지 않는다. 진행 중 잡은
      // 보통 0~2건이므로 가져와서 집합으로 비교한다 — 선택 순서가 달라도 같게 본다.
      const inFlight = await trx
        .select()
        .from(productFormExports)
        .where(
          and(
            eq(productFormExports.requestedBy, userId),
            inArray(productFormExports.status, ['queued', 'running']),
          ),
        );

      const wanted = new Set(unique);
      const match = inFlight.find((row) => sameIdSet(row.requestedMasterIds, wanted));
      if (match) {
        return {
          exportId: match.id,
          status: match.status === 'running' ? ('running' as const) : ('queued' as const),
          requestedCount: unique.length,
          reused: true,
        };
      }

      const expiresAt = new Date(Date.now() + FORM_EXPORT_TTL_DAYS * 86_400_000);
      const [row] = await trx
        .insert(productFormExports)
        .values({
          requestedBy: userId,
          requestedMasterIds: unique,
          status: 'queued',
          productCount: 0,
          expiresAt,
        })
        .returning();
      if (!row) throw new Error('양식 생성 잡을 만들지 못했습니다');

      // items 는 여기서 만들지 않는다 — 조립 시점에 실제 active 를 확인한 것만 담긴다.
      return { exportId: row.id, status: 'queued' as const, requestedCount: unique.length, reused: false };
    }, tx);
  }
```

같은 파일 하단(클래스 밖)에 순수 헬퍼를 둔다:

```typescript
/**
 * 저장된 masterId 배열이 요청 집합과 같은지 본다. 저장본에 중복이 있을 수 있어
 * (옛 행은 정렬도 중복 제거도 보장되지 않는다) 길이 비교 대신 Set 으로 접는다.
 */
function sameIdSet(stored: string[], wanted: Set<string>): boolean {
  const storedSet = new Set(stored);
  if (storedSet.size !== wanted.size) return false;
  for (const id of storedSet) {
    if (!wanted.has(id)) return false;
  }
  return true;
}
```

import 에 `and`·`inArray` 를 더한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern='form-export.manager'`
Expected: PASS — 신규 5건 포함 전부

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session
git commit -m "$(cat <<'EOF'
feat(form-export): 진행 중인 같은 요청을 재사용해 중복 잡을 막는다

accept() 가 조건 없이 INSERT 해서, 모달을 여닫을 때마다 새 잡이 쌓였다.
워커는 인스턴스당 한 번에 잡 하나만 처리하는 직렬 큐라 중복 잡이 남의
대기시간을 직접 늘린다.

SQL 배열 동등 비교 대신 JS 집합 비교를 쓴다 — 배열 비교는 저장 시 정렬이
전제인데 이미 쌓인 행들은 정렬돼 있지 않아 영영 매칭되지 않는다. 집합
비교는 그 문제도, 선택 순서가 다른 경우도 함께 없앤다.

완료된 잡은 재사용하지 않는다. 그 사이 상품 데이터가 바뀌었을 수 있다.
동시 요청 레이스는 남는다 — 닫으려면 부분 유니크 인덱스(마이그레이션)가
필요하고, 비용은 중복 잡 한 건이며 사용자는 목록에서 그것을 본다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 4: 재시도와 점유 분리 (CAS + claim 시점 실패 카운트)

**이 둘은 반드시 함께 간다.** CAS 없이 재시도를 줄이면 좀비가 후임의 lease 를 깎아 이중 조립 → 영구 고아 xlsx 이고, claim 카운트 없이 CAS 만 넣으면 연속 실패 카운터가 상한에 영원히 못 닿아 무한 재시도가 된다. 한쪽만 머지하면 회귀다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.ts` (`claim`·`recordJobError`·상수)
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.worker.ts:59`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.spec.ts`

**Interfaces:**
- Produces:
  - `FORM_EXPORT_RETRY_DELAY_MS = 60_000`
  - `recordJobError(exportId: string, leaseToken: string, message: string): Promise<void>` — **인자 3개로 바뀐다**
  - `claim(tx?: DbTransaction): Promise<ClaimedExport | null>` — 시그니처 그대로, 동작만 확장

- [ ] **Step 1: 실패하는 테스트를 쓴다**

이 스펙 파일에는 이미 `makeHarness(opts)` 가 있다 — `{ manager, updates, deletes, inserts, trx, buildPrefill, upload }` 를 돌려주고, `update().set().where()` 호출을 `updates` 에 쌓으며, `.returning()` 은 `opts.returningRows` 를 순서대로 낸다. 새 페이크를 만들지 말고 이걸 쓴다.

**먼저 한 줄 손봐야 한다:** `makeHarness` 의 `opts.claimed` 타입이 `Array<{ id: string }>` 이라 `consecutive_failures` 를 못 싣는다. `Array<{ id: string; consecutive_failures?: number }>` 로 넓힌다.

```typescript
describe('recordJobError 토큰 CAS', () => {
  it('토큰이 일치하면 실패를 기록하고 재시도 대기를 짧게 되돌린다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ failures: 1 }]] });

    await manager.recordJobError('exp-1', 'TOKEN-1', 'boom');

    expect(updates).toHaveLength(1);
    expect(updates[0].values.errorMessage).toBe('boom');
    // lease 를 짧게 되돌리는 것이 이 변경의 핵심이다 — 예전엔 이 값을 아예 안 건드렸다.
    expect(updates[0].values.leaseUntil).toBeDefined();
  });

  it('토큰이 다르면(좀비) 두 번째 UPDATE 로 넘어가지 않는다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[]] });

    await manager.recordJobError('exp-1', 'STALE-TOKEN', 'boom');

    // CAS 0행 매치 → failed 확정 UPDATE 가 없어야 한다
    expect(updates).toHaveLength(1);
  });

  it('상한에 닿으면 failed 로 확정하고 lease 를 푼다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ failures: 3 }]] });

    await manager.recordJobError('exp-1', 'TOKEN-1', 'boom');

    expect(updates).toHaveLength(2);
    expect(updates[1].values).toEqual({ status: 'failed', leaseUntil: null, leaseToken: null });
  });
});

describe('claim 이 재클레임을 실패로 센다', () => {
  it('상한 미만이면 잡을 돌려준다', async () => {
    const { manager } = makeHarness({ claimed: [{ id: 'exp-1', consecutive_failures: 1 }] });

    const claimed = await manager.claim();

    expect(claimed?.exportId).toBe('exp-1');
  });

  it('재클레임 누적이 상한이면 조립하지 않고 failed 로 확정한 뒤 null 을 돌려준다', async () => {
    const { manager, updates } = makeHarness({
      claimed: [{ id: 'exp-1', consecutive_failures: MAX_CONSECUTIVE_EXPORT_FAILURES }],
    });

    const claimed = await manager.claim();

    expect(claimed).toBeNull();
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ status: 'failed', leaseUntil: null, leaseToken: null });
  });
});
```

> **`CASE WHEN lease_token IS NULL` 자체는 단위 테스트로 잠글 수 없다.** 목 `trx.execute` 는 SQL 을 실행하지 않고 미리 정한 행을 돌려줄 뿐이라, SQL 문자열을 문자열로 단정하는 테스트는 의미가 없다(리팩터링에 깨지고 동작은 안 본다). 그 의미론은 Step 6 의 실 DB 통합 케이스가 잠근다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx jest --testPathPattern='form-export-job.manager'`
Expected: FAIL — `recordJobError` 가 인자 2개, `claim` 이 카운트를 안 봄

- [ ] **Step 3: 상수와 `recordJobError` 를 고친다**

```typescript
/**
 * 실패 후 다음 시도까지의 대기. **lease 와 다른 축이다** — lease(30분)는 조립 중 점유를
 * 지키는 값이고, 이 값은 "실패한 잡을 얼마 뒤에 다시 집을까"다. recordJobError 는 예외가
 * 던져진 뒤에 불리므로 그 시점엔 조립이 이미 끝났고, lease 의 점유 보호 역할도 끝났다 —
 * 그래서 여기서만 짧게 되돌려도 살아있는 작업을 뺏지 않는다. 워커 틱이 10초라 3회
 * 결론까지 약 2~3분이다.
 */
export const FORM_EXPORT_RETRY_DELAY_MS = 60_000;
```

`recordJobError` — 독스트링을 새 설계로 갈아끼운다(옛 독스트링은 CAS 를 안 거는 이유를 설명하므로 **반드시 지운다**):

```typescript
  /**
   * 조립 중 예외를 기록하고 다음 시도를 예약한다.
   *
   * **토큰 CAS 를 건다.** 이건 재시도 단축의 전제조건이다 — CAS 없이 lease_until 을
   * 짧게 쓰면 좀비(lease 를 잃고도 살아있던 워커)가 **후임의 살아있는 잡**의 lease 를
   * 깎아 제3의 워커가 그 잡을 집어가고, 이중 조립·이중 업로드가 되어 file-service 에
   * 고아 정리 잡이 없으니 진 쪽 xlsx 가 영구 고아로 남는다.
   *
   * CAS 가 뚫는 구멍(좀비의 실패가 안 세어져 연속 실패 상한에 영원히 못 닿음)은 claim
   * 이 막는다 — 거기서 "lease 안에 못 끝낸 시도"를 재클레임 시점에 센다. 두 곳을 합치면
   * 실패한 시도가 정확히 한 번씩, 올바른 잡에 귀속된다.
   *
   * 종결 상태(completed/failed)는 WHERE 에서 계속 제외한다. 토큰 CAS 만으로도 대부분
   * 막히지만, 성공한 잡을 되돌리는 사고는 대가가 커서 가드를 이중으로 둔다.
   */
  async recordJobError(exportId: string, leaseToken: string, message: string): Promise<void> {
    await this.db.run(async (trx) => {
      const [row] = await trx
        .update(productFormExports)
        .set({
          errorMessage: message,
          consecutiveFailures: sql`${productFormExports.consecutiveFailures} + 1`,
          leaseUntil: sql`NOW() + ${FORM_EXPORT_RETRY_DELAY_MS} * interval '1 millisecond'`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productFormExports.id, exportId),
            eq(productFormExports.leaseToken, leaseToken),
            notInArray(productFormExports.status, TERMINAL_EXPORT_STATUSES),
          ),
        )
        .returning({ failures: productFormExports.consecutiveFailures });

      if (!row) {
        this.logger.warn(
          `양식 생성 잡 ${exportId} 의 실패 기록을 건너뜁니다 — lease 토큰이 일치하지 않습니다(좀비 워커)`,
        );
        return;
      }

      if (row.failures >= MAX_CONSECUTIVE_EXPORT_FAILURES) {
        await trx
          .update(productFormExports)
          .set({ status: 'failed', leaseUntil: null, leaseToken: null })
          .where(eq(productFormExports.id, exportId));
        this.logger.error(`양식 생성 잡 ${exportId} 이 연속 실패 상한에 닿아 failed 로 확정됐습니다`);
      }
    });
  }
```

- [ ] **Step 4: `claim` 이 재클레임을 세게 한다**

```typescript
  async claim(tx?: DbTransaction): Promise<ClaimedExport | null> {
    const leaseToken = uuidv7();
    return this.db.run(async (trx) => {
      // lease_token 이 남아 있는 행을 집었다는 건 **직전 소유자가 못 끝내고 죽었다**는
      // 뜻이다(정상 종료는 완료/실패로 lease 를 푼다). recordJobError 의 토큰 CAS 는
      // 그 좀비의 뒤늦은 예외를 버리므로, 그 실패를 여기서 원자적으로 센다 — 이게 없으면
      // 매 시도가 lease 를 넘기는 잡은 카운터가 영원히 안 올라 무한 재시도가 된다.
      // 첫 클레임(queued, 토큰 NULL)은 실패가 아니므로 세지 않는다.
      const rows = await trx.execute<{ id: string; consecutive_failures: number }>(sql`
        UPDATE product_form_exports
           SET status = 'running',
               lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid,
               consecutive_failures = consecutive_failures
                                    + CASE WHEN lease_token IS NULL THEN 0 ELSE 1 END,
               updated_at = NOW()
         WHERE id = (
           SELECT id
             FROM product_form_exports
            WHERE status IN ('queued', 'running')
              AND (lease_until IS NULL OR lease_until < NOW())
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id, consecutive_failures
      `);
      const [row] = rows as unknown as Array<{ id: string; consecutive_failures: number }>;
      if (!row) return null;

      // 재클레임 카운트가 상한을 채웠다면 조립할 이유가 없다 — 바로 확정하고 이 틱은 쉰다.
      if (row.consecutive_failures >= MAX_CONSECUTIVE_EXPORT_FAILURES) {
        await trx
          .update(productFormExports)
          .set({ status: 'failed', leaseUntil: null, leaseToken: null })
          .where(eq(productFormExports.id, row.id));
        this.logger.error(
          `양식 생성 잡 ${row.id} 이 재클레임 누적으로 연속 실패 상한에 닿아 failed 로 확정됐습니다`,
        );
        return null;
      }

      return { exportId: row.id, leaseToken };
    }, tx);
  }
```

- [ ] **Step 5: 워커가 토큰을 넘기게 한다**

`form-export-job.worker.ts:59`:

```typescript
      if (claimed) await this.jobManager.recordJobError(claimed.exportId, claimed.leaseToken, message);
```

- [ ] **Step 6: 실 DB 통합 케이스로 `CASE WHEN` 의미론을 잠근다**

`form-export-job-lease.integration.spec.ts` 에 케이스를 더한다. 이 파일은 이미 `MAX_CONSECUTIVE_EXPORT_FAILURES` 를 import 하고, 일회용 스키마에 실제 행을 넣는 `seedQueuedExport()`·`readExport(id)` 헬퍼와 두 워커 `a`/`b`(각각 `{ manager, buildPrefill, upload }`), admin 커넥션 `admin` 을 갖고 있다. **`readExport` 는 이미 `consecutive_failures` 를 셀렉트한다** — 새 헬퍼가 필요 없다.

```typescript
it('첫 클레임(lease_token NULL)은 실패로 세지 않는다', async () => {
  const exportId = await seedQueuedExport();

  const claimed = await a.manager.claim();

  expect(claimed?.exportId).toBe(exportId);
  expect(Number((await readExport(exportId)).consecutive_failures)).toBe(0);
});

it('lease 만료 재클레임은 직전 시도를 실패로 센다', async () => {
  const exportId = await seedQueuedExport();
  // 1회차 클레임이 토큰을 박고 lease 를 미래로 민다.
  await a.manager.claim();
  // 워커가 끝내지 못한 채 lease 만 만료된 상황을 만든다.
  await admin`
    UPDATE product_form_exports SET lease_until = NOW() - interval '1 minute' WHERE id = ${exportId}
  `;

  const reclaimed = await b.manager.claim();

  expect(reclaimed?.exportId).toBe(exportId);
  expect(Number((await readExport(exportId)).consecutive_failures)).toBe(1);
});
```

> **이 스위트는 스크래치 DB(`sdd_stage1_scratch`)에 core 마이그레이션을 올리고 그 `DATABASE_URL` 로 돌려야 한다.** 환경이 없으면 스킵된다 — 스킵된 채로 태스크를 완료로 표시하지 말고, **돌리지 못했다면 그 사실을 보고하라.** 이 두 케이스가 CASE 의미론의 유일한 검증이다.

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx jest --testPathPattern='form-export-job'`
Expected: PASS — 기존 + 신규 단위 5건

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session
git commit -m "$(cat <<'EOF'
fix(form-export): 재시도 대기를 조립 점유와 분리해 90분을 2~3분으로

lease_until 한 컬럼이 "조립 중 점유 보호"와 "재시도 대기" 둘을 겸하고
있어, 일시적 실패의 결론이 lease(30분) × 상한(3회) = 약 90분이었다.
그동안 상태는 running 이라 화면은 스피너만 돌았다.

lease 상수는 그대로 두고 recordJobError 에서만 짧게 되돌린다. 그 메서드는
예외가 던져진 뒤에 불리므로 조립이 이미 끝났고 점유 보호 역할도 끝났다.

전제조건으로 토큰 CAS 를 건다 — 없으면 좀비가 후임의 살아있는 잡의 lease
를 깎아 이중 조립으로 영구 고아 xlsx 가 된다. CAS 가 뚫는 구멍(좀비의
실패가 안 세어져 상한에 못 닿음)은 claim 이 재클레임 시점에 센다:
lease_token 이 남아 있으면 직전 소유자가 못 끝내고 죽은 것이므로 +1.
현행이 아예 못 세던 경우(워커 강제 종료로 catch 미실행)까지 잡힌다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 5: 재시도 라우트

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.service.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/form-export.controller.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.spec.ts`

**Interfaces:**
- Consumes: `accept` (Task 3)
- Produces: `FormExportManager.retry(exportId: string, userId: string, tx?: DbTransaction): Promise<FormExportAcceptedDto>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
describe('FormExportManager.retry', () => {
  it('원본의 masterIds 로 accept 를 다시 부른다', async () => {
    const trx = {
      select: () => ({
        from: () => ({
          where: () => {
            const p = Promise.resolve([{ id: 'E1', requestedBy: 'U1', requestedMasterIds: ['m1', 'm2'] }]);
            return Object.assign(p, { limit: () => p });
          },
        }),
      }),
    };
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );
    const spy = jest.spyOn(manager, 'accept').mockResolvedValue({
      exportId: 'NEW',
      status: 'queued',
      requestedCount: 2,
      reused: false,
    });

    const result = await manager.retry('E1', 'U1');

    expect(spy).toHaveBeenCalledWith(['m1', 'm2'], 'U1', expect.anything());
    expect(result.exportId).toBe('NEW');
  });

  it('남의 잡은 404 다 — 존재 여부를 알려주지 않는다', async () => {
    const trx = {
      select: () => ({
        from: () => ({
          where: () => {
            const p = Promise.resolve([{ id: 'E1', requestedBy: 'OTHER', requestedMasterIds: ['m1'] }]);
            return Object.assign(p, { limit: () => p });
          },
        }),
      }),
    };
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );

    await expect(manager.retry('E1', 'U1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('없는 잡도 404 다', async () => {
    const trx = {
      select: () => ({
        from: () => ({
          where: () => {
            const p = Promise.resolve([]);
            return Object.assign(p, { limit: () => p });
          },
        }),
      }),
    };
    const manager = new FormExportManager(
      { run: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never,
      {} as never,
    );

    await expect(manager.retry('MISSING', 'U1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx jest --testPathPattern='form-export.manager' -t 'FormExportManager.retry'`
Expected: FAIL — `manager.retry is not a function`

- [ ] **Step 3: 구현한다**

```typescript
  /**
   * 같은 상품 집합으로 다시 뽑는다. 별도 경로를 만들지 않고 accept 를 그대로 부르는
   * 이유는, 그래야 중복 제거·응답 모양·reused 플래그가 자동으로 똑같이 적용되기
   * 때문이다.
   *
   * **원본 상태에 제약을 두지 않는다.** failed 든 completed 든 "이 집합으로 다시
   * 뽑아줘"는 언제나 정당하고, 노출은 화면이 통제한다. 서버에 상태 제약을 넣으면
   * 화면 표와 서버 표를 둘 다 관리해야 한다.
   */
  async retry(exportId: string, userId: string, tx?: DbTransaction): Promise<FormExportAcceptedDto> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(productFormExports)
        .where(eq(productFormExports.id, exportId))
        .limit(1);
      // getStatus 와 같은 이유로 소유권 실패를 404 로 합친다 — 구분해 주면 그 구분
      // 자체가 id 존재 여부를 캐는 오라클이 된다.
      if (!row || row.requestedBy !== userId) {
        throw new NotFoundError(`양식 생성 잡을 찾을 수 없습니다: ${exportId}`);
      }
      return this.accept(row.requestedMasterIds, userId, trx);
    }, tx);
  }
```

서비스:

```typescript
  retry(exportId: string, userId: string): Promise<FormExportAcceptedDto> {
    return this.manager.retry(exportId, userId);
  }
```

컨트롤러 — **`@Get(':exportId')` 계열과 섞이지 않게 POST 라 충돌은 없다**:

```typescript
  @Post(':exportId/retry')
  @HttpCode(202)
  @ApiOperation({ summary: '같은 상품 집합으로 양식 생성을 다시 접수한다' })
  @ApiResponse({ status: 202, type: FormExportAcceptedDto })
  @ApiResponse({ status: 404, description: '없거나 내 잡이 아님' })
  async retry(
    @Param('exportId') exportId: string,
    @User() user: { userId: string },
  ): Promise<FormExportAcceptedDto> {
    return this.service.retry(exportId, user.userId);
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern='form-export'`
Expected: PASS

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session
git commit -m "$(cat <<'EOF'
feat(form-export): 같은 상품 집합으로 다시 뽑는 재시도 라우트

목록에서 실패한 잡을 되살리려면 상품을 처음부터 다시 선택해야 했다.
서버가 requested_master_ids 를 갖고 있으니 그걸로 accept 를 다시 부른다.

별도 경로를 만들지 않고 accept 를 재사용해 중복 제거·reused 플래그가
자동으로 같게 적용되게 한다. 원본 상태에 제약을 두지 않는다 — 노출은
화면이 통제하고, 서버에 제약을 넣으면 표를 두 곳에서 관리하게 된다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 6: admin-web — 타입 · 클라이언트 · 훅 · 순수 판정

여기부터 화면이다. **컴포넌트 테스트가 불가능하므로**, 이 태스크가 판정 로직을 전부 순수 함수로 뽑아 놓는 것이 뒤 태스크들의 검증 기반이 된다.

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/form-export.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/form-export.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/form-export.ts`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.ts`
- Create: `apps/admin-web/src/lib/services/products/form-export-model.ts`
- Create: `apps/admin-web/src/lib/services/products/form-export-model.spec.ts`

**Interfaces:**
- Produces:
  - `FormExportSummary` · `FormExportList` 타입
  - `formExportListRefetchInterval(list: FormExportList | undefined): number | false`
  - `formExportRowState(item: FormExportSummary): FormExportRowState`
  - `FormExportRowState = { label: string; tone: 'pending' | 'progress' | 'error' | 'done'; action: 'none' | 'download' | 'retry' }`
  - `useFormExportList(page, limit)` · `useRetryFormExport()`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`form-export-model.spec.ts`:

```typescript
import {
  formExportListRefetchInterval,
  formExportRowState,
} from './form-export-model';
import type { FormExportSummary } from '@/lib/types/dto/form-export';

function item(over: Partial<FormExportSummary> = {}): FormExportSummary {
  return {
    exportId: 'E1',
    status: 'queued',
    requestedCount: 3,
    productCount: 0,
    errorMessage: null,
    consecutiveFailures: 0,
    downloadable: false,
    createdAt: '2026-08-06T00:00:00.000Z',
    expiresAt: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

describe('양식 생성 목록 폴링 간격', () => {
  it('데이터가 아직 없으면 계속 두드린다', () => {
    expect(formExportListRefetchInterval(undefined)).toBe(5000);
  });

  it('진행 중 항목이 하나라도 있으면 계속 두드린다', () => {
    const list = { data: [item({ status: 'completed' }), item({ status: 'running' })], total: 2, page: 1, limit: 20 };
    expect(formExportListRefetchInterval(list)).toBe(5000);
  });

  it('전부 종결이면 멈춘다', () => {
    const list = { data: [item({ status: 'completed' }), item({ status: 'failed' })], total: 2, page: 1, limit: 20 };
    expect(formExportListRefetchInterval(list)).toBe(false);
  });

  it('빈 목록이면 멈춘다', () => {
    expect(formExportListRefetchInterval({ data: [], total: 0, page: 1, limit: 20 })).toBe(false);
  });
});

describe('양식 생성 행 상태 판정', () => {
  it('queued 는 대기 중이고 액션이 없다', () => {
    expect(formExportRowState(item({ status: 'queued' }))).toEqual({
      label: '대기 중',
      tone: 'pending',
      action: 'none',
    });
  });

  it('running 이고 실패가 없으면 생성 중이다', () => {
    expect(formExportRowState(item({ status: 'running' }))).toEqual({
      label: '생성 중',
      tone: 'progress',
      action: 'none',
    });
  });

  it('running 인데 연속 실패가 있으면 재시도 대기 중이다', () => {
    expect(formExportRowState(item({ status: 'running', consecutiveFailures: 2 }))).toEqual({
      label: '재시도 대기 중 (2/3)',
      tone: 'error',
      action: 'none',
    });
  });

  it('완료면 다운로드를 준다', () => {
    expect(formExportRowState(item({ status: 'completed', downloadable: true, productCount: 3 }))).toEqual({
      label: '완료',
      tone: 'done',
      action: 'download',
    });
  });

  it('completed 인데 파일이 없으면 다운로드를 주지 않는다', () => {
    expect(formExportRowState(item({ status: 'completed', downloadable: false }))).toEqual({
      label: '완료 (파일 없음)',
      tone: 'error',
      action: 'none',
    });
  });

  it('실패면 다시 시도를 준다', () => {
    expect(formExportRowState(item({ status: 'failed', errorMessage: 'boom' }))).toEqual({
      label: '실패',
      tone: 'error',
      action: 'retry',
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx jest --testPathPattern='form-export-model'`
Expected: FAIL — `Cannot find module './form-export-model'`

- [ ] **Step 3: 타입을 더한다**

`lib/types/dto/form-export.ts` — `FormExportAccepted` 에 `reused`·넓힌 `status`, `FormExportStatus` 에 `consecutiveFailures`, 그리고:

```typescript
export interface FormExportAccepted {
  exportId: string;
  status: 'queued' | 'running';
  requestedCount: number;
  /** 진행 중인 같은 요청을 재사용했으면 true. */
  reused: boolean;
}

export interface FormExportSummary {
  exportId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  requestedCount: number;
  productCount: number;
  errorMessage: string | null;
  /** running 인데 0 보다 크면 재시도 대기 중이다. */
  consecutiveFailures: number;
  downloadable: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface FormExportList {
  data: FormExportSummary[];
  total: number;
  page: number;
  limit: number;
}
```

`FormExportStatus` 에 `consecutiveFailures: number;` 를 더한다.

- [ ] **Step 4: 순수 판정을 구현한다**

`form-export-model.ts`:

```typescript
// src/lib/services/products/form-export-model.ts
// 양식 생성 목록의 판정 로직. admin-web 은 컴포넌트 테스트가 불가능하므로(렌더러 없음)
// 화면이 쓰는 판정은 전부 여기 순수 함수로 두고 spec 으로 잠근다.

import type { FormExportList, FormExportSummary } from '@/lib/types/dto/form-export';

/** 서버의 MAX_CONSECUTIVE_EXPORT_FAILURES 와 같은 값. 문구에만 쓴다. */
const MAX_FAILURES = 3;

export interface FormExportRowState {
  label: string;
  tone: 'pending' | 'progress' | 'error' | 'done';
  action: 'none' | 'download' | 'retry';
}

/**
 * 진행 중 항목이 하나라도 있으면 계속 두드린다. 데이터가 아직 없을 때(초기 로드·일시적
 * 5xx)도 두드린다 — 여기서 멈추면 화면이 마운트 내내 굳는다(formExportRefetchInterval
 * 이 같은 이유로 그렇게 돼 있었다).
 */
export function formExportListRefetchInterval(list: FormExportList | undefined): number | false {
  if (!list) return 5000;
  const running = list.data.some((item) => item.status === 'queued' || item.status === 'running');
  return running ? 5000 : false;
}

/**
 * 행 하나의 표시·액션을 정한다.
 *
 * 서버는 실패해도 상태를 running 으로 두고 consecutiveFailures 만 올린다(상한에 닿아야
 * failed). 그래서 "생성 중"과 "재시도 대기 중"은 status 가 아니라 이 카운터로 갈린다 —
 * 이 구분이 없으면 사용자는 실패를 진행 중으로 오해한 채 기다린다.
 */
export function formExportRowState(item: FormExportSummary): FormExportRowState {
  if (item.status === 'failed') {
    return { label: '실패', tone: 'error', action: 'retry' };
  }
  if (item.status === 'completed') {
    return item.downloadable
      ? { label: '완료', tone: 'done', action: 'download' }
      : { label: '완료 (파일 없음)', tone: 'error', action: 'none' };
  }
  if (item.status === 'running') {
    return item.consecutiveFailures > 0
      ? {
          label: `재시도 대기 중 (${item.consecutiveFailures}/${MAX_FAILURES})`,
          tone: 'error',
          action: 'none',
        }
      : { label: '생성 중', tone: 'progress', action: 'none' };
  }
  return { label: '대기 중', tone: 'pending', action: 'none' };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern='form-export-model'`
Expected: PASS (10 tests)

- [ ] **Step 6: 클라이언트·훅·쿼리키를 잇는다**

`form-export.client.ts` 에 추가:

```typescript
  list: async (page: number, limit: number): Promise<FormExportList> => {
    const res = await client.get(BASE, { params: { page, limit } });
    return res.data;
  },

  retry: async (exportId: string): Promise<FormExportAccepted> => {
    const res = await client.post(`${BASE}/${exportId}/retry`);
    return res.data;
  },
```

`query-keys.ts` 에 추가:

```typescript
  formExportList: (page: number, limit: number) =>
    [...productQueryKeys.formExports, 'list', page, limit] as const,
```

`form-export.ts` — `useFormExportStatus`·`formExportRefetchInterval`·`isFormExportRunning` 을 **지우고**(단건 폴링은 모달과 함께 사라진다) 다음을 더한다:

```typescript
export function useFormExportList(page: number, limit: number) {
  return useQuery({
    queryKey: productQueryKeys.formExportList(page, limit),
    queryFn: () => products.formExport.list(page, limit),
    refetchInterval: (query) => formExportListRefetchInterval(query.state.data),
  });
}

export function useRetryFormExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (exportId: string) => products.formExport.retry(exportId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productQueryKeys.formExports });
    },
  });
}
```

> `useRequestFormExport` 는 남긴다 — Task 10 의 상품목록이 계속 쓴다.

- [ ] **Step 7: 타입 체크와 커밋**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit 2>&1 | grep -E 'form-export|bulk-sessions|products-list' || echo "관련 파일 신규 에러 없음"`
Expected: 관련 파일에 신규 에러 없음 (저장소 전역 admin-web type-check 는 상시 debt 다 — 변경 파일만 본다)

Run: `npx jest --testPathPattern='form-export-model'`
Expected: PASS

```bash
git add apps/admin-web/src/lib
git commit -m "$(cat <<'EOF'
feat(admin-web): 양식 생성 목록 타입·클라이언트·훅과 순수 판정 분리

목록 화면이 쓸 API 배선과 판정 로직을 먼저 놓는다. admin-web 은 렌더러가
없어 컴포넌트 테스트가 불가능하므로, 행 상태·폴링 간격 판정을 순수 함수로
뽑아 spec 으로 잠근다 — 컴포넌트에 남기면 검증되지 않는다.

"생성 중"과 "재시도 대기 중"은 status 가 아니라 consecutiveFailures 로
갈린다. 서버가 실패해도 상한 전까지는 running 을 유지하기 때문이다.

단건 폴링 훅(useFormExportStatus)은 모달과 함께 사라지므로 제거한다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 7: admin-web — 탭 파라미터 파싱

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/tab-param.ts`
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/tab-param.spec.ts`

**Interfaces:**
- Produces: `BulkSessionsTab = 'sessions' | 'forms'` · `parseBulkSessionsTab(raw: string | undefined): BulkSessionsTab`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { parseBulkSessionsTab } from './tab-param';

describe('일괄 등록 화면 탭 파라미터', () => {
  it('없으면 업로드 세션이 기본이다 — 사이드바 동선의 기존 동작을 보존한다', () => {
    expect(parseBulkSessionsTab(undefined)).toBe('sessions');
    expect(parseBulkSessionsTab('')).toBe('sessions');
  });

  it('forms 를 인식한다', () => {
    expect(parseBulkSessionsTab('forms')).toBe('forms');
  });

  it('모르는 값은 기본으로 떨어진다', () => {
    expect(parseBulkSessionsTab('nope')).toBe('sessions');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx jest --testPathPattern='tab-param'`
Expected: FAIL — `Cannot find module './tab-param'`

- [ ] **Step 3: 구현한다**

```typescript
// src/features/mall/bulk-sessions/lib/tab-param.ts
// ?tab= 파싱. 판정을 컴포넌트에 두면 검증할 수 없어(admin-web 은 컴포넌트 테스트 불가)
// 순수 함수로 뽑는다.

export type BulkSessionsTab = 'sessions' | 'forms';

/**
 * 기본값이 'sessions' 인 이유: 사이드바 메뉴로 들어오는 기존 동선이 지금까지 세션
 * 목록을 보여줬다. 상품 목록에서 새 탭으로 열 때만 ?tab=forms 를 붙인다.
 */
export function parseBulkSessionsTab(raw: string | undefined): BulkSessionsTab {
  return raw === 'forms' ? 'forms' : 'sessions';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern='tab-param'`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/lib/tab-param.ts \
        apps/admin-web/src/features/mall/bulk-sessions/lib/tab-param.spec.ts
git commit -m "$(cat <<'EOF'
feat(admin-web): 일괄 등록 화면 탭 파라미터 파싱

기본값을 sessions 로 둬서 사이드바 동선의 기존 동작을 보존한다.
컴포넌트에 두면 검증할 수 없어 순수 함수로 분리한다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 8: admin-web — 양식 생성 탭 컴포넌트

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/form-export-list/index.tsx`

**Interfaces:**
- Consumes: `useFormExportList`·`useRetryFormExport` (Task 6) · `formExportRowState` (Task 6) · `products.formExport.getDownloadUrl`·`downloadBlank` (기존)
- Produces: `export default function FormExportListTemplate()`

**검증 방식:** 이 태스크에는 자동 테스트가 없다(컴포넌트 테스트 불가). 판정은 Task 6 의 spec 이 이미 잠갔고, 여기서는 **타입 체크 + 수동 스모크**로 확인한다.

- [ ] **Step 1: 컴포넌트를 만든다**

`session-list/index.tsx` 의 구조(Container/Header/DataTable/useDataTable/useQueryParams)를 그대로 따른다. 핵심 배선:

```tsx
'use client';

import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/data-table';
import { DateCell } from '@/components/table/table-cells/common';
import { useDataTable } from '@/hooks/use-data-table';
import { useQueryParams } from '@/hooks/use-query-params';
import { products } from '@/lib/api/domains';
import { parseServerError } from '@/lib/api/server-error';
import { useFormExportList, useRetryFormExport } from '@/lib/services/products/form-export';
import { formExportRowState } from '@/lib/services/products/form-export-model';
import type { FormExportSummary } from '@/lib/types/dto/form-export';
import { downloadBlob } from '@/lib/utils/download-blob';

const PAGE_SIZE = 20;

const TONE_VARIANT = {
  pending: 'secondary',
  progress: 'default',
  error: 'destructive',
  done: 'outline',
} as const;
```

컬럼은 `createdAt`(DateCell) · 상품 수(`productCount`/`requestedCount`) · 상태 Badge(`formExportRowState(row).label`) · `expiresAt`(DateCell) · 액션.

액션 셀:

```tsx
function ActionCell({ item }: { item: FormExportSummary }) {
  const retry = useRetryFormExport();
  const state = formExportRowState(item);

  if (state.action === 'download') {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            const { url } = await products.formExport.getDownloadUrl(item.exportId);
            window.location.href = url;
          } catch (error) {
            const parsed = parseServerError(error, '다운로드 링크를 가져오지 못했습니다.');
            toast.error(
              parsed.conflict
                ? '아직 파일 생성이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.'
                : parsed.message,
            );
          }
        }}
      >
        다운로드
      </Button>
    );
  }

  if (state.action === 'retry') {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={retry.isPending}
        onClick={() =>
          retry.mutate(item.exportId, {
            onSuccess: (res) =>
              toast.success(
                res.reused
                  ? '이미 진행 중인 요청이 있어 그것으로 이어집니다.'
                  : '양식 생성을 다시 접수했습니다.',
              ),
            onError: (error) =>
              toast.error(parseServerError(error, '재시도에 실패했습니다.').message),
          })
        }
      >
        다시 시도
      </Button>
    );
  }

  return null;
}
```

헤더에는 **빈 양식 다운로드** 버튼을 둔다 — `session-list/index.tsx:85-92` 의 `downloadBlank`→`downloadBlob(blob, '상품일괄등록_빈양식.xlsx')` 배선을 그대로 옮긴다.

실패 행은 `errorMessage` 를 상태 아래 작은 글씨로 함께 보여준다 — 이게 없으면 "실패"만 보이고 원인을 알 수 없다.

- [ ] **Step 2: 타입 체크**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit 2>&1 | grep -E 'form-export-list' || echo "신규 에러 없음"`
Expected: 신규 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/form-export-list
git commit -m "$(cat <<'EOF'
feat(admin-web): 양식 생성 목록 탭 컴포넌트

표시·액션 판정은 form-export-model 의 순수 함수가 하고 이 컴포넌트는
그리기만 한다. 실패 행은 errorMessage 를 함께 보여준다 — 없으면 "실패"만
보이고 원인을 알 수 없다.

빈 양식 다운로드 버튼을 세션 목록 헤더에서 여기로 옮긴다. 양식을 얻는 두
방법(빈 양식·상품 프리필)이 한 탭에 모이는 게 맞다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 9: admin-web — 탭 컨테이너로 두 목록을 묶는다

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/index.tsx`
- Modify: `apps/admin-web/src/features/mall/bulk-sessions/session-list/index.tsx` (빈 양식 버튼 제거)
- Modify: `apps/admin-web/src/app/(admin)/mall/bulk-sessions/page.tsx`

**Interfaces:**
- Consumes: `parseBulkSessionsTab` (Task 7) · `FormExportListTemplate` (Task 8) · `BulkSessionListTemplate` (기존)

- [ ] **Step 1: 컨테이너를 만든다**

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BulkSessionListTemplate from './session-list';
import FormExportListTemplate from './form-export-list';
import { parseBulkSessionsTab } from './lib/tab-param';

export default function BulkSessionsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseBulkSessionsTab(searchParams.get('tab') ?? undefined);

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', next);
        // 탭 전환은 히스토리를 쌓지 않는다 — 뒤로가기가 탭 토글이 되면 이 화면을
        // 벗어나기 어려워진다.
        router.replace(`/mall/bulk-sessions?${params.toString()}`);
      }}
    >
      <TabsList>
        <TabsTrigger value="forms">양식 생성</TabsTrigger>
        <TabsTrigger value="sessions">업로드 세션</TabsTrigger>
      </TabsList>
      <TabsContent value="forms">
        <FormExportListTemplate />
      </TabsContent>
      <TabsContent value="sessions">
        <BulkSessionListTemplate />
      </TabsContent>
    </Tabs>
  );
}
```

> `@/components/ui/tabs` 는 이미 있다(`Tabs`·`TabsList`·`TabsTrigger`·`TabsContent` 를 내보낸다) — 추가 설치가 필요 없다.

- [ ] **Step 2: 세션 목록에서 빈 양식 버튼을 뺀다**

`session-list/index.tsx` — `downloadBlank` 호출과 그 버튼, 이제 안 쓰는 `downloadBlob` import 를 제거한다. 업로드 모달은 남긴다.

- [ ] **Step 3: 라우트를 갈아끼운다**

`app/(admin)/mall/bulk-sessions/page.tsx` 의 `BulkSessionListTemplate` 을 `BulkSessionsTabs` 로 바꾼다. `RouteGuard requireRole={['admin','master']}` 는 그대로 둔다.

- [ ] **Step 4: 타입 체크**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit 2>&1 | grep -E 'bulk-sessions' || echo "신규 에러 없음"`
Expected: 신규 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions apps/admin-web/src/app/\(admin\)/mall/bulk-sessions/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin-web): 일괄 등록 화면을 양식 생성·업로드 세션 두 탭으로

양식 받기→채워서 올리기가 하나의 업무 흐름이라 한 화면에 둔다. 쿼리가
없으면 업로드 세션이 기본이라 사이드바 동선의 기존 동작은 그대로다.

탭 전환은 router.replace 를 쓴다 — 히스토리를 쌓으면 뒤로가기가 탭
토글이 되어 화면을 벗어나기 어려워진다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## Task 10: admin-web — 모달 제거하고 새 탭으로 보낸다

**Files:**
- Delete: `apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx`
- Delete: `apps/admin-web/src/features/mall/products-list/components/form-export-modal/request-guard.ts`
- Delete: `apps/admin-web/src/features/mall/products-list/components/form-export-modal/request-guard.spec.ts`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx:24,132-140,197-201`

- [ ] **Step 1: 버튼 핸들러를 바꾼다**

`table/index.tsx` — `FormExportModal` import(`:24`)와 `<FormExportModal .../>`(`:197-201`), `formExportOpen` state 를 제거하고, 버튼(`:132-140`)을 다음으로 바꾼다:

```tsx
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSelection || requestFormExport.isPending}
              onClick={() => {
                // window.open 은 사용자 제스처 핸들러 안에서 **동기적으로** 불러야
                // 팝업 차단에 안 걸린다. POST 응답을 기다렸다 열면 차단되므로 창을
                // 먼저 열고 요청은 이 탭에서 보낸다. 새 탭은 목록을 폴링하므로
                // 접수된 잡이 곧 나타난다.
                const opened = window.open('/mall/bulk-sessions?tab=forms', '_blank');
                if (!opened) {
                  toast.info('팝업이 차단되어 이 탭에서 엽니다.');
                  router.push('/mall/bulk-sessions?tab=forms');
                }
                requestFormExport.mutate(selectedIds, {
                  onSuccess: (res) =>
                    toast.success(
                      res.reused
                        ? '이미 진행 중인 같은 요청이 있어 그것으로 이어집니다.'
                        : '양식 생성을 접수했습니다. 새 탭에서 진행 상황을 확인하세요.',
                    ),
                  onError: (error) =>
                    toast.error(parseServerError(error, '양식 생성 요청에 실패했습니다.').message),
                });
              }}
            >
              <FileSpreadsheet className="w-3 h-3 mr-1" />
              양식 다운로드
            </Button>
```

`useRequestFormExport`·`useRouter`·`toast`·`parseServerError` import 를 더한다.

- [ ] **Step 2: 모달 디렉터리를 지운다**

```bash
git rm -r apps/admin-web/src/features/mall/products-list/components/form-export-modal
```

- [ ] **Step 3: 남은 참조가 없는지 확인한다**

Run: `rg -n 'FormExportModal|form-export-modal|useFormExportStatus|isFormExportRunning|formExportRefetchInterval' apps/admin-web/src`
Expected: 출력 없음

- [ ] **Step 4: 타입 체크와 테스트**

Run: `npx tsc -p apps/admin-web/tsconfig.json --noEmit 2>&1 | grep -E 'products-list|form-export' || echo "신규 에러 없음"`
Expected: 신규 에러 없음

Run: `npx jest --testPathPattern='(form-export|bulk-sessions|products-list)'`
Expected: PASS — `request-guard.spec.ts` 가 사라진 만큼 총 개수가 줄어드는 것은 정상

- [ ] **Step 5: 커밋**

```bash
git add -A apps/admin-web/src/features/mall/products-list
git commit -m "$(cat <<'EOF'
feat(admin-web)!: 양식 생성 모달을 제거하고 목록 탭을 새 창으로 연다

수 분이 걸릴 수 있는 작업을 모달로 지켜보게 하는 구조 자체가 문제였다.
클릭하면 새 탭에서 목록을 열고 요청은 이 탭에서 보낸다 — 새 탭이라 상품
선택 상태가 그대로 남는다.

window.open 을 POST 보다 먼저 동기로 부르는 이유는 팝업 차단이다.
사용자 제스처 핸들러를 벗어나면(응답 대기 후) 차단된다. 차단되면
같은 탭 router.push 로 폴백한다.

모달과 함께 응답 순서 보호 로직(request-guard)도 사라진다 — 상태가
목록 한 곳에만 있으면 애초에 필요 없는 방어였다.

Claude-Session: https://claude.ai/code/session_01D7vdy5eDc6PUuJHRjXwFz5
EOF
)"
```

---

## 최종 검증 (모든 태스크 완료 후)

- [ ] **서버 스위트**

Run: `npx jest --testPathPattern='(bulk-session|form-export)'`
Expected: 신규 실패 0

- [ ] **core 타입 게이트**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0

- [ ] **변경 파일 lint (전역 `npm run lint` 금지 — `--fix` 가 무관한 파일을 건드린다)**

Run: `npx eslint $(git diff --name-only origin/develop...HEAD | grep -E '\.tsx?$' | tr '\n' ' ')`
Expected: error 0 (warning 은 기존 패턴과 같은 것만)

- [ ] **수동 스모크 — 자동 테스트가 못 덮는 것**

1. 상품 3개 선택 → 「양식 다운로드」 → 새 탭이 열리고 목록에 잡이 나타난다
2. 완료되면 「다운로드」로 xlsx 를 받고 **파일명이 `상품일괄양식_YYYY-MM-DD.xlsx` 로 안 깨진다**
3. 같은 3개로 다시 누르면 "이미 진행 중인 요청" 토스트가 뜨고 새 잡이 안 생긴다
4. 팝업을 차단한 브라우저에서 눌러 같은 탭 폴백이 도는지 본다
5. 사이드바 → 일괄 등록 메뉴로 들어가면 「업로드 세션」 탭이 먼저 보인다
6. 「양식 생성」 탭 헤더의 빈 양식 다운로드가 여전히 동작한다

- [ ] **배포 순서 확인**

**core 선배포 → admin-web.** 반대로 하면 새 화면이 없는 API 를 부른다. 마이그레이션 0건, 새 secret/env 없음.
