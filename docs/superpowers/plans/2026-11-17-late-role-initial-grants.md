# 첫 등록 때 없던 역할에도 카탈로그 첫 부여 (#1248) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권한 키가 등록될 때 없던 역할이 나중에 생기면, 다음 user-service 부팅 동기화가 그 역할에 카탈로그의 첫 부여 몫을 한 번 준다.

**Architecture:** 새 표 `iam_initial_grant_deliveries`(권한 키 × 역할 id)가 «이미 준 몫»을 기록한다. 부팅 동기화는 새 키만이 아니라 카탈로그 전체의 (키, 첫 부여 역할) 중 기록이 없는 몫만 기록하고 부여한다. 기존 데이터는 custom 마이그가 «준 것»으로 채운다.

**Tech Stack:** NestJS, drizzle-orm + drizzle-kit(postgres), Jest.

**Spec:** `docs/superpowers/specs/2026-11-17-late-role-initial-grants-design.md`

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/fix-1248`, 브랜치 `fix/1248-late-role-initial-grants`, draft PR #1355. 메인 체크아웃으로 `cd` 하지 않는다.
- 전체 `npx jest`·`npm run type-check` 는 Task 3 에서 **한 번만** `--maxWorkers=2` 로 돌린다(같은 머신에 다른 세션). 그 전엔 대상 스펙만 돌린다.
- 한 번 준 몫은 사람이 회수해도 다시 주지 않는다. 역할 기준은 이름이 아니라 `role_id`(`on delete cascade` — 지우고 다시 만든 역할은 다시 받는다).
- 마이그는 expand(추가만) → `migrate → deploy`. 생성 마이그는 손으로 고치지 않는다. schema·SQL·`meta/` 를 한 커밋에.
- `as` 캐스팅·`any` 금지. 시스템 부여의 `granted_by` 는 null 그대로.
- 테스트 데이터는 키 `zz.` 영역, 역할 이름 `zz_` 접두사만 쓴다.

## Review Focus

- 두 인스턴스가 동시에 부팅 → 한 몫은 한 번만 부여·기록(기록 insert 의 `returning` 에 나온 몫만 부여). Task 2 통합 스펙이 늦은 역할로 확인.
- 배포 뒤 첫 부팅에 대량 부여 → 무엇이 들어갔는지 로그에 `key→role` 목록. Task 2 단위 스펙이 `granted` 를 확인.
- 역할이 있는데 몫이 카탈로그에서 빠진 키(deprecated) → 부여 대상 아님(카탈로그만 본다). Task 2 단위 스펙.
- 역할을 지우고 같은 이름으로 다시 만듦 → 다시 받는다. Task 2 통합 스펙.
- 손으로 주고 뺀 늦은 역할(회수 이력) → 마이그 채우기가 «준 것»으로 기록해 되살리지 않는다. Task 1 통합 스펙.

---

### Task 1: 기록 표 + 기존 데이터 채우기 마이그

**Files:**
- Modify: `apps/user-service/database/drizzle/schema.ts` (`iamRolePermissions` 바로 뒤에 표 추가, `userServiceTables` 에 등록)
- Create(생성): `apps/user-service/database/drizzle/<ts>_add-initial-grant-deliveries.sql`, `<ts>_backfill-initial-grant-deliveries.sql`, `meta/` 갱신
- Test: `apps/user-service/src/api/iam/initial-grant-deliveries.backfill.integration.spec.ts`

**Interfaces:**
- Produces: `iamInitialGrantDeliveries` (schema export) — 열 `permissionKey`(`permission_key` varchar(100), FK `iamPermissions.key`, not null), `roleId`(`role_id` uuid, FK `roles.roleId` on delete cascade, not null), `deliveredAt`(`delivered_at` timestamp default now() not null), PK `(permission_key, role_id)`.

- [ ] **Step 1: 임시 DB 를 띄운다** (로컬 postgres 는 꺼져 있고, bootstrap 은 다른 세션을 건드리므로 쓰지 않는다)

```bash
docker run -d --rm --name pg-1248 -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16
export SCRATCH_URL=postgresql://postgres:postgres@localhost:55432/postgres
```
Expected: `pg_isready -h localhost -p 55432` → accepting connections.

- [ ] **Step 2: 표를 schema 에 추가하고 생성한다**

`iamInitialGrantDeliveries` 를 위 Interfaces 대로 정의하고 주석 한 줄: «카탈로그 첫 부여 몫을 이미 준 (키, 역할). 회수돼도 남아 다시 주지 않는다.» `userServiceTables` 의 `iamRolePermissions` 뒤에 넣는다.

```bash
npm run db:generate:user-service -- --name add-initial-grant-deliveries
sleep 2
npm run db:generate:user-service -- --custom --name backfill-initial-grant-deliveries
```
Expected: SQL 두 파일. 첫 파일은 `CREATE TABLE "iam_initial_grant_deliveries"` + FK 둘 + PK 만(다른 표 변경이 섞이면 멈추고 원인을 본다).

- [ ] **Step 3: 채우기 SQL 을 custom 마이그에 쓴다**

```sql
-- 이미 준 첫 부여 몫을 기록한다(#1248). 셋 중 하나면 «준 것» — 되살리지 않는다.
-- 카탈로그는 코드라 SQL 이 모른다: 모든 (권한, 역할) 쌍을 보고, 첫 부여 대상이 아닌 쌍이 기록돼도 동기화는 카탈로그 몫만 본다.
INSERT INTO "iam_initial_grant_deliveries" ("permission_key", "role_id")
SELECT p."key", r."role_id"
  FROM "iam_permissions" p CROSS JOIN "roles" r
 WHERE EXISTS (SELECT 1 FROM "iam_role_permissions" g WHERE g."permission_key" = p."key" AND g."role_id" = r."role_id")
    OR r."created_at" <= p."registered_at"
    OR EXISTS (SELECT 1 FROM "iam_audit_logs" a
                WHERE a."action" = 'role.permissions.replace' AND a."target_type" = 'role'
                  AND a."target_id" = r."role_id"::text AND a."after" -> 'removed' ? p."key")
ON CONFLICT DO NOTHING;
```

- [ ] **Step 4: 임시 DB 에 전체 마이그를 적용한다**

```bash
psql "$SCRATCH_URL" -c 'create database user_service_1248'
export USDB=postgresql://postgres:postgres@localhost:55432/user_service_1248
DATABASE_URL=$USDB npx drizzle-kit migrate --config apps/user-service/database/drizzle/drizzle.config.ts
```
Expected: 오류 없이 끝나고 `\d iam_initial_grant_deliveries` 에 PK·FK 둘.

- [ ] **Step 5: 채우기 규칙의 실패 테스트를 쓴다**

`describeIfDb` 가드·`REQUIRE_USER_SERVICE_DB` 검사는 `permission-catalog-sync.integration.spec.ts` 와 같은 모양. 스펙은 `apps/user-service/database/drizzle/*_backfill-initial-grant-deliveries.sql` 를 찾아 읽고 `db.execute(sql.raw(text))` 로 돌린다. 준비: 키 `zz.item.read`(`registered_at` 2026-03-01), 역할 `zz_early`(`created_at` 2026-01-01), `zz_late_granted`·`zz_late_revoked`·`zz_late_plain`(셋 다 `created_at` 2026-06-01). `zz_late_granted` 에 부여 행, `zz_late_revoked` 에 audit 행(`action` 'role.permissions.replace', `target_type` 'role', `target_id` 역할 id, `target_label` 'zz_late_revoked', `actor_user_id` 임의 uuid, `after` `{ removed: ['zz.item.read'] }`). 정리(beforeEach·afterAll): `zz.%` 키의 기록·부여, `target_label like 'zz_%'` audit, `zz.%` 권한, `zz_%` 역할.

테스트 `records shares the old one-time sync already gave or a person took back`:
- `zz_early`·`zz_late_granted`·`zz_late_revoked` 는 기록 있음
- `zz_late_plain` 은 기록 없음

- [ ] **Step 6: 돌려서 통과를 본다** (Step 3 이 먼저 있으므로 이 스펙은 처음부터 초록이어야 한다 — 빨가면 SQL 이 틀린 것)

```bash
DATABASE_URL=$USDB REQUIRE_USER_SERVICE_DB=1 npx jest --config ./apps/user-service/jest.config.js initial-grant-deliveries.backfill --runInBand
```
Expected: PASS 1. 확인 삼아 Step 3 의 `OR r."created_at" <= …` 줄을 빼고 돌리면 `zz_early` 에서 FAIL → 되돌린다.

- [ ] **Step 7: 커밋**

```bash
git add apps/user-service/database/drizzle apps/user-service/src/api/iam/initial-grant-deliveries.backfill.integration.spec.ts
git commit -m "feat(user-service): 카탈로그 첫 부여 몫 기록 표와 기존 데이터 채우기 (#1248)"
```

---

### Task 2: 동기화가 기록 없는 몫만 부여

**Files:**
- Modify: `apps/user-service/src/api/iam/iam.repository.ts`
- Modify: `apps/user-service/src/api/iam/permission-catalog-sync.manager.ts`
- Modify: `apps/user-service/src/api/iam/permission-catalog-sync.bootstrap.ts`
- Modify: `libs/authorization/src/permissions/permission.types.ts:51` 주석, `docs/adr/0048-admin-permission-model.md:16`, `CLAUDE.md:351`
- Test: `apps/user-service/src/api/iam/permission-catalog-sync.manager.spec.ts`, `apps/user-service/src/api/iam/permission-catalog-sync.integration.spec.ts`

**Interfaces:**
- Consumes: `iamInitialGrantDeliveries` (Task 1).
- Produces:
  - `IamRepository.findDeliveredShares(permissionKeys: string[], tx: UserServiceTx): Promise<{ permissionKey: string; roleId: string }[]>`
  - `IamRepository.insertDeliveries(rows: { roleId: string; permissionKey: string }[], tx: UserServiceTx): Promise<{ roleId: string; permissionKey: string }[]>` — `onConflictDoNothing().returning(...)`, 이번에 새로 들어간 행만.
  - `export type SyncablePermission = Omit<PermissionDefinition, 'grantOnFirstRegistration'> & { readonly grantOnFirstRegistration: readonly string[] }` (manager 파일). `sync(catalog: readonly SyncablePermission[] = PERMISSION_CATALOG, options)` — 테스트가 `zz_` 역할 이름을 캐스팅 없이 쓰게.
  - `CatalogSyncResult` 에 `granted: { permissionKey: string; roleName: string }[]` 추가, `grants === granted.length`.

- [ ] **Step 1: 단위 스펙을 새 동작으로 바꾼다(실패)**

repository mock 에 `findDeliveredShares`(기본 `[]`)·`insertDeliveries`(기본: 받은 행 그대로 resolve) 추가.
- `grants only the keys this call actually inserted` → `grants every undelivered share of the catalog, not only new keys`: `insertMissingPermissions` → `[]`, `findDeliveredShares` → `[{ permissionKey: 'a.b.read', roleId: 'role-admin' }]`, 카탈로그 `a.b.read[admin,intern]`·`a.b.write[admin]`. 기대: `insertGrants` 가 `[{ roleId: 'role-intern', permissionKey: 'a.b.read' }, { roleId: 'role-admin', permissionKey: 'a.b.write' }]`, `result.granted` = `[{ permissionKey: 'a.b.read', roleName: 'intern' }, { permissionKey: 'a.b.write', roleName: 'admin' }]`, `grants` 2.
- 새 `grants only what this instance recorded`: `insertDeliveries` 가 첫 행만 돌려주면 `insertGrants` 도 그 한 행만.
- `does nothing when the catalog is already in the database`·`restores a returning key without granting it again`: `findDeliveredShares` 가 해당 몫을 돌려주게 하고 `insertGrants` 미호출 기대 유지.
- 새 `ignores shares of keys that left the catalog`: DB 상태에 `a.old.read` 가 있어도 카탈로그에 없으면 `findDeliveredShares` 는 카탈로그 키로만 불린다(`toHaveBeenCalledWith(['a.b.read'], tx)`).
- `reports initial-grant roles that do not exist yet`: 기대 유지.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/user-service/src/api/iam/permission-catalog-sync.manager.spec.ts`
Expected: FAIL(`findDeliveredShares` 미호출 등).

- [ ] **Step 3: 구현**

repository 두 메서드 추가. manager 의 `grantFirstRegistrations(catalog, insertedKeys, tx)` → `grantUndeliveredShares(catalog, tx)` 로 바꾼다: 원하는 역할 이름 전부 → `findRoleIdsByNames` → (키, 있는 역할) 후보 → `findDeliveredShares(카탈로그 키, tx)` 를 뺀 나머지 → `insertDeliveries` → 그 반환 행만 `insertGrants`. `missingRoles` 는 지금처럼 없는 이름. `syncIn` 의 `new Set(inserted)` 전달을 없앤다. 클래스 위에 한 줄: «첫 등록 때 없던 역할도 생긴 뒤 다음 부팅에 받는다 — 기록이 «한 번만»을 지킨다(#1248).»

bootstrap: `granted` 가 있으면 `initial grants: a.b.read→intern, …` 로 log. 경고 문구를 `initial grants waiting for missing roles: X — 역할이 생기면 다음 부팅에 부여된다` 로.

문서 세 곳 문구를 «역할마다 한 번만 부여한다 — 첫 등록 때 없던 역할은 생긴 뒤 다음 부팅에 받는다(회수하면 다시 주지 않는다)» 뜻으로 고친다(ADR 은 16번 줄 문장만).

- [ ] **Step 4: 단위 통과**

Run: `npx jest apps/user-service/src/api/iam/permission-catalog-sync.manager.spec.ts`
Expected: PASS 전부.

- [ ] **Step 5: 통합 스펙에 회귀를 더한다**

정리에 `zz.%` 키의 기록 행(권한보다 먼저)과 `zz_%` 역할 삭제를 더한다. 기존 테스트의 `'admin'` 은 seed 가 없는 임시 DB 에서도 돌게 `beforeEach` 가 만드는 `zz_admin` 역할로 바꾼다. 새 테스트(`zz_late_worker` 역할):
- `grants a role that appears after its key was registered`: 역할 없이 sync → `missingRoles` 에 포함·부여 0 → 역할 insert → sync → 부여 1, `granted` 에 `{ permissionKey: 'zz.item.read', roleName: 'zz_late_worker' }`.
- `does not bring back a late grant that was revoked`: 위에 이어 부여 행 삭제 → sync → 0.
- `gives a recreated role its share again`: 역할 삭제(기록 cascade) → 같은 이름 insert → sync → 1.
- `grants a late role once when two instances boot together`: 역할 생성 뒤 `Promise.all` 두 sync → 부여 1, 두 결과의 `grants` 합 1.

- [ ] **Step 6: 통합 통과**

Run: `DATABASE_URL=$USDB REQUIRE_USER_SERVICE_DB=1 npx jest --config ./apps/user-service/jest.config.js permission-catalog-sync initial-grant-deliveries --runInBand`
Expected: PASS 전부.

- [ ] **Step 7: 커밋**

```bash
git add apps/user-service/src/api/iam libs/authorization/src/permissions/permission.types.ts docs/adr/0048-admin-permission-model.md CLAUDE.md
git commit -m "fix(user-service): 첫 등록 때 없던 역할도 생긴 뒤 카탈로그 첫 부여를 받는다 (#1248)"
```

---

### Task 3: 게이트와 PR

- [ ] **Step 1: 임시 DB 정리** — `docker stop pg-1248`

- [ ] **Step 2: E2E 스택이 안 떠 있는지 본다** — `docker ps` 에 e2e/kafka 컨테이너가 있으면 멈추고 사용자에게 묻는다(전체 jest 금지 조건).

- [ ] **Step 3: 게이트 한 번씩**

```bash
npm run type-check
npx jest --maxWorkers=2
```
Expected: 둘 다 에러·실패 0. 빨간 게 있으면 이 브랜치가 만든 것으로 보고 고친다.

- [ ] **Step 4: push·PR 본문 갱신** — 본문에서 «진행 중» 줄을 지우고 변경 요약·배포(`migrate → deploy`, lcnine-auth, 배포 뒤 첫 부팅 로그의 `initial grants:` 줄 확인)·테스트 명령을 적는다. 끝 줄은 세션 URL. draft 해제는 사용자에게 묻는다.
