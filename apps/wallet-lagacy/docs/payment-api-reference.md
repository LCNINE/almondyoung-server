# Payment API 참조 문서

## 📋 목차

- [개요](#개요)
- [기본 정보](#기본-정보)
- [인증 및 권한](#인증-및-권한)
- [공통 응답 형식](#공통-응답-형식)
- [에러 코드](#에러-코드)
- [API 엔드포인트](#api-엔드포인트)
  - [Payment Intent APIs](#payment-intent-apis)
    - [POST /v2/payments/intents](#post-v2paymentsintents) - 결제 의도 생성
    - [GET /v2/payments/intents/:intentId](#get-v2paymentsintentsintentid) - 결제 의도 조회
    - [POST /v2/payments/intents/:intentId/execute](#post-v2paymentsintentsintentidexecute) - 결제 실행
    - [POST /v2/payments/intents/:intentId/process](#post-v2paymentsintentsintentidprocess) - 결제 처리
  - [Checkout APIs](#checkout-apis)
    - [GET /v2/payments/checkout/ui-data/:intentId](#get-v2paymentscheckoutui-dataintentid) - 체크아웃 UI 데이터 조회
    - [POST /v2/payments/checkout/sessions](#post-v2paymentscheckoutsessions) - 체크아웃 세션 생성
  - [Profile APIs](#profile-apis)
    - [POST /v2/payments/profiles/hms-card](#post-v2paymentsprofileshms-card) - HMS 카드 프로필 생성
    - [POST /v2/payments/hms-bnpl/onboard](#post-v2paymentshms-bnplonboard) - HMS BNPL 프로필 온보딩
- [데이터 스키마](#데이터-스키마)
- [예제 시나리오](#예제-시나리오)

---

## 개요

Wallet 서비스의 Payment API는 결제 의도(Intent) 기반의 결제 시스템을 제공합니다. 이 API를 통해 다양한 결제 수단(Toss, HMS 카드, HMS BNPL 등)으로 안전하고 일관된 결제 경험을 구현할 수 있습니다.

### 주요 특징

- **Intent 기반 결제**: 하나의 결제 의도에 대해 여러 결제 수단으로 시도 가능
- **멱등성 지원**: `Idempotency-Key` 헤더를 통한 중복 요청 방지
- **다중 Provider 지원**: Toss, HMS 등 다양한 결제 서비스 제공업체 지원
- **체크아웃 세션**: 웹 기반 결제 UI를 위한 세션 관리
- **프로필 관리**: 결제 수단 등록 및 관리

---

## 기본 정보

- **Base URL**: `https://api.almondyoung.com/v2/payments`
- **Content-Type**: `application/json`
- **API 버전**: v2
- **문서 업데이트**: 2025-01-16

---

## 인증 및 권한

현재 구현에서는 별도의 인증 헤더가 명시되어 있지 않으나, 향후 JWT 토큰 기반 인증이 추가될 예정입니다.

### 멱등성 키

중복 요청 방지를 위해 `Idempotency-Key` 헤더를 사용할 수 있습니다:

```http
Idempotency-Key: unique-key-12345
```

---

## 공통 응답 형식

### 성공 응답

```json
{
  "success": true,
  "data": {
    // 실제 응답 데이터
  }
}
```

### 에러 응답

```json
{
  "statusCode": 400,
  "message": "에러 메시지",
  "error": "Bad Request"
}
```

---

## 에러 코드

| HTTP 상태 코드 | 설명         | 예시                              |
| -------------- | ------------ | --------------------------------- |
| 200            | 성공         | 요청이 성공적으로 처리됨          |
| 201            | 생성됨       | 새로운 리소스가 생성됨            |
| 400            | 잘못된 요청  | 유효성 검사 실패, 잘못된 파라미터 |
| 404            | 찾을 수 없음 | Intent ID가 존재하지 않음         |
| 500            | 서버 에러    | 내부 서버 오류                    |
| 502            | Bad Gateway  | 외부 결제 서비스 오류             |

---

## API 엔드포인트

## Payment Intent APIs

### POST /v2/payments/intents

결제 의도를 생성합니다.

#### 매개변수

| 파라미터   | 타입   | 필수 | 설명                  |
| ---------- | ------ | ---- | --------------------- |
| customerId | string | ✅   | 고객 ID               |
| amount     | number | ✅   | 결제 금액 (양의 정수) |
| type       | enum   | ✅   | 결제 타입             |

#### 헤더

| 헤더명          | 타입   | 필수 | 설명      |
| --------------- | ------ | ---- | --------- |
| Idempotency-Key | string | ❌   | 멱등성 키 |

#### 요청 예제

```http
POST /v2/payments/intents
Content-Type: application/json
Idempotency-Key: intent-creation-12345

{
  "customerId": "cust_01994c82237b706c853ba62344bd51a0",
  "amount": 75000,
  "type": "PURCHASE"
}
```

#### 응답 예제

```json
{
  "id": "pi_01994c82237b706c853ba62344bd51a0",
  "customerId": "cust_01994c82237b706c853ba62344bd51a0",
  "amount": 75000,
  "type": "PURCHASE",
  "status": "PENDING",
  "createdAt": "2025-01-16T10:30:00Z",
  "updatedAt": "2025-01-16T10:30:00Z"
}
```

---

### GET /v2/payments/intents/:intentId

결제 의도 정보를 조회합니다.

#### 매개변수

| 파라미터 | 타입   | 필수 | 설명                    |
| -------- | ------ | ---- | ----------------------- |
| intentId | string | ✅   | 결제 의도 ID (URL 경로) |

#### 요청 예제

```http
GET /v2/payments/intents/pi_01994c82237b706c853ba62344bd51a0
```

#### 응답 예제

```json
{
  "id": "pi_01994c82237b706c853ba62344bd51a0",
  "customerId": "cust_01994c82237b706c853ba62344bd51a0",
  "amount": 75000,
  "type": "PURCHASE",
  "status": "PENDING",
  "metadata": {
    "orderName": "프리미엄 원두 세트"
  },
  "createdAt": "2025-01-16T10:30:00Z",
  "updatedAt": "2025-01-16T10:30:00Z"
}
```

#### 에러 응답

```json
{
  "statusCode": 404,
  "message": "Intent not found: pi_invalid_id",
  "error": "Not Found"
}
```

---

### POST /v2/payments/intents/:intentId/execute

클라이언트에서 받은 결제 정보로 실제 결제를 실행합니다.

#### 매개변수

| 파라미터   | 타입   | 필수 | 설명                       |
| ---------- | ------ | ---- | -------------------------- |
| intentId   | string | ✅   | 결제 의도 ID (URL 경로)    |
| provider   | string | ✅   | 결제 제공업체 (예: "TOSS") |
| paymentKey | string | ✅   | 결제 키                    |

#### 헤더

| 헤더명          | 타입   | 필수 | 설명      |
| --------------- | ------ | ---- | --------- |
| Idempotency-Key | string | ❌   | 멱등성 키 |

#### 요청 예제

```http
POST /v2/payments/intents/pi_01994c82237b706c853ba62344bd51a0/execute
Content-Type: application/json

{
  "provider": "TOSS",
  "paymentKey": "tgen_20250916173151NMof5"
}
```

#### 응답 예제

```json
{
  "success": true,
  "intentId": "pi_01994c82237b706c853ba62344bd51a0",
  "status": "SUCCEEDED",
  "provider": "TOSS",
  "amount": 75000,
  "paymentKey": "tgen_20250916173151NMof5",
  "message": "Toss 테스트 결제가 성공적으로 완료되었습니다."
}
```

#### 에러 응답

```json
{
  "statusCode": 400,
  "message": "지원하지 않는 Provider: INVALID_PROVIDER",
  "error": "Bad Request"
}
```

---

### POST /v2/payments/intents/:intentId/process

백엔드 간 결제 처리를 위한 엔드포인트입니다.

#### 매개변수

| 파라미터      | 타입   | 필수 | 설명                    |
| ------------- | ------ | ---- | ----------------------- |
| intentId      | string | ✅   | 결제 의도 ID (URL 경로) |
| providerType  | enum   | ✅   | 결제 제공업체 타입      |
| profileId     | string | ❌   | 결제 프로필 ID          |
| instrumentRef | string | ❌   | 결제 수단 참조          |

#### 헤더

| 헤더명          | 타입   | 필수 | 설명      |
| --------------- | ------ | ---- | --------- |
| Idempotency-Key | string | ❌   | 멱등성 키 |

#### 요청 예제

```http
POST /v2/payments/intents/pi_01994c82237b706c853ba62344bd51a0/process
Content-Type: application/json

{
  "providerType": "HMS_CARD",
  "profileId": "profile_12345",
  "instrumentRef": "card_67890"
}
```

---

## Checkout APIs

### GET /v2/payments/checkout/ui-data/:intentId

체크아웃 페이지에 필요한 최소한의 UI 데이터를 반환합니다.

#### 매개변수

| 파라미터 | 타입   | 필수 | 설명                    |
| -------- | ------ | ---- | ----------------------- |
| intentId | string | ✅   | 결제 의도 ID (URL 경로) |

#### 요청 예제

```http
GET /v2/payments/checkout/ui-data/pi_01994c82237b706c853ba62344bd51a0
```

#### 응답 예제

```json
{
  "intentId": "pi_01994c82237b706c853ba62344bd51a0",
  "amount": 75000,
  "orderName": "프리미엄 원두 세트",
  "allowedProviders": ["TOSS"],
  "clientConfig": {
    "TOSS": {
      "clientKey": "test_ck_pP2YxJ4K87ZZmMga5K59rRGZwXLO"
    }
  }
}
```

#### 에러 응답

```json
{
  "statusCode": 400,
  "message": "Intent is not in PENDING status: COMPLETED",
  "error": "Bad Request"
}
```

---

### POST /v2/payments/checkout/sessions

체크아웃 세션을 생성합니다.

#### 매개변수

| 파라미터  | 타입   | 필수 | 설명                        |
| --------- | ------ | ---- | --------------------------- |
| intentId  | string | ✅   | 결제 의도 ID                |
| returnUrl | string | ✅   | 결제 성공 시 리다이렉트 URL |
| cancelUrl | string | ✅   | 결제 취소 시 리다이렉트 URL |

#### 요청 예제

```http
POST /v2/payments/checkout/sessions
Content-Type: application/json

{
  "intentId": "pi_01994c82237b706c853ba62344bd51a0",
  "returnUrl": "https://example.com/payment/success",
  "cancelUrl": "https://example.com/payment/cancel"
}
```

#### 응답 예제

```json
{
  "sessionId": "cs_01994c82237b706c853ba62344bd51a0",
  "paymentUrl": "https://api.almondyoung.com/checkout?session=cs_01994c82237b706c853ba62344bd51a0",
  "intentId": "pi_01994c82237b706c853ba62344bd51a0",
  "status": "PENDING",
  "expiresAt": "2025-01-16T11:30:00Z"
}
```

---

## Profile APIs

### POST /v2/payments/profiles/hms-card

HMS 카드 프로필을 생성합니다.

#### 매개변수

| 파라미터       | 타입   | 필수 | 설명                   | 제약조건       |
| -------------- | ------ | ---- | ---------------------- | -------------- |
| userId         | string | ✅   | 사용자 ID              | 최소 1자       |
| memberId       | string | ✅   | 회원 ID                | 1-20자         |
| memberName     | string | ✅   | 회원명                 | 1-25자         |
| phone          | string | ✅   | 전화번호               | 1-12자, 숫자만 |
| payerNumber    | string | ✅   | 납부자 번호 (생년월일) | 6-10자, 숫자만 |
| paymentNumber  | string | ✅   | 카드번호               | 1-16자, 숫자만 |
| payerName      | string | ✅   | 납부자명               | 1-10자         |
| validYear      | string | ✅   | 유효기간 년도          | 2자, 숫자만    |
| validMonth     | string | ✅   | 유효기간 월            | 2자, 숫자만    |
| validUntil     | string | ✅   | 유효기간               | 4자            |
| password       | string | ✅   | 비밀번호 앞 2자리      | 2자, 숫자만    |
| paymentCompany | string | ✅   | 결제 기관 코드         | 최대 3자       |

#### 요청 예제

```http
POST /v2/payments/profiles/hms-card
Content-Type: application/json

{
  "userId": "user_12345",
  "memberId": "member_67890",
  "memberName": "홍길동",
  "phone": "01012345678",
  "payerNumber": "901201",
  "paymentNumber": "1234567890123456",
  "payerName": "홍길동",
  "validYear": "25",
  "validMonth": "12",
  "validUntil": "2512",
  "password": "12",
  "paymentCompany": "011"
}
```

#### 응답 예제

```json
{
  "success": true,
  "profileId": "profile_hms_card_12345",
  "status": "CREATED",
  "message": "HMS 카드 프로필이 성공적으로 생성되었습니다."
}
```

---

### POST /v2/payments/hms-bnpl/onboard

HMS BNPL 프로필 및 동의서를 등록합니다.

#### Content-Type

`multipart/form-data`

#### 매개변수

| 파라미터       | 타입   | 필수 | 설명        | 제약조건  |
| -------------- | ------ | ---- | ----------- | --------- |
| userId         | string | ✅   | 사용자 ID   | 최소 1자  |
| payerName      | string | ✅   | 납부자명    | 최소 1자  |
| phone          | string | ✅   | 전화번호    | 최소 10자 |
| paymentCompany | string | ✅   | 은행 코드   | 최소 1자  |
| paymentNumber  | string | ✅   | 계좌 번호   | 최소 1자  |
| payerNumber    | string | ✅   | 생년월일    | 최소 6자  |
| name           | string | ❌   | 프로필 별칭 | -         |
| agreementFile  | file   | ✅   | 동의서 파일 | -         |

#### 요청 예제

```http
POST /v2/payments/hms-bnpl/onboard
Content-Type: multipart/form-data

--boundary123
Content-Disposition: form-data; name="userId"

user_12345
--boundary123
Content-Disposition: form-data; name="payerName"

홍길동
--boundary123
Content-Disposition: form-data; name="phone"

01012345678
--boundary123
Content-Disposition: form-data; name="paymentCompany"

011
--boundary123
Content-Disposition: form-data; name="paymentNumber"

1234567890123456
--boundary123
Content-Disposition: form-data; name="payerNumber"

901201
--boundary123
Content-Disposition: form-data; name="agreementFile"; filename="agreement.pdf"
Content-Type: application/pdf

[파일 내용]
--boundary123--
```

#### 응답 예제

```json
{
  "success": true,
  "profileId": "profile_hms_bnpl_12345",
  "agreementId": "agreement_67890",
  "status": "ONBOARDED",
  "message": "HMS BNPL 프로필이 성공적으로 온보딩되었습니다."
}
```

---

## 데이터 스키마

### PaymentIntent

```typescript
interface PaymentIntent {
  id: string; // 결제 의도 ID
  customerId: string; // 고객 ID
  amount: number; // 결제 금액
  type: PaymentIntentType; // 결제 타입
  status: PaymentIntentStatus; // 결제 상태
  metadata?: Record<string, any>; // 메타데이터
  createdAt: string; // 생성 시간
  updatedAt: string; // 업데이트 시간
}
```

### PaymentIntentType

```typescript
enum PaymentIntentType {
  PURCHASE = 'PURCHASE', // 구매
  SUBSCRIPTION = 'SUBSCRIPTION', // 구독
  REFUND = 'REFUND', // 환불
}
```

### PaymentIntentStatus

```typescript
enum PaymentIntentStatus {
  PENDING = 'PENDING', // 대기 중
  PROCESSING = 'PROCESSING', // 처리 중
  SUCCEEDED = 'SUCCEEDED', // 성공
  FAILED = 'FAILED', // 실패
  CANCELED = 'CANCELED', // 취소됨
}
```

### ProviderType

```typescript
enum ProviderType {
  TOSS = 'TOSS', // 토스페이먼츠
  HMS_CARD = 'HMS_CARD', // HMS 카드
  HMS_BNPL = 'HMS_BNPL', // HMS BNPL
  POINT = 'POINT', // 포인트
}
```

---

## 예제 시나리오

### 시나리오 1: 웹 체크아웃 결제

1. **결제 의도 생성**

   ```http
   POST /v2/payments/intents
   {
     "customerId": "cust_12345",
     "amount": 50000,
     "type": "PURCHASE"
   }
   ```

2. **체크아웃 세션 생성**

   ```http
   POST /v2/payments/checkout/sessions
   {
     "intentId": "pi_67890",
     "returnUrl": "https://shop.com/success",
     "cancelUrl": "https://shop.com/cancel"
   }
   ```

3. **UI 데이터 조회**

   ```http
   GET /v2/payments/checkout/ui-data/pi_67890
   ```

4. **결제 실행**
   ```http
   POST /v2/payments/intents/pi_67890/execute
   {
     "provider": "TOSS",
     "paymentKey": "tgen_12345"
   }
   ```

### 시나리오 2: 백엔드 간 결제

1. **결제 의도 생성**

   ```http
   POST /v2/payments/intents
   {
     "customerId": "cust_12345",
     "amount": 30000,
     "type": "SUBSCRIPTION"
   }
   ```

2. **결제 처리**
   ```http
   POST /v2/payments/intents/pi_67890/process
   {
     "providerType": "HMS_CARD",
     "profileId": "profile_12345"
   }
   ```

---

## 참고 사항

- 모든 금액은 원(KRW) 단위의 정수로 처리됩니다.
- 시간은 ISO 8601 형식(UTC)으로 반환됩니다.
- 멱등성 키는 최대 255자까지 지원됩니다.
- 파일 업로드는 최대 10MB까지 지원됩니다.

---

**문서 버전**: v2.0  
**최종 업데이트**: 2025-01-16  
**작성자**: API 문서 전문가
