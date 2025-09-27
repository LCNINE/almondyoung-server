# Almond Payment Provider Module

아몬드 결제 시스템과 연동하는 Medusa 커스텀 결제 프로바이더입니다.

## 기능

- **혼합 결제 지원**: BNPL + 포인트 동시 사용 가능
- **Event Sourcing**: 모든 결제 이벤트 추적
- **정산 시스템**: 월말 배치 정산 처리
- **웹훅 지원**: 비동기 이벤트 처리

## 설정

`medusa-config.ts`에 다음과 같이 추가:

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  projectConfig: {
    // ...
  },
  modules: [
    {
      resolve: "./src/modules/almond-payment",
      options: {
        apiKey: process.env.ALMOND_PAYMENT_API_KEY,
        endpoint: process.env.ALMOND_PAYMENT_ENDPOINT,
        timeout: 30000,
      },
    },
  ],
})
```

## 환경 변수

```env
ALMOND_PAYMENT_API_KEY=your_api_key_here
ALMOND_PAYMENT_ENDPOINT=http://localhost:3000/api/v1
```

## API 연동

### 결제 처리
- `POST /payment/process` - 결제 승인
- `GET /payment/status/{paymentEventId}` - 결제 상태 조회
- `POST /payment/refund` - 환불 처리

### 지원하는 결제 방식
1. **BNPL**: Buy Now Pay Later
2. **REWARD_POINT**: 포인트 사용

## 사용 예시

```ts
// Medusa에서 자동으로 호출됩니다
const paymentData = {
  invoiceId: "inv_123",
  invoiceSessionId: "session_456",
  payments: [
    {
      methodType: "BNPL",
      amount: 80000,
      paymentMethodId: "pm_bnpl_123"
    },
    {
      methodType: "REWARD_POINT",
      amount: 20000
    }
  ]
};
```

## 이벤트 처리

아몬드 결제 시스템에서 발생하는 이벤트:
- `payment.completed`: 결제 완료
- `payment.failed`: 결제 실패
- `payment.refunded`: 환불 완료

## 에러 처리

모든 API 호출은 적절한 에러 처리와 로깅을 포함합니다:
- 네트워크 타임아웃: 30초
- 재시도 로직: 필요시 구현 가능
- 상세한 에러 메시지 제공