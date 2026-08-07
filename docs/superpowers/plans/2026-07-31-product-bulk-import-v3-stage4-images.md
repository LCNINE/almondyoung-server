# 판매상품 대량등록 v3 — 4단계(이미지 파이프라인) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크북이 `Images` 시트로 이미지 URL 을 싣고, 워커가 그 URL 을 점검(probe)·다운로드해 file-service 에 올린 뒤, 생성되는 상품의 대표/부가/본문 이미지로 연결한다.

**Architecture:** 세션에 **이미지 레인**을 하나 더 붙인다 — `image(probe→fetch) → commit → publish`. 두 phase 는 별도 레인이 아니라 `product_import_images.status` 로 구분한다(레인이 늘면 굶주림 경로가 함께 는다). 접수 시점에 이미지가 있으면 `commit_status` 를 `'idle'` 로 두어 커밋 레인을 게이트하고, 이미지 레인이 마감될 때 `'queued'` 로 연다. 워크북은 UUID 를 다루지 않는다 — 어디서든 `IMG-n` 이고, 임포터가 `fileId` 로 치환한다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), ExcelJS, Node 22 전역 `fetch`/`FormData`/`Blob`/`AbortSignal.timeout`, `dns/promises`, jsonwebtoken(HS256), Jest, Next.js(admin-web)

**베이스:** `develop` @ `5d29514e8` (v3 1·2·3단계 전부 머지됨 — 3단계 `5d29514e8`, 1단계 마이그레이션 `20260729181026`)
**브랜치/워크트리:** `feat/product-bulk-import-v3-images` @ `.claude/worktrees/feat+product-bulk-import-v3-images`
**스펙:** `docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` §3.1~§3.5 · §6 4단계

---

## Global Constraints

- **마이그레이션 1건, 전부 additive** → ADR-0005 §5 **expand phase = `migrate` → `deploy`** 순서. contract phase(`deploy` → `migrate`)의 **반대**다. 헷갈리지 말 것.
- **`image_status` 의 DEFAULT 는 반드시 `'completed'`.** `'queued'` 로 두면 마이그레이션 이전 세션 전부가 이미지 레인에 걸려 영원히 대기한다. `commit_status` 가 이미 같은 이유로 `.default('completed')` 다 (`catalog.schema.ts:1030`).
- **`ALTER TYPE ... ADD VALUE` 는 이번에 없다.** `'canceled'` 는 1단계에서 이미 들어갔고, 이미지용 enum 2개는 **새로 만드는** 타입이라 `unsafe use of new value` 제약을 받지 않는다. 그래도 생성된 SQL 은 눈으로 확인한다.
- **신규 시크릿 0건.** Core live env 에 `AUTH_SECRET`·`FILE_SERVICE_URL` 이 이미 있다 (`deployments/lcnine/services/infra/services.ts:344,352`).
- **신규 env 3건, 전부 기본값 있음** (미설정이면 그대로 동작): `PRODUCT_IMPORT_IMAGE_SLICE`(기본 20), `PRODUCT_IMPORT_IMAGE_FETCH_TIMEOUT_MS`(기본 15000), `PRODUCT_IMPORT_IMAGE_MAX_BYTES`(기본 20971520). 셋 다 `ProductImportJobManager.positiveInt` 관례를 따른다.
- **동시성은 1이다.** 슬라이스 안에서 이미지를 **순차** 처리한다. 근거는 core CPU 가 아니라 **단일 `t4g.nano` fck-nat + 고정 EIP**(스펙 §2.11·§3.2.4)다. 나중에 느리다는 판단이 나오면 올려야 할 것은 슬라이스가 아니라 NAT 인스턴스 타입이다 — 이 근거를 코드 주석에 남긴다.
- **레이어 규칙**(CLAUDE.md): Controller → Service → Reader/Manager → Repository. Service 는 2~3줄 흐름만. 도메인 예외는 `@app/shared` 의 `BadRequestError`/`NotFoundError`/`ConflictError`.
- **트랜잭션 전파**: `this.db.run(async (trx) => {...}, tx)`. `DbTransaction` 은 `apps/core/src/modules/catalog/catalog.types.ts` 에서 import. 클래스별 `inTx` 헬퍼를 새로 만들지 않는다 (ADR-0025).
- **HTTP 호출은 트랜잭션 밖에서** 한다. 다운로드·업로드·삭제가 DB 트랜잭션을 물면 커넥션이 초 단위로 잠긴다.
- **`any`·`as` 금지** (프로덕션 코드). 기존 spec 파일의 `as any` 목 하네스는 관례이므로 유지·확장해도 된다.
- **오류 메시지는 한국어.** 기존 톤을 따른다 (`basePrice 는 0보다 큰 숫자여야 합니다`).
- **스코프 밖 (스펙 §4)**: 로컬 파일 드롭존, 태그 임포트, `descriptionHtml`·`shippingMethodId`·`supplierId`, 옵션값별 색상/이미지/정렬, 기존 상품 upsert, 카테고리 신규 생성, **DNS 재바인딩 방어**, file-service 전역 고아 정리 잡, InboxWorker 배치 claim(v2 5단계).
- **검증 게이트 스코프**(repo 상시 debt): `npm run lint`(전역 `--fix`)·전역 `jest`·전역 `tsc`·`nest build core`(webpack module-not-found 12건) 는 develop 에서도 red 라 권위가 아니다. **변경 파일 기준 차분**으로만 판정하고, core 타입 게이트는 `npm run type-check:scoped` 를 쓴다.

### 이 단계가 내리는 판단 — 사람이 알아야 할 것

**1. 참조한 이미지가 하나라도 안 올라오면 그 상품 행은 실패한다.**

대안은 "이미지 없이 상품을 만든다"인데, 그건 이 단계가 존재하는 이유(대량등록 상품이 전부 이미지 없이 생성된다)를 그대로 재생산한다. 게다가 조용하다 — 관리자는 어느 상품에 이미지가 빠졌는지 상품을 하나씩 열어보기 전엔 모른다. 실패시키면 세션 상세 행 목록에 `imageKey` 와 실패 사유가 그대로 뜨고, URL 을 고쳐 워크북을 다시 올리면 된다.

대가는 **소싱처 URL 하나가 죽으면 그걸 참조하는 모든 행이 함께 죽는다**는 것이다(같은 이미지를 여러 상품이 쓰는 것이 흔한 운용이다). 그 대가를 받아들이는 이유는 위와 같고, 진행률 화면이 fetch 실패 수를 따로 보여주므로 원인이 한눈에 보인다.

**2. 커밋을 눌러야 URL 문제를 안다.**

`/validate` 는 동기 엔드포인트라 **ALB 60초 천장**(스펙 §2.11)에 걸린다. 고유 URL 3,000개면 병렬 20 × HEAD 300ms = 45초라 정상일 때도 여유가 없고, 넘기면 504 라 **검사 결과를 통째로 버린다**. 그래서 probe 를 워커로 옮겼고, `/validate` 는 URL **형식**과 키 참조 해석까지만 본다.

그 대가(세션이 생긴 뒤에야 알게 된다)를 받아낼 수단이 **세션 취소**(1단계)이고 확인 수단이 **진행률**(2단계)이다. 1·2단계를 먼저 한 이유가 이것이다.

**3. DNS 재바인딩은 막지 않는다.**

검사한 IP 로 직접 연결하고 Host 헤더를 세팅해야 막을 수 있는데, 이번 입력은 **관리자가 올린 워크북**이지 임의 사용자 입력이 아니다. 리다이렉트 홉마다 IP 를 재검사하는 것까지만 한다. 이 판단을 코드 주석에 남긴다.

---

## File Structure

### apps/core — 신규 파일 7개

| 파일 | 책임 |
|---|---|
| `.../import/services/product-import-image.directive.ts` | 본문 마크다운의 `::product-image{imageKey="…"}` 추출·치환 (순수 함수) |
| `.../import/services/product-import-image.guard.ts` | SSRF 가드 — URL 스킴·IP 분류·DNS 해석 (순수 + `dns/promises`) |
| `.../import/services/product-import-image.fetcher.ts` | probe(HEAD) / fetch(GET+크기 상한 abort) — 리다이렉트 홉마다 재검사 |
| `.../import/services/product-import-file.client.ts` | file-service 업로드·삭제 (서비스 토큰에 `userId` 클레임 포함) |
| `.../import/services/product-import-image.resolver.ts` | 세션 이미지 행 → `SessionImageMap` + 미해결 사유 (순수 함수) |
| `.../import/services/product-import-image.cleaner.ts` | 취소 시 업로드된 이미지 soft delete |
| `.../import/services/product-import-image-lane.integration.spec.ts` | `image_status` DEFAULT · claim 순서 · UNIQUE 제약을 **진짜 Postgres** 로 확인 |

### apps/core — 수정 파일

| 파일 | 이 단계에서의 변경 |
|---|---|
| `.../catalog/schema/catalog.schema.ts` | enum 2개, `product_import_images` 테이블, 세션 `image_status`/`image_error`, claim 인덱스 |
| `.../import/dto/import.types.ts` | `ParsedWorkbook.images`, `RowError.sheet` += `'Images'`, `ProductRecord` 이미지 필드, `SessionImageMap` |
| `.../import/services/product-import.parser.ts` | `Images` 시트 읽기 + 행 상한 |
| `.../import/services/product-import.normalizer.ts` | Images 시트 검증·스텁, `imageKey` 참조 해석(용도 추론), 본문 디렉티브 스캔 |
| `.../import/services/product-import.manager.ts` | `acceptCommit` 이 이미지 행 적재 + 커밋 레인 게이트, `createFromRecord` 가 이미지 주입, `cancelSession` 이 이미지 레인 포함 |
| `.../import/services/product-import-job.manager.ts` | `claimImage`, `runImageSlice`, `recordJobError` kind 확장 |
| `.../import/services/product-import-job.worker.ts` | 틱 순서 `image → commit → publish` |
| `.../import/services/product-import-session.reader.ts` | `getSessionImages`, `getProgressCounts` 에 이미지 집계 |
| `.../import/services/product-import-progress.builder.ts` | `probe`·`fetch` 단계 |
| `.../import/services/product-import.service.ts` | 프리뷰에 `imageCount` |
| `.../import/services/product-import.template.ts` | `Images` 시트 + Products 컬럼 2개 + 본문 디렉티브 예시 |
| `.../import/dto/import-progress.dto.ts` | 단계 키 유니온 확장 |
| `.../import/dto/import-response.dto.ts` | `ResolvedPreviewDto.imageCount`, `CommitAcceptedDto.imageCount`, `SessionSummaryDto.imageStatus/imageError`, `CancelAcceptedDto.imageStatus` |
| `.../import/product-import.module.ts` | 신규 provider 6개 등록 |

### apps/admin-web

| 파일 | 책임 |
|---|---|
| `src/lib/types/dto/product-import.ts` | 미러 타입 확장 (단계 키·`imageStatus`·`imageCount`) |
| `src/features/mall/product-imports/wizard/validate-step.tsx` | 프리뷰에 이미지 수 컬럼 |

**`ProgressPanel` 은 손대지 않는다** — 이미 `progress.stages` 배열을 순회해 그린다(2단계가 이 확장을 미리 준비해 두었다). `visibleStages` 도 분모 0 인 단계를 접으므로 이미지 없는 워크북은 자동으로 2단계처럼 보인다.

---

### Task 1: 스키마 + 마이그레이션

DDL 만 한다 — 이후 태스크들이 이 테이블·컬럼을 읽고 쓴다.

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts` (enum 블록 `:999` 뒤, 세션 테이블 `:1073` 뒤, `catalogSchema` 객체 `:1154`)
- Create: `apps/core/drizzle/<timestamp>_product-import-images.sql` (drizzle-kit 이 생성)
- Modify: `apps/core/drizzle/meta/*` (drizzle-kit 이 생성)

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces:
  - `productImportImageStatusEnum` — `'pending' | 'probed' | 'uploaded' | 'probe_failed' | 'fetch_failed'`
  - `productImportImageUsageEnum` — `'main' | 'description'`
  - `productImportImages` 테이블 핸들 (컬럼: `id`, `sessionId`, `imageKey`, `usage`, `sourceUrl`, `status`, `fileId`, `mimeType`, `sizeBytes`, `errorMessage`, `createdAt`, `updatedAt`)
  - `productImportSessions.imageStatus: PgColumn<...>` (not null, default `'completed'`), `productImportSessions.imageError: PgColumn<string | null>`
  - `catalogSchema.productImportImages`

- [ ] **Step 1: 워크트리 의존성이 설치돼 있는지 확인한다**

git worktree 는 `node_modules` 를 공유하지 않는다. 이 워크트리는 계획 작성 시점에 `npm install` 을 이미 돌렸지만, 다른 머신에서 이어받는다면 먼저 설치한다.

```bash
cd /home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat+product-bulk-import-v3-images
ls node_modules >/dev/null 2>&1 || npm install
npx jest --testPathPattern="product-import" 2>&1 | tail -5
```

기대: 기존 임포트 스펙이 전부 초록. 여기서 빨강이면 설치가 덜 된 것이지 코드 문제가 아니다.

- [ ] **Step 2: enum 2개를 추가한다**

`catalog.schema.ts` 의 `productImportItemPublishStatusEnum` 블록(`:999-1004`) **바로 아래**에 추가한다.

```typescript
/**
 * 이미지 행의 두 phase 를 한 컬럼으로 표현한다. 레인을 둘로 쪼개지 않는 이유는
 * 세션 상태 컬럼과 굶주림 경로가 함께 늘기 때문이다(스펙 §3.3).
 *
 * 5값으로 나누는 이유는 **진행률**이다 — probe 실패는 fetch 단계의 분모에서 빠져야
 * 하는데, 실패를 한 값으로 뭉치면 어느 단계에서 죽었는지 알 수 없어 분모가 틀린다.
 * 5값이면 `GROUP BY status` 하나로 두 단계의 분모·분자·실패가 전부 나온다.
 */
export const productImportImageStatusEnum = pgEnum('product_import_image_status', [
  'pending',
  'probed',
  'uploaded',
  'probe_failed',
  'fetch_failed',
]);

/**
 * 이미지의 **용도**. 참조 지점에서 추론한다 — thumbnailImageKey/additionalImageKeys 에
 * 등장하면 'main', description 본문 디렉티브에 등장하면 'description'.
 *
 * 용도가 갈리는 이유는 file-service 컨텍스트가 다르기 때문이다: `product-image` 는
 * jpeg/png/webp 만 10MB, `product-description-image` 는 image/* 20MB
 * (file-service/src/database/default-file-contexts.ts). 한 키가 양쪽에 쓰이면 행이
 * 둘 생기고 **두 번 업로드해 fileId 가 둘이 된다** — 막지 않는다(스펙 §3.1).
 */
export const productImportImageUsageEnum = pgEnum('product_import_image_usage', ['main', 'description']);
```

- [ ] **Step 3: 세션 테이블에 컬럼 2개 + claim 인덱스를 추가한다**

같은 파일 `productImportSessions` 의 `invalidCount` 줄(`:1073`) **바로 아래**, 닫는 `}` 앞에 추가한다.

```typescript
    invalidCount: integer('invalid_count'),

    // ─── 이미지 레인 (v3 4단계) ───
    /**
     * 이미지 레인(probe → fetch)의 상태.
     *
     * ⚠️ DEFAULT 가 `'completed'` 인 것은 **필수**다. ADD COLUMN 은 기존 행에 DEFAULT 를
     * 채우는데 `'queued'` 로 두면 **마이그레이션 이전 세션 전부가 이미지 레인에 걸려 영원히
     * 대기한다**. 바로 위 commit_status 가 같은 이유로 `.default('completed')` 다.
     * 새 세션은 acceptCommit 이 이미지 유무에 따라 명시로 넣으므로 DEFAULT 에 의존하지 않는다.
     *
     * `Images` 시트가 없는 워크북도 접수 즉시 `'completed'` 라 기존 흐름과 동일하게 동작한다.
     */
    imageStatus: productImportJobStatusEnum('image_status').notNull().default('completed'),
    imageError: text('image_error'),
  },
  (table) => [
```

같은 테이블의 인덱스 배열(`:1082-1083`) 끝에 한 줄 추가한다.

```typescript
    index('idx_import_sessions_publish_claim').on(table.publishStatus, table.leaseUntil),
    // 워커별 2컬럼 인덱스 컨벤션을 그대로 따른다 — 3컬럼 복합으로 묶으면 leading column 이
    // 아닌 레인이 leftmost-prefix 규칙에 걸려 인덱스를 못 탄다.
    index('idx_import_sessions_image_claim').on(table.imageStatus, table.leaseUntil),
  ],
);
```

- [ ] **Step 4: `product_import_images` 테이블을 추가한다**

`productImportItems` 테이블 정의(`:1118` 닫는 `);`) **바로 아래**에 추가한다.

```typescript
/**
 * 세션 스코프의 이미지 행. **행의 단위는 `(imageKey, usage)` 이지 참조 횟수가 아니다** —
 * 여러 상품이 같은 키를 같은 용도로 가리키면 행 하나·업로드 한 번이고 fileId 를 공유한다.
 * 같은 이미지를 여러 상품에 쓰는 것이 흔한 운용이므로 이 dedup 이 NAT 부하를 직접 줄인다
 * (스펙 §3.2.1 — outbound 는 단일 t4g.nano fck-nat 을 Medusa·notification 과 공유한다).
 */
export const productImportImages = pgTable(
  'product_import_images',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => productImportSessions.id, { onDelete: 'cascade' }),
    /** 워크북 스코프 키(`IMG-1` 등). 세션 밖에서는 의미가 없다. */
    imageKey: varchar('image_key', { length: 255 }).notNull(),
    usage: productImportImageUsageEnum('usage').notNull(),
    sourceUrl: text('source_url').notNull(),
    status: productImportImageStatusEnum('status').notNull().default('pending'),
    /** 업로드 성공 시 file-service 가 준 id. 취소 정리가 이 값을 추적한다. */
    fileId: uuid('file_id'),
    mimeType: varchar('mime_type', { length: 255 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // dedup 의 본체. 같은 세션에서 같은 (키, 용도) 는 반드시 한 행이다.
    uniqueIndex('uq_import_images_session_key_usage').on(table.sessionId, table.imageKey, table.usage),
    // 슬라이스 선택(`status='pending'` → `status='probed'`)과 진행률 GROUP BY 가 둘 다 탄다.
    index('idx_import_images_session_status').on(table.sessionId, table.status),
  ],
);
```

`catalogSchema` 객체(`:1153-1154`)에 등록한다.

```typescript
  productImportSessions,
  productImportItems,
  productImportImages,
};
```

- [ ] **Step 5: 마이그레이션을 생성한다**

```bash
npm run db:generate:core -- --name product-import-images
```

이 명령은 대화형일 수 있다(drizzle-kit 이 rename 을 의심할 때). **이번 변경은 전부 신규 추가라 rename 프롬프트가 뜨면 안 된다** — 뜨면 schema.ts 를 잘못 고친 것이니 중단하고 확인한다.

- [ ] **Step 6: 생성된 SQL 을 눈으로 검사한다 (건너뛰지 말 것)**

```bash
ls -t apps/core/drizzle/*.sql | head -1 | xargs cat
```

기대하는 문장(순서는 달라도 된다):

```sql
CREATE TYPE "public"."product_import_image_status" AS ENUM('pending', 'probed', 'uploaded', 'probe_failed', 'fetch_failed');--> statement-breakpoint
CREATE TYPE "public"."product_import_image_usage" AS ENUM('main', 'description');--> statement-breakpoint
CREATE TABLE "product_import_images" ( ... );--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "image_status" "product_import_job_status" DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "image_error" text;--> statement-breakpoint
ALTER TABLE "product_import_images" ADD CONSTRAINT "product_import_images_session_id_product_import_sessions_id_fk" FOREIGN KEY ...;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_import_images_session_key_usage" ...;--> statement-breakpoint
CREATE INDEX "idx_import_images_session_status" ...;--> statement-breakpoint
CREATE INDEX "idx_import_sessions_image_claim" ...;
```

**확인 항목 — 하나라도 어긋나면 멈추고 원인을 찾는다:**

1. **`image_status` 에 `DEFAULT 'completed'` 가 붙어야 한다.** `'queued'` 나 DEFAULT 없음이면 schema.ts 가 틀린 것이다 — 이게 이 마이그레이션의 유일한 진짜 위험이다.
2. **`ALTER TYPE ... ADD VALUE` 가 한 줄도 없어야 한다.** `'canceled'` 는 1단계에서 이미 들어갔고 이미지 enum 2개는 새로 만드는 타입이다. `ADD VALUE` 가 보이면 기존 enum 을 건드린 것이니 되돌린다.
3. **`DROP` 이 한 줄도 없어야 한다.** 전부 additive 여야 `migrate` → `deploy` 순서가 성립한다.
4. **UNIQUE 인덱스가 `(session_id, image_key, usage)` 3컬럼이어야 한다.** 2컬럼이면 한 키가 대표·본문 양쪽에 쓰일 때 충돌한다.

- [ ] **Step 7: 로컬 docker-compose Postgres 에 적용한다**

**AWS dev 스테이지는 폐기됐다** — SST state 상 `lcnine-services/dev` 는 리소스 0개다. 개발은 `docs/local-dev.md` 가 기술하는 로컬 docker-compose Postgres 경로로 진행한다("새 노트북 셋업 체크리스트" 6단계):

```bash
npm run db:migrate:local        # drizzle 서비스 전체 (셸에서 localhost URL 주입 — 원격 DB 절대 안 건드림)
```

실제로 이번 마이그레이션은 `apps/core/.env` 의 `DATABASE_URL`(로컬 docker-compose Postgres, `localhost:5432`)을 대상으로 `npx drizzle-kit migrate` 로 적용했다.

적용 확인:

```bash
psql "$DATABASE_URL" -c "\d product_import_images"
psql "$DATABASE_URL" -c "SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name='product_import_sessions' AND column_name IN ('image_status','image_error')"
psql "$DATABASE_URL" -c "SELECT image_status, count(*) FROM product_import_sessions GROUP BY 1"
```

기대: 테이블 1개(인덱스 2개 + FK), `image_status` 의 default 가 `'completed'::product_import_job_status`, **기존 세션 전부가 `completed`**(0행이어도 좋다).

- [ ] **Step 8: 타입 게이트**

```bash
npm run type-check:scoped
```

기대: 성공. (아직 새 테이블을 읽는 코드가 없으므로 실패할 이유가 없다.)

- [ ] **Step 9: 커밋**

schema.ts·SQL·meta 를 **한 커밋**에 묶는다. 나누면 다른 사람의 체크아웃이 어긋난다.

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle/
git commit -m "feat(product-import): 이미지 파이프라인 스키마 — product_import_images + image_status

- product_import_image_status / product_import_image_usage enum 신설
- product_import_images: UNIQUE(session_id, image_key, usage) + (session_id, status) 인덱스
- product_import_sessions: image_status(DEFAULT 'completed'), image_error, image claim 인덱스
- 전부 additive → ADR-0005 §5 expand phase (migrate → deploy)"
```

---

### Task 2: 본문 디렉티브 헬퍼 (순수 함수)

워크북의 본문 마크다운은 `::product-image{imageKey="IMG-2" alt="…"}` 로 쓰고, 임포터가 커밋 시점에 `fileId="<uuid>"` 로 치환한다. 워크북에는 UUID 가 등장하지 않는다.

기존 `@packages/product-description` 의 `parseProductImageDirective` 는 **mdast 노드**를 받는다(remark-directive 파싱 이후). 임포터는 원문 문자열만 갖고 있으므로 텍스트 레벨 헬퍼를 따로 둔다 — 패키지를 건드리지 않는다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image.directive.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-image.directive.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export function extractDirectiveImageKeys(markdown: string | undefined): string[]` — 등장 순서, 중복 제거
  - `export function replaceDirectiveImageKeys(markdown: string, fileIdByKey: ReadonlyMap<string, string>): string` — `imageKey="X"` 를 `fileId="<uuid>"` 로 치환. 맵에 없는 키는 **그대로 둔다**(호출부가 이미 행을 실패시켰다는 뜻이라 여기서 또 판단하지 않는다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import {
  extractDirectiveImageKeys,
  replaceDirectiveImageKeys,
} from './product-import-image.directive';

describe('extractDirectiveImageKeys', () => {
  it('본문의 imageKey 를 등장 순서로 뽑는다', () => {
    const md = '앞\n::product-image{imageKey="IMG-2" alt="상세"}\n뒤\n::product-image{imageKey="IMG-3"}';
    expect(extractDirectiveImageKeys(md)).toEqual(['IMG-2', 'IMG-3']);
  });

  it('같은 키가 여러 번 나와도 한 번만 돌려준다', () => {
    const md = '::product-image{imageKey="IMG-2"}\n::product-image{imageKey="IMG-2"}';
    expect(extractDirectiveImageKeys(md)).toEqual(['IMG-2']);
  });

  it('속성 순서가 달라도 찾는다', () => {
    expect(extractDirectiveImageKeys('::product-image{alt="a" imageKey="IMG-9"}')).toEqual(['IMG-9']);
  });

  it('imageKey 가 없는 디렉티브(이미 fileId 인 것)는 무시한다', () => {
    const md = '::product-image{fileId="0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee" alt="x"}';
    expect(extractDirectiveImageKeys(md)).toEqual([]);
  });

  it('본문이 없으면 빈 배열', () => {
    expect(extractDirectiveImageKeys(undefined)).toEqual([]);
    expect(extractDirectiveImageKeys('')).toEqual([]);
  });

  it('다른 디렉티브는 건드리지 않는다', () => {
    expect(extractDirectiveImageKeys('::note{imageKey="IMG-1"}')).toEqual([]);
  });
});

describe('replaceDirectiveImageKeys', () => {
  it('imageKey 를 fileId 로 바꾸고 alt 는 보존한다', () => {
    const md = '::product-image{imageKey="IMG-2" alt="상세컷"}';
    const out = replaceDirectiveImageKeys(md, new Map([['IMG-2', '0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee']]));
    expect(out).toBe('::product-image{fileId="0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee" alt="상세컷"}');
  });

  it('같은 키가 여러 번 나오면 전부 바꾼다', () => {
    const md = '::product-image{imageKey="IMG-2"}\nx\n::product-image{imageKey="IMG-2"}';
    const out = replaceDirectiveImageKeys(md, new Map([['IMG-2', 'f-1']]));
    expect(out).toBe('::product-image{fileId="f-1"}\nx\n::product-image{fileId="f-1"}');
  });

  it('맵에 없는 키는 그대로 둔다', () => {
    const md = '::product-image{imageKey="IMG-7"}';
    expect(replaceDirectiveImageKeys(md, new Map())).toBe(md);
  });

  it('본문에 디렉티브가 없으면 원문 그대로', () => {
    expect(replaceDirectiveImageKeys('그냥 설명', new Map([['IMG-1', 'f-1']]))).toBe('그냥 설명');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.directive" 2>&1 | tail -20
```

기대: FAIL — 모듈이 없어 해석 실패.

- [ ] **Step 3: 구현한다**

```typescript
/**
 * 워크북 본문 마크다운의 `::product-image{imageKey="IMG-n"}` 디렉티브를 다룬다.
 *
 * 기존 `@packages/product-description` 의 파서는 **mdast 노드**를 받는다(remark-directive
 * 파싱 이후). 임포터는 셀에서 읽은 원문 문자열만 갖고 있으므로 텍스트 레벨로 따로 다룬다 —
 * 마크다운 파서를 임포트 경로에 끌어들이지 않기 위해서다.
 *
 * `imageKey` 는 **워크북 스코프**다. AI/MD 가 바이너리나 UUID 를 다루지 않게 하는 것이
 * 이 간접참조의 목적이고, 커밋 시점에 여기서 fileId 로 바뀐다(스펙 §2.4·§3.1).
 */

/** `::product-image{...}` 한 덩어리. 중괄호 안에 중괄호가 없다는 전제는 디렉티브 문법이 보장한다. */
const DIRECTIVE_RE = /::product-image\{([^}]*)\}/g;
/** 속성 하나. 순서에 의존하지 않으려고 attrs 안에서 따로 찾는다. */
const IMAGE_KEY_ATTR_RE = /imageKey\s*=\s*"([^"]*)"/;

export function extractDirectiveImageKeys(markdown: string | undefined): string[] {
  if (!markdown) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  // 전역 정규식은 lastIndex 를 들고 있다 — 모듈 상수를 여러 호출이 공유하므로
  // matchAll 로 새 이터레이터를 만든다(exec 루프를 쓰면 호출 간에 상태가 샌다).
  for (const match of markdown.matchAll(DIRECTIVE_RE)) {
    const attr = IMAGE_KEY_ATTR_RE.exec(match[1]);
    const key = attr?.[1]?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function replaceDirectiveImageKeys(markdown: string, fileIdByKey: ReadonlyMap<string, string>): string {
  return markdown.replace(DIRECTIVE_RE, (whole, attrs: string) => {
    const attr = IMAGE_KEY_ATTR_RE.exec(attrs);
    const key = attr?.[1]?.trim();
    if (!key) return whole;
    const fileId = fileIdByKey.get(key);
    // 맵에 없으면 그대로 둔다. 이 상황은 호출부가 이미 그 행을 실패시켰다는 뜻이라
    // (unresolvedImageError) 여기서 또 판단하지 않는다 — 판단 지점을 하나로 모은다.
    if (!fileId) return whole;
    return whole.replace(attr[0], `fileId="${fileId}"`);
  });
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.directive" 2>&1 | tail -10
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS, 신규 타입 error 0건.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-image.directive.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-image.directive.spec.ts
git commit -m "feat(product-import): 본문 디렉티브 imageKey 추출·치환 헬퍼"
```

---

### Task 3: `Images` 시트 파싱 + 타입 확장

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import.types.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts`
- Test(수정): `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts` (목 워크북 헬퍼에 `images: []` 추가)

**Interfaces:**
- Consumes: Task 2 없음(독립)
- Produces:
  - `ParsedWorkbook.images: RawRow[]`
  - `RowError.sheet: 'Products' | 'Options' | 'Variants' | 'Categories' | 'Constraints' | 'Images'`
  - `export const MAX_IMAGE_ROWS = 10_000` (parser)
  - `export const MAX_ADDITIONAL_IMAGE_KEYS = 5` (import.types.ts)
  - `export type ProductImageUsage = 'main' | 'description'`
  - `export interface ImageSourceRef { imageKey: string; usage: ProductImageUsage; sourceUrl: string }`
  - `ProductRecord` 신규 **선택** 필드: `thumbnailImageKey?`, `additionalImageKeys?`, `descriptionImageKeys?`, `imageRefs?`
  - `export interface SessionImageMap { main: Map<string, string>; description: Map<string, string> }`
  - `export const EMPTY_SESSION_IMAGES: SessionImageMap`

**⚠️ 신규 `ProductRecord` 필드는 전부 `?` 다 — 이건 취향이 아니라 배포 안전장치다.**

`isProductRecord`(`product-import-job.manager.ts:40`)는 payload 의 최소 형태를 확인하고, 어긋나면 **그 행을 실패시킨다**. 롤링 배포 창에서는 **옛 코드가 접수한 payload 를 새 코드가 처리**한다 — 그 payload 엔 이미지 필드가 없다. 필수 배열로 만들고 가드에 `Array.isArray` 를 추가하면 그 세션의 모든 행이 "행 데이터 형식이 달라 처리할 수 없습니다"로 죽는다. **가드는 이번에 확장하지 않는다.** 소비자는 전부 `?? []` 로 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-import.parser.spec.ts` 에 추가한다(파일 상단의 `buildWorkbook` / `PRODUCTS_MINIMAL` 헬퍼를 재사용한다 — 3단계 Task 1 에서 만들었다).

```typescript
describe('ProductImportParser — Images 시트', () => {
  const parser = new ProductImportParser();

  it('시트가 없으면 빈 배열이다 (기존 워크북 하위호환)', async () => {
    const parsed = await parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL }));
    expect(parsed.images).toEqual([]);
  });

  it('Images 시트를 헤더명 → 셀 맵으로 읽는다', async () => {
    const parsed = await parser.parse(
      await buildWorkbook({
        Products: PRODUCTS_MINIMAL,
        Images: [
          ['imageKey', 'sourceUrl'],
          ['IMG-1', 'https://supplier.example/p/1/main.jpg'],
          ['IMG-2', 'https://supplier.example/p/1/detail.jpg'],
        ],
      }),
    );
    expect(parsed.images).toEqual([
      { rowNumber: 1, cells: { imageKey: 'IMG-1', sourceUrl: 'https://supplier.example/p/1/main.jpg' } },
      { rowNumber: 2, cells: { imageKey: 'IMG-2', sourceUrl: 'https://supplier.example/p/1/detail.jpg' } },
    ]);
  });

  it('Images 행 상한을 넘으면 거부한다', async () => {
    const rows: string[][] = [['imageKey', 'sourceUrl']];
    for (let i = 0; i <= MAX_IMAGE_ROWS; i++) rows.push([`IMG-${i}`, `https://e.example/${i}.jpg`]);
    await expect(parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL, Images: rows }))).rejects.toThrow(
      /Images/,
    );
  });
});
```

파일 상단 import 에 `MAX_IMAGE_ROWS` 를 추가한다.

```typescript
import { ProductImportParser, MAX_CATEGORY_ROWS, MAX_CONSTRAINT_ROWS, MAX_IMAGE_ROWS } from './product-import.parser';
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.parser" 2>&1 | tail -20
```

기대: FAIL — `MAX_IMAGE_ROWS` 미export 로 TS 오류, `parsed.images` 가 `undefined`.

- [ ] **Step 3: 타입을 넓힌다**

`import.types.ts` 의 `ParsedWorkbook` 과 `RowError` 를 교체한다.

```typescript
export interface ParsedWorkbook {
  products: RawRow[];
  options: RawRow[];
  /** 선택 시트 — 없으면 빈 배열 */
  variants: RawRow[];
  /** 선택 시트 — 다중 카테고리 지정. 없으면 빈 배열(Products.categoryPath 하위호환) */
  categories: RawRow[];
  /** 선택 시트 — 구매제약. 없으면 빈 배열 */
  constraints: RawRow[];
  /** 선택 시트 — 이미지 URL 사전(`imageKey` → `sourceUrl`). 없으면 빈 배열 */
  images: RawRow[];
}

export interface RowError {
  sheet: 'Products' | 'Options' | 'Variants' | 'Categories' | 'Constraints' | 'Images';
  rowNumber: number;
  message: string;
}
```

같은 파일 아무 곳(권장: `NormalizedVariantOverride` 위)에 이미지 타입을 추가한다.

```typescript
/**
 * 이미지 용도. **참조 지점에서 추론한다** — thumbnailImageKey/additionalImageKeys 에
 * 등장하면 'main', description 본문 디렉티브에 등장하면 'description'.
 * 양쪽에 등장하면 오류로 막지 않고 두 번 업로드해 fileId 두 개를 만든다(스펙 §3.1).
 * MD/AI 가 채울 칸이 하나 줄고, 컨텍스트별 MIME 제약이 자동으로 맞는다.
 */
export type ProductImageUsage = 'main' | 'description';

/** 도메인 상한이다 — create-master.dto.ts:11 의 `.max(5)`. */
export const MAX_ADDITIONAL_IMAGE_KEYS = 5;

/** 한 상품이 참조하는 이미지 하나. acceptCommit 이 이걸 모아 (키, 용도) 로 dedup 한다. */
export interface ImageSourceRef {
  imageKey: string;
  usage: ProductImageUsage;
  sourceUrl: string;
}

/**
 * 커밋 슬라이스가 세션 이미지 행에서 만들어 `createFromRecord` 에 넘기는 맵.
 * 용도별로 갈라 두어야 같은 키가 양쪽에 쓰일 때 서로 다른 fileId 가 섞이지 않는다.
 */
export interface SessionImageMap {
  /** usage='main' 인 imageKey → fileId */
  main: Map<string, string>;
  /** usage='description' 인 imageKey → fileId */
  description: Map<string, string>;
}

/** 이미지가 없는 세션·테스트용. 호출부가 매번 빈 Map 을 두 개 만들지 않게. */
export const EMPTY_SESSION_IMAGES: SessionImageMap = { main: new Map(), description: new Map() };
```

`ProductRecord` 에 필드를 추가한다 (`errors` 바로 위).

```typescript
  /**
   * Products.thumbnailImageKey. **선택 필드인 이유는 롤링 배포다** — 옛 코드가 접수한
   * payload 에는 이 키들이 없고, isProductRecord 가드를 확장하면 그 세션 전 행이 죽는다.
   * 소비자는 전부 `?? []` / `?? undefined` 로 읽는다.
   */
  thumbnailImageKey?: string;
  /** Products.additionalImageKeys ('|' 구분, 최대 5). 지정 순서가 sortOrder 가 된다. */
  additionalImageKeys?: string[];
  /** description 본문 디렉티브가 참조하는 키. 등장 순서·중복 제거. */
  descriptionImageKeys?: string[];
  /**
   * 위 셋을 Images 시트와 접합한 결과. `(imageKey, usage)` 로 중복 제거돼 있다.
   * acceptCommit 이 **오류 없는 행의 것만** 모아 product_import_images 를 만든다 —
   * 어차피 만들지 않을 상품의 이미지를 NAT 로 끌어올 이유가 없다.
   */
  imageRefs?: ImageSourceRef[];
```

- [ ] **Step 4: 파서가 시트를 읽게 한다**

`product-import.parser.ts` 의 `MAX_CONSTRAINT_ROWS` 아래에 추가한다.

```typescript
/**
 * 상품 1000행 × (대표 1 + 부가 5 + 본문 n) 을 넉넉히 담는 실용 상한. 파일 크기 상한
 * (10MB)에 먼저 걸리는 것이 보통이고, 이 값은 파싱 메모리를 보호한다.
 */
export const MAX_IMAGE_ROWS = 10_000;
```

`parse()` 의 constraints 블록 뒤, `return` 직전에 추가한다.

```typescript
    const imagesSheet = wb.getWorksheet('Images');
    const images = imagesSheet ? this.readSheet(imagesSheet) : [];
    if (images.length > MAX_IMAGE_ROWS) {
      throw new BadRequestError(`Images 행이 상한(${MAX_IMAGE_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }
```

`return` 문을 교체한다.

```typescript
    return { products, options, variants, categories, constraints, images };
```

- [ ] **Step 5: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -30
```

기대: 파서 테스트 PASS. **다른 임포트 스펙이 TS 오류로 깨질 수 있다** — `ParsedWorkbook` 에 필수 필드가 하나 늘었으므로 목 워크북을 만드는 헬퍼를 고쳐야 한다. 대상은 `product-import.normalizer.spec.ts` 의 `parsedWith()`(3단계에서 만든 헬퍼)다. 다음처럼 `images` 를 받도록 넓힌다.

```typescript
function parsedWith(
  products: Record<string, string>[],
  extra: {
    categories?: Record<string, string>[];
    constraints?: Record<string, string>[];
    images?: Record<string, string>[];
  } = {},
) {
  return {
    products: products.map((cells, i) => ({ rowNumber: i + 1, cells })),
    options: [],
    variants: [],
    categories: (extra.categories ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
    constraints: (extra.constraints ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
    images: (extra.images ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
  };
}
```

`product-import.service.spec.ts` 등에서 `ParsedWorkbook` 리터럴을 만드는 자리가 더 있으면 같은 방식으로 `images: []` 를 채운다. 컴파일 오류가 알려준다.

- [ ] **Step 6: 타입 게이트 + 커밋**

```bash
npm run type-check:scoped 2>&1 | tail -10
git add apps/core/src/modules/catalog/operations/import/dto/import.types.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts
git commit -m "feat(product-import): Images 시트 파싱 + 이미지 타입 확장"
```

---

### Task 4: 정규화기 — 이미지 키 해석

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts`

**Interfaces:**
- Consumes: `ParsedWorkbook.images`, `ProductImageUsage`, `ImageSourceRef`, `MAX_ADDITIONAL_IMAGE_KEYS` (Task 3), `extractDirectiveImageKeys` (Task 2)
- Produces: `ProductRecord.thumbnailImageKey` / `.additionalImageKeys` / `.descriptionImageKeys` / `.imageRefs` 가 채워진다. Images 시트 자체의 오류는 **스텁 레코드**로 남는다(고아 productKey 참조와 같은 취급).

**규칙:**
1. `imageKey` 또는 `sourceUrl` 이 비면 Images 스텁 오류.
2. `imageKey` 중복 → Images 스텁 오류(두 번째 행부터). **첫 행은 살아있다** — 나중 행이 조용히 덮지 않는다(Constraints 와 같은 분담).
3. `sourceUrl` 이 `http`/`https` 로 파싱되지 않으면 Images 스텁 오류. **형식만 본다** — 도달 가능성은 워커의 probe 가 본다.
4. 정의되지 않은 `imageKey` 참조 → 그 **상품 행**의 오류 (`sheet: 'Products'`).
5. `additionalImageKeys` 가 5개 초과 → 상품 행 오류. 같은 키가 두 번 → 상품 행 오류.
6. 용도는 참조 지점이 정한다. thumbnail·additional → `'main'`, 본문 디렉티브 → `'description'`. **양쪽에 등장하면 ref 가 둘 생긴다**(막지 않는다).

**URL 형식 검사를 validator 가 아니라 여기서 하는 이유:** validator 는 `ProductRecord` 만 훑는데, Images 시트 행은 상품에 붙지 않는 것이 있을 수 있어 붙일 레코드가 없다. 스텁 레코드를 만드는 주체가 정규화기이므로 검사도 여기 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
describe('ProductImportNormalizer — Images 시트', () => {
  const normalizer = new ProductImportNormalizer();
  const IMAGES = [
    { imageKey: 'IMG-1', sourceUrl: 'https://e.example/1.jpg' },
    { imageKey: 'IMG-2', sourceUrl: 'https://e.example/2.jpg' },
    { imageKey: 'IMG-3', sourceUrl: 'https://e.example/3.jpg' },
  ];

  it('대표·부가 키를 main 용도로, 본문 디렉티브 키를 description 용도로 접합한다', () => {
    const [rec] = normalizer.normalize(
      parsedWith(
        [
          {
            productKey: 'P1',
            name: '니트A',
            thumbnailImageKey: 'IMG-1',
            additionalImageKeys: 'IMG-2|IMG-3',
            description: '부드러운 니트\n::product-image{imageKey="IMG-2"}',
          },
        ],
        { images: IMAGES },
      ),
      CATEGORIES,
    );
    expect(rec.errors).toEqual([]);
    expect(rec.thumbnailImageKey).toBe('IMG-1');
    expect(rec.additionalImageKeys).toEqual(['IMG-2', 'IMG-3']);
    expect(rec.descriptionImageKeys).toEqual(['IMG-2']);
    // IMG-2 는 main·description 양쪽에 쓰여 ref 가 둘이다 — 업로드도 두 번, fileId 도 둘.
    expect(rec.imageRefs).toEqual([
      { imageKey: 'IMG-1', usage: 'main', sourceUrl: 'https://e.example/1.jpg' },
      { imageKey: 'IMG-2', usage: 'main', sourceUrl: 'https://e.example/2.jpg' },
      { imageKey: 'IMG-3', usage: 'main', sourceUrl: 'https://e.example/3.jpg' },
      { imageKey: 'IMG-2', usage: 'description', sourceUrl: 'https://e.example/2.jpg' },
    ]);
  });

  it('이미지를 안 쓰는 행은 imageRefs 가 빈 배열이다', () => {
    const [rec] = normalizer.normalize(parsedWith([{ productKey: 'P1', name: 'x' }]), CATEGORIES);
    expect(rec.imageRefs).toEqual([]);
    expect(rec.errors).toEqual([]);
  });

  it('정의되지 않은 imageKey 참조는 상품 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', thumbnailImageKey: 'GHOST' }], { images: IMAGES }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Products' && /GHOST/.test(e.message))).toBe(true);
    expect(rec.imageRefs).toEqual([]);
  });

  it('본문 디렉티브가 정의되지 않은 키를 가리켜도 상품 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', description: '::product-image{imageKey="GHOST"}' }], {
        images: IMAGES,
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Products' && /GHOST/.test(e.message))).toBe(true);
  });

  it('부가 이미지 6개는 상품 행 오류', () => {
    const many = ['IMG-1', 'IMG-2', 'IMG-3', 'IMG-1', 'IMG-2', 'IMG-3'].join('|');
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', additionalImageKeys: many }], { images: IMAGES }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => /부가 이미지/.test(e.message))).toBe(true);
  });

  it('부가 이미지에 같은 키가 두 번이면 상품 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', additionalImageKeys: 'IMG-2|IMG-2' }], { images: IMAGES }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => /중복/.test(e.message))).toBe(true);
  });

  it('imageKey 중복은 Images 스텁 오류이고 첫 행은 살아있다', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', thumbnailImageKey: 'IMG-1' }], {
        images: [
          { imageKey: 'IMG-1', sourceUrl: 'https://e.example/first.jpg' },
          { imageKey: 'IMG-1', sourceUrl: 'https://e.example/second.jpg' },
        ],
      }),
      CATEGORIES,
    );
    const stub = records.find((r) => r.errors.some((e) => e.sheet === 'Images'));
    expect(stub).toBeDefined();
    expect(stub!.errors[0].rowNumber).toBe(2);
    const [product] = records;
    expect(product.imageRefs?.[0].sourceUrl).toBe('https://e.example/first.jpg');
  });

  it('http/https 가 아닌 sourceUrl 은 Images 스텁 오류', () => {
    for (const bad of ['file:///etc/passwd', 'gopher://x/1', 'ftp://e.example/a.jpg', '그냥문자열']) {
      const records = normalizer.normalize(
        parsedWith([{ productKey: 'P1', name: 'x' }], { images: [{ imageKey: 'IMG-1', sourceUrl: bad }] }),
        CATEGORIES,
      );
      expect(records.some((r) => r.errors.some((e) => e.sheet === 'Images' && /sourceUrl/.test(e.message)))).toBe(true);
    }
  });

  it('imageKey 나 sourceUrl 이 비면 Images 스텁 오류', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        images: [
          { imageKey: '', sourceUrl: 'https://e.example/1.jpg' },
          { imageKey: 'IMG-9', sourceUrl: '' },
        ],
      }),
      CATEGORIES,
    );
    expect(records.filter((r) => r.errors.some((e) => e.sheet === 'Images')).length).toBe(2);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.normalizer" -t "Images" 2>&1 | tail -25
```

기대: FAIL — `imageRefs` 가 `undefined`.

- [ ] **Step 3: 구현한다**

`product-import.normalizer.ts` 의 import 를 넓힌다.

```typescript
import {
  ParsedWorkbook,
  CategoryNode,
  ProductRecord,
  NormalizedOption,
  RawRow,
  RowError,
  ImageSourceRef,
  MAX_ADDITIONAL_IMAGE_KEYS,
  comboKey,
  parseBoolCell,
} from '../dto/import.types';
import { extractDirectiveImageKeys } from './product-import-image.directive';
```

`normalize()` 안, Products 루프 **직전**에 이미지 사전을 만든다(Products 루프가 그걸 쓴다).

```typescript
    const records: ProductRecord[] = [];
    const byKey = new Map<string, ProductRecord>();
    const seenKeys = new Set<string>();

    // Images 시트를 먼저 사전으로 만든다 — Products 루프가 키를 해석해야 하므로.
    // 시트 자체의 오류(중복 키·잘못된 URL)는 붙일 상품이 없으므로 스텁 레코드로 남긴다.
    const imageSources = this.buildImageSources(parsed.images, records);
```

Products 루프 안, `records.push(record);` **직전**에 한 줄 추가한다.

```typescript
      this.applyImageKeys(record, imageSources);

      records.push(record);
```

`orphanRecord` 아래에 메서드 셋을 추가한다.

```typescript
  /**
   * Images 시트 → `imageKey` → `sourceUrl` 사전.
   *
   * **형식만 본다.** 도달 가능성·MIME·크기는 다운로드해봐야 알고 그건 워커 시점이다
   * (스펙 §3.2.2 — /validate 는 ALB 60초 천장에 걸리므로 probe 를 워커로 옮겼다).
   */
  private buildImageSources(rows: RawRow[], records: ProductRecord[]): Map<string, string> {
    const sources = new Map<string, string>();

    for (const row of rows) {
      const imageKey = (row.cells.imageKey ?? '').trim();
      const sourceUrl = (row.cells.sourceUrl ?? '').trim();

      if (imageKey === '') {
        records.push(this.imageSheetStub(row, 'imageKey 는 필수입니다.'));
        continue;
      }
      if (sourceUrl === '') {
        records.push(this.imageSheetStub(row, `sourceUrl 는 필수입니다: ${imageKey}`));
        continue;
      }
      if (sources.has(imageKey)) {
        // 나중 행이 조용히 앞 행을 덮으면 어느 URL 이 쓰였는지 파일만 봐서는 알 수 없다.
        records.push(this.imageSheetStub(row, `중복 imageKey: ${imageKey}`));
        continue;
      }
      if (!this.isHttpUrl(sourceUrl)) {
        records.push(
          this.imageSheetStub(row, `sourceUrl 는 http/https URL 이어야 합니다: ${imageKey} → ${sourceUrl}`),
        );
        continue;
      }

      sources.set(imageKey, sourceUrl);
    }

    return sources;
  }

  /** `new URL()` 로 파싱되고 스킴이 http/https 인지만 본다. SSRF 가드(사설 IP 등)는 워커가 건다. */
  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Images 시트 행 자체의 오류. 상품에 붙지 않으므로 고아 참조와 같은 스텁 레코드로 남긴다 —
   * 그래야 프리뷰에 invalid 행으로 뜨고 acceptCommit 의 invalidCount 에도 들어간다.
   */
  private imageSheetStub(row: RawRow, message: string): ProductRecord {
    return {
      rowNumber: row.rowNumber,
      productKey: (row.cells.imageKey ?? '').trim(),
      raw: {},
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      imageRefs: [],
      errors: [{ sheet: 'Images', rowNumber: row.rowNumber, message }],
    };
  }

  /**
   * 상품 행의 이미지 키 3종(대표·부가·본문)을 해석해 `imageRefs` 로 접합한다.
   *
   * 용도는 **참조 지점**이 정한다(스펙 §3.1). 같은 키가 대표와 본문 양쪽에 등장하면 ref 가
   * 둘 생기고, 워커가 서로 다른 file-service 컨텍스트로 두 번 올린다 — 컨텍스트별 MIME·크기
   * 제약이 다르기 때문이다(product-image 는 jpeg/png/webp 10MB, description 은 image/* 20MB).
   */
  private applyImageKeys(record: ProductRecord, sources: Map<string, string>): void {
    const push = (message: string): void =>
      record.errors.push({ sheet: 'Products', rowNumber: record.rowNumber, message });

    const thumbnail = (record.raw.thumbnailImageKey ?? '').trim();
    const additional = (record.raw.additionalImageKeys ?? '')
      .split(VALUE_DELIMITER)
      .map((key) => key.trim())
      .filter((key) => key !== '');
    const description = extractDirectiveImageKeys(record.raw.description);

    record.additionalImageKeys = additional;
    record.descriptionImageKeys = description;
    if (thumbnail !== '') record.thumbnailImageKey = thumbnail;

    if (additional.length > MAX_ADDITIONAL_IMAGE_KEYS) {
      push(`부가 이미지는 최대 ${MAX_ADDITIONAL_IMAGE_KEYS}개까지 지정할 수 있습니다 (현재 ${additional.length}개).`);
    }
    const duplicated = additional.filter((key, index) => additional.indexOf(key) !== index);
    if (duplicated.length > 0) {
      push(`additionalImageKeys 에 같은 키가 중복 지정되었습니다: ${[...new Set(duplicated)].join(', ')}`);
    }

    const refs: ImageSourceRef[] = [];
    const seen = new Set<string>();
    const add = (imageKey: string, usage: ImageSourceRef['usage']): void => {
      const sourceUrl = sources.get(imageKey);
      if (!sourceUrl) {
        push(`Images 시트에 정의되지 않은 imageKey 참조: ${imageKey}`);
        return;
      }
      // 같은 상품이 같은 (키, 용도) 를 두 번 가리켜도 ref 는 하나다 — 대표와 부가에
      // 같은 키를 넣은 경우가 여기 걸린다(막을 이유는 없고 업로드만 아끼면 된다).
      const dedupKey = `${usage}:${imageKey}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      refs.push({ imageKey, usage, sourceUrl });
    };

    if (thumbnail !== '') add(thumbnail, 'main');
    for (const key of additional) add(key, 'main');
    for (const key of description) add(key, 'description');

    record.imageRefs = refs;
  }
```

**주의:** 위 `imageSheetStub` 은 `orphanRecord` 와 모양이 같지만 시그니처가 다르다(메시지를 직접 받는다). `orphanRecord` 를 재사용하지 않는 이유는 메시지가 "존재하지 않는 productKey 참조" 로 고정돼 있기 때문이다.

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts
git commit -m "feat(product-import): imageKey 참조 해석 — 용도 추론 + Images 시트 검증"
```

---

### Task 5: SSRF 가드 — IP 분류 + URL 검사

**core 가 맡는 것은 네트워크 경계뿐이다.** MIME·크기 검증은 file-service 가 이미 한다(버퍼 콘텐츠 스니핑 → 컨텍스트 화이트리스트, `upload.service.ts:51-67`).

**가장 중요한 항목은 사설·링크로컬 IP 차단**이다 — ECS 태스크 메타데이터 `169.254.170.2`, EC2 IMDS `169.254.169.254` 가 여기 걸린다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image.guard.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-image.guard.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export function isBlockedIp(ip: string): boolean` — 순수 함수. IPv4/IPv6, IPv4-mapped IPv6 포함
  - `export class ImageUrlBlockedError extends Error` — 가드 위반 전용(호출부가 실패 사유를 그대로 행에 적는다)
  - `export async function assertPublicHttpUrl(rawUrl: string): Promise<URL>` — 스킴 확인 + DNS 해석 + 전 주소 IP 검사. 통과하면 파싱된 `URL` 을 돌려준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { isBlockedIp, assertPublicHttpUrl, ImageUrlBlockedError } from './product-import-image.guard';

describe('isBlockedIp', () => {
  it.each([
    // 이 둘이 이 가드의 존재 이유다 — ECS 태스크 메타데이터 / EC2 IMDS
    '169.254.170.2',
    '169.254.169.254',
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '0.0.0.0',
    '100.64.0.1', // CGNAT
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
    '255.255.255.255',
  ])('사설·특수 IPv4 를 막는다: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '52.78.0.1', '172.32.0.1', '172.15.255.255', '11.0.0.1'])(
    '공개 IPv4 는 통과한다: %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1'])('사설·특수 IPv6 를 막는다: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['2001:4860:4860::8888', '2606:4700::1111'])('공개 IPv6 는 통과한다: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it.each(['::ffff:169.254.169.254', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])(
    'IPv4-mapped IPv6 는 벗겨서 v4 규칙으로 본다: %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    },
  );

  it('IPv4-mapped 공개 주소는 통과한다', () => {
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('해석할 수 없는 문자열은 막는다 (모르면 막는다)', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

describe('assertPublicHttpUrl', () => {
  it('http/https 가 아니면 막는다', async () => {
    for (const bad of ['file:///etc/passwd', 'gopher://x/1', 'ftp://e.example/a.jpg']) {
      await expect(assertPublicHttpUrl(bad)).rejects.toBeInstanceOf(ImageUrlBlockedError);
    }
  });

  it('파싱 불가 URL 을 막는다', async () => {
    await expect(assertPublicHttpUrl('그냥문자열')).rejects.toBeInstanceOf(ImageUrlBlockedError);
  });

  it('IP 리터럴 호스트도 DNS 없이 바로 걸린다', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/차단/);
    await expect(assertPublicHttpUrl('http://127.0.0.1:8080/x.jpg')).rejects.toThrow(/차단/);
    await expect(assertPublicHttpUrl('http://[::1]/x.jpg')).rejects.toThrow(/차단/);
  });

  it('localhost 처럼 사설로 해석되는 이름도 막는다 (실제 DNS 해석)', async () => {
    await expect(assertPublicHttpUrl('http://localhost/x.jpg')).rejects.toThrow(/차단/);
  });

  it('해석되지 않는 호스트는 막는다', async () => {
    await expect(
      assertPublicHttpUrl('https://this-host-does-not-exist.invalid/x.jpg'),
    ).rejects.toBeInstanceOf(ImageUrlBlockedError);
  });
});
```

**`localhost` 테스트는 네트워크가 아니라 로컬 리졸버만 쓴다** — `/etc/hosts` 로 끝나므로 CI 에서도 결정적이다. `.invalid` 는 RFC 2606 예약 TLD 라 항상 NXDOMAIN 이다(리졸버가 없으면 `EAI_AGAIN` 으로 역시 실패한다 — 어느 쪽이든 거부가 맞다).

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.guard" 2>&1 | tail -20
```

기대: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

```typescript
import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * 임포트 이미지 다운로드의 **네트워크 경계** 가드.
 *
 * MIME·크기 검증은 여기 없다 — file-service 가 버퍼를 콘텐츠 스니핑해 컨텍스트
 * 화이트리스트로 검증한다(upload.service.ts:51-67). core 가 맡는 것은 "이 URL 로
 * 나가도 되는가" 뿐이다.
 *
 * **DNS 재바인딩(검사 후 실제 연결에서 다른 IP 로 해석)은 막지 않는다** — 막으려면 해석한
 * IP 로 직접 연결하고 Host 헤더를 세팅해야 하는데, 이번 입력은 관리자가 올린 워크북이지
 * 임의 사용자 입력이 아니다. 리다이렉트 홉마다 재검사하는 것까지만 한다(스펙 §3.2.3).
 */
export class ImageUrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUrlBlockedError';
  }
}

/** `a.b.c.d` → 32비트 정수. 형식이 아니면 null. */
function toIpv4Int(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** [네트워크, 프리픽스길이] 목록. 사설·링크로컬·loopback·예약 대역 전부. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // 사설
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // 링크로컬 — ECS 메타데이터(169.254.170.2)·EC2 IMDS(169.254.169.254)
  ['172.16.0.0', 12], // 사설
  ['192.0.0.0', 24], // IETF 프로토콜 할당
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // 사설
  ['198.18.0.0', 15], // 벤치마크
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // 예약 + 255.255.255.255
];

function isBlockedV4(ip: string): boolean {
  const value = toIpv4Int(ip);
  if (value === null) return true;
  for (const [network, bits] of BLOCKED_V4) {
    const base = toIpv4Int(network);
    if (base === null) continue;
    // bits=0 은 목록에 없다(있으면 전부 차단이라 의미가 없다) — 시프트 32 문제도 함께 피한다.
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (base & mask)) return true;
  }
  return false;
}

/**
 * IPv4-mapped IPv6(`::ffff:1.2.3.4`) 는 벗겨서 v4 규칙으로 본다 — 벗기지 않으면
 * `::ffff:169.254.169.254` 가 "공개 IPv6" 로 통과해 가드가 통째로 무력화된다.
 */
function unmapV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const marker = '::ffff:';
  if (!lower.startsWith(marker)) return null;
  const tail = lower.slice(marker.length);
  return isIP(tail) === 4 ? tail : null;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  // 해석할 수 없으면 막는다 — 모르는 것을 통과시키는 가드는 가드가 아니다.
  if (version !== 6) return true;

  const mapped = unmapV4(ip);
  if (mapped) return isBlockedV4(mapped);

  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const head = lower.split(':')[0];
  const prefix = Number.parseInt(head === '' ? '0' : head, 16);
  if (Number.isNaN(prefix)) return true;
  if ((prefix & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((prefix & 0xffc0) === 0xfe80) return true; // fe80::/10 링크로컬
  if ((prefix & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

/**
 * 스킴을 확인하고 호스트를 해석해 **모든** 주소가 공개 대역인지 본다.
 * 하나라도 사설이면 거부한다 — 라운드로빈 DNS 로 하나만 사설을 섞는 우회를 막는다.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageUrlBlockedError(`URL 을 해석할 수 없습니다: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageUrlBlockedError(`http/https 만 허용됩니다: ${url.protocol}//…`);
  }

  // URL 의 IPv6 호스트는 대괄호로 감싸여 있다 — 벗겨야 isIP 가 인식한다.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new ImageUrlBlockedError(`사설·링크로컬 주소는 차단됩니다: ${hostname}`);
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (error) {
    throw new ImageUrlBlockedError(
      `호스트를 해석할 수 없습니다: ${hostname} (${error instanceof Error ? error.message : '알 수 없는 오류'})`,
    );
  }
  if (addresses.length === 0) {
    throw new ImageUrlBlockedError(`호스트를 해석할 수 없습니다: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new ImageUrlBlockedError(`사설·링크로컬 주소로 해석되어 차단됩니다: ${hostname} → ${address}`);
    }
  }

  return url;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.guard" 2>&1 | tail -15
```

기대: 전부 PASS. `169.254.169.254`·`169.254.170.2` 케이스가 초록인지 **눈으로** 확인한다 — 이 두 줄이 이 태스크의 전부다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-image.guard.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-image.guard.spec.ts
git commit -m "feat(product-import): 이미지 URL SSRF 가드 — 사설·링크로컬 IP 차단"
```

---

### Task 6: HTTP 페처 — probe(HEAD) / fetch(GET)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image.fetcher.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-image.fetcher.spec.ts`

**Interfaces:**
- Consumes: `assertPublicHttpUrl`, `ImageUrlBlockedError` (Task 5)
- Produces:
  - `export const MAX_REDIRECT_HOPS = 3`
  - `export const PROBE_TIMEOUT_MS = 5_000`
  - `export interface ProbeResult { mimeType: string | null; sizeBytes: number | null }`
  - `export interface FetchResult { body: Buffer; mimeType: string | null; sizeBytes: number }`
  - `@Injectable() export class ProductImportImageFetcher`
    - `probe(sourceUrl: string): Promise<ProbeResult>`
    - `fetch(sourceUrl: string, maxBytes: number, timeoutMs: number): Promise<FetchResult>`
  - 실패는 전부 `throw` 다. 호출부(이미지 슬라이스)가 메시지를 그대로 행에 적는다.

**설계 메모**

- **리다이렉트는 `manual` 로 받아 직접 따라간다.** `redirect: 'follow'` 로 두면 홉 중간의 사설 IP 를 검사할 자리가 없다 — 공개 URL → 사설 IP 리다이렉트가 그대로 통과한다.
- **probe 는 HEAD 지만 405/501 이면 `Range: bytes=0-0` GET 으로 폴백한다.** HEAD 를 거부하는 CDN 이 흔하고, 거부를 "URL 이 죽었다"로 보고하면 MD 가 멀쩡한 URL 을 고치려 든다.
- **크기 상한은 스트림을 읽으며 센다.** `Content-Length` 만 믿으면 헤더 없는 chunked 응답이 상한을 통과한다. 넘는 순간 reader 를 cancel 해 남은 바이트를 받지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

전역 `fetch` 를 목으로 갈아끼운다. 가드는 IP 리터럴 경로로 우회한다(공개 IP 리터럴은 DNS 를 타지 않는다).

```typescript
import { ProductImportImageFetcher, MAX_REDIRECT_HOPS } from './product-import-image.fetcher';

/** 공개 IP 리터럴 — 가드가 DNS 없이 통과시킨다. 목 fetch 가 실제로 나가지는 않는다. */
const OK_URL = 'https://8.8.8.8/a.jpg';
const PRIVATE_URL = 'https://169.254.169.254/a.jpg';

function response(init: {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Uint8Array[];
}): Response {
  const { status = 200, headers = {}, chunks = [] } = init;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(status === 204 || status >= 300 ? null : stream, { status, headers });
}

describe('ProductImportImageFetcher', () => {
  const fetcher = new ProductImportImageFetcher();
  let mock: jest.Mock;

  beforeEach(() => {
    mock = jest.fn();
    global.fetch = mock as unknown as typeof global.fetch;
  });

  describe('probe', () => {
    it('HEAD 200 이면 content-type/length 를 돌려준다', async () => {
      mock.mockResolvedValue(response({ headers: { 'content-type': 'image/jpeg', 'content-length': '12345' } }));
      await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: 'image/jpeg', sizeBytes: 12345 });
      expect(mock.mock.calls[0][1].method).toBe('HEAD');
    });

    it('헤더가 없으면 null 로 둔다 (fetch 단계가 판정한다)', async () => {
      mock.mockResolvedValue(response({}));
      await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: null, sizeBytes: null });
    });

    it('HEAD 405 면 Range GET 으로 폴백한다', async () => {
      mock
        .mockResolvedValueOnce(response({ status: 405 }))
        .mockResolvedValueOnce(response({ status: 206, headers: { 'content-type': 'image/png' } }));
      await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: 'image/png', sizeBytes: null });
      expect(mock.mock.calls[1][1].method).toBe('GET');
      expect(mock.mock.calls[1][1].headers.Range).toBe('bytes=0-0');
    });

    it('4xx/5xx 는 실패다', async () => {
      mock.mockResolvedValue(response({ status: 404 }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/404/);
    });

    it('사설 IP 는 요청을 보내지도 않는다', async () => {
      await expect(fetcher.probe(PRIVATE_URL)).rejects.toThrow(/차단/);
      expect(mock).not.toHaveBeenCalled();
    });

    it('리다이렉트 홉마다 IP 를 다시 검사한다', async () => {
      mock.mockResolvedValueOnce(response({ status: 302, headers: { location: PRIVATE_URL } }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/차단/);
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('리다이렉트가 상한을 넘으면 실패다', async () => {
      mock.mockResolvedValue(response({ status: 302, headers: { location: 'https://8.8.4.4/next.jpg' } }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/리다이렉트/);
      expect(mock).toHaveBeenCalledTimes(MAX_REDIRECT_HOPS + 1);
    });

    it('Location 없는 3xx 는 실패다', async () => {
      mock.mockResolvedValue(response({ status: 302 }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/Location/);
    });
  });

  describe('fetch', () => {
    it('본문을 Buffer 로 모아 크기와 함께 돌려준다', async () => {
      mock.mockResolvedValue(
        response({ headers: { 'content-type': 'image/webp' }, chunks: [new Uint8Array([1, 2]), new Uint8Array([3])] }),
      );
      const out = await fetcher.fetch(OK_URL, 1024, 1000);
      expect(out.sizeBytes).toBe(3);
      expect([...out.body]).toEqual([1, 2, 3]);
      expect(out.mimeType).toBe('image/webp');
    });

    it('Content-Length 가 상한을 넘으면 받지 않는다', async () => {
      mock.mockResolvedValue(response({ headers: { 'content-length': '99999' } }));
      await expect(fetcher.fetch(OK_URL, 1024, 1000)).rejects.toThrow(/상한/);
    });

    it('헤더가 없어도 누적 바이트가 상한을 넘으면 중단한다', async () => {
      mock.mockResolvedValue(response({ chunks: [new Uint8Array(700), new Uint8Array(700)] }));
      await expect(fetcher.fetch(OK_URL, 1024, 1000)).rejects.toThrow(/상한/);
    });

    it('사설 IP 는 요청을 보내지도 않는다', async () => {
      await expect(fetcher.fetch(PRIVATE_URL, 1024, 1000)).rejects.toThrow(/차단/);
      expect(mock).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.fetcher" 2>&1 | tail -20
```

기대: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

```typescript
import { Injectable } from '@nestjs/common';
import { assertPublicHttpUrl } from './product-import-image.guard';

/** 공개 URL → 사설 IP 리다이렉트 우회를 막으려면 홉마다 재검사해야 한다. 3회면 충분하다. */
export const MAX_REDIRECT_HOPS = 3;
/**
 * probe 는 바디를 안 받으므로 fetch 보다 훨씬 빠르다 — 별도 상수로 짧게 잡는다.
 * env 로 열지 않는 이유는 노브를 늘리지 않기 위해서다(느린 소싱처는 fetch 타임아웃이 잡는다).
 */
export const PROBE_TIMEOUT_MS = 5_000;

export interface ProbeResult {
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface FetchResult {
  body: Buffer;
  mimeType: string | null;
  sizeBytes: number;
}

/** `image/jpeg; charset=x` → `image/jpeg`. file-service 가 다시 스니핑하므로 참고값이다. */
function normalizeContentType(value: string | null): string | null {
  if (!value) return null;
  const head = value.split(';')[0]?.trim();
  return head ? head.toLowerCase() : null;
}

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

@Injectable()
export class ProductImportImageFetcher {
  /**
   * 리다이렉트를 직접 따라가며 **홉마다** SSRF 가드를 다시 건다.
   * `redirect: 'follow'` 로 두면 중간 홉을 검사할 자리가 없어 공개 URL → 사설 IP
   * 리다이렉트가 그대로 통과한다.
   */
  private async request(
    sourceUrl: string,
    init: { method: 'HEAD' | 'GET'; headers?: Record<string, string>; timeoutMs: number },
  ): Promise<Response> {
    let target = sourceUrl;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      const url = await assertPublicHttpUrl(target);
      const response = await globalThis.fetch(url.toString(), {
        method: init.method,
        headers: init.headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(init.timeoutMs),
      });

      if (response.status < 300 || response.status >= 400) return response;

      const location = response.headers.get('location');
      if (!location) throw new Error(`리다이렉트 응답에 Location 헤더가 없습니다 (${response.status})`);
      // 상대 경로 Location 을 절대 URL 로 만든다 — 그러지 않으면 다음 홉의 URL 파싱이 실패한다.
      target = new URL(location, url).toString();
    }
    throw new Error(`리다이렉트가 상한(${MAX_REDIRECT_HOPS}회)을 넘었습니다: ${sourceUrl}`);
  }

  /**
   * 도달 가능성만 본다. 바디를 받지 않으므로 3,000개도 워커 틱 몇 번이면 끝난다.
   *
   * HEAD 를 거부하는 CDN 이 흔해 405/501 은 `Range: bytes=0-0` GET 으로 폴백한다 —
   * 거부를 "URL 이 죽었다"로 보고하면 MD 가 멀쩡한 URL 을 고치려 든다.
   */
  async probe(sourceUrl: string): Promise<ProbeResult> {
    let response = await this.request(sourceUrl, { method: 'HEAD', timeoutMs: PROBE_TIMEOUT_MS });

    if (response.status === 405 || response.status === 501) {
      response = await this.request(sourceUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    }

    if (!response.ok) {
      throw new Error(`URL 에 접근할 수 없습니다: ${response.status} ${response.statusText}`);
    }
    // 바디를 안 쓰므로 소켓을 붙잡지 않게 명시적으로 버린다(Range GET 폴백 경로).
    await response.body?.cancel().catch(() => undefined);

    return {
      mimeType: normalizeContentType(response.headers.get('content-type')),
      sizeBytes: parseLength(response.headers.get('content-length')),
    };
  }

  /**
   * 바디를 받아 Buffer 로 돌려준다. **상한을 넘는 순간 스트림을 끊는다** —
   * Content-Length 만 믿으면 헤더 없는 chunked 응답이 상한을 통과한다.
   */
  async fetch(sourceUrl: string, maxBytes: number, timeoutMs: number): Promise<FetchResult> {
    const response = await this.request(sourceUrl, { method: 'GET', timeoutMs });

    if (!response.ok) {
      throw new Error(`이미지를 내려받지 못했습니다: ${response.status} ${response.statusText}`);
    }

    const declared = parseLength(response.headers.get('content-length'));
    if (declared !== null && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`이미지 크기가 상한(${maxBytes} bytes)을 초과했습니다: ${declared} bytes`);
    }
    if (!response.body) throw new Error('응답에 본문이 없습니다.');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`이미지 크기가 상한(${maxBytes} bytes)을 초과했습니다.`);
        }
        chunks.push(value);
      }
    } finally {
      // 상한 초과로 빠져나온 경우 남은 바이트를 계속 받지 않게 끊는다.
      reader.cancel().catch(() => undefined);
    }

    return {
      body: Buffer.concat(chunks),
      mimeType: normalizeContentType(response.headers.get('content-type')),
      sizeBytes: total,
    };
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.fetcher" 2>&1 | tail -15
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-image.fetcher.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-image.fetcher.spec.ts
git commit -m "feat(product-import): 이미지 probe/fetch 페처 — 홉별 재검사 + 크기 상한 abort"
```

---

### Task 7: file-service 업로드·삭제 클라이언트

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-file.client.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-file.client.spec.ts`

**Interfaces:**
- Consumes: `ProductImageUsage` (Task 3)
- Produces:
  - `export const IMAGE_CONTEXT_BY_USAGE: Record<ProductImageUsage, string>` — `{ main: 'product-image', description: 'product-description-image' }`
  - `export const MAX_BYTES_BY_USAGE: Record<ProductImageUsage, number>` — `{ main: 10485760, description: 20971520 }`
  - `@Injectable() export class ProductImportFileClient`
    - `upload(input: { body: Buffer; fileName: string; mimeType: string; usage: ProductImageUsage; userId: string }): Promise<{ fileId: string }>`
    - `softDelete(fileId: string, userId: string): Promise<void>`

**⚠️ 함정 — `uploads.uploaded_by` 는 NOT NULL uuid 다** (`file-service/src/database/schema.ts:50`). 업로드 컨트롤러는 `@User()` 의 `userId` 를 그대로 쓴다(`upload.controller.ts:81`). 기존 `FileServiceClient`(library)의 서비스 토큰은 `sub: 'core-library-service'` 만 있고 `userId` 가 없어 **그대로 쓰면 NOT NULL 위반으로 죽는다**(스펙 §2.7).

대응: 토큰에 **세션의 `uploaded_by` 를 `userId` 클레임으로** 싣는다. `AuthenticationService.validatePayload` 는 `{ userId: payload.sub, ..., ...payload }` 로 payload 를 **마지막에 펼치므로**, payload 의 `userId` 가 `sub` 파생값을 덮는다(`libs/authorization/src/services/authentication.service.ts:23-29`). `sub` 는 없으면 401 이라 함께 넣는다.

이미지가 워크북을 올린 MD 에게 귀속되어 소유자 기반 접근이 자연스럽게 동작한다. `scopes: ['master']` 도 함께 실어 삭제 권한을 얻는다(`file-access.ts:62` 가 위임 토큰의 scopes 를 명시적으로 허용한다).

**기존 `FileServiceClient` 는 건드리지 않는다** — library 의 다운로드 위임과 용도가 다르고 토큰 클레임 구성이 달라진다(스펙 §3.2.5).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { ProductImportFileClient, IMAGE_CONTEXT_BY_USAGE } from './product-import-file.client';

const SECRET = 'test-auth-secret';
const USER_ID = '0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function config(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    AUTH_SECRET: SECRET,
    FILE_SERVICE_URL: 'https://file.example/',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('ProductImportFileClient', () => {
  let mock: jest.Mock;

  beforeEach(() => {
    mock = jest.fn();
    global.fetch = mock as unknown as typeof global.fetch;
  });

  it('multipart 로 올리고 fileId 를 돌려준다', async () => {
    mock.mockResolvedValue(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
    const client = new ProductImportFileClient(config());

    const out = await client.upload({
      body: Buffer.from([1, 2, 3]),
      fileName: 'IMG-1.jpg',
      mimeType: 'image/jpeg',
      usage: 'main',
      userId: USER_ID,
    });

    expect(out).toEqual({ fileId: 'file-1' });
    const [url, init] = mock.mock.calls[0];
    // baseUrl 의 트레일링 슬래시는 잘려야 한다
    expect(url).toBe('https://file.example/files/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('contextId')).toBe(IMAGE_CONTEXT_BY_USAGE.main);
    expect(form.get('isPublic')).toBe('true');
  });

  it('토큰에 sub 와 userId 를 함께 싣는다 (uploads.uploaded_by 가 NOT NULL uuid)', async () => {
    mock.mockResolvedValue(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
    const client = new ProductImportFileClient(config());

    await client.upload({
      body: Buffer.from([1]),
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      usage: 'description',
      userId: USER_ID,
    });

    const auth = (mock.mock.calls[0][1].headers as Record<string, string>).Authorization;
    const payload = verify(auth.replace('Bearer ', ''), SECRET) as Record<string, unknown>;
    expect(payload.userId).toBe(USER_ID);
    expect(payload.sub).toBeTruthy();
    expect(payload.scopes).toEqual(['master']);
    expect((mock.mock.calls[0][1].body as FormData).get('contextId')).toBe(
      IMAGE_CONTEXT_BY_USAGE.description,
    );
  });

  it('userId 가 비면 업로드 자체를 하지 않는다', async () => {
    const client = new ProductImportFileClient(config());
    await expect(
      client.upload({ body: Buffer.from([1]), fileName: 'a.jpg', mimeType: 'image/jpeg', usage: 'main', userId: '' }),
    ).rejects.toThrow(/업로더/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('file-service 가 실패하면 상태코드와 본문을 담아 던진다', async () => {
    mock.mockResolvedValue(new Response('nope', { status: 400, statusText: 'Bad Request' }));
    const client = new ProductImportFileClient(config());
    await expect(
      client.upload({
        body: Buffer.from([1]),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        usage: 'main',
        userId: USER_ID,
      }),
    ).rejects.toThrow(/400.*nope/s);
  });

  it('AUTH_SECRET 이 없으면 던진다', async () => {
    const client = new ProductImportFileClient(config({ AUTH_SECRET: undefined }));
    await expect(
      client.upload({
        body: Buffer.from([1]),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        usage: 'main',
        userId: USER_ID,
      }),
    ).rejects.toThrow(/AUTH_SECRET/);
  });

  it('softDelete 는 DELETE /files/:id 를 부른다', async () => {
    mock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const client = new ProductImportFileClient(config());
    await client.softDelete('file-1', USER_ID);
    expect(mock.mock.calls[0][0]).toBe('https://file.example/files/file-1');
    expect(mock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('softDelete 는 404 를 성공으로 본다 (이미 지워진 것)', async () => {
    mock.mockResolvedValue(new Response('not found', { status: 404 }));
    const client = new ProductImportFileClient(config());
    await expect(client.softDelete('file-1', USER_ID)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-file.client" 2>&1 | tail -20
```

기대: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign as jwtSign } from 'jsonwebtoken';
import { ProductImageUsage } from '../dto/import.types';

/**
 * 용도별 file-service 컨텍스트. 같은 이미지라도 용도에 따라 통과 여부와 저장 경로가 갈린다
 * (apps/file-service/src/database/default-file-contexts.ts).
 */
export const IMAGE_CONTEXT_BY_USAGE: Record<ProductImageUsage, string> = {
  main: 'product-image',
  description: 'product-description-image',
};

/** 컨텍스트별 maxFileSize. 이보다 큰 바이트를 끌어와도 file-service 가 거부하므로 미리 끊는다. */
export const MAX_BYTES_BY_USAGE: Record<ProductImageUsage, number> = {
  main: 10 * 1024 * 1024,
  description: 20 * 1024 * 1024,
};

/**
 * 임포트 전용 file-service 클라이언트.
 *
 * library 의 `FileServiceClient` 를 재사용하지 않는다 — 그쪽은 **다운로드 위임** 전용이고
 * 토큰 클레임 구성이 다르다(스펙 §3.2.5).
 *
 * ⚠️ `uploads.uploaded_by` 가 **NOT NULL uuid** 인데 업로드 컨트롤러는 `@User().userId` 를
 * 그대로 쓴다. `sub` 만 있는 서비스 토큰으로 올리면 NOT NULL 위반으로 죽는다. 그래서 세션의
 * `uploaded_by` 를 `userId` 클레임으로 싣는다 — `validatePayload` 가 payload 를 마지막에
 * 펼치므로 이 값이 `sub` 파생값을 덮는다(authentication.service.ts:23-29).
 * 결과적으로 이미지가 워크북을 올린 MD 에게 귀속돼 소유자 기반 접근이 자연스럽게 동작한다.
 */
@Injectable()
export class ProductImportFileClient {
  constructor(private readonly config: ConfigService) {}

  private mintServiceToken(userId: string): string {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) {
      throw new Error(
        'ProductImportFileClient requires AUTH_SECRET (HS256 shared with file-service) to mint a service token.',
      );
    }
    return jwtSign(
      {
        // sub 가 없으면 validatePayload 가 401 을 던진다.
        sub: 'core-product-import-service',
        // uploads.uploaded_by 로 그대로 들어간다.
        userId,
        // 삭제 위임에 쓰인다 — file-access.ts:62 가 scopes:['master'] 를 명시 허용한다.
        scopes: ['master'],
      },
      secret,
      { algorithm: 'HS256', expiresIn: '1m' },
    );
  }

  private baseUrl(): string {
    const url = this.config.get<string>('FILE_SERVICE_URL');
    if (!url) throw new Error('FILE_SERVICE_URL is not configured');
    return url.replace(/\/+$/, '');
  }

  private assertUserId(userId: string): void {
    if (!userId || userId.trim() === '') {
      // 옛 세션은 uploaded_by 가 NULL 일 수 있다(컬럼이 nullable). 빈 문자열로 올리면
      // file-service 가 uuid 파싱에서 500 을 내므로, 원인이 보이는 메시지로 여기서 막는다.
      throw new Error('업로더(uploaded_by)가 없는 세션이라 이미지를 올릴 수 없습니다.');
    }
  }

  async upload(input: {
    body: Buffer;
    fileName: string;
    mimeType: string;
    usage: ProductImageUsage;
    userId: string;
  }): Promise<{ fileId: string }> {
    this.assertUserId(input.userId);
    const token = this.mintServiceToken(input.userId);

    const form = new FormData();
    // Buffer → Blob 은 Node 22 전역 Blob 으로 충분하다. multer 가 originalname 으로
    // 확장자를 뽑으므로(upload.service.ts:72) fileName 에 확장자가 있어야 한다.
    form.append('file', new Blob([input.body], { type: input.mimeType }), input.fileName);
    form.append('contextId', IMAGE_CONTEXT_BY_USAGE[input.usage]);
    // 두 컨텍스트 모두 allowPublic:true / allowPrivate:false 라 true 만 통과한다.
    form.append('isPublic', 'true');

    // Content-Type 을 직접 세팅하지 않는다 — FormData 를 넘기면 undici 가 boundary 를
    // 포함한 헤더를 만든다. 손으로 넣으면 boundary 가 빠져 파싱이 깨진다.
    const res = await globalThis.fetch(`${this.baseUrl()}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`file-service 업로드 실패: ${res.status} ${res.statusText} — ${body}`);
    }

    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error('file-service 업로드 응답에 id 가 없습니다.');
    return { fileId: json.id };
  }

  /**
   * 취소 정리용 soft delete. file-service 에 고아 파일 정리 잡이 없어(스펙 §2.8)
   * 안 지우면 S3 에 영구 잔존한다.
   */
  async softDelete(fileId: string, userId: string): Promise<void> {
    this.assertUserId(userId);
    const token = this.mintServiceToken(userId);
    const res = await globalThis.fetch(`${this.baseUrl()}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 는 이미 지워졌다는 뜻이라 성공과 구분할 실익이 없다 — 정리는 멱등해야 한다.
    if (res.ok || res.status === 404) return;
    const body = await res.text().catch(() => '');
    throw new Error(`file-service 삭제 실패: ${res.status} ${res.statusText} — ${body}`);
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import-file.client" 2>&1 | tail -15
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-file.client.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-file.client.spec.ts
git commit -m "feat(product-import): 임포트 전용 file-service 업로드·삭제 클라이언트

토큰에 세션 uploaded_by 를 userId 클레임으로 실어 uploads.uploaded_by NOT NULL 을 만족시킨다."
```

---

### Task 8: 접수 경로 — 이미지 행 적재 + 커밋 레인 게이트

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord.imageRefs` (Task 4), `productImportImages` (Task 1)
- Produces:
  - `acceptCommit` 이 `product_import_images` 를 채우고 세션에 `imageStatus`/`commitStatus` 를 이미지 유무로 갈라 넣는다.
  - `CommitAcceptedDto.imageCount: number` — 워커가 내려받을 고유 이미지 수

**게이트 설계 — 왜 `commit_status='idle'` 인가**

워커의 claim 은 레인별로 독립이다. 이미지가 아직 pending 인데 `commit_status='queued'` 로 두면 **커밋 레인이 같은 틱에 그 세션을 집어 이미지 없는 상품을 만들어 버린다.** `publish_status` 가 이미 같은 이유로 `'idle'` 로 시작하므로(생성이 끝나야 게시할 것이 생긴다) 선례를 그대로 따른다 — 이미지 레인이 마감될 때 `'queued'` 로 연다(Task 9).

**이미지 행은 오류 없는 상품 행의 참조만 모은다.** 어차피 만들지 않을 상품의 이미지를 단일 NAT 로 끌어올 이유가 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-import.manager.spec.ts` 의 기존 목 하네스(트랜잭션 목)를 그대로 쓴다. 목이 `insert().values()` 호출을 수집하는 형태가 아니라면, 아래처럼 **호출 인자를 모으는** 최소 하네스를 이 describe 안에 따로 만든다.

```typescript
import { productImportImages, productImportSessions, productImportItems } from '../../../schema/catalog.schema';

describe('ProductImportManager.acceptCommit — 이미지', () => {
  /** insert 대상 테이블별로 values() 인자를 모으는 최소 트랜잭션 목. */
  function harness() {
    const inserted = new Map<unknown, unknown[]>();
    const trx = {
      insert: (table: unknown) => ({
        values: (rows: unknown) => {
          const list = inserted.get(table) ?? [];
          list.push(...(Array.isArray(rows) ? rows : [rows]));
          inserted.set(table, list);
          return {
            returning: () => Promise.resolve([{ id: 'session-1' }]),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          };
        },
      }),
    };
    const db = { run: (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never;
    return { inserted, db };
  }

  /**
   * acceptCommit 은 협력자를 **하나도 부르지 않는다** — 세션과 행을 적을 뿐이다.
   * 목을 채우는 대신 undefined 로 두면, 나중에 누가 여기서 협력자를 부르도록 바꿨을 때
   * 이 테스트가 TypeError 로 즉시 알려준다.
   * 순서: reader, productMastersService, pricingService, pricingBuilder,
   *       purchaseConstraintsService, imageCleaner(Task 12 에서 추가)
   */
  const COLLABORATORS = [
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  ] as const;

  function record(over: Partial<ProductRecord>): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: 'x', basePrice: '1000' },
      version: { name: 'x' },
      basePrice: 1000,
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
      ...over,
    };
  }

  const REF_MAIN = { imageKey: 'IMG-1', usage: 'main' as const, sourceUrl: 'https://e.example/1.jpg' };
  const REF_DESC = { imageKey: 'IMG-1', usage: 'description' as const, sourceUrl: 'https://e.example/1.jpg' };

  it('이미지가 없으면 커밋 레인이 바로 queued 이고 image 레인은 completed 다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...COLLABORATORS);

    const out = await manager.acceptCommit({ fileName: 'a.xlsx', userId: 'u-1', records: [record({})] });

    expect(out.imageCount).toBe(0);
    expect(inserted.get(productImportImages)).toBeUndefined();
    const [session] = inserted.get(productImportSessions) as Array<Record<string, unknown>>;
    expect(session.commitStatus).toBe('queued');
    expect(session.imageStatus).toBe('completed');
  });

  it('이미지가 있으면 커밋 레인을 idle 로 게이트하고 image 레인을 queued 로 둔다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...);
    const out = await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [record({ imageRefs: [REF_MAIN] })],
    });

    expect(out.imageCount).toBe(1);
    const [session] = inserted.get(productImportSessions) as Array<Record<string, unknown>>;
    expect(session.commitStatus).toBe('idle');
    expect(session.imageStatus).toBe('queued');
  });

  it('여러 상품이 같은 (키, 용도) 를 가리키면 이미지 행은 하나다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...);
    await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [
        record({ rowNumber: 1, productKey: 'P1', imageRefs: [REF_MAIN] }),
        record({ rowNumber: 2, productKey: 'P2', imageRefs: [REF_MAIN] }),
      ],
    });
    expect(inserted.get(productImportImages)).toHaveLength(1);
  });

  it('같은 키가 용도가 다르면 행이 둘이다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...);
    await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [record({ imageRefs: [REF_MAIN, REF_DESC] })],
    });
    const rows = inserted.get(productImportImages) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.usage).sort()).toEqual(['description', 'main']);
  });

  it('오류 있는 행의 이미지는 내려받지 않는다', async () => {
    const { inserted, db } = harness();
    const manager = new ProductImportManager(db, ...);
    const out = await manager.acceptCommit({
      fileName: 'a.xlsx',
      userId: 'u-1',
      records: [
        record({
          imageRefs: [REF_MAIN],
          errors: [{ sheet: 'Products', rowNumber: 1, message: 'name 은 필수입니다.' }],
        }),
      ],
    });
    expect(out.imageCount).toBe(0);
    expect(inserted.get(productImportImages)).toBeUndefined();
    const [session] = inserted.get(productImportSessions) as Array<Record<string, unknown>>;
    // 내려받을 이미지가 없으므로 게이트도 걸지 않는다
    expect(session.commitStatus).toBe('queued');
  });
});
```

**협력자 개수 주의:** `COLLABORATORS` 는 Task 12 가 `imageCleaner` 를 추가한 뒤의 6개다. Task 8 을 먼저 구현한다면 5개로 두고, Task 12 에서 하나 늘린다 — 컴파일 오류가 알려준다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.manager" -t "이미지" 2>&1 | tail -25
```

기대: FAIL — `imageCount` 가 `undefined`.

- [ ] **Step 3: DTO 를 넓힌다**

`import-response.dto.ts` 의 `CommitAcceptedDto` 에 추가한다.

```typescript
  @ApiProperty({ description: '워커가 내려받을 고유 이미지 수. 0 이면 이미지 단계 없이 바로 상품 생성으로 간다.' })
  imageCount: number;
```

- [ ] **Step 4: `acceptCommit` 을 구현한다**

`product-import.manager.ts` 의 import 에 테이블과 타입을 추가한다.

```typescript
import {
  type PimSchema,
  productImportSessions,
  productImportItems,
  productImportImages,
  productVariants,
} from '../../../schema/catalog.schema';
import { ProductRecord, ImageSourceRef, SessionImageMap } from '../dto/import.types';
```

`acceptCommit` 을 다음으로 교체한다.

```typescript
  async acceptCommit(input: {
    fileName: string;
    userId: string;
    records: ProductRecord[];
  }): Promise<CommitAcceptedDto> {
    const { fileName, userId, records } = input;
    const invalidCount = records.filter((r) => r.errors.length > 0).length;
    // **오류 없는 행의 참조만** 모은다 — 어차피 만들지 않을 상품의 이미지를 단일 NAT 로
    // 끌어올 이유가 없다(스펙 §3.2.4: outbound 는 t4g.nano fck-nat 하나를 공유한다).
    const imageRefs = this.dedupImageRefs(records.filter((r) => r.errors.length === 0));

    return this.db.run(async (trx) => {
      const [session] = await trx
        .insert(productImportSessions)
        .values({
          fileName,
          uploadedBy: userId,
          totalRows: records.length,
          failedCount: invalidCount,
          invalidCount,
          status: 'completed',
          // 이미지가 남아 있는 동안 커밋 레인을 **게이트**한다. claim 은 레인별로 독립이라
          // 'queued' 로 두면 같은 틱에 커밋 레인이 이 세션을 집어 이미지 없는 상품을 만든다.
          // 이미지 레인이 마감될 때 'queued' 로 열린다(runImageSlice).
          // publish_status 가 'idle' 로 시작하는 것과 같은 계열의 게이트다.
          commitStatus: imageRefs.length > 0 ? 'idle' : 'queued',
          imageStatus: imageRefs.length > 0 ? 'queued' : 'completed',
          publishStatus: 'idle',
        })
        .returning();

      const rows = records.map((record) =>
        record.errors.length > 0
          ? {
              sessionId: session.id,
              rowNumber: record.rowNumber,
              productKey: record.productKey,
              status: 'failed' as const,
              publishStatus: 'skipped' as const,
              errorMessage: record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; '),
            }
          : {
              sessionId: session.id,
              rowNumber: record.rowNumber,
              productKey: record.productKey,
              status: 'pending' as const,
              payload: record,
            },
      );

      for (let i = 0; i < rows.length; i += 200) {
        await trx.insert(productImportItems).values(rows.slice(i, i + 200));
      }

      for (let i = 0; i < imageRefs.length; i += 200) {
        await trx.insert(productImportImages).values(
          imageRefs.slice(i, i + 200).map((ref) => ({
            sessionId: session.id,
            imageKey: ref.imageKey,
            usage: ref.usage,
            sourceUrl: ref.sourceUrl,
            status: 'pending' as const,
          })),
        );
      }

      return {
        sessionId: session.id,
        status: 'queued' as const,
        totalRows: records.length,
        queuedCount: records.length - invalidCount,
        invalidCount,
        imageCount: imageRefs.length,
      };
    });
  }

  /**
   * 행의 단위는 `(imageKey, usage)` 이지 참조 횟수가 아니다 — 여러 상품이 같은 키를 같은
   * 용도로 가리키면 행 하나·업로드 한 번이고 fileId 를 공유한다. 같은 이미지를 여러 상품에
   * 쓰는 것이 흔한 운용이라 이 dedup 이 NAT 부하를 직접 줄인다(스펙 §3.2.1).
   *
   * DB 의 UNIQUE(session_id, image_key, usage) 가 최종 방어선이지만, 여기서 미리 줄여야
   * 3,000행 워크북이 수만 건의 INSERT 충돌을 내지 않는다.
   */
  private dedupImageRefs(records: ProductRecord[]): ImageSourceRef[] {
    const byKey = new Map<string, ImageSourceRef>();
    for (const record of records) {
      for (const ref of record.imageRefs ?? []) {
        const dedupKey = `${ref.usage}:${ref.imageKey}`;
        if (!byKey.has(dedupKey)) byKey.set(dedupKey, ref);
      }
    }
    return [...byKey.values()];
  }
```

- [ ] **Step 5: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS. `CommitAcceptedDto` 에 필수 필드가 늘었으므로 이 DTO 를 리터럴로 만드는 다른 스펙이 있으면 컴파일 오류가 알려준다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts \
        apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts
git commit -m "feat(product-import): 접수 시 이미지 행 적재 + 커밋 레인 게이트(commit_status='idle')"
```

---

### Task 9: 세션 이미지 인덱스 (순수 함수) + reader

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image.resolver.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image.resolver.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts`

**Interfaces:**
- Consumes: `SessionImageMap`, `ProductRecord` (Task 3), `productImportImages` (Task 1)
- Produces:
  - `export interface SessionImageRow { imageKey: string; usage: ProductImageUsage; status: string; fileId: string | null; errorMessage: string | null }`
  - `export interface SessionImageIndex { fileIds: SessionImageMap; failures: Map<string, string> }`
  - `export function indexSessionImages(rows: SessionImageRow[]): SessionImageIndex`
  - `export function unresolvedImageError(record: ProductRecord, index: SessionImageIndex): string | null`
  - `ProductImportSessionReader.getSessionImages(sessionId, tx?): Promise<SessionImageRow[]>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { indexSessionImages, unresolvedImageError, SessionImageRow } from './product-import-image.resolver';
import { ProductRecord } from '../dto/import.types';

function row(over: Partial<SessionImageRow>): SessionImageRow {
  return { imageKey: 'IMG-1', usage: 'main', status: 'uploaded', fileId: 'f-1', errorMessage: null, ...over };
}

function record(over: Partial<ProductRecord>): ProductRecord {
  return {
    rowNumber: 1,
    productKey: 'P1',
    raw: {},
    version: {},
    categoryIds: [],
    categoryNames: [],
    options: [],
    variantOverrides: [],
    errors: [],
    ...over,
  };
}

describe('indexSessionImages', () => {
  it('용도별로 갈라 uploaded 행만 fileId 맵에 넣는다', () => {
    const index = indexSessionImages([
      row({ imageKey: 'IMG-1', usage: 'main', fileId: 'f-main' }),
      row({ imageKey: 'IMG-1', usage: 'description', fileId: 'f-desc' }),
      row({ imageKey: 'IMG-2', usage: 'main', status: 'fetch_failed', fileId: null, errorMessage: '404' }),
    ]);
    expect(index.fileIds.main.get('IMG-1')).toBe('f-main');
    expect(index.fileIds.description.get('IMG-1')).toBe('f-desc');
    expect(index.fileIds.main.has('IMG-2')).toBe(false);
    expect(index.failures.get('main:IMG-2')).toBe('404');
  });

  it('uploaded 인데 fileId 가 없으면 실패로 본다 (있을 수 없는 상태지만 조용히 통과시키지 않는다)', () => {
    const index = indexSessionImages([row({ status: 'uploaded', fileId: null })]);
    expect(index.fileIds.main.size).toBe(0);
    expect(index.failures.get('main:IMG-1')).toMatch(/fileId/);
  });

  it('errorMessage 가 없는 미완료 행은 상태를 사유로 쓴다', () => {
    const index = indexSessionImages([row({ status: 'pending', fileId: null, errorMessage: null })]);
    expect(index.failures.get('main:IMG-1')).toMatch(/pending/);
  });
});

describe('unresolvedImageError', () => {
  const index = indexSessionImages([
    row({ imageKey: 'IMG-1', usage: 'main', fileId: 'f-main' }),
    row({ imageKey: 'IMG-2', usage: 'main', status: 'probe_failed', fileId: null, errorMessage: 'DNS 실패' }),
    row({ imageKey: 'IMG-3', usage: 'description', fileId: 'f-desc' }),
  ]);

  it('전부 해결되면 null', () => {
    const out = unresolvedImageError(
      record({ thumbnailImageKey: 'IMG-1', descriptionImageKeys: ['IMG-3'] }),
      index,
    );
    expect(out).toBeNull();
  });

  it('이미지를 안 쓰는 행도 null', () => {
    expect(unresolvedImageError(record({}), index)).toBeNull();
  });

  it('대표 이미지가 실패했으면 키와 사유를 담은 메시지를 돌려준다', () => {
    const out = unresolvedImageError(record({ thumbnailImageKey: 'IMG-2' }), index);
    expect(out).toMatch(/IMG-2/);
    expect(out).toMatch(/DNS 실패/);
  });

  it('부가·본문도 함께 본다', () => {
    const out = unresolvedImageError(
      record({ additionalImageKeys: ['IMG-2'], descriptionImageKeys: ['GHOST'] }),
      index,
    );
    expect(out).toMatch(/IMG-2/);
    expect(out).toMatch(/GHOST/);
  });

  it('인덱스에 아예 없는 키도 실패로 본다', () => {
    expect(unresolvedImageError(record({ thumbnailImageKey: 'NOPE' }), index)).toMatch(/NOPE/);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.resolver" 2>&1 | tail -20
```

기대: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

```typescript
import { ProductImageUsage, ProductRecord, SessionImageMap } from '../dto/import.types';

/** reader 가 읽어오는 열만. 전체 행도 구조적으로 대입 가능하다. */
export interface SessionImageRow {
  imageKey: string;
  usage: ProductImageUsage;
  status: string;
  fileId: string | null;
  errorMessage: string | null;
}

export interface SessionImageIndex {
  fileIds: SessionImageMap;
  /** `${usage}:${imageKey}` → 실패 사유. **업로드에 성공하지 않은 행만** 담긴다. */
  failures: Map<string, string>;
}

function failureKey(usage: ProductImageUsage, imageKey: string): string {
  return `${usage}:${imageKey}`;
}

/**
 * 세션의 이미지 행을 커밋 슬라이스가 쓰는 두 구조로 접는다 — 성공한 것의 fileId 맵과
 * 실패한 것의 사유 맵. 슬라이스당 한 번만 만들고 그 안의 모든 행이 공유한다.
 */
export function indexSessionImages(rows: SessionImageRow[]): SessionImageIndex {
  const fileIds: SessionImageMap = { main: new Map(), description: new Map() };
  const failures = new Map<string, string>();

  for (const row of rows) {
    if (row.status === 'uploaded' && row.fileId) {
      fileIds[row.usage].set(row.imageKey, row.fileId);
      continue;
    }
    // uploaded 인데 fileId 가 없는 것은 있을 수 없는 상태지만, 조용히 통과시키면
    // 상품이 이미지 없이 생성된다 — 이 단계가 없애려는 바로 그 실패 모드다.
    const reason =
      row.status === 'uploaded'
        ? '업로드 상태이나 fileId 가 없습니다.'
        : (row.errorMessage ?? `이미지가 아직 처리되지 않았습니다 (status=${row.status})`);
    failures.set(failureKey(row.usage, row.imageKey), reason);
  }

  return { fileIds, failures };
}

/**
 * 이 행이 참조하는 이미지 중 하나라도 못 쓰면 사유 문자열을, 전부 쓸 수 있으면 null 을 돌려준다.
 *
 * **참조한 이미지가 하나라도 안 올라오면 그 상품 행은 실패한다**(계획 서두의 판단 1).
 * 대안("이미지 없이 만든다")은 이 단계가 존재하는 이유를 그대로 재생산하고, 게다가 조용하다 —
 * 관리자는 상품을 하나씩 열어보기 전엔 어디가 빠졌는지 모른다.
 */
export function unresolvedImageError(record: ProductRecord, index: SessionImageIndex): string | null {
  const problems: string[] = [];
  const check = (imageKey: string, usage: ProductImageUsage): void => {
    if (index.fileIds[usage].has(imageKey)) return;
    const reason = index.failures.get(failureKey(usage, imageKey)) ?? '이미지 정보를 찾을 수 없습니다.';
    problems.push(`${imageKey}(${usage === 'main' ? '대표/부가' : '본문'}): ${reason}`);
  };

  if (record.thumbnailImageKey) check(record.thumbnailImageKey, 'main');
  for (const key of record.additionalImageKeys ?? []) check(key, 'main');
  for (const key of record.descriptionImageKeys ?? []) check(key, 'description');

  if (problems.length === 0) return null;
  return `이미지를 준비하지 못해 상품을 만들 수 없습니다 — ${problems.join('; ')}`;
}
```

- [ ] **Step 4: reader 에 조회를 추가한다**

`product-import-session.reader.ts` 의 import 에 테이블과 타입을 추가한다.

```typescript
import {
  type PimSchema,
  productCategories,
  productImportSessions,
  productImportItems,
  productImportImages,
  productMasterVersions,
  productMasterVariants,
  productVariants,
} from '../../../schema/catalog.schema';
import type { SessionImageRow } from './product-import-image.resolver';
```

`getProgressCounts` 아래에 메서드를 추가한다.

```typescript
  /**
   * 세션의 이미지 행 전체. 커밋 슬라이스가 **슬라이스당 한 번** 부르고 인덱스를 만들어
   * 그 안의 모든 행이 공유한다. 행 수는 MAX_IMAGE_ROWS 로 유계다.
   */
  getSessionImages(sessionId: string, tx?: DbTransaction): Promise<SessionImageRow[]> {
    return this.db.run(
      (trx) =>
        trx
          .select({
            imageKey: productImportImages.imageKey,
            usage: productImportImages.usage,
            status: productImportImages.status,
            fileId: productImportImages.fileId,
            errorMessage: productImportImages.errorMessage,
          })
          .from(productImportImages)
          .where(eq(productImportImages.sessionId, sessionId)),
      tx,
    );
  }
```

- [ ] **Step 5: 통과 + 커밋**

```bash
npx jest --testPathPattern="product-import-image.resolver" 2>&1 | tail -10
npm run type-check:scoped 2>&1 | tail -10
git add apps/core/src/modules/catalog/operations/import/services/product-import-image.resolver.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-image.resolver.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts
git commit -m "feat(product-import): 세션 이미지 인덱스 + 미해결 이미지 사유"
```

---

### Task 10: 이미지 레인 워커

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.spec.ts`

**Interfaces:**
- Consumes: `ProductImportImageFetcher` (Task 6), `ProductImportFileClient` + `MAX_BYTES_BY_USAGE` (Task 7), `productImportImages` (Task 1)
- Produces:
  - `export const DEFAULT_IMAGE_SLICE = 20`
  - `export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 15_000`
  - `export const DEFAULT_IMAGE_MAX_BYTES = 20 * 1024 * 1024`
  - `ProductImportJobManager.claimImage(tx?): Promise<ClaimedSession | null>`
  - `ProductImportJobManager.runImageSlice(claimed: ClaimedSession): Promise<void>`
  - `recordJobError(sessionId, kind: 'image' | 'commit' | 'publish', message)` — kind 확장
  - 워커 틱이 `image → commit → publish` 순으로 claim 한다

**슬라이스 규칙**

1. `pending` 이 남아 있으면 **probe** 를 돈다. 없으면 `probed` 를 **fetch** 한다. 둘 다 없으면 **마감**한다.
2. 마감은 `image_status='completed'` + `commit_status='queued'` 를 함께 쓴다 — 커밋 레인의 게이트를 여는 지점이 여기뿐이다.
3. **동시성 1.** 순차 루프다. 근거는 core CPU 가 아니라 단일 `t4g.nano` NAT + 고정 EIP 다.
4. 행마다 `renewLease` 로 lease·취소를 확인한다 — commit/publish 슬라이스와 같은 형태.

- [ ] **Step 1: 실패하는 테스트를 쓴다 (job.manager)**

기존 스펙의 목 하네스를 재사용한다. 아래는 **동작 계약**만 확인하는 최소 케이스다.

**기존 `makeHarness` 를 확장한다** — 새 하네스를 처음부터 만들지 말 것. 기존 것과 어긋나면 두 스펙이 서로 다른 계약을 검증하게 된다.

`makeHarness` 의 `select().from()` 분기에 이미지 테이블을 하나 더 얹고(`opts.imageRows`), `update` 기록에 `'images'` 라벨을 추가한다.

```typescript
import { productImportImages } from '../../../schema/catalog.schema';

// makeHarness(opts) 의 opts 에 추가:
//   imageRows?: Record<'pending' | 'probed', any[]>
//
// select().from(table).where() 분기를 다음으로 교체한다. selectImages 는
// `.where(...).orderBy(c).limit(n)` 으로 부르므로 기존 chain() 이 그대로 받는다.
    select: (_projection?: any) => ({
      from: (table: any) => ({
        where: (condition?: unknown) => {
          if (table === productImportImages) {
            // status 별로 갈라 돌려준다. 조건절을 파싱하는 대신 호출 순서로 가른다 —
            // runImageSlice 는 항상 pending 을 먼저, 그 다음 probed 를 조회한다.
            const rows = imageSelectCallIndex === 0 ? (opts.imageRows?.pending ?? []) : (opts.imageRows?.probed ?? []);
            imageSelectCallIndex += 1;
            return chain(rows);
          }
          return chain(table === productImportItems ? pending : [{ id: 'sess-1', uploadedBy: 'u1' }]);
        },
      }),
    }),

// update(table) 의 라벨링을 3분기로:
//   table === productImportSessions ? 'sessions' : table === productImportImages ? 'images' : 'items'
```

`makeHarness` 위에 `let imageSelectCallIndex = 0;` 을 선언하고, 반환 객체에 `updates` 와 함께 노출한다.

```typescript
const CLAIMED: ClaimedSession = { sessionId: 'sess-1', leaseToken: 'tok-1' };

function imageRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'img-1',
    sessionId: 'sess-1',
    imageKey: 'IMG-1',
    usage: 'main',
    sourceUrl: 'https://e.example/1.jpg',
    status: 'pending',
    fileId: null,
    mimeType: null,
    sizeBytes: null,
    errorMessage: null,
    ...over,
  };
}

function imageManager(
  harness: ReturnType<typeof makeHarness>,
  fetcher: { probe: jest.Mock; fetch: jest.Mock },
  fileClient: { upload: jest.Mock; softDelete: jest.Mock },
) {
  return new ProductImportJobManager(
    harness.db,
    undefined as never, // importManager — 이미지 슬라이스는 부르지 않는다
    { check: jest.fn() } as never, // variantCodeChecker
    { get: () => undefined } as never, // config → 전부 기본값
    undefined as never, // reader
    undefined as never, // versionsService
    fetcher as never,
    fileClient as never,
  );
}

describe('ProductImportJobManager — 이미지 레인', () => {
  const fetcher = { probe: jest.fn(), fetch: jest.fn() };
  const fileClient = { upload: jest.fn(), softDelete: jest.fn() };

  beforeEach(() => {
    fetcher.probe.mockReset();
    fetcher.fetch.mockReset();
    fileClient.upload.mockReset();
    fileClient.softDelete.mockReset();
  });

  it('pending 이 있으면 probe 를 돌고 상태를 probed 로 바꾼다', async () => {
    const harness = makeHarness({ imageRows: { pending: [imageRow()], probed: [] } });
    fetcher.probe.mockResolvedValue({ mimeType: 'image/jpeg', sizeBytes: 1234 });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.probe).toHaveBeenCalledWith('https://e.example/1.jpg');
    const imageUpdate = harness.updates.find((u) => u.table === 'images');
    expect(imageUpdate.values).toMatchObject({ status: 'probed', mimeType: 'image/jpeg', sizeBytes: 1234 });
    // 마감은 아직이다 — pending 을 처리한 슬라이스는 lease 만 놓는다.
    expect(harness.updates.some((u) => u.table === 'sessions' && u.values.imageStatus === 'completed')).toBe(false);
  });

  it('probe 실패는 그 행만 probe_failed 로 만들고 슬라이스는 계속 돈다', async () => {
    const harness = makeHarness({
      imageRows: { pending: [imageRow({ id: 'img-1' }), imageRow({ id: 'img-2', imageKey: 'IMG-2' })], probed: [] },
    });
    fetcher.probe
      .mockRejectedValueOnce(new Error('DNS 실패'))
      .mockResolvedValueOnce({ mimeType: null, sizeBytes: null });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    const imageUpdates = harness.updates.filter((u) => u.table === 'images');
    expect(imageUpdates[0].values).toMatchObject({ status: 'probe_failed', errorMessage: 'DNS 실패' });
    expect(imageUpdates[1].values).toMatchObject({ status: 'probed' });
  });

  it('pending 이 없으면 probed 를 fetch 해 업로드하고 uploaded 로 바꾼다', async () => {
    const harness = makeHarness({
      imageRows: { pending: [], probed: [imageRow({ status: 'probed', usage: 'description' })] },
    });
    fetcher.fetch.mockResolvedValue({ body: Buffer.from([1, 2]), mimeType: 'image/png', sizeBytes: 2 });
    fileClient.upload.mockResolvedValue({ fileId: 'file-9' });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fileClient.upload).toHaveBeenCalledWith(
      expect.objectContaining({ usage: 'description', mimeType: 'image/png', userId: 'u1' }),
    );
    const imageUpdate = harness.updates.find((u) => u.table === 'images');
    expect(imageUpdate.values).toMatchObject({ status: 'uploaded', fileId: 'file-9', sizeBytes: 2 });
  });

  it('용도별 크기 상한 중 작은 쪽을 쓴다 (main 은 10MB)', async () => {
    const harness = makeHarness({ imageRows: { pending: [], probed: [imageRow({ status: 'probed' })] } });
    fetcher.fetch.mockResolvedValue({ body: Buffer.from([1]), mimeType: 'image/jpeg', sizeBytes: 1 });
    fileClient.upload.mockResolvedValue({ fileId: 'f-1' });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.fetch).toHaveBeenCalledWith('https://e.example/1.jpg', 10 * 1024 * 1024, 15_000);
  });

  it('fetch/업로드 실패는 그 행만 fetch_failed 로 만들고 예외가 슬라이스를 탈출하지 않는다', async () => {
    const harness = makeHarness({ imageRows: { pending: [], probed: [imageRow({ status: 'probed' })] } });
    fetcher.fetch.mockRejectedValue(new Error('크기 상한 초과'));

    await expect(imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED)).resolves.toBeUndefined();

    const imageUpdate = harness.updates.find((u) => u.table === 'images');
    expect(imageUpdate.values).toMatchObject({ status: 'fetch_failed', errorMessage: '크기 상한 초과' });
  });

  it('pending·probed 가 모두 없으면 image 레인을 마감하고 commit 레인을 연다', async () => {
    const harness = makeHarness({ imageRows: { pending: [], probed: [] } });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    const [sessionUpdate] = harness.updates.filter((u) => u.table === 'sessions');
    expect(sessionUpdate.values).toMatchObject({
      imageStatus: 'completed',
      // 커밋 레인의 게이트를 여는 유일한 지점이다
      commitStatus: 'queued',
      leaseUntil: null,
      leaseToken: null,
      imageError: null,
    });
    // 마감도 토큰 CAS + 취소 가드를 건다 — 좀비가 후임의 세션에 도장을 찍지 못하게.
    const rendered = renderQuery(sessionUpdate.condition);
    expect(rendered.params).toContain('tok-1');
    expect(rendered.sql).toMatch(/cancel_requested_at.*is null/i);
  });

  it('lease 를 잃으면 아무 행도 처리하지 않고 멈춘다', async () => {
    // renewLease 의 returning 이 0행 → owned:false
    const harness = makeHarness({ imageRows: { pending: [imageRow()], probed: [] }, returningRows: [[]] });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.probe).not.toHaveBeenCalled();
    expect(harness.updates.some((u) => u.table === 'images')).toBe(false);
  });

  it('취소를 감지하면 lease 만 놓고 멈춘다', async () => {
    const harness = makeHarness({
      imageRows: { pending: [imageRow()], probed: [] },
      returningRows: [[{ id: 'sess-1', cancelRequestedAt: new Date() }]],
    });

    await imageManager(harness, fetcher, fileClient).runImageSlice(CLAIMED);

    expect(fetcher.probe).not.toHaveBeenCalled();
    const [sessionUpdate] = harness.updates.filter(
      (u) => u.table === 'sessions' && u.values.leaseToken === null,
    );
    expect(sessionUpdate.values).toMatchObject({ leaseUntil: null, leaseToken: null });
    // 레인 상태는 cancelSession 이 이미 확정했다 — 워커는 덮지 않는다.
    expect(sessionUpdate.values.imageStatus).toBeUndefined();
  });

  it('recordJobError 가 image kind 를 image_error 에 쓰고 상한에서 레인을 failed 로 만든다', async () => {
    const harness = makeHarness({
      returningRows: [[{ consecutiveFailures: MAX_CONSECUTIVE_JOB_FAILURES }]],
    });

    await imageManager(harness, fetcher, fileClient).recordJobError('sess-1', 'image', 'boom');

    const sessionUpdates = harness.updates.filter((u) => u.table === 'sessions');
    expect(sessionUpdates[0].values.imageError).toBe('boom');
    expect(sessionUpdates[1].values).toMatchObject({ imageStatus: 'failed', leaseUntil: null, leaseToken: null });
  });
});
```

**하네스 조립 주의:** `imageManager()` 가 넘기는 `undefined as never` 자리는 이미지 슬라이스가 **한 번도 부르지 않는** 협력자다. `runImageSlice` 가 그중 하나를 부르게 코드를 바꾸면 이 테스트가 `TypeError` 로 즉시 알려준다 — 그게 이 자리를 목으로 채우지 않은 이유다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-job.manager" -t "이미지" 2>&1 | tail -25
```

기대: FAIL — `runImageSlice` 없음.

- [ ] **Step 3: job.manager 를 구현한다**

import 를 넓힌다.

```typescript
import {
  type PimSchema,
  productImportSessions,
  productImportItems,
  productImportImages,
} from '../../../schema/catalog.schema';
import { ProductImportImageFetcher } from './product-import-image.fetcher';
import { ProductImportFileClient, MAX_BYTES_BY_USAGE } from './product-import-file.client';
```

상수를 추가한다(`MAX_CONSECUTIVE_JOB_FAILURES` 아래).

```typescript
/**
 * 한 틱에 처리할 이미지 행 수. probe 는 바디를 안 받아 20개면 몇 초고, fetch 는 행마다
 * lease 를 갱신하므로 오래 걸려도 lease 를 잃지 않는다.
 *
 * ⚠️ **동시성은 여전히 1이다** — 이 값은 "한 틱에 몇 개"이지 "동시에 몇 개"가 아니다.
 * 근거는 core CPU 가 아니라 outbound NAT 다: 3,000장 × 평균 500KB ≈ 1.5GB 가 단일
 * t4g.nano fck-nat 을 지나고, 그 인스턴스는 Medusa·notification 의 outbound 와 공유된다.
 * 고정 EIP 라 소싱처가 IP 하나만 rate-limit 하면 전체가 막힌다.
 * 느리다는 판단이 나오면 **올려야 할 것은 이 슬라이스가 아니라 NAT 인스턴스 타입**이다
 * (deployments/lcnine/platform/infra/shared.ts:22 — `nat:"ec2"`, 타입 override 없음).
 */
export const DEFAULT_IMAGE_SLICE = 20;
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 15_000;
/** 컨텍스트 상한 중 큰 값. 실제 상한은 용도별 상한과 min 을 취한다. */
export const DEFAULT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
```

생성자에 협력자 둘을 추가한다.

```typescript
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly importManager: ProductImportManager,
    private readonly variantCodeChecker: ProductImportVariantCodeChecker,
    private readonly config: ConfigService,
    private readonly reader: ProductImportSessionReader,
    private readonly versionsService: ProductVersionsService,
    private readonly imageFetcher: ProductImportImageFetcher,
    private readonly fileClient: ProductImportFileClient,
  ) {}
```

getter 를 추가한다(`leaseMs` 아래).

```typescript
  get imageSlice(): number {
    return this.positiveInt('PRODUCT_IMPORT_IMAGE_SLICE', DEFAULT_IMAGE_SLICE);
  }

  get imageFetchTimeoutMs(): number {
    return this.positiveInt('PRODUCT_IMPORT_IMAGE_FETCH_TIMEOUT_MS', DEFAULT_IMAGE_FETCH_TIMEOUT_MS);
  }

  get imageMaxBytes(): number {
    return this.positiveInt('PRODUCT_IMPORT_IMAGE_MAX_BYTES', DEFAULT_IMAGE_MAX_BYTES);
  }
```

claim 을 확장한다.

```typescript
  /** claimCommit 과 같은 원자적 claim, image_status 컬럼을 잡는다. */
  async claimImage(tx?: DbTransaction): Promise<ClaimedSession | null> {
    return this.claim('image_status', tx);
  }

  private async claim(
    column: 'image_status' | 'commit_status' | 'publish_status',
    tx?: DbTransaction,
  ): Promise<ClaimedSession | null> {
    // (본문은 그대로 — sql.raw 인자가 유니온 세 값뿐이라 외부 입력이 닿지 않는다)
```

`runPublishSlice` 아래에 이미지 슬라이스를 추가한다.

```typescript
  /**
   * 이미지 레인 한 슬라이스. 두 phase 를 **한 레인**이 번갈아 돈다 —
   * `pending` 이 남아 있으면 probe, 없으면 `probed` 를 fetch, 둘 다 없으면 마감.
   * 레인을 둘로 쪼개지 않는 이유는 세션 상태 컬럼과 굶주림 경로가 함께 늘기 때문이다(스펙 §3.3).
   */
  async runImageSlice(claimed: ClaimedSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const pending = await this.selectImages(sessionId, 'pending');
    if (pending.length > 0) {
      await this.runProbePhase(sessionId, leaseToken, pending);
      return;
    }

    const probed = await this.selectImages(sessionId, 'probed');
    if (probed.length > 0) {
      await this.runFetchPhase(sessionId, leaseToken, probed);
      return;
    }

    // 마감. **커밋 레인의 게이트를 여는 유일한 지점**이다(acceptCommit 이 'idle' 로 잠갔다).
    // 토큰 CAS + 취소 가드는 commit/publish 마감과 같은 이유다 — lease 를 잃은 좀비가
    // 후임의 세션에 completed 를 도장 찍고 lease 를 지우는 것을 막는다.
    //
    // commitStatus 를 조건 없이 'queued' 로 쓰는 것이 안전한 이유: 이미지가 있는 세션의
    // commit_status 는 acceptCommit 이 'idle' 로 넣은 뒤 이 지점 전까지 아무도 건드리지
    // 않고, 마감 후에는 image_status 가 'completed' 라 이 레인이 다시 클레임되지 않는다.
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({
          imageStatus: 'completed',
          commitStatus: 'queued',
          leaseUntil: null,
          leaseToken: null,
          imageError: null,
        })
        .where(
          and(
            eq(productImportSessions.id, sessionId),
            eq(productImportSessions.leaseToken, leaseToken),
            isNull(productImportSessions.cancelRequestedAt),
          ),
        ),
    );
  }

  private selectImages(sessionId: string, status: 'pending' | 'probed') {
    return this.db.run((trx) =>
      trx
        .select()
        .from(productImportImages)
        .where(and(eq(productImportImages.sessionId, sessionId), eq(productImportImages.status, status)))
        // uuidv7 이라 id 순서가 곧 삽입 순서다 — 슬라이스가 항상 같은 순서로 나아간다.
        .orderBy(productImportImages.id)
        .limit(this.imageSlice),
    );
  }

  /**
   * probe — 바디를 받지 않고 도달 가능성만 본다. **동시성 1**(위 DEFAULT_IMAGE_SLICE 주석).
   * "probe 전량 완료"는 `count(status='pending') = 0` 으로 관측된다(진행률이 그걸 본다).
   */
  private async runProbePhase(
    sessionId: string,
    leaseToken: string,
    rows: Array<typeof productImportImages.$inferSelect>,
  ): Promise<void> {
    for (const row of rows) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`임포트 세션이 취소돼 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      try {
        const result = await this.imageFetcher.probe(row.sourceUrl);
        await this.updateImage(row.id, {
          status: 'probed',
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`이미지 점검 실패 (session=${sessionId}, key=${row.imageKey}): ${message}`);
        await this.updateImage(row.id, { status: 'probe_failed', errorMessage: message });
      }
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /** fetch — 바디를 받아 file-service 에 올린다. 크기 상한은 env 와 용도별 컨텍스트 상한의 min. */
  private async runFetchPhase(
    sessionId: string,
    leaseToken: string,
    rows: Array<typeof productImportImages.$inferSelect>,
  ): Promise<void> {
    const [session] = await this.db.run((trx) =>
      trx
        .select({ uploadedBy: productImportSessions.uploadedBy })
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1),
    );
    const userId = session?.uploadedBy ?? '';

    for (const row of rows) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`임포트 세션 lease 를 잃어 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`임포트 세션이 취소돼 이미지 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      try {
        const maxBytes = Math.min(this.imageMaxBytes, MAX_BYTES_BY_USAGE[row.usage]);
        const fetched = await this.imageFetcher.fetch(row.sourceUrl, maxBytes, this.imageFetchTimeoutMs);
        const mimeType = fetched.mimeType ?? 'application/octet-stream';
        const uploaded = await this.fileClient.upload({
          body: fetched.body,
          fileName: this.uploadFileName(row.imageKey, row.sourceUrl),
          mimeType,
          usage: row.usage,
          userId,
        });
        await this.updateImage(row.id, {
          status: 'uploaded',
          fileId: uploaded.fileId,
          mimeType,
          sizeBytes: fetched.sizeBytes,
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`이미지 업로드 실패 (session=${sessionId}, key=${row.imageKey}): ${message}`);
        await this.updateImage(row.id, { status: 'fetch_failed', errorMessage: message });
      }
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * file-service 가 originalname 에서 확장자를 뽑아 저장 파일명을 만든다(upload.service.ts:72).
   * 소스 URL 의 확장자를 살리되, 없거나 이상하면 `bin` 으로 둔다 — 저장 경로에만 쓰이고
   * MIME 판정은 콘텐츠 스니핑이 하므로 틀려도 업로드가 깨지지 않는다.
   */
  private uploadFileName(imageKey: string, sourceUrl: string): string {
    let extension = '';
    try {
      const path = new URL(sourceUrl).pathname;
      const match = /\.([a-zA-Z0-9]{1,5})$/.exec(path);
      extension = match ? match[1].toLowerCase() : '';
    } catch {
      extension = '';
    }
    // imageKey 는 워크북 입력이라 경로 구분자가 섞일 수 있다 — 파일명에 그대로 쓰지 않는다.
    const safeKey = imageKey.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safeKey}.${extension || 'bin'}`;
  }

  private async updateImage(
    imageId: string,
    patch: Partial<typeof productImportImages.$inferInsert>,
  ): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productImportImages)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(productImportImages.id, imageId)),
    );
  }
```

`recordJobError` 의 kind 를 넓힌다.

```typescript
  async recordJobError(sessionId: string, kind: 'image' | 'commit' | 'publish', message: string): Promise<void> {
    const errorColumn =
      kind === 'image' ? { imageError: message } : kind === 'commit' ? { commitError: message } : { publishError: message };
    const failedColumn =
      kind === 'image'
        ? { imageStatus: 'failed' as const }
        : kind === 'commit'
          ? { commitStatus: 'failed' as const }
          : { publishStatus: 'failed' as const };

    const rows = await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ ...errorColumn, consecutiveFailures: sql`${productImportSessions.consecutiveFailures} + 1` })
        .where(eq(productImportSessions.id, sessionId))
        .returning({ consecutiveFailures: productImportSessions.consecutiveFailures }),
    );

    const failures = rows[0]?.consecutiveFailures ?? 0;
    if (failures < MAX_CONSECUTIVE_JOB_FAILURES) return;

    this.logger.error(`임포트 잡이 ${failures}회 연속 실패해 ${kind} 레인을 failed 로 확정한다 (session=${sessionId})`);
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ ...failedColumn, leaseUntil: null, leaseToken: null })
        .where(eq(productImportSessions.id, sessionId)),
    );
  }
```

- [ ] **Step 4: 워커 틱 순서를 바꾼다**

`product-import-job.worker.ts` 의 `tick()` 을 교체한다.

```typescript
    this.isProcessing = true;
    let claimed: ClaimedSession | null = null;
    let kind: 'image' | 'commit' | 'publish' = 'image';
    try {
      // 이미지가 먼저다 — 이미지가 끝나야 커밋 레인의 게이트(commit_status='idle')가 열린다.
      claimed = await this.jobManager.claimImage();
      if (claimed) {
        await this.jobManager.runImageSlice(claimed);
        await this.jobManager.clearConsecutiveFailures(claimed.sessionId);
        return;
      }
      kind = 'commit';
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

기존 클래스 주석의 "가장 오래된 세션이 끝날 때까지 워커를 독점한다 — FIFO 지 교대 진행이 아니다" 규칙은 그대로 확장된다. 주석에 한 줄 덧붙인다.

```typescript
 * 한 틱은 세션 하나의 슬라이스 하나만 돈다. 레인 우선순위는 image → commit → publish 다 —
 * 앞선 레인에 일이 있으면 뒤 레인은 그 틱에 굶는다(스펙 §3.3).
```

`product-import-job.worker.spec.ts` 에 케이스를 추가한다.

```typescript
  it('이미지 레인을 먼저 클레임하고, 잡으면 커밋을 시도하지 않는다', async () => {
    jobManager.claimImage.mockResolvedValue({ sessionId: 's-1', leaseToken: 't-1' });
    await worker.tick();
    expect(jobManager.runImageSlice).toHaveBeenCalledWith({ sessionId: 's-1', leaseToken: 't-1' });
    expect(jobManager.claimCommit).not.toHaveBeenCalled();
  });

  it('이미지 레인이 비면 커밋으로 넘어간다', async () => {
    jobManager.claimImage.mockResolvedValue(null);
    jobManager.claimCommit.mockResolvedValue({ sessionId: 's-1', leaseToken: 't-1' });
    await worker.tick();
    expect(jobManager.runCommitSlice).toHaveBeenCalled();
  });

  it('이미지 슬라이스가 던지면 image kind 로 기록한다', async () => {
    jobManager.claimImage.mockResolvedValue({ sessionId: 's-1', leaseToken: 't-1' });
    jobManager.runImageSlice.mockRejectedValue(new Error('boom'));
    await worker.tick();
    expect(jobManager.recordJobError).toHaveBeenCalledWith('s-1', 'image', 'boom');
  });
```

- [ ] **Step 5: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import-job" 2>&1 | tail -25
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS. `ProductImportJobManager` 생성자 인자가 둘 늘었으므로 기존 스펙의 조립부를 함께 고쳐야 한다 — 컴파일 오류가 알려준다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.spec.ts
git commit -m "feat(product-import): 이미지 레인 워커 — probe→fetch→마감, 동시성 1"
```

---

### Task 11: 커밋 경로 배선 — 이미지 주입 + 디렉티브 치환

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts` (`createFromRecord`)
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts` (`runCommitSlice`)
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `SessionImageMap`·`EMPTY_SESSION_IMAGES` (Task 3), `replaceDirectiveImageKeys` (Task 2), `indexSessionImages`·`unresolvedImageError`·`getSessionImages` (Task 9)
- Produces: `createFromRecord(record, userId, tx, images: SessionImageMap): Promise<string>` — 마지막 인자가 늘어난다. 이미지 없는 세션은 `EMPTY_SESSION_IMAGES` 를 넘긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

기존 `product-import.manager.spec.ts` 의 `createFromRecord` 케이스가 이미 `productMastersService.updateVersion` 을 감시하는 목을 갖고 있다. 그 목의 캡처된 인자에 단언한다 — 새 하네스를 만들지 않는다.

```typescript
import { EMPTY_SESSION_IMAGES, SessionImageMap, ProductRecord } from '../dto/import.types';

describe('ProductImportManager.createFromRecord — 이미지', () => {
  /** updateVersion 이 받은 data 를 캡처한다. 나머지 협력자는 최소 동작만. */
  function capture() {
    const updates: Array<Record<string, unknown>> = [];
    const productMastersService = {
      createMaster: jest.fn().mockResolvedValue({ id: 'v-1', masterId: 'm-1' }),
      updateVersion: jest.fn(async (_versionId: string, data: Record<string, unknown>) => {
        updates.push(data);
      }),
    };
    const manager = new ProductImportManager(
      { run: <T>(fn: (t: unknown) => Promise<T>) => fn({}) } as never,
      { getVariantComboMap: jest.fn().mockResolvedValue(new Map()) } as never,
      productMastersService as never,
      { replaceVersionRules: jest.fn() } as never,
      { build: jest.fn().mockReturnValue([]) } as never,
      { upsertForDraft: jest.fn() } as never,
      { cleanupUploaded: jest.fn() } as never,
    );
    return { manager, updates };
  }

  function record(over: Partial<ProductRecord>): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: {},
      version: { name: '니트A' },
      basePrice: 29000,
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
      ...over,
    };
  }

  const images: SessionImageMap = {
    main: new Map([
      ['IMG-1', 'f-thumb'],
      ['IMG-2', 'f-add-2'],
      ['IMG-3', 'f-add-3'],
    ]),
    description: new Map([['IMG-9', 'f-desc']]),
  };

  it('대표·부가 fileId 를 updateVersion 에 넘긴다', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(
      record({ thumbnailImageKey: 'IMG-1', additionalImageKeys: ['IMG-2'] }),
      'u-1',
      {} as never,
      images,
    );
    expect(updates[0]).toMatchObject({ thumbnailFileId: 'f-thumb', additionalImageFileIds: ['f-add-2'] });
  });

  it('부가 이미지 순서가 지정 순서 그대로다 (updateVersion 이 index+1 을 sortOrder 로 쓴다)', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(record({ additionalImageKeys: ['IMG-3', 'IMG-2'] }), 'u-1', {} as never, images);
    expect(updates[0].additionalImageFileIds).toEqual(['f-add-3', 'f-add-2']);
  });

  it('본문 디렉티브의 imageKey 를 fileId 로 치환한다', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(
      record({
        version: { name: 'x', description: '앞\n::product-image{imageKey="IMG-9" alt="상세"}' },
        descriptionImageKeys: ['IMG-9'],
      }),
      'u-1',
      {} as never,
      images,
    );
    expect(updates[0].description).toBe('앞\n::product-image{fileId="f-desc" alt="상세"}');
  });

  it('이미지를 안 쓰는 행은 이미지 키를 아예 만들지 않는다', async () => {
    const { manager, updates } = capture();
    await manager.createFromRecord(record({}), 'u-1', {} as never, EMPTY_SESSION_IMAGES);
    // undefined 를 넣어도 drizzle 은 무시하지만, 키를 만들면 updateVersion 이
    // `!== undefined` 분기로 기존 이미지를 지우는 DELETE 두 번을 더 돈다.
    expect('thumbnailFileId' in updates[0]).toBe(false);
    expect('additionalImageFileIds' in updates[0]).toBe(false);
  });
});
```

**협력자 순서 주의:** 위 `new ProductImportManager(...)` 의 인자 순서는 Task 12 가 `imageCleaner` 를 **마지막**에 추가한 뒤의 순서다. Task 11 을 먼저 구현한다면 마지막 인자를 빼고, Task 12 에서 다시 넣는다 — 컴파일 오류가 알려준다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.manager" -t "createFromRecord" 2>&1 | tail -25
```

기대: FAIL — 인자 개수 불일치(TS) 또는 `thumbnailFileId` 가 `undefined`.

- [ ] **Step 3: `createFromRecord` 를 구현한다**

import 를 넓힌다.

```typescript
import { ProductRecord, ImageSourceRef, SessionImageMap } from '../dto/import.types';
import { replaceDirectiveImageKeys } from './product-import-image.directive';
```

`createFromRecord` 를 교체한다.

```typescript
  /**
   * 레코드 하나로 draft 상품을 만든다. 호출자가 연 트랜잭션 안에서 돈다 —
   * 이 안에서 터지면 그 행의 변경 전부가 롤백된다.
   *
   * `images` 는 **이 세션의 업로드 결과**다(슬라이스당 한 번 만들어 모든 행이 공유한다).
   * 여기 도달했다는 건 호출부가 이미 `unresolvedImageError` 로 해결 가능성을 확인했다는
   * 뜻이라, 아래 조회는 전부 성공한다고 보고 진행한다 — 판단 지점을 하나로 모은다.
   */
  async createFromRecord(
    record: ProductRecord,
    userId: string,
    tx: DbTransaction,
    images: SessionImageMap,
  ): Promise<string> {
    const version = await this.productMastersService.createMaster(userId, tx);

    const thumbnailFileId = record.thumbnailImageKey ? images.main.get(record.thumbnailImageKey) : undefined;
    // 지정 순서가 그대로 sortOrder 가 된다(updateVersion 이 index+1 을 넣는다).
    const additionalImageFileIds = (record.additionalImageKeys ?? [])
      .map((key) => images.main.get(key))
      .filter((fileId): fileId is string => typeof fileId === 'string');
    // 본문은 워크북에 imageKey 로 적혀 있다 — 저장 직전에 fileId 로 바꾼다.
    // 워크북에는 UUID 가 등장하지 않는다는 것이 이 간접참조의 목적이다(스펙 §3.1).
    const description =
      typeof record.version.description === 'string'
        ? replaceDirectiveImageKeys(record.version.description, images.description)
        : undefined;

    const data: UpdateProductMasterVersion = {
      ...record.version,
      ...(description !== undefined ? { description } : {}),
      categoryIds: record.categoryIds,
      primaryCategoryId: record.primaryCategoryId,
      ...(record.salesStartDate ? { salesStartDate: new Date(record.salesStartDate) } : {}),
      ...(record.salesEndDate ? { salesEndDate: new Date(record.salesEndDate) } : {}),
      // 값이 없으면 키 자체를 만들지 않는다 — updateVersion 은 `!== undefined` 로 분기해
      // **기존 이미지를 지우는** 경로를 타므로(product-masters.service.ts:920,940), 신규
      // 생성이라 지울 것이 없어도 불필요한 DELETE 왕복이 두 번 는다.
      ...(thumbnailFileId ? { thumbnailFileId } : {}),
      ...(additionalImageFileIds.length > 0 ? { additionalImageFileIds } : {}),
      optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
    };
    await this.productMastersService.updateVersion(version.id, data, tx);

    // (이하 구매제약 / comboMap / applyVariantCodes / pricing 은 변경 없음)
```

- [ ] **Step 4: `runCommitSlice` 를 배선한다**

`product-import-job.manager.ts` 의 import 에 추가한다.

```typescript
import { EMPTY_SESSION_IMAGES } from '../dto/import.types';
import { indexSessionImages, unresolvedImageError } from './product-import-image.resolver';
```

`runCommitSlice` 에서 `variantCodeChecker.check(records)` 직후에 인덱스를 만든다.

```typescript
    const records = items.map((item) => item.payload).filter(isProductRecord);
    await this.variantCodeChecker.check(records);

    // 세션 이미지 인덱스는 **슬라이스당 한 번**만 만든다. 행 수는 MAX_IMAGE_ROWS 로 유계고,
    // 이미지가 없는 세션이면 조회가 0행이라 비용이 없다.
    const imageIndex = indexSessionImages(await this.reader.getSessionImages(sessionId));
```

행 루프의 `record.errors.length > 0` 분기 **바로 뒤**에 이미지 확인을 넣는다.

```typescript
      if (record.errors.length > 0) {
        await this.failItem(
          item.id,
          sessionId,
          record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; '),
        );
        continue;
      }

      // 참조한 이미지가 하나라도 못 올라왔으면 이 행은 실패다. 이미지 없이 만들면 그건
      // 이 단계가 없애려는 실패 모드 그대로이고, 게다가 조용하다 — 관리자는 상품을
      // 하나씩 열어보기 전엔 어디가 빠졌는지 모른다(계획 서두의 판단 1).
      const imageError = unresolvedImageError(record, imageIndex);
      if (imageError) {
        await this.failItem(item.id, sessionId, imageError);
        continue;
      }
```

`createFromRecord` 호출에 인자를 넘긴다.

```typescript
          const masterId = await this.importManager.createFromRecord(record, userId, trx, imageIndex.fileIds);
```

**`EMPTY_SESSION_IMAGES` 는 어디에 쓰나:** `indexSessionImages([])` 가 이미 빈 맵 두 개를 만들므로 워커 경로에서는 안 쓴다. 스펙 파일과, 나중에 `createFromRecord` 를 다른 곳에서 부를 때의 기본값으로 export 해 둔다.

- [ ] **Step 5: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts
git commit -m "feat(product-import): 커밋 시 이미지 주입 + 본문 디렉티브 fileId 치환

참조한 이미지가 하나라도 없으면 그 행을 실패시킨다 — 이미지 없이 조용히 만들지 않는다."
```

---

### Task 12: 취소 확장 + 업로드 이미지 정리

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image.cleaner.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image.cleaner.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts` (`cancelSession`)
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `ProductImportFileClient` (Task 7), `productImportImages` (Task 1)
- Produces:
  - `@Injectable() export class ProductImportImageCleaner` — `cleanupUploaded(sessionId: string): Promise<void>`
  - `CancelAcceptedDto.imageStatus: string`
  - `SessionSummaryDto.imageStatus: string` / `.imageError: string | null`

**취소가 되돌리는 것 (스펙 §3.4.1)**

| 취소 시점 | 되돌리는 것 | 남는 것 |
|---|---|---|
| probe 중 | — | — |
| fetch 중 | **업로드된 이미지 soft delete** | — |
| commit 중 | 없음 | 이미 생성된 draft 상품 |
| publish 중 | 없음 | 이미 게시된 상품 + 이미 나간 이벤트 |

**draft 자동 삭제는 하지 않는다.** 삭제는 되돌릴 수 없고, 부분 생성된 상품은 사람이 보고 판단하는 것이 맞다.

**이미지 정리는 반드시 한다.** file-service 에 고아 정리 잡이 없어(스펙 §2.8) 안 지우면 S3 에 영구 잔존한다. `product_import_images.file_id` 를 전부 추적하므로 정리는 싸고, 권한도 이미 통한다.

**정리는 트랜잭션 밖에서 돈다.** HTTP 호출을 DB 트랜잭션이 물면 커넥션이 초 단위로 잠긴다. **정리 실패는 로그만 남기고 취소를 막지 않는다** — 취소가 정리 때문에 실패하는 편이 더 나쁘다.

**남는 경계 하나(의도적):** 정리가 도는 사이 진행 중인 fetch 슬라이스가 이미지 하나를 더 올릴 수 있다. 슬라이스는 행마다 취소를 확인하므로 창은 최대 한 장이고, 그 한 장은 S3 에 남는다. 이걸 완전히 없애려면 정리를 워커 쪽으로 옮겨야 하는데, 그러면 **lease 를 아무도 안 들고 있는 세션(대부분의 취소 시점)이 영영 정리되지 않는다** — 훨씬 나쁜 교환이다. 기록만 남긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 (cleaner)**

```typescript
import { ProductImportImageCleaner } from './product-import-image.cleaner';
import { productImportSessions } from '../../../schema/catalog.schema';

describe('ProductImportImageCleaner', () => {
  /**
   * cleanupUploaded 는 한 트랜잭션에서 세션 1행 + 이미지 N행을 읽는다.
   * 세션 조회만 `.limit(1)` 로 끝나므로 그 형태로 분기한다.
   */
  function harness(fileIds: Array<string | null>, uploadedBy: string | null = 'u-1') {
    const softDelete = jest.fn().mockResolvedValue(undefined);
    const trx = {
      select: (_projection?: unknown) => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === productImportSessions) {
              return { limit: () => Promise.resolve([{ uploadedBy }]) };
            }
            return Promise.resolve(fileIds.map((fileId) => ({ fileId })));
          },
        }),
      }),
    };
    const db = { run: <T>(fn: (t: unknown) => Promise<T>) => fn(trx) } as never;
    const cleaner = new ProductImportImageCleaner(db, { softDelete } as never);
    return { cleaner, softDelete };
  }

  it('uploaded 행의 fileId 를 전부 지운다', async () => {
    const { cleaner, softDelete } = harness(['f-1', 'f-2']);
    await cleaner.cleanupUploaded('s-1');
    expect(softDelete).toHaveBeenCalledTimes(2);
    expect(softDelete).toHaveBeenCalledWith('f-1', 'u-1');
    expect(softDelete).toHaveBeenCalledWith('f-2', 'u-1');
  });

  it('fileId 가 null 인 행은 건너뛴다', async () => {
    const { cleaner, softDelete } = harness([null, 'f-2']);
    await cleaner.cleanupUploaded('s-1');
    expect(softDelete).toHaveBeenCalledTimes(1);
    expect(softDelete).toHaveBeenCalledWith('f-2', 'u-1');
  });

  it('일부 삭제가 실패해도 나머지를 계속 지우고 던지지 않는다', async () => {
    const { cleaner, softDelete } = harness(['f-1', 'f-2']);
    softDelete.mockRejectedValueOnce(new Error('403'));
    await expect(cleaner.cleanupUploaded('s-1')).resolves.toBeUndefined();
    expect(softDelete).toHaveBeenCalledTimes(2);
  });

  it('지울 것이 없으면 file-service 를 부르지 않는다', async () => {
    const { cleaner, softDelete } = harness([]);
    await cleaner.cleanupUploaded('s-1');
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('uploaded_by 가 없는 옛 세션은 조용히 건너뛴다', async () => {
    const { cleaner, softDelete } = harness(['f-1'], null);
    await expect(cleaner.cleanupUploaded('s-1')).resolves.toBeUndefined();
    expect(softDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-image.cleaner" 2>&1 | tail -20
```

기대: FAIL — 모듈 없음.

- [ ] **Step 3: cleaner 를 구현한다**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { type PimSchema, productImportImages, productImportSessions } from '../../../schema/catalog.schema';
import { ProductImportFileClient } from './product-import-file.client';

/**
 * 취소된 세션이 이미 올린 이미지를 지운다.
 *
 * file-service 에 고아 파일 정리 잡이 없어(스펙 §2.8) 안 지우면 S3 에 영구 잔존한다.
 * `product_import_images.file_id` 를 전부 추적하므로 정리는 싸고, 권한도 이미 통한다
 * (file-access.ts:62 가 scopes:['master'] 위임 토큰을 명시 허용).
 *
 * **트랜잭션 밖에서 돈다.** HTTP 호출을 DB 트랜잭션이 물면 커넥션이 초 단위로 잠긴다.
 * **실패는 로그만 남긴다** — 취소가 정리 때문에 실패하는 편이 더 나쁘다.
 *
 * ⚠️ 진행 중인 fetch 슬라이스가 정리 도중 한 장을 더 올릴 수 있다(슬라이스는 행마다
 * 취소를 확인하므로 창은 최대 한 장). 이걸 없애려면 정리를 워커로 옮겨야 하는데, 그러면
 * lease 를 아무도 안 들고 있는 세션 — 즉 대부분의 취소 시점 — 이 영영 정리되지 않는다.
 */
@Injectable()
export class ProductImportImageCleaner {
  private readonly logger = new Logger(ProductImportImageCleaner.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: ProductImportFileClient,
  ) {}

  async cleanupUploaded(sessionId: string): Promise<void> {
    const { uploadedBy, fileIds } = await this.db.run(async (trx) => {
      const [session] = await trx
        .select({ uploadedBy: productImportSessions.uploadedBy })
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      const rows = await trx
        .select({ fileId: productImportImages.fileId })
        .from(productImportImages)
        .where(
          and(
            eq(productImportImages.sessionId, sessionId),
            eq(productImportImages.status, 'uploaded'),
            isNotNull(productImportImages.fileId),
          ),
        );
      return {
        uploadedBy: session?.uploadedBy ?? null,
        fileIds: rows.map((row) => row.fileId).filter((id): id is string => typeof id === 'string'),
      };
    });

    if (fileIds.length === 0) return;
    if (!uploadedBy) {
      // 옛 세션은 uploaded_by 가 NULL 일 수 있다(컬럼이 nullable). 위임 토큰을 만들 수
      // 없으므로 지울 방법이 없다 — 조용히 넘기되 흔적은 남긴다.
      this.logger.warn(`업로더가 없는 세션이라 이미지 정리를 건너뛴다 (session=${sessionId}, files=${fileIds.length})`);
      return;
    }

    let failed = 0;
    for (const fileId of fileIds) {
      try {
        await this.fileClient.softDelete(fileId, uploadedBy);
      } catch (error) {
        failed += 1;
        this.logger.warn(`이미지 정리 실패 (session=${sessionId}, file=${fileId}): ${String(error)}`);
      }
    }
    this.logger.log(`취소 세션 이미지 정리 완료 (session=${sessionId}, 총 ${fileIds.length}건, 실패 ${failed}건)`);
  }
}
```

- [ ] **Step 4: `cancelSession` 을 확장한다**

`product-import.manager.ts` 의 생성자에 cleaner 를 추가한다.

```typescript
    private readonly purchaseConstraintsService: ProductPurchaseConstraintsService,
    private readonly imageCleaner: ProductImportImageCleaner,
  ) {}
```

`cancelSession` 을 교체한다.

```typescript
  async cancelSession(sessionId: string): Promise<CancelAcceptedDto> {
    const active = (status: string): boolean => status === 'queued' || status === 'running';

    const result = await this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1)
        .for('update');
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      if (session.cancelRequestedAt) throw new ConflictError('이미 취소된 세션입니다.');

      const cancelImage = active(session.imageStatus);
      const cancelCommit = active(session.commitStatus);
      const cancelPublish = active(session.publishStatus);
      if (!cancelImage && !cancelCommit && !cancelPublish) {
        throw new ConflictError('진행 중인 작업이 없어 취소할 수 없습니다.');
      }

      const canceledAt = new Date();
      await trx
        .update(productImportSessions)
        .set({
          cancelRequestedAt: canceledAt,
          ...(cancelImage ? { imageStatus: 'canceled' as const } : {}),
          ...(cancelCommit ? { commitStatus: 'canceled' as const } : {}),
          ...(cancelPublish ? { publishStatus: 'canceled' as const } : {}),
        })
        .where(eq(productImportSessions.id, sessionId));

      return {
        sessionId,
        imageStatus: cancelImage ? 'canceled' : session.imageStatus,
        commitStatus: cancelCommit ? 'canceled' : session.commitStatus,
        publishStatus: cancelPublish ? 'canceled' : session.publishStatus,
        canceledAt,
      };
    });

    // **트랜잭션 밖에서** 정리한다 — HTTP 호출이 DB 커넥션을 물면 안 된다. 실패해도
    // 취소는 이미 확정됐고, 정리 실패로 취소가 실패하는 편이 더 나쁘다(스펙 §3.4.1).
    await this.imageCleaner.cleanupUploaded(sessionId).catch(() => undefined);

    return result;
  }
```

**중요 — 이미지 레인 게이트와 취소:** 이미지 레인이 `'queued'`/`'running'` 인 세션은 `commit_status` 가 `'idle'` 이라 위 `cancelCommit` 이 false 다. 즉 커밋 레인은 `'idle'` 로 남는다. 그래도 `claim` 의 `cancel_requested_at IS NULL` 가드와 `IN ('queued','running')` 조건 둘 다에 걸려 다시 잡히지 않는다 — 안전하다.

- [ ] **Step 5: DTO 를 넓힌다**

`import-response.dto.ts` — `SessionSummaryDto` 에 추가한다.

```typescript
  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '이미지 레인(probe→fetch) 상태. Images 시트가 없는 워크북은 접수 즉시 completed 다.',
  })
  imageStatus: string;

  @ApiProperty({ required: false, nullable: true })
  imageError: string | null;
```

`CancelAcceptedDto` 에 추가한다.

```typescript
  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '취소 반영 후 이미지 잡 상태. 이미 끝난 레인은 completed 로 남는다.',
  })
  imageStatus: string;
```

`product-import.service.ts` 의 `toSummary` 에 두 줄을 추가한다.

```typescript
      invalidCount: session.invalidCount,
      cancelRequestedAt: session.cancelRequestedAt,
      imageStatus: session.imageStatus,
      imageError: session.imageError,
    };
```

- [ ] **Step 6: manager 스펙에 취소 케이스를 추가한다**

기존 취소 스펙(1단계에서 만든 것)의 세션 목에 `imageStatus` 를 채우고, 아래를 추가한다.

```typescript
describe('ProductImportManager.cancelSession — 이미지 레인', () => {
  function harness(session: Record<string, unknown>) {
    const updates: Array<Record<string, unknown>> = [];
    const cleanupUploaded = jest.fn().mockResolvedValue(undefined);
    const trx = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => ({ for: () => Promise.resolve([session]) }) }) }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
    };
    const manager = new ProductImportManager(
      { run: <T>(fn: (t: unknown) => Promise<T>) => fn(trx) } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { cleanupUploaded } as never,
    );
    return { manager, updates, cleanupUploaded };
  }

  const RUNNING_IMAGE = {
    id: 's-1',
    imageStatus: 'running',
    // 이미지 레인이 도는 동안 커밋 레인은 게이트 때문에 'idle' 이다(acceptCommit).
    commitStatus: 'idle',
    publishStatus: 'idle',
    cancelRequestedAt: null,
  };

  it('이미지 레인만 진행 중이어도 취소된다', async () => {
    const { manager, updates } = harness(RUNNING_IMAGE);
    const out = await manager.cancelSession('s-1');

    expect(updates[0]).toMatchObject({ imageStatus: 'canceled' });
    expect(updates[0].cancelRequestedAt).toBeInstanceOf(Date);
    // 끝나지 않은(아직 시작도 안 한) 레인은 덮지 않는다 — 이력이 거짓이 되지 않게.
    expect('commitStatus' in updates[0]).toBe(false);
    expect('publishStatus' in updates[0]).toBe(false);
    expect(out).toMatchObject({ imageStatus: 'canceled', commitStatus: 'idle', publishStatus: 'idle' });
  });

  it('취소 후 업로드된 이미지를 정리한다', async () => {
    const { manager, cleanupUploaded } = harness(RUNNING_IMAGE);
    await manager.cancelSession('s-1');
    expect(cleanupUploaded).toHaveBeenCalledWith('s-1');
  });

  it('정리가 실패해도 취소 응답은 정상이다', async () => {
    const { manager, cleanupUploaded } = harness(RUNNING_IMAGE);
    cleanupUploaded.mockRejectedValue(new Error('file-service 다운'));
    // 취소가 정리 때문에 실패하는 편이 더 나쁘다.
    await expect(manager.cancelSession('s-1')).resolves.toMatchObject({ imageStatus: 'canceled' });
  });

  it('진행 중인 레인이 하나도 없으면 409 (이미지 레인까지 포함해 판정)', async () => {
    const { manager, cleanupUploaded } = harness({
      id: 's-1',
      imageStatus: 'completed',
      commitStatus: 'completed',
      publishStatus: 'completed',
      cancelRequestedAt: null,
    });
    await expect(manager.cancelSession('s-1')).rejects.toBeInstanceOf(ConflictError);
    expect(cleanupUploaded).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: 통과 + 커밋**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
npm run type-check:scoped 2>&1 | tail -10
git add apps/core/src/modules/catalog/operations/import/services/product-import-image.cleaner.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-image.cleaner.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.service.ts \
        apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts
git commit -m "feat(product-import): 취소가 이미지 레인을 포함하고 업로드된 이미지를 정리한다"
```

---

### Task 13: 진행률 — probe / fetch 단계

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-progress.dto.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts` (`getProgressCounts`)
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.spec.ts`

**Interfaces:**
- Consumes: `productImportImages` (Task 1)
- Produces:
  - `ImportProgressStageKey = 'probe' | 'fetch' | 'commit' | 'publish'`
  - `export interface ImportImageStatusCount { status: ImageRow['status']; count: number }`
  - `ProgressSessionRow` += `'imageStatus' | 'imageError'`
  - `getProgressCounts` 가 `{ session, itemCounts, imageCounts }` 를 돌려준다
  - `ProductImportProgressBuilder.build(session, itemCounts, imageCounts)` — 인자 하나 증가

**단계별 분모 (스펙 §3.5)**

| 단계 | total | done | failed |
|---|---|---|---|
| probe | 전체 이미지 행 | `status != 'pending'` | `probe_failed` |
| fetch | `status ∈ {probed, uploaded, fetch_failed}` | `uploaded + fetch_failed` | `fetch_failed` |

**probe 실패가 fetch 분모에서 빠지는 것이 5값 enum 의 존재 이유다.** 실패를 한 값으로 뭉치면 fetch 의 분모가 틀려 진행률이 100% 에 도달하지 못한다.

**단계 상태 파생**

- `probe`: `imageStatus === 'running' && pending > 0` 이면 `'running'`, `imageStatus === 'running' && pending === 0` 이면 `'completed'`, 그 밖엔 `imageStatus` 그대로.
- `fetch`: `imageStatus === 'running' && pending > 0` 이면 아직 시작 전이므로 `'queued'`, 그 밖엔 `imageStatus` 그대로.

**이미지가 없는 세션은 두 단계의 `total` 이 0** 이라 `visibleStages` 가 접는다 — 화면이 지금과 똑같이 2단계로 보인다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { ProductImportProgressBuilder, ImportImageStatusCount } from './product-import-progress.builder';

function imageCounts(counts: Partial<Record<string, number>>): ImportImageStatusCount[] {
  return Object.entries(counts).map(([status, count]) => ({
    status: status as ImportImageStatusCount['status'],
    count: count ?? 0,
  }));
}

describe('ProductImportProgressBuilder — 이미지 단계', () => {
  const builder = new ProductImportProgressBuilder();
  const session = {
    id: 's-1',
    fileName: 'a.xlsx',
    totalRows: 10,
    invalidCount: 0,
    imageStatus: 'running' as const,
    commitStatus: 'idle' as const,
    publishStatus: 'idle' as const,
    imageError: null,
    commitError: null,
    publishError: null,
    cancelRequestedAt: null,
  };

  it('이미지가 없으면 probe/fetch 의 분모가 0 이다 (화면이 접는다)', () => {
    const out = builder.build({ ...session, imageStatus: 'completed' }, [], []);
    const probe = out.stages.find((s) => s.key === 'probe')!;
    const fetch = out.stages.find((s) => s.key === 'fetch')!;
    expect(probe.total).toBe(0);
    expect(fetch.total).toBe(0);
  });

  it('probe 진행 중이면 fetch 는 아직 queued 다', () => {
    const out = builder.build(session, [], imageCounts({ pending: 6, probed: 3, probe_failed: 1 }));
    const probe = out.stages.find((s) => s.key === 'probe')!;
    expect(probe).toMatchObject({ status: 'running', total: 10, done: 4, failed: 1 });
    const fetch = out.stages.find((s) => s.key === 'fetch')!;
    expect(fetch.status).toBe('queued');
  });

  it('pending 이 0 이면 probe 는 completed 로 확정된다', () => {
    const out = builder.build(session, [], imageCounts({ probed: 5, probe_failed: 2, uploaded: 3 }));
    const probe = out.stages.find((s) => s.key === 'probe')!;
    expect(probe).toMatchObject({ status: 'completed', total: 10, done: 10, failed: 2 });
  });

  it('probe 실패는 fetch 분모에서 빠진다', () => {
    const out = builder.build(
      session,
      [],
      imageCounts({ probe_failed: 4, probed: 2, uploaded: 3, fetch_failed: 1 }),
    );
    const fetch = out.stages.find((s) => s.key === 'fetch')!;
    // 분모 = probed + uploaded + fetch_failed = 6 (probe_failed 4 는 빠진다)
    expect(fetch).toMatchObject({ status: 'running', total: 6, done: 4, failed: 1 });
  });

  it('단계 순서는 probe → fetch → commit → publish 다', () => {
    const out = builder.build(session, [], imageCounts({ pending: 1 }));
    expect(out.stages.map((s) => s.key)).toEqual(['probe', 'fetch', 'commit', 'publish']);
  });

  it('이미지 레인 오류는 두 단계 모두에 실린다 (어느 phase 에서 죽었는지 화면이 접지 않게)', () => {
    const out = builder.build(
      { ...session, imageStatus: 'failed', imageError: 'boom' },
      [],
      imageCounts({ pending: 2 }),
    );
    expect(out.stages.find((s) => s.key === 'probe')!.error).toBe('boom');
    expect(out.stages.find((s) => s.key === 'fetch')!.error).toBe('boom');
  });

  it('취소된 세션은 두 단계 모두 canceled 다', () => {
    const out = builder.build(
      { ...session, imageStatus: 'canceled', cancelRequestedAt: new Date() },
      [],
      imageCounts({ pending: 2, uploaded: 1 }),
    );
    expect(out.stages.find((s) => s.key === 'probe')!.status).toBe('canceled');
    expect(out.stages.find((s) => s.key === 'fetch')!.status).toBe('canceled');
    expect(out.canceled).toBe(true);
  });
});
```

기존 `build(session, itemCounts)` 2인자 호출이 스펙 전반에 있으므로 **전부 3인자로 고쳐야 한다** — 컴파일 오류가 알려준다. 기존 케이스는 `[]` 를 넘기고, 세션 리터럴에 `imageStatus: 'completed'`, `imageError: null` 을 채운다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import-progress.builder" 2>&1 | tail -25
```

기대: FAIL — 인자 개수 불일치.

- [ ] **Step 3: DTO 를 넓힌다**

`import-progress.dto.ts` 를 교체한다.

```typescript
/**
 * 화면 단계 키. 워커 **레인**과 1:1 이 아니다 — 레인은 claim·lease·굶주림의 단위고
 * 단계는 사람이 이해하는 단위다. 이미지 레인 하나가 'probe'·'fetch' 두 단계로 갈린다
 * (스펙 §3.5). 화면은 이 배열을 순회해 그리고, 단계 개수를 코드에 박지 않는다.
 */
export type ImportProgressStageKey = 'probe' | 'fetch' | 'commit' | 'publish';

export class ImportProgressStageDto {
  @ApiProperty({ enum: ['probe', 'fetch', 'commit', 'publish'] })
  key: ImportProgressStageKey;
  // (나머지 필드는 변경 없음)
```

- [ ] **Step 4: reader 에 이미지 집계를 추가한다**

`getProgressCounts` 의 반환 타입과 본문을 교체한다.

```typescript
  async getProgressCounts(
    sessionId: string,
    tx?: DbTransaction,
  ): Promise<{
    session: SessionRow;
    itemCounts: ImportItemStatusCount[];
    imageCounts: ImportImageStatusCount[];
  }> {
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

      // 이미지 집계는 5행 이하다 — 세 번째 쿼리를 더해도 응답은 여전히 세션 크기와 무관하다.
      const groupedImages = await trx
        .select({ status: productImportImages.status, value: count() })
        .from(productImportImages)
        .where(eq(productImportImages.sessionId, sessionId))
        .groupBy(productImportImages.status);

      return {
        session,
        itemCounts: grouped.map((row) => ({
          status: row.status,
          publishStatus: row.publishStatus,
          count: Number(row.value),
        })),
        imageCounts: groupedImages.map((row) => ({ status: row.status, count: Number(row.value) })),
      };
    }, tx);
  }
```

import 에 `ImportImageStatusCount` 를 추가한다.

```typescript
import type { ImportItemStatusCount, ImportImageStatusCount } from './product-import-progress.builder';
```

- [ ] **Step 5: builder 를 구현한다**

`product-import-progress.builder.ts` 상단을 교체한다.

```typescript
import type {
  productImportSessions,
  productImportItems,
  productImportImages,
} from '../../../schema/catalog.schema';

type SessionRow = typeof productImportSessions.$inferSelect;
type ItemRow = typeof productImportItems.$inferSelect;
type ImageRow = typeof productImportImages.$inferSelect;

export type ProgressSessionRow = Pick<
  SessionRow,
  | 'id'
  | 'fileName'
  | 'totalRows'
  | 'invalidCount'
  | 'imageStatus'
  | 'commitStatus'
  | 'publishStatus'
  | 'imageError'
  | 'commitError'
  | 'publishError'
  | 'cancelRequestedAt'
>;

/** 이미지 행의 status 별 개수. 상태가 5값이라 상한이 5행이다. */
export interface ImportImageStatusCount {
  status: ImageRow['status'];
  count: number;
}
```

`build` 를 교체한다.

```typescript
  build(
    session: ProgressSessionRow,
    itemCounts: ImportItemStatusCount[],
    imageCounts: ImportImageStatusCount[],
  ): ImportProgressDto {
    const sum = (predicate: (row: ImportItemStatusCount) => boolean): number =>
      itemCounts.reduce((acc, row) => (predicate(row) ? acc + row.count : acc), 0);
    const images = (...statuses: Array<ImageRow['status']>): number =>
      imageCounts.reduce((acc, row) => (statuses.includes(row.status) ? acc + row.count : acc), 0);

    // ─── 이미지 두 단계 ───
    const pending = images('pending');
    const probeFailed = images('probe_failed');
    const uploaded = images('uploaded');
    const fetchFailed = images('fetch_failed');
    const probeTotal = images('pending', 'probed', 'uploaded', 'probe_failed', 'fetch_failed');
    // probe 실패는 fetch 분모에서 빠진다 — 5값 enum 의 존재 이유가 이것이다. 뭉쳐 놓으면
    // 분모가 틀려 진행률이 영영 100% 에 닿지 않는다(스펙 §3.2.1).
    const fetchTotal = images('probed', 'uploaded', 'fetch_failed');

    const probing = session.imageStatus === 'running' && pending > 0;
    // 레인이 도는 중이고 pending 이 0 이면 probe 는 사실상 끝났다 — "probe 전량 완료"는
    // `count(status='pending') = 0` 으로 관측된다(스펙 §3.2.2).
    const probeStatus = session.imageStatus === 'running' && pending === 0 ? 'completed' : session.imageStatus;
    // probe 가 도는 동안 fetch 는 아직 시작 전이다. 'running' 으로 두면 화면이 두 단계가
    // 동시에 도는 것처럼 보인다.
    const fetchStatus = probing ? 'queued' : session.imageStatus;

    const createdRows = sum((row) => row.status === 'created');
    const failedRows = sum((row) => row.status === 'failed');
    const invalidCount = session.invalidCount ?? 0;
    const commitFailed = Math.max(0, failedRows - invalidCount);
    const commitTotal = Math.max(0, session.totalRows - invalidCount);
    const publishFailed = sum((row) => row.status === 'created' && row.publishStatus === 'failed');
    const publishPublished = sum((row) => row.status === 'created' && row.publishStatus === 'published');

    const stages: ImportProgressStageDto[] = [
      {
        key: 'probe',
        label: '이미지 점검',
        status: probeStatus,
        done: probeTotal - pending,
        total: probeTotal,
        failed: probeFailed,
        // 레인 오류는 어느 phase 에서 났는지 알 수 없으므로 두 단계 모두에 싣는다 —
        // 한쪽에만 실으면 그 단계가 분모 0 으로 접힐 때 오류가 화면 어디에도 안 뜬다.
        error: session.imageError,
      },
      {
        key: 'fetch',
        label: '이미지 업로드',
        status: fetchStatus,
        done: uploaded + fetchFailed,
        total: fetchTotal,
        failed: fetchFailed,
        error: session.imageError,
      },
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
```

`product-import.service.ts` 의 `getProgress` 를 고친다.

```typescript
  async getProgress(sessionId: string): Promise<ImportProgressDto> {
    const { session, itemCounts, imageCounts } = await this.reader.getProgressCounts(sessionId);
    return this.progressBuilder.build(session, itemCounts, imageCounts);
  }
```

- [ ] **Step 6: 통과 + 커밋**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
npm run type-check:scoped 2>&1 | tail -10
git add apps/core/src/modules/catalog/operations/import/dto/import-progress.dto.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-progress.builder.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.service.ts
git commit -m "feat(product-import): 진행률에 이미지 점검·업로드 단계 추가"
```

---

### Task 14: 모듈 등록 + 템플릿 + 프리뷰 + admin-web 미러

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.module.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.template.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.template.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts` (`ResolvedPreviewDto.imageCount`)
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts` (프리뷰 조립)
- Modify: `apps/admin-web/src/lib/types/dto/product-import.ts`
- Modify: `apps/admin-web/src/features/mall/product-imports/wizard/validate-step.tsx`

**Interfaces:**
- Consumes: Task 5~12 의 신규 클래스 6개
- Produces: 템플릿 워크북에 `Images` 시트 + Products 컬럼 2개, 프리뷰 응답에 `resolved.imageCount`

- [ ] **Step 1: 모듈에 provider 를 등록한다**

`product-import.module.ts` 에 import 6줄과 provider 6줄을 추가한다.

```typescript
import { ProductImportImageFetcher } from './services/product-import-image.fetcher';
import { ProductImportFileClient } from './services/product-import-file.client';
import { ProductImportImageCleaner } from './services/product-import-image.cleaner';
```

```typescript
    ProductImportJobManager,
    ProductImportJobWorker,
    ProductImportImageFetcher,
    ProductImportFileClient,
    ProductImportImageCleaner,
  ],
```

`product-import-image.directive.ts`·`product-import-image.guard.ts`·`product-import-image.resolver.ts` 는 **순수 함수 모듈이라 provider 가 아니다** — import 로만 쓴다.

`ConfigService` 는 이미 `ProductImportJobManager` 가 주입받고 있으므로 전역 `ConfigModule` 이 있다. 별도 import 는 필요 없다(부팅이 실패하면 `apps/core/src/app.module.ts` 의 `ConfigModule.forRoot({ isGlobal: true })` 를 확인한다).

- [ ] **Step 2: 템플릿 워크북을 갱신한다 (실패 테스트 먼저)**

`product-import.template.spec.ts` 에 추가한다.

```typescript
it('Products 헤더에 이미지 컬럼 2개가 있다', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generateTemplateWorkbook());
  const headers = wb.getWorksheet('Products')!.getRow(1).values as string[];
  expect(headers).toContain('thumbnailImageKey');
  expect(headers).toContain('additionalImageKeys');
});

it('Images 시트가 imageKey/sourceUrl 헤더로 있다', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generateTemplateWorkbook());
  const sheet = wb.getWorksheet('Images');
  expect(sheet).toBeDefined();
  expect((sheet!.getRow(1).values as string[]).filter(Boolean)).toEqual(['imageKey', 'sourceUrl']);
});

it('예시 description 이 본문 디렉티브를 imageKey 로 쓴다', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generateTemplateWorkbook());
  const headers = (wb.getWorksheet('Products')!.getRow(1).values as string[]) ?? [];
  const col = headers.indexOf('description');
  const value = String(wb.getWorksheet('Products')!.getRow(2).getCell(col).text);
  expect(value).toMatch(/::product-image\{imageKey="IMG-2"\}/);
});
```

`product-import.template.ts` 를 고친다 — `PRODUCT_HEADERS` 의 `description` **바로 앞**에 두 컬럼을 넣는다(이미지와 본문이 붙어 있어야 MD 가 읽기 쉽다).

```typescript
  'alternativeName',
  'thumbnailImageKey',
  'additionalImageKeys',
  'description',
```

예시 행의 대응 위치를 채운다.

```typescript
    '',              // alternativeName
    'IMG-1',         // thumbnailImageKey — Images 시트의 키를 그대로 쓴다
    'IMG-3|IMG-4',   // additionalImageKeys — '|' 구분, 최대 5개
    // 본문 이미지는 URL 이 아니라 디렉티브다. imageKey 로 쓰면 임포터가 fileId 로 치환한다 —
    // 워크북에는 UUID 가 등장하지 않는다.
    '부드러운 니트\n::product-image{imageKey="IMG-2"}',
```

`Constraints` 시트 아래에 새 시트를 추가한다.

```typescript
  // 선택 시트. 이미지 URL 사전이다. 같은 키를 여러 상품이 가리키면 **한 번만** 내려받아
  // 공유한다. 한 키가 대표(thumbnail/additional)와 본문 양쪽에 쓰이면 용도가 달라
  // 두 번 올라가고 fileId 도 둘이 된다 — 컨텍스트별 MIME·크기 제약이 다르기 때문이다.
  const images = wb.addWorksheet('Images');
  images.addRow(IMAGE_HEADERS);
  images.addRow(['IMG-1', 'https://supplier.example/p/123/main.jpg']);
  images.addRow(['IMG-2', 'https://supplier.example/p/123/detail-01.jpg']);
  images.addRow(['IMG-3', 'https://supplier.example/p/123/sub-01.jpg']);
  images.addRow(['IMG-4', 'https://supplier.example/p/123/sub-02.jpg']);
```

헤더 상수를 추가한다.

```typescript
const IMAGE_HEADERS = ['imageKey', 'sourceUrl'];
```

- [ ] **Step 3: 프리뷰에 이미지 수를 싣는다**

`import-response.dto.ts` 의 `ResolvedPreviewDto` 에 추가한다.

```typescript
  @ApiProperty({
    description: '이 행이 참조하는 고유 이미지 수(대표+부가+본문). 커밋 전에 인식 여부를 확인하는 용도.',
  })
  imageCount: number;
```

`product-import.service.ts` 의 `validate()` 매핑에 한 줄 추가한다.

```typescript
        salesPeriod: this.salesPeriod(r),
        variantCount: this.variantCount(r),
        imageCount: r.imageRefs?.length ?? 0,
      },
```

- [ ] **Step 4: admin-web 미러 타입을 넓힌다**

`apps/admin-web/src/lib/types/dto/product-import.ts`:

```typescript
export interface ResolvedPreview {
  name: string;
  categoryNames: string[];
  categoryCount: number;
  salesPeriod: string | null;
  variantCount: number;
  /** 이 행이 참조하는 고유 이미지 수. 롤링 배포 중 옛 core 응답에는 없다. */
  imageCount?: number;
}
```

```typescript
/**
 * 진행률 화면의 단계 키. 워커 레인과 1:1 이 아니다 — 이미지 레인 하나가 'probe'·'fetch'
 * 두 단계로 갈린다. 화면은 stages 배열을 순회해 그리므로 여기만 넓히면 된다.
 */
export type ImportProgressStageKey = 'probe' | 'fetch' | 'commit' | 'publish';
```

`SessionSummaryDto` 와 `CancelAcceptedDto` 에 추가한다. **둘 다 `?` 다** — 롤링 배포 중 옛 core 는 이 키를 안 실어 보낸다(`cancelRequestedAt` 을 `Boolean()` 으로 읽는 것과 같은 이유).

```typescript
  /** 이미지 레인 상태. 롤링 배포 중 옛 core 응답에는 없다. */
  imageStatus?: ImportJobStatus;
  imageError?: string | null;
```

```typescript
export interface CancelAcceptedDto {
  sessionId: string;
  imageStatus?: ImportJobStatus;
  commitStatus: ImportJobStatus;
  publishStatus: ImportJobStatus;
  canceledAt: string;
}
```

`CommitAcceptedDto` 에도 추가한다.

```typescript
  /** 워커가 내려받을 고유 이미지 수. 옛 core 응답에는 없다. */
  imageCount?: number;
```

- [ ] **Step 5: 프리뷰 화면에 이미지 컬럼을 넣는다**

`validate-step.tsx` — `변형 수` 헤더 **앞**에 한 칸 추가한다.

```tsx
              <th className="p-2">판매기간</th>
              <th className="p-2">이미지</th>
              <th className="p-2">변형 수</th>
```

대응 셀을 추가한다.

```tsx
                <td className="p-2 whitespace-nowrap">
                  {r.resolved.salesPeriod ?? '-'}
                </td>
                {/* 옛 core 응답에는 imageCount 가 없다 — 0 으로 눌러 보이지 않게 한다. */}
                <td className="p-2">{r.resolved.imageCount ?? 0}</td>
                <td className="p-2">{r.resolved.variantCount}</td>
```

- [ ] **Step 6: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
npm run type-check:scoped 2>&1 | tail -10
npx tsc -p apps/admin-web/tsconfig.json --noEmit 2>&1 | grep -E "product-import|validate-step" | head -20
```

기대: jest 전부 PASS, core 신규 타입 error 0건, admin-web 에서 **우리가 만든** error 0건(레포 상시 debt 는 대상이 아니다).

- [ ] **Step 7: 부팅 확인 (DI 그래프)**

provider 6개가 늘었으므로 Nest 가 실제로 뜨는지 본다 — 순환 의존이나 누락된 provider 는 여기서만 잡힌다.

```bash
npm run start:main:dev 2>&1 | tail -40
```

기대: `Nest application successfully started`. `ProductImportImageCleaner` 나 `ProductImportFileClient` 에 대한 `Nest can't resolve dependencies` 가 보이면 provider 등록을 빠뜨린 것이다. 확인 후 Ctrl-C.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/product-import.module.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.template.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.template.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.service.ts \
        apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts \
        apps/admin-web/src/lib/types/dto/product-import.ts \
        apps/admin-web/src/features/mall/product-imports/wizard/validate-step.tsx
git commit -m "feat(product-import): 템플릿 Images 시트 + 프리뷰 이미지 수 + admin-web 미러 타입"
```

---

### Task 15: 통합 테스트 (실 Postgres)

목 하네스는 `.groupBy()` 를 삼켜도 같은 배열을 돌려주고, UNIQUE 제약이나 DEFAULT 는 아예 보이지 않는다. 이 태스크는 **실제 SQL 이 실제 행에 어떻게 작용하는지**만 본다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-image-lane.integration.spec.ts`

**Interfaces:**
- Consumes: `catalogSchema`, `ProductImportSessionReader`, `ProductImportProgressBuilder`, `indexSessionImages`
- Produces: 없음(검증 전용)

**확인할 것 4가지**

1. **`image_status` DEFAULT 가 옛 세션을 이미지 레인에 가두지 않는다** — 컬럼을 명시하지 않고 INSERT 한 세션이 `completed` 로 앉는다. 이게 이 마이그레이션의 유일한 진짜 위험이다.
2. **`claim` 이 이미지 레인을 잡고, `cancel_requested_at` 가드가 취소된 세션을 거른다.**
3. **UNIQUE(session_id, image_key, usage)** — 같은 (키, 용도) 중복 INSERT 가 실패하고, 용도가 다르면 통과한다.
4. **진행률 이미지 집계가 실제 `GROUP BY` 로 나온다** (`count()` 가 bigint 문자열로 올라오는 것 포함).

- [ ] **Step 1: 통합 스펙을 쓴다**

기존 `product-import-progress.integration.spec.ts` 의 격리 패턴(일회용 스키마 + `CREATE TABLE (LIKE … INCLUDING ALL)` + `search_path`)을 그대로 따른다.

```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { catalogSchema, type PimSchema } from '../../../schema/catalog.schema';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportProgressBuilder } from './product-import-progress.builder';
import { indexSessionImages } from './product-import-image.resolver';
import type { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_PRODUCT_IMPORT_IMAGE_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the product import image lane integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('product import 이미지 레인 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `pi_images_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let reader: ProductImportSessionReader;
  const builder = new ProductImportProgressBuilder();

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    // public 의 실제 DDL 을 복제한다 — 손으로 옮겨 적은 테이블에 대고 통과하는 테스트는
    // 아무 것도 증명하지 못한다. INCLUDING ALL 이 DEFAULT·UNIQUE·인덱스를 함께 가져온다.
    await admin.unsafe(`CREATE TABLE product_import_sessions (LIKE public.product_import_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_items (LIKE public.product_import_items INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_images (LIKE public.product_import_images INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    const db = drizzle(client, { schema: catalogSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as never)),
    } as unknown as DbService<PimSchema>;
    reader = new ProductImportSessionReader(dbService, undefined as unknown as OptionReadLoader);
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([client?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM product_import_images`;
    await admin`DELETE FROM product_import_sessions`;
  });

  async function seedSession(over: { imageStatus?: string; commitStatus?: string } = {}): Promise<string> {
    const id = randomUUID();
    // image_status 를 **일부러 명시하지 않는 경로**가 아래 첫 테스트다. 여기서는 필요할 때만 준다.
    if (over.imageStatus) {
      await admin`
        INSERT INTO product_import_sessions (id, file_name, total_rows, status, commit_status, publish_status, image_status)
        VALUES (${id}, ${'it-img-' + id}, 1, 'completed', ${over.commitStatus ?? 'idle'}, 'idle', ${over.imageStatus})
      `;
    } else {
      await admin`
        INSERT INTO product_import_sessions (id, file_name, total_rows, status, commit_status, publish_status)
        VALUES (${id}, ${'it-img-' + id}, 1, 'completed', ${over.commitStatus ?? 'completed'}, 'idle')
      `;
    }
    return id;
  }

  it('image_status 를 명시하지 않은 세션은 completed 로 앉는다 (옛 세션이 레인에 갇히지 않는다)', async () => {
    const id = await seedSession();
    const [row] = await admin`SELECT image_status FROM product_import_sessions WHERE id = ${id}`;
    expect(row.image_status).toBe('completed');
  });

  it('같은 (session, imageKey, usage) 는 두 번 들어가지 않는다', async () => {
    const id = await seedSession({ imageStatus: 'queued' });
    await admin`
      INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
      VALUES (${randomUUID()}, ${id}, 'IMG-1', 'main', 'https://e.example/1.jpg', 'pending')
    `;
    await expect(
      admin`
        INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
        VALUES (${randomUUID()}, ${id}, 'IMG-1', 'main', 'https://e.example/other.jpg', 'pending')
      `,
    ).rejects.toThrow();
  });

  it('용도가 다르면 같은 키라도 행이 둘이다', async () => {
    const id = await seedSession({ imageStatus: 'queued' });
    for (const usage of ['main', 'description']) {
      await admin`
        INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
        VALUES (${randomUUID()}, ${id}, 'IMG-1', ${usage}, 'https://e.example/1.jpg', 'pending')
      `;
    }
    const rows = await reader.getSessionImages(id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.usage).sort()).toEqual(['description', 'main']);
  });

  it('getSessionImages → indexSessionImages 가 uploaded 만 fileId 맵에 넣는다', async () => {
    const id = await seedSession({ imageStatus: 'running' });
    const fileId = randomUUID();
    await admin`
      INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status, file_id)
      VALUES (${randomUUID()}, ${id}, 'IMG-1', 'main', 'https://e.example/1.jpg', 'uploaded', ${fileId})
    `;
    await admin`
      INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status, error_message)
      VALUES (${randomUUID()}, ${id}, 'IMG-2', 'main', 'https://e.example/2.jpg', 'fetch_failed', '404')
    `;
    const index = indexSessionImages(await reader.getSessionImages(id));
    expect(index.fileIds.main.get('IMG-1')).toBe(fileId);
    expect(index.failures.get('main:IMG-2')).toBe('404');
  });

  it('진행률 이미지 집계가 실제 GROUP BY 로 나온다 (count 가 bigint 문자열로 와도)', async () => {
    const id = await seedSession({ imageStatus: 'running', commitStatus: 'idle' });
    const rows: Array<[string, string]> = [
      ['IMG-1', 'pending'],
      ['IMG-2', 'probed'],
      ['IMG-3', 'probe_failed'],
      ['IMG-4', 'uploaded'],
      ['IMG-5', 'fetch_failed'],
    ];
    for (const [key, status] of rows) {
      await admin`
        INSERT INTO product_import_images (id, session_id, image_key, usage, source_url, status)
        VALUES (${randomUUID()}, ${id}, ${key}, 'main', 'https://e.example/x.jpg', ${status})
      `;
    }
    const { session, itemCounts, imageCounts } = await reader.getProgressCounts(id);
    expect(imageCounts.every((c) => typeof c.count === 'number')).toBe(true);

    const progress = builder.build(session, itemCounts, imageCounts);
    const probe = progress.stages.find((s) => s.key === 'probe')!;
    const fetch = progress.stages.find((s) => s.key === 'fetch')!;
    expect(probe).toMatchObject({ total: 5, done: 4, failed: 1, status: 'running' });
    // fetch 분모에서 probe_failed 1건이 빠진다
    expect(fetch).toMatchObject({ total: 3, done: 2, failed: 1 });
  });

  it('취소된 세션은 이미지 레인 클레임에 잡히지 않는다', async () => {
    const id = await seedSession({ imageStatus: 'queued' });
    await admin`UPDATE product_import_sessions SET cancel_requested_at = NOW(), image_status = 'canceled' WHERE id = ${id}`;
    const [row] = await admin`
      SELECT id FROM product_import_sessions
       WHERE image_status IN ('queued', 'running')
         AND (lease_until IS NULL OR lease_until < NOW())
         AND cancel_requested_at IS NULL
    `;
    expect(row).toBeUndefined();
  });
});
```

**클레임 SQL 을 스펙에 손으로 옮겨 적은 것에 주의한다.** `claim()` 의 WHERE 절과 **바이트 단위로 같아야** 의미가 있다 — `product-import-job.manager.ts` 의 `claim()` 을 열어 대조하고, 다르면 스펙이 아니라 대조 결과를 믿는다.

- [ ] **Step 2: 실행한다**

```bash
DATABASE_URL="$DATABASE_URL" REQUIRE_PRODUCT_IMPORT_IMAGE_DB=1 \
  npx jest --testPathPattern=product-import-image-lane.integration 2>&1 | tail -30
```

기대: 전부 PASS. **`skipped` 로 나오면 `DATABASE_URL` 이 안 잡힌 것이다** — 그 상태를 "통과"로 보고하지 않는다. `REQUIRE_…=1` 이 그때 던지게 해 둔 것이 이 실수를 막는 장치다.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-image-lane.integration.spec.ts
git commit -m "test(product-import): 이미지 레인 실 Postgres 통합 — DEFAULT·UNIQUE·집계·취소 가드"
```

---

### Task 16: 스펙 문서 상태 갱신

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음(문서)

- [ ] **Step 1: 상태 줄과 단계 표를 고친다**

문서 머리(`:6`)의 상태 줄을 교체한다.

```markdown
- 상태: 설계 확정. 1~4단계 구현 완료(§6)
```

§6 단계 표의 4단계 행을 교체한다.

```markdown
| **4** | 이미지 파이프라인 — `Images` 시트 + `product_import_images` + probe/fetch 레인 + 업로드 클라이언트 | 마이그레이션 1건 (additive) — **구현 완료(2026-07-31)** |
```

§6 아래 "**구현 계획은 단계별로 따로 쓴다.**" 문장 뒤에 계획 문서 링크를 덧붙인다.

```markdown
**구현 계획은 단계별로 따로 쓴다.**

- 1단계: `docs/superpowers/plans/2026-07-30-product-bulk-import-v3-stage1-ops-gaps.md`
- 2단계: `docs/superpowers/plans/2026-07-30-product-bulk-import-v3-stage2-progress.md`
- 3단계: `docs/superpowers/plans/2026-07-30-product-bulk-import-v3-stage3-fields-and-sheets.md`
- 4단계: `docs/superpowers/plans/2026-07-31-product-bulk-import-v3-stage4-images.md`
```

- [ ] **Step 2: §5 "알려진 결함" 에 이번에 남긴 것을 추가한다**

기존 목록 끝에 두 줄을 덧붙인다.

```markdown
- **취소 정리에 한 장짜리 경계가 남는다.** 정리가 도는 사이 진행 중인 fetch 슬라이스가 이미지 하나를 더 올릴 수 있다(슬라이스는 행마다 취소를 확인하므로 창은 최대 한 장). 없애려면 정리를 워커로 옮겨야 하는데, 그러면 lease 를 아무도 안 들고 있는 세션 — 대부분의 취소 시점 — 이 영영 정리되지 않는다. 전역 고아 정리 잡이 생기면 함께 사라진다.
- **참조 이미지가 하나라도 실패하면 그 상품 행이 실패한다.** 소싱처 URL 하나가 죽으면 그걸 참조하는 모든 행이 함께 죽는다. 이미지 없이 조용히 생성하는 대안보다 낫다는 판단이지만(4단계 계획 서두), 대량 실패가 잦으면 "부분 생성 + 경고" 로 바꾸는 것이 후속 논의 대상이다.
```

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md
git commit -m "docs(product-import): v3 스펙 4단계 상태 갱신 + 계획 문서 링크"
```

---

## 최종 검증

전부 끝난 뒤 한 번에 돌린다.

- [ ] **단위 스펙 (임포트 범위)**

```bash
npx jest --testPathPattern=product-import 2>&1 | tail -20
```

기대: 전부 PASS.

- [ ] **통합 스펙 (실 Postgres 3종)**

```bash
DATABASE_URL="$DATABASE_URL" REQUIRE_PRODUCT_IMPORT_IMAGE_DB=1 \
  npx jest --testPathPattern=product-import-image-lane.integration 2>&1 | tail -20
DATABASE_URL="$DATABASE_URL" REQUIRE_PRODUCT_IMPORT_PROGRESS_DB=1 \
  npx jest --testPathPattern=product-import-progress.integration 2>&1 | tail -20
DATABASE_URL="$DATABASE_URL" REQUIRE_PRODUCT_IMPORT_LEASE_DB=1 \
  npx jest --testPathPattern=product-import-job-lease.integration 2>&1 | tail -20
```

기대: 전부 PASS. `skipped` 는 통과가 아니다.

**⛔ v3 2단계 통합테스트가 아직 미실행 상태로 남아 있다**(현황판 기록). 이번에 함께 돌려 그 부채를 정리한다 — 위 두 번째 명령이 그것이다.

- [ ] **타입 게이트**

```bash
npm run type-check:scoped
npx tsc -p apps/admin-web/tsconfig.json --noEmit 2>&1 | grep -E "product-import|validate-step" | head
```

기대: core 성공, admin-web 에서 **우리가 만든** error 0건.

- [ ] **변경 파일 lint 차분**

```bash
npx eslint $(git diff --name-only origin/develop -- '*.ts' '*.tsx')
```

전역 `npm run lint` 는 `--fix` 가 붙어 있고 레포 상시 debt 라 쓰지 않는다. 위 출력에서 **우리가 만든 error** 만 본다.

- [ ] **수동 스모크 (dev) — 정상 경로**

1. `npm run start:main:dev` + `npm run start:admin-web:dev`
2. `GET /product-imports/template` 로 템플릿을 받아 `Images` 시트에 **실제로 도달 가능한** 이미지 URL 3~5개를 채운다(공개 CDN 이면 무엇이든 좋다). Products 한 행에 `thumbnailImageKey`·`additionalImageKeys`·본문 디렉티브를 모두 쓴다.
3. 프리뷰(`/validate`): **이미지** 컬럼에 참조 수가 뜨는지 확인한다.
4. 커밋 → 세션 상세에서 확인할 것:
   - 진행률 패널에 **이미지 점검 → 이미지 업로드 → 상품 생성 → 게시** 4단계가 뜬다.
   - 이미지 점검이 끝나기 전까지 **상품 생성은 `대기`** 다(커밋 레인 게이트가 동작한다).
   - 이미지 업로드가 끝나면 상품 생성이 자동으로 시작된다.
5. 생성된 상품 상세를 열어 **대표 이미지·부가 이미지·본문 이미지**가 전부 보이는지 확인한다. 본문은 `::product-image{fileId="…"}` 로 치환돼 있어야 한다(워크북의 `imageKey` 가 남아 있으면 치환이 안 된 것이다).
6. file-service DB 에서 `SELECT uploaded_by, context_id FROM uploads ORDER BY created_at DESC LIMIT 5` — `uploaded_by` 가 **워크북을 올린 관리자 uuid** 이고 `context_id` 가 `product-image`/`product-description-image` 로 갈려 있어야 한다. **`uploaded_by` 가 NULL 이거나 엉뚱한 값이면 토큰 클레임이 안 먹은 것이다** (Task 7 의 함정).

- [ ] **수동 스모크 (dev) — 실패 경로**

1. `Images` 시트에 **죽은 URL** 하나(예: `https://example.invalid/x.jpg`)를 넣고, 그 키를 한 상품의 `thumbnailImageKey` 로 쓴다.
2. 확인할 것:
   - 이미지 점검 단계의 **실패 수**가 1 올라간다.
   - 그 URL 은 fetch 분모에 들어가지 않는다(이미지 업로드 단계의 `total` 이 그만큼 작다).
   - 그 키를 참조한 상품 행이 `실패` 로 뜨고, 오류 메시지에 **imageKey 와 사유**가 함께 보인다.
   - 다른 상품 행은 정상 생성된다.

- [ ] **수동 스모크 (dev) — SSRF 가드**

`Images` 시트에 `http://169.254.169.254/latest/meta-data/` 를 넣고 커밋한다.

기대: 그 행이 `이미지 점검` 단계에서 실패하고 오류 메시지에 **"사설·링크로컬 주소는 차단됩니다"** 가 뜬다. **네트워크로 요청이 나가지 않아야 한다** — 서버 로그에 타임아웃이 아니라 즉시 차단이 찍힌다.

- [ ] **수동 스모크 (dev) — 취소 + 이미지 정리**

1. 이미지 20장 이상짜리 워크북을 커밋한다(슬라이스 20 × 틱 5초 → 취소 창이 열린다).
2. **이미지 업로드 중**에 `작업 취소`.
3. 확인할 것:
   - 진행률의 이미지 단계가 `취소됨` 으로 바뀌고 폴링이 멈춘다.
   - 상품 생성은 시작되지 않았다(커밋 레인이 `idle` 로 남아 있었다).
   - 서버 로그에 `임포트 세션이 취소돼 이미지 슬라이스를 중단한다` + `취소 세션 이미지 정리 완료 (…, 총 N건, 실패 0건)`.
   - file-service DB 에서 그 세션이 올린 파일들이 `status='deleted'` 다.
   - 이후 워커 틱이 이 세션을 다시 집지 않는다.

- [ ] **회귀 — 이미지 없는 워크북**

`Images` 시트를 지운 워크북(= 3단계까지의 워크북)을 그대로 올려 **기존과 똑같이** 동작하는지 본다.

- 프리뷰 이미지 컬럼이 `0`.
- 커밋 즉시 `상품 생성` 이 시작된다(이미지 단계가 화면에서 접힌다).
- 진행률 패널이 지금처럼 2단계로 보인다.

- [ ] **회귀 — 마이그레이션 이전 세션**

```sql
SELECT id, image_status, commit_status FROM product_import_sessions ORDER BY created_at LIMIT 5;
```

기대: 전부 `image_status='completed'`. 하나라도 `queued` 면 DEFAULT 가 틀린 것이고, 그 세션들은 영원히 이미지 레인에 갇힌다.

## 배포 선행조건

- **마이그레이션 1건, 전부 additive → `migrate` → `deploy` 순서** (ADR-0005 §5 expand phase). 순서를 뒤집으면 새 컬럼·테이블을 읽는 새 코드가 스키마보다 먼저 떠서 깨진다. contract phase 의 `deploy → migrate` 와 **반대**다.

```bash
npm run db:migrate -- --stage live --deployment lcnine-services --yes
# 그 다음에
sst deploy --stage live
```

- **신규 시크릿 없음.** Core live env 에 `AUTH_SECRET`·`FILE_SERVICE_URL` 이 이미 있다.
- **신규 env 3건은 전부 기본값이 있어 설정하지 않아도 된다.** 기본값이 곧 권장값이다: `PRODUCT_IMPORT_IMAGE_SLICE=20`, `PRODUCT_IMPORT_IMAGE_FETCH_TIMEOUT_MS=15000`, `PRODUCT_IMPORT_IMAGE_MAX_BYTES=20971520`.
- **`PRODUCT_IMPORT_WORKER_ENABLED=false` 킬스위치가 그대로 유효하다** — 이미지 레인도 같은 워커에 붙으므로 함께 멈춘다.
- **admin-web 은 core 와 같은 `sst deploy` 에 실린다.** 미러 타입의 신규 필드를 전부 `?` 로 둔 이유가 롤링 창 대비다 — 롤백할 때는 **admin-web 먼저** 되돌린다.
- **배포 후 확인**

```sql
-- 옛 세션이 이미지 레인에 갇히지 않았는가 (가장 중요)
SELECT image_status, count(*) FROM product_import_sessions GROUP BY 1;
-- 이미지 테이블은 아직 비어 있어야 한다
SELECT count(*) FROM product_import_images;
```

기대: `image_status` 는 전부 `completed`, `product_import_images` 는 0행.

- **NAT 를 지켜본다.** 첫 대량 워크북(수백 장 이상)을 올릴 때 NAT 인스턴스의 `NetworkOut` 을 본다. 느리다는 판단이 나오면 **올려야 할 것은 `PRODUCT_IMPORT_IMAGE_SLICE` 가 아니라 NAT 인스턴스 타입**이다(`deployments/lcnine/platform/infra/shared.ts:22`). 슬라이스를 올리면 같은 NAT 에 더 몰릴 뿐이고, 고정 EIP 라 소싱처 rate-limit 에 먼저 걸린다.

## 범위 밖 (이 계획에서 하지 않는 것)

- **로컬 파일 업로드(드롭존)** — 시트 모양을 바꾸지 않고 나중에 얹을 수 있다. 그때 `Images` 에 `fileName` 컬럼이 붙고 `sourceUrl` 과 배타 관계가 된다 (스펙 §3.2 초입).
- **태그 임포트**, **옵션값별 색상/이미지/정렬**, **기존 상품 upsert**, **카테고리 신규 생성**, **`descriptionHtml`·`shippingMethodId`·`supplierId`** (스펙 §4).
- **DNS 재바인딩 방어** (스펙 §3.2.3 — 판단 3).
- **file-service 전역 고아 파일 정리 잡** (스펙 §2.8). 이 계획은 취소 경로에서만 정리한다.
- **draft 자동 삭제** (스펙 §3.4.1).
- **InboxWorker 배치 claim (v2 5단계)** — 이벤트 발행량은 이번에 바뀌지 않는다.
- **v2 2단계 리뷰 지적 ③군 5건**, **phantom masterId**, **조합 variant 매칭 누락**, **판매기간 admin 편집 UI**, **varchar 길이 검증 공백** (스펙 §5 — 전부 별건).

## Self-Review

계획 작성 후 스펙과 대조한 결과. 남은 판단은 아래 셋이다.

**1. 스펙 §3.3 의 "레인 3개" 와 실제 구현.** 스펙은 `image → commit → publish` 로 적었고 계획도 그대로다. 다만 스펙이 명시하지 않은 것 하나를 계획이 정했다 — **커밋 레인을 `commit_status='idle'` 로 게이트하는 것**. claim 이 레인별로 독립이라 게이트가 없으면 이미지가 pending 인 세션을 커밋 레인이 같은 틱에 집는다. `publish_status` 가 이미 같은 이유로 `'idle'` 로 시작하므로 선례를 따랐다(Task 8).

**2. 스펙 §3.5 의 progress 예시는 `error` 필드를 안 보여준다.** 2단계 구현이 이미 단계마다 `error` 를 싣고 있고, `visibleStages` 가 분모 0 이어도 `error !== null` 이면 접지 않는다. 그래서 이미지 레인 오류를 **probe·fetch 두 단계 모두**에 실었다 — 한쪽에만 실으면 그 단계가 접힐 때 오류가 화면 어디에도 안 뜬다(Task 13).

**3. 스펙에 없는 결정 하나 — 참조 이미지 실패 시 행 실패.** 스펙 §3.2 는 이미지 실패의 상품 행 처리에 대해 침묵한다. 계획은 **행 실패**로 정했고 근거를 서두에 적었다. 반대 방향(부분 생성 + 경고)으로 바꾸려면 Task 11 의 `unresolvedImageError` 호출 한 곳만 고치면 되므로 되돌리기 싸다 — 그래서 이 자리를 한 곳으로 모았다.

**타입 일관성 확인** — 태스크 간에 이름이 어긋나지 않는지 훑었다:

| 이름 | 정의 | 소비 |
|---|---|---|
| `ProductImageUsage` | Task 3 (`import.types.ts`) | Task 4·7·9 |
| `ImageSourceRef` | Task 3 | Task 4(생성)·8(dedup) |
| `SessionImageMap` / `EMPTY_SESSION_IMAGES` | Task 3 | Task 9(생성)·11(소비) |
| `SessionImageRow` / `SessionImageIndex` | Task 9 | Task 9(reader)·11(job.manager)·15 |
| `indexSessionImages` / `unresolvedImageError` | Task 9 | Task 11·15 |
| `extractDirectiveImageKeys` / `replaceDirectiveImageKeys` | Task 2 | Task 4 / Task 11 |
| `assertPublicHttpUrl` / `isBlockedIp` | Task 5 | Task 6 |
| `IMAGE_CONTEXT_BY_USAGE` / `MAX_BYTES_BY_USAGE` | Task 7 | Task 10 |
| `ImportImageStatusCount` | Task 13 (builder) | Task 13 (reader) |
| `createFromRecord(record, userId, tx, images)` | Task 11 | Task 11 (job.manager) |
| `recordJobError(id, 'image'\|'commit'\|'publish', msg)` | Task 10 | Task 10 (worker) |
| `build(session, itemCounts, imageCounts)` | Task 13 | Task 13 (service)·15 |

**시그니처가 바뀌어 기존 호출부를 깨는 지점 3곳** — 각 태스크가 그 수정을 함께 담고 있다:

1. `ProductImportJobManager` 생성자 +2 (Task 10)
2. `createFromRecord` +1 인자 (Task 11)
3. `ProgressBuilder.build` +1 인자, `getProgressCounts` 반환 +1 (Task 13)

**`ParsedWorkbook` 에 필수 필드가 하나 늘어(Task 3) 목 워크북을 만드는 모든 스펙이 깨진다** — Task 3 Step 5 가 그 수정을 명시한다. 반면 **`ProductRecord` 신규 필드는 전부 `?`** 라 `ProductRecord` 리터럴을 만드는 스펙은 안 깨진다(그리고 `isProductRecord` 가드를 확장하지 않아 롤링 배포 중 옛 payload 도 안전하다).
