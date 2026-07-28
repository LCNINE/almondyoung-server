# 창고 쓰기 엔드포인트 스코프 authorization 구현 계획 (#546)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `WarehouseController` 의 쓰기 엔드포인트 3개(`POST`/`PATCH`/`DELETE`)를 새 `inventory.warehouse.manage` 스코프로 닫고, 그 스코프를 `admin` 과 `logistics_manager` 에 매핑한다.

**Architecture:** BC별로 분리된 스코프 파일 컨벤션(`fulfillment-scopes.ts`)을 따라 `inventory-scopes.ts` 를 새로 만든다. `merged-scopes.ts` 가 두 BC의 스코프와 role 매핑을 병합해 단일 목록으로 노출하고, `app.module.ts` 와 dev 시드가 그 병합 목록 하나만 소비한다. 컨트롤러에는 `@UseGuards(ScopeGuard)` + `@RequireScopes(...)` 를 붙인다.

**Tech Stack:** NestJS, `@app/authorization` (`ScopeGuard` / `RequireScopes` / `ScopeBootstrapService`), Jest

## Global Constraints

- **마이그레이션 0건.** 스키마 변경 없음. `ScopeBootstrapService.onModuleInit` 이 부팅 시 `auth.scopes` / `auth.role_scope_mapping` 을 upsert 한다
- **읽기 엔드포인트(`@Get` 3개)는 절대 손대지 않는다.** warehouse-app 이 `GET /inventory/warehouses` 를 쓰는데 현장 토큰의 role 을 코드로 확인할 수 없다
- **admin-web 은 변경하지 않는다.** RouteGuard·UI 권한 게이팅 모두 범위 밖
- **`ensureRoleScopeMappings` 에 넘기는 배열은 role 이름이 중복되면 안 된다** — `authorization.service.ts:97` 이 던진다. 그리고 그 배열은 해당 role 의 *전체* 스코프 목록이어야 한다 — `:127` 이 목록에 없는 행을 지운다
- 테스트 기대값은 검증 대상 상수를 import 하지 말고 리터럴로 직접 적는다 (`fulfillment-scopes.spec.ts` / `seed.integration.spec.ts:50-52` 의 기존 컨벤션)
- 스코프 키 문자열은 정확히 `inventory.warehouse.manage`

## File Structure

| 파일 | 역할 |
|---|---|
| `apps/core/src/platform/auth/inventory-scopes.ts` (신규) | Inventory BC 의 스코프 정의와 role 매핑. `fulfillment-scopes.ts` 와 대칭 |
| `apps/core/src/platform/auth/inventory-scopes.spec.ts` (신규) | 위 상수의 계약 테스트 |
| `apps/core/src/platform/auth/merged-scopes.ts` (수정) | BC별 스코프·role 매핑 병합. `ALL_ROLE_MAPPINGS` 신규 export |
| `apps/core/src/platform/auth/merged-scopes.spec.ts` (신규) | 병합 결과의 계약 테스트 — roleName 중복 0건이 핵심 |
| `apps/core/src/app.module.ts` (수정) | `roleMappings` 를 병합 목록으로 교체 |
| `scripts/local/seed-dev-core/scopes.ts` (수정) | 같은 병합 목록 사용 |
| `scripts/local/seed-dev-core/seed.integration.spec.ts` (수정) | 스코프 개수·role 기대값 갱신 |
| `apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.ts` (수정) | 쓰기 3개에 가드 부착 |
| `apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.spec.ts` (신규) | authorization contract 테스트 |

**Task 순서가 중요하다.** role 매핑 등록(Task 3)이 가드 부착(Task 4)보다 먼저다 — 순서가 반대면 중간 커밋 상태에서 매핑 없는 스코프를 요구하게 된다.

---

### Task 1: Inventory 스코프 정의

**Files:**
- Create: `apps/core/src/platform/auth/inventory-scopes.ts`
- Test: `apps/core/src/platform/auth/inventory-scopes.spec.ts`

**Interfaces:**
- Consumes: `ScopeDefinition`, `RoleScopeMappingDefinition` (`@app/authorization`)
- Produces:
  - `INVENTORY_SCOPE: { readonly WAREHOUSE_MANAGE: 'inventory.warehouse.manage' }`
  - `InventoryScope` — `(typeof INVENTORY_SCOPE)[keyof typeof INVENTORY_SCOPE]`
  - `INVENTORY_SCOPES: ScopeDefinition[]`
  - `INVENTORY_ROLE_MAPPINGS: RoleScopeMappingDefinition[]`

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/platform/auth/inventory-scopes.spec.ts`:

```typescript
import { INVENTORY_ROLE_MAPPINGS, INVENTORY_SCOPE, INVENTORY_SCOPES } from './inventory-scopes';

describe('inventory authorization contract', () => {
  const roleScopes = new Map(INVENTORY_ROLE_MAPPINGS.map((mapping) => [mapping.roleName, mapping.scopeKeys]));

  it('registers the warehouse management scope under the inventory category', () => {
    expect(INVENTORY_SCOPES.map((scope) => scope.key)).toEqual(['inventory.warehouse.manage']);
    expect(INVENTORY_SCOPES.every((scope) => scope.category === 'inventory')).toBe(true);
  });

  it('grants warehouse management to admin and the logistics manager, never to the worker', () => {
    expect(roleScopes.get('admin')).toEqual([INVENTORY_SCOPE.WAREHOUSE_MANAGE]);
    expect(roleScopes.get('logistics_manager')).toEqual([INVENTORY_SCOPE.WAREHOUSE_MANAGE]);
    expect(roleScopes.get('logistics_worker')).toBeUndefined();
  });
});
```

**`ScopeGuard` 를 직접 돌리는 테스트는 의도적으로 두지 않는다.** 그 테스트가 증명하는 것은
`ScopeGuard` 자체의 동작이고 `fulfillment-scopes.spec.ts:29-59` 가 이미 증명하고 있다.
이번에 새로 생기는 사실(어떤 role 이 이 스코프를 받는가)은 위 두 테스트가 전부 덮는다.
가드 하네스를 복사해 오면 `fulfillment-scopes.spec.ts` 와 같은 로직 블록이 두 벌이 된다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern="platform/auth/inventory-scopes" -v`
Expected: FAIL — `Cannot find module './inventory-scopes'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/core/src/platform/auth/inventory-scopes.ts`:

```typescript
import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

export const INVENTORY_SCOPE = {
  WAREHOUSE_MANAGE: 'inventory.warehouse.manage',
} as const;

export type InventoryScope = (typeof INVENTORY_SCOPE)[keyof typeof INVENTORY_SCOPE];

export const INVENTORY_SCOPES: ScopeDefinition[] = [
  {
    key: INVENTORY_SCOPE.WAREHOUSE_MANAGE,
    category: 'inventory',
    description: '창고 생성·수정·삭제 및 피킹 방식 설정',
  },
];

/**
 * `admin` 을 포함하는 이유: 이 스코프를 쓰는 유일한 화면
 * (`admin-web` 의 `/inventory/warehouses`)이 `requireRole={['admin','master']}` 로
 * 들여보낸다. `logistics_manager` 만 매핑하면 master 없는 admin 사용자가 화면에는
 * 들어가고 저장에서 403 을 받는다.
 *
 * `logistics_worker` 는 의도적으로 제외한다 — 창고 생성·삭제는 현장 작업이 아니다.
 */
export const INVENTORY_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  { roleName: 'admin', scopeKeys: [INVENTORY_SCOPE.WAREHOUSE_MANAGE] },
  { roleName: 'logistics_manager', scopeKeys: [INVENTORY_SCOPE.WAREHOUSE_MANAGE] },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern="platform/auth/inventory-scopes" -v`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/platform/auth/inventory-scopes.ts apps/core/src/platform/auth/inventory-scopes.spec.ts
git commit -m "feat(core): inventory.warehouse.manage 스코프 정의 (#546)"
```

---

### Task 2: 스코프·role 매핑 병합

**Files:**
- Modify: `apps/core/src/platform/auth/merged-scopes.ts` (전체 교체)
- Test: `apps/core/src/platform/auth/merged-scopes.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 1 의 `INVENTORY_SCOPES`, `INVENTORY_ROLE_MAPPINGS`; 기존 `FULFILLMENT_SCOPES`, `FULFILLMENT_ROLE_MAPPINGS`
- Produces:
  - `ALL_SCOPES: ScopeDefinition[]` (기존, 항목 1개 증가)
  - `ALL_ROLE_MAPPINGS: RoleScopeMappingDefinition[]` — **신규.** roleName 별로 1행, `scopeKeys` 는 각 BC 목록을 순서대로 이어붙이고 중복 제거

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/platform/auth/merged-scopes.spec.ts`:

```typescript
import { ALL_ROLE_MAPPINGS, ALL_SCOPES } from './merged-scopes';

describe('merged authorization contract', () => {
  it('merges every BC scope exactly once', () => {
    const keys = ALL_SCOPES.map((scope) => scope.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('fulfillment.warehouse.operate');
    expect(keys).toContain('inventory.warehouse.manage');
    expect(keys).toHaveLength(9);
  });

  // ensureRoleScopeMappings 는 중복 roleName 을 만나면 던지고(authorization.service.ts:97),
  // 넘긴 목록에 없는 매핑 행을 지운다(:127). 두 BC 목록을 그냥 이어붙이면
  // logistics_manager 가 두 번 나와 부팅이 죽는다 — 이 테스트가 그 회귀를 잡는다.
  it('emits one row per role so bootstrap neither throws nor drops a mapping', () => {
    const roleNames = ALL_ROLE_MAPPINGS.map((mapping) => mapping.roleName);
    expect(new Set(roleNames).size).toBe(roleNames.length);
    expect(new Set(roleNames)).toEqual(new Set(['admin', 'logistics_worker', 'logistics_manager']));

    for (const mapping of ALL_ROLE_MAPPINGS) {
      expect(new Set(mapping.scopeKeys).size).toBe(mapping.scopeKeys.length);
    }
  });

  it('keeps each role total — the merged list is authoritative, not additive', () => {
    const scopesFor = (roleName: string) =>
      ALL_ROLE_MAPPINGS.find((mapping) => mapping.roleName === roleName)?.scopeKeys ?? [];

    expect(scopesFor('admin')).toEqual(['inventory.warehouse.manage']);
    expect(scopesFor('logistics_worker')).toEqual(['fulfillment.warehouse.operate']);
    expect([...scopesFor('logistics_manager')].sort()).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.reservation.transfer',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.shipment.reopen',
      'fulfillment.warehouse.operate',
      'inventory.warehouse.manage',
    ]);
  });

  it('never grants warehouse management to the logistics worker', () => {
    const worker = ALL_ROLE_MAPPINGS.find((mapping) => mapping.roleName === 'logistics_worker');
    expect(worker?.scopeKeys).not.toContain('inventory.warehouse.manage');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern="platform/auth/merged-scopes" -v`
Expected: FAIL — `ALL_ROLE_MAPPINGS` 가 `merged-scopes.ts` 에 없어 `undefined` 로 import 되고 `.map` 에서 TypeError

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `apps/core/src/platform/auth/merged-scopes.ts`:

```typescript
import { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';
import { FULFILLMENT_ROLE_MAPPINGS, FULFILLMENT_SCOPES } from './fulfillment-scopes';
import { INVENTORY_ROLE_MAPPINGS, INVENTORY_SCOPES } from './inventory-scopes';

/**
 * 모든 BC의 스코프를 병합한다.
 * 현재 Catalog scopes: [] (빈 배열).
 * 향후 각 BC에서 스코프가 추가되면 여기서 병합.
 */
export const ALL_SCOPES: ScopeDefinition[] = [
  // Catalog scopes (향후 추가)
  ...INVENTORY_SCOPES,
  ...FULFILLMENT_SCOPES,
];

/**
 * role 이름 기준으로 BC별 매핑을 하나로 합친다.
 *
 * 병합이 선택이 아닌 이유 — `AuthorizationService.ensureRoleScopeMappings` 는
 * (1) 중복 roleName 을 만나면 던지고(authorization.service.ts:97),
 * (2) 넘긴 목록에 없는 매핑 행을 지운다(:127).
 * 즉 이 함수에 넘기는 배열은 "추가분"이 아니라 그 role 의 **전체 목록**이어야 하며,
 * 두 BC 배열을 그냥 spread 하면 logistics_manager 가 두 번 나와 부팅이 죽는다.
 */
function mergeRoleMappings(...groups: RoleScopeMappingDefinition[][]): RoleScopeMappingDefinition[] {
  const scopeKeysByRole = new Map<string, string[]>();

  for (const group of groups) {
    for (const mapping of group) {
      const scopeKeys = scopeKeysByRole.get(mapping.roleName) ?? [];
      for (const scopeKey of mapping.scopeKeys) {
        if (!scopeKeys.includes(scopeKey)) scopeKeys.push(scopeKey);
      }
      scopeKeysByRole.set(mapping.roleName, scopeKeys);
    }
  }

  return [...scopeKeysByRole].map(([roleName, scopeKeys]) => ({ roleName, scopeKeys }));
}

export const ALL_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = mergeRoleMappings(
  FULFILLMENT_ROLE_MAPPINGS,
  INVENTORY_ROLE_MAPPINGS,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern="platform/auth" -v`
Expected: PASS — `merged-scopes.spec.ts` 4 tests + `inventory-scopes.spec.ts` 2 tests + `fulfillment-scopes.spec.ts` 3 tests. `fulfillment-scopes.spec.ts` 는 손대지 않았으므로 그대로 통과해야 한다

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/platform/auth/merged-scopes.ts apps/core/src/platform/auth/merged-scopes.spec.ts
git commit -m "feat(core): BC별 role 매핑을 role 이름 기준으로 병합 (#546)"
```

---

### Task 3: 부트스트랩과 dev 시드 배선

**Files:**
- Modify: `apps/core/src/app.module.ts:11` (import), `:40` (`roleMappings`)
- Modify: `scripts/local/seed-dev-core/scopes.ts:4-5` (import), `:20`, `:24`
- Modify: `scripts/local/seed-dev-core/seed.integration.spec.ts:30-35`, `:50-62`

**Interfaces:**
- Consumes: Task 2 의 `ALL_ROLE_MAPPINGS`, `ALL_SCOPES`
- Produces: 런타임 계약 — core 부팅 시 `auth.scopes` 9행, `auth.role_scope_mapping` 이 `admin` / `logistics_worker` / `logistics_manager` 3개 role 을 덮는다

- [ ] **Step 1: Update the seed integration spec (this is the failing test)**

`scripts/local/seed-dev-core/seed.integration.spec.ts` 에서 이 블록을

```typescript
    // 정확히 8개를 어서션한다 — apps/core/src/platform/auth/merged-scopes.ts 의 ALL_SCOPES 에서
    // 부팅 시 시딩되는 개수다(import 하지 않음: ALL_SCOPES 에서 스코프 하나가 빠지는 회귀는
    // `> 0` 로는 못 잡는다). 현재 ALL_SCOPES 는 FULFILLMENT_SCOPES 와 동일하다.
    const scopeCountRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM auth.scopes`);
    expect(scopeCountRows[0].n).toBe(8);
```

이렇게 바꾼다:

```typescript
    // 정확히 9개를 어서션한다 — apps/core/src/platform/auth/merged-scopes.ts 의 ALL_SCOPES 에서
    // 부팅 시 시딩되는 개수다(import 하지 않음: ALL_SCOPES 에서 스코프 하나가 빠지는 회귀는
    // `> 0` 로는 못 잡는다). ALL_SCOPES = INVENTORY_SCOPES(1) + FULFILLMENT_SCOPES(8).
    const scopeCountRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM auth.scopes`);
    expect(scopeCountRows[0].n).toBe(9);
```

이어서 같은 테스트의 기대값 블록을

```typescript
    // 기대값은 apps/core/src/platform/auth/fulfillment-scopes.ts 의 FULFILLMENT_ROLE_MAPPINGS 를
    // import 하지 않고 여기 직접 적는다 — 검증 대상 상수를 그대로 가져와 비교하면 그 상수 자체가
    // 잘못됐을 때도 테스트가 통과해버려 회귀를 잡지 못한다.
    expect(scopeKeysByRole.get('logistics_worker')).toEqual(['fulfillment.warehouse.operate']);
    expect(scopeKeysByRole.get('logistics_manager')).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.reservation.transfer',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.shipment.reopen',
      'fulfillment.warehouse.operate',
    ]);
```

이렇게 바꾼다. 쿼리가 `ORDER BY rsm.role_name, s.key` 이므로 배열은 스코프 키의 알파벳 순이고, `inventory.…` 는 `fulfillment.…` 전부보다 뒤에 온다 — 그래서 `logistics_manager` 의 마지막 원소로 붙는다:

```typescript
    // 기대값은 apps/core/src/platform/auth/merged-scopes.ts 의 ALL_ROLE_MAPPINGS 를
    // import 하지 않고 여기 직접 적는다 — 검증 대상 상수를 그대로 가져와 비교하면 그 상수 자체가
    // 잘못됐을 때도 테스트가 통과해버려 회귀를 잡지 못한다.
    expect(scopeKeysByRole.get('admin')).toEqual(['inventory.warehouse.manage']);
    expect(scopeKeysByRole.get('logistics_worker')).toEqual(['fulfillment.warehouse.operate']);
    expect(scopeKeysByRole.get('logistics_manager')).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.reservation.transfer',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.shipment.reopen',
      'fulfillment.warehouse.operate',
      'inventory.warehouse.manage',
    ]);
```

- [ ] **Step 2: Confirm the spec is skipped without a seed DB, then typecheck it**

Run: `npx jest --testPathPattern="seed-dev-core/seed.integration" 2>&1 | tail -6`
Expected: `Test Suites: 1 skipped, 0 of 1 total` / `Tests: 8 skipped, 8 total` — `SEED_DEV_CORE_URL` 이 없으면 `describe.skip` 이다 (`seed.integration.spec.ts:7-8`). **실행되지 않는 것이 정상이며, 이 태스크의 실질 검증은 Step 5 의 타입체크다.**

- [ ] **Step 3: Wire `app.module.ts`**

`apps/core/src/app.module.ts:11` 의

```typescript
import { FULFILLMENT_ROLE_MAPPINGS } from './platform/auth/fulfillment-scopes';
```

을 지우고, `:10` 의 `ALL_SCOPES` import 를 이렇게 바꾼다:

```typescript
import { ALL_ROLE_MAPPINGS, ALL_SCOPES } from './platform/auth/merged-scopes';
```

그리고 `:40` 의

```typescript
      roleMappings: FULFILLMENT_ROLE_MAPPINGS,
```

를

```typescript
      roleMappings: ALL_ROLE_MAPPINGS,
```

로 바꾼다.

- [ ] **Step 4: Wire the dev seed**

`scripts/local/seed-dev-core/scopes.ts` 의 import 두 줄

```typescript
import { ALL_SCOPES } from '../../../apps/core/src/platform/auth/merged-scopes';
import { FULFILLMENT_ROLE_MAPPINGS } from '../../../apps/core/src/platform/auth/fulfillment-scopes';
```

을 한 줄로 바꾼다:

```typescript
import { ALL_ROLE_MAPPINGS, ALL_SCOPES } from '../../../apps/core/src/platform/auth/merged-scopes';
```

그리고 `FULFILLMENT_ROLE_MAPPINGS` 를 쓰는 두 곳(`:20` 의 `roleMappings:`, `:24` 의 `ensureRoleScopeMappings(...)` 인자)을 `ALL_ROLE_MAPPINGS` 로 바꾼다. 결과는 이렇다:

```typescript
  const service = new AuthorizationService(dbService as unknown as DbService, {
    microserviceName: 'almondyoung',
    scopes: ALL_SCOPES,
    roleMappings: ALL_ROLE_MAPPINGS,
  });

  await service.ensureScopesExist('almondyoung', ALL_SCOPES);
  await service.ensureRoleScopeMappings(ALL_ROLE_MAPPINGS);
```

**이 변경이 필수인 이유:** 그대로 두면 dev 시드가 `FULFILLMENT_ROLE_MAPPINGS` 만 넘기고, `ensureRoleScopeMappings` 의 `notInArray` 삭제가 `logistics_manager` 의 `inventory.warehouse.manage` 행을 **매번 지운다.**

- [ ] **Step 5: Verify nothing references the old symbol and it all typechecks**

Run: `grep -rn "FULFILLMENT_ROLE_MAPPINGS" apps/core/src/app.module.ts scripts/local/seed-dev-core/`
Expected: 출력 없음 (exit 1)

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 출력 없음 (0줄)

Run: `npx jest --testPathPattern="platform/auth" --silent 2>&1 | tail -5`
Expected: PASS — 3 suites, 9 tests

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/app.module.ts scripts/local/seed-dev-core/scopes.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "feat(core): 부트스트랩과 dev 시드가 병합 role 매핑을 쓰도록 배선 (#546)"
```

---

### Task 4: 창고 쓰기 엔드포인트에 가드 부착

**Files:**
- Modify: `apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.ts:1` (imports), `:14` (`@Post`), `:45` (`@Patch`), `:57` (`@Delete`)
- Test: `apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 1 의 `INVENTORY_SCOPE`; `RequireScopes` / `ScopeGuard` / `REQUIRED_SCOPES_KEY` (`@app/authorization`); `GUARDS_METADATA` (`@nestjs/common/constants`)
- Produces: 없음 (최종 태스크)

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.spec.ts`:

```typescript
import { REQUIRED_SCOPES_KEY, ScopeGuard } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { WarehouseController } from './warehouse.controller';

describe('WarehouseController authorization contract', () => {
  const handlerFor = (name: string): unknown =>
    Object.getOwnPropertyDescriptor(WarehouseController.prototype, name)?.value;

  const WRITE_HANDLERS = ['create', 'update', 'remove'];
  const READ_HANDLERS = ['findAll', 'findOne', 'getStockSummary'];

  it.each(WRITE_HANDLERS)('closes %s behind the warehouse management scope', (name) => {
    const handler = handlerFor(name);
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, handler)).toEqual([INVENTORY_SCOPE.WAREHOUSE_MANAGE]);
  });

  // RequireScopes 는 메타데이터일 뿐이라 ScopeGuard 가 없으면 아무것도 막지 못한다.
  // 데코레이터 하나만 붙이고 끝내는 회귀를 이 어서션이 잡는다.
  it.each(WRITE_HANDLERS)('binds ScopeGuard to %s so the metadata is actually enforced', (name) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handlerFor(name))).toEqual([ScopeGuard]);
  });

  // warehouse-app 이 GET /inventory/warehouses 로 창고를 고르는데 현장 토큰의 role 을
  // 코드로 확인할 수 없다. 읽기를 닫으면 현장 PDA 가 창고 선택조차 못 한다.
  it.each(READ_HANDLERS)('leaves %s open to any authenticated caller', (name) => {
    const handler = handlerFor(name);
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
  });

  it('does not put a class-level scope requirement on the controller', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, WarehouseController)).toBeUndefined();
  });

  it('still delegates to the service through the mapper', async () => {
    // 필드 구성은 warehouses 테이블(inventory.schema.ts:726-735) 그대로다.
    // type 은 warehouseTypeEnum = ['domestic','overseas','bonded','return'] 중 하나여야 한다.
    const warehouse = {
      id: 'w-1',
      name: '부천 물류창고',
      type: 'domestic' as const,
      location: '부천',
      supportedPickingStrategies: null,
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    };
    const service = { update: jest.fn().mockResolvedValue(warehouse) };
    const controller = new WarehouseController(service as never);

    const result = await controller.update('w-1', { supportedPickingStrategies: ['discrete'] });

    expect(service.update).toHaveBeenCalledWith('w-1', { supportedPickingStrategies: ['discrete'] });
    expect(result.supportedPickingStrategies).toEqual([]);
  });
});
```

**마지막 테스트의 목적:** 가드를 붙이면서 핸들러 본문을 건드리지 않았음을 고정한다. `WarehouseMapper.toDto` 가 `supportedPickingStrategies` 의 `null` 을 `[]` 로 정규화하는 기존 동작(`warehouse.mapper.ts:11`, 컨트롤러 `:47-49` 주석)이 그대로 남아 있어야 한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern="warehouse.controller" -v`
Expected: FAIL — 쓰기 3개의 `REQUIRED_SCOPES_KEY` 가 `undefined` 라 `toEqual([...])` 불일치, `GUARDS_METADATA` 도 `undefined`. 읽기 3개와 마지막 두 테스트는 PASS

- [ ] **Step 3: Attach the guards**

`apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.ts` 의 import 블록 맨 위 두 줄을

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
```

이렇게 바꾼다:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
```

그리고 쓰기 핸들러 3개에만 데코레이터 두 줄씩을 `@Post()` / `@Patch(':id')` / `@Delete(':id')` **바로 아래**에 넣는다:

```typescript
  @Post()
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: '새 창고 생성' })
```

```typescript
  @Patch(':id')
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: '창고 정보 수정' })
```

```typescript
  @Delete(':id')
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.WAREHOUSE_MANAGE)
  @ApiOperation({ summary: '창고 삭제' })
```

`@Get()` / `@Get(':id')` / `@Get(':id/summary')` 세 개는 **건드리지 않는다.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern="warehouse.controller" -v`
Expected: PASS — 11 tests (`it.each` 3+3+3 = 9, 단일 2)

- [ ] **Step 5: Verify the whole affected surface still passes**

Run: `npx jest --testPathPattern="(platform/auth|inventory/warehouse|fulfillment/controllers)" --silent 2>&1 | tail -6`
Expected: PASS — 베이스라인 14 suites / 56 tests 에 신규 3 suites(inventory-scopes 2 + merged-scopes 4 + warehouse.controller 11 = 17 tests)가 더해져 **17 suites / 73 tests**, 0 failures

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 출력 없음 (0줄)

Run: `npx eslint apps/core/src/platform/auth apps/core/src/modules/inventory/warehouse/controllers apps/core/src/app.module.ts scripts/local/seed-dev-core`
Expected: 출력 없음. **주의:** 저장소 전역 `npm run lint` 는 상시 debt 가 있어 쓰지 않는다 — 변경한 경로만 스코프로 본다

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/inventory/warehouse/controllers/
git commit -m "fix(core): 창고 쓰기 엔드포인트에 스코프 authorization 부착 (#546)

POST/PATCH/DELETE 를 inventory.warehouse.manage 뒤로 닫는다. 전역
JwtAuthGuard 로 인증만 걸려 있어 인증된 아무 사용자나 창고를 만들고
지울 수 있었다. #545 가 같은 PATCH 로 supportedPickingStrategies 를
열면서 이 공백의 대가가 창고 이름 변경에서 출고 정지로 올라갔다.

GET 3개는 열어둔다 — warehouse-app 이 창고 선택에 쓴다."
```

---

## 완료 후 남는 것 (구현 범위 밖)

이 계획을 다 실행해도 아래는 남는다. #546 을 닫기 전에 사람이 처리해야 한다.

1. **배포 후 검증:** master 없이 `admin` role 만 가진 사용자로 `/inventory/warehouses` 저장이 되는지. 실제 토큰이 필요해 코드로 확인 불가
2. **후속 이슈 등록:** inventory 나머지 컨트롤러 20개가 여전히 스코프 0건 — stocktaking(쓰기 8), purchase-order(쓰기 11), location(쓰기 7), sku-group(쓰기 6), sku-catalog(6), barcode-generation(5), return(4), sku-managers(4), suppliers(3), supplier-categories(3), holder(3), transfer(3), inventory(2), reservation(2), stock-projection(2), movement(1)
