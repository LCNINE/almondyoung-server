#!/bin/bash
# apps/notification/scripts/update-resend-api-key.sh
#
# Railway 배포 환경에서 Resend 프로바이더의 API 키를 업데이트하는 스크립트
#
# 사용법:
#   chmod +x apps/notification/scripts/update-resend-api-key.sh
#   NOTIFICATION_URL=https://notice-development.up.railway.app RESEND_API_KEY=your_key ./apps/notification/scripts/update-resend-api-key.sh

set -e

NOTIFICATION_URL="${NOTIFICATION_URL:-https://notice-development.up.railway.app}"

if [ -z "$RESEND_API_KEY" ]; then
  echo "❌ RESEND_API_KEY 환경변수가 필요합니다."
  echo "   사용법: RESEND_API_KEY=your_key ./update-resend-api-key.sh"
  exit 1
fi

echo "🚀 Resend 프로바이더 API 키 업데이트 시작..."
echo "📡 Notification 서비스 URL: $NOTIFICATION_URL"

# EMAIL 채널의 프로바이더 조회
echo ""
echo "📝 EMAIL 채널의 프로바이더 조회 중..."

PROVIDERS=$(curl -s "$NOTIFICATION_URL/providers?channel=EMAIL")

if [ "$PROVIDERS" = "[]" ]; then
  echo "❌ EMAIL 채널에 등록된 프로바이더가 없습니다."
  echo "   먼저 프로바이더를 등록하세요."
  exit 1
fi

# providerId 추출 (첫 번째 프로바이더 사용)
PROVIDER_ID=$(echo "$PROVIDERS" | grep -o '"providerId":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$PROVIDER_ID" ]; then
  echo "❌ 프로바이더 ID를 찾을 수 없습니다."
  exit 1
fi

echo "✅ 프로바이더 ID: $PROVIDER_ID"

# 프로바이더 상세 정보 조회
echo ""
echo "📝 프로바이더 상세 정보 조회 중..."

PROVIDER_DETAIL=$(curl -s "$NOTIFICATION_URL/providers/$PROVIDER_ID")

# 기존 config 추출 및 API 키 업데이트
CURRENT_CONFIG=$(echo "$PROVIDER_DETAIL" | grep -o '"config":{[^}]*}' || echo '{"config":{}}')

# 프로바이더 업데이트
echo ""
echo "📝 프로바이더 API 키 업데이트 중..."

UPDATE_RESPONSE=$(curl -s -X PUT "$NOTIFICATION_URL/providers/$PROVIDER_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"config\": {
      \"apiKey\": \"$RESEND_API_KEY\",
      \"fromEmail\": \"noreply@almondyoung.com\",
      \"fromName\": \"Almond Young\",
      \"baseUrl\": \"https://api.resend.com\",
      \"maxRetries\": 3,
      \"retryDelay\": 1000,
      \"timeout\": 30000
    },
    \"isActive\": true,
    \"priority\": 10
  }")

if echo "$UPDATE_RESPONSE" | grep -q "providerId\|provider_id"; then
  echo "✅ 프로바이더 API 키 업데이트 완료"
  echo ""
  echo "프로바이더가 자동으로 리로드됩니다."
else
  echo "❌ 프로바이더 업데이트 실패: $UPDATE_RESPONSE"
  exit 1
fi

echo ""
echo "🎉 모든 작업이 완료되었습니다!"

