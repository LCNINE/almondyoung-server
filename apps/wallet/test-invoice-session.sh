#!/bin/bash
# 청구서 세션 기능 E2E 테스트 스크립트

BASE_URL="http://localhost:5000"
USER_ID="test-user-$(date +%s)"
INVOICE_ID=""

echo "================================"
echo "청구서 세션 E2E 테스트 시작"
echo "================================"

# 1. 테스트용 청구서 생성
echo "1️⃣ 테스트용 청구서 생성..."
INVOICE_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceType\": \"BNPL_PAYMENT\",
    \"amount\": 10000,
    \"currency\": \"KRW\"
  }")

INVOICE_ID=$(echo $INVOICE_RESPONSE | jq -r '.id')
echo "생성된 청구서 ID: $INVOICE_ID"

if [ "$INVOICE_ID" = "null" ] || [ -z "$INVOICE_ID" ]; then
  echo "❌ 청구서 생성 실패"
  exit 1
fi

# 2. 첫 번째 세션 생성
echo "2️⃣ 첫 번째 청구서 세션 생성..."
FIRST_SESSION_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices/$INVOICE_ID/create-session" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\"
  }")

FIRST_SESSION_ID=$(echo $FIRST_SESSION_RESPONSE | jq -r '.data.invoiceSessionId')
echo "첫 번째 세션 ID: $FIRST_SESSION_ID"

if [ "$FIRST_SESSION_ID" = "null" ] || [ -z "$FIRST_SESSION_ID" ]; then
  echo "❌ 첫 번째 세션 생성 실패"
  echo "응답: $FIRST_SESSION_RESPONSE"
  exit 1
fi

# 3. 동일한 청구서에 대해 두 번째 세션 생성 시도 (409 Conflict 예상)
echo "3️⃣ 동일한 청구서에 대해 두 번째 세션 생성 시도 (409 Conflict 예상)..."
SECOND_SESSION_RESPONSE=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/invoices/$INVOICE_ID/create-session" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\"
  }")

CONCURRENCY_HTTP_CODE="${SECOND_SESSION_RESPONSE: -3}"
RESPONSE_BODY="${SECOND_SESSION_RESPONSE%???}"

if [ "$CONCURRENCY_HTTP_CODE" = "409" ]; then
  echo "✅ 동시성 제어 테스트 성공: 409 Conflict 반환"
  echo "응답 메시지: $(echo $RESPONSE_BODY | jq -r '.message')"
  CONCURRENCY_TEST_RESULT="✅"
else
  echo "❌ 동시성 제어 테스트 실패: HTTP $CONCURRENCY_HTTP_CODE"
  echo "응답: $RESPONSE_BODY"
  CONCURRENCY_TEST_RESULT="❌"
fi

# 4. 다른 사용자로 세션 생성 시도 (권한 없음, 400 Bad Request 예상)
echo "4️⃣ 다른 사용자로 세션 생성 시도 (400 Bad Request 예상)..."
OTHER_USER_RESPONSE=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/invoices/$INVOICE_ID/create-session" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"other-user-123\"
  }")

HTTP_CODE="${OTHER_USER_RESPONSE: -3}"
RESPONSE_BODY="${OTHER_USER_RESPONSE%???}"

if [ "$HTTP_CODE" = "400" ]; then
  echo "✅ 권한 검증 테스트 성공: 400 Bad Request 반환"
  echo "응답 메시지: $(echo $RESPONSE_BODY | jq -r '.message')"
else
  echo "❌ 권한 검증 테스트 실패: HTTP $HTTP_CODE"
  echo "응답: $RESPONSE_BODY"
fi

# 5. 유효한 세션으로 결제 시도 (실제 결제는 하지 않고 세션 검증만)
echo "5️⃣ 유효한 세션으로 결제 요청 테스트..."
echo "세션 ID: $FIRST_SESSION_ID"
echo "청구서 ID: $INVOICE_ID"

# 실제 결제 테스트는 PaymentController가 완전히 구현된 후에 진행
echo "💡 실제 결제 테스트는 PaymentController 업데이트 후 진행 예정"

# 6. 세션 정보 확인
echo "6️⃣ 청구서 정보 확인..."
INVOICE_INFO=$(curl -s -X GET "$BASE_URL/invoices/$INVOICE_ID")
SESSION_EXPIRES_AT=$(echo $INVOICE_INFO | jq -r '.paymentSessionExpiresAt')
echo "세션 만료 시간: $SESSION_EXPIRES_AT"

echo "================================"
echo "청구서 세션 E2E 테스트 완료"
echo "================================"
echo ""
echo "📋 테스트 결과 요약:"
echo "- 청구서 생성: ✅"
echo "- 첫 번째 세션 생성: ✅"
echo "- 동시성 제어 (409): $CONCURRENCY_TEST_RESULT"
echo "- 권한 검증 (400): $([ "$HTTP_CODE" = "400" ] && echo "✅" || echo "❌")"
echo "- 세션 ID: $FIRST_SESSION_ID"
echo "- 청구서 ID: $INVOICE_ID"