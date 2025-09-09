-- 002-v2-tables.sql - v2 아키텍처 새 테이블 생성
-- 
-- 목표: 옵션 B (리네임) - 새로운 테이블명으로 v2 구조 생성
-- - payment_intents (PaymentIntent)
-- - payment_attempts (PaymentAttempt) 
-- - payment_refunds (PaymentRefund)
-- - checkout_sessions (웹 리다이렉트용)

-- ================================================================
-- PaymentIntent 테이블 - 결제 의도 (한국 전용, currency 제거)
-- ================================================================
CREATE TABLE payment_intents (
  id VARCHAR(26) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  type VARCHAR(32) NOT NULL DEFAULT 'ORDER',
  allowed_providers TEXT, -- JSON array
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  metadata TEXT, -- JSON
  refunded_amount DECIMAL(19, 4) NOT NULL DEFAULT 0,
  authorized_at TIMESTAMP WITH TIME ZONE,
  captured_at TIMESTAMP WITH TIME ZONE
);

-- 인덱스 생성
CREATE INDEX idx_payment_intents_customer_id ON payment_intents(customer_id);
CREATE INDEX idx_payment_intents_status ON payment_intents(status);
CREATE INDEX idx_payment_intents_type ON payment_intents(type);
CREATE INDEX idx_payment_intents_created_at ON payment_intents(created_at);
CREATE INDEX idx_payment_intents_expires_at ON payment_intents(expires_at);

-- ================================================================
-- PaymentAttempt 테이블 - 결제 시도
-- ================================================================
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
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  error_message TEXT,
  event_context TEXT NOT NULL,
  transaction_id VARCHAR(255),
  approval_number VARCHAR(255)
);

-- 인덱스 생성
CREATE INDEX idx_payment_attempts_intent_id ON payment_attempts(intent_id);
CREATE INDEX idx_payment_attempts_provider ON payment_attempts(provider);
CREATE INDEX idx_payment_attempts_status ON payment_attempts(status);
CREATE INDEX idx_payment_attempts_created_at ON payment_attempts(created_at);
CREATE INDEX idx_payment_attempts_profile_id ON payment_attempts(profile_id);

-- ================================================================
-- PaymentRefund 테이블 - 환불
-- ================================================================
CREATE TABLE payment_refunds (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  attempt_id VARCHAR(26) NOT NULL REFERENCES payment_attempts(id),
  amount DECIMAL(19, 4) NOT NULL,
  status VARCHAR(255) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by VARCHAR(64),
  metadata TEXT,
  refund_account_id VARCHAR(26) REFERENCES user_refund_accounts(id)
);

-- 인덱스 생성
CREATE INDEX idx_payment_refunds_intent_id ON payment_refunds(intent_id);
CREATE INDEX idx_payment_refunds_attempt_id ON payment_refunds(attempt_id);
CREATE INDEX idx_payment_refunds_status ON payment_refunds(status);
CREATE INDEX idx_payment_refunds_created_at ON payment_refunds(created_at);

-- ================================================================
-- CheckoutSession 테이블 - 웹 리다이렉트 UX용 경량 컨테이너
-- ================================================================
CREATE TABLE checkout_sessions (
  id VARCHAR(26) PRIMARY KEY,
  intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  provider VARCHAR(32) NOT NULL,
  redirect_url TEXT NOT NULL,
  cancel_url TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata TEXT -- PG사별 세션 정보
);

-- 인덱스 생성
CREATE INDEX idx_checkout_sessions_intent_id ON checkout_sessions(intent_id);
CREATE INDEX idx_checkout_sessions_status ON checkout_sessions(status);
CREATE INDEX idx_checkout_sessions_created_at ON checkout_sessions(created_at);
CREATE INDEX idx_checkout_sessions_expires_at ON checkout_sessions(expires_at);

-- ================================================================
-- 레거시 호환 VIEW (옵션 B: 기존 테이블명으로 VIEW 제공)
-- ================================================================

-- payment_sessions VIEW (기존 코드 호환용)
CREATE OR REPLACE VIEW payment_sessions AS
SELECT 
  id,
  customer_id AS user_id,
  amount,
  'KRW' AS currency, -- 고정값
  status,
  type,
  allowed_providers,
  expires_at,
  created_at,
  updated_at,
  metadata,
  refunded_amount,
  authorized_at,
  captured_at
FROM payment_intents;

-- payment_events VIEW (기존 코드 호환용)
CREATE OR REPLACE VIEW payment_events AS
SELECT 
  id,
  intent_id AS session_id,
  profile_id AS method_id, -- 임시 매핑
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
  event_context,
  transaction_id,
  approval_number
FROM payment_attempts;

-- refund_events VIEW (기존 코드 호환용)  
CREATE OR REPLACE VIEW refund_events AS
SELECT 
  id,
  attempt_id AS payment_event_id,
  amount,
  status,
  reason,
  created_at,
  completed_at,
  completed_by,
  metadata,
  refund_account_id
FROM payment_refunds;

-- ================================================================
-- 트리거 함수 (updated_at 자동 업데이트)
-- ================================================================
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
-- 코멘트 추가
-- ================================================================
COMMENT ON TABLE payment_intents IS 'v2 결제 의도 테이블 - 한국 전용 (currency 제거)';
COMMENT ON TABLE payment_attempts IS 'v2 결제 시도 테이블 - Provider별 실행 기록';
COMMENT ON TABLE payment_refunds IS 'v2 환불 테이블 - Intent/Attempt 직접 참조';
COMMENT ON TABLE checkout_sessions IS 'v2 체크아웃 세션 테이블 - 웹 리다이렉트 UX용';

COMMENT ON VIEW payment_sessions IS '레거시 호환 VIEW - payment_intents 매핑';
COMMENT ON VIEW payment_events IS '레거시 호환 VIEW - payment_attempts 매핑';
COMMENT ON VIEW refund_events IS '레거시 호환 VIEW - payment_refunds 매핑';
