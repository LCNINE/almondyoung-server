#!/bin/bash

# 실패 시나리오 멱등성 테스트
BASE_URL="http://localhost:5000"
USER_ID="test-failure-$(date +%s)"

echo "================================"
echo "🔄 실패 시나리오 멱등성 테스트"
echo "================================"

# UUID 생성 함수
generate_uuid() {
  if command -v uuidgen &> /dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    python3 -c "import uuid; print(str(uuid.uuid4()))"
  fi
}

echo "1️⃣ 존재하지 않는 Invoice로 결제 시도 (실패 예상)"
echo "================================"

# 존재하지 않는 Invoice ID
FAKE_INVOICE_ID="01FAKE000000000000000000"
IDEMPOTENCY_KEY=$(generate_uuid)

echo "멱등키: $IDEMPOTENCY_KEY"
echo "가짜 Invoice ID: $FAKE_INVOICE_ID"

# 첫 번째 실패 요청
echo "1️⃣-1 첫 번째 실패 요청..."
FIRST_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$FAKE_INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": 10000,
        \"paymentMethodId\": \"fake-payment-method\"
      }
    ]
  }")

FIRST_HTTP_CODE=$(echo "$FIRST_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
FIRST_RESPONSE_BODY=$(echo "$FIRST_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

echo "첫 번째 요청 HTTP 코드: $FIRST_HTTP_CODE"
echo "첫 번째 요청 응답: $FIRST_RESPONSE_BODY"

# 동일한 멱등키로 두 번째 실패 요청 (멱등성 확인)
echo ""
echo "1️⃣-2 동일한 멱등키로 두 번째 실패 요청 (멱등성 확인)..."
sleep 1

SECOND_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$FAKE_INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": 10000,
        \"paymentMethodId\": \"fake-payment-method\"
      }
    ]
  }")

SECOND_HTTP_CODE=$(echo "$SECOND_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
SECOND_RESPONSE_BODY=$(echo "$SECOND_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

echo "두 번째 요청 HTTP 코드: $SECOND_HTTP_CODE"
echo "두 번째 요청 응답: $SECOND_RESPONSE_BODY"

# 응답 비교
echo ""
echo "1️⃣-3 실패 응답 멱등성 검증..."
if [ "$FIRST_HTTP_CODE" = "$SECOND_HTTP_CODE" ] && [ "$FIRST_RESPONSE_BODY" = "$SECOND_RESPONSE_BODY" ]; then
  echo "✅ 실패 응답 멱등성 테스트 성공: 동일한 실패 응답 반환"
  FAILURE_IDEMPOTENCY_PASSED=true
else
  echo "❌ 실패 응답 멱등성 테스트 실패: 응답이 다름"
  echo "첫 번째: HTTP $FIRST_HTTP_CODE - $FIRST_RESPONSE_BODY"
  echo "두 번째: HTTP $SECOND_HTTP_CODE - $SECOND_RESPONSE_BODY"
  FAILURE_IDEMPOTENCY_PASSED=false
fi

echo ""
echo "2️⃣ 잘못된 멱등키 형식으로 400 에러 테스트"
echo "================================"

BAD_KEY="@#$%^&*()_+{}|:<>?[]\\;'\",./"
echo "잘못된 멱등키: $BAD_KEY"

BAD_KEY_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $BAD_KEY" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$FAKE_INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": 10000,
        \"paymentMethodId\": \"fake-payment-method\"
      }
    ]
  }")

BAD_KEY_HTTP_CODE=$(echo "$BAD_KEY_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
BAD_KEY_RESPONSE_BODY=$(echo "$BAD_KEY_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

echo "잘못된 키 요청 HTTP 코드: $BAD_KEY_HTTP_CODE"
echo "잘못된 키 요청 응답: $BAD_KEY_RESPONSE_BODY"

if [ "$BAD_KEY_HTTP_CODE" = "400" ]; then
  echo "✅ 잘못된 멱등키 형식 테스트 성공: 400 에러 반환"
  BAD_KEY_TEST_PASSED=true
else
  echo "❌ 잘못된 멱등키 형식 테스트 실패: HTTP $BAD_KEY_HTTP_CODE (예상: 400)"
  BAD_KEY_TEST_PASSED=false
fi

echo ""
echo "================================"
echo "📋 실패 시나리오 테스트 결과"
echo "================================"

TOTAL_TESTS=0
PASSED_TESTS=0

if [ "$FAILURE_IDEMPOTENCY_PASSED" = true ]; then
  echo "✅ 실패 응답 멱등성 테스트 통과"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo "❌ 실패 응답 멱등성 테스트 실패"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

if [ "$BAD_KEY_TEST_PASSED" = true ]; then
  echo "✅ 잘못된 멱등키 형식 테스트 통과"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo "❌ 잘못된 멱등키 형식 테스트 실패"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "🎯 실패 시나리오 결과: $PASSED_TESTS/$TOTAL_TESTS 테스트 통과"

if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
  echo "🎉 모든 실패 시나리오 테스트 통과!"
  exit 0
else
  echo "⚠️ 일부 실패 시나리오 테스트 실패"
  exit 1
fi