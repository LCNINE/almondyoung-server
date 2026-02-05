# Scripts

프로젝트에서 사용하는 유틸리티 스크립트 모음입니다.

## JWT Token Generator

### 📝 설명

테스트용 JWT 토큰을 생성하는 대화형 스크립트입니다.
거의 영구적인 유효기간(100년)을 가진 토큰을 생성할 수 있어 로컬 개발 및 테스트에 유용합니다.

### 🚀 사용 방법

```bash
# npm script로 실행 (권장)
npm run generate:token

# 또는 직접 실행
node scripts/generate-jwt-token.js
```

### 💡 입력 항목

1. **AUTH_SECRET** (필수)
   - JWT 서명에 사용할 비밀 키
   - 환경 변수의 `AUTH_SECRET`과 동일해야 함

2. **User ID** (선택)
   - 사용자 고유 식별자 (UUID 권장)
   - 입력하지 않으면 자동으로 UUID 생성

3. **Email** (선택)
   - 사용자 이메일
   - 기본값: `test@almondyoung.com`

4. **Roles** (선택)
   - 쉼표로 구분된 역할 목록
   - 기본값: `admin`
   - 예시: `admin,user` 또는 `user`

5. **유효기간** (선택)
   - 1: 100년 (테스트용 영구 토큰) - 기본값
   - 2: 1년
   - 3: 30일
   - 4: 커스텀 (예: 24h, 7d, 365d)

### 📋 출력 예시

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 JWT Token Generator for Almondyoung Services
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AUTH_SECRET (필수): my-secret-key
User ID (UUID, Enter로 자동생성):
   → 자동 생성된 UUID: 123e4567-e89b-12d3-a456-426614174000
Email (기본: test@almondyoung.com): admin@example.com
Roles (쉼표로 구분, 기본: admin): admin

💡 유효기간 옵션:
   1. 100년 (테스트용 영구 토큰)
   2. 1년
   3. 30일
   4. 커스텀
선택 (기본: 1): 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔨 토큰 생성 중...

✅ JWT Token 생성 완료!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Token Payload:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User ID:  123e4567-e89b-12d3-a456-426614174000
Email:    admin@example.com
Roles:    admin
Issued:   2025-01-15T10:30:00.000Z
Expires:  2125-01-15T10:30:00.000Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 JWT Token:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 사용 예시:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Authorization Header 방식:
curl -H "Authorization: Bearer eyJhbGc..." \
     http://localhost:3000/api/v1/files/:fileId/download

# Cookie 방식:
curl --cookie "accessToken=eyJhbGc..." \
     http://localhost:3000/api/v1/files/:fileId/download

# Swagger에서 사용:
  1. Swagger UI 접속 (http://localhost:3000/api)
  2. 🔒 Authorize 버튼 클릭
  3. 위 토큰 복사/붙여넣기
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 🎯 사용 시나리오

#### File Service 테스트

```bash
npm run generate:token
# AUTH_SECRET 입력 (file-service의 .env에 있는 값)
# 나머지는 기본값 사용
# 생성된 토큰으로 file upload/download API 테스트
```

#### 특정 사용자로 테스트

```bash
npm run generate:token
# User ID: 12345678-1234-1234-1234-123456789012
# Email: testuser@example.com
# Roles: user
# 유효기간: 1 (100년)
```

#### 여러 역할을 가진 사용자

```bash
npm run generate:token
# Roles: admin,user,moderator
```

### ⚠️ 주의사항

- **프로덕션에서 절대 사용하지 마세요!** 이 스크립트는 개발/테스트 전용입니다.
- 100년 유효기간은 테스트 편의를 위한 것으로, 실제 프로덕션에서는 짧은 유효기간을 사용해야 합니다.
- AUTH_SECRET은 각 마이크로서비스의 환경 변수와 동일해야 토큰이 유효합니다.
- 생성된 토큰은 민감정보이므로 코드에 하드코딩하거나 공개 저장소에 커밋하지 마세요.

### 🔗 관련 문서

- [Authorization Module](../libs/authorization/README.md)
- [Test Auth Scope App](../apps/test-auth-scope/README.md)

## User Service Test User Generator

### 📝 설명

user-service에 테스트용 계정을 DB에 직접 생성하는 스크립트입니다.
휴대폰 인증, 이메일 인증, 콜백 절차 없이 회원가입 흐름을 DB 레벨에서 모방합니다.

### 🚀 사용 방법

```bash
# 한 줄로 1명 생성 (모든 정보를 args로 전달)
ts-node -r tsconfig-paths/register scripts/user-service/create-test-users.ts \
  --login-id qa001 \
  --email qa001@almondyoung.test \
  --username qa001 \
  --nickname qa001 \
  --password Test@1234 \
  --phone 01000000001 \
  --birth-date 19900101 \
  --role membership \
  --verify-phone

# 여러 명 자동 생성
ts-node -r tsconfig-paths/register scripts/user-service/create-test-users.ts --count 3 --prefix qauser
```

### 💡 주요 옵션

```
--file <path>            JSON 파일로 계정 목록 입력
--count <n>              생성 개수 (기본 1)
--prefix <text>          loginId/email prefix (기본 testuser)
--email-domain <domain>  이메일 도메인 (기본 example.com)
--email <value>          단일 사용자 이메일
--login-id <value>       단일 사용자 loginId
--username <value>       단일 사용자 username
--nickname <value>       단일 사용자 nickname
--password <value>       비밀번호 (기본 Test@1234)
--role <name>            역할 이름 (기본 membership)
--role-id <uuid>         역할 ID (role보다 우선)
--verify-phone           휴대폰 인증 완료 레코드 생성
```
