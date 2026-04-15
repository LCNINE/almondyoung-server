# Medusa 멤버십가 처리 방식 개선안: Price List → Variant Price Rules

## 1. 배경

### 1.1 현재 구조

PIM은 상품/옵션에 대해 **일반가(basePrice)** 와 **멤버십가(membershipPrice)** 를 포함한 가격 레이어를 정의한다.
channel-adapter는 PIM 이벤트(`ProductMasterActiveVersionChanged`)를 수신해 Medusa에 동기화하며, 현재는 아래와 같이 두 가지 다른 메커니즘을 혼합해 사용한다:

| 가격 종류 | 저장 위치 | 비고 |
|----------|----------|------|
| 일반가 | `variant.prices[]` | rule 없음(default) |
| 멤버십가 | `Price List` (`type: "sale"`, rule: `customer.groups.id`) | 전역 "Membership Prices" 단일 Price List에 모든 variant 가격이 누적 |
| 수량 할인 | `Price List` (`type: "sale"`, `min_quantity`별 분리) | "Tiered Prices - Min N" 형태 |

멤버십 상태 변경(가입/해지)은 `MEDUSA_MEMBERSHIP_GROUP_ID`의 Customer Group add/remove로 처리하며, 이후 `POST /admin/customers/:id/refresh-cart-prices`를 fire-and-forget으로 호출해 카트 가격을 재계산한다.

### 1.2 현재 구조의 문제점

1. **의미의 오남용** — Medusa의 Price List는 원래 한시적 프로모션/세일을 위한 기능인데, 상시 가격인 멤버십가를 저장하는 데 사용 중이다. 향후 실제 시즌 세일/프로모션을 도입할 때 Price List가 이미 멤버십으로 점유되어 있어 혼재된다.

2. **`compare_at_unit_price` 수동 보정** — Price List(`sale` 타입) 사용의 부작용으로, 카트/주문의 `compare_at_unit_price`가 의도한 값(일반가)이 되지 않아, `refresh-cart-prices` API 내부의 `fixCompareAtPrices()` 커스텀 로직으로 보정하고 있다. 이는 "Medusa 표준 기능을 그대로 사용"이라는 원칙에서 벗어난다.

3. **동기화 복잡도** — product upsert와 price list batch API 호출이 분리되어 있고, Price List는 모든 상품에 대해 전역 단일로 관리되므로 한 variant의 가격 변경 시에도 Price List batch에 접근해 create/update/delete 분기를 수행해야 한다.

4. **디버깅 난이도** — 한 상품의 멤버십가를 확인하려면 variant와 Price List를 따로 조회해야 하고, Admin UI에서도 상품 화면과 Price List 화면을 오가야 한다.

### 1.3 개선 원칙

사용자 합의에 따라 다음 원칙을 기준으로 한다:

- Medusa의 기본 기능을 가능한 한 적극 사용하고, 완전한 커스텀은 최후의 수단
- Medusa의 다른 표준 기능(주문, 결제, 카트)과 자연스럽게 호환
- Medusa가 매번 PIM/membership 서비스로 동기 호출하는 것을 피한다
- 외부 서비스와의 번역은 channel-adapter가 담당

---

## 2. 제안: Variant Price Rules 사용

### 2.1 핵심 아이디어

멤버십가를 **variant의 `prices[]` 배열 내부에 Price Rule이 적용된 개별 price로 저장**한다. Price List를 사용하지 않는다.

```typescript
variants: [
  {
    prices: [
      // 일반가 (default, rule 없음)
      { amount: 30000, currency_code: "krw" },

      // 멤버십가 (customer group rule)
      {
        amount: 25000,
        currency_code: "krw",
        rules: { "customer.groups.id": MEMBERSHIP_GROUP_ID },
      },

      // (선택) 수량 할인 (일반)
      { amount: 28000, currency_code: "krw", min_quantity: 10 },

      // (선택) 수량 할인 (멤버십)
      {
        amount: 23000,
        currency_code: "krw",
        min_quantity: 10,
        rules: { "customer.groups.id": MEMBERSHIP_GROUP_ID },
      },
    ],
  },
]
```

### 2.2 동작 메커니즘

Medusa v2 Pricing Module은 `calculatePrices(priceSetId, { context })`에서 context(currency, customer group, quantity 등)를 기준으로 **best match**를 자동 선택한다:

1. context의 모든 rule과 정확히 매치되는 price가 있으면 그 price 선택
2. 정확한 매치가 없으면, context의 rule 중 가장 많이 매치되는 price 선택
3. 아무 rule도 매치되지 않으면 default price(rule 없는 가격) 선택

Medusa 표준 워크플로우(`createCartWorkflow`, `addToCartWorkflow` 등)는 customer 정보를 자동으로 pricing context에 포함시키므로, 멤버십 고객이 카트에 상품을 담으면 자동으로 멤버십가가 적용된다.

`original_amount`(rule 없는 가격) vs `calculated_amount`(customer group 매칭 가격)이 Medusa에 의해 자동 계산되므로, **프론트엔드는 이 두 값을 비교하기만 하면 된다**. `compare_at_unit_price` 수동 보정이 불필요하다.

### 2.3 Price List의 올바른 용도 확보

Price List는 본래 용도(한시적 프로모션/시즌 세일, `starts_at`/`ends_at` 활용)로 해방된다. 향후 "여름 세일 −20%"와 같은 프로모션이 필요할 때 Price List로 깔끔하게 표현할 수 있고, 멤버십가와 프로모션이 동시에 적용되는 경우도 Medusa의 표준 우선순위 계산에 맡길 수 있다.

---

## 3. 아키텍처

### 3.1 데이터 흐름

```
┌─────┐   ProductMasterActiveVersionChanged   ┌──────────────────┐
│ PIM │ ────────────────────────────────────► │ channel-adapter  │
└─────┘           (Kafka event)               │  (inbox worker)  │
                                              └────────┬─────────┘
                                                       │
                                                       ▼
                                   transform(snapshot) → variant.prices[] 배열
                                   (basePrice + membershipPrice as Price Rule)
                                                       │
                                                       ▼
                              ┌────────────────────────────────────┐
                              │ Medusa upsertVariantPricesWorkflow  │
                              │  (or updateProductsWorkflow)         │
                              └────────────────────────────────────┘

┌────────────┐  MembershipStatusChanged   ┌──────────────────┐
│ membership │ ────────────────────────► │ channel-adapter   │
└────────────┘                            │                   │
                                          ├─ customer group  │
                                          │   add/remove     │
                                          └─ refresh-cart    │
                                              (fire-forget)   │
```

채널 경계와 직접 호출 회피 원칙은 그대로 유지된다. Medusa는 PIM/membership 서비스에 동기 호출하지 않고, channel-adapter가 이벤트 수신 후 Medusa 표준 API/Workflow로 데이터를 밀어넣는다.

### 3.2 channel-adapter 변경 범위

**수정 대상:**

- `apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.ts`
  - `variant.prices` 생성 로직 확장: `basePrice` + `membershipPrice`(rules 포함) + `tieredPrices` 모두 포함
  - 환경변수 `MEDUSA_MEMBERSHIP_GROUP_ID`를 transformer에 주입하거나 상위에서 합성

- `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts`
  - `syncPriceLists()` 호출 제거 (membership/tiered 모두 variant.prices로 이동)
  - product upsert 한 단계로 통합

- `apps/channel-adapter/src/adapters/medusa/medusa.client.ts`
  - `ensurePriceList`, `addPricesToPriceList`의 멤버십/tiered 용도 호출 지점 제거
  - 메서드 자체는 프로모션용으로 남겨둘지 별도 결정 (남겨두는 것을 권장)

- `apps/channel-adapter/src/adapters/medusa/membership-medusa-sync.service.ts`
  - Customer Group add/remove 로직 유지
  - `refreshCartPricesAfterGroupChange` 유지 (카트 lock-in 문제는 이 방식으로도 동일하게 존재)

### 3.3 Medusa 측 변경 범위

**제거/단순화 가능:**

- `apps/medusa/src/api/store/customers/me/refresh-cart-prices/route.ts`
- `apps/medusa/src/api/admin/customers/[customerId]/refresh-cart-prices/route.ts`
  - 내부의 `fixCompareAtPrices()` 로직 제거 가능 여부 검증 필요
  - `refreshCartItemsWorkflow`(Medusa 표준) 호출만 남기는 방향이 이상적
  - `compare_at_unit_price`는 Medusa가 `original_amount`(rule 없는 default price)로 자동 설정하거나, `sale` 타입이 아니므로 별도 설정이 불필요할 가능성이 높음 → **실제 동작 검증 필요**

- `apps/medusa/src/scripts/fix-price-list-rule-customer-group-attribute.ts`
  - 멤버십 Price List가 사라지면 이 일회성 스크립트도 의미를 잃음(문서화 후 제거)

**제거 불가(계속 필요):**

- Customer Group 기반 멤버십 판별 (`src/utils/membership-filter.ts`의 `resolveMemberState`)
- Customer Group을 이용한 membership-exclusive 상품 필터링 로직

---

## 4. 검증된 제약 사항

### 4.1 Variant별 prices 배열에 rules 포함 — ✅ 가능

Medusa v2 공식 지원 기능이다. 다음 경로로 관리 가능:

- `createProductsWorkflow` / `updateProductsWorkflow` → 내부적으로 `upsertVariantPricesWorkflow` 호출
- Admin REST: `POST /admin/products/:id/variants/:variant_id` (body에 `prices[].rules` 포함)
- Admin REST: `POST /admin/products/:id/variants/batch`
- 직접 workflow 호출: `upsertVariantPricesWorkflow`

### 4.2 Customer Group ID를 공유 엔티티로 참조 — ❌ 불가능

`PriceRule` 데이터 모델은 `{ attribute, value, operator }` 구조이며 `value`는 **리터럴 문자열**이다. 즉, 각 price의 rule마다 customer group ID가 그대로 저장된다.

**영향도 평가:**

- 그룹 ID가 변경되면 모든 variant의 해당 rule을 일괄 업데이트해야 함
- 그러나 Medusa가 생성한 Customer Group ID(`cusgrp_xxx`)는 사실상 불변(그룹을 삭제하고 재생성하는 경우에만 바뀜)
- 현재의 Price List 방식도 동일하게 `customer.groups.id`를 리터럴로 저장 (Price List Rule 1개 vs Variant Price Rule N개의 차이는 있음)
- channel-adapter가 `MEDUSA_MEMBERSHIP_GROUP_ID` 환경변수를 단일 원천으로 사용하므로, 그룹 ID 변경 시 env 변경 + 전체 재동기화 한 번으로 해결됨

결론: 운영상 문제가 되지 않는다. Price List에 비해 저장 공간 사용량이 늘어나지만 무시할 수준이다.

### 4.3 카트 가격 lock-in은 여전히 존재

카트 아이템은 추가 시점 가격을 기억하므로, 멤버십 가입/해지 후에도 자동 재계산되지 않는다. 이는 Price List 방식에서도 동일한 제약이며, `refresh-cart-prices` 엔드포인트는 유지된다. 단, 내부에서 `fixCompareAtPrices()` 같은 커스텀 보정은 제거 가능성이 있다.

---

## 5. 마이그레이션 계획

### Phase 0. 사전 검증 (Spike)

목표: 가정을 실제로 확인.

1. 테스트 DB에서 한 variant에 대해 `customer.groups.id` rule이 붙은 멤버십가를 포함한 variant price를 생성
2. 해당 variant를 멤버십 회원/비회원 각각으로 카트에 담아 가격 검증
   - 멤버십 회원: `unit_price` = 멤버십가, `compare_at_unit_price` = 일반가 또는 null?
   - 비회원: `unit_price` = 일반가, `compare_at_unit_price` = null 기대
3. `refreshCartItemsWorkflow`(Medusa 표준) 단독 호출만으로 그룹 변경이 카트에 반영되는지 확인
4. 주문 완료 후 `order.items[].unit_price` / `compare_at_unit_price` 검증
5. `subscribers/membership-benefit-order.ts`의 할인액 계산이 여전히 정합한지 확인

**→ 이 단계에서 `fixCompareAtPrices()` 로직이 불필요함이 확인되어야 한다.** 불필요하지 않다면 Medusa 표준 동작을 더 깊이 파악해 원인을 찾는다(또는 원인을 알고 있는 상태에서 이 방식을 택할지 재검토).

### Phase 1. Transformer 개선

- `pim-to-medusa.transformer.ts`에서 variant.prices 생성 로직을 확장
- `MEDUSA_MEMBERSHIP_GROUP_ID`가 설정된 경우에만 멤버십가 rule을 추가 (없으면 일반가만)
- 기존 Price List 관련 동기화 호출은 일단 유지(플래그로 분기) — 점진적 롤아웃

### Phase 2. Sync Service 정리

- `syncPriceLists()` 호출을 feature flag로 제어
- 플래그 off 시 variant.prices 단독 동기화
- 스테이징에서 병행 운영하며 검증

### Phase 3. 일괄 재동기화

- 기존에 Price List로 관리되던 모든 상품에 대해 variant.prices 포함 재동기화 실행
- 이후 "Membership Prices" Price List의 모든 price를 일괄 삭제 (또는 Price List 자체를 soft delete)
- 일회성 스크립트: `apps/medusa/src/scripts/migrate-membership-price-list-to-variant-prices.ts` (옵션)

### Phase 4. 정리

- `fixCompareAtPrices()` 로직 제거 (Phase 0에서 불필요 확인된 경우)
- `fix-price-list-rule-customer-group-attribute.ts` 일회성 스크립트 제거 (또는 docs/archive로 이동)
- `syncPriceLists()` 관련 코드에서 멤버십 분기 제거 (프로모션/세일 전용으로만 남김)

---

## 6. 대안 비교 요약

| 항목 | 현재 (Price List) | 제안 (Variant Price Rules) |
|------|-------------------|----------------------------|
| Medusa 표준 호환성 | 부분 (커스텀 보정 필요) | 완전 |
| `compare_at_unit_price` 처리 | `fixCompareAtPrices()` 수동 보정 | Medusa 자동 처리 (검증 필요) |
| 동기화 복잡도 | product upsert + price list batch | product upsert 단일 |
| 상품별 가격 격리 | 전역 Price List에 누적 | variant에 귀속 |
| Admin UI에서 멤버십가 일괄 조회 | 가능 (Price List 화면) | 불가 (각 variant별 확인) |
| Price List의 본래 용도(프로모션) | 점유되어 있음 | 해방됨 |
| Customer Group ID 저장 방식 | 리터럴 (Price List Rule 1건) | 리터럴 (각 price마다) |
| 그룹 ID 변경 시 영향 | Price List Rule 1건 업데이트 | 전체 variant 재동기화 |
| 카트 lock-in 대응 | `refresh-cart-prices` 필요 | `refresh-cart-prices` 필요 (동일) |
| 원칙 부합도 | 낮음 (커스텀 로직 존재) | 높음 (표준 기능 활용) |

---

## 7. 리스크 및 대응

| 리스크 | 대응 |
|-------|------|
| Phase 0 검증 결과 `fixCompareAtPrices()`가 여전히 필요한 경우 | 원인 분석 후, 제거 가능한 방식을 찾거나 Medusa 표준 훅(`setPricingContext` 등) 활용으로 우회 |
| 기존 카트/주문 데이터 정합성 | 과거 데이터는 그대로 유지. Phase 3 재동기화는 미래 카트에만 영향 |
| Admin UI에서 멤버십가 관리 불편 | 필요 시 admin dashboard customization(widget/page)으로 상품 상세에 "멤버십가 조회" 패널 추가. PIM이 원천이므로 직접 수정은 PIM에서만 가능하다는 정책도 명확화 |
| 그룹 ID가 환경별로 다른 경우 | 이미 `MEDUSA_MEMBERSHIP_GROUP_ID` env로 분리됨. 배포 시 env 관리만 정확히 하면 됨 |
| Price Rule 레코드 수 증가 | 성능 영향 미미 (수만~수십만 건 수준). 필요 시 인덱스 확인 |

---

## 8. 결론

**Variant Price Rules로의 이행은 다음을 달성한다:**

- Medusa 표준 기능을 정상 용도로 사용
- 커스텀 보정 로직(`fixCompareAtPrices`) 제거 가능성
- channel-adapter 동기화 경로 단순화
- Price List를 프로모션 전용으로 해방

**단, 실제 착수 전 Phase 0의 검증이 필수이다.** 특히 `compare_at_unit_price` 자동 설정 동작과 `refreshCartItemsWorkflow` 단독 호출의 충분성이 확인되어야 이 방향의 가치가 성립한다.
