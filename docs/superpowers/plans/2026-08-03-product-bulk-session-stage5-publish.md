# 상품 일괄 등록/수정 세션 5단계 — 일괄 발행·재시도·제외·정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4단계가 만들어 둔 draft 를 세션 단위로 일괄 발행하고, 실패한 행을 재시도·제외하고, 취소된 세션의 draft 와 만료된 워크북을 정리하는 경로를 만든다.

**Architecture:** 기존 `BulkSessionJobManager` 에 네 번째 레인(`publishing`)을 더한다 — claim → 슬라이스 → 행 하나가 트랜잭션 하나. 행 트랜잭션의 첫 문장은 세션 행 `FOR UPDATE` + 취소 재확인이고(3·4단계가 두 번 밟은 사고의 규약), 발행 직전에 `bulk_session_id` 를 풀어 4단계의 개별 발행 가드를 통과한다. 사람이 누르는 것은 매니저(`BulkSessionManager`)에, 워커가 도는 것은 잡 매니저에 둔다 — 2~4단계와 같은 분담이다.

**Tech Stack:** NestJS · Drizzle ORM(postgres.js) · Jest · `@nestjs/schedule` @Cron · file-service HTTP

## Global Constraints

이 절의 값은 태스크마다 다시 적지 않는다. **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **스펙**: `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md`. **§10(5단계 확정 사항)이 본문과 어긋나는 곳에서 우선한다.** 부록 A·B·C 는 1·3·4단계가 실측한 사실이며 출발점으로만 쓴다 — 자기 범위의 인터페이스는 코드로 다시 확인한다
- **범위는 core 백엔드만.** admin-web 은 이 단계에서 **한 줄도 건드리지 않는다**(§10.1)
- **`origin` 은 `'bulk_import'` 를 재사용한다**(§10.2). `packages/event-contracts` 는 건드리지 않는다 — 계약을 바꾸면 analytics·search 선배포가 배포 선행조건에 추가된다
- **트랜잭션 규약**(CLAUDE.md / ADR-0025): 공개 메서드는 `tx?: DbTransaction` 을 마지막 인자로, 비공개 헬퍼는 `tx: DbTransaction` 필수. `this.db.run(async (trx) => …, tx)` 하나만 쓰고 per-class `inTx` 헬퍼를 만들지 않는다. 콜백 안에서는 `this.db` 가 아니라 `trx` 를 쓴다
- **쿼리 규약**: `db.query.*`·`with` 관계·`any`/`as` 캐스팅 금지. `trx.select().from().where()` + drizzle 연산자만. DB 주입은 `@InjectDb()` + `DbService<PimSchema>`
- **예외 규약**: 도메인 예외는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError`. 컨트롤러는 입력 가드에만 Nest 예외를 쓰고 서비스 호출을 try/catch 로 감싸지 않는다
- **한국어**: 사용자에게 보이는 모든 문구(오류 메시지·Swagger `summary`)는 한국어. 주석도 이 모듈의 관례대로 한국어
- **env 이름을 틀리면 조용히 무시된다** — `positiveInt` 가 파싱 실패를 기본값으로 흡수한다. 새 이름은 `PRODUCT_BULK_PUBLISH_SLICE` **하나뿐**이고 킬스위치는 기존 `PRODUCT_BULK_SESSION_WORKER_ENABLED` 를 재사용한다
- **검증 게이트**: `npm run type-check:scoped` 는 exit 0 이어야 한다. 전역 `jest`·`tsc`·`npm run lint` 는 develop 에서도 red 인 레포 상시 debt 이므로 **변경 파일 기준 차분**으로 본다(신규 error 0건). `.tsx` 는 레포 lint 글롭을 빠져나가지만 이 단계엔 `.tsx` 가 없다
- **커밋은 태스크마다.** 메시지는 한국어 한 줄 + `feat(bulk-session):` / `test(bulk-session):` / `refactor(bulk-session):` 접두

---

## 착수 전 확정된 사실 (F1~F12)

계획을 세우며 **실제 코드를 읽어 확인한 것**이다. 구현자는 이것을 출발점으로 쓰되, 자기가 고치는 파일은 다시 연다.

**F1. `publishVersion` 은 잠긴 draft 를 409 로 거부한다.** `product-versions.service.ts:274` — `if (version.bulkSessionId) throw new ConflictError(…)`. 그 값은 `getVersionById(versionId, tx)` 로 **같은 트랜잭션 안에서** 읽으므로, 같은 트랜잭션에서 먼저 `NULL` 로 UPDATE 하면 가드를 통과한다(§10.3).

**F2. `publishVersion(versionId, tx?, options?)` 의 `options` 는 `PublishVersionOptions { origin?: ProductPublishOrigin; importSessionId?: string }`** (`:54-57`). `ProductPublishOrigin` 은 `'bulk_import'` 리터럴 하나다(`packages/event-contracts/streams/product.stream.ts:69`, zod 는 `:381`).

**F3. 발행 시점 가드에 필요한 것이 이미 다 있다.** `productMasterVersions.parentVersionId` 는 스키마 컬럼이고 `getActiveVersion(masterId, tx?)` 는 `ProductMasterVersion` 을 돌려주며 **active 가 없으면 `NotFoundException` 을 던진다**(`product-versions.service.ts:125`). 신규 행은 그 예외 경로로 들어오므로 `try/catch` 로 "active 없음"을 정상 흐름으로 처리해야 한다.

**F4. 삭제 API 셋의 성격이 다르다.**
- `ProductVersionsService.deleteDraftVersion(versionId, tx?)`(`:1800`) — **하드 삭제**, `status !== 'draft'` 면 `BadRequestException`, `bulkSessionId` 가드 **없음**. purge 가 쓸 것
- `ProductMastersService.deleteVersion(id, userId, tx?)`(`product-masters.service.ts:1264`) — soft delete 이고 **`bulkSessionId` 가드가 있다**(409). purge 는 이걸 쓰지 않는다
- `ProductMastersService.deleteMaster(masterId, userId, tx?)`(`:1361`) — master soft delete. active 버전이 있을 때만 `ProductMasterDeleted` 이벤트를 낸다 → 발행된 적 없는 신규 master 는 이벤트가 안 나간다

**F5. 발행 실패 예외 문구는 넷이 지배적이다.** 분류기(Task 2)가 짚을 실제 문자열:
- `Duplicate variantCode in version ${versionId}: ${codes}` (`product-versions.service.ts:364`)
- `productCode ${code} is already used by another active product` (`:388`)
- `Invalid calculated prices: \n…` (`pricing-validator.service.ts:305`, `BadRequestException({ message })` 라 `error.message` 로 읽힌다)
- postgres 22001 — 드라이버 메시지 `value too long for type character varying(N)`

**F6. lease·claim 헬퍼는 그대로 재사용한다.** `renewLease(sessionId, token) → { owned, canceled }`, `releaseLease`, `recordJobError`, `clearConsecutiveFailures` 가 이미 있다(`bulk-session-job.manager.ts:988-1063`). `finishValidating`·`finishDrafting` 은 **토큰 CAS + `cancel_requested_at IS NULL`** 을 거는 같은 모양이고 발행 마감도 그 모양이어야 한다.

**F7. claim 은 세 곳에 phase 목록이 있다.** claim SQL 의 `WHERE phase IN ('uploaded','validating','drafting')`(`:215`), 상수 `CLAIMABLE_PHASES`(`:89`), 그리고 그 상수를 쓰는 `recordJobError` 의 WHERE(`:1038`). **셋 다 고쳐야 한다** — SQL 은 문자열이라 상수를 안 본다.

**F8. `productBulkItems.publishStatus` 는 이미 있다** — `'idle' | 'pending' | 'published' | 'failed'`(`catalog.schema.ts:1343`, 기본값 `'idle'`). `publishError` text 도 있다. **발행 관련 마이그레이션은 0건이다.**

**F9. `productBulkSessions.sourceFileId` 는 `notNull()` 이다**(`catalog.schema.ts:1371`). 만료 스윕의 멱등 표시를 위해 이 제약만 푼다(§10.6). 그 값을 읽는 곳은 `runParseSlice` 하나뿐이고 그건 `uploaded` phase 전용이라 종단 세션에서 도달하지 않는다.

**F10. 단위 테스트 하네스는 발명하지 않는다.** `bulk-session.manager.spec.ts` 상단의 `writeHarness` 가 drizzle 조건을 `PgDialect` 로 렌더해 **WHERE 를 실제로 판정하는** 페이크다. `.for('update')` 를 쓰는 경로는 `bulk-session-job.manager.spec.ts`(4단계 `draftOne`)의 페이크가 이미 지원한다 — 새 코드도 그 파일들의 하네스를 확장해 쓴다. 하네스를 새로 만들면 WHERE 를 안 보는 목이 되어 게이트가 초록인 채 뚫린다.

**F11. 통합 스위트는 전용 scratch DB 를 쓴다.** `bulk-session-draft.integration.spec.ts:82-112` 가 `DATABASE_URL` 가드(`/bulk_stage\d+_scratch/`)와 `describeIfDb` 를 정의한다. 새 스위트도 **같은 헤더**(`jest.mock('@packages/event-contracts', …requireActual…)` 포함)를 그대로 복사해야 부팅한다 — 부록 C.7 이 이 함정으로 lease 스위트를 한 번 죽였다.

**F12. `checkCreateStructure(fields, optionRows)` 는 지금 (a)(b)(c) 만 본다**(`bulk-draft.options.ts:186`). (d) "같은 조합 두 번" 은 `FlatFields` 로는 구조적으로 관측 불가능하다 — `flattenBundle` 이 `variant:<조합>.<열>` 을 맵 키로 써서 뒤 행이 앞 행을 덮는다(`bulk-session.fields.ts:57-66`). 원본 `bundle.variants: PrefillRow[]`(각 행에 `combination` 문자열이 있다)를 받아야 닫힌다.

---

## 파일 구조

**새로 만드는 파일 (6)**

| 파일 | 책임 |
|---|---|
| `…/services/bulk-publish.errors.ts` | 발행 실패 예외 → 사람이 읽는 한국어 문구. 순수 함수 하나 |
| `…/services/bulk-publish.errors.spec.ts` | 위 단위 |
| `…/services/bulk-session.cleaner.ts` | 종단 세션 워크북 만료 @Cron 스윕 |
| `…/services/bulk-session.cleaner.spec.ts` | 위 단위 |
| `…/services/bulk-variant-code.checker.ts` | 세션 전역 `variantCode` 중복 사전검사(순수 판정 + DB 조회 분리) |
| `…/services/bulk-variant-code.checker.spec.ts` | 위 단위 |
| `…/services/bulk-session-publish.integration.spec.ts` | 실 Postgres 통합 6건 |

경로 접두는 전부 `apps/core/src/modules/catalog/operations/bulk-session/`.

**고치는 파일 (11)**

| 파일 | 변경 |
|---|---|
| `schema/catalog.schema.ts` | `productBulkSessions.sourceFileId` 에서 `.notNull()` 제거 |
| `apps/core/drizzle/<ts>_bulk-session-source-file-nullable.sql` | 생성물(직접 쓰지 않는다) |
| `services/bulk-session-job.manager.ts` | 발행 레인 + claim 확장 + variantCode 검사 호출 |
| `services/bulk-session-job.worker.ts` | `publishing` 분기 |
| `services/bulk-session.manager.ts` | `queuePublish`·`retryDraft`·`excludeItem`·`purgeDrafts` |
| `services/bulk-session.reader.ts` | `publishStatus`·`publishError` 노출 + `publishCounts` 집계 |
| `services/bulk-session.service.ts` | 파사드 4개 |
| `bulk-session.controller.ts` | 라우트 4개 + `RolesGuard` |
| `form-export.controller.ts` | `RolesGuard` |
| `dto/bulk-session-response.dto.ts` | `publishStatus`·`publishError`·`publishCounts`·`PurgeDraftsResultDto` |
| `services/bulk-draft.options.ts` + `bulk-draft.applier.ts` | `checkCreateStructure` (d) |
| `bulk-session.module.ts` | `BulkSessionCleaner`·`BulkVariantCodeChecker` 등록 |
| `package.json` | 통합 스위트 파일 목록에 새 스펙 추가 |

---

## Task 1: `source_file_id` nullable 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts:1371`
- Create(생성물): `apps/core/drizzle/<timestamp>_bulk-session-source-file-nullable.sql`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts` (`runParseSlice` 방어 가드)

**Interfaces:**
- Consumes: 없음
- Produces: `productBulkSessions.sourceFileId` 가 `string | null` 이 된다. Task 7 의 스윕이 이 자리에 `null` 을 쓴다

- [ ] **Step 1: 스키마에서 `.notNull()` 을 뺀다**

```ts
    /**
     * 업로드된 원본 엑셀의 file-service fileId. 검증 레인이 이걸 다시 내려받아 파싱한다.
     *
     * **nullable 인 이유**: 종단(published·canceled) 세션의 워크북을 30일 뒤 지우는
     * 만료 스윕(BulkSessionCleaner)이 "이미 지웠다"를 여기 NULL 로 표시한다 — 그것이
     * 스윕의 멱등성이다(스펙 §10.6). 읽는 곳은 `runParseSlice` 하나뿐이고 그건
     * `uploaded` phase 전용이라 종단 세션에서 도달하지 않는다.
     */
    sourceFileId: uuid('source_file_id'),
```

- [ ] **Step 2: 마이그레이션을 생성한다 (직접 쓰지 않는다)**

```bash
npm run db:generate:core -- --name bulk-session-source-file-nullable
```

생성된 SQL 을 열어 `ALTER TABLE "product_bulk_sessions" ALTER COLUMN "source_file_id" DROP NOT NULL;` **한 줄인지 확인한다.** 다른 문장이 섞여 나오면 이 브랜치와 무관한 스키마 드리프트다 — `git rm` 하고 원인을 먼저 보고한다.

- [ ] **Step 3: `runParseSlice` 에 방어 가드를 넣는다**

`runParseSlice` 가 `session.sourceFileId` 를 쓰는 자리를 찾아(다운로드 직전) 그 앞에 넣는다. 타입이 nullable 이 됐으므로 이 가드 없이는 `type-check:scoped` 가 깨진다.

```ts
      if (!session.sourceFileId) {
        // 도달 불가여야 한다 — 만료 스윕은 종단 phase 만 비우고 파싱은 uploaded 전용이다.
        // 그래도 조용히 넘기지 않는다: NULL 을 만났다는 건 둘 중 하나의 전제가 깨졌다는 뜻이다.
        await this.failSession(sessionId, leaseToken, '업로드된 원본 파일을 찾을 수 없습니다. 다시 올려주세요.');
        return;
      }
```

- [ ] **Step 4: 타입 게이트**

Run: `npm run type-check:scoped`
Expected: exit 0. `sourceFileId` 를 쓰는 다른 자리가 있으면 여기서 잡힌다 — 있으면 같은 방식으로 좁힌다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts
git commit -m "feat(bulk-session): 세션 원본 워크북 fileId 를 nullable 로 (만료 스윕의 멱등 표시)"
```

---

## Task 2: 발행 실패 오류 분류기

**Files:**
- Create: `…/services/bulk-publish.errors.ts`
- Test: `…/services/bulk-publish.errors.spec.ts`

**Interfaces:**
- Consumes: 없음(순수 함수)
- Produces: `classifyPublishError(error: unknown): string` — Task 3 의 `failPublish` 와 Task 6 의 purge 실패 기록이 쓴다. **최대 500자**를 넘지 않는 한국어 문장을 돌려준다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { classifyPublishError } from './bulk-publish.errors';

describe('classifyPublishError', () => {
  it('variantCode 중복을 품목코드 문구로 옮긴다', () => {
    const error = new Error('Duplicate variantCode in version 9f0…: SKU-1, SKU-2');
    expect(classifyPublishError(error)).toBe('품목코드가 다른 상품과 중복됩니다: SKU-1, SKU-2');
  });

  it('productCode 중복을 상품코드 문구로 옮긴다', () => {
    const error = new Error('productCode AB-100 is already used by another active product');
    expect(classifyPublishError(error)).toBe('상품코드를 이미 사용 중인 다른 상품이 있습니다: AB-100');
  });

  it('길이 초과(22001)를 안내 문구로 옮긴다', () => {
    const error = new Error('value too long for type character varying(200)');
    expect(classifyPublishError(error)).toBe('입력한 값이 저장할 수 있는 길이(200자)를 넘었습니다.');
  });

  it('가격 검증 실패를 안내 문구로 옮긴다', () => {
    const error = new Error('Invalid calculated prices: \nVariant a: base price is -100 (must be >= 0)');
    expect(classifyPublishError(error)).toBe('계산된 판매가가 올바르지 않습니다. 가격 설정을 확인해 주세요.');
  });

  it('한국어 도메인 예외는 그대로 통과시킨다', () => {
    const error = new Error('기준이 변경되었습니다. 양식을 다시 받아 작업해 주세요.');
    expect(classifyPublishError(error)).toBe('기준이 변경되었습니다. 양식을 다시 받아 작업해 주세요.');
  });

  it('모르는 오류는 안내 + 잘라낸 원문을 함께 준다', () => {
    const error = new Error('ECONNRESET');
    expect(classifyPublishError(error)).toBe('발행에 실패했습니다. (원인: ECONNRESET)');
  });

  it('Error 가 아닌 것도 죽지 않는다', () => {
    expect(classifyPublishError('nope')).toBe('발행에 실패했습니다. (원인: 알 수 없는 오류)');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-publish.errors.spec.ts`
Expected: FAIL — `Cannot find module './bulk-publish.errors'`

- [ ] **Step 3: 구현**

```ts
/**
 * 발행 실패 예외를 관리자 화면에 그대로 실을 수 있는 한국어 문장으로 옮긴다.
 *
 * 부록 A.8 이 남긴 후속이다 — 지금까지는 예외 원문(영어 DB 오류 포함)이 500자로 잘려
 * 화면에 렌더됐다. 발행 실패의 종류는 유한하고(F5) 그 넷이 실제 사고의 대부분이다.
 *
 * **원문을 완전히 버리지 않는다** — 모르는 오류는 잘라낸 원문을 괄호로 붙인다. 버리면
 * 로그를 뒤지지 않고는 아무것도 못 하고, 통째로 실으면 지금과 같아진다.
 *
 * 한국어로 시작하는 메시지는 우리 도메인 예외이므로 그대로 통과시킨다.
 */
const MAX_LENGTH = 500;
const RAW_TAIL = 120;

export function classifyPublishError(error: unknown): string {
  const raw = error instanceof Error ? error.message : '알 수 없는 오류';

  const variantDup = /Duplicate variantCode in version [^:]+: (.+)/.exec(raw);
  if (variantDup) return `품목코드가 다른 상품과 중복됩니다: ${variantDup[1]}`.slice(0, MAX_LENGTH);

  const productDup = /productCode (.+) is already used by another active product/.exec(raw);
  if (productDup) return `상품코드를 이미 사용 중인 다른 상품이 있습니다: ${productDup[1]}`.slice(0, MAX_LENGTH);

  const tooLong = /value too long for type character varying\((\d+)\)/.exec(raw);
  if (tooLong) return `입력한 값이 저장할 수 있는 길이(${tooLong[1]}자)를 넘었습니다.`;

  if (raw.startsWith('Invalid calculated prices')) {
    return '계산된 판매가가 올바르지 않습니다. 가격 설정을 확인해 주세요.';
  }

  // 한글이 하나라도 있으면 우리가 쓴 도메인 문구다.
  if (/[가-힣]/.test(raw)) return raw.slice(0, MAX_LENGTH);

  return `발행에 실패했습니다. (원인: ${raw.slice(0, RAW_TAIL)})`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-publish.errors.spec.ts`
Expected: PASS (7건)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-publish.errors.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-publish.errors.spec.ts
git commit -m "feat(bulk-session): 발행 실패 예외를 한국어 문구로 분류"
```

---

## Task 3: 발행 레인 (claim 확장 + 슬라이스 + 행 트랜잭션)

**Files:**
- Modify: `…/services/bulk-session-job.manager.ts`
- Modify: `…/services/bulk-session-job.worker.ts`
- Test: `…/services/bulk-session-job.manager.spec.ts` (기존 파일에 추가)
- Test: `…/services/bulk-session-job.worker.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `classifyPublishError`(Task 2), `ProductVersionsService.publishVersion`·`getActiveVersion`·`getVersionById`(F1~F3)
- Produces:
  - `DEFAULT_PUBLISH_SLICE = 5` (export)
  - `BulkSessionJobManager.runPublishSlice(claimed: ClaimedBulkSession): Promise<void>`
  - `BulkSessionJobManager.publishSlice: number` getter (`PRODUCT_BULK_PUBLISH_SLICE`)
  - `CLAIMABLE_PHASES` 에 `'publishing'` 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다 (5건)**

`bulk-session-job.manager.spec.ts` 의 기존 페이크 하네스를 확장한다(F10 — 새로 만들지 않는다). `ProductVersionsService` 는 생성자 주입으로 새로 들어오므로 페이크를 하나 더 넘긴다.

```ts
describe('runPublishSlice', () => {
  it('행 트랜잭션의 첫 문장은 세션 행 FOR UPDATE 잠금이다', async () => {
    // 4단계 draftOne 회귀 테스트와 같은 형태 — 페이크 트랜잭션에 마커를 심어 **순서**를
    // 관측한다. "잠갔는가" 만으로는 부족하다: publishVersion 뒤로 밀리면 취소 레이스의
    // 창이 그대로 남는다.
    const { manager, calls } = harnessWithItem({ status: 'drafted', publishStatus: 'pending' });
    await manager.runPublishSlice({ sessionId: 'S1', leaseToken: 'T1', phase: 'publishing' });
    expect(calls[0]).toEqual({ kind: 'select-for-update', table: 'product_bulk_sessions' });
  });

  it('트랜잭션 안에서 취소가 관측되면 발행도 행 갱신도 하지 않는다', async () => {
    // renewLease 는 취소를 못 보게, 잠근 세션 행은 취소를 보게 둔다 — 정확히 그 창이다.
    const { manager, publishVersion } = harnessWithItem(
      { status: 'drafted', publishStatus: 'pending' },
      { sessionRowCancelRequestedAt: new Date(), renewSeesCancel: false },
    );
    await manager.runPublishSlice({ sessionId: 'S1', leaseToken: 'T1', phase: 'publishing' });
    expect(publishVersion).not.toHaveBeenCalled();
  });

  it('현재 active 가 draft 의 parentVersionId 와 다르면 그 행만 실패시킨다', async () => {
    const { manager, publishVersion, itemUpdates } = harnessWithItem(
      { status: 'drafted', publishStatus: 'pending', draftVersionId: 'V-draft' },
      { activeVersionId: 'V-other', draftParentVersionId: 'V-base' },
    );
    await manager.runPublishSlice({ sessionId: 'S1', leaseToken: 'T1', phase: 'publishing' });
    expect(publishVersion).not.toHaveBeenCalled();
    expect(itemUpdates[0]).toMatchObject({
      publishStatus: 'failed',
      publishError: expect.stringContaining('기준이 변경되었습니다'),
    });
  });

  it('발행 직전에 bulk_session_id 를 풀고 publishVersion 을 origin=bulk_import 로 부른다', async () => {
    const { manager, publishVersion, versionUpdates } = harnessWithItem(
      { status: 'drafted', publishStatus: 'pending', draftVersionId: 'V-draft' },
      { activeVersionId: 'V-base', draftParentVersionId: 'V-base' },
    );
    await manager.runPublishSlice({ sessionId: 'S1', leaseToken: 'T1', phase: 'publishing' });
    // 순서가 계약이다 — 잠금 해제가 뒤로 가면 publishVersion 이 409 로 죽는다.
    expect(versionUpdates[0]).toEqual({ id: 'V-draft', bulkSessionId: null });
    expect(publishVersion).toHaveBeenCalledWith('V-draft', expect.anything(), {
      origin: 'bulk_import',
      importSessionId: 'S1',
    });
  });

  it('대상이 없으면 phase 를 published 로 마감한다 (토큰 CAS)', async () => {
    const { manager, sessionUpdates } = harnessWithItem(null);
    await manager.runPublishSlice({ sessionId: 'S1', leaseToken: 'T1', phase: 'publishing' });
    expect(sessionUpdates[0]).toMatchObject({ phase: 'published', leaseToken: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts -t runPublishSlice`
Expected: FAIL — `manager.runPublishSlice is not a function`

- [ ] **Step 3: claim 을 세 곳에서 넓힌다 (F7)**

```ts
const CLAIMABLE_PHASES: Array<'uploaded' | 'validating' | 'drafting' | 'publishing'> = [
  'uploaded',
  'validating',
  'drafting',
  'publishing',
];
```

claim SQL 의 문자열도 함께 고친다 — **상수를 안 보므로 여기를 빼먹으면 워커가 세션을 영원히 못 집는다.**

```sql
            WHERE phase IN ('uploaded', 'validating', 'drafting', 'publishing')
```

`ClaimedBulkSession.phase` 독스트링도 갱신한다: `'publishing' 이면 발행 슬라이스`.

- [ ] **Step 4: 슬라이스 상수와 게터를 더한다**

```ts
/**
 * 한 틱에 발행할 행 수. `publishVersion` 한 건에 variantCode·productCode 유니크 검증,
 * 가격 검증, 가격 캐시 생성, 매칭 인계, asset link 인계, 이벤트 3종, sellable 재계산이
 * 전부 붙는다(스펙 §2.3) — draft 생성(10)보다 무겁다. 5에서 시작해 실측으로 조정한다.
 */
export const DEFAULT_PUBLISH_SLICE = 5;
```

```ts
  get publishSlice(): number {
    return this.positiveInt('PRODUCT_BULK_PUBLISH_SLICE', DEFAULT_PUBLISH_SLICE);
  }
```

- [ ] **Step 5: `runPublishSlice` 를 구현한다**

`runDraftSlice` 바로 아래에 둔다. 구조가 의도적으로 같다 — 슬라이스 적재 → 마감 → 행 루프(lease 갱신) → lease 반납.

```ts
  /**
   * `status='drafted'` ∧ `publish_status='pending'` 인 행을 슬라이스만큼 발행한다.
   * 남은 행이 없으면 phase 를 published 로 민다.
   *
   * **실패 행이 남아 있어도 published 로 마감한다** — 세션 차원의 일은 끝났고, 남은 것은
   * 그 행들의 재시도(`queuePublish` 재호출)나 제외다(스펙 §10.4).
   *
   * 행 하나가 트랜잭션 하나인 이유는 `runDraftSlice` 와 같다 — 한 행의 실패가 앞선 성공을
   * 되돌리면 안 된다. 다만 여기서 되돌아가지 **않는** 것이 하나 있다: 발행이 커밋되면
   * 카탈로그가 이미 바뀐 것이라 취소로 되돌릴 수 없다(스펙 §3.12 — 취소는 published 를
   * 덮지 않는다).
   */
  async runPublishSlice(claimed: ClaimedBulkSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productBulkItems)
        .where(
          and(
            eq(productBulkItems.sessionId, sessionId),
            eq(productBulkItems.status, 'drafted'),
            eq(productBulkItems.publishStatus, 'pending'),
          ),
        )
        .orderBy(productBulkItems.rowNumber)
        .limit(this.publishSlice),
    );

    if (items.length === 0) {
      await this.finishPublishing(sessionId, leaseToken);
      return;
    }

    for (const item of items) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`일괄 세션 lease 를 잃어 발행 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`일괄 세션이 취소돼 발행 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      await this.publishOne(sessionId, item);
    }

    await this.releaseLease(sessionId, leaseToken);
  }
```

- [ ] **Step 6: `publishOne` 을 구현한다 — 네 관문이 이 순서여야 한다**

```ts
  /**
   * 행 하나를 자기 트랜잭션에서 발행한다. 관문 넷의 **순서가 계약이다**(스펙 §10.4).
   *
   * ① 세션 행 FOR UPDATE + 취소 재확인 — 루프의 `renewLease` 는 값싼 앞단 필터일 뿐이다.
   *    그 검사와 이 커밋 사이에 취소가 커밋되면 "취소했는데 상품이 발행됨"이 된다.
   *    `cancel()` 의 CAS UPDATE 가 같은 세션 행을 잠그므로 두 순서 모두 안전해진다.
   *    (3단계 bulk-image.manager.ts:190, 4단계 draftOne 과 같은 형태·같은 이유)
   * ② 행 상태 재확인 — ①과 같은 창에서 `excludeItem` 이 이 행을 뺐을 수 있다. 제외도
   *    세션 행을 잠그므로 여기까지 오면 결정은 이미 확정돼 있다.
   * ③ 발행 시점 가드 — `현재 active.id === draft.parentVersionId`. 다르면 그 사이 남이
   *    발행했다는 뜻이고, 그대로 발행하면 남의 변경이 통째로 사라진다(스펙 §2.2·§3.10).
   * ④ 잠금 해제 후 발행 — `publishVersion` 이 잠긴 draft 를 409 로 거부하므로 같은
   *    트랜잭션에서 먼저 푼다(스펙 §10.3). 실패하면 롤백돼 잠금이 되살아나 재시도가 된다.
   */
  private async publishOne(sessionId: string, item: typeof productBulkItems.$inferSelect): Promise<void> {
    const draftVersionId = item.draftVersionId;
    if (!draftVersionId) {
      await this.failPublish(item.id, '생성된 draft 가 없어 발행할 수 없습니다.');
      return;
    }

    try {
      await this.db.run(async (trx) => {
        // ① 취소 재확인
        const [locked] = await trx
          .select({ cancelRequestedAt: productBulkSessions.cancelRequestedAt })
          .from(productBulkSessions)
          .where(eq(productBulkSessions.id, sessionId))
          .for('update');
        if (!locked || Boolean(locked.cancelRequestedAt)) {
          this.logger.log(`일괄 세션이 취소돼 이 행을 발행하지 않는다 (session=${sessionId}, item=${item.id})`);
          return;
        }

        // ② 행 상태 재확인 (제외·중복 발행 방지)
        const [current] = await trx
          .select({ status: productBulkItems.status, publishStatus: productBulkItems.publishStatus })
          .from(productBulkItems)
          .where(eq(productBulkItems.id, item.id));
        if (!current || current.status !== 'drafted' || current.publishStatus !== 'pending') return;

        const version = await this.versions.getVersionById(draftVersionId, trx);

        // 멱등: 재시도로 다시 온 행이 이미 발행돼 있으면 도장만 찍는다.
        if (version.status === 'active') {
          await trx
            .update(productBulkItems)
            .set({ publishStatus: 'published', publishError: null, updatedAt: new Date() })
            .where(eq(productBulkItems.id, item.id));
          return;
        }

        // ③ 발행 시점 가드
        let currentActiveId: string | null = null;
        try {
          const active = await this.versions.getActiveVersion(version.masterId, trx);
          currentActiveId = active.id;
        } catch {
          // active 가 없는 것은 신규 행의 정상 상태다(getActiveVersion 은 NotFoundException 을 던진다).
          currentActiveId = null;
        }
        if (currentActiveId !== (version.parentVersionId ?? null)) {
          throw new ConflictError('기준이 변경되었습니다. 이 상품은 양식을 다시 받아 작업해 주세요.');
        }

        // ④ 잠금 해제 → 발행
        await trx
          .update(productMasterVersions)
          .set({ bulkSessionId: null, updatedAt: new Date() })
          .where(eq(productMasterVersions.id, draftVersionId));

        await this.versions.publishVersion(draftVersionId, trx, {
          origin: 'bulk_import',
          importSessionId: sessionId,
        });

        await trx
          .update(productBulkItems)
          .set({ publishStatus: 'published', publishError: null, updatedAt: new Date() })
          .where(eq(productBulkItems.id, item.id));
      });
    } catch (error) {
      // 행 층 오류는 그 행만 죽인다. 원문은 로그로만 남기고 화면에는 분류된 문구를 준다.
      this.logger.warn(
        `일괄 세션 행 발행 실패 (session=${sessionId}, item=${item.id}): ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.failPublish(item.id, classifyPublishError(error));
    }
  }

  /** 발행 실패를 그 행에만 적는다. 문구는 이미 분류·절단된 것이 온다. */
  private async failPublish(itemId: string, message: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkItems)
        .set({
          publishStatus: 'failed',
          publishError: message.slice(0, BulkSessionJobManager.ERROR_MESSAGE_MAX),
          updatedAt: new Date(),
        })
        .where(eq(productBulkItems.id, itemId)),
    );
  }

  /**
   * 발행 대기 행이 없으면 세션을 published 로 넘긴다.
   * 토큰 CAS + 취소 가드는 `finishDrafting` 과 같은 이유다(F6).
   */
  private async finishPublishing(sessionId: string, leaseToken: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ phase: 'published', phaseError: null, leaseUntil: null, leaseToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.leaseToken, leaseToken),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        ),
    );
  }
```

임포트에 `ProductVersionsService`, `productMasterVersions`, `ConflictError`, `classifyPublishError` 를 더하고 생성자에 `private readonly versions: ProductVersionsService` 를 **마지막 인자 앞**(ConfigService 앞)에 넣는다. 생성자 인자가 늘면 기존 스펙들의 `new BulkSessionJobManager(...)` 호출부가 전부 깨진다 — `undefined as never` 로 채워 둔 4단계 선례(부록 C.7)를 따라 컴파일을 먼저 통과시킨 뒤 필요한 스펙만 진짜 페이크로 바꾼다.

⚠️ **부록 C.7 경고**: `ProductVersionsService` 를 정적으로 끌어오면 임포트 그래프가 넓어진다. Task 12 에서 DB 를 붙여 통합 스위트를 **반드시 한 번** 돌려야 이 종류의 부팅 실패를 잡는다.

- [ ] **Step 7: 워커에 분기를 더한다**

`bulk-session-job.worker.ts` 의 tick:

```ts
      if (claimed.phase === 'uploaded') await this.jobManager.runParseSlice(claimed);
      else if (claimed.phase === 'drafting') await this.jobManager.runDraftSlice(claimed);
      else if (claimed.phase === 'publishing') await this.jobManager.runPublishSlice(claimed);
      else await this.jobManager.runValidateSlice(claimed);
```

워커 스펙에 케이스를 하나 더한다:

```ts
  it('publishing 을 클레임하면 발행 슬라이스를 돈다', async () => {
    jobManager.claim.mockResolvedValue({ sessionId: 'S1', leaseToken: 'T1', phase: 'publishing' });
    await worker.tick();
    expect(jobManager.runPublishSlice).toHaveBeenCalledWith({ sessionId: 'S1', leaseToken: 'T1', phase: 'publishing' });
    expect(jobManager.runValidateSlice).not.toHaveBeenCalled();
  });
```

- [ ] **Step 8: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.worker.spec.ts`
Expected: PASS (기존 전량 + 신규 6건)

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.worker.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.worker.spec.ts
git commit -m "feat(bulk-session): 발행 레인 — 취소 잠금·발행 시점 가드·잠금 선해제"
```

---

## Task 4: 발행 트리거와 draft 재시도

**Files:**
- Modify: `…/services/bulk-session.manager.ts`
- Test: `…/services/bulk-session.manager.spec.ts`

**Interfaces:**
- Consumes: `BulkSessionReader.getProgress`(기존)
- Produces:
  - `BulkSessionManager.queuePublish(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto>`
  - `BulkSessionManager.retryDraft(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto>`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (6건)**

```ts
describe('queuePublish', () => {
  it('drafted 세션의 미발행 행을 pending 으로 돌리고 publishing 으로 민다', async () => {
    const { manager, sessionRow, itemRows } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'drafted' },
      items: [{ id: 'I1', status: 'drafted', publishStatus: 'idle' }],
    });
    await manager.queuePublish('S1', 'U1');
    expect(itemRows[0]).toMatchObject({ publishStatus: 'pending', publishError: null });
    expect(sessionRow.phase).toBe('publishing');
  });

  it('published 세션에서는 실패 행만 다시 pending 으로 돌린다', async () => {
    const { manager, itemRows } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'published' },
      items: [
        { id: 'I1', status: 'drafted', publishStatus: 'published' },
        { id: 'I2', status: 'drafted', publishStatus: 'failed' },
      ],
    });
    await manager.queuePublish('S1', 'U1');
    expect(itemRows[0].publishStatus).toBe('published'); // 건드리지 않는다
    expect(itemRows[1].publishStatus).toBe('pending');
  });

  it('발행할 행이 하나도 없으면 409 다', async () => {
    const { manager } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'published' },
      items: [{ id: 'I1', status: 'drafted', publishStatus: 'published' }],
    });
    await expect(manager.queuePublish('S1', 'U1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('drafting 중인 세션은 발행할 수 없다', async () => {
    const { manager } = writeHarness({ session: { id: 'S1', uploadedBy: 'U1', phase: 'drafting' }, items: [] });
    await expect(manager.queuePublish('S1', 'U1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('남의 세션은 404 다', async () => {
    const { manager } = writeHarness({ session: { id: 'S1', uploadedBy: 'U-other', phase: 'drafted' }, items: [] });
    await expect(manager.queuePublish('S1', 'U1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('retryDraft', () => {
  it('draft 생성 실패 행만 pending 으로 돌리고 drafting 으로 민다', async () => {
    const { manager, sessionRow, itemRows } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'drafted' },
      items: [
        { id: 'I1', status: 'failed', errorMessage: '무언가 실패' },
        { id: 'I2', status: 'drafted' },
      ],
    });
    await manager.retryDraft('S1', 'U1');
    expect(itemRows[0]).toMatchObject({ status: 'pending', errorMessage: null });
    expect(itemRows[1].status).toBe('drafted');
    expect(sessionRow.phase).toBe('drafting');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts -t queuePublish`
Expected: FAIL — `manager.queuePublish is not a function`

- [ ] **Step 3: 구현**

`cancel` 아래에 둔다.

```ts
  /**
   * 일괄 발행 접수. **최초 발행과 실패 행 재발행을 겸한다**(v3 `queuePublish` 선례,
   * 스펙 §10.5) — 라우트를 둘로 나누면 화면이 "지금 어느 쪽을 불러야 하는가"를 phase 로
   * 판정해야 하고, 그 판정이 서버와 어긋나는 순간 버튼이 409 를 받는다.
   *
   * 아이템 갱신과 phase 전환이 **한 트랜잭션**이다 — 둘로 쪼개면 그 사이 워커가
   * `publishing` 을 클레임해 "pending 이 하나도 없는" 세션을 곧장 published 로 마감한다.
   *
   * `status='drafted'` 조건이 제외(`excluded`)·검증 실패(`invalid`)·미착수(`pending`) 행을
   * 자연히 뺀다. `publish_status='published'` 도 빠지므로 재호출이 이미 발행된 행을 다시
   * 밀지 않는다(멱등).
   */
  async queuePublish(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'drafted' && session.phase !== 'published') {
        throw new ConflictError('draft 검토가 끝난 세션만 발행할 수 있습니다.');
      }

      const queued = await trx
        .update(productBulkItems)
        .set({ publishStatus: 'pending', publishError: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkItems.sessionId, sessionId),
            eq(productBulkItems.status, 'drafted'),
            inArray(productBulkItems.publishStatus, ['idle', 'failed']),
          ),
        )
        .returning({ id: productBulkItems.id });

      if (queued.length === 0) {
        throw new ConflictError('발행할 행이 없습니다.');
      }

      const [updated] = await trx
        .update(productBulkSessions)
        .set({ phase: 'publishing', phaseError: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            inArray(productBulkSessions.phase, ['drafted', 'published']),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        )
        .returning({ id: productBulkSessions.id });
      if (!updated) {
        throw new ConflictError('세션 상태가 그 사이 바뀌어 발행하지 못했습니다. 다시 조회한 뒤 시도해 주세요.');
      }

      return this.reader.getProgress(sessionId, userId, trx);
    }, tx);
  }

  /**
   * draft 생성 실패 행 재시도(스펙 §3.12 의 두 재시도 지점 중 앞의 것).
   *
   * ⚠️ **신규 행 재시도에는 대가가 있다.** `createMaster` 는 트랜잭션 밖으로 새는 부수효과
   * 둘을 낸다 — 브로커로 직송되는 `ProductVariantCreated` 이벤트와, `tx` 를 전파받지 않아
   * 독립 커밋되는 `product_matchings` 행(스펙 §5.1 정정). 롤백돼도 남으므로 **재시도
   * 횟수만큼 누적된다.** 근본 수정은 catalog core 전체에 걸리는 별건이다.
   */
  async retryDraft(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'drafted') {
        throw new ConflictError('draft 생성이 끝난 세션에서만 실패 행을 재시도할 수 있습니다.');
      }

      const retried = await trx
        .update(productBulkItems)
        .set({ status: 'pending', errorMessage: null, updatedAt: new Date() })
        .where(and(eq(productBulkItems.sessionId, sessionId), eq(productBulkItems.status, 'failed')))
        .returning({ id: productBulkItems.id });

      if (retried.length === 0) {
        throw new ConflictError('재시도할 실패 행이 없습니다.');
      }

      const [updated] = await trx
        .update(productBulkSessions)
        .set({ phase: 'drafting', phaseError: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.phase, 'drafted'),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        )
        .returning({ id: productBulkSessions.id });
      if (!updated) {
        throw new ConflictError('세션 상태가 그 사이 바뀌어 재시도하지 못했습니다. 다시 조회한 뒤 시도해 주세요.');
      }

      return this.reader.getProgress(sessionId, userId, trx);
    }, tx);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts`
Expected: PASS (기존 전량 + 신규 6건)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts
git commit -m "feat(bulk-session): 일괄 발행 접수와 draft 생성 실패 행 재시도"
```

---

## Task 5: 행 제외

**Files:**
- Modify: `…/services/bulk-session.manager.ts`
- Test: `…/services/bulk-session.manager.spec.ts`

**Interfaces:**
- Consumes: `bulkItemRowColumns`·`toItemDto`(reader, 기존)
- Produces: `BulkSessionManager.excludeItem(sessionId: string, itemId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionItemDto>`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (4건)**

```ts
describe('excludeItem', () => {
  it('제외한 행의 draft 잠금을 푼다', async () => {
    const { manager, itemRows, versionRows } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'drafted' },
      items: [{ id: 'I1', status: 'drafted', draftVersionId: 'V1', publishStatus: 'idle' }],
      versions: [{ id: 'V1', bulkSessionId: 'S1' }],
    });
    await manager.excludeItem('S1', 'I1', 'U1');
    expect(itemRows[0].status).toBe('excluded');
    expect(versionRows[0].bulkSessionId).toBeNull();
  });

  it('트랜잭션 첫 문장은 세션 행 FOR UPDATE 잠금이다', async () => {
    // 발행 레인의 publishOne 과 같은 행을 두고 경합한다 — 둘 다 같은 세션 행을 잠가야
    // 직렬화된다. 잠그지 않으면 "제외했는데 발행됨"이 열린다.
    const { manager, calls } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'drafted' },
      items: [{ id: 'I1', status: 'drafted', draftVersionId: 'V1' }],
      versions: [{ id: 'V1', bulkSessionId: 'S1' }],
    });
    await manager.excludeItem('S1', 'I1', 'U1');
    expect(calls[0]).toEqual({ kind: 'select-for-update', table: 'product_bulk_sessions' });
  });

  it('이미 발행된 행은 제외할 수 없다', async () => {
    const { manager } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'published' },
      items: [{ id: 'I1', status: 'drafted', publishStatus: 'published', draftVersionId: 'V1' }],
      versions: [{ id: 'V1', bulkSessionId: null }],
    });
    await expect(manager.excludeItem('S1', 'I1', 'U1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('drafted·published 가 아닌 phase 에서는 제외할 수 없다', async () => {
    const { manager } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'review' },
      items: [{ id: 'I1', status: 'pending' }],
    });
    await expect(manager.excludeItem('S1', 'I1', 'U1')).rejects.toBeInstanceOf(ConflictError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts -t excludeItem`
Expected: FAIL — `manager.excludeItem is not a function`

- [ ] **Step 3: 구현**

```ts
  /**
   * 행 하나를 세션에서 뺀다 — 발행 대상에서 제외하고 **그 draft 의 잠금을 푼다**(스펙 §10.5).
   *
   * 풀린 draft 는 `draftOwnerId` 가 업로더 그대로라 `my-drafts` 에 다시 나타나고 개별
   * 발행·삭제가 열린다. 취소(§3.12)와 같은 규약이다 — 규칙이 하나여야 사람이 예측한다.
   *
   * **되돌릴 수 없다.** 재포함을 만들려면 "푼 사이에 개별 발행됐거나 삭제된 draft" 를 전부
   * 다뤄야 하는데, 잘못 제외해도 그 상품만 개별로 처리하면 되므로 잃는 것이 없다.
   *
   * 트랜잭션 첫 문장이 세션 행 `FOR UPDATE` 인 이유는 `publishOne` 과 같은 행을 두고
   * 경합하기 때문이다 — 잠그지 않으면 제외가 잠금을 푸는 사이 발행이 커밋될 수 있다.
   * `publishOne` ②의 행 상태 재확인이 그 반대편 절반이다.
   */
  async excludeItem(
    sessionId: string,
    itemId: string,
    userId: string,
    tx?: DbTransaction,
  ): Promise<BulkSessionItemDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .for('update');
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'drafted' && session.phase !== 'published') {
        throw new ConflictError('draft 검토 단계 이후에만 행을 제외할 수 있습니다.');
      }

      const [item] = await trx
        .select({
          id: productBulkItems.id,
          status: productBulkItems.status,
          publishStatus: productBulkItems.publishStatus,
          draftVersionId: productBulkItems.draftVersionId,
        })
        .from(productBulkItems)
        .where(and(eq(productBulkItems.id, itemId), eq(productBulkItems.sessionId, sessionId)))
        .limit(1);
      if (!item) throw new NotFoundError(`세션의 행을 찾을 수 없습니다: ${itemId}`);
      if (item.publishStatus === 'published') {
        throw new ConflictError('이미 발행된 행은 제외할 수 없습니다.');
      }
      if (item.status !== 'drafted' && item.status !== 'failed') {
        throw new ConflictError('draft 가 만들어졌거나 실패한 행만 제외할 수 있습니다.');
      }

      const [updated] = await trx
        .update(productBulkItems)
        .set({ status: 'excluded', publishStatus: 'idle', publishError: null, updatedAt: new Date() })
        .where(eq(productBulkItems.id, itemId))
        .returning(bulkItemRowColumns);

      if (item.draftVersionId) {
        await trx
          .update(productMasterVersions)
          .set({ bulkSessionId: null, updatedAt: new Date() })
          .where(eq(productMasterVersions.id, item.draftVersionId));
      }

      return this.reader.toItemDto(updated);
    }, tx);
  }
```

`BulkSessionReader.toItemDto`(`:291`)는 이미 public 이고 `bulkItemRowColumns` 는 매니저가 이미 임포트하고 있다 — `setConflictDecision` 이 같은 조합(`.returning(bulkItemRowColumns)` → `reader.toItemDto`)을 쓰는 선례를 그대로 따른다. 새 임포트는 `productMasterVersions` 하나다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts -t excludeItem`
Expected: PASS (4건)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.ts
git commit -m "feat(bulk-session): 행 제외 — 발행 대상 제외 + draft 잠금 해제"
```

---

## Task 6: 취소 세션 draft 전량 정리

**Files:**
- Modify: `…/services/bulk-session.manager.ts`
- Test: `…/services/bulk-session.manager.spec.ts`

**Interfaces:**
- Consumes: `ProductVersionsService.deleteDraftVersion`, `ProductMastersService.deleteMaster`(F4)
- Produces: `BulkSessionManager.purgeDrafts(sessionId, userId, tx?): Promise<{ purged: number; failed: number; remaining: number }>`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (5건)**

```ts
describe('purgeDrafts', () => {
  it('취소된 세션에서만 열린다', async () => {
    const { manager } = writeHarness({ session: { id: 'S1', uploadedBy: 'U1', phase: 'drafted' }, items: [] });
    await expect(manager.purgeDrafts('S1', 'U1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('수정 행은 draft 만 지운다', async () => {
    const { manager, deleteDraftVersion, deleteMaster } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [{ id: 'I1', kind: 'update', masterId: 'M1', draftVersionId: 'V1', publishStatus: 'idle' }],
    });
    await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).toHaveBeenCalledWith('V1', expect.anything());
    expect(deleteMaster).not.toHaveBeenCalled();
  });

  it('신규 행은 master 까지 지운다 — draft 만 지우면 빈 껍데기가 남는다', async () => {
    const { manager, deleteDraftVersion, deleteMaster } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [{ id: 'I1', kind: 'create', masterId: 'M1', draftVersionId: 'V1', publishStatus: 'idle' }],
    });
    await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).toHaveBeenCalledWith('V1', expect.anything());
    expect(deleteMaster).toHaveBeenCalledWith('M1', 'U1', expect.anything());
  });

  it('한 번이라도 발행된 행은 건드리지 않는다', async () => {
    const { manager, deleteDraftVersion, itemRows } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [{ id: 'I1', kind: 'update', draftVersionId: 'V1', publishStatus: 'published' }],
    });
    const result = await manager.purgeDrafts('S1', 'U1');
    expect(deleteDraftVersion).not.toHaveBeenCalled();
    expect(itemRows[0].draftVersionId).toBe('V1');
    expect(result).toEqual({ purged: 0, failed: 0, remaining: 0 });
  });

  it('한 행이 실패해도 나머지는 지우고 failed 로 센다', async () => {
    const { manager, deleteDraftVersion } = writeHarness({
      session: { id: 'S1', uploadedBy: 'U1', phase: 'canceled' },
      items: [
        { id: 'I1', kind: 'update', draftVersionId: 'V1', publishStatus: 'idle' },
        { id: 'I2', kind: 'update', draftVersionId: 'V2', publishStatus: 'idle' },
      ],
    });
    deleteDraftVersion.mockRejectedValueOnce(new Error('boom'));
    const result = await manager.purgeDrafts('S1', 'U1');
    expect(result.purged).toBe(1);
    expect(result.failed).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts -t purgeDrafts`
Expected: FAIL — `manager.purgeDrafts is not a function`

- [ ] **Step 3: 구현**

```ts
/**
 * 한 요청에 정리할 행 수. 행마다 draft 하드 삭제(+ 신규면 master soft delete)가 붙어
 * ALB 60초 안에 수천 행을 끝낼 수 없다. 화면이 `remaining === 0` 까지 반복 호출한다 —
 * 새 상태 컬럼 없이 진행을 표현하는 방법이다(3단계 이미지 스윕과 같은 계열).
 */
export const PURGE_DRAFTS_BATCH = 100;
```

```ts
  /**
   * 취소된 세션이 남긴 draft 를 지운다. **취소 세션에서만 열리는 명시적 관리자 동작**이다
   * (스펙 §3.12) — 취소 자체는 draft 를 남긴다. 수천 건 세션에서 작업 결과가 통째로
   * 날아가는 것은 취소의 대가로 너무 크고, 지울지 말지는 사람이 보고 판단할 일이다.
   *
   * - 수정 행: draft 만 지운다(원래 active 는 멀쩡하다)
   * - 신규 행: master 까지 지운다 — draft 만 지우면 어떤 버전도 없는 유령 master 가 남는다
   * - 발행된 적 있는 행: 건드리지 않는다
   *
   * **이미지는 여기서 지우지 않는다.** 처리한 행의 `draft_version_id` 를 비우면 3단계
   * `BulkImageCleaner` 의 스윕 제외 조건(`notExists(draft_version_id 있는 아이템)`,
   * 부록 B.6)이 저절로 풀려 이미지 정리가 이어서 돈다. 새 코드가 필요 없다.
   *
   * 행마다 트랜잭션 하나다 — 한 행의 삭제 실패가 앞선 성공을 되돌리면 재호출이 같은 일을
   * 무한히 반복한다.
   */
  async purgeDrafts(
    sessionId: string,
    userId: string,
    tx?: DbTransaction,
  ): Promise<{ purged: number; failed: number; remaining: number }> {
    const targets = await this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'canceled') {
        throw new ConflictError('취소된 세션에서만 draft 를 정리할 수 있습니다.');
      }

      return trx
        .select({
          id: productBulkItems.id,
          kind: productBulkItems.kind,
          masterId: productBulkItems.masterId,
          draftVersionId: productBulkItems.draftVersionId,
        })
        .from(productBulkItems)
        .where(
          and(
            eq(productBulkItems.sessionId, sessionId),
            isNotNull(productBulkItems.draftVersionId),
            ne(productBulkItems.publishStatus, 'published'),
          ),
        )
        .orderBy(productBulkItems.rowNumber)
        .limit(PURGE_DRAFTS_BATCH);
    }, tx);

    let purged = 0;
    let failed = 0;

    for (const target of targets) {
      const draftVersionId = target.draftVersionId;
      if (!draftVersionId) continue;
      try {
        await this.db.run(async (trx) => {
          await this.versions.deleteDraftVersion(draftVersionId, trx);
          if (target.kind === 'create' && target.masterId) {
            await this.masters.deleteMaster(target.masterId, userId, trx);
          }
          await trx
            .update(productBulkItems)
            .set({ draftVersionId: null, updatedAt: new Date() })
            .where(eq(productBulkItems.id, target.id));
        });
        purged += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`draft 정리 실패 (session=${sessionId}, item=${target.id}): ${message}`);
        failed += 1;
        await this.db.run((trx) =>
          trx
            .update(productBulkItems)
            .set({ errorMessage: classifyPublishError(error).slice(0, 500), updatedAt: new Date() })
            .where(eq(productBulkItems.id, target.id)),
        );
      }
    }

    const [remainingRow] = await this.db.run((trx) =>
      trx
        .select({ value: count() })
        .from(productBulkItems)
        .where(
          and(
            eq(productBulkItems.sessionId, sessionId),
            isNotNull(productBulkItems.draftVersionId),
            ne(productBulkItems.publishStatus, 'published'),
          ),
        ),
    );

    return { purged, failed, remaining: Number(remainingRow?.value ?? 0) };
  }
```

배선 메모:

- 생성자에 `ProductVersionsService`·`ProductMastersService` 를 더한다. **둘 다 `ProductsModule` 이 export 하는지 먼저 확인하고 아니면 export 를 더한다** — 부록 A.5 가 정확히 이 함정을 기록해 뒀다(`ProductVersionReadLoader` 가 export 안 돼 있었고 **타입 체크로는 절대 안 잡힌다**. Nest DI 는 런타임 reflection 이다). 확인은 `bulk-session.module.spec.ts` 를 돌리는 것이다
- 새 drizzle 임포트는 `count`·`ne` 둘이다(`isNotNull` 은 이미 있다)
- `classifyPublishError` 를 여기서도 쓰는 것은 이름이 어긋나 보이지만 의도적이다 — 삭제 실패도 결국 같은 종류의 DB/도메인 예외이고, 문구 분류기를 둘로 나누면 한쪽만 개선되는 자리가 생긴다. 이름은 그대로 두고 독스트링에 "발행·정리 공용"이라고 적는다

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts -t purgeDrafts`
Expected: PASS (5건)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts apps/core/src/modules/catalog/core/products/products.module.ts
git commit -m "feat(bulk-session): 취소 세션 draft 전량 정리 (배치 100행·멱등)"
```

---

## Task 7: 워크북 만료 스윕

**Files:**
- Create: `…/services/bulk-session.cleaner.ts`
- Test: `…/services/bulk-session.cleaner.spec.ts`

**Interfaces:**
- Consumes: `FormExportFileClient.softDelete(fileId, userId)`(워크북 경로 — master 스코프 토큰. 이미지 경로의 `softDeleteOwnedFile` 이 **아니다**, 부록 B.7)
- Produces: `BulkSessionCleaner.sweepOnce(now: Date): Promise<{ deleted: number; failed: number }>`, `WORKBOOK_RETENTION_DAYS = 30`

- [ ] **Step 1: 실패하는 테스트를 쓴다 (5건)**

```ts
describe('BulkSessionCleaner', () => {
  it('종단 세션의 30일 지난 워크북을 지우고 fileId 를 비운다', async () => {
    const { cleaner, softDelete, sessionRows } = harness([
      { id: 'S1', phase: 'published', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(31) },
    ]);
    const result = await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(softDelete).toHaveBeenCalledWith('F1', 'U1');
    expect(sessionRows[0].sourceFileId).toBeNull();
    expect(result).toEqual({ deleted: 1, failed: 0 });
  });

  it('진행 중인 세션은 건드리지 않는다', async () => {
    const { cleaner, softDelete } = harness([
      { id: 'S1', phase: 'drafted', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(90) },
    ]);
    await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('30일이 안 된 세션은 건드리지 않는다', async () => {
    const { cleaner, softDelete } = harness([
      { id: 'S1', phase: 'canceled', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(29) },
    ]);
    await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('삭제 실패는 fileId 를 남긴다 — 다음 틱이 다시 시도한다', async () => {
    const { cleaner, softDelete, sessionRows } = harness([
      { id: 'S1', phase: 'canceled', sourceFileId: 'F1', uploadedBy: 'U1', updatedAt: daysAgo(31) },
    ]);
    softDelete.mockRejectedValueOnce(new Error('403'));
    const result = await cleaner.sweepOnce(new Date('2026-08-03T00:00:00Z'));
    expect(sessionRows[0].sourceFileId).toBe('F1');
    expect(result).toEqual({ deleted: 0, failed: 1 });
  });

  it('킬스위치가 꺼져 있으면 크론이 아무것도 하지 않는다', async () => {
    const { cleaner, softDelete } = harness([], { PRODUCT_BULK_SESSION_WORKER_ENABLED: 'false' });
    await cleaner.sweep();
    expect(softDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.cleaner.spec.ts`
Expected: FAIL — `Cannot find module './bulk-session.cleaner'`

- [ ] **Step 3: 구현**

```ts
/** 종단 세션의 워크북 보관 기간. 양식 잡의 만료(30일)와 같은 값을 쓴다 — 둘이 다르면 이유를 설명해야 한다. */
export const WORKBOOK_RETENTION_DAYS = 30;

/** 한 틱에 지우는 세션 수. 파일마다 file-service HTTP 왕복이 하나라 틱 길이를 유계로 만든다. */
export const WORKBOOK_CLEANUP_BATCH = 200;

/**
 * 끝난 세션의 원본 워크북을 지운다(스펙 §10.6, 부록 B.7 이 5단계 몫으로 남긴 것).
 *
 * `BulkImageCleaner`(취소 세션의 업로드 이미지)와 **다른 대상**이다. 여기서 지우는 것은
 * 작업자가 올린 엑셀 하나뿐이고, 취소만이 아니라 **발행 완료 세션도 대상**이다.
 *
 * 하루 한 번이면 충분하다 — 30일 보관에서 하루의 지연은 의미가 없고, 파일당 HTTP 왕복이
 * 하나라 매분 도는 크론에 얹을 이유가 없다.
 *
 * 킬스위치는 검증 레인·이미지 스윕과 **같은** `PRODUCT_BULK_SESSION_WORKER_ENABLED` 다 —
 * 하나의 기능이고, 이름을 늘리면 오타로 조용히 무시되는 자리만 는다.
 */
@Injectable()
export class BulkSessionCleaner {
  private readonly logger = new Logger(BulkSessionCleaner.name);
  private isSweeping = false;

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_BULK_SESSION_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async sweep(): Promise<void> {
    if (!this.enabled) return;
    if (this.isSweeping) {
      this.logger.debug('이전 워크북 정리 스윕 진행 중, 건너뜀');
      return;
    }
    this.isSweeping = true;
    try {
      const { deleted, failed } = await this.sweepOnce(new Date());
      if (deleted > 0 || failed > 0) {
        this.logger.log(`만료 세션 워크북 정리 (삭제 ${deleted}건, 실패 ${failed}건)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`워크북 정리 스윕 실패: ${message}`, error instanceof Error ? error.stack : undefined);
    } finally {
      this.isSweeping = false;
    }
  }

  /**
   * 한 배치를 처리한다. `now` 를 인자로 받는 이유는 `FormExportManager.purgeExpired` 와
   * 같다 — 테스트가 시계를 고정할 수 있어야 한다.
   *
   * **HTTP 는 트랜잭션 밖에서 돈다.** 실패한 행은 `sourceFileId` 를 남겨 다음 틱이 다시
   * 시도한다 — soft delete 는 멱등이라 두 번 불려도 안전하다.
   */
  async sweepOnce(now: Date): Promise<{ deleted: number; failed: number }> {
    const cutoff = new Date(now.getTime() - WORKBOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const targets = await this.db.run((trx) =>
      trx
        .select({
          id: productBulkSessions.id,
          sourceFileId: productBulkSessions.sourceFileId,
          uploadedBy: productBulkSessions.uploadedBy,
        })
        .from(productBulkSessions)
        .where(
          and(
            inArray(productBulkSessions.phase, ['published', 'canceled']),
            isNotNull(productBulkSessions.sourceFileId),
            lt(productBulkSessions.updatedAt, cutoff),
          ),
        )
        .orderBy(productBulkSessions.updatedAt)
        .limit(WORKBOOK_CLEANUP_BATCH),
    );

    let deleted = 0;
    let failed = 0;

    for (const target of targets) {
      const fileId = target.sourceFileId;
      if (!fileId) continue;
      try {
        // 워크북 경로는 master 스코프 위임 토큰을 그대로 쓴다(부록 B.7) — 양식을 만든 사람과
        // 올린 사람이 다른 것이 정상 업무이고, 이 fileId 는 core 가 스스로 만들어 DB 에 적어
        // 둔 값이라 임의 주입 통로가 없다. 이미지 경로의 softDeleteOwnedFile 과 다르다.
        await this.fileClient.softDelete(fileId, target.uploadedBy);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`워크북 정리 실패 (session=${target.id}, file=${fileId}): ${message}`);
        failed += 1;
        continue;
      }

      await this.db.run((trx) =>
        trx
          .update(productBulkSessions)
          .set({ sourceFileId: null })
          .where(eq(productBulkSessions.id, target.id)),
      );
      deleted += 1;
    }

    return { deleted, failed };
  }
}
```

⚠️ 마지막 UPDATE 에 `updatedAt` 을 **찍지 않는다.** 이 스윕의 대상 술어가 `updatedAt` 을 나이로 쓰는데 여기서 갱신하면 대상 판정이 자기 자신 때문에 흔들린다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.cleaner.spec.ts`
Expected: PASS (5건)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.cleaner.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.cleaner.spec.ts
git commit -m "feat(bulk-session): 종단 세션 워크북 30일 만료 스윕"
```

---

## Task 8: 발행 상태 노출 (리더 + DTO)

**Files:**
- Modify: `…/services/bulk-session.reader.ts`
- Modify: `…/dto/bulk-session-response.dto.ts`
- Test: `…/services/bulk-session.reader.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `BulkSessionItemDto` 에 `publishStatus: string`·`publishError: string | null`
  - `BulkSessionProgressDto` 에 `publishCounts: BulkSessionPublishStatusCountDto[]`
  - `PurgeDraftsResultDto { purged, failed, remaining }` (Task 9 의 컨트롤러가 쓴다)

- [ ] **Step 1: 실패하는 테스트를 쓴다 (2건)**

```ts
it('행 목록이 발행 상태와 실패 사유를 함께 준다', async () => {
  const { reader } = harness({ items: [{ id: 'I1', publishStatus: 'failed', publishError: '상품코드 중복' }] });
  const list = await reader.getItems('S1', 'U1', undefined, 1, 20);
  expect(list.data[0]).toMatchObject({ publishStatus: 'failed', publishError: '상품코드 중복' });
});

it('진행률이 publish_status 별 집계를 함께 준다', async () => {
  const { reader } = harness({
    items: [{ publishStatus: 'published' }, { publishStatus: 'published' }, { publishStatus: 'failed' }],
  });
  const progress = await reader.getProgress('S1', 'U1');
  expect(progress.publishCounts).toEqual(
    expect.arrayContaining([
      { status: 'published', count: 2 },
      { status: 'failed', count: 1 },
    ]),
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts`
Expected: FAIL — `publishStatus` 가 응답에 없다

- [ ] **Step 3: 구현**

`bulkItemRowColumns` 에 두 컬럼을 더한다:

```ts
  publishStatus: productBulkItems.publishStatus,
  publishError: productBulkItems.publishError,
```

`toItemDto` 반환에 그대로 얹는다. `getProgress` 에는 집계 하나를 더한다:

```ts
      // 발행 단계의 분모·분자다. 아이템 status 집계와 축이 다르다 — 한 행은 status='drafted'
      // 이면서 publish_status='failed' 일 수 있고, 화면은 그 둘을 함께 봐야 한다.
      const publishCounts = await trx
        .select({ status: productBulkItems.publishStatus, value: count() })
        .from(productBulkItems)
        .where(eq(productBulkItems.sessionId, sessionId))
        .groupBy(productBulkItems.publishStatus);
```

DTO 에 클래스 둘을 더한다:

```ts
export class BulkSessionPublishStatusCountDto {
  @ApiProperty({ enum: ['idle', 'pending', 'published', 'failed'] }) status: string;
  @ApiProperty() count: number;
}

export class PurgeDraftsResultDto {
  @ApiProperty({ description: '이번 요청에서 지운 행 수' }) purged: number;
  @ApiProperty({ description: '이번 요청에서 실패한 행 수. error_message 에 사유가 남는다' }) failed: number;
  @ApiProperty({ description: '아직 남은 행 수. 0 이 될 때까지 다시 호출한다' }) remaining: number;
}
```

`BulkSessionItemDto`·`BulkSessionProgressDto` 에 필드를 더한다:

```ts
  @ApiProperty({ enum: ['idle', 'pending', 'published', 'failed'] }) publishStatus: string;
  @ApiProperty({ required: false, nullable: true, description: '분류된 한국어 실패 사유' })
  publishError: string | null;
```

```ts
  @ApiProperty({ type: [BulkSessionPublishStatusCountDto], description: '발행 단계 집계' })
  publishCounts: BulkSessionPublishStatusCountDto[];
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts apps/core/src/modules/catalog/operations/bulk-session/dto/bulk-session-response.dto.ts
git commit -m "feat(bulk-session): 행·진행률 응답에 발행 상태 노출"
```

---

## Task 9: 라우트 넷 + 역할 가드 + 모듈 등록

**Files:**
- Modify: `…/bulk-session.controller.ts`
- Modify: `…/form-export.controller.ts`
- Modify: `…/services/bulk-session.service.ts`
- Modify: `…/bulk-session.module.ts`
- Test: `…/bulk-session.module.spec.ts`

**Interfaces:**
- Consumes: Task 4·5·6 의 매니저 메서드, Task 8 의 DTO
- Produces: HTTP 계약 4개 (아래 표)

- [ ] **Step 1: 파사드에 네 개를 뚫는다**

```ts
  queuePublish(sessionId: string, userId: string): Promise<BulkSessionProgressDto> {
    return this.manager.queuePublish(sessionId, userId);
  }

  retryDraft(sessionId: string, userId: string): Promise<BulkSessionProgressDto> {
    return this.manager.retryDraft(sessionId, userId);
  }

  excludeItem(sessionId: string, itemId: string, userId: string): Promise<BulkSessionItemDto> {
    return this.manager.excludeItem(sessionId, itemId, userId);
  }

  purgeDrafts(sessionId: string, userId: string): Promise<PurgeDraftsResultDto> {
    return this.manager.purgeDrafts(sessionId, userId);
  }
```

- [ ] **Step 2: 라우트를 더한다**

`cancel` 아래에 넣는다.

```ts
  @Post(':id/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: '일괄 발행 접수. drafted → publishing. published 에서 부르면 실패 행만 다시 발행한다.',
  })
  @ApiResponse({ status: 200, type: BulkSessionProgressDto })
  @ApiResponse({ status: 409, description: '발행할 행이 없거나 발행 가능한 단계가 아님' })
  async publish(@Param('id') id: string, @User() user: { userId: string }): Promise<BulkSessionProgressDto> {
    return this.service.queuePublish(id, user.userId);
  }

  @Post(':id/retry-draft')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'draft 생성 실패 행 재시도. drafted → drafting. 신규 행은 재시도할 때마다 상품 생성 이벤트가 한 번 더 나가므로 반복 호출을 피한다.',
  })
  @ApiResponse({ status: 200, type: BulkSessionProgressDto })
  @ApiResponse({ status: 409, description: '재시도할 실패 행이 없거나 drafted 단계가 아님' })
  async retryDraft(@Param('id') id: string, @User() user: { userId: string }): Promise<BulkSessionProgressDto> {
    return this.service.retryDraft(id, user.userId);
  }

  @Post(':id/items/:itemId/exclude')
  @HttpCode(200)
  @ApiOperation({ summary: '행 제외. 발행 대상에서 빼고 그 draft 의 세션 잠금을 푼다. 되돌릴 수 없다.' })
  @ApiResponse({ status: 200, type: BulkSessionItemDto })
  @ApiResponse({ status: 404, description: '세션 또는 행이 없거나 내 것이 아님' })
  @ApiResponse({ status: 409, description: '이미 발행됐거나 제외할 수 있는 단계·상태가 아님' })
  async excludeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @User() user: { userId: string },
  ): Promise<BulkSessionItemDto> {
    return this.service.excludeItem(id, itemId, user.userId);
  }

  @Post(':id/purge-drafts')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '취소된 세션이 남긴 draft 정리. 한 번에 최대 100행이라 remaining 이 0 이 될 때까지 반복 호출한다. 발행된 행은 건드리지 않는다.',
  })
  @ApiResponse({ status: 200, type: PurgeDraftsResultDto })
  @ApiResponse({ status: 409, description: '취소된 세션이 아님' })
  async purgeDrafts(@Param('id') id: string, @User() user: { userId: string }): Promise<PurgeDraftsResultDto> {
    return this.service.purgeDrafts(id, user.userId);
  }
```

- [ ] **Step 3: 두 컨트롤러에 역할 가드를 건다**

```ts
import { RolesGuard, User } from '@app/authorization';

@ApiTags('Product Bulk Session')
// 전역 JwtAuthGuard 는 서명·만료만 본다. core 의 OIDC issuer 가 storefront 와 공유이고
// ALLOWED_AUDIENCES 가 설정돼 있지 않아, 가드가 없으면 **쇼핑몰 회원 토큰으로도** 세션을
// 만들 수 있다(부록 B.7 이 남긴 잔여 항목). 고객센터 컨트롤러들과 같은 형태로 잠근다.
// 양식 컨트롤러(form-export.controller.ts)도 **같이** 잠가야 우회로가 남지 않는다.
@UseGuards(RolesGuard('master', 'admin'))
@Controller('product-bulk-sessions')
export class BulkSessionController {
```

`form-export.controller.ts` 에도 같은 두 줄(임포트 + `@UseGuards`)을 넣는다.

⚠️ **이 가드는 라이브 토큰의 `roles` 클레임에 의존한다.** 1단계 "양식 다운로드"는 이미 노출돼 있어, 실제 MD 계정이 `admin`·`master` 를 갖고 있지 않으면 배포 즉시 403 이 된다. 시드 롤은 여섯이다(`scripts/seeding/steps/user-service.seed-step.ts:94-108`). **배포 전 실측이 선행조건**이며 Task 13 의 체크리스트에 있다.

- [ ] **Step 4: 모듈에 등록한다**

`providers` 에 `BulkSessionCleaner`(Task 7)와 `BulkVariantCodeChecker`(Task 11)를 더하고, 왜 등록하는지 한 줄씩 주석을 남긴다(이 파일의 관례다). 모듈 스펙(`bulk-session.module.spec.ts`)에 새 provider 가 해석되는지 확인하는 단정을 더한다 — **Nest DI 는 런타임 reflection 이라 타입 체크로는 절대 안 잡힌다**(부록 A.5).

```ts
    expect(moduleRef.get(BulkSessionCleaner)).toBeInstanceOf(BulkSessionCleaner);
    expect(moduleRef.get(BulkVariantCodeChecker)).toBeInstanceOf(BulkVariantCodeChecker);
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts`
Expected: PASS — 모듈이 실제로 부팅되고 새 provider 4개(cleaner·checker + 새 의존성)가 해석된다

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session
git commit -m "feat(bulk-session): 발행·재시도·제외·정리 라우트 + 관리자 역할 가드"
```

---

## Task 10: 신규 행 "같은 조합 두 번" 검출 (C.4 d)

**Files:**
- Modify: `…/services/bulk-draft.options.ts`
- Modify: `…/services/bulk-draft.applier.ts`
- Modify: `…/services/bulk-session-job.manager.ts` (`draftOne` 이 넘기는 `DraftInput`)
- Test: `…/services/bulk-draft.options.spec.ts`

**Interfaces:**
- Consumes: `PrefillRow`(각 행에 `combination` 문자열)
- Produces: `checkCreateStructure(fields: FlatFields, optionRows: PrefillRow[], variantRows: PrefillRow[]): RowError[]`, `DraftInput.variantRows: PrefillRow[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('같은 조합이 두 행에 있으면 행 오류다', () => {
  const variantRows: PrefillRow[] = [
    { rowKey: 'P1', combination: 'OV-1+OV-3', basePrice: '10000' },
    { rowKey: 'P1', combination: 'OV-1+OV-3', basePrice: '20000' },
  ];
  const errors = checkCreateStructure(fieldsWithOptions(), optionRowsFixture(), variantRows);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ sheet: '조합', message: expect.stringContaining('OV-1+OV-3') });
});

it('서로 다른 조합은 오류가 아니다', () => {
  const variantRows: PrefillRow[] = [
    { rowKey: 'P1', combination: 'OV-1+OV-3' },
    { rowKey: 'P1', combination: 'OV-2+OV-3' },
  ];
  expect(checkCreateStructure(fieldsWithOptions(), optionRowsFixture(), variantRows)).toHaveLength(0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.spec.ts -t "같은 조합"`
Expected: FAIL — 인자 3개를 받지 않는다 (TS2554)

- [ ] **Step 3: 구현**

`checkCreateStructure` 시그니처에 `variantRows: PrefillRow[]` 를 더하고 함수 앞머리에 검사를 넣는다. 독스트링의 "(d) 는 의도적으로 구현하지 않았다" 단락을 **지우고** 무엇이 바뀌었는지 적는다.

```ts
  // (d) 같은 조합이 두 번. `fields` 로는 관측 불가능하다 — `flattenBundle` 이
  // `variant:<조합>.<열>` 을 맵 키로 써서 뒤 행이 앞 행을 덮는다(bulk-session.fields.ts:57-66).
  // 그래서 평면화 **이전** 원본 행 배열을 따로 받는다. 덮어쓰기는 조용해서 행 오류도 없이
  // 뒤 값만 살아남았다(부록 C.4).
  const seenCombos = new Set<string>();
  const duplicated = new Set<string>();
  for (const row of variantRows) {
    const combo = typeof row.combination === 'string' ? row.combination : '';
    if (seenCombos.has(combo)) duplicated.add(combo);
    else seenCombos.add(combo);
  }
  for (const combo of duplicated) {
    errors.push({
      sheet: '조합',
      rowNumber: 0,
      message: `같은 조합이 두 번 이상 적혀 있습니다: ${combo || '(옵션 없음)'}`,
    });
  }
```

`DraftInput` 에 `variantRows: PrefillRow[]` 를 더하고, `applyCreate` 의 호출부를 세 인자로 고친다. `draftOne` 이 넘기는 자리는 `optionRows` 바로 아래다:

```ts
            optionRows: isBulkItemInput(item.input) ? item.input.bundle.options : [],
            variantRows: isBulkItemInput(item.input) ? item.input.bundle.variants : [],
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts`
Expected: PASS (기존 전량 + 신규 2건)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts
git commit -m "fix(bulk-session): 신규 행의 같은 조합 중복을 행 오류로 잡는다"
```

---

## Task 11: `variantCode` 세션 전역 사전검사

**Files:**
- Create: `…/services/bulk-variant-code.checker.ts`
- Test: `…/services/bulk-variant-code.checker.spec.ts`
- Modify: `…/services/bulk-session-job.manager.ts` (`runValidateSlice` 마감 직전 호출)

**Interfaces:**
- Consumes: `productVariants`·`productMasterVariants`·`productMasterVersions`(F5 의 v3 쿼리와 같은 조인)
- Produces: `BulkVariantCodeChecker.checkSession(sessionId: string, tx?: DbTransaction): Promise<number>` — 오류를 붙인 행 수를 돌려준다

- [ ] **Step 1: 실패하는 테스트를 쓴다 (4건)**

```ts
describe('BulkVariantCodeChecker', () => {
  it('세션 안에서 같은 코드를 두 행이 주장하면 양쪽 다 invalid 다', async () => {
    const { checker, itemRows } = harness({
      items: [
        { id: 'I1', rowNumber: 2, status: 'pending', payload: fieldsWith({ 'variant:A.variantCode': 'SKU-1' }) },
        { id: 'I2', rowNumber: 3, status: 'pending', payload: fieldsWith({ 'variant:B.variantCode': 'SKU-1' }) },
      ],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].status).toBe('invalid');
    expect(itemRows[1].status).toBe('invalid');
    expect(itemRows[0].errorMessage).toContain('SKU-1');
  });

  it('다른 상품이 이미 쓰는 코드는 invalid 다', async () => {
    const { checker, itemRows } = harness({
      items: [{ id: 'I1', masterId: 'M1', status: 'pending', payload: fieldsWith({ 'variant:A.variantCode': 'SKU-9' }) }],
      activeCodes: [{ variantCode: 'SKU-9', masterId: 'M-other' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].status).toBe('invalid');
  });

  it('자기 상품이 이미 쓰는 코드는 오류가 아니다', async () => {
    // 수정 행이 자기 variant 들 사이에서 코드를 옮기는 것은 정상이다. 같은 버전 안의
    // 진짜 중복은 발행 시점 `_validateVariantCodeUniqueness` 가 잡는다.
    const { checker, itemRows } = harness({
      items: [{ id: 'I1', masterId: 'M1', status: 'pending', payload: fieldsWith({ 'variant:A.variantCode': 'SKU-9' }) }],
      activeCodes: [{ variantCode: 'SKU-9', masterId: 'M1' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].status).toBe('pending');
  });

  it('이미 invalid 인 행은 다시 건드리지 않는다 — 재실행이 문구를 겹쳐 쌓지 않는다', async () => {
    const { checker, itemRows } = harness({
      items: [{ id: 'I1', status: 'invalid', errorMessage: '기존 오류', payload: fieldsWith({ 'variant:A.variantCode': 'SKU-1' }) }],
      activeCodes: [{ variantCode: 'SKU-1', masterId: 'M-other' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].errorMessage).toBe('기존 오류');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-variant-code.checker.spec.ts`
Expected: FAIL — `Cannot find module './bulk-variant-code.checker'`

- [ ] **Step 3: 구현**

```ts
/**
 * 세션 전역 `variantCode` 중복 사전검사(스펙 §10.7). v3 `ProductImportVariantCodeChecker`
 * 를 이 세션 모델로 옮긴 것이다.
 *
 * **행 단위가 아니라 세션 단위인 이유**: 검증 레인은 슬라이스로 쪼개지므로 인메모리 맵이
 * 틱을 넘어 살아남지 못한다(v3 가 같은 이유로 파이프라인 단계에 뒀다). 그래서 검증 슬라이스가
 * "남은 행 0" 을 본 순간, review 로 넘기기 **직전에** 한 번만 전량을 훑는다.
 *
 * **`status='pending'` 인 행만 본다.** 이미 invalid 인 행은 어차피 draft 가 되지 않으므로
 * 코드를 주장하지 않고, 여기서 손대지 않으므로 재실행(lease 만료로 슬라이스가 다시 도는
 * 경우)이 같은 문구를 겹쳐 쌓지 않는다 — 멱등성이 이 조건 하나에 걸려 있다.
 *
 * **자기 master 가 이미 쓰는 코드는 통과시킨다.** 수정 행이 자기 variant 들 사이에서 코드를
 * 옮기는 것은 정상이고, 같은 버전 안의 진짜 중복은 발행 시점
 * `_validateVariantCodeUniqueness` 가 그 행만 실패시킨다(스펙 §5.2 와 같은 성질).
 *
 * ⚠️ 남는 경합: 이 검사와 실제 발행 사이에 다른 세션이 같은 코드를 선점할 수 있다. 좁히기만
 * 하고 닫지는 못한다 — DB 유니크로 닫으려면 정션 join 이 필요해 partial index 로 불가능하다
 * (ADR-0004).
 */
@Injectable()
export class BulkVariantCodeChecker {
  /** 문구 상한. 기존 오류에 이어 붙이므로 합쳐서 이 길이를 넘지 않게 자른다. */
  private static readonly ERROR_MESSAGE_MAX = 500;
  /** postgres 파라미터 상한을 피하는 조회 청크. v3 checker 와 같은 값이다. */
  private static readonly CODE_CHUNK = 1000;

  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  /** @returns 오류를 새로 붙인 행 수 */
  async checkSession(sessionId: string, tx?: DbTransaction): Promise<number> {
    /* 아래 다섯 단계 */
  }
}
```

`checkSession` 본문의 다섯 단계:

1. `status='pending'` 인 행의 `id`·`rowNumber`·`masterId`·`payload` 를 읽는다
2. 각 행의 `payload.fields` 에서 키가 `/^variant:.+\.variantCode$/` 인 항목의 **빈 문자열이 아닌** 값을 모아 `code → Array<{ itemId, rowNumber, masterId }>` 맵을 만든다
3. 세션 안 중복: 버킷 크기 ≥ 2 인 코드 → 관련 행 전부에 `[조합] 품목코드가 파일 안에서 중복됩니다: <code> (3행, 7행)` 을 붙인다
4. DB 중복: 코드들을 1,000개씩 잘라 아래 쿼리로 `code → masterId[]` 를 얻고, 자기 `masterId` 가 **아닌** 소유자가 있으면 `[조합] 품목코드를 이미 사용 중인 상품이 있습니다: <code>` 를 붙인다

```ts
        const rows = await trx
          .selectDistinct({ variantCode: productVariants.variantCode, masterId: productMasterVersions.masterId })
          .from(productVariants)
          .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
          .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
          .where(and(inArray(productVariants.variantCode, chunk), eq(productMasterVersions.status, 'active')));
```

5. 오류가 붙은 행마다 `status='invalid'`, `errorMessage` 는 **기존 문구 뒤에 이어 붙인다**(기존이 null 이면 새 문구만). 붙인 행 수를 돌려준다

`runValidateSlice` 의 마감 분기를 이렇게 바꾼다:

```ts
    if (items.length === 0) {
      // review 로 넘기기 직전, 세션 전역 검사를 한 번 돈다. 여기가 유일한 자리다 — 슬라이스
      // 중간에 돌면 아직 검증 안 된 행의 코드를 못 보고, review 이후에 돌면 사람이 이미
      // 프리뷰를 다 본 뒤다.
      const flagged = await this.variantCodes.checkSession(sessionId);
      if (flagged > 0) {
        this.logger.log(`품목코드 중복으로 ${flagged}건을 invalid 로 표시했다 (session=${sessionId})`);
      }
      await this.finishValidating(sessionId, leaseToken);
      return;
    }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-variant-code.checker.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-variant-code.checker.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-variant-code.checker.spec.ts apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts
git commit -m "feat(bulk-session): 품목코드 전역 중복을 업로드 검증에서 잡는다"
```

---

## Task 12: 실 Postgres 통합 스위트 6건

**Files:**
- Create: `…/services/bulk-session-publish.integration.spec.ts`
- Modify: `package.json` (`test:bulk-session:integration` 에 새 파일 추가)

**Interfaces:**
- Consumes: Task 3~7 전부
- Produces: 이 단계의 회귀 잠금

- [ ] **Step 1: 스위트 골격을 만든다**

`bulk-session-draft.integration.spec.ts` 의 **파일 상단 전체**(`jest.mock('@packages/event-contracts', …)` 주석 포함, `DATABASE_URL` 가드, `describeIfDb`, `CatalogModule` 부팅, `afterAll` 정리)를 그대로 복사해 시작한다(F11). scratch DB 이름은 `bulk_stage5_scratch` 이고 기존 가드 정규식(`/bulk_stage\d+_scratch/`)이 이미 이를 허용한다.

픽스처는 **반드시 서비스로 만든다**(`createMaster` → `updateVersion` → `replaceVersionRules` → `publishVersion`). 손으로 INSERT 하면 실제 쓰기 경로가 만드는 행 모양과 갈라져 거짓 초록이 된다 — 4단계 스위트 헤더가 이 이유를 적어 뒀다.

- [ ] **Step 2: 케이스 6개를 쓴다**

```ts
it('발행 시점에 남이 먼저 발행했으면 그 행만 실패한다', async () => {
  // draft 를 만든 뒤, 같은 master 에 다른 경로로 새 active 를 만든다 → parentVersionId 가 어긋난다.
  await expectItem(itemId).toMatchObject({ publishStatus: 'failed' });
  await expectItem(otherItemId).toMatchObject({ publishStatus: 'published' });
});

it('취소가 커밋된 뒤 시작된 행은 발행되지 않는다', async () => {
  // ⚠️ 커넥션을 **물리적으로 분리**해야 재현된다 — max:1 단일 커넥션이면 postgres.js 가
  // 직렬화해 경합 자체가 관측되지 않는다(부록 B.4, bulk-session-lease.integration.spec.ts:149).
  // renewLease 는 목으로 덮는다: 그 값싼 필터가 먼저 취소를 관측해 버려 창이 안 열린다
  // (4단계 C.11 통합 케이스와 같은 이유). 목은 그 하나뿐이고 DB·트랜잭션은 전부 진짜다.
});

it('발행에 성공한 버전은 bulk_session_id 가 비워져 롤백 발행이 가능하다', async () => {
  const [version] = await db.select().from(productMasterVersions).where(eq(productMasterVersions.id, draftId));
  expect(version.bulkSessionId).toBeNull();
  // 그리고 그 버전을 inactive 로 만든 뒤 다시 publishVersion 이 409 없이 통과한다.
});

it('제외한 행의 draft 는 잠금이 풀려 개별 발행이 열린다', async () => {
  await manager.excludeItem(sessionId, itemId, userId);
  await expect(versionsService.publishVersion(draftId)).resolves.not.toThrow();
});

it('이미 발행된 행을 다시 큐에 넣어도 두 번 발행되지 않는다', async () => {
  // queuePublish 는 publish_status='published' 를 대상에서 빼고, publishOne 은 version.status
  // 가 이미 active 면 도장만 찍는다 — 두 층의 멱등을 각각 확인한다.
});

it('취소 세션 정리는 신규는 master 까지, 수정은 draft 만, 발행된 행은 미접촉이다', async () => {
  const result = await manager.purgeDrafts(sessionId, userId);
  expect(result).toMatchObject({ failed: 0, remaining: 0 });
  // 신규: master.deletedAt 이 채워졌다 / 수정: 원래 active 는 멀쩡하다 / 발행된 행: draftVersionId 유지
});
```

- [ ] **Step 3: 스크립트에 등록한다**

`package.json` 의 `test:bulk-session:integration` 마지막에 새 파일 경로를 더한다.

- [ ] **Step 4: DB 를 붙여 전 스위트를 돌린다 (이 태스크의 핵심)**

```bash
DATABASE_URL=postgres://…/bulk_stage5_scratch npm run test:bulk-session:integration
```

Expected: 5개 스위트 전부 PASS. **부록 C.7 이 경고한 부팅 실패(`Cannot find module '@packages/event-contracts'`)가 여기서만 잡힌다** — Task 3 이 `ProductVersionsService` 를 정적으로 끌어와 임포트 그래프를 넓혔으므로 기존 4개 스위트도 함께 돌려 회귀를 확인한다.

- [ ] **Step 5: 역검증 — 관문 하나를 지우면 정확히 그 케이스만 빨개지는가**

4단계 C.8 이 한 것과 같은 절차다. 임시로 `publishOne` 의 ③ 발행 시점 가드를 주석 처리하고 스위트를 다시 돌려 **케이스 1만** 실패하는지 확인한다. 그다음 ①의 `FOR UPDATE` 를 지우고 **케이스 2만** 실패하는지 확인한다. 둘 다 되돌리고 `git status` 로 워킹트리가 깨끗한지 본다.

역검증에서 "아무것도 안 빨개진다"가 나오면 그 테스트는 잠금이 아니다 — 케이스를 고쳐서 실제로 실패하게 만든 뒤 진행한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-publish.integration.spec.ts package.json
git commit -m "test(bulk-session): 발행·제외·정리 실 Postgres 통합 6건"
```

---

## Task 13: 전체 게이트와 스펙 부록 D

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` (부록 D 추가)

- [ ] **Step 1: 타입 게이트**

Run: `npm run type-check:scoped`
Expected: exit 0

- [ ] **Step 2: 단위 전량**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session`
Expected: 전량 PASS. 실패가 있으면 **여기서 멈추고** 원인을 보고한다

- [ ] **Step 3: lint 차분**

```bash
npx eslint <변경한 .ts 파일들> 2>&1 | tail -5
git stash push -u -m "lint-baseline-check" && npx eslint <같은 파일들> 2>&1 | tail -5
```

develop 기준선과 비교해 **신규 error 0건**인지 본다. 부록 C.10 의 교훈: 이 도메인에서 사설 메서드를 목으로 바꿀 때 `(service as any).x = jest.fn()` 는 error 를, `jest.spyOn(service as any, 'x')` 는 warning 만 낸다 — **후자를 쓴다.** (stash 를 쓸 때는 CLAUDE.md 의 규칙대로 고유 태그 + `apply` + 태그로 재탐색해 `drop`)

- [ ] **Step 4: 통합 전량 (DB 필요)**

Run: `DATABASE_URL=…/bulk_stage5_scratch npm run test:bulk-session:integration`
Expected: 5개 스위트 PASS

- [ ] **Step 5: 스펙에 부록 D 를 쓴다**

부록 A·B·C 와 같은 형식으로 **구현이 실측한 것만** 적는다. 최소 담을 것:

- §10 의 결정 중 구현에서 **틀린 것으로 드러난 것**과 그 정정
- `publishVersion` 을 실제로 통합에서 돌려 확인한 것(잠금 선해제 순서, 롤백 발행 가능 여부)
- 역검증 결과(어느 관문을 지우면 어느 케이스가 빨개지는가 — Task 12 Step 5)
- 6단계가 알아야 할 함정
- 남긴 갭(닫지 않기로 한 것 + 새로 발견한 것)

- [ ] **Step 6: 배포 선행조건 체크리스트를 부록 D 말미에 남긴다**

- [ ] 마이그레이션 1건(`source_file_id` DROP NOT NULL) — **`migrate` → `deploy`** 순서(expand phase)
- [ ] ⚠️ **라이브 DB 에서 MD 계정의 `roles` 실측** — `admin`·`master` 가 없으면 역할 가드가 1단계 양식 다운로드를 403 으로 막는다
- [ ] 새 env `PRODUCT_BULK_PUBLISH_SLICE`(선택, 기본 5) — **이름을 틀리면 조용히 기본값이 쓰인다**
- [ ] 이벤트 계약 변경 0건 · 새 시크릿 0건 · admin-web 변경 0건
- [ ] 2·3·4단계의 미수행 수동 스모크 + 5단계 스모크(발행 전 구간 1회 · 발행 중 취소 1회 · 실패 행 재시도 1회 · 제외 1회 · 취소 후 draft 전량 정리 1회)

- [ ] **Step 7: 커밋**

```bash
git add docs/superpowers/specs/2026-07-31-product-bulk-session-design.md
git commit -m "docs(spec): 부록 D — 5단계 구현이 실측한 사실"
```

---

## 자체 점검 (계획 작성자가 이미 돌린 것)

**스펙 커버리지** — §10 의 8개 절이 전부 태스크에 매핑된다: §10.1(범위, 전 태스크) · §10.2(origin, T3) · §10.3(잠금 선해제, T3) · §10.4(행 규약, T3) · §10.5(라우트 넷, T4·T5·T6·T9) · §10.6(워크북 만료 + 마이그, T1·T7) · §10.7(갭 4건, T9·T10·T11 + T2) · §10.8(검증·배포, T12·T13).

**본문 §3.12 의 재시도 두 지점** — draft 재시도는 T4, 발행 재시도는 T4 의 `queuePublish` 재호출로 겸한다(§10.5 의 결정).

**타입 일관성** — `queuePublish`·`retryDraft` 는 `BulkSessionProgressDto`, `excludeItem` 은 `BulkSessionItemDto`, `purgeDrafts` 는 `{ purged, failed, remaining }`(DTO 는 `PurgeDraftsResultDto`)로 T4~T9 에서 같은 이름·같은 타입을 쓴다. `classifyPublishError` 는 T2 에서 정의하고 T3·T6 이 소비한다. `checkSession` 은 T11 에서 정의하고 T11 이 스스로 배선한다.

**의도적으로 닫지 않는 것**(스펙 §10.7 말미와 같다): 수정 행의 카테고리 전체 해제 · `loadReferencedImageRefs` payload 전량 select · 스냅샷 리더 배치화 · `createMaster` 의 트랜잭션 밖 부수효과.
