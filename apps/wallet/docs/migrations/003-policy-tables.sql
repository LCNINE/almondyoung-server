-- 003-policy-tables.sql - 정책 테이블화 (리뉴얼.md 6.1절)
-- 
-- 목표: 런타임에 정책 변경 가능한 테이블 구조 생성
-- - payment_type_provider_policy: Type × Provider 매핑
-- - payment_provider_capabilities: Provider별 능력/제약
-- - payment_type_parameters: Type별 비즈니스 파라미터

-- ================================================================
-- 결제 타입별 허용 Provider 정책 테이블
-- ================================================================
CREATE TABLE payment_type_provider_policy (
  id VARCHAR(26) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  requires_stored_profile BOOLEAN NOT NULL DEFAULT false,
  allows_ephemeral BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(type, provider)
);

-- 인덱스 생성
CREATE INDEX idx_policy_type ON payment_type_provider_policy(type);
CREATE INDEX idx_policy_provider ON payment_type_provider_policy(provider);
CREATE INDEX idx_policy_active ON payment_type_provider_policy(is_active);

-- ================================================================
-- Provider 능력/제약 테이블 (전역)
-- ================================================================
CREATE TABLE payment_provider_capabilities (
  provider VARCHAR(32) PRIMARY KEY,
  supports_cancel BOOLEAN NOT NULL DEFAULT true,
  supports_refund BOOLEAN NOT NULL DEFAULT true,
  max_retries INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  supported_methods TEXT, -- JSON array
  notes TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_provider_enabled ON payment_provider_capabilities(is_enabled);

-- ================================================================
-- 타입별 비즈니스 파라미터 테이블
-- ================================================================
CREATE TABLE payment_type_parameters (
  type VARCHAR(32) PRIMARY KEY,
  max_amount DECIMAL(19, 4) NOT NULL DEFAULT 10000000,
  min_amount DECIMAL(19, 4) NOT NULL DEFAULT 100,
  params TEXT, -- JSON - 추가 파라미터들
  description VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ================================================================
-- 기본 데이터 삽입 (DEFAULT_PAYMENT_POLICY 기반)
-- ================================================================

-- Provider 능력 정보 삽입
INSERT INTO payment_provider_capabilities (provider, supports_cancel, supports_refund, max_retries, timeout_ms, supported_methods, is_enabled) VALUES
('TOSS', true, true, 3, 30000, '["card", "bank_transfer"]', true),
('KAKAOPAY', true, true, 2, 25000, '["wallet"]', true),
('CMS', true, true, 1, 60000, '["bank_account"]', true),
('BNPL', true, true, 2, 15000, '["credit_limit"]', true),
('POINTS', false, false, 1, 5000, '["balance"]', true);

-- 타입별 파라미터 삽입
INSERT INTO payment_type_parameters (type, max_amount, min_amount, description, is_active) VALUES
('ORDER', 10000000, 100, '일반 주문 결제', true),
('BNPL_CAPTURE', 5000000, 1000, 'BNPL 월말 캡처 (CMS 전용)', true),
('MEMBERSHIP_FEE', 1000000, 10000, '멤버십 정기결제', true);

-- 타입별 허용 Provider 정책 삽입
INSERT INTO payment_type_provider_policy (id, type, provider, requires_stored_profile, allows_ephemeral, is_active) VALUES
-- ORDER 타입
('01KPOLICY001', 'ORDER', 'TOSS', false, true, true),
('01KPOLICY002', 'ORDER', 'KAKAOPAY', false, true, true),
('01KPOLICY003', 'ORDER', 'BNPL', false, true, true),
('01KPOLICY004', 'ORDER', 'POINTS', false, false, true),

-- BNPL_CAPTURE 타입 (CMS 전용 - 하드가드)
('01KPOLICY005', 'BNPL_CAPTURE', 'CMS', true, false, true),

-- MEMBERSHIP_FEE 타입
('01KPOLICY006', 'MEMBERSHIP_FEE', 'TOSS', true, false, true),
('01KPOLICY007', 'MEMBERSHIP_FEE', 'BNPL', true, false, true);

-- ================================================================
-- 트리거 함수 (updated_at 자동 업데이트)
-- ================================================================
CREATE OR REPLACE FUNCTION update_policy_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 트리거 적용
CREATE TRIGGER update_policy_type_provider_updated_at 
  BEFORE UPDATE ON payment_type_provider_policy 
  FOR EACH ROW EXECUTE FUNCTION update_policy_updated_at_column();

CREATE TRIGGER update_provider_capabilities_updated_at 
  BEFORE UPDATE ON payment_provider_capabilities 
  FOR EACH ROW EXECUTE FUNCTION update_policy_updated_at_column();

CREATE TRIGGER update_type_parameters_updated_at 
  BEFORE UPDATE ON payment_type_parameters 
  FOR EACH ROW EXECUTE FUNCTION update_policy_updated_at_column();

-- ================================================================
-- 코멘트 추가
-- ================================================================
COMMENT ON TABLE payment_type_provider_policy IS '결제 타입별 허용 Provider 정책 - 런타임 변경 가능';
COMMENT ON TABLE payment_provider_capabilities IS 'Provider별 능력/제약 정보';
COMMENT ON TABLE payment_type_parameters IS '결제 타입별 비즈니스 파라미터';

COMMENT ON COLUMN payment_type_provider_policy.requires_stored_profile IS '저장형 Profile 필수 여부';
COMMENT ON COLUMN payment_type_provider_policy.allows_ephemeral IS 'Ephemeral Instrument 허용 여부';
COMMENT ON COLUMN payment_provider_capabilities.supported_methods IS 'JSON 배열 - 지원하는 결제 수단들';
COMMENT ON COLUMN payment_type_parameters.params IS 'JSON - 타입별 추가 파라미터들';
