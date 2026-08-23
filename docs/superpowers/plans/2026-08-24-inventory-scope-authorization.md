# inventory 전면 스코프 authorization 구현 계획 (#551)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/core` inventory 모듈 라우트 154개 전부에 스코프 authorization 판단을 부여하고, 판단 없는 새 라우트가 들어오면 테스트가 잡게 만든다.

**Architecture:** `INVENTORY_SCOPE` 에 위험도 3분할 스코프(`operate`/`manage`/`adjust`)를 추가하고, 18개 컨트롤러에 클래스 레벨 `@UseGuards(ScopeGuard)` + 핸들러 레벨 `@RequireScopes(...)` 를 붙인다. 라우트→스코프 배정표를 AST 기반 스펙으로 못 박아, 표에 없는 라우트나 표와 다른 데코레이터를 실패로 만든다.

**Tech Stack:** NestJS 11 · TypeScript · Jest · `@app/authorization`(`ScopeGuard`, `RequireScopes`, `AuthorizationService`) · TypeScript Compiler API(AST 스펙)

**Spec:** `docs/superpowers/specs/2026-08-24-inventory-scope-authorization-design.md`

## Global Constraints

- **마이그레이션 0건.** `ScopeBootstrapService.onModuleInit` 이 부팅 시 스코프·매핑을 upsert 한다. 새 SQL 파일을 만들지 말 것.
- **admin-web 변경 0건.** inventory 화면 15개의 `requireRole={['admin','master']}` 는 건드리지 않는다.
- **`INVENTORY_ROLE_MAPPINGS` 는 role 당 전체 목록이어야 한다.** `ALL_ROLE_MAPPINGS` 의 `mergeRoleMappings` 가 병합하므로 다른 BC 배열을 직접 spread 하지 말 것 — `ensureRoleScopeMappings`(`libs/authorization/src/services/authorization.service.ts:97`)가 중복 roleName 에 던지고 `:127` 이 목록에 없는 행을 지운다.
- **`master` 는 매핑에 넣지 않는다.** `ScopeGuard` 가 바이패스한다(`libs/authorization/src/guards/scope.guard.ts:74`).
- **`@RequireScopes` 를 붙이면 `AdminRealmGuard` 가 비켜선다**(`libs/authorization/src/guards/admin-realm.guard.ts:53`). 스코프를 붙이면서 role 매핑을 빠뜨리면 admin 이 403 을 맞는다.
- **`ScopeGuard` 는 클래스 레벨에 붙인다.** `@RequireScopes` 없는 핸들러에 대해 `canActivate` 가 즉시 `true` 를 반환하므로(`scope.guard.ts:66`) 무해하고, "데코레이터만 붙고 가드가 빠지는" 사고 유형을 파일 단위로 제거한다.
- **전체 테스트는 `npx jest --maxWorkers=2`** 로 돌린다. 워커 제한 없이 돌리면 OOM 이 난다.
- 스코프 키 문자열은 `inventory.operate` · `inventory.manage` · `inventory.adjust` · `inventory.warehouse.manage`(기존) 정확히 이 값이다.

## 설계 문서와의 차이 1건

설계 문서 §"누락을 기계가 잡는다" 는 신규 스펙을 2개(`inventory-scope-coverage.spec.ts` + `inventory-scope-assignment.spec.ts`)로 적었다. **구현은 1개로 합친다.** 배정표가 154행 전수이면 "표에 없는 라우트 = 실패" 가 곧 커버리지 단언이므로 두 번째 파일은 같은 표를 두 번 읽는 중복이 된다. 파일명은 `inventory-scope-coverage.spec.ts` 를 쓴다.

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `apps/core/src/platform/auth/inventory-scopes.ts` *(수정)* | 스코프 4개 정의 + role 매핑. 이 BC 의 authorization 정본 | T1 |
| `apps/core/src/platform/auth/inventory-scopes.spec.ts` *(수정)* | 스코프 정의·매핑 계약 | T1 |
| `apps/core/src/platform/auth/merged-scopes.spec.ts` *(수정)* | BC 병합 결과 계약. 스코프 총수·role 별 전체 목록 | T1 |
| `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` *(신규)* | 라우트 154개 ↔ 스코프 배정표. **이 계획 전체의 드라이버** | T2 |
| `apps/core/src/modules/inventory/**/*.controller{,s}.ts` *(수정 18개)* | 데코레이터 부착 | T3–T7 |

`inventory-scope-coverage.spec.ts` 는 T2 에서 **RED** 로 들어와 T7 에서 GREEN 이 된다. 태스크마다 남은 불일치 수가 명시돼 있으니 그 숫자로 진행을 검증한다.

---

### Task 1: 스코프 3개 정의 + role 매핑

**Files:**
- Modify: `apps/core/src/platform/auth/inventory-scopes.ts`
- Test: `apps/core/src/platform/auth/inventory-scopes.spec.ts`, `apps/core/src/platform/auth/merged-scopes.spec.ts`

**Interfaces:**
- Consumes: `ScopeDefinition`, `RoleScopeMappingDefinition` from `@app/authorization`
- Produces: `INVENTORY_SCOPE.OPERATE = 'inventory.operate'`, `INVENTORY_SCOPE.MANAGE = 'inventory.manage'`, `INVENTORY_SCOPE.ADJUST = 'inventory.adjust'`, `INVENTORY_SCOPE.WAREHOUSE_MANAGE = 'inventory.warehouse.manage'`(기존 유지). T2–T7 이 이 상수들을 import 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — `inventory-scopes.spec.ts` 전체를 아래로 교체**

```typescript
import { INVENTORY_ROLE_MAPPINGS, INVENTORY_SCOPE, INVENTORY_SCOPES } from './inventory-scopes';

describe('inventory authorization contract', () => {
  const roleScopes = new Map(INVENTORY_ROLE_MAPPINGS.map((mapping) => [mapping.roleName, mapping.scopeKeys]));
  const sorted = (roleName: string) => [...(roleScopes.get(roleName) ?? [])].sort();

  it('registers four inventory scopes under the inventory category', () => {
    expect([...INVENTORY_SCOPES.map((scope) => scope.key)].sort()).toEqual([
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
    expect(INVENTORY_SCOPES.every((scope) => scope.category === 'inventory')).toBe(true);
    expect(INVENTORY_SCOPES.every((scope) => scope.description.length > 0)).toBe(true);
  });

  // admin-web 의 inventory 화면 15개가 전부 requireRole={['admin','master']} 다.
  // admin 이 네 스코프를 다 갖지 않으면 화면에는 들어가고 저장에서 403 을 받는다.
  it('grants every inventory scope to admin', () => {
    expect(sorted('admin')).toEqual([
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
  });

  it('grants every inventory scope to the logistics manager', () => {
    expect(sorted('logistics_manager')).toEqual([
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
  });

  // 현장 작업자는 operate 하나만 받는다. 원장 직접 조작(adjust)·마스터데이터(manage)·
  // 창고 설정(warehouse.manage)은 작업자 권한이 아니다.
  it('grants only operate to the logistics worker', () => {
    expect(sorted('logistics_worker')).toEqual(['inventory.operate']);
  });

  it('never grants adjust or manage to the logistics worker', () => {
    expect(roleScopes.get('logistics_worker')).not.toContain(INVENTORY_SCOPE.ADJUST);
    expect(roleScopes.get('logistics_worker')).not.toContain(INVENTORY_SCOPE.MANAGE);
    expect(roleScopes.get('logistics_worker')).not.toContain(INVENTORY_SCOPE.WAREHOUSE_MANAGE);
  });
});
```

- [ ] **Step 2: `merged-scopes.spec.ts` 의 세 단언을 갱신한다**

`'merges every BC scope exactly once'` 의 마지막 줄:

```typescript
    expect(keys).toHaveLength(12); // fulfillment 8 + inventory 4
```

`'keeps each role total — the merged list is authoritative, not additive'` 전체를 아래로 교체:

```typescript
  it('keeps each role total — the merged list is authoritative, not additive', () => {
    const scopesFor = (roleName: string) =>
      [...(ALL_ROLE_MAPPINGS.find((mapping) => mapping.roleName === roleName)?.scopeKeys ?? [])].sort();

    expect(scopesFor('admin')).toEqual([
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
    expect(scopesFor('logistics_worker')).toEqual(['fulfillment.warehouse.operate', 'inventory.operate']);
    expect(scopesFor('logistics_manager')).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.reservation.transfer',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.shipment.reopen',
      'fulfillment.warehouse.operate',
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
  });
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `npx jest apps/core/src/platform/auth --maxWorkers=2`
Expected: FAIL — `inventory-scopes.spec.ts` 는 `['inventory.warehouse.manage']` 만 받아 4개 기대와 어긋나고, `merged-scopes.spec.ts` 는 `toHaveLength(12)` 에서 9 를 받는다.

- [ ] **Step 4: `inventory-scopes.ts` 를 구현한다 — 파일 전체를 아래로 교체**

```typescript
import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

export const INVENTORY_SCOPE = {
  OPERATE: 'inventory.operate',
  MANAGE: 'inventory.manage',
  ADJUST: 'inventory.adjust',
  WAREHOUSE_MANAGE: 'inventory.warehouse.manage',
} as const;

export type InventoryScope = (typeof INVENTORY_SCOPE)[keyof typeof INVENTORY_SCOPE];

export const INVENTORY_SCOPES: ScopeDefinition[] = [
  {
    key: INVENTORY_SCOPE.OPERATE,
    category: 'inventory',
    description: '재고 현장 작업(입고·적치·실사 카운트·이동)과 재고 조회 전반',
  },
  {
    key: INVENTORY_SCOPE.MANAGE,
    category: 'inventory',
    description: 'SKU·로케이션·보관주체·거래처·매입 등 재고 마스터데이터 관리',
  },
  {
    key: INVENTORY_SCOPE.ADJUST,
    category: 'inventory',
    description: '재고 원장 직접 조작 — 수량 조정, 실사 차이 반영, 이전, 반품 처리',
  },
  {
    key: INVENTORY_SCOPE.WAREHOUSE_MANAGE,
    category: 'inventory',
    description: '창고 생성·수정·삭제 및 피킹 방식 설정',
  },
];

const ALL_INVENTORY_SCOPE_KEYS = INVENTORY_SCOPES.map((scope) => scope.key);

/**
 * `admin` 이 전부 받는 이유: inventory 를 쓰는 admin-web 화면 15개가 모두
 * `requireRole={['admin','master']}` 로 들여보낸다. 하나라도 빠지면 화면에는 들어가고
 * 저장에서 403 을 받는다. admin 자체의 권한 축소는 role 재편이 선행돼야 해서 #551 범위 밖이다.
 *
 * `logistics_worker` 가 `OPERATE` 만 받는 이유: 현장 PDA(warehouse-app)의 적치·입고확정·
 * 실사 카운트·이동·조회는 작업자 행위지만, 재고 수량을 직접 고치는 `ADJUST` 와
 * 마스터데이터를 바꾸는 `MANAGE` 는 아니다. 그 결과 PDA 의 재고조정 화면과 실사 차이 반영은
 * `logistics_manager` 를 요구하게 된다 — 오늘도 AdminRealmGuard 가 막고 있으므로 회귀는 아니다.
 */
export const INVENTORY_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  { roleName: 'admin', scopeKeys: ALL_INVENTORY_SCOPE_KEYS },
  { roleName: 'logistics_manager', scopeKeys: ALL_INVENTORY_SCOPE_KEYS },
  { roleName: 'logistics_worker', scopeKeys: [INVENTORY_SCOPE.OPERATE] },
];
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `npx jest apps/core/src/platform/auth --maxWorkers=2`
Expected: PASS — `inventory-scopes.spec.ts`, `merged-scopes.spec.ts`, `fulfillment-scopes.spec.ts`, `scope-guard-binding.spec.ts` 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/platform/auth/inventory-scopes.ts \
        apps/core/src/platform/auth/inventory-scopes.spec.ts \
        apps/core/src/platform/auth/merged-scopes.spec.ts
git commit -m "feat(auth): inventory 스코프 operate/manage/adjust 정의 (#551)"
```

---

### Task 2: 라우트 ↔ 스코프 배정표 스펙 (드라이버, RED 로 들어온다)

**Files:**
- Create: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`

**Interfaces:**
- Consumes: `INVENTORY_SCOPE`, `InventoryScope` (T1)
- Produces: 없음(스펙 전용). T3–T7 이 이 스펙의 불일치 수를 진행 지표로 쓴다.

**이 태스크는 통과하지 않는다.** 기능 전체의 "실패하는 테스트" 이며, 라우트 154개 중 **144개가 불일치**한 상태로 커밋된다(현재 일치하는 10개 = warehouse 쓰기 3 + 의도적 무표시 7). T3–T7 이 그 144를 0으로 만든다. 다른 스펙은 전부 GREEN 이어야 한다.

- [ ] **Step 1: 스펙 파일을 만든다**

`apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`:

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { INVENTORY_SCOPE, type InventoryScope } from './inventory-scopes';

/**
 * inventory 라우트 ↔ 스코프 배정표.
 *
 * 왜 전수 표인가 — #551 을 만든 원인은 전수조사가 사람 손 글롭이었다는 것이다. 이슈 본문의
 * `find -name "*.controller.ts"` 가 `inbound.controllers.ts`(복수형)를 통째로 놓쳐 쓰기
 * 11개가 조사에서 빠졌다. 이 스펙은 AST 로 라우트를 뽑아 표와 **양방향** 대조하므로,
 * 표에 없는 새 라우트도 표에만 있고 코드에서 사라진 라우트도 실패로 잡힌다.
 *
 * 스코프 판단 없이 라우트를 추가할 수 없다 — 그게 이 파일의 목적이다.
 *
 * `null` = 의도적 무표시. 표시가 없으면 `AdminRealmGuard`(전역)가 `admin`/`master` 로 계속
 * 지키므로, 진단·내부 조회 전용 라우트에는 그게 올바른 기본값이다.
 *
 * `@RequireScopes` ↔ `ScopeGuard` 바인딩은 `scope-guard-binding.spec.ts` 가 core 전역으로
 * 검사한다 — 여기서 중복하지 않는다.
 */
const INVENTORY_DIR = join(__dirname, '..', '..', 'modules', 'inventory');
const HTTP_METHODS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);

const S = INVENTORY_SCOPE;

const ROUTE_SCOPES: Record<string, InventoryScope | null> = {
  /* Step 2 에서 아래 154행을 여기에 넣는다 */
};

/** AST 는 식의 원문만 준다. 값으로 되돌리는 유일한 통로. */
const SCOPE_BY_EXPRESSION: Record<string, InventoryScope> = {
  'INVENTORY_SCOPE.OPERATE': S.OPERATE,
  'INVENTORY_SCOPE.MANAGE': S.MANAGE,
  'INVENTORY_SCOPE.ADJUST': S.ADJUST,
  'INVENTORY_SCOPE.WAREHOUSE_MANAGE': S.WAREHOUSE_MANAGE,
};

interface Route {
  key: string;
  /** 그 핸들러에 걸린 `@RequireScopes` 인자들의 원문. */
  expressions: string[];
}

interface DecoratorInfo {
  name: string;
  args: string[];
}

function collectControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectControllerFiles(full));
    else if (/\.controllers?\.ts$/.test(entry) && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function decoratorsOf(node: ts.Node): DecoratorInfo[] {
  return (ts.getDecorators(node as ts.HasDecorators) ?? []).map((decorator) => {
    const expression = decorator.expression;
    return ts.isCallExpression(expression)
      ? { name: expression.expression.getText(), args: expression.arguments.map((arg) => arg.getText()) }
      : { name: expression.getText(), args: [] };
  });
}

const literal = (arg: string | undefined): string =>
  arg !== undefined && /^['"`]/.test(arg) ? arg.slice(1, -1) : '';

function collectRoutes(file: string): Route[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const routes: Route[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const classDecorators = decoratorsOf(node);
      const controller = classDecorators.find((decorator) => decorator.name === 'Controller');

      if (controller) {
        const base = literal(controller.args[0]);
        const classScopes = classDecorators.filter((decorator) => decorator.name === 'RequireScopes');

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const decorators = decoratorsOf(member);
          const route = decorators.find((decorator) => HTTP_METHODS.has(decorator.name));
          if (!route) continue;

          const path = `/${base}/${literal(route.args[0])}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
          const scopeDecorators = [
            ...classScopes,
            ...decorators.filter((decorator) => decorator.name === 'RequireScopes'),
          ];

          routes.push({
            key: `${route.name.toUpperCase()} ${path}`,
            expressions: scopeDecorators.flatMap((decorator) => decorator.args),
          });
        }
      }
    }
    node.forEachChild(visit);
  };

  source.forEachChild(visit);
  return routes;
}

/** 표와 비교 가능한 값. `undefined` 는 "해석 불가" — 별도 테스트가 잡는다. */
function resolveScope(route: Route): InventoryScope | null | undefined {
  if (route.expressions.length === 0) return null;
  if (route.expressions.length > 1) return undefined;
  return SCOPE_BY_EXPRESSION[route.expressions[0]];
}

describe('core inventory: 라우트 스코프 배정 커버리지', () => {
  const files = collectControllerFiles(INVENTORY_DIR);
  const routes = files.flatMap(collectRoutes);

  it('컨트롤러 파일을 실제로 수집한다 (수집 실패로 인한 위양성 방지)', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it('표와 코드의 라우트 집합이 정확히 일치한다', () => {
    const inCode = new Set(routes.map((route) => route.key));
    const inTable = new Set(Object.keys(ROUTE_SCOPES));

    const missingFromTable = [...inCode].filter((key) => !inTable.has(key)).sort();
    const staleInTable = [...inTable].filter((key) => !inCode.has(key)).sort();

    expect({ missingFromTable, staleInTable }).toEqual({ missingFromTable: [], staleInTable: [] });
  });

  it('모든 @RequireScopes 인자가 알려진 스코프 식이다', () => {
    const unresolved = routes
      .filter((route) => route.expressions.length > 0 && resolveScope(route) === undefined)
      .map((route) => `${route.key} → ${route.expressions.join(', ')}`)
      .sort();

    expect(unresolved).toEqual([]);
  });

  it('모든 라우트의 스코프가 배정표와 일치한다', () => {
    const mismatches = routes
      .filter((route) => route.key in ROUTE_SCOPES)
      .filter((route) => resolveScope(route) !== ROUTE_SCOPES[route.key])
      .map((route) => `${route.key}: 표=${ROUTE_SCOPES[route.key] ?? '무표시'} 코드=${resolveScope(route) ?? '무표시'}`)
      .sort();

    expect(mismatches).toEqual([]);
  });
});
```

- [ ] **Step 2: 표를 채운다**

Step 1 스펙의 `ROUTE_SCOPES` 안 `/* Step 2 에서 아래 154행을 여기에 넣는다 */` 주석을 아래 154행으로 교체한다.

```typescript

  // ── inventory.operate (70) ──────────────────────────────────────────
  'GET /holders':                                            S.OPERATE,
  'GET /holders/:id':                                        S.OPERATE,
  'POST /inbound/cancel':                                    S.OPERATE,
  'GET /inbound/history':                                    S.OPERATE,
  'POST /inbound/individual':                                S.OPERATE,
  'POST /inbound/lines/:lineId/memo':                        S.OPERATE,
  'GET /inbound/pending':                                    S.OPERATE,
  'POST /inbound/plans':                                     S.OPERATE,
  'GET /inbound/plans/items':                                S.OPERATE,
  'POST /inbound/plans/items':                               S.OPERATE,
  'POST /inbound/plans/receive':                             S.OPERATE,
  'POST /inbound/putaway':                                   S.OPERATE,
  'GET /inbound/putaway/pending':                            S.OPERATE,
  'GET /inbound/receipts':                                   S.OPERATE,
  'POST /inbound/return':                                    S.OPERATE,
  'POST /inbound/simple':                                    S.OPERATE,
  'POST /inbound/simple-fullscan':                           S.OPERATE,
  'GET /inbound/status':                                     S.OPERATE,
  'POST /inbound/verify-barcode':                            S.OPERATE,
  'GET /inbound/work-logs':                                  S.OPERATE,
  'GET /inventory/managers/:managerId/skus':                 S.OPERATE,
  'GET /inventory/reservations/by-sku/:skuId':               S.OPERATE,
  'GET /inventory/reservations/by-target':                   S.OPERATE,
  'GET /inventory/reservations/summary/:warehouseId':        S.OPERATE,
  'GET /inventory/returns':                                  S.OPERATE,
  'GET /inventory/returns/:id':                              S.OPERATE,
  'GET /inventory/safety-stock-status/:skuId':               S.OPERATE,
  'GET /inventory/safety-stock-warnings':                    S.OPERATE,
  'GET /inventory/sku-groups':                               S.OPERATE,
  'GET /inventory/sku-groups/:id':                           S.OPERATE,
  'GET /inventory/sku-groups/:id/members':                   S.OPERATE,
  'GET /inventory/sku-groups/ungrouped':                     S.OPERATE,
  'GET /inventory/skus':                                     S.OPERATE,
  'GET /inventory/skus/:id':                                 S.OPERATE,
  'GET /inventory/skus/:id/stock-summary':                   S.OPERATE,
  'GET /inventory/skus/:skuId/managers':                     S.OPERATE,
  'GET /inventory/skus/deleted':                             S.OPERATE,
  'GET /inventory/skus/managers/all':                        S.OPERATE,
  'GET /inventory/skus/search/advanced':                     S.OPERATE,
  'GET /inventory/stocks':                                   S.OPERATE,
  'GET /inventory/stocks/history':                           S.OPERATE,
  'GET /inventory/stocks/inbound-pipeline':                  S.OPERATE,
  'GET /inventory/stocks/location/:locationId':              S.OPERATE,
  'GET /inventory/stocks/sku/:skuId/total':                  S.OPERATE,
  'GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId': S.OPERATE,
  'GET /inventory/stocks/summary':                           S.OPERATE,
  'GET /inventory/transfers':                                S.OPERATE,
  'GET /inventory/transfers/:id':                            S.OPERATE,
  'GET /inventory/transfers/:id/status':                     S.OPERATE,
  'GET /inventory/warehouse-transfers/outstanding':          S.OPERATE,
  'GET /inventory/warehouses':                               S.OPERATE,
  'GET /inventory/warehouses/:id':                           S.OPERATE,
  'GET /inventory/warehouses/:id/summary':                   S.OPERATE,
  'GET /locations/:locationId':                              S.OPERATE,
  'GET /locations/warehouses/:warehouseId':                  S.OPERATE,
  'GET /locations/warehouses/:warehouseId/columns':          S.OPERATE,
  'GET /locations/warehouses/:warehouseId/racks':            S.OPERATE,
  'GET /movement/history':                                   S.OPERATE,
  'GET /movement/jobs/:jobId':                               S.OPERATE,
  'POST /movement/move':                                     S.OPERATE,
  'PUT /stocktaking/lines/:id/count':                        S.OPERATE,
  'POST /stocktaking/scan-location':                         S.OPERATE,
  'POST /stocktaking/scan-product':                          S.OPERATE,
  'GET /stocktaking/sessions':                               S.OPERATE,
  'POST /stocktaking/sessions':                              S.OPERATE,
  'GET /stocktaking/sessions/:id':                           S.OPERATE,
  'POST /stocktaking/sessions/:id/cancel':                   S.OPERATE,
  'POST /stocktaking/sessions/:id/complete':                 S.OPERATE,
  'POST /stocktaking/sessions/:id/start':                    S.OPERATE,
  'GET /stocktaking/sessions/:id/variances':                 S.OPERATE,

  // ── inventory.manage (56) ──────────────────────────────────────────
  'POST /barcode-generation/custom':                           S.MANAGE,
  'POST /barcode-generation/fulfillment-order':                S.MANAGE,
  'POST /barcode-generation/location':                         S.MANAGE,
  'POST /barcode-generation/sku':                              S.MANAGE,
  'POST /barcode-generation/validate':                         S.MANAGE,
  'POST /holders':                                             S.MANAGE,
  'DELETE /holders/:id':                                       S.MANAGE,
  'PUT /holders/:id':                                          S.MANAGE,
  'POST /inventory/sku-groups':                                S.MANAGE,
  'DELETE /inventory/sku-groups/:id':                          S.MANAGE,
  'PUT /inventory/sku-groups/:id':                             S.MANAGE,
  'POST /inventory/sku-groups/:id/members':                    S.MANAGE,
  'POST /inventory/sku-groups/:id/members/bulk':               S.MANAGE,
  'DELETE /inventory/sku-groups/members/:skuId':               S.MANAGE,
  'POST /inventory/skus':                                      S.MANAGE,
  'DELETE /inventory/skus/:id':                                S.MANAGE,
  'PUT /inventory/skus/:id':                                   S.MANAGE,
  'POST /inventory/skus/:id/barcodes':                         S.MANAGE,
  'DELETE /inventory/skus/:id/barcodes/:barcodeId':            S.MANAGE,
  'PATCH /inventory/skus/:id/restore':                         S.MANAGE,
  'DELETE /inventory/skus/:skuId/managers':                    S.MANAGE,
  'PUT /inventory/skus/:skuId/managers':                       S.MANAGE,
  'DELETE /inventory/skus/:skuId/managers/:role':              S.MANAGE,
  'POST /inventory/skus/managers':                             S.MANAGE,
  'PUT /locations/:locationId':                                S.MANAGE,
  'PUT /locations/columns/:columnId':                          S.MANAGE,
  'PUT /locations/racks/:rackId':                              S.MANAGE,
  'POST /locations/warehouses/:warehouseId/columns':           S.MANAGE,
  'POST /locations/warehouses/:warehouseId/racks':             S.MANAGE,
  'POST /locations/warehouses/:warehouseId/racks/custom-bins': S.MANAGE,
  'POST /locations/warehouses/:warehouseId/zones':             S.MANAGE,
  'GET /purchase-orders':                                      S.MANAGE,
  'POST /purchase-orders':                                     S.MANAGE,
  'GET /purchase-orders/:id':                                  S.MANAGE,
  'PUT /purchase-orders/:id/approve':                          S.MANAGE,
  'PUT /purchase-orders/:id/lines':                            S.MANAGE,
  'PUT /purchase-orders/:id/reject':                           S.MANAGE,
  'PUT /purchase-orders/:id/status':                           S.MANAGE,
  'PUT /purchase-orders/:id/submit-for-audit':                 S.MANAGE,
  'DELETE /purchase-orders/cart':                              S.MANAGE,
  'GET /purchase-orders/cart':                                 S.MANAGE,
  'POST /purchase-orders/cart':                                S.MANAGE,
  'DELETE /purchase-orders/cart/:itemId':                      S.MANAGE,
  'PUT /purchase-orders/cart/:itemId':                         S.MANAGE,
  'POST /purchase-orders/from-cart':                           S.MANAGE,
  'GET /purchase-orders/suggestions/reorder':                  S.MANAGE,
  'GET /supplier-categories':                                  S.MANAGE,
  'POST /supplier-categories':                                 S.MANAGE,
  'DELETE /supplier-categories/:id':                           S.MANAGE,
  'GET /supplier-categories/:id':                              S.MANAGE,
  'PUT /supplier-categories/:id':                              S.MANAGE,
  'GET /suppliers':                                            S.MANAGE,
  'POST /suppliers':                                           S.MANAGE,
  'DELETE /suppliers/:id':                                     S.MANAGE,
  'GET /suppliers/:id':                                        S.MANAGE,
  'PUT /suppliers/:id':                                        S.MANAGE,

  // ── inventory.adjust (18) ──────────────────────────────────────────
  'DELETE /inventory/reservations/:id':                         S.ADJUST,
  'POST /inventory/reservations/reconcile':                     S.ADJUST,
  'POST /inventory/returns':                                    S.ADJUST,
  'PATCH /inventory/returns/:id/inspect':                       S.ADJUST,
  'PATCH /inventory/returns/:id/process':                       S.ADJUST,
  'PATCH /inventory/returns/:id/receive':                       S.ADJUST,
  'POST /inventory/stocks/adjust':                              S.ADJUST,
  'POST /inventory/stocks/entry-safe':                          S.ADJUST,
  'DELETE /inventory/stocks/events/:eventId/cancel':            S.ADJUST,
  'POST /inventory/stocks/summary/:skuId/:warehouseId/rebuild': S.ADJUST,
  'POST /inventory/transfers':                                  S.ADJUST,
  'PATCH /inventory/transfers/:id/execute':                     S.ADJUST,
  'POST /inventory/transfers/move-within-warehouse':            S.ADJUST,
  'POST /inventory/warehouse-transfers':                        S.ADJUST,
  'PATCH /inventory/warehouse-transfers/:id/eta':               S.ADJUST,
  'POST /inventory/warehouse-transfers/:id/receipts':           S.ADJUST,
  'POST /inventory/warehouse-transfers/:id/ship':               S.ADJUST,
  'POST /stocktaking/sessions/:id/generate-adjustments':        S.ADJUST,

  // ── inventory.warehouse.manage (3) ──────────────────────────────────────────
  'POST /inventory/warehouses':       S.WAREHOUSE_MANAGE,
  'DELETE /inventory/warehouses/:id': S.WAREHOUSE_MANAGE,
  'PATCH /inventory/warehouses/:id':  S.WAREHOUSE_MANAGE,

  // ── 무표시 유지 (7) ──────────────────────────────────────────
  'GET /inventory/health':                                          null,
  'GET /inventory/health/detailed':                                 null,
  'GET /inventory/health/live':                                     null,
  'GET /inventory/health/ready':                                    null,
  'GET /inventory/ledger-reconciliation':                           null,
  'GET /inventory/ledger-reconciliation/reservations':              null,
  'GET /inventory/product-sellable-quantities/variants/:variantId': null,
```

- [ ] **Step 3: 돌려서 예상대로 실패하는지 확인한다**

Run: `npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | tail -30`

Expected:
- `컨트롤러 파일을 실제로 수집한다` → PASS
- `표와 코드의 라우트 집합이 정확히 일치한다` → **PASS** (표가 154개 전수라 집합은 이미 맞다)
- `모든 @RequireScopes 인자가 알려진 스코프 식이다` → PASS
- `모든 라우트의 스코프가 배정표와 일치한다` → **FAIL, 불일치 정확히 144건**

불일치 수를 세어 144인지 확인한다:

```bash
npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep -c '표=inventory'
```

144 가 아니면 표를 잘못 옮긴 것이다. 다음 태스크로 넘어가지 말 것.

- [ ] **Step 4: 나머지 스펙이 GREEN 인지 확인한다**

Run: `npx jest apps/core/src/platform/auth --maxWorkers=2`
Expected: `inventory-scope-coverage.spec.ts` 만 실패, 나머지 4개 스펙 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
git commit -m "test(auth): inventory 라우트 154개 스코프 배정표 (#551)

의도적으로 RED 로 들어온다 — 불일치 144건. T3~T7 이 0 으로 만든다."
```

---

## T3–T7 공통: 데코레이터 부착 방법

다섯 태스크가 같은 기계적 편집을 한다. 각 태스크에서 반복하지 않도록 여기 한 번만 적는다.

**① 컨트롤러 클래스에 가드를 붙인다** (이미 있으면 건너뛴다):

```typescript
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';

@ApiTags('Inventory')
@Controller('stocktaking')
@UseGuards(ScopeGuard)          // ← 클래스 레벨. 파일당 한 번
export class StocktakingController {
```

`UseGuards` 는 `@nestjs/common` 에서 import 한다. 상대경로 `../../../../platform/auth/inventory-scopes` 의 깊이는 파일 위치마다 다르다 — `apps/core/src/modules/inventory/<a>/controllers/<b>.ts` 는 `../../../../platform/auth/inventory-scopes` 이다.

**클래스 레벨 가드가 안전한 이유**: `ScopeGuard.canActivate` 는 `@RequireScopes` 메타데이터가 없으면 즉시 `true` 를 반환한다(`scope.guard.ts:66`). 따라서 아직 스코프를 안 붙인 핸들러의 동작은 변하지 않는다. `@RequireScopes` 를 클래스 레벨에 붙이면 안 된다 — 그건 모든 핸들러에 적용된다.

**② 각 핸들러에 스코프를 붙인다:**

```typescript
  @Post('scan-product')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '상품 바코드 스캔' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async scanProduct(@Body() dto: ScanProductDto) {
```

`@RequireScopes` 는 HTTP 메서드 데코레이터 **바로 아래**에 둔다. `@ApiResponse({ status: 403, ... })` 를 함께 추가한다 — #546 이 세운 형태다. 403 설명 문구는 스코프별로:

| 스코프 | 403 설명 |
|---|---|
| `INVENTORY_SCOPE.OPERATE` | `'재고 현장 작업 권한이 없습니다.'` |
| `INVENTORY_SCOPE.MANAGE` | `'재고 마스터데이터 관리 권한이 없습니다.'` |
| `INVENTORY_SCOPE.ADJUST` | `'재고 원장 조정 권한이 없습니다.'` |

**③ 검증** — 태스크마다 다음 두 명령을 돌린다:

```bash
# 남은 불일치 수 (태스크마다 목표치가 다르다)
npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep -c '표=inventory'

# 데코레이터↔가드 짝이 깨지지 않았는지
npx jest apps/core/src/platform/auth/scope-guard-binding --maxWorkers=2
```

**④ 한 파일이 여러 태스크에 걸친다.** 예컨대 `location.controller.ts` 는 T4(읽기 4개)와 T6(쓰기 7개)에 모두 나온다. 나중 태스크는 클래스 레벨 가드가 이미 붙어 있으니 핸들러만 손댄다.

---

### Task 3: operate 부착 — 현장 작업 (31 라우트 / 3 파일)

**Files:**
- Modify: 아래 컨트롤러 3개
- Test: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (기존 — 편집하지 않는다)

**Interfaces:**
- Consumes: `INVENTORY_SCOPE.OPERATE` (T1), 배정표 (T2)
- Produces: 없음. 다음 태스크는 남은 불일치 수만 이어받는다.

warehouse-app(PDA)이 직접 부르는 경로다. 이 태스크가 끝나면 `logistics_worker` 가 적치·입고확정·실사 카운트·이동을 할 수 있게 된다 — 오늘은 `AdminRealmGuard` 가 막고 있다.

**주의**: `POST /stocktaking/sessions/:id/generate-adjustments` 는 이 태스크에 **없다**. 실사 차이를 원장에 반영하는 행위라 T7 에서 `ADJUST` 를 받는다. 같은 파일 안에서 갈리니 그 핸들러는 건드리지 말 것.

**또 하나**: `POST /inbound/return` 은 여기 있고(반품품을 창고에서 *수령*하는 현장 행위),
`/inventory/returns/*` 쓰기는 T7 에서 `ADJUST` 를 받는다(반품 레코드의 검수·처리 수명주기).
경로 이름이 비슷하지만 다른 행위다 — 헷갈려서 한쪽으로 몰지 말 것.

부착 방법은 §"T3–T7 공통: 데코레이터 부착 방법" 을 그대로 따른다. 스코프는 전부 `INVENTORY_SCOPE.OPERATE` 하나다.

- [ ] **Step 1: 아래 라우트 31개에 `@RequireScopes(INVENTORY_SCOPE.OPERATE)` 를 붙인다**

경로는 `apps/core/src/modules/inventory/` 기준.

**`inbound/controllers/inbound.controllers.ts`** — 18개

`GET /inbound/history` · `GET /inbound/pending` · `GET /inbound/plans/items` · `GET /inbound/putaway/pending` · `GET /inbound/receipts` · `GET /inbound/status` · `GET /inbound/work-logs` · `POST /inbound/cancel` · `POST /inbound/individual` · `POST /inbound/lines/:lineId/memo` · `POST /inbound/plans` · `POST /inbound/plans/items` · `POST /inbound/plans/receive` · `POST /inbound/putaway` · `POST /inbound/return` · `POST /inbound/simple` · `POST /inbound/simple-fullscan` · `POST /inbound/verify-barcode`

**`movement/controllers/movement.controller.ts`** — 3개

`GET /movement/history` · `GET /movement/jobs/:jobId` · `POST /movement/move`

**`stocktaking/controllers/stocktaking.controller.ts`** — 10개

`PUT /stocktaking/lines/:id/count` · `GET /stocktaking/sessions` · `GET /stocktaking/sessions/:id` · `GET /stocktaking/sessions/:id/variances` · `POST /stocktaking/scan-location` · `POST /stocktaking/scan-product` · `POST /stocktaking/sessions` · `POST /stocktaking/sessions/:id/cancel` · `POST /stocktaking/sessions/:id/complete` · `POST /stocktaking/sessions/:id/start`


- [ ] **Step 2: 남은 불일치가 113 인지 확인한다**

Run: `npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep -c '표=inventory'`
Expected: `113`

113 이 아니면 붙이다 만 라우트가 있다. 실패 출력에 어느 라우트인지 나오니 그걸 보고 채운다:

```bash
npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep '표=inventory.operate'
```

- [ ] **Step 3: 가드 바인딩과 타입을 확인한다**

Run: `npx jest apps/core/src/platform/auth/scope-guard-binding --maxWorkers=2 && npm run type-check`
Expected: 스펙 PASS, type-check 에러 0

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory
git commit -m "feat(inventory): 현장 작업 라우트에 inventory.operate 부착 (#551)"
```

---

### Task 4: operate 부착 — 조회 전반 (39 라우트 / 12 파일)

**Files:**
- Modify: 아래 컨트롤러 12개
- Test: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (기존 — 편집하지 않는다)

**Interfaces:**
- Consumes: `INVENTORY_SCOPE.OPERATE` (T1), 배정표 (T2)
- Produces: 없음. 다음 태스크는 남은 불일치 수만 이어받는다.

전부 `@Get` 이다. 매입 원가·거래처 계좌가 나가는 purchase-orders·suppliers 조회는 여기 없다 — T5 에서 `MANAGE` 를 받는다.

**`warehouse.controller.ts` 는 특별 취급한다.** #546 이 붙여둔 메서드 레벨 `@UseGuards(ScopeGuard)` 3개(`@Post`/`@Patch`/`@Delete`)를 지우고 클래스 레벨 하나로 합친다. `@RequireScopes(INVENTORY_SCOPE.WAREHOUSE_MANAGE)` 3개는 **그대로 둔다.** 그 다음 `@Get` 3개에 `OPERATE` 를 붙인다.

부착 방법은 §"T3–T7 공통: 데코레이터 부착 방법" 을 그대로 따른다. 스코프는 전부 `INVENTORY_SCOPE.OPERATE` 하나다.

- [ ] **Step 1: 아래 라우트 39개에 `@RequireScopes(INVENTORY_SCOPE.OPERATE)` 를 붙인다**

경로는 `apps/core/src/modules/inventory/` 기준.

**`core/controllers/holder.controller.ts`** — 2개

`GET /holders` · `GET /holders/:id`

**`core/controllers/inventory.controller.ts`** — 2개

`GET /inventory/safety-stock-status/:skuId` · `GET /inventory/safety-stock-warnings`

**`core/controllers/location.controller.ts`** — 4개

`GET /locations/:locationId` · `GET /locations/warehouses/:warehouseId` · `GET /locations/warehouses/:warehouseId/columns` · `GET /locations/warehouses/:warehouseId/racks`

**`core/controllers/reservation.controller.ts`** — 3개

`GET /inventory/reservations/by-sku/:skuId` · `GET /inventory/reservations/by-target` · `GET /inventory/reservations/summary/:warehouseId`

**`core/controllers/return.controller.ts`** — 2개

`GET /inventory/returns` · `GET /inventory/returns/:id`

**`core/controllers/sku-managers.controller.ts`** — 3개

`GET /inventory/managers/:managerId/skus` · `GET /inventory/skus/:skuId/managers` · `GET /inventory/skus/managers/all`

**`core/controllers/transfer.controller.ts`** — 3개

`GET /inventory/transfers` · `GET /inventory/transfers/:id` · `GET /inventory/transfers/:id/status`

**`sku-catalog/controllers/sku-catalog.controller.ts`** — 4개

`GET /inventory/skus` · `GET /inventory/skus/:id` · `GET /inventory/skus/deleted` · `GET /inventory/skus/search/advanced`

**`sku-group/controllers/sku-group.controller.ts`** — 4개

`GET /inventory/sku-groups` · `GET /inventory/sku-groups/:id` · `GET /inventory/sku-groups/:id/members` · `GET /inventory/sku-groups/ungrouped`

**`stock-projection/controllers/stock-projection.controller.ts`** — 8개

`GET /inventory/skus/:id/stock-summary` · `GET /inventory/stocks` · `GET /inventory/stocks/history` · `GET /inventory/stocks/inbound-pipeline` · `GET /inventory/stocks/location/:locationId` · `GET /inventory/stocks/sku/:skuId/total` · `GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId` · `GET /inventory/stocks/summary`

**`warehouse-transfer/controllers/warehouse-transfer.controller.ts`** — 1개

`GET /inventory/warehouse-transfers/outstanding`

**`warehouse/controllers/warehouse.controller.ts`** — 3개

`GET /inventory/warehouses` · `GET /inventory/warehouses/:id` · `GET /inventory/warehouses/:id/summary`


- [ ] **Step 2: 남은 불일치가 74 인지 확인한다**

Run: `npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep -c '표=inventory'`
Expected: `74`

74 이 아니면 붙이다 만 라우트가 있다. 실패 출력에 어느 라우트인지 나오니 그걸 보고 채운다:

```bash
npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep '표=inventory.operate'
```

- [ ] **Step 3: 가드 바인딩과 타입을 확인한다**

Run: `npx jest apps/core/src/platform/auth/scope-guard-binding --maxWorkers=2 && npm run type-check`
Expected: 스펙 PASS, type-check 에러 0

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory
git commit -m "feat(inventory): 재고 조회 라우트에 inventory.operate 부착 (#551)"
```

---

### Task 5: manage 부착 — 매입·거래처 (25 라우트 / 3 파일)

**Files:**
- Modify: 아래 컨트롤러 3개
- Test: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (기존 — 편집하지 않는다)

**Interfaces:**
- Consumes: `INVENTORY_SCOPE.MANAGE` (T1), 배정표 (T2)
- Produces: 없음. 다음 태스크는 남은 불일치 수만 이어받는다.

**읽기까지 `MANAGE` 인 유일한 묶음이다.** `GET /purchase-orders`·`/:id` 는 `unitPrice`(매입 원가)를, `GET /suppliers`·`/:id` 는 `bankAccountNo`(거래처 은행계좌)를 응답에 싣는다. 현장 작업자가 볼 데이터가 아니다.

부착 방법은 §"T3–T7 공통: 데코레이터 부착 방법" 을 그대로 따른다. 스코프는 전부 `INVENTORY_SCOPE.MANAGE` 하나다.

- [ ] **Step 1: 아래 라우트 25개에 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` 를 붙인다**

경로는 `apps/core/src/modules/inventory/` 기준.

**`inbound/controllers/purchase-order.controller.ts`** — 15개

`GET /purchase-orders` · `GET /purchase-orders/:id` · `PUT /purchase-orders/:id/approve` · `PUT /purchase-orders/:id/lines` · `PUT /purchase-orders/:id/reject` · `PUT /purchase-orders/:id/status` · `PUT /purchase-orders/:id/submit-for-audit` · `GET /purchase-orders/cart` · `PUT /purchase-orders/cart/:itemId` · `GET /purchase-orders/suggestions/reorder` · `POST /purchase-orders` · `POST /purchase-orders/cart` · `POST /purchase-orders/from-cart` · `DELETE /purchase-orders/cart` · `DELETE /purchase-orders/cart/:itemId`

**`suppliers/controllers/supplier-categories.controller.ts`** — 5개

`GET /supplier-categories` · `GET /supplier-categories/:id` · `PUT /supplier-categories/:id` · `POST /supplier-categories` · `DELETE /supplier-categories/:id`

**`suppliers/controllers/suppliers.controller.ts`** — 5개

`GET /suppliers` · `GET /suppliers/:id` · `PUT /suppliers/:id` · `POST /suppliers` · `DELETE /suppliers/:id`


- [ ] **Step 2: 남은 불일치가 49 인지 확인한다**

Run: `npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep -c '표=inventory'`
Expected: `49`

49 이 아니면 붙이다 만 라우트가 있다. 실패 출력에 어느 라우트인지 나오니 그걸 보고 채운다:

```bash
npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep '표=inventory.manage'
```

- [ ] **Step 3: 가드 바인딩과 타입을 확인한다**

Run: `npx jest apps/core/src/platform/auth/scope-guard-binding --maxWorkers=2 && npm run type-check`
Expected: 스펙 PASS, type-check 에러 0

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory
git commit -m "feat(inventory): 매입·거래처 라우트에 inventory.manage 부착 (#551)"
```

---

### Task 6: manage 부착 — 마스터데이터 (31 라우트 / 6 파일)

**Files:**
- Modify: 아래 컨트롤러 6개
- Test: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (기존 — 편집하지 않는다)

**Interfaces:**
- Consumes: `INVENTORY_SCOPE.MANAGE` (T1), 배정표 (T2)
- Produces: 없음. 다음 태스크는 남은 불일치 수만 이어받는다.

전부 쓰기다. 같은 컨트롤러의 `@Get` 은 T4 에서 이미 `OPERATE` 를 받았다 — 읽기는 열고 쓰기만 관리자로 좁히는 게 의도다. 다섯 파일(`holder`·`location`·`sku-catalog`·`sku-group`·`sku-managers`)은 클래스 레벨 가드가 T4 에서 이미 붙었다. `barcode-generation` 만 이 태스크에서 처음 손댄다.

부착 방법은 §"T3–T7 공통: 데코레이터 부착 방법" 을 그대로 따른다. 스코프는 전부 `INVENTORY_SCOPE.MANAGE` 하나다.

- [ ] **Step 1: 아래 라우트 31개에 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` 를 붙인다**

경로는 `apps/core/src/modules/inventory/` 기준.

**`core/controllers/holder.controller.ts`** — 3개

`PUT /holders/:id` · `POST /holders` · `DELETE /holders/:id`

**`core/controllers/location.controller.ts`** — 7개

`PUT /locations/:locationId` · `PUT /locations/columns/:columnId` · `PUT /locations/racks/:rackId` · `POST /locations/warehouses/:warehouseId/columns` · `POST /locations/warehouses/:warehouseId/racks` · `POST /locations/warehouses/:warehouseId/racks/custom-bins` · `POST /locations/warehouses/:warehouseId/zones`

**`core/controllers/sku-managers.controller.ts`** — 4개

`PUT /inventory/skus/:skuId/managers` · `POST /inventory/skus/managers` · `DELETE /inventory/skus/:skuId/managers` · `DELETE /inventory/skus/:skuId/managers/:role`

**`shared/controllers/barcode-generation.controller.ts`** — 5개

`POST /barcode-generation/custom` · `POST /barcode-generation/fulfillment-order` · `POST /barcode-generation/location` · `POST /barcode-generation/sku` · `POST /barcode-generation/validate`

**`sku-catalog/controllers/sku-catalog.controller.ts`** — 6개

`PUT /inventory/skus/:id` · `POST /inventory/skus` · `POST /inventory/skus/:id/barcodes` · `PATCH /inventory/skus/:id/restore` · `DELETE /inventory/skus/:id` · `DELETE /inventory/skus/:id/barcodes/:barcodeId`

**`sku-group/controllers/sku-group.controller.ts`** — 6개

`PUT /inventory/sku-groups/:id` · `POST /inventory/sku-groups` · `POST /inventory/sku-groups/:id/members` · `POST /inventory/sku-groups/:id/members/bulk` · `DELETE /inventory/sku-groups/:id` · `DELETE /inventory/sku-groups/members/:skuId`


- [ ] **Step 2: 남은 불일치가 18 인지 확인한다**

Run: `npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep -c '표=inventory'`
Expected: `18`

18 이 아니면 붙이다 만 라우트가 있다. 실패 출력에 어느 라우트인지 나오니 그걸 보고 채운다:

```bash
npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep '표=inventory.manage'
```

- [ ] **Step 3: 가드 바인딩과 타입을 확인한다**

Run: `npx jest apps/core/src/platform/auth/scope-guard-binding --maxWorkers=2 && npm run type-check`
Expected: 스펙 PASS, type-check 에러 0

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory
git commit -m "feat(inventory): 재고 마스터데이터 라우트에 inventory.manage 부착 (#551)"
```

---

### Task 7: adjust 부착 — 원장 직접 조작 (18 라우트 / 7 파일)

**Files:**
- Modify: 아래 컨트롤러 7개
- Test: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` (기존 — 편집하지 않는다)

**Interfaces:**
- Consumes: `INVENTORY_SCOPE.ADJUST` (T1), 배정표 (T2)
- Produces: 없음. 다음 태스크는 남은 불일치 수만 이어받는다.

재고 수량을 사람이 직접 움직이는 경로다. **이 태스크가 끝나면 배정표 스펙이 GREEN 이 된다.**

`POST /inventory/stocks/adjust` 와 `POST /stocktaking/sessions/:id/generate-adjustments` 는 warehouse-app 이 부르는 경로다. `ADJUST` 를 받으므로 PDA 에서 그 두 화면은 `logistics_manager` 를 요구하게 된다 — 의도한 결과다(설계 문서 §결과로 생기는 동작 2건).

부착 방법은 §"T3–T7 공통: 데코레이터 부착 방법" 을 그대로 따른다. 스코프는 전부 `INVENTORY_SCOPE.ADJUST` 하나다.

- [ ] **Step 1: 아래 라우트 18개에 `@RequireScopes(INVENTORY_SCOPE.ADJUST)` 를 붙인다**

경로는 `apps/core/src/modules/inventory/` 기준.

**`core/controllers/inventory.controller.ts`** — 2개

`POST /inventory/stocks/adjust` · `POST /inventory/stocks/entry-safe`

**`core/controllers/reservation.controller.ts`** — 2개

`POST /inventory/reservations/reconcile` · `DELETE /inventory/reservations/:id`

**`core/controllers/return.controller.ts`** — 4개

`POST /inventory/returns` · `PATCH /inventory/returns/:id/inspect` · `PATCH /inventory/returns/:id/process` · `PATCH /inventory/returns/:id/receive`

**`core/controllers/transfer.controller.ts`** — 3개

`POST /inventory/transfers` · `POST /inventory/transfers/move-within-warehouse` · `PATCH /inventory/transfers/:id/execute`

**`stock-projection/controllers/stock-projection.controller.ts`** — 2개

`POST /inventory/stocks/summary/:skuId/:warehouseId/rebuild` · `DELETE /inventory/stocks/events/:eventId/cancel`

**`stocktaking/controllers/stocktaking.controller.ts`** — 1개

`POST /stocktaking/sessions/:id/generate-adjustments`

**`warehouse-transfer/controllers/warehouse-transfer.controller.ts`** — 4개

`POST /inventory/warehouse-transfers` · `POST /inventory/warehouse-transfers/:id/receipts` · `POST /inventory/warehouse-transfers/:id/ship` · `PATCH /inventory/warehouse-transfers/:id/eta`

- [ ] **Step 2: 남은 불일치가 0 인지 확인한다**

Run: `npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep -c '표=inventory'`
Expected: `0`

0 이 아니면 붙이다 만 라우트가 있다. 실패 출력에 어느 라우트인지 나오니 그걸 보고 채운다:

```bash
npx jest apps/core/src/platform/auth/inventory-scope-coverage --maxWorkers=2 2>&1 | grep '표=inventory.adjust'
```

- [ ] **Step 3: 가드 바인딩과 타입을 확인한다**

Run: `npx jest apps/core/src/platform/auth/scope-guard-binding --maxWorkers=2 && npm run type-check`
Expected: 스펙 PASS, type-check 에러 0

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory
git commit -m "feat(inventory): 원장 조작 라우트에 inventory.adjust 부착 (#551)"
```

---

### Task 8: 무표시 7개 사유 명시 + 전체 게이트

**Files:**
- Modify: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`

**Interfaces:**
- Consumes: T2–T7 의 결과 (배정표 GREEN)
- Produces: 없음. 최종 상태.

배정표는 T7 에서 이미 GREEN 이다. 이 태스크는 **무표시 7개가 "아직 안 한 것" 이 아니라 "의도" 임을 코드에 못 박고**, 전체 게이트를 돌린다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`inventory-scope-coverage.spec.ts` 의 `describe` 블록 맨 끝에 추가:

```typescript
  // 무표시는 "아직 안 붙인 것" 이 아니라 결론이다. 이 수가 늘어나면 누군가 스코프 부착을
  // 건너뛰고 표에 null 을 적었다는 뜻이다 — 늘리려면 이 테스트를 고치면서 사유를 적어야 한다.
  it('의도적 무표시는 정확히 7개이며 전부 진단·내부 조회 전용이다', () => {
    const unscoped = Object.entries(ROUTE_SCOPES)
      .filter(([, scope]) => scope === null)
      .map(([key]) => key)
      .sort();

    expect(unscoped).toEqual([
      // 이미 @Public — 로드밸런서·ECS 헬스체크
      'GET /inventory/health',
      'GET /inventory/health/detailed',
      'GET /inventory/health/live',
      'GET /inventory/health/ready',
      // 원장 드리프트 탐지 전용 읽기. HTTP 호출자 0건 (저장소 전수 grep)
      'GET /inventory/ledger-reconciliation',
      'GET /inventory/ledger-reconciliation/reservations',
      // 판매가능수량 조회. HTTP 호출자 0건 (저장소 전수 grep)
      'GET /inventory/product-sellable-quantities/variants/:variantId',
    ]);
  });
```

- [ ] **Step 2: 돌려서 통과를 확인한다**

Run: `npx jest apps/core/src/platform/auth --maxWorkers=2`
Expected: 5개 스펙 전부 PASS. `inventory-scope-coverage.spec.ts` 는 테스트 5개 전부 통과(불일치 0, 무표시 7).

이 단계에서 실패하면 표를 잘못 채운 것이지 새 코드 문제가 아니다.

- [ ] **Step 3: 검증 게이트 4개를 전부 돌린다**

```bash
npm run type-check
npx jest --maxWorkers=2
node scripts/security/route-authz-audit.js
```

Expected:
- `type-check` — 에러 0
- `jest` — 실패 0
- `route-authz-audit.js` — 마지막 줄 `[A] 무력화 0`. core 헤더는 여전히 `AdminRealm=true 기본차단=true`

`route-authz-audit.js` 의 core 섹션에서 `[A]` 가 생겼다면 `@RequireScopes` 를 붙였는데 `ScopeGuard` 가 없는 핸들러가 있다는 뜻이다 — `scope-guard-binding.spec.ts` 가 먼저 잡았어야 하므로 둘 다 확인한다.

- [ ] **Step 4: 부팅이 실제로 되는지 확인한다**

`ScopeBootstrapService.onModuleInit` 이 스코프 4개와 role 매핑 3행을 upsert 한다. 매핑에 미등록 스코프 키가 있으면 **부팅이 죽는다**(`authorization.service.ts:112-114`). 유닛 테스트가 그 불변식을 잡지만(`merged-scopes.spec.ts` 의 `maps only scopes that are actually registered`), 빌드까지 확인한다:

```bash
npx nest build core
```

Expected: 에러 없이 완료

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
git commit -m "test(auth): inventory 무표시 라우트 7개를 사유와 함께 못 박는다 (#551)"
```

- [ ] **Step 6: 설계 문서의 스펙 개수를 실제와 맞춘다**

설계 문서 §"누락을 기계가 잡는다" 는 신규 스펙 2개를 적었지만 구현은 1개다. `docs/superpowers/specs/2026-08-24-inventory-scope-authorization-design.md` 에서 `### inventory-scope-assignment.spec.ts` 절을 지우고, `### inventory-scope-coverage.spec.ts` 절 끝에 한 문장을 더한다:

```markdown
배정표가 154행 전수이므로 "표에 없는 라우트 = 실패" 가 곧 커버리지 단언이다. 별도의
배정표 스펙을 두지 않는 이유가 이것이다 — 같은 표를 두 번 읽게 된다.
```

```bash
git add docs/superpowers/specs/2026-08-24-inventory-scope-authorization-design.md
git commit -m "docs(inventory): 설계 문서의 신규 스펙 수를 구현과 맞춘다 (#551)"
```

---

## 배포

- **마이그레이션 0건.** `sst deploy` 만 하면 `ScopeBootstrapService` 가 부팅 시 스코프·매핑을 반영한다. `migrate → deploy` / `deploy → migrate` 순서 논의 대상이 아니다.
- **core 단독 배포.** admin-web 변경이 없으므로 순서 제약이 없다.
- **배포 후 실측** — admin 계정으로 admin-web inventory 화면 몇 개(`/inventory/skus` 저장, `/inventory/suppliers` 저장, `/inventory/stocktaking` 진행)를 눌러 403 이 없는지 확인한다. role 매핑 누락의 유일한 증상이 그것이다.

## 후속 (이 계획 범위 밖)

- **admin role 자체의 권한 축소.** admin-web 15개 화면의 `requireRole` 재배치 + 기존 admin 유저에게 `logistics_manager` 부여(DB). 별도 이슈.
- **`logistics_*` 를 실제 PDA 운영자에게 부여하는 운영 작업.** 라이브 user-service DB 실측이 선행. 이 계획의 선행조건은 아니다 — 설계가 단조적으로 안전하므로 배포해도 깨지는 게 없다.
- **#713 1단계 종료 처리.** #551 이 닫히면 1단계(#705 + #551)가 완료된다. #713 체크박스 갱신.
