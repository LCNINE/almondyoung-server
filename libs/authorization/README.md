# Authorization Module

JWT 인증과 권한 기반 라우트 판정을 서비스에 붙이는 공용 라이브러리. 모델은 `docs/adr/0048-admin-permission-model.md` 가 정본이다.

## 구성

- `AuthorizationModule.forAuthOnly()` — JWT 인증(`JwtAuthGuard`·`AuthenticationService`)만 등록한다. 유일한 등록 방식이다.
- `PermissionModule` — 역할별 권한 사본을 받아 `PermissionGuard`·`PermissionCheckpoints` 로 판정한다.
- `permissions/permission-catalog.ts` — 권한 키 목록과 첫 등록 때의 부여.

## 환경 변수

둘 중 하나는 필수다(둘 다 있으면 dual-mode).

```
AUTH_SECRET=...                 # HS256
OIDC_ISSUER_URL=https://...     # RS256, ${OIDC_ISSUER_URL}/.well-known/jwks.json
JWT_ISSUER / JWT_AUDIENCE / ALLOWED_AUDIENCES   # 선택
```

## 라우트 선언

새 HTTP 라우트는 아래 중 하나를 단다. 없으면 `scripts/security/route-classification.spec.ts` 가 빨갛다.

| 데코레이터 | 뜻 |
|-----------|----|
| `@Public` · `@InternalOnly` · `@OptionalAuth` | 공개·내부·선택 인증 |
| `@StoreRoute` | 고객. 로그인한 계정이 자기 데이터만 다룬다(대상은 토큰의 사용자) |
| `@KeyAuthRoute` | 머천트 키 인증 |
| `@RequirePermission('영역.대상.행동')` | 관리자 권한 |

핸들러 안의 조건 판정은 `PermissionCheckpoints.check` / `checkRoute` 로 권한만 보고 한다. 코드는 역할 이름을 보지 않는다.

## 예시

```typescript
@Controller('admin/orders')
export class OrdersController {
  @Get()
  @RequirePermission('order.order.read')
  list() { /* ... */ }
}

@Controller('me')
export class MeController {
  @Get()
  @StoreRoute()
  me(@User() user: JwtPayload) { /* user.id 로만 자기 데이터를 고른다 */ }
}
```
