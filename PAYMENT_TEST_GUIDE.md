# 🚀 결제 시스템 Swagger 테스트 가이드

새로운 Port/Adapter 패턴 기반 결제 시스템을 Swagger UI로 테스트하는 방법입니다.

## 📋 테스트 시나리오

### 1단계: 테스트용 결제수단 및 포인트 준비

#### 1.1 테스트 카드 생성

```
POST /test-setup/payment-methods/card
```

```json
{
  "userId": "user_test_001",
  "methodName": "테스트 카드",
  "cardNumber": "1234567890123456"
}
```

#### 1.2 테스트 BNPL 생성

```
POST /test-setup/payment-methods/bnpl
```

```json
{
  "userId": "user_test_001",
  "methodName": "테스트 BNPL",
  "creditLimit": 1000000,
  "billingCycleDay": 15
}
```

#### 1.3 포인트 충전

```
POST /test-setup/points/charge
```

```json
{
  "userId": "user_test_001",
  "amount": 50000,
  "reason": "테스트용 포인트 충전"
}
```

#### 1.4 설정 확인

결제수단 목록 조회:

```
GET /test-setup/payment-methods/user_test_001
```

포인트 잔액 조회:

```
GET /test-setup/points/user_test_001
```

### 2단계: 혼합 결제 테스트

#### 2.1 결제 세션(청구서) 생성

```
POST /v2/sessions
```

```json
{
  "userId": "user_test_001",
  "amount": 100000,
  "currency": "KRW",
  "metadata": {
    "orderName": "아몬드영 테스트 상품",
    "orderId": "order_test_001"
  }
}
```

**응답에서 `sessionId`를 기억해두세요!**

#### 2.2 혼합 결제 실행

```
POST /v2/payments/process
```

```json
{
  "sessionId": "ps_session_xyz789", // 위에서 받은 sessionId
  "paymentMethods": [
    {
      "paymentMethodId": "pm_card_abc123", // 카드 ID (1단계에서 생성)
      "amount": 50000
    },
    {
      "paymentMethodId": "pm_bnpl_def456", // BNPL ID (1단계에서 생성)
      "amount": 30000
    }
  ],
  "usePoints": 20000,
  "metadata": {
    "orderName": "혼합 결제 테스트"
  }
}
```

**예상 결과:**

- 카드: 즉시결제 완료 (transactionId 반환)
- BNPL: 승인만 완료 (authorizationId 반환)
- 포인트: 즉시 차감 완료

### 3단계: BNPL 출금 실행 (스케줄러 시뮬레이션)

#### 3.1 BNPL 캡처

```
PATCH /v2/payments/deferred/{authorizationId}/capture
```

`{authorizationId}`는 2.2 단계 응답의 `results.deferred[0].authorizationId` 값을 사용하세요.

**예상 결과:**

- BNPL 실제 출금 실행 완료
- HMS 트랜잭션 ID 반환

### 4단계: 결과 확인

#### 4.1 결제 세션(청구서) 상태 확인

```
GET /v2/sessions/{sessionId}
```

#### 4.2 포인트 잔액 확인

```
GET /test-setup/points/user_test_001
```

포인트가 20,000원 차감되었는지 확인하세요.

## 🧪 테스트 케이스별 설명

### 즉시결제 (카드)

- **특징**: authorize + capture 동시 처리
- **응답**: `transactionId` (PG사 트랜잭션 ID)
- **상태**: 즉시 `CAPTURED`

### 후불결제 (BNPL)

- **특징**: authorize와 capture 분리
- **1단계**: `authorizationId` 반환, 내부 한도 차감
- **2단계**: 스케줄러가 실제 HMS 출금 실행
- **상태**: `AUTHORIZED` → `CAPTURED`

### 포인트 사용

- **특징**: 결제수단이 아닌 잔액 차감
- **처리**: 즉시 포인트 차감
- **응답**: 잔액 정보

## ⚠️ 주의사항

1. **테스트 환경**: 모든 어댑터는 Mock 데이터로 동작합니다
2. **금액 일치**: 결제수단 금액 + 포인트 = 총 결제금액이어야 합니다
3. **순서 중요**: 테스트용 데이터 생성 → 결제 실행 → 확인 순서를 지켜주세요
4. **BNPL 한도**: 기본 100만원 한도가 설정됩니다
5. **세션 만료**: 결제 세션은 30분 후 자동 만료됩니다

## 🐛 문제 해결

### 에러: "결제 세션을 찾을 수 없습니다"

- 세션 ID가 올바른지 확인
- 세션이 만료되지 않았는지 확인

### 에러: "결제수단을 찾을 수 없습니다"

- 1단계에서 결제수단이 올바르게 생성되었는지 확인
- GET `/test-setup/payment-methods/{userId}`로 확인

### 에러: "포인트 부족"

- 포인트 충전이 올바르게 되었는지 확인
- GET `/test-setup/points/{userId}`로 잔액 확인

### 에러: "결제 금액이 일치하지 않습니다"

- 결제수단 금액들의 합 + 포인트 사용량 = 세션 총액인지 확인

## 🎯 성공 기준

✅ **모든 단계가 성공하면:**

1. 카드 결제: 즉시 완료 (`CAPTURED`)
2. BNPL 결제: 승인 후 캡처 완료 (`AUTHORIZED` → `CAPTURED`)
3. 포인트: 정확히 차감됨
4. 결제 세션: 최종 `CAPTURED` 상태

이제 Swagger UI에서 위 순서대로 테스트해보세요! 🚀
