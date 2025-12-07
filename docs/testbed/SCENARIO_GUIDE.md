# 테스트 시나리오 작성 가이드

이 문서는 PIM/WMS API 테스트 시나리오를 작성하는 방법을 설명합니다.

## 목차
- [시나리오란?](#시나리오란)
- [기본 구조](#기본-구조)
- [시나리오 작성하기](#시나리오-작성하기)
- [스텝 정의하기](#스텝-정의하기)
- [컨텍스트 변수 사용하기](#컨텍스트-변수-사용하기)
- [응답 검증하기](#응답-검증하기)
- [고급 기능](#고급-기능)
- [실전 예제](#실전-예제)

---

## 시나리오란?

**시나리오(Scenario)**는 API를 테스트하기 위한 일련의 단계(스텝)를 정의한 것입니다. 각 시나리오는 특정 기능이나 플로우를 검증하기 위해 여러 API 요청을 순차적으로 실행합니다.

예: "카테고리 생성 → 조회 → 수정 → 삭제"라는 CRUD 플로우를 테스트하는 시나리오

---

## 기본 구조

시나리오는 TypeScript 파일에 배열로 정의됩니다:

```typescript
import { z } from 'zod';
import type { Scenario } from './types';

export const myScenarios: Scenario[] = [
  {
    id: 'PREFIX-001',
    name: '시나리오 이름',
    category: 'Service > Domain',
    validation: '검증 내용 설명',
    steps: [
      // 스텝들...
    ],
  },
];
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `string` | 고유 ID (예: `CAT-001`, `SKU-002`) |
| `name` | `string` | 시나리오 이름 (UI에 표시됨) |
| `category` | `string` | 카테고리 (예: `PIM > Category`, `WMS > SKU`) |
| `validation` | `string` | 무엇을 검증하는지 설명 |
| `steps` | `ScenarioStep[]` | 실행할 스텝 목록 (순차 실행) |

---

## 시나리오 작성하기

### 1. 시나리오 파일 생성

`src/scenarios/` 폴더에 새 파일을 만듭니다.

**파일명 규칙:**
- PIM 시나리오: `pim-{domain}.ts` (예: `pim-product.ts`)
- WMS 시나리오: `wms-{domain}.ts` (예: `wms-inventory.ts`)

### 2. 시나리오 배열 정의

```typescript
import { z } from 'zod';
import type { Scenario } from './types';

export const myProductScenarios: Scenario[] = [
  {
    id: 'PROD-001',
    name: '상품 생성 → 조회',
    category: 'PIM > Product',
    validation: '상품이 정상적으로 생성되고 조회되는지 확인',
    steps: [
      // 스텝 정의...
    ],
  },
];
```

### 3. index.ts에 등록

`src/scenarios/index.ts`에 시나리오를 추가:

```typescript
import { myProductScenarios } from './pim-product';

export const allScenarios: Scenario[] = [
  // ...
  ...myProductScenarios,
];
```

---

## 스텝 정의하기

스텝은 단일 API 요청을 나타냅니다.

### 기본 스텝 구조

```typescript
{
  id: 'create-product',           // 스텝 고유 ID
  method: 'POST',                 // HTTP 메서드
  path: '/products',              // API 경로
  body: {                         // 요청 본문 (선택)
    name: 'Test Product',
    price: 10000
  },
  expectedStatus: 201,            // 기대하는 HTTP 상태 코드
  description: '상품 생성',        // 스텝 설명
}
```

### ScenarioStep 필드

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `id` | `string` | O | 스텝 고유 ID |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | O | HTTP 메서드 |
| `path` | `string` | O | API 경로 (컨텍스트 변수 사용 가능) |
| `expectedStatus` | `number` | O | 기대하는 HTTP 상태 코드 |
| `description` | `string` | O | 스텝 설명 (UI에 표시됨) |
| `body` | `Record<string, unknown>` | X | 요청 본문 (POST/PUT/PATCH) |
| `queryParams` | `Record<string, string>` | X | 쿼리 파라미터 |
| `pathParams` | `Record<string, string>` | X | 경로 파라미터 (현재 미사용) |
| `extractFromResponse` | `Record<string, string>` | X | 응답에서 추출할 값 |
| `responseSchema` | `ZodType \| ResponseSchemaFn` | X | 응답 검증 스키마 |

---

## 컨텍스트 변수 사용하기

스텝 간에 데이터를 전달하려면 **컨텍스트 변수**를 사용합니다.

### 1. 응답에서 값 추출하기

`extractFromResponse`를 사용하여 응답 데이터에서 값을 추출:

```typescript
{
  id: 'create-category',
  method: 'POST',
  path: '/categories',
  body: { name: 'Test' },
  expectedStatus: 201,
  description: '카테고리 생성',
  extractFromResponse: {
    categoryId: 'id',           // response.id를 categoryId로 저장
    categorySlug: 'slug'        // response.slug를 categorySlug로 저장
  },
}
```

**추출 경로 규칙:**
- 단순 필드: `'id'` → `response.id`
- 중첩 필드: `'data.userId'` → `response.data.userId`
- 배열: `'items.0.id'` → `response.items[0].id`

### 2. 변수 사용하기

추출한 변수는 `{{변수명}}` 형식으로 사용:

```typescript
{
  id: 'get-category',
  method: 'GET',
  path: '/categories/{{categoryId}}',  // 이전 스텝에서 추출한 categoryId 사용
  expectedStatus: 200,
  description: '생성된 카테고리 조회',
}
```

### 3. body에서 변수 사용

```typescript
{
  id: 'create-child',
  method: 'POST',
  path: '/categories',
  body: {
    name: 'Child Category',
    parentId: '{{categoryId}}',  // 변수 사용
  },
  expectedStatus: 201,
  description: '자식 카테고리 생성',
}
```

### 4. queryParams에서 변수 사용

```typescript
{
  id: 'move-category',
  method: 'PUT',
  path: '/categories/{{childId}}/move',
  queryParams: {
    newParentId: '{{newParentId}}'  // 변수 사용
  },
  expectedStatus: 200,
  description: '카테고리 이동',
}
```

### 5. 특수 변수: {{timestamp}}

현재 타임스탬프를 자동 생성:

```typescript
{
  id: 'create-category',
  method: 'POST',
  path: '/categories',
  body: {
    slug: 'test-category-{{timestamp}}',  // 고유한 slug 생성
  },
  expectedStatus: 201,
  description: '카테고리 생성',
}
```

---

## 응답 검증하기

### 1. 상태 코드 검증 (필수)

모든 스텝은 `expectedStatus`로 HTTP 상태 코드를 검증:

```typescript
{
  id: 'create-product',
  method: 'POST',
  path: '/products',
  expectedStatus: 201,  // 201이 아니면 실패
  description: '상품 생성',
}
```

### 2. 응답 스키마 검증 (선택)

Zod를 사용하여 응답 본문을 검증:

```typescript
import { z } from 'zod';

{
  id: 'get-category',
  method: 'GET',
  path: '/categories/{{categoryId}}',
  expectedStatus: 200,
  description: '카테고리 조회',
  responseSchema: z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
  }),
}
```

### 3. 특정 값 검증

`z.literal()`을 사용하여 정확한 값 검증:

```typescript
{
  id: 'get-updated-product',
  method: 'GET',
  path: '/products/{{productId}}',
  expectedStatus: 200,
  description: '수정된 상품 조회',
  responseSchema: z.object({
    name: z.literal('Updated Product'),  // 정확히 이 값이어야 함
    status: z.literal('active'),
  }),
}
```

### 4. 부분 검증

응답의 일부만 검증:

```typescript
{
  id: 'get-category',
  method: 'GET',
  path: '/categories/{{categoryId}}',
  expectedStatus: 200,
  description: '카테고리 조회',
  responseSchema: z.object({
    displaySettings: z.object({
      menuPositions: z.object({
        topMenu: z.literal(true)
      }),
    }),
  }),
}
```

### 5. 동적 스키마 (고급)

컨텍스트 변수를 사용하는 동적 검증:

```typescript
{
  id: 'get-product',
  method: 'GET',
  path: '/products/{{productId}}',
  expectedStatus: 200,
  description: '상품 조회',
  responseSchema: (ctx) => z.object({
    id: z.literal(ctx.productId),  // 컨텍스트 변수 사용
  }),
}
```

---

## 고급 기능

### 404 테스트

삭제된 리소스를 조회하여 404를 기대:

```typescript
{
  id: 'get-deleted-category',
  method: 'GET',
  path: '/categories/{{categoryId}}',
  expectedStatus: 404,  // 404를 기대
  description: '삭제된 카테고리 조회 (404 예상)',
}
```

### 에러 상황 테스트

중복 데이터 생성 등의 에러 상황 테스트:

```typescript
{
  id: 'add-duplicate-barcode',
  method: 'POST',
  path: '/inventory/skus/{{skuId}}/barcodes',
  body: {
    barcode: 'DUP-BC-{{timestamp}}',
  },
  expectedStatus: 409,  // Conflict 에러 기대
  description: '중복 바코드 추가 시도 (409 예상)',
}
```

### 배열 데이터 처리

```typescript
{
  id: 'bulk-add',
  method: 'POST',
  path: '/inventory/sku-groups/{{groupId}}/members/bulk',
  body: {
    skuIds: ['{{skuId1}}', '{{skuId2}}'],  // 여러 변수 사용
  },
  expectedStatus: 201,
  description: '일괄 멤버 추가',
}
```

---

## 실전 예제

### 예제 1: 기본 CRUD

```typescript
export const categoryScenarios: Scenario[] = [
  {
    id: 'CAT-001',
    name: '카테고리 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Category',
    validation: 'CRUD 전체 플로우 확인',
    steps: [
      {
        id: 'create',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Test Category',
          slug: 'test-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'get',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '카테고리 조회',
      },
      {
        id: 'update',
        method: 'PUT',
        path: '/categories/{{categoryId}}',
        body: {
          name: 'Updated Category',
        },
        expectedStatus: 200,
        description: '카테고리 수정',
      },
      {
        id: 'delete',
        method: 'DELETE',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '카테고리 삭제',
      },
      {
        id: 'verify-delete',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 404,
        description: '삭제 확인 (404 기대)',
      },
    ],
  },
];
```

### 예제 2: 계층 구조 테스트

```typescript
{
  id: 'CAT-004',
  name: '부모-자식 카테고리 계층 구조',
  category: 'PIM > Category',
  validation: '하위 카테고리 목록에 자식이 포함되는지 확인',
  steps: [
    {
      id: 'create-parent',
      method: 'POST',
      path: '/categories',
      body: {
        name: 'Parent Category',
        slug: 'parent-{{timestamp}}',
      },
      expectedStatus: 201,
      description: '부모 카테고리 생성',
      extractFromResponse: { parentId: 'id' },
    },
    {
      id: 'create-child',
      method: 'POST',
      path: '/categories',
      body: {
        name: 'Child Category',
        slug: 'child-{{timestamp}}',
        parentId: '{{parentId}}',  // 부모 ID 참조
      },
      expectedStatus: 201,
      description: '자식 카테고리 생성',
      extractFromResponse: { childId: 'id' },
    },
    {
      id: 'get-children',
      method: 'GET',
      path: '/categories/{{parentId}}/children',
      expectedStatus: 200,
      description: '부모의 하위 카테고리 목록 조회',
    },
  ],
}
```

### 예제 3: 복잡한 플로우 (주문 + 출고)

```typescript
{
  id: 'ORDER-001',
  name: '주문 생성 → 확정 → 피킹 → 출고',
  category: 'WMS > Order Flow',
  validation: '전체 주문 플로우 정상 동작 확인',
  steps: [
    {
      id: 'create-sku',
      method: 'POST',
      path: '/inventory/skus',
      body: {
        name: 'Order Test SKU',
        code: 'ORD-{{timestamp}}',
        barcode: 'BC-{{timestamp}}',
      },
      expectedStatus: 201,
      description: 'SKU 생성',
      extractFromResponse: { skuId: 'id' },
    },
    {
      id: 'create-order',
      method: 'POST',
      path: '/sales-orders',
      body: {
        customerId: 'CUST-001',
        lines: [
          {
            skuId: '{{skuId}}',
            quantity: 10,
            unitPrice: 50000,
          },
        ],
      },
      expectedStatus: 201,
      description: '판매 주문 생성',
      extractFromResponse: { orderId: 'id' },
    },
    {
      id: 'confirm-order',
      method: 'POST',
      path: '/sales-orders/{{orderId}}/confirm',
      expectedStatus: 200,
      description: '주문 확정',
    },
    {
      id: 'create-picking',
      method: 'POST',
      path: '/picking/tasks',
      body: {
        orderId: '{{orderId}}',
      },
      expectedStatus: 201,
      description: '피킹 작업 생성',
      extractFromResponse: { pickingId: 'id' },
    },
    {
      id: 'complete-picking',
      method: 'POST',
      path: '/picking/tasks/{{pickingId}}/complete',
      expectedStatus: 200,
      description: '피킹 완료',
    },
    {
      id: 'create-shipment',
      method: 'POST',
      path: '/shipping/shipments',
      body: {
        orderId: '{{orderId}}',
      },
      expectedStatus: 201,
      description: '출고 생성',
    },
  ],
}
```

---

## API 라우팅 규칙

테스트베드는 두 개의 백엔드 서비스로 요청을 라우팅합니다:

### WMS API 경로
다음 경로로 시작하면 WMS API로 라우팅:
- `/inventory`
- `/warehouses`
- `/orders`
- `/shipping`
- `/picking`
- `/purchase`
- `/movements`
- `/reservations`

### PIM API 경로
위 경로가 아닌 모든 경로는 PIM API로 라우팅

---

## 팁과 모범 사례

### 1. 고유한 데이터 생성
`{{timestamp}}`를 사용하여 매번 고유한 값 생성:
```typescript
slug: 'category-{{timestamp}}'
```

### 2. 명확한 ID 규칙
시나리오 ID는 일관된 규칙 사용:
- `CAT-001`, `CAT-002` (카테고리)
- `PROD-001`, `PROD-002` (상품)
- `SKU-001`, `SKU-002` (SKU)

### 3. 설명적인 이름
시나리오와 스텝에 명확한 설명 작성:
```typescript
name: '카테고리 생성 → 수정 → 조회'
description: '수정된 카테고리 조회'
```

### 4. 스텝은 작게
각 스텝은 하나의 API 호출만:
```typescript
// Good
{ id: 'create', method: 'POST', path: '/categories' }
{ id: 'get', method: 'GET', path: '/categories/{{id}}' }

// Bad - 한 스텝에 여러 작업 (불가능)
```

### 5. 실패 케이스도 테스트
정상 케이스뿐만 아니라 에러 케이스도 테스트:
```typescript
expectedStatus: 404  // 리소스 없음
expectedStatus: 409  // 중복 데이터
expectedStatus: 400  // 잘못된 요청
```

### 6. 응답 검증 활용
중요한 값은 `responseSchema`로 검증:
```typescript
responseSchema: z.object({
  status: z.literal('confirmed'),
  quantity: z.number().min(1),
})
```

---

## 문제 해결

### 변수가 치환되지 않음
- `extractFromResponse`에서 올바른 경로 사용 확인
- 이전 스텝이 성공적으로 실행되었는지 확인
- 변수명 오타 확인 (`{{categoryId}}` vs `{{categotyId}}`)

### 응답 검증 실패
- 실제 응답 구조를 확인하고 스키마 수정
- UI의 응답 뷰어에서 실제 응답 확인
- 선택 필드는 `.optional()` 사용

### 404 에러
- API 경로가 올바른지 확인
- PIM/WMS 라우팅 규칙 확인
- 환경 변수에 올바른 API URL 설정 확인

---

## 다음 단계

1. 기존 시나리오 파일 참고 (`src/scenarios/`)
2. 새 시나리오 작성
3. `src/scenarios/index.ts`에 등록
4. 테스트베드 UI에서 실행 및 검증

더 많은 예제는 프로젝트의 `src/scenarios/` 폴더를 참고하세요.
