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
