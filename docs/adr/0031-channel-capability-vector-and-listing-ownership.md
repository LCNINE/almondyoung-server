# 채널 차이는 능력 벡터로 표현하고, 채널상품 매핑의 정본은 Core 가 갖는다

네이버·쿠팡 주문 수집을 켜기 전에, "Medusa 와 다른 채널은 무엇이 어떻게 다른가" 를 한 번 정한다. 지금 그 차이는 다섯 군데에 흩어져 있고 그중 한 곳(출고)만 명시적인 능력 표를 갖는다. 이 ADR 은 그 표를 정본으로 승격하고, 함께 정해야만 답이 나오는 SoT 경계를 못 박는다.

[[0013-sales-channels-hold-commerce-projections]] 를 뒤집지 않는다. 그 ADR 이 정한 "Core 가 commerce SoT, 판매채널은 projection, 채널이 Core 를 직접 호출하지 않는다" 는 그대로다. 이 ADR 이 더하는 것은 그 문장이 **채널상품 자체에는 적용되지 않는 경우**가 있다는 사실과, 그 경우를 어떤 어휘로 구분할지다.

이 ADR 은 문서다 — 코드 변경 0건, 마이그레이션 0건. 구현은 후속 PR 과 이슈로 쪼갠다.

## Decision

### 1. 채널 차이는 코드 상수의 능력 벡터로 표현한다

- `CHANNEL_FULFILLMENT_CAPABILITIES`(`apps/channel-adapter/src/services/channel-fulfillment-capabilities.ts`)를 `CHANNEL_CAPABILITIES` 로 승격한다. 거처는 **코드 상수**, 키는 **`@packages/event-contracts` 의 `SalesChannel`**.

- **DB 가 아니라 코드인 이유는 exhaustive `Record` 다.** 이 표의 값어치 절반은 채널을 추가할 때 컴파일러가 결정 누락을 요구한다는 것이고(파일의 기존 주석이 이미 그렇게 선언한다), DB 로 옮기면 그 자리가 런타임 `undefined` 분기로 바뀐다.

- **능력은 채널 *종류*의 성질이지 계정의 성질이 아니다.** 스마트스토어 계정을 둘 만들어도 "상품을 우리가 못 만든다" 는 같다. 측정: 어댑터 크레덴셜은 전부 env 다(`naver-auth.client.ts:40`, `coupang-base.client.service.ts:53`). `sales_channels.credentials` 컬럼은 CRUD 로 저장되지만 **런타임에서 읽는 코드가 없다**(`sales-channels.service.ts:262–265` 는 주석 처리). 즉 오늘 구조는 채널 타입당 계정 1개이고, 계정이 여러 개가 되는 날에도 능력은 타입에 남고 계정은 `sales_channels` 행이 갖는다.

### 2. 표의 모양 — 나가는 쓰기는 route, 성질은 스칼라, 외부 연동 없음은 판별 유니온

- 기존 `ChannelFulfillmentRoute` 의 discriminator 를 **나가는 쓰기 전반으로 일반화**한다: `route: 'projection' | 'adapter' | 'manual' | 'none'`. 적용 축은 상품 · 재고 · 출고.

- **`none` 과 `manual` 을 구분한다.** `none` 은 "그 채널엔 그 개념이 없다"(설계상 비대상, 조용한 no-op), `manual` 은 "해야 하는데 자동화가 없다"(사람이 하고, 운영 큐에 남는다). 이 구분이 없으면 *미구현*과 *비대상*이 섞인다. 지금 네이버·쿠팡의 상품·재고 sync 가 아무 일도 안 하면서 `success: true` 를 돌려주는 stub 인 것(`naver-smartstore.adapter.ts:274`, `coupang.adapter.ts:137,149`)이 정확히 그 혼동의 산물이다. `none` 이면 그런 stub 이 존재할 타입 자리가 없다.

- **`manual` 은 반드시 durable 한 운영 큐에 남아야 한다.** 준거 사례는 출고다: `manual` route → `channel_dispatch_operations.status='manual_adjustment_required'` + 사유(`shipment-dispatch-inbox.worker.ts:347`) → admin-web 이행 상세가 읽음(`features/order/fulfillments/detail/channel-dispatch-model.ts:102`). **두 번째 큐는 두 번째 소비자가 생길 때 함께 만든다** — 지금 상품·재고 push 를 만들 계획이 없는데 큐부터 만들면 소비자 없는 테이블이 하나 더 생긴다(`channel_products` 가 정확히 그 길을 걸어 아래 결정 5에서 폐기 대상이 됐다).

- **스칼라 두 축을 더한다.**
  - `productOwnership: 'ours' | 'theirs'` — 채널상품의 *내용*을 누가 만드는가.
  - `lineIdentity: 'embedded' | 'mapped'` — 채널이 우리 식별자를 보관하는가(Medusa variant metadata, 네이버 판매자관리코드, 쿠팡 externalVendorSku), 아니면 매핑을 조회해야 아는가.

- **`orderCollection` 과 `sellableQuantity` 는 아직 축이 아니다.** 전자는 세 채널이 모두 provider 라 값이 하나뿐이고, 후자는 [[0011-shared-sellable-quantity-across-sales-channels]] 가 이미 "모든 판매채널이 같은 수량을 공유" 로 못 박았다. **값이 하나뿐인 축은 아직 축이 아니다.** 실제로 다른 동작이 필요해질 때 추가한다.

- **외부 연동이 없는 채널은 판별 유니온으로 가른다.** `fulfillment` 는 모든 `SalesChannel` 이 공통으로 갖고, `productProjection` · `inventory` · `lineIdentity` · `orderCollection` 은 `integration: 'api'` 인 채널만 갖는다.

  ```ts
  type ChannelCapabilities =
    | { integration: 'none'; fulfillment: Route }
    | { integration: 'api'; fulfillment: Route; productProjection: Route;
        inventory: Route; lineIdentity: 'embedded' | 'mapped'; orderCollection: 'provider' }
  ```

  `3pl` 이 `integration: 'none'` 이다. 측정: `3pl` 주문은 channel-adapter 를 거치지 않고 Core 의 SO 생성 경로로 직접 들어오며(`sales-orders.service.ts:212`), admin-web 은 **전화주문을 `3pl` 로 매핑**한다(`features/order/matching/template/index.tsx:20`). 즉 외부 API 가 아예 없는 수기 채널이다. 이 유니온은 **주문 수집 provider 가 필요한 채널의 집합**을 타입으로 정확히 표현하므로, 새 수기 채널이 생겨도 provider 를 요구받지 않는다.

- 오늘의 값:

  | | medusa | naver | coupang | 3pl |
  |---|---|---|---|---|
  | `integration` | api | api | api | **none** |
  | `productOwnership` | ours | theirs | theirs | — |
  | `productProjection.route` | projection | none | none | — |
  | `lineIdentity` | embedded | mapped | mapped | — |
  | `inventory.route` | projection | manual¹ | manual | — |
  | `fulfillment.route` | projection | adapter | adapter | manual |

  ¹ 네이버는 `updateOptionStock` 이 이미 구현돼 있으나 배선되지 않았다 — 그래서 `none` 이 아니라 `manual` 이고, 배선하면 `adapter` 로 승격된다.

### 3. 채널상품의 *내용* SoT 는 능력에 따라 갈린다

- `productOwnership: 'theirs'` 인 채널(네이버·쿠팡)에서는 **채널이 채널상품 내용의 SoT** 다. 채널 상품명·이미지·상세·가격이 Core 판매상품과 달라도 drift 가 아니라 정상이다.

- **Core 가 SoT 이고 언젠가 push 로 수렴시킨다는 선택은 기각한다.** 그러면 [[0024-core-catalog-projection-snapshot-assembler]] 가 정한 Projection Snapshot 계약(가격 계산 필수, 옵션 표시문자열 필수, 미충족 시 publish 차단)을 네이버·쿠팡의 카테고리·옵션 모델·심사에 강제하게 되고, **publish 가 채널 사정으로 막히는** 실패 모드가 생긴다.

- 따라서 `ProductMasterActiveVersionChanged` 는 `productProjection.route: 'none'` 인 채널에 대해 **no-op** 이다.

- **대가를 명시한다: link 채널 주문의 `unitPrice` 는 채널이 준 값을 그대로 싣고, Core 계산가와 달라도 정상으로 받는다.** 그 차이를 delta 로 기록하지 않는다 — 정산은 별도 도메인이고, 여기서 delta 를 만들면 판매주문이 정산 장부가 된다([[0016-post-acceptance-order-lifecycle-boundaries]] 가 막은 방향).

- **반면 상품명은 Core 값을 싣는다.** `OrderItem` 계약은 이미 `masterId`/`versionId`/`variantId`/`productName` 을 묶어 갖고 있어 Core 정체성이 정본이고, 창고 피킹 리스트와 CS 화면이 채널마다 다른 이름을 보면 운영이 갈린다. `OrderItem` 에 `channelProductName` 같은 필드를 더하지 않는다 — 채널 원문은 격리 스냅샷 `rawOrder` 에 통째로 남는다.

### 4. 채널상품 ↔ variant **매핑**의 정본은 능력과 무관하게 Core 가 갖는다

- 정본은 `channel_variant_listings`(`apps/core/src/modules/catalog/schema/catalog.schema.ts`) 하나다. 스키마 · CRUD API · admin 화면(`/mall/channel-listings`)이 이미 있다.

- **`productOwnership: 'ours'` 인 채널도 리스팅 row 를 갖는다.** channel-adapter 가 상품 projection 에 성공하면 리스팅을 upsert 한다. 측정상 추가 조회가 필요 없다 — `pim-medusa-sync.service.ts:617` 이 이미 `medusaVariant.metadata.pimVariantId` 로 두 식별자 쌍을 손에 쥔다.

- **row 는 *선언*, 채널의 metadata 는 *관측*이다.** 주문 라인 식별의 fast path 는 여전히 metadata(`lineIdentity: 'embedded'`)이고, 리스팅 row 는 "우리가 무엇을 올렸는지의 기록" 이다. 둘이 어긋나면 metadata 가 식별을 이기고, 불일치는 운영 화면에 드러낸다.

- **이 결정의 요점은 격리 큐가 하나가 된다는 것이다.** "Medusa 관리자에서 직접 만든 상품이 주문됨"(CONTEXT §채널 상품 식별 실패 — 리스팅 row 도 metadata 도 없음)이 네이버의 미매핑과 *같은 큐*로 들어온다. 지금 그 격리는 되지만 볼 화면이 없다(`grep '/adapter/' apps/admin-web/src` → 0건).

- **리스팅 승계를 publish 에 붙인다.** `channel_variant_listings.variantId` 는 `product_variants.id` 를 고정하는데, variant 는 draft 편집 시 CoW 로 새 row 가 된다([[0004-variant-draft-scoped-edit-cow]]). 측정: 이 테이블에 쓰는 코드는 자기 CRUD service 뿐이고 **publish/CoW 경로에 재지정이 없다.** 따라서 `_reconcileChannelListingsAfterPublish` 를 추가한다 — publish 에 이미 같은 모양의 reconciler 가 둘 있다(`_reconcileMatchingsAfterPublish` `product-versions.service.ts:325`, `_reconcileAssetLinksAfterPublish` `:328`).
  - **전 채널을 같은 트랜잭션에서 승계한다.** link 채널만 승계하면 publish 직후 projection 이 도착하기 전까지 짧은 창 동안 row 가 옛 variant 를 가리킨다.
  - **옵션 조합이 안 맞아 승계하지 못하면 리스팅은 끊고 미매핑으로 남긴다.** 기존 매칭 승계와 정확히 같은 규칙이라 운영자가 배울 규칙이 하나로 유지된다: *"옵션 정체성이 바뀌면 매칭도 리스팅도 끊기고, 운영자가 다시 잇는다."* 옛 variant 에 남겨두는 선택은 끊긴 것을 안 끊긴 것처럼 보이게 만들어 최악이다.

- **장기 방향(이 ADR 에서 채택하지 않음): 리스팅 키를 `variantCode` 로 옮긴다.** `variantCode` 는 CoW 를 넘고(`_cloneVariant` 가 그대로 복사 — `product-variants.service.ts:390`), 스키마 주석이 이미 *"외부 식별자(채널 어댑터에서 Medusa barcode 로 매핑)"* 라고 적고 있으며 실제로 transformer 가 `barcode: variant.variantCode` 로 내보낸다(`pim-to-medusa.transformer.ts:307`). 그러면 승계 자체가 필요 없어진다. 채택하지 않은 이유는 **`variantCode` 가 nullable 이고 자동 발번이 없기 때문**이다 — publish 는 non-null 끼리 중복만 보고(`product-versions.service.ts:365–378`), 자동 발번되는 건 master 의 `productCode`(`AY-10001`) 뿐(`:293`). notNull 승격은 expand-contract 3 PR 짜리라 이 ADR 의 범위를 넘는다.

### 5. `channel_products` 는 폐기 대상이다

`channel_products`(master ↔ channel 오버라이드)는 `channel_variant_listings` 와 개념이 겹치고 grain 만 다르다(master vs variant). 둘을 남기면 "채널상품이 무엇이냐" 가 다시 두 벌이 된다. 그리고 **이 테이블은 양쪽 경로가 모두 죽어 있다** — 측정:

- **읽기**: 상품 상세 assembler 가 `channelProducts` 를 **하드코딩된 빈 배열**로 내보낸다(`product-read.assembler.ts:141`). 스펙도 그 사실을 고정한다(`product-read.assembler.spec.ts:83` — `expect(detail.channelProducts).toEqual([])`).
- **쓰기**: 유일한 호출자는 주문 매칭 화면의 `ProductRegistrationDialog.tsx:182` 인데, `masterId` 를 아예 보내지 않고 `channelId` 자리에 채널 *이름* 문자열(`line.salesChannel || 'other'`)을 넣는다. `CreateChannelProductDto` 는 둘 다 `@IsUUID()` 로 필수다. 즉 **이 호출은 항상 실패하며, 화면이 그 실패를 의도적으로 삼킨다**(`console.warn('채널상품 생성 실패(무시하고 매칭 진행)')`). 코드에도 *"CreateChannelProductDto의 상세를 몰라도 …"* 라는 추측 주석이 달려 있다.

CRUD controller + service 490줄이 그 위에 얹혀 있다. 이 ADR 은 선언만 하고, 삭제는 별도 PR 로 다룬다(drop 은 expand-contract 상 2 PR). **선행 조건은 프로덕션 행 수 확인이다** — 위 분석은 "지금 이 경로로는 행이 안 생긴다" 를 말할 뿐, 과거 다른 경로로 생긴 행이 없다는 증명이 아니다.

### 6. 채널 활성화는 능력이 아니라 운영 결정이다

- 채널 on/off 는 `sales_channels.is_active`(DB)가 갖는다. 컬럼도 어드민 화면도 이미 있다. **능력(불변 사실)과 활성(운영 결정)을 한 상수에 섞지 않는다.**

- `ACTIVE_CHANNELS` env 는 폐기한다. 측정: 이 env 는 후속 정리에서 삭제될 얕은 수집 층 3곳에서만 쓰인다(`channel-sync.manager.ts:174`, `channel-command.manager.ts:114`, `channel-adapter.service.ts:301`) — 곧 주인을 잃는다.

- **대가: 수집 orchestrator 가 폴링마다(5분) Core 에 채널 목록을 묻는다.** 새 의존이지만 부담은 낮다.

- **조회 실패 시 마지막 성공 목록 캐시로 fail-open 한다.** 수집은 "중복보다 누락이 더 큰 장애"(CONTEXT §채널 주문 수집 신뢰성)이므로, Core 가 잠깐 안 뜬다고 수집을 멈추면 그동안의 라이프사이클 관측이 밀린다. 첫 부팅에 조회가 실패하면 캐시가 없으니 그 주기는 건너뛴다.

- **능력 표에 없는 `site` 로 운영자가 채널을 만들면 무시하되 경고를 남긴다.** 부팅 실패는 어드민 오타 하나로 서비스를 죽인다. 조용히 무시하면 "왜 이 채널 주문이 안 들어오지" 가 다시 생기므로 경고는 필수다.

### 7. 채널 어휘의 정본은 `SalesChannel` 이다

표의 키가 흔들리지 않도록 정본을 선언한다: `@packages/event-contracts/streams/orders.stream.ts` 의 `SalesChannel`(`medusa | naver | coupang | 3pl`). `ChannelType`(`naver_smartstore` …), `ShipmentSalesChannel`, `adapter.stream` 의 `ChannelType`, `sales_channels.site` 는 모두 여기서 파생되거나 이 값으로 정렬된다.

**선언만 하고 구현은 쪼갠다.** `sales_channels.site` 의 데이터 정렬(시드가 넣는 `'MEDUSA'` → `'medusa'`; lookup 은 `eq(salesChannels.site, channelCode)` 로 대소문자를 그대로 비교한다 — `channel-listing.service.ts:118`)은 데이터 마이그레이션이 붙으므로 별도 PR 이다.

**`site` 위에 이미 능력 판단이 하나 올라가 있다.** `channel-listing.service.ts:365` 의 `isExternalMarketplaceSite(site)` 가 `site === 'naver' || site === 'coupang'` 로 하드코딩해 외부 마켓플레이스에 디지털 상품 리스팅을 막는다. 이것은 성격상 `CHANNEL_CAPABILITIES` 에 속하는 판단이 자유 문자열 비교로 Core 에 눌러앉은 사례다. 다만 **Core 는 channel-adapter 의 능력 표를 import 할 수 없으므로**(서비스 경계) 이 판단을 그대로 옮길 수는 없다 — 능력 표를 어디까지 공유 패키지로 올릴지는 이 ADR 의 범위 밖이고, 세 번째 사례가 생기면 재검토한다.

## Why this shape

- **"퍼스트파티 / 서드파티" 이분법을 기각한다.** Medusa 가 다른 건 소유 구조가 아니라 능력이다 — 우리가 상품을 만들어 넣을 수 있고(`productOwnership: ours`), 우리 식별자를 심을 수 있다(`lineIdentity: embedded`). 자사몰이라도 카페24 였다면 `theirs + mapped` 였을 것이다. 등급으로 나누면 채널이 늘 때마다 "이건 어느 등급이지" 를 다시 다투게 되고, 등급 안에서 축이 갈리는 첫 사례에서 규칙이 깨진다.

- **능력 표를 새로 만들지 않고 있는 것을 넓힌 이유.** `CHANNEL_FULFILLMENT_CAPABILITIES` 는 이미 `projection` / `adapter` / `manual` 이라는 정확한 discriminator 를 갖고 있고 소비자(dispatch worker)가 그걸로 분기한다. 새 어휘를 만들면 같은 개념이 두 이름을 갖는다.

- **매핑 정본을 Core 에 두는 이유.** 매핑 부재는 주문을 격리시키는 **운영자 결정 사항**이고, 그 결정을 내리는 화면이 이미 Core 쪽에 있다. 매핑을 채널마다 다른 곳에 두면 운영 화면이 채널 수만큼 갈린다. 반대 방향(매핑을 channel-adapter 가 소유)도 가능하지만, 그러면 admin-web 이 상품 편집 중에 channel-adapter 를 따로 불러야 하고 `channel_variant_listings` 의 variant FK 가 서비스 경계를 넘는다.

- **`row = 선언 / metadata = 관측` 으로 가른 이유.** 둘 다 정본이라고 하면 불일치에 답이 없다. 식별의 정본을 metadata 로 고정하면 오늘 Medusa 수집 경로가 그대로 살고(추가 조회 0), row 는 감사·운영 목적의 선언으로 의미가 분명해진다.

## Consequences

- 채널 추가 비용이 "표 한 줄 + provider 하나" 로 수렴한다. 다섯 결정을 컴파일러가 요구하므로 누락이 조용히 지나가지 않는다.
- 네이버·쿠팡의 상품·재고 stub 3개가 타입상 존재할 자리를 잃는다.
- Medusa 상품 projection 에 리스팅 upsert 쓰기가 하나 붙는다. 기존 Medusa 상품에 대한 백필이 필요하다.
- publish 트랜잭션에 reconciler 가 하나 늘어난다(현재 2 → 3).
- 수집 orchestrator 에 Core 조회 의존이 하나 생긴다(폴링당 1회, fail-open).
- **격리 큐 화면이 필수가 된다.** 이 결정 이전에는 링크 채널을 안 켜서 미뤄둘 수 있었지만, Medusa 식별 실패까지 같은 큐로 모으기로 한 이상 볼 화면이 없으면 격리가 블랙홀이 된다.
- 마이그레이션 0건 · 이벤트 계약 변경 0건 · secret/env 변경 0건 (이 ADR 자체는 문서).

## 후속 이슈

| 이슈 | 내용 | 결정 |
|---|---|---|
| #638 | `channel_products` 폐기 (코드 제거 → DROP, 2 PR) | 5 |
| #639 | `sales_channels.site` 를 `SalesChannel` 어휘로 정렬 | 7 |
| #640 | 미매핑 주문 격리 큐 운영 화면 (`/mall/channel-listings` 통합) | 4 |
| #641 | (장기) `variantCode` notNull + 자동 발번 → 리스팅 키 이관 | 4 |

능력 표 승격(결정 1·2)과 리스팅 승계 reconciler(결정 4)는 별도 이슈를 두지 않는다 — 주문 수집 층 재정비 PR 과 함께 간다.

## 재검토 트리거

- **한 채널 타입에 계정이 둘 이상 필요해지면** 능력은 코드에 남기고 계정·자격을 `sales_channels` 행으로 내리는 혼합 구조로 확장한다. 표의 키가 `SalesChannel` 인 채로 유지되는지가 그때의 판단 지점이다.
- **어떤 축의 값이 채널 간에 실제로 갈리면 그때 축으로 승격한다.** 지금 `orderCollection` 과 `sellableQuantity` 를 축으로 만들지 않은 근거가 "값이 하나뿐" 이므로, 값이 둘이 되는 순간 근거가 소멸한다.
- **`manual` route 의 두 번째 소비자가 생기면** 그 기능과 함께 durable 운영 큐를 만든다. 큐 없는 `manual` 은 이 ADR 위반이다.
- **`variantCode` 가 notNull + 자동 발번으로 승격되면** 리스팅 키를 `variantCode` 로 옮기고 승계 reconciler 를 제거할지 재검토한다.
- **Core 안에서 채널 이름으로 분기하는 세 번째 사례가 생기면** 능력 표(또는 그중 Core 가 알아야 하는 축)를 `@packages` 공유 코드로 올릴지 재검토한다. 현재 사례는 `isExternalMarketplaceSite` 하나뿐이라 옮기지 않는다.
- **네이버·쿠팡에 상품을 우리가 만들기로 하면** 결정 3(내용 SoT = 채널)이 그 채널에 한해 뒤집힌다. 그때 [[0024-core-catalog-projection-snapshot-assembler]] 의 snapshot 계약을 그 채널 모델에 맞출 수 있는지가 선결 조건이다.
