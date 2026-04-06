# 도메인 모델

## 핵심 개념

order-matching 앱은 두 가지 핵심 기능을 갖는다:

1. **상품 매칭** — variant ↔ SKU 대응 규칙 관리
2. **주문 변환** — 판매주문(variant 기반)을 재고주문(SKU 기반)으로 변환

이 둘은 밀접하게 연관된다. 주문 변환은 상품 매칭 규칙을 적용하는 행위이기 때문이다.

---

## 상품 매칭 (Product Matching)

### 매칭 상태

매칭 레코드의 존재 여부와 strategy 값으로 상태를 표현한다.

| 상태 | 레코드 | strategy | 의미 | 주문 변환 시 |
|------|--------|----------|------|-------------|
| 미매칭 | 없음 | - | 매칭이 아직 정의되지 않음 | **주문 변환 차단** |
| SKU 매칭 | 있음 | `sku` | SKU와 수량이 지정됨 | 재고주문 라인에 포함 |
| 이행 불필요 | 있음 | `void` | 물리적 이행이 본질적으로 불필요 (디지털 상품 등) | 라인에서 제외, 정상 진행 |
| 임시 제외 | 있음 | `skip` | 매칭이 필요하지만 현재 없음, 주문 차단은 원하지 않음 | 라인에서 제외, 정상 진행 |

`pending` 같은 "매칭 대기" 상태는 존재하지 않는다. 미매칭은 레코드가 없는 것으로 표현되며, 미매칭 variant 목록은 PIM의 variant 목록과 매칭 레코드의 차이(diff)로 도출한다.

### `void`와 `skip`의 차이

둘 다 주문 변환 시 라인에서 제외되지만, 의미가 다르다:

- **`void`**: 본질적으로 물리 이행이 불필요. 디지털 상품, 서비스 등. 영구적 상태.
- **`skip`**: 매칭이 필요하지만 아직 안 됐고, 그렇다고 이 variant 때문에 주문 전체가 막히는 것을 원하지 않을 때 관리자가 명시적으로 설정. 임시적 상태이며, 추후 `sku`로 전환할 것이 기대됨.

### 데이터 모델

```
product_matchings
├── id              UUID PK
├── variant_id      UUID UNIQUE    -- PIM variant 참조 (문자열, FK 아님)
├── master_id       UUID           -- PIM master 참조 (문자열, FK 아님)
├── strategy        'sku' | 'void' | 'skip'
├── created_at      TIMESTAMP
└── updated_at      TIMESTAMP

product_matching_sku_links
├── matching_id     UUID FK → product_matchings (CASCADE DELETE)
├── sku_id          UUID           -- WMS SKU 참조 (문자열, FK 아님)
├── quantity        INT DEFAULT 1  -- 세트상품 시 수량
└── created_at      TIMESTAMP
```

- `variant_id`, `master_id`, `sku_id`는 모두 외부 시스템의 ID를 문자열로 저장. 직접 FK가 아니므로 PIM/WMS와의 물리적 의존이 없다.
- `product_matching_sku_links`는 `strategy: 'sku'`인 매칭에만 존재한다.

### 상품 매칭 예시

```
립스틱 1호 (variant_A)  →  strategy: sku  →  [SKU_립스틱1호 × 1]
립스틱 2호 (variant_B)  →  strategy: sku  →  [SKU_립스틱2호 × 1]
립스틱 세트 (variant_C) →  strategy: sku  →  [SKU_립스틱1호 × 1, SKU_립스틱2호 × 1, ...]
전자책 (variant_D)      →  strategy: void
신상품 (variant_E)      →  (레코드 없음 = 미매칭)
임시제외 (variant_F)    →  strategy: skip
```

---

## 주문 변환 (Order Conversion)

### 개요

판매주문은 variant 단위로 구성된다 (고객이 쇼핑몰에서 구매한 것). 재고주문은 SKU 단위로 구성된다 (물류팀이 창고에서 처리할 것). 매칭 앱은 전자를 후자로 변환하는 역할을 한다.

### 변환 규칙

판매주문의 각 라인(variant + 수량)에 대해:

1. **매칭 레코드 조회** (variant_id로)
2. **strategy에 따라 분기**:
   - `sku` → SKU 링크를 참조하여 재고주문 라인 생성 (수량 곱산)
   - `void` → 해당 라인 제외 (물리 이행 불필요)
   - `skip` → 해당 라인 제외 (임시 제외)
   - 레코드 없음 → **변환 실패, 주문 hold**

### 변환 예시

```
판매주문:
  - variant_A × 2  (립스틱 1호 2개)
  - variant_C × 1  (립스틱 세트 1개)
  - variant_D × 1  (전자책 1개)

        ↓ 매칭 규칙 적용

재고주문:
  - SKU_립스틱1호 × 3  (variant_A에서 2개 + variant_C에서 1개)
  - SKU_립스틱2호 × 1  (variant_C에서 1개)
  - SKU_립스틱3호 × 1  (variant_C에서 1개)
  - SKU_립스틱4호 × 1  (variant_C에서 1개)
  (variant_D는 void이므로 제외)
```

### 변환 결과의 소유

- 매칭 앱은 변환을 수행하고 결과를 **이벤트로 발행**한다.
- 재고주문의 SoT는 **WMS**가 가진다. WMS는 이벤트를 받아 자체 DB에 재고주문을 생성한다.
- 관리자가 수동으로 재고주문을 생성하는 경우에도 WMS에 직접 등록하므로, WMS가 SoT를 갖는 것이 자연스럽다.

```
[판매주문 이벤트] → [매칭 앱: 변환] → [재고주문 이벤트] → [WMS: 재고주문 SoT]
                                                              ↑
                                        [관리자 수동 생성] ───┘
```

### 제외된 라인의 추적

`void`나 `skip`으로 제외된 라인은 변환 결과 이벤트에 포함시켜, 판매주문의 어떤 라인이 재고주문에 포함되지 않았는지를 추적할 수 있게 한다.

```
변환 결과 이벤트:
{
  salesOrderId: "...",
  inventoryOrderLines: [...],       // SKU 기반 라인들
  excludedLines: [
    { variantId: "variant_D", reason: "void" },
    { variantId: "variant_F", reason: "skip" }
  ]
}
```
