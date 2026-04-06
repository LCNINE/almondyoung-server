# 설계 배경

## 판매상품과 재고상품

이 커머스 백엔드에서 상품은 두 가지 관점으로 관리된다.

### 판매상품 (PIM이 SoT)

고객이 쇼핑몰에서 보게 되는 상품. 계층 구조는 다음과 같다:

```
product_master (판매상품)
  └─ product_master_version (버전, 하나가 active)
       └─ product_variant (품목, 옵션 조합으로 결정)
```

- 비슷한 종류의 품목(variant)들이 version에 묶임
- version들이 master에 묶이고, 그 중 하나가 active version으로 master를 대표
- 실질적인 구매/매칭 단위는 **variant**

### 재고상품 / SKU (WMS가 SoT)

물류창고에 물리적으로 보관되는 상품 단위. WMS에서는 variant의 옵션 조합 같은 개념이 없고, 각 SKU가 동등하게 다른 물건일 뿐이다.

### 상품 매칭

판매상품(variant)과 재고상품(SKU)의 대응 관계를 정의하는 것.

| 관계 | 예시 |
|------|------|
| 1:1 | 일반적인 상품 |
| 1:N | 세트상품 (주문 1건 → 물건 여러 개 배송) |
| N:1 | 여러 판매상품이 같은 물리 상품을 포함 |
| 1:0 | 디지털 상품, 또는 아직 매칭되지 않음 |
| 0:1 | 판매용이 아닌 재고관리 전용 상품, 또는 아직 매칭되지 않음 |

다대다도 가능하다. 예: 립스틱 1~4호를 각각 따로 팔면서, '립스틱 세트'에 4종 SKU를 매칭하는 경우.

---

## 기존 설계: "매칭대기" 모델

기존에는 WMS가 매칭의 SoT를 가졌고, PIM에서 variant가 생성되면 Kafka 이벤트를 통해 WMS에 `pending` 상태의 매칭 레코드를 자동 생성하는 구조였다.

```
PIM: variant 생성
  → Kafka: ProductVariantCreated
    → WMS: product_matchings 테이블에 status='pending' 레코드 생성
      → 관리자가 SKU를 매칭하거나 '필요없음'을 선언하여 pending 해소
```

### 이 설계의 문제점

#### 1. 이벤트 유실 시 보이지 않는 구멍

Kafka 이벤트가 유실되거나 WMS consumer가 다운된 사이에 variant가 생성되면, pending 레코드 자체가 생기지 않는다. 존재하지 않는 레코드는 조회할 수 없으므로 관리자가 미매칭 상품의 존재를 알 수 없다.

#### 2. PIM variant 삭제 시 처리 미구현

`ProductVariantDeleted` 핸들러가 TODO 상태. variant가 삭제되어도 WMS에 orphan matching이 남는다.

#### 3. PIM version 교체 시 인지 불가

새 version이 activate되면 variant 세트가 바뀔 수 있는데, 이 전환을 WMS가 인지하지 못한다.

#### 4. 매칭 해소 시 역방향 이벤트 없음

WMS에서 pending이 resolved되어도 PIM이나 다른 시스템에 알림이 없다. PIM 쪽에서 "이 상품 매칭 완료됨"을 알 방법이 없다.

#### 5. inventoryManagement 하드코딩

PIM에서 variant 생성 시 `inventoryManagement: true`로 고정. 디지털 상품을 만들어도 무조건 pending이 생겨 관리자가 일일이 ignore 해야 한다.

#### 6. SoT 위치의 근본적 문제

매칭은 판매상품(PIM)이나 재고상품(WMS) 중 한쪽만으로는 의미가 없는 관계(relationship)다. 이를 WMS에 두면 PIM 이벤트에 의존하게 되고, PIM에 두면 WMS의 SKU 개념을 알아야 한다. 어느 쪽도 자연스럽지 않다.

---

## 새 설계로의 전환 동기

이 시스템은 "특정 앱이 필요 없으면 배제하고도 동작해야 한다"는 원칙을 갖고 있다. 매칭이 PIM이나 WMS 어느 쪽의 관심사도 아니라면, **독립된 앱**으로 분리하는 것이 이 원칙에 부합한다.

또한 Push 모델(이벤트로 상태 생성)에서 **Pull 모델(조회 시점에 차이 계산)**로 전환하면, 이벤트 유실으로 인한 보이지 않는 구멍 문제를 원천적으로 해결할 수 있다.
