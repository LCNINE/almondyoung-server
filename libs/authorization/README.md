# Authorization Module

MSA 환경에서 사용할 공통 인증/인가 모듈입니다. JWT 토큰의 roles를 기반으로 DB에서 scopes를 조회하여 권한을 검증합니다.

## 🚀 시작하기

```bash
# 1단계: Auth 스키마 생성 (DB마다 한 번만 실행)
npm run migrate:auth "postgresql://user:password@localhost:5432/your_database"

# 2단계: 전체 작동 예제 확인
cd apps/test-auth-scope
cat README.md
```

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

## 빠른 시작 (Quick Start)

```bash
# 1. DB에 auth 스키마 생성
npm run migrate:auth "postgresql://user:password@localhost:5432/your_db"

# 2. Scope 정의 파일 작성
# apps/your-service/src/auth/your-service.scopes.ts

# 3. AppModule에 통합
# - DbModule에 authorizationSchema 병합
# - AuthorizationModule.forRoot() 추가
# - APP_GUARD로 JwtAuthGuard + ScopeGuard 설정

# 4. 컨트롤러에서 사용
# @RequireScopes('resource:read')
```

전체 예제: `apps/test-auth-scope` 참조

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

**권장 방법**: 새로운 마이그레이션 스크립트 사용

```bash
# 프로젝트 루트에서 실행
npm run migrate:auth "postgresql://user:password@localhost:5432/your_database"

# 또는 환경 변수 사용
DATABASE_URL="postgresql://user:password@localhost:5432/your_database" npm run migrate:auth
```

**대체 방법**: drizzle-kit 직접 사용 (권장하지 않음)

```bash
cd libs/authorization
DATABASE_URL="postgresql://..." npx drizzle-kit generate
DATABASE_URL="postgresql://..." npx drizzle-kit migrate
```

이 명령은 PostgreSQL에 `auth` 스키마를 생성하고 다음 테이블을 만듭니다:
- `auth.roles` - 역할 정의
- `auth.scopes` - 권한 정의
- `auth.role_scope_mapping` - 역할-권한 매핑

**⚠️ 중요**: 마이그레이션은 마이크로서비스마다 한 번만 실행하면 됩니다. 모든 서비스가 같은 `auth` 스키마를 공유합니다.

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

### 런타임 스코프 체크

Guard 방식(`@RequireScopes()`)은 요청 시작 시 한 번만 체크하지만, 핸들러 내부에서 **조건부로 스코프를 확인**해야 할 때가 있습니다.

#### 사용 시나리오

- 조건부 데이터 필터링 (권한에 따라 다른 데이터 반환)
- 동적 권한 체크 (리소스 소유자 또는 관리자만 허용)
- 복잡한 비즈니스 로직 내 권한 분기

#### 헬퍼 메소드

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { AuthorizationService, UserWithRoles } from '@app/authorization';
import { User } from '@app/auth-core';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly authService: AuthorizationService,
  ) {}

  @Get(':id')
  async getProduct(
    @Param('id') id: string,
    @User() user: UserWithRoles,
  ) {
    const product = await this.productService.findOne(id);
    
    // 1. hasScope - 단일 스코프 체크
    const canViewSensitive = await this.authService.hasScope(user, 'product:admin');
    
    if (canViewSensitive) {
      return { ...product, cost: product.cost, margin: product.margin };
    }
    
    return product; // 일반 사용자는 민감 정보 제외
  }

  @Get()
  async listProducts(@User() user: UserWithRoles) {
    // 2. hasAnyScope - 여러 스코프 중 하나 (OR)
    const canViewAll = await this.authService.hasAnyScope(user, [
      'product:admin',
      'product:read-all',
    ]);
    
    if (canViewAll) {
      return this.productService.findAll(); // 모든 상품
    }
    
    return this.productService.findPublicOnly(); // 공개 상품만
  }

  @Delete(':id')
  async deleteProduct(
    @Param('id') id: string,
    @User() user: UserWithRoles,
  ) {
    const product = await this.productService.findOne(id);
    
    // 3. 복합 조건 - 소유자이거나 관리자 권한 보유
    const isOwner = product.createdBy === user.userId;
    const isAdmin = await this.authService.hasScope(user, 'product:delete-all');
    
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Not authorized to delete this product');
    }
    
    await this.productService.remove(id);
  }

  @Get('analytics')
  async getAnalytics(@User() user: UserWithRoles) {
    // 4. hasAllScopes - 모든 스코프 필요 (AND)
    const canViewAnalytics = await this.authService.hasAllScopes(user, [
      'product:read',
      'analytics:view',
    ]);
    
    if (!canViewAnalytics) {
      throw new ForbiddenException('Insufficient permissions');
    }
    
    return this.analyticsService.getProductAnalytics();
  }

  @Get('my-permissions')
  async getMyPermissions(@User() user: UserWithRoles) {
    // 5. getUserScopes - 사용자의 모든 스코프 조회
    const scopes = await this.authService.getUserScopes(user);
    return { scopes };
  }
}
```

#### Guard vs 런타임 체크 비교

| 구분 | Guard (`@RequireScopes()`) | 런타임 체크 (`authService.hasScope()`) |
|------|----------------------------|----------------------------------------|
| **시점** | 요청 시작 시 (핸들러 실행 전) | 핸들러 내부 (조건부) |
| **용도** | 엔드포인트 전체 보호 | 조건부 로직, 동적 체크 |
| **실패 시** | 403 Forbidden 자동 반환 | 개발자가 직접 처리 |
| **복잡도** | 간단 (데코레이터만) | 약간 복잡 (조건문 필요) |
| **유연성** | 낮음 (고정 스코프) | 높음 (동적 판단 가능) |

#### 권장 사용 패턴

```typescript
// ✅ 좋은 패턴: Guard로 기본 보호 + 런타임으로 세밀한 제어
@Get(':id')
@RequireScopes('resource:read')  // 최소 권한 체크 (Guard)
async getResource(@Param('id') id: string, @User() user: UserWithRoles) {
  const resource = await this.service.findOne(id);
  
  // 소유자가 아닌 경우 추가 권한 필요 (런타임)
  if (resource.ownerId !== user.userId) {
    const canViewOthers = await this.authService.hasScope(user, 'resource:read-all');
    if (!canViewOthers) {
      throw new ForbiddenException();
    }
  }
  
  return resource;
}

// ❌ 나쁜 패턴: 모든 로직을 런타임 체크로만 (Guard 미사용)
@Get(':id')  // Guard 없음 - 보안 취약
async getResource(@Param('id') id: string, @User() user: UserWithRoles) {
  const canView = await this.authService.hasScope(user, 'resource:read');
  if (!canView) {
    throw new ForbiddenException();
  }
  // ...
}
```

**💡 팁**: 
- 엔드포인트 전체를 보호할 때는 `@RequireScopes()` Guard 사용
- 핸들러 내부에서 조건부 로직이 필요할 때만 런타임 체크 사용
- 두 방식을 조합하면 가장 안전하고 유연한 권한 관리 가능

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

## 실제 작동 예제

완전히 작동하는 예제는 **`apps/test-auth-scope`** 참조:

```bash
# 1. 데이터베이스 생성
createdb test_auth_scope

# 2. Auth 스키마 마이그레이션
npm run migrate:auth "postgresql://user:password@localhost:5432/test_auth_scope"

# 3. Todo 앱 테이블 마이그레이션
cd apps/test-auth-scope
DATABASE_URL="postgresql://..." npx drizzle-kit migrate

# 4. e2e 테스트 실행
cd ../..
DATABASE_URL="postgresql://..." npx jest --config apps/test-auth-scope/test/jest-e2e.json --rootDir apps/test-auth-scope --runInBand
```

test-auth-scope는 다음을 검증합니다:
- ✅ JWT 기반 인증
- ✅ Scope 기반 인가 (`todo:read-all`)
- ✅ 일반 사용자 vs 관리자 권한 분리
- ✅ 사용자 격리 (자신의 데이터만 접근)
- ✅ 16개 e2e 테스트 모두 통과

자세한 내용은 `apps/test-auth-scope/README.md` 참조

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
- auth 스키마 마이그레이션을 실행하지 않음

**해결**:
```bash
# auth 스키마가 있는지 확인
psql -U postgres -d your_db -c "\dn"

# auth 스키마가 없으면 마이그레이션 실행
npm run migrate:auth "postgresql://user:password@localhost:5432/your_db"

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

### 4. "auth.scopes relation does not exist" 에러

**증상**: DB 쿼리 실패

**원인**: auth 스키마가 DB에 생성되지 않음

**해결**:
```bash
# auth 스키마 마이그레이션 실행
npm run migrate:auth "postgresql://user:password@localhost:5432/your_db"
```

### 5. 테스트에서 401 Unauthorized

**증상**: JWT 토큰을 전달했는데도 401 에러

**원인**: cookie-parser 미들웨어가 테스트 앱에 추가되지 않음

**해결**:
```typescript
// e2e 테스트 beforeAll
const cookieParser = require('cookie-parser');
app.use(cookieParser());
```

### 6. 여러 DB에서 auth 스키마를 사용하고 싶음

**해결**: 각 DB마다 한 번씩 마이그레이션 실행
```bash
# DB1
npm run migrate:auth "postgresql://user:password@localhost:5432/db1"

# DB2
npm run migrate:auth "postgresql://user:password@localhost:5432/db2"

# DB3
npm run migrate:auth "postgresql://user:password@localhost:5432/db3"
```

모든 DB가 동일한 auth 스키마 구조를 가지지만, 데이터(roles, scopes, mappings)는 독립적입니다.

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

## 마이그레이션 스크립트

`npm run migrate:auth` 명령어는 `libs/authorization/scripts/migrate-auth-schema.ts`를 실행합니다.

이 스크립트는:
- ✅ `auth` 스키마 생성
- ✅ `auth.roles` 테이블 생성
- ✅ `auth.scopes` 테이블 생성
- ✅ `auth.role_scope_mapping` 테이블 생성
- ✅ 멱등성 보장 (여러 번 실행해도 안전)

**장점**:
- 간단한 명령어 하나로 모든 DB 초기화
- 환경 변수 또는 인자로 DATABASE_URL 전달 가능
- 여러 마이크로서비스/DB에서 재사용 가능

## 관련 모듈

- **@app/auth-core**: JWT 토큰 검증 (인증)
- **@app/authorization**: Role-Scope 기반 권한 검증 (인가)
- **@app/db**: Drizzle ORM 기반 DB 연결

## 라이센스

UNLICENSED

---

**문의**: 구현 관련 질문은 팀 슬랙 채널에서

