# 가격정책 API 문서

## 목차
1. [개요](#개요)
2. [API 엔드포인트 목록](#api-엔드포인트-목록)
3. [가격 규칙 구조](#가격-규칙-구조)
4. [API 상세 설명](#api-상세-설명)
5. [사용 예시](#사용-예시)

---

## 개요

가격정책 API는 제품 마스터(Product Master)에 대한 가격 규칙을 관리하고, 변형(Variant)별 가격을 계산하는 기능을 제공합니다.

### 주요 특징

- **3단계 레이어 구조**: `base_price` → `membership_price` → `tiered_price`
- **범위(Scope) 기반 적용**: 모든 변형, 옵션 기반, 특정 변형 선택 가능
- **다양한 연산 타입**: 가격 오프셋, 비율 조정, 가격 덮어쓰기
- **버전 관리**: Draft 버전에서만 규칙 수정 가능

### Base URL
```
/products/:masterId/pricing
```

---

## API 엔드포인트 목록

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/products/:masterId/pricing/rules` | 가격 규칙 조회 |
| PUT | `/products/:masterId/pricing/rules` | 가격 규칙 전체 교체 |
| DELETE | `/products/:masterId/pricing/rules` | 가격 규칙 전체 삭제 |
| POST | `/products/:masterId/pricing/calculate` | 변형 가격 계산 |
| GET | `/products/:masterId/pricing/price-set` | 변형 가격 세트 조회 |

---

## 가격 규칙 구조

### 레이어(Layer)

가격 규칙은 3개의 레이어로 구성되며, 순차적으로 적용됩니다:

1. **base_price** (기본 가격)
   - 모든 고객에게 적용되는 기본 가격 규칙
   - 반드시 최소 1개 이상의 규칙 필요
   - 첫 번째 규칙(order=1)은 반드시 `scopeType: 'all_variants'`여야 함

2. **membership_price** (멤버십 가격)
   - 멤버십 고객에게만 적용되는 가격 규칙
   - `base_price` 레이어 이후에 적용
   - 일반 고객(`regular`)에게는 적용되지 않음

3. **tiered_price** (수량별 가격)
   - 멤버십 고객의 수량별 도매가
   - `minQuantity` 필수
   - `membership_price` 레이어 이후에 적용
   - 멤버십 고객이 특정 수량 이상 구매 시에만 적용

### 범위(Scope Type)

| 타입 | 설명 | scopeTargetIds 필수 여부 |
|------|------|-------------------------|
| `all_variants` | 모든 변형에 적용 | ❌ 불필요 (비어있어야 함) |
| `with_option` | 특정 옵션 값을 가진 변형에 적용 | ✅ 필수 (option_value_id 배열) |
| `variants` | 특정 변형에만 적용 | ✅ 필수 (variant_id 배열) |

### 연산 타입(Operation Type)

| 타입 | 설명 | operationValue 의미 | 예시 |
|------|------|---------------------|------|
| `offset` | 가격에 값을 더하거나 빼기 | 원 단위 증감액 | `+1000` → 1,000원 추가 |
| `scale` | 가격에 비율을 곱하기 | 1000배 단위 (1000 = 100%) | `-50` → 5% 할인 (95% 가격) |
| `override` | 가격을 특정 값으로 덮어쓰기 | 원 단위 절대 가격 | `5000` → 5,000원으로 설정 |

**주의사항:**
- `scale`의 `operationValue`는 -1000 이상이어야 함 (100% 이상 할인 불가)
- `override`의 `operationValue`는 0보다 커야 함

### 규칙 순서(Order)

- 각 레이어 내에서 `order` 값에 따라 순차적으로 적용
- 같은 레이어 내에서 `order` 값은 중복될 수 없음
- 낮은 `order` 값부터 먼저 적용

---

## API 상세 설명

### 1. 가격 규칙 조회

**엔드포인트**
```
GET /products/:masterId/pricing/rules
```

**설명**
- 제품 마스터의 활성(active) 버전에 연결된 가격 규칙을 조회합니다.
- 3개 레이어별로 분류되어 반환됩니다.

**Path Parameters**
| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `masterId` | string | 제품 마스터 ID |

**응답 예시**
```json
{
  "basePriceRules": [
    {
      "id": "rule-uuid-1",
      "masterId": "master-uuid",
      "layer": "base_price",
      "order": 1,
      "scopeType": "all_variants",
      "scopeTargetIds": null,
      "operationType": "override",
      "operationValue": 10000,
      "minQuantity": null,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "rule-uuid-2",
      "masterId": "master-uuid",
      "layer": "base_price",
      "order": 2,
      "scopeType": "with_option",
      "scopeTargetIds": ["option-value-uuid-1", "option-value-uuid-2"],
      "operationType": "offset",
      "operationValue": 2000,
      "minQuantity": null,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "membershipPriceRules": [
    {
      "id": "rule-uuid-3",
      "masterId": "master-uuid",
      "layer": "membership_price",
      "order": 1,
      "scopeType": "all_variants",
      "scopeTargetIds": null,
      "operationType": "scale",
      "operationValue": -100,
      "minQuantity": null,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "tieredPriceRules": [
    {
      "id": "rule-uuid-4",
      "masterId": "master-uuid",
      "layer": "tiered_price",
      "order": 1,
      "scopeType": "all_variants",
      "scopeTargetIds": null,
      "operationType": "scale",
      "operationValue": -50,
      "minQuantity": 10,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**에러 응답**
- `404`: 제품 마스터를 찾을 수 없음

---

### 2. 가격 규칙 전체 교체

**엔드포인트**
```
PUT /products/:masterId/pricing/rules
```

**설명**
- 제품 마스터의 가격 규칙을 전체 교체합니다.
- **중요**: Draft 버전에서만 수정 가능합니다.
- 기존 규칙은 모두 삭제되고 새로운 규칙으로 교체됩니다.
- 규칙 검증 후 저장되며, 저장 후 모든 변형의 가격이 유효한지 검증합니다.

**Path Parameters**
| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `masterId` | string | 제품 마스터 ID |

**Request Body**
```typescript
{
  basePriceRules: Array<{
    order: number;                    // 1 이상, 레이어 내 고유값
    scopeType: 'all_variants' | 'with_option' | 'variants';
    scopeTargetIds?: string[];        // scopeType이 'all_variants'가 아닐 때 필수
    operationType: 'offset' | 'scale' | 'override';
    operationValue: number;           // offset/override: 원 단위, scale: 1000배 단위
    // minQuantity는 base_price 레이어에서 사용 불가
  }>;
  membershipPriceRules: Array<{
    order: number;
    scopeType: 'all_variants' | 'with_option' | 'variants';
    scopeTargetIds?: string[];
    operationType: 'offset' | 'scale' | 'override';
    operationValue: number;
    // minQuantity는 membership_price 레이어에서 사용 불가
  }>;
  tieredPriceRules: Array<{
    order: number;
    scopeType: 'all_variants' | 'with_option' | 'variants';
    scopeTargetIds?: string[];
    operationType: 'offset' | 'scale' | 'override';
    operationValue: number;
    minQuantity: number;              // tiered_price 레이어에서 필수 (1 이상)
  }>;
}
```

**Request Body 예시**
```json
{
  "basePriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000
    },
    {
      "order": 2,
      "scopeType": "with_option",
      "scopeTargetIds": ["option-value-uuid-1"],
      "operationType": "offset",
      "operationValue": 2000
    }
  ],
  "membershipPriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100
    }
  ],
  "tieredPriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -50,
      "minQuantity": 10
    },
    {
      "order": 2,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100,
      "minQuantity": 50
    }
  ]
}
```

**검증 규칙**
1. `basePriceRules`는 최소 1개 이상 필요
2. `basePriceRules`의 첫 번째 규칙(order=1)은 반드시 `scopeType: 'all_variants'`여야 함
3. 각 레이어 내에서 `order` 값은 중복될 수 없음
4. `scopeType`이 `all_variants`가 아닐 때는 `scopeTargetIds`가 필수이며 비어있으면 안 됨
5. `scopeType`이 `all_variants`일 때는 `scopeTargetIds`가 없어야 함 (또는 빈 배열)
6. `tieredPriceRules`의 모든 규칙은 `minQuantity`가 필수 (1 이상)
7. `basePriceRules`와 `membershipPriceRules`에는 `minQuantity`가 없어야 함
8. `scale`의 `operationValue`는 -1000 이상
9. `override`의 `operationValue`는 0보다 커야 함
10. 모든 변형에 대해 최종 가격이 0 이상이어야 함

**응답**
- 성공 시: `200 OK` - 가격 규칙 조회 응답과 동일한 형식

**에러 응답**
- `400`: 검증 실패 (규칙이 유효하지 않음, Draft 버전이 아님 등)
- `404`: 제품 마스터를 찾을 수 없음

---

### 3. 가격 규칙 전체 삭제

**엔드포인트**
```
DELETE /products/:masterId/pricing/rules
```

**설명**
- 제품 마스터의 활성 버전에 연결된 모든 가격 규칙을 삭제합니다.
- 다른 버전에서 사용하지 않는 규칙만 실제로 삭제됩니다.

**Path Parameters**
| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `masterId` | string | 제품 마스터 ID |

**응답**
- 성공 시: `204 No Content`

**에러 응답**
- `404`: 제품 마스터를 찾을 수 없음

---

### 4. 변형 가격 계산

**엔드포인트**
```
POST /products/:masterId/pricing/calculate
```

**설명**
- 특정 변형에 대한 가격을 계산합니다.
- 고객 타입과 수량에 따라 적절한 레이어의 규칙이 적용됩니다.
- 적용된 규칙과 가격 변동 내역을 상세히 반환합니다.

**Path Parameters**
| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `masterId` | string | 제품 마스터 ID |

**Request Body**
```typescript
{
  variantId: string;                  // 필수: 변형 ID
  quantity?: number;                  // 선택: 수량 (1 이상, tiered_price 계산에 사용)
  customerType?: 'regular' | 'membership';  // 선택: 고객 타입 (기본값: 'regular')
}
```

**Request Body 예시**
```json
{
  "variantId": "variant-uuid-1",
  "quantity": 10,
  "customerType": "membership"
}
```

**응답 예시**
```json
{
  "variantId": "variant-uuid-1",
  "price": 8550,
  "totalPrice": 85500,
  "appliedRules": [
    {
      "ruleId": "rule-uuid-1",
      "layer": "base_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000,
      "priceBeforeRule": 0,
      "priceAfterRule": 10000
    },
    {
      "ruleId": "rule-uuid-2",
      "layer": "base_price",
      "order": 2,
      "scopeType": "with_option",
      "operationType": "offset",
      "operationValue": 2000,
      "priceBeforeRule": 10000,
      "priceAfterRule": 12000
    },
    {
      "ruleId": "rule-uuid-3",
      "layer": "membership_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100,
      "priceBeforeRule": 12000,
      "priceAfterRule": 10800
    },
    {
      "ruleId": "rule-uuid-4",
      "layer": "tiered_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -50,
      "priceBeforeRule": 10800,
      "priceAfterRule": 8550
    }
  ],
  "priceBreakdown": {
    "initialPrice": 0,
    "afterBasePrice": 12000,
    "afterMembershipPrice": 10800,
    "afterTieredPrice": 8550
  }
}
```

**가격 계산 흐름**
1. 초기 가격: `0`
2. **base_price 레이어**: 모든 규칙을 순서대로 적용
   - `afterBasePrice`: base_price 레이어 적용 후 가격
3. **membership_price 레이어** (고객 타입이 `membership`인 경우만):
   - `afterMembershipPrice`: membership_price 레이어 적용 후 가격
4. **tiered_price 레이어** (고객 타입이 `membership`이고 `quantity`가 지정된 경우만):
   - `minQuantity` 조건을 만족하는 규칙만 적용
   - `afterTieredPrice`: tiered_price 레이어 적용 후 가격
5. 최종 가격: 마지막 레이어 적용 후 가격 (0 이상으로 보정)

**에러 응답**
- `400`: 변형이 해당 버전에 속하지 않음
- `404`: 제품 마스터 또는 활성 버전을 찾을 수 없음

---

### 5. 변형 가격 세트 조회

**엔드포인트**
```
GET /products/:masterId/pricing/price-set
```

**설명**
- 특정 변형에 대한 모든 가격 정보를 한 번에 조회합니다.
- 기본 가격, 멤버십 가격, 수량별 가격을 모두 포함합니다.

**Path Parameters**
| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `masterId` | string | 제품 마스터 ID |

**Query Parameters**
| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `variantId` | string | 변형 ID (필수) |
| `versionId` | string | 버전 ID (선택, 기본값: 활성 버전) |

**요청 예시**
```
GET /products/master-uuid/pricing/price-set?variantId=variant-uuid-1
```

**응답 예시**
```json
{
  "basePrice": 12000,
  "membershipPrice": 10800,
  "tieredPrices": [
    {
      "minQuantity": 10,
      "price": 8550
    },
    {
      "minQuantity": 50,
      "price": 8100
    }
  ]
}
```

**응답 필드 설명**
- `basePrice`: 일반 고객 가격 (base_price 레이어만 적용)
- `membershipPrice`: 멤버십 고객 가격 (base_price + membership_price 레이어 적용)
- `tieredPrices`: 수량별 가격 배열 (minQuantity 오름차순 정렬)
  - 각 항목은 해당 수량 이상 구매 시 적용되는 단가

**에러 응답**
- `400`: 변형이 해당 버전에 속하지 않음
- `404`: 제품 마스터 또는 버전을 찾을 수 없음

---

## 사용 예시

### 시나리오 1: 기본 가격 규칙 설정

**목표**: 모든 변형 기본 가격 10,000원, 특정 옵션(빨강)은 +2,000원 추가

**요청**
```http
PUT /products/master-uuid/pricing/rules
Content-Type: application/json

{
  "basePriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000
    },
    {
      "order": 2,
      "scopeType": "with_option",
      "scopeTargetIds": ["red-option-value-uuid"],
      "operationType": "offset",
      "operationValue": 2000
    }
  ],
  "membershipPriceRules": [],
  "tieredPriceRules": []
}
```

**결과**
- 일반 변형: 10,000원
- 빨강 옵션 변형: 12,000원

---

### 시나리오 2: 멤버십 할인 추가

**목표**: 멤버십 고객에게 10% 할인

**요청**
```http
PUT /products/master-uuid/pricing/rules
Content-Type: application/json

{
  "basePriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000
    }
  ],
  "membershipPriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100
    }
  ],
  "tieredPriceRules": []
}
```

**결과**
- 일반 고객: 10,000원
- 멤버십 고객: 9,000원 (10% 할인)

---

### 시나리오 3: 수량별 도매가 설정

**목표**: 멤버십 고객이 10개 이상 구매 시 5% 추가 할인, 50개 이상 구매 시 10% 추가 할인

**요청**
```http
PUT /products/master-uuid/pricing/rules
Content-Type: application/json

{
  "basePriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000
    }
  ],
  "membershipPriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100
    }
  ],
  "tieredPriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -50,
      "minQuantity": 10
    },
    {
      "order": 2,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100,
      "minQuantity": 50
    }
  ]
}
```

**가격 계산 예시**
- 일반 고객 1개: 10,000원
- 멤버십 고객 1개: 9,000원
- 멤버십 고객 10개: 8,550원 (9,000원에서 5% 추가 할인)
- 멤버십 고객 50개: 8,100원 (9,000원에서 10% 추가 할인)

**가격 계산 API 호출**
```http
POST /products/master-uuid/pricing/calculate
Content-Type: application/json

{
  "variantId": "variant-uuid-1",
  "quantity": 50,
  "customerType": "membership"
}
```

**응답**
```json
{
  "variantId": "variant-uuid-1",
  "price": 8100,
  "totalPrice": 405000,
  "appliedRules": [
    {
      "ruleId": "rule-1",
      "layer": "base_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000,
      "priceBeforeRule": 0,
      "priceAfterRule": 10000
    },
    {
      "ruleId": "rule-2",
      "layer": "membership_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100,
      "priceBeforeRule": 10000,
      "priceAfterRule": 9000
    },
    {
      "ruleId": "rule-3",
      "layer": "tiered_price",
      "order": 2,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100,
      "priceBeforeRule": 9000,
      "priceAfterRule": 8100
    }
  ],
  "priceBreakdown": {
    "initialPrice": 0,
    "afterBasePrice": 10000,
    "afterMembershipPrice": 9000,
    "afterTieredPrice": 8100
  }
}
```

---

### 시나리오 4: 특정 변형만 가격 변경

**목표**: 특정 변형(variant-uuid-1)만 가격을 5,000원으로 설정

**요청**
```http
PUT /products/master-uuid/pricing/rules
Content-Type: application/json

{
  "basePriceRules": [
    {
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000
    },
    {
      "order": 2,
      "scopeType": "variants",
      "scopeTargetIds": ["variant-uuid-1"],
      "operationType": "override",
      "operationValue": 5000
    }
  ],
  "membershipPriceRules": [],
  "tieredPriceRules": []
}
```

**결과**
- variant-uuid-1: 5,000원 (order=2 규칙이 order=1 규칙을 덮어씀)
- 다른 변형: 10,000원

---

## 주의사항

1. **버전 관리**
   - 가격 규칙은 Draft 버전에서만 수정 가능
   - Active 버전의 규칙은 수정할 수 없음

2. **규칙 순서**
   - 같은 레이어 내에서 `order` 값이 낮을수록 먼저 적용
   - 나중에 적용된 규칙이 이전 규칙의 결과를 기반으로 계산됨

3. **가격 계산**
   - 최종 가격은 항상 0 이상으로 보정됨
   - `tiered_price`는 멤버십 고객이고 수량이 지정된 경우에만 적용

4. **Scope 매칭**
   - `with_option`: 변형이 가진 옵션 값 중 하나라도 `scopeTargetIds`에 포함되면 적용
   - `variants`: 변형 ID가 `scopeTargetIds`에 포함되면 적용

5. **Operation Value 단위**
   - `offset`, `override`: 원 단위
   - `scale`: 1000배 단위 (-100 = 10% 할인, -50 = 5% 할인)

---

## 에러 코드

| HTTP 상태 코드 | 설명 |
|---------------|------|
| 200 | 성공 |
| 204 | 성공 (삭제) |
| 400 | 잘못된 요청 (검증 실패, Draft 버전이 아님 등) |
| 404 | 리소스를 찾을 수 없음 (제품 마스터, 변형, 버전 등) |
| 500 | 서버 내부 오류 |

---

## 추가 정보

- 가격 규칙은 제품 마스터 버전과 연결되어 관리됩니다.
- 활성 버전의 규칙만 가격 계산에 사용됩니다.
- 규칙 삭제 시 다른 버전에서 사용하지 않는 규칙만 실제로 삭제됩니다.

