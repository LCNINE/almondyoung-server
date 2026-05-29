# 상품매칭 상태는 strategy 중심으로 해석한다

상품매칭의 도메인 결정은 "모든 판매상품 variant 는 상품매칭 전략을 가져야 한다"이다. 전략은 SKU 와 수량을 지정하는 SKU 구성 매칭과, 재고상품과 매칭되지 않음을 명시하는 `void` 전략으로 나뉜다. `void` 는 철저히 SKU/재고상품 매칭 전략이며 digital asset 매칭과 무관하다. 현재 코드에는 `status='ignored'` 가 남아 있지만, 이는 매칭대기 목록에서 잠시 치우기 위한 운영 상태였고 상품매칭 결정으로는 `pending` 과 동일한 미결정이다. 따라서 canonical 상태로 승격하지 않는다.

## Consequences

- 매칭 완료율은 SKU 구성 매칭과 `void` 전략을 모두 "전략 결정 완료"로 세야 한다.
- `pending`, `ignored`, 전략 없음, SKU 구성 매칭인데 SKU link 없음은 미결정/불완전 매칭으로 취급한다.
- 현 스키마에서는 `status='matched'` 를 "전략 결정 완료" 라는 legacy encoding 으로 사용한다. SKU 구성 매칭은 `status='matched'` + `strategy='variant'`, 재고상품 비매칭은 `status='matched'` + `strategy='void'` 로 쓴다.
- `status='ignored'` 는 새로 쓰지 않는다. 기존 `ignored` 행은 실제 의도를 감사한 뒤 `pending` 또는 `matched + void` 로 정리해야 하며, 코드가 새 `ignored` 를 만들면 안 된다.
- 기존 API 의 `ignore=true` 는 호환 입력으로만 유지하고, 의미는 `status='matched' + strategy='void'` 로 해석한다. 새 API/UI 용어는 `resolveAsVoid` 또는 `strategy='void'` 로 옮긴다.
- UI 와 문서에서는 "무시됨"을 새 도메인 용어로 쓰지 않는다. 매칭대기 목록 숨김 기능이 필요하면 매칭 상태값이 아니라 별도 운영 플래그로 표현한다.
- 출고주문 생성은 SKU link 부재만 보고 물리 출고 불필요를 판단하지 않고, `strategy='void'` 여부를 명시적으로 본다.
- 판매가능수량 계산에서 `void` 전략은 SKU 재고에 묶이지 않는 무제한 판매가능으로 처리한다. 상품 활성 상태와 판매기간은 계속 적용한다.
- 디지털/서비스/기타 비물리 이행 여부는 상품매칭의 `void` 로 추론하지 않는다. Library ownership 은 `productVariantDigitalAssetLinks` 같은 별도 도메인 매칭으로만 결정한다.

## PR Slices

1. **상품매칭 semantics 정정**
   - `ProductSellableQuantityCalculator` 에서 `status='matched' + strategy='void'` 를 무제한 판매가능으로 계산한다.
   - `ProductMatchingService.resolveMatchingPending(ignore=true)` 는 더 이상 `ignored` 를 만들지 않고 `status='matched' + strategy='void'` 를 기록한다.
   - `ignore` 명칭은 deprecated 로 취급하고, 새 내부 표현은 `strategy='void'` 로 맞춘다.

2. **어드민 상품매칭 UI 정리**
   - "무시됨/재고사용 안함" 문구를 "재고상품 비매칭" 또는 "전략 미결정" 으로 교체한다.
   - 매칭 통계는 `matched + variant` 와 `matched + void` 를 전략 결정 완료로 세고, `ignored` 는 legacy 미결정으로 별도 표시한다.
   - 기존 `ignored` 데이터는 즉시 일괄 변환하지 않고 감사 목록으로 노출한다.

3. **출고주문 생성 backlog 도입**
   - `OrderCreated` 처리 후 출고주문 생성 시도를 durable backlog 로 기록한다.
   - worker 가 backlog 를 처리해 `strategy='variant'` 는 출고주문 라인으로 만들고, `strategy='void'` 는 물리 출고 불필요로 닫는다.
   - 미결정/불완전 매칭은 `awaiting_matching` 으로 남긴다.

4. **매칭 등록 시 출고주문 재시도**
   - SKU 구성 매칭이나 `void` 전략이 등록되면, 해당 variant 를 기다리던 backlog 항목만 재시도한다.
   - 재시도는 멱등적으로 처리해 이미 출고주문이 있는 판매주문을 중복 생성하지 않는다.

5. **legacy ignored 정리**
   - 운영자가 감사한 기존 `ignored` 행을 `pending` 또는 `matched + void` 로 정리하는 migration/관리 액션을 제공한다.
   - 정리 이후 새 `ignored` 생성을 막거나 enum 제거/대체를 별도 스키마 PR 로 다룬다.
