# 피킹 방식 개통 선행조건 설계 스펙

- 날짜: 2026-07-28
- 대상: `apps/core` (fulfillment, inventory warehouse) + `apps/admin-web` + `native/warehouse-app`
- 브랜치: `feat/picking-activation-prerequisites` (base `bd5e07bc3` = origin/develop)
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물
- 해결 이슈: #544 (단순출고가 배치 `pickingMethod` 를 검증하지 않는다), #545 (`supported_picking_strategies` 설정 수단 부재)
- 관련: #543 (정합성 작업, develop `bd5e07bc3`), #546 (창고 쓰기 엔드포인트 스코프 부재 — 이번 작업 중 발견, 분리), #542 (하드닝 현황판 W4), `docs/superpowers/specs/2026-07-27-picking-method-strategy-alignment-design.md`

## 1. 목표

토탈피킹·멀티오더 피킹을 **켜기 전에 닫아야 하는 두 구멍**을 막는다.

#543 이 배치의 `pickingMethod` 를 피킹 전략의 단일 출처로 만들면서, 개통 스위치가 창고의 `supported_picking_strategies` 한 곳으로 모였다. 그 결과 두 가지가 남았다:

1. 스위치를 켜면 단순출고(물류 앱 경로)가 감당 못 하는 배치를 조용히 받아들인다 (#544)
2. 스위치를 켤 방법이 프로덕션 DB 직접 UPDATE 뿐이다 (#545)

**이번 범위는 선행조건까지다.** 실제 개통(창고에 `pick_to_tote` / `aggregate_then_sort` 를 켜는 일)은 하지 않는다 (§7).

## 2. 현재 상태 실측

### 2.1 단순출고는 배치 방식을 보지 않는다

- `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts` 의 `pickingMethod` 참조 **0건** (`grep -c` 확인)
- `prepare()`(:69) → `loadWorkItem()` → `ensurePlan()`(:544) → `this.picking.plan({ batchId, shipmentIds, ... })`(:573)
- #543 이전에는 `this.picking.plan('discrete', {...})` 로 전략을 하드코딩했다. 하드코딩이 사라진 자리에 "이 배치가 정말 discrete 절차인가"를 확인하는 가드가 들어가지 않았다
- `simple-outbound.service.ts:46` 주석은 이미 이 서비스가 `DiscretePickingStrategy` 의 내부 규약(`ACTIVE_WORK_ITEM_STATUSES`)에 결합돼 있음을 적고 있다. 결합은 문서화됐지만 강제되지 않았다

### 2.2 배치 생성은 창고 능력에 전면 의존한다

`apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts:107` 이 요청한 방식에 대응하는 전략이 창고의 `supportedPickingStrategies` 에 없으면 409 `OUTBOUND_BATCH_METHOD_NOT_SUPPORTED` 를 던진다. #543 이전에는 plan 생성 시점에만 쓰이던 값이 이제 배치 생성 자체를 좌우한다.

### 2.3 그 값을 쓸 수단이 없다

| 위치 | 상태 |
|---|---|
| `create-warehouse.dto.ts` | `name` / `type` / `location` 만 |
| `update-warehouse.dto.ts` | `PartialType(CreateWarehouseDto)` — 마찬가지로 없음 |
| `warehouse.dto.ts:22` | 응답에는 내려준다 (읽기 전용) |
| `admin-web` | **창고 관리 화면이 존재하지 않는다** — `src/app/(admin)/inventory/` 14개 라우트 중 `warehouses` 없음. `warehousesClient.updateWarehouse` / `useUpdateWarehouse`(`mutations.ts:208`)는 정의만 되고 호출자가 없다 |

### 2.4 기본 창고도 비어 있는 채로 태어난다

`inventory.schema.ts:732` 의 `supportedPickingStrategies` 는 DB default 가 없어 `NULL` 이다. `WarehouseManager.ensureDefaultsExist()`(`warehouse.manager.ts:87`)가 부팅 시 만드는 기본 국내/해외 창고 2개도 이 값을 넣지 않는다. 즉 **새 환경에서는 기본 창고조차 출고 배치를 만들 수 없다.**

### 2.5 `pickingMethod` 는 생성 후 불변

`outboundBatches` 에 대한 프로덕션 쓰기는 `outbound-batch-orchestrator.service.ts:116` 의 INSERT 하나뿐이다. UPDATE 경로가 존재하지 않는다 — 가드의 락 전략(§3.2)의 근거다.

## 3. 설계 — #544 단순출고 방식 가드

### 3.1 판정은 순수 술어로 계약 파일에 둔다

`apps/core/src/modules/fulfillment/picking/picking-method.contract.ts` 에 추가한다:

```ts
/**
 * 단순출고가 재현하는 절차는 DiscretePickingStrategy 하나뿐이다 — 토트 등록(pick_to_tote)과
 * 벌크 후 분류(aggregate_then_sort)는 앱이 숨길 수 없는 단계를 요구한다.
 */
export function isSimpleOutboundSupportedMethod(method: PickingMethodEnum): boolean {
  return strategyForPickingMethod(method) === 'discrete';
}
```

`method === 'individual'` 로 직접 비교하지 않는다. 단순출고가 실제로 전제하는 것은 방식 이름이 아니라 **DiscretePickingStrategy 의 절차**이기 때문이다. #543 이 만든 방식↔전략 단일 출처 옆에 두면 "단순출고가 감당하는 범위 = discrete 전략 하나"라는 사실이 계약 파일에서 읽힌다. 나중에 discrete 로 매핑되는 방식이 추가되면 자동으로 통과한다.

### 3.2 가드는 `prepare()` 에 둔다

```
prepare()
  loadWorkItem()             ← 기존
  assertBatchMethodSupported ← 신규
  ensurePlan() / ensureSession() / ensurePickerClaim()
```

가드의 의미는 "단순출고가 이 배치를 다룰 수 있는가"이므로 plan 생성이 아니라 prepare 전체의 선행조건이다.

```ts
private async assertBatchMethodSupported(batchId: string, tx: DbTx): Promise<void> {
  const [batch] = await tx
    .select({ pickingMethod: wmsTables.outboundBatches.pickingMethod })
    .from(wmsTables.outboundBatches)
    .where(eq(wmsTables.outboundBatches.id, batchId))
    .limit(1);
  // 열린 work item 의 FK 가 배치 존재를 보장한다 — 여기가 비면 데이터 손상이므로 도메인 409 가 아니다.
  if (!batch) throw new Error(`Outbound batch ${batchId} referenced by an open work item is missing`);
  if (!isSimpleOutboundSupportedMethod(batch.pickingMethod)) {
    throw this.conflict(
      'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED',
      `Simple outbound handles discrete picking only — this batch uses ${batch.pickingMethod}`,
    );
  }
}
```

**락을 걸지 않는다.** `pickingMethod` 는 §2.5 대로 INSERT 이후 갱신 경로가 없다.

### 3.3 검토했으나 채택하지 않은 두 안

- **`ensurePlan()` 안에 둔다** — 동작은 같지만 함정이 있다. 이슈 본문의 "plan 을 만들기 전에 확인"을 문자 그대로 fast-path 조회(`existing` 조기 반환, :561) *뒤에* 넣으면, 이미 plan 이 있는 배치는 가드가 실행되지 않는다. 관리자가 admin-web 에서 계획을 만든 `multi_order` 배치가 정확히 그 경우이고, 이슈가 막으려던 시나리오가 그대로 통과한다
- **`loadWorkItem` 쿼리에 `outboundBatches` 조인** — 쿼리 1회로 끝나지만 그 쿼리는 `.for('update')` 다. 조인하면 배치 행까지 잠겨 같은 배치의 서로 다른 송장을 스캔하는 작업자들이 전부 직렬화된다

### 3.4 물류 앱 문구

`native/warehouse-app/src/core/data/errorMessage.ts` 의 `OUTBOUND_CONFLICT_MESSAGES` 에 추가한다:

```ts
SIMPLE_OUTBOUND_METHOD_UNSUPPORTED: '이 배치는 개별 피킹이 아니라 앱에서 처리할 수 없어요 — 관리자에게 문의해 주세요',
```

이 맵에 없으면 `errorMessage()` 가 모든 409 를 "다른 작업자가 먼저 변경했어요"로 뭉갠다.

## 4. 설계 — #545 core

### 4.1 `UpdateWarehouseDto` 에만 필드를 연다

`PartialType(CreateWarehouseDto)` 상속을 유지한 채 본문에 선언한다. 생성 시점에는 못 넣고 수정으로만 켠다는 결정(§7)을 타입이 그대로 표현한다.

```ts
export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {
  @ApiPropertyOptional({ enum: pickingStrategyEnum.enumValues, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(pickingStrategyEnum.enumValues, { each: true })
  supportedPickingStrategies?: PickingStrategyName[];
}
```

**빈 배열은 허용한다** — 출고 불가로 되돌리는 유일한 수단이다. 미등록 전략 이름은 쓰기 시점에 400 으로 막는다. 막지 않으면 plan 단계에서야 `BadRequestException` 이 난다.

`WarehouseManager.update`(`warehouse.manager.ts:40`)는 `.set({ ...dto, updatedAt })` 스프레드라 배선은 자동이다.

### 4.2 곁다리 결함 — 컨트롤러 `update` 가 매퍼를 안 탄다

`warehouse.controller.ts:49` 만 raw 엔티티를 반환하고 `WarehouseMapper.toDto` 를 쓰지 않는다. 매퍼는 `supportedPickingStrategies: warehouse.supportedPickingStrategies ?? []` 로 null 을 정규화한다(`warehouse.mapper.ts:11`). 새 화면이 PATCH 응답으로 목록을 갱신하는데 `null` 과 `[]` 가 섞이면 "설정 없음" 판정이 흔들린다. create/findAll 과 같이 매퍼를 태운다.

### 4.3 기본 창고 시드

`WAREHOUSE_CONSTANTS` 의 기본 창고 2개에 `supportedPickingStrategies: ['discrete']` 를 넣고 `ensureDefaultsExist` 가 그대로 insert 한다. 상수가 곧 시드 정의가 된다.

`discrete`(개별 피킹)만 넣는다 — 레거시 동등한 안전 기본값이고, 토탈·멀티오더는 여전히 명시적으로 켜야 한다. `ensureDefaultsExist` 는 창고가 없을 때만 insert 하므로 기존 프로덕션 값을 덮어쓰지 않는다.

### 4.4 마이그레이션

**0건.** 컬럼은 이미 존재하고(`20260714120854_certain_wendigo.sql:355`), 이번 변경은 DTO·상수·매퍼뿐이다.

## 5. 설계 — #545 admin-web 최소 화면

### 5.1 방식↔전략 매핑 공용화 (선행)

`src/features/order/outbound-batches/picking-method.ts` → `src/lib/utils/picking-method.ts` 로 옮기고 기존 임포트 3곳을 고친다:

- `features/order/outbound-batches/components/table/index.tsx:33`
- `features/order/outbound-batches/components/batch-detail-drawer/index.tsx:41`
- `features/order/outbound-batches/components/create-batch-dialog/index.tsx:35`

창고 화면(inventory)이 배치 화면(order) 밑의 모듈을 당겨 쓰면 feature 간 역방향 의존이 생긴다. `lib/utils/menu.ts` 가 이미 "데이터 + 순수 헬퍼" 모듈의 선례다. 파일 이동일 뿐 내용 변경은 없다.

### 5.2 화면

- **라우트** `src/app/(admin)/inventory/warehouses/page.tsx` — `<RouteGuard requireRole={['admin','master']}>`. 인벤토리 페이지 14개가 전부 이 패턴이고, `logistics_worker` 는 접근하지 못한다. #546 이 백엔드 스코프를 닫기 전까지의 실질적 차단선이다
- **기능** `src/features/inventory/warehouses/` — 목록 테이블(이름·타입·위치·피킹 방식) + 편집 다이얼로그(체크박스 3개)
- **메뉴** `src/lib/utils/menu.ts` 재고관리 children 에 `{ id: 'inventory-warehouses', title: '창고 관리', path: '/inventory/warehouses' }` 를 `inventory-locations` 다음에 추가
- **타입** `src/lib/types/dto/inventory.ts` 의 `UpdateWarehouseDto` 에 필드 추가

### 5.3 어휘와 변환

UI 는 **방식**(개별 피킹 / 토탈 피킹 / 멀티오더 피킹)으로 보여주고 저장 직전에 `STRATEGY_BY_PICKING_METHOD` 로 전략 배열로 바꾼다. 읽을 때는 `methodsForStrategies` 로 역파생한다. 배치 생성 다이얼로그와 같은 어휘를 쓴다.

### 5.4 빈 값 UX

방식이 0개인 창고는 목록에 `⚠ 설정 없음 — 출고 배치 생성 불가`, 편집 다이얼로그에도 같은 경고를 띄운다. 빈 값이 유효한 저장이면서 동시에 기능 정지를 뜻한다는 사실이 화면에서 보여야 한다.

## 6. 테스트

| 대상 | 위치 | 실행 |
|---|---|---|
| `isSimpleOutboundSupportedMethod` 3케이스 | `picking-method.contract.spec.ts` (기존 파일 확장) | 기본 `npm run test` 에 포함 |
| 409 `SIMPLE_OUTBOUND_METHOD_UNSUPPORTED` 배선 | `simple-outbound.service.integration.spec.ts` | 로컬 dev DB 필요 — 기본 실행에서 skip |
| `UpdateWarehouseDto` 검증 (유효값·미등록 전략명·빈 배열·중복) | `update-warehouse.dto.spec.ts` (신규) | 기본 실행에 포함 |
| 기본 창고 시드 | `warehouse.manager.spec.ts` (기존 파일 확장) | 기본 실행에 포함 |
| 앱 문구 매핑 | `native/warehouse-app/src/core/data/errorMessage.test.ts` (기존 파일 확장) | 앱 테스트 러너 |
| 메뉴/임포트 회귀 | `menu.spec.ts` 및 기존 3개 임포트 | 기본 실행에 포함 |

통합 테스트는 로컬 dev DB 마이그레이션이 적용된 상태를 전제한다. 이번 작업은 마이그레이션 0건이므로 추가 적용은 필요 없다.

## 7. 범위 밖 (명시)

- **#546 스코프 authorization** — 창고 쓰기 엔드포인트에 `RequireScopes`/`ScopeGuard` 부착. 이번 작업이 스코프 부재를 새로 만들지는 않는다(같은 PATCH 엔드포인트를 그대로 쓴다). admin-web 은 `RouteGuard requireRole={['admin','master']}` 로 UI 접근을 막는다
- **`CreateWarehouseDto` 필드** — 신규 창고는 여전히 `NULL` 로 태어나고 생성 직후 편집으로 켠다
- **단순출고의 토탈·멀티오더 지원 확대** — 토트 등록·분류 단계를 앱이 숨길 수 있는지부터 설계해야 하는 별개 작업
- **실제 개통** — 어떤 창고에도 `pick_to_tote` / `aggregate_then_sort` 를 켜지 않는다

## 8. 배포

마이그레이션 0건이라 `migrate`↔`deploy` 순서 제약이 없다.

1. `apps/core` 배포 — 가드와 DTO 가 함께 뜬다
2. `apps/admin-web` 배포 — 화면
3. `native/warehouse-app` — 문구 한 줄이라 시점 무관

기본 창고 시드는 `ensureDefaultsExist` 가 창고 부재 시에만 동작하므로, 기존 환경에서는 아무 일도 일어나지 않는다. **기존 창고 중 `supported_picking_strategies` 가 NULL/빈 배열인 곳은 이번 화면으로 사람이 켠다** — #543 배포 체크리스트의 수기 backfill 을 대체하는 수단이 생기는 것이 이번 작업의 실질적 성과다.

## 9. 리스크

- **가드가 기존 현장을 막을 가능성** — 현재 모든 배치는 `individual` 이므로 가드는 도달 불가 상태로 배포된다. 실측으로 확인할 것: 배포 전 `outbound_batches` 에 `picking_method <> 'individual'` 인 행이 없어야 한다
- **`picking-method.ts` 이동** — 순수 파일 이동이지만 #543 코드를 건드린다. 임포트 3곳이 전부이고 타입 체크로 누락이 드러난다
- **admin-web 화면이 스코프 없이 열린다** — `requireRole` 은 프론트 게이트일 뿐 API 는 인증된 아무나 부를 수 있다. #546 이 닫을 때까지 남는 위험이고, 이번 작업이 그 위험을 새로 만들지는 않는다
