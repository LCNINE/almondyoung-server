# User Service — CLAUDE.md

> 루트 `CLAUDE.md`의 공통 규칙(레이어 아키텍처, Drizzle 컨벤션, 에러 핸들링 패턴 등)은 여기서 반복하지 않는다.

## 1. 역할과 경계

### 책임지는 것
- 사용자 인증(로컬 회원가입/로그인, 카카오/네이버 소셜 로그인)
- JWT 토큰 발급/갱신/폐기 (Access 15분, Refresh 2주/자동로그인 90일)
- 사용자 프로필, 동의(consents), 위시리스트, 최근 본 상품 관리
- RBAC 역할/스코프 관리 (역할 할당, 만료 기한 지원)
- 사업자등록증 등록/심사
- 상점(Shop) 정보 관리
- Cafe24 계정 연동/마이그레이션
- 파일 업로드/삭제 (AWS S3)
- 휴대폰 인증 (Twilio SMS)
- 블랙리스트, 휴면/탈퇴 회원 관리 (Admin)

### 책임지지 않는 것
- 결제/지갑 — `wallet`
- 상품 마스터 데이터 — `pim`
- 재고/물류 — `wms`
- 주문/커머스 트랜잭션 — `medusa`
- 마켓플레이스 연동 — `channel-adapter` (Cafe24 토큰 관리는 user-service가 하지만, 주문/상품 동기화는 channel-adapter)
- 알림 발송 — `notification`

## 2. Source of Truth (SoT)

| 데이터 | 테이블 | 비고 |
|--------|--------|------|
| 사용자 계정 | `users` | loginId, email, password(bcrypt) |
| 사용자 프로필 | `profiles` | 전화번호, 주소(JSONB), 생년월일, 프로필 이미지 |
| 소셜 ID 연동 | `user_identities` | provider: kakao/google/naver |
| JWT 토큰 | `tokens` | access/refresh/verification, 폐기(isRevoked) 관리 |
| 역할/권한 | `roles`, `user_roles` | 스코프 기반 RBAC, 만료 기한 지원 |
| 동의 내역 | `user_consents` | 14세 이상, 약관, 마케팅 등 |
| 상점 정보 | `shops` | 업종, 카테고리(JSONB), 영업일(JSONB) |
| 사업자등록증 | `business_licenses` | 심사 상태(under_review/approved/rejected) |
| Cafe24 연동 | `cafe24_tokens`, `cafe24_links`, `cafe24_snapshots` | 멀티몰, 스냅샷 |
| 블랙리스트 | `blacklists` | soft delete |
| 위시리스트 | `wishlist` | (userId, productId) unique |
| 최근 본 상품 | `recent_views` | (userId, productId) unique |
| 휴대폰 인증 | `phone_verifications` | 목적별(phone_verify/pin_reset), 만료/시도 횟수 |

## 3. 핵심 설계 패턴 & 아키텍처 특이사항

### JWT 토큰 추출
Bearer 헤더 **또는** 쿠키(`accessToken`, `refreshToken`)에서 추출한다. Refresh Strategy는 `ignoreExpiration: true`로 설정하고 DB에서 폐기/만료를 직접 검증한다.

### @Public() 데코레이터
`JwtAuthGuard`가 글로벌 가드로 등록되어 있고, 인증 불필요 엔드포인트에 `@Public()`을 붙여 bypass한다. Cafe24 내부 API도 `@Public()`로 열려 있다(channel-adapter 서비스 간 호출용).

### 소셜 로그인 전략 조건부 로딩
`KAKAO_CLIENT_ID`, `NAVER_CLIENT_ID` 환경 변수 존재 여부에 따라 Passport Strategy를 동적으로 등록한다. 없으면 해당 소셜 로그인 비활성.

### Fastify 기반
Express가 아닌 Fastify를 사용한다. 파일 업로드는 `@fastify/multipart` + 커스텀 `FastifyFileInterceptor`로 처리한다.

### Soft Delete
사용자(`users.deletedAt`), 블랙리스트(`blacklists.deletedAt`) 모두 논리 삭제. 휴면 전환/영구 삭제는 Admin API를 통해 수행.

### Cafe24 조건부 Unique 인덱스
`cafe24_links` 테이블에서 `unlinkedAt IS NULL` 조건의 partial unique index를 사용하여, 해제 후 재연동을 허용한다.

### 역할 만료
`user_roles.expiresAt`으로 시한부 역할 할당을 지원한다.

### Throttling
ThrottlerModule — 60초당 10회 글로벌 제한.

### 스케줄 작업
`@nestjs/schedule`로 만료된 휴대폰 인증 코드를 자동 처리한다(ExpireExistingCodesService).

## 4. 다른 앱/라이브러리와의 연동

### 사용하는 공유 라이브러리
| 라이브러리 | 용도 |
|-----------|------|
| `@app/db` | `DbService`, `@InjectDb` |
| `@app/events` | `StreamPublisher` — Kafka 이벤트 발행 |
| `@app/authorization` | `RequireScopes`, `ScopeGuard`, `authorizationSchema` |
| `@app/shared` | `CurrentUser`, `GlobalExceptionFilter`, `ResponseInterceptor` |
| `@packages/event-contracts` | `UserEvents`, `USER_STREAM` 이벤트 타입 |

### 발행하는 이벤트 (Kafka Stream: `users.events.v1`)
| 이벤트 | 발생 시점 |
|--------|----------|
| `UserCreated` | 회원가입 |
| `UserEmailVerified` | 이메일 인증 완료 |
| `UserUpdated` | 프로필 수정 |
| `UserVerification` | 인증 요청 |
| `Cafe24Linked` / `Cafe24Unlinked` | Cafe24 연동/해제 |
| `BusinessLicenseApproved` | 사업자등록증 승인 |
| `UserDormantConverted` | 휴면 전환 |
| `UserPermanentDeleted` | 영구 삭제 |

### 서비스 간 내부 API
- **channel-adapter → user-service**: `/cafe24/internal/link-info`, `/cafe24/internal/links` (Public 엔드포인트, 인증 없이 호출)

## 5. 스키마 구조 요약

```
users ──┬── profiles (1:1)
        ├── user_identities (1:N, provider별)
        ├── tokens (1:N)
        ├── user_roles (N:M) ── roles
        ├── user_consents (1:1)
        ├── shops (1:1) ── business_licenses (1:1)
        ├── blacklists (1:1)
        ├── wishlist (1:N)
        ├── recent_views (1:N)
        └── cafe24_links (1:N) ── cafe24_snapshots (1:1)

cafe24_tokens (독립, mallId 기준)
phone_verifications (독립, 전화번호 기준)
```

스키마 파일: `database/drizzle/schema.ts`

## 6. 주요 환경 변수

| 변수 | 용도 |
|------|------|
| `AUTH_SECRET` | JWT Access Token 시크릿 |
| `JWT_REFRESH_SECRET` | Refresh Token 시크릿 |
| `JWT_VERIFICATION_TOKEN_SECRET` | 이메일 인증 토큰 시크릿 |
| `KAKAO_CLIENT_ID/SECRET/CALLBACK_URL` | 카카오 OAuth (선택) |
| `NAVER_CLIENT_ID/SECRET/CALLBACK_URL` | 네이버 OAuth (선택) |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER/SERVICE_ID` | SMS 인증 |
| `AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION/S3_BUCKET` | S3 파일 업로드 |
| `CAFE24_CLIENT_ID/CLIENT_SECRET/SERVICE_KEY` | Cafe24 연동 |
| `CORS_ORIGIN_DOMAIN`, `COOKIE_DOMAIN` | CORS/쿠키 설정 |

환경 변수 검증: `src/config/env.validation.ts` (Zod 스키마, 앱 시작 시 검증)
