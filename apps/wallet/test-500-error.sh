#!/bin/bash

# 500 에러 시나리오 테스트
BASE_URL="http://localhost:5000"
USER_ID="test-500-error-$(date +%s)"

echo "================================"
echo "🔄 500 에러 시나리오 테스트"
echo "================================"

# UUID 생성 함수
generate_uuid() {
  if command -v uuidgen &> /dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    python3 -c "import uuid; print(str(uuid.uuid4()))"
  fi
}

echo "1️⃣ 잘못된 JSON 형식으로 500 에러 유발 시도"
echo "================================"

IDEMPOTENCY_KEY=$(generate_uuid)
echo "멱등키: $IDEMPOTENCY_KEY"

# 잘못된 JSON으로 500 에러 유발 시도
echo "1️⃣-1 첫 번째 잘못된 JSON 요청..."
FIRST_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"userId": "test", "invoiceId": "invalid", "payments": [{"methodType": "INVALID_TYPE", "amount": "not_a_number", "paymentMethodId": null}]}')

FIRST_HTTP_CODE=$(echo "$FIRST_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
FIRST_RESPONSE_BODY=$(echo "$FIRST_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

echo "첫 번째 요청 HTTP 코드: $FIRST_HTTP_CODE"
echo "첫 번째 요청 응답: $FIRST_RESPONSE_BODY"

# 동일한 멱등키로 두 번째 요청
echo ""
echo "1️⃣-2 동일한 멱등키로 두 번째 요청..."
sleep 1

SECOND_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"userId": "test", "invoiceId": "invalid", "payments": [{"methodType": "INVALID_TYPE", "amount": "not_a_number", "paymentMethodId": null}]}')

SECOND_HTTP_CODE=$(echo "$SECOND_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
SECOND_RESPONSE_BODY=$(echo "$SECOND_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

echo "두 번째 요청 HTTP 코드: $SECOND_HTTP_CODE"
echo "두 번째 요청 응답: $SECOND_RESPONSE_BODY"

# 응답 비교
echo ""
echo "1️⃣-3 에러 응답 멱등성 검증..."
if [ "$FIRST_HTTP_CODE" = "$SECOND_HTTP_CODE" ] && [ "$FIRST_RESPONSE_BODY" = "$SECOND_RESPONSE_BODY" ]; then
  echo "✅ 에러 응답 멱등성 테스트 성공: 동일한 에러 응답 반환"
  ERROR_IDEMPOTENCY_PASSED=true
else
  echo "❌ 에러 응답 멱등성 테스트 실패: 응답이 다름"
  echo "첫 번째: HTTP $FIRST_HTTP_CODE - $FIRST_RESPONSE_BODY"
  echo "두 번째: HTTP $SECOND_HTTP_CODE - $SECOND_RESPONSE_BODY"
  ERROR_IDEMPOTENCY_PASSED=false
fi

echo ""
echo "2️⃣ 매우 긴 요청으로 서버 부하 테스트"
echo "================================"

LONG_KEY=$(generate_uuid)
echo "멱등키: $LONG_KEY"

# 매우 긴 문자열로 서버 부하 유발 시도
LONG_STRING=$(python3 -c "print('A' * 10000)")

LONG_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $LONG_KEY" \
  -d "{\"userId\": \"$LONG_STRING\", \"invoiceId\": \"test\", \"payments\": []}")

LONG_HTTP_CODE=$(echo "$LONG_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
LONG_RESPONSE_BODY=$(echo "$LONG_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

echo "긴 요청 HTTP 코드: $LONG_HTTP_CODE"
echo "긴 요청 응답: $LONG_RESPONSE_BODY"

echo ""
echo "================================"
echo "📋 500 에러 테스트 결과"
echo "================================"

echo "🔍 발견된 HTTP 상태 코드들:"
echo "- 첫 번째 시나리오: $FIRST_HTTP_CODE"
echo "- 두 번째 시나리오: $LONG_HTTP_CODE"

if [ "$ERROR_IDEMPOTENCY_PASSED" = true ]; then
  echo "✅ 에러 응답 멱등성 확인됨"
else
  echo "❌ 에러 응답 멱등성 문제 있음"
fi

echo ""
echo "💡 실제 500 에러를 유발하려면 다음을 시도해볼 수 있습니다:"
echo "1. 데이터베이스 연결 끊기"
echo "2. 메모리 부족 상황 유발"
echo "3. 외부 서비스 (HMS API) 장애 시뮬레이션"