# Wallet 결제서버 재구축 설계서 — 최종안 v4 (Intent/Attempt 코어)

> **작성일**: 2025-01-08
> **요지**: 코어는 **PaymentIntent / PaymentAttempt / PaymentRefund** 만 영속.
> **웹일 때만** 얇은 **Checkout Session**(리다이렉트/승인키 운반용) 사용.
> BNPL 정산 **Settlement → Invoice/Collection** 의미로 정렬(리네임 or VIEW).

---

## 0) 목표 & 범위

- **목표**

  - 코드·데이터 **단순화** (AI/신규투입자 친화)
  - **정책 변경**과 **프로바이더 추가**에 유연
  - 동일한 코어로 **웹/백오피스/B2B** 흐름 일관 처리

- **범위**
  - 도메인/스키마 의미 정렬, API/DTO, 정책/검증, 관측/멱등, 마이그레이션, 테스트/스웨거

---

## 1) 핵심 개념

- **PaymentIntent(의도)**: 결제의 상위 컨테이너(금액/통화/고객/만료/허용 Provider/타입)
- **PaymentAttempt(시도)**: 특정 Provider·수단으로의 **1회 실행**(성공/실패/메타)
- **PaymentRefund(환불)**: 환불 원장(가능하면 attemptId도 가진다)
- **Checkout Session(선택)**: **웹 리다이렉트 UX**가 있을 때만 쓰는 경량 컨테이너(엣지 캐시/경량 테이블)
- **Provider**: TOSS/CMS/KAKAOPAY/BNPL/POINTS …
- **Profile(등록형)**: 우리 DB에 저장된 수단(예: CMS 계좌, 저장카드)
- **Instrument(ephemeral)**: 세션 중 일시 승인키/토큰(카카오페이 승인키 등, DB 미저장)
- **Type**: 결제 맥락(예: `ORDER`,`BNPL_CAPTURE`,`MEMBERSHIP_FEE`)
- **하드가드**: `type='BNPL_CAPTURE'` 이면 **provider는 반드시 `CMS`**

---

## 2) 현재 스키마와 의미 매핑 (스키마 변경 최소화 권장)

> **스키마명 유지 + 의미 정렬 + VIEW 제공**(옵션 A), 필요 시 이후 리네임(옵션 B)

| 의미 모델             | 기존 테이블                | 권장 해석                                        |
| --------------------- | -------------------------- | ------------------------------------------------ |
| PaymentIntent         | `payment_sessions`         | 의도(금액/통화/상태/만료/메타)                   |
| PaymentAttempt        | `payment_events`           | 시도(세션ID=의도ID, provider/수단/상태/요약응답) |
| PaymentRefund         | `refund_events`            | 환불(의도ID는 attempt join으로 노출)             |
| BNPL Usage            | `bnpl_events`              | 사용 원장                                        |
| BNPL Invoice          | `settlement_batch`         | **청구서**                                       |
| BNPL Invoice Item     | `settlement_batch_item`    | 청구서 라인아이템                                |
| BNPL Collection Event | `settlement_process_event` | 징수(출금) 이벤트                                |

### 2.1 컬럼 보강(옵션 A: 스키마명 유지)

```sql
-- Intent 의미 보강
ALTER TABLE payment_sessions
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) DEFAULT 'ORDER',
  ADD COLUMN IF NOT EXISTS allowed_providers TEXT; -- JSON 문자열 ['TOSS','KAKAOPAY','CMS','BNPL','POINTS']

-- Attempt 의미 보강
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32),          -- 'TOSS'|'KAKAOPAY'|'CMS'|'BNPL'|'POINTS'
  ADD COLUMN IF NOT EXISTS instrument_kind VARCHAR(16),   -- 'stored'|'ephemeral'
  ADD COLUMN IF NOT EXISTS instrument_ref TEXT,           -- ephemeral 승인키 등
  ADD COLUMN IF NOT EXISTS profile_id VARCHAR(26);        -- 저장형 수단 연결(있을 때만)
```

### 2.2 혼동 제거용 VIEW (강력 권장)

```sql
CREATE OR REPLACE VIEW v_payment_intent AS
SELECT id AS intent_id, user_id AS customer_id, amount, currency, status, type,
       expires_at, created_at, updated_at, metadata, allowed_providers
FROM payment_sessions;

CREATE OR REPLACE VIEW v_payment_attempt AS
SELECT id AS attempt_id, session_id AS intent_id, method_id AS legacy_method_id,
       provider, instrument_kind, instrument_ref, profile_id,
       amount, status, actor, created_at, updated_at, error_message, event_context
FROM payment_events;

CREATE OR REPLACE VIEW v_refund_intent AS
SELECT r.id AS refund_id, e.session_id AS intent_id, r.payment_event_id AS attempt_id,
       r.amount, r.status, r.reason, r.created_at, r.metadata
FROM refund_events r
JOIN payment_events e ON e.id = r.payment_event_id;
```

### 2.3 BNPL 네이밍 정렬(뷰 추천)

```sql
CREATE OR REPLACE VIEW v_bnpl_invoice AS
SELECT id AS invoice_id, bnpl_account_id, total_amount,
       due_date,
       CASE status
         WHEN 'PENDING'    THEN 'OPEN'
         WHEN 'PROCESSING' THEN 'COLLECTING'
         WHEN 'COMPLETED'  THEN 'PAID'
         ELSE status
       END AS status,
       pg_transaction_id,
       batch_period_start AS period_start,
       batch_period_end   AS period_end,
       created_at, updated_at
FROM settlement_batch;

CREATE OR REPLACE VIEW v_bnpl_invoice_item AS
SELECT id AS item_id, batch_id AS invoice_id, bnpl_event_id AS usage_id,
       amount, transaction_date, created_at
FROM settlement_batch_item;

CREATE OR REPLACE VIEW v_bnpl_collection_event AS
SELECT id AS event_id, batch_id AS invoice_id, batch_item_id AS invoice_item_id,
       CASE event_type
         WHEN 'BATCH_STARTED'   THEN 'COLLECTION_STARTED'
         WHEN 'BATCH_COMPLETED' THEN 'COLLECTION_COMPLETED'
         WHEN 'BATCH_FAILED'    THEN 'COLLECTION_FAILED'
         ELSE event_type
       END AS event_type,
       status, payment_event_id, error_message, metadata, actor, created_at
FROM settlement_process_event;
```

> **옵션 B(리네임)**: 테이블명을 `payment_intents/payment_attempts/payment_refunds`,
> `bnpl_invoices/bnpl_invoice_items/bnpl_collection_events`로 바꾸고,
> **레거시 호환 VIEW**를 기존 이름으로 제공.

---

## 3) API 설계 (v2 권장 경로)

```
POST /v2/payments/intents
POST /v2/payments/intents/{intentId}/attempts
POST /v2/payments/intents/{intentId}/attempts/finalize
POST /v2/refunds
POST /v2/checkout/sessions          -- (웹일 때만)
```

### 3.1 DTO (간결·엄격)

```ts
// IntentCreateDto
{
  userId: string;
  amount: number;               // 최종 과금액
  currency: 'KRW';
  type: 'ORDER'|'BNPL_CAPTURE'|'MEMBERSHIP_FEE';
  allowedProviders?: ('TOSS'|'KAKAOPAY'|'CMS'|'BNPL'|'POINTS')[];
  metadata?: Record<string, any>;
  expiresAt?: string;           // ISO
}

// AttemptCreateDto
{
  provider: 'TOSS'|'KAKAOPAY'|'CMS'|'BNPL'|'POINTS';
  profileId?: string;           // 저장형(있을 때만)
  instrumentRef?: string;       // ephemeral(있을 때만)
  idempotencyKey?: string;
  source?: 'api'|'scheduler'|'admin';
  actor?: 'USER'|'SYSTEM'|'SCHEDULER'|'ADMIN';
}

// AttemptFinalizeDto (웹 복귀 확정)
{
  approvalKey?: string;         // 예: 카카오페이
  pgToken?: string;
  idempotencyKey?: string;
}

// RefundCreateDto
{
  intentId: string;
  attemptId?: string;           // 지정 시 정확한 환불 매핑
  amount?: number;              // 없으면 전액
  reason?: string;
  metadata?: Record<string, any>;
}
```

**검증 규칙(서비스 초입 하드가드)**

- 정책에서 `requiresStoredProfile=true`면 `profileId` 필수
- `allowsEphemeral=false`면 `instrumentRef` 금지
- `type==='BNPL_CAPTURE'` 면 **provider는 `CMS`** 만 허용

> **모든 POST는 `@HttpCode(200)`** 로 통일해 E2E 상태코드 불일치 제거.

---

## 4) 정책(ENV/JSON 단일 설정) — MVP

```json
{
  "payments": {
    "typePolicy": {
      "ORDER": {
        "allowed": ["TOSS", "KAKAOPAY", "BNPL", "POINTS"],
        "requiresStoredProfile": false,
        "allowsEphemeral": true
      },
      "BNPL_CAPTURE": {
        "allowed": ["CMS"],
        "requiresStoredProfile": true,
        "allowsEphemeral": false
      },
      "MEMBERSHIP_FEE": {
        "allowed": ["TOSS", "BNPL"],
        "requiresStoredProfile": true,
        "allowsEphemeral": false
      }
    }
  }
}
```

---

## 5) 상태(간결 세트)

- **Intent(status)**: `PENDING | AUTHORIZED | CAPTURED | FAILED | CANCELLED | PARTIALLY_REFUNDED | REFUNDED`
- **Attempt(status)**: `AUTHORIZED | CAPTURED | FAILED | CANCELLED`
- **Refund(status)**: `REQUESTED | APPROVED | COMPLETED | CANCELLED | FAILED`
- **BNPL Invoice(status)**: `OPEN | COLLECTING | PAID | FAILED | CANCELLED`

---

## 6) 코어 저장 규칙

- **Attempt.eventContext(JSON)**: **요약만** 저장

  - `pg: { gateway, approvalNumber?, paymentDate? }`
  - `business: { type, source }`
  - _(raw 응답/원본 요청 저장 금지. 필요 시 별도 로그/객체 스토리지)_

- **Profile vs Instrument**
  - 저장형이면 `profileId` 세팅 + `instrumentKind='stored'`
  - ephemeral이면 `instrumentRef` 세팅 + `instrumentKind='ephemeral'`

---

## 7) 주요 플로우

### 7.1 웹 체크아웃(예: KAKAOPAY)

```
createIntent ──► (웹이면) createCheckoutSession ──► 리다이렉트/승인
   │                                                  │
   └───────────── finalizeAttempt ◄────────────────────┘
                    ▲  (provider=KAKAOPAY, instrumentRef=approvalKey)
                    └─ Attempt 저장 + Intent 상태 확정
```

### 7.2 포인트/BNPL(웹 세션 無)

```
createIntent ──► createAttempt(provider=POINTS/BNPL) ──► 즉시 확정
```

### 7.3 BNPL 월말 캡처(하드가드 CMS)

```
(인보이스 생성) ──► createIntent(type=BNPL_CAPTURE, allowed=[CMS])
                └─► createAttempt(provider=CMS) ──► 징수 결과 이벤트 기록
```

> **스케줄러 위치 유지**: 기존 위치 그대로(리팩터링 대상 아님). 스케줄러는 Intent/Attempt API를 호출.

---

## 8) 컨트롤러 스케치 (Swagger 지침)

- 모든 POST에 `@HttpCode(200)`
- Swagger 예시 포함, Idempotency-Key 헤더 선언
- DTO는 **class-validator + @ApiProperty** 로 엄격 표기
- 에러 매핑: 서비스는 `throw new Error('policy.xxx')`, 컨트롤러에서 400/404/409/500으로 변환

---

## 9) 테스트(필수 시나리오)

- **E2E: 결제 성공/실패**
- **E2E: 웹 체크아웃 finalize**
- **E2E: 환불 전액/부분, 초과 환불 400**
- **E2E: 정책 위반(프로바이더 불허/프로필 필수 위반) 400**
- **E2E: 멱등키 중복 요청 동일 응답**
- **E2E: BNPL_CAPTURE ≠ CMS 요청 400 하드가드**
- **세션 기반에서 Intent로 의미 전환된 응답(`intentId`) 일관 확인**

> 모든 테스트는 **200** 상태 기대. 컨트롤러에서 `@HttpCode(200)` 설정 필수.

---

## 10) 운영/관측/보안

- **멱등성**: Intent/Attempt 레벨 모두 허용(요청 본문 해시)
- **로깅**: JSON 구조화(시간/intentId/attemptId/provider/type/correlationId)
- **보안**: 카드/PAN/계좌 **원문 미보관**, 토큰/식별자만 저장
- **관측**: intent 타임라인에 Attempt/Refund/BNPL 이벤트 집계

---

## 11) Stripe ↔ 현재 스키마 매핑(요약)

| Stripe           | 우리 의미   | 현재 스키마                                           |
| ---------------- | ----------- | ----------------------------------------------------- |
| PaymentIntent    | 의도        | `payment_sessions`                                    |
| PaymentMethod    | 등록형 수단 | `payment_method` (+ `card_method`/`batch_cms_method`) |
| Ephemeral source | 일시 수단   | `payment_events.eventContext.pg.*`                    |
| PaymentAttempt   | 시도        | `payment_events`                                      |
| Refund           | 환불        | `refund_events` (뷰로 intentId 노출)                  |
| Balance/Credit   | Ledger      | `points`/`point_events`, `bnpl_*`                     |

---

## 12) 마이그레이션 순서 (다운타임 無)

1. 컬럼 추가 (2.1) → 2) 앱 코드에서 새 필드 기록 시작 →
2. VIEW 생성(2.2/2.3) → 4) 대시보드/리포트 전환 →
3. (선택) 테이블 리네임 + 레거시 호환 VIEW 제공

---

## 13) 샘플 코드 스니펫

### 13.1 정책 하드가드

```ts
function assertPolicy(
  intentType: string,
  provider: string,
  hasProfile: boolean,
  hasInstrument: boolean,
) {
  const p = policy.typePolicy[intentType];
  if (!p) throw new Error(`policy.type.unknown:${intentType}`);
  if (!p.allowed.includes(provider))
    throw new Error(`policy.not.allowed:${intentType}->${provider}`);
  if (p.requiresStoredProfile && !hasProfile)
    throw new Error('policy.profile.required');
  if (!p.allowsEphemeral && hasInstrument)
    throw new Error('policy.ephemeral.not.allowed');
  if (intentType === 'BNPL_CAPTURE' && provider !== 'CMS')
    throw new Error('policy.bnpl.capture.cms.only');
}
```

### 13.2 Attempt 저장(요약만)

```ts
await tx.insert(schema.paymentEvents).values({
  sessionId: intent.id, // = intentId
  methodId: dto.profileId ?? null, // 저장형일 때만
  provider: dto.provider,
  instrumentKind: dto.profileId ? 'stored' : 'ephemeral',
  instrumentRef: dto.instrumentRef ?? null,
  amount: intent.amount,
  status: finalize.ok ? 'CAPTURED' : 'FAILED',
  actor: dto.actor ?? 'USER',
  eventContext: JSON.stringify({
    pg: {
      gateway: dto.provider.toLowerCase(),
      approvalNumber: finalize.approvalNumber,
      paymentDate: finalize.paymentDate,
    },
    business: { type: intent.type, source: dto.source ?? 'api' },
  }),
});
```

---

## 14) 에러 매핑(예시)

| 코드                           | 의미                 | HTTP |
| ------------------------------ | -------------------- | ---- |
| `policy.not.allowed`           | 타입-프로바이더 불가 | 400  |
| `policy.profile.required`      | 저장형 프로필 필수   | 400  |
| `policy.ephemeral.not.allowed` | ephemeral 금지       | 400  |
| `policy.bnpl.capture.cms.only` | BNPL_CAPTURE는 CMS만 | 400  |
| `not.found`                    | 리소스 없음          | 404  |
| `already.processed`            | 중복 처리            | 409  |
| 기타                           | 내부 오류            | 500  |

---

## 15) 스케줄러

- **현재 위치 유지**(분리 보류).
- 스케줄러는 Intent 생성 → Attempt 실행(또는 CMS BNPL 캡처) 호출만 담당.

---

## 16) Cursor/AI를 위한 엄격 수칙

- **원장 저장은 항상**: Intent → Attempt → Refund **삼단계**
- **웹**일 때만 Checkout Session 생성. **Intent가 상태 소유**
- **Attempt.eventContext**에는 **요약만**. raw 요청/응답 **금지**
- **하드가드**: `BNPL_CAPTURE → CMS`
- 모든 POST **`@HttpCode(200)`**, Swagger **예시 필수**, DTO **필수 필드 누락 금지**
- **쓰지 않는 코드/파일은 삭제**(레거시/죽은 테스트 금지)

---

## 17) 테스트 To-Do (통합)

- `tests/e2e/payment.e2e.spec.ts`

  - 일반 결제(포인트/BNPL/TOSS) 성공/실패
  - 웹 체크아웃 finalize(KAKAOPAY) 성공
  - 정책 위반/하드가드 400
  - 환불 전액/부분/초과 400
  - 멱등키 동일 응답

- `tests/e2e/refund.e2e.spec.ts`

  - 환불 이후 Intent 상태 `PARTIALLY_REFUNDED/REFUNDED` 확인

- DB 조회 단언: `v_payment_intent`, `v_payment_attempt`, `v_refund_intent` 사용

---

## 18) 파일 배치 규칙

- **모든 문서**: `wallet/docs/**`
- 정책 템플릿: `wallet/docs/policy.sample.json`
- 마이그레이션 SQL: `wallet/docs/migrations/*.sql`
- 스웨거 캡처: `wallet/docs/swagger/*.md` (요청/응답 예시 포함)

---

## 19) 구현된 파일들

### 스키마 변경

- ✅ `src/shared/database/schema.ts` - Intent/Attempt 컬럼 추가 및 타입 정의
- ✅ `docs/migrations/001-intent-attempt-views.sql` - VIEW 생성 마이그레이션

### 정책 시스템

- ✅ `src/shared/policies/payment-policy.ts` - 정책 검증 로직
- ✅ `docs/policy.sample.json` - 정책 설정 템플릿

### 문서화

- ✅ `docs/wallet-v4-payment-architecture.md` - 본 설계서

---

### 끝.

이 문서대로 적용하면 기존 스키마를 유지하면서도 **Intent/Attempt 중심**의 단순한 코어로 전환할 수 있습니다.

다음 단계는:

1. **마이그레이션 실행**: `001-intent-attempt-views.sql` 적용
2. **v2 API 구현**: Intent/Attempt 기반 컨트롤러 개발
3. **정책 시스템 적용**: `PaymentPolicyValidator` 활용
4. **E2E 테스트 작성**: 핵심 시나리오 검증

원하면 **v2 API 컨트롤러 구현**이나 **E2E 테스트 골격**을 즉시 작성해서 제공할 수 있습니다.
