# Medusa vs Mercur.js 카트 API 비교 명세서

## 📋 목차

1. [개요](#개요)
2. [API 라우트 오버라이드 개념](#api-라우트-오버라이드-개념)
3. [API 엔드포인트 비교](#api-엔드포인트-비교)
4. [Query Config 차이](#query-config-차이)
5. [워크플로우 차이](#워크플로우-차이)
6. [응답 필드 차이](#응답-필드-차이)
7. [주요 차이점 요약](#주요-차이점-요약)

---

## 개요

이 문서는 Medusa 프레임워크와 Mercur.js(Medusa 기반 마켓플레이스 확장)의 카트 API 차이점을 분석한 명세서입니다.

**조사 범위:**

- 카트 생성 API (POST `/store/carts`)
- 카트 조회 API (GET `/store/carts/:id`)
- 카트 완료 API (POST `/store/carts/:id/complete`)
- Shipping Methods API (POST/DELETE `/store/carts/:id/shipping-methods`)

**조사 결과:**

- DB 스키마는 동일함
- API 라우트 레벨에서 일부 오버라이드 존재
- Query Config와 워크플로우에서 주요 차이점 발견

---

## API 라우트 오버라이드 개념

### 오버라이드(Override)란?

Medusa 프레임워크에서 **오버라이드**는 기존 API 라우트를 커스텀 라우트로 대체하는 것을 의미합니다.

#### 오버라이드하지 않는 경우

```typescript
// Medusa 기본 라우트: packages/medusa/src/api/store/carts/route.ts
export const POST = async (req, res) => {
  // Medusa 기본 로직 실행
  const { result } = await createCartWorkflow(req.scope).run({...})
  res.json({ cart })
}

// Mercur.js에서 별도 라우트 파일을 만들지 않음
// → Medusa 기본 라우트가 그대로 사용됨
```

**결과:** Medusa의 기본 구현이 그대로 실행됩니다.

#### 오버라이드하는 경우

```typescript
// Mercur.js 커스텀 라우트: packages/modules/b2c-core/src/api/store/carts/[id]/complete/route.ts
export const POST = async (req, res) => {
  // 커스텀 로직 실행
  const { result } = await splitAndCompleteCartWorkflow(req.scope).run({...})
  res.json({ order_set: data[0] }) // 다른 응답 구조
}
```

**결과:** Medusa 기본 라우트가 무시되고, Mercur.js의 커스텀 로직이 실행됩니다.

### Mercur.js의 오버라이드 현황

| API 엔드포인트                             | 오버라이드 여부 | 위치                                                                                  |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| `POST /store/carts`                        | ❌ 없음         | Medusa 기본 사용                                                                      |
| `GET /store/carts/:id`                     | ❌ 없음         | Medusa 기본 사용                                                                      |
| `POST /store/carts/:id`                    | ❌ 없음         | Medusa 기본 사용                                                                      |
| `POST /store/carts/:id/complete`           | ✅ 오버라이드   | `mercur/packages/modules/b2c-core/src/api/store/carts/[id]/complete/route.ts`         |
| `POST /store/carts/:id/shipping-methods`   | ✅ 오버라이드   | `mercur/packages/modules/b2c-core/src/api/store/carts/[id]/shipping-methods/route.ts` |
| `DELETE /store/carts/:id/shipping-methods` | ✅ 오버라이드   | `mercur/packages/modules/b2c-core/src/api/store/carts/[id]/shipping-methods/route.ts` |

---

## API 엔드포인트 비교

### 1. 카트 생성 API

#### `POST /store/carts`

**Medusa 기본 구현:**

```typescript
// packages/medusa/src/api/store/carts/route.ts
export const POST = async (req, res) => {
  const workflowInput = {
    ...req.validatedBody,
    customer_id: req.auth_context?.actor_id,
  };

  const { result } = await createCartWorkflow(req.scope).run({
    input: workflowInput as CreateCartWorkflowInputDTO,
  });

  const cart = await refetchCart(result.id, req.scope, req.queryConfig.fields);
  res.status(200).json({ cart });
};
```

**Mercur.js:**

- 오버라이드 없음
- Medusa 기본 구현 그대로 사용
- 동일한 워크플로우(`createCartWorkflow`) 사용

**요청/응답:**

- 요청 구조: 동일
- 응답 구조: Query Config에 따라 필드 차이 발생 (아래 참조)

---

### 2. 카트 조회 API

#### `GET /store/carts/:id`

**Medusa 기본 구현:**

```typescript
// packages/medusa/src/api/store/carts/[id]/route.ts
export const GET = async (req, res) => {
  const cart = await refetchCart(req.params.id, req.scope, req.queryConfig.fields);
  res.json({ cart });
};
```

**Mercur.js:**

- 오버라이드 없음
- Medusa 기본 구현 그대로 사용
- 동일한 `refetchCart` 헬퍼 함수 사용

**요청/응답:**

- 요청 구조: 동일
- 응답 구조: Query Config에 따라 필드 차이 발생

---

### 3. 카트 완료 API

#### `POST /store/carts/:id/complete`

**Medusa 기본 구현:**

- 기본 라우트 존재 (구현 확인 필요)

**Mercur.js 오버라이드:**

```typescript
// mercur/packages/modules/b2c-core/src/api/store/carts/[id]/complete/route.ts
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cart_id = req.params.id;

  // 커스텀 워크플로우: 마켓플레이스용 주문 분할
  const { result } = await splitAndCompleteCartWorkflow(req.scope).run({
    input: { id: cart_id },
    context: { transactionId: cart_id },
  });

  // Order Set 조회
  const {
    result: { data },
  } = await getFormattedOrderSetListWorkflow(req.scope).run({
    input: { filters: { id: result.id } },
  });

  // ⚠️ 응답 구조가 다름: cart 대신 order_set 반환
  res.json({
    order_set: data[0],
  });
};
```

**주요 차이점:**

- 워크플로우: `splitAndCompleteCartWorkflow` (마켓플레이스용 주문 분할)
- 응답 구조: `{ cart }` → `{ order_set }`

---

### 4. Shipping Methods API

#### `POST /store/carts/:id/shipping-methods`

**Medusa 기본 구현:**

- 기본 라우트 존재

**Mercur.js 오버라이드:**

```typescript
// mercur/packages/modules/b2c-core/src/api/store/carts/[id]/shipping-methods/route.ts
export const POST = async (req, res) => {
  // Seller 기반 Shipping Method 추가
  await addSellerShippingMethodToCartWorkflow(req.scope).run({
    input: {
      cart_id: req.params.id,
      option: {
        id: req.validatedBody.option_id,
        data: req.validatedBody.data,
      },
    },
  });

  const {
    data: [cart],
  } = await query.graph({
    entity: 'cart',
    filters: { id: req.params.id },
    fields: req.queryConfig.fields,
  });

  res.json({ cart });
};
```

**주요 차이점:**

- 워크플로우: `addSellerShippingMethodToCartWorkflow` (Seller 검증 포함)
- Seller 기반 검증 로직 추가

#### `DELETE /store/carts/:id/shipping-methods`

**Mercur.js 오버라이드:**

```typescript
export const DELETE = async (req, res) => {
  await removeCartShippingMethodsWorkflow.run({
    container: req.scope,
    input: req.validatedBody,
  });

  const {
    data: [cart],
  } = await query.graph({
    entity: 'cart',
    filters: { id: req.params.id },
    fields: req.queryConfig.fields,
  });

  res.json({ cart });
};
```

---

## Query Config 차이

### Medusa 기본 Query Config

**파일 위치:** `packages/medusa/src/api/store/carts/query-config.ts`

**특징:**

- 구체적인 필드 목록 지정
- `raw_*` 필드 없음
- 제한된 필드만 반환 (성능 최적화)

**주요 필드:**

```typescript
export const defaultStoreCartFields = [
  'id',
  'currency_code',
  'email',
  'total',
  'subtotal',
  'tax_total',
  // ... 구체적인 필드 목록
  'items.id',
  'items.thumbnail',
  'items.product',
  'items.variant',
  'items.tax_lines.id',
  'items.tax_lines.description',
  'items.tax_lines.code',
  'items.tax_lines.rate',
  'items.adjustments.id',
  'items.adjustments.code',
  'items.adjustments.amount',
  // ...
];
```

### Mercur.js 워크플로우용 Query Config

**파일 위치:** `mercur/packages/modules/b2c-core/src/workflows/cart/utils/complete-cart-fields.ts`

**특징:**

- 와일드카드 사용 (`items.*`, `items.tax_lines.*`)
- `raw_*` 필드 포함
- 인벤토리 관련 필드 추가

**주요 필드:**

```typescript
export const completeCartFields = [
  'id',
  'currency_code',
  'email',
  'total',
  'subtotal',
  'tax_total',
  // ... 기본 필드들

  // ⚠️ Medusa에 없는 raw_* 필드들
  'raw_total',
  'raw_subtotal',
  'raw_tax_total',
  'raw_discount_total',
  'raw_discount_tax_total',
  'raw_original_total',
  'raw_original_tax_total',
  'raw_item_total',
  'raw_item_subtotal',
  'raw_item_tax_total',
  'raw_sales_channel_id',
  'raw_original_item_total',
  'raw_original_item_subtotal',
  'raw_original_item_tax_total',
  'raw_shipping_total',
  'raw_shipping_subtotal',
  'raw_shipping_tax_total',
  'raw_original_shipping_tax_total',
  'raw_original_shipping_subtotal',
  'raw_original_shipping_total',

  // ⚠️ 와일드카드 사용
  'items.*',
  'items.tax_lines.*',
  'items.adjustments.*',
  'customer.*',
  'shipping_methods.*',
  'shipping_methods.tax_lines.*',
  'shipping_methods.adjustments.*',
  'shipping_address.*',
  'billing_address.*',
  'region.*',
  'payment_collection.*',
  'payment_collection.payment_sessions.*',

  // ⚠️ 인벤토리 관련 필드 (Medusa에 없음)
  'items.variant.inventory_items.inventory_item_id',
  'items.variant.inventory_items.required_quantity',
  'items.variant.inventory_items.inventory.requires_shipping',
  'items.variant.inventory_items.inventory.location_levels.stock_locations.id',
  'items.variant.inventory_items.inventory.location_levels.stock_locations.name',
  'items.variant.inventory_items.inventory.location_levels.stock_locations.sales_channels.id',
  'items.variant.inventory_items.inventory.location_levels.stock_locations.sales_channels.name',
];
```

### Query Config 사용 위치

**Mercur.js API 미들웨어:**

```typescript
// mercur/packages/modules/b2c-core/src/api/store/carts/middlewares.ts
import * as QueryConfig from '@medusajs/medusa/api/store/carts/query-config';

export const storeCartsMiddlewares: MiddlewareRoute[] = [
  {
    method: ['POST'],
    matcher: '/store/carts/:id/shipping-methods',
    middlewares: [
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig, // ⚠️ Medusa 기본 사용
      ),
    ],
  },
];
```

**결론:**

- API 레벨에서는 Medusa 기본 Query Config 사용
- 워크플로우 레벨에서는 `completeCartFields` 사용
- 실제 API 응답은 Medusa 기본 필드만 포함 (워크플로우 내부에서만 `completeCartFields` 사용)

---

## 워크플로우 차이

### 카트 생성 워크플로우

**Medusa:**

- `createCartWorkflow` 사용
- 기본 카트 생성 로직

**Mercur.js:**

- 오버라이드 없음
- 동일한 `createCartWorkflow` 사용

### 카트 완료 워크플로우

**Medusa:**

- 기본 `completeCartWorkflow` 존재

**Mercur.js:**

- `splitAndCompleteCartWorkflow` 커스터마이징
- 마켓플레이스용 주문 분할 로직:
  - Seller별로 주문 분할
  - Order Set 생성
  - Split Payment 생성

**주요 차이점:**

```typescript
// Mercur.js의 splitAndCompleteCartWorkflow
1. Cart 조회
2. Seller 검증 (validateCartSellersStep)
3. Shipping Options 검증 (validateCartShippingOptionsStep)
4. Seller별로 Line Items 그룹화
5. Seller별 Order 생성
6. Order Set 생성
7. Split Payment 생성
8. Order Set 반환
```

---

## 응답 필드 차이

### Medusa 기본 응답

**Query Config:** `defaultStoreCartFields` 사용

**응답 예시:**

```json
{
  "cart": {
    "id": "cart_123",
    "currency_code": "usd",
    "total": 1500,
    "subtotal": 1500,
    "tax_total": 0,
    "items": [
      {
        "id": "item_123",
        "quantity": 1,
        "unit_price": 1500,
        "product": {...},
        "variant": {...},
        "tax_lines": [
          {
            "id": "tax_123",
            "description": "CA Default Rate",
            "code": "CADEFAULT",
            "rate": 5
          }
        ],
        "adjustments": []
      }
    ]
    // raw_* 필드 없음
  }
}
```

### Mercur.js 응답 (워크플로우 내부)

**Query Config:** `completeCartFields` 사용 (워크플로우 내부에서만)

**응답 예시:**

```json
{
  "cart": {
    "id": "cart_123",
    "currency_code": "usd",
    "total": 1500,
    "subtotal": 1500,
    "tax_total": 0,

    // ⚠️ raw_* 필드 포함 (워크플로우 내부에서만)
    "raw_total": { "value": "1500", "precision": 2 },
    "raw_subtotal": { "value": "1500", "precision": 2 },
    "raw_tax_total": { "value": "0", "precision": 2 },

    "items": [
      {
        "id": "item_123",
        "quantity": 1,
        "unit_price": 1500,
        // ⚠️ 더 많은 필드 포함 (와일드카드 사용)
        "variant": {
          "id": "var_123",
          "inventory_items": {
            "inventory_item_id": "inv_123",
            "required_quantity": 1,
            "inventory": {
              "requires_shipping": true,
              "location_levels": {
                "stock_locations": {
                  "id": "loc_123",
                  "name": "Main Warehouse"
                }
              }
            }
          }
        }
      }
    ]
  }
}
```

**중요:**

- 실제 API 응답은 Medusa 기본 필드만 포함
- `raw_*` 필드는 워크플로우 내부에서만 사용
- API 클라이언트가 받는 응답은 Medusa와 동일한 구조

---

## 주요 차이점 요약

### 1. API 라우트 레벨

| 항목                                       | Medusa    | Mercur.js                   |
| ------------------------------------------ | --------- | --------------------------- |
| `POST /store/carts`                        | 기본 구현 | 오버라이드 없음 (기본 사용) |
| `GET /store/carts/:id`                     | 기본 구현 | 오버라이드 없음 (기본 사용) |
| `POST /store/carts/:id/complete`           | 기본 구현 | ✅ 오버라이드 (주문 분할)   |
| `POST /store/carts/:id/shipping-methods`   | 기본 구현 | ✅ 오버라이드 (Seller 검증) |
| `DELETE /store/carts/:id/shipping-methods` | 기본 구현 | ✅ 오버라이드               |

### 2. Query Config

| 항목                    | Medusa                   | Mercur.js                     |
| ----------------------- | ------------------------ | ----------------------------- |
| API 레벨 Query Config   | `defaultStoreCartFields` | Medusa 기본 사용 (동일)       |
| 워크플로우 Query Config | -                        | `completeCartFields` (커스텀) |
| `raw_*` 필드            | ❌ 없음                  | ✅ 있음 (워크플로우 내부)     |
| 필드 지정 방식          | 구체적 필드 목록         | 와일드카드 사용               |
| 인벤토리 필드           | ❌ 없음                  | ✅ 있음                       |

### 3. 워크플로우

| 항목             | Medusa                 | Mercur.js                                        |
| ---------------- | ---------------------- | ------------------------------------------------ |
| 카트 생성        | `createCartWorkflow`   | 동일 (오버라이드 없음)                           |
| 카트 완료        | `completeCartWorkflow` | `splitAndCompleteCartWorkflow` (커스텀)          |
| Shipping Methods | 기본 워크플로우        | `addSellerShippingMethodToCartWorkflow` (커스텀) |

### 4. 응답 구조

| 항목                  | Medusa            | Mercur.js                 |
| --------------------- | ----------------- | ------------------------- |
| 카트 생성/조회 응답   | `{ cart: {...} }` | 동일                      |
| 카트 완료 응답        | `{ cart: {...} }` | `{ order_set: {...} }` ⚠️ |
| Shipping Methods 응답 | `{ cart: {...} }` | 동일                      |

### 5. 주요 커스터마이징 포인트

1. **마켓플레이스 기능:**
   - Seller 기반 검증
   - 주문 분할 (Order Set)
   - Split Payment

2. **워크플로우 내부:**
   - `raw_*` 필드 사용 (정밀한 금액 계산)
   - 인벤토리 정보 포함
   - 와일드카드로 더 많은 필드 조회

3. **API 응답:**
   - 대부분 Medusa와 동일
   - 카트 완료 API만 다른 응답 구조 (`order_set`)

---

## 결론

### DB 스키마는 동일하지만...

1. **API 라우트 레벨:**
   - 카트 POST/GET은 오버라이드 없음 → Medusa 기본 사용
   - 카트 완료, Shipping Methods는 오버라이드 → 커스텀 로직

2. **Query Config:**
   - API 레벨: Medusa 기본 사용 (동일)
   - 워크플로우 레벨: Mercur.js 커스텀 필드 사용

3. **응답 차이:**
   - 대부분 동일한 구조
   - 카트 완료 API만 다른 응답 (`order_set`)
   - `raw_*` 필드는 워크플로우 내부에서만 사용 (API 응답에는 없음)

4. **주요 차이 원인:**
   - 마켓플레이스 기능 (Seller, Order Set, Split Payment)
   - 워크플로우 내부에서의 상세 필드 조회
   - 카트 완료 시 주문 분할 로직

---

## 참고 자료

- Medusa 카트 API: `packages/medusa/src/api/store/carts/`
- Mercur.js 카트 API: `mercur/packages/modules/b2c-core/src/api/store/carts/`
- Medusa Query Config: `packages/medusa/src/api/store/carts/query-config.ts`
- Mercur.js Query Config: `mercur/packages/modules/b2c-core/src/workflows/cart/utils/complete-cart-fields.ts`
- Medusa 워크플로우: `packages/core/core-flows/src/cart/workflows/create-carts.ts`
- Mercur.js 워크플로우: `mercur/packages/modules/b2c-core/src/workflows/cart/workflows/`

---

**작성일:** 2025-01-XX  
**작성자:** AI Assistant  
**버전:** 1.0.0
