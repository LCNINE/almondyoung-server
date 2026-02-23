# Wallet Rebuild - Intent Items/Discounts/Pricing (Draft)

## 1. Purpose

이 문서는 `CreatePaymentIntent`의 주문 스냅샷 구조, 금액 계산 규칙, DB 정규화 저장 규칙을 확정한다.
본 문서는 `01`, `03`, `04`, `05`, `07` 문서를 전제로 하며, Intent 생성 시 가격 계산 SoT를 Wallet 내부 규칙으로 고정한다.

## 2. Scope and Decisions (v1)

- 모든 Intent는 생성 시 `items`를 반드시 포함해야 한다.
- 각 item은 `quantity`를 반드시 가진다.
- 할인은 선택이며 아래 3종류만 지원한다.
  - `ITEM_PER_UNIT` (수량 연동 품목 할인)
  - `ITEM_FLAT` (수량 무관 품목 할인)
  - `ORDER` (주문 전체 할인)
- 할인 적용 순서는 아래로 고정한다.
  1. `ITEM_PER_UNIT`
  2. `ITEM_FLAT`
  3. `ORDER`
- 음수 금액은 에러가 아니라 `0`으로 clamp 처리한다.
- clamp 경계는 item 단위다. (item 간 상계 금지)
- `payment_intents.payable_amount`는 Wallet이 계산한 최종값으로 저장한다.

## 3. `CreateIntent` Request Body Contract

## 3.1 Top-level Required Fields

- `referenceType`
- `referenceId`
- `userId`
- `currency`
- `payableAmount`
- `snapshotPayload`
- `signature`
- `signatureVersion`
- `signedAt`

`payableAmount`는 호출자가 선언한 금액이며, Wallet이 `snapshotPayload` 기준으로 재계산한 값과 반드시 일치해야 한다.

## 3.2 `snapshotPayload` Required Structure

```json
{
  "schemaVersion": "INTENT_SNAPSHOT_V1",
  "items": [
    {
      "lineId": "line-1",
      "name": "상품 A",
      "unitPrice": 3000,
      "quantity": 1,
      "type": "PRODUCT",
      "id": "prod_123",
      "discounts": [
        {
          "discountId": "disc-item-per-unit-1",
          "kind": "ITEM_PER_UNIT",
          "amount": 1000
        },
        {
          "discountId": "disc-item-flat-1",
          "kind": "ITEM_FLAT",
          "amount": 2000
        }
      ]
    },
    {
      "lineId": "line-2",
      "name": "배송비",
      "unitPrice": 2000,
      "quantity": 1,
      "type": "SHIPPING_FEE",
      "discounts": []
    }
  ],
  "orderDiscounts": [
    {
      "discountId": "disc-order-1",
      "kind": "ORDER",
      "amount": 500
    }
  ]
}
```

## 3.3 Item Field Rules

- `lineId`: non-empty string, intent 내부에서 유니크
- `name`: non-empty string
- `unitPrice`: 정수, `>= 0`
- `quantity`: 정수, `> 0`
- `type`: optional (`PRODUCT` | `SHIPPING_FEE`)
- `id`: optional string

`type`/`id` 규칙:

- `type`이 없으면 `id`도 없어야 한다.
- `type`이 있어도 `id`는 optional이다.
- `type=SHIPPING_FEE`면 `id`는 없어야 한다.

## 3.4 Discount Field Rules

- 공통:
  - `discountId`: optional string
  - `amount`: 정수, `> 0`
- item discount:
  - `kind`는 `ITEM_PER_UNIT` 또는 `ITEM_FLAT`
  - item 경계 내에서만 적용된다.
- order discount:
  - `kind`는 `ORDER`만 허용
  - 모든 item 계산이 끝난 뒤 적용한다.

## 4. Pricing Algorithm (Normative)

아래 계산 규칙은 구현체가 반드시 따라야 하는 규범 규칙이다.

## 4.1 Item-level Calculation

각 item에 대해:

1. `baseAmount = unitPrice * quantity`
2. `perUnitDiscountTotal = SUM(ITEM_PER_UNIT.amount * quantity)`
3. `afterPerUnit = max(baseAmount - perUnitDiscountTotal, 0)`
4. `flatDiscountTotal = SUM(ITEM_FLAT.amount)`
5. `itemPayable = max(afterPerUnit - flatDiscountTotal, 0)`

## 4.2 Intent-level Calculation

1. `itemsSubtotal = SUM(itemPayable)`
2. `orderDiscountTotal = SUM(orderDiscount.amount)`
3. `intentPayable = max(itemsSubtotal - orderDiscountTotal, 0)`

## 4.3 Example (Item Boundary Clamp)

- Item A: `3000`, item discount `10000`
- Item B: `2000`, no item discount

계산:

- `A = max(3000 - 10000, 0) = 0`
- `B = 2000`
- `itemsSubtotal = 2000`
- `intentPayable = 2000`

즉, `3000 - 10000 + 2000 = -5000 -> 0`처럼 전체 합산 후 clamp하지 않는다.

## 5. Validation and Error Policy

- `items`가 비어 있으면 거절 (`400`, `INVALID_ITEMS`)
- item/discount 금액 규칙 위반 시 거절 (`400`, `INVALID_PRICING_INPUT`)
- `snapshotPayload` 구조 위반 시 거절 (`400`, `INVALID_SNAPSHOT_SCHEMA`)
- 재계산값과 `payableAmount` 불일치 시 거절 (`400`, `PAYABLE_AMOUNT_MISMATCH`)
- HMAC 검증 실패는 기존 정책 유지 (`07-hmac-integrity.md`)

## 6. Persistence (Normalized DB)

## 6.1 `payment_intent_items`

권장 컬럼:

- `id` (PK)
- `intent_id` (FK -> `payment_intents.id`)
- `line_id` (non-null)
- `name` (non-null)
- `item_type` (`PRODUCT` | `SHIPPING_FEE`, nullable)
- `item_ref_id` (nullable)
- `unit_price` (int, `>= 0`)
- `quantity` (int, `> 0`)
- `base_amount` (int, `>= 0`)
- `item_discount_per_unit_total` (int, `>= 0`)
- `item_discount_flat_total` (int, `>= 0`)
- `payable_amount` (int, `>= 0`)
- `metadata` (jsonb)
- `created_at`, `updated_at`

핵심 제약:

- `UNIQUE(intent_id, line_id)`
- `item_type IS NULL => item_ref_id IS NULL`
- `item_type = 'SHIPPING_FEE' => item_ref_id IS NULL`

## 6.2 `payment_intent_item_discounts`

권장 컬럼:

- `id` (PK)
- `intent_id` (FK -> `payment_intents.id`)
- `item_id` (FK -> `payment_intent_items.id`)
- `discount_id` (nullable)
- `kind` (`ITEM_PER_UNIT` | `ITEM_FLAT`)
- `amount` (int, `> 0`)
- `metadata` (jsonb)
- `created_at`, `updated_at`

핵심 제약:

- `amount > 0`
- `kind in ('ITEM_PER_UNIT', 'ITEM_FLAT')`

## 6.3 `payment_intent_order_discounts`

권장 컬럼:

- `id` (PK)
- `intent_id` (FK -> `payment_intents.id`)
- `discount_id` (nullable)
- `kind` (`ORDER`)
- `amount` (int, `> 0`)
- `metadata` (jsonb)
- `created_at`, `updated_at`

핵심 제약:

- `kind = 'ORDER'`
- `amount > 0`

## 6.4 Intent Row Storage

- `payment_intents.payable_amount`에는 `intentPayable` 저장
- `payment_intents.metadata`에는 아래를 저장
  - `snapshotPayload` 원문
  - `signatureVersion`
  - `signedAt`
  - `payloadHash`

## 7. Transaction Pattern (CreateIntent)

Intent 생성 트랜잭션 순서:

1. HMAC 검증
2. `snapshotPayload` 스키마 검증
3. 가격 계산 (`intentPayable`)
4. `intentPayable == payableAmount` 검증
5. `payment_intents` insert (`payable_amount = intentPayable`)
6. `payment_intent_items` / `payment_intent_item_discounts` / `payment_intent_order_discounts` insert
7. 상태 전이 로그 + outbox insert
8. commit

## 8. Open Decisions

- 현재 없음
