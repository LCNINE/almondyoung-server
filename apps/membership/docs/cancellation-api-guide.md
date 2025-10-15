# 구독 취소 및 환불 API 가이드

## 개요

멤버십 구독 취소 및 환불 기능을 제공합니다. 무료 체험 기간 중 취소 시 전액 환불이 가능하며, 모든 변경 이력은 이벤트 소싱 패턴으로 추적됩니다.

## 주요 기능

- ✅ 일반 구독 취소 (사용자)
- ✅ 강제 구독 취소 (어드민) - 구현 예정
- ✅ 환불 자격 자동 판단
- ✅ 이벤트 소싱 기반 이력 추적
- ✅ 취소 이유 관리

## API 엔드포인트

### 1. 구독 취소

**POST** `/api/subscriptions/cancel`

사용자가 현재 활성 구독을 취소합니다.

#### Request Headers

```
x-dev-user-id: {userId}
```

#### Request Body

```json
{
  "reasonCode": "TRIAL_PERIOD",
  "reasonText": "추가 설명 (선택사항)"
}
```

#### Response (200 OK)

```json
{
  "contractId": "uuid",
  "status": "CANCELLED",
  "cancelledAt": "2025-10-15T10:30:00Z",
  "refundEligible": true,
  "refundAmount": 10000,
  "refundStatus": "PENDING"
}
```

#### 환불 정책

- **무료 체험 기간 중 취소**: 전액 환불 (`refundEligible: true`)
- **무료 체험 기간 후 취소**: 환불 불가 (`refundEligible: false`)

무료 체험 기간은 `billingDate + plan.trialDays`로 계산됩니다.

#### 취소 이유 코드

| 코드             | 설명                                 | 카테고리 |
| ---------------- | ------------------------------------ | -------- |
| `TRIAL_PERIOD`   | 더 나은 서비스를 위해 노력하겠습니다 | TRIAL    |
| `PRICE_TOO_HIGH` | 가격이 저렴하지 않습니다             | PRICE    |
| `NO_PRODUCTS`    | 살만한 제품이 없습니다               | PRODUCT  |
| `DELIVERY_SLOW`  | 배송이 느립니다                      | SERVICE  |
| `DELIVERY_MANY`  | 오배송이 많습니다                    | SERVICE  |
| `SITE_SLOW`      | 사이트가 느립니다                    | SERVICE  |
| `PAYMENT_ISSUE`  | 결제가 불편합니다                    | SERVICE  |
| `DISSATISFIED`   | 불친절합니다                         | SERVICE  |
| `OTHER`          | 기타                                 | OTHER    |

#### Error Responses

**404 Not Found** - 활성 구독이 없음

```json
{
  "statusCode": 404,
  "message": "Active subscription not found"
}
```

**400 Bad Request** - 이미 취소된 구독

```json
{
  "statusCode": 400,
  "message": "Subscription already cancelled"
}
```

### 2. 취소 이유 목록 조회

**GET** `/api/cancellation-reasons`

활성화된 취소 이유 목록을 조회합니다.

#### Response (200 OK)

```json
{
  "reasons": [
    {
      "code": "TRIAL_PERIOD",
      "displayText": "더 나은 서비스를 위해 노력하겠습니다",
      "category": "TRIAL"
    },
    {
      "code": "PRICE_TOO_HIGH",
      "displayText": "가격이 저렴하지 않습니다",
      "category": "PRICE"
    }
  ]
}
```

## 이벤트 소싱

모든 구독 취소는 다음 이벤트로 기록됩니다:

### CANCELLED 이벤트

```json
{
  "eventType": "CANCELLED",
  "metadata": {
    "reason": "TRIAL_PERIOD",
    "reasonText": null,
    "isForced": false
  },
  "causedBy": "USER",
  "causedByUserId": "user_123"
}
```

### REFUND_REQUESTED 이벤트 (환불 자격이 있을 때만)

```json
{
  "eventType": "REFUND_REQUESTED",
  "metadata": {
    "amount": 10000,
    "eligibleAmount": 10000
  },
  "causedBy": "SYSTEM"
}
```

## 데이터베이스 변경사항

### subscriptionContracts 테이블 추가 필드

```sql
status TEXT DEFAULT 'ACTIVE'
cancelled_at TIMESTAMP
cancellation_reason_code TEXT
refund_requested BOOLEAN DEFAULT false
refund_requested_at TIMESTAMP
eligible_refund_amount INTEGER
refund_completed BOOLEAN DEFAULT false
refund_completed_at TIMESTAMP
wallet_reference_id TEXT
last_event_id INTEGER
```

### 새 테이블

- `cancellation_reasons`: 취소 이유 마스터 테이블
- `subscription_contract_events`: 이벤트 소싱 테이블

## 사용 예시

### TypeScript/JavaScript

```typescript
// 구독 취소
const response = await fetch('/api/subscriptions/cancel', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-dev-user-id': 'user_123',
  },
  body: JSON.stringify({
    reasonCode: 'TRIAL_PERIOD',
    reasonText: '아직 사용할 준비가 안 됐어요',
  }),
});

const result = await response.json();

if (result.refundEligible) {
  console.log(`환불 예정 금액: ${result.refundAmount}원`);
} else {
  console.log('환불 대상이 아닙니다');
}
```

### cURL

```bash
curl -X POST http://localhost:3000/api/subscriptions/cancel \
  -H "Content-Type: application/json" \
  -H "x-dev-user-id: user_123" \
  -d '{
    "reasonCode": "TRIAL_PERIOD"
  }'
```

## 테스트

E2E 테스트는 `apps/membership/test/subscription-cancellation.e2e-spec.ts`에 있습니다.

```bash
# 테스트 실행
npm run test:e2e -- subscription-cancellation.e2e-spec.ts
```

### 3. 강제 구독 취소 (어드민)

**POST** `/api/admin/subscriptions/:contractId/force-cancel`

어드민이 정책을 무시하고 구독을 강제로 취소합니다.

#### Request Headers

```
x-dev-user-id: {adminId}
```

#### Request Body

```json
{
  "reason": "시스템 오류로 인한 강제 취소",
  "refundType": "FULL",
  "refundAmount": 5000,
  "adminNote": "고객 요청으로 특별 처리"
}
```

**refundType 옵션:**

- `FULL`: 플랜 가격 전액 환불
- `PARTIAL`: 지정된 금액만 환불 (refundAmount 필수)
- `NONE`: 환불 없음

#### Response (200 OK)

```json
{
  "contractId": "uuid",
  "status": "CANCELLED",
  "cancelledAt": "2025-10-15T10:30:00Z",
  "refundEligible": true,
  "refundAmount": 10000,
  "refundStatus": "PENDING"
}
```

#### Error Responses

**404 Not Found** - 계약을 찾을 수 없음

```json
{
  "statusCode": 404,
  "message": "Contract not found"
}
```

**400 Bad Request** - 잘못된 환불 금액

```json
{
  "statusCode": 400,
  "message": "Invalid refund amount for PARTIAL refund type"
}
```

## 향후 구현 예정

- [x] 강제 취소 API (어드민) ✅
- [ ] 계약 이벤트 이력 조회 API
- [ ] Wallet 서버 환불 완료/실패 이벤트 처리
- [ ] 정책 검증 통합 (MIN_SUBSCRIPTION_PERIOD)

## 관련 문서

- [Requirements](.kiro/specs/subscription-cancellation-refund/requirements.md)
- [Design](.kiro/specs/subscription-cancellation-refund/design.md)
- [Tasks](.kiro/specs/subscription-cancellation-refund/tasks.md)
