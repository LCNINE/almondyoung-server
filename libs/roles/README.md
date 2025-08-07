# Roles Library

사용자 권한 및 스코프 관리를 위한 NestJS 라이브러리입니다.

## 기능

- 사용자 스코프 기반의 권한 관리
- 데코레이터를 통한 간편한 권한 체크
- Guard를 통한 자동 권한 검증

## 디렉토리 구조

```
src/
├── constants/           # 상수 및 타입 정의
│   └── scopes.constant.ts  # 스코프 상수, 스키마, 타입 정의
├── decorators/         # 커스텀 데코레이터
├── guards/             # 권한 검증 가드
└── index.ts           # 라이브러리 엔트리 포인트
```

## 사용 방법

### 1. 모듈 임포트

```typescript
import { RolesModule } from '@libs/roles';

@Module({
  imports: [RolesModule],
})
export class AppModule {}
```

### 2. 스코프 정의

현재 정의된 스코프:

```typescript
// @/constants/scopes.constant.ts
export const USER_SCOPES = {
  USER: {
    READ: 'user:read', // 사용자 조회 권한
    UPDATE: 'users:update', // 사용자 수정 권한
    DELETE: 'users:delete', // 사용자 삭제 권한
    WRITE: 'users:write', // 사용자 생성 권한
  },
  MASTER: 'master', // 모든 권한
} as const;

// Zod 스키마를 통한 타입 검증
export const UserScopeSchema = z.enum([
  USER_SCOPES.USER.READ,
  USER_SCOPES.USER.UPDATE,
  USER_SCOPES.USER.DELETE,
  USER_SCOPES.USER.WRITE,
  USER_SCOPES.MASTER,
]);

// 타입 추론
export type UserScope = z.infer<typeof UserScopeSchema>;

// 스코프 설명
export const SCOPE_DESCRIPTIONS: Record<UserScope, string> = {
  [USER_SCOPES.USER.READ]: '일반 사용자 조회 권한',
  [USER_SCOPES.USER.UPDATE]: '일반 사용자 수정 권한',
  [USER_SCOPES.USER.DELETE]: '일반 사용자 삭제 권한',
  [USER_SCOPES.USER.WRITE]: '일반 사용자 작성 권한',
  [USER_SCOPES.MASTER]: '모든 권한',
} as const;
```

### 3. 가드 사용하기

#### 3.1 컨트롤러에 가드 적용

```typescript
import { RequireScopes } from '@libs/roles';
import { USER_SCOPES } from '@libs/roles';

@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  @Get()
  @RequireScopes([USER_SCOPES.USER.READ])
  findAll() {
    // 사용자 조회 권한이 있는 사용자만 접근 가능
  }

  @Post()
  @RequireScopes([USER_SCOPES.USER.WRITE])
  create() {
    // 사용자 생성 권한이 있는 사용자만 접근 가능
  }
}
```

#### 3.2 가드 동작 방식

1. `@RequireScopes` 데코레이터를 통해 필요한 스코프를 지정
2. `RolesGuard`가 요청의 JWT 토큰에서 사용자 스코프를 확인
3. 다음과 같은 순서로 권한 검증:
   - 필수 스코프가 지정되지 않은 경우 → 접근 허용
   - 사용자가 'master' 스코프를 가진 경우 → 모든 접근 허용
   - 사용자가 필요한 스코프 중 하나 이상을 가진 경우 → 접근 허용
   - 그 외의 경우 → 접근 거부

## API 문서

### 데코레이터

#### @RequireScopes(scopes: UserScope[])

- 설명: 해당 엔드포인트에 접근하기 위해 필요한 스코프를 지정
- 매개변수:
  - scopes: 필요한 스코프 배열
- 사용 예:
  ```typescript
  @RequireScopes([USER_SCOPES.USER.READ])
  ```

### 가드

#### RolesGuard

- 설명: 사용자의 스코프를 검증하는 가드
- 기능:
  - JWT 토큰에서 사용자 정보 추출
  - 필요한 스코프와 사용자의 스코프 비교
  - 권한 검증 로직 수행
