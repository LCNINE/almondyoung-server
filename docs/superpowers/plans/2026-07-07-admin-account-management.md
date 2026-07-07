# 관리자 계정 관리 (master 전용) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** master 만 새 관리자 계정을 랜덤 초기비번으로 만들고 역할을 부여/박탈하며, non-master admin 은 일반 회원만 다루되 권한 밖 버튼으로 403 을 만나지 않게 한다.

**Architecture:** ① user-service 에 `must_change_password` 컬럼 + 랜덤 초기비번 생성/첫로그인 강제변경, ② admin-web 에서 관리자 계정 화면(`/users`)을 role(`master`) 기준 메뉴·페이지 게이팅, ③ OIDC access token 에 `must_change_password` claim 을 실어 admin-web middleware 가 첫 로그인 시 비번변경 페이지로 강제 redirect.

**Tech Stack:** NestJS + Drizzle ORM(postgres.js), user-service(Fastify) / admin-web(Next.js App Router, jose, TanStack Query, shadcn/ui).

**참고 스펙:** `docs/superpowers/specs/2026-07-07-admin-account-management-design.md`

**공통 제약(memory):** jest 전체 스위트 일괄 실행 금지(OOM) — `--testPathPattern` 으로 좁혀 실행. 타입체크/빌드는 OK. 마이그레이션은 `schema.ts` + 생성 SQL + `drizzle/meta` 를 한 커밋에.

---

## 파일 구조 (생성/수정 지도)

**user-service (백엔드)**
- `apps/user-service/database/drizzle/schema.ts` — `users.mustChangePassword` 컬럼 (수정)
- `apps/user-service/database/drizzle/<ts>_add-must-change-password.sql` + `meta/` — 마이그레이션 (생성)
- `apps/user-service/src/api/admin/auth/lib/generate-initial-password.ts` — 랜덤 비번 유틸 (생성)
- `apps/user-service/src/api/admin/auth/lib/generate-initial-password.spec.ts` — 유틸 테스트 (생성)
- `apps/user-service/src/api/admin/auth/dto/create-account-dto.ts` — password 필드 제거 (수정)
- `apps/user-service/src/api/admin/auth/auth.service.ts` — 랜덤비번·플래그·`{user,initialPassword}` 반환·ConflictError (수정)
- `apps/user-service/src/api/admin/auth/auth.controller.ts` — try/catch 제거·master 전용 (수정)
- `apps/user-service/src/api/auth/auth.service.ts` — self 변경 성공 시 플래그 클리어 (수정, `changePassword` ~939)
- `apps/user-service/src/api/oauth/oauth.manager.ts` — access token 에 `must_change_password` claim (수정, `mintTokenPair` ~264)

**admin-web (프론트)**
- `apps/admin-web/src/lib/utils/menu.ts` — `MenuItem.requireRole` + `admin-accounts` 게이팅 (수정)
- `apps/admin-web/src/components/layout/app-sidebar.tsx` — role 필터 (수정)
- `apps/admin-web/src/app/(admin)/users/page.tsx` — RouteGuard `['master']` (수정)
- `apps/admin-web/src/app/(admin)/users/[id]/page.tsx` — RouteGuard `['master']` 추가 (수정)
- `apps/admin-web/src/lib/api/domains/users/index.ts` — `createAdminAccount` 클라이언트 (수정)
- `apps/admin-web/src/lib/services/users/mutations.ts` — `useCreateAdminAccount` (수정)
- `apps/admin-web/src/features/users/components/create-admin-dialog/index.tsx` — 생성 다이얼로그 + 초기비번 노출 (생성)
- `apps/admin-web/src/features/users/components/table/index.tsx` — "관리자 추가" 버튼 (수정)
- `apps/admin-web/src/lib/auth/get-token-payload.ts` — `must_change_password` 추가 (수정)
- `apps/admin-web/src/middleware.ts` — 첫로그인 강제 redirect (수정)
- `apps/admin-web/src/app/(admin)/account/change-password/page.tsx` — 강제 비번변경 페이지 (생성)

---

## Task 1: `must_change_password` 컬럼 추가

**Files:**
- Modify: `apps/user-service/database/drizzle/schema.ts:82-95` (users 테이블)
- Generate: `apps/user-service/database/drizzle/<ts>_add-must-change-password.sql`

- [ ] **Step 1: users 테이블에 컬럼 추가**

`apps/user-service/database/drizzle/schema.ts` 의 `users` 정의에서 `deletedAt` 다음, `...timestampColumns` 앞에 추가:

```typescript
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  loginId: varchar('login_id', { length: 30 }).notNull().unique(),
  username: varchar('username', { length: 30 }).notNull(),
  nickname: varchar('nickname', { length: 30 }).notNull(),
  email: varchar('email', { length: 60 }).notNull().unique(),
  password: varchar('password', { length: 255 }),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  lastActivityAt: timestamp('last_activity_at')
    .default(sql`now()`)
    .notNull(),
  deletedAt: timestamp('deleted_at'),
  ...timestampColumns,
});
```

(`boolean` 은 이 파일에서 이미 import 되어 사용 중이라 추가 import 불필요.)

- [ ] **Step 2: 마이그레이션 생성**

Run: `npm run db:generate:user-service -- --name add-must-change-password`
Expected: `apps/user-service/database/drizzle/<timestamp>_add-must-change-password.sql` 생성. 내용은 `ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;` 한 줄 (additive). rename 프롬프트가 뜨면 안 됨 — 뜨면 취소하고 컬럼명을 재확인.

- [ ] **Step 3: 생성 SQL 검토**

`apps/user-service/database/drizzle/<timestamp>_add-must-change-password.sql` 를 열어 additive `ADD COLUMN` 만 있는지 확인. `DROP`/`ALTER TYPE` 등이 섞이면 잘못된 것이니 그 SQL 을 `git rm` 하고 schema.ts 를 고쳐 재생성.

- [ ] **Step 4: 로컬 적용**

Run: `npm run db:setup -- --stage dev --deployment lcnine-auth`
(user-service 는 lcnine-auth 소유. 인터랙티브 — 시드 그룹 프롬프트엔 기본값 응답.)
Expected: 새 마이그레이션이 적용되고 에러 없이 종료.

- [ ] **Step 5: 커밋**

```bash
git add apps/user-service/database/drizzle/schema.ts apps/user-service/database/drizzle/
git commit -m "[user-service] users.must_change_password 컬럼 추가"
```

---

## Task 2: 랜덤 초기비번 생성 유틸 (TDD)

**Files:**
- Create: `apps/user-service/src/api/admin/auth/lib/generate-initial-password.ts`
- Test: `apps/user-service/src/api/admin/auth/lib/generate-initial-password.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/user-service/src/api/admin/auth/lib/generate-initial-password.spec.ts`:

```typescript
import { generateInitialPassword } from './generate-initial-password';

const POLICY = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).+$/;

describe('generateInitialPassword', () => {
  it('16자 이상이고 비번 정책(영문+숫자+특수문자)을 만족한다', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateInitialPassword();
      expect(pw.length).toBeGreaterThanOrEqual(16);
      expect(pw.length).toBeLessThanOrEqual(20);
      expect(POLICY.test(pw)).toBe(true);
    }
  });

  it('호출마다 다른 값을 만든다', () => {
    const a = generateInitialPassword();
    const b = generateInitialPassword();
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --testPathPattern=generate-initial-password --runInBand`
Expected: FAIL — `Cannot find module './generate-initial-password'`.

- [ ] **Step 3: 유틸 구현**

`apps/user-service/src/api/admin/auth/lib/generate-initial-password.ts`:

```typescript
import * as crypto from 'crypto';

const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SPECIAL = '!@#$%^&*()_+-=';
const ALL = LOWER + UPPER + DIGIT + SPECIAL;

function pick(chars: string): string {
  return chars[crypto.randomInt(chars.length)];
}

/**
 * 관리자 계정 생성 시 서버가 발급하는 1회용 초기 비밀번호.
 * create-account/change-password DTO 의 비번 정책(영문+숫자+특수문자, 8-20자)을 항상 만족한다.
 */
export function generateInitialPassword(): string {
  const length = 16;
  // 각 카테고리 최소 1개 보장
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SPECIAL)];
  const rest = Array.from({ length: length - required.length }, () => pick(ALL));
  const chars = [...required, ...rest];
  // Fisher-Yates 셔플 (required 문자가 항상 앞에 오지 않도록)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=generate-initial-password --runInBand`
Expected: PASS (2 passing).

- [ ] **Step 5: 커밋**

```bash
git add apps/user-service/src/api/admin/auth/lib/
git commit -m "[user-service] 초기비번 생성 유틸 추가 (TDD)"
```

---

## Task 3: CreateAccountDto 에서 password 제거

**Files:**
- Modify: `apps/user-service/src/api/admin/auth/dto/create-account-dto.ts:47-59`

- [ ] **Step 1: password 필드 삭제**

`create-account-dto.ts` 에서 아래 블록(줄 47-59, `@ApiProperty({ description: '비밀번호...' }) ... password: string;`)을 통째로 삭제한다. `IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength` import 는 나머지 필드(username/loginId/email/roleId/phone_number)가 여전히 쓰므로 유지. 최종 DTO 필드: `username, nickname, loginId, email, roleId, phone_number?`.

- [ ] **Step 2: 타입체크**

Run: `npx nest build user-service`
Expected: `auth.service.ts` 에서 `password` 를 구조분해하는 코드가 아직 남아 컴파일 에러가 날 수 있음 — Task 4 에서 함께 고친다. 지금은 에러가 나면 다음 태스크로 진행(같은 커밋으로 묶음).

- [ ] **Step 3: 커밋 보류**

Task 4 와 한 커밋으로 묶는다 (DTO·서비스·컨트롤러가 함께 바뀌어야 빌드가 성립).

---

## Task 4: createAccount — 랜덤비번·플래그·initialPassword 반환 + 컨트롤러 정리 + master 전용

**Files:**
- Modify: `apps/user-service/src/api/admin/auth/auth.service.ts:24-92`
- Modify: `apps/user-service/src/api/admin/auth/auth.controller.ts:13-24`

- [ ] **Step 1: 서비스 createAccount 수정**

`auth.service.ts` 상단 import 에 추가:

```typescript
import { ConflictError } from '@app/shared';
import { generateInitialPassword } from './lib/generate-initial-password';
```

`createAccount` + `_createAccountWithTransaction` 를 아래로 교체 (기존 unreachable `return;` 잔재 제거, `throw new Error` → `ConflictError`, 트랜잭션 안에서 랜덤비번 생성·플래그·반환):

```typescript
async createAccount(createAccountDto: CreateAccountDto, tx?: DbTransaction) {
  const { loginId, email } = createAccountDto;

  if (await this.usersService.findUserByLoginId(loginId)) {
    throw new ConflictError('이미 존재하는 로그인 ID 입니다.');
  }
  if (await this.usersService.findUserByEmail(email)) {
    throw new ConflictError('이미 존재하는 이메일 입니다.');
  }

  if (tx) {
    return this._createAccountWithTransaction(createAccountDto, tx);
  }
  return this.dbService.db.transaction((newTx) =>
    this._createAccountWithTransaction(createAccountDto, newTx),
  );
}

private async _createAccountWithTransaction(createAccountDto: CreateAccountDto, tx: DbTransaction) {
  const client = this.getClient(tx);
  const { loginId, roleId, phone_number, email, username, nickname } = createAccountDto;

  const initialPassword = generateInitialPassword();
  const hash = await bcrypt.hash(initialPassword, 10);

  const [user] = await client
    .insert(userServiceSchema.users)
    .values({
      username,
      nickname,
      loginId,
      password: hash,
      isEmailVerified: true,
      mustChangePassword: true,
      email,
    })
    .returning();

  await this.usersService.assignUserRole(user.id, roleId, tx);
  await this.usersService.updateMyProfile(user.id, { phoneNumber: phone_number }, tx);

  return { user, initialPassword };
}
```

- [ ] **Step 2: 컨트롤러 정리 (try/catch 제거 + master 전용)**

`auth.controller.ts` 의 `createAccount` 를 교체. 프로젝트 규칙(컨트롤러는 error→status 매핑용 try/catch 금지, 글로벌 필터가 `ConflictError`→409 처리)에 맞춘다:

```typescript
@Post()
@RequireScopes('master')
async createAccount(@Body() createAccountDto: CreateAccountDto) {
  return this.authService.createAccount(createAccountDto);
}
```

`HttpException, HttpStatus` import 가 `changePassword` 에서 아직 쓰이면 유지, 안 쓰이면 제거. (`changePassword` 컨트롤러는 이번 범위 밖 — 그대로 둔다.)

- [ ] **Step 3: 빌드/타입체크**

Run: `npx nest build user-service`
Expected: PASS. `@app/shared` 의 `ConflictError` 존재 확인(다른 서비스에서 널리 사용). 실패 시 import 경로 점검.

- [ ] **Step 4: 커밋 (Task 3 + 4 묶음)**

```bash
git add apps/user-service/src/api/admin/auth/
git commit -m "[user-service] 관리자 계정 생성 시 서버 랜덤 초기비번 발급 + master 전용"
```

---

## Task 5: self 비번변경 성공 시 플래그 클리어

**Files:**
- Modify: `apps/user-service/src/api/auth/auth.service.ts:967-971` (`changePassword` 의 update)

- [ ] **Step 1: update set 에 플래그 추가**

`auth.service.ts` self `changePassword(currentPassword, newPassword, userId, tx?)` 끝부분 update 문을 교체:

```typescript
const hash = await bcrypt.hash(newPassword, saltOrRounds);

await client
  .update(userServiceSchema.users)
  .set({ password: hash, mustChangePassword: false })
  .where(eq(userServiceSchema.users.id, userId));
```

- [ ] **Step 2: 빌드**

Run: `npx nest build user-service`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add apps/user-service/src/api/auth/auth.service.ts
git commit -m "[user-service] self 비번변경 성공 시 must_change_password 클리어"
```

---

## Task 6: access token 에 `must_change_password` claim

**Files:**
- Modify: `apps/user-service/src/api/oauth/oauth.manager.ts:260-278` (`mintTokenPair`)

- [ ] **Step 1: claim 주입**

`mintTokenPair` 에서 `user` 는 이미 `findUserById(userId)` 로 조회됨(줄 260). access token 서명 payload 의 user claim 블록에 `must_change_password` 추가:

```typescript
const accessToken = await this.jwtService.signAsync(
  {
    sub: userId,
    client_id: clientId,
    scope: scope ?? undefined,
    ...(user
      ? {
          email: user.email,
          login_id: user.loginId,
          roles,
          must_change_password: user.mustChangePassword ?? false,
        }
      : {}),
  },
  { audience: clientId, expiresIn: JWT_ACCESS_TOKEN_EXPIRATION },
);
```

(`findUserById` 가 users 행 전체를 반환하므로 Task 1 이후 `user.mustChangePassword` 가 타입에 포함된다. 만약 `findUserById` 가 특정 컬럼만 select 한다면 그 select 목록에 `mustChangePassword` 를 추가할 것 — 빌드 에러로 드러남.)

- [ ] **Step 2: 빌드**

Run: `npx nest build user-service`
Expected: PASS. `user.mustChangePassword` 가 unknown 이면 `findUserById` select 컬럼을 확장.

- [ ] **Step 3: 기존 oauth 스펙 회귀**

Run: `npx jest --testPathPattern=oauth.manager --runInBand`
Expected: PASS (기존 토큰 발급 스펙이 깨지지 않음).

- [ ] **Step 4: 커밋**

```bash
git add apps/user-service/src/api/oauth/oauth.manager.ts
git commit -m "[user-service] access token 에 must_change_password claim 추가"
```

---

## Task 7: 프론트 메뉴 role 게이팅

**Files:**
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (`MenuItem` 타입 + `admin-accounts` 항목)
- Modify: `apps/admin-web/src/components/layout/app-sidebar.tsx`

- [ ] **Step 1: MenuItem 타입에 requireRole 추가 + admin-accounts 게이팅**

`menu.ts` 의 `MenuItem` 인터페이스에 옵션 필드 추가:

```typescript
export interface MenuItem {
  id: string;
  title: string;
  icon?: string;
  children?: MenuItem[];
  isComingSoon?: boolean;
  path?: string;
  requireRole?: string[];
}
```

같은 파일 `admin-accounts` 항목에 `requireRole` 부여:

```typescript
{
  id: 'admin-accounts',
  title: '관리자 계정',
  path: '/users',
  requireRole: ['master'],
},
```

- [ ] **Step 2: 사이드바에서 role 로 필터**

`app-sidebar.tsx` 상단 import 에 추가:

```typescript
import { usePermission } from '@/hooks/use-permission';
```

`findParentPath` 아래에 재귀 필터 헬퍼 추가:

```typescript
// requireRole 이 걸린 항목은 해당 role 보유자에게만 노출
function filterMenuByRole(
  items: MenuItem[],
  hasRole: (roles: string[]) => boolean | undefined,
): MenuItem[] {
  return items
    .filter((item) => !item.requireRole || hasRole(item.requireRole) === true)
    .map((item) =>
      item.children
        ? { ...item, children: filterMenuByRole(item.children, hasRole) }
        : item,
    );
}
```

`AppSidebar` 컴포넌트 안에서 `currentMenu` 계산 뒤에 필터 적용:

```typescript
const { hasRole } = usePermission();
const currentMenu = getMenuById(activeMenu);
const visibleChildren = currentMenu
  ? filterMenuByRole(currentMenu.children, hasRole)
  : [];
```

그리고 렌더에서 `currentMenu.children.map(...)` 를 `visibleChildren.map(...)` 로 교체(줄 141). `findParentPath(currentMenu.children, ...)` 도 `visibleChildren` 기준으로 바꿀 필요는 없음(펼침 계산은 무해).

(로딩 중 `hasRole` 은 `undefined` 를 반환 → `=== true` 비교로 인해 master 항목은 로딩 동안 숨김. 권한 확정 후 나타남 — 안전한 기본값.)

- [ ] **Step 3: 프론트 타입체크**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/lib/utils/menu.ts apps/admin-web/src/components/layout/app-sidebar.tsx
git commit -m "[admin-web] 관리자 계정 메뉴를 master 전용으로 게이팅"
```

---

## Task 8: `/users` 페이지 가드 master 전용

**Files:**
- Modify: `apps/admin-web/src/app/(admin)/users/page.tsx:6-8`
- Modify: `apps/admin-web/src/app/(admin)/users/[id]/page.tsx`

- [ ] **Step 1: 목록 페이지 가드 변경**

`users/page.tsx` 의 `requireRole={['admin', 'master']}` 를 `requireRole={['master']}` 로 변경.

- [ ] **Step 2: 상세 페이지에 가드 추가**

`users/[id]/page.tsx` 를 교체 (현재 RouteGuard 없음):

```tsx
import RouteGuard from '@/components/layout/route-guard';
import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { UserDetailGeneral } from './user-detail-general';
import { UserDetailRole } from './user-detail-role';

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <TwoColumnPage>
          <UserDetailGeneral userId={id} />
          <UserDetailRole userId={id} />
        </TwoColumnPage>
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add "apps/admin-web/src/app/(admin)/users/"
git commit -m "[admin-web] 관리자 계정 페이지(목록/상세)를 master 전용 가드로"
```

---

## Task 9: 관리자 생성 API 클라이언트 + mutation 훅

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/users/index.ts`
- Modify: `apps/admin-web/src/lib/services/users/mutations.ts`

- [ ] **Step 1: API 클라이언트에 createAdminAccount 추가**

`lib/api/domains/users/index.ts` 에 함수 추가 (기존 `client` + `USER_SERVICE_BASE_URL` 사용 패턴을 따름):

```typescript
export interface CreateAdminAccountDto {
  username: string;
  nickname: string;
  loginId: string;
  email: string;
  roleId: string;
  phone_number?: string;
}

export interface CreateAdminAccountResult {
  user: { id: string; loginId: string; email: string; username: string };
  initialPassword: string;
}

export const createAdminAccount = async (
  dto: CreateAdminAccountDto,
): Promise<CreateAdminAccountResult> => {
  const res = await client.post<CreateAdminAccountResult>(
    `${USER_SERVICE_BASE_URL}/admin/auth`,
    dto,
  );
  return res.data;
};
```

(응답 envelope: user-service 응답이 `{success,data}` 로 감싸이면 `res.data.data` 를 반환하도록 조정 — 같은 파일의 기존 함수가 `res.data` 를 그대로 쓰는지 `res.data.data` 를 쓰는지 확인해 맞춘다.)

- [ ] **Step 2: mutation 훅 추가**

`lib/services/users/mutations.ts` 에 추가:

```typescript
import { createAdminAccount, type CreateAdminAccountDto } from '@/lib/api/domains/users';

export const useCreateAdminAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAdminAccountDto) => createAdminAccount(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
};
```

(`queryKey` 는 이 파일/`query-keys.ts` 에서 admin users 목록에 쓰는 실제 키에 맞춘다 — 목록 갱신 목적. 정확한 키는 `query-keys.ts` 확인.)

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/users/index.ts apps/admin-web/src/lib/services/users/mutations.ts
git commit -m "[admin-web] 관리자 계정 생성 API 클라이언트/훅 추가"
```

---

## Task 10: "관리자 추가" 다이얼로그 + 초기비번 노출

**Files:**
- Create: `apps/admin-web/src/features/users/components/create-admin-dialog/index.tsx`
- Modify: `apps/admin-web/src/features/users/components/table/index.tsx`

- [ ] **Step 1: 다이얼로그 컴포넌트 작성**

`features/users/components/create-admin-dialog/index.tsx` (역할 선택은 `useAdminRoles()` 로 admin/master 역할 로드, 초기비번은 생성 후 같은 다이얼로그에서 1회 노출):

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAdminRoles } from '@/lib/services/roles';
import { useCreateAdminAccount } from '@/lib/services/users';

export function CreateAdminDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: roles } = useAdminRoles();
  const createMutation = useCreateAdminAccount();

  const [username, setUsername] = useState('');
  const [loginId, setLoginId] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [issued, setIssued] = useState<{ loginId: string; password: string } | null>(null);

  const reset = () => {
    setUsername('');
    setLoginId('');
    setEmail('');
    setRoleId('');
    setIssued(null);
  };

  const handleSubmit = async () => {
    if (!username.trim() || !loginId.trim() || !email.trim() || !roleId) {
      toast.error('이름/로그인 ID/이메일/역할을 모두 입력하세요.');
      return;
    }
    try {
      const res = await createMutation.mutateAsync({
        username: username.trim(),
        nickname: username.trim(),
        loginId: loginId.trim(),
        email: email.trim(),
        roleId,
      });
      setIssued({ loginId: res.user.loginId, password: res.initialPassword });
    } catch (e) {
      toast.error((e as Error).message || '관리자 계정 생성에 실패했습니다.');
    }
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>관리자 계정이 생성되었습니다</DialogTitle>
              <DialogDescription>
                초기 비밀번호는 <b>지금만</b> 표시됩니다. 안전하게 전달하세요. 해당 관리자는 첫 로그인 시 비밀번호를 변경해야 합니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label>로그인 ID</Label>
              <Input readOnly value={issued.loginId} />
              <Label>초기 비밀번호</Label>
              <div className="flex gap-2">
                <Input readOnly value={issued.password} className="font-mono" />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(issued.password);
                    toast.success('복사했습니다.');
                  }}
                >
                  복사
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>닫기</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>관리자 추가</DialogTitle>
              <DialogDescription>
                초기 비밀번호는 서버가 자동 생성하며, 생성 직후 1회만 표시됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ca-username">이름</Label>
                <Input id="ca-username" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ca-loginId">로그인 ID</Label>
                <Input
                  id="ca-loginId"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="영문 소문자+숫자, 4-20자"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ca-email">이메일</Label>
                <Input id="ca-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>역할</Label>
                <RadioGroup value={roleId} onValueChange={setRoleId}>
                  {(roles ?? []).map((r) => (
                    <div key={r.roleId} className="flex items-center gap-2">
                      <RadioGroupItem id={`role-${r.roleId}`} value={r.roleId} />
                      <Label htmlFor={`role-${r.roleId}`} className="font-normal">
                        {r.name}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={createMutation.isPending}>
                취소
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? '생성 중...' : '생성'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

(`useAdminRoles()` 반환 항목의 필드명이 `roleId`/`name` 이 맞는지 `user-detail-role.tsx` 에서 확인됨 — `role.roleId`, `role.name` 사용 중. `useCreateAdminAccount` 는 `@/lib/services/users` 에서 export 되도록 `services/users/index.ts` 에 재-export 추가 필요하면 추가.)

- [ ] **Step 2: UserTable 상단에 "관리자 추가" 버튼 배치**

`features/users/components/table/index.tsx` 를 수정: import 추가 + 상단 툴바에 버튼/다이얼로그.

```tsx
import { CreateAdminDialog } from '../create-admin-dialog';
```

`const [modalOpen, setModalOpen] = useState(false);` 아래에:

```tsx
const [createOpen, setCreateOpen] = useState(false);
```

`return (<div>` 바로 안, 선택 툴바(`selectedUserIds.length > 0 && ...`) 위에 추가:

```tsx
<div className="flex justify-end p-2">
  <Button size="sm" onClick={() => setCreateOpen(true)}>
    관리자 추가
  </Button>
</div>
```

그리고 `<BulkRoleModal .../>` 아래에:

```tsx
<CreateAdminDialog open={createOpen} onOpenChange={setCreateOpen} />
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: PASS. `useCreateAdminAccount` 가 `@/lib/services/users` 에서 안 나오면 `services/users/index.ts` 에 `export * from './mutations';` 확인/추가.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/users/ apps/admin-web/src/lib/services/users/
git commit -m "[admin-web] 관리자 추가 다이얼로그 + 초기비번 1회 노출"
```

---

## Task 11: 첫 로그인 강제 비번변경 (토큰 payload + middleware + 페이지)

**Files:**
- Modify: `apps/admin-web/src/lib/auth/get-token-payload.ts`
- Modify: `apps/admin-web/src/middleware.ts`
- Create: `apps/admin-web/src/app/(admin)/account/change-password/page.tsx`

- [ ] **Step 1: TokenPayload 에 must_change_password 추가**

`get-token-payload.ts` 의 인터페이스와 반환에 필드 추가:

```typescript
export interface TokenPayload {
  sub: string;
  roles: string[];
  email: string;
  login_id: string;
  must_change_password: boolean;
}
```

반환 객체에:

```typescript
return {
  sub: payload.sub as string,
  roles: (payload.roles as string[]) ?? [],
  email: (payload.email as string) ?? '',
  login_id: (payload.login_id as string) ?? '',
  must_change_password: (payload.must_change_password as boolean) ?? false,
};
```

- [ ] **Step 2: middleware 에서 강제 redirect**

`middleware.ts` 에 상수 추가(파일 상단 `PUBLIC_PATHS` 근처):

```typescript
const CHANGE_PASSWORD_PATH = '/account/change-password';
```

`try { await verifyAccessToken(accessToken); return NextResponse.next(); }` 블록을 아래로 교체 — 검증 결과 payload 에서 플래그를 읽어 강제:

```typescript
try {
  const { payload } = await verifyAccessToken(accessToken);
  const mustChange = payload.must_change_password === true;
  if (mustChange && pathname !== CHANGE_PASSWORD_PATH) {
    const url = new URL(CHANGE_PASSWORD_PATH, request.nextUrl.origin);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
} catch {
  return bounce(request, hasRefreshToken);
}
```

- [ ] **Step 3: 강제 비번변경 페이지 작성**

`apps/admin-web/src/app/(admin)/account/change-password/page.tsx` (기존 self 변경 API `changePassword` = `POST /auth/change-password` 사용. 성공 후 `/api/auth/refresh` 로 토큰 회전시켜 새 토큰에 플래그 클리어 반영 → 홈으로):

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePassword } from '@/lib/api/domains/users';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (newPassword !== confirm) {
      toast.error('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      // 토큰 회전으로 must_change_password=false 반영
      await fetch('/api/auth/refresh', { method: 'POST' });
      toast.success('비밀번호가 변경되었습니다.');
      router.replace('/');
    } catch (e) {
      toast.error((e as Error).message || '비밀번호 변경에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">비밀번호 변경</h1>
      <p className="text-sm text-muted-foreground">
        최초 로그인입니다. 계속하려면 초기 비밀번호를 변경해야 합니다.
      </p>
      <div className="space-y-2">
        <Label htmlFor="cur">현재(초기) 비밀번호</Label>
        <Input id="cur" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new">새 비밀번호</Label>
        <Input id="new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">영문, 숫자, 특수문자 포함 8-20자</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">새 비밀번호 확인</Label>
        <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <Button onClick={handleSubmit} disabled={submitting}>
        {submitting ? '변경 중...' : '비밀번호 변경'}
      </Button>
    </div>
  );
}
```

(`changePassword` 클라이언트는 `lib/api/domains/users/index.ts` 에 이미 존재 — `POST /auth/change-password` 로 `{currentPassword, newPassword}` 를 보냄. 시그니처가 다르면 그 함수의 실제 인자 형태에 맞춘다. `/api/auth/refresh` 라우트 존재는 `app/api/auth/refresh/route.ts` 로 확인됨.)

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/auth/get-token-payload.ts apps/admin-web/src/middleware.ts "apps/admin-web/src/app/(admin)/account/change-password/"
git commit -m "[admin-web] 첫 로그인 시 비밀번호 변경 강제 (middleware redirect)"
```

---

## Task 12: 일반 회원 열람 마찰 감사 + dead code 정리

**Files:**
- Audit: `apps/admin-web/src/features/customers/**`, `apps/admin-web/src/app/(admin)/account/customer/page.tsx`
- Modify(정리): `apps/admin-web/src/lib/api/domains/roles/index.ts`, `apps/admin-web/src/lib/types/dto/scopes.ts`

- [ ] **Step 1: 고객 페이지가 부르는 엔드포인트 감사**

Run: `grep -rnE "USER_SERVICE_BASE_URL|/admin/|/oauth/|master" apps/admin-web/src/features/customers apps/admin-web/src/lib/services/customers apps/admin-web/src/lib/api/domains/customer`
Expected: 호출 엔드포인트 목록을 확인. **판정 기준**: `/admin/users`(GET, `admin:users:read` 허용), `PATCH /admin/users/:id`(`admin:users:modify`), archive/purge(`admin:users:archive/purge`) 는 admin 스코프 내 → OK. 만약 `/admin/roles*`, `PUT /admin/users/:id/roles`, `POST /admin/auth` 처럼 master 전용을 부르는 버튼이 있으면 그 버튼을 고객 페이지에서 제거하거나 `usePermission().hasRole(['master'])` 로 감싼다.

- [ ] **Step 2: 감사 결과 반영**

위반 발견 시에만 해당 버튼을 `hasRole(['master'])` 조건부 렌더로 감싼다. 위반 없으면 이 스텝은 no-op (그대로 통과).

- [ ] **Step 3: dead code 정리**

`lib/api/domains/roles/index.ts` 의 `roleApi.createRole/updateRole/deleteRole` 는 UI 미사용(하드코딩 방침) → 제거. `listRoles` 만 남긴다(권한 탭·다이얼로그에서 사용). `lib/types/dto/scopes.ts` 가 어디서도 import 되지 않으면 파일 삭제.

Run: `grep -rnE "createRole|updateRole|deleteRole|dto/scopes" apps/admin-web/src` 로 잔여 참조 없음 확인 후 제거.

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src
git commit -m "[admin-web] 일반 회원 페이지 감사 + 미사용 역할 CRUD 클라이언트 정리"
```

---

## Task 13: 엔드-투-엔드 수동 검증

**Files:** 없음 (실행/관찰만)

- [ ] **Step 1: user-service 로컬 기동**

Run: `npm run start:user-service:dev`
Expected: 부팅 성공. (admin-web 은 `npm run start:admin-web:dev`, 필요 env: OIDC 관련.)

- [ ] **Step 2: master 로 관리자 생성 → 초기비번 확인**

admin-web `회사/조직 > 사용자관리 > 관리자 계정`(`/users`) → "관리자 추가" → 생성 → 초기비번 1회 노출/복사 확인.

- [ ] **Step 3: 신규 관리자 첫 로그인 강제 변경**

신규 계정으로 로그인 → `/account/change-password` 로 자동 redirect 되는지, 다른 경로 접근이 막히는지 확인 → 변경 성공 후 홈 진입, 재로그인 시 더 이상 강제되지 않음.

- [ ] **Step 4: non-master admin 게이팅**

admin(비-master) 계정으로 로그인 → 사이드바에 "관리자 계정" 메뉴 미노출, `/users` 직접 접근 시 `/unauthorized` redirect, 고객(일반 회원) 목록은 정상 열람/조작(403 없음) 확인.

- [ ] **Step 5: 최종 상태 커밋 없음 (관찰만)**

검증 로그를 요약해 보고. 문제 발견 시 해당 Task 로 돌아가 수정.

---

## 배포 순서 (참고)

- 모든 변경은 **additive** (`must_change_password` nullable-default) 이며 destructive 없음 → 코드와 마이그레이션을 같은 PR 로 가능 (ADR-0005 expand 규칙).
- `POST /admin/auth` 를 master 전용으로 조이는 것은 behavior change 지만 비파괴적. 배포 후 기존 admin(비-master)이 계정 생성 API 를 호출하던 경로가 있으면 403 이 되므로, 그런 사용처가 없음을 배포 전 확인.
