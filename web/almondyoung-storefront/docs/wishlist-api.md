# 찜하기 (Wishlist) API 명세서

## 개요

사용자의 관심 상품을 관리하는 위시리스트(찜하기) 기능 API입니다.

- **Base Path**: `/wishlist`
- **인증**: Bearer Token (JWT) 필수
- **태그**: 찜하기

---

## 데이터 모델

### Wishlist 테이블

| 컬럼명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| `id` | `uuid` | 위시리스트 항목 고유 ID | PK, 자동생성 |
| `userId` | `uuid` | 사용자 ID | FK → users.id, NOT NULL |
| `productId` | `varchar(255)` | 상품 ID | NOT NULL |
| `createdAt` | `timestamp` | 생성일시 | 자동생성 |
| `updatedAt` | `timestamp` | 수정일시 | 자동업데이트 |

**유니크 제약**: `(userId, productId)` - 동일 사용자가 같은 상품을 중복 찜할 수 없음

---

## API 목록

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| `POST` | `/wishlist` | 상품 찜하기 토글 (추가/제거) |
| `GET` | `/wishlist` | 찜 목록 조회 |

---

## 1. 상품 찜하기 토글

### `POST /wishlist`

사용자가 특정 상품을 위시리스트에 추가/제거합니다.  
이미 찜한 상품이면 **제거**하고, 찜하지 않은 상품이면 **추가**합니다.

### Request

**Headers**

| 헤더명 | 값 | 필수 |
|--------|-----|------|
| `Authorization` | `Bearer {access_token}` | ✅ |
| `Content-Type` | `application/json` | ✅ |

**Body**

```json
{
  "productId": "prod_01H9ZRXKJ123456789"
}
```

| 필드 | 타입 | 설명 | 필수 |
|------|------|------|------|
| `productId` | `string` | 찜하기에 추가할 상품 ID | ✅ |

### Response

**성공 - 찜 목록에 추가됨 (200 OK)**

```json
{
  "action": "added",
  "message": "찜 목록에 추가되었습니다.",
  "data": {
    "id": "wish_01H9ZRXKJ123456789",
    "userId": "user_01H9ZRXKJ123456789",
    "productId": "prod_01H9ZRXKJ123456789",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**성공 - 찜 목록에서 제거됨 (200 OK)**

```json
{
  "action": "removed",
  "message": "찜 목록에서 제거되었습니다."
}
```

**실패 응답**

| 상태코드 | 설명 |
|----------|------|
| `400` | 잘못된 요청 (상품 ID 누락 등) |
| `401` | 인증되지 않은 사용자 |

---

## 2. 찜 목록 조회

### `GET /wishlist`

사용자의 전체 위시리스트를 조회합니다.  
**최신순**으로 정렬됩니다.

### Request

**Headers**

| 헤더명 | 값 | 필수 |
|--------|-----|------|
| `Authorization` | `Bearer {access_token}` | ✅ |

### Response

**성공 (200 OK)**

```json
[
  {
    "id": "wish_01H9ZRXKJ123456789",
    "userId": "user_01H9ZRXKJ123456789",
    "productId": "prod_01H9ZRXKJ123456789",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "wish_01H9ZRXKJ987654321",
    "userId": "user_01H9ZRXKJ123456789",
    "productId": "prod_01H9ZRXKJ987654321",
    "createdAt": "2023-12-31T00:00:00.000Z",
    "updatedAt": "2023-12-31T00:00:00.000Z"
  }
]
```

**실패 응답**

| 상태코드 | 설명 |
|----------|------|
| `401` | 인증되지 않은 사용자 |

---

## DTO (Data Transfer Objects)

### AddToWishlistDto

```typescript
class AddToWishlistDto {
  @IsString({ message: '상품 ID는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '상품 ID는 필수 입력 항목입니다.' })
  productId: string;
}
```

---

## 사용 예시

### cURL - 찜하기 토글

```bash
# 상품 찜하기 추가/제거
curl -X POST http://localhost:3000/wishlist \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{"productId": "prod_01H9ZRXKJ123456789"}'
```

### cURL - 찜 목록 조회

```bash
# 내 찜 목록 조회
curl -X GET http://localhost:3000/wishlist \
  -H "Authorization: Bearer {access_token}"
```

---

## 비고

- 토글 방식으로 동작하여 동일한 요청을 두 번 보내면 추가 → 제거 순서로 동작
- 상품 정보는 PIM(상품 정보 관리) 서비스에서 별도로 조회 필요
- 찜 목록은 사용자 계정 삭제 시 함께 삭제됨 (`onDelete: 'cascade'`)

