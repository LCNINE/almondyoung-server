#!/bin/bash

# 포인트 통합 결제 API 수동 테스트 스크립트
# 사용법: ./test-point-payment.sh

BASE_URL="http://localhost:3000/v2/payments"
CUSTOMER_ID="1"

echo "🧪 포인트 통합 결제 테스트 시작"
echo "=================================="

# 색상 정의
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Intent 생성
echo -e "\n${YELLOW}1. Intent 생성 (30,000원)${NC}"
INTENT_RESPONSE=$(curl -s -X POST "${BASE_URL}/intents" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"${CUSTOMER_ID}\",
    \"amount\": 30000,
    \"type\": \"ORDER\"
  }")

INTENT_ID=$(echo $INTENT_RESPONSE | jq -r '.id')
echo "Intent ID: $INTENT_ID"
echo $INTENT_RESPONSE | jq '.'

if [ "$INTENT_ID" == "null" ]; then
  echo -e "${RED}❌ Intent 생성 실패${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Intent 생성 성공${NC}"

# 2. 포인트 + 카드 혼합 결제 (10,000 포인트 + 20,000 카드)
echo -e "\n${YELLOW}2. 포인트 + 카드 혼합 결제 (10,000 포인트 사용)${NC}"
AUTHORIZE_RESPONSE=$(curl -s -X POST "${BASE_URL}/intents/${INTENT_ID}/authorize" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "TOSS",
    "paymentKey": "test_payment_key_' $(date +%s) '",
    "usePoints": 10000
  }')

echo $AUTHORIZE_RESPONSE | jq '.'

SUCCESS=$(echo $AUTHORIZE_RESPONSE | jq -r '.success')
if [ "$SUCCESS" == "true" ]; then
  echo -e "${GREEN}✅ 결제 승인 성공${NC}"
  
  FINAL_AMOUNT=$(echo $AUTHORIZE_RESPONSE | jq -r '.breakdown.finalAmount')
  POINTS_USED=$(echo $AUTHORIZE_RESPONSE | jq -r '.breakdown.pointsUsed')
  
  echo "  - 최종 결제 금액: ${FINAL_AMOUNT}원"
  echo "  - 사용 포인트: ${POINTS_USED}원"
else
  echo -e "${RED}❌ 결제 승인 실패${NC}"
  echo "오류 메시지: $(echo $AUTHORIZE_RESPONSE | jq -r '.message')"
fi

# 3. Intent 상태 조회
echo -e "\n${YELLOW}3. Intent 상태 조회${NC}"
INTENT_STATUS=$(curl -s -X GET "${BASE_URL}/intents/${INTENT_ID}")
echo $INTENT_STATUS | jq '.'

STATUS=$(echo $INTENT_STATUS | jq -r '.status')
echo "현재 상태: $STATUS"

# 4. 부분 환불 테스트 (15,000원)
echo -e "\n${YELLOW}4. 부분 환불 테스트 (15,000원)${NC}"
read -p "부분 환불을 진행하시겠습니까? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  REFUND_RESPONSE=$(curl -s -X POST "${BASE_URL}/${INTENT_ID}/refund" \
    -H "Content-Type: application/json" \
    -d '{
      "amount": 15000,
      "reason": "PARTIAL_CANCEL"
    }')
  
  echo $REFUND_RESPONSE | jq '.'
  
  REFUND_SUCCESS=$(echo $REFUND_RESPONSE | jq -r '.success')
  if [ "$REFUND_SUCCESS" == "true" ]; then
    echo -e "${GREEN}✅ 환불 성공${NC}"
    
    REFUND_POINTS=$(echo $REFUND_RESPONSE | jq -r '.refunded.points')
    REFUND_CASH=$(echo $REFUND_RESPONSE | jq -r '.refunded.cash')
    REFUND_TOTAL=$(echo $REFUND_RESPONSE | jq -r '.refunded.total')
    
    echo "  - 환불 포인트: ${REFUND_POINTS}원"
    echo "  - 환불 현금: ${REFUND_CASH}원"
    echo "  - 총 환불액: ${REFUND_TOTAL}원"
  else
    echo -e "${RED}❌ 환불 실패${NC}"
  fi
fi

# 5. 포인트 전액 결제 테스트
echo -e "\n${YELLOW}5. 포인트 전액 결제 테스트 (10,000원)${NC}"
read -p "포인트 전액 결제를 테스트하시겠습니까? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  # 새 Intent 생성
  POINT_INTENT_RESPONSE=$(curl -s -X POST "${BASE_URL}/intents" \
    -H "Content-Type: application/json" \
    -d "{
      \"customerId\": \"${CUSTOMER_ID}\",
      \"amount\": 10000,
      \"type\": \"ORDER\"
    }")
  
  POINT_INTENT_ID=$(echo $POINT_INTENT_RESPONSE | jq -r '.id')
  echo "새 Intent ID: $POINT_INTENT_ID"
  
  # 포인트 전액 결제 (provider는 TOSS지만 usePoints가 전액이면 자동으로 포인트 전액 결제)
  POINT_AUTHORIZE_RESPONSE=$(curl -s -X POST "${BASE_URL}/intents/${POINT_INTENT_ID}/authorize" \
    -H "Content-Type: application/json" \
    -d "{
      \"provider\": \"TOSS\",
      \"paymentKey\": \"points_only_$(date +%s)\",
      \"usePoints\": 10000
    }")
  
  echo $POINT_AUTHORIZE_RESPONSE | jq '.'
  
  POINT_SUCCESS=$(echo $POINT_AUTHORIZE_RESPONSE | jq -r '.success')
  if [ "$POINT_SUCCESS" == "true" ]; then
    echo -e "${GREEN}✅ 포인트 전액 결제 성공${NC}"
    
    POINT_STATUS=$(echo $POINT_AUTHORIZE_RESPONSE | jq -r '.status')
    echo "  - 결제 상태: ${POINT_STATUS} (CAPTURED 여야 함)"
  else
    echo -e "${RED}❌ 포인트 전액 결제 실패${NC}"
  fi
fi

echo -e "\n${GREEN}=================================="
echo "🧪 테스트 완료${NC}"

