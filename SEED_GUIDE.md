# 정기결제 테스트용 Drizzle Seed 가이드

## 🎯 목적

멤버십 정기결제 시스템의 다양한 시나리오를 테스트하기 위한 Drizzle ORM seed 데이터를 생성합니다.

## 📋 테스트 시나리오

### 1. 오늘 결제 예정 (정상 케이스)

- **사용자 ID**: `test-user-001`
- **결제일**: 오늘
- **상태**: 정상
- **결제 프로필**: `hms-profile-001`
- **예상 결과**: 정상 결제 처리

### 2. 1일 연체 (첫 번째 재시도)

- **사용자 ID**: `test-user-002`
- **결제일**: 어제 (1일 연체)
- **상태**: 연체 (재시도 1회)
- **결제 프로필**: `hms-profile-002`
- **예상 결과**: 재시도 결제 처리

### 3. 3일 연체 (마지막 재시도)

- **사용자 ID**: `test-user-003`
- **결제일**: 3일 전 (3일 연체)
- **상태**: 연체 (재시도 2회)
- **결제 프로필**: `hms-profile-003`
- **예상 결과**: 최종 재시도 결제 처리

### 4. 결제 프로필 없음 (에러 케이스)

- **사용자 ID**: `test-user-004`
- **결제일**: 오늘
- **상태**: 정상
- **결제 프로필**: 없음
- **예상 결과**: `NO_PAYMENT_PROFILE` 에러

## 🚀 사용법

### 1. 환경변수 설정

```bash
export DATABASE_URL="postgresql://username:password@localhost:5432/membership_db"
export PAYMENT_SERVER_URL="http://localhost:5000"
```

### 2. Drizzle Seed 실행

```bash
cd 멤버십
npm run db:seed:billing-test
```

또는 직접 실행:

```bash
cd apps/membership
drizzle-kit seed
```

### 3. 정기결제 스케줄러 실행

```bash
npm run start:dev membership
```

## 📊 생성되는 데이터

### Tiers (티어)

```sql
INSERT INTO tiers (code, priority_level) VALUES ('PREMIUM', 2);
```

### Plans (플랜)

```sql
INSERT INTO plan (tier_id, price, duration_days, currency, trial_days, is_active)
VALUES (tier_id, 10000, 30, 'KRW', 0, true);
```

### Users (사용자)

```sql
INSERT INTO users (id) VALUES
('test-user-001'),
('test-user-002'),
('test-user-003'),
('test-user-004');
```

### Subscription Contracts (구독 계약)

```sql
-- 오늘 결제 예정
INSERT INTO subscription_contracts (user_id, plan_id, next_billing_date, payment_profile_id, is_past_due, billing_retry_count)
VALUES ('test-user-001', plan_id, '2024-01-15', 'hms-profile-001', false, 0);

-- 1일 연체
INSERT INTO subscription_contracts (user_id, plan_id, next_billing_date, payment_profile_id, is_past_due, billing_retry_count)
VALUES ('test-user-002', plan_id, '2024-01-14', 'hms-profile-002', true, 1);

-- 3일 연체
INSERT INTO subscription_contracts (user_id, plan_id, next_billing_date, payment_profile_id, is_past_due, billing_retry_count)
VALUES ('test-user-003', plan_id, '2024-01-12', 'hms-profile-003', true, 2);

-- 결제 프로필 없음
INSERT INTO subscription_contracts (user_id, plan_id, next_billing_date, payment_profile_id, is_past_due, billing_retry_count)
VALUES ('test-user-004', plan_id, '2024-01-15', null, false, 0);
```

### Subscription Entitlement (구독 권한)

```sql
-- 모든 사용자에 대해 활성 권한 생성 (내일까지)
INSERT INTO subscription_entitlement (user_id, tier_id, starts_at, ends_at, is_current)
VALUES (user_id, tier_id, '2023-12-16', '2024-01-16', true);
```

### Membership Dunning Queue (재시도 큐)

```sql
-- 연체 사용자들에 대해서만 생성
INSERT INTO membership_dunning_queue (contract_id, next_retry_at, attempts, max_attempts, last_error_code, last_error_message)
VALUES (contract_id, '2024-01-16 09:00:00', 1, 3, 'PAYMENT_FAILED', '이전 결제 실패 - 재시도 예정');
```

## 🔍 결과 확인

### 1. 생성된 계약 확인

```sql
SELECT
    sc.id,
    sc.user_id,
    sc.next_billing_date,
    sc.is_past_due,
    sc.billing_retry_count,
    sc.payment_profile_id
FROM subscription_contracts sc
ORDER BY sc.user_id;
```

### 2. 권한 상태 확인

```sql
SELECT
    se.user_id,
    se.starts_at,
    se.ends_at,
    se.is_current,
    t.code as tier_code
FROM subscription_entitlement se
JOIN tiers t ON se.tier_id = t.id
ORDER BY se.user_id;
```

### 3. Dunning 큐 확인

```sql
SELECT
    mdq.contract_id,
    sc.user_id,
    mdq.attempts,
    mdq.max_attempts,
    mdq.next_retry_at,
    mdq.last_error_code
FROM membership_dunning_queue mdq
JOIN subscription_contracts sc ON mdq.contract_id = sc.id
ORDER BY sc.user_id;
```

## 📝 로그 모니터링

정기결제 스케줄러 실행 후 예상 로그:

```
[RecurringBillingService] Starting daily billing scheduler...
[RecurringBillingService] Found 4 contracts due for billing
[RecurringBillingService] Processing billing for contract: test-user-001
[PaymentClientService] Creating payment intent for contract: contract-id
[PaymentClientService] Payment processed: intent-id with status: CAPTURED
[RecurringBillingService] Billing successful for contract test-user-001, next billing: 2024-02-15

[RecurringBillingService] Processing billing for contract: test-user-004
[PaymentClientService] Failed to get payment profile for user test-user-004: No active payment profile found
[RecurringBillingService] Failed to process billing for contract test-user-004: NO_PAYMENT_PROFILE
```

## 🧹 데이터 정리

테스트 완료 후 데이터를 정리하려면 seed 파일에서 `cleanupExistingTestData()` 함수가 자동으로 실행됩니다.

수동으로 정리하려면:

```sql
DELETE FROM membership_dunning_queue;
DELETE FROM subscription_entitlement;
DELETE FROM subscription_contracts;
DELETE FROM users WHERE id LIKE 'test-user-%';
DELETE FROM plan;
DELETE FROM tiers WHERE code = 'PREMIUM';
```

## ⚠️ 주의사항

1. **Wallet 서버 필요**: 실제 결제 처리를 위해 Wallet v4 서버가 실행 중이어야 합니다.
2. **날짜 기준**: Seed 데이터는 실행 시점의 날짜를 기준으로 생성됩니다.
3. **환경변수**: DATABASE_URL과 PAYMENT_SERVER_URL이 올바르게 설정되어야 합니다.

## 🔧 트러블슈팅

### Seed 실행 실패

```bash
# Drizzle Kit 버전 확인
npx drizzle-kit --version

# 스키마 검증
cd apps/membership
drizzle-kit check

# 마이그레이션 상태 확인
drizzle-kit status
```

### 데이터베이스 연결 실패

```bash
# 환경변수 확인
echo $DATABASE_URL

# 데이터베이스 접속 테스트
psql $DATABASE_URL -c "SELECT 1;"
```

## 🎯 테스트 실행 순서

1. **Seed 데이터 생성**: `npm run db:seed:billing-test`
2. **Wallet 서버 실행**: Wallet v4 서버 시작
3. **멤버십 서버 실행**: `npm run start:dev membership`
4. **로그 모니터링**: 1분마다 실행되는 스케줄러 로그 확인
5. **결과 검증**: 데이터베이스에서 결제 결과 확인
