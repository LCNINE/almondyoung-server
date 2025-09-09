-- ================================================================
-- v4 Architecture Migration: Intent/Attempt Views 생성
-- 기존 스키마를 유지하면서 의미를 명확화하는 VIEW들을 생성
-- 업데이트된 참고 문서 기준 (2025-01-08)
-- ================================================================

-- 먼저 필요한 컬럼들을 추가 (Drizzle 스키마와 동기화)
ALTER TABLE payment_sessions
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) DEFAULT 'ORDER',
  ADD COLUMN IF NOT EXISTS allowed_providers TEXT; -- JSON 문자열 ['TOSS','KAKAOPAY','CMS','BNPL','POINTS']

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32),          -- 'TOSS'|'KAKAOPAY'|'CMS'|'BNPL'|'POINTS'
  ADD COLUMN IF NOT EXISTS instrument_kind VARCHAR(16),   -- 'stored'|'ephemeral'
  ADD COLUMN IF NOT EXISTS instrument_ref TEXT,           -- ephemeral 승인키 등
  ADD COLUMN IF NOT EXISTS profile_id VARCHAR(26);        -- 저장형 수단 연결(있을 때만)

-- 1. PaymentIntent View (payment_sessions → Intent 의미)
CREATE OR REPLACE VIEW v_payment_intent AS
SELECT 
    id AS intent_id,
    user_id AS customer_id,
    amount,
    currency,
    status,
    type,
    allowed_providers,
    expires_at,
    created_at,
    updated_at,
    metadata
FROM payment_sessions;

-- 2. PaymentAttempt View (payment_events → Attempt 의미)  
CREATE OR REPLACE VIEW v_payment_attempt AS
SELECT 
    id AS attempt_id,
    session_id AS intent_id,
    method_id AS legacy_method_id,
    provider,
    instrument_kind,
    instrument_ref,
    profile_id,
    amount,
    status,
    actor,
    created_at,
    updated_at,
    error_message,
    event_context
FROM payment_events;

-- 3. RefundIntent View (refund_events + payment_events join)
-- 참고: 환불 도메인에서는 성공 상태를 'COMPLETED'로 사용 (용어 충돌 방지)
CREATE OR REPLACE VIEW v_refund_intent AS
SELECT 
    r.id AS refund_id,
    e.session_id AS intent_id,
    r.payment_event_id AS attempt_id,
    r.amount,
    r.status, -- REQUESTED | APPROVED | COMPLETED | CANCELLED | FAILED
    r.reason,
    r.created_at,
    r.metadata
FROM refund_events r
JOIN payment_events e ON e.id = r.payment_event_id;

-- 4. BNPL Invoice View (settlement_batch → Invoice 의미)
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

-- 5. BNPL Invoice Items View (settlement_batch_item → Invoice Item 의미)
CREATE OR REPLACE VIEW v_bnpl_invoice_item AS
SELECT 
    id AS item_id,
    batch_id AS invoice_id,
    bnpl_event_id AS usage_id,
    amount,
    transaction_date,
    created_at
FROM settlement_batch_item;

-- 6. BNPL Collection Events View (settlement_process_event → Collection Event 의미)
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
-- 인덱스 추가 (성능 최적화)
-- ================================================================

-- Intent 조회 최적화
CREATE INDEX IF NOT EXISTS idx_payment_sessions_type ON payment_sessions(type);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_type_status ON payment_sessions(type, status);

-- Attempt 조회 최적화  
CREATE INDEX IF NOT EXISTS idx_payment_events_provider ON payment_events(provider);
CREATE INDEX IF NOT EXISTS idx_payment_events_instrument_kind ON payment_events(instrument_kind);
CREATE INDEX IF NOT EXISTS idx_payment_events_profile_id ON payment_events(profile_id);

-- Provider별 성능 최적화
CREATE INDEX IF NOT EXISTS idx_payment_events_provider_status ON payment_events(provider, status);
CREATE INDEX IF NOT EXISTS idx_payment_events_session_provider ON payment_events(session_id, provider);

-- ================================================================
-- 권한 설정 (필요한 경우)
-- ================================================================

-- 읽기 전용 사용자에게 VIEW 권한 부여 (예시)
-- GRANT SELECT ON v_payment_intent TO readonly_user;
-- GRANT SELECT ON v_payment_attempt TO readonly_user;
-- GRANT SELECT ON v_refund_intent TO readonly_user;
-- GRANT SELECT ON v_bnpl_invoice TO readonly_user;
-- GRANT SELECT ON v_bnpl_invoice_item TO readonly_user;
-- GRANT SELECT ON v_bnpl_collection_event TO readonly_user;

-- ================================================================
-- 확인 쿼리 (마이그레이션 후 테스트용)
-- ================================================================

-- 1. Intent 조회 테스트
-- SELECT * FROM v_payment_intent WHERE type = 'ORDER' LIMIT 5;

-- 2. Attempt 조회 테스트  
-- SELECT * FROM v_payment_attempt WHERE provider = 'TOSS' LIMIT 5;

-- 3. Refund 조회 테스트
-- SELECT * FROM v_refund_intent WHERE status = 'COMPLETED' LIMIT 5;

-- 4. BNPL Invoice 조회 테스트
-- SELECT * FROM v_bnpl_invoice WHERE status = 'OPEN' LIMIT 5;

-- 5. 통계 확인
-- SELECT 
--     type,
--     COUNT(*) as intent_count,
--     SUM(amount) as total_amount
-- FROM v_payment_intent 
-- GROUP BY type;
