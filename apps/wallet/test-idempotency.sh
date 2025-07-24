#!/bin/bash

# 멱등성 E2E 테스트 스크립트
# 결제 API의 멱등성 처리를 검증합니다.

BASE_URL="http://localhost:5000"
USER_ID="test-user-idempotency-$(date +%s)"

echo "================================"
echo "🔄 멱등성 E2E 테스트 시작"
echo "================================"

# ULID 생성 함수 (더 간단하고 정렬 가능)
generate_ulid() {
  # ULID는 26자리 Base32 문자로 구성
  # 타임스탬프(10자리) + 랜덤(16자리)
  local timestamp=$(date +%s)
  local random=$(openssl rand -hex 8 | tr '[:lower:]' '[:upper:]' | tr '0-9A-F' '0123456789ABCDEFGHJKMNPQRSTVWXYZ' | head -c 16)
  
  # 간단한 ULID 형식 생성 (실제 ULID 라이브러리 사용 권장)
  printf "%010d%016s" $timestamp $random | head -c 26
}

# UUID v4 생성 함수 (백업용)
generate_uuid() {
  if command -v uuidgen &> /dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    # uuidgen이 없는 경우 간단한 UUID 생성
    python3 -c "import uuid; print(str(uuid.uuid4()))"
  fi
}

# 테스트용 멱등키 생성 (ULID 사용)
generate_test_key() {
  generate_ulid
}

# 테스트 준비
echo "1️⃣ 테스트 준비"
echo "================================"

# 1-1. 결제수단 생성 (BNPL 계정 자동 생성)
echo "1️⃣-1 결제수단 생성..."
PAYMENT_METHOD_RESPONSE=$(curl -s -X POST "$BASE_URL/payment-methods" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"methodType\": \"BNPL\",
    \"methodName\": \"멱등성 테스트 계정\",
    \"institutionCode\": \"ALMOND001\",
    \"isDefault\": true
  }")

echo "결제수단 생성 응답:"
echo "$PAYMENT_METHOD_RESPONSE" | jq '.'

PAYMENT_METHOD_ID=$(echo "$PAYMENT_METHOD_RESPONSE" | jq -r '.id')
echo "✅ 결제수단 ID: $PAYMENT_METHOD_ID"

# 결제수단 ID 검증
if [ "$PAYMENT_METHOD_ID" = "null" ] || [ -z "$PAYMENT_METHOD_ID" ]; then
  echo "❌ 결제수단 생성 실패: ID가 null이거나 비어있습니다."
  echo "응답 내용: $PAYMENT_METHOD_RESPONSE"
  exit 1
fi

# 1-2. BNPL 계정 생성 확인 (재시도 로직)
echo "1️⃣-2 BNPL 계정 생성 확인 중..."
RETRY_COUNT=0
MAX_RETRIES=10

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    sleep 2
    ACCOUNT_RESPONSE=$(curl -s "$BASE_URL/bnpl/accounts/me?userId=$USER_ID")
    
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
echo "1️⃣-3 동의자료 업로드 중..."

# 테스트용 동의서 파일 생성
TEST_AGREEMENT_FILE="/tmp/test-agreement-idempotency-$USER_ID.txt"
cat > "$TEST_AGREEMENT_FILE" << EOF
BNPL 서비스 이용 동의서 (멱등성 테스트용)

본인은 BNPL(Buy Now Pay Later) 서비스 이용에 동의합니다.

사용자: $USER_ID
결제수단 ID: $PAYMENT_METHOD_ID
동의 일시: $(date)
테스트 목적: 멱등성 검증

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
echo "⏳ 결제수단 활성화 대기 중 (1분)..."
sleep 60

echo "✅ 결제수단 활성화 대기 완료"

# 1-4. Invoice 생성
echo "1️⃣-4 Invoice 생성..."
INVOICE_AMOUNT=10000
INVOICE_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceType\": \"PURCHASE\",
    \"amount\": $INVOICE_AMOUNT,
    \"currency\": \"KRW\"
  }")

INVOICE_ID=$(echo "$INVOICE_RESPONSE" | jq -r '.id')
echo "✅ Invoice 생성 완료: $INVOICE_ID ($INVOICE_AMOUNT원)"

# Invoice ID 검증
if [ "$INVOICE_ID" = "null" ] || [ -z "$INVOICE_ID" ]; then
  echo "❌ Invoice 생성 실패: ID가 null이거나 비어있습니다."
  echo "응답 내용: $INVOICE_RESPONSE"
  exit 1
fi

# 멱등성 테스트
echo ""
echo "2️⃣ 멱등성 테스트"
echo "================================"

# 2-1. 첫 번째 결제 요청 (멱등키 포함)
echo "2️⃣-1 첫 번째 결제 요청 (멱등키 포함)..."
IDEMPOTENCY_KEY=$(generate_test_key)
echo "멱등키: $IDEMPOTENCY_KEY"

FIRST_PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": $INVOICE_AMOUNT,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

echo "첫 번째 결제 응답:"
echo "$FIRST_PAYMENT_RESPONSE" | jq '.'

FIRST_SUCCESS=$(echo "$FIRST_PAYMENT_RESPONSE" | jq -r '.success')
FIRST_PAYMENT_EVENT_ID=$(echo "$FIRST_PAYMENT_RESPONSE" | jq -r '.paymentEventId')

if [ "$FIRST_SUCCESS" = "true" ]; then
  echo "✅ 첫 번째 결제 성공"
else
  echo "❌ 첫 번째 결제 실패"
  exit 1
fi

# 2-2. 동일한 멱등키로 두 번째 요청 (중복 요청)
echo ""
echo "2️⃣-2 동일한 멱등키로 두 번째 요청 (중복 요청)..."
sleep 1 # 잠시 대기

SECOND_PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": $INVOICE_AMOUNT,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

echo "두 번째 결제 응답:"
echo "$SECOND_PAYMENT_RESPONSE" | jq '.'

# 2-3. 응답 비교 (멱등성 검증)
echo ""
echo "2️⃣-3 응답 비교 (멱등성 검증)..."

# JSON 응답을 정규화하여 비교
FIRST_NORMALIZED=$(echo "$FIRST_PAYMENT_RESPONSE" | jq -S '.')
SECOND_NORMALIZED=$(echo "$SECOND_PAYMENT_RESPONSE" | jq -S '.')

if [ "$FIRST_NORMALIZED" = "$SECOND_NORMALIZED" ]; then
  echo "✅ 멱등성 테스트 성공: 동일한 응답 반환"
  IDEMPOTENCY_TEST_PASSED=true
else
  echo "❌ 멱등성 테스트 실패: 응답이 다름"
  echo "첫 번째 응답: $FIRST_NORMALIZED"
  echo "두 번째 응답: $SECOND_NORMALIZED"
  IDEMPOTENCY_TEST_PASSED=false
fi

# 2-4. 다른 페이로드로 동일한 멱등키 요청 (422 에러 예상)
echo ""
echo "2️⃣-4 다른 페이로드로 동일한 멱등키 요청 (422 에러 예상)..."

THIRD_PAYMENT_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": 20000,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

HTTP_CODE=$(echo "$THIRD_PAYMENT_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
THIRD_RESPONSE_BODY=$(echo "$THIRD_PAYMENT_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

echo "세 번째 요청 HTTP 코드: $HTTP_CODE"
echo "세 번째 요청 응답: $THIRD_RESPONSE_BODY"

if [ "$HTTP_CODE" = "422" ]; then
  echo "✅ 페이로드 불일치 테스트 성공: 422 에러 반환"
  PAYLOAD_MISMATCH_TEST_PASSED=true
else
  echo "❌ 페이로드 불일치 테스트 실패: HTTP $HTTP_CODE (예상: 422)"
  PAYLOAD_MISMATCH_TEST_PASSED=false
fi

# 3. 새로운 멱등키로 정상 요청 테스트
echo ""
echo "3️⃣ 새로운 멱등키로 정상 요청 테스트"
echo "================================"

# 3-1. 새로운 Invoice 생성
echo "3️⃣-1 새로운 Invoice 생성..."
NEW_INVOICE_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceType\": \"PURCHASE\",
    \"amount\": 5000,
    \"currency\": \"KRW\"
  }")

NEW_INVOICE_ID=$(echo "$NEW_INVOICE_RESPONSE" | jq -r '.id')
echo "✅ 새로운 Invoice 생성: $NEW_INVOICE_ID"

# 3-2. 새로운 멱등키로 결제 요청
echo "3️⃣-2 새로운 멱등키로 결제 요청..."
NEW_IDEMPOTENCY_KEY=$(generate_test_key)
echo "새로운 멱등키: $NEW_IDEMPOTENCY_KEY"

NEW_PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $NEW_IDEMPOTENCY_KEY" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$NEW_INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": 5000,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

NEW_SUCCESS=$(echo "$NEW_PAYMENT_RESPONSE" | jq -r '.success')

if [ "$NEW_SUCCESS" = "true" ]; then
  echo "✅ 새로운 멱등키 결제 성공"
  NEW_KEY_TEST_PASSED=true
else
  echo "❌ 새로운 멱등키 결제 실패"
  echo "$NEW_PAYMENT_RESPONSE" | jq '.'
  NEW_KEY_TEST_PASSED=false
fi

# 4. 멱등키 없는 요청 테스트
echo ""
echo "4️⃣ 멱등키 없는 요청 테스트"
echo "================================"

# 4-1. 또 다른 Invoice 생성
echo "4️⃣-1 또 다른 Invoice 생성..."
NO_KEY_INVOICE_RESPONSE=$(curl -s -X POST "$BASE_URL/invoices" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceType\": \"PURCHASE\",
    \"amount\": 3000,
    \"currency\": \"KRW\"
  }")

NO_KEY_INVOICE_ID=$(echo "$NO_KEY_INVOICE_RESPONSE" | jq -r '.id')
echo "✅ Invoice 생성: $NO_KEY_INVOICE_ID"

# 4-2. 멱등키 없이 결제 요청
echo "4️⃣-2 멱등키 없이 결제 요청..."
NO_KEY_PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$NO_KEY_INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": 3000,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

NO_KEY_SUCCESS=$(echo "$NO_KEY_PAYMENT_RESPONSE" | jq -r '.success')

if [ "$NO_KEY_SUCCESS" = "true" ]; then
  echo "✅ 멱등키 없는 결제 성공 (일반 처리)"
  NO_KEY_TEST_PASSED=true
else
  echo "❌ 멱등키 없는 결제 실패"
  echo "$NO_KEY_PAYMENT_RESPONSE" | jq '.'
  NO_KEY_TEST_PASSED=false
fi

# 5. 잘못된 멱등키 형식 테스트
echo ""
echo "5️⃣ 잘못된 멱등키 형식 테스트"
echo "================================"

INVALID_KEY_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "$BASE_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: invalid-key-format" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"invoiceId\": \"$NO_KEY_INVOICE_ID\",
    \"payments\": [
      {
        \"methodType\": \"BNPL\",
        \"amount\": 3000,
        \"paymentMethodId\": \"$PAYMENT_METHOD_ID\"
      }
    ]
  }")

INVALID_HTTP_CODE=$(echo "$INVALID_KEY_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)

if [ "$INVALID_HTTP_CODE" = "400" ]; then
  echo "✅ 잘못된 멱등키 형식 테스트 성공: 400 에러 반환"
  INVALID_KEY_TEST_PASSED=true
else
  echo "❌ 잘못된 멱등키 형식 테스트 실패: HTTP $INVALID_HTTP_CODE (예상: 400)"
  INVALID_KEY_TEST_PASSED=false
fi

# 테스트 결과 요약
echo ""
echo "================================"
echo "📋 테스트 결과 요약"
echo "================================"

TOTAL_TESTS=0
PASSED_TESTS=0

# 멱등성 테스트
if [ "$IDEMPOTENCY_TEST_PASSED" = true ]; then
  echo "✅ 멱등성 테스트 통과"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo "❌ 멱등성 테스트 실패"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# 페이로드 불일치 테스트
if [ "$PAYLOAD_MISMATCH_TEST_PASSED" = true ]; then
  echo "✅ 페이로드 불일치 테스트 통과"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo "❌ 페이로드 불일치 테스트 실패"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# 새로운 멱등키 테스트
if [ "$NEW_KEY_TEST_PASSED" = true ]; then
  echo "✅ 새로운 멱등키 테스트 통과"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo "❌ 새로운 멱등키 테스트 실패"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# 멱등키 없는 요청 테스트
if [ "$NO_KEY_TEST_PASSED" = true ]; then
  echo "✅ 멱등키 없는 요청 테스트 통과"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo "❌ 멱등키 없는 요청 테스트 실패"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# 잘못된 멱등키 형식 테스트
if [ "$INVALID_KEY_TEST_PASSED" = true ]; then
  echo "✅ 잘못된 멱등키 형식 테스트 통과"
  PASSED_TESTS=$((PASSED_TESTS + 1))
else
  echo "❌ 잘못된 멱등키 형식 테스트 실패"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "🎯 최종 결과: $PASSED_TESTS/$TOTAL_TESTS 테스트 통과"
echo "🎯 테스트 사용자: $USER_ID"

if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
  echo "🎉 모든 멱등성 테스트 통과! 시스템이 정상 작동합니다."
  exit 0
else
  echo "⚠️ 일부 테스트 실패. 시스템 점검이 필요합니다."
  exit 1
fi

echo ""
echo "💡 추가 확인 명령어:"
echo "curl -s \"$BASE_URL/payments/events/$FIRST_PAYMENT_EVENT_ID\" | jq '.'"

# 임시 파일 정리
rm -f "$TEST_AGREEMENT_FILE"
echo ""
echo "🧹 임시 파일 정리 완료"