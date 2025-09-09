-- ================================================================
-- Wallet 리뉴얼 마이그레이션: 뷰 → 물리 테이블 치환
-- 생성일: 2025-09-09
-- 목표: VIEW-REPLACE 대상을 물리 테이블로 변환
-- 참고: db-view-inventory.md, enum-audit-report.md
-- ================================================================

-- ================================================================
-- Phase 1: 물리 테이블 생성 (TABLE-CREATE)
-- ================================================================

-- 1.1 PaymentIntent 테이블 생성
-- VIEW-REPLACE: v_payment_intent → payment_intents 물리테이블
CREATE TABLE payment_intents (
  id VARCHAR(26) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  type VARCHAR(32) NOT NULL DEFAULT 'ORDER',
  allowed_providers TEXT, -- JSON array ['TOSS','KAKAOPAY','CMS','BNPL','POINTS']
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  authorized_at TIMESTAMP WITH TIME ZONE,
  captured_at TIMESTAMP WITH TIME ZONE,
  refunded_amount DECIMAL(19, 4) NOT NULL DEFAULT 0,
  metadata TEXT, -- JSON
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스 생성 (성능 최적화)
CREATE INDEX idx_payment_intents_customer_id ON payment_intents(customer_id);
CREATE INDEX idx_payment_intents_status ON payment_intents(status);
CREATE INDEX idx_payment_intents_type ON payment_intents(type);
CREATE INDEX idx_payment_intents_created_at ON payment_intents(created_at);
CREATE INDEX idx_payment_intents_expires_at ON payment_intents(expires_at);
CREATE INDEX idx_payment_intents_customer_status ON payment_intents(customer_id, status);
CREATE INDEX idx_payment_intents_type_status ON payment_intents(type, status);

-- 1.2 PaymentAttempt 테이블 생성
-- VIEW-REPLACE: v_payment_attempt → payment_attempts 물리테이블
CREATE TABLE payment_attempts (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  instrument_kind VARCHAR(16), -- 'STORED' | 'EPHEMERAL'
  instrument_ref TEXT,         -- ephemeral 승인키 등
  profile_id VARCHAR(26),      -- 저장형 수단 참조 (nullable)
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(255) NOT NULL,
  actor VARCHAR(255) NOT NULL, -- 'USER' | 'SCHEDULER' | 'ADMIN' | 'SYSTEM'
  transaction_id VARCHAR(255), -- PG사 트랜잭션 ID
  approval_number VARCHAR(255), -- 승인번호
  error_message TEXT,
  event_context TEXT NOT NULL, -- JSON - PG 응답, 비즈니스 맥락 등
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_payment_attempts_intent_id ON payment_attempts(intent_id);
CREATE INDEX idx_payment_attempts_provider ON payment_attempts(provider);
CREATE INDEX idx_payment_attempts_status ON payment_attempts(status);
CREATE INDEX idx_payment_attempts_created_at ON payment_attempts(created_at);
CREATE INDEX idx_payment_attempts_profile_id ON payment_attempts(profile_id);
CREATE INDEX idx_payment_attempts_provider_status ON payment_attempts(provider, status);
CREATE INDEX idx_payment_attempts_intent_provider ON payment_attempts(intent_id, provider);

-- 1.3 PaymentRefund 테이블 생성
-- VIEW-REPLACE: v_refund_intent → payment_refunds 물리테이블
CREATE TABLE payment_refunds (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  attempt_id VARCHAR(26) NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(255) NOT NULL, -- 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  reason TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by VARCHAR(64),
  refund_account_id VARCHAR(26) REFERENCES user_refund_accounts(id),
  metadata TEXT, -- JSON
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_payment_refunds_intent_id ON payment_refunds(intent_id);
CREATE INDEX idx_payment_refunds_attempt_id ON payment_refunds(attempt_id);
CREATE INDEX idx_payment_refunds_status ON payment_refunds(status);
CREATE INDEX idx_payment_refunds_created_at ON payment_refunds(created_at);

-- 1.4 CheckoutSession 테이블 생성
-- 웹 리다이렉트 UX용 경량 컨테이너
CREATE TABLE checkout_sessions (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  redirect_url TEXT NOT NULL,
  cancel_url TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata TEXT, -- JSON - PG사별 세션 정보
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_checkout_sessions_intent_id ON checkout_sessions(intent_id);
CREATE INDEX idx_checkout_sessions_status ON checkout_sessions(status);
CREATE INDEX idx_checkout_sessions_created_at ON checkout_sessions(created_at);
CREATE INDEX idx_checkout_sessions_expires_at ON checkout_sessions(expires_at);

-- ================================================================
-- Phase 2: 초기 데이터 적재 (기존 데이터가 있다면)
-- ================================================================

-- 2.1 payment_sessions → payment_intents 데이터 마이그레이션
INSERT INTO payment_intents (
  id, customer_id, amount, status, type, allowed_providers,
  expires_at, authorized_at, captured_at, refunded_amount,
  metadata, created_at, updated_at
)
SELECT 
  id,
  user_id AS customer_id,
  amount,
  status,
  COALESCE(type, 'ORDER') AS type,
  allowed_providers,
  expires_at,
  authorized_at,
  captured_at,
  COALESCE(refunded_amount, 0) AS refunded_amount,
  metadata,
  created_at,
  updated_at
FROM payment_sessions
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_sessions');

-- 2.2 payment_events → payment_attempts 데이터 마이그레이션
INSERT INTO payment_attempts (
  id, intent_id, provider, instrument_kind, instrument_ref,
  profile_id, amount, status, actor, transaction_id,
  approval_number, error_message, event_context,
  created_at, updated_at
)
SELECT 
  pe.id,
  pe.session_id AS intent_id,
  COALESCE(pe.provider, 'UNKNOWN') AS provider,
  pe.instrument_kind,
  pe.instrument_ref,
  pe.profile_id,
  pe.amount,
  pe.status,
  pe.actor,
  -- event_context에서 transaction_id 추출 (JSON 파싱)
  CASE 
    WHEN pe.event_context::jsonb ? 'pg' 
    THEN (pe.event_context::jsonb->'pg'->>'transactionId')
    ELSE NULL 
  END AS transaction_id,
  -- event_context에서 approval_number 추출
  CASE 
    WHEN pe.event_context::jsonb ? 'pg' 
    THEN (pe.event_context::jsonb->'pg'->>'approvalNumber')
    ELSE NULL 
  END AS approval_number,
  pe.error_message,
  pe.event_context,
  pe.created_at,
  pe.updated_at
FROM payment_events pe
INNER JOIN payment_intents pi ON pe.session_id = pi.id
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_events');

-- 2.3 refund_events → payment_refunds 데이터 마이그레이션
INSERT INTO payment_refunds (
  id, intent_id, attempt_id, amount, status, reason,
  completed_at, completed_by, refund_account_id, metadata,
  created_at
)
SELECT 
  re.id,
  pa.intent_id,
  re.payment_event_id AS attempt_id,
  re.amount,
  re.status,
  re.reason,
  re.completed_at,
  re.completed_by,
  re.refund_account_id,
  re.metadata,
  re.created_at
FROM refund_events re
INNER JOIN payment_attempts pa ON re.payment_event_id = pa.id
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'refund_events');

-- ================================================================
-- Phase 3: 레거시 호환 뷰 생성 (VIEW-KEEP)
-- ================================================================

-- 3.1 기존 테이블명으로 VIEW 제공 (기존 코드 호환용)
CREATE OR REPLACE VIEW payment_sessions AS
SELECT 
  id,
  customer_id AS user_id,
  amount,
  'KRW' AS currency, -- 한국 전용 고정값
  status,
  type,
  allowed_providers,
  expires_at,
  authorized_at,
  captured_at,
  refunded_amount,
  metadata,
  created_at,
  updated_at
FROM payment_intents;

CREATE OR REPLACE VIEW payment_events AS
SELECT 
  id,
  intent_id AS session_id,
  profile_id AS method_id, -- 레거시 호환
  provider,
  instrument_kind,
  instrument_ref,
  profile_id,
  amount,
  status,
  actor,
  transaction_id,
  approval_number,
  error_message,
  event_context,
  created_at,
  updated_at
FROM payment_attempts;

CREATE OR REPLACE VIEW refund_events AS
SELECT 
  id,
  attempt_id AS payment_event_id, -- 레거시 호환
  amount,
  status,
  reason,
  completed_at,
  completed_by,
  refund_account_id,
  metadata,
  created_at
FROM payment_refunds;

-- 3.2 BNPL 조회 전용 뷰 유지 (VIEW-KEEP)
CREATE OR REPLACE VIEW v_bnpl_invoice AS
SELECT 
  id AS invoice_id,
  bnpl_account_id,
  total_amount,
  due_date,
  CASE status
    WHEN 'PENDING' THEN 'OPEN'
    WHEN 'PROCESSING' THEN 'COLLECTING'  
    WHEN 'COMPLETED' THEN 'PAID'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE status
  END AS status,
  pg_transaction_id,
  batch_period_start AS period_start,
  batch_period_end AS period_end,
  created_at,
  updated_at
FROM settlement_batch;

CREATE OR REPLACE VIEW v_bnpl_invoice_item AS
SELECT 
  id AS item_id,
  batch_id AS invoice_id,
  bnpl_event_id AS usage_id,
  amount,
  transaction_date,
  created_at
FROM settlement_batch_item;

CREATE OR REPLACE VIEW v_bnpl_collection_event AS
SELECT 
  id AS event_id,
  batch_id AS invoice_id,
  batch_item_id AS invoice_item_id,
  CASE event_type
    WHEN 'BATCH_STARTED' THEN 'COLLECTION_STARTED'
    WHEN 'BATCH_COMPLETED' THEN 'COLLECTION_COMPLETED'
    WHEN 'BATCH_FAILED' THEN 'COLLECTION_FAILED'
    ELSE event_type
  END AS event_type,
  status,
  payment_event_id,
  error_message,
  metadata,
  actor,
  created_at
FROM settlement_process_event;

-- ================================================================
-- Phase 4: 트리거 함수 (updated_at 자동 업데이트)
-- ================================================================

-- updated_at 자동 업데이트 함수 생성 (없는 경우에만)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 트리거 적용
CREATE TRIGGER update_payment_intents_updated_at 
  BEFORE UPDATE ON payment_intents 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_attempts_updated_at 
  BEFORE UPDATE ON payment_attempts 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- Phase 5: 제약 조건 및 검증
-- ================================================================

-- 5.1 상태 값 검증 제약 조건
ALTER TABLE payment_intents 
ADD CONSTRAINT chk_payment_intents_status 
CHECK (status IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED'));

ALTER TABLE payment_intents 
ADD CONSTRAINT chk_payment_intents_type 
CHECK (type IN ('ORDER', 'BNPL_CAPTURE', 'MEMBERSHIP_FEE'));

ALTER TABLE payment_attempts 
ADD CONSTRAINT chk_payment_attempts_status 
CHECK (status IN ('AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'));

ALTER TABLE payment_attempts 
ADD CONSTRAINT chk_payment_attempts_provider 
CHECK (provider IN ('TOSS', 'KAKAOPAY', 'CMS', 'BNPL', 'POINTS'));

ALTER TABLE payment_attempts 
ADD CONSTRAINT chk_payment_attempts_instrument_kind 
CHECK (instrument_kind IN ('STORED', 'EPHEMERAL'));

ALTER TABLE payment_attempts 
ADD CONSTRAINT chk_payment_attempts_actor 
CHECK (actor IN ('USER', 'SCHEDULER', 'ADMIN', 'SYSTEM'));

ALTER TABLE payment_refunds 
ADD CONSTRAINT chk_payment_refunds_status 
CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'));

ALTER TABLE checkout_sessions 
ADD CONSTRAINT chk_checkout_sessions_status 
CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

-- 5.2 비즈니스 규칙 제약 조건
-- BNPL_CAPTURE는 CMS Provider만 허용
ALTER TABLE payment_intents 
ADD CONSTRAINT chk_bnpl_capture_cms_only 
CHECK (
  (type = 'BNPL_CAPTURE' AND allowed_providers = '["CMS"]') OR 
  (type != 'BNPL_CAPTURE')
);

-- refunded_amount는 amount를 초과할 수 없음
ALTER TABLE payment_intents 
ADD CONSTRAINT chk_refunded_amount_limit 
CHECK (refunded_amount <= amount);

-- ================================================================
-- Phase 6: 코멘트 및 문서화
-- ================================================================

-- 테이블 코멘트
COMMENT ON TABLE payment_intents IS 'v4 결제 의도 테이블 - 한국 전용 (currency 제거), VIEW-REPLACE 완료';
COMMENT ON TABLE payment_attempts IS 'v4 결제 시도 테이블 - Provider별 실행 기록, VIEW-REPLACE 완료';
COMMENT ON TABLE payment_refunds IS 'v4 환불 테이블 - Intent/Attempt 직접 참조, VIEW-REPLACE 완료';
COMMENT ON TABLE checkout_sessions IS 'v4 체크아웃 세션 테이블 - 웹 리다이렉트 UX용';

-- 뷰 코멘트
COMMENT ON VIEW payment_sessions IS '레거시 호환 VIEW - payment_intents 매핑 (VIEW-KEEP)';
COMMENT ON VIEW payment_events IS '레거시 호환 VIEW - payment_attempts 매핑 (VIEW-KEEP)';
COMMENT ON VIEW refund_events IS '레거시 호환 VIEW - payment_refunds 매핑 (VIEW-KEEP)';
COMMENT ON VIEW v_bnpl_invoice IS 'BNPL Invoice 조회 전용 VIEW - settlement_batch 의미 매핑 (VIEW-KEEP)';

-- ================================================================
-- Phase 7: 권한 설정 (필요한 경우)
-- ================================================================

-- 애플리케이션 사용자에게 테이블 권한 부여
-- GRANT SELECT, INSERT, UPDATE, DELETE ON payment_intents TO wallet_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON payment_attempts TO wallet_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON payment_refunds TO wallet_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON checkout_sessions TO wallet_app_user;

-- 읽기 전용 사용자에게 VIEW 권한 부여
-- GRANT SELECT ON payment_sessions TO readonly_user;
-- GRANT SELECT ON payment_events TO readonly_user;
-- GRANT SELECT ON refund_events TO readonly_user;
-- GRANT SELECT ON v_bnpl_invoice TO readonly_user;

-- ================================================================
-- Phase 8: 확인 쿼리 (마이그레이션 후 테스트용)
-- ================================================================

-- 8.1 데이터 마이그레이션 확인
-- SELECT COUNT(*) as intent_count FROM payment_intents;
-- SELECT COUNT(*) as attempt_count FROM payment_attempts;
-- SELECT COUNT(*) as refund_count FROM payment_refunds;

-- 8.2 뷰 동작 확인
-- SELECT * FROM payment_sessions LIMIT 5;
-- SELECT * FROM payment_events LIMIT 5;
-- SELECT * FROM refund_events LIMIT 5;

-- 8.3 외래키 무결성 확인
-- SELECT 
--   pi.id as intent_id,
--   COUNT(pa.id) as attempt_count,
--   COUNT(pr.id) as refund_count
-- FROM payment_intents pi
-- LEFT JOIN payment_attempts pa ON pi.id = pa.intent_id
-- LEFT JOIN payment_refunds pr ON pi.id = pr.intent_id
-- GROUP BY pi.id
-- LIMIT 10;

-- 8.4 인덱스 사용 확인
-- EXPLAIN (ANALYZE, BUFFERS) 
-- SELECT * FROM payment_intents WHERE customer_id = 'test_user' AND status = 'PENDING';

-- ================================================================
-- 마이그레이션 완료 로그
-- ================================================================
INSERT INTO schema_migrations (version, applied_at) 
VALUES ('2025xxxx_view_to_table', NOW())
ON CONFLICT (version) DO NOTHING;

-- ================================================================
-- 롤백 스크립트 (필요시)
-- ================================================================

/*
-- 롤백 순서 (역순)
-- 1. 트리거 제거
DROP TRIGGER IF EXISTS update_payment_intents_updated_at ON payment_intents;
DROP TRIGGER IF EXISTS update_payment_attempts_updated_at ON payment_attempts;

-- 2. 뷰 제거
DROP VIEW IF EXISTS payment_sessions;
DROP VIEW IF EXISTS payment_events; 
DROP VIEW IF EXISTS refund_events;
DROP VIEW IF EXISTS v_bnpl_invoice;
DROP VIEW IF EXISTS v_bnpl_invoice_item;
DROP VIEW IF EXISTS v_bnpl_collection_event;

-- 3. 테이블 제거 (외래키 순서 고려)
DROP TABLE IF EXISTS checkout_sessions;
DROP TABLE IF EXISTS payment_refunds;
DROP TABLE IF EXISTS payment_attempts;
DROP TABLE IF EXISTS payment_intents;

-- 4. 함수 제거
DROP FUNCTION IF EXISTS update_updated_at_column();

-- 5. 마이그레이션 기록 제거
DELETE FROM schema_migrations WHERE version = '2025xxxx_view_to_table';
*/
