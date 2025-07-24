#!/bin/bash

# 포인트 + BNPL 혼합 결제 테스트 스크립트
# 사용법: ./test-mixed-payment.sh

BASE_URL="http://localhost:5000"
TEST_USER_ID="test-user-mixed-$(date +%s)"

echo "🚀 포인트 + BNPL 혼합 결제 테스트 시작"
echo "테스트 사용자 ID: $TEST_USER_ID"
echo "================================"

# 1. 테스트 데이터 사전 준비 (Arrange)
echo "1️⃣ 테스트 데이터 사전 준비 중..."

# 1-1. BNPL 결제수단 등록 (BNPL 계정 자동 생성)
echo "1️⃣-1 BNPL 결제수단 등록 중..."
PAYMENT_METHOD_RESPONSE=$(curl -s -X POST "$BASE_URL/payment-methods" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"methodType\": \"BNPL\",
    \"methodName\": \"혼합결제 테스트 계정\",
    \"institutionCode\": \"ALMOND001\",
    \"isDefault\": true
  }")

echo "BNPL 결제수단 등록 결과:"
echo "$PAYMENT_METHOD_RESPONSE" | jq '.'

PAYMENT_METHOD_ID=$(echo "$PAYMENT_METHOD_RESPONSE" | jq -r '.id')
echo "✅ BNPL 결제수단 ID: $PAYMENT_METHOD_ID"

# 1-2. BNPL 계정 생성 확인 (재시도 로직)
echo -e "\n1️⃣-2 BNPL 계정 생성 확인 중..."
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

# 1-3. 동의자료 업로드 (결제수단 활성화)
echo -e "\n1️⃣-3 동의자료 업로드 중..."

# 테스트용 동의서 파일 생성
TEST_AGREEMENT_FILE="/tmp/test-agreement-mixed-$TEST_USER_ID.txt"
cat > "$TEST_AGREEMENT_FILE" << EOF
BNPL 서비스 이용 동의서 (혼합결제 테스트용)

본인은 BNPL(Buy Now Pay Later) 서비스 이용에 동의합니다.

사용자: $TEST_USER_ID
결제수단 ID: $PAYMENT_METHOD_ID
동의 일시: $(date)
테스트 목적: 포인트 + BNPL 혼합결제 검증

서명: 테스트 사용자
EOF

HMS_MEMBER_ID="$PAYMENT_METHOD_ID"

echo "동의자료 업로드 중... (HMS 회원 ID: $HMS_MEMBER_ID)"
CONSENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payment-methods/$HMS_MEMBER_ID/consent" \
  -F "agreementFile=@$TEST_AGREEMENT_FILE")

echo "동의자료 업로드 결과:"
echo "$CONSENT_RESPONSE" | jq '.'

# 결제수단 활성화 대기
echo -e "\n⏳ 결제수단 활성화 대기 중 (30초)..."
sleep 30
echo "✅ 결제수단 활성화 대기 완료"

# 1-4. 포인트 계정 생성 및 충전 (2,000 포인트)
echo -e "\n1️⃣-4 포인트 계정 생성 및 충전 중..."
POINT_CHARGE_AMOUNT=2000

POINT_CHARGE_RESPONSE=$(curl -s -X POST "$BASE_URL/points/charge" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"amount\": $POINT_CHARGE_AMOUNT,
    \"reason\": \"혼합결제 테스트용 포인트 충전\"
  }")

echo "포인트 충전 결과:"
echo "$POINT_CHARGE_RESPONSE" | jq '.'

# 포인트 잔액 확인
POINT_BALANCE_RESPONSE=$(curl -s "$BASE_URL/points/balance?userId=$TEST_USER_ID")
CURRENT_POINT_BALANCE=$(echo "$POINT_BALANCE_RESPONSE" | jq -r '.data.balance')
echo "✅ 현재 포인트 잔액: $CURRENT_POINT_BALANCE 포인트"

if [ "$CURRENT_POINT_BALANCE" != "$POINT_CHARGE_AMOUNT" ]; then
    echo "⚠️ 포인트 충전이 정상적으로 완료되지 않았습니다."
    echo "예상: $POINT_CHARGE_AMOUNT, 실제: $CURRENT_POINT_BALANCE"
fi

# 1-5. 테스트용 Invoice 생성 (10,000원)
echo -e "\n1️⃣-5 테스트용 Invoice 생성 중..."
INVOICE_AMOUNT=10000

INVOICE_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"invoiceType\": \"PURCHASE\",
    \"amount\": $INVOICE_AMOUNT,
    \"currency\": \"KRW\"
  }")

echo "Invoice 생성 응답:"
echo "$INVOICE_RESPONSE" | jq '.'

INVOICE_ID=$(echo "$INVOICE_RESPONSE" | jq -r '.id')
echo "✅ Invoice 생성 완료: $INVOICE_ID (${INVOICE_AMOUNT}원)"

# Invoice ID 검증
if [ "$INVOICE_ID" = "null" ] || [ -z "$INVOICE_ID" ]; then
    echo "❌ Invoice 생성 실패: ID가 null이거나 비어있습니다."
    echo "응답 내용: $INVOICE_RESPONSE"
    exit 1
fi

# 2. 혼합 결제 실행 (Act)
echo -e "\n================================"
echo "2️⃣ 혼합 결제 실행 (포인트 2,000 + BNPL 8,000)"
echo "================================"

POINT_USE_AMOUNT=2000
BNPL_AMOUNT=$((INVOICE_AMOUNT - POINT_USE_AMOUNT))

echo "💳 결제 상세:"
echo "- 총 결제 금액: ${INVOICE_AMOUNT}원"
echo "- 포인트 사용: ${POINT_USE_AMOUNT} 포인트"
echo "- BNPL 결제: ${BNPL_AMOUNT}원"

# 혼합 결제 API 호출 (새로운 통합 API 형식)
MIXED_PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -d "{
    \"invoiceId\": \"$INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"REWARD_POINT\",
        \"amount\": $POINT_USE_AMOUNT
      },
      {
        \"methodType\": \"BNPL\",
        \"amount\": $BNPL_AMOUNT,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

echo -e "\n혼합 결제 실행 결과:"
echo "$MIXED_PAYMENT_RESPONSE" | jq '.'

PAYMENT_SUCCESS=$(echo "$MIXED_PAYMENT_RESPONSE" | jq -r '.success')
PAYMENT_EVENT_ID=$(echo "$MIXED_PAYMENT_RESPONSE" | jq -r '.paymentEventId // empty')

if [ "$PAYMENT_SUCCESS" = "true" ] && [ -n "$PAYMENT_EVENT_ID" ]; then
    echo "✅ 혼합 결제 성공! PaymentEvent ID: $PAYMENT_EVENT_ID"
else
    echo "❌ 혼합 결제 실패"
    echo "응답: $MIXED_PAYMENT_RESPONSE"
    exit 1
fi

# 3. 결과 검증 (Assert)
echo -e "\n================================"
echo "3️⃣ 결과 검증 (Assert)"
echo "================================"

# 3-1. 포인트 잔액 검증 (0이 되어야 함)
echo -e "\n3️⃣-1 포인트 잔액 검증..."
FINAL_POINT_BALANCE_RESPONSE=$(curl -s "$BASE_URL/points/balance?userId=$TEST_USER_ID")
FINAL_POINT_BALANCE=$(echo "$FINAL_POINT_BALANCE_RESPONSE" | jq -r '.data.balance')

echo "포인트 잔액 변화:"
echo "- 이전: $CURRENT_POINT_BALANCE 포인트"
echo "- 현재: $FINAL_POINT_BALANCE 포인트"
echo "- 사용: $((CURRENT_POINT_BALANCE - FINAL_POINT_BALANCE)) 포인트"

if [ "$FINAL_POINT_BALANCE" -eq 0 ]; then
    echo "✅ 포인트 잔액 검증 성공 (0 포인트)"
else
    echo "❌ 포인트 잔액 검증 실패 (예상: 0, 실제: $FINAL_POINT_BALANCE)"
fi

# 3-2. 포인트 거래 내역 검증 (REDEEM 기록 확인)
echo -e "\n3️⃣-2 포인트 거래 내역 검증..."
POINT_HISTORY_RESPONSE=$(curl -s "$BASE_URL/points/history?userId=$TEST_USER_ID")
echo "포인트 거래 내역:"
echo "$POINT_HISTORY_RESPONSE" | jq '.data.transactions[] | {type, amount, reason, createdAt}'

REDEEM_COUNT=$(echo "$POINT_HISTORY_RESPONSE" | jq '[.data.transactions[] | select(.type == "REDEEM")] | length')
REDEEM_AMOUNT=$(echo "$POINT_HISTORY_RESPONSE" | jq '[.data.transactions[] | select(.type == "REDEEM")] | .[0].amount // 0')

if [ "$REDEEM_COUNT" -gt 0 ] && [ "$REDEEM_AMOUNT" -eq "-$POINT_USE_AMOUNT" ]; then
    echo "✅ 포인트 REDEEM 기록 검증 성공 (${REDEEM_AMOUNT} 포인트)"
else
    echo "❌ 포인트 REDEEM 기록 검증 실패"
    echo "REDEEM 기록 수: $REDEEM_COUNT, 금액: $REDEEM_AMOUNT"
fi

# 3-3. BNPL 거래 내역 검증 (AUTHORIZED 기록 확인)
echo -e "\n3️⃣-3 BNPL 거래 내역 검증..."
BNPL_TRANSACTIONS_RESPONSE=$(curl -s "$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
echo "BNPL 거래 내역:"
echo "$BNPL_TRANSACTIONS_RESPONSE" | jq '.data.transactions[] | {id, status, amount, createdAt}'

AUTHORIZED_TRANSACTIONS=$(echo "$BNPL_TRANSACTIONS_RESPONSE" | jq '[.data.transactions[] | select(.status == "AUTHORIZED")]')
AUTHORIZED_COUNT=$(echo "$AUTHORIZED_TRANSACTIONS" | jq 'length')
AUTHORIZED_AMOUNT=$(echo "$AUTHORIZED_TRANSACTIONS" | jq '.[0].amount // 0')

AUTHORIZED_AMOUNT_INT=$(echo "$AUTHORIZED_AMOUNT" | sed 's/"//g' | sed 's/\..*//')
if [ "$AUTHORIZED_COUNT" -gt 0 ] && [ "$AUTHORIZED_AMOUNT_INT" = "$BNPL_AMOUNT" ]; then
    echo "✅ BNPL AUTHORIZED 기록 검증 성공 (${AUTHORIZED_AMOUNT}원)"
else
    echo "❌ BNPL AUTHORIZED 기록 검증 실패"
    echo "AUTHORIZED 기록 수: $AUTHORIZED_COUNT, 금액: $AUTHORIZED_AMOUNT (정수부: $AUTHORIZED_AMOUNT_INT, 예상: $BNPL_AMOUNT)"
fi

# 3-4. Invoice 상태 검증 (PAID가 되어야 함)
echo -e "\n3️⃣-4 Invoice 상태 검증..."
INVOICE_STATUS_RESPONSE=$(curl -s "$BASE_URL/invoices/$INVOICE_ID")
INVOICE_STATUS=$(echo "$INVOICE_STATUS_RESPONSE" | jq -r '.status')

echo "Invoice 상태 변화:"
echo "- Invoice ID: $INVOICE_ID"
echo "- 현재 상태: $INVOICE_STATUS"

if [ "$INVOICE_STATUS" = "PAID" ]; then
    echo "✅ Invoice 상태 검증 성공 (PAID)"
else
    echo "❌ Invoice 상태 검증 실패 (예상: PAID, 실제: $INVOICE_STATUS)"
fi

# 3-5. PaymentEvent 검증
echo -e "\n3️⃣-5 PaymentEvent 검증..."
PAYMENT_EVENT_RESPONSE=$(curl -s "$BASE_URL/payments/events/$PAYMENT_EVENT_ID")
echo "PaymentEvent 상세:"
echo "$PAYMENT_EVENT_RESPONSE" | jq '.data | {id, status, amount, paymentMethodId, createdAt}'

PAYMENT_EVENT_STATUS=$(echo "$PAYMENT_EVENT_RESPONSE" | jq -r '.data.status')
PAYMENT_EVENT_AMOUNT=$(echo "$PAYMENT_EVENT_RESPONSE" | jq -r '.data.amount')

if [ "$PAYMENT_EVENT_STATUS" = "AUTHORIZED" ] && [ "$PAYMENT_EVENT_AMOUNT" = "${BNPL_AMOUNT}.0000" ]; then
    echo "✅ PaymentEvent 검증 성공 (AUTHORIZED, ${PAYMENT_EVENT_AMOUNT}원)"
else
    echo "❌ PaymentEvent 검증 실패"
    echo "상태: $PAYMENT_EVENT_STATUS, 금액: $PAYMENT_EVENT_AMOUNT"
fi

# 4. 추가 시나리오 테스트 (포인트 부족 상황)
echo -e "\n================================"
echo "4️⃣ 추가 시나리오: 포인트 부족 상황 테스트"
echo "================================"

# 4-1. 새로운 Invoice 생성 (5,000원)
echo -e "\n4️⃣-1 새로운 Invoice 생성 (5,000원)..."
SECOND_INVOICE_AMOUNT=5000

SECOND_INVOICE_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"invoiceType\": \"PURCHASE\",
    \"amount\": $SECOND_INVOICE_AMOUNT,
    \"currency\": \"KRW\"
  }")

SECOND_INVOICE_ID=$(echo "$SECOND_INVOICE_RESPONSE" | jq -r '.id')
echo "✅ 두 번째 Invoice 생성: $SECOND_INVOICE_ID (${SECOND_INVOICE_AMOUNT}원)"

# 4-2. 포인트 부족 상황에서 혼합 결제 시도 (3,000 포인트 사용 시도)
echo -e "\n4️⃣-2 포인트 부족 상황에서 혼합 결제 시도..."
INSUFFICIENT_POINT_AMOUNT=3000
INSUFFICIENT_BNPL_AMOUNT=$((SECOND_INVOICE_AMOUNT - INSUFFICIENT_POINT_AMOUNT))

echo "💳 포인트 부족 시나리오:"
echo "- 총 결제 금액: ${SECOND_INVOICE_AMOUNT}원"
echo "- 포인트 사용 시도: ${INSUFFICIENT_POINT_AMOUNT} 포인트 (현재 잔액: $FINAL_POINT_BALANCE)"
echo "- BNPL 결제 예정: ${INSUFFICIENT_BNPL_AMOUNT}원"

INSUFFICIENT_PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -d "{
    \"invoiceId\": \"$SECOND_INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"REWARD_POINT\",
        \"amount\": $INSUFFICIENT_POINT_AMOUNT
      },
      {
        \"methodType\": \"BNPL\",
        \"amount\": $INSUFFICIENT_BNPL_AMOUNT,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

echo -e "\n포인트 부족 상황 결제 결과:"
echo "$INSUFFICIENT_PAYMENT_RESPONSE" | jq '.'

INSUFFICIENT_PAYMENT_SUCCESS=$(echo "$INSUFFICIENT_PAYMENT_RESPONSE" | jq -r '.success')
INSUFFICIENT_ERROR_MESSAGE=$(echo "$INSUFFICIENT_PAYMENT_RESPONSE" | jq -r '.error // empty')

# HTTP 400 에러이고 메시지에 "포인트"가 포함되어 있으면 성공
HTTP_STATUS=$(echo "$INSUFFICIENT_PAYMENT_RESPONSE" | jq -r '.statusCode // empty')
ERROR_MESSAGE=$(echo "$INSUFFICIENT_PAYMENT_RESPONSE" | jq -r '.message // empty')

if [ "$HTTP_STATUS" = "400" ] && [[ "$ERROR_MESSAGE" == *"포인트"* ]]; then
    echo "✅ 포인트 부족 상황 처리 성공 (HTTP 400, 적절한 오류 메시지)"
else
    echo "❌ 포인트 부족 상황 처리 실패"
    echo "HTTP 상태: $HTTP_STATUS, 메시지: $ERROR_MESSAGE"
fi

# 5. 최종 상태 확인
echo -e "\n================================"
echo "📋 최종 상태 확인"
echo "================================"

# 5-1. 최종 포인트 상태
echo -e "\n🔍 최종 포인트 상태:"
FINAL_POINT_STATUS=$(curl -s "$BASE_URL/points/balance?userId=$TEST_USER_ID")
echo "$FINAL_POINT_STATUS" | jq '.data'

# 5-2. 최종 BNPL 계정 상태
echo -e "\n🔍 최종 BNPL 계정 상태:"
FINAL_BNPL_STATUS=$(curl -s "$BASE_URL/bnpl/accounts/me?userId=$TEST_USER_ID")
echo "$FINAL_BNPL_STATUS" | jq '.data | {id, approvedLimit, status}'

# 5-3. 최종 거래 내역
echo -e "\n🔍 최종 BNPL 거래 내역:"
FINAL_BNPL_TRANSACTIONS=$(curl -s "$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID")
echo "$FINAL_BNPL_TRANSACTIONS" | jq '.data.transactions[] | {id, status, amount, createdAt}'

# 5-4. Invoice 상태 확인
echo -e "\n🔍 Invoice 상태 확인:"
echo "첫 번째 Invoice ($INVOICE_ID):"
FIRST_INVOICE_FINAL=$(curl -s "$BASE_URL/invoices/$INVOICE_ID")
echo "$FIRST_INVOICE_FINAL" | jq '.data | {id, status, amount}'

echo -e "\n두 번째 Invoice ($SECOND_INVOICE_ID):"
SECOND_INVOICE_FINAL=$(curl -s "$BASE_URL/invoices/$SECOND_INVOICE_ID")
echo "$SECOND_INVOICE_FINAL" | jq '.data | {id, status, amount}'

# 6. 테스트 결과 요약
echo -e "\n================================"
echo "📋 테스트 결과 요약"
echo "================================"

TOTAL_TESTS=6
PASSED_TESTS=0

# 검증 결과 집계
if [ "$FINAL_POINT_BALANCE" -eq 0 ]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "✅ 포인트 잔액 검증 통과"
else
    echo "❌ 포인트 잔액 검증 실패"
fi

if [ "$REDEEM_COUNT" -gt 0 ] && [ "$REDEEM_AMOUNT" -eq "-$POINT_USE_AMOUNT" ]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "✅ 포인트 REDEEM 기록 검증 통과"
else
    echo "❌ 포인트 REDEEM 기록 검증 실패"
fi

if [ "$AUTHORIZED_COUNT" -gt 0 ] && [ "$AUTHORIZED_AMOUNT_INT" = "$BNPL_AMOUNT" ]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "✅ BNPL AUTHORIZED 기록 검증 통과"
else
    echo "❌ BNPL AUTHORIZED 기록 검증 실패"
fi

if [ "$INVOICE_STATUS" = "PAID" ]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "✅ Invoice 상태 검증 통과"
else
    echo "❌ Invoice 상태 검증 실패"
fi

if [ "$PAYMENT_EVENT_STATUS" = "AUTHORIZED" ] && [ "$PAYMENT_EVENT_AMOUNT" = "${BNPL_AMOUNT}.0000" ]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "✅ PaymentEvent 검증 통과"
else
    echo "❌ PaymentEvent 검증 실패"
fi

if [ "$HTTP_STATUS" = "400" ] && [[ "$ERROR_MESSAGE" == *"포인트"* ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "✅ 포인트 부족 상황 처리 통과"
else
    echo "❌ 포인트 부족 상황 처리 실패"
fi

echo -e "\n🎯 테스트 결과: $PASSED_TESTS/$TOTAL_TESTS 통과"
echo "🎯 테스트 사용자: $TEST_USER_ID"

if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
    echo -e "\n🎉 모든 테스트 통과! 혼합 결제 시스템이 정상 작동합니다."
else
    echo -e "\n⚠️ 일부 테스트 실패. 시스템 점검이 필요합니다."
fi

echo -e "\n💡 추가 확인 명령어:"
echo "curl -s \"$BASE_URL/points/balance?userId=$TEST_USER_ID\" | jq '.data'"
echo "curl -s \"$BASE_URL/bnpl/accounts/me/transactions?userId=$TEST_USER_ID\" | jq '.data.transactions'"
echo "curl -s \"$BASE_URL/points/history?userId=$TEST_USER_ID\" | jq '.data.transactions'"

# 임시 파일 정리
rm -f "$TEST_AGREEMENT_FILE"
echo -e "\n🧹 임시 파일 정리 완료"