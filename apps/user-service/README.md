# User Service

사용자 관리, 인증, 권한 관리를 담당하는 마이크로서비스입니다.

## 시작하기

### 환경 설정

1. 데이터베이스 설정

```env
# .env 파일 생성
DATABASE_URL=postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require
```

2. 의존성 설치

```bash
npm install
```

### 데이터베이스 초기화

1. 스키마 동기화

```bash
npm run db:push.user
```

2. 초기 데이터 시드

```bash
npm run seed:user-service
```

이 명령어는 다음 데이터를 생성합니다:

- 기본 스코프 (master, user)
- 기본 역할 (master, user_read, user_write, user_delete, user_update)
- 역할-스코프 매핑

## 주요 기능

### 사용자 관리

- 사용자 생성, 조회, 수정, 삭제
- 프로필 관리
- 이메일 인증

### 인증

- 로그인/로그아웃
- 소셜 로그인 (카카오)
- JWT 토큰 관리
- 비밀번호 재설정

### 권한 관리

- RBAC(Role-Based Access Control) 구현
- 스코프 기반 권한 체크
- 역할 할당 및 관리

## API 문서

API 문서는 Swagger를 통해 제공됩니다.

- 개발 환경: http://localhost:5000/api
- 운영 환경: ''

## 데이터베이스 스키마

주요 테이블:

- users: 사용자 기본 정보
- profiles: 사용자 프로필
- roles: 역할 정의
- scopes: 권한 범위
- role_scopes: 역할-스코프 매핑
- user_roles: 사용자-역할 할당
- tokens: 인증 토큰
- user_identities: 소셜 로그인 정보

## 개발 가이드

### 새로운 권한 추가하기

1. `database/seed.ts`에서 새로운 스코프 추가

```typescript
export const PREDEFINED_SCOPES = {
  MASTER: '...',
  USER: '...',
  NEW_SCOPE: '...', // 새로운 스코프
};
```

2. 새로운 역할 추가

```typescript
export const PREDEFINED_ROLES = {
  MASTER: '...',
  NEW_ROLE: '...', // 새로운 역할
};
```

3. 역할-스코프 매핑 설정

```typescript
const DEFAULT_ROLE_SCOPE_MAPPINGS = [
  {
    roleId: PREDEFINED_ROLES.NEW_ROLE,
    scopeIds: [PREDEFINED_SCOPES.NEW_SCOPE],
  },
];
```

4. 시드 실행

```bash
npm run seed:user-service
```
