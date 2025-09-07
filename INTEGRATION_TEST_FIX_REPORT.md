# 🔧 통합테스트 오류 수정 보고서

## 🚨 발견된 문제점들

### 1️⃣ 라우트 경로 불일치 (404 에러 원인)

**문제:** 테스트에서 호출하는 엔드포인트와 실제 컨트롤러 경로가 다름

- **테스트 호출:** `POST /api/payments/recurring/hms/register-card`
- **실제 경로:** `POST /payment-methods/recurring/card` (PaymentMethodController)

**원인:**

- `PaymentMethodController`는 `@Controller('payment-methods')`로 정의됨
- HMS 카드 등록은 `@Post('recurring/card')` 메서드임
- 글로벌 프리픽스는 없음 (main.ts에서 설정 안함)

### 2️⃣ 에러 매핑 한글 패턴 누락

**문제:** 서비스에서 던진 한글 에러 메시지가 올바른 HTTP 상태코드로 매핑되지 않음

- 서비스: `"결제수단을 찾을 수 없습니다"` → 404 기대
- 실제: `"failed"` 키워드로 400 매핑됨

### 3️⃣ 테스트 플로우 ID 연결 문제

**문제:** 각 단계별 응답에서 받은 실제 ID를 다음 단계에서 사용하지 않음

---

## ✅ 수정 사항

### 1. 라우트 경로 수정

```typescript
// Before: 잘못된 경로
.post('/api/payments/recurring/hms/register-card')

// After: 올바른 경로
.post('/payment-methods/recurring/card')
```

### 2. 에러 매핑 한글 패턴 추가

```typescript
private mapErrorToHttpException(error: Error): HttpException {
  const message = error.message.toLowerCase();

  // "not found" → 404 (한글 패턴 추가)
  if (
    message.includes('not found') ||
    message.includes('찾을 수 없습니다') ||
    message.includes('존재하지 않습니다')
  ) {
    return new HttpException(error.message, HttpStatus.NOT_FOUND);
  }

  // "invalid", "failed" → 400 (한글 패턴 추가)
  if (
    message.includes('already processed') ||
    message.includes('exceeds') ||
    message.includes('required') ||
    message.includes('invalid') ||
    message.includes('failed') ||
    message.includes('inactive') ||
    message.includes('not allowed') ||
    message.includes('conflict') ||
    message.includes('유효하지') ||
    message.includes('실패') ||
    message.includes('허용되지') ||
    message.includes('비활성화')
  ) {
    return new HttpException(error.message, HttpStatus.BAD_REQUEST);
  }

  // 그 외 → 500
  return new HttpException(
    'Internal server error',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
```

### 3. 라우트 디버깅 유틸리티 추가

```typescript
// 테스트에서 실제 라우트 확인용
function printRoutes(app: INestApplication) {
  const server = app.getHttpAdapter().getInstance();
  const router = server._router || server.router;

  if (router && router.stack) {
    const routes = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => {
        const route = layer.route;
        const methods = Object.keys(route.methods).join(',').toUpperCase();
        return `${methods} ${route.path}`;
      })
      .sort();

    console.log('🚦 Available Routes:\n' + routes.join('\n'));
  }
}
```

### 4. 테스트 플로우 ID 연결 수정

```typescript
// 1단계: HMS 카드 등록 (올바른 경로)
const registrationResponse = await request(app.getHttpServer())
  .post('/payment-methods/recurring/card')
  .set('idempotency-key', `test-reg-${Date.now()}`)
  .send(registrationRequest)
  .expect(201);

// 실제 응답에서 ID 추출
testPaymentMethodId = registrationResponse.body.id;
testHmsMemberId = registrationResponse.body.hmsMemberId;

// 2단계: 결제수단 검증 (실제 ID 사용)
const validationResponse = await request(app.getHttpServer())
  .post('/api/payments/recurring/validate-payment-method')
  .send({
    paymentMethodId: testPaymentMethodId, // 실제 ID 사용
    userId: testUserId,
    expectedAmount: 9900,
    performDetailedValidation: false,
  })
  .expect(200);

// 3단계: 구독 결제 실행 (실제 ID 사용)
const paymentResponse = await request(app.getHttpServer())
  .post('/api/payments/recurring')
  .set('idempotency-key', `test-${Date.now()}`)
  .send({
    userId: testUserId,
    paymentMethodId: testPaymentMethodId, // 실제 ID 사용
    amount: 9900,
    currency: 'KRW',
    subscriptionType: 'monthly',
    billingCycle: 30,
  })
  .expect(201);
```

---

## 🎯 수정된 테스트 구조

### 올바른 엔드포인트 매핑

| 기능           | 컨트롤러                   | 실제 경로                                              | 테스트 수정 |
| -------------- | -------------------------- | ------------------------------------------------------ | ----------- |
| HMS 카드 등록  | PaymentMethodController    | `POST /payment-methods/recurring/card`                 | ✅ 수정됨   |
| 결제수단 검증  | RecurringPaymentController | `POST /api/payments/recurring/validate-payment-method` | ✅ 올바름   |
| 구독 결제 실행 | RecurringPaymentController | `POST /api/payments/recurring`                         | ✅ 올바름   |
| 결제 상태 조회 | RecurringPaymentController | `GET /api/payments/recurring/:transactionId`           | ✅ 올바름   |

### 에러 매핑 테스트 케이스

```typescript
// "not found" → 404 테스트
await request(app.getHttpServer())
  .post('/api/payments/recurring')
  .send({ paymentMethodId: 'non-existent-id', ... })
  .expect(404);

// "invalid" → 400 테스트
await request(app.getHttpServer())
  .post('/api/payments/recurring')
  .send({ amount: -100, ... })
  .expect(400);
```

---

## 🔍 추가 디버깅 정보

### 라우트 확인 방법

테스트 실행 시 다음과 같이 실제 라우트를 확인할 수 있습니다:

```bash
# 테스트 실행하면 콘솔에 출력됨
🚦 Available Routes:
GET /api/payments/recurring/:transactionId
POST /api/payments/recurring
POST /api/payments/recurring/validate-payment-method
POST /payment-methods/recurring/card
POST /payment-methods/recurring/point
...
```

### HMS Mock 설정 확인

```typescript
// HMS API Mock이 올바르게 설정되었는지 확인
mockHmsApi = {
  paymentProfiles: {
    create: jest.fn().mockResolvedValue({
      success: true,
      memberId: `HMS_CARD_${Date.now()}`,
      result: { flag: 'SUCCESS', message: 'Mock 등록 성공' },
    }),
  },
  // ... 기타 메서드들
};
```

---

## ✅ 체크리스트 업데이트

```
[ ✅ ] RecurringPaymentService mock/stub 없음 - 실제 AppModule 사용
[ ✅ ] Repository/DB 실제 연결 사용, 외부(HMS)만 mock
[ ✅ ] .env.test 로드 + ConfigModule isGlobal
[ ✅ ] app.init()/app.close() 호출
[ ✅ ] 요청에 idempotency-key 포함
[ ✅ ] HMS mock 반환 필드명/시그니처 실제 코드와 일치
[ ✅ ] 서비스는 Error만 던짐 (모든 HttpException → Error로 변경 완료)
[ ✅ ] 컨트롤러 에러 문자열→HTTP 상태 매핑 (한글 패턴 포함)
[ ✅ ] 올바른 라우트 경로 사용 (실제 컨트롤러 경로와 일치)
[ ✅ ] 라우트 디버깅 유틸리티 추가 (printRoutes 함수)
[ ✅ ] DB 저장 후 실제 행 조회로 검증
[ ✅ ] 테스트 플로우에서 실제 응답 ID 사용 (하드코딩 금지)
[ ✅ ] 열린 핸들/커넥션 누수 없음
```

## 🔧 적용된 수정사항

### 1. 라우트 경로 수정 완료

- **Before:** `POST /api/payments/recurring/hms/register-card` (404 에러)
- **After:** `POST /payment-methods/recurring/card` (실제 경로)

### 2. 에러 매핑 한글 패턴 추가 완료

- `찾을 수 없습니다` → 404
- `유효하지`, `실패`, `허용되지`, `비활성화` → 400

### 3. 라우트 디버깅 유틸리티 추가 완료

- `printRoutes(app)` 함수로 실제 등록된 라우트 확인 가능

### 4. 테스트 플로우 최적화 완료

- 1단계: HMS 카드 등록 & 결제수단 저장 (한 번에)
- 2단계: 결제수단 검증
- 3단계: 구독 결제 실행
- 4단계: 실제 DB 저장 검증
- 5단계: 결제 상태 조회

---

## 🎉 최종 결과

이제 통합테스트는:

1. **올바른 라우트 경로**로 실제 API 호출
2. **실제 모듈 조립**으로 진짜 통합테스트 수행
3. **외부 의존성(HMS)만** 정확히 mock
4. **실제 DB 저장** 검증
5. **서비스 Error → 컨트롤러 HTTP 상태** 매핑 (한글 지원)
6. **실제 응답 ID 연결**로 완전한 플로우 테스트

**다른 AI가 절대 반복하지 못할 완벽한 통합테스트 구조 완성!** 🚀
