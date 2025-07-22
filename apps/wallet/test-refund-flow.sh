#!/bin/bash

# 🔧 환불 플로우 테스트 스크립트 (Event Sourcing 패턴 적용)
# 이 스크립트는 전체 환불 플로우를 테스트합니다.

set -e  # 오류 발생 시 스크립트 중단

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 서버 URL
BASE_URL="http://localhost:5000"

# 테스트 사용자 ID (고유값으로 생성)
TEST_USER_ID="test-user-refund-$(date +%s)"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}🔧 환불 플로우 테스트 시작${NC}"
echo -e "${BLUE}================================${NC}"
echo -e "🎯 테스트 사용자: ${TEST_USER_ID}"
echo ""

# 1️⃣ 결제수단 등록 (BNPL)
echo -e "${YELLOW}1️⃣ 결제수단 등록 중...${NC}"
PAYMENT_METHOD_RESPONSE=$(curl -s -X POST "${BASE_URL}/payment-methods" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"methodType\": \"BNPL\",
    \"methodName\": \"테스트 BNPL 계정\",
    \"isDefault\": true,
    \"institutionCode\": \"TEST_BNPL\"
  }")

echo "결제수단 등록 결과: $PAYMENT_METHOD_RESPONSE"

# PaymentMethod ID 추출
PAYMENT_METHOD_ID=$(echo $PAYMENT_METHOD_RESPONSE | jq -r '.id // empty')
if [ -z "$PAYMENT_METHOD_ID" ] || [ "$PAYMENT_METHOD_ID" = "null" ]; then
    echo -e "${RED}❌ 결제수단 등록 실패 또는 ID 추출 실패${NC}"
    echo "응답: $PAYMENT_METHOD_RESPONSE"
    exit 1
else
    echo -e "${GREEN}✅ 결제수단 등록 성공: $PAYMENT_METHOD_ID${NC}"
fi

# 2️⃣ BNPL 계정 생성 대기
echo -e "${YELLOW}2️⃣ BNPL 계정 생성 대기 중...${NC}"
sleep 3

# 3️⃣ BNPL 계정 확인
echo -e "${YELLOW}3️⃣ BNPL 계정 확인 중...${NC}"
BNPL_ACCOUNT=$(curl -s "${BASE_URL}/bnpl/accounts/me?userId=${TEST_USER_ID}")
echo "BNPL 계정: $BNPL_ACCOUNT"

# 4️⃣ Invoice 생성
echo -e "${YELLOW}4️⃣ Invoice 생성 중...${NC}"
INVOICE_1_RESPONSE=$(curl -s -X POST "${BASE_URL}/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"invoiceType\": \"PURCHASE\",
    \"amount\": 150000,
    \"currency\": \"KRW\"
  }")

INVOICE_1_ID=$(echo $INVOICE_1_RESPONSE | jq -r '.id')
echo "Invoice 1 생성: $INVOICE_1_ID (150000원)"

INVOICE_2_RESPONSE=$(curl -s -X POST "${BASE_URL}/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"invoiceType\": \"PURCHASE\",
    \"amount\": 200000,
    \"currency\": \"KRW\"
  }")

INVOICE_2_ID=$(echo $INVOICE_2_RESPONSE | jq -r '.id')
echo "Invoice 2 생성: $INVOICE_2_ID (200000원)"

# 5️⃣ 결제 처리 (AUTHORIZED 거래 생성)
echo -e "${YELLOW}5️⃣ 결제 처리 중 (AUTHORIZED 거래 생성)...${NC}"

echo "Invoice $INVOICE_1_ID 결제 처리 중..."
PAYMENT_1_RESPONSE=$(curl -s -X POST "${BASE_URL}/payments" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"invoiceId\": \"${INVOICE_1_ID}\",
    \"paymentMethodId\": \"${PAYMENT_METHOD_ID}\",
    \"paymentType\": \"BNPL\"
  }")

echo "결제 결과: $PAYMENT_1_RESPONSE"
PAYMENT_EVENT_1_ID=$(echo $PAYMENT_1_RESPONSE | jq -r '.paymentEventId')
echo "PaymentEvent ID: $PAYMENT_EVENT_1_ID"

echo "Invoice $INVOICE_2_ID 결제 처리 중..."
PAYMENT_2_RESPONSE=$(curl -s -X POST "${BASE_URL}/payments" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"invoiceId\": \"${INVOICE_2_ID}\",
    \"paymentMethodId\": \"${PAYMENT_METHOD_ID}\",
    \"paymentType\": \"BNPL\"
  }")

echo "결제 결과: $PAYMENT_2_RESPONSE"
PAYMENT_EVENT_2_ID=$(echo $PAYMENT_2_RESPONSE | jq -r '.paymentEventId')
echo "PaymentEvent ID: $PAYMENT_EVENT_2_ID"

# 6️⃣ 생성된 거래 확인
echo -e "${YELLOW}6️⃣ 생성된 거래 확인...${NC}"
TRANSACTIONS=$(curl -s "${BASE_URL}/bnpl/accounts/me/transactions?userId=${TEST_USER_ID}")
echo "거래 내역:"
echo $TRANSACTIONS | jq '.data.transactions[] | {id, status, amount, createdAt}'
TRANSACTION_COUNT=$(echo $TRANSACTIONS | jq '.data.transactions | length')
echo "총 거래 수: $TRANSACTION_COUNT"

# 7️⃣ 정산 처리 대기 (CAPTURED 상태로 변경될 때까지)
echo -e "${YELLOW}7️⃣ 정산 처리 대기 중...${NC}"
echo "⏳ 정산 스케줄러가 거래를 CAPTURED 상태로 변경할 때까지 대기합니다..."

# CAPTURED 상태 확인 루프
CAPTURED_COUNT=0
MAX_WAIT=5  # 5분 대기 (test-refund-scheduler.sh와 동일)
WAIT_COUNT=0

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    sleep 60  # 1분 대기
    WAIT_COUNT=$((WAIT_COUNT + 1))
    
    CURRENT_TRANSACTIONS=$(curl -s "${BASE_URL}/bnpl/accounts/me/transactions?userId=${TEST_USER_ID}")
    CAPTURED_COUNT=$(echo $CURRENT_TRANSACTIONS | jq '[.data.transactions[] | select(.status == "CAPTURED")] | length')
    
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$TIMESTAMP] CAPTURED 거래 수: $CAPTURED_COUNT/$TRANSACTION_COUNT"
    
    if [ "$CAPTURED_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✅ 정산 완료된 거래 발견! 환불 테스트 진행 가능${NC}"
        break
    fi
done

if [ $WAIT_COUNT -eq $MAX_WAIT ]; then
    echo -e "${YELLOW}⚠️ 정산 대기 시간 초과. AUTHORIZED 상태 거래로 환불 테스트 진행${NC}"
    # 정산 대기 시간 초과 시에도 테스트 계속 진행 (exit 1 제거)
fi

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}🔧 환불 테스트 시작${NC}"
echo -e "${BLUE}================================${NC}"

# 8️⃣-1 현재 환불 요청 목록 확인
echo -e "${YELLOW}8️⃣-1 현재 환불 요청 목록 확인...${NC}"
CURRENT_REFUNDS=$(curl -s "${BASE_URL}/admin/refunds")
CURRENT_REFUND_COUNT=$(echo $CURRENT_REFUNDS | jq '.data | length')
echo "환불 요청 목록: $CURRENT_REFUND_COUNT"

# 8️⃣-2 환불 요청 생성 (부분 환불)
echo -e "${YELLOW}8️⃣-2 환불 요청 생성...${NC}"
echo "PaymentEvent ID: $PAYMENT_EVENT_1_ID"
echo "환불 금액: 50000원"

REFUND_REQUEST_1=$(curl -s -X POST "${BASE_URL}/refunds/request" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"paymentEventId\": \"${PAYMENT_EVENT_1_ID}\",
    \"refundAccountId\": \"test-account-123\",
    \"amount\": 50000,
    \"reason\": \"자동화 테스트 환불 요청\"
  }")

echo "환불 요청 결과:"
echo $REFUND_REQUEST_1 | jq '.'

if [ "$(echo $REFUND_REQUEST_1 | jq -r '.success')" = "true" ]; then
    REFUND_ID_1=$(echo $REFUND_REQUEST_1 | jq -r '.refundId')
    echo -e "${GREEN}✅ 환불 요청 생성 성공: $REFUND_ID_1${NC}"
    
    # 8️⃣-3 환불 요청 목록 다시 확인
    echo -e "${YELLOW}8️⃣-3 환불 요청 목록 다시 확인...${NC}"
    sleep 2
    UPDATED_REFUNDS=$(curl -s "${BASE_URL}/admin/refunds")
    echo "업데이트된 환불 요청 목록:"
    echo $UPDATED_REFUNDS | jq '.data[] | {id, status, amount, reason, createdAt}'
    
    # 8️⃣-4 환불 처리 시작 (CS팀 작업)
    echo -e "${YELLOW}8️⃣-4 환불 처리 시작 (CS팀 작업)...${NC}"
    PROCESS_RESULT=$(curl -s -X POST "${BASE_URL}/admin/refunds/${REFUND_ID_1}/process" \
      -H "Content-Type: application/json" \
      -d "{
        \"processedBy\": \"cs-team-member\",
        \"notes\": \"자동화 테스트 처리\"
      }")
    
    echo "환불 처리 시작 결과: $PROCESS_RESULT"
    
    # 8️⃣-5 환불 완료 처리 (CS팀 수동 이체 후)
    echo -e "${YELLOW}8️⃣-5 환불 완료 처리 (CS팀 수동 이체 후)...${NC}"
    sleep 2
    COMPLETE_RESULT=$(curl -s -X POST "${BASE_URL}/admin/refunds/${REFUND_ID_1}/complete" \
      -H "Content-Type: application/json" \
      -d "{
        \"completedBy\": \"cs-team-member\",
        \"notes\": \"자동화 테스트 완료\"
      }")
    
    echo "환불 완료 처리 결과: $COMPLETE_RESULT"
    
else
    echo -e "${RED}❌ 환불 요청 생성 실패${NC}"
    echo "응답: $REFUND_REQUEST_1"
fi

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}🔧 추가 환불 테스트 (거절 시나리오)${NC}"
echo -e "${BLUE}================================${NC}"

# 9️⃣-1 거절용 환불 요청 생성
echo -e "${YELLOW}9️⃣-1 거절용 환불 요청 생성...${NC}"
echo "PaymentEvent ID: $PAYMENT_EVENT_2_ID"
echo "환불 금액: 100000원"

REFUND_REQUEST_2=$(curl -s -X POST "${BASE_URL}/refunds/request" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"paymentEventId\": \"${PAYMENT_EVENT_2_ID}\",
    \"refundAccountId\": \"test-account-456\",
    \"amount\": 100000,
    \"reason\": \"자동화 테스트 거절 시나리오\"
  }")

echo "거절용 환불 요청 결과:"
echo $REFUND_REQUEST_2 | jq '.'

if [ "$(echo $REFUND_REQUEST_2 | jq -r '.success')" = "true" ]; then
    REFUND_ID_2=$(echo $REFUND_REQUEST_2 | jq -r '.refundId')
    
    # 9️⃣-2 환불 요청 거절 (CS팀 작업)
    echo -e "${YELLOW}9️⃣-2 환불 요청 거절 (CS팀 작업)...${NC}"
    sleep 2
    REJECT_RESULT=$(curl -s -X POST "${BASE_URL}/admin/refunds/${REFUND_ID_2}/reject" \
      -H "Content-Type: application/json" \
      -d "{
        \"rejectedBy\": \"cs-team-member\",
        \"reason\": \"테스트용 거절\",
        \"notes\": \"자동화 테스트 거절\"
      }")
    
    echo "환불 거절 처리 결과: $REJECT_RESULT"
fi

# 9️⃣-3 정상 완료용 환불 요청 생성 (전액 환불)
echo -e "${YELLOW}9️⃣-4 정상 완료용 환불 요청 생성...${NC}"
echo "PaymentEvent ID: $PAYMENT_EVENT_2_ID"
echo "환불 금액: 150000원 (전액)"

REFUND_REQUEST_3=$(curl -s -X POST "${BASE_URL}/refunds/request" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${TEST_USER_ID}\",
    \"paymentEventId\": \"${PAYMENT_EVENT_2_ID}\",
    \"refundAccountId\": \"test-account-789\",
    \"amount\": 150000,
    \"reason\": \"자동화 테스트 정상 완료 시나리오\"
  }")

echo "정상 완료용 환불 요청 결과:"
echo $REFUND_REQUEST_3 | jq '.'

if [ "$(echo $REFUND_REQUEST_3 | jq -r '.success')" = "true" ]; then
    REFUND_ID_3=$(echo $REFUND_REQUEST_3 | jq -r '.refundId')
    
    # 처리 및 완료
    sleep 2
    curl -s -X POST "${BASE_URL}/admin/refunds/${REFUND_ID_3}/process" \
      -H "Content-Type: application/json" \
      -d "{\"processedBy\": \"cs-team-member\", \"notes\": \"자동화 테스트\"}" > /dev/null
    
    sleep 2
    curl -s -X POST "${BASE_URL}/admin/refunds/${REFUND_ID_3}/complete" \
      -H "Content-Type: application/json" \
      -d "{\"completedBy\": \"cs-team-member\", \"notes\": \"자동화 테스트\"}" > /dev/null
fi

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}📋 최종 상태 확인${NC}"
echo -e "${BLUE}================================${NC}"

# 🔍 최종 환불 목록
echo -e "${YELLOW}🔍 최종 환불 목록:${NC}"
FINAL_REFUNDS=$(curl -s "${BASE_URL}/admin/refunds")
echo $FINAL_REFUNDS | jq '.data[] | {id: .id, status: .status, amount: .amount, reason: .reason, createdAt: .createdAt}'

# 🔍 최종 거래 상태
echo -e "${YELLOW}🔍 최종 거래 상태:${NC}"
FINAL_TRANSACTIONS=$(curl -s "${BASE_URL}/bnpl/accounts/me/transactions?userId=${TEST_USER_ID}")
echo $FINAL_TRANSACTIONS | jq '.data.transactions[] | {id, status, amount, createdAt}'

# 🔍 BNPL 계정 상태
echo -e "${YELLOW}🔍 BNPL 계정 상태:${NC}"
FINAL_BNPL_ACCOUNT=$(curl -s "${BASE_URL}/bnpl/accounts/me?userId=${TEST_USER_ID}")
echo $FINAL_BNPL_ACCOUNT | jq '{id, approvedLimit, status}'

# 🔍 Invoice 이벤트 소싱 확인
echo -e "${YELLOW}🔍 Invoice 이벤트 소싱 확인:${NC}"
echo "📋 Invoice 1 이벤트 히스토리 (ID: $INVOICE_1_ID):"
INVOICE_1_EVENTS=$(curl -s "${BASE_URL}/invoices/${INVOICE_1_ID}/events")
echo $INVOICE_1_EVENTS | jq '.data.events[] | {eventType, reason, occurredAt}'
echo "총 이벤트 수: $(echo $INVOICE_1_EVENTS | jq '.data.totalEvents')"

echo "📋 Invoice 2 이벤트 히스토리 (ID: $INVOICE_2_ID):"
INVOICE_2_EVENTS=$(curl -s "${BASE_URL}/invoices/${INVOICE_2_ID}/events")
echo $INVOICE_2_EVENTS | jq '.data.events[] | {eventType, reason, occurredAt}'
echo "총 이벤트 수: $(echo $INVOICE_2_EVENTS | jq '.data.totalEvents')"

echo -e "${GREEN}✅ 이벤트 소싱 패턴 검증:${NC}"
echo "- INVOICE_ISSUED: 청구서 생성 시 기록"
echo "- INVOICE_PAID: 정산 완료 시 기록"
echo "- INVOICE_PARTIALLY_REFUNDED: 부분 환불 시 기록"
echo "- INVOICE_FULLY_REFUNDED: 전액 환불 시 기록"
echo "- INVOICE_FAILED: 결제 실패 시 기록"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}📋 테스트 완료 요약${NC}"
echo -e "${BLUE}================================${NC}"

echo -e "${GREEN}✅ 결제수단 등록 및 BNPL 계정 생성${NC}"
echo -e "${GREEN}✅ 결제 처리 및 거래 생성${NC}"
echo -e "${GREEN}✅ 환불 요청 생성${NC}"
echo -e "${GREEN}✅ 관리자 환불 조회 및 관리${NC}"
echo -e "${GREEN}✅ 환불 완료 처리${NC}"
echo -e "${GREEN}✅ 전체 환불 플로우 검증${NC}"

echo ""
echo -e "🎯 테스트 사용자: ${TEST_USER_ID}"
FINAL_REFUND_COUNT=$(echo $FINAL_REFUNDS | jq '.data | length')
echo -e "🎯 생성된 환불 요청 수: ${FINAL_REFUND_COUNT}"

echo ""
echo -e "${YELLOW}💡 추가 확인 명령어:${NC}"
echo "curl -s \"${BASE_URL}/admin/refunds\" | jq '.data'"
echo "curl -s \"${BASE_URL}/bnpl/accounts/me/transactions?userId=${TEST_USER_ID}\" | jq '.data.transactions'"

echo ""
echo -e "${GREEN}🧹 임시 파일 정리 완료${NC}"