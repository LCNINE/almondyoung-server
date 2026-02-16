# Sprint 1 - Foundation

## 1. 목표

신규 `apps/wallet` 앱의 실행 가능한 최소 기반을 완성한다.

- 앱 부트스트랩(Nest/Config/DB/Events/Auth)
- Wallet v1 핵심 데이터 모델 구축
- 상태 전이 공통 프레임워크(전이 가드 + 전이 로그 + outbox insert) 구축

## 2. 범위

### In Scope

- `apps/wallet` 신규 앱 생성
- `main.ts`, `wallet.module.ts`, `config/env.validation.ts`
- `schema.ts` / `types.ts` 초기 버전
- DB 마이그레이션(핵심 테이블 + 인덱스 + 제약)
- 공통 `inTx`/락/상태전이 유틸
- 헬스 API (`/v1/health`, `/v1/ready`)

### Out of Scope

- 결제 authorize/capture 실제 비즈니스 구현
- 환불/보상 오케스트레이션
- 관리자 API

## 3. 구현 작업

## 3.1 앱 골격

- `nest new g app wallet`로 앱 생성
- `ConfigModule.forRoot({ validate: validateWalletEnv })`
- `DbModule.forRoot({ schema: walletSchema })`
- `EventsModule.forRoot(...)`
- `AuthorizationModule.forRoot(...)`

## 3.2 스키마/타입

- `schema.ts`에 아래 테이블 생성
  - `payment_intents`
  - `payment_legs`
  - `payment_attempts`
  - `refund_requests`
  - `refund_allocations`
  - `manual_cancel_queue_items`
  - `payment_state_transitions`
  - `outbox_events`
  - `provider_webhook_receipts`
- `idempotency_keys` 공용 테이블 재사용 연결
- `types.ts`에 Select/Insert/Update/Tx 타입 정의

## 3.3 상태 전이 프레임워크

- 전이 가능성 검증기
- `SELECT ... FOR UPDATE` 기반 상태 변경 유틸
- 전이 시 `state row update + transition insert + outbox insert` 원자성 보장
- append-only 정책 검사 유틸

## 4. 완료 조건 (Definition of Done)

- 로컬 부팅 및 `/v1/health`, `/v1/ready` 응답 성공
- 마이그레이션 적용 성공
- 아래 제약 정상 동작 테스트 통과
  - reference-blocking partial unique
  - queue open 상태 partial unique
  - webhook receipt unique
- 상태 전이 유닛테스트 통과

## 5. 테스트 체크리스트

- `S-DB-001`, `S-DB-002`, `S-DB-003` 선반영
- 상태 전이 불가능 케이스 차단 테스트
- optimistic lock 충돌 `409` 매핑 테스트

## 6. 리스크와 대응

- 리스크: partial index 조건 누락으로 동시성 버그
  - 대응: migration + integration test에서 경합 재현
- 리스크: 타입 분산으로 도메인 타입 불일치
  - 대응: `schema.ts + types.ts` 단일 SoT 유지

## 7. 산출물

- 앱 골격 코드
- 초기 마이그레이션 SQL
- 상태 전이 유틸/테스트 코드
- Sprint 1 결과 요약 문서

