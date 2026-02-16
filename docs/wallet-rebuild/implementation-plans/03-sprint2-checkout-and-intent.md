# Sprint 2 - Checkout and Intent

## 1. 목표

사용자 결제 시작 경로를 `POINTS` 기준으로 end-to-end 구현한다.

- Intent 생성/조회/취소/대체
- Leg 구성/authorize/capture
- HMAC 무결성 검증
- HTTP 멱등성 보장

## 2. 범위

### In Scope

- Checkout API
  - `POST /v1/intents`
  - `GET /v1/intents/{intentId}`
  - `PUT /v1/intents/{intentId}/legs`
  - `POST /v1/intents/{intentId}/legs/{legId}/authorize`
  - `POST /v1/intents/{intentId}/legs/{legId}/capture`
  - `POST /v1/intents/{intentId}/cancel`
  - `POST /v1/intents/{intentId}/supersede`
- HMAC verify 모듈
- Idempotency 처리기(HTTP scope)
- Provider capability 인터페이스 + `POINTS` provider
- 0원 fast path

### Out of Scope

- 복합 Provider(TOSS/BANK_TRANSFER) 실구현
- 환불 승인/거절 관리자 플로우

## 3. 구현 작업

## 3.1 HMAC 무결성

- canonical JSON serializer 구현
- signing string(`version + signedAt + payloadHash`) 재구성
- constant-time 비교
- 에러코드 매핑:
  - `SIGNATURE_VERSION_UNSUPPORTED`
  - `SIGNATURE_TIMESTAMP_INVALID`
  - `SIGNATURE_EXPIRED`
  - `INVALID_SIGNATURE`

## 3.2 Intent 생성/상태 전이

- `referenceType` 허용값 검증 (`STORE_ORDER`, `SUBSCRIPTION_BILLING`)
- reference-blocking 단일화 강제
- `SUCCEEDED` reference 재결제 차단
- supersede 시 `SUSPENDED` 전이 시작

## 3.3 Leg/Provider 실행

- Capability 사전 검증(`supports(...)`)
- `POINTS`: authorize/capture/cancel/refund 기본 구현
- Provider 미지원 호출시 `PROVIDER_CAPABILITY_NOT_SUPPORTED`

## 3.4 Idempotency

- `Idempotency-Key` 필수(write API)
- 동일 키+동일 본문 -> 저장된 응답 반환
- 동일 키+상이 본문 -> `409`
- in-progress 키 충돌 -> `409`

## 4. 완료 조건 (Definition of Done)

- 의도 생성부터 `POINTS` 결제 성공까지 E2E green
- HMAC 실패 케이스가 DB write 이전에 차단
- 멱등성 관련 `409` 동작 확인
- 0원 결제는 leg 미생성 즉시 성공 처리

## 5. 테스트 체크리스트

- `S-INT-001~011`
- `S-LEG-001~006`
- `S-ACT-001~003`(부분)
- `S-HMAC-001~006`

## 6. 리스크와 대응

- 리스크: HMAC canonicalization 불일치
  - 대응: 고정 테스트 벡터로 producer/consumer 동시 검증
- 리스크: supersede 경합 시 상태 꼬임
  - 대응: `FOR UPDATE` + partial unique + 경합 테스트

## 7. 산출물

- checkout controller/service/provider 코드
- hmac verifier 모듈 + 테스트 벡터
- idempotency interceptor/service + integration test

