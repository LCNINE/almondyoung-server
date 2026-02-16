# Sprint 4 - Admin, Webhook, Ops

## 1. 목표

운영자가 실제 장애/예외 상황을 처리할 수 있는 관리 기능과 외부 웹훅 경계를 완성한다.

- 관리자 API(큐/수동확정/환불승인/재처리)
- role/scope 권한 모델 적용
- provider webhook 멱등 처리
- 운영 관측/감사 로그 강화

## 2. 범위

### In Scope

- `/v1/admin` API 구현
- 권한 가드(`wallet.admin.*`, `wallet.service.*`)
- 감사로그 append-only 저장/조회
- `POST /v1/webhooks/{providerType}` 구현
- 운영 검색/timeline API

### Out of Scope

- 고급 MFA/step-up 인증(정책 확정 이후)
- Admin UI 프론트엔드 구현

## 3. 구현 작업

## 3.1 Admin API

- queue API:
  - assign/process/complete/fail/close
- manual confirm API:
  - `manual-confirm`, `manual-confirm-fail`
- refund approval API:
  - approve/reject
- reconcile retry API:
  - intent/leg 단위 재처리

## 3.2 권한/감사

- role -> scope 매핑 로컬 정책 구현
- write API 공통 감사 필드 저장:
  - `actorId`, `action`, `targetId`, `beforeStatus`, `afterStatus`,
    `reasonCode`, `correlationId`, `idempotencyKey`

## 3.3 Webhook 멱등

- provider 서명 검증
- `providerEventId` 추출
- `provider_webhook_receipts` insert-first
- unique 충돌시 no-op `2xx`

## 4. 완료 조건 (Definition of Done)

- 관리자 write API 모두 idempotency 적용
- 권한 없는 write 액션 100% 차단
- 웹훅 중복 전달 시 상태 재전이 없음
- 감사로그 조회로 모든 운영 액션 추적 가능

## 5. 테스트 체크리스트

- `S-ADM-001~010`
- `S-MSG-008~009`
- `S-DB-008`

## 6. 리스크와 대응

- 리스크: 수동 큐 중복 open row 생성
  - 대응: partial unique + upsert/update 정책 강제
- 리스크: 운영자 오조작
  - 대응: 상태 가드 + reasonCode 필수 + 감사로그 강제

## 7. 산출물

- admin controller/service/repository
- webhook controller/provider adapter
- auth/scope 가드 정책 문서 및 테스트

