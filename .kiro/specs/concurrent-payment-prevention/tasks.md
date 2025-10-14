# 구현 계획

- [x] 1. 데이터베이스 스키마 수정
  - PostgreSQL 마이그레이션 파일 생성하여 동시 결제 방지 인덱스와 UNKNOWN 상태 추가
  - 활성 결제 시도에 대한 유니크 인덱스 생성: `uq_active_attempt_per_intent`
  - payment_intent_status enum에 'UNKNOWN' 값 추가
  - _Requirements: 3.1, 3.2_

- [x] 2. PaymentOrchestratorService 동시 결제 방지 로직 구현
  - [x] 2.1 이전 활성 결제 시도 취소 헬퍼 메서드 추가
    - `cancelActiveAttempt()` private 메서드 구현
    - 주어진 intentId의 모든 활성 상태 attempt를 'CANCELED'로 업데이트
    - 트랜잭션 컨텍스트 내에서 실행되도록 구현
    - _Requirements: 1.2, 1.3_
  - [x] 2.2 authorizePayment() 메서드에 활성 시도 감지 및 취소 로직 추가
    - 메서드 진입 시 활성 결제 시도 존재 여부 확인
    - 활성 시도 발견 시 자동으로 이전 시도 취소 처리
    - 취소 로그 기록 및 새로운 시도 진행
    - _Requirements: 1.1, 1.2, 4.3_

- [x] 3. UNKNOWN 상태 처리 및 복구 로직 구현
  - [x] 3.1 외부 결제 성공 후 내부 오류 시 UNKNOWN 상태 저장
    - paymentExecutor.authorize() 호출 후 내부 처리 실패 시 UNKNOWN 상태로 설정
    - 트랜잭션 롤백 시에도 UNKNOWN 상태 유지하도록 예외 처리
    - _Requirements: 2.1_
  - [x] 3.2 UNKNOWN 상태 복구 로직 추가
    - authorizePayment() 진입 시 intent 상태가 UNKNOWN인 경우 감지
    - paymentExecutor.inquire() 호출하여 실제 결제 상태 조회
    - 조회 결과에 따라 intent 상태 업데이트 및 적절한 응답 반환
    - _Requirements: 2.2, 2.3_

- [x] 4. 테스트 코드 개선
  - [x] 4.1 타입 안정성 개선
    - ProviderType enum 사용으로 문자열 리터럴 타입 에러 해결
    - 모든 테스트에서 ProviderType.TOSS 사용
  - [x] 4.2 Mock 객체 완성도 향상
    - PaymentExecutorService에 capture 메서드 추가
    - 트랜잭션 mock에 insert 메서드 추가
  - [x] 4.3 테스트 커버리지 확인
    - 9개 테스트 모두 통과 확인
    - 동시 결제 방지, UNKNOWN 복구, 에러 처리 시나리오 검증
