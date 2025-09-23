# 아몬드영 인증 프로세스

이 문서는 아몬드영의 회원가입과 로그인 프로세스에 대한 상세한 설명을 제공합니다.

## 🔹 회원가입 (Sign Up)

### 1. 회원가입 요청

- `user-service`의 `/signup` 엔드포인트 호출
  - 회원 정보 생성
  - 이메일 인증 이벤트 발행
- 알림 서비스가 이벤트 수신 후 인증 이메일 발송
  - 이메일에 포함된 인증 URL에는 callback URL과 단기 유효 토큰이 포함됨

### 2. 이메일 인증

사용자가 이메일의 인증 URL을 클릭하면 callback URL로 이동

#### ✅ Callback URL 처리 로직

1. `user-service.users.is_email_verified = TRUE` 설정
   - 이메일 인증 완료 처리
2. Medusa 고객 등록 요청 (`/auth/customer/my-auth/register`)

```json
{
  "almond_user_id": "...",
  "email": "...",
  "first_name": "...",
  "last_name": "..."
}
```

요청이 성공하면 Medusa 고객 계정 등록이 완료됩니다.

## 🔹 로그인 (Sign In)

### 1. 로그인 요청

- `user-service`의 `/signin` 엔드포인트 호출
- 성공 시 AccessToken과 RefreshToken 발급

### 2. Medusa 인증 연동

- 클라이언트가 `http://localhost:9000/auth/admin/my-auth` 호출
  - Authorization 헤더에 user-service의 AccessToken 포함

### 3. 로그인 완료

Medusa 인증이 성공하면 클라이언트는 최종적으로 다음 3개의 토큰을 보유하게 됩니다:

- user-service AccessToken
- user-service RefreshToken
- medusa AccessToken

## 🔹 요약

1. 회원가입 프로세스:
   - user-service 회원가입
   - 이메일 인증 (Callback 처리)
   - Medusa 고객 등록

2. 로그인 프로세스:
   - user-service 인증
   - Medusa 인증
   - 최종 세션 확립
