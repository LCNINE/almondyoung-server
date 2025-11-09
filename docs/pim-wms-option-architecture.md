# PIM-WMS 옵션 아키텍처 설계 문서

## 목차
1. [개요](#개요)
2. [핵심 설계 원칙](#핵심-설계-원칙)
3. [PIM 옵션 구조](#pim-옵션-구조)
4. [WMS 옵션 구조](#wms-옵션-구조)
5. [Product Matching 아키텍처](#product-matching-아키텍처)
6. [이벤트 기반 동기화](#이벤트-기반-동기화)
7. [데이터 흐름 예시](#데이터-흐름-예시)

---

## 개요

본 문서는 Almondyoung 물류 시스템에서 PIM(판매상품 관리)과 WMS(재고상품 관리)가 각각 옵션을 관리하는 방식과, 두 시스템 간 동기화 메커니즘을 설명합니다.

### 핵심 질문
- **왜 PIM과 WMS의 옵션 구조가 다른가?**
- **옵션 변경 시 재고 연속성을 어떻게 보장하는가?**

---

## 핵심 설계 원칙

### 1. **독립성 (Independence)**
PIM과 WMS는 재고 매칭을 제외하고 완전히 독립적으로 기능합니다.
- Direct FK 참조 없음 (variantId는 문자열)
- 각 시스템이 자신의 도메인 요구사항에 최적화된 구조 사용

### 2. **재고 연속성 (Inventory Continuity)**
WMS의 SKU는 한번 생성되면 영구 존속합니다.
- PIM에서 variant 삭제/재생성 시에도 SKU는 유지
- 재고 이벤트 소싱(stock_events)의 무결성 보장

### 3. **이벤트 기반 동기화 (Event-Driven Sync)**
PIM의 변경사항은 이벤트로 WMS에 전파됩니다.
- VARIANT_DELETED → 매칭 정리
- VARIANT_ADDED → 매칭 대기 등록

---

## PIM 옵션 구조

### 설계 철학: **조합형 옵션 (Combinatorial Options)**

PIM의 옵션은 고객이 선택할 수 있는 **조합**을 제공하는 것이 목적입니다.

### 데이터 구조

```
product_masters (마스터)
  ↓ FK: masterId
product_option_groups (옵션 그룹)
  ↓ FK: optionGroupId
product_option_values (옵션 값)
  ↓ M:N
variant_option_values (연결 테이블)
  ↓ FK: variantId
product_variants (품목)
```

### 실제 예시

```sql
-- Master
INSERT INTO product_masters (id, name)
VALUES ('m-001', '티셔츠');

-- Option Groups
INSERT INTO product_option_groups (id, master_id, name, display_name)
VALUES
  ('og-1', 'm-001', 'size', '사이즈'),
  ('og-2', 'm-001', 'color', '색상');

-- Option Values
INSERT INTO product_option_values (id, option_group_id, value, display_name)
VALUES
  ('ov-1', 'og-1', 'S', 'S사이즈'),
  ('ov-2', 'og-1', 'M', 'M사이즈'),
  ('ov-3', 'og-2', 'black', '검정'),
  ('ov-4', 'og-2', 'white', '흰색');

-- Variants (2×2 = 4개 조합)
INSERT INTO product_variants (id, master_id, variant_name)
VALUES
  ('v-1', 'm-001', 'S/검정'),
  ('v-2', 'm-001', 'S/흰색'),
  ('v-3', 'm-001', 'M/검정'),
  ('v-4', 'm-001', 'M/흰색');

-- Variant-Option 연결
INSERT INTO variant_option_values (variant_id, option_value_id)
VALUES
  ('v-1', 'ov-1'),  -- S
  ('v-1', 'ov-3'),  -- 검정
  ('v-2', 'ov-1'),  -- S
  ('v-2', 'ov-4'),  -- 흰색
  -- ...
```

### 옵션 변경 시나리오

**"무늬" 옵션 추가**:
```
Before: 사이즈(2) × 색상(2) = 4개 variant
After:  사이즈(2) × 색상(2) × 무늬(2) = 8개 variant

처리 방식:
1. 기존 4개 variant 삭제 (v-1, v-2, v-3, v-4)
2. 새 8개 variant 생성 (v-101 ~ v-108)
3. VARIANT_DELETED 이벤트 발행: ['v-1', 'v-2', 'v-3', 'v-4']
4. VARIANT_ADDED 이벤트 발행: ['v-101', ... 'v-108']
```

### 안전 장치

1. **Cascade 삭제**
   ```typescript
   productOptionGroups.masterId
     .references(() => productMasters.id, { onDelete: 'cascade' })
   ```

2. **Unique 제약**
   ```typescript
   uniqueIndex('unique_option_groups_master_name').on(
     table.masterId, table.name
   )
   uniqueIndex('unique_option_values_group_value').on(
     table.optionGroupId, table.value
   )
   ```

3. **참조 무결성**
   - FK 제약으로 고아 레코드 불가능
   - 옵션값 ID 기반 연결 (문자열 오타 방지)

---

## WMS 옵션 구조

### 설계 철학: **1차원 식별자 (One-Dimensional Identifier)**

WMS의 관점에서 옵션은 **조합의 의미가 없습니다**. 물류팀에게는:
- "S/검정 티셔츠"
- "M/흰색 티셔츠"
- "키보드"

이 세 가지가 **동등하게 다른 물건**일 뿐입니다.

### 데이터 구조

```
inventory_product_masters (재고 마스터)
  ↓ FK: masterId (느슨한 연결)
skus (재고 단위)
```

### 핵심 필드

```typescript
// inventory_product_masters
{
  id: uuid,
  name: string,
  masterCode: string,
  optionSchema: json,      // 현재는 조합형, 향후 단순화 예정
  defaultPolicy: json,
  status: 'active' | 'inactive'
}

// skus
{
  id: uuid,
  masterId: uuid,          // FK (optional)
  name: string,
  code: string,            // 고유 코드
  optionKey: jsonb,        // ⭐ 1차원 식별자 (개편 대상)
  defaultBarcode: string,
  stockType: 'physical' | 'digital',
  // ... 물류 관련 필드들
}
```

### optionKey 개편 계획

#### 현재 (조합형 - 제거 예정)
```json
{
  "Color": "Red",
  "Size": "M"
}
```

#### 개편 후 (1차원 식별자)
```json
"S/검정"
```
또는
```json
{
  "key": "S/검정"
}
```

### Master의 역할 차이

| 구분 | PIM Master | WMS Master |
|------|-----------|-----------|
| **역할** | 부모 (variant의 템플릿) | 그룹 라벨 (느슨한 묶음) |
| **삭제 시** | Cascade로 variant 삭제 | SET NULL (SKU는 생존) |
| **필수성** | 필수 (variant는 반드시 master 소속) | 선택 (SKU는 master 없어도 존재 가능) |
| **속성** | 가격 정책, 승인 워크플로우 | optionSchema 템플릿 |

### 왜 1차원 옵션인가?

#### 시나리오: "무늬" 옵션 추가

**PIM 측**:
```
기존: S/검정, S/흰색, M/검정, M/흰색 (4개)
추가 후: S/검정/무늬없음, S/검정/줄무늬, ... (8개)

처리: -4 +8 = variant 전체 재생성
```

**WMS 조합형 접근 시 (❌ 문제)**:
```
기존 SKU 4개 삭제
  → stock_events 이력 손실
  → 재고가 "마법처럼" 사라짐

새 SKU 8개 생성
  → 기존 재고를 새 SKU에 "마법처럼" 이동
  → 재고 이벤트 소싱 무결성 파괴
```

**WMS 1차원 접근 시 (✅ 정상)**:
```
기존 SKU 4개 유지
  → stock_events 이력 보존
  → 재고 연속성 유지

신규 SKU 4개만 추가
  → "줄무늬" 티셔츠가 입고되는 자연스러운 흐름
  → 추적 가능한 재고 이벤트
```

### 물류팀의 시각

```
입고 담당자: "오늘 무늬있는 티셔츠 4종이 새로 들어왔네요."
             (O 자연스러움)

입고 담당자: "기존 티셔츠 4종이 삭제되고, 똑같은 티셔츠 4종이
             무늬없음으로 바뀌면서, 무늬있는 티셔츠 4종이
             추가로 생겼네요."
             (X 부자연스러움, 추적 어려움)
```

---

## Product Matching 아키텍처

### 역할: **변환 레이어 (Translation Layer)**

Product Matching은 PIM의 판매 단위(variant)를 WMS의 물리 단위(SKU)로 변환하는 중간 레이어입니다.

### 핵심 테이블

#### 1. product_matchings (메인 매칭 테이블)

```typescript
{
  id: uuid,
  variantId: string,              // PIM variant ID (문자열, FK 아님!)
  masterId: uuid,                 // WMS inventory_product_masters.id (optional)
  status: 'pending' | 'matched' | 'ignored',
  priority: 'normal' | 'high',
  strategy: 'void' | 'variant' | 'option',
  isResolved: boolean,

  // 재고 정책 (SKU가 아닌 매칭에 저장)
  inventoryManagement: boolean,
  preStockSellable: boolean,
  alwaysSellableZeroStock: boolean,
}
```

#### 2. product_variant_sku_links (Variant 전략용)

```typescript
{
  productMatchingId: uuid,
  skuId: uuid,
  quantity: integer,              // 세트 상품용 (예: 커피세트 = 원두 2개 + 머그컵 1개)
}
```

#### 3. product_option_matchings (Option 전략용 - 개편 대상)

```typescript
{
  id: uuid,
  productMatchingId: uuid,
  optionName: string,             // 'Color', 'Size'
  optionValue: string,            // 'Red', 'M'
  skuId: uuid,
}
```

### 매칭 전략 (Strategy Pattern)

#### 1. **Void 전략**
- **용도**: 재고 없는 상품 (디지털 상품, 무한 재고)
- **동작**: SKU 매핑 없음, 항상 판매 가능
- **테이블**: 없음

```typescript
// 예: 디지털 음원, 전자책
productMatching: {
  variantId: 'v-digital-001',
  strategy: 'void',
  inventoryManagement: false,
  alwaysSellableZeroStock: true
}
```

#### 2. **Variant 전략** (권장)
- **용도**: 일반 상품, 세트/번들 상품
- **동작**: 1 variant → N SKU 매핑 (보통 N=1)
- **테이블**: product_variant_sku_links

```typescript
// 예: 단일 상품
productMatching: {
  variantId: 'v-1',
  strategy: 'variant'
}
productVariantSkuLinks: [
  { productMatchingId: 'pm-1', skuId: 'sku-001', quantity: 1 }
]

// 예: 세트 상품
productMatching: {
  variantId: 'v-gift-set',
  strategy: 'variant'
}
productVariantSkuLinks: [
  { productMatchingId: 'pm-2', skuId: 'sku-coffee', quantity: 2 },
  { productMatchingId: 'pm-2', skuId: 'sku-mug', quantity: 1 }
]
```

#### 3. **Option 전략** (개편 예정)
- **용도**: 옵션별 SKU 분리 (현재는 사용 비권장)
- **동작**: 각 옵션값마다 SKU 매핑
- **문제**: 1차원 optionKey와 불일치
- **테이블**: product_option_matchings

```typescript
// 현재 구조 (조합형 전제)
productMatching: {
  variantId: 'v-1',  // S/검정 티셔츠
  strategy: 'option'
}
productOptionMatchings: [
  { productMatchingId: 'pm-1', optionName: 'Size', optionValue: 'S', skuId: 'sku-size-s' },
  { productMatchingId: 'pm-1', optionName: 'Color', optionValue: 'Black', skuId: 'sku-color-black' }
]

// ❌ 문제: 1개 variant가 왜 2개 SKU로 분리되는가?
// ✅ 해결: Variant 전략 사용 (1 variant → 1 SKU)
```

### 전략 선택 가이드

| 상품 유형 | 전략 | 이유 |
|----------|------|------|
| 단일 실물 상품 | variant | 1:1 매핑, 단순 명확 |
| 세트/번들 상품 | variant | 구성품별 재고 차감 |
| 디지털 상품 | void | 재고 관리 불필요 |
| 직배송 상품 | void | 무한 재고 가정 |
| ~~옵션별 분리~~ | ~~option~~ | ~~개편으로 제거 예정~~ |

---

## 이벤트 기반 동기화

### 이벤트 타입

#### 1. VARIANT_DELETED

```typescript
{
  eventType: 'VARIANT_DELETED',
  productId: string,
  name: string,
  changedVariantIds: string[],    // 삭제된 variant ID 목록
}
```

**WMS 처리** (`pim-event.handler.ts`):
```typescript
case 'VARIANT_DELETED':
  for (const variantId of event.changedVariantIds) {
    await productMatchingService.handleVariantDeletion(variantId);
  }
```

**삭제 로직** (`product-matching.service.ts:354`):
```typescript
async handleVariantDeletion(variantId: string, tx?: DbTx) {
  // 1. variantId로 매칭 찾기
  const matching = await trx
    .select()
    .from(productMatchings)
    .where(eq(productMatchings.variantId, variantId))
    .limit(1);

  if (!matching) return;

  // 2. 전략별 연결 정리
  if (matching.status === 'matched' && matching.strategy) {
    const strategy = this.getStrategy(matching.strategy);

    // void: 아무것도 안 함
    // variant: product_variant_sku_links 삭제
    // option: product_option_matchings 삭제
    await strategy.delete({ variantId, productMatchingId: matching.id }, trx);
  }

  // 3. 매칭 레코드 삭제
  await trx.delete(productMatchings)
    .where(eq(productMatchings.id, matching.id));
}
```

**중요**: SKU는 절대 삭제되지 않음!

#### 2. VARIANT_ADDED

```typescript
{
  eventType: 'VARIANT_ADDED',
  productId: string,
  name: string,
  changedVariantIds: string[],    // 추가된 variant ID 목록
  variants: Array<{
    id: string,
    name: string,
    inventoryManagement: boolean,
  }>
}
```

**WMS 처리**:
```typescript
case 'VARIANT_ADDED':
  await productMatchingService.handleManualMatchingRequest({
    productId: event.productId,
    name: event.name,
    variants: event.variants.filter(v =>
      event.changedVariantIds.includes(v.id)
    ),
  });
```

**매칭 대기 등록**:
```typescript
async handleManualMatchingRequest(payload) {
  for (const variant of payload.variants) {
    await trx.insert(productMatchings).values({
      variantId: variant.id,
      status: 'pending',              // ← 수동 매칭 대기
      inventoryManagement: variant.inventoryManagement,
      isResolved: false,
    });
  }
}
```

#### 3. INVENTORY_MANAGEMENT_CHANGED

```typescript
{
  eventType: 'INVENTORY_MANAGEMENT_CHANGED',
  productId: string,
  name: string,
  variants: Array<{
    id: string,
    inventoryManagement: boolean,
  }>,
  previousInventoryManagement: boolean
}
```

**WMS 처리**: VARIANT_ADDED와 동일 (매칭 대기 재등록)

---

## 데이터 흐름 예시

### 시나리오: 티셔츠에 "무늬" 옵션 추가

#### Phase 0: 초기 상태

**PIM**:
```
Master "티셔츠" (m-001)
├─ OptionGroup "사이즈" [S, M]
└─ OptionGroup "색상" [검정, 흰색]

Variants (4개):
├─ v-1: S/검정
├─ v-2: S/흰색
├─ v-3: M/검정
└─ v-4: M/흰색
```

**WMS**:
```
SKUs (4개):
├─ sku-001: "S/검정 티셔츠" (재고 100개)
├─ sku-002: "S/흰색 티셔츠" (재고 50개)
├─ sku-003: "M/검정 티셔츠" (재고 80개)
└─ sku-004: "M/흰색 티셔츠" (재고 120개)

Product Matchings:
├─ pm-1: v-1 → sku-001 (variant 전략)
├─ pm-2: v-2 → sku-002
├─ pm-3: v-3 → sku-003
└─ pm-4: v-4 → sku-004
```

#### Phase 1: PIM에서 "무늬" 옵션 추가

**PIM 작업**:
```sql
-- 1. 새 옵션 그룹 추가
INSERT INTO product_option_groups (id, master_id, name, display_name)
VALUES ('og-3', 'm-001', 'pattern', '무늬');

-- 2. 옵션값 추가
INSERT INTO product_option_values (id, option_group_id, value, display_name)
VALUES
  ('ov-5', 'og-3', 'none', '무늬없음'),
  ('ov-6', 'og-3', 'stripe', '줄무늬');

-- 3. 기존 variant 삭제
DELETE FROM product_variants WHERE id IN ('v-1', 'v-2', 'v-3', 'v-4');
-- → variant_option_values도 CASCADE로 자동 삭제

-- 4. 새 variant 생성 (2×2×2 = 8개)
INSERT INTO product_variants (id, master_id, variant_name)
VALUES
  ('v-101', 'm-001', 'S/검정/무늬없음'),
  ('v-102', 'm-001', 'S/검정/줄무늬'),
  ('v-103', 'm-001', 'S/흰색/무늬없음'),
  ('v-104', 'm-001', 'S/흰색/줄무늬'),
  ('v-105', 'm-001', 'M/검정/무늬없음'),
  ('v-106', 'm-001', 'M/검정/줄무늬'),
  ('v-107', 'm-001', 'M/흰색/무늬없음'),
  ('v-108', 'm-001', 'M/흰색/줄무늬');

-- 5. 이벤트 발행
PUBLISH 'VARIANT_DELETED' {
  productId: 'm-001',
  changedVariantIds: ['v-1', 'v-2', 'v-3', 'v-4']
}

PUBLISH 'VARIANT_ADDED' {
  productId: 'm-001',
  changedVariantIds: ['v-101', 'v-102', ... 'v-108'],
  variants: [...]
}
```

#### Phase 2: WMS가 VARIANT_DELETED 처리

**WMS 작업**:
```typescript
// handleVariantDeletion('v-1')
// 1. 매칭 찾기
matching = { id: 'pm-1', variantId: 'v-1', strategy: 'variant' }

// 2. Variant 전략으로 연결 삭제
DELETE FROM product_variant_sku_links
WHERE product_matching_id = 'pm-1';

// 3. 매칭 삭제
DELETE FROM product_matchings WHERE id = 'pm-1';

// v-2, v-3, v-4도 동일하게 처리
```

**결과**:
```
SKUs (변화 없음!):
├─ sku-001: "S/검정 티셔츠" (재고 100개) ✅ 유지
├─ sku-002: "S/흰색 티셔츠" (재고 50개) ✅ 유지
├─ sku-003: "M/검정 티셔츠" (재고 80개) ✅ 유지
└─ sku-004: "M/흰색 티셔츠" (재고 120개) ✅ 유지

Product Matchings: (모두 삭제됨)

Product Variant SKU Links: (모두 삭제됨)

Stock Events: (변화 없음, 이력 보존)
```

#### Phase 3: WMS가 VARIANT_ADDED 처리

**WMS 작업**:
```typescript
// handleManualMatchingRequest
for (const variant of [v-101, v-102, ... v-108]) {
  INSERT INTO product_matchings (variant_id, status, is_resolved)
  VALUES (variant.id, 'pending', false);
}
```

**결과**:
```
Product Matchings (8개 pending):
├─ pm-101: v-101 (S/검정/무늬없음) → status: pending
├─ pm-102: v-102 (S/검정/줄무늬) → status: pending
├─ pm-103: v-103 (S/흰색/무늬없음) → status: pending
├─ pm-104: v-104 (S/흰색/줄무늬) → status: pending
├─ pm-105: v-105 (M/검정/무늬없음) → status: pending
├─ pm-106: v-106 (M/검정/줄무늬) → status: pending
├─ pm-107: v-107 (M/흰색/무늬없음) → status: pending
└─ pm-108: v-108 (M/흰색/줄무늬) → status: pending
```

#### Phase 4: 관리자가 수동 매칭

**관리자 작업 (WMS UI)**:
```
[기존 SKU와 재매칭]
v-101 (S/검정/무늬없음) → sku-001 (S/검정 티셔츠)
v-103 (S/흰색/무늬없음) → sku-002 (S/흰색 티셔츠)
v-105 (M/검정/무늬없음) → sku-003 (M/검정 티셔츠)
v-107 (M/흰색/무늬없음) → sku-004 (M/흰색 티셔츠)

[신규 SKU 생성 후 매칭]
v-102 (S/검정/줄무늬) → sku-005 (신규 생성, 재고 0)
v-104 (S/흰색/줄무늬) → sku-006 (신규 생성, 재고 0)
v-106 (M/검정/줄무늬) → sku-007 (신규 생성, 재고 0)
v-108 (M/흰색/줄무늬) → sku-008 (신규 생성, 재고 0)
```

**WMS 처리**:
```typescript
// resolveMatchingPending(pm-101, { skuMappings: [{ skuId: 'sku-001', quantity: 1 }], strategy: 'variant' })

// 1. 매칭 업데이트
UPDATE product_matchings SET status = 'matched', strategy = 'variant', is_resolved = true
WHERE id = 'pm-101';

// 2. 연결 생성
INSERT INTO product_variant_sku_links (product_matching_id, sku_id, quantity)
VALUES ('pm-101', 'sku-001', 1);
```

#### Phase 5: 최종 상태

**PIM**:
```
Variants (8개):
├─ v-101: S/검정/무늬없음
├─ v-102: S/검정/줄무늬
├─ v-103: S/흰색/무늬없음
├─ v-104: S/흰색/줄무늬
├─ v-105: M/검정/무늬없음
├─ v-106: M/검정/줄무늬
├─ v-107: M/흰색/무늬없음
└─ v-108: M/흰색/줄무늬
```

**WMS**:
```
SKUs (8개):
├─ sku-001: "S/검정 티셔츠" (재고 100개) ← 기존 유지
├─ sku-002: "S/흰색 티셔츠" (재고 50개) ← 기존 유지
├─ sku-003: "M/검정 티셔츠" (재고 80개) ← 기존 유지
├─ sku-004: "M/흰색 티셔츠" (재고 120개) ← 기존 유지
├─ sku-005: "S/검정/줄무늬 티셔츠" (재고 0개) ← 신규
├─ sku-006: "S/흰색/줄무늬 티셔츠" (재고 0개) ← 신규
├─ sku-007: "M/검정/줄무늬 티셔츠" (재고 0개) ← 신규
└─ sku-008: "M/흰색/줄무늬 티셔츠" (재고 0개) ← 신규

Product Matchings (8개 matched):
├─ pm-101: v-101 → sku-001
├─ pm-102: v-102 → sku-005
├─ pm-103: v-103 → sku-002
├─ pm-104: v-104 → sku-006
├─ pm-105: v-105 → sku-003
├─ pm-106: v-106 → sku-007
├─ pm-107: v-107 → sku-004
└─ pm-108: v-108 → sku-008
```

**재고 연속성 검증**:
```sql
-- 기존 SKU의 재고 이벤트 이력 확인
SELECT * FROM stock_events WHERE sku_id = 'sku-001' ORDER BY occurred_at;

-- 결과: 모든 이력 보존됨 (입고, 출고, 이동 등)
-- PIM의 variant 변경과 무관하게 물리적 재고 추적 가능
```

---

## 요약

### PIM (판매상품)
- **목적**: 고객에게 선택 가능한 조합 제공
- **구조**: 정규화된 3단계 옵션 구조
- **변경 시**: Variant 전체 재생성 (조합 변경)
- **안전성**: FK 제약, Cascade 삭제, Unique 제약

### WMS (재고상품)
- **목적**: 물리적 재고 추적 및 관리
- **구조**: 1차원 optionKey (조합 의미 없음)
- **변경 시**: SKU 유지, 매칭만 업데이트
- **안전성**: 재고 연속성, 이벤트 소싱 무결성

### Product Matching (연결 레이어)
- **목적**: PIM 변동성 흡수, WMS 안정성 보장
- **전략**: void (디지털), variant (일반/세트), ~~option (개편 대상)~~
- **동기화**: 이벤트 기반 (DELETED → 매칭 정리, ADDED → 대기 등록)

### 핵심 원칙
1. **독립성**: 각 시스템은 자신의 도메인에 최적화
2. **연속성**: SKU는 영구 존속, 재고 이력 보존
3. **유연성**: 전략 패턴으로 다양한 상품 유형 대응

---

**문서 버전**: 1.0
**최종 수정**: 2025-01-09
**작성자**: System Architecture Team
