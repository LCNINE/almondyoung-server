# 카트(Cart) API 문서

## API 엔드포인트

### 카트 메타 정보 업데이트

```http
POST /store/carts/{id}
```

- 고객 정보, 지역, 주소 등 카트의 메타 정보를 업데이트합니다.

### 상품 추가

```http
POST /store/carts/{id}/line-items
```

- 카트에 새로운 상품을 추가합니다.

### 상품 수정

```http
POST /store/carts/{id}/line-items/{line_id}
```

- 카트에 있는 상품의 수량 등을 수정합니다.

### 고객 카트 복구

```http
GET /store/customers/me/cart
```

- 로그인한 고객의 미완료 카트를 복구합니다.
- **인증 필요**: Bearer 토큰 또는 세션 인증
- 로그아웃 후 재로그인 시 이전에 담았던 장바구니를 유실하지 않도록 합니다.

**선택 우선순위:**
1. 아이템이 있는 카트를 우선
2. 아이템 수가 많은 카트를 우선
3. 최근에 업데이트된 카트를 우선

**응답 예시 (카트가 있는 경우):**

```json
{
  "cart": {
    "id": "cart_01234...",
    "customer_id": "cus_01234...",
    "items": [...],
    "total": 50000,
    ...
  }
}
```

**응답 예시 (카트가 없는 경우):**

```json
{
  "cart": null,
  "message": "No active cart found for this customer"
}
```

**프론트엔드 사용 예시:**

```typescript
// 로그인 성공 후 카트 복구
const recoverCart = async () => {
  const response = await fetch('/store/customers/me/cart', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const { cart } = await response.json();

  if (cart) {
    // 복구된 카트 ID를 쿠키에 저장
    setCookie('cart_id', cart.id);
  }
};
```

## 가격 구조

### 가격 구성 요소

- `unit_price`: 상품 하나당 순수 가격
- `subtotal`: 상품 가격만 합산한 금액 (세금, 할인, 배송비 제외)
- `total`: 최종 결제 금액 (세금, 배송비 포함, 할인 반영)

## CART 이벤트 발행 정보

### cart.created

카트가 생성되었을 때 발행되는 이벤트입니다.

**이벤트 데이터:**

```json
{
  "id": "카트 ID",
  "customer_id": "고객 ID",
  "region_id": "지역 ID",
  "email": "고객 이메일",
  "created_at": "생성 시간"
}
```

### cart.updated

카트가 업데이트되었을 때 발행되는 이벤트입니다.

**이벤트 데이터:**

```json
{
  "id": "카트 ID",
  "items": [
    {
      "id": "상품 ID",
      "variant_id": "상품 변형 ID",
      "quantity": "수량",
      "unit_price": "상품 하나당 순수 가격"
    }
  ],
  "updated_at": "업데이트 시간"
}
```
