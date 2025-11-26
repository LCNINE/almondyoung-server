#!/bin/bash
# apps/notification/scripts/setup-user-verification-railway.sh
#
# Railway 배포 환경에서 USER_VERIFICATION 템플릿과 이벤트 매핑을 생성하는 스크립트
#
# 사용법:
#   chmod +x apps/notification/scripts/setup-user-verification-railway.sh
#   NOTIFICATION_URL=https://notice-development.up.railway.app ./apps/notification/scripts/setup-user-verification-railway.sh

set -e

NOTIFICATION_URL="${NOTIFICATION_URL:-https://notice-development.up.railway.app}"

echo "🚀 USER_VERIFICATION 템플릿 및 이벤트 매핑 생성 시작..."
echo "📡 Notification 서비스 URL: $NOTIFICATION_URL"

# 1. 템플릿 생성
echo ""
echo "📝 템플릿 생성 중..."

TEMPLATE_RESPONSE=$(curl -s -X POST "$NOTIFICATION_URL/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "templateKey": "USER_VERIFICATION_EMAIL",
    "name": "회원가입 이메일 인증",
    "category": "SYSTEM",
    "contents": {
      "ko": {
        "EMAIL": {
          "subject": "아몬드영 회원가입 이메일 인증",
          "body": "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>이메일 인증</title></head><body style=\"font-family: -apple-system, BlinkMacSystemFont, '\''Segoe UI'\'', Roboto, '\''Helvetica Neue'\'', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;\"><div style=\"background-color: #f8f9fa; padding: 30px; border-radius: 8px;\"><h1 style=\"color: #2c3e50; margin-bottom: 20px;\">안녕하세요 {{name}}님!</h1><p style=\"font-size: 16px; margin-bottom: 20px;\">아몬드영에 가입해 주셔서 감사합니다. 이메일 인증을 완료해 주세요.</p><div style=\"text-align: center; margin: 30px 0;\"><a href=\"{{callbackUrl}}?token={{verificationToken}}&redirect_to={{redirectTo}}\" style=\"display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;\">이메일 인증하기</a></div><p style=\"font-size: 14px; color: #666; margin-top: 30px;\">위 버튼이 작동하지 않는 경우, 아래 링크를 복사하여 브라우저에 붙여넣으세요:<br><span style=\"word-break: break-all; color: #007bff;\">{{callbackUrl}}?token={{verificationToken}}&redirect_to={{redirectTo}}</span></p><hr style=\"border: none; border-top: 1px solid #dee2e6; margin: 30px 0;\"><p style=\"font-size: 12px; color: #999; text-align: center;\">이 이메일은 회원가입 과정에서 자동으로 발송되었습니다.<br>만약 회원가입을 하지 않으셨다면, 이 이메일을 무시하셔도 됩니다.</p></div></body></html>"
        }
      }
    },
    "variablesSchema": {
      "name": {
        "type": "string",
        "required": true,
        "description": "사용자 이름"
      },
      "email": {
        "type": "string",
        "required": true,
        "description": "사용자 이메일"
      },
      "verificationToken": {
        "type": "string",
        "required": true,
        "description": "이메일 인증 토큰"
      },
      "callbackUrl": {
        "type": "string",
        "required": true,
        "description": "인증 콜백 URL"
      },
      "redirectTo": {
        "type": "string",
        "required": true,
        "description": "인증 후 리다이렉트 경로"
      }
    },
    "supportedChannels": ["EMAIL"]
  }')

if echo "$TEMPLATE_RESPONSE" | grep -q "templateId\|template_id"; then
  echo "✅ 템플릿 생성 완료"
else
  if echo "$TEMPLATE_RESPONSE" | grep -q "already exists\|duplicate"; then
    echo "⚠️  템플릿이 이미 존재합니다. 계속 진행합니다..."
  else
    echo "❌ 템플릿 생성 실패: $TEMPLATE_RESPONSE"
    exit 1
  fi
fi

# 2. 이벤트 매핑 생성
echo ""
echo "📝 이벤트 매핑 생성 중..."

EVENT_RESPONSE=$(curl -s -X POST "$NOTIFICATION_URL/events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventKey": "USER_VERIFICATION",
    "name": "회원가입 이메일 인증",
    "description": "회원가입 시 이메일 인증 링크를 발송하는 이벤트",
    "templateKey": "USER_VERIFICATION_EMAIL",
    "category": "SYSTEM",
    "defaultChannels": ["EMAIL"],
    "priority": "NORMAL"
  }')

if echo "$EVENT_RESPONSE" | grep -q "eventId\|event_id"; then
  echo "✅ 이벤트 매핑 생성 완료"
else
  if echo "$EVENT_RESPONSE" | grep -q "already exists\|duplicate"; then
    echo "⚠️  이벤트 매핑이 이미 존재합니다."
  else
    echo "❌ 이벤트 매핑 생성 실패: $EVENT_RESPONSE"
    exit 1
  fi
fi

echo ""
echo "🎉 모든 작업이 완료되었습니다!"
echo ""
echo "템플릿 키: USER_VERIFICATION_EMAIL"
echo "이벤트 키: USER_VERIFICATION"
echo ""
echo "이제 회원가입 시 이메일 인증 이메일이 발송됩니다."

