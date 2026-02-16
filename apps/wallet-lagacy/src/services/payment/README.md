# Payment 비즈니스 로직 모듈

## 📋 개요

PaymentIntent 서비스에서 결제 비즈니스 로직을 분리하여 관심사별로 응집시킨 모듈입니다. 회의에서 요청한 관심사 분리와 확장성을 고려한 구조로 설계되었습니다.

## 🏗️ 구조

```
services/payment/
├── payment-orchestrator.service.ts  # 결제 플로우 전체 조율
├── payment-validator.service.ts     # 결제 검증 로직
├── payment-executor.service.ts      # 실제 결제 실행
├── index.ts                         # 모듈 export
└── README.md                        # 이 문서
```

## 🎯 각 서비스의 책임

### PaymentOrchestratorService

- **책임**: 결제 플로우 전체 조율
- **기능**:
  - Intent 기반 결제 실행
  - BNPL 정산 처리
  - DB 트랜잭션 관리
  - Attempt 기록 저장
  - Intent 상태 업데이트

### PaymentValidatorService

- **책임**: 결제 검증 로직
- **기능**:
  - 결제 정책 검증
  - Intent 상태/만료 검증
  - 하드가드 검증 (BNPL_CAPTURE → CMS 강제)
  - 프로필 유효성 검증
  - 비즈니스 규칙 검증

### PaymentExecutorService

- **책임**: 실제 결제 실행
- **기능**:
  - Provider를 통한 결제 실행
  - Provider별 특수 로직 처리
  - 결제 재시도 로직
  - 폴백 결제 처리
  - 에러 처리 및 변환

## 🔄 PaymentService 통합

기존 PaymentService는 이제 통합 레이어 역할을 하며, 새로운 기능들을 제공합니다:

### 새로운 메서드들

```typescript
// Intent 기반 결제 (새로운 방식)
await paymentService.processPaymentByIntent('intent_12345', ProviderType.TOSS, {
  instrumentRef: 'payment_key_abc',
});

// BNPL 정산 처리
await paymentService.processBnplCapture(
  'bnpl_intent_12345',
  30000, // 정산 금액 (선택사항)
);

// 결제 재시도 (고급 기능)
await paymentService.retryPayment(
  request,
  ProviderType.TOSS,
  3, // 최대 재시도 횟수
);

// 폴백 결제 (고급 기능)
await paymentService.processPaymentWithFallback(
  request,
  ProviderType.TOSS, // 주 결제수단
  ProviderType.HMS_CARD, // 폴백 결제수단
);
```

## 🔗 기존 시스템과의 통합

### PaymentIntent 서비스와의 관계

- PaymentIntent: Intent 생명주기 관리에 집중
- PaymentOrchestrator: 실제 결제 실행 로직 담당
- 명확한 책임 분리로 유지보수성 향상

### 호환성 유지

- 기존 `processPayment()` 메서드 유지
- 기존 Provider 인터페이스와 완전 호환
- 점진적 마이그레이션 가능

## 🎉 회의 요구사항 달성

| 요구사항           | 달성 여부 | 구현 내용                     |
| ------------------ | --------- | ----------------------------- |
| 관심사 분리        | ✅        | Intent 관리 vs 결제 실행 분리 |
| 비즈니스 로직 응집 | ✅        | services/payment 폴더로 응집  |
| 확장성             | ✅        | 새로운 기능 쉽게 추가 가능    |
| 유지보수성         | ✅        | 각 서비스별 명확한 책임       |

## 🚀 다음 단계

1. **NestJS 모듈 통합**: PaymentModule에 새로운 서비스들 등록
2. **의존성 주입 설정**: 순환 참조 해결 및 DI 구성
3. **단위 테스트 작성**: 각 서비스별 테스트 코드 작성
4. **통합 테스트**: 전체 플로우 테스트
5. **기존 코드 마이그레이션**: 점진적으로 새로운 구조 적용

이제 결제 시스템이 확장 가능하고 유지보수가 용이한 구조로 개선되었습니다! 🎯
