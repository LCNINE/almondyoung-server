-- check-payment-events.sql
-- 멤버십 정기결제 테스트 결과 확인 SQL

-- 1. 최근 생성된 PaymentEvents 조회 (최신 10개)
SELECT 
  id,
  payment_method_id,
  amount,
  status,
  actor,
  pg_transaction_id,
  created_at,
  metadata::json->>'paymentPurpose' as payment_purpose,
  metadata::json->>'isSubscriptionPayment' as is_subscription,
  metadata::json->>'subscriptionType' as subscription_type,
  metadata::json->>'source' as source,
  pricing_snapshot::json->>'finalAmount' as final_amount,
  pricing_snapshot::json->>'originalAmount' as original_amount,
  pricing_snapshot::json->>'discountAmount' as discount_amount,
  pricing_snapshot::json->>'couponId' as coupon_id
FROM payment_events 
ORDER BY created_at DESC 
LIMIT 10;

-- 2. 테스트에서 생성된 특정 PaymentEvents 조회
SELECT 
  'Premium Plan (29,900원)' as test_case,
  id,
  amount,
  status,
  metadata::json->>'subscriptionType' as subscription_type,
  pricing_snapshot::json->>'finalAmount' as final_amount,
  created_at
FROM payment_events 
WHERE id = '01K4HKCFNXCQGN3889GR13PBQW'

UNION ALL

SELECT 
  'Basic Plan (19,900원)' as test_case,
  id,
  amount,
  status,
  metadata::json->>'subscriptionType' as subscription_type,
  pricing_snapshot::json->>'finalAmount' as final_amount,
  created_at
FROM payment_events 
WHERE id = '01K4HKCG9WERBP7HGV1FWGPC7A';

-- 3. PaymentEvents 통계 (최근 1시간)
SELECT 
  status,
  COUNT(*) as count,
  SUM(amount) as total_amount,
  AVG(amount) as avg_amount
FROM payment_events 
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY status
ORDER BY count DESC;

-- 4. 결제수단별 통계
SELECT 
  pm.method_type,
  pm.method_name,
  COUNT(pe.*) as payment_count,
  SUM(pe.amount) as total_amount,
  MAX(pe.created_at) as last_payment
FROM payment_events pe
JOIN payment_method pm ON pe.payment_method_id = pm.id
WHERE pe.created_at >= NOW() - INTERVAL '1 hour'
GROUP BY pm.method_type, pm.method_name
ORDER BY payment_count DESC;

-- 5. 가이드 문서 준수 확인 (필수 필드 체크)
SELECT 
  id,
  CASE 
    WHEN payment_method_id IS NOT NULL THEN '✅' 
    ELSE '❌' 
  END as has_payment_method_id,
  CASE 
    WHEN amount > 0 THEN '✅' 
    ELSE '❌' 
  END as has_valid_amount,
  CASE 
    WHEN status IN ('AUTHORIZED', 'CAPTURED', 'FAILED') THEN '✅' 
    ELSE '❌' 
  END as has_valid_status,
  CASE 
    WHEN actor IN ('USER', 'SCHEDULER', 'ADMIN', 'SYSTEM') THEN '✅' 
    ELSE '❌' 
  END as has_valid_actor,
  CASE 
    WHEN metadata IS NOT NULL AND metadata::json ? 'paymentPurpose' THEN '✅' 
    ELSE '❌' 
  END as has_metadata_payment_purpose,
  CASE 
    WHEN pricing_snapshot IS NOT NULL AND pricing_snapshot::json ? 'finalAmount' THEN '✅' 
    ELSE '❌' 
  END as has_pricing_snapshot,
  created_at
FROM payment_events 
WHERE created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- 6. JSON 필드 상세 분석
SELECT 
  id,
  amount,
  -- metadata 필드 분석
  metadata::json->>'paymentPurpose' as payment_purpose,
  metadata::json->>'isSubscriptionPayment' as is_subscription_payment,
  metadata::json->>'source' as source,
  metadata::json->>'subscriptionType' as subscription_type,
  metadata::json->>'billingCycle' as billing_cycle,
  metadata::json->>'planId' as plan_id,
  -- pricingSnapshot 필드 분석  
  pricing_snapshot::json->>'originalAmount' as original_amount,
  pricing_snapshot::json->>'discountAmount' as discount_amount,
  pricing_snapshot::json->>'finalAmount' as final_amount,
  pricing_snapshot::json->>'couponId' as coupon_id,
  pricing_snapshot::json->>'discountRate' as discount_rate,
  -- pgResponse 필드 분석
  pg_response::json->>'gateway' as gateway,
  pg_response::json->>'approvalNumber' as approval_number,
  created_at
FROM payment_events 
WHERE created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
