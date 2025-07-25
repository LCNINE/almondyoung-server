-- 청구서 세션 관리를 위한 컬럼 추가
-- 동시성 제어를 통한 중복 결제 방지

-- Invoice 테이블에 세션 관련 컬럼 추가
ALTER TABLE invoice 
ADD COLUMN payment_session_id VARCHAR(255) UNIQUE,
ADD COLUMN payment_session_expires_at TIMESTAMP WITH TIME ZONE;

-- 성능 최적화를 위한 인덱스 추가
CREATE INDEX idx_invoice_payment_session_id ON invoice(payment_session_id) WHERE payment_session_id IS NOT NULL;
CREATE INDEX idx_invoice_payment_session_expires_at ON invoice(payment_session_expires_at) WHERE payment_session_expires_at IS NOT NULL;

-- 복합 인덱스 (만료된 세션 정리용)
CREATE INDEX idx_invoice_session_cleanup ON invoice(payment_session_expires_at, payment_session_id) 
WHERE payment_session_id IS NOT NULL AND payment_session_expires_at IS NOT NULL;

-- 코멘트 추가
COMMENT ON COLUMN invoice.payment_session_id IS '청구서 결제 세션 ID - 동시성 제어용';
COMMENT ON COLUMN invoice.payment_session_expires_at IS '청구서 결제 세션 만료 시간 - 15분 후 자동 만료';