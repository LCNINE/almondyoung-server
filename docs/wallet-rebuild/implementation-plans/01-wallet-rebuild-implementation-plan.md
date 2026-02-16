# Wallet Rebuild Implementation Plan (v1)

## 1) 목적

이 문서는 `docs/wallet-rebuild/design`의 `00~10` 설계를 실제 코드로 구현하기 위한 실행 계획이다.  
목표는 `wallet-lagacy`와 무관하게 신규 Wallet 앱을 처음부터 올바르게 구축하고, 이를 결제 SoT 실행 계층으로 운영하는 것이다.

핵심 기준:

- 설계 문서의 불변식/상태머신/계약을 코드에 그대로 반영
- `apps/pim`의 검증된 구조(모듈 분리, `schema.ts + types.ts`, Drizzle 타입 패턴, 공통 라이브러리 활용)를 Wallet에 적용
- 장애/경합/중복요청/정합성 복구 시나리오까지 출시 전에 검증

---

## 2) 구현 원칙 (PIM Best Practice 적용)

### 2.1 앱 골격

- 신규 앱 경로: `apps/wallet`
- 앱 생성: Nest CLI 규칙 준수 (`nest new g app wallet`)
- `main.ts`:
  - `ValidationPipe` 전역 적용
  - `GlobalExceptionFilter` 적용
  - Swagger 문서(`/docs`) 노출
- `wallet.module.ts`:
  - `ConfigModule.forRoot({ isGlobal: true, validate: validateWalletEnv })`
  - `DbModule.forRoot({ schema: walletSchema })`
  - `EventsModule.forRoot(...)`
  - `AuthorizationModule.forRoot(...)`

### 2.2 스키마/타입

- `apps/wallet/src/schema.ts` 단일 스키마 파일에서 모든 테이블 정의
- `apps/wallet/src/types.ts`에서 `InferSelectModel/InferInsertModel` 기반 타입 생성
- `Update` 타입은 `Partial<Omit<NewEntity, ...>>` 패턴 고정
- `walletSchema` / `WalletSchema` / `DbTransaction`(또는 `DbTx`)을 공통 타입으로 사용

### 2.3 레이어링

- Controller: transport 책임 + 에러 응답 변환
- Service: 도메인 로직 + `throw new Error("...")` 중심
- Repository(선택): 복잡 쿼리/락/영속화 추상화
- Provider Adapter: 외부 연동 캡슐화, Wallet 상태 직접 변경 금지

### 2.4 트랜잭션 규칙

- DB 접근 public 메서드 시그니처 마지막에 `tx?: DbTx`
- private 내부 헬퍼는 `tx: DbTx` 필수
- `inTx(fn, tx)` 패턴으로 tx 전파 강제
- 상태 전이 트랜잭션에서 `state update + transition log + outbox` 원자성 보장

---

## 3) 목표 디렉토리 구조

```text
apps/wallet/src
  /auth
    wallet.scopes.ts
  /config
    env.validation.ts
  /common
    dto/
    errors/
    mappers/
  /database
    migrations/
  /domain
    /intents
      intents.module.ts
      controllers/
      services/
      repositories/
      dto/
    /legs
    /attempts
    /refunds
    /reconcile
    /admin
    /providers
      provider.interface.ts
      provider-registry.service.ts
      /points
      /toss (roadmap)
      /bank-transfer (roadmap)
  /messaging
    command-consumers/
    event-publishers/
    outbox/
  /jobs
    expiration.job.ts
    reconcile.job.ts
  main.ts
  wallet.module.ts
  schema.ts
  types.ts
```

---

## 4) 도메인 구현 순서 (권장)

설계 문서 의존성을 반영해 아래 순서로 구현한다.

### Phase 0. 부트스트랩/토대

목표:

- 신규 앱 실행 가능한 최소 골격 구성
- DB/이벤트/인증/권한/로깅/Swagger 연결

작업:

- `apps/wallet` 생성 및 기본 모듈 구성
- `validateWalletEnv` 작성
- `wallet.scopes.ts` 작성 (`wallet.admin.*`, `wallet.service.*`)
- 헬스/레디니스 API (`/v1/health`, `/v1/ready`) 추가

완료 기준:

- 로컬에서 앱 부팅 가능
- DB 연결 및 기본 엔드포인트 정상 응답

---

### Phase 1. 데이터 모델 + 상태 전이 프레임워크

근거 문서: `02`, `05`

목표:

- 핵심 테이블/인덱스/제약 구축
- 상태머신 공용 전이 엔진(가드 + 로깅) 구축

작업:

- `schema.ts`에 아래 테이블 정의:
  - `payment_intents`
  - `payment_legs`
  - `payment_attempts`
  - `refund_requests`
  - `refund_allocations`
  - `manual_cancel_queue_items`
  - `payment_state_transitions`
  - `outbox_events`
  - `provider_webhook_receipts`
- `idempotency_keys`는 기존 공용 테이블 재사용
- Partial unique index(참조 단일화), queue open 상태 unique, webhook unique 반영
- 상태 전이 유틸:
  - 전이 가능성 검사
  - `SELECT ... FOR UPDATE`
  - 전이 로그 append-only 기록

완료 기준:

- 마이그레이션 적용 성공
- 전이 엔진 단위테스트 통과

---

### Phase 2. Intent/Leg 오케스트레이션 (POINTS 우선)

근거 문서: `01`, `02`, `06`, `07`

목표:

- 결제 의도 생성부터 Leg authorize/capture/cancel 핵심 경로 구현
- HMAC 무결성 검증/멱등성/참조 단일화 구현

작업:

- Checkout API:
  - `POST /v1/intents`
  - `GET /v1/intents/{intentId}`
  - `PUT /v1/intents/{intentId}/legs`
  - `POST /v1/intents/{intentId}/legs/{legId}/authorize`
  - `POST /v1/intents/{intentId}/legs/{legId}/capture`
  - `POST /v1/intents/{intentId}/cancel`
  - `POST /v1/intents/{intentId}/supersede`
- HMAC 모듈:
  - canonicalization
  - signedAt window 검증
  - constant-time compare
- Idempotency 인터셉터/서비스:
  - 동일 키+동일 요청 응답 재사용
  - 동일 키+상이 요청 `409`
- Provider contract + `POINTS` provider 구현
- 0원 fast path(`payableAmount==0`) 구현

완료 기준:

- P0 시나리오 `S-INT-*`, `S-LEG-*`, `S-ACT-*` 핵심 통과

---

### Phase 3. 환불/보상/정합성 복구

근거 문서: `02`, `04`, `08`

목표:

- allocation 기반 환불 무결성
- 보상 경로 자동 처리 + 실패 시 수동 큐 이관

작업:

- Refund API:
  - `POST /v1/intents/{intentId}/refund-requests`
  - `GET /v1/refund-requests/{refundId}`
- allocation 검증 로직:
  - 합계 일치
  - 캡처 leg 한정
  - 누적 한도 검증
- 보상 오케스트레이션:
  - cancel 우선 -> refund 후행
  - 자동 1회 시도 후 실패 시 queue 등록
- reconcile batch/job:
  - 대상 상태 조회
  - provider 상태 재조회
  - 보정 가능 시 자동 보정, 불가 시 `RECONCILE_REQUIRED` 유지

완료 기준:

- P0 시나리오 `S-RFD-*`, `S-CMP-*`, `S-DB-*` 통과

---

### Phase 4. 메시지 계약(Commands/Events) + Outbox

근거 문서: `03`

목표:

- `payments.commands.v1`, `payments.events.v1` 기준으로 메시지 입출력 구현
- 상태와 이벤트 발행의 원자성 보장

작업:

- command consumer 구현:
  - `CreatePaymentIntent`, `StartPaymentLeg`, `CancelPaymentIntent`, `RequestRefund`, `RetryReconcile` 등
- 이벤트 발행 구현:
  - `PaymentIntentSucceeded|Failed|Expired|Cancelled|Superseded`
  - `PaymentReconcileRequired`
  - `RefundRequested|Completed|Failed`
- outbox dispatcher 구현 및 재시도 정책 연결
- `packages/event-contracts` 정합성 점검:
  - 기존 wallet stream과 신규 payments v1 계약 간 갭 분석
  - 필요 시 신규 stream/타입 추가 및 소비자 영향도 평가

완료 기준:

- `S-MSG-*` P0 시나리오 통과
- 상태/이벤트 불일치 0건

---

### Phase 5. 관리자 운영 API

근거 문서: `09`

목표:

- 수동 큐/수동확정/환불승인/재처리/감사조회를 관리자 API로 제공

작업:

- `/v1/admin` 하위 API 구현:
  - manual-cancel-queue 조회/할당/처리/완료/실패/종결
  - manual-confirm
  - refund approve/reject
  - reconcile retry
  - ops query + timeline + audit logs
- Role/Scope 가드 적용
- 모든 write API에 감사로그 append-only 기록

완료 기준:

- `S-ADM-*` P0 시나리오 통과
- 권한 없는 write 접근 100% 차단

---

### Phase 6. Webhook/외부 연동 경계

근거 문서: `04`, `06`

목표:

- provider webhook 멱등 처리와 상태 반영
- Medusa 연동 경계 안정화

작업:

- `POST /v1/webhooks/{providerType}` 구현
  - 서명 검증
  - `(providerType, providerEventId)` receipt insert first
  - 중복 수신 no-op 2xx
- Medusa Provider -> Wallet HTTP 호출 경로 검증
- `TOSS`, `BANK_TRANSFER`는 capability 기반 확장 포인트만 우선 제공 (실구현은 roadmap)

완료 기준:

- `S-MSG-008`, `S-MSG-009` 통과

---

### Phase 7. Go-live and Legacy Freeze

목표:

- 신규 wallet 프로덕션 go-live
- `wallet-lagacy` 동결/보관(재활용/참고/마이그레이션 대상 아님)

작업:

- Go-live 전략:
  1) 신규 앱 배포 및 사전 점검(스모크/헬스/필수 API)
  2) 프로덕션 트래픽을 신규 wallet로 직접 라우팅
  3) 운영 지표 안정화 확인 후 정식 운영 전환 완료
- legacy 처리 원칙:
  - `wallet-lagacy`는 코드/기능/데이터 관점에서 마이그레이션 원천으로 사용하지 않는다.
  - 운영 참조가 필요한 최소 범위만 read-only 보관하고 신규 개발에서 제외한다.
- 롤백 플랜:
  - 신규 wallet 비활성화 및 임시 fallback 경로 문서화
  - 장애 원인 분석 후 재배포 기준 수립

완료 기준:

- 신규 wallet가 프로덕션 결제 트래픽을 안정 처리
- `wallet-lagacy`는 동결 상태로 유지되고 신규 기능 개발 대상에서 제외

---

## 5) 테스트 전략과 게이트

근거 문서: `10`

- 테스트 계층:
  - Unit: 상태 전이, capability, allocation, HMAC
  - Integration: 트랜잭션/락/outbox/idempotency/webhook receipt
  - E2E: Medusa 주문결제/환불/대체/관리자 처리
  - Recovery: timeout/unknown/reconcile/manual queue
- 출시 게이트:
  - P0 100% 통과
  - 금액/상태/이벤트 불일치 0건
  - 수동 큐 추적 누락 0건

---

## 6) 운영 관측/보안 체크리스트

- 메트릭:
  - `hmac_verify_failed_total{reason}`
  - `compensation_success_rate`
  - `manual_queue_open_count`
  - `reconcile_required_count`
- 로그:
  - `correlationId`, `intentId`, `legId`, `attemptId` 공통 포함
- 보안:
  - HMAC secret 환경별 분리
  - 관리자 write API rate limit
  - 민감정보 마스킹

---

## 7) 작업 분해(WBS) 제안

스프린트 단위 권장:

- Sprint 1: Phase 0~1
- Sprint 2: Phase 2
- Sprint 3: Phase 3~4
- Sprint 4: Phase 5~6
- Sprint 5: Phase 7 + hardening

각 스프린트 종료 시:

- API/Command/Event 계약 diff 점검
- P0 회귀셋 실행
- 운영 대시보드/알람 임계치 점검

---

## 8) 즉시 착수 TODO (Implementation Backlog Seed)

1. `apps/wallet` 신규 앱 생성 및 모듈 골격 확정  
2. `schema.ts`/`types.ts` 초안 작성 (05 문서 기준)  
3. `PaymentIntentStatus`, `PaymentLegStatus` 등 enum 고정  
4. HMAC canonicalizer + verifier 유닛테스트 작성  
5. idempotency interceptor + 저장소 연동  
6. POINTS provider capability 구현  
7. `POST /v1/intents` 엔드포인트 E2E green  
8. outbox dispatcher + `PaymentIntentSucceeded` 발행 검증

