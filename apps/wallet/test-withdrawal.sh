#!/bin/bash

# HMS 출금 API 테스트 스크립트 (우리 서버를 통한 완전한 E2E 테스트)

BASE_URL="http://localhost:5000"
echo "🧪 HMS 출금 API 테스트 시작..."
echo "서버: $BASE_URL"
echo ""

# 이전 단계에서 생성된 테스트 데이터 읽기
if [ ! -f "/tmp/test-payment-methods.txt" ]; then
  echo "❌ 테스트 데이터가 없습니다. 먼저 ./test-setup.sh를 실행하세요."
  exit 1
fi

# 테스트 결과 저장
TEST_RESULTS=()

echo "📋 출금 테스트 시나리오:"
echo "  1. 생성된 PaymentMethod로 결제 요청"
echo "  2. BNPL 시스템을 통한 출금 처리"
echo "  3. 결과 검증"
echo ""

# 테스트 데이터 파일에서 한 줄씩 읽기
while IFS=':' read -r user_id payment_method_id hms_member_id user_name; do
  echo "💰 출금 테스트: $user_name (HMS ID: $hms_member_id)"
  echo "  👤 User ID: $user_id"
  echo "  🆔 PaymentMethod ID: $payment_method_id"
  
  # 현재 시간을 기반으로 고유한 값 생성
  TIMESTAMP=$(date +%s)
  INVOICE_ID="INV-TEST-$hms_member_id-$TIMESTAMP"
  TEST_AMOUNT=10000
  
  echo "  📄 Invoice ID: $INVOICE_ID"
  echo "  💵 금액: $TEST_AMOUNT원"
  
  # 결제 요청 API 호출 (올바른 경로: /payments)
  echo "  🔄 결제 요청 중..."
  
  PAYMENT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/payments" \
    -H "Content-Type: application/json" \
    -d "{
      \"invoiceId\": \"$INVOICE_ID\",
      \"paymentMethodId\": \"$payment_method_id\",
      \"amount\": $TEST_AMOUNT
    }")
  
  # HTTP 상태 코드와 응답 분리
  HTTP_CODE=$(echo "$PAYMENT_RESPONSE" | tail -n1)
  RESPONSE_BODY=$(echo "$PAYMENT_RESPONSE" | head -n -1)
  
  echo "  📊 HTTP 상태: $HTTP_CODE"
  
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  ✅ 결제 요청 성공"
    echo "  📝 응답: $RESPONSE_BODY"
    
    # jq가 있다면 paymentEventId 추출
    if command -v jq &> /dev/null; then
      PAYMENT_EVENT_ID=$(echo "$RESPONSE_BODY" | jq -r '.paymentEventId // .id // empty')
      if [ -n "$PAYMENT_EVENT_ID" ]; then
        echo "  🆔 Payment Event ID: $PAYMENT_EVENT_ID"
        
        # 결제 이벤트 상태 조회 테스트
        echo "  🔍 결제 상태 조회 중..."
        sleep 2  # 잠시 대기
        
        STATUS_RESPONSE=$(curl -s -X GET "$BASE_URL/payments/events/$PAYMENT_EVENT_ID")
        echo "  📋 상태 조회 결과: $STATUS_RESPONSE"
      fi
    fi
    
    TEST_RESULTS+=("✅ $user_name ($hms_member_id): 성공")
  else
    echo "  ❌ 결제 요청 실패"
    echo "  📝 오류 응답: $RESPONSE_BODY"
    TEST_RESULTS+=("❌ $user_name ($hms_member_id): 실패 (HTTP $HTTP_CODE)")
  fi
  
  echo ""
  echo "  ⏳ 다음 테스트까지 3초 대기..."
  sleep 3
  echo ""
done < /tmp/test-payment-methods.txt

echo "📊 테스트 결과 요약:"
echo "===================="
for result in "${TEST_RESULTS[@]}"; do
  echo "$result"
done
echo ""

echo "💡 다음 단계:"
echo "  1. 효성 CMS 관리자 페이지 접속"
echo "  2. 출금 신청 내역 확인 (HMS Member ID: lcninetest1, lcninetest2, lcninetest3)"
echo "  3. 수기 승인 처리"
echo "  4. ./test-hms-direct.sh로 HMS 상태 직접 확인"

echo ""
echo "🧹 테스트 정리:"
echo "  테스트 데이터 파일 삭제: rm /tmp/test-payment-methods.txt"