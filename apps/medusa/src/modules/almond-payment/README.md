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

### refundPayment 규약 (ADR-0042)
- **금액**: Medusa 는 `raw_amount` 를 BigNumber(`{ value, precision }`)로 넘긴다. `Number()` 는 NaN 이라 `new BigNumber(input.amount).numeric` 으로 바꾸고, 양의 정수가 아니면 wallet 을 부르기 전에 throw 한다(wallet 은 `@IsInt @Min(1)`).
- **Idempotency-Key**: `medusa-refund:<context.idempotency_key>`(= Medusa refund 행 id). 한계 — provider 호출이 실패하면 Medusa 가 refund 행을 지우므로, wallet 은 환불했는데 응답만 유실된 경우 재시도는 새 키로 나간다. 그때의 방어선은 wallet 환불가능액 검사다.
- **`walletRefundIds`**: 결제 `data` 에 wallet 이 돌려준 환불 id 를 쌓는다. wallet 환불 사실이 돌아왔을 때 «Medusa 가 낸 것»을 가리는 근거다(`reasonCode: 'MEDUSA_REFUND'` 와 함께).
- **`externalRefund` 표식**: `{ walletRefundId, amount }` 가 있고 금액이 같으면 wallet 을 부르지 않고(Medusa 밖에서 이미 끝난 환불을 장부에 넣는 중) 표식을 지운다. 지울 땐 키를 빼지 말고 `null` 로 쓴다 — Medusa 는 JSON 컬럼을 병합 갱신한다.
- **결제 잠금**: provider 가 잡는 게 아니라 **부르는 쪽**이 `paymentRefundLockKey(paymentId)` 를 잡고 환불·표식 쓰기를 한다 — wallet 환불 투영(`api/hooks/payment-events`)과 부분취소 오케스트레이터가 같은 키를 쓴다. 정의는 `refund-data.ts`.

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