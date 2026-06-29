# Domain Context

도메인 명사와 모듈 경계의 출처를 기록한다. 코드에서 직접 추론하기 어렵거나, 추론으로는 자주 틀리는 사실만 적는다.

## 핵심 명사

### 판매상품 (Product / Master + Variant) — PIM 출신
- 정의: 쇼핑몰에서 고객이 보게 되는 상품 단위. **판매**의 단위.
- 구조: 한 **master** 는 여러 **variant** 를 가질 수 있다. 각 variant 는 option value 조합 하나에 대응. master ↔ variant 는 **강결합**.
- 스키마: `apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 `productVariants` 테이블 외.
- 핵심 속성(variant): `variantCode` (unique), `variantName`, `displayOrder`, `status`, `isDefault`, `imageId`.
- **가격은 판매상품의 본질 속성이 아니다.** master/variant 어느 단위에도 가격 컬럼이 묶여있지 않고, 가격은 별도 pricing 모듈(버전 + 규칙)이 관장한다. UI 에서 master 의 "기본 정보" 와 "가격" 은 다른 카드/페이지로 분리되는 게 도메인적으로 자연스럽다.
- **가격정책 편집은 별도 version-scoped surface 에서 다룬다.** 판매상품 상세 화면은 가격 요약과 가격정책 편집 진입만 제공하고, base/membership/tiered rule 편집·시뮬레이션·variant별 가격 확인은 같은 draft version 을 대상으로 하는 가격 관리 화면에서 수행한다.
- **마스터는 항상 버전을 통해 수정된다.** `productMasterVersions` (draft/active) 가 진실의 source. 마스터 자체에는 PATCH 엔드포인트가 없고, 편집은 `POST versions → PUT versions/:id → PATCH versions/:id/publish` 흐름. 운영자 UI 는 세 모드로 갈라진다: (1) **active 보기** — `…/[masterId]` 기본; (2) **draft 편집** — status='draft' 인 버전만 PUT 가능; (3) **이전 버전 둘러보기** — `…/[masterId]/versions` 트리에서 inactive 를 골라 `…/[masterId]?versionId=…` 로 read-only 열람. inactive 에서도 "이 버전 기반 새 draft 만들기" 는 허용 (API 가 임의 parentVersionId 받으므로 fork 가 정상 시나리오). publish 로 inactive→active 롤백도 API 는 지원하지만, 운영 정책상 어드민 UI 의 별도 액션으로 다룬다.
- **판매상품 등록**은 완성된 판매상품 데이터를 한 번에 제출하는 행위가 아니다. 새 master 와 최초 draft version 을 열고, 이후 draft 편집에서 기본정보·옵션·variant·이미지·가격 정책을 완성한 뒤 publish 하는 시작 행위다. 등록 진입점은 가격/구매조건 같은 복합 데이터를 직접 받지 않고, 생성될 draft 편집 흐름을 명확히 예고해야 한다. 등록 진입점에는 이름 입력 같은 사전 필드도 두지 않고, 서버 기본값(`새 상품`)으로 생성한 뒤 draft 편집 화면에서 수정한다.
- **신규 draft 편집 화면은 완성 흐름을 안내해야 한다.** 최초 draft version 은 의도적으로 불완전하게 생성되므로, 관리자 화면은 기본 정보·이미지·옵션/품목·가격정책·publish 같은 다음 작업을 체크리스트로 보여준다. 이 체크리스트는 대형 등록 폼을 대체하는 작성 흐름 안내이며, 각 항목은 해당 draft 편집 surface 로 이어져야 한다. 체크리스트는 안내용(advisory)이며 publish 차단 조건이 아니다. publish hard gate 는 서버의 명시적 검증(예: draft/inactive 여부, variantCode 충돌, 가격 계산 가능성)으로만 다룬다.
- **버전 격리는 정션 + copy-on-write 로 구현된다.** `product_variants`, `product_option_groups`, `product_option_values`, `pricing_rules` 모두 version 컬럼이 없고, 버전 매핑은 정션 테이블 (`productMasterVariants`, `productMasterOptionGroups`, `productMasterPricingRules`) 이 가진다. draft 가 부모로부터 생기면 정션만 복사 — entity row 는 공유. **edit 시 그 entity 가 draft 외 다른 버전에도 매핑되어 있으면 새 row 를 clone 하고 draft 의 정션만 repoint** (CoW). draft 단독 매핑이면 in-place. 옵션 구조/값 변경에 의한 variant 재생성도 같은 원리 — `_regenerateVariantsForVersion` 의 `_findMatchingVariant` 가 부모 조합과 일치하는 variant 는 승계, 새 조합은 새 variant 발급. 직접 variant 편집은 version-scoped 엔드포인트(`PUT /masters/:masterId/versions/:versionId/variants/:variantId`)로만 가능 — 기존 글로벌 `PUT /variants/:id` 는 격리를 깨뜨리므로 사용 금지.
- **CoW 는 cascading 된다.** variant CoW 가 일어나면, draft 의 pricing rule 중 그 variantId 를 `scopeTargetIds` 에 포함하는 룰도 함께 clone 되고 새 variantId 로 교체된다. 같은 트랜잭션 안에서 처리.
- **가격 규칙은 per-row CoW 대상이 아니다.** variant 는 단독으로 온전한 데이터라 한 줄씩 버전 격리(공유면 clone, 단독이면 in-place)가 의미 있다. 그러나 가격 규칙은 여러 rule 이 쌓여 한 version 의 가격 구성("variant별/상황별 가격")을 이루므로, rule 한 줄을 독립적 버전 관리 단위로 보지 않는다. 따라서 가격 정책 편집은 version 단위 **whole-set 교체** (`replaceVersionRules`: 그 version 의 정션 전체 삭제 → 고아 rule 정리 → 새 rule 재삽입)로 다루고, variant 처럼 "공유면 clone, 단독이면 in-place" 분기를 두지 않는다. pricing rule 의 per-rule clone 은 오직 **variant CoW 의 cascade** (바로 위 항목)에서만 일어나며, 이는 버전 격리 결정이 아니라 변경된 variantId 참조를 draft 안에서 기계적으로 repoint 하는 것이다. per-rule CoW 로 두는 선택도 가능하지만 의도적으로 택하지 않았다.
- **`variantCode` 는 unique 제약 없다.** 같은 master 의 active variant 와 draft variant 는 동일한 외부 코드(=물리적 상품 식별자)를 의도적으로 공유한다. 진짜 의도("현재 active 버전에 매달린 variant 끼리만 unique")는 정션 join 이 필요해 partial index 로 표현 불가하므로 DB 강제는 없다. publish 직전에 active 버전의 variant 들끼리 충돌 검증.
- **판매상품 구매제약조건**은 한 판매상품 master 전체에 적용되는 구매 가능 조건이다. 개별 variant 가 아니라 master 기준으로 적용하며, 서로 다른 variant 별 구매제한이 필요하면 별도 판매상품 master 로 분리한다.
- Catalog 는 멤버십의 상세 자격 모델을 알지 않는다. 판매상품 구매제약조건에는 멤버십 회원만 구매 가능한지 여부를 boolean 으로만 저장하고, 판매채널의 customer group 같은 구체 식별자는 channel-adapter/판매채널 설정이 번역한다.
- 판매상품 구매제약조건의 lifetime 구매수량 제한은 같은 master 의 모든 variant 구매수량을 합산해 판단한다. 새 version 이 publish 되어도 같은 master 의 lifetime 구매수량 기준은 리셋되지 않는다.
- 판매상품 구매제약조건의 lifetime 구매수량 제한은 없거나 양의 정수여야 한다. `0` 은 "아예 구매 불가"라는 별도 의미가 되므로 구매제약조건 값으로 쓰지 않는다.
- 판매상품 구매제약조건은 없을 수 있다. 제약조건 row/매핑이 0개이면 해당 판매상품 version 에는 구매제약조건이 없다는 뜻이다.
- 판매상품 구매제약조건도 다른 version-owned 상품 연관 데이터처럼 entity row 와 version mapping 을 분리한다. draft 생성 시 mapping 만 복사해 조건 row 를 공유하고, draft 수정 시 공유 row 이면 CoW 로 clone 후 draft mapping 만 repoint 한다. 한 version 이 가질 수 있는 판매상품 구매제약조건은 최대 1개다.
- 구매제약조건이 없는 부모 version 에서 만든 draft 에 처음 조건을 추가하면 새 constraint row 를 만들고 draft version 에만 mapping 한다.
- 판매상품 구매제약조건 row 는 version mapping 이 없으면 의미가 없으므로 orphan 을 남기지 않는다. 단, CoW 자체가 기존 row 삭제를 뜻하지는 않으며, mapping 삭제 또는 repoint 후 참조하는 version 이 0개인지 확인한 경우에만 constraint row 를 삭제한다.
- 판매상품 구매제약조건 수정은 scalar version update DTO 에 섞지 않고 별도 version-scoped surface 로 다룬다. 조건 row 생성/수정/삭제는 CoW 와 "row 0개 = 없음" 의미를 가지므로 pricing rule/variant 편집처럼 독립된 편집 흐름이 적절하다.
- 판매상품 구매제약조건의 admin-web 편집 UI 는 Core API/event/channel-adapter projection 이후 별도 작업으로 다룬다.
- 판매상품 구매제약조건 mutation 에서 모든 조건을 끈 값(`requiresMembership=false`, `lifetimeQuantityLimit=null`)은 제약조건 삭제와 같은 결과다. 명시적 삭제 endpoint 도 제공한다.
- version detail read model 도 현재 version 의 판매상품 구매제약조건을 포함한다. 별도 구매제약조건 조회 endpoint 는 편집 surface 의 명시적 조회용으로 유지하고, mutation 은 별도 endpoint 가 담당한다.
- active version publish snapshot 은 판매상품 구매제약조건을 optional object 로 전달한다. 필드가 없으면 제약조건 없음이고, row 가 있으면 `requiresMembership` 과 `lifetimeQuantityLimit` (`null` 이면 수량 제한 없음) 을 포함한다.
- 판매상품 구매제약조건 draft edit 은 판매채널 이벤트를 발행하지 않는다. 판매채널 projection 은 active version publish/rollback 시 `ProductMasterActiveVersionChanged` snapshot 으로만 갱신한다.
- Medusa 는 현재 판매상품 구매제약조건의 lifetime 구매수량 제한을 기본 기능으로 지원하지 않는다. Core Catalog 는 이 조건의 SoT 를 가질 수 있지만, Medusa 에서의 실제 적용은 별도 custom workflow/hook 구현 전까지 작동하지 않는다.
- channel-adapter 는 판매상품 구매제약조건을 Medusa product metadata 의 별도 projection 으로 전달한다. 이 metadata 는 미래의 Medusa custom workflow/hook 이 Core 호출 없이 로컬에서 제약을 적용하기 위한 입력이며, 기존 `isMembershipOnly` metadata 와 섞지 않는다.
- 판매상품 구매제약조건이 설정되어도 판매채널이 해당 제약 기능을 지원하지 않으면 실제 제약은 작동하지 않을 수 있다. 이것은 Catalog publish 차단 조건이 아니며, channel-adapter/판매채널 projection 의 지원 범위 문제로 다룬다.
- **멤버십가 공개 제한**은 멤버십 회원이 아닌 고객에게 해당 판매상품의 멤버십가를 보여주지 않는 가격 노출 정책이다. 이것은 상품 노출이나 구매 가능 여부가 아니며, 코드에서는 `hideMembershipPriceForNonMembers` 로 표현한다.
- **멤버십 회원 전용 노출**은 멤버십 회원이 아닌 고객의 목록/검색/상세 접근에서 해당 판매상품을 숨기는 고객 노출 정책이다. 이것은 구매 가능 여부가 아니며, 코드에서는 `isVisibleToMembersOnly` 로 표현한다.
- **멤버십가 공개 제한**과 **멤버십 회원 전용 노출**은 운영 노출 정책이므로 active version 에 즉시 반영할 수 있다. 일반 판매상품 내용 변경은 여전히 draft/publish 흐름을 따른다.
- **멤버십 회원 전용 노출**의 canonical enforcement 는 판매채널 응답 단계다. Medusa 는 단건 상세 접근을 차단하고, custom sorted list 는 query/count 단계에서 제외한다. 비회원 장바구니 담기도 방어적으로 차단한다. Storefront 는 metadata 기반 필터를 한 번 더 적용하는 UX 방어선이다.
- Medusa/Storefront 에서 **멤버십 회원** 판정은 Medusa customer group 기준이다. 고객이 `MEDUSA_MEMBERSHIP_GROUP_ID` 그룹에 속해 있으면 멤버십 회원이고, guest 또는 해당 그룹이 없는 로그인 고객은 비회원이다.
- Search service 는 첫 구현에서 **멤버십 회원 전용 노출**을 index/query 조건으로 반영하지 않는다. Storefront 검색 결과는 Medusa metadata 기준으로 필터하지만 search total/page 는 숨겨진 상품을 포함할 수 있으며, 정확한 검색 pagination 은 별도 작업으로 다룬다.
- `isMembershipOnly` 는 legacy 필드명 때문에 **멤버십가 공개 제한**, **멤버십 회원 전용 노출**, **멤버십 회원 전용 구매조건**을 혼동시키기 쉽다. 도메인 언어에서는 이 세 정책 중 어느 것도 `isMembershipOnly` 로 부르지 않는다.
- `isMembersOnly` 는 어떤 정책이 멤버십 전용인지 불분명하므로 쓰지 않는다.
- **재고 매칭 (productMatchings + productVariantSkuLinks) 의 버전 인계.** matching 은 inventory 모듈 소유이고 `variantId` unique. variant CoW 가 발생해도 PIM 트랜잭션 안에선 matching 을 건드리지 않는다. 대신 `publishVersion` 이 새 active 의 matching 없는 variant 들에 대해 **이전 active 의 같은 옵션 조합 variant** 의 matching+links 를 clone (variantId 만 새 ID). 옵션 조합이 일치 안 하면 (= 정체성이 달라진 신규 조합) unmatched 유지 — 운영자가 product-matching 화면에서 처리. 의도: 본질적이지 않은 variant 변경(이미지/이름) 은 매칭 자동 인계, 옵션 정체성 변화는 끊김. draft 단계에선 inventory 시뮬레이션은 안 한다는 운영 가정.
- **상품 상세설명 (Product Description)**: 판매상품 master version 에 속하는 고객 노출용 상세 콘텐츠. Canonical source 는 Markdown 기반 `description` 이며, `description` 이 없을 때만 legacy `descriptionHtml` 을 fallback 으로 사용한다. 작성자는 `description` 에 raw HTML 을 쓰지 않고, 기본 Markdown 문법과 상품 상세설명 이미지 문법으로 콘텐츠를 표현한다.
- **상품 상세설명 이미지**: 상품 상세설명 Markdown 안에서 file-service 의 File UUID 를 참조해 노출하는 이미지. 작성 문법은 `::product-image{fileId="..." alt="..."}` 이며, raw URL 이미지가 아니라 `product-description-image` file context 에 업로드된 파일을 참조한다.
- 상품 상세설명 이미지 file reference 가 깨졌을 때 storefront 는 이미지를 조용히 숨기지 않고 alt 기반 placeholder 를 노출한다. 관리자 미리보기는 운영자가 고칠 수 있도록 fileId 와 함께 불러오기 실패를 명확히 표시한다.
- **레거시 상품 상세설명 HTML (Legacy Product Description HTML)**: 카페24/NNEditor 마이그레이션 출신의 raw HTML 상세 콘텐츠. 데이터 모양은 **이미지 스택 HTML** (`<img>` 나열 + 인라인 style) 이 주류이며, 신규 작성의 canonical source 가 아니다. Markdown 전환 단계에서는 기존 raw HTML 호환성을 유지하고, 이를 정제하거나 Markdown 으로 자동 변환하는 작업은 별도 migration 으로 다룬다.
- `description` 이 비어 있고 `descriptionHtml` 만 있는 기존 판매상품을 관리자가 열면, Markdown 편집기는 비어 있게 두고 legacy HTML 은 read-only preview 로 보여준다. 관리자가 Markdown 을 새로 저장한 뒤부터 해당 version 의 고객 노출 상세설명은 `description` 이 우선한다.
- 새 draft version 을 만들 때는 부모 version 의 `description` 과 `descriptionHtml` 을 모두 그대로 복사한다. 기존 HTML-only 판매상품도 draft 생성 직후 고객 노출 상세설명이 유지되고, 운영자가 Markdown 을 저장한 version 부터 `description` 이 우선한다.
- 판매채널에 노출되는 상품 상세설명은 active version 의 상세설명뿐이다. draft/inactive version 의 상세설명은 관리자 작성·미리보기·이전 버전 열람 대상이지 판매채널 projection 대상이 아니다.
- 상품 상세설명 Markdown 파싱 규칙과 directive 계약은 NestJS 에 의존하지 않는 `packages/` 공유 코드로 둔다. admin preview 와 storefront/customer renderer 는 같은 파싱 규칙을 공유하고, surface 별 표시 컴포넌트만 다르게 주입한다.
- Medusa product 의 `description` 필드는 canonical 상품 상세설명의 원천이 아니다. 현재는 null/empty projection 으로 두며, 고객용 상품 상세 콘텐츠는 Core 의 active version 상세설명(`description` 우선, 없으면 `descriptionHtml` fallback)을 storefront 가 직접 렌더한다. 필요해지면 Medusa `description` 은 요약(summary) 성격의 plain text projection 으로만 쓴다.
- 변화 동인: 상품 등록/판매 시작·종료/이미지 변경.

### 재고상품 (SKU) — WMS 출신
- 정의: 물류창고에서 서로 다른 물리적 상품의 단위. **재고**의 단위.
- 스키마: `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `skus` 테이블.
- 핵심 속성: `code` (unique), `holderId`(소유자), `stockType`, `safetyStock`, 물리 속성(무게/치수/소재), `moq`.
- 변화 동인: 입고/이동/실측/재고 보정.

### 재고상품 재고량 (SKU Stock Quantity)
- 정의: 특정 재고상품(SKU)이 물류 관점에서 보유·예약·판매 가능 상태로 가진 수량.
- 재고상품 재고량은 물리 재고의 진실이며, 판매상품의 판매 가능 수량과 1:1로 같다고 가정하지 않는다.
- _Avoid_: 판매상품 재고량과 같은 말로 쓰기.

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

### 판매 채널 (Sales Channel)
- 정의: 고객 주문을 수집하는 판매 접점이며, Core 는 판매 채널을 자기 내부 모델로 직접 신뢰하지 않고 channel-adapter 를 통해 번역된 주문만 받는다.
- **Medusa 는 자사몰 판매 채널이다.** Naver/Coupang 과 소유 구조는 다르지만 Core 관점에서는 같은 외부 주문 출처로 취급한다.
- **Medusa order id 는 채널 주문 ID다.** Core 의 `sales_orders.id` 와 같은 정체성이 아니며, Core 에서는 `(salesChannel, channelOrderId)` 로 참조한다.
- 판매채널은 Core/관련 백엔드 SoT 의 projection 을 보유한다. 상품, 가격, 판매가능수량 등은 SoT 에서 계산되어 channel-adapter 를 통해 판매채널에 반영된다.
- Medusa 는 WMS/재고 판단을 위해 Core API 를 직접 호출하지 않는다. 꼭 필요한 예외가 아니라면 Medusa 와 Core 의 commerce 경계는 channel-adapter 를 통해 연결한다.
- _Avoid_: Medusa 를 Core 의 주문 하위 모듈처럼 취급하기, Medusa order id 를 Core sales order id 로 재사용하기, Medusa 에서 Core WMS/availability API 를 직접 호출하기.

### 판매채널 Projection Snapshot
- 정의: active 판매상품 version 을 판매채널이 자기 상품 projection 으로 반영할 수 있도록 Core Catalog 가 publish/rollback 시점에 전달하는 상품 상태 스냅샷.
- 판매채널 Projection Snapshot 은 고객 화면 read model 이 아니라 channel-adapter 가 소비하는 active 판매상품 projection 계약이다.
- 판매채널 Projection Snapshot 은 active version 에 대해서만 생성한다. draft/inactive 의 작성·열람 상태는 관리자 version detail 의 대상이지 판매채널 반영 대상이 아니다.
- 판매상품이 unpublished 상태가 될 때는 판매채널 Projection Snapshot 없이 active version 이 없다는 상태만 전달한다.
- 판매채널 Projection Snapshot 은 계산된 가격 projection 이 빠진 상태로 생성하지 않는다. 가격 projection 누락은 판매채널에 기본값으로 넘길 문제가 아니라 publish/republish 실패로 드러내야 하는 상태다.
- 판매채널 Projection Snapshot 은 variant 가 0개인 active 판매상품에 대해 생성하지 않는다. 옵션 없는 판매상품도 기본 variant 1개가 있어야 하므로, variant 0개 active 상태는 정상 publish 흐름에서는 발생하지 않아야 하는 불완전한 상태다.
- 판매채널 Projection Snapshot 의 상품 이미지 참조는 File UUID 를 일차 데이터로 다룬다. URL 문자열은 판매채널 adapter 가 필요할 때 자기 projection 형식에 맞춰 파생하는 값이지 Core Catalog 의 canonical 상품 상태가 아니다.
- 기존 판매채널 Projection Snapshot contract 와 consumer 호환은 유지한다. 이미지 URL 필드가 남아 있어도 Core Catalog 의 의미상 canonical 값은 File UUID 이며, URL 필드는 호환/adapter 편의 값으로 취급한다.
- _Avoid_: 일반 사용자용 read model, storefront read model.

### 채널주문 (Channel Order)
- 정의: Medusa/Naver/Coupang 같은 판매 채널이 자기 주문 모델과 ID 체계로 보유하는 원천 주문.
- 채널주문은 Core 판매주문의 live projection 대상이 아니다. Payment Accepted 시점에 channel-adapter 가 채널주문을 Core 판매주문 처리 계약으로 번역한다.
- _Avoid_: 채널주문과 Core 판매주문을 같은 주문 row 의 두 표현으로 보기.

### Payment Accepted — 채널 주문 수락 기준
- 정의: 판매 채널이 결제 실패 위험을 벗어나 Core 주문 처리 대상으로 넘길 수 있다고 판단한 결제 상태.
- Medusa/Wallet 에서는 `AUTHORIZED` 또는 `CAPTURED` 가 Payment Accepted 이다. Core 판매주문 생성 기준은 `AUTHORIZED` 이며, `CAPTURED` 는 `AUTHORIZED` 를 이미 만족한 더 강한 정산 상태일 뿐 생성 게이트가 아니다.
- `CREATED`, `PROCESSING`, `REQUIRES_ACTION`, `FAILED`, `CANCELED` 주문/결제는 Core 판매주문 생성 대상이 아니다.
- _Avoid_: `authorized` 라는 특정 provider 상태명을 Core 주문 생성의 도메인 용어로 쓰기.

### Medusa 결제 Projection (Payment Events Hook)
- 정의: Wallet 결제 인텐트 상태 변경(`payment.intent.captured/canceled`, refund 등)을 Medusa 의 payment/order 레코드에 반영하는 단방향 projection. 수신점은 `/hooks/payment-events`, 결제 SSOT 는 Wallet 이다.
- Medusa 결제 projection 의 대상은 **Medusa 체크아웃을 거쳐 생성된 결제뿐이다.** 판별 기준은 그 intentId 에 대응하는 Medusa payment session row 의 존재 여부다. session 은 체크아웃 시 동기적으로 생성·커밋되므로, capture/cancel 이벤트 도착 시점엔 이미 존재한다 (주문인데 session 이 아직 없는 race 는 없다).
- 멤버십·빌링처럼 Medusa 를 거치지 않은 인텐트는 Medusa 에 session 이 영영 없다. 이런 이벤트는 projection 대상이 아니므로 `200 SKIPPED` 로 종료한다 (재시도/dead-letter 아님). channel-adapter 는 결제 종류를 안 가리고 모든 `payment.intent.*` 를 훅으로 forward 하므로, "내 것이 아닌" 이벤트 구분은 훅의 책임이다.
- 무통장입금(BANK_TRANSFER) 은 session 은 있고 Medusa payment row 만 없는 상태다. 이때 capture 이벤트만 cart 를 완료해 주문/결제를 만든 뒤 capture 를 반영하는 복구 경로를 탄다 (session 자체가 없는 비-Medusa 케이스와 구분). cancel/refund 는 반영할 payment 가 없으면 no-op SKIPPED 다 — 취소하려고 주문을 새로 만들지 않는다.
- 500 은 진짜 일시적 실패(DB 오류 등)에만 쓴다. "Medusa 에 짝이 없음" 은 일시적 상태가 아니라 영구 상태이므로 500/재시도로 다루지 않는다. 실제 side-effect 멱등성은 `captured_at`/`canceled_at` DB 상태가 보장하며, in-memory `processedMessageIds` 는 그 보조 최적화일 뿐이다.
- _Avoid_: 모든 Wallet 결제 이벤트를 Medusa 주문으로 가정하기, "payment 없음" 을 race 로 보고 무한 재시도(500)하기, in-memory 멱등성 set 을 멱등성의 유일한 근거로 신뢰하기.

### 판매주문 (Core Sales Order)
- 정의: Payment Accepted 된 채널 주문을 Core 의 주문 처리 모델로 번역해 기록한 주문.
- 판매주문은 채널주문의 live projection 이 아니라, Payment Accepted 시점에 Core 가 수락한 독립 처리 계약이다.
- 판매주문의 원 line 은 수락 당시 계약 스냅샷이다. Payment Accepted 이후 상품 추가/대체/수량 보정은 원 line 을 직접 수정하지 않고 별도 주문정정으로 기록한다.
- 판매주문 생성은 아직 창고 출고가 가능하다는 뜻이 아니다. 판매상품 중 재고상품 매칭이 없으면 이후 출고주문 생성이 실패하거나 대기할 수 있다.
- Payment Accepted 된 채널 주문이 Core 에 들어오면 Core 는 판매주문 생성 뒤 출고주문 생성까지 자동으로 시도한다. 판매채널이 Core/WMS 를 직접 호출하지 않게 격리하는 대신, Core 내부 전환이 자동으로 이어져야 한다.
- 같은 채널 주문의 결제 상태가 `AUTHORIZED` 에서 `CAPTURED` 로 강해져도 새 판매주문을 만들지 않는다. Core 판매주문 정체성은 `(salesChannel, channelOrderId)` 이며, 결제 상태 변화는 같은 주문의 update 다.
- channel-adapter 가 한 번 수집한 Medusa 주문은 Core 처리 계약으로 고정된다. 이후 Medusa 쪽 주문 변경은 Core 판매주문에 자동 반영하지 않고 운영 예외로 격리한다. 상품 추가/대체 같은 CS 정정은 별도 주문정정/추가출고 워크플로우로 다루고, 취소는 별도 주문취소 lifecycle 로 다룬다.
- _Avoid_: Medusa order 를 판매주문과 같은 정체성으로 보기, 판매주문 생성을 출고주문/재고주문 생성이라고 부르기, 수락된 판매주문 line 을 사후 수정 이력 없이 덮어쓰기.

### 주문정정 (SalesOrderAmendment)
- 정의: Payment Accepted 이후 원 판매주문 계약과 달라지는 상품/수량/금액/이행 의사결정을 기록하는 별도 사건.
- 주문정정은 원 판매주문 line 의 revision 이나 단순 값 변경이 아니다. 추가출고, 보상출고, 추가 결제/환불 같은 후속 workflow 의 입력이 되는 정정 결정과 delta 기록이다.
- 금액이 바뀌는 상업적 주문정정과 고객 청구액이 바뀌지 않는 이행 정정은 구분한다. 무료 증정/누락 보상/CS 보상출고를 단순히 `unitPrice=0` 주문 line 추가로 표현하지 않는다.
- 이미 만들어진 출고주문/예약/피킹 단의 상태 조정은 주문정정에서 파생될 수 있지만, 그 자체가 원 판매주문 계약 변경은 아니다. 실제 출고 조정은 아직 출고되지 않은 수량에만 적용한다.
- 이미 출고된 수량은 출고주문에서 제거하지 않는다. 부분 취소/라인 제거 정정이 출고 이후에 발생하면 반품/회수/환불/보상 정책으로 넘어간다.
- Medusa 의 OrderChange 와 유사하게 정정 사건을 원 주문 옆에 누적하지만, Core 의 canonical term 은 주문정정이다.
- _Avoid_: 주문정정을 채널주문 재수집으로 처리하기, 원 판매주문 line 을 직접 PATCH/DELETE 하는 API 로 표현하기, 주문취소를 모든 line 제거 정정으로 환원하기.

### 주문취소 (OrderCancellation)
- 정의: 수락된 판매주문의 남은 청구/이행 의무를 전체 또는 일부 범위에서 더 이상 진행하지 않기로 하는 lifecycle 사건.
- 주문취소는 주문정정의 하위 타입이 아니다. 전체 취소는 모든 line 을 제거하는 주문정정을 만들지 않고, 원 판매주문 line 을 보존한 채 남은 의무를 취소 상태/효과로 닫는다.
- 부분 취소는 line 과 수량 범위를 가진 주문취소다. 아직 출고되지 않은 수량은 출고 조정/예약 해제로 이어지고, 이미 출고된 수량은 반품/회수/환불/보상 정책으로 이어진다.
- _Avoid_: 주문취소를 원 판매주문 line 삭제로 표현하기, 환불 완료만으로 주문취소가 완료됐다고 보기.

### 업무 연결 (Business Link)
- 정의: CS 사건, 주문정정, 결제/환불, 출고/반품 같은 독립 도메인 사건 사이의 원인/파급효과 관계.
- CS Case, 주문정정, Wallet 결제/환불, 출고주문/반품은 서로를 소유하지 않는다. 관리자가 한 주문의 전체 파급효과를 조회할 수 있도록 명시적인 업무 연결로 묶는다.
- 업무 연결은 `주문정정 → 환불`, `주문정정 → 출고 조정`, `CS Case → 주문정정`, `환불 → 판매주문` 같은 관계를 표현한다. 각 대상의 상태와 감사 로그는 대상 도메인이 소유한다.
- _Avoid_: 주문정정 row 에 환불/출고/CS 세부 상태를 내장하기, 결제/CS/출고 엔티티를 주문정정의 하위 엔티티로 만들기.

### 출고주문 (Fulfillment Order / 재고주문)
- 정의: 판매주문 전체 또는 일부를 창고 작업과 재고 차감 대상으로 넘기기 위해 만든 WMS/Core 객체.
- `재고주문`은 별도 도메인 객체가 아니라 출고주문의 현장/레거시 별칭이다. 문서와 코드에서는 가능하면 `출고주문`을 canonical term 으로 쓴다.
- 출고주문 생성은 판매상품 ↔ 재고상품 매칭을 필요로 하며, 매칭이 없으면 판매주문이 존재해도 출고주문으로 전환될 수 없다.
- Payment Accepted 주문의 최초 출고주문 생성이 매칭 누락 때문에 실패했다면, 실패는 운영자가 볼 수 있는 **출고주문 생성 대기** 상태로 남아야 한다. 이후 해당 판매상품 ↔ 재고상품 매칭이 등록되면 Core 는 관련 판매주문의 출고주문 생성을 다시 자동 시도한다.
- 출고주문 생성 대기는 암묵적으로 오래된 판매주문을 다시 훑는 규칙이 아니라, 어떤 판매주문이 어떤 variant 매칭을 기다리는지 추적되는 durable backlog 여야 한다.
- SKU 링크가 없다는 사실만으로 "물리 출고 불필요" 라고 판단하지 않는다. 판매상품의 상품매칭 전략이 명시적으로 재고상품 비매칭이면 출고주문 라인에서 제외하고, 상품매칭 전략 자체가 없거나 미해결이면 출고주문 생성 대기/매칭 누락으로 남긴다.
- 매칭이 있으면 출고주문 자체는 생성될 수 있다. 실제 재고 부족은 reservation 단계에서 막히며, 이 경우 출고주문은 존재하지만 출고 불가 상태로 남는다.
- **(설계 결정, 미구현 — `docs/inventory-ledger-binding-review.md`)** 새 설계에서 출고주문은 "박스"가 아니라 **판매주문을 상품매칭 규칙으로 재고상품(SKU)으로 변환한 스냅샷**이다. 판매주문 ↔ 출고주문은 **0..1 : 0..1** (디지털-only 주문은 출고주문 없음, 보상출고 등 단독 출고주문은 판매주문 없음). 물리 박스 분할(송장분할)·합배송은 출고주문이 아니라 **상자(shipment) 레이어**에서 일어난다. 기존의 "출고주문을 2개로 쪼개는" FO 분할(`split()` / `handleFulfillmentOrderSplit`)은 이 모델에서 은퇴한다.
- **(설계 결정, 미구현 — 별도 워크스트림)** 직배(drop-ship)는 출고주문으로 모델링하지 않는다. 직배 상품은 타사 소유·추적 불가 재고라 자사 출고 플로우(예약·피킹·재고원장 소진)에 묶이지 않고, 공급사에 주문 내역을 전달하는 것으로 출고를 갈음한다. → 직배는 출고주문 바깥의 별도 엔티티(직배주문)로 분리한다. 자세한 결정은 `docs/outbound-shipment-ledger-rfc.md` §직배 모델 추출.
- _Avoid_: 판매주문을 재고주문이라고 부르기, 출고주문을 물리 박스와 동일시하기, **직배 주문을 출고주문(FO)으로 모델링하기**.

### 직배주문 (Drop-ship Order) *(설계 결정, 미구현)*
- 정의: 타사가 소유한 재고상품(우리가 추적하지 않는 재고)을 우리 쇼핑몰에서 판매했을 때, 해당 공급사에 주문 내역·배송지를 전달해 공급사가 직접 발송하게 하는 주문. 출고주문(FO)과 평행한 별개 엔티티이며 자체 라이프사이클을 가진다.
- 출고주문과의 차이: 직배주문은 우리 창고 재고를 예약·피킹·소진하지 않는다. 출고 종결 = 공급사 전달. 재고원장(`stock_events`)을 건드리지 않는다.
- 분기 기준: 판매주문이 들어와 주문매칭이 성공하면 SO 는 **출고주문 0..1개**(자사 매칭 라인이 있으면 1개; 디지털-only 등 자사 출고 라인이 0이면 0개) **+ 직배 공급사 수만큼의 직배주문**으로 쪼개진다. (SO ↔ FO 가 양쪽 optional 1:1 로 재정의되면서 "한 SO 를 자사 FO 와 타사 직배 FO 로 쪼개기" 가 부적절해진 결과.)
- 현재 코드는 직배를 `fulfillmentMode='drop_ship'` FO + `direct-ship` 라이프사이클(pending→forwarded→completed)로 다루며, 이 추출 전까지 한시적으로 유지된다.
- _Avoid_: 직배주문을 박스/상자로 보기, 직배 종결 시 재고원장을 소진하기.

### 재고예약 (Reservation)
- 정의: 특정 출고주문 또는 이동 작업을 위해 SKU 의 판매 가능 재고 일부를 점유하는 행위.
- 재고예약 성공은 출고주문 생성의 필수 성공 조건이 아니다. 출고주문은 매칭된 SKU 구성으로 생성되고, 재고 부족은 재고예약 단계의 실패/대기 상태로 표현한다.
- **예약의 종결은 두 가지로 구분한다 (설계 결정, 미구현 — `docs/inventory-ledger-binding-review.md`).** **소진(consume)**: 출고로 실제 나감 → 재고원장 on_hand 영구 차감(SHIP 이벤트 append) + 예약 닫힘. **환원(release)**: 취소/만료로 안 나감 → on_hand 유지 + 예약만 닫힘(다시 가용). 현재 코드는 둘을 release 하나로 뭉뚱그려 출고 시 on_hand 가 줄지 않는 누수가 있다.
- _Avoid_: 출고주문 생성 실패와 재고예약 실패를 같은 사건으로 취급하기, 출고 시 예약을 소진이 아니라 환원으로 처리하기.

### 출고작업 (Outbound Task)
- 정의: 물류팀이 매일 임의 시각에 **재고예약(할당)에 성공한 출고주문들을 모아** 만드는 창고 피킹/포장 작업 묶음. 한 출고작업은 여러 출고주문을 포함하고, 출고주문별로 작업자가 추적된다.
- 작업 방식 두 가지. **개별피킹**(현행): 출고주문을 하나씩 — 송장 한 장 집어 바구니에 담고 포장대에서 상품 바코드로 검수·포장 후 송장 바코드 스캔으로 출고. **토탈피킹**(*도입 예정, 미구현*): 번호 붙은 바구니가 달린 피킹 카트로 출고작업 하나(=바구니 수만큼의 출고주문)를 한 번에 처리 — 단말기가 SKU 단위로 병합한 리스트와 로케이션을 지시하고, 작업자가 한 SKU 를 여러 바구니(=출고주문)에 분배한다.
- 현재 구조가 토탈피킹 도입을 막지 않아야 한다 (로케이션 결정 전략 seam 으로 흡수 — `docs/inventory-ledger-binding-review.md`).
- **강제출고 (forced shipment)**: 수량이 많은 상품(예: 50개 단위로 주문, 한 주문에 수백 개)은 작업자가 갯수만 대략 확인하고 해당 상품 또는 박스 전체를 **직권으로 검수완료** 처리하는 기능. 물류팀 현장 용어. 작업자 누구나 가능, 사유 입력 없음 — 데이터상 `shipment_line.forced` 플래그만 남긴다.

### 상자 (Shipment) · 운송장번호 (Invoice)  *(설계 결정, 미구현)*
- **상자(shipment)** = 물리적 택배 상자 하나 = 송장(라벨) 한 장. **출고 종결(재고 소진)의 단위.** 상자 라벨을 스캔하면 그 상자에 담긴 라인들이 출고 처리되고, 그만큼 재고원장 on_hand 가 차감된다.
- **상자 라인(shipment_line)** = `{shipmentId, fulfillmentOrderItemId, skuId, qty}`. source 출고주문 라인(FOI)을 참조하므로 **출고주문 ↔ 상자는 M:N**: 한 출고주문 라인이 여러 상자에 걸치면 **송장분할**(지금 필요), 한 상자에 여러 출고주문 라인이 모이면 **합배송**(*나중 필요, 모델만 열어둠*).
- **운송장번호(invoice)** = 택배사 API 로 발급받는 운송장번호. 상자 1:N invoice 로 **발급 이력**을 남기되(요금은 실배송 기준이라 미사용 발급을 추궁하지 않음) 복잡한 정합 모듈은 두지 않는다. 활성 운송장번호 1개.
- _Avoid_: 출고주문을 박스로 보기, 운송장번호를 상자의 string 컬럼 하나로 박기, 송장분할을 출고주문 분할로 처리하기.

### 주문 전환 용어
- **채널 주문 수집/번역**: Medusa/Naver/Coupang 주문을 Core 판매주문으로 만드는 전이.
- **출고주문 생성**: Core 판매주문을 WMS/Core 출고주문으로 넘기는 전이.
- _Avoid_: source 와 target 없이 "주문 변환"이라고만 쓰기.

### 채널 주문 수집 신뢰성
- 정의: Payment Accepted 된 채널 주문을 Core 판매주문 후보로 빠짐없이 전달해야 하는 운영 보장.
- 주문 수집에서는 중복보다 누락이 더 큰 장애다. 중복은 `(salesChannel, channelOrderId)` 멱등성으로 흡수하고, 수집 기준점은 durable 하게 기록된 주문 범위까지만 전진해야 한다.
- 증분 수집은 watermark 경계 직전의 짧은 overlap window 를 다시 읽을 수 있다. 이때 중복은 멱등성으로 흡수하고, 경계 timestamp 주문 누락을 피하는 쪽을 우선한다.
- Medusa 주문 수집의 canonical 경로는 channel-adapter 의 내부 `OrderPollerOrchestrator` 다. legacy REST `/adapter/poll` 은 Medusa 주문 수집 경로가 아니며, 수동 재처리가 필요하면 같은 durable collection 경로를 재사용해야 한다.
- _Avoid_: polling 시작/실패 시점을 성공 기준점처럼 취급하기.

### 채널 상품 식별 실패
- 정의: 채널 주문 라인이 Core 판매상품 variant 로 식별되지 않아 판매주문 라인으로 번역할 수 없는 운영 예외.
- Medusa 주문 라인에 `pimVariantId` 가 없으면 SKU 매칭 없음이 아니라 채널 상품 식별 실패다. 보통 Core Catalog 를 통하지 않고 Medusa 관리자에서 직접 만든 상품이 주문된 경우다.
- 채널 상품 식별 실패 주문은 정상 판매주문으로 조용히 생성하지 않는다. 운영자가 확인할 수 있도록 격리되어야 한다.
- _Avoid_: SKU 매칭 없음과 혼동하기, 유료 주문을 silent skip 하기.

### SKU Group — 재고상품의 느슨한 묶음
- 정의: 매우 유사한 SKU들의 묶음 (예: 같은 제품인데 색만 다른 색연필).
- 스키마: `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `skuGroups` 테이블, `skus.groupId` (nullable).
- master/variant 의 강결합과 달리 **느슨한 결합**: 묶이지 않은 SKU도 정상이고, 그룹 자체는 판매 단위가 아니라 운영 편의용 묶음.

### 판매상품 ↔ 재고상품 관계
- **두 단위는 별개 정체성이다. 1:1로 동등하지 않으며 직접 FK도 없다.**
- 둘 사이 매핑은 `apps/core/src/modules/product-matching/` 모듈이 전담한다.
- 링크 테이블: `productVariantSkuLinks` (현재 `wmsTables` 스키마 그룹에 묶여있는 것은 [[project-core-wms-pim-merge]] 통합 흔적).
- 한 variant 가 여러 SKU 와 연결될 수 있고 그 반대도 가능.
- 모든 판매상품 variant 는 궁극적으로 상품매칭 전략을 가져야 한다. 전략은 두 부류다: (1) **SKU 구성 매칭** — 재고상품과 구성 수량을 명시한다. (2) **재고상품 비매칭** — 이 판매상품은 재고상품과 매칭되지 않음을 명시한다.
- 상품매칭 전략이 없거나 아직 결정되지 않은 판매상품은 미매칭이다. 유료 주문 라인이 미매칭이면 조용히 제외하지 않고 출고주문 생성 대기/매칭 누락으로 남긴다.
- 상품매칭의 canonical 상태는 `status` 보다 `strategy` 로 해석한다. `strategy='variant'` + SKU links 는 SKU 구성 매칭, `strategy='void'` 는 재고상품 비매칭 명시, `pending` 또는 전략 없음은 미결정이다.
- 현재 스키마에서는 전략 결정 완료를 `status='matched'` 로 저장한다. 따라서 SKU 구성 매칭은 `status='matched'` + `strategy='variant'`, 재고상품 비매칭은 `status='matched'` + `strategy='void'` 로 기록한다. 이때 `matched` 는 "SKU 와 매칭됨" 이 아니라 legacy 필드의 "전략 결정 완료" 의미다.
- `void` 전략은 재고상품과의 매칭이 없음을 명시하므로 SKU 재고에 구애받지 않고 판매 가능하다.
- `void` 는 철저히 재고상품 매칭 전략이며 digital asset 매칭과 무관하다. 디지털/서비스/기타 비물리 이행 여부는 SKU 매칭의 `void` 여부가 아니라 해당 도메인의 매칭/정책이 따로 결정한다.
- `ignored` 는 기존 코드의 legacy 상태명이며 canonical 도메인 용어로 쓰지 않는다. 의도상 매칭대기 목록에서 잠시 치우는 운영 상태였고, 상품매칭 결정으로는 `pending` 과 동일한 미결정이다. 이런 숨김 기능이 필요하면 매칭 상태값이 아니라 별도 운영 플래그로 둔다.

### 판매상품 판매가능수량 (Product Sellable Quantity)
- 정의: 특정 판매상품 variant 를 고객에게 몇 개까지 판매할 수 있는지 나타내는 판매 관점의 수량.
- 판매상품 판매가능수량은 재고상품 재고량에 판매상품↔재고상품 매칭과 구성 수량을 적용해 산출한다. 예: 1호~4호 립스틱 SKU 를 각 1개씩 쓰는 세트 variant 의 판매가능수량은 네 SKU 의 판매가능 재고 중 최솟값이다.
- 판매상품의 상품매칭 전략이 재고상품 비매칭(`void`)이면 SKU 재고에 묶이지 않으므로 판매가능수량은 무제한으로 본다. 단, 상품 활성 상태와 판매기간 같은 판매 조건은 여전히 적용된다.
- SKU 재고, 판매상품↔재고상품 매칭, variant 활성 상태, 채널 노출 정책 등 의존 데이터 변경으로 판매가능수량이 달라지면 Core 는 판매상품 판매가능수량 변경 이벤트를 발행한다.
- 판매상품 판매가능수량 변경 이벤트는 원인 이벤트가 아니라 state projection 이벤트다. 소비자는 왜 바뀌었는지가 아니라 현재 최종 판매가능수량을 받는다.
- _Avoid_: SKU 하나의 물리 재고량을 그대로 판매상품 재고량으로 노출하기.

### 판매채널 재고 Projection
- 정의: 판매채널이 checkout 시 자기 로컬 데이터만으로 판매 가능 여부를 판단하도록 Core 가 계산해 전달하는 판매상품별 판매가능수량.
- Medusa inventory module 에는 Core 의 재고상품(SKU) 그래프를 복제하지 않는다. Medusa variant 의 inventory quantity 는 해당 판매상품 variant 의 Product Sellable Quantity projection 이다.
- Medusa 의 bundled product / variant-inventory M:M 기능은 Core 의 판매상품↔재고상품 매칭과 의미가 완전히 일치하지 않으므로 Core 매칭 모델을 그대로 투영하지 않는다.
- 판매채널별 재고 할당은 하지 않는다. 모든 판매채널은 같은 Product Sellable Quantity projection 을 공유하며, race condition 에 의한 일부 초과판매 위험을 감수한다.
- _Avoid_: Medusa inventory item 을 Core SKU 와 같은 정체성으로 취급하기, channel-adapter 에서 SKU 매칭/세트 재고 계산 로직을 재구현하기, 채널별 수량 배분을 기본 모델로 되돌리기.

### 라이브러리 (Library) — 디지털 fulfillment 의 한 종류 *(설계 중, 미구현)*
- 정의: **디지털 자산(DigitalAsset)** 과 그 **소유권(Ownership)** 을 관리하는 새 Core 모듈. 위치: `apps/core/src/modules/library`. 운영자 관리 surface 는 `apps/admin-web` 의 mall 영역이고, customer-facing surface 는 storefront 의 다운로드/사용 처리 화면이다. Storefront BackendService enum 의 `library` 항목은 core subdomain 을 공유한다.
- 핵심 명사:
  - **DigitalAsset** (`digitalAssets`) — 1 row = 1 파일. 메타데이터 + `file-service` 의 fileId.
  - **Ownership** (`digitalAssetOwnerships`) — 고객의 1 개 자산에 대한 영구 소유권. `License` 가 아닌 이유: 본 모델은 영구 소유이며 SaaS 적 라이선스 의미와 다름.
  - 매칭 정션 (`productVariantDigitalAssetLinks`) — variant ↔ asset M:M. SKU 매칭의 `productVariantSkuLinks` 와 대칭.
- **fulfillment 의 한 수단이지 새로운 "상품 종류" 가 아니다.** WMS 의 "택배" 와 동격: 같은 variant 가 SKU 매칭이 있으면 택배 fulfillment, asset 매칭이 있으면 라이브러리 fulfillment. 둘 다 있으면 둘 다 발생 (예: 장치 + 사용법 강의 동영상).
- **fulfillment 방식은 catalog 의 책임이 아니다.** variant/master 에 fulfillment mode 컬럼을 두지 않는다. **매칭의 존재 자체가** fulfillment 방식을 결정. 잔재의 `salesVariantPolicies.fulfillmentMode` 와 `productMatchings.inventoryManagement` (`true: 물리, false: 디지털` 주석) 는 폐기 대상.
- SKU 매칭의 `void` 는 digital asset 매칭을 뜻하지 않는다. 물리 SKU 출고가 필요 없다는 뜻일 뿐이며, 라이브러리 fulfillment 는 `productVariantDigitalAssetLinks` 로 별도 결정된다.
- 매칭 단위: **variant ↔ digital asset (M:M)**. SKU 매칭(`productVariantSkuLinks`)과 같은 단위. 정션 테이블 가칭 `productVariantAssetLinks`. variant 별로 콘텐츠가 다를 수 있음 (예: 시술동의서 양식 + 컬러 옵션은 컬러마다 다른 파일).
- 매칭은 **master 버전 격리 (CoW) 대상.** variant 가 CoW 로 clone 되면 asset 정션도 함께 clone — pricing rule cascading 과 동일 패턴. publish 시 옵션 조합이 같으면 자동 승계, 정체성이 다르면 unmatched 로 남김 (SKU 매칭의 publish-time clone 과 대칭).
- **Ownership grant 시점: `OrderCreated` 이벤트 도착 + Payment Accepted 상태.** `handleOrderCreated` 의 같은 트랜잭션 안에서 ownership row 작성. WMS 의 `pending → confirmed` 상태 전이(`POST /sales-orders/:id/confirm`, 운영자의 출고확정 액션) 와 무관 — 그건 별개 사건. 디지털은 **`fulfillment_orders` 를 거치지 않는다** — fulfillment_orders 는 sku/출고에 깊게 묶인 WMS 의 객체이고, 디지털은 "재고주문" 단계 자체가 존재하지 않음. 자세한 매커니즘은 ADR-0010.
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
