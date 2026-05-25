# Domain Context

도메인 명사와 모듈 경계의 출처를 기록한다. 코드에서 직접 추론하기 어렵거나, 추론으로는 자주 틀리는 사실만 적는다.

## 핵심 명사

### 판매상품 (Product / Master + Variant) — PIM 출신
- 정의: 쇼핑몰에서 고객이 보게 되는 상품 단위. **판매**의 단위.
- 구조: 한 **master** 는 여러 **variant** 를 가질 수 있다. 각 variant 는 option value 조합 하나에 대응. master ↔ variant 는 **강결합**.
- 스키마: `apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 `productVariants` 테이블 외.
- 핵심 속성(variant): `variantCode` (unique), `variantName`, `displayOrder`, `status`, `isDefault`, `imageId`.
- **가격은 판매상품의 본질 속성이 아니다.** master/variant 어느 단위에도 가격 컬럼이 묶여있지 않고, 가격은 별도 pricing 모듈(버전 + 규칙)이 관장한다. UI 에서 master 의 "기본 정보" 와 "가격" 은 다른 카드/페이지로 분리되는 게 도메인적으로 자연스럽다.
- **마스터는 항상 버전을 통해 수정된다.** `productMasterVersions` (draft/active) 가 진실의 source. 마스터 자체에는 PATCH 엔드포인트가 없고, 편집은 `POST versions → PUT versions/:id → PATCH versions/:id/publish` 흐름. 운영자 UI 는 세 모드로 갈라진다: (1) **active 보기** — `…/[masterId]` 기본; (2) **draft 편집** — status='draft' 인 버전만 PUT 가능; (3) **이전 버전 둘러보기** — `…/[masterId]/versions` 트리에서 inactive 를 골라 `…/[masterId]?versionId=…` 로 read-only 열람. inactive 에서도 "이 버전 기반 새 draft 만들기" 는 허용 (API 가 임의 parentVersionId 받으므로 fork 가 정상 시나리오). publish 로 inactive→active 롤백도 API 는 지원하지만, 운영 정책상 어드민 UI 의 별도 액션으로 다룬다.
- **버전 격리는 정션 + copy-on-write 로 구현된다.** `product_variants`, `product_option_groups`, `product_option_values`, `pricing_rules` 모두 version 컬럼이 없고, 버전 매핑은 정션 테이블 (`productMasterVariants`, `productMasterOptionGroups`, `productMasterPricingRules`) 이 가진다. draft 가 부모로부터 생기면 정션만 복사 — entity row 는 공유. **edit 시 그 entity 가 draft 외 다른 버전에도 매핑되어 있으면 새 row 를 clone 하고 draft 의 정션만 repoint** (CoW). draft 단독 매핑이면 in-place. 옵션 구조/값 변경에 의한 variant 재생성도 같은 원리 — `_regenerateVariantsForVersion` 의 `_findMatchingVariant` 가 부모 조합과 일치하는 variant 는 승계, 새 조합은 새 variant 발급. 직접 variant 편집은 version-scoped 엔드포인트(`PUT /masters/:masterId/versions/:versionId/variants/:variantId`)로만 가능 — 기존 글로벌 `PUT /variants/:id` 는 격리를 깨뜨리므로 사용 금지.
- **CoW 는 cascading 된다.** variant CoW 가 일어나면, draft 의 pricing rule 중 그 variantId 를 `scopeTargetIds` 에 포함하는 룰도 함께 clone 되고 새 variantId 로 교체된다. 같은 트랜잭션 안에서 처리.
- **`variantCode` 는 unique 제약 없다.** 같은 master 의 active variant 와 draft variant 는 동일한 외부 코드(=물리적 상품 식별자)를 의도적으로 공유한다. 진짜 의도("현재 active 버전에 매달린 variant 끼리만 unique")는 정션 join 이 필요해 partial index 로 표현 불가하므로 DB 강제는 없다. publish 직전에 active 버전의 variant 들끼리 충돌 검증.
- **재고 매칭 (productMatchings + productVariantSkuLinks) 의 버전 인계.** matching 은 inventory 모듈 소유이고 `variantId` unique. variant CoW 가 발생해도 PIM 트랜잭션 안에선 matching 을 건드리지 않는다. 대신 `publishVersion` 이 새 active 의 matching 없는 variant 들에 대해 **이전 active 의 같은 옵션 조합 variant** 의 matching+links 를 clone (variantId 만 새 ID). 옵션 조합이 일치 안 하면 (= 정체성이 달라진 신규 조합) unmatched 유지 — 운영자가 product-matching 화면에서 처리. 의도: 본질적이지 않은 variant 변경(이미지/이름) 은 매칭 자동 인계, 옵션 정체성 변화는 끊김. draft 단계에선 inventory 시뮬레이션은 안 한다는 운영 가정.
- **상품 상세설명**: `descriptionHtml` (text) 가 실데이터. 평문 `description` 컬럼은 현재 항상 NULL — 미래 용도 미정. 스토어프론트는 `prose` 컨테이너에 `dangerouslySetInnerHTML` 로 렌더 (sanitize 없음). 데이터 모양은 카페24/NNEditor 마이그레이션 출신의 **이미지 스택 HTML** (`<img>` 나열 + 인라인 style) 이 주류.
- 변화 동인: 상품 등록/판매 시작·종료/이미지 변경.

### 재고상품 (SKU) — WMS 출신
- 정의: 물류창고에서 서로 다른 물리적 상품의 단위. **재고**의 단위.
- 스키마: `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `skus` 테이블.
- 핵심 속성: `code` (unique), `holderId`(소유자), `stockType`, `safetyStock`, 물리 속성(무게/치수/소재), `moq`.
- 변화 동인: 입고/이동/실측/재고 보정.

### 상품 카테고리 (Product Category) — 고객 노출용 분류 트리
- 정의: 쇼핑몰에서 **고객이 상품을 탐색**할 때 쓰는 단일 분류 트리. 운영/집계용 내부 분류가 아니라 노출 메뉴.
- 스키마: `apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 `productCategories` (`product_categories`).
- 구조: 단일 트리(여러 트리 아님). 부모-자식 관계, `sortOrder` 로 정렬, `isActive` 로 노출 토글.
- 핵심 속성: `name`, `slug`, `description`, `parentId`, `level`, `sortOrder`, `isActive`.
- **판매상품(master)** 과의 관계는 분류이지 강결합 아님. 매핑은 `productMasterCategories` (한 master 가 여러 카테고리에 속할 수 있음, `isPrimary` 로 대표 1건 지정).
- 변화 동인: 시즌/기획전 개편, 메뉴 재배치, 노출 on/off.
- admin 라우트: `apps/admin-web/src/app/(admin)/mall/categories`.

### 채널 카테고리 (Channel Category) — 판매 채널 분류 (별개 개념)
- 정의: **판매 채널**(`salesChannels`) 자체를 묶는 분류. 상품 카테고리와는 별개 테이블·별개 도메인.
- 스키마: 같은 파일의 `channelCategories` (`channel_categories`). `salesChannels.categoryId` 가 이걸 참조.
- 상품 카테고리와 혼동 금지 — UI 도 모듈도 분리되어 있음 (`channel-categories.controller.ts`).

### SKU Group — 재고상품의 느슨한 묶음
- 정의: 매우 유사한 SKU들의 묶음 (예: 같은 제품인데 색만 다른 색연필).
- 스키마: `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `skuGroups` 테이블, `skus.groupId` (nullable).
- master/variant 의 강결합과 달리 **느슨한 결합**: 묶이지 않은 SKU도 정상이고, 그룹 자체는 판매 단위가 아니라 운영 편의용 묶음.

### 판매상품 ↔ 재고상품 관계
- **두 단위는 별개 정체성이다. 1:1로 동등하지 않으며 직접 FK도 없다.**
- 둘 사이 매핑은 `apps/core/src/modules/product-matching/` 모듈이 전담한다.
- 링크 테이블: `productVariantSkuLinks` (현재 `wmsTables` 스키마 그룹에 묶여있는 것은 [[project-core-wms-pim-merge]] 통합 흔적).
- 한 variant 가 여러 SKU 와 연결될 수 있고 그 반대도 가능.

### 라이브러리 (Library) — 디지털 fulfillment 의 한 종류 *(설계 중, 미구현)*
- 정의: **디지털 자산(DigitalAsset)** 과 그 **소유권(Ownership)** 을 관리하는 새 Core 모듈. 위치: `apps/core/src/modules/library`. 운영자 관리 surface 는 `apps/admin-web` 의 mall 영역이고, customer-facing surface 는 storefront 의 다운로드/사용 처리 화면이다. Storefront BackendService enum 의 `library` 항목은 core subdomain 을 공유한다.
- 핵심 명사:
  - **DigitalAsset** (`digitalAssets`) — 1 row = 1 파일. 메타데이터 + `file-service` 의 fileId.
  - **Ownership** (`digitalAssetOwnerships`) — 고객의 1 개 자산에 대한 영구 소유권. `License` 가 아닌 이유: 본 모델은 영구 소유이며 SaaS 적 라이선스 의미와 다름.
  - 매칭 정션 (`productVariantDigitalAssetLinks`) — variant ↔ asset M:M. SKU 매칭의 `productVariantSkuLinks` 와 대칭.
- **fulfillment 의 한 수단이지 새로운 "상품 종류" 가 아니다.** WMS 의 "택배" 와 동격: 같은 variant 가 SKU 매칭이 있으면 택배 fulfillment, asset 매칭이 있으면 라이브러리 fulfillment. 둘 다 있으면 둘 다 발생 (예: 장치 + 사용법 강의 동영상).
- **fulfillment 방식은 catalog 의 책임이 아니다.** variant/master 에 fulfillment mode 컬럼을 두지 않는다. **매칭의 존재 자체가** fulfillment 방식을 결정. 잔재의 `salesVariantPolicies.fulfillmentMode` 와 `productMatchings.inventoryManagement` (`true: 물리, false: 디지털` 주석) 는 폐기 대상.
- 매칭 단위: **variant ↔ digital asset (M:M)**. SKU 매칭(`productVariantSkuLinks`)과 같은 단위. 정션 테이블 가칭 `productVariantAssetLinks`. variant 별로 콘텐츠가 다를 수 있음 (예: 시술동의서 양식 + 컬러 옵션은 컬러마다 다른 파일).
- 매칭은 **master 버전 격리 (CoW) 대상.** variant 가 CoW 로 clone 되면 asset 정션도 함께 clone — pricing rule cascading 과 동일 패턴. publish 시 옵션 조합이 같으면 자동 승계, 정체성이 다르면 unmatched 로 남김 (SKU 매칭의 publish-time clone 과 대칭).
- **Ownership grant 시점: `OrderCreated` 이벤트 도착 + `payload.status === 'confirmed'` (= 채널이 결제완료된 주문을 우리에게 넘긴 시점).** `handleOrderCreated` 의 같은 트랜잭션 안에서 ownership row 작성. WMS 의 `pending → confirmed` 상태 전이(`POST /sales-orders/:id/confirm`, 운영자의 출고확정 액션) 와 무관 — 그건 별개 사건. 디지털은 **`fulfillment_orders` 를 거치지 않는다** — fulfillment_orders 는 sku/출고에 깊게 묶인 WMS 의 객체이고, 디지털은 "재고주문" 단계 자체가 존재하지 않음. 자세한 매커니즘은 ADR-0010.
- **"Confirmed" 용어의 두 의미 (혼동 주의).** 코드/도메인 어휘에서 *결제 확정* (채널이 PAYED 상태로 주문을 넘기는 시점, `OrderCreated.status === 'confirmed'` 로 표현) 과 *출고 확정* (운영자가 어드민 화면에서 SO 를 창고에 보내겠다고 결정, `salesOrders.status = 'confirmed'` 로 표현) 는 다른 사건. library grant 는 *결제 확정* 시점에 일어남.
- **두 fulfillment track 은 평행하다.** 한 SO 가 동시에 (WMS) fulfillment_order 와 (library) ownership 두 trail 을 trigger 할 수 있고, 두 track 은 비동기·독립으로 진행.
- **Asset 정체성: 1 DigitalAsset = 1 파일** (단, 파일은 version history 를 가짐 — 아래 항목 참고). 묶음은 매칭 단의 M:M 으로 자연 표현 (한 variant 에 여러 asset 매칭). 진짜 묶음 운영 편의가 필요해지면 별도 bundle 레이어 도입, 첫 구현에는 없음.
- **Asset 의 파일은 mutable 하다 — file version history 로 추적.** `digitalAssetFileVersions` (assetId, fileId, version, releaseNote, releasedAt/By) 가 immutable 이력. `digitalAssets.currentFileVersionId` 가 latest 포인터. 운영자의 "파일 교체" = 새 version row 추가 + 포인터 갱신. **다운로드 = ownership.asset.currentFileVersion 의 파일 — 모든 보유자가 자동 latest.** 메타데이터(`name`, `description` 등) 변경은 history 미보존 (audit 가치 적음).
- **두 레이어의 책임 분리 (중요).** master version 시스템이 frozen 시키는 것은 **sale offering** 의 진실 ("어떤 variant 가 어떤 옵션/가격으로 팔렸나"). asset 파일 내용은 **콘텐츠** 의 진실이며 다른 layer. 변종 CoW 는 매칭 정체성("어떤 asset 인지")만 격리하고, 그 asset 의 파일 내용은 publish 와 무관하게 살아있음. 시술동의서 오타 수정은 옛 버전에 묶여있던 고객에게도 자동 전파됨.
- **Ownership 라이프사이클: exercise boundary 패턴.** ownership row 에 `grantedAt` / `exercisedAt` / `revokedAt` 세 timestamp.
  - exercise 전: 다운로드 불가. 주문 환불/취소 시 자동 회수 (`revokedAt` 세팅).
  - exercise = "사용 처리" 명시적 의사표시. 그 후: 다운로드 가능, 환불 권리 포기 (결제 측이 환불 거절). 전자상거래법 17 조 "사용 또는 일부 소비" 의 명시적 boundary 역할.
- **Grant 경로는 결제 단일.** 멤버십 자격에 의한 자동 grant 경로는 두지 않는다. 멤버십 베네핏 형태의 무료/할인 제공은 **pricing 모듈의 멤버십가** (0 원 포함) 로 표현 — 0 원 결제도 같은 SO/ownership 흐름을 타므로 모델 일관성 유지, 동시에 "원치 않는 콘텐츠가 라이브러리에 자동으로 쌓이는" 문제도 자연 회피.
- 파일 저장 자체는 `apps/file-service` 위임 — library 모듈은 메타데이터 + 소유권만 관리.

### 파일 (File / file-service)
- 정의: 업로드된 단일 물리적 파일. file-service 가 소유하는 가장 작은 단위.
- 스키마: `apps/file-service/src/database/schema.ts` 의 `uploads` 테이블. 핵심 컬럼: `id`, `mimeType`, `size`, `filePath`, `url`, `status` (`active` | `deleted` — 두 개뿐), `isPublic`, `uploadedBy`, `contextId`.
- **책임 경계는 "파일 자체" 까지.** file-service 는 inbound reference 를 추적하지 않는다 — 참조 방향은 호출 도메인 → `uploads.id` 단일. 자세한 결정은 ADR-0009.
- **파일 접근 결정의 single port = `FileAccess`** (`apps/file-service`). 권한(`isPublic` / `uploadedBy` / `master` scope) + status + delete 라이프사이클의 모든 *결정* 이 이 모듈 안. 호출자는 세 메서드로만 진입 — `loadReadable(id, user)`, `loadPublicServable(id)`, `delete(id, user)`. `FileRepository` 의 read 와 권한 결부 write (softDelete) 는 이 모듈 안에서만 호출 — Upload 의 row 생성처럼 권한 결정이 결부되지 않는 write 는 호출자가 직접 사용.
- **호출 도메인은 자기 권한 검사를 file-service 에 전가하지 않는다.** Library 의 ownership 검사는 core 안에서 끝나고, core 가 master scope JWT 위임으로 file-service 호출. file-service 는 library/ownership 의 존재를 모름. 같은 분리가 다른 calling domain 에도 적용.

## 출신 시스템

`apps/core` 는 한때 분리되어 있던 WMS와 PIM이 통합된 앱이다. 자세한 맥락은 메모리 [[project-core-wms-pim-merge]].
