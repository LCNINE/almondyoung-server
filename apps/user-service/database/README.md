# User Service Database

이 디렉토리는 User Service의 데이터베이스 관련 기능을 포함합니다.

## 주요 기능

### 1. Seed 데이터 초기화

데이터베이스에 기본 역할(roles)과 권한(scopes)을 초기화합니다.

```bash
# User Service 데이터베이스 시드 실행
npm run seed:user-service
```

seed.ts는 `@app/roles`의 `USER_SCOPES` 상수를 사용하여 데이터베이스를 초기화합니다.

### 2. 타입 자동 생성

데이터베이스의 roles와 scopes 테이블에서 데이터를 읽어와 TypeScript 타입을 자동으로 생성합니다.

```bash
# 타입 생성 스크립트 실행
npm run generate:scope-types
```

이 명령은 다음과 같은 작업을 수행합니다:

1. 데이터베이스에서 모든 roles와 scopes를 읽어옵니다
2. `apps/user-service/src/constants/db-scopes.constant.ts` 파일을 생성합니다
3. 타입 자동완성이 가능한 상수와 타입을 생성합니다

### 생성되는 파일 예시

```typescript
// apps/user-service/src/constants/db-scopes.constant.ts
export const DB_USER_SCOPES = {
  USER: {
    READ: { key: 'user:read', desc: '일반 사용자 조회 권한' },
    UPDATE: { key: 'users:update', desc: '일반 사용자 수정 권한' },
    // ...
  },
  ADMIN: {
    USER_MANAGE: { key: 'admin:users:manage', desc: '사용자 관리 권한' },
    // ...
  },
  // ...
} as const;

export type DBUserScope = // ... 타입 정의

export const DB_ROLES = {
  MASTER: { id: '...', name: 'master', description: '마스터' },
  USER: { id: '...', name: 'user', description: '일반 사용자' },
  // ...
} as const;

export const DB_ROLE_SCOPES = {
  MASTER: ['master'],
  USER: ['user:read', 'user:write', ...],
  // ...
} as const;
```

### 사용 예시

```typescript
import { DB_USER_SCOPES, DB_ROLES } from '../constants/db-scopes.constant';

// 타입 자동완성이 지원됩니다
const readPermission = DB_USER_SCOPES.USER.READ.key; // 'user:read'
const masterRole = DB_ROLES.MASTER.name; // 'master'
```

## 워크플로우

1. **개발 초기**: `USER_SCOPES` 상수를 수정하여 새로운 권한 추가
2. **시드 실행**: `npm run seed:user-service`로 데이터베이스 초기화
3. **타입 생성**: `npm run generate:scope-types`로 타입 파일 생성
4. **사용**: 생성된 타입을 import하여 타입 안전하게 사용
