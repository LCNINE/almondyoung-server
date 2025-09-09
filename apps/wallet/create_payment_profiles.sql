-- payment_profiles 테이블 수동 생성
CREATE TABLE IF NOT EXISTS payment_profiles (
    id VARCHAR(26) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    profile_type TEXT NOT NULL CHECK (profile_type IN ('CARD', 'BANK_ACCOUNT', 'BNPL', 'REWARD_POINT')),
    profile_name VARCHAR(64) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'FAILED')),
    payment_purpose TEXT NOT NULL DEFAULT 'PURCHASE' CHECK (payment_purpose IN ('PURCHASE', 'SUBSCRIPTION', 'BOTH')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 인덱스 생성
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_default_unique ON payment_profiles (user_id) WHERE is_default = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_profile_id_type ON payment_profiles (id, profile_type);

-- batch_cms_profiles 테이블도 생성
CREATE TABLE IF NOT EXISTS batch_cms_profiles (
    id VARCHAR(26) PRIMARY KEY REFERENCES payment_profiles(id),
    payment_profile_id VARCHAR(26) NOT NULL REFERENCES payment_profiles(id),
    hms_member_id VARCHAR(64) NOT NULL,
    hms_cust_id VARCHAR(64) NOT NULL DEFAULT 'default-cust',
    credit_limit NUMERIC(18, 2) NOT NULL DEFAULT 0,
    approved_limit NUMERIC(18, 2) NOT NULL DEFAULT 0,
    billing_cycle_day INTEGER NOT NULL DEFAULT 28,
    hms_metadata TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- BNPL 관련 테이블들도 생성
CREATE TABLE IF NOT EXISTS bnpl_invoices (
    id VARCHAR(26) PRIMARY KEY,
    bnpl_account_id VARCHAR(21) NOT NULL REFERENCES bnpl_account(id),
    invoice_number VARCHAR(50) NOT NULL,
    total_amount NUMERIC(19, 4) NOT NULL DEFAULT 0,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    pg_transaction_id VARCHAR(255),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS bnpl_invoice_items (
    id VARCHAR(26) PRIMARY KEY,
    invoice_id VARCHAR(26) NOT NULL REFERENCES bnpl_invoices(id),
    bnpl_event_id VARCHAR(26) NOT NULL REFERENCES bnpl_events(id),
    amount NUMERIC(19, 4) NOT NULL,
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS bnpl_collection_events (
    id VARCHAR(26) PRIMARY KEY,
    invoice_id VARCHAR(26) NOT NULL REFERENCES bnpl_invoices(id),
    invoice_item_id VARCHAR(26) REFERENCES bnpl_invoice_items(id),
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('COLLECTION_STARTED', 'ITEM_PROCESSING', 'ITEM_AUTHORIZED', 'ITEM_CAPTURED', 'ITEM_FAILED', 'COLLECTION_COMPLETED', 'COLLECTION_FAILED')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('PROCESSING', 'AUTHORIZED', 'CAPTURED', 'FAILED')),
    payment_event_id VARCHAR(26),
    error_message TEXT,
    metadata TEXT,
    actor VARCHAR(255) NOT NULL DEFAULT 'SCHEDULER' CHECK (actor IN ('SCHEDULER', 'ADMIN', 'SYSTEM', 'USER')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
