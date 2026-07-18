# 판매상품 대량등록(엑셀 임포트) 재설계 — 설계

- 날짜: 2026-07-10
- 대상: `apps/core` (catalog operations) — 신규 import 모듈 + 기존 CSV 모듈 제거
- 브랜치: `feat/product-bulk-import-redesign`

## 1. 배경 / 문제

현재 Core의 "대량등록"은 `catalog/operations/csv/` 의 **CSV 임포트** 경로 하나뿐이며, 이것이 canonical 단건 등록 경로를 **우회**하기 때문에 "제대로 된 판매상품"을 만들지 못한다.

### 현재 구조 (근거 파일)

**현재 CSV 대량등록 (제거 대상)**
- 컨트롤러: `apps/core/src/modules/catalog/operations/csv/product-csv.controller.ts` (`POST /products/csv/bulk-import`, `GET /products/csv/template`, `GET /products/csv/export`)
- 서비스: `apps/core/src/modules/catalog/operations/csv/product-csv.service.ts`
- 모듈: `apps/core/src/modules/catalog/operations/csv/csv.module.ts` (`CatalogModule` 에 등록: `catalog.module.ts:17,42`)

**canonical 단건 등록 (재사용 대상)**
- `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts`
  - `createMaster(ownerId, tx?)` (:179) — 빈 draft master + version 1 + 기본 variant + 매핑 + WMS variant-created 이벤트
  - `updateVersion(versionId, data, tx?)` (:806) — 스칼라 필드 + `categoryIds`/`primaryCategoryId` + `optionDiff`(옵션→variant 조합 생성) + 이미지 필드. **draft 상태에서만 수정 가능**
- `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts`
  - `publishVersion(versionId, tx?)` (:256) — draft/inactive → active, 검증(가격·variantCode 충돌·디지털 자산) 후 `ProductMasterActiveVersionChanged` 이벤트 발행 → Medusa·검색·analytics 동기화
- 입력 타입: `apps/core/src/modules/catalog/catalog.types.ts` — `UpdateProductMasterVersion` (:66), `OptionDiff` (:119, `add: [{displayName, values:[{displayName}]}]`)
- 스키마: `apps/core/src/modules/catalog/schema/catalog.schema.ts` — `productMasters` (:97, 컬럼은 `id/createdAt/createdBy/deletedAt/deletedBy` 5개뿐), `productMasterVersions` (:119, 모든 상품 필드), `productCategories` (:53, `name` 비유니크·`slug` 유니크·`parentId`/`path` 계층), `productVariants` (`variantCode` 보유, 가격 없음)

**참고할 선례 (레포 내 컨벤션)**
- 세션 그룹핑: inventory `stocktakingSessions` (`inventory.schema.ts:1723`)
- 잡+상태 조회: inventory `TransferJobStatus` (`transfer.service.ts:374`)
- 엑셀 파싱: `exceljs@^4.4.0` 이미 `package.json` 의존성

### 핵심 제약 (반드시 준수)

1. **현재 CSV 임포트는 canonical 경로를 우회한다.** `createMaster` 의 기본 variant·매핑·이벤트를 건너뛰고, 카테고리/옵션/variant/이미지를 못 넣고, 스칼라 필드만 `draft` 로 직접 insert 한다. 그 결과 노출도 안 되고 불변식도 깨진다.
2. **부수 부채.** `basePrice` 는 스키마에 없는 유령 필드인데 CSV 템플릿·export·`BulkUpdateDto` 가 참조한다. `exportProducts` 는 `productMasters` 에서 version 컬럼(`name`/`brand`/`productType` 등)을 조회해 **깨져 있다**. 서비스가 Reader/Manager 없이 직접 `db.transaction()` + `as any` 캐스팅, 컨트롤러가 수동 try/catch 로 `HttpException` 매핑 — 전부 CLAUDE.md 레이어 규약 위반.
3. **publish 는 단순 status write 가 아니다.** `ProductMasterActiveVersionChanged` outbox 이벤트로 Medusa·검색·analytics 를 동기화한다. 대량등록도 이 경로를 타야 노출이 정상 동작한다.

## 2. 목표 / 비목표

**목표 (v1)**
- 내부 운영자(MD/상품팀)가 공급사 엑셀을 받아 **풀상품**(version 스칼라 필드 + 카테고리 + 옵션→variant)을 한 번에 등록.
- 멀티시트 엑셀 워크북(Products/Options) → 서버가 내부 batch 모델로 정규화 → 검증 → 커밋.
- **동기 2단계**: `validate`(무상태 프리뷰) → `commit`(세션 + 행별 create 루프, 전부 `draft`).
- 등록 결과를 **import 세션**으로 묶어, 성공/실패 상품 전체를 한 화면 리스트로 리뷰하고 **세션 단위 일괄 publish**.
- 대량등록 로직은 canonical `createMaster` + `updateVersion` 을 **그대로 호출**(bulk == single 정합성 보장).
- 기존 CSV 모듈 **통째 제거**.

**비목표 (v1)**
- **이미지**: v1 제외. Images 시트/필드는 후속. 등록 후 기존 단건 UI 로 보완.
- **명시적 variant 모델**: 시트에서 variant당 SKU 직접 지정은 후속(v1.1). v1 은 옵션 선언 → variant 자동생성, `variantCode` 자동/공란.
- **CSV export**: CSV 모듈과 함께 제거. 필요 시 후속에 엑셀 export 로 재구현.
- **멱등/중복 방지**: 같은 파일 2회 commit = 상품 2벌(세션 2개). 크로스-임포트 dedup 없음.
- **비동기 워커**: 수십~수백 건 규모 → 불필요.
- **카테고리 생성**: 임포트는 카테고리를 만들지 않음(사전 존재 필수).
- **BulkModule 개편**: update/delete/restore/policy 는 대량등록과 별개 → 그대로 둠.

## 3. 결정 요약

| 항목 | 결정 |
|------|------|
| 구현 접근 | **A. 얇은 오케스트레이터** — canonical `createMaster`+`updateVersion` 재사용 |
| 입력 포맷 | 멀티시트 엑셀 워크북(Products/Options), `exceljs` 파싱 |
| 등록 깊이 | 스칼라 필드 + 카테고리 + 옵션→variant (이미지 제외) |
| 두 번째 시트 모델 | **옵션 선언 모델** — variant 자동생성 |
| 카테고리 입력키 | `categoryPath`(이름 경로) 기본, `slug` 허용 |
| 최종 상태 | 전부 `draft` → 세션 리뷰 → 세션 단위 일괄 publish |
| validate | **무상태**(DB 쓰기 0), 세션은 commit 시 생성 |
| 처리 모델 | 동기 2단계, **행별 독립 트랜잭션**(부분 성공 즉시 영속) |
| 상한 | 행 수 1,000 / 상품당 variant 조합 100 |
| CSV 모듈 | 통째 제거(export 포함) |

## 4. 아키텍처 & 모듈 구조

`catalog/operations/import/` 신규 모듈 (레이어 규약 준수):

```
catalog/operations/import/
  product-import.module.ts
  product-import.controller.ts        # HTTP 경계, DTO 검증, try/catch 없음(글로벌 필터 위임)
  services/
    product-import.service.ts         # 포트: 2~3줄 흐름만 (validate / commit / publishSession)
    product-import.parser.ts          # exceljs 워크북 → 원시 시트 행 (I/O)
    product-import.normalizer.ts      # 원시 행 → 내부 batch 모델 (카테고리명→id 해석 포함)
    product-import.validator.ts       # 행별 구조+비즈니스 검증 → {valid, invalid}
    product-import.manager.ts         # 커밋: createMaster+updateVersion 루프 + 세션 기록
    product-import-session.reader.ts  # 세션/아이템 조회
  dto/ ...
```

- **Controller → Service → (Parser/Normalizer/Validator/Manager/Reader) → 기존 `ProductMastersService`.** Manager 는 상품을 직접 insert 하지 않고 canonical 서비스를 호출한다.
- Service 는 도메인 예외(`@app/shared` 의 `BadRequestError` 등)만 throw, `DbService.run(tx)` 단일 러너 사용. Controller 는 try/catch 없이 위임.
- `ProductImportModule` 은 `ProductsModule`(createMaster/updateVersion/publishVersion 제공) 을 import, `CatalogModule` 에 등록.

## 5. 데이터 모델 — 신규 테이블 2개 (`catalog.schema.ts`)

`stocktakingSessions` 네이밍/컬럼 컨벤션을 따름. 전부 **additive**(신규 테이블/nullable FK) → 코드와 같은 PR 가능.

**`product_import_sessions`** — 임포트 한 건
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `file_name` | varchar | 업로드 원본 파일명 |
| `uploaded_by` | uuid | 작업자 |
| `total_rows` | int | 시도한 상품 행 수 |
| `created_count` | int | 성공 생성 수 |
| `failed_count` | int | 실패 수 |
| `status` | enum(`completed`,`archived`) | commit 종료 시 `completed` |
| `created_at` / `committed_at` | timestamp | |

**`product_import_items`** — 세션 내 행별 결과(성공·실패 **모두** 기록 = 한 화면 리스트의 원천)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `session_id` | uuid FK → sessions | |
| `row_number` | int | 엑셀 행 번호(에러 리포트용) |
| `product_key` | varchar | 워크북 내 임시 상품 key |
| `status` | enum(`created`,`failed`) | |
| `master_id` | uuid null (FK → product_masters) | 성공 시 |
| `error_message` | text null | 실패 사유 |

마이그레이션: `npm run db:generate:core -- --name add-product-import-session` → 생성 SQL 리뷰 → `schema.ts` + `drizzle/*.sql` + `drizzle/meta/` 단일 커밋.

## 6. 엑셀 워크북 포맷 & 정규화

### 시트 구성 (v1: 2개 시트)

| 시트 | 역할 |
|------|------|
| **Products** | 상품당 1행. 스칼라 필드 + 카테고리 + `productKey` |
| **Options** | 옵션당 1행. `productKey` 로 연결, 옵션그룹+값 선언 |

### Products 시트 컬럼 (→ version 스칼라 필드)
- 필수: `productKey`(임시 키), `name`
- 선택: `productCode`, `brand`, `alternativeName`, `description`, `material`, `marketPrice`, `supplyPrice`, `productType`(regular_sale/limited_edition), `fulfillmentKind`(physical/digital), `salesClassification`, `purchaseClassification`, `ageRestriction`, `minQuantity`, `maxQuantity`, `seller`, `categoryPath`(예: `여성패션>니트`), `isOverseas`, `isVisibleToMembersOnly`, `hideMembershipPriceForNonMembers`
- `basePrice` 폐기(스키마에 없음). 가격은 `marketPrice`/`supplyPrice` 만.

### Options 시트 컬럼
- `productKey`, `optionName`(예: 색상), `optionValues`(구분자 리스트, 예: `빨강|파랑|검정`), `sortOrder`(선택)
- 한 상품에 여러 옵션그룹 = 여러 행. Options 에 productKey 가 없으면 옵션 없는 기본 variant 1개.

### 정규화 규칙 (`normalizer`)
1. **카테고리 해석**: 전체 카테고리 트리 1회 로드 → `categoryPath`(이름 경로)를 부모체인 따라 leaf `categoryId` 로 해석. 사전 존재 필수. 미해석/모호(동명 형제) → 행 에러. `slug` 정확 매칭도 허용. 빈 값은 허용(카테고리 없는 상품).
2. **옵션→variant**: Options 행들을 `optionDiff.add: [{displayName, values:[{displayName}]}]` 로 변환 → `updateVersion` 이 조합 생성.
3. **타입 강제/기본값**: 숫자 `Number()` 강제(NaN·음수 → 에러), enum 은 정의된 값만, 누락 시 스키마 기본값(productType=regular_sale, fulfillmentKind=physical, ageRestriction=0, minQuantity=1). boolean 은 `Y/N/true/false/1/0`.
4. **productKey 링크**: Options 행의 productKey 가 Products 에 없으면 에러. 파일 내 중복 productKey → 에러.

### 공유 내부 모델 (validate·commit 동일 사용)
```ts
NormalizedProduct = {
  rowNumber, productKey,
  version: { name, brand, marketPrice, ... },        // updateVersion 스칼라
  categoryIds: string[], primaryCategoryId,
  optionDiff: { add: [{ displayName, values }] },
}
```
commit 은 레코드마다 `createMaster(userId)` → `updateVersion(versionId, {...version, categoryIds, primaryCategoryId, optionDiff})` (전부 draft).

## 7. API 엔드포인트 & 흐름

`ProductImportController`, base `/product-imports`:

| 메서드 | 경로 | 역할 |
|--------|------|------|
| `GET` | `/product-imports/template` | 엑셀 템플릿 워크북 다운로드(Products/Options + 헤더 + 예시행), exceljs 생성 |
| `POST` | `/product-imports/validate` | 워크북 업로드 → 파싱·정규화·검증 → **프리뷰 반환, DB 쓰기 0** |
| `POST` | `/product-imports/commit` | 같은 워크북 업로드 → 재검증 후 **세션+아이템 생성 + create 루프(전부 draft)** |
| `GET` | `/product-imports` | 세션 목록(페이지네이션) |
| `GET` | `/product-imports/:sessionId` | 세션 상세 = 성공+실패 아이템 전체 리스트 |
| `POST` | `/product-imports/:sessionId/publish` | 세션 내 draft 일괄 publish(best-effort) |
| `POST` | `/product-imports/:sessionId/archive` | 세션 아카이브(선택) |

- `@User()` 로 `userId` → `uploadedBy`/`createdBy`. 파일 업로드는 `FileInterceptor('file')` + `@UploadedFile()`. 응답 DTO 는 중첩 DTO 클래스로 정의(`@ApiProperty({type:'object'})` 금지).

**validate 응답 (프리뷰)**
```ts
{
  totalRows, validCount, invalidCount,
  rows: [
    { rowNumber, productKey, status: 'valid'|'invalid',
      errors: string[],
      resolved: { name, categoryNames: string[], variantCount } }
  ]
}
```

**commit 응답 (세션 결과)**
```ts
{
  sessionId, createdCount, failedCount,
  items: [ { rowNumber, productKey, status: 'created'|'failed', masterId?, errorMessage? } ]
}
```

**운영자 흐름 (동기 2단계)**
1. 템플릿 다운로드 → 공급사 데이터 채움
2. `validate` → 프리뷰 에러 확인 → 파일 수정 → 재검증
3. `commit` → 세션 생성, draft 상품 생성, `sessionId` 반환 (validate 이후 무효가 된 행은 `failed` 아이템으로 흡수)
4. `GET /:sessionId` → 성공/실패 한 화면 리뷰
5. `publish` → 세션 draft 일괄 게시 → `ProductMasterActiveVersionChanged` 이벤트 → Medusa·검색·analytics 동기화(**여기서 비로소 노출**)

## 8. 검증 규칙 & 에러 처리

### 2계층 검증

**① 워크북 레벨 (치명적 — 도메인 예외 → 400, 아무것도 생성 안 됨)**
- 유효한 xlsx 아님 / 파싱 실패
- Products 시트 없음 / 필수 헤더 누락 / Products 0행
- **행 수 상한(1,000) 초과** → 파일 분할 안내

**② 행 레벨 (best-effort — 수집만, throw 안 함)**

Products 행: `productKey` 필수+파일 내 유니크, `name` 필수, 숫자 파싱/음수·범위(ageRestriction 0–100, quantity ≥1, maxQuantity ≥ minQuantity), enum(productType/fulfillmentKind), boolean 파싱, `categoryPath` 해석(빈 값 허용).

Options 행: 존재하는 `productKey` 참조, `optionName` 필수, `optionValues` 비어있지 않음, 그룹 내 값 중복 금지, 상품 내 optionName 중복 금지, **variant 조합 상한(100) 초과** 금지.

에러 귀속: `{sheet, rowNumber, message}`. 한 상품의 유효성은 그 상품의 Options 행에도 의존 → Options 행이 무효면 그 상품 레코드 전체가 invalid(에러가 문제의 Options 행번호를 가리킴). 검증은 상품 단위 집계.

### commit — 행별 독립 트랜잭션 (부분 성공 즉시 영속)

세션을 먼저 생성한 뒤, 상품마다 독립 트랜잭션:
```ts
try {
  await db.run(async (trx) => {
    const version = await productMastersService.createMaster(userId, trx);
    await productMastersService.updateVersion(version.id, normalized, trx);   // 필드+카테고리+optionDiff(→variant)
    await trx.insert(productImportItems).values({ sessionId, status: 'created', masterId: version.masterId, ... });
  });
  createdCount++;
} catch (e) {
  await db.run((trx) => trx.insert(productImportItems).values({ sessionId, status: 'failed', errorMessage: e.message, ... }));
  failedCount++;
}
// 종료 후 세션 counts 갱신
```
- 한 상품 실패 = 그 행 tx 만 롤백(orphan master 없음), 나머지 계속. 성공 아이템은 행마다 즉시 영속(요청 중간에 죽어도 이미 만든 건 남음).
- 상품+아이템 같은 tx → 원자적. createMaster/updateVersion 의 variant-created 등 이벤트는 outbox 로 tx 와 함께 커밋 → 단건 경로와 이벤트 parity 유지.

### publish 액션 (`/:sessionId/publish`)
세션의 `created` + 아직 draft 인 아이템 순회 → `publishVersion(draftVersionId)`(draft/inactive 허용). publish 검증 실패(가격 미설정·variantCode 충돌·디지털 자산 누락 등)는 master 별 수집, savepoint 격리:
```ts
{ published: number, failed: [{ masterId, reason }] }
```
이미 active 인 master 는 skip(멱등).

## 9. CSV 모듈 제거

- `apps/core/src/modules/catalog/operations/csv/` 전체 삭제(controller·service·dto·module + spec).
- `catalog.module.ts` 에서 `CsvModule` import/등록 해제(`:17`, `:42`).
- `papaparse` 잔여 사용처 확인(다른 모듈에서 쓰지 않으면 의존성 정리 여부 판단).
- 프론트(admin-web)가 `/products/csv/*` 호출 중이면 신규 `/product-imports/*` 로 전환 필요 — 엔드포인트 제거는 계약 변경이므로 프론트 전환과 동시에.

## 10. 테스트 전략

순수 로직 분리 → 단위 테스트 비중 높음.

- **단위**: `parser`(워크북 파싱, 시트/헤더 누락·행 상한 → `BadRequestError`), `normalizer`(categoryPath 해석 정상/모호/미존재, 옵션→optionDiff, 타입강제·기본값, productKey 링크), `validator`(행 규칙 전부, 조합 상한, 에러 귀속, 상품 단위 집계)
- **서비스/통합**: `manager.commit` 행별 savepoint 격리(1건 실패 시 나머지 created·실패 기록·orphan 없음·counts 정확), `publish` 액션(master별 publishVersion·실패 수집·active skip), parity 스팟체크(옵션 조합 variant 생성·카테고리 연결·status=draft)
- **E2E/itdoc**: 템플릿 → 워크북 생성 → validate 프리뷰 → commit 세션 → GET 리스트 → publish 전환
- **픽스처**: `buildImportWorkbook(products, options)` xlsx Buffer 헬퍼(공유). 골든 케이스: 해피패스(옵션 2그룹→조합 variant), 카테고리 경로 해석, 부분실패(불량 1행), 조합 상한 초과, 행 상한 초과, productKey 중복.
- **YAGNI 제외**: exceljs/drizzle 내부, 비동기 워커.

## 11. 롤아웃 노트

- 스키마 변경은 additive → 코드와 같은 PR. `db:generate:core` → SQL 리뷰 → 단일 커밋 → `db:setup`(dev) 적용.
- CSV 엔드포인트 제거는 admin-web 전환과 짝지어 배포.
- v1 후속(별도): Images 시트/필드, 명시적 variant SKU 모델, 엑셀 export, 크로스-임포트 dedup, 대규모용 비동기 워커.
