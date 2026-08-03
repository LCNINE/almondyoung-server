# 상품 일괄 세션 3단계 — 이미지 단계(브라우저 직접 업로드 + 전량 게이트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단계 승인이 세션을 `awaiting_images` 로 밀어놓고 멈춰 있는 지점을 연다 — 작업자가 어떤 파일을 올려야 하는지 목록으로 받고, 브라우저가 file-service 에 직접 올린 파일을 `(imageKey, usage, fileId)` 로 통보하면 core 가 검증해 기록하며, **요구된 파일이 전부 채워지는 순간 자동으로 `drafting` 으로 전진**한다. 취소된 세션이 올린 파일은 백그라운드 스윕이 지운다.

**Architecture:** 새 레인을 만들지 않는다. 게이트 판정은 2단계 `BulkSessionManager.approve` 가 이미 쓰던 `hasPendingImageWork` 를 **Reader 로 옮겨** 승인·조회·해석 세 곳이 같은 술어를 공유하게 하고, 전진은 해석 요청 트랜잭션 끝에서 `phase='awaiting_images'` CAS 로 원자적으로 찍는다. file-service 호출(메타데이터 검증·옛 파일 정리)은 **DB 트랜잭션 밖**에서 돈다 — 2단계 `accept` 가 세운 3단계 분리와 같은 규율이다. 취소 정리만 `@Cron` 스윕이다(취소 요청 안에서 최대 1만 건을 지울 수 없다).

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), `@nestjs/schedule`, Jest

---

## Global Constraints

- 레이어 규칙: Controller → Service(2-3줄 포트) → Manager/Reader → DB. Controller 는 Repository 를 직접 부르지 않고, Service 는 `HttpException`·drizzle·Express 타입을 임포트하지 않는다.
- 도메인 예외는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError` 를 던진다. `GlobalExceptionFilter` 가 상태코드로 매핑한다.
- 트랜잭션 전파: 공개 메서드는 `tx?: DbTransaction` 을 마지막 인자로, private 헬퍼는 `tx: DbTransaction` 을 필수로. `this.db.run(async (trx) => {...}, tx)` 만 쓰고 per-class `inTx` 헬퍼를 만들지 않는다 (ADR-0025).
- DB 주입은 `@InjectDb() private readonly db: DbService<PimSchema>`. `@Inject('DB')` 금지.
- 쿼리는 `trx.select().from().innerJoin().where()` 형태. `db.query.*`·`with` relations 금지. `any`/`as` 캐스팅은 **근거를 주석으로 남긴 경우에만**.
  - **프로덕션 코드에서 이 계획이 허용하는 캐스팅은 0건이다.** 하나라도 필요해지면 설계가 어긋난 신호다 — 멈추고 보고한다.
  - **테스트 코드**에서는 2단계가 세운 선례 두 가지만 허용한다: (1) 페이크·스텁을 생성자에 넘길 때의 `as never`(`bulk-session.reader.spec.ts:110`, `bulk-session-lease.integration.spec.ts:96-102`), (2) drizzle 조건을 렌더할 때의 `dialect.sqlToQuery(condition as never)`(`bulk-session.manager.spec.ts:40`). 근거 주석은 선례 파일에 이미 있으므로 그 파일을 가리키면 된다.
- **소유권 검사는 존재 검사와 같은 `NotFoundError` 로 합친다** — 1단계 `form-export.manager.ts:48-55`, 2단계 `bulk-session.reader.ts:259-269` 가 세운 관례(존재 여부 오라클 차단).
- jsonb 에 `Date` 를 담지 않는다.
- 진행률은 카운터 컬럼이 아니라 **매번 집계**한다(`GROUP BY status`).
- **마이그레이션 0건이다**(스펙 §7). 이 단계에서 `catalog.schema.ts` 를 고치는 일이 생기면 그건 설계가 어긋났다는 신호다 — 멈추고 보고한다.
- 검증 게이트: `npm run type-check:scoped` exit 0, 변경 파일 기준 신규 lint error 0. **전역 `npx jest`·전역 `tsc`·`nest build core` 는 develop 에서도 red 이므로 "전체 그린"으로 판정하지 않는다** — 변경 파일 차분으로만 본다.
- 통합 테스트는 **scratch DB**(`bulk_stage3_scratch`)에 대고 돈다. `dev_core` 에 마이그레이션을 돌리거나 행을 남기지 않는다.
- 브랜치는 `feat/product-bulk-session-stage3` 이고 `develop`(9d0cd7739 = 2단계 머지본) 위에 바로 서 있다. 스택이 아니다 — rebase 걱정이 없다.

---

## 착수 전 확정된 사실 (읽고 시작할 것)

### F1. 범위는 **core 백엔드만**이다 (사용자 결정, 2026-08-02)

2단계와 같다. admin-web 에는 지금 1단계 "양식 다운로드" 버튼밖에 없고 업로드·프리뷰·충돌 화면이 아예 없어서, 이미지 화면만 먼저 만들면 붙일 자리가 없다. 2·3단계 화면은 나중에 한 번에 만든다.

그래서 이 단계의 산출물은 **두 개의 라우트와 하나의 크론**이고, 사람이 손으로 확인하는 방법은 Swagger/curl 이다.

### F2. 스펙 §3.9 의 "브라우저 → file-service 직접"은 **admin-web 프록시 경유**를 뜻한다

실측: admin-web 은 file-service 에 `fetch('/api/proxy/file/files/upload', { credentials: 'include' })` 로 올린다(`apps/admin-web/src/lib/api/domains/files/upload.client.ts`). 즉 "직접"의 진짜 의미는 **core 를 경유하지 않는다**이지 브라우저가 file-service 오리진을 때린다가 아니다. core 가 할 일은 파일 바이트를 만지는 것이 아니라 **결과 fileId 를 검증해 기록하는 것**뿐이다 — 이 단계는 그래서 멀티파트를 다루지 않는다.

### F3. 실측한 file-service 계약 (2026-08-02)

| 사실 | 근거 | 영향 |
|---|---|---|
| `GET /files/:fileId/metadata` 가 `{ id, fileName, originalName, mimeType, size, status, contextId, isPublic, metadata, createdAt, activatedAt }` 를 준다 | `download.controller.ts:54`, `dto/file-metadata-response.dto.ts` | core 가 "그 fileId 가 진짜 있고, 이 용도의 컨텍스트로 올라갔는가"를 확인할 수 있다 |
| `fileId` 는 `ParseUUIDPipe` 를 탄다 | 같은 파일 `:61` | 비-uuid 를 넘기면 file-service 가 400 을 준다 — core 가 DTO 에서 `@IsUUID()` 로 먼저 막는다 |
| 업로드된 파일은 **즉시 `status:'active'`** 다. 활성화 단계도, 미사용 파일 GC 도 없다 | `upload.service.ts:99,105`, `database/schema.ts:36` | 올린 파일은 우리가 안 지우면 영구 잔존한다 |
| 삭제는 **soft delete** — S3 바이트는 남는다 | `lifecycle.controller.ts:15` | 스펙 §5.2 의 기지 결함. 이 계획이 해결하지 않는다 |
| `FileAccess.isMasterOrOwner` 가 `scopes:['master']` 에서 단락한다 | `access/file-access.ts:54-63` | core 의 위임 토큰(`FormExportFileClient.token`)은 메타데이터·삭제에 그대로 통한다 |
| 컨텍스트 제약: `product-image` = `image/jpeg|png|webp`, 10MB / `product-description-image` = `image/*`, 20MB | `database/default-file-contexts.ts:162-181` | 용도별 contextId 가 다르다 — 스펙 §3.9 의 "한 키가 양쪽에 쓰이면 두 번 올라간다"의 근거 |
| `POST /files/batch-upload` 는 `Promise.all` 이라 **한 장이 실패하면 배치 전체가 reject** 되고, 성공분은 고아로 남는다. 응답 `files[]` 에는 `originalName` 이 없어 **배열 순서로만** 로컬 파일과 대응된다 | `upload.service.ts:118-135`, `dto/upload-response.dto.ts` | 프런트가 나중에 붙을 때의 함정. **이 단계는 batch-upload 를 부르지 않는다** — 기록만 받는다. 여기 적어 두는 이유는 화면 단계가 이 사실을 다시 캐지 않게 하기 위해서다 |

### F4. 2단계가 이미 만들어 둔 것 (이 단계가 소비한다)

| 것 | 위치 | 이 단계에서의 의미 |
|---|---|---|
| `product_bulk_images` 행 | 파싱 슬라이스 `bulk-session-job.manager.ts:344-392` | 이 단계는 **행을 만들지 않는다.** 이미 있는 행의 `fileId`·`status` 를 채울 뿐이다 |
| `sourceKind='file_id'` → `status='resolved'`, `file_name` → `awaiting_upload` | 같은 파일 `:388-389` | 프리필 이미지는 이미 끝나 있다. 기다리는 건 파일명 참조뿐이다 |
| `payload.imageRefs: Array<{imageKey, usage}>` | `bulk-session.types.ts:90` | "이 행이 참조하는 이미지". 요구 집합의 유일한 근거 |
| `hasPendingImageWork` (private) | `bulk-session.manager.ts:374-395` | **`status='pending'` 아이템이 참조하는 것만** 센다. Task 2 가 이걸 Reader 로 옮긴다 |
| `approve` 가 `awaiting_images | drafting` 을 가른다 | 같은 파일 `:335` | 이 단계는 그 뒤를 잇는다 |
| `cancel` 이 "이미지 정리는 3단계 몫"이라 적어 뒀다 | 같은 파일 `:408-411` | Task 7 이 그 자리를 채운다 |
| `uq_bulk_images_session_key_usage` | `catalog.schema.ts:1441` | 이미지 행의 정체성은 `(sessionId, imageKey, usage)` 다 — API 도 그 쌍으로 지목한다 |
| `getProgress` 가 `imageCounts` 를 이미 내려준다 | `bulk-session.reader.ts:153-172` | 폴링 화면은 그대로 쓴다 |

### F5. 이 단계가 하는 결정 셋 (스펙에 없어 여기서 정한다)

1. **core 는 통보받은 fileId 를 file-service 메타데이터로 검증한다.** 존재하지 않거나 용도에 맞지 않는 컨텍스트면 그 항목만 거절한다. 안 하면 오타·클라이언트 버그가 4단계 draft 에 깨진 참조로 굳고, 발견은 발행 후다. 비용은 항목당 HTTP 1회이고 요청당 상한이 50건이라 유계다.
2. **부분 성공을 허용한다.** 50건 중 3건이 실패해도 47건은 기록된다. 배치 전체를 400 으로 돌리면 성공한 47장이 재업로드돼 S3 고아가 47개 생긴다(F3 — GC 가 없다).
3. **이미 `resolved` 인 파일명 행의 교체를 허용한다**(단, `awaiting_images` 인 동안만). 작업자가 엉뚱한 파일을 올렸을 때 되돌릴 길이 그것뿐이다. 교체되면 **옛 fileId 는 best-effort 로 soft delete** 한다. `sourceKind='file_id'`(양식에 파일ID로 적힌 것) 행은 교체 대상이 아니다 — 그건 워크북에서 키를 고칠 일이다.

### F6. 이 단계가 하지 않는 것

admin-web(F1), draft 생성·`bulk_session_id` 잠금(4단계), 일괄 발행·실패 행 재시도·"draft 전량 정리"(5단계), 옛 `product_import_*` 제거(6단계), file-service 전역 고아 정리 잡(스펙 §5.2 — 영구 부채).

**세션이 업로드한 원본 워크북(`sourceFileId`) 은 이 단계가 지우지 않는다.** 취소 스윕은 이미지만 본다. 세션 자체의 만료·정리 정책이 아직 없기 때문이고(양식 잡에만 30일 만료가 있다), 그건 5단계 정리 경로에서 함께 정할 사안이다. §알려진 갭에 남긴다.

---

## File Structure

**신규** (전부 `apps/core/src/modules/catalog/operations/bulk-session/` 아래)

| 파일 | 책임 |
|---|---|
| `services/bulk-session.images.ts` | 순수: 용도↔컨텍스트 매핑, payload 에서 요구 참조 집합 추출, 메타데이터 적합성 판정, 요청 중복 정리 |
| `services/bulk-session.images.spec.ts` | 위 단위 테스트 |
| `services/bulk-image.manager.ts` | 해석 통보 처리 — 소유권·단계 가드, 항목별 검증, 기록, 전량 게이트, 자동 전진, 교체 파일 정리 |
| `services/bulk-image.manager.spec.ts` | 위 단위 테스트(페이크 DB) |
| `services/bulk-image.cleaner.ts` | 취소 세션이 올린 파일 스윕(`@Cron`) |
| `services/bulk-image.cleaner.spec.ts` | 위 단위 테스트 |
| `services/bulk-session-image.integration.spec.ts` | 실 Postgres — 게이트·자동 전진·CAS·스윕·draft 보호 |
| `dto/bulk-image.dto.ts` | 요구 목록 응답 · 해석 요청/결과 |

**수정**

| 파일 | 무엇을 |
|---|---|
| `services/bulk-session.reader.ts` | `hasPendingImageWork` 를 매니저에서 이관(public) + `getImages` 신설 |
| `services/bulk-session.reader.spec.ts` | 위 두 메서드 테스트 추가 |
| `services/bulk-session.manager.ts` | private `hasPendingImageWork` 제거 → `this.reader.hasPendingImageWork` 호출 |
| `services/form-export-file.client.ts` | `getMetadata` 추가 |
| `services/form-export-file.client.spec.ts` | 위 테스트 추가 |
| `bulk-session.controller.ts` | `GET :id/images`, `POST :id/images/resolve` |
| `services/bulk-session.service.ts` | 포트 2개 |
| `bulk-session.module.ts` | `BulkImageManager`·`BulkImageCleaner` 등록 |
| `bulk-session.module.spec.ts` | 부팅 검증에 새 provider 반영 |
| `dto/index.ts` | 새 DTO 파일 re-export |
| `package.json` | `test:bulk-session:integration` 에 새 통합 스펙 추가 |
| `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` | 부록 B(3단계 실측) 추가 |

---

## Task 1: 순수 모듈 — 용도·요구 집합·메타데이터 판정

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.spec.ts`

**Interfaces:**
- Consumes: `isBulkItemPayload` from `./bulk-session.types`
- Produces:
  - `type BulkImageUsage = 'main' | 'description'`
  - `const BULK_IMAGE_CONTEXT_BY_USAGE: Record<BulkImageUsage, string>`
  - `function imageRefKey(usage: BulkImageUsage, imageKey: string): string`
  - `function isBulkImageUsage(value: string): value is BulkImageUsage`
  - `function collectReferencedImageRefs(payloads: unknown[]): Set<string>`
  - `interface FileMetadataForCheck { contextId: string; status: string }`
  - `function checkFileMetadata(meta: FileMetadataForCheck, usage: BulkImageUsage): string | null`
  - `function dedupeResolutions<T extends { imageKey: string; usage: BulkImageUsage }>(entries: T[]): T[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.spec.ts`:

```ts
import {
  BULK_IMAGE_CONTEXT_BY_USAGE,
  checkFileMetadata,
  collectReferencedImageRefs,
  dedupeResolutions,
  imageRefKey,
  isBulkImageUsage,
} from './bulk-session.images';

describe('imageRefKey / isBulkImageUsage', () => {
  it('용도와 이미지키를 하나의 비교 가능한 문자열로 만든다', () => {
    expect(imageRefKey('main', 'IMG-1')).toBe('main:IMG-1');
    expect(imageRefKey('description', 'IMG-1')).toBe('description:IMG-1');
  });

  it('같은 키라도 용도가 다르면 다른 참조다', () => {
    expect(imageRefKey('main', 'IMG-1')).not.toBe(imageRefKey('description', 'IMG-1'));
  });

  it('용도 가드는 열거값만 통과시킨다', () => {
    expect(isBulkImageUsage('main')).toBe(true);
    expect(isBulkImageUsage('description')).toBe(true);
    expect(isBulkImageUsage('MAIN')).toBe(false);
    expect(isBulkImageUsage('thumbnail')).toBe(false);
  });
});

describe('collectReferencedImageRefs', () => {
  it('payload 들의 imageRefs 를 용도까지 포함해 모은다', () => {
    const refs = collectReferencedImageRefs([
      { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
      { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'description' }] },
    ]);
    expect([...refs].sort()).toEqual(['description:IMG-1', 'main:IMG-1']);
  });

  it('imageRefs 가 없는 payload 는 그냥 건너뛴다', () => {
    expect(collectReferencedImageRefs([{ fields: {} }]).size).toBe(0);
  });

  // jsonb 왕복 값이라 shape 이 다를 수 있다 — 가드를 통과 못 하는 값에서 죽으면 안 된다.
  it('payload 가 아닌 값(null·문자열·옛 shape)은 조용히 무시한다', () => {
    expect(collectReferencedImageRefs([null, 'x', 42, {}, { imageRefs: [] }]).size).toBe(0);
  });
});

describe('checkFileMetadata', () => {
  it('용도에 맞는 컨텍스트면 통과다', () => {
    expect(checkFileMetadata({ contextId: 'product-image', status: 'active' }, 'main')).toBeNull();
    expect(
      checkFileMetadata({ contextId: 'product-description-image', status: 'active' }, 'description'),
    ).toBeNull();
  });

  // 용도별 MIME·크기 제약이 달라서(product-image 는 jpeg/png/webp 10MB) 컨텍스트가
  // 어긋난 파일은 제약을 우회해 들어온 것이다.
  it('컨텍스트가 어긋나면 기대·실제를 함께 담은 오류를 준다', () => {
    const error = checkFileMetadata({ contextId: 'product-description-image', status: 'active' }, 'main');
    expect(error).toContain('product-image');
    expect(error).toContain('product-description-image');
  });

  it('이미 삭제된 파일은 거절한다', () => {
    expect(checkFileMetadata({ contextId: 'product-image', status: 'deleted' }, 'main')).toContain('삭제');
  });

  it('용도 → 컨텍스트 매핑은 file-service 시드와 같은 두 값뿐이다', () => {
    expect(BULK_IMAGE_CONTEXT_BY_USAGE).toEqual({
      main: 'product-image',
      description: 'product-description-image',
    });
  });
});

describe('dedupeResolutions', () => {
  it('같은 (imageKey, usage) 가 여러 번 오면 마지막 것만 남긴다', () => {
    const out = dedupeResolutions([
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'a' },
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'b' },
    ]);
    expect(out).toEqual([{ imageKey: 'IMG-1', usage: 'main', fileId: 'b' }]);
  });

  it('용도가 다르면 서로 다른 항목이라 둘 다 남는다', () => {
    const out = dedupeResolutions([
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'a' },
      { imageKey: 'IMG-1', usage: 'description' as const, fileId: 'b' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('입력 순서를 유지한다 — 결과 배열이 요청 순서와 대응해야 화면이 짝지을 수 있다', () => {
    const out = dedupeResolutions([
      { imageKey: 'IMG-2', usage: 'main' as const, fileId: 'a' },
      { imageKey: 'IMG-1', usage: 'main' as const, fileId: 'b' },
    ]);
    expect(out.map((e) => e.imageKey)).toEqual(['IMG-2', 'IMG-1']);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.spec.ts`
Expected: FAIL — `Cannot find module './bulk-session.images'`

- [ ] **Step 3: 구현한다**

`apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.ts`:

```ts
import { isBulkItemPayload } from './bulk-session.types';

/** `productBulkImageUsageEnum` 과 같은 두 값. 참조 지점이 정한다(스펙 §3.9). */
export type BulkImageUsage = 'main' | 'description';

/**
 * 용도 → file-service 컨텍스트.
 *
 * 두 컨텍스트의 제약이 다르다 — `product-image` 는 `image/jpeg|png|webp` 10MB,
 * `product-description-image` 는 `image/*` 20MB
 * (apps/file-service/src/database/default-file-contexts.ts:162-181). 그래서 한 파일을
 * 대표와 본문 양쪽에 쓰면 두 번 올라가 fileId 가 둘이 된다(스펙 §3.9 — 막지 않는다).
 *
 * core 가 이 표를 드는 이유는 **통보된 fileId 가 그 용도로 올라간 파일인지 확인하기
 * 위해서**다. 확인하지 않으면 20MB gif 가 대표이미지 자리에 들어와 제약을 우회한다.
 */
export const BULK_IMAGE_CONTEXT_BY_USAGE: Record<BulkImageUsage, string> = {
  main: 'product-image',
  description: 'product-description-image',
};

/**
 * 이미지 참조 하나의 정체성. **키만으로 비교하면 안 된다** — 이미지 행의 유니크 제약이
 * `(sessionId, imageKey, usage)` 라(catalog.schema.ts:1441) 한 파일을 본문용으로만 쓰는
 * 행이 대표용 업로드까지 기다리게 된다(2단계 `hasPendingImageWork` 독스트링과 같은 근거).
 */
export function imageRefKey(usage: BulkImageUsage, imageKey: string): string {
  return `${usage}:${imageKey}`;
}

/** 컨트롤러·DTO 입력 가드. 배열 `.includes()` 는 리터럴 유니언과 `string` 이 만나 타입 오류가 나므로 비교 체인으로 판정한다(`isBulkItemStatus` 와 같은 관례). */
export function isBulkImageUsage(value: string): value is BulkImageUsage {
  return value === 'main' || value === 'description';
}

/**
 * 이 세션에서 **실제로 파일이 필요한** 참조 집합.
 *
 * 입력은 `status='pending'` 아이템의 `payload` 들이어야 한다 — 나중에 `invalid` 이 된 행이
 * 참조하던 파일까지 세면, 30행이 invalid 인 세션에서 작업자가 **절대 쓰이지 않을 파일
 * 30개**를 올려야 다음으로 넘어간다(2단계 `hasPendingImageWork` 독스트링).
 *
 * `payload` 는 jsonb 왕복 값이라 `unknown` 이다 — 가드를 통과한 것만 읽는다(롤링 배포에서
 * 옛 코드가 쓴 shape 을 만나도 죽지 않는다).
 */
export function collectReferencedImageRefs(payloads: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const payload of payloads) {
    if (!isBulkItemPayload(payload)) continue;
    for (const ref of payload.imageRefs ?? []) refs.add(imageRefKey(ref.usage, ref.imageKey));
  }
  return refs;
}

/** `checkFileMetadata` 가 보는 것만. file-service 응답 전체를 끌고 다니지 않는다. */
export interface FileMetadataForCheck {
  contextId: string;
  status: string;
}

/** 사람이 읽는 용도 이름. 오류 문구가 `main`/`description` 을 그대로 노출하면 작업자가 못 읽는다. */
const USAGE_LABEL: Record<BulkImageUsage, string> = {
  main: '대표·부가 이미지',
  description: '본문 이미지',
};

/**
 * 통보된 fileId 의 메타데이터가 그 용도에 맞는지 본다. 맞으면 `null`, 아니면 작업자에게
 * 그대로 보여줄 한국어 오류 문자열이다.
 */
export function checkFileMetadata(meta: FileMetadataForCheck, usage: BulkImageUsage): string | null {
  const expected = BULK_IMAGE_CONTEXT_BY_USAGE[usage];
  if (meta.contextId !== expected) {
    return `${USAGE_LABEL[usage]} 용도로 올린 파일이 아닙니다 (기대 컨텍스트 ${expected}, 실제 ${meta.contextId}).`;
  }
  if (meta.status === 'deleted') return '이미 삭제된 파일입니다.';
  return null;
}

/**
 * 한 요청 안의 중복을 정리한다 — 같은 `(imageKey, usage)` 가 두 번 오면 **마지막이 이긴다**.
 *
 * 정리하지 않으면 같은 행을 두 번 UPDATE 하면서 첫 번째 fileId 를 "교체된 옛 파일"로
 * 지우게 되는데, 그건 작업자가 방금 올린 파일이다. 순서는 유지한다 — 결과 배열이 요청
 * 순서와 대응해야 화면이 항목별 성공/실패를 짝지을 수 있다.
 */
export function dedupeResolutions<T extends { imageKey: string; usage: BulkImageUsage }>(entries: T[]): T[] {
  const lastIndexByRef = new Map<string, number>();
  entries.forEach((entry, index) => lastIndexByRef.set(imageRefKey(entry.usage, entry.imageKey), index));
  return entries.filter((entry, index) => lastIndexByRef.get(imageRefKey(entry.usage, entry.imageKey)) === index);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.spec.ts`
Expected: PASS (전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.images.spec.ts
git commit -m "feat(bulk-session): 이미지 용도·요구 참조·메타데이터 판정 순수 모듈"
```

---

## Task 2: `hasPendingImageWork` 를 Reader 로 이관

**왜 이 태스크가 따로 있나:** 같은 술어를 승인(2단계)·요구 목록 조회(Task 3)·해석 후 게이트(Task 5) 셋이 쓴다. 지금 매니저 private 에 있어 나머지 둘이 복사하면 **셋 중 하나만 필터를 고쳤을 때 승인과 게이트가 서로 다른 답을 내는** 상태가 된다 — 그러면 승인은 `drafting` 으로 보냈는데 해석 API 는 아직 남았다고 하거나 그 반대가 된다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts:374-395` (private 메서드 삭제) 및 `:335` (호출부 교체)
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts` (추가)

**Interfaces:**
- Consumes: `collectReferencedImageRefs`, `imageRefKey` (Task 1)
- Produces:
  - `BulkSessionReader.hasPendingImageWork(trx: DbTransaction, sessionId: string): Promise<boolean>`
  - `BulkSessionReader.loadReferencedImageRefs(trx: DbTransaction, sessionId: string): Promise<Set<string>>` (public — Task 3 의 `getImages` 도 쓴다)

- [ ] **Step 1: 기존 하네스가 `trx` 도 돌려주게 한다 (한 줄)**

`bulk-session.reader.spec.ts:95` 의 `harness(tables: HarnessTables)` 는 지금 `{ reader }` 만 돌려준다. `hasPendingImageWork` 는 `trx` 를 인자로 받으므로 한 줄을 고친다:

```ts
  // 기존: return { reader };
  // 3단계: hasPendingImageWork(trx, ...) 처럼 trx 를 명시로 받는 메서드를 테스트하려면
  // 하네스가 만든 그 trx 가 필요하다.
  return { reader, trx };
```

새 하네스를 병렬로 만들지 않는다 — 두 개가 되면 한쪽만 고쳐지는 자리가 또 생긴다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`bulk-session.reader.spec.ts` 맨 아래에 추가한다. `harness` 는 `{ sessions?, items?, images? }`(= `HarnessTables`)를 받고, 파일 상단의 `selectChain`/`rowMatchesCondition` 이 `.where()` 를 진짜로 걸어 준다.

```ts
describe('BulkSessionReader.hasPendingImageWork', () => {
  const SESSION = '00000000-0000-7000-8000-000000000001';
  const OTHER = '00000000-0000-7000-8000-0000000000ff';

  it('요구된 파일이 아직 안 올라왔으면 true', async () => {
    const { reader, trx } = harness({
      items: [{ sessionId: SESSION, status: 'pending', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] } }],
      images: [{ sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(true);
  });

  it('전부 resolved 면 false', async () => {
    const { reader, trx } = harness({
      items: [{ sessionId: SESSION, status: 'pending', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] } }],
      images: [{ sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', status: 'resolved' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  // 이 한 줄이 이 술어의 존재 이유다 — invalid 행이 참조하던 파일까지 세면 작업자가
  // 절대 안 쓰일 파일을 올려야 다음으로 넘어간다.
  it('invalid 행만 참조하는 미해결 이미지는 세지 않는다', async () => {
    const { reader, trx } = harness({
      items: [{ sessionId: SESSION, status: 'invalid', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-9', usage: 'main' }] } }],
      images: [{ sessionId: SESSION, imageKey: 'IMG-9', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  it('아무도 참조하지 않는 미해결 이미지도 세지 않는다', async () => {
    const { reader, trx } = harness({
      items: [{ sessionId: SESSION, status: 'pending', payload: { fields: {} } }],
      images: [{ sessionId: SESSION, imageKey: 'IMG-ORPHAN', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  it('용도가 다르면 다른 참조다 — 본문용만 참조된 키는 대표용 업로드를 기다리지 않는다', async () => {
    const { reader, trx } = harness({
      items: [{ sessionId: SESSION, status: 'pending', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'description' }] } }],
      images: [{ sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  it('남의 세션 행은 보지 않는다', async () => {
    const { reader, trx } = harness({
      items: [{ sessionId: OTHER, status: 'pending', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] } }],
      images: [{ sessionId: OTHER, imageKey: 'IMG-1', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts`
Expected: FAIL — `reader.hasPendingImageWork is not a function`

- [ ] **Step 4: Reader 로 옮긴다**

`bulk-session.reader.ts` 상단 import 에 추가:

```ts
import { collectReferencedImageRefs, imageRefKey } from './bulk-session.images';
```

클래스 안, `assertOwned` 바로 위에 넣는다(공개 메서드 뒤·private 앞):

```ts
  /**
   * **적용될 행이 참조하는 이미지 중 아직 파일이 없는 것이 있는가.**
   *
   * 2단계 `BulkSessionManager` 의 private 메서드였던 것을 여기로 옮겼다 — 같은 술어를
   * 승인(`approve`)·요구 목록(`getImages`)·해석 후 게이트(`BulkImageManager.resolve`)
   * 셋이 쓴다. 복사본이 생기면 셋 중 하나만 필터를 고쳤을 때 승인은 `drafting` 으로
   * 보냈는데 해석 API 는 아직 남았다고 답하는(또는 그 반대) 어긋남이 생긴다.
   *
   * "세션에 `awaiting_upload` 행이 하나라도 있는가"로 물으면 안 된다. 이미지 행은
   * **파싱 시점**에 만들어지는데 그때는 접합 오류만 알고 필드 검증 결과는 모른다 —
   * 나중에 `invalid` 이 된 행이 참조하던 파일명 이미지가 그대로 `awaiting_upload` 로
   * 남는다. 그것까지 세면 30행이 invalid 인 세션에서 작업자가 **절대 쓰이지 않을 파일
   * 30개**를 올려야 다음으로 넘어간다. 미결정 충돌 게이트가 `status='pending'` 만 세는
   * 것과 같은 이유·같은 필터다.
   *
   * 미해결 이미지가 **하나도 없을 때는 items 를 읽지 않는다** — 흔한 경우(프리필
   * 이미지는 전부 fileId 라 `resolved` 다)에서 payload 전량 스캔을 피한다.
   */
  async hasPendingImageWork(trx: DbTransaction, sessionId: string): Promise<boolean> {
    const awaiting = await trx
      .select({ imageKey: productBulkImages.imageKey, usage: productBulkImages.usage })
      .from(productBulkImages)
      .where(and(eq(productBulkImages.sessionId, sessionId), eq(productBulkImages.status, 'awaiting_upload')));
    if (awaiting.length === 0) return false;

    const referenced = await this.loadReferencedImageRefs(trx, sessionId);
    return awaiting.some((image) => referenced.has(imageRefKey(image.usage, image.imageKey)));
  }

  /**
   * `status='pending'` 아이템이 참조하는 `(usage, imageKey)` 집합. 위 게이트와
   * `getImages` 의 `required` 플래그가 같은 근거를 쓰도록 여기 하나만 둔다.
   */
  async loadReferencedImageRefs(trx: DbTransaction, sessionId: string): Promise<Set<string>> {
    const rows = await trx
      .select({ payload: productBulkItems.payload })
      .from(productBulkItems)
      .where(and(eq(productBulkItems.sessionId, sessionId), eq(productBulkItems.status, 'pending')));
    return collectReferencedImageRefs(rows.map((row) => row.payload));
  }
```

`isBulkItemPayload` 가 리더에서 더 안 쓰이면 import 에서 뺀다(`toItemDto` 가 여전히 쓰므로 보통은 남는다 — 실제 사용처를 확인하고 판단한다).

- [ ] **Step 5: 매니저에서 지우고 리더 것을 부른다**

`bulk-session.manager.ts`:
- `:335` 를 바꾼다:
  ```ts
      const nextPhase = (await this.reader.hasPendingImageWork(trx, sessionId)) ? 'awaiting_images' : 'drafting';
  ```
- `:374-395` 의 private `hasPendingImageWork` 를 **통째로 삭제**한다.
- `approve` 독스트링의 "판정은 `hasPendingImageWork` 가 하고" 문장을 "판정은 `BulkSessionReader.hasPendingImageWork` 가 하고"로 고친다.
- 그 결과 안 쓰이게 된 import (`productBulkImages`, `isBulkItemPayload` 등)를 정리한다. `productBulkImages` 는 매니저에서 다른 곳에 안 쓰이면 제거한다.

- [ ] **Step 6: 리더·매니저 테스트가 모두 통과하는지 본다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts \
         apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts
```
Expected: PASS. 매니저 스펙의 승인 케이스는 **한 줄도 고치지 않고** 통과해야 한다 — `writeHarness` 가 진짜 `BulkSessionReader` 를 같은 페이크 DB 로 주입하고 있어(`bulk-session.manager.spec.ts:549-550`) 이관이 투명하다. 여기서 깨지면 이관이 동작을 바꾼 것이므로 되돌아가 원인을 찾는다.

- [ ] **Step 7: 타입 게이트**

Run: `npm run type-check:scoped`
Expected: exit 0

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts
git commit -m "refactor(bulk-session): 전량 게이트 술어를 Reader 로 이관해 승인·조회·해석이 공유하게"
```

---

## Task 3: 요구 이미지 목록 — DTO + `Reader.getImages`

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/dto/bulk-image.dto.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/dto/index.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts` (추가)

**Interfaces:**
- Consumes: `BULK_IMAGE_CONTEXT_BY_USAGE`, `imageRefKey`, `isBulkImageUsage` (Task 1); `loadReferencedImageRefs` (Task 2)
- Produces:
  - `class BulkSessionImageDto { imageKey; usage; contextId; sourceKind; sourceValue; status; fileId; required }`
  - `class BulkSessionImageListDto { data; total; page; limit; requiredTotal; requiredResolved }`
  - `BulkSessionReader.getImages(sessionId, userId, filter: BulkImageFilter, tx?): Promise<BulkSessionImageListDto>`
  - `interface BulkImageFilter { status?: 'resolved' | 'awaiting_upload'; onlyRequired: boolean; page: number; limit: number }`

- [ ] **Step 1: DTO 를 쓴다**

`apps/core/src/modules/catalog/operations/bulk-session/dto/bulk-image.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { BulkSessionProgressDto } from './bulk-session-response.dto';

export class BulkSessionImageDto {
  @ApiProperty({ description: '워크북 "이미지" 시트의 이미지키' }) imageKey: string;
  @ApiProperty({ enum: ['main', 'description'], description: '참조 지점이 정한다 — 대표·부가는 main, 본문 디렉티브는 description' })
  usage: 'main' | 'description';
  @ApiProperty({ description: '이 용도로 업로드할 때 써야 하는 file-service 컨텍스트' }) contextId: string;
  @ApiProperty({ enum: ['file_id', 'file_name'] }) sourceKind: string;
  @ApiProperty({ description: 'file_name 이면 작업자가 올려야 할 로컬 파일명' }) sourceValue: string;
  @ApiProperty({ enum: ['resolved', 'awaiting_upload'] }) status: string;
  @ApiProperty({ required: false, nullable: true }) fileId: string | null;
  @ApiProperty({
    description:
      '적용될 행(status=pending)이 실제로 참조하는가. false 인 행은 올리지 않아도 다음 단계로 넘어간다 — invalid 행만 참조하던 이미지가 여기 해당한다.',
  })
  required: boolean;
}

export class BulkSessionImageListDto {
  @ApiProperty({ type: [BulkSessionImageDto] }) data: BulkSessionImageDto[];
  @ApiProperty({ description: '필터를 적용한 전체 건수(페이지 이전)' }) total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty({ description: '필터와 무관한 세션 전체 기준 — 전량 게이트의 분모' }) requiredTotal: number;
  @ApiProperty({ description: '필터와 무관한 세션 전체 기준 — 전량 게이트의 분자' }) requiredResolved: number;
}

export class ResolveImageEntryDto {
  @ApiProperty({ description: '워크북 이미지키' })
  @IsString()
  @MaxLength(100)
  imageKey: string;

  @ApiProperty({ enum: ['main', 'description'] })
  @IsIn(['main', 'description'])
  usage: 'main' | 'description';

  @ApiProperty({ description: 'file-service 가 돌려준 fileId' })
  @IsUUID()
  fileId: string;
}

export class ResolveImagesDto {
  @ApiProperty({
    type: [ResolveImageEntryDto],
    description:
      '한 요청 최대 50건. 항목마다 file-service 메타데이터를 확인하므로 상한이 있다 — 브라우저는 업로드가 끝나는 대로 나눠 보낸다.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResolveImageEntryDto)
  resolutions: ResolveImageEntryDto[];
}

export class ResolveImageResultDto {
  @ApiProperty() imageKey: string;
  @ApiProperty({ enum: ['main', 'description'] }) usage: 'main' | 'description';
  @ApiProperty() ok: boolean;
  @ApiProperty({ required: false, nullable: true, description: 'ok=false 일 때 작업자에게 그대로 보여줄 문구' })
  error: string | null;
}

export class ResolveImagesResponseDto {
  @ApiProperty({ type: [ResolveImageResultDto], description: '요청 순서와 대응한다(중복은 마지막 것만 남는다)' })
  results: ResolveImageResultDto[];
  @ApiProperty({ type: BulkSessionProgressDto, description: '처리 후 세션 상태 — 전량 게이트가 열렸으면 phase 가 drafting 이다' })
  progress: BulkSessionProgressDto;
}
```

`dto/index.ts` 에 한 줄 추가:

```ts
export * from './bulk-image.dto';
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`bulk-session.reader.spec.ts` 에 추가한다(Task 2 에서 쓴 `harness` 를 그대로 쓴다):

```ts
describe('BulkSessionReader.getImages', () => {
  const SESSION = '00000000-0000-7000-8000-000000000001';
  const USER = '00000000-0000-7000-8000-000000000009';
  const ALL = { onlyRequired: false, page: 1, limit: 20 };

  function imageFixture() {
    return {
      sessions: [{ id: SESSION, uploadedBy: USER }],
      items: [
        { sessionId: SESSION, status: 'pending', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] } },
        { sessionId: SESSION, status: 'invalid', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-9', usage: 'main' }] } },
      ],
      images: [
        { sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', sourceKind: 'file_name', sourceValue: 'front.jpg', status: 'awaiting_upload', fileId: null },
        { sessionId: SESSION, imageKey: 'IMG-9', usage: 'main', sourceKind: 'file_name', sourceValue: 'ghost.jpg', status: 'awaiting_upload', fileId: null },
      ],
    };
  }

  it('pending 행이 참조하는 이미지만 required 다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, ALL);
    expect(out.data.find((r) => r.imageKey === 'IMG-1')?.required).toBe(true);
    expect(out.data.find((r) => r.imageKey === 'IMG-9')?.required).toBe(false);
  });

  it('게이트 분모·분자는 required 기준이다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, ALL);
    expect(out.requiredTotal).toBe(1);
    expect(out.requiredResolved).toBe(0);
  });

  it('용도에 맞는 업로드 컨텍스트를 함께 준다 — 클라이언트가 매핑을 다시 들지 않게', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, ALL);
    expect(out.data[0].contextId).toBe('product-image');
  });

  it('onlyRequired 는 목록만 좁히고 요약 카운트는 세션 전체 기준을 유지한다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, { ...ALL, onlyRequired: true });
    expect(out.data).toHaveLength(1);
    expect(out.total).toBe(1);
    expect(out.requiredTotal).toBe(1);
  });

  it('status 필터가 걸린다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, { ...ALL, status: 'resolved' });
    expect(out.data).toHaveLength(0);
    expect(out.requiredTotal).toBe(1);
  });

  it('남의 세션이면 존재 검사와 같은 NotFoundError', async () => {
    const { reader } = harness(imageFixture());
    await expect(reader.getImages(SESSION, 'someone-else', ALL)).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts -t getImages`
Expected: FAIL — `reader.getImages is not a function`

- [ ] **Step 4: 구현한다**

`bulk-session.reader.ts` — import 를 보강하고(`BULK_IMAGE_CONTEXT_BY_USAGE` 추가, DTO 추가) `getItems` 아래에 넣는다:

```ts
/** GET /product-bulk-sessions/:id/images 의 필터. 컨트롤러가 파싱해 넘긴다. */
export interface BulkImageFilter {
  status?: 'resolved' | 'awaiting_upload';
  onlyRequired: boolean;
  page: number;
  limit: number;
}
```

```ts
  /**
   * 이 세션의 이미지 참조 목록. 작업자가 "무슨 파일을 올려야 하는가"를 보는 자리다.
   *
   * **행을 전부 읽어 메모리에서 자른다.** 페이지네이션을 SQL 로 내리지 않는 이유는
   * `required` 판정과 요약 카운트(`requiredTotal`/`requiredResolved`)가 **필터와 무관하게
   * 세션 전체 기준**이어야 하기 때문이다 — 전량 게이트의 분모를 페이지가 바꾸면 화면이
   * "3/3 완료"라고 해놓고 다음으로 안 넘어간다. 이미지 행은 컬럼이 작고 파싱 슬라이스가
   * 세션당 1만 건에서 끊으므로(bulk-session-job.manager.ts) 전량 적재가 감당된다.
   */
  async getImages(
    sessionId: string,
    userId: string,
    filter: BulkImageFilter,
    tx?: DbTransaction,
  ): Promise<BulkSessionImageListDto> {
    return this.db.run(async (trx) => {
      await this.assertOwned(trx, sessionId, userId);

      const rows = await trx
        .select({
          imageKey: productBulkImages.imageKey,
          usage: productBulkImages.usage,
          sourceKind: productBulkImages.sourceKind,
          sourceValue: productBulkImages.sourceValue,
          status: productBulkImages.status,
          fileId: productBulkImages.fileId,
        })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId))
        .orderBy(productBulkImages.imageKey, productBulkImages.usage);

      // 이미지 행이 없으면 payload 전량 스캔을 하지 않는다(hasPendingImageWork 와 같은 절약).
      const referenced = rows.length > 0 ? await this.loadReferencedImageRefs(trx, sessionId) : new Set<string>();

      const all: BulkSessionImageDto[] = rows.map((row) => ({
        imageKey: row.imageKey,
        usage: row.usage,
        contextId: BULK_IMAGE_CONTEXT_BY_USAGE[row.usage],
        sourceKind: row.sourceKind,
        sourceValue: row.sourceValue,
        status: row.status,
        fileId: row.fileId,
        required: referenced.has(imageRefKey(row.usage, row.imageKey)),
      }));

      const requiredRows = all.filter((row) => row.required);
      const filtered = all.filter(
        (row) => (!filter.onlyRequired || row.required) && (filter.status === undefined || row.status === filter.status),
      );
      const page = Math.max(filter.page, 1);
      const limit = Math.max(filter.limit, 1);
      const offset = (page - 1) * limit;

      return {
        data: filtered.slice(offset, offset + limit),
        total: filtered.length,
        page,
        limit,
        requiredTotal: requiredRows.length,
        requiredResolved: requiredRows.filter((row) => row.status === 'resolved').length,
      };
    }, tx);
  }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts`
Expected: PASS

- [ ] **Step 6: 타입 게이트**

Run: `npm run type-check:scoped`
Expected: exit 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/dto/bulk-image.dto.ts \
        apps/core/src/modules/catalog/operations/bulk-session/dto/index.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts
git commit -m "feat(bulk-session): 요구 이미지 목록 조회(required 판정·게이트 요약 포함)"
```

---

## Task 4: `FormExportFileClient.getMetadata`

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts` (추가)

**Interfaces:**
- Produces:
  - `interface BulkFileMetadata { id: string; contextId: string; status: string; originalName: string }`
  - `FormExportFileClient.getMetadata(fileId: string, userId: string): Promise<BulkFileMetadata | null>` — 404 는 `null`, 그 밖의 실패는 throw

- [ ] **Step 1: 실패하는 테스트를 쓴다**

기존 spec 파일은 헬퍼 없이 `global.fetch = jest.fn().mockResolvedValue({...})` 를 테스트마다 직접 세우고 `new FormExportFileClient(config)` 로 만든다(`config` 는 `describe` 스코프의 상수, `:9-11`). 같은 모양으로 쓴다. `describe('download', ...)` 아래에 붙인다:

```ts
  describe('getMetadata', () => {
    it('메타데이터를 core 가 쓰는 네 필드로 좁혀 돌려준다', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'f1',
            contextId: 'product-image',
            status: 'active',
            originalName: 'front.jpg',
            size: 10,
            mimeType: 'image/jpeg',
          }),
      });
      global.fetch = fetchMock as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).resolves.toEqual({
        id: 'f1',
        contextId: 'product-image',
        status: 'active',
        originalName: 'front.jpg',
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://file-service/files/f1/metadata');
      const auth = (init.headers as Record<string, string>).Authorization;
      // 위임 토큰에 요청자 userId 가 실려야 file-service 접근 검사를 통과한다(upload 와 같은 근거).
      expect(verify(auth.replace('Bearer ', ''), SECRET)).toMatchObject({ userId: 'u1', scopes: ['master'] });
    });

    // 이 분기가 "통보된 fileId 가 실재하는가"의 답이다 — 예외로 만들면 배치 한 건의
    // 오타가 나머지 49건을 통째로 죽인다.
    it('404 는 예외가 아니라 null 이다', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('not found'),
      }) as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).resolves.toBeNull();
    });

    it('그 밖의 실패는 상태코드를 담아 던진다', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('boom'),
      }) as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).rejects.toThrow('(500)');
    });

    it('응답 형태가 다르면 던진다 — 조용히 통과시키면 검증이 무력화된다', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'f1' }),
      }) as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).rejects.toThrow('형태');
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts -t getMetadata`
Expected: FAIL — `client.getMetadata is not a function`

- [ ] **Step 3: 구현한다**

`form-export-file.client.ts` 상단 상수 옆에 추가:

```ts
/**
 * 메타데이터 조회 타임아웃. 해석 요청 하나가 최대 50건을 순차로 확인하므로
 * (bulk-image.manager.ts 의 MAX_RESOLUTIONS_PER_REQUEST), 건당 상한이 없으면 한 요청이
 * ALB 60초 천장을 넘길 수 있다. 5초 × 50 = 최악 250초는 여전히 넘지만, 그 상태는
 * file-service 가 죽은 것이고 첫 몇 건에서 이미 실패로 드러난다.
 */
const METADATA_TIMEOUT_MS = 5_000;
```

클래스 밖(파일 상단, `@Injectable` 위)에 타입:

```ts
/** file-service 메타데이터 응답 중 core 가 쓰는 것만. 전체를 끌고 다니지 않는다. */
export interface BulkFileMetadata {
  id: string;
  contextId: string;
  status: string;
  originalName: string;
}
```

`getDownloadUrl` 아래에 메서드:

```ts
  /**
   * 통보받은 fileId 가 실재하고 어떤 컨텍스트로 올라갔는지 확인한다.
   *
   * **404 는 예외가 아니라 `null`** 이다 — "그런 파일 없음"은 배치 항목 하나의 정상적인
   * 실패 사유이고, 예외로 만들면 오타 한 건이 나머지 49건을 통째로 죽인다.
   *
   * 권한은 `token()` 의 `scopes:['master']` 가 통과시킨다(file-access.ts:54-63 이
   * master 스코프에서 단락한다). 즉 **file-service 는 소유권을 강제하지 않으므로**
   * 세션 소유권 검사는 호출부(BulkImageManager)가 이미 끝낸 상태여야 한다.
   */
  async getMetadata(fileId: string, userId: string): Promise<BulkFileMetadata | null> {
    const res = await fetch(`${this.baseUrl}/files/${fileId}/metadata`, {
      headers: { Authorization: `Bearer ${this.token(userId)}` },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await this.describeFailure('메타데이터 조회', res));

    const json: unknown = await res.json();
    const meta = this.extractMetadata(json);
    if (!meta) throw new Error('file-service 메타데이터 응답 형태가 다릅니다');
    return meta;
  }
```

`extractSignedUrl` 아래에 private:

```ts
  /** `res.json()` 은 `unknown` 이다 — 캐스팅 대신 `in` narrowing 으로 실제 검증한다(위 두 추출기와 같은 관례). */
  private extractMetadata(json: unknown): BulkFileMetadata | null {
    if (typeof json !== 'object' || json === null) return null;
    if (!('id' in json) || typeof json.id !== 'string') return null;
    if (!('contextId' in json) || typeof json.contextId !== 'string') return null;
    if (!('status' in json) || typeof json.status !== 'string') return null;
    const originalName = 'originalName' in json && typeof json.originalName === 'string' ? json.originalName : '';
    return { id: json.id, contextId: json.contextId, status: json.status, originalName };
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts
git commit -m "feat(bulk-session): file-service 메타데이터 조회(404=null) 추가"
```

---

## Task 5: `BulkImageManager` — 해석 통보·전량 게이트·자동 전진

이 태스크가 이 단계의 심장이다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.spec.ts`

**Interfaces:**
- Consumes: `checkFileMetadata`·`dedupeResolutions`·`imageRefKey`·`BulkImageUsage` (Task 1), `BulkSessionReader.hasPendingImageWork`·`getProgress` (Task 2), `FormExportFileClient.getMetadata`·`softDelete` (Task 4), DTO (Task 3)
- Produces:
  - `const MAX_RESOLUTIONS_PER_REQUEST = 50`
  - `interface ResolveEntry { imageKey: string; usage: BulkImageUsage; fileId: string }`
  - `BulkImageManager.resolve(sessionId: string, userId: string, entries: ResolveEntry[], tx?: DbTransaction): Promise<ResolveImagesResponseDto>`

**트랜잭션 경계 (이 클래스의 규율):** 2단계 `accept` 가 세운 3단계 분리를 그대로 쓴다.

```
① 짧은 트랜잭션  : 소유권·phase 가드 + 대상 이미지 행 적재
② 트랜잭션 밖    : 항목마다 file-service 메타데이터 확인 (HTTP)
③ 짧은 트랜잭션  : 통과분 UPDATE + 전량 게이트 판정 + phase CAS + 진행률
④ 트랜잭션 밖    : 교체된 옛 fileId best-effort soft delete (HTTP)
```

HTTP 호출이 DB 트랜잭션을 물면 커넥션이 초 단위로 잠긴다. `db.run(fn, tx)` 을 ①③ 에서만 부른다.

> **사전 판정 (사용자 결정, 2026-08-02):** 아래 스펙의 페이크 DB 하네스는 `bulk-session.reader.spec.ts`·`bulk-session.manager.spec.ts` 에 이어 **세 번째 복사본**이다. 공용 모듈로 추출하지 않는 것이 확정된 결정이다 — 세 하네스는 지원 연산자와 `groupBy`/count 의미가 서로 달라, 합치면 합집합이 지저분해지고 2단계 테스트를 건드리는 사전 작업이 하나 는다. 리뷰에서 "중복"으로 지적되면 이 판정이 governs 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.spec.ts`:

```ts
import { ConflictError, NotFoundError } from '@app/shared';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BulkImageManager } from './bulk-image.manager';
import { BulkSessionReader } from './bulk-session.reader';
import { productBulkImages, productBulkItems, productBulkSessions } from '../../../schema/catalog.schema';

type FakeRow = Record<string, unknown>;

const dialect = new PgDialect();

/** drizzle 컬럼명(snake_case) → 픽스처 키(camelCase). */
function toCamelKey(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * `.where()` 에 넘어온 조건을 렌더해 행이 그 조건을 만족하는지 판정한다. 이 매니저가
 * 실제로 쓰는 연산자(`eq`·`and`·`isNull`)만 지원한다 — bulk-session.manager.spec.ts 가
 * 세운 기법을 필요한 만큼만 가져온다.
 */
function rowMatchesCondition(row: FakeRow, condition: unknown): boolean {
  if (condition === undefined) return true;
  const { sql, params } = dialect.sqlToQuery(condition as never);
  const lowered = sql.toLowerCase();
  let ok = true;
  for (const m of lowered.matchAll(/"(\w+)"\s*=\s*\$(\d+)/g)) {
    if (row[toCamelKey(m[1])] !== params[Number(m[2]) - 1]) ok = false;
  }
  for (const m of lowered.matchAll(/"(\w+)"\s+is\s+null/g)) {
    const value = row[toCamelKey(m[1])];
    if (!(value === null || value === undefined)) ok = false;
  }
  return ok;
}

interface Chain extends Promise<FakeRow[]> {
  where(condition?: unknown): Chain;
  orderBy(...args: unknown[]): Chain;
  groupBy(...args: unknown[]): Chain;
  limit(n?: number): Chain;
  offset(n?: number): Chain;
}

function chain(rows: FakeRow[], isCount = false): Chain {
  const builder = Promise.resolve(isCount ? [{ value: rows.length }] : rows) as Chain;
  builder.where = (condition) => chain(rows.filter((row) => rowMatchesCondition(row, condition)), isCount);
  builder.orderBy = () => builder;
  builder.groupBy = () => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(String(row.status), (counts.get(String(row.status)) ?? 0) + 1);
    return chain([...counts.entries()].map(([status, value]) => ({ status, value })));
  };
  builder.limit = () => builder;
  builder.offset = () => builder;
  return builder;
}

interface Fixture {
  sessions: FakeRow[];
  items: FakeRow[];
  images: FakeRow[];
}

function harness(fixture: Fixture, metadata: Record<string, { contextId: string; status: string } | null> = {}) {
  const tableRows = (table: unknown): FakeRow[] => {
    if (table === productBulkSessions) return fixture.sessions;
    if (table === productBulkItems) return fixture.items;
    if (table === productBulkImages) return fixture.images;
    throw new Error('알 수 없는 테이블');
  };

  const trx = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => chain(tableRows(table), isCountQuery(fields)),
    }),
    update: (table: unknown) => ({
      set: (values: FakeRow) => ({
        where: (condition?: unknown) => {
          const target = tableRows(table).filter((row) => rowMatchesCondition(row, condition));
          for (const row of target) Object.assign(row, values);
          return {
            returning: () => Promise.resolve(target.map((row) => ({ ...row }))),
            then: (resolve: (rows: FakeRow[]) => unknown) => resolve(target),
          };
        },
      }),
    }),
  };

  const softDeleted: string[] = [];
  const fileClient = {
    getMetadata: (fileId: string) => Promise.resolve(metadata[fileId] ?? null),
    softDelete: (fileId: string) => {
      softDeleted.push(fileId);
      return Promise.resolve();
    },
  };

  const db = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  // 진짜 Reader 를 같은 페이크 DB 로 만든다 — 게이트 술어와 진행률이 실제로 도는지 봐야 한다
  // (bulk-session.manager.spec.ts:549-550 과 같은 이유).
  const reader = new BulkSessionReader(db as never);
  const manager = new BulkImageManager(db as never, fileClient as never, reader);
  return { manager, fileClient, softDeleted, fixture };
}

function isCountQuery(fields: unknown): boolean {
  if (typeof fields !== 'object' || fields === null) return false;
  const keys = Object.keys(fields);
  return keys.length === 1 && keys[0] === 'value';
}

const SESSION = '00000000-0000-7000-8000-000000000001';
const USER = '00000000-0000-7000-8000-000000000009';
const FILE = '00000000-0000-7000-8000-0000000000aa';

function baseFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    sessions: [{ id: SESSION, uploadedBy: USER, phase: 'awaiting_images', cancelRequestedAt: null, totalRows: 1, phaseError: null }],
    items: [{ sessionId: SESSION, status: 'pending', payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] } }],
    images: [
      { id: 'img-row-1', sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', sourceKind: 'file_name', sourceValue: 'front.jpg', status: 'awaiting_upload', fileId: null },
    ],
    ...overrides,
  };
}

describe('BulkImageManager.resolve — 가드', () => {
  it('남의 세션이면 NotFoundError', async () => {
    const { manager } = harness(baseFixture(), { [FILE]: { contextId: 'product-image', status: 'active' } });
    await expect(
      manager.resolve(SESSION, 'someone-else', [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('awaiting_images 가 아니면 ConflictError', async () => {
    const fixture = baseFixture();
    fixture.sessions[0].phase = 'review';
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await expect(
      manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('BulkImageManager.resolve — 항목 처리', () => {
  it('통과한 항목을 resolved 로 기록한다', async () => {
    const { manager, fixture } = harness(baseFixture(), { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results).toEqual([{ imageKey: 'IMG-1', usage: 'main', ok: true, error: null }]);
    expect(fixture.images[0].status).toBe('resolved');
    expect(fixture.images[0].fileId).toBe(FILE);
  });

  it('요구가 전부 채워지면 phase 가 drafting 으로 전진한다', async () => {
    const { manager, fixture } = harness(baseFixture(), { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.sessions[0].phase).toBe('drafting');
    expect(out.progress.phase).toBe('drafting');
  });

  it('요구가 남으면 전진하지 않는다', async () => {
    const fixture = baseFixture();
    fixture.items[0].payload = { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }, { imageKey: 'IMG-2', usage: 'main' }] };
    fixture.images.push({ id: 'img-row-2', sessionId: SESSION, imageKey: 'IMG-2', usage: 'main', sourceKind: 'file_name', sourceValue: 'back.jpg', status: 'awaiting_upload', fileId: null });
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.sessions[0].phase).toBe('awaiting_images');
  });

  // 이 케이스가 게이트의 존재 이유다 — invalid 행만 참조하던 이미지는 영원히 안 올라온다.
  it('아무도 참조하지 않는 미해결 이미지가 남아도 전진한다', async () => {
    const fixture = baseFixture();
    fixture.images.push({ id: 'img-row-9', sessionId: SESSION, imageKey: 'IMG-9', usage: 'main', sourceKind: 'file_name', sourceValue: 'ghost.jpg', status: 'awaiting_upload', fileId: null });
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.sessions[0].phase).toBe('drafting');
  });

  it('없는 참조는 그 항목만 실패한다 — 나머지는 기록된다', async () => {
    const fixture = baseFixture();
    fixture.items[0].payload = { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] };
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [
      { imageKey: 'GHOST', usage: 'main', fileId: FILE },
      { imageKey: 'IMG-1', usage: 'main', fileId: FILE },
    ]);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[1].ok).toBe(true);
    expect(fixture.images[0].status).toBe('resolved');
  });

  it('file-service 에 없는 fileId 는 거절한다', async () => {
    const { manager, fixture } = harness(baseFixture(), {});
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(false);
    expect(fixture.images[0].status).toBe('awaiting_upload');
  });

  it('용도와 컨텍스트가 어긋난 파일은 거절한다', async () => {
    const { manager } = harness(baseFixture(), { [FILE]: { contextId: 'product-description-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].error).toContain('product-image');
  });

  it('양식에 파일ID로 적힌 행(sourceKind=file_id)은 업로드로 교체할 수 없다', async () => {
    const fixture = baseFixture();
    fixture.images[0].sourceKind = 'file_id';
    fixture.images[0].status = 'resolved';
    fixture.images[0].fileId = '00000000-0000-7000-8000-0000000000bb';
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(false);
    expect(fixture.images[0].fileId).toBe('00000000-0000-7000-8000-0000000000bb');
  });

  it('이미 올린 파일을 교체하면 옛 파일을 지운다', async () => {
    const OLD = '00000000-0000-7000-8000-0000000000cc';
    const fixture = baseFixture();
    fixture.images[0].status = 'resolved';
    fixture.images[0].fileId = OLD;
    const { manager, softDeleted } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.images[0].fileId).toBe(FILE);
    expect(softDeleted).toEqual([OLD]);
  });

  it('같은 fileId 를 다시 통보하면 옛 파일을 지우지 않는다 — 자기 자신을 지우는 사고', async () => {
    const fixture = baseFixture();
    fixture.images[0].status = 'resolved';
    fixture.images[0].fileId = FILE;
    const { manager, softDeleted } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(true);
    expect(softDeleted).toEqual([]);
  });

  it('한 요청 안의 중복은 마지막 것만 적용한다', async () => {
    const SECOND = '00000000-0000-7000-8000-0000000000dd';
    const { manager, fixture, softDeleted } = harness(baseFixture(), {
      [FILE]: { contextId: 'product-image', status: 'active' },
      [SECOND]: { contextId: 'product-image', status: 'active' },
    });
    const out = await manager.resolve(SESSION, USER, [
      { imageKey: 'IMG-1', usage: 'main', fileId: FILE },
      { imageKey: 'IMG-1', usage: 'main', fileId: SECOND },
    ]);
    expect(out.results).toHaveLength(1);
    expect(fixture.images[0].fileId).toBe(SECOND);
    expect(softDeleted).toEqual([]);
  });

  it('상한을 넘긴 요청은 매니저가 거절한다 — DTO 가 뚫려도 서버가 막는다', async () => {
    const { manager } = harness(baseFixture());
    const many = Array.from({ length: 51 }, (_, i) => ({ imageKey: `IMG-${i}`, usage: 'main' as const, fileId: FILE }));
    await expect(manager.resolve(SESSION, USER, many)).rejects.toThrow('50');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.spec.ts`
Expected: FAIL — `Cannot find module './bulk-image.manager'`

- [ ] **Step 3: 구현한다**

`apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { type PimSchema, productBulkImages, productBulkSessions } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { FormExportFileClient } from './form-export-file.client';
import { BulkSessionReader } from './bulk-session.reader';
import { checkFileMetadata, dedupeResolutions, imageRefKey, type BulkImageUsage } from './bulk-session.images';
import { ResolveImageResultDto, ResolveImagesResponseDto } from '../dto';

/**
 * 한 요청이 담을 수 있는 해석 통보 수.
 *
 * 항목마다 file-service 메타데이터를 순차로 확인하므로 요청 시간이 이 수에 비례한다.
 * ALB idle timeout 이 60초(스펙 §2.7)이고 건당 타임아웃이 5초라 최악을 감당할 수는
 * 없지만, 정상 경로(수십 ms)에서는 50건이 1~2초다. 브라우저는 업로드가 끝나는 대로
 * 나눠 보낸다 — 한 번에 다 보내야 할 이유가 없다.
 */
export const MAX_RESOLUTIONS_PER_REQUEST = 50;

export interface ResolveEntry {
  imageKey: string;
  usage: BulkImageUsage;
  fileId: string;
}

/** ② 단계를 통과해 실제로 쓸 것 하나. `previousFileId` 는 ④ 단계 정리 대상이다. */
interface AppliedResolution {
  rowId: string;
  fileId: string;
  previousFileId: string | null;
}

@Injectable()
export class BulkImageManager {
  private readonly logger = new Logger(BulkImageManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly reader: BulkSessionReader,
  ) {}

  /**
   * 브라우저가 file-service 에 직접 올린 파일들을 `(imageKey, usage, fileId)` 로 통보받아
   * 기록하고, 요구된 파일이 전부 채워졌으면 `drafting` 으로 전진시킨다.
   *
   * **부분 성공이다.** 50건 중 3건이 실패해도 47건은 기록된다 — 배치 전체를 400 으로
   * 돌리면 성공한 47장이 재업로드돼 S3 고아가 47개 생긴다(file-service 에 고아 정리 잡이
   * 없다, 스펙 §2.7). 실패는 항목별 `results[i].error` 로 돌려준다.
   *
   * **트랜잭션 경계**(2단계 `BulkSessionManager.accept` 가 세운 3단계 분리와 같은 규율):
   * ① 짧은 트랜잭션에서 가드 + 대상 적재 → ② 트랜잭션 **밖**에서 메타데이터 확인 →
   * ③ 짧은 트랜잭션에서 UPDATE + 게이트 + CAS → ④ 트랜잭션 **밖**에서 옛 파일 정리.
   * HTTP 왕복이 DB 트랜잭션을 물면 커넥션이 초 단위로 잠긴다.
   */
  async resolve(
    sessionId: string,
    userId: string,
    entries: ResolveEntry[],
    tx?: DbTransaction,
  ): Promise<ResolveImagesResponseDto> {
    // DTO 의 @ArrayMaxSize 와 중복이지만 서버가 다시 막는다 — 매니저는 컨트롤러 없이도
    // (통합 테스트·미래의 내부 호출) 불릴 수 있고, 그때 상한이 사라지면 안 된다.
    if (entries.length > MAX_RESOLUTIONS_PER_REQUEST) {
      throw new BadRequestError(`한 번에 최대 ${MAX_RESOLUTIONS_PER_REQUEST}건까지 보낼 수 있습니다.`);
    }
    const deduped = dedupeResolutions(entries);

    // ─── ① 가드 + 대상 적재 ───
    const targets = await this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      // 소유권은 존재 검사와 같은 오류로 합친다 — 구분 자체가 id 존재 여부 오라클이 된다.
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'awaiting_images') {
        throw new ConflictError('이미지 업로드 단계가 아닌 세션입니다.');
      }

      const rows = await trx
        .select({
          id: productBulkImages.id,
          imageKey: productBulkImages.imageKey,
          usage: productBulkImages.usage,
          sourceKind: productBulkImages.sourceKind,
          fileId: productBulkImages.fileId,
        })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId));

      return new Map(rows.map((row) => [imageRefKey(row.usage, row.imageKey), row]));
    }, tx);

    // ─── ② 항목별 확인 (트랜잭션 밖) ───
    const results: ResolveImageResultDto[] = [];
    const applied: AppliedResolution[] = [];

    for (const entry of deduped) {
      const fail = (error: string) => results.push({ imageKey: entry.imageKey, usage: entry.usage, ok: false, error });
      const row = targets.get(imageRefKey(entry.usage, entry.imageKey));

      if (!row) {
        fail('이 세션에 없는 이미지 참조입니다. 양식의 이미지키와 용도를 확인해 주세요.');
        continue;
      }
      // 양식에 파일ID로 적힌 원본은 이미 file-service 에 있는 파일을 가리킨다 — 그걸
      // 업로드로 바꾸면 워크북과 실제가 어긋난다. 바꾸려면 워크북에서 키를 고쳐야 한다.
      if (row.sourceKind !== 'file_name') {
        fail('양식에 파일ID로 적힌 이미지는 업로드로 바꿀 수 없습니다.');
        continue;
      }
      // 같은 값 재통보는 성공으로 친다(멱등) — 네트워크 재시도가 실패로 보이면 안 된다.
      if (row.fileId === entry.fileId) {
        results.push({ imageKey: entry.imageKey, usage: entry.usage, ok: true, error: null });
        continue;
      }

      const meta = await this.fileClient.getMetadata(entry.fileId, userId);
      if (!meta) {
        fail('업로드된 파일을 찾을 수 없습니다. 다시 올려주세요.');
        continue;
      }
      const problem = checkFileMetadata(meta, entry.usage);
      if (problem) {
        fail(problem);
        continue;
      }

      applied.push({ rowId: row.id, fileId: entry.fileId, previousFileId: row.fileId });
      results.push({ imageKey: entry.imageKey, usage: entry.usage, ok: true, error: null });
    }

    // ─── ③ 기록 + 전량 게이트 + 전진 ───
    const progress = await this.db.run(async (trx) => {
      for (const item of applied) {
        // sourceKind 조건을 다시 건다 — ① 이후 바뀔 경로는 없지만 CAS 는 싸고,
        // 조건이 사라지면 나중에 그 불변식을 깨는 경로가 생겨도 조용히 통과한다.
        await trx
          .update(productBulkImages)
          .set({ fileId: item.fileId, status: 'resolved', updatedAt: new Date() })
          .where(and(eq(productBulkImages.id, item.rowId), eq(productBulkImages.sourceKind, 'file_name')));
      }

      if (!(await this.reader.hasPendingImageWork(trx, sessionId))) {
        // `phase='awaiting_images'` + 취소 없음 CAS. 두 탭이 동시에 마지막 파일을
        // 통보하면 한쪽만 이기고, 그 사이 취소가 끼어들면 아무도 이기지 않는다 —
        // "취소됐는데 phase 는 drafting" 인 좀비를 만들지 않는다(2단계 approve 와 같은 CAS).
        const [advanced] = await trx
          .update(productBulkSessions)
          .set({ phase: 'drafting', phaseError: null, updatedAt: new Date() })
          .where(
            and(
              eq(productBulkSessions.id, sessionId),
              eq(productBulkSessions.phase, 'awaiting_images'),
              isNull(productBulkSessions.cancelRequestedAt),
            ),
          )
          .returning({ id: productBulkSessions.id });
        // 졌다고 예외를 던지지 않는다 — 이 요청의 본래 일(파일 기록)은 이미 성공했고,
        // 응답의 progress 가 실제 phase 를 그대로 보여준다.
        if (!advanced) {
          this.logger.debug(`전량 게이트 전진 CAS 에서 밀렸습니다 (session=${sessionId})`);
        }
      }

      return this.reader.getProgress(sessionId, userId, trx);
    }, tx);

    // ─── ④ 교체된 옛 파일 정리 (트랜잭션 밖, best-effort) ───
    // 실패해도 이 요청을 실패시키지 않는다 — 기록은 이미 끝났고, 정리 실패는 S3 고아
    // 한 장이지 작업자가 행동할 수 있는 문제가 아니다.
    for (const item of applied) {
      if (!item.previousFileId || item.previousFileId === item.fileId) continue;
      try {
        await this.fileClient.softDelete(item.previousFileId, userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`교체된 옛 이미지 정리 실패 (session=${sessionId}, file=${item.previousFileId}): ${message}`);
      }
    }

    return { results, progress };
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.spec.ts`
Expected: PASS (전 케이스). 페이크 DB 하네스가 `update().set().where()` 를 await 하는 형태와 `.returning()` 형태를 둘 다 받아야 한다 — 위 하네스가 그렇게 돼 있다. 실패하면 하네스를 고치지 말고 **매니저가 실제로 부르는 체인 모양**을 먼저 확인한다.

- [ ] **Step 5: 타입 게이트**

Run: `npm run type-check:scoped`
Expected: exit 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.manager.spec.ts
git commit -m "feat(bulk-session): 이미지 해석 통보 처리 + 전량 게이트 자동 전진"
```

---

## Task 6: 라우트 배선 — 컨트롤러 · 서비스 · 모듈

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.service.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts`

**Interfaces:**
- Consumes: `BulkSessionReader.getImages` (Task 3), `BulkImageManager.resolve` (Task 5), DTO (Task 3)
- Produces:
  - `GET  /product-bulk-sessions/:id/images?status=&onlyRequired=&page=&limit=` → `BulkSessionImageListDto`
  - `POST /product-bulk-sessions/:id/images/resolve` → `ResolveImagesResponseDto`

- [ ] **Step 1: 서비스 포트 두 개를 더한다**

`bulk-session.service.ts` — import 를 보강하고(`BulkImageManager`, `BulkImageFilter`, `ResolveEntry`, 새 DTO) `cancel` 아래에 추가:

```ts
  getImages(
    sessionId: string,
    userId: string,
    filter: BulkImageFilter,
  ): Promise<BulkSessionImageListDto> {
    return this.reader.getImages(sessionId, userId, filter);
  }

  resolveImages(sessionId: string, userId: string, entries: ResolveEntry[]): Promise<ResolveImagesResponseDto> {
    return this.imageManager.resolve(sessionId, userId, entries);
  }
```

생성자에 `private readonly imageManager: BulkImageManager` 를 더한다.

- [ ] **Step 2: 컨트롤러에 라우트 두 개를 더한다**

`bulk-session.controller.ts` — `cancel` 아래에 추가하고, 파일 상단에 필요한 import(`isBulkImageUsage` 는 쓰지 않는다 — DTO 의 `@IsIn` 이 막는다)를 더한다:

```ts
  @Get(':id/images')
  @ApiOperation({
    summary: '이 세션이 요구하는 이미지 목록. required=true 인 awaiting_upload 행의 sourceValue 가 올려야 할 파일명이다.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['resolved', 'awaiting_upload'] })
  @ApiQuery({ name: 'onlyRequired', required: false, description: 'true 면 적용될 행이 참조하는 것만' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: BulkSessionImageListDto })
  @ApiResponse({ status: 404, description: '세션이 없거나 내 것이 아님' })
  async getImages(
    @Param('id') id: string,
    @Query('status') status: string | undefined,
    @Query('onlyRequired') onlyRequired: string | undefined,
    @Query('page') page = '1',
    @Query('limit') limit = '200',
    @User() user: { userId: string },
  ): Promise<BulkSessionImageListDto> {
    if (status !== undefined && status !== 'resolved' && status !== 'awaiting_upload') {
      throw new BadRequestException('status 는 resolved 또는 awaiting_upload 여야 합니다');
    }
    return this.service.getImages(id, user.userId, {
      status,
      onlyRequired: onlyRequired === 'true' || onlyRequired === '1',
      page: parsePage(page),
      limit: parseLimit(limit),
    });
  }

  @Post(':id/images/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '브라우저가 file-service 에 올린 파일을 (imageKey, usage, fileId) 로 통보한다. 요구가 전부 채워지면 phase 가 drafting 으로 전진한다.',
  })
  @ApiResponse({ status: 200, type: ResolveImagesResponseDto, description: '부분 성공 — 항목별 결과를 본다' })
  @ApiResponse({ status: 400, description: '요청 형식 오류 또는 상한 초과' })
  @ApiResponse({ status: 404, description: '세션이 없거나 내 것이 아님' })
  @ApiResponse({ status: 409, description: 'awaiting_images 단계가 아님' })
  async resolveImages(
    @Param('id') id: string,
    @Body() dto: ResolveImagesDto,
    @User() user: { userId: string },
  ): Promise<ResolveImagesResponseDto> {
    return this.service.resolveImages(id, user.userId, dto.resolutions);
  }
```

**`parseLimit` 를 고쳐야 한다.** 현재 상한이 100 인데(`bulk-session.controller.ts:35`) 이미지 목록의 기본값을 200 으로 두면 조용히 100 으로 깎인다. 이미지 행은 아이템 행보다 훨씬 가벼우므로 **이미지 전용 파서를 따로 둔다** — 기존 `parseLimit` 는 건드리지 않는다(아이템 목록의 상한은 payload 크기 때문에 그대로여야 한다):

```ts
/** 이미지 행은 아이템 행보다 훨씬 가벼워(문자열 몇 개) 상한을 높게 둔다. */
function parseImageLimit(limit: string): number {
  return Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 200));
}
```

위 라우트의 `parseLimit(limit)` 를 `parseImageLimit(limit)` 로 바꾼다.

- [ ] **Step 3: 모듈에 등록한다**

`bulk-session.module.ts` — `BulkImageManager` 와 (Task 7 이후) `BulkImageCleaner` 를 providers 에 더한다. 지금은 매니저만:

```ts
import { BulkImageManager } from './services/bulk-image.manager';
```

providers 배열 끝에 `BulkImageManager,` 를 넣고, 파일 상단 주석 블록 끝에 한 문단을 잇는다:

```
// BulkImageManager 는 3단계 이미지 해석 통보 경로다. BulkSessionReader 를 주입받아
// 전량 게이트 술어와 진행률을 승인 경로와 **공유**한다 — 복사본을 만들면 승인과 게이트가
// 서로 다른 답을 내는 자리가 생긴다.
```

- [ ] **Step 4: 부팅 스펙을 갱신한다**

`bulk-session.module.spec.ts` 는 실제 Nest 컨테이너를 `.compile()` 해 provider 그래프를 해석한다(`DATABASE_URL` 없으면 skip). 동적 import 목록과 단정 두 줄을 더한다:

```ts
    const { BulkImageManager } = await import('./services/bulk-image.manager');
    const { BulkImageCleaner } = await import('./services/bulk-image.cleaner');
```

`BulkSessionJobWorker` 단정 아래에 붙인다:

```ts
    // 3단계 이미지 경로. BulkImageManager 가 해석된다는 건 그 생성자가 받는
    // DbService<PimSchema>/FormExportFileClient/BulkSessionReader 3개 의존성도 함께 실제로
    // 해석됐다는 뜻이다 — 특히 BulkSessionReader 는 2단계까지 BulkSessionManager 만 쓰던
    // provider 라, 새 소비자가 붙는 순간 등록 누락이 여기서만 드러난다.
    expect(moduleRef.get(BulkImageManager, { strict: false })).toBeInstanceOf(BulkImageManager);
    // 정리 스윕. @Cron 은 provider 로 등록돼야 ScheduleExplorer 가 마운트한다 —
    // 등록을 빠뜨리면 타입도 테스트도 초록인 채 **크론이 영영 안 돈다**.
    expect(moduleRef.get(BulkImageCleaner, { strict: false })).toBeInstanceOf(BulkImageCleaner);
```

**DI 그래프는 타입 체크로 절대 안 잡힌다**(Nest 는 런타임 reflection) — 이 스펙이 유일한 방어선이다. `BulkImageCleaner` 는 Task 7 에서 생기므로, 그 단정은 Task 7 Step 4 에서 함께 넣는다(지금 넣으면 import 가 깨진다).

- [ ] **Step 5: 관련 테스트 전부 통과 확인**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session
```
Expected: PASS (통합 스펙은 DATABASE_URL 없이 skip 된다)

- [ ] **Step 6: 타입 게이트 + lint**

```bash
npm run type-check:scoped
npx eslint apps/core/src/modules/catalog/operations/bulk-session --ext .ts
```
Expected: type-check exit 0. lint 는 **변경 파일 기준 신규 error 0** — 기존 debt 는 판정 대상이 아니다.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.service.ts \
        apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts \
        apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts
git commit -m "feat(bulk-session): 이미지 목록·해석 통보 라우트 2종 배선"
```

---

## Task 7: 취소 세션 이미지 스윕 (`@Cron`)

**왜 인라인이 아닌가:** v3 는 취소 안에서 바로 지웠다(`product-import-image.cleaner.ts`). 여기서는 못 한다 — 파싱 슬라이스가 세션당 이미지 행을 최대 1만 건까지 만들고(`bulk-session-job.manager.ts` 의 상한 주석), 순차 soft delete 1만 회는 ALB 60초를 한참 넘긴다. 취소는 즉시 끝나야 하는 동작이다.

**왜 `phase='canceled'` 만으로 부족한가:** `cancel` 은 `published`·`canceled` 를 뺀 **모든** phase 에서 허용된다 — `drafting` 이후 취소도 된다. 스펙 §3.12 는 "`drafting` 이전 취소면 이미지를 정리하고, 이후면 draft 가 참조 중이므로 유지"라고 못 박는다. 3단계에는 아직 4단계 워커가 없어 실제로 그 상태에 도달할 수 없지만, **4단계가 오는 순간 이 스윕이 draft 가 쓰는 파일을 지운다.** 그래서 지금부터 `draft_version_id` 가 하나라도 붙은 세션은 건드리지 않는다 — 그 컬럼은 2단계 스키마에 이미 있어서 마이그레이션이 0으로 유지된다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.cleaner.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.cleaner.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts` (cancel 독스트링만)

**Interfaces:**
- Consumes: `FormExportFileClient.softDelete` (기존)
- Produces:
  - `const IMAGE_CLEANUP_BATCH = 100`
  - `BulkImageCleaner.sweepOnce(): Promise<{ deleted: number; failed: number }>`
  - `BulkImageCleaner.sweep(): Promise<void>` (`@Cron`)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.cleaner.spec.ts`:

```ts
import { BulkImageCleaner, IMAGE_CLEANUP_BATCH } from './bulk-image.cleaner';

/**
 * 이 스펙은 스윕의 **결정과 부수효과**만 본다 — 어떤 행을 고르는지(SQL 술어)는 페이크로
 * 흉내 낼 수 없으므로 통합 스펙(Task 8)이 실 Postgres 로 증명한다. 여기서는 후처리
 * (성공 → fileId 비우기, 실패 → 뒤로 미루기, 업로더 없음 → 건너뛰기)를 못 박는다.
 */
function harness(rows: Array<{ id: string; fileId: string | null; uploadedBy: string | null }>, failing: string[] = []) {
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const deleted: string[] = [];

  const trx = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        // 어느 행인지는 조건 렌더 대신 호출 순서로 짝짓는다 — 이 스펙의 관심사는
        // "성공/실패에 따라 무엇을 쓰는가"이고, 대상 선택(SQL 술어)은 통합 스펙이 본다.
        where: () => {
          updates.push({ id: String(updates.length), values });
          return Promise.resolve([]);
        },
      }),
    }),
  };

  const fileClient = {
    softDelete: (fileId: string) => {
      if (failing.includes(fileId)) return Promise.reject(new Error('boom'));
      deleted.push(fileId);
      return Promise.resolve();
    },
  };

  const db = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  const config = { get: () => undefined };
  const cleaner = new BulkImageCleaner(db as never, fileClient as never, config as never);
  return { cleaner, updates, deleted };
}

describe('BulkImageCleaner.sweepOnce', () => {
  it('대상 파일을 지우고 행의 fileId 를 비운다', async () => {
    const { cleaner, updates, deleted } = harness([{ id: 'r1', fileId: 'f1', uploadedBy: 'u1' }]);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(deleted).toEqual(['f1']);
    expect(updates[0].values).toMatchObject({ fileId: null, status: 'awaiting_upload' });
  });

  // 실패한 행이 매 틱 배치 앞머리를 차지하면 뒤의 정상 행이 영영 안 지워진다.
  it('실패하면 updatedAt 만 갱신해 대기열 뒤로 보낸다', async () => {
    const { cleaner, updates } = harness([{ id: 'r1', fileId: 'f1', uploadedBy: 'u1' }], ['f1']);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(updates[0].values).not.toHaveProperty('fileId');
    expect(updates[0].values).toHaveProperty('updatedAt');
  });

  it('업로더가 없으면 위임 토큰을 만들 수 없어 건너뛴다', async () => {
    const { cleaner, deleted } = harness([{ id: 'r1', fileId: 'f1', uploadedBy: null }]);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(deleted).toEqual([]);
  });

  it('배치 상한이 있다', () => {
    expect(IMAGE_CLEANUP_BATCH).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.cleaner.spec.ts`
Expected: FAIL — `Cannot find module './bulk-image.cleaner'`

- [ ] **Step 3: 구현한다**

`apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.cleaner.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDb, DbService } from '@app/db';
import { and, eq, isNotNull, notExists, sql } from 'drizzle-orm';
import {
  type PimSchema,
  productBulkImages,
  productBulkItems,
  productBulkSessions,
} from '../../../schema/catalog.schema';
import { FormExportFileClient } from './form-export-file.client';

/**
 * 한 틱에 지우는 파일 수. 파일마다 file-service HTTP 왕복이 하나라 틱 길이를 유계로
 * 만드는 것이 목적이다. 남은 것은 다음 틱이 이어받는다 — 스윕은 완주할 필요가 없다.
 */
export const IMAGE_CLEANUP_BATCH = 100;

/**
 * 취소된 세션이 올린 이미지 파일을 지운다.
 *
 * file-service 에 고아 파일 정리 잡이 없어(스펙 §2.7) 안 지우면 S3 에 영구 잔존한다.
 *
 * **왜 취소 요청 안에서 하지 않는가**: 파싱 슬라이스가 세션당 이미지 행을 최대 1만 건까지
 * 만든다. 순차 soft delete 1만 회는 ALB 60초를 한참 넘긴다 — 취소는 즉시 끝나야 하는
 * 동작이다(v3 는 인라인이었지만 그쪽은 규모가 달랐다).
 *
 * **왜 `draft_version_id` 를 보는가**: `cancel` 은 `published`·`canceled` 를 뺀 모든
 * phase 에서 허용되므로 `drafting` **이후** 취소도 된다. 스펙 §3.12 는 그때는 draft 가
 * 참조 중이므로 이미지를 **유지**하라고 한다. 3단계에는 4단계 워커가 없어 아직 도달할 수
 * 없는 상태지만, 4단계가 오는 순간 이 스윕이 draft 가 쓰는 파일을 지우게 된다. 지금부터
 * 막아 둔다 — `draft_version_id` 는 2단계 스키마에 이미 있어 마이그레이션이 필요 없다.
 *
 * **왜 `sourceKind='file_name'` 만인가**: `file_id` 행의 fileId 는 우리가 올린 것이
 * 아니라 작업자가 양식에 적어 넣은 **기존 상품 이미지**다. 지우면 살아있는 상품의
 * 이미지가 사라진다.
 */
@Injectable()
export class BulkImageCleaner {
  private readonly logger = new Logger(BulkImageCleaner.name);
  private isSweeping = false;

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * 검증 레인과 **같은 킬스위치**를 쓴다. 하나의 기능이라 따로 끌 이유가 없고, 이름을
   * 늘리면 오타로 조용히 무시되는 자리만 는다(env 이름은 틀려도 아무 신호가 없다).
   */
  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_BULK_SESSION_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (!this.enabled) return;
    if (this.isSweeping) {
      this.logger.debug('이전 이미지 정리 스윕 진행 중, 건너뜀');
      return;
    }
    this.isSweeping = true;
    try {
      const { deleted, failed } = await this.sweepOnce();
      if (deleted > 0 || failed > 0) {
        this.logger.log(`취소 세션 이미지 정리 (삭제 ${deleted}건, 실패 ${failed}건)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(`이미지 정리 스윕 실패: ${message}`, error instanceof Error ? error.stack : undefined);
    } finally {
      this.isSweeping = false;
    }
  }

  /**
   * 한 배치를 처리한다. 크론 밖에서도 부를 수 있게 분리했다(테스트·수동 실행).
   *
   * **HTTP 는 트랜잭션 밖에서 돈다** — 대상 적재와 후처리만 각자 짧은 트랜잭션이다.
   */
  async sweepOnce(): Promise<{ deleted: number; failed: number }> {
    const targets = await this.db.run((trx) =>
      trx
        .select({
          id: productBulkImages.id,
          fileId: productBulkImages.fileId,
          uploadedBy: productBulkSessions.uploadedBy,
        })
        .from(productBulkImages)
        .innerJoin(productBulkSessions, eq(productBulkImages.sessionId, productBulkSessions.id))
        .where(
          and(
            eq(productBulkSessions.phase, 'canceled'),
            eq(productBulkImages.sourceKind, 'file_name'),
            isNotNull(productBulkImages.fileId),
            notExists(
              trx
                .select({ one: sql`1` })
                .from(productBulkItems)
                .where(
                  and(
                    eq(productBulkItems.sessionId, productBulkSessions.id),
                    isNotNull(productBulkItems.draftVersionId),
                  ),
                ),
            ),
          ),
        )
        // 실패한 행은 아래에서 updatedAt 을 갱신해 뒤로 보낸다 — 이 정렬이 그 밀어내기를
        // 성립시킨다. 없으면 영구 실패 파일 하나가 매 틱 배치 앞머리를 차지해 뒤의 정상
        // 행이 영영 안 지워진다.
        .orderBy(productBulkImages.updatedAt)
        .limit(IMAGE_CLEANUP_BATCH),
    );

    let deleted = 0;
    let failed = 0;

    for (const target of targets) {
      const fileId = target.fileId;
      if (!fileId) continue;

      if (!target.uploadedBy) {
        // 위임 토큰에 실을 userId 가 없으면 file-service 를 부를 수 없다. 지금 스키마는
        // uploaded_by 가 NOT NULL 이라 도달 불가지만, 도달하면 조용히 넘기지 않고 남긴다.
        this.logger.warn(`업로더가 없어 이미지 정리를 건너뜁니다 (image=${target.id})`);
        failed += 1;
        continue;
      }

      try {
        await this.fileClient.softDelete(fileId, target.uploadedBy);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`이미지 정리 실패 (image=${target.id}, file=${fileId}): ${message}`);
        failed += 1;
        await this.db.run((trx) =>
          trx.update(productBulkImages).set({ updatedAt: new Date() }).where(eq(productBulkImages.id, target.id)),
        );
        continue;
      }

      // 파일이 사라졌으므로 행도 "파일 없음" 상태로 되돌린다. 취소는 종단이라 이 세션이
      // 다시 업로드를 기다리는 일은 없고, 이 값이 다음 틱의 대상 술어에서 이 행을
      // 빼주므로 스윕이 멱등해진다 — 새 컬럼 없이 진행 상태를 표현하는 방법이다.
      await this.db.run((trx) =>
        trx
          .update(productBulkImages)
          .set({ fileId: null, status: 'awaiting_upload', updatedAt: new Date() })
          .where(eq(productBulkImages.id, target.id)),
      );
      deleted += 1;
    }

    return { deleted, failed };
  }
}
```

- [ ] **Step 4: 모듈에 등록한다**

`bulk-session.module.ts` — import 와 providers 에 `BulkImageCleaner` 를 더하고 주석 한 문단을 잇는다:

```
// BulkImageCleaner 는 취소된 세션이 올린 파일을 지우는 @Cron 스윕이다. 워커와 마찬가지로
// provider 로 등록돼야 (전역으로 이미 떠 있는) ScheduleModule 의 explorer 가 크론에 마운트한다.
```

그리고 `bulk-session.module.spec.ts` 에 Task 6 에서 미뤄 둔 두 줄을 넣는다:

```ts
    const { BulkImageCleaner } = await import('./services/bulk-image.cleaner');
```

```ts
    // 정리 스윕. @Cron 은 provider 로 등록돼야 ScheduleExplorer 가 마운트한다 —
    // 등록을 빠뜨리면 타입도 테스트도 초록인 채 **크론이 영영 안 돈다**.
    expect(moduleRef.get(BulkImageCleaner, { strict: false })).toBeInstanceOf(BulkImageCleaner);
```

- [ ] **Step 5: 2단계 cancel 독스트링을 갱신한다**

`bulk-session.manager.ts` 의 `cancel` 독스트링에서 "실제 업로드된 파일 정리는 3단계(이미지 레인)의 몫이다" 문장을 다음으로 바꾼다:

```
   * **이미지 정리는 여기서 하지 않는다.** 취소는 즉시 끝나야 하고 세션당 이미지 행이
   * 최대 1만 건이라 인라인 삭제가 불가능하다 — `BulkImageCleaner` 의 @Cron 스윕이
   * `phase='canceled'` 세션을 찾아 지운다(draft 가 하나라도 붙은 세션은 건드리지 않는다).
```

- [ ] **Step 6: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session
npm run type-check:scoped
```
Expected: PASS / exit 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.cleaner.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-image.cleaner.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts \
        apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts
git commit -m "feat(bulk-session): 취소 세션 이미지 정리 스윕(@Cron, draft 보호)"
```

---

## Task 8: 통합 테스트 — 실 Postgres

**왜 필요한가:** 이 단계의 두 핵심 주장은 페이크 DB 로 증명되지 않는다. (1) 스윕의 `notExists` 술어가 진짜 SQL 로 draft 붙은 세션을 제외하는가, (2) 게이트 전진 CAS 가 동시 요청에서 한 번만 이기는가. 2단계가 lease CAS 를 실 Postgres 로 못 박은 것과 같은 이유다(이 레포에서 목이 초록인 채 3번 깨진 이력).

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-image.integration.spec.ts`
- Modify: `package.json` (`test:bulk-session:integration` 에 새 파일 추가)

**Interfaces:**
- Consumes: `BulkImageManager`, `BulkImageCleaner`, `BulkSessionReader` — 실 DB, 스텁 `FormExportFileClient`

- [ ] **Step 1: scratch DB 를 만든다**

```bash
docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS bulk_stage3_scratch"
docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE bulk_stage3_scratch"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage3_scratch" \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts
```
Expected: 마이그레이션이 전부 적용되고 에러 없음. **`dev_core` 를 쓰지 않는다.**

- [ ] **Step 2: 통합 스펙을 쓴다**

`apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-image.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import {
  catalogSchema,
  type PimSchema,
  productBulkImages,
  productBulkItems,
  productBulkSessions,
} from '../../../schema/catalog.schema';
import { BulkSessionReader } from './bulk-session.reader';
import { BulkImageManager } from './bulk-image.manager';
import { BulkImageCleaner } from './bulk-image.cleaner';

/**
 * 3단계 이미지 경로를 **진짜 Postgres** 에 대고 구동한다.
 *
 * 페이크 DB 로 증명되지 않는 두 가지만 본다: (1) 스윕의 `notExists` 술어가 draft 붙은
 * 세션을 실제로 제외하는가, (2) 전량 게이트 전진 CAS 가 동시 통보에서 한 번만 이기는가.
 *
 * **실행**: 전용 scratch DB(`bulk_stage3_scratch`)에 core 마이그레이션을 올린 뒤 그 DB 를
 * 가리키는 DATABASE_URL 로 돌린다 — `dev_core` 에는 이 브랜치와 무관한 보류 마이그레이션이
 * 있어 거기서 마이그레이션을 실행하면 안 된다.
 *
 * **격리**: 일회용 스키마를 만들고 커넥션의 search_path 를 startup 파라미터로 고정한다
 * (`SET search_path` 는 postgres.js 가 물리 재연결하면 조용히 public 으로 되돌아간다).
 * 스윕의 대상 쿼리에는 세션을 골라내는 필터가 없어(취소된 세션 전부가 대상이다) public
 * 스키마에 붙으면 남의 세션 이미지를 지운다. 선례: bulk-session-lease.integration.spec.ts:26-32.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_BULK_SESSION_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the bulk session image integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function connect(url: string, schema: string): postgres.Sql {
  return postgres(url, { max: 1, prepare: false, connection: { search_path: schema } });
}

/**
 * `DbService` 를 구조적으로 흉내 낸다 — 실제 클래스를 생성하지 않는 것이
 * `bulk-session-lease.integration.spec.ts:96-102` 가 세운 선례다(`run` 만 쓰면 되고,
 * 생성자 의존성을 통째로 끌고 오면 이 스위트가 무거워진다).
 */
function makeDbService(client: postgres.Sql): DbService<PimSchema> {
  const db = drizzle(client, { schema: catalogSchema });
  return {
    db,
    run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as never)),
  } as unknown as DbService<PimSchema>;
}

describeIfDb('일괄 세션 이미지 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const schemaName = `bs_img_${randomUUID().replaceAll('-', '')}`;
  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let reader: BulkSessionReader;

  /** file-service 스텁. 통보된 fileId 는 전부 유효한 product-image 로 답한다. */
  const softDeleted: string[] = [];
  const fileClient = {
    getMetadata: (fileId: string) => Promise.resolve({ id: fileId, contextId: 'product-image', status: 'active', originalName: 'x.jpg' }),
    softDelete: (fileId: string) => {
      softDeleted.push(fileId);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    // 스키마 생성은 search_path 가 아직 없는 부트스트랩 커넥션으로 한다 — 존재하지 않는
    // 스키마를 search_path 로 들고 접속하는 것을 피한다(lease 스펙 :137-140 과 같은 순서).
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    sql = connect(DATABASE_URL as string, schemaName);
    // public 의 실제 DDL 을 그대로 복제한다 — 손으로 옮겨 적으면 스키마가 갈라진다.
    // (enum 컬럼 타입은 public 의 타입 OID 로 해석돼 따라온다. LIKE 는 외래키를 복제하지
    // 않는다 — 이 스위트는 FK 를 검증 대상으로 삼지 않으므로 상품/양식 테이블이 없어도 된다.)
    await sql.unsafe(`CREATE TABLE product_bulk_sessions (LIKE public.product_bulk_sessions INCLUDING ALL)`);
    await sql.unsafe(`CREATE TABLE product_bulk_items (LIKE public.product_bulk_items INCLUDING ALL)`);
    await sql.unsafe(`CREATE TABLE product_bulk_images (LIKE public.product_bulk_images INCLUDING ALL)`);

    db = makeDbService(sql);
    reader = new BulkSessionReader(db as never);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    const cleanup = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await cleanup.end();
  });

  beforeEach(async () => {
    softDeleted.length = 0;
    // search_path 가 임시 스키마로 고정돼 있어 이름만으로 그 스키마의 테이블을 가리킨다.
    await sql.unsafe(`TRUNCATE product_bulk_images, product_bulk_items, product_bulk_sessions`);
  });

  async function seedSession(phase: string, userId = randomUUID()): Promise<string> {
    const [row] = await db.run((trx) =>
      trx
        .insert(productBulkSessions)
        .values({ name: 's', uploadedBy: userId, fileName: 'f.xlsx', sourceFileId: randomUUID(), phase: phase as never, totalRows: 1 })
        .returning({ id: productBulkSessions.id, uploadedBy: productBulkSessions.uploadedBy }),
    );
    return row.id;
  }

  it('요구된 마지막 파일이 채워지면 phase 가 drafting 으로 전진한다', async () => {
    const userId = randomUUID();
    const sessionId = await seedSession('awaiting_images', userId);
    await db.run((trx) =>
      trx.insert(productBulkItems).values({
        sessionId,
        rowNumber: 1,
        rowKey: 'P1',
        kind: 'create',
        input: {},
        payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
        status: 'pending',
      }),
    );
    await db.run((trx) =>
      trx.insert(productBulkImages).values([
        { sessionId, imageKey: 'IMG-1', usage: 'main', sourceKind: 'file_name', sourceValue: 'a.jpg', status: 'awaiting_upload' },
        // 아무도 참조하지 않는 미해결 행 — 게이트가 이걸 세면 안 된다.
        { sessionId, imageKey: 'IMG-9', usage: 'main', sourceKind: 'file_name', sourceValue: 'ghost.jpg', status: 'awaiting_upload' },
      ]),
    );

    const manager = new BulkImageManager(db as never, fileClient as never, reader);
    const out = await manager.resolve(sessionId, userId, [{ imageKey: 'IMG-1', usage: 'main', fileId: randomUUID() }]);

    expect(out.results[0].ok).toBe(true);
    expect(out.progress.phase).toBe('drafting');
  });

  it('동시 통보에서 전진 CAS 는 한 번만 이기고 둘 다 성공 응답을 받는다', async () => {
    const userId = randomUUID();
    const sessionId = await seedSession('awaiting_images', userId);
    await db.run((trx) =>
      trx.insert(productBulkItems).values({
        sessionId,
        rowNumber: 1,
        rowKey: 'P1',
        kind: 'create',
        input: {},
        payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }, { imageKey: 'IMG-2', usage: 'main' }] },
        status: 'pending',
      }),
    );
    await db.run((trx) =>
      trx.insert(productBulkImages).values([
        { sessionId, imageKey: 'IMG-1', usage: 'main', sourceKind: 'file_name', sourceValue: 'a.jpg', status: 'awaiting_upload' },
        { sessionId, imageKey: 'IMG-2', usage: 'main', sourceKind: 'file_name', sourceValue: 'b.jpg', status: 'awaiting_upload' },
      ]),
    );

    const manager = new BulkImageManager(db as never, fileClient as never, reader);
    const [first, second] = await Promise.all([
      manager.resolve(sessionId, userId, [{ imageKey: 'IMG-1', usage: 'main', fileId: randomUUID() }]),
      manager.resolve(sessionId, userId, [{ imageKey: 'IMG-2', usage: 'main', fileId: randomUUID() }]),
    ]);

    expect(first.results[0].ok).toBe(true);
    expect(second.results[0].ok).toBe(true);
    const [session] = await db.run((trx) =>
      trx.select({ phase: productBulkSessions.phase }).from(productBulkSessions).where(eq(productBulkSessions.id, sessionId)),
    );
    expect(session.phase).toBe('drafting');
  });

  it('취소된 세션이 올린 파일을 스윕이 지우고 행을 되돌린다', async () => {
    const sessionId = await seedSession('canceled');
    const fileId = randomUUID();
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_name',
        sourceValue: 'a.jpg',
        status: 'resolved',
        fileId,
      }),
    );

    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(softDeleted).toEqual([fileId]);

    const [row] = await db.run((trx) => trx.select().from(productBulkImages));
    expect(row.fileId).toBeNull();
    expect(row.status).toBe('awaiting_upload');

    // 멱등: 두 번째 스윕은 아무 것도 하지 않는다.
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
  });

  it('양식에 파일ID로 적힌 이미지(sourceKind=file_id)는 스윕이 건드리지 않는다', async () => {
    const sessionId = await seedSession('canceled');
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_id',
        sourceValue: randomUUID(),
        status: 'resolved',
        fileId: randomUUID(),
      }),
    );
    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(softDeleted).toEqual([]);
  });

  // 4단계가 오면 이 단정이 실제 사고를 막는다 — 지금은 도달 불가한 상태를 미리 막아 둔다.
  it('draft 가 하나라도 붙은 취소 세션은 스윕이 건드리지 않는다', async () => {
    const sessionId = await seedSession('canceled');
    await db.run((trx) =>
      trx.insert(productBulkItems).values({
        sessionId,
        rowNumber: 1,
        rowKey: 'P1',
        kind: 'create',
        input: {},
        status: 'drafted',
        draftVersionId: randomUUID(),
      }),
    );
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_name',
        sourceValue: 'a.jpg',
        status: 'resolved',
        fileId: randomUUID(),
      }),
    );
    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(softDeleted).toEqual([]);
  });

  it('진행 중 세션의 이미지는 스윕 대상이 아니다', async () => {
    const sessionId = await seedSession('awaiting_images');
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_name',
        sourceValue: 'a.jpg',
        status: 'resolved',
        fileId: randomUUID(),
      }),
    );
    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
  });
});
```

**이 부트스트랩은 `bulk-session-lease.integration.spec.ts:135-150` 을 그대로 따른 것이다** — 같은 세 테이블을 `LIKE ... INCLUDING ALL` 로 복제하고, `LIKE` 가 외래키를 복제하지 않는 덕에 상품·양식 테이블 없이도 INSERT 가 통과한다. 그 파일과 어긋나면 **그 파일이 맞다** — 열어 보고 맞춘다.

- [ ] **Step 3: 통합 스펙을 npm 스크립트에 등록한다**

`package.json` 의 `test:bulk-session:integration` 끝에 새 파일 경로를 덧붙인다:

```
apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-image.integration.spec.ts
```

등록하지 않으면 이 스위트는 **영원히 안 돈다** — 스크립트가 파일을 명시 나열하는 방식이다.

- [ ] **Step 4: 통합 테스트를 돌린다**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage3_scratch" \
  npm run test:bulk-session:integration
```
Expected: 3단계 스위트 전 케이스 PASS + 2단계 두 스위트도 그대로 PASS (회귀 없음).

**증거를 남긴다** — 이 명령의 출력(스위트별 통과 수)을 커밋 메시지나 작업 노트에 붙인다. "돌렸다"는 주장만으로는 완료가 아니다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-image.integration.spec.ts package.json
git commit -m "test(bulk-session): 3단계 이미지 게이트·CAS·정리 스윕 통합 테스트"
```

---

## Task 9: 스펙 부록 갱신 + 최종 검증

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` (부록 B 추가)

- [ ] **Step 1: 부록 B 를 쓴다**

스펙 파일 맨 끝(부록 A 다음)에 붙인다. **구현하면서 실제로 확인한 것만** 담는다 — 계획서가 추측한 것을 사실로 옮기지 않는다.

```markdown
---

# 부록 B — 3단계 구현이 실측한 사실 (2026-08-02)

3단계(이미지 단계)는 **core 백엔드만** 구현했다(사용자 결정). admin-web 은 2·3단계 화면을 나중에 한 번에 만든다.

## B.1 file-service 계약 (부록 A.3 보강)

| 사실 | 근거 |
|---|---|
| `GET /files/:fileId/metadata` 가 `{ id, contextId, status, originalName, mimeType, size, ... }` 를 준다 | `download.controller.ts:54`, `dto/file-metadata-response.dto.ts` |
| 업로드 직후 `status:'active'` 다 — 활성화 단계도 미사용 파일 GC 도 없다 | `upload.service.ts:99,105` |
| `POST /files/batch-upload` 는 `Promise.all` 이라 **한 장 실패 = 배치 전체 reject**, 성공분은 고아로 남는다 | `upload.service.ts:127-129` |
| batch-upload 응답에 `originalName` 이 없다 — 로컬 파일과의 대응은 **배열 순서**뿐이다 | `dto/upload-response.dto.ts` |
| 컨텍스트 제약: `product-image` = jpeg/png/webp 10MB, `product-description-image` = `image/*` 20MB | `default-file-contexts.ts:162-181` |

**화면 단계가 읽을 것:** 위 두 줄 때문에 프런트는 batch-upload 를 큰 묶음으로 부르면 안 된다. 작은 청크로 나누고, 응답을 **인덱스로** 로컬 파일과 짝지어야 한다.

## B.2 스펙 §3.9 의 "브라우저 → file-service 직접"의 실제 의미

admin-web 은 `/api/proxy/file/files/upload` (Next.js 프록시)로 올린다(`lib/api/domains/files/upload.client.ts`). "직접"은 **core 를 경유하지 않는다**는 뜻이지 브라우저가 file-service 오리진을 때린다는 뜻이 아니다. 그래서 CORS·인증 경로는 이미 있는 것을 그대로 쓴다.

## B.3 이 단계가 정한 것 (스펙에 없던 결정)

| 결정 | 이유 |
|---|---|
| core 가 통보받은 fileId 를 메타데이터로 검증한다(존재·컨텍스트) | 안 하면 깨진 참조가 4단계 draft 에 굳고 발견은 발행 후다 |
| 해석 통보는 **부분 성공** — 요청당 최대 50건 | 배치 전체를 400 으로 돌리면 성공분이 재업로드돼 S3 고아가 생긴다(전역 GC 없음) |
| `awaiting_images` 동안 이미 올린 파일의 **교체 허용**, 옛 fileId 는 best-effort soft delete | 엉뚱한 파일을 올렸을 때 되돌릴 길이 그것뿐이다 |
| `sourceKind='file_id'` 행은 교체 불가 | 그건 워크북에서 키를 고칠 일이다 |
| 취소 정리를 **인라인이 아니라 @Cron 스윕**으로 | 세션당 이미지 행 상한이 1만이라 인라인 삭제가 ALB 60초를 넘긴다 |
| 스윕이 `draft_version_id` 붙은 세션을 제외 | `cancel` 이 `drafting` 이후에도 허용되므로, 4단계가 오면 스윕이 draft 가 쓰는 파일을 지우게 된다. 마이그레이션 없이 지금 막아 둔다 |
| 전량 게이트 술어를 `BulkSessionReader` 로 이관 | 승인·조회·해석 셋이 공유해야 한다. 복사본이 생기면 승인과 게이트가 서로 다른 답을 낸다 |

## B.4 3단계가 남긴 후속

- **세션의 원본 워크북(`source_file_id`)은 아무도 지우지 않는다.** 양식 잡에만 30일 만료가 있고 세션에는 없다. 5단계 정리 경로에서 함께 정한다
- **스윕은 soft delete 라 S3 바이트가 남는다** — file-service 전역 고아 정리 잡이 생기면 함께 사라진다(스펙 §5.2)
- **`awaiting_images` 에 갇힌 세션을 푸는 길은 취소뿐이다.** 요구 파일을 못 구하면(원본 분실 등) 세션을 버리고 다시 올려야 한다. "이 이미지 참조를 포기하고 진행" 같은 탈출구는 만들지 않았다 — 스펙 §3.9 의 전량 게이트가 의도한 바다
- **4단계 주의**: draft 생성은 `product_bulk_images.file_id` 를 읽어 `::product-image{imageKey=...}` 를 `fileId=` 로 치환해야 한다(스펙 §3.9). 프리필 그대로인 참조는 `refs` 에 담기지 않으므로(2단계 `resolveImageRefs` 독스트링) `base_snapshot.images` 가 근거다
```

- [ ] **Step 2: 전체 검증을 돌린다**

```bash
# 단위 (bulk-session 모듈 전체)
npx jest apps/core/src/modules/catalog/operations/bulk-session

# 타입 게이트
npm run type-check:scoped

# lint — 변경 파일 기준 신규 error 0
npx eslint apps/core/src/modules/catalog/operations/bulk-session --ext .ts

# 통합 (scratch DB — dev_core 를 절대 쓰지 않는다)
docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS bulk_stage3_scratch"
docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE bulk_stage3_scratch"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage3_scratch" npx drizzle-kit migrate --config apps/core/drizzle.config.ts
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage3_scratch" npm run test:bulk-session:integration
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage3_scratch" npm run test:form-export:integration
```

Expected: 전부 PASS / exit 0. **각 명령의 실제 출력을 확인하고 기록한다** — 하나라도 못 돌렸으면 그 사실을 그대로 보고한다.

- [ ] **Step 3: 마이그레이션이 0건인지 확인한다**

```bash
git status --short apps/core/drizzle/
git diff --stat develop -- apps/core/src/modules/catalog/schema/catalog.schema.ts
```
Expected: **둘 다 비어 있다.** 스키마가 바뀌었으면 설계가 어긋난 것이므로 멈추고 보고한다(스펙 §7 — 3단계 마이그레이션 0).

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-07-31-product-bulk-session-design.md
git commit -m "docs(spec): 부록 B — 3단계 구현이 실측한 사실"
```

---

## 완료 후 사람이 할 일 (수동 스모크 · 배포)

**이 계획은 자동 검증까지다.** 아래는 계획 밖이며, 끝난 뒤 사용자에게 그대로 넘긴다.

### 수동 스모크 (core 를 띄우고 Swagger/curl)

1. 2단계 경로로 세션을 하나 만들어 `awaiting_images` 까지 보낸다(파일명 이미지를 참조하는 워크북).
2. `GET /product-bulk-sessions/:id/images?onlyRequired=true&status=awaiting_upload` — `sourceValue` 에 파일명이, `contextId` 에 `product-image` 가 보이는가.
3. admin-web 프록시(또는 file-service 직접)로 이미지를 하나 올려 `fileId` 를 받는다.
4. `POST /product-bulk-sessions/:id/images/resolve` — `results[0].ok=true`, 마지막 한 장이면 `progress.phase='drafting'`.
5. 일부러 틀린 컨텍스트(`product-description-image` 로 올린 파일)를 대표용으로 통보 → `ok=false` + 컨텍스트 오류 문구.
6. 없는 fileId 통보 → `ok=false` + "찾을 수 없습니다".
7. 세션을 취소하고 1분 기다린 뒤, 올렸던 파일이 file-service 에서 soft delete 됐는지 확인(`GET /files/:id/metadata` → 404 또는 `status:'deleted'`).

### 배포

- **마이그레이션 0건** — DB 작업이 없다.
- **신규 시크릿 없음** — `AUTH_SECRET`·`FILE_SERVICE_URL` 이 이미 Core live env 에 있다.
- **신규 env 없음** — 킬스위치는 기존 `PRODUCT_BULK_SESSION_WORKER_ENABLED` 를 재사용한다(스윕도 이 플래그를 본다).
- 배포 대상은 **core 뿐**이다(admin-web 변경 없음).
- 새 `@Cron` 이 하나 늘어난다(`BulkImageCleaner.sweep`, 매분). 취소된 세션이 없으면 쿼리 한 번으로 끝난다.

---

## 알려진 갭 (이 계획이 닫지 않는 것)

- **세션 원본 워크북이 영구 잔존한다.** 세션에는 만료 정책이 없다 — 5단계 정리 경로의 몫.
- **soft delete 라 S3 바이트가 남는다.** file-service 전역 고아 정리 잡의 부재(스펙 §5.2)는 이 계획의 범위 밖이다.
- **`awaiting_images` 탈출구가 취소뿐이다.** 전량 게이트의 의도된 성질이다(스펙 §3.9).
- **admin-web 화면이 없다.** 2·3단계 UI 는 별건(F1).
- **해석 요청이 항목마다 HTTP 를 하나 쓴다.** 50건이면 순차 50회다. 실측 후 느리면 `Promise.all` 청크로 바꾼다 — 지금은 단순한 쪽을 고른다.
