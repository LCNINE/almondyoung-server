# 출시예정(coming soon)은 날짜가 아니라 재고가 연다

## Status
Accepted (2026-08-03).

## Context
MD 가 신상품을 등록할 때, 물건이 아직 안 들어온 구간에서 스토어프론트가 "품절" 로 표시된다.
아직 한 번도 판 적 없는 상품에 "품절" 은 틀린 안내이고, 신상품을 죽은 상품처럼 보이게 한다.
요구는 그 구간에 "곧 출시 예정" 을 보여달라는 것이었다.

관련해서 이미 있던 것들:

- `product_master_versions.sales_start_date` — 미래면 계산기가 `SALES_NOT_STARTED` 로 판매가능수량을 0 으로 만든다. 다만 **쓰기 경로가 엑셀 임포트뿐**이고 admin 화면에 편집·해제 수단이 없다.
- `variant.metadata.inboundDate` — 품절 시 "○월 ○일 입고 예정" 안내. core `inbound_plans` → Medusa 동기화(수동 스크립트)로 채워진다.
- `sales_variant_policies.availability_override = 'manual_out_of_stock'` — 노출은 유지하되 판매가능수량을 0 으로 만드는 수동 품절.
- 입고(`RECEIVE` stock event)가 기록되면 `stock-event.store.ts` 가 같은 트랜잭션에서 sellable 재계산을 부르고, 그 결과가 Medusa 재고까지 전파된다.

즉 "물건이 들어오면 자동으로 팔린다" 는 이미 성립한다. 없는 것은 그 구간의 **표시**와, MD 가
그 구간을 선언할 **입력 수단**뿐이었다.

## Decision

### 1. 출시예정은 날짜 게이트가 아니라 재고 게이트다
판매를 여는 것은 **입고**다. 날짜는 판매 개시를 트리거하지 않는다.

`sales_start_date` 를 재사용하지 **않는다**. 그 필드는 계산기가 판매를 막는 데 쓰이므로,
재고가 예정일보다 먼저 들어오면 물건이 있는데도 못 파는 상태가 된다. 해외 발주는 예정일이
밀리거나 당겨지는 게 정상이라 이 충돌이 예외가 아니라 기본값이 된다.

### 2. 상태는 `availability_override = 'coming_soon'` 하나
`varchar(32)` 라 값 추가에 마이그레이션이 필요 없다. 의미는:

> 아직 물건이 없다. 재고 없이 파는 모든 경로(선판매·항상판매·void)를 무시하고 실재고로만 판정하며,
> 품절 대신 "곧 출시 예정" 으로 표시한다.

`manual_out_of_stock` 과 상호배타다 — 둘 다 `availability_override` 한 칸을 쓴다.

### 3. 선판매·항상판매를 이긴다
`preStockSellable`(재고 0 이어도 팔아라)과 `alwaysSellableZeroStock`(항상 팔아라)은 출시예정에
진다. "아직 물건이 없다" 가 더 강한 사실이기 때문이다. 수동 품절이 선판매를 이기는 기존 규칙과
같은 계열이다.

영구 무력화가 아니다 — 입고되는 순간 플래그가 자동 해제되므로 선판매 정책은 그때 복원된다.

### 4. 재고가 붙으면 플래그를 자동 해제한다
`recalculateAndPublishForVariant` 에서 `stockBoundQuantity > 0` 이면
`availability_override` 와 `coming_soon_date` 를 비운다. 해제하지 않으면 두 가지가 샌다:

- 선판매·항상판매가 계속 눌린 채로 남는다.
- 나중에 **진짜** 품절됐을 때 "곧 출시 예정" 이 되살아난다 (stale `inboundDate` 와 같은 종류의 사고).

관리자가 나중에 뭘 풀어줄 일이 없다는 것이 이 설계의 핵심 이점이다.

### 5. 날짜(`coming_soon_date`)는 표시 전용이다
`sales_variant_policies.coming_soon_date` (date, nullable). 비우면 "곧 출시 예정",
채우면 "8월 10일 출시 예정" 으로 표시된다. 판매 개시와는 무관하다.

날짜가 지났는데 물건이 안 온 경우는 **정상적으로 발생한다**. 그때 지난 날짜를 그대로 노출하면
8월 20일에도 "8월 10일 출시 예정" 이 걸려 있게 되므로, 스토어프론트가 지난 날짜를 버리고
"곧 출시 예정" 으로 되돌린다 (`pickEarliestRestock` 이 stale `inboundDate` 를 버리는 것과 같은 이유).

`product_sellable_quantity_projections` 에도 같은 컬럼을 둔다. 날짜만 고친 경우 `reason` 이
그대로라, 이 컬럼이 없으면 변경 감지에서 "변경 없음" 으로 접혀 Medusa 까지 전파되지 않는다.

## Consequences

- **전파 경로**: `sales_variant_policies` → 계산기 → `ProductSellableQuantityChanged` →
  `medusa.client.ts::applyProductSellableQuantityProjection` → `variant.metadata.{comingSoon, comingSoonDate}`
  → 스토어프론트. `inboundDate` 와 같은 자리·같은 방식이다.
- **표시 우선순위**: 출시예정 > 재입고예정 > 품절. 한 번도 안 나온 상품에 "재입고" 는 틀린 안내다.
- **캐시 무효화**: 출시예정 토글은 재고 0 → 0 이라 기존 `soldOutChanged` 판정에 걸리지 않는다.
  metadata 변경도 무효화 대상에 포함시켰다.
- **비회원 게이팅**: `membership-filter.ts` 가 `comingSoon`/`comingSoonDate` 도 지운다.
  안 지우면 멤버십 전용 상품의 출시일이 비회원에게 샌다.
- **실재고가 안 붙는 상품은 자동 해제되지 않는다.** 해제 트리거가 `stockBoundQuantity > 0`
  하나뿐이라, 그 값이 영영 0인 상품은 트리거가 오지 않는다. 해당하는 것은 두 가지다:
  - void 매칭 — 실재고가 없는 상품(디지털 등)이라 입고로 풀릴 일이 없다.
  - `alwaysSellableZeroStock` — 애초에 재고를 안 세려고 켜는 플래그다(직배 등). 실입고가
    잡히면 걷히지만, 그런 운영이 아니면 안 걷힌다.

  둘 다 관리자가 직접 체크를 풀어야 한다. 즉 §4 의 "관리자가 나중에 뭘 풀어줄 일이 없다" 는
  이 두 경우에는 성립하지 않으므로, 어드민이 해당 조합에서 그 사실을 경고한다
  (`willComingSoonClearOnStock`). 계산기는 이 경우도 판매를 막는다 — "출시 예정" 이라고
  써놓고 팔리는 것보다 놀람이 적다.
- **어드민 품절 배지에는 집계하지 않는다.** `SOLD_OUT_REASONS` 에 `COMING_SOON` 을 넣지 않았다.
  관리자가 의도적으로 건 상태라 목록에서 품절로 뜨면 원인을 찾게 만든다.
- **부수 수정**: 판매시작일이 미래인데 선판매가 켜진 상품은 `sellable = 0` 인데도
  `allow_backorder = true` 로 나가 구매가 가능했다. `sales_start_date` 를 쓰는 상품이 거의 없어
  드러나지 않았을 뿐인 기존 결함으로, 같은 규칙(강제 품절이면 백오더 차단)으로 함께 막았다.

## Follow-ups
- `sales_start_date` 는 여전히 엑셀 임포트가 유일한 쓰기 경로다. 출시예정과는 별개 축(판매기간)이며
  admin 편집 수단이 없는 상태 그대로 남는다.
- `inbound_plans` → `variant.metadata.inboundDate` 동기화는 수동 스크립트(`sync-restock-to-medusa.ts`)다.
  출시예정 날짜는 이와 독립적으로 관리자가 직접 넣는 값이라 영향받지 않는다.
- 출시예정 토글을 variant 테이블 컬럼에도 노출할지는 미정. 현재는 variant 편집 다이얼로그에만 있고,
  여러 상품 일괄 적용은 기존 배치 API 를 쓴다.
