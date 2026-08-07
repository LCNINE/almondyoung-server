# 상품 일괄 세션 4단계 — draft 생성(신규 + 수정) + 잠금 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3단계가 `drafting` 으로 밀어놓고 멈춰 있는 지점을 연다 — 검증·승인·이미지를 통과한 행마다 draft 버전을 만들고(신규는 master 째로, 수정은 **현재 active 에서 포크한 뒤 변경분만 얹어서**), 그 draft 를 세션이 잠가 개별 발행·삭제·`my-drafts` 노출에서 뺀다. 마지막 행이 끝나면 세션이 `drafted` 로 전진한다.

**Architecture:** 새 워커를 만들지 않는다. `BulkSessionJobWorker` 에 세 번째 분기(`drafting → runDraftSlice`)를 달고, claim·lease CAS·행마다 `renewLease`·취소 감지·연속 실패 상한은 검증 레인 것을 그대로 쓴다. 쓰기는 **행 하나가 트랜잭션 하나**다(한 행의 22001 이 슬라이스를 되돌리면 안 된다). 변환(`FlatFields` → 도메인 입력)은 DB 를 타지 않는 순수 함수 셋으로 분리하고, 실제 쓰기는 이미 있는 catalog core 서비스(`createMaster`·`createDraftVersion`·`updateVersion`·`bulkUpdateVariantsInDraft`·`replaceVersionRules`·`upsertForDraft`)를 조립해 부른다.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), `@nestjs/schedule`, Jest

---

## Global Constraints

- 레이어 규칙: Controller → Service(2-3줄 포트) → Manager/Reader → DB. Controller 는 Repository 를 직접 부르지 않고, Service 는 `HttpException`·drizzle·Express 타입을 임포트하지 않는다.
- 도메인 예외는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError`. `GlobalExceptionFilter` 가 상태코드로 매핑한다.
- 트랜잭션 전파: 공개 메서드는 `tx?: DbTransaction` 을 마지막 인자로, private 헬퍼는 `tx: DbTransaction` 필수. `this.db.run(async (trx) => {...}, tx)` 만 쓰고 per-class `inTx` 헬퍼를 만들지 않는다 (ADR-0025).
- DB 주입은 `@InjectDb() private readonly db: DbService<PimSchema>`. `@Inject('DB')` 금지.
- 쿼리는 `trx.select().from().innerJoin().where()` 형태. `db.query.*`·`with` relations 금지.
- **프로덕션 코드에서 이 계획이 허용하는 `any`/`as` 캐스팅은 0건이다.** 하나라도 필요해지면 설계가 어긋난 신호다 — 멈추고 보고한다. 테스트 코드에서는 2·3단계 선례 둘만 허용한다: 페이크를 생성자에 넘길 때의 `as never`(`bulk-session.reader.spec.ts:110`), drizzle 조건 렌더의 `dialect.sqlToQuery(condition as never)`(`bulk-session.manager.spec.ts:40`).
- 소유권 검사는 존재 검사와 같은 `NotFoundError` 로 합친다 (1단계 `form-export.manager.ts:48-55`, 2단계 `bulk-session.reader.ts:259-269` 관례 — 존재 여부 오라클 차단).
- jsonb 에 `Date` 를 담지 않는다. ISO 문자열로만 담고 되살리는 지점을 한 곳으로 모은다.
- 진행률은 카운터 컬럼이 아니라 매번 집계한다 — `getProgress` 가 이미 `GROUP BY status` 라 `drafted`·`failed` 는 **코드 변경 없이 흘러간다**(`bulk-session.reader.ts:157-162`). 새 카운터를 만들지 않는다.
- **마이그레이션은 정확히 1건이다** — `product_master_versions.bulk_session_id` 컬럼 + 인덱스. 그 밖에 `catalog.schema.ts` 를 고칠 일이 생기면 설계가 어긋난 신호다(enum 값은 이미 전부 있다 — F1 참조). 멈추고 보고한다.
- 검증 게이트: `npm run type-check:scoped` exit 0, 변경 파일 기준 신규 lint error 0. **전역 `npx jest`·전역 `tsc`·`nest build core` 는 develop 에서도 red 이므로 "전체 그린"으로 판정하지 않는다** — 변경 파일 차분으로만 본다.
- 통합 테스트는 **scratch DB**(`bulk_stage4_scratch`)에 대고 돈다. `dev_core` 에 마이그레이션을 돌리거나 행을 남기지 않는다.
- 브랜치는 `feat/product-bulk-session-stage4`, 워크트리는 `.claude/worktrees/feat+product-bulk-session-stage4`, `develop`(`074162269` = 3단계 머지본) 바로 위다. 스택이 아니다.

---

## 착수 전 확정된 사실 (읽고 시작할 것)

아래는 **2026-08-02 에 코드를 읽어 확인한 것**이다. 스펙 본문이 단언만 하고 넘어간 자리를 여기서 못 박는다. 자기 태스크 범위의 인터페이스는 착수 시 한 번 더 확인하고, 이 표는 출발점으로만 쓴다.

### F1. 범위는 **core 백엔드만**이다 (사용자 결정, 2026-08-02)

2·3단계와 같다. admin-web 에는 아직 1단계 "양식 다운로드" 버튼밖에 없어 붙일 자리가 없다. 2~4단계 화면은 5단계 이후 한 묶음으로 만든다. 이 단계 산출물을 사람이 확인하는 방법은 Swagger/curl 이다.

### F2. 스키마는 컬럼 하나만 모자라다

| 사실 | 근거 |
|---|---|
| `product_bulk_session_phase` enum 에 `drafting`·`drafted` 가 **이미 있다** | `catalog.schema.ts:1303-1315` |
| `product_bulk_item_status` enum 에 `drafted`·`excluded`·`failed` 가 **이미 있다** | `catalog.schema.ts:1322-1329` |
| `product_bulk_items.draft_version_id` 컬럼이 **이미 있다** | `catalog.schema.ts:1407` |
| `bulk_session_id` 는 레포 어디에도 **없다** (`grep -rn "bulkSessionId\|bulk_session_id" apps/core/src` → 0건) | 2026-08-02 실측 |
| `product_master_versions` 의 인덱스 명명 관례는 `idx_versions_*` | `catalog.schema.ts:216-229` |

즉 이 단계의 DDL 은 `ADD COLUMN` + `CREATE INDEX` 두 문장뿐이고, ADR-0005 §5 의 **expand phase** 다(`migrate` → `deploy` 순서).

### F3. 워크북의 옵션 키는 **진짜 DB UUID** 다

| 사실 | 근거 |
|---|---|
| `optionKey` = `productOptionGroups.id` | `form-export.snapshot.reader.ts:243` |
| `optionValueKey` = `productOptionValues.id` | `:246` |
| `combination` = 그 variant 의 `optionValueId` 들을 **정렬해 `+` 로 이은 문자열**. 옵션 없는 상품은 **빈 문자열이 계약**이다 | `:268-271`, `bulk-session.fields.ts:127-134` |

그래서 **수정 행**은 워크북 키를 그대로 `ModifyOptionDisplayDto.optionGroupId`·`optionValueId` 로 쓸 수 있다. **신규 행**은 작업자가 지은 이름이라 그렇지 않다(F7).

### F4. `_applyOptionDiff` 의 표시명 갱신은 truthiness 다 — 빈칸이 조용히 무시된다

`product-masters.service.ts:1598` (`if (modify.displayName)`) 과 `:1619` (`if (valueModify.displayName)`) 가 빈 문자열을 falsy 로 걸러낸다. 반면 `colorCode`·`sortOrder` 는 `!== undefined` 라 빈 값이 실제로 써진다(`:1620-1622`).

**결정(사용자, 2026-08-02): 옵션명·옵션값명 빈칸은 행 오류로 거부한다.** core 의 공용 쓰기 경로를 고치지 않는 쪽을 골랐다 — 고치면 임포트 밖의 기존 호출부(상품 편집 화면·관리 API)에서 지금까지 무시되던 빈 문자열이 갑자기 이름을 지우기 때문이다. 근거는 도메인에도 있다: `display_name` 은 `notNull`(`catalog.schema.ts:401,429`)이고 이름 없는 옵션값은 화면에서 빈 버튼이다.

### F5. 포크는 완전 복제다 — 그래서 "변경분만 얹기"가 성립한다

`createDraftVersion`(`product-versions.service.ts:206-257`)은 부모 행을 통째로 복사한 뒤 `_copyMappings`(`:1582-1710`)로 다음을 모두 복사한다: 옵션 그룹 매핑, **그룹 display**, **값 display**, variant 매핑, 가격룰 매핑, 구매제약 매핑. 따라서 포크 직후 draft 는 현재 active 의 완전한 사본이고, 우리는 바뀐 필드만 덮어쓰면 된다.

`parentVersionId` 는 포크 시 부모 id 로 채워진다(`:241`) — 5단계 발행 시점 가드가 이걸 쓴다.

### F6. variant 편집은 반드시 CoW 경로로 — 직접 UPDATE 는 active 를 오염시킨다

| 사실 | 근거 |
|---|---|
| 포크한 draft 와 active 는 **같은 `variantId` 를 공유**한다(정션만 복사된다) | `product-versions.service.ts:1662-1677` |
| `updateVariantInDraft` 는 그 variantId 가 다른 버전에도 매핑돼 있으면 `product_variants` 를 clone → `variantOptionValues` clone → draft 정션만 repoint → **가격룰 cascading CoW** → asset link clone 순으로 돈다 | `product-variants.service.ts:401-420` |
| `bulkUpdateVariantsInDraft(masterId, versionId, updates, tx)` 가 `Array<{originalId, variantId, cowed}>` 를 돌려준다 | `:424-443` |
| v3 임포트의 `applyVariantCodes` 는 `productVariants` 를 **직접 UPDATE** 한다 | `product-import.manager.ts:235-238` |

v3 방식은 **갓 만든 master 에서만** 안전하다. 수정 행에 그대로 쓰면 draft 편집이 즉시 active 에 새어 ADR-0004 가 막으려던 것을 정확히 되살린다. **수정 경로는 `bulkUpdateVariantsInDraft` 를 쓴다.**

그리고 CoW 가 variantId 를 바꾸므로 **가격 룰은 variant 편집 뒤에**, 반환된 id 로 조립한다.

### F7. 신규 행의 조합키 ↔ variantId 는 이름으로만 이어진다

`optionDiff.add`(`product-masters.service.ts:1548-1591`)는 옵션 그룹·값을 새로 만들지만 **만들어진 id 를 돌려주지 않는다**. 그래서 신규 행은:

1. `updateVersion({ optionDiff: { add } })` 로 옵션을 만들고 variant 가 자동 생성되게 한 뒤(`_regenerateVariantsForVersion`),
2. `OptionReadLoader.getOptionGroups(tx, masterId, versionId, 'ko-KR')`(`option-read.loader.ts:20-25`)로 **되읽어** `(그룹 표시명, 값 표시명) → optionValueId` 를 만들고,
3. 워크북의 `조합`(작업자 키 결합)을 그 맵으로 실제 `optionValueId` 집합으로 바꾼 뒤,
4. `productMasterVariants` 정션의 variant 마다 `getVariantOptionValues` 로 실제 조합을 만들어 짝짓는다.

그래서 **같은 그룹 안에서 표시명이 겹치면 짝짓기가 모호해진다** — 신규 행 구조 검증에서 행 오류로 막는다(Task 4).

### F8. 신규 행에는 옵션 구조 검증이 전혀 없다

`checkOptionStructure`(`bulk-session.structure.ts:17-47`)는 인자로 스냅샷(`base: PrefillBundle`)을 받는 **수정 행 전용**이고, 2단계 검증기 호출부도 `if (updateBase)` 안에 있다(`bulk-session-job.manager.ts:623`). 즉 신규 행의 다음 넷은 지금 아무 게이트도 통과하지 않은 채 4단계에 도착한다:

- 같은 옵션값키가 두 번 나옴 / 두 그룹에 걸침
- `조합` 이 옵션 시트에 없는 옵션값키를 가리킴
- 같은 조합이 두 행
- 한 그룹 안에서 옵션값 표시명이 중복 (F7 때문에 치명적)

Task 4 가 이 넷을 행 오류로 닫는다.

### F9. 가격은 replace 라 "재조립"이 유일한 방법이다

| 사실 | 근거 |
|---|---|
| `replaceVersionRules(versionId, dto, tx)` 는 draft 가 아니면 400, 기존 매핑을 **전부 지우고** 새로 만든다 | `pricing.service.ts:67-110` |
| 임포트 표현 집합은 layer ∈ {base_price, membership_price} × scopeType ∈ {all_variants, variants} × operationType = override | `form-export.pricing-judge.ts:21-28` |
| `extractSimplePrices(rules)` 가 그 집합의 룰셋에서 `{basePrice, membershipPrice, variantOverrides}` 를 뽑는다 | `:36-61` |
| `PricingService.getVersionRules(versionId, tx?)` 가 `PricingRulesResponseDto` 를 준다 — `extractSimplePrices` 의 입력 타입과 **정확히 같다** | `pricing.service.ts:25` |
| `pricingEditable` 판정은 **양식 다운로드 시점에 얼려** `base_snapshot.pricingEditable` 로 온다 | `bulk-session.types.ts:110-125`, `bulk-session-job.manager.ts:599-601` |

따라서 수정 행의 가격 적용은 **현재 룰 → `extractSimplePrices` → 변경 칸으로 덮기 → 전체 DTO 재조립 → replace** 다. `pricingEditable === false` 면 **`replaceVersionRules` 를 아예 부르지 않는다**(부르는 순간 복합 룰이 단순 override 로 뭉개진다). 그 경우 `_copyMappings` 가 복사한 룰 매핑이 그대로 남아 draft 가 active 와 같은 가격을 갖는다.

### F10. 상품 필드는 워크북 키 = 버전 컬럼 이름이다 (1:1)

`form-export.snapshot.reader.ts:204-236` 이 그 매핑의 원본이다. 타입과 "빈칸(=명시적 비움)" 의 착지점은 이렇다 (`catalog.schema.ts` 실측):

| 워크북 키 | 컬럼 | 타입 | 빈칸이 뜻하는 값 |
|---|---|---|---|
| `name` | `name` | `varchar(255) notNull default '새 상품'` | **비울 수 없음 → 행 오류** |
| `productCode`·`brand`·`alternativeName`·`salesClassification`·`purchaseClassification`·`seller`·`seoTitle` | 동명 | nullable varchar | `null` |
| `description`·`material`·`seoDescription` | 동명 | nullable text | `null` |
| `marketPrice`·`supplyPrice` | 동명 | `bigint mode:'number'` nullable (`:176-177`) | `null` |
| `ageRestriction` | 동명 | `integer notNull default 0` (`:181`) | `0` |
| `minQuantity` | 동명 | `integer notNull default 1` (`:182`) | `1` |
| `maxQuantity` | 동명 | `integer` nullable (`:183`) | `null` |
| `productType` | 동명 | `varchar(50) notNull default 'regular_sale'` (`:156`) | `'regular_sale'` |
| `fulfillmentKind` | 동명 | `varchar(20) notNull` default `'physical'` (`:158`) | `'physical'` |
| `isOverseas`·`isVisibleToMembersOnly`·`hideMembershipPriceForNonMembers`·`isWholesaleOnly` | 동명 | `boolean notNull default false` (`:148-152`) | `false` |
| `seoKeywords` | 동명 | `text[]` nullable (`:145`) | `[]` |
| `salesStartDate`·`salesEndDate` | 동명 | `timestamp` nullable (`:186-187`) | `null` |
| `thumbnailImageKey` | → `thumbnailFileId` | (updateVersion 이 `product_images` 로 옮긴다) | `null` (대표 이미지 삭제) |
| `additionalImageKeys` | → `additionalImageFileIds` | 같음, `\|` 구분 최대 5 | `[]` (부가 이미지 전부 삭제) |
| `basePrice`·`membershipPrice` | (버전 컬럼 아님) | 가격 룰로 간다 | F9 |

`updateVersion`(`product-masters.service.ts:889-1059`)은 `thumbnailFileId !== undefined` 일 때만 대표 이미지를 지우고 다시 넣으며(`:945-962`), `additionalImageFileIds !== undefined` 일 때만 부가 이미지를 갈아끼운다(`:965-988`). 즉 **키를 만들지 않으면 손대지 않는다** — "변경 없음"을 그렇게 표현한다.

`hideMembershipPriceForNonMembers` 와 `isMembershipOnly` 는 한쪽만 주면 다른 쪽이 따라 붙는다(`:917-927`) — 워크북에는 전자만 있으므로 그대로 두면 된다.

### F11. 이미지 참조의 근거는 두 곳이다

- `payload.imageRefs`(`bulk-session.types.ts:90`)는 **이 행이 바꾼** 참조만 담는다. 3단계가 `product_bulk_images` 의 `(imageKey, usage) → fileId` 로 해석해 뒀다.
- 수정 행에서 **손대지 않은** 프리필 참조는 `imageRefs` 에 없다(2단계 `resolveImageRefs` 규약). 그 근거는 `base_snapshot.images`(`imageKey → fileId`)다 — 부록 B.7 마지막 줄이 지목한 자리.

본문 이미지는 `::product-image{imageKey="IMG-2"}` 형태이고 `replaceDirectiveImageKeys(markdown, fileIdByKey)`(`product-import-image.directive.ts`)가 `fileId="..."` 로 바꾼다. **이 파일은 6단계가 지울 모듈에 있으므로 import 하지 않고 이식한다.**

### F12. 취소·스윕과의 상호작용 (부록 B.5·B.6 인계)

| 사실 | 이 단계에 대한 의미 |
|---|---|
| `cancel()` 이 `phase`·`cancelRequestedAt` 을 같은 UPDATE 로 찍는다 | `bulk-session.manager.ts:389-395`. drafting 슬라이스는 `renewLease` 의 `returning` 으로 즉시 감지한다 |
| `BulkImageCleaner` 의 스윕 술어에 `notExists(draft_version_id 있는 아이템)` 이 **세션 단위 상관 서브쿼리**로 들어 있다 | `bulk-image.cleaner.ts:99-110`. draft 가 하나라도 생기면 그 세션의 이미지는 스윕에서 통째로 빠진다 — **4단계가 만드는 draft 를 지키는 유일한 방어선**이므로 이 조건을 건드리지 않는다 |
| 3단계 `resolve()` 는 세션 행 `FOR UPDATE` 를 잡고 **잠금 후 phase 를 다시 읽어** `awaiting_images` 가 아니면 아무것도 기록하지 않는다 | `bulk-image.manager.ts:190-215`. 그래서 drafting 워커가 도는 동안 늦게 도착한 이미지 통보가 draft 참조 파일을 갈아끼우지 못한다. **이 단계는 게이트를 재평가하지 않으므로 세션 행을 잠글 필요가 없다** |

### F13. 이 단계가 하지 않는 것

admin-web(F1), **실패 행 재시도·`excluded` 전이·일괄 발행·정리**(5단계 — 아래 "알려진 갭" 참조), 옛 `product_import_*` 제거(6단계), file-service 전역 고아 파일 정리(스펙 §5.2 영구 부채).

---

## File Structure

**신규 (전부 `apps/core/src/modules/catalog/operations/bulk-session/services/`)**

| 파일 | 책임 |
|---|---|
| `bulk-draft.fields.ts` | 순수. `FlatFields` → `UpdateProductMasterVersion`(스칼라·이미지·카테고리) + 행 오류. DB 무접촉 |
| `bulk-draft.options.ts` | 순수. 신규 행의 `optionDiff.add` 조립 + 구조 검증(F8), 수정 행의 `optionDiff.modifyDisplay` 조립(F4 빈칸 거부) |
| `bulk-draft.pricing.ts` | 순수. `SimplePrices` + 변경 칸 → `ReplacePricingRulesDto` |
| `bulk-draft.applier.ts` | 쓰기. 신규 경로·수정 경로 두 개. catalog core 서비스를 조립해 부르고 `bulk_session_id` 를 심는다 |

**수정**

| 파일 | 내용 |
|---|---|
| `apps/core/src/modules/catalog/schema/catalog.schema.ts` | `productMasterVersions` 에 `bulkSessionId` + 인덱스 |
| `apps/core/drizzle/<ts>_product-master-versions-bulk-session-id.sql` | 생성물 |
| `.../core/products/services/product-versions.service.ts` | `publishVersion` 잠금 가드, `getMyDraftVersions` 제외 조건 |
| `.../core/products/services/product-masters.service.ts` | `deleteVersion` 잠금 가드 |
| `.../bulk-session/services/bulk-session-job.manager.ts` | `CLAIMABLE_PHASES`·claim SQL 에 `drafting` 추가, `runDraftSlice` |
| `.../bulk-session/services/bulk-session-job.worker.ts` | 세 번째 분기 |
| `.../bulk-session/services/bulk-session.manager.ts` | `cancel()` 이 잠금을 푼다 |
| `.../bulk-session/services/bulk-session.reader.ts` | 행 목록에 `draftVersionId` 노출 |
| `.../bulk-session/dto/bulk-session-response.dto.ts` | 같음 |
| `.../bulk-session/bulk-session.module.ts` | `BulkDraftApplier` 등록 |
| `package.json` | 통합 스위트 목록에 4단계 스펙 추가 |

---

## Task 1: `bulk_session_id` 컬럼 + 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts:121-230` (`productMasterVersions`)
- Create: `apps/core/drizzle/<timestamp>_product-master-versions-bulk-session-id.sql` (생성물)

**Interfaces:**
- Produces: `productMasterVersions.bulkSessionId` — Task 2·7·8·9 가 읽고 쓴다

- [ ] **Step 1: 컬럼을 더한다**

`catalog.schema.ts` 의 `productMasterVersions` 에서 `draftOwnerId` 바로 아래(버전 관리 필드 블록 끝, `:135` 다음 줄)에 넣는다:

```ts
    draftOwnerId: uuid('draft_owner_id'),
    /**
     * 이 draft 를 소유한 일괄 세션. NULL 이면 통상의 개인 draft 다.
     *
     * **FK 를 걸지 않는다.** 같은 파일의 `product_bulk_sessions` 를 가리키지만, 이 컬럼의
     * 역할은 `draft_owner_id` 와 같은 "누구 것인가" 태그이고 그쪽도 FK 가 없다. 세션 행을
     * 지우는 경로가 없어(5단계 정리도 draft 와 이미지만 다룬다) 참조 무결성으로 얻을 것이
     * 없는 반면, catalog core 테이블이 operations 테이블에 DDL 의존성을 갖게 된다.
     *
     * 값이 있으면: 개별 발행·삭제 거부, `my-drafts` 에서 제외. 편집은 허용한다(스펙 §3.3).
     * 세션 취소가 NULL 로 되돌려 잠금을 푼다.
     */
    bulkSessionId: uuid('bulk_session_id'),
    // ===== VERSION MANAGEMENT FIELDS END =====
```

인덱스는 기존 목록(`:216-229`) 끝에 관례대로 더한다:

```ts
    index('idx_versions_bulk_session').on(table.bulkSessionId),
```

- [ ] **Step 2: 마이그레이션을 생성한다**

```bash
npm run db:generate:core -- --name product-master-versions-bulk-session-id
```

- [ ] **Step 3: 생성된 SQL 이 additive 인지 눈으로 확인한다**

```bash
cat apps/core/drizzle/$(ls apps/core/drizzle | grep bulk-session-id | head -1)
```

Expected: `ALTER TABLE "product_master_versions" ADD COLUMN "bulk_session_id" uuid;` 와 `CREATE INDEX ... "idx_versions_bulk_session" ...` **두 문장뿐**. `DROP`·`ALTER COLUMN`·`NOT NULL` 이 한 줄이라도 있으면 스키마 편집이 잘못된 것이다 — 되돌리고 다시 한다.

drizzle-kit 이 rename 을 물으면(**컬럼 추가에서는 나오지 않아야 한다**) 그건 기존 컬럼을 건드렸다는 뜻이다. 취소하고 diff 를 다시 본다.

- [ ] **Step 4: 타입 게이트**

```bash
npm run type-check:scoped
```
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle/
git commit -m "feat(bulk-session): product_master_versions 에 bulk_session_id 추가"
```

---

## Task 2: 잠금 게이트 — 개별 발행·삭제 거부 + `my-drafts` 제외

세션 draft 가 아직 하나도 없어도(컬럼이 항상 NULL) 이 태스크는 독립적으로 옳다. 그래서 lane 보다 먼저 둔다.

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts:268-` (`publishVersion`), `:874-883` (`getMyDraftVersions` whereClause)
- Modify: `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts:1263-` (`deleteVersion`)
- Test: `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `productMasterVersions.bulkSessionId` (Task 1)
- Produces: 없음 (게이트만)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-versions.service.spec.ts` 의 기존 하네스를 그대로 쓰고(파일 상단의 목 DB 구성 방식을 따른다) 다음 두 케이스를 더한다:

```ts
  it('일괄 세션이 잠근 draft 는 개별 발행할 수 없다', async () => {
    // getVersionById 가 세션에 잠긴 draft 를 돌려주도록 픽스처를 세운다.
    const version = makeVersion({ status: 'draft', bulkSessionId: '0198f000-0000-7000-8000-000000000001' });
    jest.spyOn(service, 'getVersionById').mockResolvedValue(version);

    await expect(service.publishVersion(version.id)).rejects.toThrow(
      '일괄 등록 세션이 관리하는 상품입니다. 세션 화면에서 일괄 발행해 주세요.',
    );
  });

  it('잠기지 않은 draft 는 그대로 발행된다', async () => {
    const version = makeVersion({ status: 'draft', bulkSessionId: null });
    jest.spyOn(service, 'getVersionById').mockResolvedValue(version);

    await expect(service.publishVersion(version.id)).resolves.toBeUndefined();
  });
```

`makeVersion` 이 그 스펙에 없으면, 파일이 이미 쓰고 있는 방식(인라인 객체 리터럴)으로 같은 픽스처를 만든다 — **없는 헬퍼를 지어내지 않는다.**

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts -t '일괄 세션이 잠근'
```
Expected: FAIL — 예외가 던져지지 않는다.

- [ ] **Step 3: 가드를 넣는다**

`publishVersion`(`product-versions.service.ts:270` 의 `getVersionById` 바로 다음, status 검사보다 **앞**):

```ts
      const version = await this.getVersionById(versionId, tx);

      // 일괄 세션이 소유한 draft 는 세션이 일괄로 발행한다 — 여기서 한 건씩 나가면 세션의
      // 진행 상태와 실제 카탈로그가 갈린다(스펙 §3.3). 세션 취소가 이 값을 NULL 로 되돌린다.
      if (version.bulkSessionId) {
        throw new ConflictError('일괄 등록 세션이 관리하는 상품입니다. 세션 화면에서 일괄 발행해 주세요.');
      }
```

`ConflictError` 는 `@app/shared` 에서 온다. 이 파일이 아직 임포트하지 않았으면 더한다. (이 서비스가 `BadRequestException` 같은 Nest 예외를 쓰는 자리가 남아 있지만 **기존 줄을 이 태스크에서 바꾸지 않는다** — 범위 밖이다.)

`deleteVersion`(`product-masters.service.ts:1265` 의 `getVersionById` 다음, `deletedAt` 검사 앞):

```ts
      if (product.bulkSessionId) {
        throw new ConflictError('일괄 등록 세션이 관리하는 상품입니다. 세션을 취소하면 삭제할 수 있습니다.');
      }
```

`getMyDraftVersions` 의 `whereClause`(`product-versions.service.ts:877-883`):

```ts
    const whereClause = and(
      eq(productMasterVersions.status, 'draft'),
      eq(productMasterVersions.draftOwnerId, userId),
      // 일괄 세션 draft 는 수백 건이라 이 화면에 쏟아지면 작업자가 따로 편집하던 draft 가
      // 묻혀 화면의 용도 자체가 없어진다(스펙 §3.3). 세션 화면에서 본다.
      isNull(productMasterVersions.bulkSessionId),
      isNull(productMasterVersions.deletedAt),
      isNull(productMasters.deletedAt),
      filters?.q ? ilike(productMasterVersions.name, `%${filters.q}%`) : undefined,
    );
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts
npm run type-check:scoped
```
Expected: 새 케이스 PASS + 기존 케이스 회귀 0. type-check exit 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/core/products/services/
git commit -m "feat(bulk-session): 세션이 잠근 draft 의 개별 발행·삭제 차단 + my-drafts 제외"
```

---

## Task 3: 상품 필드 변환기 (`bulk-draft.fields.ts`) — 순수

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.fields.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.fields.spec.ts`

**Interfaces:**
- Consumes: `FlatFields`·`BulkItemPayload`·`RowError` (`bulk-session.types.ts`), `UpdateProductMasterVersion` (`catalog.types.ts:66-77`)
- Produces:
  ```ts
  export interface ImageResolver {
    /** (imageKey, usage) → fileId. 3단계가 해석해 둔 것. */
    fileIdFor(imageKey: string, usage: 'main' | 'description'): string | undefined;
  }
  export function buildVersionData(
    fields: FlatFields,
    payload: BulkItemPayload,
    images: ImageResolver,
  ): { data: UpdateProductMasterVersion; errors: RowError[] };
  ```
  Task 6·7 이 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-draft.fields.spec.ts`:

```ts
import { buildVersionData } from './bulk-draft.fields';
import type { FlatFields } from './bulk-session.types';

const noImages = { fileIdFor: () => undefined };
const FILE_A = '0198f000-0000-7000-8000-00000000aaaa';

describe('buildVersionData', () => {
  it('채워진 스칼라를 타입에 맞게 옮긴다', () => {
    const fields: FlatFields = {
      'product.name': '반팔티',
      'product.brand': 'ACME',
      'product.marketPrice': '19900',
      'product.ageRestriction': '19',
      'product.isOverseas': 'Y',
      'product.seoKeywords': '여름|반팔',
    };
    const { data, errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toEqual([]);
    expect(data.name).toBe('반팔티');
    expect(data.brand).toBe('ACME');
    expect(data.marketPrice).toBe(19900);
    expect(data.ageRestriction).toBe(19);
    expect(data.isOverseas).toBe(true);
    expect(data.seoKeywords).toEqual(['여름', '반팔']);
  });

  it('필드경로에 없는 키는 아예 만들지 않는다 — 그것이 "변경 없음"이다', () => {
    const fields: FlatFields = { 'product.brand': 'ACME' };
    const { data } = buildVersionData(fields, { fields }, noImages);

    expect('name' in data).toBe(false);
    expect('marketPrice' in data).toBe(false);
    expect('thumbnailFileId' in data).toBe(false);
  });

  it('빈칸은 컬럼의 성격대로 착지한다 (nullable→null, notNull→기본값)', () => {
    const fields: FlatFields = {
      'product.brand': '',
      'product.maxQuantity': '',
      'product.ageRestriction': '',
      'product.minQuantity': '',
      'product.isWholesaleOnly': '',
      'product.seoKeywords': '',
      'product.salesEndDate': '',
    };
    const { data, errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toEqual([]);
    expect(data.brand).toBeNull();
    expect(data.maxQuantity).toBeNull();
    expect(data.ageRestriction).toBe(0);
    expect(data.minQuantity).toBe(1);
    expect(data.isWholesaleOnly).toBe(false);
    expect(data.seoKeywords).toEqual([]);
    expect(data.salesEndDate).toBeNull();
  });

  it('상품명은 비울 수 없다', () => {
    const fields: FlatFields = { 'product.name': '' };
    const { errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('상품명');
  });

  it('판매기간 ISO 문자열을 Date 로 되살린다', () => {
    const fields: FlatFields = { 'product.salesStartDate': '2026-08-01T15:00:00.000Z' };
    const { data } = buildVersionData(fields, { fields }, noImages);

    expect(data.salesStartDate).toBeInstanceOf(Date);
    expect((data.salesStartDate as Date).toISOString()).toBe('2026-08-01T15:00:00.000Z');
  });

  it('대표이미지키를 fileId 로 바꾸고, 빈칸이면 null 로 지운다', () => {
    const images = { fileIdFor: (key: string) => (key === 'IMG-1' ? FILE_A : undefined) };

    const set = buildVersionData(
      { 'product.thumbnailImageKey': 'IMG-1' },
      { fields: { 'product.thumbnailImageKey': 'IMG-1' } },
      images,
    );
    expect(set.data.thumbnailFileId).toBe(FILE_A);

    const cleared = buildVersionData(
      { 'product.thumbnailImageKey': '' },
      { fields: { 'product.thumbnailImageKey': '' } },
      images,
    );
    expect(cleared.data.thumbnailFileId).toBeNull();
  });

  it('해석되지 않은 이미지키는 행 오류다', () => {
    const fields: FlatFields = { 'product.thumbnailImageKey': 'IMG-9' };
    const { errors } = buildVersionData(fields, { fields }, noImages);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('IMG-9');
  });

  it('본문의 이미지 디렉티브를 fileId 로 치환한다', () => {
    const images = { fileIdFor: (key: string) => (key === 'IMG-2' ? FILE_A : undefined) };
    const fields: FlatFields = { 'product.description': '앞\n::product-image{imageKey="IMG-2"}\n뒤' };
    const { data, errors } = buildVersionData(fields, { fields }, images);

    expect(errors).toEqual([]);
    expect(data.description).toBe(`앞\n::product-image{fileId="${FILE_A}"}\n뒤`);
  });

  it('카테고리는 payload 의 해석 결과를 그대로 싣는다', () => {
    const fields: FlatFields = { 'category.set': 'A>B*' };
    const payload = { fields, categoryIds: ['cat-1', 'cat-2'], primaryCategoryId: 'cat-1' };
    const { data } = buildVersionData(fields, payload, noImages);

    expect(data.categoryIds).toEqual(['cat-1', 'cat-2']);
    expect(data.primaryCategoryId).toBe('cat-1');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.fields.spec.ts
```
Expected: FAIL — `Cannot find module './bulk-draft.fields'`

- [ ] **Step 3: 구현한다**

`bulk-draft.fields.ts`. 핵심은 **키가 `fields` 에 있는지**로 "손댔는가"를 판정하고, 값의 빈칸은 F10 표대로 착지시키는 것이다.

```ts
import type { UpdateProductMasterVersion } from '../../../catalog.types';
import type { BulkItemPayload, FlatFields, RowError } from './bulk-session.types';

export interface ImageResolver {
  fileIdFor(imageKey: string, usage: 'main' | 'description'): string | undefined;
}

/** 부가이미지 상한. 2단계 검증기와 `updateVersion`(product-masters.service.ts:973) 둘 다 5 다. */
const MAX_ADDITIONAL_IMAGES = 5;

/** `::product-image{...}` 한 덩어리. product-import-image.directive.ts 에서 이식했다 — 6단계가 그 파일을 지운다. */
const DIRECTIVE_RE = /::product-image\{([^}]*)\}/g;
const IMAGE_KEY_ATTR_RE = /imageKey\s*=\s*"([^"]*)"/;

/** nullable 문자열 컬럼: 빈칸 → null. */
const NULLABLE_TEXT = [
  'productCode', 'brand', 'alternativeName', 'material',
  'salesClassification', 'purchaseClassification', 'seller',
  'seoTitle', 'seoDescription',
] as const;

/** notNull varchar + 기본값: 빈칸 → 기본값. */
const DEFAULTED_TEXT: Array<[string, string]> = [
  ['productType', 'regular_sale'],
  ['fulfillmentKind', 'physical'],
];

/** notNull boolean, 기본값 false. 'Y' 만 true 다 — 2단계 검증기가 Y/N 외를 이미 걸렀다. */
const BOOLEANS = [
  'isOverseas', 'isVisibleToMembersOnly', 'hideMembershipPriceForNonMembers', 'isWholesaleOnly',
] as const;

/** nullable bigint. 빈칸 → null. */
const NULLABLE_MONEY = ['marketPrice', 'supplyPrice'] as const;

/** notNull integer + 기본값. */
const DEFAULTED_INT: Array<[string, number]> = [
  ['ageRestriction', 0],
  ['minQuantity', 1],
];

export function buildVersionData(
  fields: FlatFields,
  payload: BulkItemPayload,
  images: ImageResolver,
): { data: UpdateProductMasterVersion; errors: RowError[] } {
  const data: UpdateProductMasterVersion = {};
  const errors: RowError[] = [];
  const push = (message: string): void => {
    errors.push({ sheet: '상품', rowNumber: 0, message });
  };

  /** 그 필드를 이 행이 손댔는가. 키의 **존재**가 판정 기준이고 값의 빈 여부가 아니다. */
  const touched = (key: string): boolean => `product.${key}` in fields;
  const raw = (key: string): string => (fields[`product.${key}`] ?? '').trim();

  if (touched('name')) {
    const name = raw('name');
    // 컬럼이 notNull 이고 이름 없는 상품은 목록에서 식별할 수 없다. 비우려는 의도가 있을 수
    // 없으므로 실수로 지운 것으로 본다.
    if (name === '') push('상품명은 비울 수 없습니다.');
    else data.name = name;
  }

  for (const key of NULLABLE_TEXT) {
    if (!touched(key)) continue;
    const value = raw(key);
    data[key] = value === '' ? null : value;
  }

  if (touched('description')) {
    const value = raw('description');
    data.description = value === '' ? null : replaceDirectiveImageKeys(value, images, errors);
  }

  for (const [key, fallback] of DEFAULTED_TEXT) {
    if (!touched(key)) continue;
    const value = raw(key);
    data[key] = value === '' ? fallback : value;
  }

  for (const key of BOOLEANS) {
    if (!touched(key)) continue;
    data[key] = raw(key) === 'Y';
  }

  for (const key of NULLABLE_MONEY) {
    if (!touched(key)) continue;
    const value = raw(key);
    data[key] = value === '' ? null : Number(value);
  }

  for (const [key, fallback] of DEFAULTED_INT) {
    if (!touched(key)) continue;
    const value = raw(key);
    data[key] = value === '' ? fallback : Number(value);
  }

  if (touched('maxQuantity')) {
    const value = raw('maxQuantity');
    data.maxQuantity = value === '' ? null : Number(value);
  }

  if (touched('seoKeywords')) {
    const value = raw('seoKeywords');
    data.seoKeywords = value === '' ? [] : value.split('|').map((k) => k.trim()).filter((k) => k !== '');
  }

  for (const key of ['salesStartDate', 'salesEndDate'] as const) {
    if (!touched(key)) continue;
    const value = raw(key);
    // 2단계 검증기가 ISO 문자열로 굳혀 두었다(bulk-session.validator.ts:208-236). jsonb 왕복에서
    // Date 는 문자열이 되므로 되살리는 지점을 여기 하나로 모은다 — 문자열을 그대로 넘기면
    // drizzle 의 timestamp 매퍼가 .toISOString() 을 불러 그 행이 TypeError 로 죽는다.
    data[key] = value === '' ? null : new Date(value);
  }

  if (touched('thumbnailImageKey')) {
    const key = raw('thumbnailImageKey');
    if (key === '') data.thumbnailFileId = null;
    else {
      const fileId = images.fileIdFor(key, 'main');
      if (!fileId) push(`대표이미지키를 해석할 수 없습니다: ${key}`);
      else data.thumbnailFileId = fileId;
    }
  }

  if (touched('additionalImageKeys')) {
    const rawKeys = raw('additionalImageKeys');
    const keys = rawKeys === '' ? [] : rawKeys.split('|').map((k) => k.trim()).filter((k) => k !== '');
    if (keys.length > MAX_ADDITIONAL_IMAGES) {
      push(`부가이미지키는 ${MAX_ADDITIONAL_IMAGES}개까지 등록할 수 있습니다 (현재 ${keys.length}개).`);
    } else {
      const fileIds: string[] = [];
      for (const key of keys) {
        const fileId = images.fileIdFor(key, 'main');
        if (!fileId) push(`부가이미지키를 해석할 수 없습니다: ${key}`);
        else fileIds.push(fileId);
      }
      // 오류가 있으면 부분 목록을 싣지 않는다 — 그 행은 어차피 실패하고, 부분 목록을 실으면
      // 나중에 이 함수를 재사용하는 쪽이 "일부만 반영된 이미지"를 쓰게 된다.
      if (fileIds.length === keys.length) data.additionalImageFileIds = fileIds;
    }
  }

  // 카테고리는 2단계가 이미 경로 → id 로 해석했다(bulk-session-job.manager.ts:654-659).
  // 여기서 다시 해석하지 않는다 — 해석 규칙이 두 벌이 되면 조용히 갈린다.
  if ('category.set' in fields && payload.categoryIds) {
    data.categoryIds = payload.categoryIds;
    if (payload.primaryCategoryId) data.primaryCategoryId = payload.primaryCategoryId;
  }

  return { data, errors };
}

/**
 * 본문의 `::product-image{imageKey="..."}` 를 `fileId="..."` 로 바꾼다.
 *
 * product-import-image.directive.ts 에서 **이식**했다(import 하지 않는다 — 6단계가 그 모듈을
 * 통째로 지운다). 원본과 다른 점 하나: 해석되지 않은 키를 조용히 두지 않고 행 오류로 올린다.
 * 원본은 호출부가 이미 그 행을 실패시켰다는 전제였는데, 여기서는 이 함수가 그 판단 지점이다.
 */
function replaceDirectiveImageKeys(markdown: string, images: ImageResolver, errors: RowError[]): string {
  return markdown.replace(DIRECTIVE_RE, (whole, attrs: string) => {
    const attr = IMAGE_KEY_ATTR_RE.exec(attrs);
    if (!attr) return whole;
    const key = attr[1]?.trim();
    if (!key) return whole;
    const fileId = images.fileIdFor(key, 'description');
    if (!fileId) {
      errors.push({ sheet: '상품', rowNumber: 0, message: `상세설명의 이미지키를 해석할 수 없습니다: ${key}` });
      return whole;
    }
    return whole.replace(attr[0], `fileId="${fileId}"`);
  });
}
```

**타입 주의**: `data[key] = ...` 형태의 동적 인덱싱이 `UpdateProductMasterVersion` 에서 타입 오류를 내면, 배열을 `as const` 로 두고 `key` 를 리터럴 유니언으로 좁히는 방식으로 푼다. **`as any` 로 덮지 않는다** — Global Constraints 위반이고, 그렇게 하면 컬럼 이름 오타가 컴파일에서 안 잡힌다.

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.fields.spec.ts
npm run type-check:scoped
```
Expected: 9 케이스 PASS, type-check exit 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.fields.*
git commit -m "feat(bulk-session): 상품 필드 변환기 — FlatFields → 버전 갱신 입력"
```

---

## Task 4: 옵션 변환기 (`bulk-draft.options.ts`) — 순수

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.spec.ts`

**Interfaces:**
- Consumes: `parseFieldPath` (`bulk-session.fields.ts:127`), `AddOptionDto`·`ModifyOptionDisplayDto` (`catalog.types.ts:127-151`)
- Produces:
  ```ts
  export interface OptionPlan {
    /** 워크북 옵션키 → { 표시명, 정렬, 값들 } — 신규 행에서만 채워진다. */
    add: AddOptionDto[];
    /** 신규 행: 워크북 옵션값키 → (그룹표시명, 값표시명). 생성 후 실제 id 를 찾는 열쇠(F7). */
    valueNameByKey: Map<string, { groupName: string; valueName: string }>;
  }
  export function buildOptionAdd(fields: FlatFields, optionRows: PrefillRow[]): { plan: OptionPlan; errors: RowError[] };
  export function buildOptionModify(fields: FlatFields): { modify: ModifyOptionDisplayDto[]; errors: RowError[] };
  export function checkCreateStructure(fields: FlatFields, optionRows: PrefillRow[]): RowError[];
  ```
  Task 6·7 이 부른다. `optionRows` 는 `BulkItemInput['bundle']['options']`(= `PrefillRow[]`)다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-draft.options.spec.ts`:

```ts
import { buildOptionAdd, buildOptionModify, checkCreateStructure } from './bulk-draft.options';
import type { FlatFields } from './bulk-session.types';

/** 신규 행의 전형적인 옵션 필드 — 색상(빨강/파랑) 축 하나. */
const createFields: FlatFields = {
  'optionGroup:C.optionName': '색상',
  'optionGroup:C.optionSortOrder': '1',
  'optionValue:C1.optionValueName': '빨강',
  'optionValue:C1.colorCode': '#FF0000',
  'optionValue:C1.valueSortOrder': '1',
  'optionValue:C2.optionValueName': '파랑',
  'optionValue:C2.colorCode': '',
  'optionValue:C2.valueSortOrder': '2',
  'variant:C1.basePrice': '10000',
  'variant:C2.basePrice': '10000',
};

describe('buildOptionAdd (신규 행)', () => {
  it('그룹과 값을 optionDiff.add 로 조립한다', () => {
    const { plan, errors } = buildOptionAdd(createFields);

    expect(errors).toEqual([]);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].displayName).toBe('색상');
    expect(plan.add[0].sortOrder).toBe(1);
    expect(plan.add[0].values).toEqual([
      { displayName: '빨강', colorCode: '#FF0000', sortOrder: 1 },
      { displayName: '파랑', sortOrder: 2 },
    ]);
  });

  it('생성 후 id 를 찾을 열쇠(그룹명·값명)를 워크북 키별로 남긴다', () => {
    const { plan } = buildOptionAdd(createFields);

    expect(plan.valueNameByKey.get('C1')).toEqual({ groupName: '색상', valueName: '빨강' });
    expect(plan.valueNameByKey.get('C2')).toEqual({ groupName: '색상', valueName: '파랑' });
  });

  it('옵션 축이 없는 상품은 빈 계획을 낸다', () => {
    const { plan, errors } = buildOptionAdd({ 'variant:.basePrice': '10000' });

    expect(errors).toEqual([]);
    expect(plan.add).toEqual([]);
  });
});

describe('checkCreateStructure (신규 행 구조 검증 — 스펙에 없던 갭)', () => {
  it('한 그룹 안에서 값 표시명이 겹치면 오류다', () => {
    const errors = checkCreateStructure({
      ...createFields,
      'optionValue:C2.optionValueName': '빨강',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('빨강');
  });

  it('조합이 옵션 시트에 없는 옵션값키를 가리키면 오류다', () => {
    const errors = checkCreateStructure({ ...createFields, 'variant:C9.basePrice': '10000' });

    expect(errors.some((e) => e.message.includes('C9'))).toBe(true);
  });

  it('정상 구조에는 오류가 없다', () => {
    expect(checkCreateStructure(createFields)).toEqual([]);
  });
});

describe('buildOptionModify (수정 행)', () => {
  it('표시명·색상·정렬 변경을 그룹/값 스코프로 나눠 담는다', () => {
    const { modify, errors } = buildOptionModify({
      'optionGroup:g-1.optionName': '컬러',
      'optionValue:v-1.optionValueName': '레드',
      'optionValue:v-1.colorCode': '#FF0000',
      'optionValue:v-2.valueSortOrder': '3',
    });

    expect(errors).toEqual([]);
    // 값의 소속 그룹은 필드경로에 없다 — 값 변경만 있는 값은 optionGroupId 를 모르므로
    // 그룹 항목과 별개로 담기지 않고, 호출부가 실제 소속을 채워 넣는다.
    expect(modify).toEqual([
      { optionGroupId: 'g-1', displayName: '컬러' },
      { optionGroupId: '', values: [{ optionValueId: 'v-1', displayName: '레드', colorCode: '#FF0000' }] },
      { optionGroupId: '', values: [{ optionValueId: 'v-2', sortOrder: 3 }] },
    ]);
  });

  it('옵션명을 비우면 행 오류다 (core 가 조용히 무시하므로)', () => {
    const { errors } = buildOptionModify({ 'optionGroup:g-1.optionName': '' });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('비울 수 없습니다');
  });

  it('옵션값명을 비워도 행 오류다', () => {
    const { errors } = buildOptionModify({ 'optionValue:v-1.optionValueName': '' });

    expect(errors).toHaveLength(1);
  });

  it('색상코드는 비울 수 있다 — core 가 !== undefined 로 처리한다', () => {
    const { modify, errors } = buildOptionModify({ 'optionValue:v-1.colorCode': '' });

    expect(errors).toEqual([]);
    expect(modify[0].values?.[0]).toEqual({ optionValueId: 'v-1', colorCode: null });
  });
});
```

**주의**: 위 `buildOptionModify` 기대값의 `optionGroupId: ''` 는 "값 스코프 변경은 그룹을 모른다"는 사실을 그대로 드러낸 것이다. 구현이 이 shape 을 못 만들겠다면 **테스트를 먼저 고치고 그 이유를 주석으로 남긴 뒤** 구현한다 — 구현에 맞춰 조용히 기대값만 바꾸지 않는다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.spec.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`bulk-draft.options.ts`. 필드경로 되파싱은 **반드시** `parseFieldPath` 를 쓴다(`bulk-session.fields.ts:127` — 정규식을 두 벌 두면 빈 스코프 처리에서 조용히 갈린다).

구현 규약:

- `buildOptionAdd`: **그룹 귀속·그룹 순서·값 순서는 `optionRows` 에서 온다.** 한 행이 `optionKey` 와 `optionValueKey` 를 함께 들고 있어(`form-export.sheets.ts:64-73`) 추론이 필요 없다. 행을 순서대로 훑으며 `optionKey` 로 그룹을 열고 `optionValueKey` 를 붙인다. 표시명·색상·정렬 **값**은 계속 `fields` 에서 읽는다 — 그래야 열 삭제(`present`) 규약이 유지된다.

  > ⚠️ **초판은 여기서 "`fields` 의 키 삽입 순서로 마지막 그룹에 붙인다"고 적었고 그것은 틀렸다** (Task 4 리뷰, 2026-08-03). JS 객체는 이미 있는 키를 재대입해도 삽입 위치가 움직이지 않으므로, 행이 (색상,빨강)→(사이즈,S)→(색상,파랑) 처럼 번갈아 나오면 `optionValue:C2` 가 `optionGroup:S` **뒤에** 삽입돼 파랑이 사이즈 그룹으로 샌다. 실측 재현: `{"C":["C1"],"S":["S1","C2","S2"]}`. 신규 행은 빈 템플릿에 사람이 직접 적으므로 행 순서를 강제할 것이 없다.
- `sortOrder` 는 빈칸이면 `0`(컬럼이 `integer notNull default 0` — `catalog.schema.ts:403,432`). 숫자가 아니면 `0`.
- `colorCode` 는 빈칸이면 `undefined` 로 두지 말고 `null` 로 담아 실제로 지워지게 한다(F4 — core 가 `!== undefined` 로 처리).
- `checkCreateStructure`: (a) 같은 그룹 안 값 표시명 중복, (b) 같은 값 키가 두 그룹, (c) `variant:<조합>` 이 참조하는 옵션값키가 옵션 시트에 없음, (d) 같은 조합 두 번. 조합 문자열은 `+` 로 쪼갠다(F3). **빈 조합(`variant:.`)은 옵션 없는 상품의 계약이므로 (c) 검사에서 제외한다.**
- `buildOptionModify`: 그룹 스코프 키(`optionName`·`optionSortOrder`)는 `{optionGroupId, ...}` 로, 값 스코프 키는 `{optionGroupId: '', values: [{optionValueId, ...}]}` 로 담는다. 표시명이 빈 문자열이면 오류를 밀고 그 항목을 담지 않는다.

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.spec.ts
npm run type-check:scoped
```
Expected: 9 케이스 PASS, exit 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.options.*
git commit -m "feat(bulk-session): 옵션 변환기 — 신규 add·구조검증 + 수정 modifyDisplay"
```

---

## Task 5: 가격 재조립 (`bulk-draft.pricing.ts`) — 순수

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.pricing.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.pricing.spec.ts`

**Interfaces:**
- Consumes: `SimplePrices` (`form-export.pricing-judge.ts:5-10`), `ReplacePricingRulesDto` (`core/pricing/dto/pricing-rules-set.dto.ts:77`)
- Produces:
  ```ts
  export function applyPriceChanges(
    current: SimplePrices,
    fields: FlatFields,
    variantIdByCombo: ReadonlyMap<string, string>,
  ): { prices: SimplePrices; errors: RowError[] };

  export function toReplaceDto(prices: SimplePrices): ReplacePricingRulesDto;
  ```
  Task 6·7 이 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { applyPriceChanges, toReplaceDto } from './bulk-draft.pricing';
import type { SimplePrices } from './form-export.pricing-judge';

const empty = (): SimplePrices => ({ basePrice: null, membershipPrice: null, variantOverrides: new Map() });

describe('applyPriceChanges', () => {
  it('상품 판매가·멤버십가 변경을 얹는다', () => {
    const current: SimplePrices = { basePrice: 10000, membershipPrice: 9000, variantOverrides: new Map() };
    const { prices, errors } = applyPriceChanges(current, { 'product.basePrice': '12000' }, new Map());

    expect(errors).toEqual([]);
    expect(prices.basePrice).toBe(12000);
    // 안 건드린 축은 현재 값이 그대로 살아남는다 — 이것이 "재조립이 무손실"인 이유다.
    expect(prices.membershipPrice).toBe(9000);
  });

  it('조합별 가격을 variantId 로 옮긴다', () => {
    const { prices, errors } = applyPriceChanges(
      empty(),
      { 'variant:ov-1+ov-2.basePrice': '15000' },
      new Map([['ov-1+ov-2', 'variant-a']]),
    );

    expect(errors).toEqual([]);
    expect(prices.variantOverrides.get('variant-a')).toEqual({ basePrice: 15000, membershipPrice: null });
  });

  it('빈칸은 그 축의 오버라이드를 해제한다', () => {
    const current: SimplePrices = {
      basePrice: 10000,
      membershipPrice: null,
      variantOverrides: new Map([['variant-a', { basePrice: 15000, membershipPrice: null }]]),
    };
    const { prices } = applyPriceChanges(
      current,
      { 'variant:ov-1.basePrice': '' },
      new Map([['ov-1', 'variant-a']]),
    );

    expect(prices.variantOverrides.get('variant-a')?.basePrice).toBeNull();
  });

  it('조합을 variant 로 풀 수 없으면 행 오류다', () => {
    const { errors } = applyPriceChanges(empty(), { 'variant:없는조합.basePrice': '1' }, new Map());

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('없는조합');
  });
});

describe('toReplaceDto', () => {
  it('all_variants 룰을 order 1 로 두고 조합 룰을 뒤에 붙인다', () => {
    const dto = toReplaceDto({
      basePrice: 10000,
      membershipPrice: 9000,
      variantOverrides: new Map([['variant-a', { basePrice: 15000, membershipPrice: null }]]),
    });

    expect(dto.basePriceRules).toEqual([
      { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 10000 },
      {
        layer: 'base_price',
        order: 2,
        scopeType: 'variants',
        scopeTargetIds: ['variant-a'],
        operationType: 'override',
        operationValue: 15000,
      },
    ]);
    expect(dto.membershipPriceRules).toHaveLength(1);
    expect(dto.tieredPriceRules).toEqual([]);
  });

  it('상품 판매가가 없으면 조합 룰만으로 DTO 를 만들지 않는다', () => {
    // pricingRulesSetSchema 제약: order 1 인 첫 base_price 룰은 all_variants 여야 한다
    // (product-import-pricing.builder.ts:9-10). 상품 판매가 없이 조합 룰만 있으면 그 제약을
    // 어기므로 여기서 막는다 — 안 막으면 replaceVersionRules 가 400 을 내고 행이 죽는다.
    expect(() =>
      toReplaceDto({
        basePrice: null,
        membershipPrice: null,
        variantOverrides: new Map([['variant-a', { basePrice: 15000, membershipPrice: null }]]),
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.pricing.spec.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`applyPriceChanges` 는 `current` 를 **복사**해 시작한다(입력을 변형하지 않는다 — 호출부가 재시도 시 같은 객체를 다시 쓴다). `product.basePrice`/`product.membershipPrice` 는 최상위 축을, `variant:<조합>.basePrice`/`.membershipPrice` 는 `variantIdByCombo` 로 푼 variantId 축을 덮는다. 빈 문자열은 `null`(해제), 그 외는 `Number()`.

`toReplaceDto` 는 `product-import-pricing.builder.ts:19-75` 의 조립 순서를 그대로 따른다 — 이식이지 재사용이 아니다(6단계가 그 파일을 지운다). `basePrice` 가 `null` 인데 조합 오버라이드가 있으면 `BadRequestError` 를 던진다.

**`membershipPrice` 만 있고 `basePrice` 가 없는 경우**: `basePriceRules` 가 비면 스키마 제약에 걸리므로 같은 예외를 던진다. 실제로 이 상태는 신규 행에서 도달 불가다(2단계 검증기가 신규 행의 판매가를 필수로 본다 — `bulk-session.validator.ts:323-325`). 수정 행에서는 `current.basePrice` 가 항상 차 있다(active 상품이므로).

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.pricing.spec.ts
npm run type-check:scoped
```
Expected: 6 케이스 PASS, exit 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.pricing.*
git commit -m "feat(bulk-session): 가격 재조립 — 현재 룰 + 변경 칸 → replace DTO"
```

---

## Task 6: applier — 신규 경로

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts`

**Interfaces:**
- Consumes: Task 3·4·5 의 순수 함수들; `ProductMastersService.createMaster(ownerId, tx)`(`product-masters.service.ts:182`)·`updateVersion(versionId, data, tx)`(`:889`); `OptionReadLoader.getOptionGroups(tx, masterId, versionId, locale)`(`option-read.loader.ts:20`)·`getVariantOptionValues(tx, variantId, versionId, locale)`; `PricingService.replaceVersionRules(versionId, dto, tx)`(`pricing.service.ts:67`); `ProductPurchaseConstraintsService.upsertForDraft(masterId, versionId, input, tx)`(`product-purchase-constraints.service.ts:73`)
- Produces:
  ```ts
  export interface DraftInput {
    sessionId: string;
    userId: string;
    kind: 'create' | 'update';
    masterId: string | null;
    payload: BulkItemPayload;
    /**
     * 업로드 원본의 옵션 시트 행(`BulkItemInput['bundle']['options']`). 신규 행의 옵션 **그룹 귀속**은
     * `payload.fields` 에서 복원할 수 없다 — 평면화가 그 정보를 잃는다(Task 4 리뷰, 2026-08-03).
     * 한 행이 optionKey·optionValueKey 를 함께 들고 있는 이 배열이 유일한 권위 있는 출처다.
     */
    optionRows: PrefillRow[];
    conflictDecision: ConflictDecisionMap;
    baseSnapshot: BulkBaseSnapshot | null;
    images: ImageResolver;
  }
  @Injectable()
  export class BulkDraftApplier {
    /** 성공하면 draft 버전 id 와 (신규면) 새 masterId 를 돌려준다. 행 오류는 BadRequestError 로 던진다. */
    async apply(input: DraftInput, tx: DbTransaction): Promise<{ draftVersionId: string; masterId: string }>;
  }
  ```
  Task 8 이 부른다.

- [ ] **Step 1: 행 오류 포매터를 공유 위치로 옮긴다**

`formatRowError`/`formatRowErrors` 는 지금 `bulk-session-job.manager.ts:116-126` 의 **모듈 private** 이라 applier 가 쓸 수 없다. `bulk-session.types.ts` 로 옮기고(`RowError` 가 이미 거기 산다) export 한 뒤, job manager 는 임포트해 쓴다. **동작을 바꾸지 않는 순수 이동이다** — 시그니처·본문·주석을 그대로 옮긴다.

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts
```
Expected: 이동 후에도 전 케이스 PASS (회귀 0). 여기서 빨개지면 이동이 아니라 변경을 한 것이다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

페이크는 **호출 인자를 기록하는 얇은 객체**로 만든다(2·3단계 선례 — 생성자에 `as never` 로 넘긴다). DB 는 타지 않는다.

```ts
import { BulkDraftApplier, type DraftInput } from './bulk-draft.applier';
import type { FlatFields } from './bulk-session.types';

const VERSION_ID = '0198f000-0000-7000-8000-000000000001';
const MASTER_ID = '0198f000-0000-7000-8000-000000000002';
const SESSION_ID = '0198f000-0000-7000-8000-000000000003';
const USER_ID = '0198f000-0000-7000-8000-000000000004';

interface Calls {
  updateVersion: unknown[][];
  replaceVersionRules: unknown[][];
  upsertForDraft: unknown[][];
  locked: Array<{ versionId: string; sessionId: string | null }>;
}

function makeApplier() {
  const calls: Calls = { updateVersion: [], replaceVersionRules: [], upsertForDraft: [], locked: [] };

  // 잠금 UPDATE 는 applier 가 직접 쓰는 유일한 DB 문장이다. drizzle 빌더를 흉내 내는 대신
  // set() 인자만 붙잡는다 — bulk-session.manager.spec.ts 가 세운 선례와 같은 깊이다.
  const trx = {
    update: () => ({
      set: (values: { bulkSessionId: string | null }) => ({
        where: () => {
          calls.locked.push({ versionId: VERSION_ID, sessionId: values.bulkSessionId });
          return Promise.resolve();
        },
      }),
    }),
  };

  const db = { run: <T>(fn: (t: never) => Promise<T>) => fn(trx as never) };

  const masters = {
    createMaster: () => Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID }),
    updateVersion: (...args: unknown[]) => {
      calls.updateVersion.push(args);
      return Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID });
    },
  };
  const versions = {
    getActiveVersion: () => Promise.resolve({ id: 'active-1', masterId: MASTER_ID }),
    createDraftVersion: () => Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID }),
  };
  const variants = { bulkUpdateVariantsInDraft: () => Promise.resolve([]) };
  const optionLoader = {
    getOptionGroups: () => Promise.resolve([]),
    getVariantOptionValues: () => Promise.resolve([]),
  };
  const pricing = {
    getVersionRules: () =>
      Promise.resolve({ basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] }),
    replaceVersionRules: (...args: unknown[]) => {
      calls.replaceVersionRules.push(args);
      return Promise.resolve({});
    },
  };
  const constraints = {
    upsertForDraft: (...args: unknown[]) => {
      calls.upsertForDraft.push(args);
      return Promise.resolve(null);
    },
  };

  const applier = new BulkDraftApplier(
    db as never,
    masters as never,
    versions as never,
    variants as never,
    optionLoader as never,
    pricing as never,
    constraints as never,
  );
  return { applier, calls, trx };
}

function createInput(fields: FlatFields): DraftInput {
  return {
    sessionId: SESSION_ID,
    userId: USER_ID,
    kind: 'create',
    masterId: null,
    payload: { fields },
    // 옵션 없는 상품이 기본값이다. 옵션이 있는 케이스는 행을 명시적으로 넘긴다.
    optionRows: [],
    conflictDecision: {},
    baseSnapshot: null,
    images: { fileIdFor: () => undefined },
  };
}
```

케이스:

```ts
describe('BulkDraftApplier — 신규 경로', () => {
  it('master 를 만들고 스칼라를 updateVersion 으로 넘긴다', async () => {
    const { applier, calls, trx } = makeApplier();

    const result = await applier.apply(
      createInput({ 'product.name': '반팔티', 'product.basePrice': '10000' }),
      trx as never,
    );

    expect(result).toEqual({ draftVersionId: VERSION_ID, masterId: MASTER_ID });
    expect(calls.updateVersion).toHaveLength(1);
    expect(calls.updateVersion[0][1]).toMatchObject({ name: '반팔티' });
  });

  it('판매가를 all_variants override 룰로 만든다', async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(createInput({ 'product.name': 'T', 'product.basePrice': '10000' }), trx as never);

    expect(calls.replaceVersionRules).toHaveLength(1);
    expect(calls.replaceVersionRules[0][1]).toMatchObject({
      basePriceRules: [
        { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 10000 },
      ],
    });
  });

  it('draft 에 bulk_session_id 를 심는다', async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(createInput({ 'product.name': 'T', 'product.basePrice': '10000' }), trx as never);

    expect(calls.locked).toEqual([{ versionId: VERSION_ID, sessionId: SESSION_ID }]);
  });

  it('옵션 구조 오류는 BadRequestError 로 그 행만 실패시킨다', async () => {
    const { applier, trx } = makeApplier();

    // 조합이 옵션 시트에 없는 옵션값키를 가리킨다 (F8 이 지적한 무검증 구멍).
    await expect(
      applier.apply(
        createInput({ 'product.name': 'T', 'product.basePrice': '10000', 'variant:없는키.basePrice': '1' }),
        trx as never,
      ),
    ).rejects.toThrow('없는키');
  });

  it('구매제약 칸이 없으면 upsertForDraft 를 부르지 않는다', async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(createInput({ 'product.name': 'T', 'product.basePrice': '10000' }), trx as never);

    expect(calls.upsertForDraft).toEqual([]);
  });
});
```

**하네스의 생성자 인자 순서가 실제 구현과 어긋나면 구현을 먼저 확정하고 하네스를 맞춘다** — 순서 자체는 위 목록(db, masters, versions, variants, optionLoader, pricing, constraints)을 그대로 쓴다.

- [ ] **Step 3: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts
```
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 신규 경로를 구현한다**

순서가 중요하다(F6·F7):

```ts
  private async applyCreate(input: DraftInput, tx: DbTransaction): Promise<{ draftVersionId: string; masterId: string }> {
    const fields = input.payload.fields;

    // ① 구조 검증이 먼저다 — master 를 만든 뒤 실패하면 롤백이 지워주긴 하지만, 검증이
    //    가능한 것을 쓰기 뒤로 미루면 실패 비용만 커진다.
    const structureErrors = checkCreateStructure(fields, input.optionRows);
    if (structureErrors.length > 0) throw new BadRequestError(formatRowErrors(structureErrors));

    const { data, errors } = buildVersionData(fields, input.payload, input.images);
    const { plan, errors: optionErrors } = buildOptionAdd(fields, input.optionRows);
    const all = [...errors, ...optionErrors];
    if (all.length > 0) throw new BadRequestError(formatRowErrors(all));

    // ② master + draft 버전
    const version = await this.masters.createMaster(input.userId, tx);

    // ③ 스칼라·이미지·카테고리 + 옵션 추가. optionDiff.add 가 있으면 updateVersion 이
    //    variant 를 자동 생성한다(_regenerateVariantsForVersion).
    await this.masters.updateVersion(
      version.id,
      { ...data, ...(plan.add.length > 0 ? { optionDiff: { add: plan.add } } : {}) },
      tx,
    );

    // ④ 조합 → variantId. 신규 행은 워크북 키가 작업자가 지은 이름이라 되읽어 짝지어야 한다(F7).
    const variantIdByCombo = await this.resolveCreatedCombos(version.masterId, version.id, plan, tx);

    // ⑤ variantCode. 갓 만든 master 라 CoW 가 필요 없지만 **경로를 하나로 유지한다** —
    //    CoW 판정은 "다른 버전에도 매핑됐는가"이므로 단독 매핑인 여기서는 in-place UPDATE 로
    //    떨어진다(product-variants.service.ts:401 앞의 분기). 두 경로를 나누면 나중에 한쪽만 고쳐진다.
    await this.applyVariantCodes(version.masterId, version.id, fields, variantIdByCombo, tx);

    // ⑥ 가격. 신규는 현재 룰이 없으므로 빈 SimplePrices 에서 시작한다.
    const { prices, errors: priceErrors } = applyPriceChanges(
      { basePrice: null, membershipPrice: null, variantOverrides: new Map() },
      fields,
      variantIdByCombo,
    );
    if (priceErrors.length > 0) throw new BadRequestError(formatRowErrors(priceErrors));
    await this.pricing.replaceVersionRules(version.id, toReplaceDto(prices), tx);

    // ⑦ 구매제약. 값이 없으면 부르지 않는다 — upsertForDraft 의 isDeleteIntent 가
    //    "requiresMembership=false + limit=null" 을 삭제로 읽으므로 신규엔 왕복만 는다
    //    (v3 product-import.manager.ts:190-197 과 같은 근거).
    await this.applyConstraint(version.masterId, version.id, fields, tx);

    await this.lockDraft(version.id, input.sessionId, tx);
    return { draftVersionId: version.id, masterId: version.masterId };
  }
```

`resolveCreatedCombos` 는 F7 의 4단계를 그대로 구현한다: `getOptionGroups` 로 `(그룹명, 값명) → optionValueId` 를 만들고, 워크북 조합키를 그 맵으로 실제 id 집합으로 바꾼 뒤 정렬 조인해 키를 만들고, `productMasterVariants` 의 variant 마다 `getVariantOptionValues` 로 같은 키를 만들어 짝짓는다. **옵션이 없는 상품은 variant 가 하나이고 키가 빈 문자열이다**(F3).

`lockDraft` 는 한 문장이다:

```ts
  private async lockDraft(versionId: string, sessionId: string, tx: DbTransaction): Promise<void> {
    await tx
      .update(productMasterVersions)
      .set({ bulkSessionId: sessionId, updatedAt: new Date() })
      .where(eq(productMasterVersions.id, versionId));
  }
```

- [ ] **Step 5: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts
npm run type-check:scoped
```
Expected: 5 케이스 PASS, exit 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/ apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.types.ts
git commit -m "feat(bulk-session): draft applier 신규 경로 — master 생성 + 옵션·가격·제약"
```

---

## Task 7: applier — 수정 경로 (포크 후 적용)

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts`

**Interfaces:**
- Consumes: `ProductVersionsService.createDraftVersion(parentVersionId, userId, copyMappings, tx)`(`product-versions.service.ts:206`)·`getActiveVersion(masterId, tx)`; `ProductVariantsService.bulkUpdateVariantsInDraft(masterId, versionId, updates, tx)`(`product-variants.service.ts:424`); `PricingService` 의 버전 룰 조회; `extractSimplePrices`(`form-export.pricing-judge.ts:36`)
- Produces: `BulkDraftApplier.apply` 의 `kind === 'update'` 분기

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Task 6 의 `makeApplier` 를 그대로 쓰고, 수정 행용 입력 헬퍼를 더한다:

```ts
const ACTIVE_ID = '0198f000-0000-7000-8000-00000000000a';

/** 옵션 없는 상품 하나짜리 스냅샷. `combination` 이 빈 문자열인 것이 계약이다(F3). */
function updateInput(fields: FlatFields, overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    sessionId: SESSION_ID,
    userId: USER_ID,
    kind: 'update',
    masterId: MASTER_ID,
    payload: { fields },
    // 수정 행은 옵션 구조를 못 바꾸므로 이 배열을 쓰지 않는다(그룹 귀속은 DB 에서 읽는다).
    optionRows: [],
    conflictDecision: {},
    baseSnapshot: {
      product: {},
      options: [],
      variants: [{ combination: '', variantCode: 'OLD' }],
      categories: [],
      constraint: null,
      images: {},
      pricingEditable: true,
    },
    images: { fileIdFor: () => undefined },
    ...overrides,
  };
}
```

케이스:

```ts
describe('BulkDraftApplier — 수정 경로', () => {
  it('현재 active 에서 포크한다 — 스냅샷 버전이 아니라', async () => {
    // §3.6 병합 설계의 전부가 이 한 줄이다. 스냅샷에서 포크하면 그 사이 남이 발행한 변경이
    // 이 draft 가 발행되는 순간 통째로 사라진다(publishVersion 은 통째 교체 — 스펙 §2.2).
    const forkedFrom: string[] = [];
    const { applier, trx } = makeApplier();
    applier['versions'].getActiveVersion = () => Promise.resolve({ id: ACTIVE_ID, masterId: MASTER_ID });
    applier['versions'].createDraftVersion = (parentVersionId: string) => {
      forkedFrom.push(parentVersionId);
      return Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID });
    };

    await applier.apply(updateInput({ 'product.brand': 'ACME' }), trx as never);

    expect(forkedFrom).toEqual([ACTIVE_ID]);
  });

  it("conflict_decision 이 'skip' 인 필드는 적용하지 않는다", async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(
      updateInput(
        { 'product.brand': 'BETA', 'product.name': '새 이름' },
        { conflictDecision: { 'product.brand': 'skip' } },
      ),
      trx as never,
    );

    const data = calls.updateVersion[0][1] as Record<string, unknown>;
    expect(data.name).toBe('새 이름');
    expect('brand' in data).toBe(false);
  });

  it('variant 편집은 bulkUpdateVariantsInDraft 로 간다', async () => {
    // 페이크에는 productVariants 직접 UPDATE 경로가 없다 — 그 방식으로 회귀하면 여기서 죽는다.
    const updates: unknown[] = [];
    const { applier, trx } = makeApplier();
    applier['variants'].bulkUpdateVariantsInDraft = (_m: string, _v: string, args: unknown[]) => {
      updates.push(...args);
      return Promise.resolve([{ originalId: 'v-old', variantId: 'v-old', cowed: false }]);
    };

    await applier.apply(updateInput({ 'variant:.variantCode': 'NEW-CODE' }), trx as never);

    expect(updates).toEqual([{ id: 'v-old', variantCode: 'NEW-CODE' }]);
  });

  it('CoW 로 바뀐 variantId 로 가격 룰을 만든다', async () => {
    const { applier, calls, trx } = makeApplier();
    applier['variants'].bulkUpdateVariantsInDraft = () =>
      Promise.resolve([{ originalId: 'v-old', variantId: 'v-new', cowed: true }]);
    applier['pricing'].getVersionRules = () =>
      Promise.resolve({
        basePriceRules: [
          { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 10000 },
        ],
        membershipPriceRules: [],
        tieredPriceRules: [],
      });

    await applier.apply(
      updateInput({ 'variant:.variantCode': 'NEW-CODE', 'variant:.basePrice': '15000' }),
      trx as never,
    );

    const dto = calls.replaceVersionRules[0][1] as { basePriceRules: Array<{ scopeTargetIds?: string[] }> };
    expect(dto.basePriceRules.some((r) => r.scopeTargetIds?.includes('v-new'))).toBe(true);
    expect(dto.basePriceRules.some((r) => r.scopeTargetIds?.includes('v-old'))).toBe(false);
  });

  it('가격 칸을 안 건드린 행은 replaceVersionRules 를 부르지 않는다', async () => {
    // Task 5 리뷰가 남긴 ⚠️: toReplaceDto 는 basePrice 가 null 이면 항상 throw 한다. 브랜드만
    // 고친 행에서 가격 replace 를 부르면, all_variants 판매가 룰이 없는 상품에서 가격과 무관한
    // 수정이 통째로 실패한다. 안 부르는 것이 옳고, `_copyMappings` 가 복사한 룰이 이미 정답이다.
    const { applier, calls, trx } = makeApplier();

    await applier.apply(updateInput({ 'product.brand': 'ACME' }), trx as never);

    expect(calls.replaceVersionRules).toEqual([]);
  });

  it('pricingEditable=false 면 가격 칸을 건드려도 replaceVersionRules 를 부르지 않는다', async () => {
    // _copyMappings 가 복사한 복합 룰(tiered·scale 등)이 그대로 살아 있어야 한다. 부르는 순간
    // replace 가 그것을 단순 override 로 뭉갠다(F9).
    //
    // **가격 칸을 실제로 건드리는 입력이어야 한다** — 위 테스트가 이미 "안 건드리면 안 부른다"를
    // 덮으므로, 여기서 브랜드만 바꾸면 두 테스트가 같은 경로를 보고 pricingEditable 분기는
    // 아무도 검증하지 않게 된다. (실전에서 이 조합은 센티넬 훼손 행이라 2단계 검증기가 이미
    // invalid 로 걸러내지만, 이 단정은 applier 가 스스로 막는다는 것을 고정한다.)
    const { applier, calls, trx } = makeApplier();
    const input = updateInput({ 'product.basePrice': '12000' });
    input.baseSnapshot = { ...input.baseSnapshot!, pricingEditable: false };

    await applier.apply(input, trx as never);

    expect(calls.replaceVersionRules).toEqual([]);
  });
});
```

`applier['versions']` 같은 인덱스 접근은 **이 스펙 안에서만** 쓴다 — private 필드를 케이스별로 갈아끼우기 위한 것이고, `as any` 없이 되는 방식이다. 클래스 필드를 `private readonly` 로 두면 이 접근이 타입 오류가 나므로, 그때는 `makeApplier` 에 페이크 오버라이드 인자를 받게 고친다(생성자 주입으로 바꾸는 쪽이 더 낫다).

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts -t '수정'
```
Expected: FAIL

- [ ] **Step 3: 수정 경로를 구현한다**

```ts
  private async applyUpdate(input: DraftInput, tx: DbTransaction): Promise<{ draftVersionId: string; masterId: string }> {
    const masterId = input.masterId;
    if (!masterId || !input.baseSnapshot) {
      throw new BadRequestError('기준 상품 정보가 없어 수정할 수 없습니다. 양식을 다시 받아 주세요.');
    }

    // ① 충돌 결정이 'skip' 인 필드를 적용분에서 뺀다. 결정은 **필드 단위**다(스펙 §3.6) —
    //    행 단위로 뭉치면 무관한 필드까지 함께 되돌아간다.
    const fields = omitSkipped(input.payload.fields, input.conflictDecision);

    // ② 현재 active 에서 포크한다. 스냅샷에서 포크하면 그 사이 남이 발행한 변경이 이 draft 가
    //    발행되는 순간 통째로 사라진다(publishVersion 은 병합이 아니라 통째 교체 — 스펙 §2.2).
    const active = await this.versions.getActiveVersion(masterId, tx);
    const draft = await this.versions.createDraftVersion(active.id, input.userId, true, tx);

    // ③ 스칼라·이미지·카테고리 + 옵션 표시 변경
    const { data, errors } = buildVersionData(fields, { ...input.payload, fields }, input.images);
    const { modify, errors: optionErrors } = buildOptionModify(fields);
    const all = [...errors, ...optionErrors];
    if (all.length > 0) throw new BadRequestError(formatRowErrors(all));

    const resolvedModify = await this.attachGroupIds(masterId, draft.id, modify, tx);
    await this.masters.updateVersion(
      draft.id,
      { ...data, ...(resolvedModify.length > 0 ? { optionDiff: { modifyDisplay: resolvedModify } } : {}) },
      tx,
    );

    // ④ variant. 포크한 draft 는 active 와 variantId 를 공유하므로 반드시 CoW 경로다(F6).
    //    반환된 {originalId → variantId} 맵이 ⑤ 의 열쇠다.
    const variantIdByCombo = await this.resolveExistingCombos(masterId, draft.id, tx);
    const cowMap = await this.applyVariantCodes(masterId, draft.id, fields, variantIdByCombo, tx);

    // ⑤ 가격. 두 경우에 **아예 손대지 않는다**:
    //   (a) 얼린 판정이 false — replace 를 부르는 순간 복합 룰이 단순 override 로 뭉개진다(F9)
    //   (b) 이 행이 가격 칸을 하나도 안 건드렸다 — `_copyMappings` 가 복사한 룰이 이미 정답이다.
    //       부르면 같은 룰을 지웠다 다시 만드는 왕복일 뿐이고, 더 나쁘게는 basePrice 축이
    //       비어 있는 상품(가격 룰이 all_variants 없이 조합 룰만 있거나 아예 없는 경우)에서
    //       `toReplaceDto` 가 throw 해 **가격과 무관한 수정(브랜드만 바꾼 행)이 실패한다.**
    //       (Task 5 리뷰가 남긴 ⚠️ 항목 — toReplaceDto 는 basePrice 가 null 이면 항상 throw 한다.)
    const touchesPrice = Object.keys(fields).some(
      (path) => path === 'product.basePrice' || path === 'product.membershipPrice' || /^variant:.*\.(basePrice|membershipPrice)$/.test(path),
    );
    if (input.baseSnapshot.pricingEditable !== false && touchesPrice) {
      const current = extractSimplePrices(await this.pricing.getVersionRules(draft.id, tx));
      const { prices, errors: priceErrors } = applyPriceChanges(current, fields, cowMap);
      if (priceErrors.length > 0) throw new BadRequestError(formatRowErrors(priceErrors));
      await this.pricing.replaceVersionRules(draft.id, toReplaceDto(prices), tx);
    }

    await this.applyConstraint(masterId, draft.id, fields, tx);
    await this.lockDraft(draft.id, input.sessionId, tx);
    return { draftVersionId: draft.id, masterId };
  }
```

**`cowMap` 은 `variantIdByCombo` 를 CoW 결과로 갱신한 맵이다** — `applyVariantCodes` 가 `bulkUpdateVariantsInDraft` 의 반환으로 원본 id 를 새 id 로 바꿔 돌려준다. variantCode 를 안 바꾼 조합은 CoW 가 일어나지 않아 원래 id 그대로다.

`attachGroupIds` 는 `buildOptionModify` 가 `optionGroupId: ''` 로 남긴 값 스코프 항목에 실제 소속 그룹을 채운다 — `getOptionGroups(tx, masterId, draft.id, 'ko-KR')` 로 `optionValueId → optionGroupId` 를 만들어 쓴다. **찾지 못한 값 id 는 행 오류**다(수정 행에서 옵션값 추가는 금지이므로 도달하면 데이터가 어긋난 것이다).

**`getVersionRules` 는 실측된 것을 그대로 쓴다** — `PricingService.getVersionRules(versionId, tx?)`(`pricing.service.ts:25`)가 `PricingRulesResponseDto` 를 돌려주고 그것이 `extractSimplePrices` 의 입력 타입이다(F9). 별도 리더를 만들지 않는다.

**포크한 draft 의 룰을 읽는다(active 가 아니라).** `_copyMappings` 가 이미 복사했으므로 둘은 같은 값이지만, draft 를 읽어야 "지금 이 draft 에 실제로 달린 것"과 replace 대상이 일치한다.

`omitSkipped` 는 applier 안의 private 순수 헬퍼다:

```ts
/**
 * 충돌 결정이 'skip' 인 필드를 적용분에서 뺀다. 결정은 필드 단위다(스펙 §3.6) —
 * 행 단위로 뭉치면 판매가 하나 되돌리려다 무관한 필드까지 함께 되돌아간다.
 */
function omitSkipped(fields: FlatFields, decision: ConflictDecisionMap): FlatFields {
  const out: FlatFields = {};
  for (const [path, value] of Object.entries(fields)) {
    if (decision[path] === 'skip') continue;
    out[path] = value;
  }
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.spec.ts
npm run type-check:scoped
```
Expected: 8 케이스 PASS, exit 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-draft.applier.*
git commit -m "feat(bulk-session): draft applier 수정 경로 — 현재 active 포크 후 변경분 적용"
```

---

## Task 8: `drafting` 레인

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.ts` (`CLAIMABLE_PHASES:80`, `claim:184`, 새 `runDraftSlice`)
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.worker.ts:46-47`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.worker.spec.ts`

**Interfaces:**
- Consumes: `BulkDraftApplier.apply`·`DraftInput` (Task 6·7, `./bulk-draft.applier`); `ImageResolver` (Task 3, `./bulk-draft.fields`); `toConflictDecisionMap` (**이미 export 돼 있다** — `bulk-session.reader.ts:113`); `isBulkItemPayload`·`isBulkBaseSnapshot` (`bulk-session.types.ts:132,136`)
- Produces: `BulkSessionJobManager.runDraftSlice(claimed: ClaimedBulkSession): Promise<void>`; 상수 `DEFAULT_DRAFT_SLICE`; getter `draftSlice`

`BulkSessionJobManager` 의 생성자에 `BulkDraftApplier` 가 하나 는다 — **기존 스펙 파일의 생성 지점도 전부 고쳐야 한다**(`bulk-session-job.manager.spec.ts`). 인자를 안 넘기면 런타임에 `undefined.apply` 로 죽지만 타입체크는 통과할 수도 있다(하네스가 `as never` 를 쓰므로).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-session-job.manager.spec.ts` 의 기존 하네스(가짜 drizzle 빌더 + 기록되는 UPDATE)를 그대로 쓴다. `BulkSessionJobManager` 생성자에 `BulkDraftApplier` 가 추가되므로 **기존 케이스의 생성 지점도 함께 고쳐야 한다** — 페이크 applier 하나를 파일 상단에 만들어 모든 케이스가 공유하게 한다.

```ts
/** 기록되는 페이크 applier. 기본은 성공이고, 케이스가 `fail` 로 특정 행만 던지게 만든다. */
function makeApplier(fail?: (rowNumber: number) => boolean) {
  const applied: number[] = [];
  return {
    applied,
    apply: (input: { payload: unknown }, _tx: unknown) => {
      const rowNumber = (input as { rowNumber?: number }).rowNumber ?? 0;
      applied.push(rowNumber);
      if (fail?.(rowNumber)) return Promise.reject(new Error('생성 실패'));
      return Promise.resolve({ draftVersionId: 'draft-1', masterId: 'master-1' });
    },
  };
}
```

케이스:

```ts
  it('drafting 슬라이스는 status=pending 인 행만 집는다', async () => {
    // 렌더된 WHERE 에 status = 'pending' 이 들어있는지 본다 —
    // bulk-session.manager.spec.ts:40 의 dialect.sqlToQuery(condition as never) 선례를 쓴다.
  });

  it('행 하나가 실패해도 나머지가 계속 진행된다', async () => {
    // applier 가 2행에서만 throw → 1·3행은 status='drafted', 2행은 'failed' + errorMessage 가
    // 그 행에만 붙는다. 이것이 행 단위 트랜잭션의 존재 이유다.
    const applier = makeApplier((rowNumber) => rowNumber === 2);
    // ... runDraftSlice 실행 후 기록된 UPDATE 3건의 set() 인자를 검사한다
    expect(updates.map((u) => u.status)).toEqual(['drafted', 'failed', 'drafted']);
    expect(updates[1].errorMessage).toContain('생성 실패');
  });

  it('성공한 행에 draft_version_id 와 master_id 를 적는다', async () => {
    expect(updates[0]).toMatchObject({ status: 'drafted', draftVersionId: 'draft-1', masterId: 'master-1' });
  });

  it('남은 행이 없으면 phase 를 drafted 로 민다 (토큰 CAS + 취소 가드)', async () => {
    // 아이템 조회가 0행 → finishDrafting. 렌더된 WHERE 에 lease_token 등호와
    // cancel_requested_at IS NULL 이 **둘 다** 있어야 한다. 하나라도 빠지면 뒤늦게 깨어난
    // 좀비가 후임이 처리 중인 세션에 drafted 를 도장 찍는다(finishValidating 과 같은 이유).
  });

  it('lease 를 잃으면 즉시 멈춘다', async () => {
    // renewLease 가 owned:false → 남은 행을 처리하지 않고 return. 계속하면 후임과 같은 행을
    // 나란히 처리해 draft 가 두 벌 생긴다.
    expect(applier.applied).toEqual([]);
  });

  it('취소가 감지되면 lease 만 놓고 멈춘다', async () => {
    // renewLease 가 canceled:true → releaseLease 만 부르고 phase 는 건드리지 않는다
    // (phase 는 취소 경로가 이미 canceled 로 확정했다 — bulk-session.manager.ts:389-395).
  });
```

각 케이스의 `updates`/`applier` 는 파일의 기존 하네스가 UPDATE 를 모으는 방식(`bulk-session-job.manager.spec.ts` 상단)을 그대로 따른다 — **새 하네스를 만들지 않는다.**

`bulk-session-job.worker.spec.ts`:

```ts
  it("phase 가 'drafting' 이면 runDraftSlice 를 부른다", async () => {
    const jobManager = {
      claim: () => Promise.resolve({ sessionId: 's-1', leaseToken: 't-1', phase: 'drafting' }),
      runParseSlice: jest.fn(),
      runValidateSlice: jest.fn(),
      runDraftSlice: jest.fn().mockResolvedValue(undefined),
      clearConsecutiveFailures: jest.fn(),
      recordJobError: jest.fn(),
    };
    const worker = new BulkSessionJobWorker(jobManager as never, { get: () => undefined } as never);

    await worker.tick();

    expect(jobManager.runDraftSlice).toHaveBeenCalledTimes(1);
    expect(jobManager.runValidateSlice).not.toHaveBeenCalled();
    expect(jobManager.runParseSlice).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts -t 'drafting'
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.worker.spec.ts
```
Expected: FAIL

- [ ] **Step 3: 구현한다**

`bulk-session-job.manager.ts`:

```ts
/** 한 틱에 draft 를 만들 행 수. publishVersion 만큼 무겁진 않지만 행마다 옵션·variant 되읽기가
 *  붙는다 — 검증 슬라이스(20)보다 작게 시작하고 실측으로 조정한다. */
export const DEFAULT_DRAFT_SLICE = 10;
```

`CLAIMABLE_PHASES` 를 넓힌다. **`recordJobError` 의 WHERE 가 이 배열을 쓰므로**(`:791`) 여기 안 넣으면 drafting 중 탈출 예외가 연속 실패로 세어지지 않고 조용히 사라진다:

```ts
const CLAIMABLE_PHASES: Array<'uploaded' | 'validating' | 'drafting'> = ['uploaded', 'validating', 'drafting'];
```

`claim()` 의 raw SQL 도 함께 넓힌다(`:184`):

```sql
            WHERE phase IN ('uploaded', 'validating', 'drafting')
```

`runDraftSlice`:

```ts
  /**
   * `status='pending'` 인 행을 슬라이스만큼 draft 로 만든다. 남은 행이 없으면 phase 를
   * drafted 로 민다.
   *
   * **행 하나가 트랜잭션 하나다.** 슬라이스를 통째로 감싸면 한 행의 22001 이 앞선 성공까지
   * 되돌린다. 행 단위로 끊으면 실패 격리가 공짜로 오고, draft 생성은 Kafka 이벤트를 내지
   * 않으므로(발행 때만 낸다) 롤백이 진짜 롤백이다 — v3 의 phantom masterId 가 구조적으로 없다.
   */
  async runDraftSlice(claimed: ClaimedBulkSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;

    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productBulkItems)
        .where(and(eq(productBulkItems.sessionId, sessionId), eq(productBulkItems.status, 'pending')))
        .orderBy(productBulkItems.rowNumber)
        .limit(this.draftSlice),
    );

    if (items.length === 0) {
      await this.finishDrafting(sessionId, leaseToken);
      return;
    }

    // 이미지 해석 결과는 행과 무관한 세션 전역 참조라 슬라이스당 한 번만 읽는다.
    const imageRows = await this.db.run((trx) =>
      trx
        .select({
          imageKey: productBulkImages.imageKey,
          usage: productBulkImages.usage,
          fileId: productBulkImages.fileId,
        })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId)),
    );

    const [session] = await this.db.run((trx) =>
      trx
        .select({ uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1),
    );
    if (!session) {
      this.logger.warn(`draft 를 만들 일괄 세션을 찾지 못했습니다 (session=${sessionId})`);
      return;
    }

    for (const item of items) {
      const lease = await this.renewLease(sessionId, leaseToken);
      if (!lease.owned) {
        this.logger.warn(`일괄 세션 lease 를 잃어 draft 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }
      if (lease.canceled) {
        this.logger.log(`일괄 세션이 취소돼 draft 슬라이스를 중단한다 (session=${sessionId})`);
        await this.releaseLease(sessionId, leaseToken);
        return;
      }

      await this.draftOne(sessionId, session.uploadedBy, item, imageResolverFrom(item, imageRows));
    }

    await this.releaseLease(sessionId, leaseToken);
  }
```

`draftOne` 은 행 하나를 자기 트랜잭션에서 처리하고, 실패는 **그 행에만** 적는다:

```ts
  private async draftOne(
    sessionId: string,
    userId: string,
    item: typeof productBulkItems.$inferSelect,
    images: ImageResolver,
  ): Promise<void> {
    // 되읽기 가드. 롤링 배포에서 옛 코드가 쓴 payload 를 만나면 그 행만 실패시킨다
    // (validateOne 의 isBulkItemInput 가드와 같은 이유).
    if (!isBulkItemPayload(item.payload)) {
      await this.failItem(item.id, '행 데이터 형식이 달라 처리할 수 없습니다. 파일을 다시 올려주세요.');
      return;
    }

    try {
      const result = await this.db.run((trx) =>
        this.applier.apply(
          {
            sessionId,
            userId,
            kind: item.kind,
            masterId: item.masterId,
            payload: item.payload,
            // 신규 행의 옵션 그룹 귀속은 원본 시트 행에서만 복원된다(Task 4 리뷰). 형식이 다르면
            // 빈 배열로 떨어뜨린다 — 그 행은 어차피 옵션 없는 상품으로 처리되고, 옵션을 참조하는
            // 조합이 있으면 checkCreateStructure 가 "없는 옵션값키"로 잡아 그 행만 실패시킨다.
            optionRows: isBulkItemInput(item.input) ? item.input.bundle.options : [],
            conflictDecision: toConflictDecisionMap(item.conflictDecision),
            baseSnapshot: isBulkBaseSnapshot(item.baseSnapshot) ? item.baseSnapshot : null,
            images,
          },
          trx,
        ),
      );

      await this.db.run((trx) =>
        trx
          .update(productBulkItems)
          .set({
            status: 'drafted',
            draftVersionId: result.draftVersionId,
            masterId: result.masterId,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(productBulkItems.id, item.id)),
      );
    } catch (error) {
      // 행 층 오류는 그 행만 죽인다(스펙 §3.12). 레인 층(슬라이스 밖 탈출)은 워커의
      // recordJobError 가 센다 — 여기서 삼키므로 draft 실패는 연속 실패 상한을 태우지 않는다.
      // 그것이 맞다: 1,000행 중 30행이 실패해도 세션은 계속 나아가야 한다.
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      await this.failItem(item.id, message);
    }
  }
```

`failItem` 은 `status:'failed'` + `errorMessage` 를 쓴다. **`errorMessage` 는 부록 A.8 이 지적한 대로 원문 예외 텍스트가 관리자 화면에 그대로 나가는 자리다** — 최소한 길이를 자른다:

```ts
  /** 오류 문구 상한. `error_message` 는 text 라 DB 제약은 아니지만, 스택이 통째로 실린 문자열이
   *  행 목록 API 에 그대로 나가는 것을 막는다(부록 A.8 인계). */
  private static readonly ERROR_MESSAGE_MAX = 500;
```

`finishDrafting` 은 `finishValidating`(`:693-706`)을 그대로 복제하되 `phase: 'drafted'` 다 — 토큰 CAS + `cancel_requested_at IS NULL` 가드를 **반드시** 함께 건다.

슬라이스 크기 getter 는 기존 `validateSlice`(`:158-160`)와 같은 모양으로 더한다:

```ts
  get draftSlice(): number {
    return this.positiveInt('PRODUCT_BULK_DRAFT_SLICE', DEFAULT_DRAFT_SLICE);
  }
```

`imageResolverFrom` 은 F11 의 두 근거를 합치는 모듈 레벨 순수 함수다:

```ts
/**
 * 이 행이 쓸 이미지 해석기. 근거가 둘이다(F11):
 *   ① 세션 이미지 행 — 이 행이 **바꾼** 참조. 3단계가 fileId 로 해석해 뒀다
 *   ② base_snapshot.images — 수정 행이 **손대지 않은** 프리필 참조. 2단계 resolveImageRefs 가
 *      이런 참조를 refs 에 담지 않으므로 세션 이미지 행에도 없다
 * ①이 없을 때만 ②로 떨어진다 — 순서가 바뀌면 작업자가 방금 올린 새 파일 대신 옛 파일이 굳는다.
 */
function imageResolverFrom(
  item: typeof productBulkItems.$inferSelect,
  imageRows: Array<{ imageKey: string; usage: string; fileId: string | null }>,
): ImageResolver {
  const byKeyUsage = new Map<string, string>();
  for (const row of imageRows) {
    if (row.fileId) byKeyUsage.set(`${row.usage}:${row.imageKey}`, row.fileId);
  }
  const prefilled = isBulkBaseSnapshot(item.baseSnapshot) ? (item.baseSnapshot.images ?? {}) : {};

  return {
    fileIdFor: (imageKey, usage) => byKeyUsage.get(`${usage}:${imageKey}`) ?? prefilled[imageKey],
  };
}
```

`bulk-session-job.worker.ts:46-47`:

```ts
      if (claimed.phase === 'uploaded') await this.jobManager.runParseSlice(claimed);
      else if (claimed.phase === 'drafting') await this.jobManager.runDraftSlice(claimed);
      else await this.jobManager.runValidateSlice(claimed);
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.manager.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.worker.spec.ts
npm run type-check:scoped
```
Expected: 새 케이스 PASS + 기존 케이스 회귀 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-job.*
git commit -m "feat(bulk-session): drafting 레인 — 행 단위 트랜잭션 + 실패 격리"
```

---

## Task 9: 취소가 잠금을 푼다 + 행 목록에 `draftVersionId` 노출

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts:378-402` (`cancel`)
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.ts:51-63` (`bulkItemRowColumns`), `toItemDto`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/dto/bulk-session-response.dto.ts:89-98`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts`, `bulk-session.reader.spec.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
  // bulk-session.manager.spec.ts — 파일의 기존 하네스가 update() 호출을 모으는 방식을 그대로 쓴다.
  it('취소는 이 세션이 잠근 draft 의 bulk_session_id 를 NULL 로 되돌린다', async () => {
    await manager.cancel(SESSION_ID, USER_ID);

    // 같은 트랜잭션 안에서 두 번째 UPDATE 가 나가야 한다. 별도 트랜잭션으로 빼면 취소는
    // 됐는데 잠금이 남는 상태가 생기고, 그 draft 는 발행도 삭제도 못 하는 미아가 된다.
    const unlock = updates.find((u) => u.table === 'product_master_versions');
    expect(unlock).toBeDefined();
    expect(unlock?.set).toEqual(expect.objectContaining({ bulkSessionId: null }));
  });

  it('취소 CAS 가 0행이면 잠금을 풀지 않는다', async () => {
    // phase 가 그 사이 published 로 바뀌어 CAS 가 지면 ConflictError 로 끝나고, 잠금 UPDATE 는
    // 나가지 않아야 한다 — 발행된 세션의 draft 잠금을 푸는 것은 명백히 틀렸다.
    casReturnsEmpty = true;

    await expect(manager.cancel(SESSION_ID, USER_ID)).rejects.toThrow();
    expect(updates.find((u) => u.table === 'product_master_versions')).toBeUndefined();
  });

  // bulk-session.reader.spec.ts
  it('행 목록이 draftVersionId 를 내려준다', async () => {
    rows = [{ ...baseRow, draftVersionId: 'draft-1', status: 'drafted' }];

    const result = await reader.getItems(SESSION_ID, USER_ID, undefined);

    expect(result.data[0].draftVersionId).toBe('draft-1');
  });
```

`updates`/`rows`/`casReturnsEmpty` 는 각 스펙 파일의 **기존** 하네스 변수다 — 이름이 다르면 그 파일의 이름을 쓴다. 새 하네스를 만들지 않는다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts -t '취소는 이 세션이'
```
Expected: FAIL

- [ ] **Step 3: 구현한다**

`cancel()` 의 phase CAS 가 성공한 **뒤**, 같은 트랜잭션에서:

```ts
      // 잠금을 푼다. draft 자체는 남긴다 — 수천 건 세션에서 작업 결과가 통째로 날아가는 건
      // 취소의 대가로 너무 크다(스펙 §3.12). 풀린 draft 는 draftOwnerId 가 업로더이므로
      // 자연스럽게 본인 draft 가 되어 my-drafts 에 다시 나타난다.
      await trx
        .update(productMasterVersions)
        .set({ bulkSessionId: null, updatedAt: new Date() })
        .where(eq(productMasterVersions.bulkSessionId, sessionId));
```

행 목록: `bulkItemRowColumns` 에 `draftVersionId: productBulkItems.draftVersionId` 를 더하고, `BulkItemRow` Pick 유니언과 `BulkSessionItemDto` 에 같은 필드를 더한 뒤 `toItemDto` 가 그대로 싣는다.

```ts
  @ApiProperty({ required: false, nullable: true, description: '생성된 draft 버전. 이 id 로 통상의 draft 편집 화면을 연다' })
  draftVersionId: string | null;
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.reader.spec.ts
npm run type-check:scoped
```
Expected: 새 케이스 PASS + 회귀 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/
git commit -m "feat(bulk-session): 취소가 draft 잠금을 해제 + 행 목록에 draftVersionId"
```

---

## Task 10: 모듈 배선

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts`
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts`

- [ ] **Step 1: DI 스모크에 새 provider 를 더한다**

`bulk-session.module.spec.ts` 의 기존 케이스 옆에:

```ts
  it('BulkDraftApplier 를 해석한다', async () => {
    // 타입체크는 provider export 누락을 못 잡는다 — DI 는 런타임 리플렉션이다.
    // BulkDraftApplier 는 ProductMastersService·ProductVersionsService·ProductVariantsService·
    // OptionReadLoader·PricingService·ProductPurchaseConstraintsService 여섯을 주입받는데,
    // 앞의 넷은 ProductsModule 이, PricingService 는 PricingModule 이 export 한다
    // (products.module.ts:41-56, pricing.module.ts:12) — 실측으로 확인된 사실이지만
    // 그 export 목록이 바뀌면 이 스모크가 먼저 빨개져야 한다.
    expect(moduleRef.get(BulkDraftApplier, { strict: false })).toBeDefined();
  });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage4_scratch" \
  npx jest apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts
```
Expected: FAIL — provider 미등록

(scratch DB 가 아직 없으면 Task 11 Step 1 을 먼저 돌린다.)

- [ ] **Step 3: provider 를 등록한다**

`bulk-session.module.ts` 의 `providers` 배열에 `BulkDraftApplier` 를 더하고, 파일 상단 주석 관례대로 **왜** 등록하는지 한 줄 남긴다:

```ts
// BulkDraftApplier 는 4단계 draft 생성 경로다. catalog core 의 쓰기 서비스 여섯을 주입받아
// 조립만 하므로 자체 DB 접근은 잠금 UPDATE 한 문장뿐이다.
```

- [ ] **Step 4: 통과를 확인한다**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage4_scratch" \
  npx jest apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.spec.ts
```
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module*
git commit -m "feat(bulk-session): BulkDraftApplier 모듈 등록 + DI 스모크"
```

---

## Task 11: 통합 테스트 (실 Postgres)

이 스위트가 이 단계의 **핵심 주장**을 못 박는다: 작업자가 A필드를, 남이 B필드를 바꿨을 때 생성된 draft 안에 **둘 다 살아있는가**. 스펙 §3.6 의 포크-후-적용 설계 전체가 이 한 줄에 걸려 있다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-draft.integration.spec.ts`
- Modify: `package.json:74` (`test:bulk-session:integration` 목록에 추가)

- [ ] **Step 1: scratch DB 를 만든다**

```bash
docker exec almondyoung-server-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS bulk_stage4_scratch"
docker exec almondyoung-server-postgres-1 psql -U postgres -c "CREATE DATABASE bulk_stage4_scratch"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage4_scratch" \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts
```
Expected: Task 1 의 마이그레이션을 포함해 전부 적용, 에러 없음. **`dev_core` 를 쓰지 않는다.**

- [ ] **Step 2: 통합 스펙을 쓴다**

2·3단계 스위트와 달리 이 스위트는 **`Test.createTestingModule` 로 `CatalogModule` 을 띄운다** — 검증 대상이 catalog core 의 실제 쓰기 경로(포크·CoW·가격 replace)이기 때문이다. 선례는 `bulk-session.module.spec.ts` 다: 같은 `jest.mock('@packages/event-contracts', …, { virtual: true })` 우회와 `KAFKA_BOOTSTRAP_TOPICS=false` 를 그대로 쓴다. `.compile()` 은 `onModuleInit` 을 부르지 않으므로 `@Cron` 워커·스윕은 뜨지 않는다(모듈 스펙 주석에 근거가 적혀 있다).

**격리**: 이 스위트는 임시 스키마를 쓰지 않는다. `LIKE` 복제로는 20개 가까운 catalog 테이블의 FK 그래프를 재현할 수 없고, 재현하려다 손으로 옮겨 적으면 스키마가 갈라진다. 대신 **전용 scratch DB 의 public** 에 직접 쓰고, `afterAll` 에서 이 스위트가 만든 master 를 지운다. `dev_core` 를 쓰지 않는 것이 격리의 전부다 — 그래서 Step 1 의 DB 이름을 절대 바꾸지 않는다.

케이스:

```ts
  /**
   * 이 단계의 핵심 주장. 스펙 §3.6 의 포크-후-적용 설계 전체가 이 한 케이스에 걸려 있다 —
   * 스냅샷에서 포크하도록 회귀하면 여기서만 빨개진다(단위 테스트는 페이크라 못 잡는다).
   */
  it('작업자가 판매가를, 남이 브랜드를 바꿨을 때 draft 에 둘 다 살아있다', async () => {
    // ① active 상품 하나 (브랜드 ACME, 판매가 10000)
    const { masterId, versionId } = await seedActiveProduct({ brand: 'ACME', basePrice: 10000 });

    // ② 그 시점 스냅샷으로 세션 아이템 하나 — 작업자는 판매가만 고쳤다
    const sessionId = await seedSession({
      phase: 'drafting',
      items: [
        {
          rowNumber: 1,
          kind: 'update',
          masterId,
          baseVersionId: versionId,
          baseSnapshot: await renderSnapshot(masterId),
          payload: { fields: { 'product.basePrice': '12000' } },
          status: 'pending',
        },
      ],
    });

    // ③ 그 사이 남이 브랜드만 바꿔 새 active 를 발행한다
    const otherDraft = await versionsService.createDraftVersion(versionId, OTHER_USER, true);
    await mastersService.updateVersion(otherDraft.id, { brand: 'BETA' });
    await versionsService.publishVersion(otherDraft.id);

    // ④ drafting 레인
    await jobManager.runDraftSlice({ sessionId, leaseToken: await leaseFor(sessionId), phase: 'drafting' });

    // ⑤ 둘 다 살아있어야 한다
    const [item] = await db.run((trx) =>
      trx.select().from(productBulkItems).where(eq(productBulkItems.sessionId, sessionId)),
    );
    expect(item.status).toBe('drafted');

    const [draft] = await db.run((trx) =>
      trx.select().from(productMasterVersions).where(eq(productMasterVersions.id, item.draftVersionId!)),
    );
    expect(draft.brand).toBe('BETA'); // 남의 변경이 살아남았다
    const rules = await pricingService.getVersionRules(draft.id);
    expect(rules.basePriceRules[0].operationValue).toBe(12000); // 내 변경도 적용됐다
  });

  it('세션이 잠근 draft 는 개별 발행이 409 다', async () => {
    const draftVersionId = await draftOneRow();

    await expect(versionsService.publishVersion(draftVersionId)).rejects.toThrow('일괄 등록 세션');
  });

  it('세션이 잠근 draft 는 my-drafts 에 나오지 않는다', async () => {
    const draftVersionId = await draftOneRow();

    const list = await versionsService.getMyDraftVersions(UPLOADER_ID, { page: 1, limit: 50 });
    expect(list.data.map((d) => d.versionId)).not.toContain(draftVersionId);
  });

  it('취소하면 잠금이 풀려 my-drafts 에 다시 나온다', async () => {
    const draftVersionId = await draftOneRow();

    await sessionManager.cancel(currentSessionId, UPLOADER_ID);

    const list = await versionsService.getMyDraftVersions(UPLOADER_ID, { page: 1, limit: 50 });
    expect(list.data.map((d) => d.versionId)).toContain(draftVersionId);
  });

  it('수정 행의 variantCode 변경이 active variant 를 건드리지 않는다', async () => {
    // ADR-0004 의 CoW 가 실제로 도는지 본다. v3 방식(productVariants 직접 UPDATE)으로 회귀하면
    // active 의 variantCode 가 함께 바뀌어 여기서 빨개진다.
    const { masterId, versionId, variantId } = await seedActiveProduct({ variantCode: 'OLD' });
    const sessionId = await seedSession({
      phase: 'drafting',
      items: [
        {
          rowNumber: 1,
          kind: 'update',
          masterId,
          baseVersionId: versionId,
          baseSnapshot: await renderSnapshot(masterId),
          payload: { fields: { 'variant:.variantCode': 'NEW' } },
          status: 'pending',
        },
      ],
    });

    await jobManager.runDraftSlice({ sessionId, leaseToken: await leaseFor(sessionId), phase: 'drafting' });

    const [activeVariant] = await db.run((trx) =>
      trx.select().from(productVariants).where(eq(productVariants.id, variantId)),
    );
    expect(activeVariant.variantCode).toBe('OLD');
  });

  it('한 행이 실패해도 나머지 행이 draft 를 얻는다', async () => {
    // 2단계 검증기를 우회해 payload 를 직접 심는다 — 여기서 보려는 것은 "행 층 오류가 슬라이스를
    // 죽이지 않는가"이지 검증기의 커버리지가 아니다. 가운데 행의 name 을 varchar(255) 초과로
    // 두면 Postgres 22001 이 그 행의 트랜잭션에서만 난다.
    const sessionId = await seedSession({
      phase: 'drafting',
      items: [
        createRow(1, { 'product.name': 'A', 'product.basePrice': '1000' }),
        createRow(2, { 'product.name': 'X'.repeat(300), 'product.basePrice': '1000' }),
        createRow(3, { 'product.name': 'C', 'product.basePrice': '1000' }),
      ],
    });

    await jobManager.runDraftSlice({ sessionId, leaseToken: await leaseFor(sessionId), phase: 'drafting' });

    const items = await db.run((trx) =>
      trx
        .select()
        .from(productBulkItems)
        .where(eq(productBulkItems.sessionId, sessionId))
        .orderBy(productBulkItems.rowNumber),
    );
    expect(items.map((i) => i.status)).toEqual(['drafted', 'failed', 'drafted']);
    expect(items[1].errorMessage).toBeTruthy();
  });
```

`seedActiveProduct`·`seedSession`·`renderSnapshot`·`leaseFor`·`draftOneRow`·`createRow` 는 이 스펙 안의 헬퍼다. `seedActiveProduct` 는 **서비스로** 만든다(`createMaster` → `updateVersion` → `replaceVersionRules` → `publishVersion`) — INSERT 를 손으로 적으면 실제 쓰기 경로가 만드는 행 모양과 갈라져 테스트가 거짓 초록이 된다.

- [ ] **Step 3: package.json 에 등록한다**

`test:bulk-session:integration` 의 파일 목록 끝에 새 스펙 경로를 더한다(`--runInBand` 는 그대로).

- [ ] **Step 4: 통합 테스트를 돌린다**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage4_scratch" \
  npm run test:bulk-session:integration
```
Expected: 4단계 스위트 전 케이스 PASS + 2·3단계 세 스위트도 그대로 PASS (회귀 없음).

**증거를 남긴다** — 이 명령의 출력(스위트별 통과 수)을 커밋 메시지나 작업 노트에 붙인다. "돌렸다"는 주장만으로는 완료가 아니다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session-draft.integration.spec.ts package.json
git commit -m "test(bulk-session): 4단계 병합·잠금·CoW·실패격리 통합 테스트"
```

---

## Task 12: 최종 게이트

- [ ] **Step 1: 변경 파일 기준 lint**

```bash
npx eslint $(git diff --name-only develop -- '*.ts' | tr '\n' ' ')
```
Expected: 이 브랜치가 새로 만든 error 0건. **레포 전역 `npm run lint` 는 상시 debt 이므로 권위가 아니다** — 변경 파일 차분으로만 본다.

- [ ] **Step 2: 타입 게이트 + 단위 스위트**

```bash
npm run type-check:scoped
npx jest apps/core/src/modules/catalog/operations/bulk-session apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts
```
Expected: exit 0 / 전 케이스 PASS

- [ ] **Step 3: 마이그레이션이 정확히 1건인지 확인한다**

```bash
git diff --stat develop -- apps/core/drizzle/
```
Expected: 새 `.sql` 파일 **1개** + `meta/` 갱신. 2개 이상이면 스키마를 계획 밖에서 건드린 것이다 — 멈추고 보고한다.

- [ ] **Step 4: 통합 스위트 재실행 (회귀 확인)**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage4_scratch" npm run test:bulk-session:integration
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bulk_stage4_scratch" npm run test:form-export:integration
```
Expected: 전부 PASS. **각 명령의 실제 출력을 확인하고 기록한다** — 하나라도 못 돌렸으면 그 사실을 그대로 보고한다.

- [ ] **Step 5: 스펙에 부록을 더한다**

`docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` 끝에 **부록 C — 4단계 구현이 실측한 사실**을 더한다. 부록 A·B 와 같은 형식이며, 최소한 다음을 담는다:

- F4(옵션 표시명 truthiness)와 그 결정
- F6(variant CoW 필수)과 순서 규약 — 5단계가 발행에서 variant 를 만질 때 다시 만난다
- F7(신규 행 조합키 ↔ variantId 를 이름으로 잇는다)과 표시명 중복 금지의 이유
- F8(신규 행 구조 검증이 없던 갭)을 4단계가 닫았다는 사실
- F9(가격은 재조립, `pricingEditable=false` 면 replace 를 부르지 않는다)
- 아래 "알려진 갭" 전량

```bash
git add docs/superpowers/specs/2026-07-31-product-bulk-session-design.md
git commit -m "docs(spec): 부록 C — 4단계 구현이 실측한 사실"
```

---

## 알려진 갭 (5단계가 받는다)

- **실패 행 탈출구가 없다.** `drafted` 에서 실패 행을 재시도하는 경로가 이 단계에 없다 — 스모크 중 행이 죽으면 취소 후 재업로드가 유일한 길이다. 스펙 §3.12 의 두 재시도 지점(생성 실패·발행 실패)을 5단계가 **한 쌍으로** 만든다. 이 결정의 근거: 라우트 shape·잠금 해제 규약·취소와의 상호작용을 두 번 열지 않기 위해서다 (사용자 판단, 2026-08-02).
- **`excluded` 전이가 없다.** 발행이 없는 단계에서 제외는 관측 가능한 효과가 없다. 5단계 몫.
- **`variantCode` 전역 중복을 업로드 시점에 못 잡는다.** 2단계 검증기는 길이만 본다. 중복은 발행 시점 `_validateVariantCodeUniqueness`(`product-versions.service.ts:287`)에서 그 행만 실패한다 — `productCode` 와 같은 성질이다(스펙 §5.2). v3 의 `ProductImportVariantCodeChecker` 에 해당하는 사전 검사는 이식하지 않았다.
- **수정 행에서 카테고리를 전부 해제할 수 없다.** 카테고리 행을 지우는 것은 "변경 없음"이므로(`bulk-session.fields.ts:76-81`) 해제를 표현할 방법이 없다. 스펙 §3.4 의 행 삭제 규약이 만든 구조적 한계다.
- **`errorMessage` 는 여전히 예외 원문이다.** 길이만 잘랐다. 분류는 부록 A.8 이 남긴 후속 그대로다.
- **세션 원본 워크북(`source_file_id`)을 아무도 지우지 않는다** (부록 B.7). 5단계 정리 경로 몫.
- **`applyUpdate` 가 행마다 옵션·variant 를 되읽는다.** 1,000행 세션에서 상품당 몇 번의 왕복이 붙는다. 슬라이스 10 으로 시작해 실측 후 `PRODUCT_BULK_DRAFT_SLICE` 로 조정한다.

## 배포 선행조건

- 마이그레이션 1건, **additive** → ADR-0005 §5 **expand phase = `migrate` → `deploy`** 순서. 순서를 뒤집으면 새 코드가 없는 컬럼을 읽는다.
- 배포는 core 만 (admin-web 변경 0건).
- 신규 시크릿 없음.
- 킬스위치는 3단계와 공유한다 — `PRODUCT_BULK_SESSION_WORKER_ENABLED=false` 면 drafting 레인도 함께 멈춘다(같은 워커다).
- 새 튜닝 env: `PRODUCT_BULK_DRAFT_SLICE`(기본 10). 이름을 틀리면 조용히 기본값이 쓰인다 — `positiveInt` 가 파싱 실패를 fallback 으로 흡수한다(`bulk-session-job.manager.ts:149-152`).
