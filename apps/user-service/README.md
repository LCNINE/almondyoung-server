# User Service

사용자 관리, 인증, 권한 관리, 그리고 사용자 관련 부가 기능을 제공하는 마이크로서비스입니다.

## 주요 기능

### 1. 사용자 관리 (`/api/users`)

- 사용자 CRUD 작업
- 프로필 관리
- 사용자 상세 정보 관리

### 2. 인증 시스템 (`/api/auth`)

- 로컬 회원가입/로그인
- 소셜 로그인 (카카오)
- JWT 기반 인증 (Access/Refresh 토큰)
- 비밀번호 변경/재설정

### 3. 권한 관리 (`/api/admin`)

- RBAC(Role-Based Access Control) 시스템
- 스코프 기반 권한 체크
- 역할 및 권한 관리
- 휴면 계정 관리

### 4. 부가 기능

- 위시리스트 관리 (`/api/wishlist`)
- 최근 본 상품 관리 (`/api/recent-views`)
- 상점 정보 관리 (`/api/shop`)

### 5. 이벤트 시스템 (`/api/events`)

다음 이벤트들이 Kafka를 통해 발행됩니다:

#### 사용자 관련

- USER_CREATED: 회원가입 완료
- USER_UPDATED: 정보 수정
- USER_DELETED: 계정 삭제
- USER_VERIFICATION: 이메일 인증
- USER_FIND_ID: ID 찾기
- USER_RESET_PASSWORD: 비밀번호 재설정
- DORMANT_ACCOUNT_CONVERTED: 휴면 전환

## 기술 스택

- Framework: NestJS
- Database: PostgreSQL
- ORM: Drizzle
- Authentication: JWT
- Message Broker: Kafka
- Testing: Jest

## 시작하기

### 1. 환경 설정

```env
# .env 파일 생성
DATABASE_URL=postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require
```

### 2. 설치 및 실행

```bash
# 의존성 설치
npm install

# 데이터베이스 스키마 동기화
npm run db:push.user

# 초기 데이터 시드
npm run seed:user-service
```

## 데이터베이스 구조

### 핵심 테이블

- users: 사용자 기본 정보
- profiles: 상세 프로필
- roles: 역할 정의
- scopes: 권한 범위
- role_scopes: 역할-스코프 매핑
- user_roles: 사용자-역할 할당
- tokens: 인증 토큰
- user_identities: 소셜 로그인 정보
- wishlists: 위시리스트
- recent_views: 최근 본 상품
- shop_info: 상점 정보

## API 문서

Swagger UI를 통해 API 문서를 제공합니다:

- 개발: http://localhost:5000/api
- 운영: [TBD]

## 개발 가이드

### 새로운 권한 추가하기

1. 스코프 정의 (`database/seed.ts`)

```typescript
export const PREDEFINED_SCOPES = {
  MASTER: 'master',
  USER: 'user',
  NEW_SCOPE: 'new_scope', // 새로운 스코프
};
```

2. 역할 정의

```typescript
export const PREDEFINED_ROLES = {
  MASTER: 'master',
  NEW_ROLE: 'new_role', // 새로운 역할
};
```

3. 매핑 설정

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

### 테스트

```bash
# 단위 테스트
npm run test

# E2E 테스트
npm run test:e2e
```
