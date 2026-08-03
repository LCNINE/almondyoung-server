# 창고 쓰기 엔드포인트 스코프 authorization (#546)

- 이슈: [#546](https://github.com/LCNINE/almondyoung-server/issues/546)
- 브랜치: `fix/inventory-warehouse-scope-authorization` (base `46bf66ebe`)
- 마이그레이션: **0건**

## 문제

`WarehouseController` 의 쓰기 엔드포인트에 스코프 authorization 이 없다. 전역
`JwtAuthGuard`(`app.module.ts:54`) 덕분에 인증은 걸려 있지만 `RequireScopes` /
`ScopeGuard` 가 없어 **인증된 아무 사용자나 창고를 만들고 고치고 지울 수 있다.**

| 위치 | 상태 |
|---|---|
| `warehouse.controller.ts:14` `@Post()` | 맨몸 |
| `warehouse.controller.ts:45` `@Patch(':id')` | 맨몸 |
| `warehouse.controller.ts:57` `@Delete(':id')` | 맨몸 |

#545(`46bf66ebe`)가 `PATCH` 로 `supportedPickingStrategies` 를 열면서 이 엔드포인트는
**피킹 방식 개통 스위치**가 됐다. 공백을 새로 만든 건 아니지만 공백의 대가가 올라갔다 —
전에는 창고 이름 변경이었고, 이제는 `supportedPickingStrategies: []` 로 특정 창고의
출고를 멈출 수 있다.

## 조사 결과

### inventory 모듈 전체가 스코프 0건이다

컨트롤러 21개를 전수 확인했고 `RequireScopes` 가 붙은 것은 하나도 없다 —
stocktaking(쓰기 8), purchase-order(쓰기 11), location(쓰기 7), sku-group(쓰기 6) 등.
대조적으로 fulfillment 쪽은 스코프 규율이 서 있다.

**이번 작업 범위는 warehouse 컨트롤러 하나로 한정한다.** 개통 선행조건이라는 목적에
정확히 맞고, `INVENTORY_SCOPE` 체계의 첫 판례를 작게 세울 수 있다. 나머지 20개는
전수조사 표와 함께 후속 이슈로 등록한다.

### 호출자는 셋뿐이고 읽기/쓰기가 깔끔하게 갈린다

| 호출자 | 사용 |
|---|---|
| admin-web (`warehouses.client.ts`) | GET / POST / PATCH / DELETE. 화면은 `RouteGuard requireRole={['admin','master']}` |
| warehouse-app (`useWarehouses.ts:11`) | **`GET /inventory/warehouses` 만** |
| 시드·스크립트 | `ensureDefaultsExist` 는 서버 내부 코드라 HTTP 를 타지 않음 |

**읽기를 열어두면 앱은 깨지지 않는다.** warehouse-app 은 코드 어디에서도 role 을
언급하지 않아 현장 토큰이 실제로 어떤 role 을 싣는지 코드로 확인할 수 없다 — 읽기를
닫았다가 틀리면 현장 PDA 가 창고 선택조차 못 하므로, 이번에는 쓰기만 닫는다.

### `admin` role 은 core 스코프를 하나도 갖고 있지 않다

- `FULFILLMENT_ROLE_MAPPINGS` 는 `logistics_worker` / `logistics_manager` 둘만 매핑한다
- `admin` role 이 받는 것은 user-service 쪽 `admin:*` 스코프뿐이다
  (`scripts/seeding/steps/user-service.seed-step.ts:67`)
- 시드된 admin **유저**가 지금 동작하는 것은 `master` role 을 같이 갖고 있어
  `ScopeGuard` 의 master 바이패스를 타기 때문이다 (`scope.guard.ts:75`)

따라서 새 스코프를 `logistics_manager` 에만 매핑하면 **master 없이 `admin` role 만
가진 사용자는 #545 창고 화면에서 403** 을 받는다. 화면은 들여보내 놓고 저장에서
튕기는 형태가 된다.

### `ensureRoleScopeMappings` 는 파괴적이고 중복 roleName 을 거부한다

`libs/authorization/src/services/authorization.service.ts:95` 의 두 가지 성질:

- **중복 roleName 이면 던진다** (:97) — `[...FULFILLMENT_ROLE_MAPPINGS,
  ...INVENTORY_ROLE_MAPPINGS]` 로 이어붙이면 `logistics_manager` 가 두 번 나와
  **부팅이 죽는다**
- **주어진 목록에 없는 매핑 행을 지운다** (:127 `notInArray`) — 이 함수에 넘기는
  배열은 "추가분"이 아니라 그 role 의 **전체 목록**이어야 한다

그래서 role 이름 기준으로 병합한 단일 목록이 필요하다. 같은 이유로
`scripts/local/seed-dev-core/scopes.ts:24` 도 고쳐야 한다 — 지금 `FULFILLMENT_ROLE_MAPPINGS`
만 넘기고 있어서 그대로 두면 **dev 시드를 돌릴 때마다 새 inventory 매핑이 지워진다.**

### 확인해서 배제한 위험: 서비스 간 매핑 오염 없음

`admin` role 에 core 스코프를 주는 것이 user-service 쪽 `admin:*` 매핑을 지우지
않는지 확인했다. **DB 가 분리돼 있다** — core 는 `core` DB, user-service 는
`user_service` DB (`scripts/seeding/lib/service-registry.ts:11-12`). 각자의
`auth.role_scope_mapping` 이므로 서로 건드리지 않는다.

## 결정

| 논점 | 결정 |
|---|---|
| 작업 범위 | warehouse 컨트롤러만. 나머지 20개는 후속 이슈 |
| 스코프 입도 | 단일 `inventory.warehouse.manage` |
| role 매핑 | `admin` + `logistics_manager` (`master` 는 가드가 바이패스) |
| 읽기 엔드포인트 | 손대지 않음 |
| admin-web | 변경 없음 |

**스코프를 쪼개지 않는 이유:** 같은 스코프로 `DELETE` 로 창고를 통째 지울 수 있는데
`[]` 로 출고를 멈추는 더 약한 행위에 더 강한 권한을 요구하는 것은 비대칭이다.
분리해도 권한의 하한이 내려가지 않아 실익이 없다.

**admin-web RouteGuard 를 손대지 않는 이유:** `logistics_manager` 는 백엔드 스코프를
받지만 `/inventory/warehouses` 화면(`requireRole={['admin','master']}`)에는 못
들어간다. inventory 페이지 14개가 전부 같은 패턴이라 하나만 바꾸면 오히려 불일치가
생긴다. `logistics_manager` 매핑은 스코프 체계상 의미가 맞아 두고, 화면 접근은 별도
판단으로 남긴다.

## 설계

### 1. 새 파일 `apps/core/src/platform/auth/inventory-scopes.ts`

```ts
export const INVENTORY_SCOPE = {
  WAREHOUSE_MANAGE: 'inventory.warehouse.manage',
} as const;

export const INVENTORY_SCOPES: ScopeDefinition[] = [{
  key: INVENTORY_SCOPE.WAREHOUSE_MANAGE,
  category: 'inventory',
  description: '창고 생성·수정·삭제 및 피킹 방식 설정',
}];

export const INVENTORY_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  { roleName: 'admin', scopeKeys: [INVENTORY_SCOPE.WAREHOUSE_MANAGE] },
  { roleName: 'logistics_manager', scopeKeys: [INVENTORY_SCOPE.WAREHOUSE_MANAGE] },
];
```

`FULFILLMENT_SCOPE` 에 얹지 않는다 — `merged-scopes.ts:10` 이 이미 BC별 분리를
전제로 `// Inventory scopes (향후 추가)` 자리를 비워뒀다. 기존
`FULFILLMENT_SCOPE.WAREHOUSE_OPERATE` 재사용도 불가 — `logistics_worker` 가 갖고
있어 워커가 창고를 지울 수 있게 되고, 그것이 이슈가 지적한 문제 자체다.

### 2. `apps/core/src/platform/auth/merged-scopes.ts`

- `ALL_SCOPES` 에 `INVENTORY_SCOPES` 추가
- **`ALL_ROLE_MAPPINGS` 신규 export** — roleName 으로 그룹핑해 `scopeKeys` 를 합치는
  순수 함수 하나. 소비처는 `app.module.ts:40` 과 `seed-dev-core/scopes.ts:20,24`

### 3. `warehouse.controller.ts`

`@Post`(:14) `@Patch`(:45) `@Delete`(:57) 각각에
`@UseGuards(ScopeGuard)` + `@RequireScopes(INVENTORY_SCOPE.WAREHOUSE_MANAGE)`.
`shipment-recall.controller.ts:29-30` 과 같은 형태. **`@Get` 3개는 손대지 않는다.**

### 4. `apps/core/src/app.module.ts`

`roleMappings: FULFILLMENT_ROLE_MAPPINGS` → `ALL_ROLE_MAPPINGS`

### 5. `scripts/local/seed-dev-core/scopes.ts`

`FULFILLMENT_ROLE_MAPPINGS` → `ALL_ROLE_MAPPINGS` (2군데: `:20`, `:24`)

## 테스트

| 파일 | 내용 |
|---|---|
| `warehouse.controller.spec.ts` (신규) | `Reflect.getMetadata(REQUIRED_SCOPES_KEY, …)` 로 쓰기 3개는 스코프 요구, **GET 3개는 `undefined`** 확인. `shipment-recall.controller.spec.ts` 패턴 |
| `inventory-scopes.spec.ts` (신규) | 스코프 키·role 매핑 상수 검증. `fulfillment-scopes.spec.ts` 패턴 |
| `merged-scopes.spec.ts` (신규) | **roleName 중복 0건** + `logistics_manager` 가 fulfillment·inventory 스코프를 모두 가짐. 위 "부팅 사망" 함정의 회귀 테스트 |
| `scripts/local/seed-dev-core/seed.integration.spec.ts` (갱신) | 스코프 개수 8 → 9, `admin` / `logistics_manager` 기대값. `:32` 주석("현재 ALL_SCOPES 는 FULFILLMENT_SCOPES 와 동일하다")도 더 이상 사실이 아니므로 함께 수정 |

기대값을 검증 대상 상수에서 import 하지 않고 직접 적는 기존 컨벤션
(`seed.integration.spec.ts:50-52` 주석)을 따른다.

## 배포

**마이그레이션 0건.** `ScopeBootstrapService.onModuleInit`
(`scope-bootstrap.service.ts:33`)이 부팅 시 스코프와 role 매핑을 upsert 하므로
core 배포만으로 적용된다.

- admin-web / warehouse-app 변경 없음 → 선후 배포 순서 제약 없음
- 롤백은 core 이전 버전 재배포로 충분하지만 행이 사문으로만 남는 것은 아니다 —
  옛 코드는 `FULFILLMENT_ROLE_MAPPINGS` 로 부팅하고 `ensureRoleScopeMappings` 가
  이 목록에 없는 스코프의 매핑 행을 실제로 지우므로, `logistics_manager` →
  `inventory.warehouse.manage` 행은 삭제된다. `admin` 행은 옛 목록에 `admin`
  자체가 없어 건드려지지 않고 남는다. 어느 쪽이든 안전하며 롤포워드하면 다시
  self-heal 된다

### 배포 후 검증 (코드로 확인 불가)

**master 없이 `admin` role 만 가진 사용자로 `/inventory/warehouses` 저장이 되는지.**
실제 토큰이 필요해 코드나 유닛 테스트로는 확인할 수 없다.

## 범위 밖

- inventory 나머지 컨트롤러 20개 (후속 이슈)
- 읽기 엔드포인트 authorization
- admin-web RouteGuard / UI 권한 게이팅
- `CreateWarehouseDto` 의 `supportedPickingStrategies` 개방 (#545 에서 의도적으로 보류)
