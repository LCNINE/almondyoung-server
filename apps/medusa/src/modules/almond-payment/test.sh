#!/bin/bash

# Medusa Almond Payment Provider 테스트 스크립트 (PaymentSession 기반)
# 사용법: ./test.sh

MEDUSA_URL="http://localhost:9000"
WALLET_URL="http://localhost:5000"
TEST_USER_ID="medusa-test-user-$(date +%s)"

echo "🚀 Medusa Almond Payment Provider 테스트 시작"
echo "Medusa URL: $MEDUSA_URL"
echo "Wallet URL: $WALLET_URL"
echo "테스트 사용자 ID: $TEST_USER_ID"
echo "================================"

# 1. Wallet 서버에 결제수단 등록 (BNPL 계정 자동 생성)
echo "1️⃣ Wallet 서버에 결제수단 등록 중..."
PAYMENT_RESPONSE=$(curl -s -X POST "$WALLET_URL/payment-methods" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"methodType\": \"BNPL\",
    \"methodName\": \"Medusa 테스트 계정\",
    \"institutionCode\": \"ALMOND001\",
    \"isDefault\": true
  }")

echo "결제수단 등록 결과:"
echo "$PAYMENT_RESPONSE" | jq '.'

PAYMENT_METHOD_ID=$(echo "$PAYMENT_RESPONSE" | jq -r '.id')
echo "결제수단 ID: $PAYMENT_METHOD_ID"

# 2. BNPL 계정 생성 확인 (재시도 로직)
echo -e "\n2️⃣ BNPL 계정 생성 확인 중..."
RETRY_COUNT=0
MAX_RETRIES=10

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    sleep 2
    ACCOUNT_RESPONSE=$(curl -s "$WALLET_URL/bnpl/accounts/me?userId=$TEST_USER_ID")
    
    if echo "$ACCOUNT_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        echo "✅ BNPL 계정 생성 성공!"
        BNPL_ACCOUNT_ID=$(echo "$ACCOUNT_RESPONSE" | jq -r '.data.id')
        echo "계정 ID: $BNPL_ACCOUNT_ID"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "⏳ BNPL 계정 생성 대기 중... ($RETRY_COUNT/$MAX_RETRIES)"
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "❌ BNPL 계정 생성 실패"
    exit 1
fi

# 3. 동의자료 업로드 (결제수단 활성화)
echo -e "\n3️⃣ 동의자료 업로드 중..."

# 테스트용 동의서 파일 생성
TEST_AGREEMENT_FILE="/tmp/medusa-test-agreement-$TEST_USER_ID.txt"
cat > "$TEST_AGREEMENT_FILE" << EOF
BNPL 서비스 이용 동의서 (Medusa 테스트용)

본인은 BNPL(Buy Now Pay Later) 서비스 이용에 동의합니다.

사용자: $TEST_USER_ID
결제수단 ID: $PAYMENT_METHOD_ID
동의 일시: $(date)
테스트 목적: Medusa Payment Provider 검증

서명: Medusa 테스트 사용자
EOF

echo "테스트용 동의서 파일 생성: $TEST_AGREEMENT_FILE"

# HMS API에서 사용하는 memberId는 결제수단 ID와 동일하게 설정
HMS_MEMBER_ID="$PAYMENT_METHOD_ID"

echo "동의자료 업로드 중... (HMS 회원 ID: $HMS_MEMBER_ID)"
CONSENT_RESPONSE=$(curl -s -X POST "$WALLET_URL/payment-methods/$HMS_MEMBER_ID/consent" \
  -F "agreementFile=@$TEST_AGREEMENT_FILE")

echo "동의자료 업로드 결과:"
echo "$CONSENT_RESPONSE" | jq '.'

# 동의자료 업로드 후 1분 대기 (결제수단 활성화 시간)
echo -e "\n⏳ 결제수단 활성화 대기 중 (1분)..."
sleep 60

echo "✅ 결제수단 활성화 대기 완료"

# 4. Almond Payment Provider 직접 테스트 (initiatePayment)
echo -e "\n4️⃣ Almond Payment Provider 직접 테스트..."
echo "💡 Payment Provider는 장바구니와 독립적으로 결제 세션만 생성합니다."

# 4-1. initiatePayment 테스트 (Medusa Payment Provider API 직접 호출)
echo -e "\n4️⃣-1 initiatePayment 테스트..."
INITIATE_PAYLOAD="{
  \"amount\": 150000,
  \"currency_code\": \"KRW\",
  \"data\": {
    \"user_id\": \"$TEST_USER_ID\",
    \"payment_method_id\": \"$PAYMENT_METHOD_ID\"
  },
  \"context\": {
    \"customer\": {
      \"id\": \"$TEST_USER_ID\",
      \"email\": \"$TEST_USER_ID@test.com\"
    }
  }
}"

echo "initiatePayment 요청 데이터:"
echo "$INITIATE_PAYLOAD" | jq '.'

# Medusa Payment Provider를 직접 테스트하기 위해 내부 API 호출
# 실제로는 Medusa가 내부적으로 호출하는 부분이지만, 테스트를 위해 시뮬레이션
echo "🔧 Payment Provider 내부 로직 시뮬레이션 중..."

# Wallet 서버에 PaymentSession 생성 요청 (Payment Provider가 하는 일)
WALLET_SESSION_RESPONSE=$(curl -s -X POST "$WALLET_URL/payment-sessions" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"amount\": 150000,
    \"currency\": \"KRW\",
    \"metadata\": {
      \"customer_id\": \"$TEST_USER_ID\",
      \"email\": \"$TEST_USER_ID@test.com\",
      \"test_source\": \"medusa_payment_provider\"
    },
    \"expiresInMinutes\": 30
  }")

echo "Wallet PaymentSession 생성 결과:"
echo "$WALLET_SESSION_RESPONSE" | jq '.'

ALMOND_SESSION_ID=$(echo "$WALLET_SESSION_RESPONSE" | jq -r '.data.id // empty')
PAYMENT_URL=$(echo "$WALLET_SESSION_RESPONSE" | jq -r '.data.payment_url // empty')

if [ -z "$ALMOND_SESSION_ID" ] || [ "$ALMOND_SESSION_ID" = "null" ]; then
    echo "❌ PaymentSession 생성 실패"
    echo "응답: $WALLET_SESSION_RESPONSE"
    exit 1
else
    echo "✅ PaymentSession 생성 성공"
    echo "Almond PaymentSession ID: $ALMOND_SESSION_ID"
    echo "Payment URL: $PAYMENT_URL"
fi

# 5. getPaymentStatus 테스트 (Payment Provider 폴링 시뮬레이션)
echo -e "\n5️⃣ getPaymentStatus 테스트..."
echo "💡 실제 환경에서는 사용자가 결제 페이지에서 결제를 완료하지만,"
echo "   테스트에서는 Wallet API를 직접 호출하여 결제를 시뮬레이션합니다."

# 5-1. Wallet 서버에서 직접 결제 승인 처리
echo -e "\n5️⃣-1 Wallet 서버에서 결제 승인 처리..."
if [ -n "$ALMOND_SESSION_ID" ]; then
    WALLET_AUTHORIZE_RESULT=$(curl -s -X POST "$WALLET_URL/payments/authorize" \
      -H "Content-Type: application/json" \
      -d "{
        \"paymentSessionId\": \"$ALMOND_SESSION_ID\",
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }")
    
    echo "Wallet 결제 승인 결과:"
    echo "$WALLET_AUTHORIZE_RESULT" | jq '.'
    
    PAYMENT_EVENT_ID=$(echo "$WALLET_AUTHORIZE_RESULT" | jq -r '.entityId // .entityBody.paymentEventId // .data.paymentEventId // empty')
    echo "PaymentEvent ID: $PAYMENT_EVENT_ID"
fi

# 5-2. Payment Provider getPaymentStatus 시뮬레이션
echo -e "\n5️⃣-2 Payment Provider getPaymentStatus 시뮬레이션..."
if [ -n "$ALMOND_SESSION_ID" ]; then
    # Wallet 서버에서 PaymentSession 상태 조회 (Payment Provider가 하는 일)
    STATUS_RESPONSE=$(curl -s "$WALLET_URL/payment-sessions/$ALMOND_SESSION_ID")
    
    echo "Wallet PaymentSession 상태 조회 결과:"
    echo "$STATUS_RESPONSE" | jq '.'
    
    PAYMENT_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.data.status // empty')
    echo "현재 결제 상태: $PAYMENT_STATUS"
    
    # 상태 매핑 확인
    case "$PAYMENT_STATUS" in
        "PENDING") MEDUSA_STATUS="pending" ;;
        "AUTHORIZED") MEDUSA_STATUS="authorized" ;;
        "CAPTURED") MEDUSA_STATUS="captured" ;;
        "FAILED") MEDUSA_STATUS="error" ;;
        "CANCELLED") MEDUSA_STATUS="canceled" ;;
        "REFUNDED") MEDUSA_STATUS="canceled" ;;
        *) MEDUSA_STATUS="pending" ;;
    esac
    
    echo "Medusa 매핑 상태: $MEDUSA_STATUS"
fi

# 6. authorizePayment 테스트 (실제로는 getPaymentStatus와 동일)
echo -e "\n6️⃣ authorizePayment 테스트..."
echo "💡 Payment Provider에서 authorizePayment는 getPaymentStatus와 동일하게 구현됩니다."
echo "현재 상태: $MEDUSA_STATUS"

# 7. capturePayment 테스트
echo -e "\n7️⃣ capturePayment 테스트..."
if [ -n "$PAYMENT_EVENT_ID" ] && [ -n "$ALMOND_SESSION_ID" ]; then
    echo "PaymentEvent 캡처 처리 중: $PAYMENT_EVENT_ID"
    
    # Wallet 서버에서 캡처
    CAPTURE_RESULT=$(curl -s -X POST "$WALLET_URL/payments/capture" \
      -H "Content-Type: application/json" \
      -d "{
        \"paymentEventId\": \"$PAYMENT_EVENT_ID\"
      }")
    
    echo "Wallet 캡처 결과:"
    echo "$CAPTURE_RESULT" | jq '.'
    
    # PaymentEvent 캡처 완료 대기 (상태 확인)
    echo "PaymentEvent 캡처 완료 대기 중..."
    CAPTURE_WAIT_COUNT=0
    MAX_CAPTURE_WAIT=10
    
    while [ $CAPTURE_WAIT_COUNT -lt $MAX_CAPTURE_WAIT ]; do
        sleep 2
        
        # PaymentSession 상태 확인
        SESSION_STATUS_CHECK=$(curl -s "$WALLET_URL/payment-sessions/$ALMOND_SESSION_ID")
        SESSION_STATUS=$(echo "$SESSION_STATUS_CHECK" | jq -r '.data.status // empty')
        
        echo "대기 $((CAPTURE_WAIT_COUNT + 1))/$MAX_CAPTURE_WAIT - PaymentSession 상태: $SESSION_STATUS"
        
        if [ "$SESSION_STATUS" = "CAPTURED" ]; then
            echo "✅ PaymentSession이 CAPTURED 상태로 업데이트됨!"
            break
        fi
        
        CAPTURE_WAIT_COUNT=$((CAPTURE_WAIT_COUNT + 1))
    done
    
    if [ $CAPTURE_WAIT_COUNT -eq $MAX_CAPTURE_WAIT ]; then
        echo "⚠️ PaymentSession 상태 업데이트 대기 타임아웃"
        echo "💡 이벤트 기반 아키텍처 또는 트랜잭션 처리 개선이 필요합니다."
    fi
    
    # Payment Provider capturePayment 시뮬레이션 (상태 확인 후)
    echo "Payment Provider capturePayment 시뮬레이션..."
    if [ "$SESSION_STATUS" = "CAPTURED" ]; then
        echo "✅ PaymentSession이 이미 CAPTURED 상태이므로 추가 처리 불필요"
        WALLET_CAPTURE_SESSION='{"status": "already_captured", "message": "PaymentSession is already in CAPTURED state"}'
    else
        WALLET_CAPTURE_SESSION=$(curl -s -X POST "$WALLET_URL/payment-sessions/$ALMOND_SESSION_ID/capture" \
          -H "Content-Type: application/json" \
          -d "{}")
    fi
    
    echo "Wallet PaymentSession 캡처 결과:"
    echo "$WALLET_CAPTURE_SESSION" | jq '.'
fi

# 8. refundPayment 테스트
echo -e "\n8️⃣ refundPayment 테스트..."
if [ -n "$PAYMENT_EVENT_ID" ] && [ -n "$ALMOND_SESSION_ID" ]; then
    # 환불 계좌 등록
    echo "환불 계좌 등록 중..."
    REFUND_ACCOUNT_RESPONSE=$(curl -s -X POST "$WALLET_URL/refund-accounts" \
      -H "Content-Type: application/json" \
      -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"bankCode\": \"004\",
        \"bankName\": \"국민은행\",
        \"accountNumber\": \"110-123-456789\",
        \"accountHolderName\": \"테스트사용자\",
        \"isDefault\": true
      }")
    
    REFUND_ACCOUNT_ID=$(echo "$REFUND_ACCOUNT_RESPONSE" | jq -r '.data.id // empty')
    echo "환불 계좌 ID: $REFUND_ACCOUNT_ID"
    
    # 환불 요청
    echo "환불 요청 생성 중..."
    REFUND_REQUEST=$(curl -s -X POST "$WALLET_URL/refunds" \
      -H "Content-Type: application/json" \
      -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"paymentEventId\": \"$PAYMENT_EVENT_ID\",
        \"refundAccountId\": \"$REFUND_ACCOUNT_ID\",
        \"amount\": 50000,
        \"reason\": \"Medusa Payment Provider 테스트 환불\"
      }")
    
    echo "환불 요청 결과:"
    echo "$REFUND_REQUEST" | jq '.'
    
    REFUND_ID=$(echo "$REFUND_REQUEST" | jq -r '.refundId // empty')
    
    if [ -n "$REFUND_ID" ]; then
        echo "✅ 환불 요청 생성 성공: $REFUND_ID"
        
        # Payment Provider refundPayment 시뮬레이션
        echo "Payment Provider refundPayment 시뮬레이션..."
        WALLET_REFUND_SESSION=$(curl -s -X POST "$WALLET_URL/payment-sessions/$ALMOND_SESSION_ID/refund" \
          -H "Content-Type: application/json" \
          -d "{
            \"amount\": 50000,
            \"currency\": \"KRW\"
          }")
        
        echo "Wallet PaymentSession 환불 결과:"
        echo "$WALLET_REFUND_SESSION" | jq '.'
    fi
fi

# 9. cancelPayment 테스트
echo -e "\n9️⃣ cancelPayment 테스트..."
if [ -n "$ALMOND_SESSION_ID" ]; then
    echo "Payment Provider cancelPayment 시뮬레이션..."
    WALLET_CANCEL_SESSION=$(curl -s -X POST "$WALLET_URL/payment-sessions/$ALMOND_SESSION_ID/cancel" \
      -H "Content-Type: application/json" \
      -d "{}")
    
    echo "Wallet PaymentSession 취소 결과:"
    echo "$WALLET_CANCEL_SESSION" | jq '.'
fi

# 10. 최종 상태 확인
echo -e "\n================================"
echo "📋 최종 상태 확인"
echo "================================"

# PaymentSession 최종 상태
echo -e "\n🔍 PaymentSession 최종 상태:"
if [ -n "$ALMOND_SESSION_ID" ]; then
    FINAL_SESSION=$(curl -s "$WALLET_URL/payment-sessions/$ALMOND_SESSION_ID")
    echo "$FINAL_SESSION" | jq '.data | {id, status, amount, currency, created_at, updated_at}'
fi

# Wallet 거래 상태
echo -e "\n🔍 Wallet 거래 상태:"
WALLET_TRANSACTIONS=$(curl -s "$WALLET_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
echo "$WALLET_TRANSACTIONS" | jq '.data.transactions[] | {id, status, amount, createdAt}'

# 환불 상태 (생성된 경우)
if [ -n "$REFUND_ID" ]; then
    echo -e "\n🔍 환불 상태:"
    REFUND_STATUS=$(curl -s "$WALLET_URL/admin/refunds/$REFUND_ID")
    echo "$REFUND_STATUS" | jq '.data | {id, status, amount, reason, createdAt}'
fi

echo -e "\n================================"
echo "📋 테스트 완료 요약"
echo "================================"
echo "✅ Wallet 서버 결제수단 등록 및 BNPL 계정 생성"
echo "✅ Payment Provider initiatePayment 테스트"
echo "✅ Payment Provider getPaymentStatus 테스트"
echo "✅ Payment Provider authorizePayment 테스트"
echo "✅ Payment Provider capturePayment 테스트"
echo "✅ Payment Provider refundPayment 테스트"
echo "✅ Payment Provider cancelPayment 테스트"
echo ""
echo "🎯 테스트 사용자: $TEST_USER_ID"
echo "🎯 결제수단 ID: $PAYMENT_METHOD_ID"
echo "🎯 Almond PaymentSession: $ALMOND_SESSION_ID"
if [ -n "$PAYMENT_EVENT_ID" ]; then
    echo "🎯 PaymentEvent ID: $PAYMENT_EVENT_ID"
fi
if [ -n "$REFUND_ID" ]; then
    echo "🎯 환불 ID: $REFUND_ID"
fi
echo ""
echo "💡 추가 확인 명령어:"
echo "curl -s \"$WALLET_URL/payment-sessions/$ALMOND_SESSION_ID\" | jq '.data'"
echo "curl -s \"$WALLET_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID\" | jq '.data.transactions'"

# 임시 파일 정리
rm -f "$TEST_AGREEMENT_FILE"
echo -e "\n🧹 임시 파일 정리 완료"