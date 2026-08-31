#!/usr/bin/env bash
# 로컬 user-service 의 OAuth(RS256) 서명 키쌍을 만들어 base64 한 줄로 출력한다.
# env.validation.ts 의 pemString 이 base64 PEM 을 받아준다 (줄바꿈 손상 없는 권장 방식).
#
# 사용: ./scripts/local/gen-oauth-keys.sh >> apps/user-service/.env
set -euo pipefail
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/priv.pem" 2>/dev/null
openssl rsa -pubout -in "$tmp/priv.pem" -out "$tmp/pub.pem" 2>/dev/null
echo "OAUTH_JWT_PRIVATE_KEY=$(base64 -w0 "$tmp/priv.pem")"
echo "OAUTH_JWT_PUBLIC_KEY=$(base64 -w0 "$tmp/pub.pem")"
