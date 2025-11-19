# Authorization Module

MSA 환경에서 사용할 공통 인증/인가 모듈입니다. JWT 토큰의 roles를 기반으로 DB에서 scopes를 조회하여 권한을 검증합니다.

## 특징

- ✅ JWT roles 기반 권한 검증
- ✅ DB 기반 role-scope 매핑 (실시간 권한 변경 가능)
- ✅ 인메모리 캐싱으로 성능 최적화
- ✅ 앱 시작 시 자동 scope 등록
- ✅ `@RequireScopes()` 데코레이터로 간편한 사용
- ✅ PostgreSQL `auth` 스키마 분리

## 아키텍처 결정

| 항목 | 설명 |
|------|------|
| **DB 연결** | 기존 DbModule 재사용 (각 마이크로서비스가 authSchema 병합) |
| **캐싱** | 인메모리 Map 기반 (role[] → scope[] 매핑) |
| **Scope 등록** | 앱 시작 시 자동 등록 (OnModuleInit) |
| **JWT Payload** | roles만 포함 (scopes는 런타임 DB 조회) |
| **Admin API** | role-scope 매핑 CRUD만 제공 (scope 자체는 코드 관리) |

## 설치 및 설정

### 1. tsconfig.json에 경로 추가 (이미 완료됨)

```json
{
  "paths": {
    "@app/authorization": ["libs/authorization/src"],
    "@app/authorization/*": ["libs/authorization/src/*"]
  }
}
```

### 2. DB 마이그레이션 실행

```bash
cd libs/authorization
npx drizzle-kit generate
npx drizzle-kit migrate
```

이 명령은 PostgreSQL에 `auth` 스키마를 생성하고 다음 테이블을 만듭니다:
- `auth.roles` - 역할 정의
- `auth.scopes` - 권한 정의
- `auth.role_scope_mapping` - 역할-권한 매핑

### 3. Scope 정의 파일 작성

각 마이크로서비스에서 자신의 scope를 정의합니다.

```typescript
// apps/your-service/src/auth/your-service.scopes.ts
import { ScopeDefinition } from '@app/authorization';

export const YOUR_SERVICE_SCOPES: ScopeDefinition[] = [
  { key: 'resource:read', category: 'resource', description: '리소스 조회' },
  { key: 'resource:write', category: 'resource', description: '리소스 생성/수정' },
  { key: 'resource:delete', category: 'resource', description: '리소스 삭제' },
];
```

**Scope 명명 규칙**:
- 형식: `{resource}:{action}`
- 예시: `product:read`, `order:write`, `user:delete`
- 특수 scope: `master` (모든 권한 통과)

### 4. AppModule 설정

```typescript
// apps/your-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '@app/db';
import { AuthCoreModule, JwtAuthGuard } from '@app/auth-core';
import { AuthorizationModule, ScopeGuard, authorizationSchema } from '@app/authorization';
import { yourServiceSchema } from './schema';
import { YOUR_SERVICE_SCOPES } from './auth/your-service.scopes';

// 서비스 스키마와 auth 스키마 병합
const combinedSchema = {
  ...yourServiceSchema,
  ...authorizationSchema,
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule.forRoot({
      config: { connectionString: process.env.DATABASE_URL },
      schema: combinedSchema, // 병합된 스키마 사용
    }),
    AuthCoreModule.forRootAsync(), // JWT 인증
    AuthorizationModule.forRoot({  // Scope 인가
      microserviceName: 'your-service',
      scopes: YOUR_SERVICE_SCOPES,
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // 1단계: JWT 인증
    },
    {
      provide: APP_GUARD,
      useClass: ScopeGuard,   // 2단계: Scope 인가
    },
  ],
})
export class AppModule {}
```

## 사용법

### 컨트롤러에서 권한 검증

```typescript
import { Controller, Get, Post, Delete } from '@nestjs/common';
import { RequireScopes } from '@app/authorization';

@Controller('products')
export class ProductsController {
  
  // 인증만 필요 (scope 체크 없음)
  @Get('public')
  async getPublicProducts() {
    return { message: 'Anyone with JWT can access' };
  }

  // 'product:read' scope 필요
  @Get()
  @RequireScopes('product:read')
  async findAll() {
    return { message: 'List products' };
  }

  // 'product:write' scope 필요
  @Post()
  @RequireScopes('product:write')
  async create() {
    return { message: 'Create product' };
  }

  // 'product:delete' scope 필요
  @Delete(':id')
  @RequireScopes('product:delete')
  async remove() {
    return { message: 'Delete product' };
  }
}
```

### 여러 scope 중 하나만 있으면 통과

```typescript
@Get('admin')
@RequireScopes('admin:read', 'master')
async getAdminData() {
  // 'admin:read' 또는 'master' scope가 있으면 통과
}
```

## 동작 원리

### 1. 앱 시작 시 (Bootstrap)

```
App Start
  ↓
ScopeBootstrapService.onModuleInit()
  ↓
DB에 scope 등록 (없는 것만 INSERT)
  ↓
Ready
```

### 2. 요청 처리 흐름

```
HTTP Request
  ↓
JwtAuthGuard (auth-core)
  ├─ 쿠키에서 JWT 토큰 추출
  ├─ 토큰 검증
  └─ req.user = { userId, roles, email, ... }
  ↓
ScopeGuard (authorization)
  ├─ @RequireScopes() 메타데이터 읽기
  ├─ req.user.roles → DB 조회 → scopes (캐싱)
  ├─ requiredScopes vs userScopes 비교
  └─ true/false 반환
  ↓
Controller Method 실행
```

### 3. 캐싱 메커니즘

```typescript
// 캐시 키: "admin,manager" (정렬된 roles)
// 캐시 값: Set<string> { "product:read", "product:write", ... }

// 첫 요청: DB 조회 + 캐시 저장
getScopesByRoles(['admin', 'manager']) → DB Query → Cache

// 이후 요청: 캐시에서 바로 반환
getScopesByRoles(['admin', 'manager']) → Cache Hit
```

**캐시 무효화**: role-scope 매핑 변경 시 `authService.invalidateCache()` 호출

## Admin API로 권한 관리

Scope 자체는 코드로 관리하지만, **role-scope 매핑은 Admin API**로 관리합니다.

user-service에서 제공할 API (예시):

```typescript
// Role 생성
POST /admin/roles
{
  "name": "product_manager",
  "description": "상품 관리자"
}

// Role에 Scope 추가
POST /admin/roles/:roleId/scopes
{
  "scopeKeys": ["product:read", "product:write", "category:read"]
}

// Role의 Scope 조회
GET /admin/roles/:roleId/scopes

// Role에서 Scope 제거
DELETE /admin/roles/:roleId/scopes/:scopeId
```

## 데이터베이스 스키마

### auth.roles

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | Primary Key |
| name | varchar(50) | 역할 이름 (unique) |
| description | text | 설명 |
| created_at | timestamp | 생성일시 |
| updated_at | timestamp | 수정일시 |

### auth.scopes

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | Primary Key |
| key | varchar(100) | Scope 키 (unique) |
| category | varchar(50) | 카테고리 |
| description | text | 설명 |
| microservice_name | varchar(50) | 서비스명 |
| created_at | timestamp | 생성일시 |

### auth.role_scope_mapping

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | Primary Key |
| role_id | uuid | Foreign Key → roles.id |
| scope_id | uuid | Foreign Key → scopes.id |
| created_at | timestamp | 생성일시 |

**Unique Constraint**: (role_id, scope_id)

## 예시: PIM 서비스

### Scope 정의

```typescript
// apps/pim/src/auth/pim.scopes.ts
export const PIM_SCOPES: ScopeDefinition[] = [
  { key: 'product:read', category: 'product', description: '상품 조회' },
  { key: 'product:write', category: 'product', description: '상품 생성/수정' },
  { key: 'product:delete', category: 'product', description: '상품 삭제' },
  { key: 'category:read', category: 'category', description: '카테고리 조회' },
  { key: 'category:write', category: 'category', description: '카테고리 생성/수정' },
];
```

### 통합 예시

전체 통합 예시는 `apps/pim/src/auth/pim.module.example.ts`와 `controller.example.ts` 참조

## 테스트

### Unit Test

```typescript
describe('AuthorizationService', () => {
  it('should cache scope lookups', async () => {
    const scopes1 = await service.getScopesByRoles(['admin']);
    const scopes2 = await service.getScopesByRoles(['admin']);
    
    // 두 번째 호출은 캐시에서 반환 (DB 호출 안 함)
    expect(scopes1).toBe(scopes2);
  });
});
```

### Integration Test

```typescript
describe('ScopeGuard', () => {
  it('should allow access with correct scope', async () => {
    // JWT with roles: ['product_manager']
    // DB: product_manager has 'product:read' scope
    
    const result = await request(app.getHttpServer())
      .get('/products')
      .set('Cookie', `accessToken=${validToken}`)
      .expect(200);
  });
});
```

## 마이그레이션 경로

### 기존 시스템에서 전환

**Phase 1**: 새 서비스에 적용
- PIM, WMS → authorization 모듈 사용

**Phase 2**: 기존 서비스 전환
- Wallet, Membership 전환

**Phase 3**: user-service 마이그레이션 (별도 계획)
- 기존 `libs/roles` 대체

## 트러블슈팅

### 1. "Required scope" 에러

**증상**: 403 Forbidden, scope가 있는데도 접근 불가

**원인**: 캐시가 오래된 매핑 정보를 가지고 있음

**해결**:
```typescript
// Admin API에서 매핑 변경 후 캐시 무효화
await authService.invalidateCache();
```

### 2. Scope가 DB에 등록되지 않음

**증상**: 앱 시작 시 scope가 DB에 추가되지 않음

**원인**: 
- DATABASE_URL 환경 변수 누락
- DB 연결 실패

**확인**:
```bash
# 로그 확인
[ScopeBootstrapService] Initializing scopes for pim...
[ScopeBootstrapService] Registered 5 new scopes for pim
```

### 3. 타입 에러: authorizationSchema를 찾을 수 없음

**해결**:
```bash
# tsconfig 경로 확인
npm run build

# 또는 IDE 재시작
```

## API Reference

### AuthorizationService

```typescript
class AuthorizationService {
  // roles → scopes 조회 (캐싱)
  getScopesByRoles(roleNames: string[]): Promise<Set<string>>
  
  // 캐시 무효화
  invalidateCache(): void
  
  // Scope 등록 (앱 시작 시 자동 호출)
  ensureScopesExist(microserviceName: string, scopeDefs: ScopeDefinition[]): Promise<void>
}
```

### ScopeGuard

```typescript
class ScopeGuard implements CanActivate {
  // 권한 검증
  canActivate(context: ExecutionContext): Promise<boolean>
}
```

### @RequireScopes()

```typescript
// 단일 scope
@RequireScopes('product:read')

// 여러 scope (OR 조건)
@RequireScopes('product:read', 'admin:read')
```

## 관련 모듈

- **@app/auth-core**: JWT 토큰 검증 (인증)
- **@app/authorization**: Role-Scope 기반 권한 검증 (인가)
- **@app/db**: Drizzle ORM 기반 DB 연결

## 라이센스

UNLICENSED

---

**문의**: 구현 관련 질문은 팀 슬랙 채널에서

