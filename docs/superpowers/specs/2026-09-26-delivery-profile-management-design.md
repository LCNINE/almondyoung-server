# 배송 프로필 관리 + 새 SKU 프로필 필수화 — 설계

- 날짜: 2026-09-26
- 관련: #923 §H (계획 확정 draft → planned)
- 상태: 승인됨 (구현 계획 대기)

## 1. 왜

출고 사슬(계획 확정 → 운송장 → 배치 → dispatch)은 상자가 `planned` 여야 시작된다. `plan()`
(`apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` `assertPlanProfile`)은
상자의 모든 SKU 가 **같은 `delivery_profile_id`** 를 갖고, 그 프로필이 완전하기를 요구한다.

2026-09-25 라이브 판정(`scripts/ops/outbound-cutover-preflight.ts` §2)에서:

- `delivery_profiles` **0행**, 열린 상자 SKU 전부 프로필 없음 → 라이브 `planned` 상자 0
- 프로필을 **만드는 경로가 코드에 없다** — INSERT 는 테스트 픽스처와 데모 시드뿐, API·화면·마이그레이션 0

기존 SKU 백필은 **보류**한다(사용자 결정) — 일부 SKU 는 3PL 물류라 송하인에 우리 정보를 넣으면 안 될 수 있다.
대신 **앞으로 만들어지는 SKU 는 프로필을 필수**로 해서 구멍이 더 커지지 않게 한다.

## 2. 결정 요약

| 항목 | 결정 |
|---|---|
| 묶음 | 프로필 생성 경로 + 선택기 + 필수 검증을 **한 PR** |
| 필수 대상 | `stock_type` 이 `physical`·`consignment` 인 SKU. `drop_shipped`·`infinite` 는 선택 |
| 수정 시 | **값이 실제로 바뀔 때만** 수정 후 상태를 검사 (§4.2) |
| 관리 범위 | 목록·생성·수정. **삭제 없음** |
| 주소 형식 | 구조화 필드 |
| 규칙 위치 | `SkuCatalogManager` 도메인 검증 (DTO 데코레이터·DB CHECK 아님, §4.3) |

## 3. core — 배송 프로필 API

위치: `apps/core/src/modules/inventory/delivery-profile/` — `warehouse/` 모듈과 같은 모양
(controllers / dto / mappers / services, 모듈 파일). Controller → Service → Reader/Manager 계층.
테이블은 이미 있다(`inventory.schema.ts` `deliveryProfiles`) — **마이그레이션 0건**.

### 3.1 엔드포인트

| 메서드 | 경로 | 스코프 | 비고 |
|---|---|---|---|
| GET | `/inventory/delivery-profiles` | `INVENTORY_SCOPE.OPERATE` | 이름순. 각 행에 `skuCount`(연결된 SKU 수) |
| GET | `/inventory/delivery-profiles/:id` | `INVENTORY_SCOPE.OPERATE` | 없으면 404 |
| POST | `/inventory/delivery-profiles` | `INVENTORY_SCOPE.MANAGE` | 201 |
| PATCH | `/inventory/delivery-profiles/:id` | `INVENTORY_SCOPE.MANAGE` | 없으면 404 |

쓰기 스코프는 SKU 생성(`POST /inventory/skus`)과 같은 `MANAGE` — 프로필을 붙이는 사람이 만들 수도 있어야 한다.
읽기는 SKU 조회와 같은 `OPERATE`. 컨트롤러에 `ScopeGuard` + `@RequireScopes` 를 붙인다
(`@RequireScopes` 를 붙이면 `AdminRealmGuard` 가 비켜서므로 매핑이 곧 권한이다 — `inventory-scopes.ts` 매핑 변경 없음).

### 3.2 DTO

중첩 객체는 별도 클래스(`@ApiProperty({ type: 'object' })` 금지 규칙).

```
CreateDeliveryProfileDto
  name: string                       필수, 1~128자
  sourceType: 'direct'|'in_house'|'overseas'   필수
  avgDeliveryDays?: number           선택, 정수 ≥ 0
  sender: DeliveryProfileSenderDto   필수
  originAddress: DeliveryProfileAddressDto   필수
  returnAddress: DeliveryProfileReturnAddressDto   필수
  carrierAccountRef: string          필수, 공백 불가, ≤ 255자 (화면 이름 「택배 계약번호」)
  supportedFulfillmentModes: ('in_house'|'3pl'|'drop_ship')[]   필수, 1개 이상, 중복 없음

DeliveryProfileSenderDto          { name: string; phone: string }            둘 다 필수·공백 불가
DeliveryProfileAddressDto         { postalCode: string; roadAddress: string; detailAddress: string }
                                                                            postalCode·roadAddress 필수, detailAddress 는 빈 문자열 허용
DeliveryProfileReturnAddressDto   DeliveryProfileAddressDto + { phone?: string }

UpdateDeliveryProfileDto = PartialType(CreateDeliveryProfileDto)
  — 중첩 객체는 보낼 때 «통째로» 보낸다(부분 병합 없음). 보낸 객체는 위 규칙대로 전부 검증된다.
```

**생성은 완전한 프로필만 받는다.** 필드 규칙이 곧 `assertPlanProfile`·`assertProfileComplete`
(발송인 `name`·`phone`, 스냅샷 3개 비어 있지 않음, `carrierAccountRef`, 이행 방식) 를 만족시키도록 짜여 있다 —
불완전한 프로필은 만들어 봐야 계획 확정에서 다시 막히기 때문이다. `PATCH` 도 결과가 완전함을 깨지 못한다
(필수 필드를 빈 값으로 보내면 DTO 가 거부하고, 필드를 빼면 기존 값이 남는다).

### 3.3 저장 모양 (jsonb)

`sender_snapshot = { name, phone }` — 하류가 읽는 키(`sender.name ?? sender.senderName`)와 일치.
`origin_address_snapshot = { postalCode, roadAddress, detailAddress }`,
`return_address_snapshot = { postalCode, roadAddress, detailAddress, phone? }` —
수취인 스냅샷(`recipientName·phone·postalCode·roadAddress·detailAddress`)과 같은 키 이름을 써서,
나중에 한진 요청·라벨이 env(`HANJIN_SENDER_*`) 대신 프로필을 읽게 될 때 그대로 쓸 수 있게 한다(3PL 송하인 분리의 전제).
`handling_flags` 는 이 API 가 읽지도 쓰지도 않는다.

### 3.4 응답

`DeliveryProfileResponseDto` — id, name, sourceType, avgDeliveryDays, sender, originAddress, returnAddress,
carrierAccountRef, supportedFulfillmentModes, skuCount(목록에서만 채움, 상세는 생략 가능), createdAt, updatedAt.
jsonb → DTO 변환은 매퍼 한 곳(`delivery-profile.mapper.ts`)에서만 한다. 픽스처·데모 시드의 옛 모양
(`{ address: '…' }`)이 들어 있어도 매퍼가 죽지 않게, 모르는 키는 빈 문자열로 정규화한다.

## 4. core — SKU 프로필 필수 규칙

### 4.1 판정 함수

`apps/core/src/modules/inventory/sku-catalog/sku-delivery-profile.rule.ts` (순수, DB 없음):

```ts
export const DELIVERY_PROFILE_REQUIRED_STOCK_TYPES = ['physical', 'consignment'] as const;
export function requiresDeliveryProfile(stockType: StockType): boolean;

/** 위반이면 사유를, 아니면 null. create 는 before=null. */
export function deliveryProfileViolation(
  before: { stockType: StockType; deliveryProfileId: string | null } | null,
  after: { stockType: StockType; deliveryProfileId: string | null },
): 'SKU_DELIVERY_PROFILE_REQUIRED' | null;
```

- 생성(`before=null`): `requiresDeliveryProfile(after.stockType) && !after.deliveryProfileId` 이면 위반
- 수정: **`stockType` 또는 `deliveryProfileId` 의 값이 before 와 달라졌을 때만** 위 판정을 after 에 적용.
  둘 다 그대로면 위반 아님

### 4.2 수정 규칙을 «키 존재»가 아니라 «값 변화»로 두는 이유

admin-web SKU 수정 폼(`features/inventory/skus/components/sku-form-dialog/index.tsx`)은 수정 때마다
`stockType` 을 **항상** 보낸다. 「요청에 키가 있으면 검사」로 두면 프로필 없는 옛 SKU(라이브 대부분)의
이름만 고쳐도 400 이 난다. 값 비교면 그 경우는 통과하고, 다음은 막힌다:

- 프로필을 `null` 로 지움 (physical·consignment 인 SKU)
- `drop_shipped`/`infinite` → `physical`/`consignment` 로 바꾸면서 프로필 없음
- physical 인 옛 SKU 에 프로필을 «다른 것으로 바꾸는» 건 허용(after 가 규칙 만족)

### 4.3 위치와 기각한 대안

`SkuCatalogManager.create` / `update` 가 트랜잭션 안에서 판정한다. 매칭의 「새 SKU」(`MatchingLinkResolver`)도
`SkuCatalogService.create` 를 거치므로 **한 곳이 두 경로를 덮는다**. `create` 의 유효 `stockType` 은
`dto.stockType ?? 'physical'` (컬럼 DEFAULT 와 동일). `update` 는 현재 행을 `FOR UPDATE` 로 읽어 before 로 쓴다.

- ✗ DTO(class-validator) 조건부 필수 — 수정 후 상태(현재 행 필요)를 볼 수 없다
- ✗ DB CHECK `NOT VALID` — 새 행뿐 아니라 **옛 행의 모든 UPDATE** 에도 검사가 걸려, 프로필 없는 옛 SKU 수정이 전부 실패한다

### 4.4 에러

- 위반: `SkuDeliveryProfileRequiredError extends ApplicationException` — `getErrorCode() = 'SKU_DELIVERY_PROFILE_REQUIRED'`,
  400. 메시지에 SKU 이름·재고 유형을 담는다. (전역 필터가 `getErrorCode()` 를 응답 `error` 로 내보낸다 —
  `libs/shared/src/filters/http-exception.filter.ts`)
- 존재하지 않는 `deliveryProfileId`: 지금은 FK 위반으로 500 이다 → 삽입·수정 전에 존재를 확인해 400
  `SKU_DELIVERY_PROFILE_NOT_FOUND` (같은 방식의 하위 클래스)

### 4.5 이 규칙이 닿지 않는 경로

`scripts/sellmate/import-products.ts` 는 원시 SQL 로 `skus` 에 INSERT 한다 — 운영 스크립트라 범위 밖.
컷오버로 셀메이트를 버리면 함께 사라진다. 스크립트 머리 주석에 「이 경로는 프로필 필수 규칙을 우회한다」 한 줄을 남긴다.

## 5. admin-web

### 5.1 새 화면 `/inventory/delivery-profiles`

창고 화면(`app/(admin)/inventory/warehouses`, `features/inventory/warehouses/`)과 같은 구조.
`requireRole={['admin','master']}` 로 창고 화면과 같게(`admin` 은 inventory 스코프 전부를 가져 쓰기 API 도 통과). 메뉴(`lib/utils/menu.ts`) 재고 그룹에 「배송 프로필」 항목.

- 목록 표: 이름 · 원천 유형 · 발송인 · 출고지(도로명) · 택배 계약번호 · 이행 방식 · 사용 SKU 수 · 수정 버튼
- 「새 프로필」 버튼 → 생성·수정 공용 다이얼로그
- API 클라이언트 `lib/api/domains/inventory/delivery-profiles.client.ts` + 쿼리키 팩토리 + mutation 훅
  (쿼리키는 인자 없는 팩토리의 `undefined` 함정을 피한다 — 목록 키는 상수 배열)

### 5.2 다이얼로그 폼 → 페이로드

폼 상태 → `CreateDeliveryProfileDto`/`UpdateDeliveryProfileDto` 변환과 필드 검증을
순수 함수 `features/inventory/delivery-profiles/lib/profile-form.ts` 로 뺀다
(admin-web 은 컴포넌트 테스트가 불가능하다 — 판정은 `.ts` 로).
수정 시엔 바뀐 필드만 보내되 중첩 객체는 통째로.

### 5.3 SKU 등록·수정 폼

`sku-form-dialog` 에 「배송 프로필」 Select(목록 API). 필수 여부 판정은 core 규칙과 **같은 모양의**
순수 함수 `features/inventory/skus/lib/delivery-profile-requirement.ts` 로:
등록이면 physical·consignment 일 때 필수, 수정이면 재고 유형이나 프로필 값이 원래와 달라졌을 때만 필수.
서버가 최종 판정자이고 이건 헛걸음 방지용이다. 수정 페이로드에는 프로필이 바뀌었을 때만 `deliveryProfileId` 를 넣는다.

### 5.4 매칭 다이얼로그 「자동」 탭

`features/order/matching/components/table/InventoryMatchingDialog.tsx` 자동 탭에 공급처·보유자 옆
「배송 프로필」 Select 하나(필수). `AutoTabState` 에 `deliveryProfileId` 를 더하고
`buildMatchingLinks`(`features/order/matching/lib/build-matching-links.ts`)가 각 `newSku` 에 넣는다.
빠지면 기존 `missing-required` 로 거부. 자동 탭이 만드는 SKU 는 `stockType` 을 안 보내 `physical` 이므로 항상 필수다.

### 5.5 프로필 0개일 때

두 폼 모두 목록이 비었으면 Select 자리에 「배송 프로필을 먼저 등록하세요」 + 새 화면 링크.
배포 직후 프로필을 만들기 전까지 물리 SKU 생성·매칭 자동 탭이 400 이 나는 창에서 헛걸음을 줄인다.

## 6. 배포

- 마이그레이션 0건. 한 SST 스택이라 core·admin-web 순서는 없다.
- **배포 직후 사람 작업: 배송 프로필 1개 생성** (새 화면). 그 전까지 물리 SKU 생성과 매칭 자동 탭은 400 이다.
  매칭 대기(#923 §E)를 푸는 작업자에게 미리 알린다.
- 판정: `scripts/ops/outbound-cutover-preflight.ts` §2 의 「완전한 배송 프로필」 이 ✓ 로 바뀐다.
  (기존 SKU 는 백필 보류라 §2 의 「열린 상자 SKU 프로필 없음」 ✗ 는 그대로 남는다 — 정상)

## 7. 테스트

core
- `sku-delivery-profile.rule.spec.ts` — 생성 4 재고 유형 × 프로필 유무, 수정 값 변화 매트릭스(§4.2 목록 전부 + 이름만 수정 통과)
- `create-delivery-profile.dto.spec.ts` — 필수·공백·이행 방식 빈 배열·중복·잘못된 enum
- `delivery-profile.mapper.spec.ts` — 옛 모양 jsonb 정규화
- `delivery-profile.manager.integration.spec.ts` (`describeIfDb`) — 생성·수정·목록 `skuCount`, 생성 결과가
  `assertProfileComplete` 를 통과함(계획 확정과의 계약)
- `sku-catalog.manager.integration.spec.ts` (`describeIfDb`) — 생성 거부/통과, 수정 값 변화 규칙, 없는 프로필 400,
  매칭 `newSku` 경로도 거부됨
- 컨트롤러 스코프 바인딩은 기존 가드 스펙(`apps/core/src/platform/auth/scope-guard-binding.spec.ts`)이 파일 이름으로 잡는다 — 파일명을 `delivery-profile.controller.ts` 로 둘 것

admin-web (`npm run test:admin-web`, `.ts` 만)
- `profile-form.spec.ts` · `delivery-profile-requirement.spec.ts` · `build-matching-links.spec.ts` 확장

게이트: `npm run type-check`, `npx jest`, `cd apps/admin-web && npx tsc --noEmit` (루트 type-check 는 admin-web 을 안 본다).
화면 배선(`.tsx`)은 CI 가 안 보므로 로컬 브라우저 스모크를 PR 에 적는다.

## 8. 범위 밖

- 기존 SKU 백필 (보류 — 3PL SKU 송하인 판단 필요)
- 한진 요청·라벨이 env 대신 프로필 발송인을 읽게 바꾸기 (3PL 송하인 분리의 다음 단계)
- 프로필 삭제
- 셀메이트 `import-products.ts` 에 규칙 적용
- 계획 확정 일괄 처리 (#923 §H 의 별도 항목)
