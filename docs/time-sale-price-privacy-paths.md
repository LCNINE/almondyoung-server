# 타임세일 멤버십 전용 특가 — 가격이 나가는 경로

멤버십 전용 특가는 일반 세일가 없이 멤버십 세일가만 있는 옵션이다. 일반가를 바꾸기 어려운 상품(국내 브랜드 등)을
멤버십 회원에게만 기간 할인할 때 쓴다. 어드민 상품진열에서 기간판매가를 비우고 멤버십 기간판매가만 넣으면 된다.

## 가격표 구조가 1차이자 최종 방어다

세일 하나는 가격표 두 개를 가진다(`apps/medusa/src/workflows/time-sale/rules.ts` 머리 주석).

- 일반용: 룰 `region_id` → 전원
- 멤버십용: 룰 `customer.groups.id = MEDUSA_MEMBERSHIP_GROUP_ID` → 멤버십 회원

멤버십 전용 특가 옵션은 멤버십용 가격표에만 가격 행이 있다. 비회원 가격 컨텍스트에는 고객 그룹이 없으므로
Medusa 가 그 가격표를 아예 고르지 않는다. 회원은 상시 `Membership Prices` 와 이 가격표 중 싼 쪽을 받는다
(둘 다 룰 1개라 `rules_count` 가 같고, 그다음 `amount` 오름차순으로 고른다).

일반용 가격표는 멤버십 전용 품목만 있는 세일에서도 비어 있는 채로 만든다. 수정·복구 로직
(`planTimeSaleUpdate`, `findTimeSaleIssues`)이 일반용 가격표가 늘 있다고 전제한다.

### 컨텍스트 키가 10개를 넘을 때

Medusa pricing 은 평탄화한 컨텍스트 키가 10개를 넘으면, DB 의 가격 룰에 쓰인 속성만 남긴다
(`@medusajs/pricing` `PricingRepository.calculatePrices`). 이 속성 목록은 프로세스 메모리에 캐시된다.

- 남은 컨텍스트가 비면 룰 0개짜리 가격과 가격표만 고른다(`pl.rules_count = 0`). 멤버십용 가격표는 룰이 1개라
  비회원에게 새지 않는다.
- 캐시된 목록에 `customer.groups.id` 가 빠져 있으면 회원이 특가를 못 받는 쪽으로 틀린다(비회원에게 새는 쪽이 아니다).
  상시 `Membership Prices` 가 같은 속성을 쓰므로 운영에서는 늘 들어 있다.

## 경로별 처리

| 경로 | 비회원 | 회원 | 테스트 |
| --- | --- | --- | --- |
| `GET /store/time-sale` | 세일 기간·상품 id 와 함께 `membershipOnlyVariantIds`·`membershipOnlyProductIds` 를 준다. **금액은 싣지 않는다** — 공개 캐시(`revalidate: 60`)라 회원·비회원이 같은 응답을 받는다 | 같다 | `rules.unit.spec.ts` (`membershipOnlyItems`) |
| `/store/products*` | `calculated_price` 는 정가. 멤버십가 비공개 상품이면 기존 미들웨어(`utils/membership-filter.ts`)가 `metadata.membershipPrice` 를 지운다 | `calculated_price` 가 특가 | 기존 |
| `/store/carts/*` 라인 | 정가로 담긴다 | 특가로 담긴다(`compare_at_unit_price` 는 정가) | 로컬 실측(2026-10-12) |
| 결제 | 별도 검사 없다. 가격은 가격표가 정한다 | 같다 | — |

## 스토어프론트 표시

비회원에게 특가 금액을 보여 주지 않는다. 표시만 바꾼다.

| 자리 | 비회원 | 회원 |
| --- | --- | --- |
| 상품 카드(`product-card/price.tsx`) | 정가 + 「멤버십 회원 공개」, 배지 「멤버십 특가 · 남은 시간」 | 정가 + 「멤버십 특가 N원」 |
| 상품 상세(`product-preview-price`) | 같다 | 같다 |
| 타임세일 매대·더보기(`packages/time-sale-ui`, `sale-products.ts`) | 정가 + 「멤버십 회원에게 가격 공개」 | 정가 + 「멤버십 특가 N원」 |
| 장바구니·결제(`lineTimeSale`) | 타임세일 표시 없음 | 「타임세일 멤버십 특가」 + 마감 카운트다운 |

장바구니는 회원 여부를 따로 묻지 않는다. 멤버십 전용 옵션 라인 중 `compare_at_unit_price > unit_price` 인 것,
즉 할인이 실제로 들어간 라인만 세일로 본다.

옵션이 섞인 상품(일반 세일 옵션 + 멤버십 전용 옵션)은 상품 단위로는 일반 세일로 본다
(`membershipOnlyProductIds` 에서 빠진다). 카드는 대표 옵션이 무엇이냐에 따라 표시가 갈린다.

## 부수 효과

`subscribers/membership-benefit-order.ts` 는 고객 그룹 없이 다시 계산한 가격과의 차이를 멤버십 혜택으로 센다.
멤버십 전용 특가로 산 주문은 정가와의 차액 전부가 멤버십 혜택으로 잡히고, 환불 한도 계산에도 그대로 쓰인다
(의도된 동작, 2026-10-12 확인).
