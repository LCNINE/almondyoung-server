#!/bin/bash

# 정산 스케줄러 전체 테스트 스크립트 (curl 완전 자동화)
# 사용법: ./test-settlement-full.sh

BASE_URL="http://localhost:5000"
TEST_USER_ID="test-user-settlement-$(date +%s)"

echo "🚀 정산 스케줄러 전체 테스트 시작 (curl 완전 자동화)"
echo "테스트 사용자 ID: $TEST_USER_ID"
echo "================================"

# 1. 결제수단 등록 (BNPL 계정 자동 생성)
echo "1️⃣ 결제수단 등록 중..."
PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payment-methods" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"methodType\": \"BNPL\",
    \"methodName\": \"정산 테스트 계정\",
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
TEST_AGREEMENT_FILE="/tmp/test-agreement-$TEST_USER_ID.txt"
cat > "$TEST_AGREEMENT_FILE" << EOF
BNPL 서비스 이용 동의서

본인은 BNPL(Buy Now Pay Later) 서비스 이용에 동의합니다.

사용자: $TEST_USER_ID
결제수단 ID: $PAYMENT_METHOD_ID
동의 일시: $(date)

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

# 4. Invoice 생성 (3개)
echo -e "\n4️⃣ Invoice 생성 중..."
INVOICES=()

for i in {1..3}; do
    AMOUNT=$((50000 + i * 25000))  # 75000, 100000, 125000
    INVOICE_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices" \
      -H "Content-Type: application/json" \
      -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"invoiceType\": \"PURCHASE\",
        \"amount\": $AMOUNT,
        \"currency\": \"KRW\"
      }")
    
    INVOICE_ID=$(echo "$INVOICE_RESPONSE" | jq -r '.id')
    INVOICES+=("$INVOICE_ID")
    echo "Invoice $i 생성: $INVOICE_ID (${AMOUNT}원)"
done

# 5. 결제 처리 (AUTHORIZED 거래 생성)
echo -e "\n5️⃣ 결제 처리 중 (AUTHORIZED 거래 생성)..."

for i in "${!INVOICES[@]}"; do
    INVOICE_ID="${INVOICES[$i]}"
    echo "Invoice $INVOICE_ID 결제 처리 중..."
    
    PAYMENT_RESULT=$(curl -s -X POST "$BASE_URL/payments" \
      -H "Content-Type: application/json" \
      -d "{
        \"invoiceId\": \"$INVOICE_ID\",
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\",
        \"userId\": \"$TEST_USER_ID\"
      }")
    
    echo "결제 결과: $(echo "$PAYMENT_RESULT" | jq -c '.')"
done

# 6. 생성된 거래 확인
echo -e "\n6️⃣ 생성된 거래 확인..."
TRANSACTIONS_RESPONSE=$(curl -s "$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
echo "거래 내역:"
echo "$TRANSACTIONS_RESPONSE" | jq '.data.transactions[] | {id, status, amount, createdAt}'

TRANSACTION_COUNT=$(echo "$TRANSACTIONS_RESPONSE" | jq '.data.transactions | length')
echo "총 거래 수: $TRANSACTION_COUNT"

if [ "$TRANSACTION_COUNT" -eq 0 ]; then
    echo "⚠️ AUTHORIZED 거래가 생성되지 않았습니다. 결제 처리 과정을 확인해주세요."
    exit 1
fi

# 7. 정산 스케줄러 모니터링 시작
echo -e "\n7️⃣ 정산 스케줄러 모니터링 시작..."
echo "================================"
echo "🔍 1분마다 정산 배치 생성을 확인합니다..."
echo "🔍 1분 30초마다 정산 결과를 확인합니다..."
echo ""

MONITOR_COUNT=0
MAX_MONITOR=5  # 5분간 모니터링

while [ $MONITOR_COUNT -lt $MAX_MONITOR ]; do
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 거래 상태 확인
    CURRENT_TRANSACTIONS=$(curl -s "$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
    AUTHORIZED_COUNT=$(echo "$CURRENT_TRANSACTIONS" | jq '[.data.transactions[] | select(.status == "AUTHORIZED")] | length')
    SETTLEMENT_REQUESTED_COUNT=$(echo "$CURRENT_TRANSACTIONS" | jq '[.data.transactions[] | select(.status == "SETTLEMENT_REQUESTED")] | length')
    CAPTURED_COUNT=$(echo "$CURRENT_TRANSACTIONS" | jq '[.data.transactions[] | select(.status == "CAPTURED")] | length')
    
    # 정산 배치 상태 확인
    SETTLEMENTS_RESPONSE=$(curl -s "$BASE_URL/bnpl/accounts/me/settlements?userId=$TEST_USER_ID")
    SETTLEMENT_COUNT=$(echo "$SETTLEMENTS_RESPONSE" | jq '.data.settlements | length')
    
    echo "[$TIMESTAMP] 거래 상태 - AUTHORIZED: $AUTHORIZED_COUNT, SETTLEMENT_REQUESTED: $SETTLEMENT_REQUESTED_COUNT, CAPTURED: $CAPTURED_COUNT"
    echo "[$TIMESTAMP] 정산 배치: $SETTLEMENT_COUNT개"
    
    if [ "$SETTLEMENT_COUNT" -gt 0 ]; then
        LATEST_SETTLEMENT=$(echo "$SETTLEMENTS_RESPONSE" | jq -r '.data.settlements[0] | "\(.status) - \(.totalAmount)원 (\(.batchNumber))"')
        echo "  └─ 최신 정산: $LATEST_SETTLEMENT"
    fi
    
    # 성공 조건 확인
    if [ "$CAPTURED_COUNT" -gt 0 ] && [ "$SETTLEMENT_COUNT" -gt 0 ]; then
        echo ""
        echo "🎉 정산 스케줄러 테스트 성공!"
        echo "✅ AUTHORIZED → SETTLEMENT_REQUESTED → CAPTURED 플로우 완료"
        echo "✅ 정산 배치 생성 및 처리 완료"
        break
    fi
    
    MONITOR_COUNT=$((MONITOR_COUNT + 1))
    echo ""
    sleep 60  # 1분 대기
done

if [ $MONITOR_COUNT -eq $MAX_MONITOR ]; then
    echo "⚠️ 모니터링 시간 초과. 수동으로 확인해주세요."
fi

echo -e "\n================================"
echo "📋 최종 상태 확인 명령어:"
echo "================================"
echo "# 거래 내역 확인"
echo "curl -s \"$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID\" | jq '.'"
echo ""
echo "# 정산 배치 확인"
echo "curl -s \"$BASE_URL/bnpl/accounts/me/settlements?userId=$TEST_USER_ID\" | jq '.'"
echo ""
echo "# 서버 로그 확인"
echo "docker logs -f <container-name> | grep -E \"정산|Settlement|$TEST_USER_ID\""