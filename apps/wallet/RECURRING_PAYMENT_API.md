# Recurring Payment API Documentation

## Overview
The Recurring Payment API provides subscription payment processing capabilities for the AlmondYoung platform. It supports HMS card payments, BNPL (Buy Now Pay Later), and reward points for subscription billing.

## Authentication
All API endpoints require JWT authentication with appropriate scopes.

```http
Authorization: Bearer <jwt_token>
```

## Base URL
```
https://api.almondyoung.com/api/payments/recurring
```

## Endpoints

### 1. Process Recurring Payment

Process a subscription payment using a registered payment method.

**Endpoint:** `POST /`

**Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer <token>`
- `Idempotency-Key: <unique_key>` (optional)
- `X-Correlation-ID: <correlation_id>` (optional)

**Request Body:**
```json
{
  "userId": "user_123456789",
  "paymentMethodId": "pm_01HQZX8QJKMNPQRST9VWXY012",
  "amount": 9900,
  "currency": "KRW",
  "subscriptionType": "monthly",
  "billingCycle": 30,
  "discountAmount": 1000,
  "discountMetadata": {
    "couponId": "COUPON123",
    "discountRate": 10
  }
}
```

**Success Response (201):**
```json
{
  "success": true,
  "transactionId": "txn_01HQZX8QJKMNPQRST9VWXY012",
  "paymentEventId": "pe_01HQZX8QJKMNPQRST9VWXY012",
  "status": "CAPTURED",
  "amount": 9900,
  "processedAt": "2024-01-15T10:30:00.000Z",
  "gatewayResponse": {
    "approvalNumber": "APPR123456",
    "paymentDate": "20240115"
  }
}
```

**Error Response (400/409/422):**
```json
{
  "success": false,
  "errorType": "HMS_MEMBER_PENDING",
  "message": "회원 등록이 진행중입니다. 잠시 후에 시도해주세요.",
  "retryable": true,
  "retryAfterSeconds": 300,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "req_01HN2K3M4P5Q6R7S8T9U0V1W2X",
  "details": {
    "reason": "INVALID_HMS_STATUS",
    "hmsStatus": "신청중",
    "hmsMemberId": "HMS123456",
    "paymentMethodId": "pm_01HN2K3M4P5Q6R7S8T9U0V1W2X"
  },
  "httpStatusCode": 409
}
```

### 2. Validate Payment Method

Validate if a payment method can be used for subscription payments.

**Endpoint:** `POST /validate-payment-method`

**Request Body:**
```json
{
  "paymentMethodId": "pm_01HQZX8QJKMNPQRST9VWXY012",
  "userId": "user_123456789",
  "methodType": "CARD",
  "expectedAmount": 9900,
  "performDetailedValidation": true
}
```

**Success Response (200):**
```json
{
  "isValid": true,
  "paymentMethodId": "pm_01HQZX8QJKMNPQRST9VWXY012",
  "methodType": "CARD",
  "status": "ACTIVE",
  "paymentPurpose": "SUBSCRIPTION",
  "hmsMemberId": "HMS_123456789",
  "validationDetails": {
    "hmsStatus": "신청완료",
    "lastValidated": "2024-01-15T10:30:00.000Z"
  }
}
```

### 3. Get Payment Status

Retrieve the status of a recurring payment transaction.

**Endpoint:** `GET /{transactionId}`

**Success Response (200):**
```json
{
  "transactionId": "txn_01HQZX8QJKMNPQRST9VWXY012",
  "paymentEventId": "pe_01HQZX8QJKMNPQRST9VWXY012",
  "status": "CAPTURED",
  "amount": 9900,
  "currency": "KRW",
  "processedAt": "2024-01-15T10:30:00.000Z",
  "isSubscriptionPayment": true,
  "subscriptionType": "monthly",
  "paymentPurpose": "SUBSCRIPTION",
  "gatewayResponse": {
    "approvalNumber": "APPR123456",
    "paymentDate": "20240115"
  }
}
```

## Error Codes

| Error Type | HTTP Status | Description | Retryable |
|------------|-------------|-------------|-----------|
| `PAYMENT_METHOD_NOT_FOUND` | 404 | Payment method not found | No |
| `PAYMENT_METHOD_INVALID_PURPOSE` | 422 | Payment method not allowed for subscriptions | No |
| `HMS_MEMBER_PENDING` | 409 | HMS member registration in progress | Yes (5 min) |
| `HMS_MEMBER_FAILED` | 422 | HMS member registration failed | No |
| `BNPL_INSUFFICIENT_CREDIT` | 422 | Insufficient BNPL credit | Yes (1 hour) |
| `CONCURRENCY_CONFLICT` | 409 | Concurrent payment request conflict | Yes (1 min) |
| `GATEWAY_TIMEOUT` | 504 | Payment gateway timeout | Yes (5 min) |

## Idempotency

The API supports idempotency through the `Idempotency-Key` header. Duplicate requests with the same key will return the cached result instead of processing again.

## Rate Limiting

- 100 requests per minute per user
- 10 concurrent requests per payment method

## Webhooks

Subscription payment events are sent to registered webhook endpoints:

```json
{
  "eventType": "recurring_payment.completed",
  "transactionId": "txn_01HQZX8QJKMNPQRST9VWXY012",
  "userId": "user_123456789",
  "amount": 9900,
  "status": "CAPTURED",
  "subscriptionType": "monthly",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## SDK Examples

### Node.js
```javascript
const recurringPayment = await fetch('/api/payments/recurring', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Idempotency-Key': generateIdempotencyKey()
  },
  body: JSON.stringify({
    userId: 'user_123',
    paymentMethodId: 'pm_456',
    amount: 9900,
    subscriptionType: 'monthly'
  })
});
```

### cURL
```bash
curl -X POST https://api.almondyoung.com/api/payments/recurring \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{
    "userId": "user_123456789",
    "paymentMethodId": "pm_01HQZX8QJKMNPQRST9VWXY012",
    "amount": 9900,
    "subscriptionType": "monthly"
  }'
```