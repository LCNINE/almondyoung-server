# Roles Library

이 라이브러리는 사용자 권한 및 스코프 관리를 위한 핵심 기능을 제공합니다.

## 주요 기능

- 사용자 권한(Role) 관리
- 스코프 기반 권한 검증
- 권한 데코레이터 및 가드 제공

## 사용 방법

### 1. 스코프 타입 생성

데이터베이스에 저장된 권한과 스코프 정보를 TypeScript 타입으로 생성하려면 다음 명령어를 실행하세요:

```bash
npm run gen:scope-types
```

이 명령어는 다음과 같은 작업을 수행합니다:

- 데이터베이스에서 모든 roles와 scopes 정보를 조회
- 스코프를 카테고리별로 그룹화
- `libs/roles/src/constants/index.ts` 파일에 타입 정의를 생성
- 생성된 타입은 `USER_SCOPES` 상수와 `UserScope` 타입을 포함

### 2. 데코레이터 사용

```typescript
import { Scopes } from '@app/roles';


@UseGuards(AuthorizationGuard)
export class UserController {
  // ...
  // authorization-guard.ts에서 jwt토큰에 담겨있는 값에 master가 있으면 통과시키는걸 하고있기 때문에
  // 여기서 'master'를 적어줄 필요는 없지만, 다른 개발자가 코드를 읽을때 명시적으로 알 수 있어서, 적어주는게 좋습니다.
   @RequireScopes(['master','user:read'])
    async findOne(...){
        ...
    }
}

@UseGuards(AuthorizationGuard)
export class AdminController {
    // ...
    @RequireScopes(['master','admin:read'])
    async findOne(...){
        ...
    }
}
```

### 3. 가드 설정

```typescript
import { AuthorizationGuard } from '@app/roles';

@UseGuards(AuthorizationGuard)
export class AppModule {
  // ...
  async Post(...){
    ...
  }
}
```

## 디렉토리 구조

```
libs/roles/
├── src/
│   ├── constants/        # 스코프 상수 및 타입 정의
│   ├── decorators/      # 스코프 데코레이터
│   ├── guards/          # 권한 검증 가드
│   ├── index.ts         # 공개 API
│   └── roles.module.ts  # 모듈 정의
└── README.md
```

## 주의사항

1. `gen:scope-types` 명령어는 데이터베이스 연결이 필요하므로, 올바른 환경변수(`DATABASE_URL`)가 설정되어 있어야 합니다.
2. 스코프 변경 시 반드시 `gen:scope-types`를 실행하여 타입 정의를 업데이트해야 합니다.
3. 권한 검증은 런타임에 이루어지므로, 타입 체크만으로는 완벽한 보안을 보장할 수 없습니다.
