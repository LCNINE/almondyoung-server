# 타임세일 가격 공개 제한 — 가격이 나가는 경로

가격 공개 제한 세일은 `settings.environment.membershipPriceOnly` 또는 세일별 `display.membershipPriceOnly` 가 켜진 세일이다.

1차 방어는 가격표 구조다. 저장 워크플로(`apps/medusa/src/workflows/time-sale/save-time-sale.ts`)가 일반 세일 가격표를 만들지 않고, 이미 있던 것은 지운다. 멤버십 가격표의 룰은 클라이언트 값을 버리고 서버가 정한다: `customer.groups.id = MEDUSA_MEMBERSHIP_GROUP_ID` 와 `region_id = 전체 region`. 그룹 설정이 없거나 region 이 없으면 400 이다. 이렇게 하면 비회원과 일반회원에게는 Medusa 가격 계산 단계에서 세일가가 아예 없다.

`region_id` 룰을 붙이는 이유가 있다. Medusa pricing 은 평탄화한 컨텍스트 키가 10개를 넘으면, 가격 룰에 실제로 쓰인 속성만 남긴다(`PricingRepository.calculatePrices`). 이 속성 목록은 캐시되고, 같은 프로세스에서 가격표를 생성·수정하면 비워진다. 카트 컨텍스트는 `region.*` 때문에 키가 10개를 넘는다. 이때 룰 속성에 `region_id` 가 없으면 걸러진 컨텍스트가 비고, 룰 매칭을 건너뛰는 분기로 가 멤버십 가격표가 비회원 카트에 적용된다.

최종 방어는 결제다. `complete-cart.ts` 의 기존 validate 훅 안에서 검사한다. 비공개 세일 상품이고, 결제 시점에 멤버십 회원이 아니며, `unit_price` 가 고객 그룹 없는 컨텍스트로 계산한 정상가보다 낮으면 결제를 거절한다. 거절 메시지는 장바구니를 새로고침하라고 안내한다.

응답 가공(`hideTimeSalePrices`)은 2차 방어다. 타임세일 설정을 읽지 못하면 상품 응답은 경고 로그를 남기고 가공 없이 나간다(fail-open). 가격은 1차 방어가 지키기 때문이다. 결제 검사는 먼저 카트 상품이 활성 타임세일에 걸렸는지 본다. 걸린 상품이 있을 때만 설정을 읽고, 이때 설정을 읽지 못하면 결제를 거절한다(fail-closed).

| 경로 | 가격 필드 | 비회원·일반회원 처리 | 테스트 |
| --- | --- | --- | --- |
| `GET /store/products`, `/store/products/:id`, `/store/products-sorted`, `/store/membership-products`(앞의 것으로 프록시) | `variants[].calculated_price`, `variants[].prices`, `variants[].metadata.membershipPrice` 및 별칭, `metadata` | `calculated_price` 는 정상가로 남고, 그 안의 membership 이름 필드는 지운다. 가격표에 속한 `prices` 항목, 멤버십가 metadata 와 별칭, `price_list(s)`, `membership_price` 는 지운다. `metadata.timeSalePriceHidden = true` 로 표시한다 | `membership-filter.unit.spec.ts`, `integration-tests/http/time-sale-price-privacy.spec.ts` |
| `/store/carts/*` line item | `unit_price`, `subtotal`, `compare_at_unit_price` | 세일 가격표가 없으므로 정상가로 담긴다. 공개 세일가로 이미 담긴 카트도 갱신하면 정상가로 바뀐다. 멤버십 회원만 멤버십 세일가로 담긴다 | `time-sale-price-privacy.spec.ts` (익명·일반회원·멤버십 카트, 비공개 전환 후 갱신한 카트의 unit_price·subtotal·compare_at) |
| 결제 `POST /store/carts/:id/complete` | line item `unit_price` | 비회원 라인이 정상가 미만이면 400 으로 거절한다. 갱신 안 한 카트와 멤버십이 끊긴 고객이 여기에 해당한다 | `time-sale-price-privacy.spec.ts` (갱신 없는 카트 거절, 멤버십 해지 후 거절, 회원·비회원 정상 결제) |
| `GET /store/time-sale` | 없음(세일 기간·상품 id·표시 설정만) | 그대로 | 해당 없음 |
| 관리자 설정 저장 `POST /admin/time-sale-settings` | 해당 없음 | 세일의 가격 공개 제한이 바뀌는 저장은 대상 세일이 하나라도 있으면 400 이다. 세일 화면에서 세일별로 저장해야 한다 | `time-sale-settings.unit.spec.ts`, `time-sale-price-privacy.spec.ts` |
| 세일 활성화 `POST /admin/time-sales/status` | 해당 없음 | 비공개 세일에 일반 가격표가 남아 있으면 활성화를 400 으로 거절한다 | 코드 리뷰로 확인(재현하려면 DB 를 직접 조작해야 함) |
| 스토어프론트 SSR(상품 카드, 상세, 홈 타임세일, 장바구니) | 위 응답의 숫자 | 받은 정상가만 HTML 에 들어간다. `timeSalePriceHidden` 이면 멤버십가 자리에 「멤버십 회원에게 가격 공개」를 둔다(카드·상세: `getHideMembershipPriceForNonMembers`, 홈 타임세일: `packages/time-sale-ui` 의 sale_price) | storefront tsc |
| Next fetch 캐시 | 상품 목록·상세 | 캐시 키에 인증 헤더와 `x-membership-segment` 가 들어가 회원과 비회원이 같은 항목을 공유하지 않는다(`lib/data/membership-cache-tags.ts`) | 기존 |
| `apps/search` 응답 | `min/max_base_price`, `min/max_membership_price` | Core PIM 스냅샷의 정가와 상시 멤버십가다. Medusa 타임세일 가격표는 색인하지 않으므로 세일가는 이 경로로 나가지 않는다 | 해당 없음 |
