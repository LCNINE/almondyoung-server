# Event Sourcing BNPL 시스템 구현 - Tasks

## Implementation Plan

이 구현 계획은 Event Sourcing 패턴을 적용한 BNPL 시스템 구축을 위한 단계별 작업 목록입니다. 각 작업은 테스트 주도 개발 방식으로 진행되며, 점진적으로 복잡성을 증가시키면서 구현합니다.

- [x] 1. 스키마 타입 정합성 수정
  - Drizzle 스키마와 Zod 스키마 간 타입 불일치 해결
  - ID 타입 통일 (ULID 26자리, TSID 21자리)
  - nullable/optional 필드 정합성 확보
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 1.1 Event Sourcing 원칙 적용을 위한 스키마 수정
  - `bnplAccount` 테이블에서 `currentBalance` 필드 제거
  - 모든 상태 변경을 이벤트로만 처리하도록 구조 변경
  - PaymentEvents 테이블에 metadata 필드 추가 (JSON 문자열)
  - _Requirements: 1.1, 1.3, 4.1, 4.3_

- [x] 1.2 실시간 잔액 계산 메서드 구현
  - `BnplAccountService.calculateCurrentBalance()` 메서드 구현
  - `BnplCreditService.calculateUsedAmount()` 메서드 구현  
  - `BnplSettlementService.calculateCurrentBalance()` 메서드 구현
  - Event Sourcing 기반 DEBIT/CREDIT 거래 집계 로직 구현
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. BNPL 서비스 레이어 Event Sourcing 적용
  - 기존 직접 업데이트 방식을 이벤트 생성 방식으로 변경
  - 모든 상태 변경이 불변 이벤트로 기록되도록 구현
  - 실시간 상태 계산 로직 통합
  - _Requirements: 1.1, 1.2, 5.1, 5.2, 5.3, 5.4_

- [x] 2.1 BnplPartialPaymentService Event Sourcing 구현
  - `processPartialPayment()` 메서드에서 DEBIT 이벤트 생성
  - `createBnplTransaction()` 메서드로 실제 DB 저장 구현
  - 직접 잔액 업데이트 제거하고 이벤트 기반 계산으로 변경
  - HMS 연동과 Payment Event 생성 로직 유지
  - _Requirements: 5.1, 1.1, 1.2_

- [x] 2.2 BnplPartialRefundService Event Sourcing 구현
  - `processPartialRefund()` 메서드에서 CREDIT 이벤트 생성
  - `createBnplRefundTransaction()` 메서드로 실제 DB 저장 구현
  - 환불 시 잔액 차감을 이벤트 기반으로 처리
  - 원본 결제 검증 및 환불 가능 금액 확인 로직 유지
  - _Requirements: 5.2, 1.1, 1.2_

- [x] 2.3 BnplSettlementService Event Sourcing 구현
  - 정산 처리 시 직접 잔액 업데이트 제거
  - 정산 완료 시 CREDIT 이벤트 생성으로 변경
  - `requestManualWithdrawal()` 메서드도 이벤트 기반으로 수정
  - 실시간 잔액 계산 메서드 추가
  - _Requirements: 5.3, 1.1, 1.2_

- [x] 3. Payment Event 서비스 메타데이터 처리 구현
  - 서비스 레이어에서 객체로 메타데이터 받기
  - DB 저장 시 JSON 문자열로 변환
  - 응답 시 필요에 따라 객체로 파싱
  - _Requirements: 2.3, 6.3_

- [x] 3.1 BnplPaymentService 메타데이터 처리
  - `requestPayment()` 메서드에서 메타데이터 JSON 직렬화
  - Drizzle 스키마와 일치하는 타입으로 DB 저장
  - 타입 안전성 보장을 위한 명시적 타입 변환
  - _Requirements: 2.3, 6.3_

- [x] 3.2 PaymentService 메타데이터 처리
  - BnplPaymentService와 동일한 메타데이터 처리 로직 적용
  - 코드 일관성 유지를 위한 동일한 패턴 구현
  - _Requirements: 2.3, 6.3_

- [x] 4. 타입 정합성 최종 검증 및 빌드 테스트
  - `npm run build` 성공 확인
  - 모든 타입 에러 해결 검증
  - Drizzle과 Zod 스키마 완전 일치 확인
  - _Requirements: 2.2, 6.2_

- [x] 4.1 실제 DB 연동 구현 완료
  - TODO로 남아있던 모든 메서드들을 실제 구현으로 변경
  - `getTransactionHistory()`, `getAccountStatistics()` 등 실제 DB 조회 로직 구현
  - Event Sourcing 기반 통계 계산 로직 구현
  - _Requirements: 5.4, 3.1, 3.2_

- [x] 5. 문서화 및 가이드라인 작성
  - Event Sourcing 구현 가이드 작성
  - 자주 발생하는 실수들에 대한 오답노트 작성
  - 개발 가이드라인 업데이트
  - BNPL 도메인 아키텍처 문서 업데이트
  - _Requirements: 6.1, 6.4_

## 완료된 작업 요약

### ✅ Event Sourcing 패턴 완전 적용
- 모든 상태 변경을 이벤트로만 처리
- `currentBalance` 필드 완전 제거
- 실시간 잔액 계산 로직 구현
- 불변 이벤트 스트림 구축

### ✅ 타입 정합성 문제 해결
- Drizzle ↔ Zod 스키마 완전 일치
- ID 타입 통일 (ULID/TSID 구분)
- 메타데이터 JSON 직렬화 처리
- 빌드 성공 확인

### ✅ 실제 DB 연동 구현
- TODO 제거 및 실제 구현 완료
- Event Sourcing 기반 서비스 로직
- HMS 연동 유지
- 통계 및 이력 조회 기능

### ✅ 문서화 및 가이드라인
- Event Sourcing 구현 가이드
- 오답노트 및 실수 방지 가이드
- 개발 가이드라인 업데이트
- 아키텍처 문서 업데이트

## 다음 단계 권장사항

### 성능 최적화
- [ ] Event Stream 인덱스 최적화
- [ ] 잔액 계산 캐싱 전략 구현
- [ ] 대량 데이터 처리 최적화

### 모니터링 및 관찰성
- [ ] Event Sourcing 메트릭 수집
- [ ] 잔액 계산 성능 모니터링
- [ ] 이벤트 스트림 건강성 체크

### 테스트 강화
- [ ] Event Sourcing 통합 테스트
- [ ] 성능 테스트 (대량 이벤트 처리)
- [ ] 장애 복구 테스트