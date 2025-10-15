# Implementation Plan

- [x] 1. RefundService에 누적 환불 검증 추가
  - `refundPayment()` 메서드 수정
  - 기존 환불 이력 조회 로직 추가 (for update 락 포함)
  - 누적 금액 계산 및 초과 검증
  - 에러 메시지에 구체적인 금액 정보 포함
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. TaxInvoiceService에 발행 기한 검증 추가
  - `validateIssuanceDeadline()` private 메서드 생성
  - 익월 10일 23:59:59 계산 로직 구현
  - `createTaxInvoice()` 메서드에 기한 검증 추가
  - `createRefundInvoice()` 메서드에 6개월 기한 검증 추가
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. PaymentController에 환불 멱등성 키 적용
  - `refundPayment()` 메서드에 `Idempotency-Key` 헤더 파라미터 추가
  - `runInTransaction()` 내에서 `checkOrCreate()` 호출
  - 히트 시 기존 결과 반환 로직 추가
  - 환불 완료 후 `complete()` 호출
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
