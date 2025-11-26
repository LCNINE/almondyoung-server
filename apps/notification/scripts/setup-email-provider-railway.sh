#!/bin/bash
# apps/notification/scripts/setup-email-provider-railway.sh
#
# Railway 배포 환경에서 Resend 이메일 프로바이더를 등록하는 스크립트
#
# 사용법:
#   chmod +x apps/notification/scripts/setup-email-provider-railway.sh
#   NOTIFICATION_URL=https://notice-development.up.railway.app ./apps/notification/scripts/setup-email-provider-railway.sh

set -e

NOTIFICATION_URL="${NOTIFICATION_URL:-https://notice-development.up.railway.app}"

echo "🚀 Resend 이메일 프로바이더 등록 시작..."
echo "📡 Notification 서비스 URL: $NOTIFICATION_URL"

# Resend API 키 확인
if [ -z "$RESEND_API_KEY" ]; then
  echo "⚠️  RESEND_API_KEY 환경변수가 설정되지 않았습니다."
  echo "   Railway 환경변수에서 RESEND_API_KEY를 확인하세요."
  echo "   프로바이더는 등록되지만 API 키가 없으면 작동하지 않을 수 있습니다."
fi

# Resend 이메일 프로바이더 등록
echo ""
echo "📝 Resend 이메일 프로바이더 등록 중..."

PROVIDER_RESPONSE=$(curl -s -X POST "$NOTIFICATION_URL/providers" \
  -H "Content-Type: application/json" \
  -d "{
    \"channel\": \"EMAIL\",
    \"providerName\": \"resend\",
    \"config\": {
      \"apiKey\": \"${RESEND_API_KEY:-}\",
      \"fromEmail\": \"${RESEND_FROM:-noreply@almondyoung.com}\",
      \"fromName\": \"${RESEND_FROM_NAME:-Almond Young}\",
      \"baseUrl\": \"https://api.resend.com\",
      \"maxRetries\": 3,
      \"retryDelay\": 1000,
      \"timeout\": 30000
    },
    \"isActive\": true,
    \"priority\": 10,
    \"capabilities\": {
      \"supportsTemplates\": true,
      \"supportsAttachments\": true,
      \"supportsScheduling\": true,
      \"maxBatchSize\": 100
    }
  }")

if echo "$PROVIDER_RESPONSE" | grep -q "providerId\|provider_id"; then
  echo "✅ Resend 이메일 프로바이더 등록 완료"
  echo "$PROVIDER_RESPONSE" | grep -o '"providerId":"[^"]*"' || echo "$PROVIDER_RESPONSE"
else
  if echo "$PROVIDER_RESPONSE" | grep -q "already exists\|duplicate"; then
    echo "⚠️  프로바이더가 이미 존재합니다. 업데이트를 시도합니다..."
    
    # 기존 프로바이더 조회 및 업데이트
    EXISTING_PROVIDER=$(curl -s "$NOTIFICATION_URL/providers?channel=EMAIL" | grep -o '"providerId":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$EXISTING_PROVIDER" ]; then
      UPDATE_RESPONSE=$(curl -s -X PUT "$NOTIFICATION_URL/providers/$EXISTING_PROVIDER" \
        -H "Content-Type: application/json" \
        -d "{
          \"config\": {
            \"apiKey\": \"${RESEND_API_KEY:-}\",
            \"fromEmail\": \"${RESEND_FROM:-noreply@almondyoung.com}\",
            \"fromName\": \"${RESEND_FROM_NAME:-Almond Young}\",
            \"baseUrl\": \"https://api.resend.com\",
            \"maxRetries\": 3,
            \"retryDelay\": 1000,
            \"timeout\": 30000
          },
          \"isActive\": true,
          \"priority\": 10
        }")
      
      if echo "$UPDATE_RESPONSE" | grep -q "providerId\|provider_id"; then
        echo "✅ 프로바이더 업데이트 완료"
      else
        echo "❌ 프로바이더 업데이트 실패: $UPDATE_RESPONSE"
        exit 1
      fi
    else
      echo "⚠️  기존 프로바이더를 찾을 수 없습니다. 수동으로 확인하세요."
    fi
  else
    echo "❌ 프로바이더 등록 실패: $PROVIDER_RESPONSE"
    exit 1
  fi
fi

echo ""
echo "🎉 모든 작업이 완료되었습니다!"
echo ""
echo "이제 이메일 알림이 발송될 수 있습니다."
echo ""
echo "⚠️  참고: RESEND_API_KEY가 Railway 환경변수에 설정되어 있는지 확인하세요."

