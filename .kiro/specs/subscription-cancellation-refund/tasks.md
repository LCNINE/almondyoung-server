# Implementation Plan

- [x] 1. 데이터베이스 스키마 추가 및 마이그레이션
  - cancellationReasons, subscriptionContractEvents 테이블 추가
  - subscriptionContracts 테이블 필드 추가
  - 마이그레이션 실행 및 초기 데이터 삽입
  - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 5.1, 5.2_

- [x] 2. 이벤트 소싱 및 취소 이유 서비스 구현
  - ContractEventService 생성 (이벤트 추가/조회) ✅
  - CancellationReasonService 생성 (취소 이유 조회) - 다음 단계
  - _Requirements: 1.2, 4.1, 4.2, 4.3, 4.5_

- [x] 3. 일반 구독 취소 기능 구현
  - SubscriptionCancellationService 생성
  - 환불 자격 확인 및 금액 계산 로직
  - cancelSubscription 메서드 구현 (트랜잭션)
  - POST /subscriptions/cancel API 추가
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1_

- [x] 4. 강제 구독 취소 기능 구현 (어드민)
  - forceCancelSubscription 메서드 구현 ✅
  - 환불 타입별 금액 계산 (FULL, PARTIAL, NONE) ✅
  - POST /admin/subscriptions/:contractId/force-cancel API 추가 ✅
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.2_

- [ ] 5. 어드민 API 추가
  - GET /admin/subscriptions/:contractId/events (이벤트 이력 조회)
  - GET /cancellation-reasons (취소 이유 목록)
  - _Requirements: 1.2, 4.5, 7.3, 7.4_

- [ ] 6. Wallet 환불 이벤트 처리 구현
  - RefundEventHandler 생성
  - handleRefundCompleted, handleRefundFailed 메서드 구현
  - 모듈에 등록 (Kafka 연동은 추후)
  - _Requirements: 5.3, 5.4, 5.5_

- [ ] 7. 기존 구독 서비스에 이벤트 추가
  - createSubscription에 CREATED 이벤트 기록
  - upgradeSubscription에 PLAN_CHANGED 이벤트 기록
  - _Requirements: 4.1_

- [ ]\* 8. E2E 테스트 작성
  - 무료 체험 기간 중/후 취소 테스트
  - 강제 취소 테스트 (FULL, PARTIAL, NONE)
  - 환불 이벤트 처리 테스트
  - _Requirements: 전체_
