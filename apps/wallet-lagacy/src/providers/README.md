# 결제 Provider 시스템 리팩토링

## 개요

CTO 피드백을 바탕으로 결제 MSA 서버의 Provider 패턴과 추상화 레이어를 개선했습니다. 회의에서 요청한 핵심 기능들을 모두 구현하여 확장 가능하고 유지보수가 용이한 결제 시스템을 구축했습니다.

## 🏗️ 아키텍처

```
API Layer
    ↓
PaymentService (추상화 레이어)
    ↓
PaymentProviderFactory (Strategy Pattern)
    ↓
PaymentPolicy (정책 테이블)
    ↓
Concrete Providers (토스, HMS 카드, HMS BNPL)
```

## 🎯 핵심 기능

### 1. 추상화 레이어 구조 ✅

- **상위 레이어**: 하위 구현체의 세부사항을 몰라도 됨
- **기본 결제 기능**: API에서 직접 접근 가능
- **복잡한 로직**: 상위 모듈에서 기본 기능 조합 사용
- **새로운 결제 수단**: 기존 코드 수정 없이 확장 가능

### 2. Strategy Pattern 기반 Provider 구조 ✅

- **통일된 인터페이스**: 모든 Provider가 동일한 API 제공
- **핵심 기능**: 결제, 환불, 취소, 내역 조회
- **쉬운 확장**: 새로운 PG사 추가 시 인터페이스만 구현
- **특수 로직**: 각 Provider 내부에서 처리

### 3. 결제 타입별 Provider 매핑 시스템 ✅

```typescript
// 정책 테이블
export const PAYMENT_POLICY_TABLE = {
  [PaymentType.ORDER]: [
    ProviderType.TOSS,
    ProviderType.HMS_CARD,
    ProviderType.HMS_BNPL,
  ],
  [PaymentType.BNPL_CAPTURE]: [
    ProviderType.HMS_BNPL, // CMS만 허용
  ],
  [PaymentType.MEMBERSHIP_FEE]: [
    ProviderType.HMS_BNPL, // 정기 결제는 CMS
  ],
};
```

### 4. 정책 테이블 기반 비즈니스 로직 관리 ✅

- **코드 수정 없음**: 정책 테이블만 수정으로 대응
- **새로운 결제 타입**: 정책 테이블 확장으로 대응
- **정책 변경**: 코드 배포 없이 설정 변경
- **일관된 접근**: payment-policy.ts를 통한 관리

## 📁 파일 구조

```
src/providers/
├── payment-provider.interface.ts    # 공통 인터페이스 및 타입
├── payment-policy.ts               # 결제 정책 테이블
├── payment-provider.factory.ts     # Provider Factory (Strategy Pattern)
├── toss.provider.ts                # 토스페이먼츠 Provider
├── hms-card.provider.ts            # 효성 카드 Provider
├── hms-bnpl.provider.ts            # 효성 BNPL Provider
└── README.md                       # 이 문서

src/services/
└── payment.service.ts              # 상위 추상화 레이어

src/examples/
└── payment-usage.example.ts        # 사용 예시
```

## 🚀 사용 방법

### 기본 결제 처리

```typescript
// 주문 결제 (토스 사용)
const result = await paymentService.processPayment(
  {
    intentId: 'intent_12345',
    attemptId: 'attempt_12345',
    amount: 50000,
    paymentType: PaymentType.ORDER,
    userId: 'user_12345',
    instrumentType: 'ONE_TIME',
    instrumentRef: 'toss_payment_key_abc123',
  },
  ProviderType.TOSS,
);
```

### 정책 기반 Provider 선택

```typescript
// 허용된 Provider 목록 조회
const allowedProviders = paymentService.getAllowedProviders(PaymentType.ORDER);
// 결과: ['TOSS', 'HMS_CARD', 'HMS_BNPL']

// 정책 위반 시 자동 차단
try {
  await paymentService.processPayment(request, ProviderType.TOSS); // BNPL 정산에 토스 사용 시도
} catch (error) {
  // "결제 정책 위반: BNPL_CAPTURE 결제는 TOSS Provider를 사용할 수 없습니다"
}
```

### 환불 및 취소

```typescript
// 환불 처리
const refundResult = await paymentService.refundPayment(
  {
    intentId: 'refund_intent_12345',
    attemptId: 'refund_attempt_12345',
    amount: 25000,
    reason: '고객 요청',
    transactionId: 'original_tx_12345',
  },
  ProviderType.TOSS,
);

// 결제 취소
const cancelResult = await paymentService.cancelPayment(
  {
    intentId: 'cancel_intent_12345',
    attemptId: 'cancel_attempt_12345',
    reason: '주문 취소',
    transactionId: 'original_tx_12345',
  },
  ProviderType.TOSS,
);
```

## 🔧 확장 방법

### 새로운 Provider 추가

1. **Provider 클래스 구현**:

```typescript
export class NewProvider implements PaymentProvider {
  readonly providerId = ProviderType.NEW_PROVIDER;

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    // 구현
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    // 구현
  }

  // ... 기타 메서드들
}
```

2. **정책 테이블 업데이트**:

```typescript
export const PAYMENT_POLICY_TABLE = {
  [PaymentType.ORDER]: [
    ProviderType.TOSS,
    ProviderType.HMS_CARD,
    ProviderType.HMS_BNPL,
    ProviderType.NEW_PROVIDER, // 추가
  ],
  // ...
};
```

3. **Factory에 등록**:

```typescript
private initializeProviders(): void {
  this.providers.set(ProviderType.NEW_PROVIDER, this.newProvider);
  // ...
}
```

### 새로운 결제 타입 추가

1. **PaymentType enum 확장**:

```typescript
export enum PaymentType {
  ORDER = 'ORDER',
  BNPL_CAPTURE = 'BNPL_CAPTURE',
  MEMBERSHIP_FEE = 'MEMBERSHIP_FEE',
  NEW_TYPE = 'NEW_TYPE', // 추가
}
```

2. **정책 테이블에 매핑 추가**:

```typescript
export const PAYMENT_POLICY_TABLE = {
  // ... 기존 매핑들
  [PaymentType.NEW_TYPE]: [ProviderType.APPROPRIATE_PROVIDER],
};
```

## 🧪 테스트

사용 예시는 `src/examples/payment-usage.example.ts`에서 확인할 수 있습니다:

- ✅ 주문 결제 (토스)
- ✅ BNPL 정산 (HMS BNPL)
- ✅ 정책 위반 차단
- ✅ 허용 Provider 조회
- ✅ 환불 처리
- ✅ 결제 내역 조회

## 🎉 회의 요구사항 달성도

| 요구사항             | 상태 | 구현 내용                         |
| -------------------- | ---- | --------------------------------- |
| 추상화 레이어 구조   | ✅   | PaymentService로 하위 디테일 숨김 |
| Strategy Pattern     | ✅   | PaymentProvider 인터페이스 통일   |
| 결제 타입별 매핑     | ✅   | PAYMENT_POLICY_TABLE로 제어       |
| 결제 프로필 통합     | ✅   | 통일된 프로필 관리 인터페이스     |
| 정책 테이블 관리     | ✅   | payment-policy.ts로 분리 관리     |
| Source of Truth 분리 | ✅   | 각 모듈별 책임 명확화             |

## 🔄 마이그레이션 가이드

기존 코드에서 새로운 구조로 마이그레이션하려면:

1. **기존 Provider 호출**을 **PaymentService** 호출로 변경
2. **결제 타입 명시**하여 정책 검증 활용
3. **통일된 응답 형식** 활용 (`success`, `message` 등)
4. **에러 처리** 개선 (PaymentError, PaymentPolicyError)

이제 확장 가능하고 유지보수가 용이한 결제 시스템이 준비되었습니다! 🚀
