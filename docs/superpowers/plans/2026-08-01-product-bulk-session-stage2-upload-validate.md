# 상품 일괄 세션 2단계 — 업로드 · 검증 레인 · 프리뷰 · 충돌 해소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1단계가 만든 프리필 양식을 작업자가 고쳐 올리면, 워커가 파싱·검증하고 **다운로드 시점 스냅샷 / 내가 올린 값 / 현재 active** 3자를 비교해 "무엇이 바뀌는가"와 "무엇이 남의 수정과 충돌하는가"를 행별로 확정한 뒤, 사람이 프리뷰에서 확인하고 충돌을 필드 단위로 결정해 승인하는 데까지 간다.

**Architecture:** 업로드는 202 로 접수하고(파싱·검증이 ALB 60초를 넘는다) `product_bulk_sessions` 행을 만든다. `@Cron` 워커가 `SKIP LOCKED` + uuid 펜싱 토큰 CAS 로 세션을 클레임해 **파싱 슬라이스 1회 + 검증 슬라이스 N회**를 돈다. 세션 상태는 `phase` 컬럼 **하나**뿐이다(스펙 §3.2). 비교의 핵심은 세 상태를 전부 **같은 렌더러로 만든 `Record<필드경로, 문자열>` 평면 맵**으로 눕혀, diff·충돌 판정을 순수 문자열 비교 한 곳에 모으는 것이다.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), exceljs, `@nestjs/schedule`, Jest

---

## Global Constraints

- 레이어 규칙: Controller → Service(2-3줄 포트) → Manager/Reader → DB. Controller 는 Repository 를 직접 부르지 않고, Service 는 `HttpException`·drizzle·Express 타입을 임포트하지 않는다.
- 도메인 예외는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError` 를 던진다. `GlobalExceptionFilter` 가 상태코드로 매핑한다.
- 트랜잭션 전파: 공개 메서드는 `tx?: DbTransaction` 을 마지막 인자로, private 헬퍼는 `tx: DbTransaction` 을 필수로. `this.db.run(async (trx) => {...}, tx)` 만 쓰고 per-class `inTx` 헬퍼를 만들지 않는다 (ADR-0025).
- DB 주입은 `@InjectDb() private readonly db: DbService<PimSchema>`. `@Inject('DB')` 금지.
- 쿼리는 `trx.select().from().innerJoin().where()` 형태. `db.query.*`·`with` relations 금지. `any`/`as` 캐스팅은 **근거를 주석으로 남긴 경우에만**. 이 계획에서 허용된 사용처는 **둘뿐**이다: (1) Task 9 의 `trx.execute` 반환 좁히기(1단계 `form-export-job.manager.ts:97` 과 같은 선례·같은 주석), (2) Task 4 의 exceljs `xlsx.load` 호출부 타입 재선언(`product-import.parser.ts:50-61` 에 근거가 적힌 기존 우회 — exceljs 의 앰비언트 Buffer shim 이 `@types/node` 와 병합돼 값 쪽 캐스팅으로는 못 푼다). 그 밖의 캐스팅은 리뷰에서 결함으로 다룬다.
- **소유권 검사는 존재 검사와 같은 `NotFoundError` 로 합친다** — 1단계 `form-export.manager.ts:48-55` 가 세운 이 모듈의 관례이고, 근거(존재 여부 오라클 차단)와 선례(`library/services/ownership.service.ts:365-368`)가 거기 적혀 있다.
- jsonb 에 `Date` 를 담지 않는다. 모든 스냅샷·payload 값은 **문자열**이다(스펙 §3.11 설계 노트, v3 3단계에서 실제로 밟은 함정).
- 진행률은 카운터 컬럼이 아니라 **매번 집계**한다(`GROUP BY status`). 워커가 중단돼도 드리프트하지 않는다.
- 마이그레이션은 `npm run db:generate:core -- --name <kebab-description>` 로 만들고 SQL 을 눈으로 확인한다. 이미 적용된 마이그레이션을 손으로 고치지 않는다.
- 검증 게이트: `npm run type-check:scoped` exit 0, 변경 파일 기준 신규 lint error 0. **전역 `npx jest`·전역 `tsc`·`nest build core` 는 develop 에서도 red 이므로 "전체 그린"으로 판정하지 않는다** — 변경 파일 차분으로만 본다.
- 통합 테스트는 **scratch DB** 에 대고 돈다. `dev_core` 에 마이그레이션을 돌리거나 행을 남기지 않는다(1단계 검증 보고서 Part A.2 방식).
- 이 단계의 마이그레이션은 **전부 additive** → ADR-0005 §5 expand phase = `migrate` → `deploy` 순서.
- 브랜치는 `feat/product-bulk-session-stage2` 이고 **`feat/product-bulk-session-stage1` 위에 스택**돼 있다(1단계가 아직 develop 에 없다). 1단계 브랜치가 더 움직이면 이 브랜치를 rebase 한다.

---

## 착수 전 확정된 사실 (읽고 시작할 것)

### F1. 스펙 §6 의 전제는 **거짓이다** — 스냅샷을 값으로 저장한다 (사용자 결정, 2026-08-01)

스펙 §3.1 은 "스냅샷은 `(masterId, versionId)` 쌍만 기록하고 active 는 CoW 라 불변이므로 나중에 재구성한다"를 전제했고, §6 은 그 전제를 착수 전에 확인하라고 했다. **확인 결과 active 버전을 CoW 없이 직접 UPDATE 하는 경로가 실재한다:**

| 경로 | 인플레이스로 바뀌는 워크북 필드 |
|---|---|
| `product-versions.service.ts:653,688,735,755` (`updateMembershipPriceVisibility`·`updateMembersOnlyVisibility`·`updateOverseas`·`updateExposurePolicy`) | `isOverseas`, `isVisibleToMembersOnly`, `hideMembershipPriceForNonMembers` |
| `product-versions.service.ts:714` (`updateRequiresMembership`) | 구매제약 `requiresMembership` |
| `product-bulk.service.ts:94-98`·`:134` (기존 `mall/bulk` 화면) | **`brand`, `seller`** |

(가격 룰 `pricing.service.ts:replaceVersionRules`·`updateVersion`·옵션 표시는 `status !== 'draft'` 가드가 있어 안전하다.)

`versionId` 로 재구성한 "스냅샷"은 저 6개 필드에서 **이미 새 값**이라, (1) 충돌로 잡히지 않고 (2) 워크북의 옛 값이 남의 수정을 조용히 되돌린다 — §3.6 이 막으려던 실패 모드 그대로다.

**결정: 스펙 §6 이 예고한 분기를 탄다 — 스냅샷을 값으로 복사한다.** `product_form_export_items.snapshot jsonb` 를 additive 로 더하고, 1단계 조립 워커가 워크북에 실제로 찍은 프리필 행을 그대로 담는다(Task 2). 부수효과가 크다: `IMG-n` 키 할당·KST 날짜 서식·`|` 조인 같은 **렌더링 규약을 2단계가 재현할 필요가 사라진다**. 워크북 셀 문자열과 1:1로 비교하면 끝이다.

### F2. 세 상태를 같은 평면 맵으로 눕힌다

```
base    = export item 의 snapshot (다운로드 시점 워크북 셀)      ← Task 2
mine    = 업로드된 워크북 셀                                    ← Task 4·5
current = 지금 active 를 같은 렌더러로 다시 그린 셀             ← Task 2 의 renderMaster 재사용
```

셋 다 `flattenBundle()` 을 통과해 `Record<필드경로, 문자열>` 이 되고, 그 다음은 순수 문자열 비교다(Task 3).

```
변경분  = { k | mine[k] ≠ base[k] }                       ← payload
충돌    = { k | mine[k] ≠ base[k] ∧ current[k] ≠ base[k] ∧ current[k] ≠ mine[k] }
```

마지막 항(`current ≠ mine`)은 둘이 같은 값으로 바꾼 경우를 충돌에서 빼기 위한 것이다.

**`mine` 에는 업로드 시트에 실제로 존재한 열의 키만 담긴다.** 작업자가 열을 통째로 지우면 그 필드는 "변경 없음"이지 "비움"이 아니다 — 이 구분이 없으면 열 하나 삭제가 전 행의 그 필드를 날린다.

### F3. 이 단계가 하지 않는 것

admin-web(사용자 결정: core 백엔드만), 이미지 업로드·전량 게이트(3단계), draft 생성·`bulk_session_id` 잠금(4단계), 일괄 발행·취소 시 이미지/ draft 정리·실패 행 재시도(5단계), 옛 `product_import_*` 제거(6단계).

`phase` enum 에는 4·5단계 값(`drafting`·`drafted`·`publishing`·`published`)을 **지금 전부 넣는다** — enum 값 추가는 뒤에 붙이는 것만 안전하고(`catalog.schema.ts:1096` 주석), 나중에 중간 삽입이 필요해지는 것보다 지금 다 넣는 편이 싸다. 2단계가 만드는 phase 는 `uploaded`→`validating`→`review`→(`awaiting_images`|`drafting`)와 `canceled`·`failed` 까지다.

### F4. 스펙 §3.11 대비 컬럼 3개가 다르다 (의도된 차이)

| 컬럼 | 스펙 | 이 계획 | 이유 |
|---|---|---|---|
| `product_bulk_items.input` | 없음 | **추가** | 업로드 원본(정규화 후)을 불변으로 남긴다. `payload` 는 검증이 만드는 *변경분*이라 shape 이 다르다 — 한 컬럼에 두 shape 을 넣는 것이 v3 `isProductRecord` 가드 같은 부채를 낳는다. 재검증도 파일 재파싱 없이 된다. |
| `product_bulk_items.base_snapshot` | 없음 (`base_version_id` 만) | **추가** | F1. 그리고 세션을 양식 잡의 30일 만료로부터 독립시킨다 — 파싱 시점에 export item 에서 복사해 온다. |
| `product_bulk_items` 검증 완료 표시 | 없음 | **`payload IS NULL` 로 대신** | 컬럼을 늘리지 않는다. 검증이 끝난 행은 `{}`(변경 없음)라도 non-null 이 된다. 이 불변식은 Task 9 의 테스트가 못 박는다. |

---

## File Structure

**신규** (전부 `apps/core/src/modules/catalog/operations/bulk-session/` 아래)

| 파일 | 책임 |
|---|---|
| `bulk-session.controller.ts` | `POST /product-bulk-sessions` 외 6개 라우트 |
| `dto/create-bulk-session.dto.ts` | 업로드 요청(name) |
| `dto/bulk-session-response.dto.ts` | 접수 202 · 진행 · 아이템 목록 응답 |
| `dto/conflict-decision.dto.ts` | 필드별 충돌 결정 요청 |
| `services/bulk-session.types.ts` | 세션 도메인 타입(평면 맵·충돌·payload) + jsonb 가드 |
| `services/bulk-session.fields.ts` | 번들 → 평면 맵, 필드경로 ↔ 한국어 라벨 (순수) |
| `services/bulk-session.diff.ts` | 3-way diff·충돌 판정 (순수) |
| `services/bulk-upload.parser.ts` | xlsx → 시트별 행 + 존재 열 집합 + 파일 오류 (순수) |
| `services/bulk-upload.assembler.ts` | 상품키로 시트 접합 + create/update 분류 (순수) |
| `services/bulk-session.validator.ts` | 필드 검증 — 길이·열거·숫자·날짜·가격 센티넬 (순수) |
| `services/bulk-session.structure.ts` | 옵션 구조 불변·이미지 용도 추론·카테고리 경로 역해석 (순수) |
| `services/bulk-session.manager.ts` | 접수·결정·승인·취소 (DB 쓰기) |
| `services/bulk-session.reader.ts` | 진행 집계·아이템 목록 (DB 읽기) |
| `services/bulk-session-job.manager.ts` | claim / lease / 파싱 슬라이스 / 검증 슬라이스 |
| `services/bulk-session-job.worker.ts` | `@Cron` 틱 |
| `services/bulk-session.service.ts` | 포트 (2-3줄) |

**수정**

| 파일 | 내용 |
|---|---|
| `apps/core/src/modules/catalog/schema/catalog.schema.ts` | enum 7 + 테이블 3 + `product_form_export_items.snapshot` |
| `services/form-export.types.ts` | `PrefillBundle`·`ImageKeyAllocator` 추가 |
| `services/form-export.snapshot.reader.ts` | 상품 1건 렌더를 `renderMaster()` 로 추출, 이미지 키 할당기 주입식으로 |
| `services/form-export-job.manager.ts` | items 에 `snapshot` 저장 |
| `services/form-export-file.client.ts` | `download(fileId, userId): Promise<Buffer>` 추가 |
| `bulk-session.module.ts` | 신규 프로바이더·컨트롤러 배선 |
| `package.json` | `test:bulk-session:integration` 스크립트 |

**분해 원칙:** DB 를 타는 것(manager·reader·job manager)과 순수한 것(fields·diff·parser·assembler·validator·structure)을 가른다. 이 단계의 위험은 전부 순수 쪽에 있다 — 3-way 판정이 틀리면 남의 수정이 조용히 사라지는데, 그건 실 Postgres 없이 전량 테스트할 수 있는 종류의 로직이다.

---

### Task 1: 스키마와 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts`
- Create: `apps/core/drizzle/<timestamp>_product-bulk-sessions.sql` (생성물)

**Interfaces:**
- Consumes: 1단계의 `productFormExports`·`productFormExportItems`
- Produces: `productBulkSessions`·`productBulkItems`·`productBulkImages` 테이블 객체, enum 7개, `productFormExportItems.snapshot` 컬럼. 이후 모든 태스크가 `from '../../../schema/catalog.schema'` 로 임포트한다.

- [ ] **Step 1: enum·테이블·컬럼을 스키마에 추가**

`productFormExportItems` 정의 안, `pricingEditable` 아래에 컬럼 하나를 더한다:

```ts
    /**
     * 양식에 실제로 찍은 프리필 행 전량(`PrefillBundle`). **nullable 이다.**
     *
     * 값으로 복사하는 이유: active 버전이 CoW 없이 직접 UPDATE 되는 경로가 실재해서
     * (product-versions.service.ts 의 updateExposurePolicy 계열, product-bulk.service.ts
     * 의 bulkUpdate 가 brand·seller 를 active 행에 바로 쓴다) versionId 만으로는 다운로드
     * 시점 값을 되살릴 수 없다 — 되살렸다고 믿고 비교하면 남의 수정이 충돌로 잡히지 않고
     * 조용히 되돌아간다(설계 스펙 §6 이 예고한 분기).
     *
     * NULL 인 행은 이 컬럼 이전에 만들어진 양식이다. 2단계 업로드는 그런 export 를
     * **거부**한다 — 스냅샷 없이 수정 경로를 태우는 것이 정확히 위 사고다.
     */
    snapshot: jsonb('snapshot'),
```

파일 끝 `productImportImages` 정의 다음에 2단계 블록을 통째로 추가한다:

```ts
// ===== PRODUCT BULK SESSIONS (일괄 세션 2단계 — 업로드·검증) =====

/**
 * 세션 상태는 이 컬럼 **하나**다. v3 는 image/commit/publish 3개를 뒀는데, 조합 대부분이
 * "있어서는 안 되는 상태"였고 v3 4단계 최종 리뷰가 잡은 Critical 버그가 정확히 그 종류였다
 * (image_status='failed' + commit_status='idle' 이 막다른 길이 되어 취소도 409 를 받았다).
 *
 * 4·5단계 값(drafting·drafted·publishing·published)을 지금 전부 넣는다 — enum 값은 **맨 뒤에**
 * 붙이는 것만 안전한데(productImportSessionStatusEnum 주석 참조), 나중에 중간 삽입이
 * 필요해지는 것보다 지금 다 넣는 편이 싸다.
 */
export const productBulkSessionPhaseEnum = pgEnum('product_bulk_session_phase', [
  'uploaded',
  'validating',
  'review',
  'awaiting_images',
  'drafting',
  'drafted',
  'publishing',
  'published',
  'canceled',
  'failed',
]);

export const productBulkItemKindEnum = pgEnum('product_bulk_item_kind', ['create', 'update']);

/**
 * 'invalid'(검증 실패)와 'failed'(생성 실패)를 나눈다 — v3 는 둘 다 'failed' 로 적어
 * invalid_count 를 얼려 뺄셈해야 했다(설계 스펙 §2.8). 새 테이블이라 기존 데이터가 없다.
 */
export const productBulkItemStatusEnum = pgEnum('product_bulk_item_status', [
  'pending',
  'invalid',
  'drafted',
  'excluded',
  'failed',
]);

export const productBulkItemPublishStatusEnum = pgEnum('product_bulk_item_publish_status', [
  'idle',
  'pending',
  'published',
  'failed',
]);

export const productBulkImageUsageEnum = pgEnum('product_bulk_image_usage', ['main', 'description']);
export const productBulkImageSourceKindEnum = pgEnum('product_bulk_image_source_kind', ['file_id', 'file_name']);
export const productBulkImageStatusEnum = pgEnum('product_bulk_image_status', ['resolved', 'awaiting_upload']);

export const productBulkSessions = pgTable(
  'product_bulk_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** 작업자가 붙인 이름. 비우면 업로드 파일명이 들어간다. */
    name: varchar('name', { length: 200 }).notNull(),
    /**
     * 이 세션의 근거가 된 양식 잡. NULL 이면 **신규 전용 세션**(빈 양식으로 올린 경우)이다.
     * 양식 잡은 30일 후 만료 삭제되므로 SET NULL 이다 — 세션이 그때 죽으면 안 된다.
     * 수정 판정에 필요한 것은 이미 items.base_snapshot 으로 복사돼 있다.
     */
    exportId: uuid('export_id').references(() => productFormExports.id, { onDelete: 'set null' }),
    uploadedBy: uuid('uploaded_by').notNull(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    /** 업로드된 원본 엑셀의 file-service fileId. 검증 레인이 이걸 다시 내려받아 파싱한다. */
    sourceFileId: uuid('source_file_id').notNull(),
    phase: productBulkSessionPhaseEnum('phase').notNull().default('uploaded'),
    phaseError: text('phase_error'),
    leaseUntil: timestamp('lease_until'),
    /** lease 소유권 펜싱 토큰. 타임스탬프로 소유권을 보려던 시도는 이 레포에서 세 번 깨졌다. */
    leaseToken: uuid('lease_token'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    cancelRequestedAt: timestamp('cancel_requested_at'),
    totalRows: integer('total_rows').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_bulk_sessions_claim').on(table.phase, table.leaseUntil),
    index('idx_bulk_sessions_uploaded_by').on(table.uploadedBy),
  ],
);

export const productBulkItems = pgTable(
  'product_bulk_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => productBulkSessions.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    /** 워크북 '상품키'. 이 키가 양식 잡의 items 에 있으면 수정, 없으면 신규다. */
    rowKey: varchar('row_key', { length: 100 }).notNull(),
    kind: productBulkItemKindEnum('kind').notNull(),
    /** update: 입력값(어느 상품을 고치는가) / create: 결과값(4단계가 채운다). kind 가 의미를 가른다. */
    masterId: uuid('master_id'),
    /** update 전용. 다운로드 시점의 active 버전. */
    baseVersionId: uuid('base_version_id'),
    /** update 전용. 양식 잡 items.snapshot 의 복사본 — 세션을 양식 만료로부터 독립시킨다. */
    baseSnapshot: jsonb('base_snapshot'),
    /** 업로드 워크북에서 읽은 정규화 입력. 불변 — 재검증이 여기서 다시 출발한다. */
    input: jsonb('input').notNull(),
    /**
     * 적용할 변경분. **NULL 이면 아직 검증 전이다** — 검증 슬라이스의 대상 판별에 쓴다.
     * 변경이 하나도 없는 수정 행도 검증 후엔 `{}` 라 non-null 이 된다.
     */
    payload: jsonb('payload'),
    status: productBulkItemStatusEnum('status').notNull().default('pending'),
    /** 충돌 필드경로 → { base, mine, current }. */
    conflict: jsonb('conflict'),
    /** 충돌 필드경로 → 'overwrite' | 'skip'. **행 단위가 아니다**(설계 스펙 §3.6). */
    conflictDecision: jsonb('conflict_decision'),
    draftVersionId: uuid('draft_version_id'),
    publishStatus: productBulkItemPublishStatusEnum('publish_status').notNull().default('idle'),
    errorMessage: text('error_message'),
    publishError: text('publish_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_bulk_items_session_row_key').on(table.sessionId, table.rowKey),
    index('idx_bulk_items_session_status').on(table.sessionId, table.status),
  ],
);

export const productBulkImages = pgTable(
  'product_bulk_images',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => productBulkSessions.id, { onDelete: 'cascade' }),
    imageKey: varchar('image_key', { length: 100 }).notNull(),
    /** 참조 지점이 정한다 — 대표·부가는 main, 본문 디렉티브는 description. */
    usage: productBulkImageUsageEnum('usage').notNull(),
    sourceKind: productBulkImageSourceKindEnum('source_kind').notNull(),
    /** fileId(UUID) 또는 작업자 로컬 파일명. 웹 URL 은 행 오류라 여기 오지 않는다. */
    sourceValue: text('source_value').notNull(),
    fileId: uuid('file_id'),
    status: productBulkImageStatusEnum('status').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_bulk_images_session_key_usage').on(table.sessionId, table.imageKey, table.usage),
    index('idx_bulk_images_session_status').on(table.sessionId, table.status),
  ],
);
```

`catalogSchema` 객체에 세 테이블을 추가한다(1단계가 `productFormExports`·`productFormExportItems` 를 더한 자리 바로 아래):

```ts
  productBulkSessions,
  productBulkItems,
  productBulkImages,
```

- [ ] **Step 2: 마이그레이션 생성**

```bash
npm run db:generate:core -- --name product-bulk-sessions
```

- [ ] **Step 3: 생성된 SQL 을 눈으로 확인**

`apps/core/drizzle/<timestamp>_product-bulk-sessions.sql` 을 열고 확인한다:
- `CREATE TYPE` 7개(전부 신규 enum — 기존 타입에 `ALTER TYPE ... ADD VALUE` 가 있으면 안 된다)
- `CREATE TABLE` 3개
- `ALTER TABLE "product_form_export_items" ADD COLUMN "snapshot" jsonb;` — **NOT NULL 이 붙으면 안 된다**
- `DROP` 문 0개

```bash
grep -ci "drop\|alter type" apps/core/drizzle/<timestamp>_product-bulk-sessions.sql   # 0 이어야 한다
```

- [ ] **Step 4: scratch DB 에 전체 체인 적용**

```bash
docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS bulk_stage2_scratch"
docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE bulk_stage2_scratch"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts
```
Expected: `[✓] migrations applied successfully!`

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle/
git commit -m "feat(bulk-session): 2단계 스키마 — 세션·아이템·이미지 테이블 + export 스냅샷 컬럼"
```

---

### Task 2: 양식 스냅샷을 값으로 저장 (1단계 리더 리팩터)

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.types.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.snapshot.reader.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.image-allocator.spec.ts` (신규)
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-snapshot.integration.spec.ts` (기존 확장)

**Interfaces:**
- Consumes: Task 1 의 `productFormExportItems.snapshot`
- Produces:
  - `interface PrefillBundle { product: PrefillRow; options: PrefillRow[]; variants: PrefillRow[]; categories: PrefillRow[]; constraint: PrefillRow | null; images: Record<string, string> }`
  - `interface ImageKeyAllocator { keyFor(fileId: string): string; entries(): Array<{ imageKey: string; fileId: string }> }`
  - `function createImageKeyAllocator(seed?: Record<string, string>): ImageKeyAllocator` — seed 는 `imageKey → fileId`
  - `FormExportSnapshotReader.renderMaster(tx: DbTransaction, masterId: string, images: ImageKeyAllocator, categoryPathById: Map<string, string>): Promise<(PrefillBundle & { versionId: string }) | null>`
  - `SnapshotItem` 에 `snapshot: PrefillBundle` 추가
  - **`export interface FlatCategory { id: string; path: string; isActive: boolean }`** 와 **`export function flattenCategoryTree(nodes: CategoryTreeNodeDto[]): FlatCategory[]`** — 지금은 리더 파일의 모듈 private 함수다. Task 7 의 경로 역해석과 Task 9 의 검증 슬라이스가 **같은 경로 문자열**을 만들어야 하므로 export 로 연다. 두 벌로 두면 양식이 적어준 경로를 업로드가 못 찾는다.

- [ ] **Step 1: 타입과 이미지 키 할당기를 만든다**

`form-export.types.ts` 에 추가:

```ts
/**
 * 상품 하나가 워크북에 만든 행 전량. 양식 잡이 이걸 그대로 스냅샷으로 저장하고(§6 대응),
 * 2단계가 '현재 active' 도 같은 shape 으로 다시 그려 비교한다.
 *
 * 값이 전부 문자열인 것이 핵심이다 — jsonb 왕복에서 타입이 변하지 않고, 비교가 문자열
 * 등호 하나로 끝나며, 워크북 셀과 1:1 이라 "무엇이 바뀌었나"가 사람이 본 것과 일치한다.
 */
export interface PrefillBundle {
  product: PrefillRow;
  options: PrefillRow[];
  variants: PrefillRow[];
  categories: PrefillRow[];
  /** 구매제약은 상품당 최대 1행이다. 없으면 null. */
  constraint: PrefillRow | null;
  /** 이 상품이 참조하는 imageKey → fileId. 2단계가 '현재' 렌더의 키 할당을 여기에 맞춘다. */
  images: Record<string, string>;
}

/**
 * fileId → imageKey 할당기. 이미지 시트는 워크북 **전역**이라 키도 전역으로 유일해야
 * 한다(같은 fileId 를 두 상품이 쓰면 키 하나로 합쳐진다 — 의도한 동작).
 *
 * 2단계가 '현재 active' 를 다시 그릴 때는 **스냅샷의 키 배정을 seed 로 넣는다**. 안 그러면
 * 안 바뀐 이미지가 IMG-1 부터 다시 번호를 받아 '대표이미지키' 셀이 항상 달라 보이고,
 * 이미지를 건드리지도 않은 행이 전부 충돌로 뜬다.
 */
export interface ImageKeyAllocator {
  keyFor(fileId: string): string;
  entries(): Array<{ imageKey: string; fileId: string }>;
}

export function createImageKeyAllocator(seed: Record<string, string> = {}): ImageKeyAllocator {
  const keyByFileId = new Map<string, string>();
  let maxIndex = 0;
  for (const [imageKey, fileId] of Object.entries(seed)) {
    keyByFileId.set(fileId, imageKey);
    // seed 된 키 번호 뒤에서 이어 붙인다 — IMG-3 이 있는데 새 키가 IMG-3 이 되면
    // 서로 다른 파일이 한 키를 가리켜 워크북이 스스로 모순된다.
    const parsed = Number.parseInt(imageKey.replace(/^IMG-/, ''), 10);
    if (Number.isInteger(parsed) && parsed > maxIndex) maxIndex = parsed;
  }
  return {
    keyFor(fileId: string): string {
      const existing = keyByFileId.get(fileId);
      if (existing) return existing;
      maxIndex += 1;
      const key = `IMG-${maxIndex}`;
      keyByFileId.set(fileId, key);
      return key;
    },
    entries(): Array<{ imageKey: string; fileId: string }> {
      return [...keyByFileId].map(([fileId, imageKey]) => ({ imageKey, fileId }));
    },
  };
}
```

- [ ] **Step 2: 할당기 테스트를 쓰고 실패를 확인한다**

`form-export.image-allocator.spec.ts`:

```ts
import { createImageKeyAllocator } from './form-export.types';

describe('createImageKeyAllocator', () => {
  it('처음 보는 fileId 마다 IMG-1 부터 번호를 준다', () => {
    const alloc = createImageKeyAllocator();
    expect(alloc.keyFor('f1')).toBe('IMG-1');
    expect(alloc.keyFor('f2')).toBe('IMG-2');
  });

  it('같은 fileId 는 같은 키를 돌려준다', () => {
    const alloc = createImageKeyAllocator();
    expect(alloc.keyFor('f1')).toBe('IMG-1');
    expect(alloc.keyFor('f1')).toBe('IMG-1');
  });

  it('seed 된 배정을 그대로 유지한다', () => {
    const alloc = createImageKeyAllocator({ 'IMG-3': 'f9' });
    expect(alloc.keyFor('f9')).toBe('IMG-3');
  });

  it('seed 의 최대 번호 뒤에서 새 키를 이어 붙인다', () => {
    const alloc = createImageKeyAllocator({ 'IMG-3': 'f9' });
    expect(alloc.keyFor('fnew')).toBe('IMG-4');
  });

  it('entries 는 할당된 전량을 (imageKey, fileId) 로 돌려준다', () => {
    const alloc = createImageKeyAllocator();
    alloc.keyFor('f1');
    alloc.keyFor('f2');
    expect(alloc.entries()).toEqual([
      { imageKey: 'IMG-1', fileId: 'f1' },
      { imageKey: 'IMG-2', fileId: 'f2' },
    ]);
  });
});
```

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.image-allocator.spec.ts
```
Expected: FAIL — `createImageKeyAllocator is not a function` (Step 1 을 먼저 했다면 통과한다. 순서를 지켜 테스트부터 쓰고 싶다면 Step 1·2 를 바꿔 실행한다.)

- [ ] **Step 3: 스냅샷 리더에서 상품 1건 렌더를 추출한다**

`form-export.snapshot.reader.ts` 의 `buildPrefill` 루프 몸통을 `renderMaster` 로 옮긴다. **바뀌는 것은 구조뿐이고 렌더 규약(문자열화·KST 날짜·`|` 조인·정렬된 combination)은 한 글자도 바꾸지 않는다** — 그 규약이 곧 비교 기준이다.

```ts
  /**
   * 상품 하나의 현재 active 를 워크북 행 shape 으로 그린다. active 가 없으면 null.
   *
   * `buildPrefill`(양식 조립)과 2단계의 '현재 active 다시 그리기'가 **같은 함수**를 쓴다 —
   * 두 벌로 두면 한쪽만 바뀌는 순간 안 바뀐 필드가 전부 변경으로 보이고, 그건 조용한
   * 오탐이라 눈치채기까지 오래 걸린다.
   *
   * rowKey 는 여기서 채우지 않는다 — 그건 양식 전체를 도는 호출자의 관심사다.
   */
  async renderMaster(
    tx: DbTransaction,
    masterId: string,
    images: ImageKeyAllocator,
    categoryPathById: Map<string, string>,
  ): Promise<PrefillBundle | null> {
    const version = await this.versionLoader.getActiveVersion(tx, masterId).catch((err: unknown) => {
      if (err instanceof NotFoundException) return null;
      throw err;
    });
    if (!version) return null;

    const rules = await this.pricing.getVersionRules(version.id, tx);
    const pricingEditable = isPricingEditable(rules);
    const prices: SimplePrices = pricingEditable
      ? extractSimplePrices(rules)
      : { basePrice: null, membershipPrice: null, variantOverrides: new Map() };

    const versionImages = await this.versionLoader.getImages(tx, version.id);
    const primaryImage = versionImages.find((img) => img.isPrimary) ?? null;
    const additionalImages = versionImages.filter((img) => !img.isPrimary);
    const usedImages: Record<string, string> = {};
    const keyFor = (fileId: string): string => {
      const key = images.keyFor(fileId);
      usedImages[key] = fileId;
      return key;
    };
    const thumbnailImageKey = primaryImage ? keyFor(primaryImage.fileId) : '';
    const additionalImageKeys = additionalImages.map((img) => keyFor(img.fileId)).join('|');

    // 아래 네 덩어리는 **현재 form-export.snapshot.reader.ts 의 본문을 그대로 옮긴 것**이다.
    // 옮기면서 바꾸는 것은 단 하나 — 각 행에서 `rowKey` 키를 뺀다(호출자가 붙인다).
    //   product     ← 현재 :157-189 의 products.push({...}) 본문
    //   options     ← 현재 :191-205 의 groups 이중 루프
    //   variants    ← 현재 :207-231 의 versionVariants 루프 (combination 정렬·조합명 포함)
    //   categories  ← 현재 :232-241 의 versionCategories 루프
    //   constraint  ← 현재 :243-250 의 getPurchaseConstraint (없으면 null)
    // 값 하나라도 다르게 만들면 그 필드가 2단계에서 영구 오탐이 된다.
    const product: PrefillRow = { name: str(version.name), /* …이하 그대로… */ };
    const options: PrefillRow[] = [];
    const variants: PrefillRow[] = [];
    const categories: PrefillRow[] = [];
    let constraint: PrefillRow | null = null;

    return { versionId: version.id, product, options, variants, categories, constraint, images: usedImages };
  }
```

`buildPrefill` 은 이렇게 얇아진다:

```ts
    const allocator = createImageKeyAllocator();
    let seq = 0;
    for (const masterId of masterIds) {
      const bundle = await this.renderMaster(tx, masterId, allocator, categoryPathById);
      if (!bundle) continue;

      seq += 1;
      const rowKey = `P-${String(seq).padStart(6, '0')}`;

      products.push({ rowKey, ...bundle.product });
      for (const row of bundle.options) options.push({ rowKey, ...row });
      for (const row of bundle.variants) variants.push({ rowKey, ...row });
      for (const row of bundle.categories) categories.push({ rowKey, ...row });
      if (bundle.constraint) constraints.push({ rowKey, ...bundle.constraint });

      // pricingEditable 은 번들의 판매가 셀이 센티넬인지로 되읽는다 — 판정 로직을 두 벌
      // 두지 않기 위해서다(리더 안에서 이미 한 번 판정했다).
      const pricingEditable = bundle.product.basePrice !== PRICING_SENTINEL;
      items.push({ masterId, versionId: bundle.versionId, rowKey, pricingEditable, snapshot: bundle });
    }

    // 이미지 시트는 잡 전체가 공유하는 할당 결과 하나로 만든다.
    for (const { imageKey, fileId } of allocator.entries()) images.push({ imageKey, sourceValue: fileId });
```

> `renderMaster` 는 `versionId` 도 돌려줘야 한다(`SnapshotItem.versionId`). 반환 타입을 `PrefillBundle & { versionId: string }` 으로 두고, jsonb 로 저장할 때는 `versionId` 를 포함해도 무해하다 — 2단계는 `base_version_id` 컬럼을 쓰고 번들의 그 필드는 읽지 않는다.

- [ ] **Step 4: 잡 매니저가 snapshot 을 저장하게 한다**

`form-export-job.manager.ts` 의 items insert 는 `SnapshotItem` 을 그대로 펼치므로 **코드 변경이 없다**(`snapshot` 이 필드로 들어와 자동으로 컬럼에 매핑된다). 다만 `SnapshotItem` 타입에 `snapshot: PrefillBundle` 이 추가됐는지, insert 가 타입 에러 없이 컴파일되는지 `npm run type-check:scoped` 로 확인한다.

- [ ] **Step 5: 통합 테스트를 확장한다**

`form-export-snapshot.integration.spec.ts` 에 케이스를 더한다:

```ts
  it('items.snapshot 에 워크북에 찍힌 것과 같은 행이 담긴다', async () => {
    const { data, items } = await reader.buildPrefill(trx, [masterId], exportId);
    const item = items[0];
    expect(item.snapshot.product.name).toBe(data.products[0].name);
    expect(item.snapshot.product.basePrice).toBe(data.products[0].basePrice);
    // 워크북 행에는 rowKey 가 있고 스냅샷에는 없다 — 그 하나만 다르다.
    expect(item.snapshot.product.rowKey).toBeUndefined();
  });

  it('snapshot.images 는 그 상품이 참조하는 키만 담는다', async () => {
    const { items } = await reader.buildPrefill(trx, [masterIdA, masterIdB], exportId);
    const a = items.find((i) => i.masterId === masterIdA)!;
    expect(Object.keys(a.snapshot.images)).toEqual([a.snapshot.product.thumbnailImageKey]);
  });

  it('renderMaster 를 seed 된 할당기로 다시 부르면 같은 이미지 키가 나온다', async () => {
    const { items } = await reader.buildPrefill(trx, [masterId], exportId);
    const snapshot = items[0].snapshot;
    const again = await reader.renderMaster(trx, masterId, createImageKeyAllocator(snapshot.images), pathIndex);
    expect(again!.product.thumbnailImageKey).toBe(snapshot.product.thumbnailImageKey);
    expect(again!.product.additionalImageKeys).toBe(snapshot.product.additionalImageKeys);
  });
```

- [ ] **Step 6: 테스트와 게이트**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" npm run test:form-export:integration
npm run type-check:scoped
```
Expected: 전부 통과, exit 0.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/
git commit -m "feat(bulk-session): 양식 스냅샷을 값으로 저장 + 상품 1건 렌더 추출"
```

---

### Task 3: 평면 필드맵과 3-way diff (순수)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.types.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.fields.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.diff.ts`
- Test: `.../services/bulk-session.fields.spec.ts`
- Test: `.../services/bulk-session.diff.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `PrefillBundle`, 1단계의 `PRODUCT_COLUMNS`·`OPTION_COLUMNS`·`VARIANT_COLUMNS`·`CATEGORY_COLUMNS`·`CONSTRAINT_COLUMNS`
- Produces:
  - `type FlatFields = Record<string, string>`
  - `type ConflictMap = Record<string, { base: string; mine: string; current: string }>`
  - `type ConflictDecisionMap = Record<string, 'overwrite' | 'skip'>`
  - `type UploadedBundle = Pick<PrefillBundle, 'product'|'options'|'variants'|'categories'|'constraint'>`
  - `interface PresentColumns { products: Set<string>; options: Set<string>; variants: Set<string>; categories: Set<string>; constraints: Set<string> }`
  - `interface RowError { sheet: '상품'|'옵션'|'조합'|'카테고리'|'구매제약'|'이미지'; rowNumber: number; message: string }`
  - `interface BulkItemInput`·`interface BulkItemPayload` + 가드 `isBulkItemInput`·`isBulkItemPayload`·`isPrefillBundle`, 변환기 `toPresentColumns`
  - `function flattenBundle(bundle: UploadedBundle, present?: PresentColumns): FlatFields`
  - `function fieldLabel(path: string): string`
  - `function computeChanges(base: FlatFields, mine: FlatFields): FlatFields`
  - `function detectConflicts(base: FlatFields, mine: FlatFields, current: FlatFields): ConflictMap`
  - `function applyDecisions(changes: FlatFields, decisions: Record<string, string>): FlatFields`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-session.fields.spec.ts`:

```ts
import { flattenBundle, fieldLabel } from './bulk-session.fields';

const bundle = () => ({
  product: { name: '티셔츠', basePrice: '19000', brand: 'ACME', membershipPrice: '' },
  options: [
    { optionKey: 'og1', optionName: '색상', optionSortOrder: '1', optionValueKey: 'ov1', optionValueName: '빨강', colorCode: '#f00', valueSortOrder: '1' },
    { optionKey: 'og1', optionName: '색상', optionSortOrder: '1', optionValueKey: 'ov2', optionValueName: '파랑', colorCode: '#00f', valueSortOrder: '2' },
  ],
  variants: [{ combination: 'ov1', basePrice: '19000', membershipPrice: '', variantCode: 'V-1' }],
  categories: [
    { categoryPath: '여성패션>티셔츠', isPrimary: 'Y' },
    { categoryPath: '신상품', isPrimary: 'N' },
  ],
  constraint: { requiresMembership: 'N', lifetimeQuantityLimit: '3' },
});

describe('flattenBundle', () => {
  it('상품 스칼라를 product.<key> 로 눕힌다', () => {
    const flat = flattenBundle(bundle());
    expect(flat['product.name']).toBe('티셔츠');
    expect(flat['product.brand']).toBe('ACME');
  });

  it('빈 셀도 빈 문자열로 담는다 (없는 것과 구분하지 않는다)', () => {
    expect(flattenBundle(bundle())['product.membershipPrice']).toBe('');
  });

  it('상품키는 필드가 아니다 — 행 정체성이지 값이 아니다', () => {
    expect(flattenBundle(bundle())['product.rowKey']).toBeUndefined();
  });

  it('옵션 그룹 필드는 옵션키로, 옵션값 필드는 옵션값키로 스코프한다', () => {
    const flat = flattenBundle(bundle());
    expect(flat['optionGroup:og1.optionName']).toBe('색상');
    expect(flat['optionValue:ov2.optionValueName']).toBe('파랑');
    expect(flat['optionValue:ov1.colorCode']).toBe('#f00');
  });

  it('조합 필드는 조합키로 스코프한다', () => {
    expect(flattenBundle(bundle())['variant:ov1.variantCode']).toBe('V-1');
  });

  it('카테고리는 집합이라 정렬 조인한 단일 필드다', () => {
    // 대표 카테고리는 * 로 표시한다 — 대표만 바뀌어도 변경으로 잡혀야 한다.
    expect(flattenBundle(bundle())['category.set']).toBe('신상품|여성패션>티셔츠*');
  });

  it('구매제약 행이 없으면 두 필드 다 빈 문자열이다', () => {
    const flat = flattenBundle({ ...bundle(), constraint: null });
    expect(flat['constraint.requiresMembership']).toBe('');
    expect(flat['constraint.lifetimeQuantityLimit']).toBe('');
  });

  it('present 를 주면 그 시트에 실제로 있던 열만 담는다', () => {
    const flat = flattenBundle(bundle(), {
      products: new Set(['name']),
      options: new Set<string>(),
      variants: new Set<string>(),
      categories: new Set<string>(),
      constraints: new Set<string>(),
    });
    expect(flat['product.name']).toBe('티셔츠');
    expect('product.brand' in flat).toBe(false);
    expect('optionValue:ov1.colorCode' in flat).toBe(false);
    // 카테고리 시트 열이 하나도 없으면 집합 필드 자체가 없다 — "카테고리 변경 없음"이다.
    expect('category.set' in flat).toBe(false);
  });
});

describe('fieldLabel', () => {
  it('상품 필드는 워크북 헤더 한국어를 그대로 쓴다', () => {
    expect(fieldLabel('product.basePrice')).toBe('판매가');
  });

  it('옵션값 필드는 어느 옵션값인지까지 보여준다', () => {
    expect(fieldLabel('optionValue:ov1.colorCode')).toBe('색상코드 (옵션값 ov1)');
  });

  it('모르는 경로는 경로를 그대로 돌려준다 (라벨이 없다고 죽지 않는다)', () => {
    expect(fieldLabel('mystery.field')).toBe('mystery.field');
  });
});
```

`bulk-session.diff.spec.ts`:

```ts
import { computeChanges, detectConflicts } from './bulk-session.diff';

describe('computeChanges', () => {
  it('값이 달라진 필드만 담는다', () => {
    expect(computeChanges({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual({ b: '3' });
  });

  it('값이 있었는데 빈칸이면 명시적 비움으로 담는다', () => {
    expect(computeChanges({ a: 'ACME' }, { a: '' })).toEqual({ a: '' });
  });

  it('원래도 빈칸이었으면 변경이 아니다', () => {
    expect(computeChanges({ a: '' }, { a: '' })).toEqual({});
  });

  it('업로드에 없는 키(열 삭제)는 아예 보지 않는다', () => {
    expect(computeChanges({ a: 'ACME', b: 'x' }, { a: 'ACME' })).toEqual({});
  });

  it('base 에 없던 키(신규 행 필드)는 값이 있으면 변경이다', () => {
    expect(computeChanges({}, { a: '1', b: '' })).toEqual({ a: '1' });
  });
});

describe('detectConflicts', () => {
  it('내가 A 를, 남이 B 를 바꿨으면 충돌이 아니다', () => {
    const base = { A: '1', B: '1' };
    const mine = { A: '2', B: '1' };
    const current = { A: '1', B: '9' };
    expect(detectConflicts(base, mine, current)).toEqual({});
  });

  it('내가 A 를, 남도 A 를 바꿨으면 충돌이다', () => {
    const conflicts = detectConflicts({ A: '1' }, { A: '2' }, { A: '3' });
    expect(conflicts).toEqual({ A: { base: '1', mine: '2', current: '3' } });
  });

  it('둘이 같은 값으로 바꿨으면 충돌이 아니다', () => {
    expect(detectConflicts({ A: '1' }, { A: '2' }, { A: '2' })).toEqual({});
  });

  it('내가 안 바꿨으면 남이 바꿨어도 충돌이 아니다 (포크가 남의 값을 이미 들고 있다)', () => {
    expect(detectConflicts({ A: '1' }, { A: '1' }, { A: '9' })).toEqual({});
  });

  it('업로드에 없는 키는 충돌 판정 대상이 아니다', () => {
    expect(detectConflicts({ A: '1' }, {}, { A: '9' })).toEqual({});
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.fields.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.diff.spec.ts
```
Expected: FAIL — `Cannot find module './bulk-session.fields'`

- [ ] **Step 3: 타입을 만든다**

`bulk-session.types.ts`:

```ts
import type { PrefillBundle, PrefillRow } from './form-export.types';

/** 필드경로 → 셀 문자열. 세 상태(base·mine·current) 가 전부 이 모양이다. */
export type FlatFields = Record<string, string>;

export type ConflictMap = Record<string, { base: string; mine: string; current: string }>;
export type ConflictDecision = 'overwrite' | 'skip';
export type ConflictDecisionMap = Record<string, ConflictDecision>;

/** 업로드 시트에 **실제로 존재한** 열(ColumnDef.key) 집합. §F2 의 "열 삭제 ≠ 비움" 규칙이 이걸 쓴다. */
export interface PresentColumns {
  products: Set<string>;
  options: Set<string>;
  variants: Set<string>;
  categories: Set<string>;
  constraints: Set<string>;
}

/** 상품 하나가 워크북에서 차지하는 행 전량. 업로드 쪽 shape 은 PrefillBundle 에서 images 만 뺀 것이다. */
export type UploadedBundle = Pick<PrefillBundle, 'product' | 'options' | 'variants' | 'categories' | 'constraint'>;

/** 행 오류 하나. 어느 시트 몇 행인지까지 보여줘야 작업자가 파일에서 그 자리를 찾는다. */
export interface RowError {
  sheet: '상품' | '옵션' | '조합' | '카테고리' | '구매제약' | '이미지';
  rowNumber: number;
  message: string;
}

/**
 * items.input 의 shape — 업로드 원본(정규화 후)이다.
 *
 * `present` 가 `Set` 이 아니라 **배열**인 것이 중요하다. 이 값은 jsonb 로 저장되는데
 * `JSON.stringify(new Set(['a']))` 는 `{}` 다 — Set 을 그대로 담으면 왕복 후 "존재한 열이
 * 하나도 없다"가 되어 모든 수정 행의 변경분이 통째로 사라진다. 되읽는 쪽에서
 * `toPresentColumns` 로 Set 으로 되살린다.
 */
export interface BulkItemInput {
  bundle: UploadedBundle;
  present: {
    products: string[];
    options: string[];
    variants: string[];
    categories: string[];
    constraints: string[];
  };
  /** 접합 단계에서 이미 붙은 행 오류(상품키 누락·중복, 구매제약 2행 등). */
  errors: RowError[];
}

export function toPresentColumns(present: BulkItemInput['present']): PresentColumns {
  return {
    products: new Set(present.products),
    options: new Set(present.options),
    variants: new Set(present.variants),
    categories: new Set(present.categories),
    constraints: new Set(present.constraints),
  };
}

export function isBulkItemInput(value: unknown): value is BulkItemInput {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<BulkItemInput>;
  return (
    typeof v.bundle === 'object' &&
    v.bundle !== null &&
    typeof v.present === 'object' &&
    v.present !== null &&
    Array.isArray(v.present.products) &&
    Array.isArray(v.errors)
  );
}

/** items.payload 의 shape. 4단계가 이걸 읽어 draft 를 만든다. */
export interface BulkItemPayload {
  /** 적용할 필드경로 → 값. update 는 변경분만, create 는 입력 전체. */
  fields: FlatFields;
  /** '카테고리경로' 를 해석한 결과. category.set 이 fields 에 있을 때만 채워진다. */
  categoryIds?: string[];
  primaryCategoryId?: string;
  /** 이 행이 참조하는 (imageKey, usage). 3단계가 fileId 로 해석한다. */
  imageRefs?: Array<{ imageKey: string; usage: 'main' | 'description' }>;
  /** create 전용 — 만들 옵션 구조. update 는 옵션 구조를 바꿀 수 없다(스펙 §3.7). */
  optionPlan?: Array<{
    optionKey: string;
    displayName: string;
    sortOrder: number;
    values: Array<{ optionValueKey: string; displayName: string; colorCode: string; sortOrder: number }>;
  }>;
}

/**
 * jsonb 로 왕복한 값의 가드. v3 의 `isProductRecord` 와 같은 이유로 둔다 — 롤링 배포에서
 * 옛 코드가 쓴 payload 를 새 코드가 읽을 수 있고, 그때 죽는 대신 그 행만 실패시켜야 한다.
 */
export function isPrefillBundle(value: unknown): value is PrefillBundle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<PrefillBundle>;
  return (
    typeof v.product === 'object' &&
    v.product !== null &&
    Array.isArray(v.options) &&
    Array.isArray(v.variants) &&
    Array.isArray(v.categories)
  );
}

export function isBulkItemPayload(value: unknown): value is BulkItemPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<BulkItemPayload>;
  return typeof v.fields === 'object' && v.fields !== null;
}

export type { PrefillRow };
```

- [ ] **Step 4: 평탄화를 구현한다**

`bulk-session.fields.ts`:

```ts
import {
  CATEGORY_COLUMNS,
  CONSTRAINT_COLUMNS,
  OPTION_COLUMNS,
  PRODUCT_COLUMNS,
  VARIANT_COLUMNS,
} from './form-export.sheets';
import type { FlatFields, PresentColumns, UploadedBundle } from './bulk-session.types';

/** 옵션 시트에서 그룹에 속한 열과 값에 속한 열을 가른다 — 스코프 키가 다르기 때문이다. */
const OPTION_GROUP_KEYS = ['optionName', 'optionSortOrder'];
const OPTION_VALUE_KEYS = ['optionValueName', 'colorCode', 'valueSortOrder'];
const VARIANT_KEYS = ['basePrice', 'membershipPrice', 'variantCode'];

const has = (present: Set<string> | undefined, key: string): boolean => present === undefined || present.has(key);

/**
 * 번들을 `필드경로 → 문자열` 평면 맵으로 눕힌다.
 *
 * `present` 를 주면 **그 시트에 실제로 있던 열만** 담는다. 작업자가 열을 통째로 지운 것은
 * "이 필드는 이번에 안 건드림"이지 "비움"이 아니다 — 이 구분이 없으면 열 하나를 지운
 * 파일이 전 행의 그 필드를 날린다. 프리필(스냅샷·현재)에는 present 를 주지 않는다.
 */
export function flattenBundle(bundle: UploadedBundle, present?: PresentColumns): FlatFields {
  const out: FlatFields = {};

  for (const col of PRODUCT_COLUMNS) {
    if (col.key === 'rowKey') continue; // 행 정체성이지 값이 아니다
    if (!has(present?.products, col.key)) continue;
    out[`product.${col.key}`] = bundle.product[col.key] ?? '';
  }

  for (const row of bundle.options) {
    const groupKey = row.optionKey ?? '';
    const valueKey = row.optionValueKey ?? '';
    for (const key of OPTION_GROUP_KEYS) {
      if (!has(present?.options, key)) continue;
      out[`optionGroup:${groupKey}.${key}`] = row[key] ?? '';
    }
    for (const key of OPTION_VALUE_KEYS) {
      if (!has(present?.options, key)) continue;
      out[`optionValue:${valueKey}.${key}`] = row[key] ?? '';
    }
  }

  for (const row of bundle.variants) {
    const combo = row.combination ?? '';
    for (const key of VARIANT_KEYS) {
      if (!has(present?.variants, key)) continue;
      out[`variant:${combo}.${key}`] = row[key] ?? '';
    }
  }

  // 카테고리는 **집합**이다. 행 하나하나를 필드로 두면 순서 하나 바뀐 것이 전부 변경으로
  // 보인다. 정렬 조인한 단일 필드로 두면 "카테고리 배정이 바뀌었다" 한 줄로 뜬다.
  // 대표는 `*` 로 표시한다 — 대표만 옮겨도 변경으로 잡혀야 한다.
  if (has(present?.categories, 'categoryPath')) {
    out['category.set'] = bundle.categories
      .map((row) => `${row.categoryPath ?? ''}${(row.isPrimary ?? '') === 'Y' ? '*' : ''}`)
      .sort()
      .join('|');
  }

  for (const col of CONSTRAINT_COLUMNS) {
    if (col.key === 'rowKey') continue;
    if (!has(present?.constraints, col.key)) continue;
    out[`constraint.${col.key}`] = bundle.constraint?.[col.key] ?? '';
  }

  return out;
}

const LABEL_BY_KEY = new Map<string, string>([
  ...PRODUCT_COLUMNS.map((c) => [`product.${c.key}`, c.label] as const),
  ...OPTION_COLUMNS.map((c) => [c.key, c.label] as const),
  ...VARIANT_COLUMNS.map((c) => [c.key, c.label] as const),
  ...CATEGORY_COLUMNS.map((c) => [c.key, c.label] as const),
  ...CONSTRAINT_COLUMNS.map((c) => [`constraint.${c.key}`, c.label] as const),
  ['category.set', '카테고리'],
]);

/**
 * 필드경로를 사람이 읽는 라벨로 바꾼다. 화면(3·4단계 admin-web)이 매핑을 또 들고 있지
 * 않도록 서버가 준다 — 헤더 라벨이 바뀌면 한 곳만 고치면 된다.
 */
export function fieldLabel(path: string): string {
  const direct = LABEL_BY_KEY.get(path);
  if (direct) return direct;

  const scoped = /^(optionGroup|optionValue|variant):(.+)\.([^.]+)$/.exec(path);
  if (scoped) {
    const [, kind, scope, key] = scoped;
    const label = LABEL_BY_KEY.get(key) ?? key;
    const noun = kind === 'optionGroup' ? '옵션' : kind === 'optionValue' ? '옵션값' : '조합';
    return `${label} (${noun} ${scope})`;
  }
  return path;
}
```

- [ ] **Step 5: diff 를 구현한다**

`bulk-session.diff.ts`:

```ts
import type { ConflictMap, FlatFields } from './bulk-session.types';

/**
 * 변경분 = 업로드 값이 스냅샷과 다른 필드.
 *
 * **업로드 맵에 있는 키만 돈다.** 스냅샷에만 있는 키는 그 열이 파일에 없었다는 뜻이고,
 * 그건 "변경 없음"이다(§F2).
 */
export function computeChanges(base: FlatFields, mine: FlatFields): FlatFields {
  const out: FlatFields = {};
  for (const [key, value] of Object.entries(mine)) {
    if (value !== (base[key] ?? '')) out[key] = value;
  }
  return out;
}

/**
 * 충돌 = 내가 바꾼 필드 ∩ 스냅샷 이후 남이 바꾼 필드.
 *
 * 셋째 조건(`current !== mine`)이 있는 이유: 둘이 같은 값으로 바꿨으면 사람이 판단할 것이
 * 없다. 결정 화면에 뜨는 것은 정말 판단이 필요한 것만이어야 한다 — "덮어쓰기"를 고르는
 * 것은 **항상 남의 편집을 되돌리는 결정**이고, 그 무게가 노이즈에 묻히면 안 된다.
 */
export function detectConflicts(base: FlatFields, mine: FlatFields, current: FlatFields): ConflictMap {
  const out: ConflictMap = {};
  for (const [key, mineValue] of Object.entries(mine)) {
    const baseValue = base[key] ?? '';
    const currentValue = current[key] ?? '';
    if (mineValue !== baseValue && currentValue !== baseValue && currentValue !== mineValue) {
      out[key] = { base: baseValue, mine: mineValue, current: currentValue };
    }
  }
  return out;
}

/** 결정을 반영한 최종 적용분. 'skip' 인 필드는 남의 값을 그대로 둔다(포크가 이미 들고 있다). */
export function applyDecisions(changes: FlatFields, decisions: Record<string, string>): FlatFields {
  const out: FlatFields = {};
  for (const [key, value] of Object.entries(changes)) {
    if (decisions[key] === 'skip') continue;
    out[key] = value;
  }
  return out;
}
```

`applyDecisions` 도 테스트한다:

```ts
describe('applyDecisions', () => {
  it("skip 인 필드는 적용분에서 빠진다", () => {
    expect(applyDecisions({ A: '2', B: '3' }, { A: 'skip' })).toEqual({ B: '3' });
  });

  it('결정이 없는 필드는 그대로 적용된다 (충돌이 아니었던 필드)', () => {
    expect(applyDecisions({ A: '2' }, {})).toEqual({ A: '2' });
  });
});
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.fields.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.diff.spec.ts
npm run type-check:scoped
```
Expected: 전부 PASS, exit 0.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.{types,fields,diff}.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.{fields,diff}.spec.ts
git commit -m "feat(bulk-session): 평면 필드맵 + 3-way diff·충돌 판정"
```

---

### Task 4: 업로드 워크북 파서

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.parser.ts`
- Test: `.../services/bulk-upload.parser.spec.ts`

**Interfaces:**
- Consumes: 1단계 `form-export.sheets.ts` 의 `SHEET_NAMES`·`*_COLUMNS`, `form-export.workbook.ts` 의 `readExportIdFromWorkbook`
- Produces:
  - `interface ParsedUpload { exportId: string | null; sheets: { products: RawSheetRow[]; options: ...; variants: ...; categories: ...; constraints: ...; images: ... }; present: PresentColumns }`
  - `interface RawSheetRow { rowNumber: number; cells: PrefillRow }` — 키는 **ColumnDef.key** 다(한국어 라벨이 아니라). `rowNumber` 는 **엑셀의 물리 행 번호**이고 헤더가 1행이므로 첫 데이터 행은 2다 (Task 4 리뷰 판정, 2026-08-01: 압축 카운터를 쓰면 중간 빈 행 하나에 오류 메시지의 좌표가 밀려 작업자가 그 줄을 못 찾는다 — 실측 재현됨)
  - `async function parseUploadWorkbook(buffer: Buffer): Promise<ParsedUpload>` — 파일 오류는 `BadRequestError`
  - 상한 상수 `MAX_UPLOAD_PRODUCT_ROWS = 1000` 외

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-upload.parser.spec.ts` — 픽스처는 1단계 워크북 빌더로 만든다(같은 파일 규약을 쓰는 것이 이 테스트의 요점이다):

```ts
import { buildFormWorkbook } from './form-export.workbook';
import { parseUploadWorkbook, MAX_UPLOAD_PRODUCT_ROWS } from './bulk-upload.parser';
import * as ExcelJS from 'exceljs';

const workbook = async (over: Partial<Parameters<typeof buildFormWorkbook>[0]> = {}) =>
  buildFormWorkbook({
    exportId: '11111111-1111-7111-8111-111111111111',
    products: [{ rowKey: 'P-000001', name: '티셔츠', basePrice: '19000', brand: 'ACME' }],
    options: [],
    variants: [],
    categories: [],
    constraints: [],
    images: [],
    categoryPaths: ['여성패션>티셔츠'],
    ...over,
  });

describe('parseUploadWorkbook', () => {
  it('1단계가 만든 워크북을 그대로 되읽는다', async () => {
    const parsed = await parseUploadWorkbook(await workbook());
    expect(parsed.exportId).toBe('11111111-1111-7111-8111-111111111111');
    expect(parsed.sheets.products).toHaveLength(1);
    expect(parsed.sheets.products[0].cells.name).toBe('티셔츠');
    expect(parsed.sheets.products[0].rowNumber).toBe(1);
  });

  it('한국어 헤더를 내부 키로 바꾼다', async () => {
    const parsed = await parseUploadWorkbook(await workbook());
    expect(parsed.sheets.products[0].cells.basePrice).toBe('19000');
    expect(parsed.sheets.products[0].cells['판매가']).toBeUndefined();
  });

  it('숨은 메타 시트가 없으면 exportId 가 null 이다 (신규 전용 세션)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가']);
    ws.addRow(['A', '새 상품', '1000']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    expect((await parseUploadWorkbook(buffer)).exportId).toBeNull();
  });

  it('모르는 열은 무시한다 (작업자 메모 열이 안전하다)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가', '작업메모']);
    ws.addRow(['A', '새 상품', '1000', '내일 확인']);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products[0].cells).toEqual({ rowKey: 'A', name: '새 상품', basePrice: '1000' });
  });

  it('열 순서가 바뀌어도 이름으로 찾는다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['판매가', '상품명', '상품키']);
    ws.addRow(['1000', '새 상품', 'A']);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products[0].cells.rowKey).toBe('A');
  });

  it('present 에 실제로 있던 열만 담긴다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가']);
    ws.addRow(['A', '새 상품', '1000']);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.present.products.has('name')).toBe(true);
    expect(parsed.present.products.has('brand')).toBe(false);
  });

  it('엑셀이 아니면 파일 오류다', async () => {
    await expect(parseUploadWorkbook(Buffer.from('not xlsx'))).rejects.toThrow('유효한 엑셀');
  });

  it('상품 시트가 없으면 파일 오류다', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('아무거나');
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('"상품"');
  });

  it('상품 시트에 필수 열이 없으면 파일 오류다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품명', '판매가']);
    ws.addRow(['새 상품', '1000']);
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('상품키');
  });

  it('데이터 행이 없으면 파일 오류다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가']);
    await expect(parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow('데이터 행이 없습니다');
  });

  it('상품 행 상한을 넘으면 파일 오류다', async () => {
    const products = Array.from({ length: MAX_UPLOAD_PRODUCT_ROWS + 1 }, (_, i) => ({
      rowKey: `P-${i}`,
      name: 'x',
      basePrice: '1000',
    }));
    await expect(parseUploadWorkbook(await workbook({ products }))).rejects.toThrow('상한');
  });

  it('날짜 서식 셀을 워크북 규격 문자열로 되돌린다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('상품');
    ws.addRow(['상품키', '상품명', '판매가', '판매시작']);
    ws.addRow(['A', 'x', '1000', new Date(Date.UTC(2026, 7, 1, 9, 0))]);
    const parsed = await parseUploadWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.sheets.products[0].cells.salesStartDate).toBe('2026-08-01 09:00');
  });

  it('카테고리 참조 시트는 읽지 않는다', async () => {
    const parsed = await parseUploadWorkbook(await workbook());
    expect('categoryReference' in parsed.sheets).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.parser.spec.ts
```
Expected: FAIL — `Cannot find module './bulk-upload.parser'`

- [ ] **Step 3: 구현한다**

```ts
import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import {
  CATEGORY_COLUMNS,
  CONSTRAINT_COLUMNS,
  ColumnDef,
  IMAGE_COLUMNS,
  OPTION_COLUMNS,
  PRODUCT_COLUMNS,
  SHEET_NAMES,
  VARIANT_COLUMNS,
} from './form-export.sheets';
import { readExportIdFromWorkbook } from './form-export.workbook';
import type { PresentColumns, PrefillRow } from './bulk-session.types';

/** v3 와 같은 값에서 출발한다. 파일 크기 상한(10MB)에 먼저 걸리는 것이 보통이다. */
export const MAX_UPLOAD_PRODUCT_ROWS = 1000;
export const MAX_UPLOAD_OPTION_ROWS = 20_000;
export const MAX_UPLOAD_VARIANT_ROWS = 20_000;
export const MAX_UPLOAD_CATEGORY_ROWS = 5_000;
export const MAX_UPLOAD_CONSTRAINT_ROWS = MAX_UPLOAD_PRODUCT_ROWS;
export const MAX_UPLOAD_IMAGE_ROWS = 10_000;

export interface RawSheetRow {
  /** 시트 데이터 행 번호(헤더 제외, 1-based). 작업자가 파일에서 그 줄을 찾는 좌표다. */
  rowNumber: number;
  /** ColumnDef.key → trim 된 셀 문자열. 한국어 라벨은 여기서 이미 사라진다. */
  cells: PrefillRow;
}

export interface ParsedUpload {
  exportId: string | null;
  sheets: {
    products: RawSheetRow[];
    options: RawSheetRow[];
    variants: RawSheetRow[];
    categories: RawSheetRow[];
    constraints: RawSheetRow[];
    images: RawSheetRow[];
  };
  present: PresentColumns;
}

/**
 * 엑셀 날짜 셀을 워크북 규격 텍스트로 되돌린다. exceljs 는 날짜 서식 셀을 Date 로 읽고
 * `cell.text` 는 서버 로케일·TZ 의존 문자열이라 어디에도 못 쓴다. UTC 성분으로 읽는다 —
 * exceljs 가 날짜 serial 을 UTC 기준 Date 로 만들기 때문이다.
 * (product-import.parser.ts:38-43 과 같은 함수·같은 이유. 옛 임포트는 6단계에서 지워지므로
 *  공통화하지 않는다 — 사용자가 하나로 줄어들 추상화를 미리 만드는 셈이 된다.)
 */
function formatWorkbookDateCell(value: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  return time === '00:00' ? date : `${date} ${time}`;
}

function readSheet(
  sheet: ExcelJS.Worksheet | undefined,
  columns: ColumnDef[],
): { rows: RawSheetRow[]; present: Set<string> } {
  if (!sheet) return { rows: [], present: new Set() };

  const keyByLabel = new Map(columns.map((c) => [c.label, c.key]));
  const keyByColumn: string[] = [];
  const present = new Set<string>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const label = String(cell.text ?? '').trim();
    const key = keyByLabel.get(label);
    if (!key) return; // 모르는 열은 무시한다 — 작업자가 메모 열을 붙여도 안전하다
    keyByColumn[col] = key;
    present.add(key);
  });

  const rows: RawSheetRow[] = [];
  let dataIndex = 0;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: PrefillRow = {};
    let hasValue = false;
    keyByColumn.forEach((key, col) => {
      if (!key) return;
      const cell = row.getCell(col);
      // 날짜 셀만 가로챈다. 수식 셀의 value 는 {formula, result} 객체라 instanceof 가 걸리지 않는다.
      const value = cell.value instanceof Date ? formatWorkbookDateCell(cell.value) : String(cell.text ?? '').trim();
      cells[key] = value;
      if (value !== '') hasValue = true;
    });
    if (!hasValue) continue; // 완전 빈 행은 건너뛴다
    dataIndex += 1;
    rows.push({ rowNumber: dataIndex, cells });
  }
  return { rows, present };
}

function capped(rows: RawSheetRow[], max: number, sheetName: string): RawSheetRow[] {
  if (rows.length > max) {
    throw new BadRequestError(`"${sheetName}" 시트 행이 상한(${max})을 초과했습니다. 파일을 나눠 올려주세요.`);
  }
  return rows;
}

/**
 * 업로드 워크북을 시트별 행으로 되읽는다. **파일 수준 오류만** 던진다(행 오류는 검증기 몫).
 *
 * "카테고리 참조" 시트는 아예 읽지 않는다 — 상수이고, 작업자가 고쳐도 반영되지 않는 것이
 * 설계다(스펙 §3.4).
 */
export async function parseUploadWorkbook(buffer: Buffer): Promise<ParsedUpload> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs 의 앰비언트 Buffer shim 과 @types/node 의 Buffer<T> 가 병합돼 호출부에서
    // TS2345 가 나므로 메서드 타입만 지역에서 다시 선언한다(product-import.parser.ts:50-61
    // 에 같은 우회와 그 근거가 적혀 있다).
    const xlsx = wb.xlsx as unknown as {
      load(buffer: Buffer, options?: Partial<ExcelJS.XlsxReadOptions>): Promise<ExcelJS.Workbook>;
    };
    await xlsx.load(buffer);
  } catch {
    throw new BadRequestError('유효한 엑셀(.xlsx) 파일이 아닙니다.');
  }

  const productsSheet = wb.getWorksheet(SHEET_NAMES.products);
  if (!productsSheet) throw new BadRequestError(`필수 시트 "${SHEET_NAMES.products}" 가 없습니다.`);

  const products = readSheet(productsSheet, PRODUCT_COLUMNS);
  const missing = PRODUCT_COLUMNS.filter((c) => c.required && !products.present.has(c.key)).map((c) => c.label);
  if (missing.length > 0) throw new BadRequestError(`"상품" 시트 필수 열 누락: ${missing.join(', ')}`);
  if (products.rows.length === 0) throw new BadRequestError('"상품" 시트에 데이터 행이 없습니다.');
  capped(products.rows, MAX_UPLOAD_PRODUCT_ROWS, SHEET_NAMES.products);

  const options = readSheet(wb.getWorksheet(SHEET_NAMES.options), OPTION_COLUMNS);
  const variants = readSheet(wb.getWorksheet(SHEET_NAMES.variants), VARIANT_COLUMNS);
  const categories = readSheet(wb.getWorksheet(SHEET_NAMES.categories), CATEGORY_COLUMNS);
  const constraints = readSheet(wb.getWorksheet(SHEET_NAMES.constraints), CONSTRAINT_COLUMNS);
  const images = readSheet(wb.getWorksheet(SHEET_NAMES.images), IMAGE_COLUMNS);

  capped(options.rows, MAX_UPLOAD_OPTION_ROWS, SHEET_NAMES.options);
  capped(variants.rows, MAX_UPLOAD_VARIANT_ROWS, SHEET_NAMES.variants);
  capped(categories.rows, MAX_UPLOAD_CATEGORY_ROWS, SHEET_NAMES.categories);
  capped(constraints.rows, MAX_UPLOAD_CONSTRAINT_ROWS, SHEET_NAMES.constraints);
  capped(images.rows, MAX_UPLOAD_IMAGE_ROWS, SHEET_NAMES.images);

  return {
    exportId: await readExportIdFromWorkbook(buffer),
    sheets: {
      products: products.rows,
      options: options.rows,
      variants: variants.rows,
      categories: categories.rows,
      constraints: constraints.rows,
      images: images.rows,
    },
    present: {
      products: products.present,
      options: options.present,
      variants: variants.present,
      categories: categories.present,
      constraints: constraints.present,
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.parser.spec.ts
npm run type-check:scoped
```
Expected: 전부 PASS, exit 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.parser*.ts
git commit -m "feat(bulk-session): 업로드 워크북 파서 (한국어 헤더·존재 열 집합)"
```

---

### Task 5: 행 접합과 create/update 분류

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler.ts`
- Test: `.../services/bulk-upload.assembler.spec.ts`

**Interfaces:**
- Consumes: Task 4 의 `ParsedUpload`, Task 3 의 `UploadedBundle`·`RowError`
- Produces:
  - `interface AssembledRow { rowNumber: number; rowKey: string; kind: 'create' | 'update'; bundle: UploadedBundle; errors: RowError[] }`
  - `interface AssembledUpload { rows: AssembledRow[]; images: Map<string, { rowNumber: number; sourceValue: string }>; errors: RowError[] }` — `errors` 는 상품에 붙일 수 없는 시트 자체 오류
  - `function assembleUpload(parsed: ParsedUpload, knownRowKeys: Set<string>): AssembledUpload`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { assembleUpload } from './bulk-upload.assembler';
import type { ParsedUpload } from './bulk-upload.parser';

const parsed = (over: Partial<ParsedUpload['sheets']> = {}): ParsedUpload => ({
  exportId: null,
  sheets: {
    products: [{ rowNumber: 1, cells: { rowKey: 'P-1', name: '티셔츠', basePrice: '19000' } }],
    options: [],
    variants: [],
    categories: [],
    constraints: [],
    images: [],
    ...over,
  },
  present: {
    products: new Set(['rowKey', 'name', 'basePrice']),
    options: new Set<string>(),
    variants: new Set<string>(),
    categories: new Set<string>(),
    constraints: new Set<string>(),
  },
});

describe('assembleUpload', () => {
  it('양식 잡에 있는 상품키는 수정이다', () => {
    const { rows } = assembleUpload(parsed(), new Set(['P-1']));
    expect(rows[0].kind).toBe('update');
  });

  it('양식 잡에 없는 상품키는 신규다', () => {
    const { rows } = assembleUpload(parsed(), new Set());
    expect(rows[0].kind).toBe('create');
  });

  it('상품키가 비면 행 오류다', () => {
    const p = parsed({ products: [{ rowNumber: 1, cells: { rowKey: '', name: 'x' } }] });
    expect(assembleUpload(p, new Set()).rows[0].errors[0].message).toContain('상품키');
  });

  it('파일 안에서 상품키가 중복되면 두 행 다 오류다 (복사한 행을 그대로 올린 경우)', () => {
    const p = parsed({
      products: [
        { rowNumber: 1, cells: { rowKey: 'P-1', name: 'a' } },
        { rowNumber: 2, cells: { rowKey: 'P-1', name: 'b' } },
      ],
    });
    const { rows } = assembleUpload(p, new Set(['P-1']));
    expect(rows[0].errors.map((e) => e.message).join()).toContain('중복');
    expect(rows[1].errors.map((e) => e.message).join()).toContain('중복');
  });

  it('부속 시트 행을 상품키로 접합한다', () => {
    const p = parsed({
      options: [{ rowNumber: 1, cells: { rowKey: 'P-1', optionKey: 'og1', optionValueKey: 'ov1' } }],
      variants: [{ rowNumber: 1, cells: { rowKey: 'P-1', combination: 'ov1' } }],
      categories: [{ rowNumber: 1, cells: { rowKey: 'P-1', categoryPath: '여성패션', isPrimary: 'Y' } }],
      constraints: [{ rowNumber: 1, cells: { rowKey: 'P-1', requiresMembership: 'Y' } }],
    });
    const { rows } = assembleUpload(p, new Set());
    expect(rows[0].bundle.options).toHaveLength(1);
    expect(rows[0].bundle.variants).toHaveLength(1);
    expect(rows[0].bundle.categories).toHaveLength(1);
    expect(rows[0].bundle.constraint?.requiresMembership).toBe('Y');
  });

  it('존재하지 않는 상품키를 참조한 부속 행은 시트 오류로 남는다', () => {
    const p = parsed({ options: [{ rowNumber: 3, cells: { rowKey: '없음', optionKey: 'og1' } }] });
    const { errors } = assembleUpload(p, new Set());
    expect(errors[0]).toMatchObject({ sheet: '옵션', rowNumber: 3 });
    expect(errors[0].message).toContain('없음');
  });

  it('구매제약이 상품당 두 행이면 행 오류다', () => {
    const p = parsed({
      constraints: [
        { rowNumber: 1, cells: { rowKey: 'P-1', requiresMembership: 'Y' } },
        { rowNumber: 2, cells: { rowKey: 'P-1', requiresMembership: 'N' } },
      ],
    });
    expect(assembleUpload(p, new Set()).rows[0].errors[0].message).toContain('한 행');
  });

  it('이미지 시트를 키 사전으로 만든다', () => {
    const p = parsed({ images: [{ rowNumber: 1, cells: { imageKey: 'IMG-1', sourceValue: 'a.jpg' } }] });
    expect(assembleUpload(p, new Set()).images.get('IMG-1')?.sourceValue).toBe('a.jpg');
  });

  it('이미지 키가 중복되면 시트 오류다 (뒤 행이 앞을 조용히 덮으면 안 된다)', () => {
    const p = parsed({
      images: [
        { rowNumber: 1, cells: { imageKey: 'IMG-1', sourceValue: 'a.jpg' } },
        { rowNumber: 2, cells: { imageKey: 'IMG-1', sourceValue: 'b.jpg' } },
      ],
    });
    const { errors, images } = assembleUpload(p, new Set());
    expect(errors[0].message).toContain('중복');
    expect(images.get('IMG-1')?.sourceValue).toBe('a.jpg'); // 첫 행이 이긴다
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler.spec.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

핵심 규약을 코드 주석으로 못 박는다:

```ts
/**
 * 시트별 행을 상품키로 접합해 상품 단위 번들로 만들고, 수정/신규를 가른다.
 *
 * **행 삭제 규약**(스펙 §3.4·§F2):
 * - 상품 시트에서 프리필 행을 지운 것 = "이 상품은 이번에 안 건드림". 임포트는 상품을 지우지 않는다.
 * - 옵션·조합 시트의 행 누락 = 옵션 구조 변경 시도 → Task 7 의 구조 검사가 행 오류로 잡는다.
 *   (여기서는 접합만 하고 판단하지 않는다 — 신규 행은 애초에 비교할 스냅샷이 없다.)
 * - 카테고리 행이 하나도 없으면 "카테고리 변경 없음"이다. 전량 해제는 임포트로 표현하지 않는다
 *   (대표 카테고리 없는 상품을 만들 수 없으므로 표현할 수 있어도 쓸 데가 없다).
 * - 구매제약 행이 없으면 "변경 없음". 해제는 값 칸을 비워서 표현한다.
 */
export function assembleUpload(parsed: ParsedUpload, knownRowKeys: Set<string>): AssembledUpload {
  const rows: AssembledRow[] = [];
  const byKey = new Map<string, AssembledRow>();
  const seen = new Set<string>();
  const errors: RowError[] = [];

  for (const raw of parsed.sheets.products) {
    const rowKey = (raw.cells.rowKey ?? '').trim();
    const row: AssembledRow = {
      rowNumber: raw.rowNumber,
      rowKey,
      kind: knownRowKeys.has(rowKey) ? 'update' : 'create',
      bundle: { product: raw.cells, options: [], variants: [], categories: [], constraint: null },
      errors: [],
    };
    if (rowKey === '') {
      row.errors.push({ sheet: '상품', rowNumber: raw.rowNumber, message: '상품키는 필수입니다.' });
    } else if (seen.has(rowKey)) {
      row.errors.push({ sheet: '상품', rowNumber: raw.rowNumber, message: `상품키가 중복되었습니다: ${rowKey}` });
      const first = byKey.get(rowKey);
      // 어느 쪽이 맞는지 알 수 없으므로 첫 행에도 같은 오류를 남긴다 — 한쪽만 실패시키면
      // 남은 쪽이 조용히 적용돼 작업자가 의도한 것과 다른 상품이 바뀐다.
      if (first && !first.errors.some((e) => e.message.includes('중복'))) {
        first.errors.push({ sheet: '상품', rowNumber: first.rowNumber, message: `상품키가 중복되었습니다: ${rowKey}` });
      }
    } else {
      seen.add(rowKey);
      byKey.set(rowKey, row);
    }
    rows.push(row);
  }

  const attach = (
    sheet: RowError['sheet'],
    sheetRows: RawSheetRow[],
    apply: (target: AssembledRow, raw: RawSheetRow) => void,
  ): void => {
    for (const raw of sheetRows) {
      const rowKey = (raw.cells.rowKey ?? '').trim();
      const target = byKey.get(rowKey);
      if (!target) {
        errors.push({
          sheet,
          rowNumber: raw.rowNumber,
          message: `"상품" 시트에 없는 상품키를 참조했습니다: ${rowKey || '(빈 값)'}`,
        });
        continue;
      }
      apply(target, raw);
    }
  };

  attach('옵션', parsed.sheets.options, (t, raw) => t.bundle.options.push(raw.cells));
  attach('조합', parsed.sheets.variants, (t, raw) => t.bundle.variants.push(raw.cells));
  attach('카테고리', parsed.sheets.categories, (t, raw) => t.bundle.categories.push(raw.cells));
  attach('구매제약', parsed.sheets.constraints, (t, raw) => {
    if (t.bundle.constraint) {
      t.errors.push({
        sheet: '구매제약',
        rowNumber: raw.rowNumber,
        message: `구매제약은 상품당 한 행만 쓸 수 있습니다: ${t.rowKey}`,
      });
      return;
    }
    t.bundle.constraint = raw.cells;
  });

  const images = new Map<string, { rowNumber: number; sourceValue: string }>();
  for (const raw of parsed.sheets.images) {
    const imageKey = (raw.cells.imageKey ?? '').trim();
    const sourceValue = (raw.cells.sourceValue ?? '').trim();
    if (imageKey === '') {
      errors.push({ sheet: '이미지', rowNumber: raw.rowNumber, message: '이미지키는 필수입니다.' });
      continue;
    }
    if (sourceValue === '') {
      errors.push({ sheet: '이미지', rowNumber: raw.rowNumber, message: `원본은 필수입니다: ${imageKey}` });
      continue;
    }
    if (images.has(imageKey)) {
      errors.push({ sheet: '이미지', rowNumber: raw.rowNumber, message: `이미지키가 중복되었습니다: ${imageKey}` });
      continue;
    }
    images.set(imageKey, { rowNumber: raw.rowNumber, sourceValue });
  }

  return { rows, images, errors };
}
```

- [ ] **Step 4: 테스트 통과 확인 후 커밋**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler.spec.ts
npm run type-check:scoped
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler*.ts
git commit -m "feat(bulk-session): 상품키 접합 + 수정/신규 분류"
```

---

### Task 6: 필드 검증기 (길이·열거·숫자·날짜·가격 센티넬)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.ts`
- Test: `.../services/bulk-session.validator.spec.ts`

**Interfaces:**
- Consumes: Task 5 의 `AssembledRow`, 1단계의 `PRICING_SENTINEL`
- Produces: `function validateFields(row: AssembledRow, ctx: { pricingEditable: boolean }): RowError[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

varchar 길이는 `catalog.schema.ts` 실측값이다 — **전 필드로 확장하는 것이 이 태스크의 존재 이유**다(스펙 §2.8·§3.12: v3 는 일부 필드만 검사해 나머지가 commit 에서 Postgres 22001 로 죽었다).

| 필드 | 컬럼 | 상한 |
|---|---|---|
| `name` | `varchar(255)` | 255 |
| `alternativeName` | `varchar(255)` | 255 |
| `seoTitle` | `varchar(255)` | 255 |
| `brand` | `varchar(100)` | 100 |
| `productCode` | `varchar(100)` | 100 |
| `seller` | `varchar(100)` | 100 |
| `salesClassification` | `varchar(100)` | 100 |
| `purchaseClassification` | `varchar(100)` | 100 |
| `productType` | `varchar(50)` (열거) | `regular_sale`·`limited_edition` |
| `fulfillmentKind` | `varchar(20)` (열거) | `physical`·`digital` |
| `description`·`material`·`seoDescription` | `text` | 없음 |

```ts
import { validateFields } from './bulk-session.validator';
import { PRICING_SENTINEL } from './form-export.sheets';

const row = (product: Record<string, string>, over: Partial<Parameters<typeof validateFields>[0]> = {}) => ({
  rowNumber: 1,
  rowKey: 'P-1',
  kind: 'create' as const,
  bundle: { product, options: [], variants: [], categories: [], constraint: null },
  errors: [],
  ...over,
});
const messages = (errors: { message: string }[]) => errors.map((e) => e.message).join(' | ');

describe('validateFields — 신규 행', () => {
  it('상품명이 없으면 오류다', () => {
    expect(messages(validateFields(row({ basePrice: '1000' }), { pricingEditable: true }))).toContain('상품명');
  });

  it('판매가가 없거나 0 이면 오류다 (판매가 없이 게시할 수 없다)', () => {
    expect(messages(validateFields(row({ name: 'x', basePrice: '0' }), { pricingEditable: true }))).toContain('판매가');
  });

  it('판매가가 소수면 오류다 (원화는 소수 단위가 없다)', () => {
    expect(messages(validateFields(row({ name: 'x', basePrice: '1000.5' }), { pricingEditable: true }))).toContain('정수');
  });

  it('멤버십가가 판매가보다 크면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1000', membershipPrice: '2000' }), { pricingEditable: true });
    expect(messages(errors)).toContain('이하');
  });

  it('varchar 상한을 넘으면 오류다 — 브랜드 100자', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', brand: 'ㄱ'.repeat(101) }), { pricingEditable: true });
    expect(messages(errors)).toContain('100자');
  });

  it('varchar 상한을 넘으면 오류다 — 상품명 255자', () => {
    const errors = validateFields(row({ name: 'ㄱ'.repeat(256), basePrice: '1' }), { pricingEditable: true });
    expect(messages(errors)).toContain('255자');
  });

  it('상품유형이 정해진 값 밖이면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', productType: 'weird' }), { pricingEditable: true });
    expect(messages(errors)).toContain('상품유형');
  });

  it('판매기간은 YYYY-MM-DD 또는 YYYY-MM-DD HH:mm 만 받는다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', salesStartDate: '08/01/2026' }), { pricingEditable: true });
    expect(messages(errors)).toContain('형식');
  });

  it('존재하지 않는 날짜를 잡는다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', salesEndDate: '2026-02-30' }), { pricingEditable: true });
    expect(messages(errors)).toContain('존재하지 않는 날짜');
  });

  it('판매종료가 판매시작보다 앞서면 오류다', () => {
    const errors = validateFields(
      row({ name: 'x', basePrice: '1', salesStartDate: '2026-08-10', salesEndDate: '2026-08-01' }),
      { pricingEditable: true },
    );
    expect(messages(errors)).toContain('판매종료');
  });

  it('부가이미지키는 5개까지다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', additionalImageKeys: 'a|b|c|d|e|f' }), { pricingEditable: true });
    expect(messages(errors)).toContain('5개');
  });

  it('평생구매한도는 integer 범위여야 한다', () => {
    const r = row({ name: 'x', basePrice: '1' });
    r.bundle.constraint = { requiresMembership: 'N', lifetimeQuantityLimit: '9999999999' };
    expect(messages(validateFields(r, { pricingEditable: true }))).toContain('2147483647');
  });
});

describe('validateFields — 가격 센티넬', () => {
  it('복합 가격규칙 상품은 센티넬이 그대로면 통과다', () => {
    const r = row({ name: 'x', basePrice: PRICING_SENTINEL, membershipPrice: PRICING_SENTINEL }, { kind: 'update' });
    expect(validateFields(r, { pricingEditable: false })).toEqual([]);
  });

  it('복합 가격규칙 상품의 판매가를 고치면 오류다', () => {
    const r = row({ name: 'x', basePrice: '19000' }, { kind: 'update' });
    expect(messages(validateFields(r, { pricingEditable: false }))).toContain('복합 가격규칙');
  });

  it('단순 가격 상품에 센티넬을 적어 넣으면 오류다', () => {
    const r = row({ name: 'x', basePrice: PRICING_SENTINEL }, { kind: 'update' });
    expect(messages(validateFields(r, { pricingEditable: true }))).toContain('판매가');
  });

  it('수정 행은 판매가가 비어 있어도 오류가 아니다 (변경 없음이다)', () => {
    const r = row({ name: 'x', basePrice: '' }, { kind: 'update' });
    expect(validateFields(r, { pricingEditable: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.spec.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`bulk-session.validator.ts` 의 구조:

```ts
/** varchar 상한. catalog.schema.ts 실측값이다 — 넘으면 프리뷰는 통과하고 4단계 write 에서 22001 로 그 행만 죽는다. */
const MAX_LENGTH: Record<string, number> = {
  name: 255,
  alternativeName: 255,
  seoTitle: 255,
  brand: 100,
  productCode: 100,
  seller: 100,
  salesClassification: 100,
  purchaseClassification: 100,
};

const ENUMS: Record<string, string[]> = {
  productType: ['regular_sale', 'limited_edition'],
  fulfillmentKind: ['physical', 'digital'],
};

const SALES_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SALES_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export function validateFields(row: AssembledRow, ctx: { pricingEditable: boolean }): RowError[] { ... }
```

구현 규칙(전부 테스트가 강제한다):

1. **길이·열거·숫자 검증은 kind 와 무관**하게, 값이 채워진 칸에만 건다.
2. **필수 검증은 `kind === 'create'` 에만** 건다 — 수정 행의 빈칸은 "변경 없음/비움"이지 누락이 아니다(스펙 §3.5).
3. **가격 센티넬**:
   - `pricingEditable === false` 면 상품·조합의 `basePrice`·`membershipPrice` 는 `PRICING_SENTINEL` 이거나 빈칸이어야 한다. 아니면 `복합 가격규칙 상품의 가격은 임포트로 수정할 수 없습니다` 오류.
   - `pricingEditable === true` 면 그 칸에 센티넬이 들어 있으면 숫자 파싱 실패로 오류.
4. **날짜**는 v3 `product-import.validator.ts:306-346` 과 같은 규약 — 두 형식만, KST(+09:00)로 해석, 종료일만 날짜만 주면 그날 23:59:59.999, `Date.UTC` 왕복으로 2026-02-30 같은 달력 오버플로를 잡는다. 결과는 **ISO8601 문자열**로만 다룬다.
5. 오류 메시지는 전부 **워크북의 한국어 헤더 이름**을 쓴다(`판매가`, `상품명`). 내부 키가 새어 나가면 작업자가 그 칸을 못 찾는다.

- [ ] **Step 4: 테스트 통과 확인 후 커밋**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator.spec.ts
npm run type-check:scoped
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.validator*.ts
git commit -m "feat(bulk-session): 필드 검증기 — varchar 상한 전 필드 확장 + 가격 센티넬"
```

---

### Task 7: 구조 검증 — 옵션 불변 · 이미지 · 카테고리

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.structure.ts`
- Test: `.../services/bulk-session.structure.spec.ts`

**Interfaces:**
- Produces:
  - `function checkOptionStructure(uploaded: UploadedBundle, base: PrefillBundle): RowError[]`
  - `function resolveImageRefs(row: AssembledRow, images: Map<string, { rowNumber: number; sourceValue: string }>): { refs: Array<{ imageKey: string; usage: 'main'|'description' }>; errors: RowError[] }`
  - `function classifyImageSource(sourceValue: string): { kind: 'file_id' | 'file_name' } | { error: string }`
  - `function buildCategoryPathIndex(flat: FlatCategory[]): Map<string, string[]>` — Task 2 가 export 한 `flattenCategoryTree` 의 결과를 그대로 받는다. 값이 **배열**인 것은 동명 형제 때문이다(아래).
  - `function resolveCategories(rows: PrefillRow[], index: Map<string, string[]>): { categoryIds: string[]; primaryCategoryId?: string; errors: RowError[] }` — `rows` 는 한 상품의 카테고리 시트 행이고, `RowError.rowNumber` 는 접합 시 잃으므로 0 으로 두고 메시지에 경로 문자열을 싣는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe('checkOptionStructure', () => {
  const base = {
    product: {},
    options: [
      { optionKey: 'og1', optionValueKey: 'ov1', optionName: '색상', optionValueName: '빨강' },
      { optionKey: 'og1', optionValueKey: 'ov2', optionName: '색상', optionValueName: '파랑' },
    ],
    variants: [{ combination: 'ov1' }, { combination: 'ov2' }],
    categories: [],
    constraint: null,
    images: {},
  };

  it('표시명만 바꾸면 통과한다 (optionValueId 가 그대로라 매칭이 안전하다)', () => {
    const uploaded = {
      ...base,
      options: base.options.map((o) => ({ ...o, optionValueName: `${o.optionValueName}색` })),
    };
    expect(checkOptionStructure(uploaded, base)).toEqual([]);
  });

  it('옵션값을 추가하면 행 오류다', () => {
    const uploaded = { ...base, options: [...base.options, { optionKey: 'og1', optionValueKey: 'ov3', optionValueName: '초록' }] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('옵션값');
  });

  it('옵션값을 지우면 행 오류다', () => {
    const uploaded = { ...base, options: [base.options[0]] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('옵션값');
  });

  it('옵션 축을 추가하면 행 오류다', () => {
    const uploaded = { ...base, options: [...base.options, { optionKey: 'og2', optionValueKey: 'ov9', optionValueName: 'S' }] };
    expect(checkOptionStructure(uploaded, base).length).toBeGreaterThan(0);
  });

  it('조합 행이 빠지면 행 오류다', () => {
    const uploaded = { ...base, variants: [base.variants[0]] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('조합');
  });

  it('없던 조합을 만들면 행 오류다', () => {
    const uploaded = { ...base, variants: [...base.variants, { combination: 'ov1+ov2' }] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('조합');
  });

  it('같은 옵션키에 서로 다른 옵션명을 적으면 행 오류다', () => {
    const uploaded = { ...base, options: [base.options[0], { ...base.options[1], optionName: '컬러' }] };
    expect(checkOptionStructure(uploaded, base)[0].message).toContain('옵션명');
  });
});

describe('classifyImageSource', () => {
  it('UUID 는 fileId 다', () => {
    expect(classifyImageSource('0198f0a0-0000-7000-8000-000000000000')).toEqual({ kind: 'file_id' });
  });

  it('파일명은 file_name 이다', () => {
    expect(classifyImageSource('사진 1.JPG')).toEqual({ kind: 'file_name' });
  });

  it('http URL 은 오류다 — URL 소싱은 지원하지 않는다', () => {
    expect(classifyImageSource('https://example.com/a.jpg')).toEqual({
      error: 'URL 은 지원하지 않습니다. 파일을 직접 올리거나 파일명을 적어주세요.',
    });
  });
});

describe('resolveImageRefs', () => {
  const sheet = new Map([
    ['IMG-1', { rowNumber: 1, sourceValue: 'a.jpg' }],
    ['IMG-2', { rowNumber: 2, sourceValue: 'b.jpg' }],
  ]);
  const imageRow = (product: Record<string, string>) => ({
    rowNumber: 1,
    rowKey: 'P-1',
    kind: 'create' as const,
    bundle: { product, options: [], variants: [], categories: [], constraint: null },
    errors: [],
  });

  it('대표·부가는 main, 본문 디렉티브는 description 으로 추론한다', () => {
    const { refs } = resolveImageRefs(
      imageRow({ thumbnailImageKey: 'IMG-1', description: '앞::product-image{imageKey="IMG-2"}뒤' }),
      sheet,
    );
    expect(refs).toEqual([
      { imageKey: 'IMG-1', usage: 'main' },
      { imageKey: 'IMG-2', usage: 'description' },
    ]);
  });

  it('한 키가 대표와 본문에 함께 쓰이면 ref 가 둘 생긴다 (컨텍스트별 MIME·크기 제약이 다르다)', () => {
    const { refs } = resolveImageRefs(
      imageRow({ thumbnailImageKey: 'IMG-1', description: '::product-image{imageKey="IMG-1"}' }),
      sheet,
    );
    expect(refs).toEqual([
      { imageKey: 'IMG-1', usage: 'main' },
      { imageKey: 'IMG-1', usage: 'description' },
    ]);
  });

  it('같은 (키, 용도) 를 두 번 가리켜도 ref 는 하나다', () => {
    const { refs } = resolveImageRefs(
      imageRow({ thumbnailImageKey: 'IMG-1', additionalImageKeys: 'IMG-1|IMG-2' }),
      sheet,
    );
    expect(refs).toEqual([
      { imageKey: 'IMG-1', usage: 'main' },
      { imageKey: 'IMG-2', usage: 'main' },
    ]);
  });

  it('이미지 시트에 없는 키를 참조하면 행 오류다', () => {
    const { errors } = resolveImageRefs(imageRow({ thumbnailImageKey: 'IMG-9' }), sheet);
    expect(errors[0].message).toContain('IMG-9');
  });

  it('본문에 이미 fileId 로 박힌 디렉티브는 참조로 세지 않는다 (이미 해석된 값이다)', () => {
    const { refs, errors } = resolveImageRefs(
      imageRow({ description: '::product-image{fileId="0198f0a0-0000-7000-8000-000000000000"}' }),
      sheet,
    );
    expect(refs).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('buildCategoryPathIndex / resolveCategories', () => {
  const flat = [
    { id: 'c1', path: '여성패션', isActive: true },
    { id: 'c2', path: '여성패션>티셔츠', isActive: true },
    { id: 'c3', path: '신상품', isActive: true },
  ];
  const index = buildCategoryPathIndex(flat);

  it('이름 경로를 id 로 해석하고 대표를 가려낸다', () => {
    const result = resolveCategories(
      [
        { categoryPath: '여성패션>티셔츠', isPrimary: 'Y' },
        { categoryPath: '신상품', isPrimary: 'N' },
      ],
      index,
    );
    expect(result.categoryIds).toEqual(['c2', 'c3']);
    expect(result.primaryCategoryId).toBe('c2');
    expect(result.errors).toEqual([]);
  });

  it('없는 경로는 행 오류다', () => {
    const result = resolveCategories([{ categoryPath: '남성패션', isPrimary: 'Y' }], index);
    expect(result.errors[0].message).toContain('남성패션');
  });

  it('같은 경로 문자열이 둘 이상이면 모호로 행 오류다 (조용히 하나를 고르지 않는다)', () => {
    // 형제 중 동명 카테고리가 있으면 이름 경로가 같아진다 — 1단계 검증 보고서 8b 가 넘긴 항목.
    const ambiguous = buildCategoryPathIndex([...flat, { id: 'c4', path: '신상품', isActive: true }]);
    const result = resolveCategories([{ categoryPath: '신상품', isPrimary: 'Y' }], ambiguous);
    expect(result.errors[0].message).toContain('모호');
    expect(result.categoryIds).toEqual([]);
  });

  it('대표가 0개면 행 오류다', () => {
    const result = resolveCategories([{ categoryPath: '신상품', isPrimary: 'N' }], index);
    expect(result.errors[0].message).toContain('대표');
  });

  it('대표가 2개면 행 오류다', () => {
    const result = resolveCategories(
      [
        { categoryPath: '신상품', isPrimary: 'Y' },
        { categoryPath: '여성패션', isPrimary: 'Y' },
      ],
      index,
    );
    expect(result.errors[0].message).toContain('대표');
  });

  it('같은 카테고리를 두 번 적으면 행 오류다', () => {
    const result = resolveCategories(
      [
        { categoryPath: '신상품', isPrimary: 'Y' },
        { categoryPath: '신상품', isPrimary: 'N' },
      ],
      index,
    );
    expect(result.errors[0].message).toContain('중복');
  });

  it('행이 하나도 없으면 오류도 결과도 없다 (카테고리 변경 없음이다)', () => {
    expect(resolveCategories([], index)).toEqual({ categoryIds: [], errors: [] });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.structure.spec.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 옵션 구조 검사를 구현한다**

```ts
/**
 * 수정 행의 옵션 구조가 스냅샷과 **완전히 같은지** 본다.
 *
 * 위험선은 "구조 변경 vs 표시명 변경"이 아니라 정확히 **variant 별 optionValueId 집합이
 * 바뀌는가**다(스펙 §2.4). 바뀌면 `_comboKey` 가 달라져 매칭 인계가 깨지고, 매칭 없는
 * variant 는 `MATCHING_MISSING` 이라 재고 게이팅을 못 받아 **무한 판매된다**.
 *
 * 그래서 옵션값 추가·삭제와 축 변경을 지금 막는다. 여는 것은 additive 지만 열어놓고
 * 좁히는 것은 못 한다(스펙 §3.7).
 */
export function checkOptionStructure(uploaded: UploadedBundle, base: PrefillBundle): RowError[] {
  const errors: RowError[] = [];
  const push = (message: string, sheet: RowError['sheet'] = '옵션') =>
    errors.push({ sheet, rowNumber: 0, message });

  const baseValueKeys = new Set(base.options.map((o) => o.optionValueKey ?? ''));
  const uploadedValueKeys = new Set(uploaded.options.map((o) => o.optionValueKey ?? ''));

  const added = [...uploadedValueKeys].filter((k) => !baseValueKeys.has(k));
  const removed = [...baseValueKeys].filter((k) => !uploadedValueKeys.has(k));
  if (added.length > 0) push(`옵션값을 추가할 수 없습니다: ${added.join(', ')}`);
  if (removed.length > 0) push(`옵션값을 삭제할 수 없습니다: ${removed.join(', ')}`);

  // 한 옵션키에 옵션명이 두 값으로 적히면 어느 쪽이 맞는지 알 수 없다.
  const nameByGroup = new Map<string, string>();
  for (const row of uploaded.options) {
    const groupKey = row.optionKey ?? '';
    const name = row.optionName ?? '';
    const seen = nameByGroup.get(groupKey);
    if (seen === undefined) nameByGroup.set(groupKey, name);
    else if (seen !== name) push(`같은 옵션키에 서로 다른 옵션명이 적혀 있습니다: ${groupKey}`);
  }

  const baseCombos = new Set(base.variants.map((v) => v.combination ?? ''));
  const uploadedCombos = new Set(uploaded.variants.map((v) => v.combination ?? ''));
  const addedCombos = [...uploadedCombos].filter((c) => !baseCombos.has(c));
  const removedCombos = [...baseCombos].filter((c) => !uploadedCombos.has(c));
  if (addedCombos.length > 0) push(`없던 조합을 만들 수 없습니다: ${addedCombos.join(', ')}`, '조합');
  if (removedCombos.length > 0) push(`조합 행을 지울 수 없습니다: ${removedCombos.join(', ')}`, '조합');

  return errors;
}
```

- [ ] **Step 4: 이미지·카테고리 해석을 구현한다**

이미지:
- `classifyImageSource` — `new URL()` 로 파싱되고 스킴이 http/https 면 **오류**(URL 소싱은 이 스펙이 제거한 기능이다). UUID 정규식이면 `file_id`, 그 외는 `file_name`.
- `resolveImageRefs` — 대표(`thumbnailImageKey`) → `main`, 부가(`additionalImageKeys`, `|` 구분) → `main`, 본문(`description` 의 `::product-image{imageKey="…"}`) → `description`. 키가 이미지 시트에 없으면 행 오류. `(imageKey, usage)` 로 중복 제거. 본문에 이미 `fileId="…"` 로 박힌 디렉티브는 **그대로 둔다** — 프리필된 상세설명은 그 형태이고, 이미 해석된 참조다.

카테고리:
- `buildCategoryPathIndex` — 1단계 `flattenCategoryTree` 가 만든 것과 **같은 이름 경로 문자열**(`조상>자식`)을 키로, id 배열을 값으로 하는 인덱스. **배열인 이유**: 형제 중 동명 카테고리가 있으면 경로 문자열이 같아진다(1단계 검증 보고서 8b 가 앞으로 넘긴 항목). 
- `resolveCategories` — 인덱스 조회 결과가 0개면 `카테고리 경로를 찾을 수 없습니다`, 2개 이상이면 `카테고리 경로가 모호합니다(같은 이름의 카테고리가 둘 이상)` 로 **행 오류**. 조용히 하나를 고르지 않는다 — 카테고리는 노출 위치를 정하므로 그 실수는 발행 후에나 발견된다.
- 대표(`isPrimary='Y'`)가 정확히 1개가 아니면 행 오류. 같은 카테고리 중복 지정도 행 오류.

- [ ] **Step 5: 테스트 통과 확인 후 커밋**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.structure.spec.ts
npm run type-check:scoped
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.structure*.ts
git commit -m "feat(bulk-session): 옵션 구조 불변 검사 + 이미지/카테고리 해석"
```

---

### Task 8: 업로드 접수 API

**Files:**
- Create: `.../dto/create-bulk-session.dto.ts`, `.../dto/bulk-session-response.dto.ts`
- Create: `.../services/bulk-session.manager.ts` (이 태스크에서는 `accept` 만)
- Create: `.../services/bulk-session.service.ts`
- Create: `.../bulk-session.controller.ts` (이 태스크에서는 `POST` 만)
- Modify: `.../services/form-export-file.client.ts` (`download` 추가)
- Modify: `bulk-session.module.ts`
- Test: `.../services/bulk-session.manager.spec.ts`

**Interfaces:**
- Consumes: Task 4 의 `parseUploadWorkbook`, Task 1 의 `productBulkSessions`, 1단계의 `FormExportFileClient`
- Produces:
  - `BulkSessionManager.accept(input: { buffer: Buffer; fileName: string; name?: string; userId: string }, tx?): Promise<BulkSessionAcceptedDto>`
  - `FormExportFileClient.download(fileId: string, userId: string): Promise<Buffer>`
  - `POST /product-bulk-sessions` → 202 `{ sessionId, phase, totalRows }`

- [ ] **Step 1: exportId 3갈래 규칙을 테스트로 못 박는다**

**이 태스크의 존재 이유가 이 규칙이다** (스펙 §3.1 ⚠️ + §7 오버라이드의 필수 조건):

```ts
describe('BulkSessionManager.accept — exportId 3갈래', () => {
  it('exportId 가 없으면 신규 전용 세션이다', async () => {
    // 메타 시트 없는 워크북 → exportId null → 세션 생성, exportId 컬럼 null
  });

  it('exportId 가 있고 해석되면 정상 세션이다', async () => {
    // export 존재 + status='completed' + items 에 snapshot 있음
  });

  it('exportId 가 있는데 그 양식이 없으면 업로드를 거부한다', async () => {
    await expect(manager.accept(input)).rejects.toThrow('양식을 다시 받아');
  });

  it('exportId 는 있는데 items 에 스냅샷이 없으면 업로드를 거부한다', async () => {
    // 스냅샷 컬럼 이전에 만들어진 양식. 이걸 신규로 읽으면 카탈로그가 통째로 중복 생성된다.
    await expect(manager.accept(input)).rejects.toThrow('양식을 다시 받아');
  });

  it('거부할 때는 file-service 에 파일을 올리지 않는다', async () => {
    await expect(manager.accept(input)).rejects.toThrow();
    expect(fileClient.upload).not.toHaveBeenCalled();
  });
});
```

> **왜 "해석 안 되면 거부"가 선택이 아닌가**: 양식 잡은 30일 후 만료돼 스냅샷째 삭제되지만 워크북 파일은 작업자 디스크에 남는다. 그 파일을 "신규 전용 세션"으로 읽으면 **프리필된 전 행이 신규 상품으로 재분류돼 카탈로그가 통째로 중복 생성된다.** 1단계를 플래그 없이 노출하기로 한 사용자 결정이 이 경로를 실제로 도달 가능하게 만들었다(스펙 §7 말미).

- [ ] **Step 2: 파일 클라이언트에 download 를 더한다**

```ts
  /**
   * 업로드된 워크북을 바이트로 가져온다. 검증 레인이 파싱하려면 파일이 필요하고,
   * file-service 는 S3 서명 URL 만 주므로 두 번 왕복한다(URL 발급 → 실제 GET).
   */
  async download(fileId: string, userId: string): Promise<Buffer> {
    const url = await this.getDownloadUrl(fileId, userId);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`업로드 파일 다운로드 실패 (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
```

- [ ] **Step 3: DTO 를 만든다**

```ts
// create-bulk-session.dto.ts
export class CreateBulkSessionDto {
  @ApiPropertyOptional({ description: '세션 이름. 비우면 업로드 파일명이 들어간다.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

// bulk-session-response.dto.ts
export class BulkSessionAcceptedDto {
  @ApiProperty() sessionId: string;
  @ApiProperty({ enum: ['uploaded'] }) phase: 'uploaded';
  @ApiProperty({ description: '"상품" 시트 데이터 행 수' }) totalRows: number;
}
```

- [ ] **Step 4: 매니저의 accept 를 구현한다**

```ts
  /**
   * 업로드를 접수한다. 파싱·검증은 워커가 이어받는다 — 1,000행 × 7시트를 동기로 처리하면
   * ALB 60초를 넘긴다.
   *
   * **다만 파일 수준 게이트는 여기서 동기로 친다.** 파싱을 두 번 하는 비용을 감수하는 이유:
   * (1) "exportId 는 있는데 해석 안 됨"은 세션을 만들기 **전에** 막아야 하는 사고고,
   * (2) 깨진 파일·필수 열 누락에 즉시 400 을 주는 편이, 세션을 만들어놓고 한 틱 뒤에
   *     failed 로 뒤집는 것보다 작업자에게 훨씬 낫다.
   * 관리자 전용 라우트라 QPS 가 낮아 감당된다.
   */
  async accept(input: AcceptInput, tx?: DbTransaction): Promise<BulkSessionAcceptedDto> {
    const parsed = await parseUploadWorkbook(input.buffer); // 파일 오류는 BadRequestError 로 던진다

    if (parsed.exportId) {
      await this.assertExportUsable(parsed.exportId, tx);
    }

    const { fileId } = await this.fileClient.upload({
      buffer: input.buffer,
      fileName: input.fileName,
      userId: input.userId,
    });

    return this.db.run(async (trx) => {
      const [row] = await trx
        .insert(productBulkSessions)
        .values({
          name: (input.name ?? '').trim() || input.fileName,
          exportId: parsed.exportId,
          uploadedBy: input.userId,
          fileName: input.fileName,
          sourceFileId: fileId,
          phase: 'uploaded',
          totalRows: parsed.sheets.products.length,
        })
        .returning();
      if (!row) throw new Error('일괄 세션을 만들지 못했습니다');
      return { sessionId: row.id, phase: 'uploaded' as const, totalRows: row.totalRows };
    }, tx);
  }

  /**
   * "없음" 과 "있지만 모름" 을 가른다. 후자는 **업로드 거부**다 — 스펙 §3.1 ⚠️.
   *
   * 소유권은 보지 않는다. 양식을 만든 사람과 올리는 사람이 다른 것은 정상 업무다
   * (MD 가 만들어 팀원에게 넘긴다). 여기서 노출되는 정보는 "이 양식이 아직 유효한가"
   * 하나뿐이고, 그건 파일을 이미 손에 든 사람만 물을 수 있는 질문이다.
   */
  private async assertExportUsable(exportId: string, tx?: DbTransaction): Promise<void> {
    const RETRY = '이 양식은 더 이상 사용할 수 없습니다. 양식을 다시 받아 작업해 주세요.';
    await this.db.run(async (trx) => {
      const [job] = await trx
        .select({ status: productFormExports.status })
        .from(productFormExports)
        .where(eq(productFormExports.id, exportId))
        .limit(1);
      if (!job || job.status !== 'completed') throw new BadRequestError(RETRY);

      const [item] = await trx
        .select({ snapshot: productFormExportItems.snapshot })
        .from(productFormExportItems)
        .where(eq(productFormExportItems.exportId, exportId))
        .limit(1);
      // items 가 0행인 양식(active 있는 상품이 하나도 없었다)은 프리필 행이 없다는 뜻이라
      // 신규 전용과 실질적으로 같다 — 거부하지 않는다. 행은 있는데 스냅샷이 NULL 인 것만
      // 거부한다(스냅샷 컬럼 이전에 만들어진 양식).
      if (item && item.snapshot === null) throw new BadRequestError(RETRY);
    }, tx);
  }
```

- [ ] **Step 5: 서비스·컨트롤러·모듈을 배선한다**

```ts
// bulk-session.controller.ts
@ApiTags('Product Bulk Session')
@Controller('product-bulk-sessions')
export class BulkSessionController {
  constructor(private readonly service: BulkSessionService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiOperation({ summary: '작성한 양식 업로드 접수. 파싱·검증은 워커가 이어받는다.' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 202, type: BulkSessionAcceptedDto })
  @ApiResponse({ status: 400, description: '파일 오류 또는 해석할 수 없는 양식' })
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateBulkSessionDto,
    @User() user: { userId: string },
  ): Promise<BulkSessionAcceptedDto> {
    if (!file) throw new BadRequestException('file is required');
    return this.service.upload({
      buffer: file.buffer,
      fileName: file.originalname,
      name: dto.name,
      userId: user.userId,
    });
  }
}
```

`MAX_UPLOAD_BYTES = 10 * 1024 * 1024` 를 파서 옆에 상수로 두고 주석에 스펙 §6 을 적는다: *수천 행 × 7시트면 10MB 를 넘을 수 있다. 실측 후 조정한다 — 지금은 v3 값에서 출발한다.*

모듈에 `BulkSessionController`·`BulkSessionService`·`BulkSessionManager` 를 등록한다. `bulk-session.module.spec.ts`(1단계가 만든 DI 부트 스펙)에 새 프로바이더가 해석되는지 케이스를 더한다.

- [ ] **Step 6: 테스트와 게이트 후 커밋**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/
npm run type-check:scoped
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "feat(bulk-session): 업로드 접수 202 + 해석 불가 양식 거부"
```

---

### Task 9: 검증 레인 워커

**Files:**
- Create: `.../services/bulk-session-job.manager.ts`
- Create: `.../services/bulk-session-job.worker.ts`
- Test: `.../services/bulk-session-job.manager.spec.ts`
- Modify: `bulk-session.module.ts`

**Interfaces:**
- Consumes: Task 2~7 전량
- Produces:
  - `BulkSessionJobManager.claim(tx?): Promise<ClaimedBulkSession | null>` — `phase IN ('uploaded','validating')`
  - `.runParseSlice(claimed): Promise<void>` — `uploaded` → items·images 적재 → `validating`
  - `.runValidateSlice(claimed): Promise<void>` — `payload IS NULL` 인 행을 슬라이스만큼 검증 → 다 끝나면 `review`
  - `.recordJobError(sessionId, message)`, `.clearConsecutiveFailures(sessionId)`
  - 상수: `DEFAULT_BULK_LEASE_MS = 60_000`, `DEFAULT_VALIDATE_SLICE = 20`, `MAX_CONSECUTIVE_BULK_FAILURES = 10`

- [ ] **Step 1: 잡 매니저를 구현한다**

claim·renewLease·releaseLease·recordJobError·clearConsecutiveFailures 는 **v3 `product-import-job.manager.ts` 에서 컬럼만 바꿔 그대로 가져온다** — 스펙 §3.11 이 "공통 추상화는 뽑지 않는다"고 못 박았다(옛 임포트가 6단계에서 제거되므로 중복이 일시적이다).

```ts
  /**
   * 파싱·검증 대상 세션 하나를 원자적으로 잡는다.
   *
   * `uploaded` 와 `validating` 을 둘 다 후보로 둔다 — 전자는 첫 파싱, 후자는 이어서 검증
   * (또는 lease 가 만료된 재개)이다. `cancel_requested_at IS NULL` 가드는 취소된 세션을
   * 다시 집지 않게 한다.
   */
  async claim(tx?: DbTransaction): Promise<ClaimedBulkSession | null> {
    const leaseToken = uuidv7();
    return this.db.run(async (trx) => {
      const rows = await trx.execute<{ id: string; phase: string }>(sql`
        UPDATE product_bulk_sessions
           SET lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid,
               updated_at = NOW()
         WHERE id = (
           SELECT id
             FROM product_bulk_sessions
            WHERE phase IN ('uploaded', 'validating')
              AND (lease_until IS NULL OR lease_until < NOW())
              AND cancel_requested_at IS NULL
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id, phase
      `);
      // drizzle 의 execute 는 postgres-js RowList 를 돌려주며 제네릭이 원소 타입까지
      // 좁혀주지 않는다 — form-export-job.manager.ts:97 과 같은 선례.
      const [row] = rows as unknown as Array<{ id: string; phase: string }>;
      return row ? { sessionId: row.id, leaseToken, phase: row.phase } : null;
    }, tx);
  }
```

**파싱 슬라이스** — 한 트랜잭션에서 끝낸다(부분 산출물이 없다):

```ts
  /**
   * 워크북을 내려받아 items·images 를 만들고 phase 를 validating 으로 민다.
   *
   * 슬라이스로 쪼개지 않는 이유: 파싱은 파일 하나를 통째로 읽는 일이라 중간 산출물이
   * 없다. 대신 **한 트랜잭션**에 넣어 재개가 공짜가 되게 한다 — 죽으면 통째로 다시 한다.
   * 토큰 CAS 를 트랜잭션의 **첫 문장**으로 둔다(1단계 runExport 가 이 순서를 뒤집었다가
   * 좀비가 후임의 items 를 덮어쓰는 데이터 손상을 냈다).
   */
  async runParseSlice(claimed: ClaimedBulkSession): Promise<void> { ... }
```

파싱 슬라이스가 하는 일, 순서대로:
1. 세션 행을 읽어 `sourceFileId`·`uploadedBy`·`exportId` 를 얻는다.
2. `fileClient.download()` → `parseUploadWorkbook()`. 여기서 던지는 파일 오류는 **세션 전체 `failed`** 로 확정하고 `phase_error` 에 메시지를 남긴다(재업로드가 유일한 답이다 — 스펙 §3.12 파일 층).
3. `exportId` 가 있으면 `product_form_export_items` 를 읽어 `rowKey → { masterId, versionId, snapshot, pricingEditable }` 맵을 만든다.
4. `assembleUpload(parsed, new Set(map.keys()))`.
5. 한 트랜잭션에서: 토큰 CAS → items insert → images insert → `phase='validating'`, `total_rows` 갱신.
   - `input` 은 `BulkItemInput` 이다 — `{ bundle, present: { products: [...], ... }, errors }`. **`present` 는 배열로 눕혀 담는다**(Set 은 jsonb 왕복에서 `{}` 가 된다 — Task 3 주석 참조).
   - `payload` 는 NULL 로 둔다. 그게 "아직 검증 안 됨"의 유일한 표시다.
   - update 행은 `base_snapshot`·`base_version_id`·`master_id` 를 export item 에서 복사한다.
6. **상품에 붙지 않는 시트 오류**(`assembleUpload` 의 `errors` — 고아 참조, 이미지키 중복 등)는 **합성 아이템**으로 남긴다: `row_key = '__orphan__:<시트>:<행번호>'`, `kind='create'`, `status='invalid'`, `payload = {}`(검증 슬라이스가 집지 않도록), `error_message` 에 메시지. 세션 전체를 실패시키지 않는 이유는 오타 한 줄 때문에 나머지 999행을 재업로드시키는 것이 나쁘기 때문이고, 그렇다고 버리면 **조용히 무시된 참조**가 되어 작업자가 왜 이미지가 빠졌는지 영영 모른다. 아이템 목록에 invalid 로 뜨는 것이 사람이 실제로 보는 자리다.
7. 이미지 행: `(imageKey, usage)` 단위. `source_kind='file_id'` 면 `status='resolved'` + `file_id` 채움, `file_name` 이면 `status='awaiting_upload'`. **오류 없는 행이 참조하는 것만** 만든다.

**검증 슬라이스**:

```ts
  async runValidateSlice(claimed: ClaimedBulkSession): Promise<void> {
    const items = await this.db.run((trx) =>
      trx.select().from(productBulkItems)
        .where(and(eq(productBulkItems.sessionId, sessionId), isNull(productBulkItems.payload)))
        .orderBy(productBulkItems.rowNumber)
        .limit(this.validateSlice),
    );

    if (items.length === 0) {
      // 남은 미검증 행이 없다 → review 로 넘긴다. 토큰 CAS + 취소 가드를 건다.
      return this.finishValidating(sessionId, leaseToken);
    }

    // 카테고리 트리는 행과 무관한 전역 참조라 슬라이스당 한 번만 읽는다.
    // 1단계 리더가 쓰는 것과 **같은** 평탄화를 쓴다(Task 2 가 export 로 열었다) — 양식에
    // 적힌 경로 문자열과 여기서 만드는 인덱스 키가 다르면 멀쩡한 경로가 전부 미해석이 된다.
    // includeInactive=true 인 것도 그대로다: 이미 비활성 카테고리에 배정된 상품의 경로가
    // 인덱스에서 빠지면, 카테고리를 건드리지도 않은 행이 통째로 오류가 된다.
    const tree = await this.categories.getCategoryTree(undefined, true, trx);
    const index = buildCategoryPathIndex(flattenCategoryTree(tree.categories));

    for (const item of items) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) { /* 즉시 중단 — 후임과 같은 행을 나란히 처리하면 안 된다 */ return; }
      if (lease.canceled) { await this.releaseLease(sessionId, leaseToken); return; }

      await this.validateOne(item, index);
    }

    await this.releaseLease(sessionId, leaseToken);
  }
```

`validateOne` 한 행의 순서:
1. `input` 을 가드로 되읽는다(`isBulkItemInput`) — 형식이 다르면 그 행만 `invalid` 로 만들고 계속한다(롤링 배포에서 옛 코드가 쓴 행을 만나도 세션 전체가 죽지 않게). `present` 는 `toPresentColumns` 로 Set 으로 되살린다.
2. 접합 단계 오류가 이미 있으면 그대로 `invalid` 로 굳힌다.
3. `validateFields(row, { pricingEditable })` — 수정 행의 `pricingEditable` 은 **export item 에서 얼린 값**이다(스펙 §3.8: 업로드 시점에 다시 판정하면 워크북의 센티넬과 어긋난다). 신규 행은 항상 `true`.
4. 수정 행이면:
   - `base = flattenBundle(item.baseSnapshot)`
   - `current = flattenBundle(await snapshotReader.renderMaster(trx, masterId, createImageKeyAllocator(baseSnapshot.images), pathIndex))`
     - `renderMaster` 가 null 이면 → `invalid`, `기준 상품의 판매 중인 버전을 찾을 수 없습니다`
   - `checkOptionStructure(uploaded, baseSnapshot)`
   - `mine = flattenBundle(uploaded, present)`
   - `changes = computeChanges(base, mine)`, `conflicts = detectConflicts(base, mine, current)`
5. 신규 행이면 `changes = flattenBundle(uploaded, present)` 전량, `conflicts = {}`.
6. `resolveImageRefs`·`resolveCategories` 결과를 payload 에 얹는다.
7. 오류가 하나라도 있으면 `status='invalid'` + `error_message`(시트·행 번호 포함), 아니면 `status='pending'`. **어느 쪽이든 `payload` 를 쓴다** — NULL 이 "미검증"의 유일한 의미여야 한다.

- [ ] **Step 2: 워커를 만든다**

v3 `product-import-job.worker.ts` 와 같은 모양이다 — `@Cron(CronExpression.EVERY_5_SECONDS)` + `isProcessing` 가드 + 킬스위치.

```ts
  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_BULK_SESSION_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled || this.isProcessing) return;
    this.isProcessing = true;
    let claimed: ClaimedBulkSession | null = null;
    try {
      claimed = await this.jobManager.claim();
      if (!claimed) return;
      if (claimed.phase === 'uploaded') await this.jobManager.runParseSlice(claimed);
      else await this.jobManager.runValidateSlice(claimed);
      // 여기 도달했다는 건 슬라이스가 예외 없이 끝났다는 뜻이다. catch 에서 부르면 안 된다
      // (리셋이 연속 실패 상한을 영원히 막는다).
      await this.jobManager.clearConsecutiveFailures(claimed.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(
        `일괄 세션 슬라이스 실패 (session=${claimed?.sessionId ?? 'none'}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (claimed) await this.jobManager.recordJobError(claimed.sessionId, message);
    } finally {
      this.isProcessing = false;
    }
  }
```

- [ ] **Step 3: 단위 테스트를 쓴다**

목 하네스는 1단계 `form-export-job.manager.spec.ts` 의 것을 그대로 쓴다(`DbService` 를 목으로 두고 `update`/`insert` 호출을 캡처, `renderQuery` 로 WHERE 절을 SQL 문자열로 렌더해 확인). 각 케이스가 세워야 하는 사실:

| describe | 테스트 이름 | 통과 조건 |
|---|---|---|
| `runParseSlice` | 파일 오류가 나면 세션을 failed 로 확정한다 | `parseUploadWorkbook` 이 던지면 `phase='failed'` + `phase_error` 에 그 메시지, items insert 0회 |
| | exportId 가 있는 세션은 items 에 base_snapshot·base_version_id·master_id 를 채운다 | insert 값에 세 컬럼이 export item 값과 같게 들어간다 |
| | exportId 가 없는 세션의 모든 행은 kind=create 다 | insert 값 전량 `kind: 'create'`, `baseSnapshot: null` |
| | present 를 배열로 눕혀 담는다 | insert 된 `input.present.products` 가 `Array.isArray` 를 만족한다 (Set 이면 jsonb 왕복에서 `{}` 가 된다) |
| | 이미지 시트의 fileId 행은 resolved, 파일명 행은 awaiting_upload 다 | images insert 값의 `status`·`fileId` |
| | 상품에 못 붙는 시트 오류는 합성 아이템으로 남는다 | `row_key` 가 `__orphan__:` 로 시작하고 `status='invalid'`, `payload={}` |
| | 마감 CAS 가 0행이면 items 를 쓰지 않는다 | CAS update 가 빈 배열을 반환하면 insert 호출 0회 (1단계 runExport 가 이 순서를 뒤집었다가 데이터 손상을 냈다) |
| `runValidateSlice` | 검증한 행은 오류가 없어도 payload 를 쓴다 | 변경 0건인 수정 행도 `payload = { fields: {} }` 로 업데이트된다 — NULL 이 "미검증"의 유일한 의미여야 한다 |
| | 오류가 있으면 status=invalid 로 굳힌다 | `error_message` 에 `[옵션 3행]` 꼴의 시트·행 좌표가 들어간다 |
| | lease 를 잃으면 즉시 멈춘다 | `renewLease` 가 0행이면 그 뒤 아이템 업데이트가 없다 |
| | 취소 요청을 만나면 lease 만 놓고 멈춘다 | `releaseLease` 1회, 아이템 업데이트 0회 |
| | 미검증 행이 없으면 phase 를 review 로 민다 | 마감 update 에 토큰 CAS + `cancel_requested_at IS NULL` 가드가 함께 걸린다 |
| | 기준 상품의 active 가 사라졌으면 그 행만 invalid 다 | `renderMaster` 가 null 을 주면 그 행만 invalid, 슬라이스는 계속 돈다 |
| | 가격 표현 가능 여부는 export item 에 얼린 값을 쓴다 | `pricingEditable=false` 인 아이템은 현재 룰이 단순해도 센티넬 규칙으로 검증된다 (업로드 시점 재판정 금지 — 스펙 §3.8) |

- [ ] **Step 4: 테스트와 게이트 후 커밋**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/
npm run type-check:scoped
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "feat(bulk-session): 검증 레인 — 파싱 슬라이스 + 행 검증 슬라이스"
```

---

### Task 10: 조회 · 충돌 결정 · 승인 · 취소 API

**Files:**
- Create: `.../services/bulk-session.reader.ts`
- Create: `.../dto/conflict-decision.dto.ts`
- Modify: `.../services/bulk-session.manager.ts`, `.../services/bulk-session.service.ts`, `.../bulk-session.controller.ts`, `.../dto/bulk-session-response.dto.ts`
- Test: `.../services/bulk-session.reader.spec.ts`, `.../services/bulk-session.manager.spec.ts` (확장)

**Interfaces:**
- Produces (라우트 6개):

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/product-bulk-sessions` | 내 세션 목록(페이지) |
| `GET` | `/product-bulk-sessions/:id` | 세션 요약 + 단계별 집계(폴링 대상, 행 목록 없음) |
| `GET` | `/product-bulk-sessions/:id/items` | 행 목록(`status` 필터·페이지). 변경분·충돌·라벨 포함 |
| `PATCH` | `/product-bulk-sessions/:id/items/:itemId/conflict-decision` | 필드별 `overwrite`/`skip` |
| `POST` | `/product-bulk-sessions/:id/approve` | `review` → `awaiting_images` \| `drafting` |
| `POST` | `/product-bulk-sessions/:id/cancel` | 진행 중 phase → `canceled` |

- [ ] **Step 1: 집계·목록 리더를 구현한다**

```ts
  /**
   * 진행률은 **매번 집계한다** — 카운터 컬럼을 두면 워커가 중단됐을 때 드리프트한다
   * (v3 2단계 결론). 행 목록이 없어 응답 크기가 세션 크기와 무관하므로 폴링은 이쪽으로 한다.
   */
  async getProgress(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto> {
    // items GROUP BY status, images GROUP BY status
  }
```

행 목록 응답의 한 행:

```ts
export class BulkSessionItemDto {
  rowNumber: number;
  rowKey: string;
  kind: 'create' | 'update';
  status: 'pending' | 'invalid' | 'drafted' | 'excluded' | 'failed';
  masterId: string | null;
  errorMessage: string | null;
  /** 이 행이 실제로 바꾸는 것. 라벨은 서버가 붙인다 — 화면이 매핑을 또 들고 있지 않도록. */
  changes: Array<{ field: string; label: string; before: string; after: string }>;
  /** 사람이 결정해야 하는 것만. 비어 있으면 승인에 걸림돌이 없다. */
  conflicts: Array<{ field: string; label: string; base: string; mine: string; current: string; decision: 'overwrite' | 'skip' | null }>;
}
```

- [ ] **Step 2: 충돌 결정 API 를 구현한다**

```ts
export class ConflictDecisionDto {
  @ApiProperty({ description: '필드경로 → overwrite | skip', type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  decisions: Record<string, 'overwrite' | 'skip'>;
}
```

규칙(테스트가 강제한다):
- `phase !== 'review'` 면 `ConflictError`.
- 결정 키가 그 행의 `conflict` 키에 없으면 `BadRequestError` — 충돌하지도 않은 필드에 결정을 다는 것은 화면이 낡았다는 뜻이다.
- 값이 `overwrite`/`skip` 이 아니면 `BadRequestError`.
- **부분 갱신을 허용한다** — 기존 `conflict_decision` 에 머지한다. 수백 행짜리 세션에서 한 번에 다 보내라고 요구할 수 없다.

- [ ] **Step 3: 승인·취소를 구현한다**

```ts
  /**
   * 검토 완료. 미결정 충돌이 하나라도 있으면 거부한다 — "덮어쓰기"는 항상 남의 편집을
   * 되돌리는 결정이라 기본값을 서버가 정할 수 없다(스펙 §3.6).
   *
   * 다음 phase 는 요구 이미지가 남았는지로 갈린다: 하나라도 awaiting_upload 면
   * `awaiting_images`(3단계가 게이트를 연다), 없으면 곧장 `drafting`(4단계 워커 대상).
   * **2단계에는 그 두 phase 를 처리하는 워커가 아직 없다** — 승인된 세션은 거기서 멈춘 채
   * 기다린다. 그게 의도다.
   */
  async approve(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto>
```

- 미결정 충돌 수를 세어 `ConflictError(\`결정하지 않은 충돌이 ${n}건 있습니다\`)`.
- 취소: `phase NOT IN ('published','canceled')` 이면 `cancel_requested_at = NOW()` + `phase='canceled'`. **`failed` 도 취소 대상이다** — v3 는 굳은 세션이 취소도 409 를 받아 영영 못 풀렸다(스펙 §3.2). 이미 종단이면 `ConflictError`.
- 취소 시 이미지 정리는 **3단계 몫이다** — 2단계 시점의 이미지 행은 우리가 올린 파일이 아니라 프리필 fileId 이거나 아직 파일이 없는 것뿐이라 지울 것이 없다. 이 사실을 `cancel` 의 주석에 남긴다.

- [ ] **Step 4: 테스트**

| describe | 테스트 이름 | 통과 조건 |
|---|---|---|
| `getProgress` | 단계별 집계를 매번 계산한다 | items 를 status 로, images 를 status 로 GROUP BY 하는 쿼리가 나가고 카운터 컬럼을 읽지 않는다 |
| | 남의 세션은 404 다 | `uploadedBy` 불일치도 `NotFoundError` (403 을 주면 그 자체가 존재 여부 오라클이다) |
| `getItems` | 변경분에 서버가 붙인 라벨이 함께 온다 | `changes[0].label === '판매가'` |
| | 결정하지 않은 충돌은 `decision: null` 로 온다 | `conflicts[0].decision` |
| `setConflictDecision` | review 가 아니면 409 다 | `phase='validating'` 이면 `ConflictError` |
| | 충돌하지 않은 필드에 결정을 달면 400 이다 | 그 행 `conflict` 에 없는 키 → `BadRequestError` (화면이 낡았다는 뜻이다) |
| | overwrite/skip 이 아닌 값은 400 이다 | |
| | 부분 갱신은 기존 결정에 머지된다 | 두 번 호출하면 두 필드가 다 남는다 (수백 행 세션에서 한 번에 다 보내라고 할 수 없다) |
| `approve` | 미결정 충돌이 있으면 409 다 | 메시지에 미결정 건수가 들어간다 |
| | 요구 이미지가 남아 있으면 awaiting_images 로 간다 | `awaiting_upload` 이미지가 1건이라도 있으면 |
| | 요구 이미지가 없으면 drafting 으로 간다 | |
| | review 가 아니면 409 다 | |
| `cancel` | 검증 중인 세션을 취소하면 cancel_requested_at 과 phase 가 함께 찍힌다 | 워커의 `renewLease` 가 returning 으로 감지한다 |
| | **failed 세션도 취소할 수 있다** | v3 는 굳은 세션이 취소도 409 를 받아 영영 못 풀렸다(스펙 §3.2) |
| | published·canceled 는 409 다 | 종단은 덮지 않는다 |

- [ ] **Step 5: 게이트 후 커밋**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/
npm run type-check:scoped
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "feat(bulk-session): 프리뷰 조회 + 필드별 충돌 결정 + 승인/취소"
```

---

### Task 11: 통합 테스트와 마무리 검증

**Files:**
- Create: `.../services/bulk-session-lease.integration.spec.ts`
- Create: `.../services/bulk-session-merge.integration.spec.ts`
- Modify: `package.json` (`test:bulk-session:integration`)
- Create: `docs/superpowers/reports/2026-08-01-product-bulk-session-stage2-verification.md`

- [ ] **Step 1: lease 소유권 통합 테스트**

1단계 `form-export-job-lease.integration.spec.ts` 를 본뜬다 — **일회용 스키마를 만들고 모든 커넥션의 `search_path` 를 접속 startup 파라미터로 고정한다**(`SET search_path` 는 postgres.js 가 물리 재연결하면 조용히 public 으로 돌아간다). `claim()` 에는 세션을 골라내는 필터가 없으므로 public 에 붙으면 이 스위트가 남의 대기 세션을 집어 running 으로 만들어놓고 되돌리지 않는다.

| 테스트 이름 | 통과 조건 |
|---|---|
| claim 은 대기 세션 하나만 잡고 lease 를 미래로 민다 | 반환 토큰이 UUIDv7, `lease_until > NOW()` |
| lease 가 살아 있는 세션은 두 번째 워커가 못 잡는다 | 두 번째 `claim()` 이 null |
| lease 가 만료되면 후임이 이어받는다 | `lease_until` 을 과거로 밀면 다시 잡힌다 (재개 경로) |
| 옛 토큰으로는 마감하지 못한다 | 좀비 토큰으로 `finishValidating` 하면 0행 매치, phase 가 후임 값 그대로 |
| `cancel_requested_at` 이 찍힌 세션은 claim 되지 않는다 | |
| 검증 슬라이스 중 취소가 들어오면 남은 행을 건드리지 않는다 | 3행 중 1행 처리 후 취소 → 나머지 2행의 `payload` 가 여전히 NULL |
| payload·input jsonb 왕복 후에도 값이 전부 문자열이다 | 되읽은 객체의 모든 leaf 에 `typeof === 'string'` (v3 3단계가 여기서 Date 로 죽었다) |
| `payload IS NULL` 이 미검증의 유일한 의미다 | 검증 끝난 행을 다시 claim 해도 슬라이스가 그 행을 다시 집지 않는다 |

- [ ] **Step 2: 병합 시나리오 통합 테스트 — 이 단계의 핵심 주장**

스펙 §8 이 "핵심 주장 하나를 통합 테스트로 못 박는다"고 지목한 그것이다. 다만 **발행까지는 4·5단계 몫이므로, 2단계가 증명할 수 있는 데까지만 증명하고 나머지는 명시적으로 남긴다.**

실 Postgres 픽스처의 뼈대(모든 케이스가 공유한다):

1. 상품 하나를 만들고 발행한다 — `brand='ACME'`, `name='티셔츠'`.
2. `FormExportSnapshotReader.buildPrefill` → `product_form_exports`·`items` 를 만들고 워크북 버퍼를 얻는다. 여기서 `items.snapshot` 이 값으로 남는다.
3. **남**이 그 사이 상품을 바꾼다(케이스마다 다르다 — 정상 draft→publish 경로 / active 인플레이스 경로).
4. **작업자**는 받은 워크북의 특정 셀만 고친 버퍼를 만든다(`buildFormWorkbook` 으로 재조립하면 셀 편집을 코드로 표현할 수 있다).
5. 세션을 만들고 `runParseSlice` → `runValidateSlice` 를 직접 부른다(워커 크론은 태우지 않는다 — 타이밍에 의존하는 테스트는 목이 초록인 채 깨진다).
6. `product_bulk_items` 를 읽어 `payload`·`conflict` 를 확인한다.

| 테스트 이름 | 통과 조건 |
|---|---|
| 작업자가 A필드를, 남이 B필드를 바꿨으면 충돌이 없고 payload 에 A 만 남는다 | `conflict === {}` 이고 `payload.fields` 의 키가 `['product.name']` 하나뿐. **`product.brand` 가 없는 것이 이 테스트의 요점이다** — 4단계의 포크-후-적용이 남의 값을 보존한다는 것이 여기에 걸려 있다 |
| 둘이 같은 필드를 바꿨으면 충돌로 잡힌다 | `conflict['product.name']` 에 `base`·`mine`·`current` 세 값이 다 담긴다 |
| **남이 brand 를 active 행에 인플레이스로 바꿔도 충돌로 잡힌다** | `product-bulk.service.ts` 의 `bulkUpdate` 경로(= active 행 직접 UPDATE)로 brand 를 바꾸고, 작업자도 brand 를 바꿔 올린다 → 충돌 1건. **§F1 의 회귀 잠금** — versionId 재구성 설계에서는 이 케이스가 조용히 통과해 남의 값이 되돌아갔다 |
| 이미지를 건드리지 않은 행은 이미지 필드가 변경으로 뜨지 않는다 | `payload.fields` 에 `product.thumbnailImageKey`·`product.additionalImageKeys` 가 없다. 이미지 키 seed 회귀 잠금(seed 를 빼면 `IMG-1` 부터 다시 번호가 붙어 전 행이 변경으로 뜬다) |
| 열을 통째로 지운 파일은 그 필드를 비우지 않는다 | '브랜드' 열이 없는 워크북 → `payload.fields` 에 `product.brand` 없음. (열 부재를 "비움"으로 읽으면 파일 하나가 전 상품의 브랜드를 날린다) |

> **정직하게 남길 것**: "발행 후에도 둘 다 살아있는가"의 *발행* 절반은 4·5단계가 생긴 뒤에야 검증된다. 2단계가 증명하는 것은 "payload 가 A 만 담고 B 를 안 건드린다"까지다. 검증 보고서에 이 경계를 적는다.

- [ ] **Step 3: 스크립트 추가**

```json
"test:bulk-session:integration": "REQUIRE_BULK_SESSION_DB=1 dotenv -e apps/core/.env -- jest --testPathPattern=bulk-session.*integration"
```

- [ ] **Step 4: 전량 실행**

```bash
# 유닛
npx jest apps/core/src/modules/catalog/operations/bulk-session/

# 통합 (scratch DB — dev_core 를 절대 쓰지 않는다)
docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS bulk_stage2_scratch"
docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE bulk_stage2_scratch"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" npx drizzle-kit migrate --config apps/core/drizzle.config.ts
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" npm run test:bulk-session:integration
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage2_scratch" npm run test:form-export:integration

# 이웃 모듈 회귀
npx jest apps/core/src/modules/catalog/operations/import/

# 게이트
npm run type-check:scoped
npx eslint $(git diff --name-only develop...HEAD -- 'apps/**/*.ts')
```

- [ ] **Step 5: 마이그레이션 안전성 확인**

```bash
grep -ci "drop\|alter type" apps/core/drizzle/<timestamp>_product-bulk-sessions.sql   # 0
git diff develop...HEAD -- apps/core/drizzle/meta/_journal.json                        # 항목 1개만 추가, 재정렬 없음
```

- [ ] **Step 6: 검증 보고서를 쓴다**

`docs/superpowers/reports/2026-08-01-product-bulk-session-stage2-verification.md` 에 1단계 보고서와 같은 구성으로: 테스트/게이트 증거, 전역 회귀 차분(baseline 클론 비교), 마이그레이션 안전성, 이연 항목 트리아지, 사람이 해야 할 일(수동 스모크·배포 선행조건).

- [ ] **Step 7: 커밋**

```bash
git add .
git commit -m "test(bulk-session): lease·취소·병합 시나리오 통합 테스트 + 2단계 검증 보고서"
```

---

## 수동 스모크 (사람)

2단계는 화면이 없으므로 curl 로 돈다. `AUTH` 는 admin 토큰이다.

1. 1단계 화면에서 상품 3건을 골라 양식을 받는다.
2. 엑셀에서 한 상품의 **상품명**만 고친다. 다른 상품은 손대지 않는다.
3. `curl -X POST $CORE/product-bulk-sessions -H "$AUTH" -F file=@양식.xlsx -F name=스모크` → 202 + sessionId
4. `curl $CORE/product-bulk-sessions/$ID -H "$AUTH"` 를 몇 초 간격으로 → `phase` 가 `uploaded`→`validating`→`review` 로 간다.
5. `curl "$CORE/product-bulk-sessions/$ID/items" -H "$AUTH"` → 고친 상품 1건만 `changes` 에 상품명 한 줄, 나머지 2건은 `changes: []`.
6. **충돌 스모크**: 4번과 5번 사이에 admin 화면에서 그 상품의 상품명을 다른 값으로 바꿔 발행한 뒤 업로드하면 `conflicts` 에 한 줄이 뜬다. `PATCH .../conflict-decision` 으로 `skip` 을 주고 `POST .../approve` → `phase` 가 `drafting`(또는 이미지가 있으면 `awaiting_images`)이 된다.
7. **거부 스모크**: `product_form_exports` 에서 그 양식 행을 지우고 같은 파일을 다시 올린다 → **400** 과 "양식을 다시 받아" 문구. (이게 실패하면 카탈로그 중복 생성 사고가 열려 있는 것이다 — 머지 금지.)
8. **취소 스모크**: 큰 파일을 올려 `validating` 인 동안 `POST .../cancel` → 진행이 멈추고 `phase='canceled'`, 이후 워커 로그에 그 세션이 다시 나타나지 않는다.

## 배포 선행조건

- 마이그레이션은 **전부 additive** → ADR-0005 §5 **expand phase = `migrate` → `deploy`** 순서.
  ```
  npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes
  ```
- **1단계와 함께 나가야 한다** — 이 브랜치는 1단계 위에 스택돼 있다. 1단계의 배포 선행조건(file-service `product-bulk-form` 컨텍스트 `db:seed:ref`)이 먼저다.
- 배포 순서: `migrate` → file-service → `db:seed:ref` → core. (admin-web 은 이 단계에 변경이 없다.)
- **신규 시크릿 없음.** `AUTH_SECRET`·`FILE_SERVICE_URL` 은 Core live env 에 이미 있다.
- 새 환경변수 (전부 안전한 기본값):

| 변수 | 기본값 | 위치 |
|---|---|---|
| `PRODUCT_BULK_SESSION_WORKER_ENABLED` | `'false'` 문자열이 아니면 켜짐 | `bulk-session-job.worker.ts` |
| `BULK_SESSION_LEASE_MS` | `60_000` | `bulk-session-job.manager.ts` |
| `BULK_SESSION_VALIDATE_SLICE` | `20` | `bulk-session-job.manager.ts` |

## 이 계획이 남기는 것 (다음 단계로 넘어가는 것)

- **`awaiting_images`·`drafting` 을 처리하는 워커가 없다.** 승인된 세션은 거기서 멈춘 채 기다린다 — 3·4단계가 이어받는다. 2단계만 배포된 상태에서 승인까지 가면 세션이 그 phase 에 남는다(취소로 풀 수 있다).
- **취소 시 이미지·draft 정리 없음** — 3·5단계 몫. 2단계 시점에는 지울 것이 없다.
- **`변경분` 이 실제로 적용되는지는 4단계가 증명한다.** 2단계는 "무엇을 적용할지"까지만 확정한다.
- **`productCode` 유니크 충돌은 발행 시점에야 확정된다**(스펙 §5.2). 다른 master 와의 충돌이라 업로드 검증으로 완전히 못 잡는다.
- **`renderMaster` 의 N+1** — 1단계 검증 보고서 8c 가 지적한 상품당 7+ 왕복이 검증 슬라이스에도 그대로 온다. 슬라이스 크기로 유계지만, 대량 세션에서 DB 부하를 실측하고 배치화를 검토해야 한다.
- **카테고리 동명 형제 모호성** — 1단계 8b 가 앞으로 넘긴 항목을 여기서 "모호하면 행 오류"로 닫았다. 근본 해결(경로에 id 를 싣는 것)은 워크북 규약 변경이라 별건이다.
