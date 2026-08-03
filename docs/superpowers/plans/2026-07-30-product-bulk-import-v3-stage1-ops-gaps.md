# 판매상품 대량등록 v3 — 1단계(운영 구멍) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대량등록 세션을 취소할 수 있게 하고, 슬라이스 밖으로 탈출한 예외가 무한 재시도로 굳는 경로를 상한으로 끊고, 접수 시점 검증실패 수를 별도 컬럼에 얼려 둔다.

**Architecture:** 세션 취소는 "여기서 멈춘다"이지 "없던 일로"가 아니다 — `cancel_requested_at` 을 찍고 **진행 중인 레인만** `canceled` 로 확정한다. 워커는 두 지점에서 취소를 존중한다: (1) claim 쿼리가 `cancel_requested_at IS NULL` 인 세션만 집어 굳은 세션의 재시도 루프를 끊고, (2) 진행 중 슬라이스는 이미 행마다 도는 `renewLease` 왕복의 `returning` 에 `cancel_requested_at` 을 얹어 읽어 스스로 멈춘다 — **쿼리가 늘지 않는다.** 고착 방지는 `consecutive_failures` 카운터다: 슬라이스 탈출 예외마다 +1, 정상 종료마다 0, 상한 10회를 넘으면 그 레인을 `failed` 로 확정한다 — 스키마에 있으면서 아무도 쓰지 않던 `'failed'` 값이 드디어 쓰인다.

**Tech Stack:** NestJS + Drizzle ORM(postgres.js) + Jest(core), Next.js + TanStack Query + shadcn/ui(admin-web).

## Global Constraints

- **설계 스펙**: `docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` — 이 계획은 §6 표의 **1단계**만 구현한다. `image_status`·`product_import_images`·`GET /:id/progress`·필드 확장은 **전부 범위 밖**이다.
- **마이그레이션 순서**: 전부 additive 이므로 ADR-0005 §5 **expand phase — `migrate` → `deploy`** 다 (contract phase 의 반대). 새 컬럼을 읽고 쓰는 코드가 컬럼보다 먼저 뜨면 깨진다.
- **마이그레이션은 1건으로 묶는다.** 스펙 §6 이 1단계 배포 결합을 "마이그레이션 1건"으로 못 박았다.
- **레이어 규칙**(CLAUDE.md): Controller → Service → Manager/Reader → DB. Service 는 2-3줄 위임만. 검증·비즈니스 로직·DB 접근은 Manager 에. Controller 는 try/catch 로 에러를 status 에 매핑하지 않는다 — `GlobalExceptionFilter` 가 한다.
- **도메인 예외**: `@app/shared` 의 `NotFoundError`(404) / `BadRequestError`(400) / `ConflictError`(409). `HttpException` 을 서비스·매니저에서 쓰지 않는다.
- **타입 안전**: `any`·`as` 캐스팅 금지(테스트 하네스의 기존 관례는 예외 — 이미 그 파일들이 `any` 로 짜여 있다). Drizzle 쿼리는 `trx.select().from().where()` 형태만, `db.query.*`·`with` 관계 금지.
- **트랜잭션 전파**(ADR-0025): 공개 메서드는 `tx?: DbTransaction` 을 마지막 인자로, 내부는 `this.db.run(async (trx) => …, tx)`. 클래스별 `inTx` 헬퍼를 새로 만들지 않는다.
- **`consecutive_failures` 상한은 10**, 상수로 둔다. 스펙 §8 의 신규 env 목록에 이 값이 없다 — env 로 빼지 않는다.
- **`invalid_count` 는 nullable 이고 백필하지 않는다.** 스펙 §3.5: "옛 세션은 NULL 이고 UI 가 현행과 같은 표시로 폴백한다."
- **취소는 종단이다.** 재개하지 않는다. 다시 하려면 워크북을 재업로드한다(스펙 §3.4.1).
- **검증 게이트는 `npm run type-check:scoped` 하나다.** `tsconfig.spec-scope.json` 의 `include` 가 `apps/core/src/modules/catalog/operations/import/**/*.ts` 전체를 이미 덮으므로 이 태스크들의 변경 surface(src + spec)가 전부 들어간다. develop 에서 green 임을 실측했다.
- **`nest build core` 는 게이트로 쓰지 않는다.** develop 에서도 webpack **module-not-found 12건**으로 실패한다(`amqp-connection-manager`·`nats`·`mqtt`·`@fastify/view` — NestJS 선택적 transport 의 미설치 peer dep). 타입 오류가 아니라 번들러 해석 실패라 우리 변경과 무관하고 초록이 될 수 없다. 실행하지 마라 — 45초를 쓰고 빨간불을 준다.
- **전역 `npm run lint`(전역 `--fix`)·전역 jest·admin-web `type-check` 는 develop 에서도 red 인 상시 debt 라 "전체 그린"으로 판정하지 않는다** — 변경 파일 기준 차분으로만 본다.
- **커밋 단위**: schema.ts + 생성된 `drizzle/<timestamp>_*.sql` + `drizzle/meta/` 는 **반드시 한 커밋**에(CLAUDE.md). 쪼개면 다른 사람 체크아웃이 desync 된다.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `apps/core/src/modules/catalog/schema/catalog.schema.ts` | 세션 테이블 + job status enum | 수정 — enum 값 1개, 컬럼 3개 |
| `apps/core/drizzle/<timestamp>_product-import-cancel-and-failure-cap.sql` | 마이그레이션 | 생성(drizzle-kit) |
| `.../import/dto/import-response.dto.ts` | API 응답 DTO | 수정 — `CancelAcceptedDto` 신설, `SessionSummaryDto` 2필드 |
| `.../import/dto/index.ts` | DTO 배럴 | 수정 — 재수출 |
| `.../import/services/product-import.manager.ts` | 접수·취소·게시큐 — **DB 쓰기와 검증이 사는 곳** | 수정 — `cancelSession` 신설, `acceptCommit`·`queuePublish` 수정 |
| `.../import/services/product-import.service.ts` | 얇은 위임 + DTO 매핑 | 수정 — `cancelSession` 위임, `toSummary` 2필드 |
| `.../import/product-import.controller.ts` | HTTP 경계 | 수정 — `POST :sessionId/cancel` |
| `.../import/services/product-import-job.manager.ts` | claim·lease·슬라이스·잡 오류 | 수정 — claim 가드, `renewLease` 반환형, 마감 가드, 실패 상한 |
| `.../import/services/product-import-job.worker.ts` | @Cron 틱 배선 | 수정 — 슬라이스 성공 시 카운터 리셋 |
| `apps/admin-web/src/lib/types/dto/product-import.ts` | 백엔드 DTO 미러 | 수정 |
| `apps/admin-web/src/lib/api/domains/products/product-import.client.ts` | HTTP 클라이언트 | 수정 — `cancel` |
| `apps/admin-web/src/lib/services/products/mutations.ts` | TanStack mutation | 수정 — `useCancelSession` |
| `apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx` | 세션 상세 화면 | 수정 — 취소 버튼 + 확인 다이얼로그 + 배지 |
| `apps/admin-web/src/features/mall/product-imports/session-list/index.tsx` | 세션 목록 화면 | 수정 — `취소됨` 라벨 |

테스트는 전부 기존 스펙 파일에 얹는다(새 파일 없음): `product-import.manager.spec.ts`, `product-import-job.manager.spec.ts`, `product-import-job.worker.spec.ts`, `product-import-job-lease.integration.spec.ts`.

---

### Task 1: 스키마 + 마이그레이션

`canceled` enum 값과 세션 컬럼 3개를 추가한다. 이 태스크는 **DDL 만** 한다 — 이후 태스크들이 이 컬럼을 읽고 쓴다.

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts:986-992` (enum), `:1043-1044` (컬럼 추가 위치)
- Create: `apps/core/drizzle/<timestamp>_product-import-cancel-and-failure-cap.sql` (drizzle-kit 이 생성)
- Modify: `apps/core/drizzle/meta/*` (drizzle-kit 이 생성)

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces: drizzle 컬럼 핸들 `productImportSessions.cancelRequestedAt: PgColumn<Date | null>`, `productImportSessions.consecutiveFailures: PgColumn<number>`, `productImportSessions.invalidCount: PgColumn<number | null>`. enum 값 `'canceled'` 가 `productImportJobStatusEnum` 의 유니온에 들어가 `commitStatus`/`publishStatus` 에 대입 가능해진다.

- [ ] **Step 1: enum 에 `canceled` 를 맨 뒤에 추가한다**

`apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 `productImportJobStatusEnum` 을 다음으로 교체:

```typescript
/** 세션 단위 잡(commit·publish)의 라이프사이클. 세션의 `status` 는 아카이브 플래그로 별개다. */
export const productImportJobStatusEnum = pgEnum('product_import_job_status', [
  'idle',
  'queued',
  'running',
  'completed',
  'failed',
  // 'canceled' 는 **맨 뒤**에 붙인다 — 바로 위 productImportItemStatusEnum 의 'pending' 과
  // 같은 이유다. drizzle-kit 이 중간 삽입을 만나면 `ALTER TYPE ... ADD VALUE 'x' BEFORE 'y'`
  // 를 만드는데, 뒤에 붙이면 단순 ADD VALUE 로 끝난다.
  'canceled',
]);
```

- [ ] **Step 2: 세션 테이블에 컬럼 3개를 추가한다**

같은 파일 `productImportSessions` 의 `publishFailedCount` 줄(`:1044`) **바로 아래**, 닫는 `}` 앞에 추가:

```typescript
    publishFailedCount: integer('publish_failed_count').notNull().default(0),

    // ─── 운영 구멍 (v3 1단계) ───
    /**
     * 취소 요청 시각. NULL 이 아니면 워커가 이 세션을 **새로 클레임하지 않는다**.
     * 굳은 세션(슬라이스 밖 예외가 반복돼 매 틱 재시도되는 세션)을 푸는 유일한 경로가
     * 이것이라, claim 쿼리의 조건에 들어가는 것이 이 컬럼의 본체다. 진행 중인 슬라이스는
     * renewLease 의 returning 으로 이 값을 읽어 스스로 멈춘다.
     *
     * 취소는 **종단**이다 — 재개하지 않는다. queuePublish 도 이 값이 있으면 거부한다.
     */
    cancelRequestedAt: timestamp('cancel_requested_at'),
    /**
     * 슬라이스 **밖으로 탈출한** 예외의 연속 횟수. 슬라이스가 정상 종료하면 0 으로 되돌린다.
     * recordJobError 가 상태를 바꾸지 않도록 의도적으로 설계돼 있어(일시적 DB 오류로 임포트를
     * 영구 실패시키는 편이 더 나쁘다) 예외가 반복되면 매 틱 무한 재시도한다 — 이 카운터가
     * 그 무한을 유계로 만든다. 상한을 넘으면 그 레인이 'failed' 로 확정된다.
     */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /**
     * **접수 시점** 검증실패 행 수. failed_count 는 접수 시점 검증실패로 초기화된 뒤
     * failItem 이 생성 실패마다 +1 하므로 두 종류가 한 칸에 섞인다 — 그 값으로는
     * "생성 대상 행 수"를 복원할 수 없다. 이 컬럼이 접수 시점 값을 얼려 둔다.
     * 옛 세션은 NULL 이고 화면이 현행과 같은 표시로 폴백한다(백필하지 않는다).
     */
    invalidCount: integer('invalid_count'),
  },
```

- [ ] **Step 3: 마이그레이션을 생성한다**

```bash
npm run db:generate:core -- --name product-import-cancel-and-failure-cap
```

이 명령은 대화형일 수 있다(drizzle-kit 이 rename 을 의심할 때). **이번 변경은 전부 신규 추가라 rename 프롬프트가 뜨면 안 된다** — 뜨면 schema.ts 를 잘못 고친 것이니 중단하고 확인한다.

- [ ] **Step 4: 생성된 SQL 을 눈으로 검사한다 (건너뛰지 말 것)**

```bash
ls -t apps/core/drizzle/*.sql | head -1 | xargs cat
```

기대하는 4개 문장(순서는 달라도 된다):

```sql
ALTER TYPE "public"."product_import_job_status" ADD VALUE 'canceled';--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "cancel_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "invalid_count" integer;
```

**확인 항목 — 하나라도 어긋나면 멈추고 원인을 찾는다:**

1. **`'canceled'` 가 DEFAULT 로 쓰인 문장이 없어야 한다.** PostgreSQL 은 `ALTER TYPE ... ADD VALUE` 로 추가한 값을 **같은 트랜잭션 안에서 사용할 수 없다**(`unsafe use of new value`). drizzle-kit migrate 는 마이그레이션을 트랜잭션으로 감싸므로, 새 값을 DEFAULT 에 쓰면 그 자리에서 실패한다. 우리는 `canceled` 를 DEFAULT 로 쓰지 않으므로 걸리지 않지만 **생성된 SQL 로 확인해야** 한다. (레포 선례 `20260727141456` 은 같은 제약을 `::text` 캐스트로 우회했다.)
2. **`DROP` 이 한 줄도 없어야 한다.** 전부 additive 여야 `migrate` → `deploy` 순서가 성립한다.
3. **`invalid_count` 에 `NOT NULL` 이 붙지 않아야 한다.** 붙었다면 schema.ts 에 `.notNull()` 을 잘못 적은 것이다 — 기존 세션 전부에 값을 만들어내야 해서 백필 없이는 마이그레이션이 실패한다.
4. **`consecutive_failures` 에는 `DEFAULT 0 NOT NULL` 이 붙어야 한다.** 기존 행이 NULL 이면 `+1` 산술이 NULL 을 낳아 상한이 영원히 안 걸린다.

- [ ] **Step 5: 로컬 dev DB 에 적용한다**

```bash
npm run db:migrate -- --stage dev --deployment lcnine-services --yes
```

`db:setup` 은 bootstrap+migrate+seed 를 묶은 **대화형** dev wrapper 다 — logical DB 가 이미 있고 시드도 필요 없으므로 비대화식 `db:migrate` 만 부른다(CLAUDE.md 가 비대화식 경로에서 4개 명령을 직접 부르라고 명시한 그 경로다).

**AWS SSO 자격증명이 만료돼 있으면 실패한다.** 재인증은 사람이 해야 한다: `aws login --profile login`.

적용 확인:

```bash
psql "$DATABASE_URL" -c "\d product_import_sessions" | grep -E "cancel_requested_at|consecutive_failures|invalid_count"
psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::product_import_job_status))"
```

기대: 컬럼 3줄 + enum 6값(`idle,queued,running,completed,failed,canceled`).

- [ ] **Step 6: 타입 게이트**

```bash
npm run type-check:scoped
```

기대: 성공. (아직 새 컬럼을 읽는 코드가 없으므로 이 단계에서 실패할 이유가 없다.)

- [ ] **Step 7: 커밋**

schema.ts·SQL·meta 를 **한 커밋**에 묶는다.

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle/
git commit -m "feat(product-import): 세션 취소·연속실패 상한·invalid_count 컬럼 추가

- product_import_job_status enum 에 'canceled' 추가 (맨 뒤)
- product_import_sessions: cancel_requested_at, consecutive_failures, invalid_count
- 전부 additive → ADR-0005 §5 expand phase (migrate → deploy)"
```

---

### Task 2: `invalid_count` 얼리기

접수 시점 검증실패 수를 세션에 쓰고 API 로 노출한다. 읽는 쪽(진행률 API)은 2단계지만, **컬럼이 생긴 시점부터 값이 쌓여야** 2단계 배포 직후의 세션들이 폴백 표시로 떨어지지 않는다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts:39-54`
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts:87-126`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts:99-115`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `productImportSessions.invalidCount`
- Produces: `SessionSummaryDto.invalidCount: number | null`, `SessionSummaryDto.cancelRequestedAt: Date | null` (Task 3·7 이 쓴다)

- [ ] **Step 1: 하네스에 `sessionMissing` 옵션을 추가한다**

Task 3 의 404 테스트도 쓸 훅이라 여기서 먼저 넣는다. `product-import.manager.spec.ts` 의 `makeHarness` 를 수정:

```typescript
function makeHarness(
  createMasterImpl?: (userId: string) => any,
  opts: { session?: Record<string, unknown>; sessionMissing?: boolean } = {},
) {
  const session = opts.sessionMissing
    ? undefined
    : {
        id: 'sess-1',
        commitStatus: 'completed',
        publishStatus: 'idle',
        cancelRequestedAt: null,
        ...opts.session,
      };
```

그리고 같은 함수 안의 `select` mock 을 교체(`session` 이 undefined 일 수 있으므로):

```typescript
    select: (projection?: any) => ({
      from: (table: any) => ({
        // count() 프로젝션이면 집계 한 줄, 아니면 세션 한 줄(없으면 빈 배열)
        where: () =>
          chain(projection?.value ? [{ value: 0 }] : table === productImportSessions && session ? [session] : []),
      }),
    }),
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`product-import.manager.spec.ts` 의 `describe('ProductImportManager', …)` 안, `acceptCommit` 관련 테스트들 옆에 추가:

```typescript
  it('접수 시점 검증실패 수를 invalidCount 로 얼려 둔다 — failedCount 는 나중에 생성실패와 섞인다', async () => {
    const { manager, sessions } = makeHarness();
    const bad = validRecord({
      rowNumber: 3,
      productKey: 'P3',
      errors: [{ sheet: 'Products', rowNumber: 3, message: '상품명이 없습니다' }],
    });

    await manager.acceptCommit({ fileName: 'f.xlsx', userId: 'u1', records: [validRecord(), bad] });

    // failedCount 와 invalidCount 는 접수 시점에는 같은 값이지만, 이후 failItem 이
    // failedCount 만 올리므로 갈라진다. 그 갈라짐을 복원하려고 얼려 두는 값이다.
    expect(sessions[0]).toMatchObject({ totalRows: 2, failedCount: 1, invalidCount: 1 });
  });
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
npx jest --testPathPattern=product-import.manager.spec -t "invalidCount 로 얼려"
```

기대: FAIL — `invalidCount` 가 `sessions[0]` 에 없다(`toMatchObject` 불일치).

- [ ] **Step 4: `acceptCommit` 이 값을 쓰게 한다**

`product-import.manager.ts` 의 `.values({…})` 블록에 한 줄 추가:

```typescript
        .values({
          fileName,
          uploadedBy: userId,
          totalRows: records.length,
          failedCount: invalidCount,
          // failedCount 는 이후 failItem 이 생성 실패마다 +1 하므로 두 종류가 섞인다.
          // 접수 시점 값을 별도 컬럼에 얼려야 "생성 대상 행 수"를 복원할 수 있다.
          invalidCount,
          // status 는 아카이브 플래그다. 잡 상태는 commitStatus/publishStatus 가 든다.
          status: 'completed',
          commitStatus: 'queued',
          publishStatus: 'idle',
        })
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern=product-import.manager.spec
```

기대: 신규 1개 포함 전부 PASS.

- [ ] **Step 6: DTO 에 노출한다**

`import-response.dto.ts` 의 `SessionSummaryDto` 에서 `publishError` 필드 **아래**에 추가:

```typescript
  @ApiProperty({ required: false, nullable: true })
  publishError: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '접수 시점 검증실패 행 수. 옛 세션(컬럼 도입 이전)은 null 이다.',
  })
  invalidCount: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '취소 요청 시각. null 이 아니면 워커가 이 세션을 더 이상 집지 않는다.',
  })
  cancelRequestedAt: Date | null;
```

그리고 `commitStatus`/`publishStatus` 의 `@ApiProperty({ enum: … })` 두 곳(`:109`, `:112`)에 `'canceled'` 를 더한다:

```typescript
  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '상품 생성 잡 상태',
  })
  commitStatus: string;

  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '게시 잡 상태',
  })
  publishStatus: string;
```

- [ ] **Step 7: `toSummary` 가 두 필드를 매핑하게 한다**

`product-import.service.ts` 의 `toSummary` 반환 객체 끝에 추가:

```typescript
      commitError: session.commitError,
      publishError: session.publishError,
      invalidCount: session.invalidCount,
      cancelRequestedAt: session.cancelRequestedAt,
    };
```

- [ ] **Step 8: 타입 게이트**

```bash
npm run type-check:scoped
```

기대: 둘 다 성공.

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(product-import): 접수 시점 검증실패 수를 invalid_count 로 얼려 둔다

failedCount 는 접수 시점 검증실패로 초기화된 뒤 failItem 이 생성 실패마다 +1 해
두 종류가 한 칸에 섞인다. 진행률 분모(2단계)가 쓸 수 있게 접수 시점 값을 분리한다."
```

---

### Task 3: 세션 취소 API

`POST /product-imports/:sessionId/cancel`. **진행 중인 레인만** `canceled` 로 확정하고, `cancel_requested_at` 을 찍고, **lease 는 건드리지 않는다.**

> **왜 lease 를 안 지우나.** 지우면 진행 중 워커의 `renewLease` CAS 가 즉시 실패해 "lease 를 잃었다"는 경로로 빠진다 — 워커는 취소 때문인지 lease 탈취 때문인지 구분하지 못하고, 4단계에서 취소 시 필요한 정리(업로드된 이미지 soft delete)를 걸 자리가 사라진다. 스펙 §3.4.1 이 정한 대로 워커가 `cancel_requested_at` 을 **명시적으로 읽고** 멈추게 둔다.

> **왜 끝난 레인은 안 덮나.** 스펙 §3.4.1 은 "모든 레인 상태를 `canceled` 로 확정한다"고 적었으나, 이미 `completed` 인 레인까지 덮으면 사실이 아닌 이력이 남는다 — commit 이 끝나고 publish 중에 취소하면 상품은 실제로 생성됐다. `queued`/`running` 인 레인만 바꾼다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts` (`cancelSession` 신설, `queuePublish` 가드)
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts` (`CancelAcceptedDto`)
- Modify: `apps/core/src/modules/catalog/operations/import/dto/index.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.controller.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `cancelRequestedAt` 컬럼과 `'canceled'` enum 값; Task 2 의 `makeHarness(…, { session, sessionMissing })`
- Produces:
  - `ProductImportManager.cancelSession(sessionId: string): Promise<CancelAcceptedDto>`
  - `ProductImportService.cancelSession(sessionId: string): Promise<CancelAcceptedDto>`
  - `CancelAcceptedDto = { sessionId: string; commitStatus: string; publishStatus: string; canceledAt: Date }`
  - HTTP `POST /product-imports/:sessionId/cancel` → 200

- [ ] **Step 1: 실패하는 테스트 5개를 쓴다**

`product-import.manager.spec.ts` 파일 맨 위의 import 에 `ConflictError`·`NotFoundError` 를 더한다:

```typescript
import { ConflictError, NotFoundError } from '@app/shared';
```

그리고 `describe('ProductImportManager', …)` 안에 새 describe 블록을 추가:

```typescript
  describe('cancelSession', () => {
    it('진행 중인 레인만 canceled 로 확정하고 끝난 레인은 그대로 둔다', async () => {
      const { manager, updates } = makeHarness(undefined, {
        session: { commitStatus: 'completed', publishStatus: 'running' },
      });

      const res = await manager.cancelSession('sess-1');

      // commit 은 실제로 끝났다 — 상품이 생성됐는데 canceled 로 덮으면 이력이 거짓이 된다.
      expect(res).toMatchObject({ sessionId: 'sess-1', commitStatus: 'completed', publishStatus: 'canceled' });
      const sessionUpdates = updates.filter((u) => u.table === 'sessions');
      expect(sessionUpdates).toHaveLength(1);
      expect(sessionUpdates[0].values.publishStatus).toBe('canceled');
      expect(sessionUpdates[0].values.commitStatus).toBeUndefined();
      expect(sessionUpdates[0].values.cancelRequestedAt).toBeInstanceOf(Date);
    });

    it('queued 인 레인도 취소 대상이다 — 아직 시작 안 한 게시를 막을 수 있어야 한다', async () => {
      const { manager, updates } = makeHarness(undefined, {
        session: { commitStatus: 'completed', publishStatus: 'queued' },
      });

      await manager.cancelSession('sess-1');

      expect(updates.filter((u) => u.table === 'sessions')[0].values.publishStatus).toBe('canceled');
    });

    it('lease 를 지우지 않는다 — 진행 중 워커가 renewLease 로 취소를 읽고 스스로 멈춰야 한다', async () => {
      const { manager, updates } = makeHarness(undefined, {
        session: { commitStatus: 'running', publishStatus: 'idle' },
      });

      await manager.cancelSession('sess-1');

      const values = updates.filter((u) => u.table === 'sessions')[0].values;
      expect(values.leaseToken).toBeUndefined();
      expect(values.leaseUntil).toBeUndefined();
    });

    it('진행 중인 레인이 없으면 취소할 것이 없다', async () => {
      const { manager } = makeHarness(undefined, {
        session: { commitStatus: 'completed', publishStatus: 'completed' },
      });

      await expect(manager.cancelSession('sess-1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('이미 취소된 세션은 다시 취소되지 않는다 — 취소는 종단이다', async () => {
      const { manager } = makeHarness(undefined, {
        session: { commitStatus: 'canceled', publishStatus: 'idle', cancelRequestedAt: new Date() },
      });

      await expect(manager.cancelSession('sess-1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('없는 세션은 404 다', async () => {
      const { manager } = makeHarness(undefined, { sessionMissing: true });

      await expect(manager.cancelSession('nope')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('취소된 세션은 다시 게시할 수 없다 — 재개하려면 워크북을 재업로드한다', async () => {
    const { manager } = makeHarness(undefined, {
      session: { commitStatus: 'completed', publishStatus: 'canceled', cancelRequestedAt: new Date() },
    });

    await expect(manager.queuePublish('sess-1')).rejects.toBeInstanceOf(ConflictError);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npx jest --testPathPattern=product-import.manager.spec
```

기대: 신규 7개 FAIL(`manager.cancelSession is not a function` 6개 + 게시 가드 1개는 예외를 안 던져 실패).

- [ ] **Step 3: `CancelAcceptedDto` 를 만든다**

`import-response.dto.ts` 맨 아래에 추가:

```typescript
export class CancelAcceptedDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '취소 반영 후 생성 잡 상태. 이미 끝난 레인은 completed 로 남는다.',
  })
  commitStatus: string;

  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '취소 반영 후 게시 잡 상태',
  })
  publishStatus: string;

  @ApiProperty({ description: '취소 요청 시각' })
  canceledAt: Date;
}
```

`dto/index.ts` 는 `export * from './import-response.dto'` 라 **수정이 필요 없다.**

- [ ] **Step 4: `cancelSession` 을 구현한다**

`product-import.manager.ts` — import 목록에 DTO 를 더하고(`CommitAcceptedDto, PublishAcceptedDto` 옆), `queuePublish` **아래**에 메서드를 추가:

```typescript
  /**
   * 세션을 취소한다. "여기서 멈춘다"이지 "없던 일로"가 아니다 — 이미 생성된 draft 상품과
   * 이미 나간 이벤트는 되돌리지 않는다. 삭제는 되돌릴 수 없고, 부분 생성된 상품은 사람이
   * 보고 판단하는 것이 맞다(세션 상세에 masterId 가 전부 있어 수동 정리가 가능하다).
   *
   * **lease 는 건드리지 않는다.** 지우면 진행 중 워커의 renewLease CAS 가 "lease 를
   * 빼앗겼다" 경로로 빠져 취소를 인지하지 못한다. 워커는 renewLease 의 returning 으로
   * cancel_requested_at 을 직접 읽고 멈춘다(product-import-job.manager.ts).
   *
   * **끝난 레인은 덮지 않는다.** commit 이 completed 인 상태에서 게시를 취소했다면
   * 상품은 실제로 생성된 것이다 — canceled 로 덮으면 이력이 거짓이 된다.
   *
   * 취소는 **종단**이다. 재개 경로를 두지 않는 대신 굳은 세션(슬라이스 밖 예외가 반복돼
   * 매 틱 재시도되는 세션)을 푸는 수단을 겸한다 — 별도 reset-lease API 가 없는 이유다.
   */
  async cancelSession(sessionId: string): Promise<CancelAcceptedDto> {
    const active = (status: string): boolean => status === 'queued' || status === 'running';

    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      if (session.cancelRequestedAt) throw new ConflictError('이미 취소된 세션입니다.');

      const cancelCommit = active(session.commitStatus);
      const cancelPublish = active(session.publishStatus);
      if (!cancelCommit && !cancelPublish) {
        throw new ConflictError('진행 중인 작업이 없어 취소할 수 없습니다.');
      }

      const canceledAt = new Date();
      await trx
        .update(productImportSessions)
        .set({
          cancelRequestedAt: canceledAt,
          ...(cancelCommit ? { commitStatus: 'canceled' as const } : {}),
          ...(cancelPublish ? { publishStatus: 'canceled' as const } : {}),
        })
        .where(eq(productImportSessions.id, sessionId));

      return {
        sessionId,
        // 방금 쓴 값을 그대로 되돌린다 — .returning() 을 붙이지 않는 이유는 왕복이
        // 하나 늘 뿐 새로 알게 되는 것이 없기 때문이다(같은 트랜잭션 안이다).
        commitStatus: cancelCommit ? 'canceled' : session.commitStatus,
        publishStatus: cancelPublish ? 'canceled' : session.publishStatus,
        canceledAt,
      };
    });
  }
```

- [ ] **Step 5: `queuePublish` 에 취소 가드를 넣는다**

`queuePublish` 의 `if (!session) throw new NotFoundError(…)` **바로 아래**에 추가:

```typescript
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      // 취소는 종단이다. commit 이 completed 인 채로 게시만 취소된 세션은 아래
      // commitStatus 검사를 통과하므로, 이 가드가 없으면 재게시가 열린다.
      if (session.cancelRequestedAt) {
        throw new ConflictError('취소된 세션입니다. 다시 등록하려면 워크북을 재업로드해 주세요.');
      }
      if (session.commitStatus !== 'completed') {
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern=product-import.manager.spec
```

기대: 전부 PASS.

- [ ] **Step 7: Service 위임과 Controller 엔드포인트를 붙인다**

`product-import.service.ts` — import 목록(`ValidatePreviewDto, … PublishAcceptedDto`)에 `CancelAcceptedDto` 를 더하고, 기존 `publishSession` 메서드는 그대로 둔 채 그 **바로 아래**에 한 메서드를 추가:

```typescript
  cancelSession(sessionId: string): Promise<CancelAcceptedDto> {
    return this.manager.cancelSession(sessionId);
  }
```

`product-import.controller.ts` — import 에 `CancelAcceptedDto` 를 더하고, `publish` 핸들러 아래에 추가:

```typescript
  @Post(':sessionId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: '세션 취소 — 진행 중인 레인을 멈춘다. 이미 생성/게시된 것은 되돌리지 않는다.',
  })
  @ApiResponse({ status: 200, type: CancelAcceptedDto })
  @ApiResponse({ status: 409, description: '이미 취소됐거나 진행 중인 작업이 없음' })
  async cancel(@Param('sessionId') sessionId: string): Promise<CancelAcceptedDto> {
    return this.service.cancelSession(sessionId);
  }
```

- [ ] **Step 8: 타입 게이트**

```bash
npm run type-check:scoped
```

기대: 둘 다 성공.

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(product-import): 세션 취소 API

POST /product-imports/:id/cancel — 진행 중인 레인만 canceled 로 확정하고
cancel_requested_at 을 찍는다. lease 는 건드리지 않는다(워커가 renewLease 로
취소를 읽고 스스로 멈춘다). 취소는 종단이라 queuePublish 도 거부한다."
```

---

### Task 4: 워커가 취소를 존중한다

claim 이 취소된 세션을 집지 않게 하고, 진행 중 슬라이스가 `renewLease` 로 취소를 읽고 멈추게 한다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts:94-125` (claim), `:136-231` (commit 슬라이스), `:237-310` (publish 슬라이스), `:334-344` (renewLease)
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts`

**Files (추가):**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job-lease.integration.spec.ts` (호출부 타입만 — 새 테스트는 Task 6)

**Interfaces:**
- Consumes: Task 1 의 `cancelRequestedAt` 컬럼
- Produces: `ProductImportJobManager` 의 private `renewLease(sessionId, token): Promise<{ owned: boolean; canceled: boolean }>` — **반환형이 `boolean` 에서 객체로 바뀐다.** 통합 스펙(`product-import-job-lease.integration.spec.ts:86`)이 `manager['renewLease']` 를 대괄호로 직접 호출하므로 **이 태스크 안에서** 호출부를 함께 고친다(Step 8) — 시그니처를 바꾼 커밋이 그 호출부를 남겨두면 타입 게이트가 red 인 커밋이 생긴다.

- [ ] **Step 1: 하네스의 `renewalRows` 를 `returningRows` 로 바꾸고 기본 행에 `cancelRequestedAt: null` 을 넣는다**

`product-import-job.manager.spec.ts` 의 `makeHarness` 는 `.returning()` 을 renewLease 전용으로 이름 지었지만, 이제 `recordJobError`(Task 5)도 같은 훅을 쓴다. 이름을 중립화한다.

`:41` 시그니처:

```typescript
function makeHarness(opts: { pendingItems?: any[]; claimed?: any[]; returningRows?: any[][] } = {}) {
```

`:63-72` 의 `returning` 블록 전체를 교체:

```typescript
          // renewLease 와 recordJobError 가 .returning() 을 체이닝한다. opts.returningRows 를
          // 안 주면 renewLease 는 성공(비어있지 않은 행)·취소 없음으로, recordJobError 는
          // consecutiveFailures 미상(→ 0 취급)으로 떨어진다.
          result.returning = (_projection?: unknown) => {
            const rows = opts.returningRows
              ? opts.returningRows[Math.min(returningCallIndex, opts.returningRows.length - 1)]
              : [{ id: 'sess-1', cancelRequestedAt: null }];
            returningCallIndex += 1;
            return Promise.resolve(rows);
          };
```

`makeHarness` 본문 첫머리의 카운터 변수(`let renewalCallIndex = 0;`) 이름도 함께 바꾼다:

```typescript
  let returningCallIndex = 0;
```

기존 호출부 3곳(`:298`, `:322`, `:458`)의 `renewalRows:` 를 `returningRows:` 로 바꾼다. `:298` 은 행 내용도 갱신한다:

```typescript
      returningRows: [[{ id: 'sess-1', leaseToken: 'not-a-real-uuid-🔥', cancelRequestedAt: null }]],
```

- [ ] **Step 2: 실패하는 테스트 4개를 쓴다**

`product-import-job.manager.spec.ts` 의 `describe('ProductImportJobManager', …)` 안에 추가:

```typescript
  it('클레임은 취소 요청된 세션을 집지 않는다 — 굳은 세션이 취소로 풀리는 경로다', async () => {
    const { manager, trx } = makeHarness({ claimed: [] });

    await manager.claimCommit();

    const sql = renderSql(trx.execute.mock.calls[0][0]).toLowerCase();
    // 이 조건이 없으면 취소된 세션도 계속 클레임돼 매 틱 같은 예외를 반복한다.
    expect(sql).toContain('cancel_requested_at is null');
  });

  it('게시 클레임도 같은 취소 가드를 건다', async () => {
    const { manager, trx } = makeHarness({ claimed: [] });

    await manager.claimPublish();

    expect(renderSql(trx.execute.mock.calls[0][0]).toLowerCase()).toContain('cancel_requested_at is null');
  });

  it('슬라이스 도중 취소가 감지되면 첫 행도 만들지 않고 lease 를 놓는다', async () => {
    const { manager, updates, importManager } = makeHarness({
      pendingItems: [PENDING(1), PENDING(2)],
      returningRows: [[{ id: 'sess-1', cancelRequestedAt: new Date() }]],
    });

    await manager.runCommitSlice(CLAIM());

    // 취소 검사는 행 처리보다 **먼저** 와야 한다 — 뒤에 두면 매 슬라이스마다 한 행씩 더 만든다.
    expect(importManager.createFromRecord).not.toHaveBeenCalled();
    // lease 를 놓는다: leaseToken 을 null 로 쓰는 세션 업데이트가 정확히 하나.
    const released = updates.filter((u) => u.table === 'sessions' && u.values.leaseToken === null);
    expect(released).toHaveLength(1);
  });

  it('마감은 취소된 세션을 completed 로 도장 찍지 않는다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runCommitSlice(CLAIM());

    const [finalize] = updates.filter((u) => u.table === 'sessions');
    expect(finalize.values.commitStatus).toBe('completed');
    // 취소 직후 pending 이 0 인 경계에서 좀비 마감이 canceled 를 completed 로 덮는 것을 막는다.
    expect(renderSql(finalize.condition).toLowerCase()).toContain('cancel_requested_at" is null');
  });

  it('게시 마감도 같은 취소 가드를 건다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runPublishSlice(CLAIM());

    const [finalize] = updates.filter((u) => u.table === 'sessions');
    expect(finalize.values.publishStatus).toBe('completed');
    expect(renderSql(finalize.condition).toLowerCase()).toContain('cancel_requested_at" is null');
  });
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
npx jest --testPathPattern=product-import-job.manager.spec
```

기대: 신규 5개 FAIL. 기존 테스트는 여전히 PASS(Step 1 의 리네임이 맞게 됐다는 증거다).

- [ ] **Step 4: claim 쿼리에 취소 가드를 넣는다**

`product-import-job.manager.ts` 의 `claim()` 안 raw SQL 의 서브쿼리 `WHERE` 절에 한 줄 추가:

```typescript
      const rows = await trx.execute<{ id: string }>(sql`
        UPDATE product_import_sessions
           SET ${statusColumn} = 'running',
               lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid
         WHERE id = (
           SELECT id
             FROM product_import_sessions
            WHERE ${statusColumn} IN ('queued', 'running')
              AND (lease_until IS NULL OR lease_until < NOW())
              -- 취소된 세션은 애초에 후보가 아니다. 레인 상태가 이미 'canceled' 라
              -- 위 IN 절에도 안 걸리지만, 이 조건이 **굳은 세션을 푸는 본체**다 —
              -- 슬라이스 밖으로 탈출한 예외는 renewLease 에 도달하기도 전에 나므로
              -- 워커 쪽 취소 감지만으로는 재시도 루프를 끊을 수 없다.
              AND cancel_requested_at IS NULL
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id
      `);
```

- [ ] **Step 5: `renewLease` 가 취소 여부까지 돌려주게 한다**

같은 파일의 `renewLease` 를 교체:

```typescript
  /**
   * lease 를 다시 민다 — **내 토큰을 그대로 들고 있을 때만**(CAS).
   * `owned:false` 면 그 사이 lease 가 만료돼 다른 워커가 세션을 가져갔다는 뜻이고,
   * `canceled:true` 면 취소 요청이 들어왔다는 뜻이다. 둘 다 슬라이스 즉시 중단 사유다.
   *
   * 취소 여부를 **여기서** 읽는 이유: 이 왕복은 행마다 이미 돌고 있다 — returning 에
   * 컬럼 하나를 얹는 것은 쿼리를 늘리지 않는다(설계 스펙 §3.4.1).
   *
   * `lease_until > NOW()` 같은 *생존* 검사로는 부족하다. 후임 워커가 방금 민 lease 도
   * 미래이므로 그 조건을 통과한다 — 즉 정말 막아야 할 경우(후임이 넘겨받은 상태)에
   * 그대로 통과해 버려 아무 것도 막지 못한다. 소유권은 "내가 발급한 토큰"으로만 확인할 수 있다.
   */
  private async renewLease(sessionId: string, token: string): Promise<{ owned: boolean; canceled: boolean }> {
    const rows = await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        // 만료시각은 DB 시계로 다시 민다 — 이 값은 비교 대상이 아니므로 정밀도가 무관하다.
        .set({ leaseUntil: sql`NOW() + ${this.leaseMs} * interval '1 millisecond'` })
        .where(and(eq(productImportSessions.id, sessionId), eq(productImportSessions.leaseToken, token)))
        .returning({ cancelRequestedAt: productImportSessions.cancelRequestedAt }),
    );
    const [row] = rows;
    if (!row) return { owned: false, canceled: false };
    // Boolean() 으로 감싼다 — Date 는 truthy, null·undefined 는 falsy 다. `!== null` 로 쓰면
    // 값이 없는 목 하네스에서 undefined 가 취소로 오독된다.
    return { owned: true, canceled: Boolean(row.cancelRequestedAt) };
  }
```

- [ ] **Step 6: 두 슬라이스의 lease 갱신 지점을 고친다**

`runCommitSlice` 의 갱신 블록(`:192-195`)을 교체:

```typescript
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        // 취소는 종단이다 — 레인 상태는 cancelSession 이 이미 확정했으므로 여기서는
        // lease 만 놓는다. 다음 틱의 claim 은 cancel_requested_at 가드에 막혀 이 세션을
        // 다시 집지 않는다.
        this.logger.log(`임포트 세션이 취소돼 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }
```

`runPublishSlice` 의 갱신 블록(`:269-272`)을 같은 모양으로 교체(로그 문구만 다르다):

```typescript
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 게시 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`임포트 세션이 취소돼 게시 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }
```

- [ ] **Step 7: 두 마감 경로에 취소 가드를 넣는다**

같은 파일 import 에 `isNull` 을 더한다:

```typescript
import { and, eq, isNull, sql } from 'drizzle-orm';
```

`runCommitSlice` 의 마감 `.where(…)`(`:165`)를 교체:

```typescript
          // 마감도 renew·release 와 같은 토큰 CAS 를 건다. 무조건 쓰면, lease 가 만료된 뒤
          // 뒤늦게 깨어난 좀비가 pending 0 을 보고 **후임이 처리 중인 세션을** completed 로
          // 도장 찍고 committed_at 을 오늘로 덮어쓰며 후임의 lease_until 까지 지운다.
          // cancel 가드도 같은 계열이다 — 취소 직후 pending 이 0 인 경계에서 canceled 를
          // completed 로 덮는 것을 막는다.
          .where(
            and(
              eq(productImportSessions.id, sessionId),
              eq(productImportSessions.leaseToken, leaseToken),
              isNull(productImportSessions.cancelRequestedAt),
            ),
          ),
```

`runPublishSlice` 의 마감 `.where(…)`(`:261`)를 교체:

```typescript
          .where(
            and(
              eq(productImportSessions.id, sessionId),
              eq(productImportSessions.leaseToken, leaseToken),
              isNull(productImportSessions.cancelRequestedAt),
            ),
          ),
```

- [ ] **Step 8: 통합 스펙의 `renewLease` 호출부 타입을 맞춘다**

`renewLease` 의 반환형을 바꿨으므로, 이 시그니처를 대괄호로 직접 부르는 통합 스펙이 컴파일되지 않는다. **같은 커밋에서 고친다** — 타입 게이트가 red 인 커밋을 남기지 않는다. (새 통합 테스트 작성은 Task 6 이다. 여기서는 **기존 호출부 타입만** 맞춘다.)

`product-import-job-lease.integration.spec.ts` 의 `makeWorkerLike` 반환 객체(`:86` 부근)를 교체:

```typescript
  return {
    manager,
    renew: (sessionId: string, token: string): Promise<{ owned: boolean; canceled: boolean }> =>
      manager['renewLease'](sessionId, token),
    release: (sessionId: string, token: string): Promise<void> => manager['releaseLease'](sessionId, token),
  };
```

기존 테스트에서 `renew(...)` 결과를 boolean 으로 단정하는 곳을 전부 `.owned` 로 바꾼다. 찾는 방법:

```bash
grep -n "renew(" apps/core/src/modules/catalog/operations/import/services/product-import-job-lease.integration.spec.ts
```

`expect(await a.renew(id, token)).toBe(true)` 꼴을 `expect((await a.renew(id, token)).owned).toBe(true)` 로, `toBe(false)` 는 `.owned).toBe(false)` 로 바꾼다. **의미를 바꾸지 말 것** — 기존 단정은 전부 소유권에 대한 것이고, 취소는 이 태스크의 기존 테스트가 다루는 주제가 아니다.

- [ ] **Step 9: 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern=product-import-job
```

기대: 단위 스펙 전부 PASS. 통합 스펙은 `DATABASE_URL` 이 없으면 skip 된다 — 있으면 기존 테스트가 전부 PASS 여야 한다(호출부만 고쳤으므로 동작은 그대로다).

- [ ] **Step 10: 타입 게이트**

```bash
npm run type-check:scoped
```

기대: **둘 다 성공.** `type-check:scoped` 가 `product-import-job-lease.integration.spec.ts` 에서 실패하면 Step 8 의 호출부를 빠뜨린 것이다.

- [ ] **Step 11: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job-lease.integration.spec.ts
git commit -m "feat(product-import): 워커가 세션 취소를 존중한다

- claim: cancel_requested_at IS NULL 가드 — 굳은 세션의 재시도 루프를 끊는 본체
- renewLease: returning 에 cancel_requested_at 을 얹어 읽는다(쿼리 증가 없음)
- 두 슬라이스: 취소 감지 시 lease 를 놓고 즉시 중단
- 두 마감 경로: 취소된 세션을 completed 로 덮지 않는다
- 통합 스펙의 renewLease 호출부를 새 반환형에 맞춘다"
```

---

### Task 5: `consecutive_failures` 상한

슬라이스 밖으로 탈출한 예외를 세고, 10회 연속이면 그 레인을 `failed` 로 확정한다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts:370-385` (`recordJobError`) + `clearConsecutiveFailures` 신설
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.ts:41-52`
- Test: `product-import-job.manager.spec.ts`, `product-import-job.worker.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `consecutiveFailures` 컬럼
- Produces:
  - `export const MAX_CONSECUTIVE_JOB_FAILURES = 10`
  - `ProductImportJobManager.recordJobError(sessionId, kind, message): Promise<void>` — 시그니처는 그대로, 동작만 확장
  - `ProductImportJobManager.clearConsecutiveFailures(sessionId: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 4개를 쓴다**

`product-import-job.manager.spec.ts` 의 import 에 상수를 더한다:

```typescript
import { ProductImportJobManager, ClaimedSession, MAX_CONSECUTIVE_JOB_FAILURES } from './product-import-job.manager';
```

그리고 describe 안에 추가:

```typescript
  it('슬라이스 밖 예외는 연속 실패를 올리기만 하고 레인 상태는 그대로 둔다', async () => {
    const { manager, updates } = makeHarness({ returningRows: [[{ consecutiveFailures: 3 }]] });

    await manager.recordJobError('sess-1', 'commit', 'DB 연결 끊김');

    // 일시적 DB 오류로 임포트를 영구 실패시키는 편이 더 나쁘다 — 상한 전까지는 재시도한다.
    expect(updates).toHaveLength(1);
    expect(updates[0].values.commitError).toBe('DB 연결 끊김');
    expect(updates[0].values.commitStatus).toBeUndefined();
    expect(updates[0].values.leaseToken).toBeUndefined();
  });

  it('연속 실패가 상한에 닿으면 그 레인을 failed 로 확정하고 lease 를 놓는다', async () => {
    const { manager, updates } = makeHarness({
      returningRows: [[{ consecutiveFailures: MAX_CONSECUTIVE_JOB_FAILURES }]],
    });

    await manager.recordJobError('sess-1', 'publish', '알 수 없는 오류');

    expect(updates).toHaveLength(2);
    // 스키마에만 있고 아무도 쓰지 않던 'failed' 값이 드디어 쓰이는 자리다.
    expect(updates[1].values).toMatchObject({ publishStatus: 'failed', leaseUntil: null, leaseToken: null });
  });

  it('commit 레인의 상한도 commit_status 를 failed 로 만든다 — publish 로 고정되면 안 된다', async () => {
    const { manager, updates } = makeHarness({
      returningRows: [[{ consecutiveFailures: MAX_CONSECUTIVE_JOB_FAILURES + 5 }]],
    });

    await manager.recordJobError('sess-1', 'commit', '알 수 없는 오류');

    expect(updates[1].values).toMatchObject({ commitStatus: 'failed' });
    expect(updates[1].values.publishStatus).toBeUndefined();
  });

  it('연속 실패 리셋은 0 보다 클 때만 실제 행에 닿는다', async () => {
    const { manager, updates } = makeHarness();

    await manager.clearConsecutiveFailures('sess-1');

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ consecutiveFailures: 0 });
    expect(renderSql(updates[0].condition).toLowerCase()).toContain('"consecutive_failures" >');
  });
```

`product-import-job.worker.spec.ts` 의 `makeWorker` 하네스에 새 목을 더한다(`recordJobError` 줄 아래):

```typescript
    recordJobError: jest.fn(async () => undefined),
    clearConsecutiveFailures: jest.fn(async () => undefined),
```

그리고 describe 안에 추가:

```typescript
  it('슬라이스가 정상 종료하면 연속 실패를 리셋한다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });

    await worker.tick();

    expect(jobManager.clearConsecutiveFailures).toHaveBeenCalledWith('sess-1');
  });

  it('슬라이스가 터지면 리셋하지 않는다 — 리셋하면 상한이 영원히 안 걸린다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.runCommitSlice.mockRejectedValue(new Error('DB down'));

    await worker.tick();

    expect(jobManager.clearConsecutiveFailures).not.toHaveBeenCalled();
  });

  it('publish 슬라이스가 정상 종료해도 리셋한다', async () => {
    const { worker, jobManager } = makeWorker({ claims: [null] });
    jobManager.claimPublish = jest.fn(async () => ({ sessionId: 'sess-2', leaseToken: 'tok-2' }));

    await worker.tick();

    expect(jobManager.clearConsecutiveFailures).toHaveBeenCalledWith('sess-2');
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npx jest --testPathPattern=product-import-job
```

기대: 신규 7개 FAIL(`MAX_CONSECUTIVE_JOB_FAILURES` 미정의, `clearConsecutiveFailures is not a function`).

- [ ] **Step 3: 상수와 import 를 더한다**

`product-import-job.manager.ts` 상단:

```typescript
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
```

상수 블록(`:14-16`)에 추가:

```typescript
export const DEFAULT_LEASE_MS = 60_000;
/**
 * 슬라이스 밖으로 탈출한 예외의 연속 허용 횟수. 넘으면 그 레인을 failed 로 확정한다.
 *
 * 10회는 틱 간격(5초) 기준 최소 50초다 — 일시적 DB 오류·배포 중 커넥션 끊김은 그 안에
 * 회복되므로 "일시적 오류로 임포트를 영구 실패시키지 않는다"는 원래 설계 의도가 보존된다.
 * 진짜 결정적 오류(payload 형태 불일치 등)만 상한에 닿는다.
 */
export const MAX_CONSECUTIVE_JOB_FAILURES = 10;
```

- [ ] **Step 4: `recordJobError` 를 확장하고 `clearConsecutiveFailures` 를 만든다**

`recordJobError` 전체를 교체하고 바로 아래에 새 메서드를 붙인다:

```typescript
  /**
   * 슬라이스를 탈출한 예외를 세션에 기록하고 **연속 실패를 센다.**
   *
   * 상한 전까지는 상태를 바꾸지 않는다 — 일시적 DB 오류로 임포트를 영구 실패시키는 편이
   * 더 나쁘다. lease 도 지우지 않는다: 예외가 났다는 건 우리가 지금 어떤 상태인지 모른다는
   * 뜻이고, 그 상태에서 lease 를 지우면 후임 워커의 lease 를 지울 수도 있다. 만료를
   * 기다리면 그만이다(최대 leaseMs).
   *
   * 상한에 닿으면 이야기가 달라진다 — 그 레인을 failed 로 확정하므로 claim 후보에서
   * 빠지고, 새 후임이 생기지 않는다. 그래서 이때만은 lease 를 지운다(토큰 CAS 없이):
   * 혹시 남아 있는 후임이 있다면 그 renewLease 가 실패해 스스로 멈추는데, 레인이 이미
   * failed 인 이상 그 중단이 옳은 방향이다. CAS 를 걸면 소유권이 옮겨간 순간 상한이
   * 영원히 발화하지 못한다.
   */
  async recordJobError(sessionId: string, kind: 'commit' | 'publish', message: string): Promise<void> {
    const rows = await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({
          ...(kind === 'commit' ? { commitError: message } : { publishError: message }),
          consecutiveFailures: sql`${productImportSessions.consecutiveFailures} + 1`,
        })
        .where(eq(productImportSessions.id, sessionId))
        .returning({ consecutiveFailures: productImportSessions.consecutiveFailures }),
    );

    const failures = rows[0]?.consecutiveFailures ?? 0;
    if (failures < MAX_CONSECUTIVE_JOB_FAILURES) return;

    this.logger.error(
      `임포트 잡이 ${failures}회 연속 실패해 ${kind} 레인을 failed 로 확정한다 (session=${sessionId})`,
    );
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({
          ...(kind === 'commit' ? { commitStatus: 'failed' as const } : { publishStatus: 'failed' as const }),
          leaseUntil: null,
          leaseToken: null,
        })
        .where(eq(productImportSessions.id, sessionId)),
    );
  }

  /**
   * 슬라이스가 예외 없이 끝났으면 연속 실패를 0 으로 되돌린다. 리셋이 없으면 산발적
   * 오류가 누적돼 멀쩡한 세션이 언젠가 상한에 닿는다.
   *
   * `> 0` 조건을 붙여 흔한 경우(이미 0)에는 실제 행에 닿지 않게 한다 — 슬라이스마다 도는
   * 왕복이라 write 를 만들지 않는 편이 낫다.
   */
  async clearConsecutiveFailures(sessionId: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ consecutiveFailures: 0 })
        .where(and(eq(productImportSessions.id, sessionId), gt(productImportSessions.consecutiveFailures, 0))),
    );
  }
```

- [ ] **Step 5: 워커가 리셋을 부르게 한다**

`product-import-job.worker.ts` 의 `try` 블록을 교체:

```typescript
    try {
      // commit 이 우선이다 — 생성이 끝나야 게시할 것이 생긴다.
      claimed = await this.jobManager.claimCommit();
      if (claimed) {
        await this.jobManager.runCommitSlice(claimed);
        // 여기 도달했다는 건 슬라이스가 예외 없이 끝났다는 뜻이다 — 연속 실패를 되돌린다.
        // catch 블록에서 부르면 안 된다(리셋이 상한을 영원히 막는다).
        await this.jobManager.clearConsecutiveFailures(claimed.sessionId);
        return;
      }
      kind = 'publish';
      claimed = await this.jobManager.claimPublish();
      if (claimed) {
        await this.jobManager.runPublishSlice(claimed);
        await this.jobManager.clearConsecutiveFailures(claimed.sessionId);
      }
    } catch (error) {
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern=product-import-job
```

기대: 단위 스펙 전부 PASS.

- [ ] **Step 7: 타입 게이트**

```bash
npm run type-check:scoped
```

기대: 둘 다 성공.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.spec.ts
git commit -m "feat(product-import): 슬라이스 탈출 예외에 연속 실패 상한을 건다

recordJobError 가 상태를 바꾸지 않도록 설계돼 있어 예외가 반복되면 매 틱 무한
재시도했다(그래서 product_import_job_status.'failed' 를 쓰는 코드가 없었다).
연속 10회를 넘으면 그 레인을 failed 로 확정하고 lease 를 놓는다."
```

---

### Task 6: 실 Postgres 통합 테스트

목 하네스는 `.returning()` 을 where 절과 무관하게 돌려주므로 **취소 가드가 실제 행에 어떻게 작용하는지 증명하지 못한다** — 이 스펙 파일이 존재하는 이유가 정확히 그것이다(lease 소유권이 세 번 연속 깨졌는데 세 번 다 목 스펙에는 초록이었다).

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job-lease.integration.spec.ts`

**Interfaces:**
- Consumes: Task 4 의 `renewLease(…): Promise<{ owned: boolean; canceled: boolean }>`, Task 5 의 `recordJobError`·`MAX_CONSECUTIVE_JOB_FAILURES`
- Produces: 없음(테스트 전용)

- [ ] **Step 1: 사전 조건을 확인한다**

이 스펙은 `CREATE TABLE … (LIKE public.product_import_sessions INCLUDING ALL)` 로 **로컬 DB 의 실제 DDL 을 복제**한다. Task 1 의 마이그레이션이 로컬에 적용돼 있지 않으면 새 컬럼이 없는 테이블이 만들어져 테스트가 무의미하게 실패한다.

```bash
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name='product_import_sessions' AND column_name IN ('cancel_requested_at','consecutive_failures','invalid_count')"
```

기대: 3행. 아니면 Task 1 Step 5 를 다시 돈다.

> `renewLease` 호출부의 타입은 **Task 4 Step 8 에서 이미 맞춰져 있다.** `a.renew(...)` 는 `{ owned, canceled }` 를 돌려준다.

- [ ] **Step 2: 취소 시드 헬퍼를 추가한다**

`seedQueuedPublishSession` 아래에 추가:

```typescript
  /** 취소 요청이 찍힌 세션 하나 — 레인은 cancelSession 이 확정한 대로 canceled 다. */
  async function seedCanceledSession(): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO product_import_sessions
             (id, file_name, total_rows, status, commit_status, cancel_requested_at)
      VALUES (${id}, ${'it-cancel-' + id}, 0, 'completed', 'canceled', NOW())
    `;
    return id;
  }
```

`readLease` 의 SELECT 에 두 컬럼을 더한다:

```typescript
    const [row] = await admin`
      SELECT commit_status,
             publish_status,
             lease_token,
             lease_until,
             committed_at,
             cancel_requested_at,
             consecutive_failures,
             EXTRACT(EPOCH FROM lease_until)::float8 AS lease_epoch,
             (lease_until > NOW()) AS is_live
        FROM product_import_sessions
       WHERE id = ${sessionId}
    `;
    return row as {
      commit_status: string;
      publish_status: string;
      lease_token: string | null;
      lease_until: unknown;
      committed_at: unknown;
      cancel_requested_at: unknown;
      consecutive_failures: number;
      lease_epoch: number | null;
      is_live: boolean | null;
    };
```

- [ ] **Step 3: 실패하는 통합 테스트 8개를 쓴다**

같은 describe 블록 안, 기존 테스트들 뒤에 추가:

```typescript
  it('클레임은 취소 요청된 세션을 집지 않는다 — 굳은 세션의 재시도 루프가 여기서 끊긴다', async () => {
    await seedCanceledSession();

    expect(await a.manager.claimCommit()).toBeNull();
  });

  it('취소 요청만 있고 레인이 아직 queued 여도 집지 않는다 — 두 조건이 독립적으로 막는다', async () => {
    const sessionId = await seedQueuedSession();
    await admin`UPDATE product_import_sessions SET cancel_requested_at = NOW() WHERE id = ${sessionId}`;

    expect(await a.manager.claimCommit()).toBeNull();
  });

  it('renewLease 는 소유권을 유지한 채 취소 요청을 읽어 온다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    // 클레임 이후에 취소가 들어온 상황 — 진행 중 슬라이스가 감지해야 하는 유일한 경로다.
    await admin`UPDATE product_import_sessions SET cancel_requested_at = NOW() WHERE id = ${sessionId}`;

    const lease = await a.renew(sessionId, claimed!.leaseToken);
    expect(lease).toEqual({ owned: true, canceled: true });
  });

  it('취소가 없으면 renewLease 는 canceled:false 다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    expect(await a.renew(sessionId, claimed!.leaseToken)).toEqual({ owned: true, canceled: false });
  });

  it('마감은 취소된 세션을 completed 로 덮지 않는다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();
    await admin`UPDATE product_import_sessions
                   SET cancel_requested_at = NOW(), commit_status = 'canceled'
                 WHERE id = ${sessionId}`;

    // pending 행이 0 이라 마감 경로로 들어간다(협력자는 한 번도 호출되지 않는다).
    await a.manager.runCommitSlice(claimed!);

    const row = await readLease(sessionId);
    expect(row.commit_status).toBe('canceled');
    expect(row.committed_at).toBeNull();
  });

  it('연속 실패가 상한에 닿으면 레인이 failed 로 확정되고 lease 가 풀린다', async () => {
    const sessionId = await seedQueuedSession();
    await a.manager.claimCommit();

    for (let i = 0; i < MAX_CONSECUTIVE_JOB_FAILURES; i += 1) {
      await a.manager.recordJobError(sessionId, 'commit', `반복 오류 ${i}`);
    }

    const row = await readLease(sessionId);
    expect(row.consecutive_failures).toBe(MAX_CONSECUTIVE_JOB_FAILURES);
    expect(row.commit_status).toBe('failed');
    expect(row.lease_token).toBeNull();
    // failed 레인은 claim 후보가 아니다 — 무한 재시도가 여기서 끝난다.
    expect(await a.manager.claimCommit()).toBeNull();
  });

  it('상한 직전까지는 레인을 건드리지 않는다', async () => {
    const sessionId = await seedQueuedSession();
    const claimed = await a.manager.claimCommit();

    for (let i = 0; i < MAX_CONSECUTIVE_JOB_FAILURES - 1; i += 1) {
      await a.manager.recordJobError(sessionId, 'commit', `일시적 오류 ${i}`);
    }

    const row = await readLease(sessionId);
    expect(row.commit_status).toBe('running');
    expect(row.lease_token).toBe(claimed!.leaseToken);
  });

  it('정상 종료한 슬라이스의 리셋이 카운터를 0 으로 되돌린다', async () => {
    const sessionId = await seedQueuedSession();
    await a.manager.claimCommit();
    await a.manager.recordJobError(sessionId, 'commit', '일시적 오류');

    await a.manager.clearConsecutiveFailures(sessionId);

    expect((await readLease(sessionId)).consecutive_failures).toBe(0);
  });
```

파일 상단 import 에 상수를 더한다:

```typescript
import { ProductImportJobManager, MAX_CONSECUTIVE_JOB_FAILURES } from './product-import-job.manager';
```

- [ ] **Step 4: 통합 테스트를 돌린다**

```bash
DATABASE_URL="$DATABASE_URL" REQUIRE_PRODUCT_IMPORT_LEASE_DB=1 \
  npx jest --testPathPattern=product-import-job-lease.integration
```

기대: 전부 PASS. `DATABASE_URL` 이 없으면 스펙 전체가 skip 되므로 **반드시 넣어서 돌린다** — `REQUIRE_PRODUCT_IMPORT_LEASE_DB=1` 이 조용한 skip 을 실패로 바꿔 준다.

- [ ] **Step 5: 타입 게이트**

```bash
npm run type-check:scoped
```

기대: 성공. 에러가 나오면 새로 쓴 테스트 코드의 타입 문제다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-job-lease.integration.spec.ts
git commit -m "test(product-import): 취소 가드·실패 상한을 실 Postgres 에 대고 검증

목 하네스는 .returning() 을 where 절과 무관하게 돌려주므로 취소 가드가 실제 행에
어떻게 작용하는지 증명하지 못한다 — lease 소유권이 세 번 깨졌을 때와 같은 이유다."
```

---

### Task 7: admin-web 취소 UI

세션 상세에 취소 버튼과 확인 다이얼로그를 붙이고, 두 화면이 `canceled` 상태를 읽게 한다.

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/product-import.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/product-import.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/mutations.ts:1045-1057`
- Modify: `apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx`
- Modify: `apps/admin-web/src/features/mall/product-imports/session-list/index.tsx:18-24`

**Interfaces:**
- Consumes: Task 2·3 의 `SessionSummaryDto.invalidCount`·`.cancelRequestedAt`, `CancelAcceptedDto`, `POST /product-imports/:id/cancel`
- Produces: `useCancelSession()` mutation, `productImportClient.cancel(sessionId)`

- [ ] **Step 1: DTO 미러를 맞춘다**

`apps/admin-web/src/lib/types/dto/product-import.ts` 를 수정.

`ImportJobStatus` 를 교체:

```typescript
/** 커밋/게시 잡의 상태. idle 은 아직 아무 잡도 접수되지 않은 상태, canceled 는 사람이 멈춘 상태. */
export type ImportJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
```

`SessionSummaryDto` 에 두 필드를 더한다:

```typescript
  commitError: string | null;
  publishError: string | null;
  /** 접수 시점 검증실패 행 수. 컬럼 도입 이전 세션은 null 이라 화면이 폴백해야 한다. */
  invalidCount: number | null;
  /** 취소 요청 시각(JSON 직렬화 결과). null 이 아니면 이 세션은 종단이다. */
  cancelRequestedAt: string | null;
}
```

`PublishAcceptedDto` 아래에 추가:

```typescript
/** POST /product-imports/:id/cancel 의 200 응답 — 진행 중이던 레인만 canceled 로 확정된다. */
export interface CancelAcceptedDto {
  sessionId: string;
  commitStatus: ImportJobStatus;
  publishStatus: ImportJobStatus;
  canceledAt: string;
}
```

- [ ] **Step 2: HTTP 클라이언트에 `cancel` 을 더한다**

`product-import.client.ts` — import 타입 목록에 `CancelAcceptedDto` 를 더하고, `publish` 아래에 추가:

```typescript
  cancel: async (sessionId: string): Promise<CancelAcceptedDto> => {
    const res = await client.post(`${BASE}/${sessionId}/cancel`);
    return res.data;
  },
```

- [ ] **Step 3: mutation 을 더한다**

`mutations.ts` 의 `usePublishSession` 바로 아래에 추가:

```typescript
/** 세션 취소 — 진행 중인 레인을 멈춘다. 이미 생성/게시된 것은 되돌아오지 않는다. */
export const useCancelSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => products.productImport.cancel(sessionId),
    onSuccess: (_res, sessionId) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.productImport(sessionId),
      });
      // 목록의 상태 라벨도 '취소됨' 으로 바뀌어야 한다.
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.productImports,
      });
    },
  });
};
```

- [ ] **Step 4: 세션 상세에 취소 버튼과 확인 다이얼로그를 붙인다**

`session-detail/index.tsx` 를 수정. import 를 교체:

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
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
import { useImportSession, usePublishSession, useCancelSession } from '@/lib/services/products';
import { getServerDenyMessage } from '@/lib/api/server-error';
```

> `@/components/ui/alert-dialog` 의 실제 export 이름을 먼저 확인한다: `grep -n "^export\|export {" apps/admin-web/src/components/ui/alert-dialog.tsx`. shadcn 기본 생성물이면 위 이름들이 그대로 있다. 다르면 그 파일의 이름을 따른다.

컴포넌트 본문에서 `publish` 선언 아래에 상태와 핸들러를 추가:

```typescript
  const publish = usePublishSession();
  const cancel = useCancelSession();
  const [confirmOpen, setConfirmOpen] = useState(false);

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
```

`commitRunning`/`publishRunning` 아래에 파생값을 추가:

```typescript
  const commitRunning = session.commitStatus === 'queued' || session.commitStatus === 'running';
  const publishRunning = session.publishStatus === 'queued' || session.publishStatus === 'running';
  const canceled = session.cancelRequestedAt !== null;
  // 취소는 진행 중인 레인이 있을 때만 의미가 있다 — 서버도 같은 조건으로 409 를 던진다.
  const cancellable = !canceled && (commitRunning || publishRunning);
```

`Header` 의 `subtitle`·`right` 를 교체:

```typescript
        <Header
          title="대량등록 세션 상세"
          subtitle={
            `${session.fileName ?? '(파일명 없음)'} · 생성 ${session.createdCount}/${session.totalRows}` +
            // invalidCount 가 null 인 옛 세션은 두 종류가 섞인 failedCount 만 보여준다(폴백).
            (session.invalidCount === null
              ? ` (실패 ${session.failedCount})`
              : ` (검증실패 ${session.invalidCount} · 생성실패 ${session.failedCount - session.invalidCount})`) +
            ` · 게시 ${session.publishedCount} (실패 ${session.publishFailedCount})`
          }
          right={
            <div className="flex items-center gap-2">
              {cancellable && (
                <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={cancel.isPending}>
                  {cancel.isPending ? '취소하는 중...' : '작업 취소'}
                </Button>
              )}
              <Button
                onClick={handlePublish}
                disabled={publish.isPending || commitRunning || publishRunning || canceled}
              >
                {canceled
                  ? '취소됨'
                  : commitRunning
                    ? '생성 중...'
                    : publishRunning
                      ? '게시 중...'
                      : '세션 일괄 게시'}
              </Button>
            </div>
          }
        />
```

오류 배너 블록 **위**에 취소 안내를 추가:

```typescript
        {canceled && (
          <div className="mx-6 mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700">
            <p>
              {new Date(session.cancelRequestedAt as string).toLocaleString('ko-KR')} 에 취소된 세션입니다. 이미
              생성·게시된 상품은 되돌아오지 않으니 아래 목록에서 확인 후 직접 정리해 주세요.
            </p>
            <p className="mt-1">다시 등록하려면 워크북을 새로 업로드해 주세요 — 취소된 세션은 재개되지 않습니다.</p>
          </div>
        )}
```

컴포넌트 최상위 `</Container>` 아래, 바깥 `</div>` 앞에 다이얼로그를 붙인다:

```typescript
      </Container>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 세션의 작업을 멈출까요?</AlertDialogTitle>
            <AlertDialogDescription>
              진행 중인 상품 생성·게시가 멈춥니다. <strong>이미 생성되거나 게시된 상품은 되돌아오지 않습니다.</strong>{' '}
              취소한 세션은 다시 이어서 진행할 수 없고, 다시 등록하려면 워크북을 새로 올려야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>작업 취소</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
```

- [ ] **Step 5: 세션 목록의 상태 라벨에 `취소됨` 을 더한다**

`session-list/index.tsx` 의 `jobStatusLabel` 을 교체:

```typescript
function jobStatusLabel(s: Pick<SessionSummaryDto, 'commitStatus' | 'publishStatus'>): string {
  // 취소를 가장 먼저 본다 — 취소된 세션은 어느 레인이 어디서 멈췄든 사람에게는 '취소됨' 하나다.
  if (s.commitStatus === 'canceled' || s.publishStatus === 'canceled') return '취소됨';
  if (s.commitStatus === 'queued' || s.commitStatus === 'running') return '생성 중';
  if (s.commitStatus === 'failed') return '생성 실패';
  if (s.publishStatus === 'queued' || s.publishStatus === 'running') return '게시 중';
  if (s.publishStatus === 'failed') return '게시 실패';
  return '완료';
}
```

- [ ] **Step 6: 폴링이 취소 후 멈추는지 코드로 확인한다**

`apps/admin-web/src/lib/services/products/queries.ts:650-663` 의 `useImportSession` 은 `running(s) = s === 'queued' || s === 'running'` 로 판정한다. `'canceled'` 는 여기 걸리지 않으므로 **폴링이 자동으로 멈춘다 — 코드 변경이 필요 없다.** 다음 명령으로 그 함수가 그대로인지만 확인한다:

```bash
sed -n '650,665p' apps/admin-web/src/lib/services/products/queries.ts
```

기대: `refetchInterval` 이 `running(data.commitStatus) || running(data.publishStatus)` 를 보고 있고, `running` 이 `queued`/`running` 만 참으로 본다. 다르면 `'canceled'` 를 폴링 대상에서 빼도록 고친다.

- [ ] **Step 7: 타입 게이트**

```bash
npx tsc -p apps/admin-web/tsconfig.json --noEmit
```

기대: **admin-web `type-check` 는 레포 상시 debt 라 develop 에서도 red 다.** 전체 초록을 기대하지 말고, 우리가 만진 5개 파일에서 **새 에러가 없는지**만 본다:

```bash
npx tsc -p apps/admin-web/tsconfig.json --noEmit 2>&1 | grep -E "product-import|session-detail|session-list|mutations\.ts"
```

기대: 출력 없음.

- [ ] **Step 8: 빌드로 한 번 더 본다**

```bash
npm run build:admin-web
```

기대: 성공. 실패하면 우리 변경 때문인지 develop 에서도 실패하는지 확인한다.

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 대량등록 세션 취소 버튼

세션 상세에 취소 버튼 + 확인 다이얼로그. 되돌아오지 않는다는 사실을 다이얼로그와
취소 배너에 명시한다. 목록은 '취소됨' 라벨을 추가하고, 상세는 invalidCount 가
있는 세션에 한해 검증실패/생성실패를 갈라 보여준다(옛 세션은 현행 표시로 폴백)."
```

---

## 최종 검증

전부 끝난 뒤 한 번에 돌린다.

- [ ] **단위 + 통합 스펙 (임포트 범위)**

```bash
npx jest --testPathPattern=product-import
DATABASE_URL="$DATABASE_URL" REQUIRE_PRODUCT_IMPORT_LEASE_DB=1 \
  npx jest --testPathPattern=product-import-job-lease.integration
```

기대: 전부 PASS. 통합 스펙이 `skipped` 로 나오면 `DATABASE_URL` 이 안 잡힌 것이다 — 그 상태를 "통과"로 보고하지 않는다.

- [ ] **타입 게이트**

```bash
npm run type-check:scoped
```

기대: 둘 다 성공.

- [ ] **변경 파일 lint 차분**

```bash
npx eslint $(git diff --name-only origin/develop -- '*.ts' '*.tsx')
```

전역 `npm run lint` 는 `--fix` 가 붙어 있고 레포 상시 debt 라 쓰지 않는다. 위 명령의 출력에서 **우리가 만든 error** 만 본다(기존 파일에 원래 있던 warning 은 대상이 아니다).

- [ ] **수동 스모크 (dev)**

1. `npm run start:main:dev` + `npm run start:admin-web:dev`
2. 행 200개짜리 워크북을 커밋한다(슬라이스 20 × 틱 5초 → 생성에 최소 50초가 걸려 취소 창이 열린다).
3. 세션 상세에서 **생성 중**에 `작업 취소` → 다이얼로그 확인 → 취소.
4. 확인할 것:
   - 상태가 `취소됨` 으로 바뀌고 폴링이 멈춘다(네트워크 탭에 요청이 더 안 나간다).
   - `게시` 버튼이 비활성이다.
   - 이미 생성된 행은 `생성` 으로 남아 있고 `상품 상세` 링크가 열린다 — 되돌리지 않는 것이 설계다.
   - 서버 로그에 `임포트 세션이 취소돼 슬라이스를 중단한다` 가 한 번 찍힌다.
   - 이후 워커 틱이 이 세션을 다시 집지 않는다(로그에 같은 세션이 안 나온다).
5. 같은 세션에 취소를 한 번 더 → 409 + 토스트.
6. 취소 없이 끝까지 간 세션을 하나 만들어 게시까지 정상 동작하는지 확인한다(회귀).

- [ ] **`invalid_count` 폴백 확인**

마이그레이션 이전에 만들어진 세션(로컬에 없으면 `UPDATE product_import_sessions SET invalid_count = NULL WHERE id = '<id>'` 로 한 건 만든다)의 상세 화면이 `(실패 N)` 현행 표시로 폴백하는지 본다. 새 세션은 `(검증실패 N · 생성실패 M)` 로 갈려야 한다.

## 배포 선행조건

- **마이그레이션 1건, 전부 additive → `migrate` → `deploy` 순서** (ADR-0005 §5 expand phase). 순서를 뒤집으면 새 컬럼을 읽는 새 코드가 컬럼보다 먼저 떠서 깨진다. contract phase 의 `deploy → migrate` 와 반대이니 헷갈리지 말 것.

```bash
npm run db:migrate -- --stage live --deployment lcnine-services --yes
# 그 다음에
sst deploy --stage live
```

- **신규 시크릿·신규 env 없음.** `PRODUCT_IMPORT_WORKER_ENABLED=false` 킬스위치는 그대로 유효하다.
- **admin-web 은 core 와 같은 `sst deploy` 에 실린다.** core 가 먼저 뜨지 않은 상태로 admin-web 만 나가면 취소 버튼이 404 를 받는다 — 한 배포에 묶여 있으므로 별도 조치는 없지만, 롤백할 때는 **admin-web 먼저** 되돌려야 같은 창이 안 생긴다.
- **배포 후 확인**: `SELECT commit_status, count(*) FROM product_import_sessions GROUP BY 1` — `canceled` 는 0행이어야 하고(아직 아무도 취소하지 않았으므로), 기존 세션의 `consecutive_failures` 는 전부 0, `invalid_count` 는 전부 NULL 이어야 한다.

## 범위 밖 (이 계획에서 하지 않는 것)

스펙 §6 의 2~4단계는 각각 별도 계획으로 쓴다.

- `GET /product-imports/:id/progress` 집계 엔드포인트와 admin-web 폴링 전환 (2단계) — `invalid_count` 를 **읽는** 쪽이 여기다.
- 스칼라 필드 6종 + `Categories`·`Constraints` 시트 (3단계)
- 이미지 파이프라인 — `Images` 시트·`product_import_images`·probe/fetch 레인·`image_status` 컬럼·file-service 업로드 클라이언트·취소 시 이미지 정리 (4단계)
- 취소된 세션의 draft 자동 삭제 (스펙 §4 — 하지 않기로 확정)
- 별도 `reset-lease` API (스펙 §3.4.2 — 취소가 겸한다)
- v2 5단계(InboxWorker 배치 claim), phantom masterId, 조합 variant 매칭 누락 (스펙 §5 — 별건)
