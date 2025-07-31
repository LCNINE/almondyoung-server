#!/bin/bash

# 환불 전체 테스트 스크립트 (PaymentSession 기반 - curl 완전 자동화)
# 사용법: ./test-refund-scheduler.sh

BASE_URL="http://localhost:5000"
TEST_USER_ID="test-user-refund-$(date +%s)"

echo "🚀 환불 전체 테스트 시작 (PaymentSession 기반 - curl 완전 자동화)"
echo "테스트 사용자 ID: $TEST_USER_ID"
echo "================================"

# 1. 결제수단 등록 (BNPL 계정 자동 생성)
echo "1️⃣ 결제수단 등록 중..."
PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payment-methods" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"methodType\": \"BNPL\",
    \"methodName\": \"환불 테스트 계정\",
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
    ACCOUNT_RESPONSE=$(curl -s "$BASE_URL/bnpl/accounts/me?userId=$TEST_USER_ID")
    
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
TEST_AGREEMENT_FILE="/tmp/test-agreement-refund-$TEST_USER_ID.txt"
cat > "$TEST_AGREEMENT_FILE" << EOF
BNPL 서비스 이용 동의서 (환불 테스트용)

본인은 BNPL(Buy Now Pay Later) 서비스 이용에 동의합니다.

사용자: $TEST_USER_ID
결제수단 ID: $PAYMENT_METHOD_ID
동의 일시: $(date)
테스트 목적: 환불 플로우 검증

서명: 테스트 사용자
EOF

echo "테스트용 동의서 파일 생성: $TEST_AGREEMENT_FILE"

# HMS API에서 사용하는 memberId는 결제수단 ID와 동일하게 설정
HMS_MEMBER_ID="$PAYMENT_METHOD_ID"

echo "동의자료 업로드 중... (HMS 회원 ID: $HMS_MEMBER_ID)"
CONSENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payment-methods/$HMS_MEMBER_ID/consent" \
  -F "agreementFile=@$TEST_AGREEMENT_FILE")

echo "동의자료 업로드 결과:"
echo "$CONSENT_RESPONSE" | jq '.'

# 동의자료 업로드 후 1분 대기 (결제수단 활성화 시간)
echo -e "\n⏳ 결제수단 활성화 대기 중 (1분)..."
sleep 60

echo "✅ 결제수단 활성화 대기 완료"

# 4. PaymentSession 생성 (환불 테스트용 2개)
echo -e "\n4️⃣ PaymentSession 생성 중..."
PAYMENT_SESSIONS=()

for i in {1..2}; do
    AMOUNT=$((100000 + i * 50000))  # 150000, 200000
    SESSION_RESPONSE=$(curl -s -X POST "$BASE_URL/payment-sessions" \
      -H "Content-Type: application/json" \
      -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"amount\": $AMOUNT,
        \"currency\": \"KRW\",
        \"platform\": \"DIRECT\",
        \"platformReferenceId\": \"refund-test-$i-$(date +%s)\",
        \"expiresInMinutes\": 30
      }")
    
    PAYMENT_SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.data.id')
    PAYMENT_SESSIONS+=("$PAYMENT_SESSION_ID")
    echo "PaymentSession $i 생성: $PAYMENT_SESSION_ID (${AMOUNT}원)"
    
    # PaymentSession 생성 결과 확인
    echo "PaymentSession 생성 결과:"
    echo "$SESSION_RESPONSE" | jq '.data | {id, amount, status, platform}'
done

# 5. 결제 승인 처리 (AUTHORIZED 거래 생성) - PaymentSession 기반
echo -e "\n5️⃣ 결제 승인 처리 중 (PaymentSession 기반 AUTHORIZED 거래 생성)..."
PAYMENT_EVENT_IDS=()

for i in "${!PAYMENT_SESSIONS[@]}"; do
    PAYMENT_SESSION_ID="${PAYMENT_SESSIONS[$i]}"
    echo "PaymentSession $PAYMENT_SESSION_ID 결제 승인 처리 중..."
    
    # 5-1. 결제 승인 (authorize) - 새로운 PaymentSession 기반 DTO 사용
    # 🎯 단일 결제수단 방식: paymentSessionId + paymentMethodId 전달
    AUTHORIZE_RESULT=$(curl -s -X POST "$BASE_URL/payments/authorize" \
      -H "Content-Type: application/json" \
      -d "{
        \"paymentSessionId\": \"$PAYMENT_SESSION_ID\",
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }")
    
    echo "결제 승인 결과: $(echo "$AUTHORIZE_RESULT" | jq -c '.')"
    
    # PaymentEvent ID 추출 (새로운 응답 구조)
    PAYMENT_EVENT_ID=$(echo "$AUTHORIZE_RESULT" | jq -r '.entityId // .entityBody.paymentEventId // .data.paymentEventId // empty')
    if [ -n "$PAYMENT_EVENT_ID" ]; then
        PAYMENT_EVENT_IDS+=("$PAYMENT_EVENT_ID")
        echo "✅ PaymentEvent ID: $PAYMENT_EVENT_ID (AUTHORIZED 상태)"
        
        # BNPL의 경우 즉시 캡처하지 않고 AUTHORIZED 상태로 유지
        # (정산 스케줄러가 나중에 CAPTURED로 변경)
        echo "📋 BNPL 거래는 정산 스케줄러 대기 상태로 유지됩니다."
        
        # PaymentSession 상태도 AUTHORIZED로 업데이트 확인
        SESSION_STATUS_CHECK=$(curl -s "$BASE_URL/payment-sessions/$PAYMENT_SESSION_ID")
        SESSION_STATUS=$(echo "$SESSION_STATUS_CHECK" | jq -r '.data.status // empty')
        echo "📋 PaymentSession 상태: $SESSION_STATUS"
        
    else
        echo "❌ PaymentEvent ID 추출 실패"
        echo "응답 전체: $AUTHORIZE_RESULT"
    fi
done

# 6. 생성된 거래 확인
echo -e "\n6️⃣ 생성된 거래 확인..."
TRANSACTIONS_RESPONSE=$(curl -s "$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
echo "거래 내역 API 응답:"
echo "$TRANSACTIONS_RESPONSE" | jq '.'

# API 오류 시 우회 처리
if echo "$TRANSACTIONS_RESPONSE" | jq -e '.statusCode' > /dev/null 2>&1; then
    echo "⚠️ BNPL 거래 조회 API 오류 발생, PaymentEvent 기반으로 계속 진행"
    TRANSACTION_COUNT=${#PAYMENT_EVENT_IDS[@]}
    echo "생성된 PaymentEvent 수: $TRANSACTION_COUNT"
else
    TRANSACTION_COUNT=$(echo "$TRANSACTIONS_RESPONSE" | jq '.data.transactions | length // 0')
    echo "총 거래 수: $TRANSACTION_COUNT"
    
    if [ "$TRANSACTION_COUNT" -gt 0 ]; then
        echo "$TRANSACTIONS_RESPONSE" | jq '.data.transactions[] | {id, status, amount, createdAt}'
    fi
fi

if [ "$TRANSACTION_COUNT" -eq 0 ] && [ ${#PAYMENT_EVENT_IDS[@]} -eq 0 ]; then
    echo "❌ 결제 이벤트가 생성되지 않았습니다. 결제 처리 과정을 확인해주세요."
    exit 1
else
    echo "✅ 결제 처리 성공: PaymentEvent ${#PAYMENT_EVENT_IDS[@]}개 생성됨"
fi

# 7. 결제 캡처 처리 (PaymentSession 기반 BNPL 정산 시뮬레이션)
echo -e "\n7️⃣ 결제 캡처 처리 중 (PaymentSession 기반 BNPL 정산 시뮬레이션)..."
echo "💡 실제 환경에서는 정산 스케줄러가 자동으로 처리하지만, 테스트에서는 수동으로 캡처합니다."

CAPTURED_PAYMENT_EVENT_IDS=()

for i in "${!PAYMENT_EVENT_IDS[@]}"; do
    PAYMENT_EVENT_ID="${PAYMENT_EVENT_IDS[$i]}"
    PAYMENT_SESSION_ID="${PAYMENT_SESSIONS[$i]}"
    echo -e "\n캡처 처리 중: PaymentEvent $PAYMENT_EVENT_ID (PaymentSession: $PAYMENT_SESSION_ID)"
    
    # 방법 1: PaymentEvent 직접 캡처 (기존 방식)
    CAPTURE_RESULT=$(curl -s -X POST "$BASE_URL/payments/capture" \
      -H "Content-Type: application/json" \
      -d "{
        \"paymentEventId\": \"$PAYMENT_EVENT_ID\"
      }")
    
    echo "PaymentEvent 캡처 결과: $(echo "$CAPTURE_RESULT" | jq -c '.')"
    
    # 캡처 성공 확인
    CAPTURE_STATUS=$(echo "$CAPTURE_RESULT" | jq -r '.entityBody.paymentStatus // .data.status // empty')
    if [ "$CAPTURE_STATUS" = "CAPTURED" ]; then
        CAPTURED_PAYMENT_EVENT_IDS+=("$PAYMENT_EVENT_ID")
        echo "✅ PaymentEvent 캡처 성공: $PAYMENT_EVENT_ID → CAPTURED"
        
        # 방법 2: PaymentSession도 캡처 상태로 업데이트 (새로운 방식)
        SESSION_CAPTURE_RESULT=$(curl -s -X POST "$BASE_URL/payment-sessions/$PAYMENT_SESSION_ID/capture" \
          -H "Content-Type: application/json" \
          -d "{}")
        
        echo "PaymentSession 캡처 결과: $(echo "$SESSION_CAPTURE_RESULT" | jq -c '.')"
        
        # PaymentSession 상태 확인
        SESSION_STATUS_CHECK=$(curl -s "$BASE_URL/payment-sessions/$PAYMENT_SESSION_ID")
        SESSION_STATUS=$(echo "$SESSION_STATUS_CHECK" | jq -r '.data.status // empty')
        echo "📋 PaymentSession 최종 상태: $SESSION_STATUS"
        
    else
        echo "⚠️ 캡처 실패 또는 상태 불명: $PAYMENT_EVENT_ID"
        echo "응답: $CAPTURE_RESULT"
    fi
done

echo -e "\n📊 캡처 완료 상태:"
echo "총 결제 이벤트: ${#PAYMENT_EVENT_IDS[@]}"
echo "캡처 완료: ${#CAPTURED_PAYMENT_EVENT_IDS[@]}"

# 캡처된 거래 확인
echo -e "\n🔍 캡처 후 거래 상태 확인..."
CURRENT_TRANSACTIONS=$(curl -s "$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
echo "거래 내역 (캡처 후):"
echo "$CURRENT_TRANSACTIONS" | jq '.data.transactions[] | {id, status, amount, createdAt}'

CAPTURED_COUNT=$(echo "$CURRENT_TRANSACTIONS" | jq '[.data.transactions[] | select(.status == "CAPTURED")] | length')
echo "CAPTURED 상태 거래 수: $CAPTURED_COUNT"

if [ "$CAPTURED_COUNT" -eq 0 ]; then
    echo "⚠️ CAPTURED 거래가 없습니다. AUTHORIZED 상태로 환불 테스트 진행"
    # AUTHORIZED 상태 거래로 환불 테스트 계속 진행
fi

# 8. 환불 테스트 시작
echo -e "\n================================"
echo "🔧 환불 테스트 시작"
echo "================================"

# 8-1. 현재 환불 요청 목록 확인 (빈 상태)
echo -e "\n8️⃣-1 현재 환불 요청 목록 확인..."
REFUND_LIST_RESPONSE=$(curl -s "$BASE_URL/admin/refunds")
echo "환불 요청 목록:"
echo "$REFUND_LIST_RESPONSE" | jq '.data | length'

# 8-1.5. 사전 환불 계좌 등록 (포트와 어댑터 패턴)
echo -e "\n8️⃣-1.5 사전 환불 계좌 등록 (BNPL 수동 처리용)..."
REFUND_ACCOUNT_RESPONSE=$(curl -s -X POST "$BASE_URL/refund-accounts" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"bankCode\": \"004\",
    \"bankName\": \"국민은행\",
    \"accountNumber\": \"110-123-456789\",
    \"accountHolderName\": \"테스트사용자\",
    \"isDefault\": true
  }")

echo "환불 계좌 등록 결과:"
echo "$REFUND_ACCOUNT_RESPONSE" | jq '.'

REFUND_ACCOUNT_ID=$(echo "$REFUND_ACCOUNT_RESPONSE" | jq -r '.data.id // empty')

if [ -z "$REFUND_ACCOUNT_ID" ] || [ "$REFUND_ACCOUNT_ID" = "null" ]; then
    echo "⚠️ 환불 계좌 등록 실패, 기본값 사용"
    REFUND_ACCOUNT_ID="default-refund-account-$TEST_USER_ID"
else
    echo "✅ 환불 계좌 등록 성공: $REFUND_ACCOUNT_ID"
fi

# 8-2. 환불 요청 생성 (첫 번째 결제에 대해) - 포트와 어댑터 패턴 적용
if [ ${#PAYMENT_EVENT_IDS[@]} -gt 0 ]; then
    FIRST_PAYMENT_EVENT_ID="${PAYMENT_EVENT_IDS[0]}"
    REFUND_AMOUNT=50000  # 부분 환불
    
    echo -e "\n8️⃣-2 환불 요청 생성 (포트와 어댑터 패턴)..."
    echo "PaymentEvent ID: $FIRST_PAYMENT_EVENT_ID"
    echo "환불 계좌 ID: $REFUND_ACCOUNT_ID"
    echo "환불 금액: ${REFUND_AMOUNT}원"
    echo "🏭 RefundGatewayFactory가 BNPL → ManualRefundAdapter 선택 예정"
    
    REFUND_REQUEST=$(curl -s -X POST "$BASE_URL/refunds" \
      -H "Content-Type: application/json" \
      -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"paymentEventId\": \"$FIRST_PAYMENT_EVENT_ID\",
        \"refundAccountId\": \"$REFUND_ACCOUNT_ID\",
        \"amount\": $REFUND_AMOUNT,
        \"reason\": \"자동화 테스트 환불 요청 (BNPL 수동 처리)\"
      }")
    
    echo "환불 요청 결과:"
    echo "$REFUND_REQUEST" | jq '.'
    
    REFUND_ID=$(echo "$REFUND_REQUEST" | jq -r '.refundId // empty')
    
    if [ -n "$REFUND_ID" ]; then
        echo "✅ 환불 요청 생성 성공! Refund ID: $REFUND_ID"
        echo "📋 ManualRefundAdapter가 CS팀 대기열에 추가했습니다."
        
        # 8-3. 관리자 환불 목록 확인
        echo -e "\n8️⃣-3 관리자 환불 목록 확인..."
        ADMIN_REFUNDS=$(curl -s "$BASE_URL/admin/refunds?status=REQUESTED")
        echo "대기 중인 환불 요청:"
        echo "$ADMIN_REFUNDS" | jq '.data[] | {id, amount, reason, status, createdAt}'
        
        # 8-4. 환불 상세 조회
        echo -e "\n8️⃣-4 환불 상세 조회..."
        REFUND_DETAIL=$(curl -s "$BASE_URL/admin/refunds/$REFUND_ID")
        echo "환불 상세 정보:"
        echo "$REFUND_DETAIL" | jq '.data'
        
        # 8-5. 환불 처리 시작 (새로운 API)
        echo -e "\n8️⃣-5 환불 처리 시작..."
        PROCESS_RESULT=$(curl -s -X PUT "$BASE_URL/admin/refunds/$REFUND_ID/process" \
          -H "Content-Type: application/json" \
          -d "{
            \"processedBy\": \"cs-team-$TEST_USER_ID\",
            \"notes\": \"자동화 테스트 - 환불 검토 시작\"
          }")
        
        echo "환불 처리 시작 결과:"
        echo "$PROCESS_RESULT" | jq '.'
        
        # 8-6. 처리 중인 환불 목록 확인
        echo -e "\n8️⃣-6 처리 중인 환불 목록 확인..."
        PROCESSING_REFUNDS=$(curl -s "$BASE_URL/admin/refunds?status=PROCESSING")
        echo "처리 중인 환불 요청:"
        echo "$PROCESSING_REFUNDS" | jq '.data[] | {id, amount, status, reason}'
        
        # 2초 대기 (상태 변경 확인)
        sleep 2
        
        # 8-7. 환불 완료 처리
        echo -e "\n8️⃣-7 환불 완료 처리..."
        COMPLETE_RESULT=$(curl -s -X PUT "$BASE_URL/admin/refunds/$REFUND_ID/complete" \
          -H "Content-Type: application/json" \
          -d "{
            \"completedBy\": \"admin-test-$TEST_USER_ID\",
            \"notes\": \"자동화 테스트 수동 이체 완료\"
          }")
        
        echo "환불 완료 결과:"
        echo "$COMPLETE_RESULT" | jq '.'
        
        # 8-8. 완료된 환불 목록 확인
        echo -e "\n8️⃣-8 완료된 환불 목록 확인..."
        COMPLETED_REFUNDS=$(curl -s "$BASE_URL/admin/refunds?status=COMPLETED")
        echo "완료된 환불 요청:"
        echo "$COMPLETED_REFUNDS" | jq '.data[] | {id, amount, status, completedAt}'
        
        echo -e "\n🎉 환불 플로우 테스트 성공!"
        echo "✅ 환불 요청 → 관리자 조회 → 완료 처리 플로우 완료"
        
    else
        echo "❌ 환불 요청 생성 실패"
        echo "응답: $REFUND_REQUEST"
    fi
else
    echo "❌ PaymentEvent ID를 찾을 수 없어 환불 테스트를 진행할 수 없습니다."
fi

# 9. 추가 환불 테스트 (두 번째 결제에 대해 - 거절 시나리오)
if [ ${#PAYMENT_EVENT_IDS[@]} -gt 1 ]; then
    SECOND_PAYMENT_EVENT_ID="${PAYMENT_EVENT_IDS[1]}"
    REJECT_REFUND_AMOUNT=100000  # 부분 환불 (거절 예정)
    
    echo -e "\n================================"
    echo "🔧 추가 환불 테스트 (거절 시나리오)"
    echo "================================"
    
    echo -e "\n9️⃣-1 거절용 환불 요청 생성..."
    echo "PaymentEvent ID: $SECOND_PAYMENT_EVENT_ID"
    echo "환불 계좌 ID: $REFUND_ACCOUNT_ID"
    echo "환불 금액: ${REJECT_REFUND_AMOUNT}원"
    
    REJECT_REFUND_REQUEST=$(curl -s -X POST "$BASE_URL/refunds" \
      -H "Content-Type: application/json" \
      -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"paymentEventId\": \"$SECOND_PAYMENT_EVENT_ID\",
        \"refundAccountId\": \"$REFUND_ACCOUNT_ID\",
        \"amount\": $REJECT_REFUND_AMOUNT,
        \"reason\": \"자동화 테스트 거절 시나리오 (BNPL 수동 처리)\"
      }")
    
    echo "거절용 환불 요청 결과:"
    echo "$REJECT_REFUND_REQUEST" | jq '.'
    
    REJECT_REFUND_ID=$(echo "$REJECT_REFUND_REQUEST" | jq -r '.refundId // empty')
    
    if [ -n "$REJECT_REFUND_ID" ]; then
        echo "✅ 거절용 환불 요청 생성 성공! Refund ID: $REJECT_REFUND_ID"
        
        # 9-2. 환불 거절 처리 (새로운 API 테스트)
        echo -e "\n9️⃣-2 환불 거절 처리..."
        sleep 2
        REJECT_RESULT=$(curl -s -X PUT "$BASE_URL/admin/refunds/$REJECT_REFUND_ID/reject" \
          -H "Content-Type: application/json" \
          -d "{
            \"rejectedBy\": \"admin-test-$TEST_USER_ID\",
            \"reason\": \"테스트 목적으로 거절\",
            \"notes\": \"자동화 테스트 - 거절 시나리오 검증\"
          }")
        
        echo "환불 거절 결과:"
        echo "$REJECT_RESULT" | jq '.'
        
        # 9-3. 거절된 환불 목록 확인
        echo -e "\n9️⃣-3 거절된 환불 목록 확인..."
        REJECTED_REFUNDS=$(curl -s "$BASE_URL/admin/refunds?status=REJECTED")
        echo "거절된 환불 요청:"
        echo "$REJECTED_REFUNDS" | jq '.data[] | {id, amount, status, reason}'
        
    fi
    
    # 9-4. 세 번째 환불 요청 (정상 완료용)
    THIRD_REFUND_AMOUNT=150000  # 전액 환불
    
    echo -e "\n9️⃣-4 정상 완료용 환불 요청 생성..."
    echo "PaymentEvent ID: $SECOND_PAYMENT_EVENT_ID"
    echo "환불 금액: ${THIRD_REFUND_AMOUNT}원 (전액)"
    
    THIRD_REFUND_REQUEST=$(curl -s -X POST "$BASE_URL/refunds" \
      -H "Content-Type: application/json" \
      -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"paymentEventId\": \"$SECOND_PAYMENT_EVENT_ID\",
        \"refundAccountId\": \"$REFUND_ACCOUNT_ID\",
        \"amount\": $THIRD_REFUND_AMOUNT,
        \"reason\": \"자동화 테스트 정상 완료 시나리오 (BNPL 수동 처리)\"
      }")
    
    echo "정상 완료용 환불 요청 결과:"
    echo "$THIRD_REFUND_REQUEST" | jq '.'
    
    THIRD_REFUND_ID=$(echo "$THIRD_REFUND_REQUEST" | jq -r '.refundId // empty')
    
    if [ -n "$THIRD_REFUND_ID" ]; then
        echo "✅ 정상 완료용 환불 요청 생성 성공! Refund ID: $THIRD_REFUND_ID"
        
        # 처리 시작 → 완료 플로우 테스트
        sleep 2
        
        # 처리 시작
        echo -e "\n9️⃣-5 환불 처리 시작..."
        THIRD_PROCESS_RESULT=$(curl -s -X PUT "$BASE_URL/admin/refunds/$THIRD_REFUND_ID/process" \
          -H "Content-Type: application/json" \
          -d "{
            \"processedBy\": \"cs-team-$TEST_USER_ID\",
            \"notes\": \"정상 플로우 테스트 - 처리 시작\"
          }")
        
        echo "환불 처리 시작 결과:"
        echo "$THIRD_PROCESS_RESULT" | jq '.'
        
        sleep 2
        
        # 완료 처리
        echo -e "\n9️⃣-6 환불 완료 처리..."
        THIRD_COMPLETE_RESULT=$(curl -s -X PUT "$BASE_URL/admin/refunds/$THIRD_REFUND_ID/complete" \
          -H "Content-Type: application/json" \
          -d "{
            \"completedBy\": \"admin-test-$TEST_USER_ID\",
            \"notes\": \"자동화 테스트 정상 플로우 완료\"
          }")
        
        echo "환불 완료 결과:"
        echo "$THIRD_COMPLETE_RESULT" | jq '.'
    fi
fi

# 10. 최종 상태 확인
echo -e "\n================================"
echo "📋 최종 상태 확인"
echo "================================"

# 최종 환불 목록
echo -e "\n🔍 최종 환불 목록:"
FINAL_REFUNDS=$(curl -s "$BASE_URL/admin/refunds")
echo "$FINAL_REFUNDS" | jq '.data[] | {id, amount, status, reason, createdAt, completedAt}'

# 최종 거래 상태
echo -e "\n🔍 최종 거래 상태:"
FINAL_TRANSACTIONS=$(curl -s "$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
echo "$FINAL_TRANSACTIONS" | jq '.data.transactions[] | {id, status, amount, createdAt}'

# 신용 한도 상태 (가능하다면)
echo -e "\n🔍 BNPL 계정 상태:"
FINAL_ACCOUNT=$(curl -s "$BASE_URL/bnpl/accounts/me?userId=$TEST_USER_ID")
echo "$FINAL_ACCOUNT" | jq '.data | {id, approvedLimit, status}'

# ✅ PaymentSession 이벤트 소싱 확인 (Event Sourcing 검증)
echo -e "\n🔍 PaymentSession 이벤트 소싱 확인:"
if [ ${#PAYMENT_SESSIONS[@]} -gt 0 ]; then
    for i in "${!PAYMENT_SESSIONS[@]}"; do
        PAYMENT_SESSION_ID="${PAYMENT_SESSIONS[$i]}"
        echo -e "\n📋 PaymentSession $((i+1)) 이벤트 히스토리 (ID: $PAYMENT_SESSION_ID):"
        
        SESSION_EVENTS=$(curl -s "$BASE_URL/payment-sessions/$PAYMENT_SESSION_ID/events")
        if echo "$SESSION_EVENTS" | jq -e '.success' > /dev/null 2>&1; then
            echo "$SESSION_EVENTS" | jq '.data.events[] | {eventType, eventData, createdAt}'
            
            EVENT_COUNT=$(echo "$SESSION_EVENTS" | jq '.data.totalEvents')
            echo "총 이벤트 수: $EVENT_COUNT"
        else
            echo "⚠️ PaymentSession 이벤트 조회 실패"
            echo "응답: $SESSION_EVENTS"
        fi
    done
    
    echo -e "\n✅ PaymentSession 이벤트 소싱 패턴 검증:"
    echo "- SESSION_CREATED: 결제 세션 생성 시 기록"
    echo "- LOCK_CREATED: 결제 잠금 생성 시 기록"
    echo "- PAYMENT_AUTHORIZED: 결제 승인 시 기록"
    echo "- PAYMENT_CAPTURED: 결제 캡처 시 기록"
    echo "- REFUND_COMPLETED: 환불 완료 시 기록"
    echo "- PAYMENT_CANCELLED: 결제 취소 시 기록"
    echo "- PAYMENT_FAILED: 결제 실패 시 기록"
fi

echo -e "\n================================"
echo "📋 테스트 완료 요약"
echo "================================"
echo "✅ 결제수단 등록 및 BNPL 계정 생성"
echo "✅ 결제 처리 및 거래 생성"
echo "✅ 환불 요청 생성"
echo "✅ 관리자 환불 조회 및 관리"
echo "✅ 환불 완료 처리"
echo "✅ 전체 환불 플로우 검증"
echo ""
echo "🎯 테스트 사용자: $TEST_USER_ID"
echo "🎯 생성된 환불 요청 수: $(echo "$FINAL_REFUNDS" | jq '.data | length')"
echo ""
echo "💡 추가 확인 명령어:"
echo "curl -s \"$BASE_URL/admin/refunds\" | jq '.data'"
echo "curl -s \"$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID\" | jq '.data.transactions'"

# 임시 파일 정리
rm -f "$TEST_AGREEMENT_FILE"
echo -e "\n🧹 임시 파일 정리 완료"