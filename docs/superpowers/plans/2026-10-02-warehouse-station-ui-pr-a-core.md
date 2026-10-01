# 스테이션 UI — PR A (core) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스테이션 출고 검수(PR C)가 기대는 core 변경 A1~A6 을 추가형으로 넣는다 — 작업자 결품·강제출고 스코프, 송장 순서 귀속, 재결품 후보 제외, by-waybill 확장, 보충 대기 조회.

**Architecture:** 전부 `apps/core/src/modules/fulfillment` 과 `apps/core/src/platform/auth` 안의 추가 변경이다. 스코프 둘은 정의 + 역할 매핑 + 엔드포인트·서비스의 «둘 중 하나» 검사로 들어간다. 귀속 순서는 배정 조회의 `orderBy` 만, 재결품 후보 제외는 `planRefill` 에 넘기는 제외 집합만 넓힌다. by-waybill 은 같은 리더에 필드를 더하고, 보충 대기는 새 리더 + 새 컨트롤러다. 마이그레이션 없음.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), Jest(ts-jest), `@app/authorization`(ScopeGuard·RequireScopes).

**Spec:** `docs/superpowers/specs/2026-10-02-warehouse-station-ui-design.md` (§3 U7·U11·U15, §9 A1~A6)

## Global Constraints

- 스코프 키는 정확히 `fulfillment.shipment.short_pick`(상수 `SHIPMENT_SHORT_PICK`)와 `fulfillment.dispatch.station_force`(상수 `DISPATCH_STATION_FORCE`)
- 두 새 스코프는 `logistics_worker` 에 준다. 관리자 스코프 `SHIPMENT_REOPEN`·`DISPATCH_FORCE` 는 작업자에게 주지 않는다. 기존 보유자는 그대로 쓸 수 있어야 한다
- 마이그레이션·시드 추가 없음(역할 매핑은 부팅 시 `ScopeBootstrapService.onModuleInit` 이 맞춘다)
- 레이어 규칙(CLAUDE.md): 컨트롤러는 위임만, 도메인 판정은 서비스/리더/매니저. `any`·`as` 캐스팅 금지 — jsonb 는 타입 가드로 좁힌다
- 트랜잭션: 공개 메서드는 `tx?: DbTx` 마지막 인자, `this.dbService.run(fn, tx)`
- 새 통합 스펙은 `describeIfDb` 가드 + `inRollbackTx`. 스펙 안에서 `dotenv.config()` 금지
- 통합 스펙은 **공유 `core` DB 가 아니라 스크래치 DB** 에서 돌린다(아래 «통합 스펙 실행»). 워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 붙인다
- 게이트: `npm run type-check` 에러 0 · `npx jest` 실패 0 · `npx jest scripts/security` 통과

### 통합 스펙 실행 (모든 태스크 공통)

```bash
# 한 번만: 스크래치 DB 만들기 + 마이그
docker compose up -d postgres
docker compose exec -T postgres psql -U postgres -c 'create database core_station_a' || true
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_station_a \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts

# 태스크마다: 패턴 지정 실행
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_station_a \
  npx jest --runInBand --testPathPattern='<패턴>'
```

`DATABASE_URL` 없이 돌리면 통합 스펙은 skip 된다 — «통과» 로 읽지 말 것.

## Review Focus

1. **스코프 없는 작업자의 직접 호출** — 컨트롤러 가드를 지나도 서비스 내부 검사(`requireScope`·`forceComplete`·`forceDispatch`)가 두 스코프 모두 없으면 403 이어야 한다 → Task 1·2 의 «둘 다 없으면 403» 테스트
2. **관리자 강제출고 경로가 작업자 스코프로 열리지 않는다** — `forceDispatch` 가 station 판정을 받아들이게 넓히지만, 관리자 전용 라우트(`ShipmentController` 강제 발송)는 여전히 `DISPATCH_FORCE` 만 요구해야 한다 → Task 2 의 메타데이터 고정 테스트
3. **한 줄이 두 위치로 나뉜 박스의 스캔 귀속** — 위치 UUID 가 코드 순과 반대일 때도 코드 순 첫 위치부터 채운다 → Task 3 (UUID 를 일부러 거꾸로 심는다)
4. **재결품** — 이미 채운 줄에서 다시 결품이 나면 유령 가용이 있는 원래 위치로 보내지 않는다 → Task 4
5. **보충 대기의 사라짐** — 채운 몫을 집으면 목록에서 빠지고, 다른 창고·이탈 중·채우지 못한 결품은 처음부터 안 나온다 → Task 6

---

### Task 1: 결품 보고 스코프 (A2)

**Files:**
- Modify: `apps/core/src/platform/auth/fulfillment-scopes.ts`
- Modify: `apps/core/src/platform/auth/fulfillment-scopes.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment-short-pick.controller.ts:30`
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment-short-pick.controller.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts:405-411` (`requireScope`)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.spec.ts`

**Interfaces:**
- Produces: `FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK = 'fulfillment.shipment.short_pick'`, `FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE = 'fulfillment.dispatch.station_force'` (Task 2 가 쓴다)

- [ ] **Step 1: 스코프 계약 테스트를 먼저 고친다**

`fulfillment-scopes.spec.ts` 의 첫 두 테스트를 다음으로 바꾼다.

```ts
  it('registers the designed operator scopes and the isolated tracking-ingest scope', () => {
    expect(FULFILLMENT_SCOPES.map((scope) => scope.key)).toEqual([
      'fulfillment.warehouse.operate',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.reservation.transfer',
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.shipment.reopen',
      'fulfillment.tracking.ingest',
      'fulfillment.shipment.short_pick',
      'fulfillment.dispatch.station_force',
    ]);
    expect(new Set(scopeKeys)).toHaveProperty('size', 10);
  });

  it('gives the worker only operate + station short-pick/force, never the manager scopes', () => {
    expect(roleScopes.get('logistics_worker')).toEqual([
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
      FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
      FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    ]);
    expect(roleScopes.get('logistics_worker')).not.toContain(FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
    expect(roleScopes.get('logistics_worker')).not.toContain(FULFILLMENT_SCOPE.DISPATCH_FORCE);
    expect(roleScopes.get('logistics_manager')).toEqual(
      scopeKeys.filter((scope) => scope !== FULFILLMENT_SCOPE.TRACKING_INGEST),
    );
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/platform/auth/fulfillment-scopes.spec.ts`
Expected: FAIL — `SHIPMENT_SHORT_PICK` 프로퍼티 없음(타입 에러는 ts-jest 가 무시하므로 값 비교에서 실패)

- [ ] **Step 3: 스코프 정의·매핑**

`fulfillment-scopes.ts`:

```ts
export const FULFILLMENT_SCOPE = {
  WAREHOUSE_OPERATE: 'fulfillment.warehouse.operate',
  SHIPMENT_CONSOLIDATE: 'fulfillment.shipment.consolidate',
  SHIPMENT_OVERRIDE_RECIPIENT: 'fulfillment.shipment.override_recipient',
  RESERVATION_TRANSFER: 'fulfillment.reservation.transfer',
  DISPATCH_FORCE: 'fulfillment.dispatch.force',
  DISPATCH_RECALL: 'fulfillment.dispatch.recall',
  SHIPMENT_REOPEN: 'fulfillment.shipment.reopen',
  TRACKING_INGEST: 'fulfillment.tracking.ingest',
  SHIPMENT_SHORT_PICK: 'fulfillment.shipment.short_pick',
  DISPATCH_STATION_FORCE: 'fulfillment.dispatch.station_force',
} as const;
```

`FULFILLMENT_SCOPES` 배열 끝(TRACKING_INGEST 항목 뒤)에 추가:

```ts
  {
    key: FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
    category: 'fulfillment',
    description: '스테이션 결품·파손 보고(다른 위치 재배정 또는 박스 이탈)',
  },
  {
    key: FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    category: 'fulfillment',
    description: '스테이션 강제출고 — 남은 미스캔 수량을 채우고 출고(감사 로그에 이 스코프로 남는다)',
  },
```

`FULFILLMENT_ROLE_MAPPINGS` 의 작업자:

```ts
  {
    roleName: 'logistics_worker',
    scopeKeys: [
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
      FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
      FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    ],
  },
```

- [ ] **Step 4: 통과 확인 + 병합 스코프 스펙**

Run: `npx jest apps/core/src/platform/auth`
Expected: PASS. `merged-scopes.spec.ts`·`scope-guard-binding.spec.ts` 가 개수·목록을 고정하고 있어 실패하면 그 기대값에 새 두 키를 같은 위치로 더한다(다른 기대값은 바꾸지 않는다).

- [ ] **Step 5: 결품 컨트롤러·서비스 테스트를 먼저 고친다**

`shipment-short-pick.controller.spec.ts` 첫 테스트의 메타데이터 기대값:

```ts
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, ShipmentShortPickController.prototype.report)).toEqual([
      FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
      FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
    ]);
```

테스트 이름도 `'requires shipment reopen or station short-pick scope and forwards the exact actor/idempotency command'` 로 바꾼다.

`shipment-short-pick.service.spec.ts` 의 기존 403 테스트 이름을 `'reopen·short_pick 스코프가 둘 다 없으면 403 — 명령을 실행하지 않는다'` 로 바꾸고, 그 아래에 추가:

```ts
  it('결품 스코프(short_pick)만 있어도 명령을 실행한다', async () => {
    const { service, commands } = makeService(new Set([FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK]));
    await service.report('s', dto, 'k', { id: 'a', roles: ['logistics_worker'] });
    expect(commands.execute).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 6: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/controllers/shipment-short-pick.controller.spec.ts apps/core/src/modules/fulfillment/services/shipment-short-pick.service.spec.ts`
Expected: FAIL 2건(메타데이터, short_pick 만 있을 때 403)

- [ ] **Step 7: 구현**

`shipment-short-pick.controller.ts`:

```ts
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_REOPEN, FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK)
```

`shipment-short-pick.service.ts` 의 `requireScope`:

```ts
  /** 관리자(reopen) 또는 스테이션 작업자(short_pick) — 스펙 U7. ScopeGuard 를 거치지 않은 직접 호출도 같은 규칙. */
  private async requireScope(actor: ShipmentShortPickActor): Promise<void> {
    if (actor.roles.includes('master')) return;
    const scopes = await this.authorization.getScopesByRoles(actor.roles);
    if (!scopes.has(FULFILLMENT_SCOPE.SHIPMENT_REOPEN) && !scopes.has(FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK)) {
      throw new ForbiddenException(
        `Missing required scope: ${FULFILLMENT_SCOPE.SHIPMENT_REOPEN} or ${FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK}`,
      );
    }
  }
```

- [ ] **Step 8: 통과 확인**

Run: 같은 명령
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/platform/auth apps/core/src/modules/fulfillment/controllers/shipment-short-pick.controller.ts apps/core/src/modules/fulfillment/controllers/shipment-short-pick.controller.spec.ts apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts apps/core/src/modules/fulfillment/services/shipment-short-pick.service.spec.ts
git commit -m "feat(fulfillment): 작업자 결품 보고·강제출고 스코프를 신설하고 결품 보고에 연다"
```

---

### Task 2: 스테이션 강제출고 권한 (A3)

**Files:**
- Create: `apps/core/src/platform/auth/force-dispatch-authorization.ts`
- Create: `apps/core/src/platform/auth/force-dispatch-authorization.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.ts:73-93` (`force`)
- Modify: `apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts:196-201` (`forceComplete` 검사)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts:336-342` (`forceDispatch` 검사)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment.controller.spec.ts` (관리자 라우트 메타데이터 고정)
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts` (`forceComplete` describe)

**Interfaces:**
- Consumes: `FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE` (Task 1)
- Produces: `forceDispatchDecisionFrom(request: unknown): ScopeAuthorizationDecision | undefined`, `isForceDispatchDecision(value: unknown): value is ScopeAuthorizationDecision` — `apps/core/src/platform/auth/force-dispatch-authorization.ts`

- [ ] **Step 1: 판정 헬퍼 테스트**

`force-dispatch-authorization.spec.ts`:

```ts
import { SCOPE_AUTHORIZATION_DECISION_BRAND } from '@app/authorization';
import { FULFILLMENT_SCOPE } from './fulfillment-scopes';
import { isForceDispatchDecision } from './force-dispatch-authorization';

const decision = (scope: string, granted = true) => ({ scope, granted, [SCOPE_AUTHORIZATION_DECISION_BRAND]: true });

describe('isForceDispatchDecision', () => {
  it.each([
    ['관리자 강제출고', decision(FULFILLMENT_SCOPE.DISPATCH_FORCE), true],
    ['스테이션 강제출고', decision(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE), true],
    ['다른 스코프', decision(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE), false],
    ['거절된 판정', decision(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE, false), false],
    ['브랜드 없는 위조 객체', { scope: FULFILLMENT_SCOPE.DISPATCH_FORCE, granted: true }, false],
    ['판정 없음', undefined, false],
  ])('%s → %s', (_name, value, expected) => {
    expect(isForceDispatchDecision(value)).toBe(expected);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/platform/auth/force-dispatch-authorization.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 헬퍼 구현**

`force-dispatch-authorization.ts`:

```ts
import {
  getScopeAuthorizationDecision,
  isScopeAuthorizationDecision,
  ScopeAuthorizationDecision,
} from '@app/authorization';
import { FULFILLMENT_SCOPE } from './fulfillment-scopes';

/**
 * 강제출고를 허락하는 판정 — 관리자(`dispatch.force`) 또는 스테이션 작업자(`dispatch.station_force`, 스펙 U15).
 * 판정 객체는 ScopeGuard 가 그 요청이 요구한 스코프에 대해서만 만든다. 그래서 station 판정은 그 스코프를 요구하는
 * 라우트(단순출고 강제완료)로 들어온 요청에만 존재하고, 관리자 전용 강제 발송 라우트로는 만들어지지 않는다.
 */
export function isForceDispatchDecision(value: unknown): value is ScopeAuthorizationDecision {
  return (
    isScopeAuthorizationDecision(value, FULFILLMENT_SCOPE.DISPATCH_FORCE) ||
    isScopeAuthorizationDecision(value, FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE)
  );
}

/** 요청에 기록된 강제출고 판정. 관리자 판정을 우선한다(둘 다 있으면 감사 로그에 관리자로 남는다). */
export function forceDispatchDecisionFrom(request: unknown): ScopeAuthorizationDecision | undefined {
  return (
    getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_FORCE) ??
    getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE)
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/platform/auth/force-dispatch-authorization.spec.ts`
Expected: PASS

- [ ] **Step 5: 컨트롤러 테스트 — station 판정 전달과 라우트 메타데이터**

`simple-outbound.controller.spec.ts` 의 `requestAuthorizedForForce` 를 스코프 인자를 받도록 바꾼다.

```ts
  async function requestAuthorizedForForce(granted: string = FULFILLMENT_SCOPE.DISPATCH_FORCE): Promise<object> {
    const request = { user: { roles: ['warehouse_dispatcher'] } };
    const guard = new ScopeGuard(
      {
        getAllAndOverride: () => [FULFILLMENT_SCOPE.DISPATCH_FORCE, FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE],
      } as never,
      { getScopesByRoles: jest.fn().mockResolvedValue(new Set([granted])) } as never,
    );
    const context = {
      getHandler: () => SimpleOutboundController.prototype.force,
      getClass: () => SimpleOutboundController,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    return request;
  }
```

파일 끝 `describe` 안에 추가(`REQUIRED_SCOPES_KEY` 를 `@app/authorization` import 에 더한다):

```ts
  it('강제완료 라우트는 관리자 또는 스테이션 강제출고 스코프를 요구한다', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, SimpleOutboundController.prototype.force)).toEqual([
      FULFILLMENT_SCOPE.DISPATCH_FORCE,
      FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    ]);
  });

  it('스테이션 작업자의 강제완료는 station 판정을 그대로 서비스에 넘긴다', async () => {
    const { service, controller } = build();
    const request = await requestAuthorizedForForce(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE);

    await controller.force(
      's-1',
      { reason: 'station_force_command' },
      'key-2',
      { userId: 'u-2', roles: ['logistics_worker'] },
      request,
    );

    expect(service.forceComplete.mock.calls[0][1].authorization).toBe(
      getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE),
    );
  });
```

Review Focus 2 를 고정하는 테스트 — 관리자 전용 강제 발송 라우트(`shipment.controller.ts:83-88` `forceDispatch`, `POST shipments/:id/force-dispatch`)는 이 PR 에서 바꾸지 않는다. 지금 그 스코프 메타데이터를 고정하는 테스트가 없으므로 `shipment.controller.spec.ts` 의 `describe` 안에 추가한다(`REQUIRED_SCOPES_KEY` 는 `@app/authorization`, `FULFILLMENT_SCOPE` 는 `../../../platform/auth/fulfillment-scopes` 에서 import):

```ts
  it('관리자 강제 발송 라우트는 dispatch.force 만 요구한다(스테이션 스코프로 열리지 않는다)', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, ShipmentController.prototype.forceDispatch)).toEqual([
      FULFILLMENT_SCOPE.DISPATCH_FORCE,
    ]);
  });
```

이 테스트는 지금도 통과해야 한다(회귀 고정용). 실패하면 전제가 틀린 것이므로 멈추고 보고한다.

- [ ] **Step 6: 디스패치 서비스 테스트**

`shipment-dispatch.service.spec.ts` 상단 상수 옆에:

```ts
const STATION_FORCE_AUTHORIZATION = Object.freeze({
  scope: FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
  granted: true as const,
  [SCOPE_AUTHORIZATION_DECISION_BRAND]: true as const,
});
```

`'rejects a direct force call without the ScopeGuard decision …'` 테스트 바로 아래에 추가:

```ts
  it('rejects a decision for an unrelated scope', async () => {
    const { service, commands } = makeService();
    await expect(
      service.forceDispatch(IDS.shipment, {
        reason: 'wrong scope',
        actor: { id: IDS.actor, roles: ['logistics_worker'] },
        idempotencyKey: 'force-wrong-scope',
        authorization: Object.freeze({
          scope: FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
          granted: true as const,
          [SCOPE_AUTHORIZATION_DECISION_BRAND]: true as const,
        }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('accepts the station force decision and runs the command', async () => {
    const { service, commands } = makeService();
    commands.execute.mockResolvedValue({ shipmentId: IDS.shipment });
    await service.forceDispatch(IDS.shipment, {
      reason: 'station_force_command',
      actor: { id: IDS.actor, roles: ['logistics_worker'] },
      idempotencyKey: 'force-station',
      authorization: STATION_FORCE_AUTHORIZATION,
    });
    expect(commands.execute).toHaveBeenCalledTimes(1);
  });
```

(`makeService` 가 돌려주는 `commands.execute` 가 jest mock 이 아니면, 같은 파일의 기존 `forceDispatch` 성공 테스트(273행 근처)가 쓰는 준비를 그대로 따른다.)

- [ ] **Step 7: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.spec.ts apps/core/src/modules/fulfillment/services/shipment-dispatch.service.spec.ts`
Expected: FAIL — 메타데이터·station 판정 전달·station 판정 수락

- [ ] **Step 8: 구현**

`simple-outbound.controller.ts` 의 `force`:

```ts
  @Post(':shipmentId/simple-outbound-forces')
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_FORCE, FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE)
  ...
        authorization: forceDispatchDecisionFrom(request),
```

import 에 `import { forceDispatchDecisionFrom } from '../../../platform/auth/force-dispatch-authorization';` 를 더하고, 더 이상 안 쓰면 `getScopeAuthorizationDecision` import 를 지운다.

`simple-outbound.service.ts` `forceComplete` 의 검사:

```ts
    if (!isForceDispatchDecision(input.authorization))
      throw new ForbiddenException({
        code: 'FULFILLMENT_DISPATCH_FORCE_FORBIDDEN',
        message: 'Force dispatch scope is required',
      });
```

`shipment-dispatch.service.ts` `forceDispatch` 의 검사:

```ts
    const authorization = input.authorization;
    if (!isForceDispatchDecision(authorization)) {
```

두 파일에 `import { isForceDispatchDecision } from '../../../platform/auth/force-dispatch-authorization';` 를 더하고, 각 파일에서 `isScopeAuthorizationDecision` 을 더 쓰지 않으면 그 import 를 지운다. 감사 로그는 이미 `authorizationScope: authorization.scope` 라 손대지 않는다 — station 강제출고는 `fulfillment.dispatch.station_force` 로 남는다.

- [ ] **Step 9: 통과 확인**

Run: `npx jest apps/core/src/platform/auth apps/core/src/modules/fulfillment/controllers apps/core/src/modules/fulfillment/services/shipment-dispatch.service.spec.ts`
Expected: PASS

- [ ] **Step 10: 통합 — station 판정으로 강제완료가 출고까지 간다**

`simple-outbound.service.integration.spec.ts` 의 `describeIfDb('SimpleOutboundService.forceComplete', …)` 안, 기존 `authorization` 옆에:

```ts
  const stationAuthorization: ScopeAuthorizationDecision = {
    scope: FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    granted: true,
    [SCOPE_AUTHORIZATION_DECISION_BRAND]: true,
  };

  it('스테이션 강제출고 판정으로도 남은 수량을 채워 출고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      await startBatchFor(tx, fixture);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const state = await service.forceComplete(
        fixture.shipmentId,
        { reason: 'station_force_command', actor, idempotencyKey: `force-${randomUUID()}`, authorization: stationAuthorization },
        tx,
      );
      if (isPreparationBlocked(state)) throw new Error('Expected prepared outbound state');
      expect(state.status).toBe('shipped');
    });
  });
```

Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='simple-outbound.service.integration'`
Expected: PASS(새 테스트 포함)

- [ ] **Step 11: Commit**

```bash
git add apps/core/src/platform/auth/force-dispatch-authorization.ts apps/core/src/platform/auth/force-dispatch-authorization.spec.ts apps/core/src/modules/fulfillment/controllers apps/core/src/modules/fulfillment/services/simple-outbound.service.ts apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts apps/core/src/modules/fulfillment/services/shipment-dispatch.service.spec.ts apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts
git commit -m "feat(fulfillment): 스테이션 작업자가 단순출고 강제완료를 쓸 수 있게 한다"
```

---

### Task 3: 위치 없는 스캔을 송장 순서로 귀속 (A1)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts` — `pickScanned` 와 `forcePickRemaining` 의 배정 조회
- Create: `apps/core/src/modules/fulfillment/services/simple-outbound.attribution-order.integration.spec.ts`

**Interfaces:**
- Consumes: 없음. 외부 시그니처 변화 없음

- [ ] **Step 1: 실패하는 통합 테스트**

위치 UUID 를 일부러 코드 순과 반대로 심는다 — 코드는 `AAA-…`(앞), id 는 `ffffffff-…`(뒤). 지금 코드(UUID 순)는 결정적으로 틀린 위치에 귀속한다.

```ts
import { randomUUID } from 'crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './__support__';
import { assembleSimpleOutbound, startBatchFor } from './__support__/simple-outbound-wiring';
import { isPreparationBlocked } from './outbound-preparation-result';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 줄 3개를 L1(SIMPLE-ZONE-…, 재고 2) 과 앞 코드 위치(AAA-…, 재고 1)로 나눈다. 앞 위치의 UUID 는 뒤로 심는다. */
async function splitLineBox(tx: DbTx) {
  const box = await seedPickableShipment(tx, 3);
  await tx
    .update(wmsTables.stockLedgers)
    .set({ qty: 2 })
    .where(and(eq(wmsTables.stockLedgers.skuId, box.skuId), eq(wmsTables.stockLedgers.locationId, box.locationId)));
  const [front] = await tx
    .insert(wmsTables.locations)
    .values({
      id: `ffffffff-ffff-4fff-8fff-${randomUUID().slice(-12)}`,
      warehouseId: box.warehouseId,
      code: `AAA-${randomUUID()}`,
      locationType: 'zone',
    })
    .returning();
  await tx.insert(wmsTables.stockLedgers).values({
    skuId: box.skuId,
    warehouseId: box.warehouseId,
    locationId: front.id,
    stockState: 'ON_HAND',
    qty: 1,
  });
  const run = await startBatchFor(tx, box);
  return { box, frontId: front.id, sessionId: run.sessionId };
}

async function attributed(tx: DbTx, sessionId: string, shipmentLineId: string, sourceLocationId: string) {
  const [row] = await tx
    .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
    .from(wmsTables.batchInventorySessionBalances)
    .where(
      and(
        eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
        eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
        eq(wmsTables.batchInventorySessionBalances.sourceLocationId, sourceLocationId),
        ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
      ),
    );
  return Number(row?.qty ?? 0);
}

describeIfDb('위치 없는 스캔의 귀속 순서 (스펙 A1)', () => {
  const { sql: pg, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await pg.end({ timeout: 5 });
  });

  it('나뉜 줄은 배정이 코드 순(AAA 1 → SIMPLE 2)으로 잡힌다 — 전제 확인', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, frontId } = await splitLineBox(tx);
      const rows = await tx
        .select({
          sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
          qty: wmsTables.pickingSourceAllocations.qty,
        })
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId));
      expect(rows).toEqual(
        expect.arrayContaining([
          { sourceLocationId: frontId, qty: 1 },
          { sourceLocationId: box.locationId, qty: 2 },
        ]),
      );
    });
  });

  it('첫 스캔은 송장에 먼저 찍힌(코드 순 첫) 위치에 귀속한다 — UUID 순이 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, frontId, sessionId } = await splitLineBox(tx);
      const actor = { id: box.actorId, roles: ['logistics_worker'] };
      const state = await assembleSimpleOutbound(tx).scan(
        box.shipmentId,
        { barcode: box.barcode, quantity: 1, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );
      if (isPreparationBlocked(state)) throw new Error('Expected prepared outbound state');
      expect(await attributed(tx, sessionId, box.shipmentLineId, frontId)).toBe(1);
      expect(await attributed(tx, sessionId, box.shipmentLineId, box.locationId)).toBe(0);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='simple-outbound.attribution-order'`
Expected: 첫 테스트 PASS(전제), 둘째 FAIL — `frontId` 귀속 0, `box.locationId` 귀속 1. 첫 테스트가 실패하면 E8 배정이 예상과 다른 것이므로 멈추고 `allocateLines` 를 확인한다(스텝을 고치지 말 것).

- [ ] **Step 3: 구현 — 두 조회에 로케이션 조인과 코드 정렬**

`pickScanned` 와 `forcePickRemaining` 의 배정 조회 둘 다:

```ts
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
```

를 기존 `.innerJoin(wmsTables.shipmentLines, …)` 뒤에 더하고, `orderBy` 를:

```ts
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        // 송장 품목 줄과 같은 순서(로케이션 코드 순, #986 스펙 §10.1-3) — 작업자가 송장대로 집었다고 보고 그 순서로 귀속한다(스펙 U11)
        asc(wmsTables.locations.code),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );
```

로 바꾼다. `forcePickRemaining` 은 남은 몫을 전부 채우므로 결과는 순서와 무관하지만, 같은 규칙을 두 곳에 두어 어긋나지 않게 한다.

- [ ] **Step 4: 통과 확인 + 기존 단순출고 통합**

Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='simple-outbound|location-outbound'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/simple-outbound.service.ts apps/core/src/modules/fulfillment/services/simple-outbound.attribution-order.integration.spec.ts
git commit -m "fix(fulfillment): 위치 없는 출고 스캔을 송장에 찍힌 로케이션 순서로 귀속한다"
```

---

### Task 4: 재결품 때 그 줄의 위치 전부를 재배정 후보에서 뺀다 (A4)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts` — `report` 의 `planRefill` 호출부, 새 private 메서드 `lineSourcesOf`
- Create: `apps/core/src/modules/fulfillment/services/short-pick-line-sources.integration.spec.ts`

**Interfaces:**
- Consumes: 없음. 응답 DTO 변화 없음

- [ ] **Step 1: 실패하는 통합 테스트**

시나리오: 줄 3개 L1(SIMPLE-ZONE-…, 재고 3). L1 결품 1 → SPARE 로 채움(배정 L1 2 · SPARE 1). 첫 결품의 부족 승인이 원장을 줄이지 않아 L1 에 유령 가용 1 이 생긴다(#1005). 이제 SPARE 결품 1 → 지금 코드는 SPARE 만 빼서 L1(코드 순 SIMPLE < TAIL)로 다시 보낸다. 고친 뒤에는 TAIL 로 간다.

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedSpareStock, startedShortPickBox } from './__support__/short-pick-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Started = Awaited<ReturnType<typeof startedShortPickBox>>;

/** 임의 위치의 결품 보고 — 픽스처의 `report` 는 L1 만 보고하므로 같은 모양으로 위치만 바꾼다. 매번 최신 버전을 읽는다. */
async function reportAt(tx: DbTx, started: Started, sourceLocationId: string, shortQty: number) {
  const { box, wiring, sessionId } = started;
  const [session] = await tx
    .select()
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.id, sessionId));
  const [workItem] = await tx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
  const [line] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
  return wiring.shortPick.report(
    box.shipmentId,
    {
      workItemId: box.workItemId,
      expectedWorkItemLeaseVersion: workItem.leaseVersion,
      sessionId: session.id,
      expectedSessionVersion: session.version,
      expectedManifestVersion: shipment.manifestVersion,
      lines: [{ shipmentLineId: line.id, sourceLocationId, expectedLineVersion: line.lineVersion, shortQty }],
      reason: 'inventory_shortage',
    },
    `sp-${randomUUID()}`,
    { id: box.actorId, roles: ['master'] },
    tx,
  );
}

describeIfDb('재결품 후보 제외 (스펙 A4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('이미 채운 줄에서 또 결품이 나면 유령 가용이 있는 원래 위치로 보내지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 1, 'SPARE');
      const first = await started.report(1);
      expect(first.outcome).toBe('refilled');
      expect(first.refills).toEqual([expect.objectContaining({ sourceLocationId: spare.locationId, qty: 1 })]);

      const tail = await seedSpareStock(tx, started.box, 5, 'TAIL');
      const second = await reportAt(tx, started, spare.locationId, 1);
      expect(second.outcome).toBe('refilled');
      expect(second.refills).toEqual([expect.objectContaining({ sourceLocationId: tail.locationId, qty: 1 })]);
    });
  });

  it('한 위치뿐인 줄의 결품은 지금처럼 그 위치만 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 5, 'SPARE');
      const result = await started.report(1);
      expect(result.refills).toEqual([expect.objectContaining({ sourceLocationId: spare.locationId, qty: 1 })]);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='short-pick-line-sources'`
Expected: 첫 테스트 FAIL — 둘째 refills 의 `sourceLocationId` 가 `started.box.locationId`(L1). 둘째 테스트 PASS. 첫 테스트의 첫 `expect`(`first.outcome`)부터 실패하면 픽스처 전제가 다른 것이므로 멈추고 보고한다.

- [ ] **Step 3: 구현**

`report` 안 `planRefill` 호출의 `excludedSources` 를:

```ts
            excludedSources: [
              ...approved.map((row) => ({ skuId: row.skuId, sourceLocationId: row.sourceLocationId })),
              ...(await this.lineSourcesOf(
                workItem.id,
                lines,
                dto.lines.map((line) => line.shipmentLineId),
                trx,
              )),
            ],
```

로 바꾸고, 클래스에 메서드를 더한다(`requireScope` 위):

```ts
  /**
   * 보고된 줄 중 배정 위치가 둘 이상인 줄의 위치 전부(스펙 A4·U11). 이미 결품으로 채운 줄은 원래 위치에 유령 가용이 남아(#1005)
   * 그 위치가 다시 재배정 후보가 된다 — 보고는 송장 순서상 마지막 위치로 오므로 원래 위치는 보고된 쌍에 없다.
   * 한 위치뿐인 줄은 보고된 쌍과 같아 아무것도 더하지 않는다.
   */
  private async lineSourcesOf(
    workItemId: string,
    lines: ReadonlyArray<{ id: string; skuId: string }>,
    reportedLineIds: readonly string[],
    tx: DbTx,
  ): Promise<Array<{ skuId: string; sourceLocationId: string }>> {
    const rows = await tx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId));
    const skuByLine = new Map(lines.map((line) => [line.id, line.skuId]));
    const sourcesByLine = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!reportedLineIds.includes(row.shipmentLineId)) continue;
      const set = sourcesByLine.get(row.shipmentLineId) ?? new Set<string>();
      set.add(row.sourceLocationId);
      sourcesByLine.set(row.shipmentLineId, set);
    }
    const result: Array<{ skuId: string; sourceLocationId: string }> = [];
    for (const [lineId, sources] of sourcesByLine) {
      const skuId = skuByLine.get(lineId);
      if (!skuId || sources.size < 2) continue;
      for (const sourceLocationId of sources) result.push({ skuId, sourceLocationId });
    }
    return result;
  }
```

`pickingSourceAllocations` 컬럼명이 다르면(`shipmentLineId`·`sourceLocationId`·`workItemId`) `inventory.schema.ts` 의 `pickingSourceAllocations` 정의를 보고 맞춘다 — Task 3 의 조회가 같은 이름을 쓴다.

- [ ] **Step 4: 통과 확인 + 결품 통합 전체**

Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='short-pick'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts apps/core/src/modules/fulfillment/services/short-pick-line-sources.integration.spec.ts
git commit -m "fix(fulfillment): 재결품 때 그 줄의 배정 위치 전부를 재배정 후보에서 뺀다"
```

---

### Task 5: by-waybill 응답 확장 (A5)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts`
- Create: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.spec.ts` (순수 함수 `readDeliveryNote`)
- Create: `apps/core/src/modules/fulfillment/reader/by-waybill.station.integration.spec.ts`

**Interfaces:**
- Produces(응답 계약, PR C 의 앱이 쓴다):

```ts
export interface ShipmentByWaybillAllocation {
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
  lineVersion: number;
  /** 송장 순서(로케이션 코드 순). 시작 안 된 배치·작업 항목 없음이면 [] */
  allocations: ShipmentByWaybillAllocation[];
}

export interface ShortPickContext {
  workItemLeaseVersion: number;
  sessionId: string;
  sessionVersion: number;
  manifestVersion: number;
}

// ShipmentByWaybillResult 에 추가
  deliveryNote: string | null;
  /** 결품 보고(POST shipments/:id/short-picks)에 필요한 버전. 활성 작업 항목과 active 세션이 둘 다 있을 때만 */
  shortPickContext: ShortPickContext | null;
```

- `export function readDeliveryNote(snapshot: unknown): string | null`

- [ ] **Step 1: 순수 함수 테스트**

`shipment-waybill.reader.spec.ts`:

```ts
import { readDeliveryNote } from './shipment-waybill.reader';

describe('readDeliveryNote', () => {
  it.each([
    ['메모가 있으면 다듬어 돌려준다', { deliveryNote: '  문 앞 ' }, '문 앞'],
    ['빈 문자열은 없음', { deliveryNote: '   ' }, null],
    ['null 은 없음', { deliveryNote: null }, null],
    ['키가 없으면 없음', { recipientName: '홍길동' }, null],
    ['문자열이 아니면 없음', { deliveryNote: 3 }, null],
    ['스냅샷이 객체가 아니면 없음', null, null],
  ])('%s', (_name, snapshot, expected) => {
    expect(readDeliveryNote(snapshot)).toBe(expected);
  });
});
```

공동현관 비밀번호는 배송메모에 섞지 않는다(송장 템플릿은 `composeMessage(deliveryNote, entrancePassword)` 로 섞지만, 현장 화면에는 메모만 띄운다).

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.spec.ts`
Expected: FAIL — `readDeliveryNote` 없음

- [ ] **Step 3: 통합 테스트**

`by-waybill.station.integration.spec.ts`:

```ts
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb, seedPickableShipment } from '../services/__support__';
import { startedShortPickBox } from '../services/__support__/short-pick-fixtures';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { assembleLabels } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('송장 스캔 — 스테이션 필드 (스펙 A5)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  const readerFor = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    return new ShipmentWaybillReader(dbService, assembleLabels(dbService).states);
  };

  it('시작된 박스는 배송메모·줄별 배정·결품 버전을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, sessionId } = await startedShortPickBox(tx, 0);
      const [before] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      const snapshot = typeof before.recipientSnapshot === 'object' && before.recipientSnapshot !== null ? before.recipientSnapshot : {};
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: { ...snapshot, deliveryNote: '문 앞' } })
        .where(eq(wmsTables.shipments.id, box.shipmentId));
      const [location] = await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, box.locationId));
      const [line] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));

      const found = await readerFor(tx).byTrackingNo(box.trackingNo);

      expect(found.deliveryNote).toBe('문 앞');
      expect(found.lines).toEqual([
        expect.objectContaining({
          shipmentLineId: box.shipmentLineId,
          lineVersion: line.lineVersion,
          allocations: [{ sourceLocationId: box.locationId, locationCode: location.code, qty: 3 }],
        }),
      ]);
      expect(found.shortPickContext).toEqual({
        workItemLeaseVersion: workItem.leaseVersion,
        sessionId,
        sessionVersion: session.version,
        manifestVersion: shipment.manifestVersion,
      });
    });
  });

  it('시작 전 배치의 박스는 배정·결품 버전이 비어 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const found = await readerFor(tx).byTrackingNo(box.trackingNo);
      expect(found.lines.every((line) => line.allocations.length === 0)).toBe(true);
      expect(found.shortPickContext).toBeNull();
      expect(found.deliveryNote).toBeNull();
    });
  });
});
```

`recipientSnapshot` 의 타입이 `unknown` 이라 spread 가 타입 에러면, 위처럼 객체인지 좁힌 뒤 spread 한다(`as` 금지). 픽스처 스냅샷에 이미 `deliveryNote` 가 있으면 둘째 테스트의 `toBeNull` 기대를 그 값으로 바꾸지 말고, 둘째 테스트 시작에서 스냅샷의 `deliveryNote` 를 지운다.

- [ ] **Step 4: 실패 확인**

Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='by-waybill.station'`
Expected: FAIL — `deliveryNote`·`allocations`·`shortPickContext` 없음

- [ ] **Step 5: 구현**

`shipment-waybill.reader.ts`:

1. 위 «Interfaces» 의 타입을 파일 위쪽 인터페이스에 반영한다(`ShipmentByWaybillLine` 에 `lineVersion`·`allocations`, 새 `ShipmentByWaybillAllocation`·`ShortPickContext`, `ShipmentByWaybillResult` 에 `deliveryNote`·`shortPickContext`).
2. `readRecipientName` 아래에:

```ts
/** 배송메모만 — 공동현관 비밀번호는 현장 화면에 띄우지 않는다(송장 템플릿만 섞는다). */
export function readDeliveryNote(snapshot: unknown): string | null {
  if (!isRecipientRecord(snapshot)) return null;
  const { deliveryNote } = snapshot;
  if (typeof deliveryNote !== 'string') return null;
  const trimmed = deliveryNote.trim();
  return trimmed ? trimmed : null;
}
```

3. `byTrackingNo` 의 조회에 컬럼을 더한다: shipment 조회에 `manifestVersion: wmsTables.shipments.manifestVersion`, workItem 조회에 `leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion`, session 조회에 `version: wmsTables.batchInventorySessions.version`. session 은 지금 `if (workItem)` 블록 안 지역 변수이므로 블록 밖에 `let activeSession: { id: string; version: number } | undefined;` 를 두고 블록 안에서 채운다.
4. `loadLines` 의 select 에 `lineVersion: wmsTables.shipmentLines.lineVersion` 을 더한다.
5. 클래스에 배정 로더:

```ts
  /** 작업 항목의 배정 — 송장 품목 줄과 같은 순서(로케이션 코드 순). 수량 0 행은 송장에 없으므로 뺀다. */
  private async loadAllocations(trx: DbTx, workItemId: string): Promise<Map<string, ShipmentByWaybillAllocation[]>> {
    const rows = await trx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        locationCode: wmsTables.locations.code,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId))
      .orderBy(asc(wmsTables.locations.code), asc(wmsTables.pickingSourceAllocations.sourceLocationId));
    const byLine = new Map<string, ShipmentByWaybillAllocation[]>();
    for (const row of rows) {
      if (row.qty <= 0) continue;
      const list = byLine.get(row.shipmentLineId) ?? [];
      list.push({ sourceLocationId: row.sourceLocationId, locationCode: row.locationCode, qty: row.qty });
      byLine.set(row.shipmentLineId, list);
    }
    return byLine;
  }
```

6. 반환부:

```ts
      const allocations = workItem ? await this.loadAllocations(trx, workItem.id) : new Map<string, ShipmentByWaybillAllocation[]>();
      ...
        recipientMasked: maskName(readRecipientName(shipment.recipientSnapshot)),
        deliveryNote: readDeliveryNote(shipment.recipientSnapshot),
        lines: lines.map((line) => ({
          ...line,
          pickedQty: pickedByLine.get(line.shipmentLineId) ?? 0,
          allocations: allocations.get(line.shipmentLineId) ?? [],
        })),
        shortPickContext:
          workItem && activeSession
            ? {
                workItemLeaseVersion: workItem.leaseVersion,
                sessionId: activeSession.id,
                sessionVersion: activeSession.version,
                manifestVersion: shipment.manifestVersion,
              }
            : null,
```

7. `withdrawnByVoidedWaybill` 의 반환에도 같은 필드를 채운다: `deliveryNote: readDeliveryNote(shipment.recipientSnapshot)`, 줄마다 `allocations: []`, `shortPickContext: null`(빠진 박스는 결품 대상이 아니다).

- [ ] **Step 6: 통과 확인 + 기존 by-waybill 스펙**

Run: `npx jest apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.spec.ts && DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='by-waybill|shipment-waybill.reader'`
Expected: PASS. 기존 스펙이 응답을 `toEqual` 로 통째 비교해 새 필드 때문에 실패하면, 그 스펙의 기대에 새 필드의 실제 값을 더한다(`toMatchObject` 로 바꾸지 않는다 — 계약을 느슨하게 만들지 말 것).

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/reader
git commit -m "feat(fulfillment): 송장 스캔 응답에 배송메모·줄별 배정·결품 버전을 싣는다"
```

---

### Task 6: 보충 대기 조회 (A6)

**Files:**
- Create: `apps/core/src/modules/fulfillment/reader/refill-pending.reader.ts`
- Create: `apps/core/src/modules/fulfillment/reader/refill-pending.reader.spec.ts` (순수 파서)
- Create: `apps/core/src/modules/fulfillment/reader/refill-pending.reader.integration.spec.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/outbound-refill.controller.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/outbound-refill.controller.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` — `controllers` 와 `providers`

**Interfaces:**
- Consumes: `maskName`, `readRecipientName` (`reader/shipment-waybill.reader.ts`, 기존 export), `WAYBILL_TERMINAL_STATUSES` (`waybill/waybill.constants`)
- Produces(응답 계약, PR C 의 앱이 쓴다) — `GET /outbound-refills/pending?warehouseId=<uuid>` (scope `WAREHOUSE_OPERATE`):

```ts
export interface RefillPendingItem {
  shipmentLineId: string;
  skuId: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  /** 아직 안 집은 채운 몫 */
  qty: number;
}

export interface RefillPendingBox {
  shipmentId: string;
  trackingNo: string | null;
  recipientMasked: string;
  items: RefillPendingItem[];
}
```

- 순수 파서: `export function readRefills(after: unknown): RefillSnapshot[]`, `export function readIntentWorkItemId(before: unknown): string | null`

- [ ] **Step 1: 파서 테스트**

`refill-pending.reader.spec.ts`:

```ts
import { readIntentWorkItemId, readRefills } from './refill-pending.reader';

const refill = { shipmentLineId: 'l', skuId: 's', sourceLocationId: 'loc', locationCode: 'C-07-1', qty: 1 };

describe('readRefills', () => {
  it('채움 결과의 refills 를 돌려준다', () => {
    expect(readRefills({ outcome: 'refilled', refills: [refill] })).toEqual([refill]);
  });
  it.each([
    ['채움이 아니면 빈 목록', { outcome: 'withdrawing', refills: [refill] }],
    ['refills 가 배열이 아니면 빈 목록', { outcome: 'refilled', refills: 'x' }],
    ['스냅샷이 없으면 빈 목록', null],
  ])('%s', (_name, after) => {
    expect(readRefills(after)).toEqual([]);
  });
  it('모양이 틀린 행은 버리고 나머지는 남긴다', () => {
    expect(readRefills({ outcome: 'refilled', refills: [refill, { ...refill, qty: '1' }, 3] })).toEqual([refill]);
  });
});

describe('readIntentWorkItemId', () => {
  it('의도의 작업 항목 id', () => {
    expect(readIntentWorkItemId({ intent: { kind: 'short_pick', workItemId: 'w-1' } })).toBe('w-1');
  });
  it.each([[{ intent: {} }], [{ intent: 'x' }], [null], [{}]])('없으면 null (%j)', (before) => {
    expect(readIntentWorkItemId(before)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/reader/refill-pending.reader.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 통합 테스트**

`refill-pending.reader.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { RefillPendingReader } from './refill-pending.reader';
import { inRollbackTx, makeDb } from '../services/__support__';
import { seedSpareStock, startedShortPickBox } from '../services/__support__/short-pick-fixtures';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('보충 대기 조회 (스펙 A6)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  const readerFor = (tx: DbTx) => new RefillPendingReader(ambientDbService(tx));

  it('다른 위치에서 채운 박스는 가져올 위치·상품·수량과 함께 나온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 5);
      expect((await started.report(1)).outcome).toBe('refilled');

      const pending = await readerFor(tx).pending(started.box.warehouseId);

      expect(pending).toEqual([
        expect.objectContaining({
          shipmentId: started.box.shipmentId,
          items: [
            expect.objectContaining({
              shipmentLineId: started.box.shipmentLineId,
              sourceLocationId: spare.locationId,
              locationCode: spare.code,
              qty: 1,
            }),
          ],
        }),
      ]);
    });
  });

  it('채운 몫을 집으면 목록에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 5);
      await started.report(1);
      await started.wiring.sessions.moveCustody(
        {
          sessionId: started.sessionId,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId: started.box.actorId,
          quantity: 1,
          from: { skuId: started.box.skuId, sourceLocationId: spare.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: started.box.skuId,
            sourceLocationId: spare.locationId,
            custodyType: 'WORKER',
            custodyRef: started.box.actorId,
            shipmentLineId: started.box.shipmentLineId,
          },
        },
        tx,
      );
      expect(await readerFor(tx).pending(started.box.warehouseId)).toEqual([]);
    });
  });

  it('채우지 못한 결품(빼는 중)과 다른 창고는 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 1);
      expect((await started.report(1)).outcome).not.toBe('refilled');
      expect(await readerFor(tx).pending(started.box.warehouseId)).toEqual([]);
      expect(await readerFor(tx).pending(randomUUID())).toEqual([]);
    });
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='refill-pending'`
Expected: FAIL — 모듈 없음

- [ ] **Step 5: 리더 구현**

`refill-pending.reader.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { maskName, readRecipientName } from './shipment-waybill.reader';

export interface RefillSnapshot {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface RefillPendingItem {
  shipmentLineId: string;
  skuId: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface RefillPendingBox {
  shipmentId: string;
  trackingNo: string | null;
  recipientMasked: string;
  items: RefillPendingItem[];
}

/** 보충이 남아 있을 수 있는 작업 항목 — 출고·제외(종결)와 빼는 중은 보충 대상이 아니다. */
const NOT_REFILLABLE_WORK_ITEM_STATUSES = ['completed', 'excluded', 'withdrawing'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 결품 오퍼레이션 after 스냅샷(`completeRefilled` 가 쓴다)에서 채운 행만. 모양이 틀린 행은 버린다. */
export function readRefills(after: unknown): RefillSnapshot[] {
  if (!isRecord(after) || after.outcome !== 'refilled' || !Array.isArray(after.refills)) return [];
  const list: unknown[] = after.refills;
  return list.flatMap((row) =>
    isRecord(row) &&
    typeof row.shipmentLineId === 'string' &&
    typeof row.skuId === 'string' &&
    typeof row.sourceLocationId === 'string' &&
    typeof row.locationCode === 'string' &&
    typeof row.qty === 'number'
      ? [
          {
            shipmentLineId: row.shipmentLineId,
            skuId: row.skuId,
            sourceLocationId: row.sourceLocationId,
            locationCode: row.locationCode,
            qty: row.qty,
          },
        ]
      : [],
  );
}

/** 결품 오퍼레이션 before 스냅샷의 의도(`ShortPickOperationIntentProof`)가 가리키는 작업 항목. */
export function readIntentWorkItemId(before: unknown): string | null {
  if (!isRecord(before) || !isRecord(before.intent)) return null;
  return typeof before.intent.workItemId === 'string' ? before.intent.workItemId : null;
}

const key = (shipmentLineId: string, sourceLocationId: string) => `${shipmentLineId}:${sourceLocationId}`;

/**
 * 스테이션 «보충 대기»(스펙 §7.3·A6). 결품을 다른 위치에서 채운 박스 중, 채운 몫을 아직 집지 않은 것.
 * 남은 몫 = 그 (줄, 위치) 배정 − 줄에 귀속된 보관(SETTLED 제외, `SimpleOutboundService.attributedQty` 와 같은 집계).
 */
@Injectable()
export class RefillPendingReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  pending(warehouseId: string, tx?: DbTx): Promise<RefillPendingBox[]> {
    return this.dbService.run(async (trx) => {
      const operations = await trx
        .select({
          shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
          before: wmsTables.shipmentOperations.beforeManifestSnapshot,
          after: wmsTables.shipmentOperations.afterManifestSnapshot,
          recipientSnapshot: wmsTables.shipments.recipientSnapshot,
        })
        .from(wmsTables.shipmentOperations)
        .innerJoin(
          wmsTables.shipmentOperationMembers,
          and(
            eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
            eq(wmsTables.shipmentOperationMembers.role, 'source'),
          ),
        )
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentOperationMembers.shipmentId))
        .where(
          and(
            eq(wmsTables.shipmentOperations.type, 'short_pick'),
            eq(wmsTables.shipmentOperations.status, 'completed'),
            sql`${wmsTables.shipmentOperations.afterManifestSnapshot}->>'outcome' = 'refilled'`,
            eq(wmsTables.shipments.warehouseId, warehouseId),
            eq(wmsTables.shipments.status, 'planned'),
          ),
        )
        .orderBy(asc(wmsTables.shipmentOperations.completedAt));

      // 같은 박스의 여러 결품을 하나로 모은다 — (작업 항목, 줄, 위치)별 채운 수량 합.
      const boxes = new Map<
        string,
        { shipmentId: string; workItemId: string; recipientSnapshot: unknown; refilled: Map<string, RefillSnapshot> }
      >();
      for (const operation of operations) {
        const workItemId = readIntentWorkItemId(operation.before);
        if (!workItemId) continue;
        const box = boxes.get(workItemId) ?? {
          shipmentId: operation.shipmentId,
          workItemId,
          recipientSnapshot: operation.recipientSnapshot,
          refilled: new Map<string, RefillSnapshot>(),
        };
        for (const refill of readRefills(operation.after)) {
          const k = key(refill.shipmentLineId, refill.sourceLocationId);
          const prev = box.refilled.get(k);
          box.refilled.set(k, prev ? { ...prev, qty: prev.qty + refill.qty } : refill);
        }
        boxes.set(workItemId, box);
      }
      if (!boxes.size) return [];

      const workItems = await trx
        .select({ id: wmsTables.outboundBatchWorkItems.id, batchId: wmsTables.outboundBatchWorkItems.batchId })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            inArray(wmsTables.outboundBatchWorkItems.id, [...boxes.keys()]),
            notInArray(wmsTables.outboundBatchWorkItems.status, [...NOT_REFILLABLE_WORK_ITEM_STATUSES]),
          ),
        );

      const result: RefillPendingBox[] = [];
      for (const workItem of workItems) {
        const box = boxes.get(workItem.id);
        if (!box) continue;
        const [session] = await trx
          .select({ id: wmsTables.batchInventorySessions.id })
          .from(wmsTables.batchInventorySessions)
          .where(
            and(
              eq(wmsTables.batchInventorySessions.batchId, workItem.batchId),
              eq(wmsTables.batchInventorySessions.status, 'active'),
            ),
          )
          .limit(1);
        if (!session) continue;
        const remaining = await this.remainingByKey(trx, workItem.id, session.id);
        const items: RefillPendingItem[] = [];
        for (const [k, refill] of box.refilled) {
          const left = Math.min(refill.qty, remaining.get(k) ?? 0);
          if (left > 0) items.push({ ...refill, skuName: '', qty: left });
        }
        if (!items.length) continue;
        result.push({
          shipmentId: box.shipmentId,
          trackingNo: await this.activeTrackingNo(trx, box.shipmentId),
          recipientMasked: maskName(readRecipientName(box.recipientSnapshot)),
          items,
        });
      }

      const skuIds = [...new Set(result.flatMap((box) => box.items.map((item) => item.skuId)))];
      if (skuIds.length) {
        const skus = await trx
          .select({ id: wmsTables.skus.id, name: wmsTables.skus.name })
          .from(wmsTables.skus)
          .where(inArray(wmsTables.skus.id, skuIds));
        const nameById = new Map(skus.map((sku) => [sku.id, sku.name]));
        for (const box of result) for (const item of box.items) item.skuName = nameById.get(item.skuId) ?? '';
      }
      return result;
    }, tx);
  }

  /** (줄, 위치)별 «배정 − 줄 귀속 보관». */
  private async remainingByKey(trx: DbTx, workItemId: string, sessionId: string): Promise<Map<string, number>> {
    const allocations = await trx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId));
    const held = await trx
      .select({
        shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
        sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
        qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int`,
      })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      )
      .groupBy(
        wmsTables.batchInventorySessionBalances.shipmentLineId,
        wmsTables.batchInventorySessionBalances.sourceLocationId,
      );
    const heldByKey = new Map<string, number>();
    for (const row of held) {
      if (row.shipmentLineId) heldByKey.set(key(row.shipmentLineId, row.sourceLocationId), Number(row.qty));
    }
    const remaining = new Map<string, number>();
    for (const row of allocations) {
      const k = key(row.shipmentLineId, row.sourceLocationId);
      remaining.set(k, (remaining.get(k) ?? 0) + row.qty - (heldByKey.get(k) ?? 0));
    }
    return remaining;
  }

  private async activeTrackingNo(trx: DbTx, shipmentId: string): Promise<string | null> {
    const [waybill] = await trx
      .select({ trackingNo: wmsTables.waybills.trackingNo })
      .from(wmsTables.waybills)
      .where(
        and(
          eq(wmsTables.waybills.shipmentId, shipmentId),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      )
      .limit(1);
    return waybill?.trackingNo ?? null;
  }
}
```

`batchInventorySessionBalances.sourceLocationId` 가 nullable 이면 `heldByKey` 를 채우는 조건에 `row.sourceLocationId` 도 더한다(타입 에러가 알려준다).

- [ ] **Step 6: 리더 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/reader/refill-pending.reader.spec.ts && DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='refill-pending'`
Expected: PASS

- [ ] **Step 7: 컨트롤러 테스트**

`outbound-refill.controller.spec.ts`:

```ts
import { REQUIRED_SCOPES_KEY } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { OutboundRefillController } from './outbound-refill.controller';

describe('OutboundRefillController', () => {
  it('창고 작업 스코프로 보충 대기를 리더에 위임한다', async () => {
    const reader = { pending: jest.fn().mockResolvedValue([]) };
    const controller = new OutboundRefillController(reader as never);
    await expect(controller.pending('11111111-1111-4111-8111-111111111111')).resolves.toEqual([]);
    expect(reader.pending).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, OutboundRefillController.prototype.pending)).toEqual([
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
    ]);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/controllers/outbound-refill.controller.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 8: 컨트롤러 구현 + 모듈 등록**

`outbound-refill.controller.ts`:

```ts
import { Controller, Get, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { RefillPendingBox, RefillPendingReader } from '../reader/refill-pending.reader';

/**
 * 스테이션 «보충 대기»(스펙 §7.3). `shipments` 아래에 두지 않는다 — 그 프리픽스엔 `:id` 라우트가 있어
 * 등록 순서에 기대야 한다(`simple-outbound.route-order.spec.ts`).
 */
@ApiTags('Outbound refills')
@Controller('outbound-refills')
@UseGuards(ScopeGuard)
export class OutboundRefillController {
  constructor(private readonly refills: RefillPendingReader) {}

  @Get('pending')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: '결품을 다른 위치에서 채웠고 그 몫을 아직 안 집은 박스 (창고별)' })
  pending(@Query('warehouseId', new ParseUUIDPipe()) warehouseId: string): Promise<RefillPendingBox[]> {
    return this.refills.pending(warehouseId);
  }
}
```

`fulfillment.module.ts`: import 두 줄을 더하고, `controllers` 배열 끝(`ShipmentRecallOperationController` 뒤)에 `OutboundRefillController`, `providers` 의 `ShipmentWaybillReader,` 바로 뒤에 `RefillPendingReader,` 를 더한다.

- [ ] **Step 9: 통과 확인 + 라우트 감사**

Run: `npx jest apps/core/src/modules/fulfillment/controllers scripts/security`
Expected: PASS. `scripts/security` 의 IDOR 명단이 새 라우트를 검사 대상으로 잡아 실패하면, 그 파일 머리 주석의 절차대로 판정과 근거(`outbound-refill.controller.ts:<줄>` 과 `eq(wmsTables.shipments.warehouseId, warehouseId)` 술어)를 적어 추가한다 — 이 라우트는 사용자 소유 데이터가 아니라 창고 스코프 데이터다.

- [ ] **Step 10: Commit**

```bash
git add apps/core/src/modules/fulfillment/reader/refill-pending.reader.ts apps/core/src/modules/fulfillment/reader/refill-pending.reader.spec.ts apps/core/src/modules/fulfillment/reader/refill-pending.reader.integration.spec.ts apps/core/src/modules/fulfillment/controllers/outbound-refill.controller.ts apps/core/src/modules/fulfillment/controllers/outbound-refill.controller.spec.ts apps/core/src/modules/fulfillment/fulfillment.module.ts
git commit -m "feat(fulfillment): 스테이션 보충 대기 조회 — 결품을 채운 몫을 아직 안 집은 박스"
```

---

### Task 7: 게이트와 PR

**Files:** 없음(검증만)

- [ ] **Step 1: 타입 검사** — Run: `npm run type-check` · Expected: 에러 0. ⚠️ tsc 증분 캐시가 가짜 에러를 낼 수 있다 — 의심되면 `rm -f tsconfig.tsbuildinfo` 후 다시
- [ ] **Step 2: 유닛 전체** — Run: `npx jest --maxWorkers=2` · Expected: 실패 0(`--maxWorkers` 없이는 OOM 이 났던 적이 있다)
- [ ] **Step 3: 보안 스펙** — Run: `npx jest scripts/security` · Expected: PASS
- [ ] **Step 4: 이번 PR 의 통합 스펙 전부** — Run: `DATABASE_URL=…/core_station_a npx jest --runInBand --testPathPattern='(simple-outbound|location-outbound|short-pick|by-waybill|shipment-waybill.reader|refill-pending)'` · Expected: PASS. develop 에서부터 빨간 통합 스펙이 섞이면 develop 에서 같은 패턴을 돌려 비교하고 PR 본문에 적는다
- [ ] **Step 5: PR 본문에 배포 메모**
  - 마이그 없음. core 배포만으로 반영(스코프·역할 매핑은 부팅 시 동기화)
  - 배포 뒤 확인: `logistics_worker` 계정으로 `GET /outbound-refills/pending?warehouseId=…` 200, 스코프 없는 계정 403
  - 앱 변경 없음 — PR C(스테이션 출고 검수)가 이 응답 필드를 쓴다. 옛 앱은 새 필드를 무시한다
