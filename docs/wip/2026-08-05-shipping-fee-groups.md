# 배송비 그룹 작업 현황 (이슈 #524)

> 2026-08-05 작업 중단 시점 기록. 브랜치 `feat/shipping-fee-groups`, 커밋 없음(작업트리에만 있음).
> 머지 전에 이 파일은 지운다.

## 1. 무엇을 만들고 있나

"샵 간편식처럼 배송비를 별도로 받아야 하는 상품군이 있다"(#524).

기존: Medusa 배송옵션 **1개**(`기본배송` 2,500원 / `item_total ≥ 50,000` 이면 0원)가 전부.
같은 숫자가 `seed-shipping.ts` 상수·스토어프론트 컴포넌트 상수·i18n 문구 3곳에 복제돼 있었다.

### 확정된 결정 (관우님·정중식 합의)

| 항목              | 결정                                                      |
| ----------------- | --------------------------------------------------------- |
| 부과 단위         | **묶음 그룹당 1회** (네이버 `deliveryBundleGroupId` 방식) |
| 배송비 유형       | 무료 / 고정 / 조건부 무료 / 수량 비례 4종                 |
| 무료 판정 기준    | **그룹 소계** — 카트 전체 합계 아님 (관우님 지적사항)     |
| 지역별 추가배송비 | 포함. **별도 템플릿으로 분리**해 그룹이 참조              |
| 기존 기본배송     | 새 계산 엔진으로 이관 (완료)                              |
| 상품 화면 UI      | **카페24 레이아웃 + 그룹 선택**                           |
| 작업 환경         | 로컬 DB만. live/RDS 무접촉                                |

### 왜 Medusa 가격규칙(price rule)이 아니라 계산형(calculated)인가

배송비 계산 컨텍스트가 **카트 객체 그 자체**라 규칙이 볼 수 있는 값이 카트 필드
(`item_total`, `total` …)뿐이다. "이 그룹 소계가 N원 이상이면 무료"를 표현할 수 없다.

훅 주입도 막혀 있다:

| 워크플로                                        | 언제 도는가                   | `setPricingContext`                                   |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------------- |
| `listShippingOptionsForCartWorkflow`            | `GET /store/shipping-options` | 있음                                                  |
| `listShippingOptionsForCartWithPricingWorkflow` | 배송수단 담기 / 카트 갱신     | **없음** (`calculated_price: { context: cart }` 고정) |

훅으로 주입하면 **목록 표시 금액 ≠ 실제 청구 금액**이 된다. 그래서 `price_type: 'calculated'` +
커스텀 fulfillment provider 로 갔다. 조회·담기·카트변경이 전부 같은 계산 경로를 탄다.

### 데이터 소유권

```
그룹 정의(이름/유형/금액/무료기준/배송안내)  →  Medusa  shipping_profile + shipping_option.data
지역별 배송비 템플릿(제주/도서산간 금액)      →  Medusa  store.metadata.shippingAreaTemplates
상품이 어느 그룹인지 (코드 문자열)            →  Core PIM  product_master_versions.shipping_group_code
```

- **배송비 그룹 = Medusa shipping profile.** Medusa 가 카트에 담긴 profile 마다 배송수단을 하나씩
  요구하기 때문(`core-flows` 의 `validateShippingStep`)에, 이게 곧 "그룹당 1회 부과"다.
- Core 에는 Medusa id 를 저장하지 않는다(로컬/라이브 id 가 달라 이관이 깨진다). 코드만 저장.
- 지역 추가비는 계산 시점에 조회할 수 없어(provider 가 store 모듈에 접근 불가) **그룹 저장 시점에
  option.data 로 복사**한다. 템플릿을 고치면 서버가 참조 그룹을 자동 재저장한다
  (`reprovisionGroupsUsingAreaTemplate`).

## 2. 완료된 것

### Medusa (`apps/medusa`)

- `src/modules/almond-fulfillment/`
  - `calculate-shipping-fee.ts` — 순수 계산 함수 (4개 유형 + 지역 추가비)
  - `korea-postal-area.ts` — 우편번호 → 제주/도서산간
  - `service.ts` — `AbstractFulfillmentProviderService` 구현. `query` 로 상품→profile 조회
  - `provision-shipping-group.ts` — 그룹 생성/갱신, 인프라 배선, 목록, 템플릿 재프로비저닝
  - `area-templates.ts` — 지역 템플릿 CRUD (store.metadata)
  - `parse-shipping-group-input.ts` — 입력 검증
  - `types.ts`
- `medusa-config.js` — fulfillment 모듈 명시 등록 + `dependencies: [QUERY]` (**모듈 레벨에만 먹는다**)
- API: `admin/shipping-groups`, `admin/shipping-groups/[code]`, `admin/shipping-area-templates`,
  `admin/shipping-area-templates/[code]`, `store/shipping-groups`,
  `store/carts/[id]/shipping-methods/bulk`
- `store/carts/query-config.ts` — `items.product.metadata`, `items.product.shipping_profile.id` 추가
- `seed-shipping.ts` — 기본 그룹 프로비저닝으로 재작성 (옛 flat 옵션 자동 삭제·이관)
- `docker-compose.yml` — postgres 이미지 `latest` → `16` 고정 (18 부터 데이터 디렉터리 규약이 바뀌어 기동 실패)

### Core (`apps/core`)

- `catalog.schema.ts` — `product_master_versions.shipping_group_code varchar(50)` (nullable)
- 마이그레이션 `apps/core/drizzle/20260805075939_add-shipping-group-code.sql` (**로컬 적용 완료**)
- `update-master.dto.ts` / `master-version.entity.ts` / `product-version.mapper.ts` / `fieldsToCompare`
- `updateExposurePolicy` 에 `shippingGroupCode` 추가 → draft 없이 active 버전 즉시 수정 + 재싱크
- `PATCH /masters/:masterId/shipping-group`
- 일괄 변경(`BulkPolicyDto`, `product-bulk.service.ts`)에도 추가
- `packages/event-contracts/streams/product.stream.ts` `ProductSnapshot` + zod
- `projection-snapshot.assembler.ts`

### channel-adapter

- `types.ts` (`PimProductSnapshot`, metadata)
- `medusa.client.ts` — `getShippingProfileIdForGroup(code)` (코드→profile id 캐시, 모르는 코드는 기본으로 폴백 + 경고)
- `pim-medusa-sync.service.ts` — 그룹 코드로 profile 해석
- `transformers/pim-to-medusa.transformer.ts` — `metadata.shippingGroupCode`
- 백필 사본 2곳도 동기화: `apps/medusa/src/scripts/lib/transformer.ts`,
  `apps/channel-adapter/scripts/lib/pim-snapshot-builder.ts`

### admin-web

- 신규 화면 `/mall/shipping-groups` — 그룹 표 + **지역별 배송비 템플릿 섹션** (메뉴: 자사몰 관리)
- `features/mall/shipping-groups/` (템플릿, 그룹 다이얼로그, 템플릿 다이얼로그)
- `lib/api/domains/medusa/shipping-groups.ts` + `lib/services/medusa-shipping-groups.ts`
- 상품 상세: `components/general/shipping-info-block.tsx` — **카페24 `배송정보` 레이아웃**
  (기본설정 사용/개별설정 라디오 · 배송비 그룹 셀렉트 + 금액 요약 · 그룹 관리 바로가기 ·
  배송방법/배송지역/배송기간)
- 상품 draft 편집(Drawer)과 active 즉시 적용 양쪽에 동일 블록 사용
- 일괄 정책 모달에 배송비 그룹 행 추가

### storefront (`web/almondyoung-storefront`)

- `lib/api/medusa/shipping-method-policy.ts` — **profile 별로 옵션 하나씩** 선택 +
  카트에 담긴 그룹만 필터(`collectRequiredShippingProfileIds`, 판정 불가 시 fail-open)
- `lib/api/medusa/cart.ts` — `setCartShippingMethods` (bulk 라우트), `ensureCorrectShippingMethod` 다중 대응
- `checkout/callback/actions.ts` — 동일
- `contexts/shipping-groups-context.tsx` + `app/layout.tsx` — 그룹 정책을 루트에서 1회 로드
- `domains/cart/utils/build-free-shipping-progress.ts` — **그룹별** 무료배송 진행바 (50,000 하드코딩 제거)
- `domains/products/product-details/utils/describe-shipping-fee.ts` — 상품상세 배송비/배송안내 문구 동적화
  (i18n `productDetail.accordion.shippingFee*` ko/en/ja)

### 테스트

- Medusa 단위 31개 통과 (`cd apps/medusa && yarn test:unit --testPathPattern="almond-fulfillment|seed-shipping"`)
- storefront 19개 통과 (`npx vitest run src/domains/cart/utils src/domains/products/product-details/utils src/lib/api/medusa/shipping-method-policy.test.ts`)
- admin-web/core/channel-adapter 관련 jest 통과
- `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts` 2건 실패는 **이 브랜치 이전부터 깨져 있던 것**(stash 로 확인)

### 실제 계산 검증 (로컬 Medusa, 스토어 API 통해 카트 생성)

| 장바구니                   | 배송비                       | 배송수단 |
| -------------------------- | ---------------------------- | -------- |
| 일반 1만원                 | 2,500                        | 1개      |
| 일반 6만원                 | 0                            | 1개      |
| 간편식 3천원               | 3,000                        | 1개      |
| 간편식 3만원               | 0                            | 1개      |
| 간편식 2개(6천원)          | 3,000 (그룹당 1회)           | 1개      |
| 일반1만 + 간편식3천        | 5,500                        | 2개      |
| **일반6만 + 간편식3천**    | **3,000** ← 관우님 지적 해결 | 2개      |
| 제주 + 간편식3천           | 8,000                        | 1개      |
| 제주 + 일반6만 + 간편식3천 | 8,000                        | 2개      |

검증 스크립트: `/private/tmp/claude-501/.../scratchpad/verify-shipping.mjs` (임시 파일, 재작성 필요할 수 있음)

### UI 확인 (ego-lite)

- 어드민 `/mall/shipping-groups` 목록 · 그룹 추가 다이얼로그 입력 · 저장 확인
- 상품 상세에서 그룹 지정 → 토스트 · 읽기 행 갱신 · `core.product_master_versions.shipping_group_code='meal'` ·
  `ProductMasterActiveVersionChanged` 발행 확인

## 3. 2026-08-06 추가 검증 결과 (어제 남은 일 전부 종료)

1~5번 완료. 6번(결제 완료)까지 확인했다.

### ego-lite 로 확인한 것

- 어드민 `/mall/shipping-groups` — 그룹 표 + 지역별 배송비 템플릿 섹션 정상
- 그룹 폼에 카페24 항목 전부 들어옴 (배송비 유형 · 지역 템플릿 · 배송방법 · 배송지역 · 배송기간)
- 템플릿 도서산간 0 → 4,000 수정 시 **참조하는 두 그룹에 자동 전파** 확인
- 상품 상세의 카페24 `배송정보` 블록 (기본설정/개별설정 라디오 + 그룹 요약 + 배송방법/지역/기간)
- 스토어프론트 장바구니 — 그룹별 진행바 2줄, 배송비 5,500원(2,500+3,000)
- 상품상세 배송 안내가 그룹 값으로 표시 (`배송 비용 : 3,000원 (30,000원 이상 무료)`)

### 동기화 (어제 미완이던 4번)

원인은 **컨슈머가 뜨기 전에 이벤트가 발행돼 놓친 것**. 코드 문제 아님.
지금 다시 지정하니 Core → Kafka → channel-adapter inbox → Medusa 까지 끝까지 흐른다:
상품 profile 이 `샵 간편식 배송` 으로, `metadata.shippingGroupCode = meal` 로 반영됨.

### 결제 완료 (어제 미완이던 6번)

`pp_system_default` 로 결제 세션을 만들어 실제 주문 생성까지 확인:

| 시나리오 | 결과 |
|---|---|
| 그룹 2개 카트 + 그룹마다 배송수단 | **200** 주문 생성, 주문 배송비 5,500원 |
| 그룹 2개 카트 + 배송수단 1개만 | **400** `The cart items require shipping profiles that are not satisfied…` |

즉 "그룹마다 배송수단을 붙인다" 로직이 없으면 결제가 막히고, 있으면 통과한다.

### 배송비 변경 시점 문제 (관우님 문의에서 파생)

측정 결과:

- 어드민에서 그룹 금액 수정 → 그룹 자체는 즉시. 새로 담는 카트는 바로 새 금액.
- **이미 담긴 카트는 그 자리에서 안 바뀐다.** Medusa 의 `complete-cart` 는 카트에 저장된 배송비를
  그대로 청구한다(`amount: sm.raw_amount ?? sm.amount`, 재계산 없음).
- → **체크아웃 진입 시 배송수단을 강제로 다시 붙이도록** 했다
  (`ensureCorrectShippingMethod(cart, { refreshAmounts: true })`, checkout page 에서만).
  장바구니·결제 콜백에서는 하지 않는다 — 결제가 끝난 뒤에 바꾸면 결제 금액과 주문 금액이 어긋난다.
- 실측: 체크아웃 띄운 채 3,000 → 12,000 으로 바꾸고 재진입하니 카트 12,000, 결제금액 18,850원.

### 이 과정에서 같이 고친 3가지

1. **엉뚱한 그룹이 카트에 붙던 문제** — 체크아웃 페이지가 자체 필드 목록을 쓰는데
   `items.product.shipping_profile.id` 가 빠져 그룹 판정이 안 됐고, fail-open 으로 **모든 그룹**이
   붙었다(쓰지도 않는 `기본배송테스트` 가 카트에 붙어 있었다). 필드 추가로 해결.
2. **체크아웃 "배송비 ₩0" 오표시** — 배송옵션의 `amount` 를 읽고 있었는데
   `GET /store/shipping-options` 는 **계산형 옵션의 금액을 주지 않는다(null)**. 게다가 그룹이 2개면
   첫 옵션 금액만으로는 합계가 안 된다. 카트의 `shipping_total` 을 쓰도록 변경.
3. **bulk 라우트 응답에 합계 누락** — 요청한 `fields` 를 무시하고 기본값만 써서 `shipping_total` 이
   빠졌다. 요청 필드를 존중하도록 변경.

### 결제 실패 안내 문구 한국어화

`cart.complete()` 가 배송 검증에서 막히면 실패 페이지에 Medusa 영문 원문이 그대로 노출됐다.
아는 에러만 코드로 잡아 번역하고, 나머지는 원문 유지(뭉뚱그리면 CS 가 원인을 못 찾는다).

- `src/lib/api/medusa/checkout-error-code.ts` — 원문 → 코드 매핑 (+ 테스트)
- `checkout/callback/actions.ts` — 실패 리다이렉트에 코드를 실어 보냄
- `checkout/fail/page.tsx` — 코드가 잡히면 i18n 문구, 아니면 기존처럼 원문
- i18n `checkout.fail.shippingMethodMissing` / `shippingMethodNone` (ko/en/ja)

방어는 3겹이다: ①체크아웃 진입 시 그룹마다 부착 + 금액 최신화 ②콜백에서 `complete()` 직전 재보장
③그래도 어긋나면 Medusa 가 주문 생성을 거부. ③이 발동하면 이미 결제가 끝난 뒤라 문구가 중요하다.

### 캐시 관련 (앞선 우려는 틀렸다)

- 상품상세 배송비 문구는 **캐시되지 않는다**. 금액을 바꾸자 즉시 반영됐다. 손댈 것 없음.
- `listCartShippingMethods` 의 `force-cache` 도 **그대로 둬도 된다**. 이 응답에 금액이 없고
  (계산형은 null) 옵션 id·profile 만 쓰는데, 그건 그룹을 추가/삭제할 때만 바뀐다.

## 4. 남은 일

1. **배포 방식 결정 (미결)** — Medusa 컨테이너는 부팅마다 `seed-shipping` 을 돌린다
   (`CMD: db:migrate && yarn start`, `start: seed.ts && seed-shipping.ts && medusa start`).
   지금 코드는 **첫 부팅에서 기존 `기본배송` flat 옵션을 지우고 계산형으로 새로 만든다**.
   - 금액은 그대로 2,500원 / 5만원 이상 무료. 고객이 내는 돈은 안 바뀐다.
   - 실패하면 `medusa start` 까지 못 가 **컨테이너 부팅 실패**. (선례: 훅 중복 부팅 크래시)
   - 대안: 옛 옵션 삭제를 환경변수로 명시할 때만 하게 막고, 배포 후 `yarn seed:shipping` 수동 1회.
2. 정리: `docs/wip/` 이 파일 삭제, 로컬 테스트 잔여물 정리
   (`기본배송테스트` 그룹, `verify-normal`/`verify-meal`/`verify-digital` 상품,
   `apps/admin-web/.env.local` 의 로컬 `MEDUSA_API_KEY`).

### 하지 않기로 한 것

- **샵 간편식 28개 상품 일괄 지정 — 안 한다.** 라이브에는 기본배송 그룹(2,500원 / 5만원 이상 무료)
  하나만 붙인다. 간편식 같은 추가 그룹은 배포 후 어드민에서 직접 만든다.
  (확인: 라이브 복제본의 기존 배송옵션은 2,500원이다. 3,000원이 아니다.)

## 4. 로컬 환경 상태

### 인프라 (루트 `docker-compose.yml` — **이게 진짜 로컬 개발 데이터**)

```bash
cd /Users/jeongjungsig/github/almondyoung-server && docker compose up -d
```

볼륨 `almondyoung-server_local_postgres_data` 에 core / medusa / user_service / wallet /
membership / channel_adapter / ugc / analytics / file_service / notification DB 가 다 있다.

> ⚠️ `apps/medusa/docker-compose.yml` 의 postgres 는 **별개의 빈 DB**다(볼륨 `medusa_*`).
> 두 compose 가 같은 5432 를 쓰므로 동시에 띄우면 안 된다. 루트 것을 쓸 것.

### 기동한 서비스

| 서비스          | 포트 | 기동 방법                                                                                  |
| --------------- | ---- | ------------------------------------------------------------------------------------------ |
| medusa          | 9000 | `cd apps/medusa && npm run dev`                                                            |
| core            | 3100 | `npx dotenv -e apps/core/.env -- node dist/apps/core/main.js` (`npx nest build core` 선행) |
| user-service    | 3000 | `npx dotenv -e apps/user-service/.env -- node dist/apps/user-service/main.js`              |
| channel-adapter | 3003 | `npx nest build channel-adapter` 후 동일 패턴                                              |
| storefront      | 8000 | `cd web/almondyoung-storefront && npm run dev`                                             |
| auth-web        | 8001 | `cd web/auth-web && npm run dev` — **없으면 어드민 로그인이 안 된다**                      |
| admin-web       | 8002 | `cd apps/admin-web && npm run dev`                                                         |

로그인: `wjdwndtlr1024` / `a123123!` (어드민은 OIDC → auth-web 경유)

### 로컬 전용 설정 변경 (커밋하면 안 되는 것)

- `apps/admin-web/.env.local` 의 `MEDUSA_API_KEY` 를 로컬 발급 키로 바꿔놓았다
  (`sk_7425c795...`). 원래 값은 `dev-secret` 이었고 그대로면 어드민의 Medusa 프록시가 401.
  로컬 Medusa 어드민 계정도 새로 만들었다: `dev@local.test` / `devpass123`.

### 이번에 밟은 함정

- **`dependencies` 는 모듈 레벨에만 먹는다.** provider 항목에 적으면 무시되고 `query` 주입이 안 된다.
- **`updateShippingOptionsWorkflow` 는 prices 없는 calculated 옵션에서 깨진다**
  (mikro-orm populate 에러). `fulfillmentModuleService.updateShippingOptions(id, data)` 직접 호출로 우회.
- **shipping option 의 `data` 갱신은 JSON 병합**이다. 빼먹은 키는 옛 값이 남는다
  (조건부무료 → 고정 으로 바꿔도 옛 `freeThreshold` 가 살아남음). 그래서 항상 전 필드를 채운다.
- **`query.graph({entity:'product', filters:{shipping_profile_id}})` 는 안 된다** (링크 테이블 컬럼).
  링크 엔티티 `product_shipping_profile` 을 직접 조회한다.
- **`/store/shipping-options` 는 카트 profile 로 걸러주지 않는다.** 배송권역의 모든 옵션을 준다.
- **Medusa 기본 `POST /store/carts/:id/shipping-methods` 는 기존 배송수단을 전부 지우고 새로 만든다.**
  그래서 그룹 2개 카트는 `bulk` 라우트가 없으면 결제가 불가능하다.
- **core 로컬 마이그레이션이 타임스탬프 역전으로 막혀 있었다.** `add-coming-soon-flag` 의
  `__drizzle_migrations.created_at` 이 journal 의 `when` 보다 과거라 재적용을 시도하다 실패.
  해당 행의 `created_at` 을 journal 값(`1785812469776`)으로 맞춰서 풀었다.
- **storefront `"use server"` 파일은 async export 만 가능** — 타입/상수는
  `shipping-group-types.ts` 로 분리했다.
- `npm install --no-save vitest` 가 `web/almondyoung-storefront/yarn.lock` 을 건드렸다. 되돌려 놨다.

## 5. 아직 정하지 않은 것

- 카페24 나머지 배송비 유형 3종(금액별/무게별/수량별 구간 차등). 계산 함수에 switch 분기 추가로 확장 가능.
  무게별은 상품 무게 데이터가 비어 있어 선행 작업 필요.
- 반품/교환 배송비 (네이버 `claimDeliveryInfo`)
- 도서산간 우편번호 목록의 어드민 편집 (지금은 `korea-postal-area.ts` 코드 상수)
- 죽은 `product_master_versions.shipping_method_id` 컬럼 제거 (destructive → 별도 PR)
- 부분선택 장바구니 프리뷰의 배송비 오차 (`build-cart-summary-totals.ts`, 기존 갭)

내일은 docker compose up -d 후 문서의 "로컬 환경 상태" 표대로 띄우시면 됩니다. 첫 할 일은 medusa 재기동해서 새 API 라우트 반영 확인, 그다음이 channel-adapter 동기화가 왜 안 넘어갔는지입니다.
