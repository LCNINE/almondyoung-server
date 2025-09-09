# DB 뷰 인벤토리 및 리뉴얼 계획

> **명령화 문서 실행**: 뷰→테이블 치환 판단 및 라벨링

## 📋 **현재 상태 분석**

### 1. **물리 테이블 (이미 존재)**

| 테이블명                   | 역할                       | 상태          | 비고                       |
| -------------------------- | -------------------------- | ------------- | -------------------------- |
| `payment_sessions`         | 결제 세션 (Intent 역할)    | ✅ 물리테이블 | v4 아키텍처 컬럼 추가 필요 |
| `payment_events`           | 결제 이벤트 (Attempt 역할) | ✅ 물리테이블 | v4 아키텍처 컬럼 추가 필요 |
| `refund_events`            | 환불 이벤트                | ✅ 물리테이블 | 현재 구조 유지             |
| `settlement_batch`         | BNPL 정산 배치             | ✅ 물리테이블 | Invoice 역할               |
| `settlement_batch_item`    | BNPL 정산 아이템           | ✅ 물리테이블 | Invoice Item 역할          |
| `settlement_process_event` | BNPL 처리 이벤트           | ✅ 물리테이블 | Collection Event 역할      |

### 2. **계획된 뷰 (마이그레이션 파일에 정의)**

| 뷰 이름                   | 기반 테이블                        | 사용처        | 라벨             | 사유                    |
| ------------------------- | ---------------------------------- | ------------- | ---------------- | ----------------------- |
| `v_payment_intent`        | `payment_sessions`                 | 없음 (계획만) | **VIEW-REPLACE** | Intent 테이블로 물리화  |
| `v_payment_attempt`       | `payment_events`                   | 없음 (계획만) | **VIEW-REPLACE** | Attempt 테이블로 물리화 |
| `v_refund_intent`         | `refund_events` + `payment_events` | 없음 (계획만) | **VIEW-REPLACE** | Refund 테이블로 물리화  |
| `v_bnpl_invoice`          | `settlement_batch`                 | 없음 (계획만) | **VIEW-KEEP**    | 조회 전용 의미 매핑     |
| `v_bnpl_invoice_item`     | `settlement_batch_item`            | 없음 (계획만) | **VIEW-KEEP**    | 조회 전용 의미 매핑     |
| `v_bnpl_collection_event` | `settlement_process_event`         | 없음 (계획만) | **VIEW-KEEP**    | 조회 전용 의미 매핑     |

### 3. **v2 아키텍처 신규 테이블 (002-v2-tables.sql)**

| 테이블명            | 역할                       | 상태      | 라벨             |
| ------------------- | -------------------------- | --------- | ---------------- |
| `payment_intents`   | PaymentIntent 물리테이블   | 📋 계획됨 | **TABLE-CREATE** |
| `payment_attempts`  | PaymentAttempt 물리테이블  | 📋 계획됨 | **TABLE-CREATE** |
| `payment_refunds`   | PaymentRefund 물리테이블   | 📋 계획됨 | **TABLE-CREATE** |
| `checkout_sessions` | CheckoutSession 물리테이블 | 📋 계획됨 | **TABLE-CREATE** |

---

## 🎯 **리뉴얼 실행 계획**

### **Phase 1: 물리 테이블 생성 (TABLE-CREATE)**

#### 1.1 **payment_intents 테이블 생성**

```sql
-- VIEW-REPLACE: v_payment_intent → payment_intents 물리테이블
CREATE TABLE payment_intents (
  id VARCHAR(26) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  type VARCHAR(32) NOT NULL DEFAULT 'ORDER',
  allowed_providers TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  authorized_at TIMESTAMP WITH TIME ZONE,
  captured_at TIMESTAMP WITH TIME ZONE,
  refunded_amount DECIMAL(19, 4) NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 1.2 **payment_attempts 테이블 생성**

```sql
-- VIEW-REPLACE: v_payment_attempt → payment_attempts 물리테이블
CREATE TABLE payment_attempts (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  provider VARCHAR(32) NOT NULL,
  instrument_kind VARCHAR(16),
  instrument_ref TEXT,
  profile_id VARCHAR(26),
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(255) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  transaction_id VARCHAR(255),
  approval_number VARCHAR(255),
  error_message TEXT,
  event_context TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 1.3 **payment_refunds 테이블 생성**

```sql
-- VIEW-REPLACE: v_refund_intent → payment_refunds 물리테이블
CREATE TABLE payment_refunds (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  attempt_id VARCHAR(26) NOT NULL REFERENCES payment_attempts(id),
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(255) NOT NULL,
  reason TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by VARCHAR(64),
  refund_account_id VARCHAR(26) REFERENCES user_refund_accounts(id),
  metadata TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 1.4 **checkout_sessions 테이블 생성**

```sql
-- 웹 리다이렉트 UX용 경량 컨테이너
CREATE TABLE checkout_sessions (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  provider VARCHAR(32) NOT NULL,
  redirect_url TEXT NOT NULL,
  cancel_url TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### **Phase 2: 레거시 호환 뷰 생성 (VIEW-KEEP)**

#### 2.1 **기존 테이블명으로 VIEW 제공**

```sql
-- 기존 코드 호환용 VIEW
CREATE OR REPLACE VIEW payment_sessions AS
SELECT
  id, customer_id AS user_id, amount, 'KRW' AS currency,
  status, type, allowed_providers, expires_at,
  authorized_at, captured_at, refunded_amount,
  metadata, created_at, updated_at
FROM payment_intents;

CREATE OR REPLACE VIEW payment_events AS
SELECT
  id, intent_id AS session_id, profile_id AS method_id,
  provider, instrument_kind, instrument_ref, profile_id,
  amount, status, actor, transaction_id, approval_number,
  error_message, event_context, created_at, updated_at
FROM payment_attempts;

CREATE OR REPLACE VIEW refund_events AS
SELECT
  id, attempt_id AS payment_event_id, amount, status, reason,
  completed_at, completed_by, refund_account_id, metadata,
  created_at
FROM payment_refunds;
```

#### 2.2 **BNPL 조회 전용 뷰 유지 (VIEW-KEEP)**

```sql
-- VIEW-KEEP(조회전용): BNPL 의미 매핑용
CREATE OR REPLACE VIEW v_bnpl_invoice AS
SELECT
  id AS invoice_id, bnpl_account_id, total_amount, due_date,
  CASE status
    WHEN 'PENDING' THEN 'OPEN'
    WHEN 'PROCESSING' THEN 'COLLECTING'
    WHEN 'COMPLETED' THEN 'PAID'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE status
  END AS status,
  pg_transaction_id, batch_period_start AS period_start,
  batch_period_end AS period_end, created_at, updated_at
FROM settlement_batch;
```

---

## 🔧 **Enum 축 분리 계획**

### **현재 Enum 상태**

- ✅ **이미 축 분리 완료**: `PaymentProvider`, `InstrumentKind`, `PaymentSessionStatus` 등
- ✅ **값 단순화 완료**: 접두어 없음, 철자 호환 (`CANCELLED` 유지)
- ✅ **중복 제거 완료**: 동의어 통합

### **추가 정리 필요**

```typescript
// 기존 (복잡)
export const PAYMENT_SESSION_STATUS = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED', // 현 DB 철자 유지
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;

// 권장 (단순화)
export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED', // 철자 유지
  REFUNDED: 'REFUNDED', // 부분환불은 금액 필드로 처리
} as const;
```

---

## ✅ **실행 체크리스트**

### **PR1: 뷰 인벤토리 & 설계 (현재 작업)**

- [x] DB 뷰 인벤토리 작성
- [x] 라벨링 완료 (`VIEW-REPLACE`, `VIEW-KEEP`, `TABLE-CREATE`)
- [x] 마이그레이션 설계서 작성

### **PR2: 물리 테이블 생성**

- [ ] `payment_intents`, `payment_attempts`, `payment_refunds` 테이블 생성
- [ ] `checkout_sessions` 테이블 생성
- [ ] 인덱스 및 제약조건 생성
- [ ] 초기 데이터 마이그레이션

### **PR3: 코드 레이어 교체**

- [ ] Repository/Service에서 신규 테이블 사용
- [ ] 레거시 호환 VIEW 생성
- [ ] Drizzle 스키마 업데이트

### **PR4: Enum 단순화**

- [ ] 축 분리된 Enum 파일 정리
- [ ] 매핑 유틸 함수 생성
- [ ] 컨트롤러/서비스 참조 교체

---

## 🚨 **중요 결정사항**

1. **물리테이블 우선**: 모든 핵심 도메인은 물리테이블로 구현
2. **VIEW는 조회전용**: BNPL 의미매핑, 레거시 호환용만 VIEW 유지
3. **점진적 마이그레이션**: 기존 코드 호환성 보장하며 단계적 전환
4. **철자 호환 유지**: `CANCELLED` 등 현재 DB 철자 그대로 유지

---

_본 인벤토리는 명령화 문서의 3) 규칙에 따라 작성되었으며, 각 뷰/테이블별 라벨링이 완료되었습니다._
