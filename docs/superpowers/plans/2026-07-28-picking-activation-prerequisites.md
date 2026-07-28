# 피킹 방식 개통 선행조건 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 토탈피킹·멀티오더 피킹을 켜기 전에 닫아야 하는 두 구멍(단순출고 방식 가드 부재, 창고 전략 설정 수단 부재)을 막는다.

**Architecture:** #544 는 방식↔전략 계약 파일(`picking-method.contract.ts`)에 순수 술어를 올리고 `SimpleOutboundService.prepare()` 가 그것을 호출한다. #545 는 `UpdateWarehouseDto` 에 필드를 열고, 기본 창고를 `['discrete']` 로 시드하며, admin-web 에 창고 목록·피킹방식 편집 화면을 새로 만든다. 마이그레이션은 0건이다.

**Tech Stack:** NestJS + Drizzle ORM (apps/core), Next.js + TanStack Query + shadcn/ui (apps/admin-web), Vite + React (native/warehouse-app), Jest

**설계 스펙:** `docs/superpowers/specs/2026-07-28-picking-activation-prerequisites-design.md`

## Global Constraints

- **마이그레이션 0건.** `schema.ts` 를 수정하지 말 것. `supported_picking_strategies` 컬럼은 이미 존재한다 (`20260714120854_certain_wendigo.sql:355`)
- **도메인 예외는 `@app/shared`**, 컨트롤러 입력 검증만 Nest 예외. 단, `SimpleOutboundService` 는 앱이 코드를 구분해야 해서 `ConflictException({ code, error, message })` 를 쓰는 기존 `conflict()` 헬퍼를 유지한다 — `GlobalExceptionFilter` 는 `error` 필드만 코드로 통과시킨다
- **`any` / `as` 캐스팅 금지** (테스트에서 잘못된 런타임 타입을 일부러 넣는 경우는 주석과 함께 허용 — `add-barcode.dto.spec.ts` 선례)
- **트랜잭션 전파**: public 메서드는 `tx?: DbTx` 마지막 인자, private 헬퍼는 `tx: DbTx` 필수 (ADR-0025)
- **검증 스코프**: `npm run lint` 전역 `--fix` 와 admin-web `type-check` 는 저장소 상시 debt 다. 변경 파일에서 **새로 생긴** error 만 판정 기준으로 삼는다
- **커밋 메시지**는 한국어 본문, `Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD` 로 끝낸다

## File Structure

**apps/core (#544)**
- Modify: `src/modules/fulfillment/picking/picking-method.contract.ts` — 순수 술어 추가
- Modify: `src/modules/fulfillment/picking/picking-method.contract.spec.ts` — 술어 케이스
- Modify: `src/modules/fulfillment/services/simple-outbound.service.ts` — `prepare()` 가드 배선
- Modify: `src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts` — 409 배선 검증

**native/warehouse-app (#544)**
- Modify: `src/core/data/errorMessage.ts` — 현장 문구 1건
- Modify: `src/core/data/errorMessage.test.ts` — 문구 케이스

**apps/core (#545)**
- Modify: `src/modules/inventory/warehouse/dto/update-warehouse.dto.ts` — 필드 개방
- Create: `src/modules/inventory/warehouse/dto/update-warehouse.dto.spec.ts` — 검증 케이스
- Modify: `src/modules/inventory/warehouse/controllers/warehouse.controller.ts` — `update` 를 매퍼에 태움
- Modify: `src/modules/inventory/core/constants/warehouse.constants.ts` — 기본 창고 시드값
- Modify: `src/modules/inventory/warehouse/services/warehouse.manager.ts` — 시드값 insert
- Modify: `src/modules/inventory/warehouse/services/warehouse.manager.spec.ts` — 시드 케이스

**apps/admin-web (#545)**
- Move: `src/features/order/outbound-batches/picking-method.ts` → `src/lib/utils/picking-method.ts`
- Modify: 위 파일을 임포트하던 3개 컴포넌트
- Modify: `src/lib/types/dto/inventory.ts` — `UpdateWarehouseDto` 필드
- Modify: `src/lib/utils/menu.ts` — 창고 관리 메뉴 항목
- Create: `src/app/(admin)/inventory/warehouses/page.tsx` — 라우트 + RouteGuard
- Create: `src/features/inventory/warehouses/template/index.tsx` — 헤더 + 테이블
- Create: `src/features/inventory/warehouses/components/table/index.tsx` — 목록 + 편집 진입
- Create: `src/features/inventory/warehouses/components/picking-method-dialog/index.tsx` — 방식 편집

---

### Task 1: 단순출고 방식 가드 (#544)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/picking-method.contract.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/picking-method.contract.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts:69` (`prepare`), 새 private 메서드
- Test: `apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts`

**Interfaces:**
- Consumes: `strategyForPickingMethod(method: PickingMethodEnum): PickingStrategyName` (기존), `SimpleOutboundService.conflict(code: string, message: string): ConflictException` (기존 private, :653)
- Produces: `isSimpleOutboundSupportedMethod(method: PickingMethodEnum): boolean` — Task 2 는 이 술어가 던지는 409 코드 `SIMPLE_OUTBOUND_METHOD_UNSUPPORTED` 에 의존한다

- [ ] **Step 1: 실패하는 유닛 테스트를 쓴다**

`apps/core/src/modules/fulfillment/picking/picking-method.contract.spec.ts` 의 import 줄을 바꾸고 파일 끝 `});` 앞에 describe 블록을 더한다.

임포트 교체 (기존 2번째 줄):
```ts
import {
  isSimpleOutboundSupportedMethod,
  STRATEGY_BY_PICKING_METHOD,
  strategyForPickingMethod,
} from './picking-method.contract';
```

파일 맨 끝 `describe('picking method contract', ...)` 블록이 닫힌 **뒤**에 추가:
```ts
describe('simple outbound supported methods', () => {
  it('개별피킹만 단순출고가 감당한다', () => {
    expect(isSimpleOutboundSupportedMethod('individual')).toBe(true);
  });

  it('토탈피킹·멀티오더는 감당하지 못한다', () => {
    expect(isSimpleOutboundSupportedMethod('total_picking')).toBe(false);
    expect(isSimpleOutboundSupportedMethod('multi_order')).toBe(false);
  });

  // 방식 이름이 아니라 전략에 매달려 있어야 한다 — 나중에 discrete 로 매핑되는
  // 방식이 추가되면 단순출고가 자동으로 그것을 받아야 하기 때문이다.
  it('discrete 전략으로 매핑되는 방식만 통과시킨다', () => {
    for (const method of pickingMethodValues) {
      expect(isSimpleOutboundSupportedMethod(method)).toBe(
        strategyForPickingMethod(method) === 'discrete',
      );
    }
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npx jest --testPathPattern='picking-method.contract.spec' 2>&1 | tail -20
```
Expected: FAIL — `isSimpleOutboundSupportedMethod is not a function` 또는 TS 컴파일 에러 (`has no exported member`)

- [ ] **Step 3: 술어를 구현한다**

`apps/core/src/modules/fulfillment/picking/picking-method.contract.ts` 파일 끝에 추가:
```ts
/**
 * 단순출고(SimpleOutboundService)가 재현하는 절차는 DiscretePickingStrategy 하나뿐이다 —
 * 토트 등록(pick_to_tote)과 벌크 후 분류(aggregate_then_sort)는 앱이 스캔 1회 뒤로 숨길 수
 * 없는 단계를 요구한다. 방식 이름(`individual`)이 아니라 파생 전략을 보는 이유는, 단순출고가
 * 실제로 결합돼 있는 대상이 전략의 절차이기 때문이다 (simple-outbound.service.ts:46 주석).
 */
export function isSimpleOutboundSupportedMethod(method: PickingMethodEnum): boolean {
  return strategyForPickingMethod(method) === 'discrete';
}
```

- [ ] **Step 4: 유닛 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern='picking-method.contract.spec' 2>&1 | tail -20
```
Expected: PASS — `Tests: 6 passed`

- [ ] **Step 5: 가드를 서비스에 배선한다**

`apps/core/src/modules/fulfillment/services/simple-outbound.service.ts` 의 import 블록(12번째 줄 `resolveSkuIdByBarcode` 다음)에 추가:
```ts
import { isSimpleOutboundSupportedMethod } from '../picking/picking-method.contract';
```

`prepare()` 안에서 `loadWorkItem` 다음 줄에 호출을 끼운다:
```ts
    const workItem = await this.loadWorkItem(shipmentId, tx);
    await this.assertBatchMethodSupported(workItem.batchId, tx);
    const planId = await this.ensurePlan(workItem.batchId, actor, idempotencyKey, tx);
```

`private async ensurePlan(` 정의 **바로 앞**에 새 메서드를 넣는다:
```ts
  /**
   * 단순출고가 다룰 수 없는 방식의 배치를 plan 생성 전에 거른다. ensurePlan 안이 아니라
   * 여기인 이유: ensurePlan 은 이미 draft/active plan 이 있으면 조기 반환하므로(:561),
   * 관리자가 admin-web 에서 계획을 만들어 둔 배치는 그 안의 가드를 영원히 지나친다.
   *
   * 락을 걸지 않는다 — picking_method 는 outbound-batch-orchestrator.service.ts:116 의
   * INSERT 이후 갱신 경로가 없다(UPDATE 문 0건). 조인 대신 별도 쿼리인 이유는 loadWorkItem 이
   * `.for('update')` 라서, 조인하면 배치 행까지 잠겨 같은 배치의 작업자들이 직렬화되기 때문이다.
   */
  private async assertBatchMethodSupported(batchId: string, tx: DbTx): Promise<void> {
    const [batch] = await tx
      .select({ pickingMethod: wmsTables.outboundBatches.pickingMethod })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, batchId))
      .limit(1);
    // 열린 work item 의 FK 가 배치 존재를 보장한다 — 비어 있으면 데이터 손상이지 도메인 충돌이 아니다.
    if (!batch) {
      throw new Error(`Outbound batch ${batchId} referenced by an open work item is missing`);
    }
    if (!isSimpleOutboundSupportedMethod(batch.pickingMethod)) {
      throw this.conflict(
        'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED',
        `Simple outbound handles discrete picking only — this batch uses ${batch.pickingMethod}`,
      );
    }
  }

```

- [ ] **Step 6: 통합 테스트를 쓴다**

`apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts` 의 `describeIfDb('SimpleOutboundService.prepare', ...)` 블록 안, `it('배치에 없는 shipment 는 409 로 거부한다', ...)` 바로 뒤에 추가:

```ts
  // 창고에 aggregate_then_sort/pick_to_tote 가 켜지면 관리자가 그 방식의 배치를 만들 수 있다.
  // 단순출고는 DiscretePickingStrategy 절차만 재현하므로 plan 을 만들기 전에 거절해야 한다.
  it('개별피킹이 아닌 배치는 409 SIMPLE_OUTBOUND_METHOD_UNSUPPORTED 로 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);
      // total_picking 을 쓰는 이유: ck_outbound_batches_cart_capacity 가 multi_order 에만
      // cart_capacity NOT NULL 을 요구하므로 한 컬럼만 바꾸면 되는 쪽을 고른다.
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: 'total_picking' })
        .where(eq(wmsTables.outboundBatches.id, fixture.batchId));
      const service = assembleSimpleOutbound(tx);

      await expect(
        service.prepare(
          fixture.shipmentId,
          { id: fixture.actorId, roles: ['logistics_worker'] },
          `prep-${randomUUID()}`,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED' } });
    });
  });
```

`fixture.batchId` 는 `PickableShipmentFixture`(`__support__/logistics-fixtures.ts:258`)에 이미 있으므로 추가 조회가 필요 없다.

- [ ] **Step 7: 유닛 테스트 전체와 통합 테스트를 돌린다**

```bash
npx jest --testPathPattern='(picking-method.contract|fulfillment)' --silent 2>&1 | tail -12
```
Expected: 기존과 같은 suite 수 통과 + 실패 0. DATABASE_URL 이 없으면 통합 스펙은 skip 된다.

DATABASE_URL 이 설정된 dev DB 가 있으면 통합 테스트도 실증한다:
```bash
npx dotenv -e apps/core/.env -- npx jest --testPathPattern='simple-outbound.service.integration' 2>&1 | tail -20
```
Expected: PASS. **DB 가 없어 skip 되면 그 사실을 보고하고 넘어간다 — 통과했다고 말하지 않는다.**

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/fulfillment/picking/picking-method.contract.ts \
        apps/core/src/modules/fulfillment/picking/picking-method.contract.spec.ts \
        apps/core/src/modules/fulfillment/services/simple-outbound.service.ts \
        apps/core/src/modules/fulfillment/services/simple-outbound.service.integration.spec.ts
git commit -F - <<'EOF'
fix(core): 단순출고가 배치 피킹방식을 검증하도록 가드 추가 (#544)

#543 이 plan 의 전략 인자를 없애면서 단순출고의 하드코딩 'discrete' 가
사라졌는데, 그 자리에 배치 방식을 확인하는 가드가 들어가지 않았다.

- picking-method.contract.ts 에 isSimpleOutboundSupportedMethod 순수 술어 추가
- prepare() 가 loadWorkItem 직후 호출 — ensurePlan 안은 draft/active plan 조기
  반환(:561) 뒤에 놓이면 가드를 지나치므로 피한다
- picking_method 는 INSERT 이후 갱신 경로가 없어 락 없이 읽는다

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD
EOF
```

---

### Task 2: 물류 앱 현장 문구 (#544)

**Files:**
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts`
- Test: `native/warehouse-app/src/core/data/errorMessage.test.ts`

**Interfaces:**
- Consumes: Task 1 이 던지는 409 코드 `SIMPLE_OUTBOUND_METHOD_UNSUPPORTED`
- Produces: 없음 (말단)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`native/warehouse-app/src/core/data/errorMessage.test.ts` 의 `it('다른 작업자가 이미 잡은 박스는 전용 문구를 준다', ...)` 뒤에 추가:
```ts
  it('개별피킹이 아닌 배치는 전용 문구를 준다', () => {
    expect(
      errorMessage(new ConflictError('x', 'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED'), 'outbound')
    ).toBe('이 배치는 개별 피킹이 아니라 앱에서 처리할 수 없어요 — 관리자에게 문의해 주세요');
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
cd native/warehouse-app && npm test -- errorMessage 2>&1 | tail -20
```
Expected: FAIL — 받은 값이 공용 문구 `'다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.'`

- [ ] **Step 3: 문구를 추가한다**

`native/warehouse-app/src/core/data/errorMessage.ts` 의 `OUTBOUND_CONFLICT_MESSAGES` 마지막 항목 뒤에 추가:
```ts
  SIMPLE_OUTBOUND_METHOD_UNSUPPORTED:
    '이 배치는 개별 피킹이 아니라 앱에서 처리할 수 없어요 — 관리자에게 문의해 주세요',
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
cd native/warehouse-app && npm test -- errorMessage 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/core/data/errorMessage.ts \
        native/warehouse-app/src/core/data/errorMessage.test.ts
git commit -F - <<'EOF'
feat(warehouse-app): 개별피킹 아닌 배치의 409 에 현장 문구 추가 (#544)

이 맵에 없으면 errorMessage 가 모든 409 를 "다른 작업자가 먼저 변경했어요"
하나로 뭉개서, 작업자가 원인을 알 수 없다.

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD
EOF
```

---

### Task 3: 창고 전략 설정 API (#545)

**Files:**
- Modify: `apps/core/src/modules/inventory/warehouse/dto/update-warehouse.dto.ts`
- Create: `apps/core/src/modules/inventory/warehouse/dto/update-warehouse.dto.spec.ts`
- Modify: `apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.ts:49`

**Interfaces:**
- Consumes: `pickingStrategyEnum` (`apps/core/src/modules/inventory/schema/inventory.schema.ts:203`), `PickingStrategyName` (`apps/core/src/modules/fulfillment/picking/picking-strategy.interface.ts:3`), `WarehouseMapper.toDto` (기존)
- Produces: `PATCH /inventory/warehouses/:id` 가 `supportedPickingStrategies` 를 받고 `WarehouseDto` 를 반환한다 — Task 6·7 의 admin-web 화면이 이 계약에 의존한다

- [ ] **Step 1: 실패하는 DTO 검증 테스트를 쓴다**

Create `apps/core/src/modules/inventory/warehouse/dto/update-warehouse.dto.spec.ts`:
```ts
import { validate } from 'class-validator';
import { UpdateWarehouseDto } from './update-warehouse.dto';

describe('UpdateWarehouseDto', () => {
  function dtoWith(strategies: unknown): UpdateWarehouseDto {
    const dto = new UpdateWarehouseDto();
    // 잘못된 런타임 타입을 일부러 넣어 검증을 확인하는 테스트라 캐스팅이 필요하다
    dto.supportedPickingStrategies = strategies as UpdateWarehouseDto['supportedPickingStrategies'];
    return dto;
  }

  it('등록된 전략 이름들을 받는다', async () => {
    await expect(validate(dtoWith(['discrete', 'pick_to_tote']))).resolves.toHaveLength(0);
  });

  it('필드 생략을 받는다', async () => {
    await expect(validate(new UpdateWarehouseDto())).resolves.toHaveLength(0);
  });

  // 빈 배열은 "출고 불가로 되돌린다"는 유효한 의도다. 이걸 막으면 켠 것을 끌 수단이 없다.
  it('빈 배열을 받는다', async () => {
    await expect(validate(dtoWith([]))).resolves.toHaveLength(0);
  });

  // 막지 않으면 plan 단계에서야 BadRequestException 이 난다 — 쓰기 시점에 400 으로 끊는다.
  it('등록되지 않은 전략 이름을 거부한다', async () => {
    const errors = await validate(dtoWith(['discrete', 'zone_picking']));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('supportedPickingStrategies');
  });

  it('배열이 아닌 값을 거부한다', async () => {
    const errors = await validate(dtoWith('discrete'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('supportedPickingStrategies');
  });

  it('중복된 전략 이름을 거부한다', async () => {
    const errors = await validate(dtoWith(['discrete', 'discrete']));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('supportedPickingStrategies');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npx jest --testPathPattern='update-warehouse.dto.spec' 2>&1 | tail -20
```
Expected: FAIL — TS 컴파일 에러 (`Property 'supportedPickingStrategies' does not exist`)

- [ ] **Step 3: DTO 에 필드를 연다**

`apps/core/src/modules/inventory/warehouse/dto/update-warehouse.dto.ts` 전체를 교체:
```ts
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { pickingStrategyEnum } from '../../schema/inventory.schema';
import type { PickingStrategyName } from '../../../fulfillment/picking/picking-strategy.interface';
import { CreateWarehouseDto } from './create-warehouse.dto';

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {
  /**
   * 이 창고가 지원하는 V2 피킹 전략. 배치 생성이 이 값을 게이트로 쓰므로
   * (outbound-batch-orchestrator.service.ts:107) 사실상 피킹 방식 개통 스위치다.
   * 빈 배열은 "이 창고로는 출고 배치를 만들 수 없다"는 유효한 상태다.
   *
   * CreateWarehouseDto 에는 일부러 넣지 않았다 — 신규 창고는 생성 후 수정으로 켠다.
   */
  @ApiPropertyOptional({
    description: '창고가 지원하는 V2 피킹 전략. 빈 배열이면 출고 배치를 만들 수 없다.',
    enum: pickingStrategyEnum.enumValues,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(pickingStrategyEnum.enumValues, { each: true })
  supportedPickingStrategies?: PickingStrategyName[];
}
```

`WarehouseManager.update`(`warehouse.manager.ts:40`)는 `.set({ ...dto, updatedAt })` 스프레드라 별도 배선이 필요 없다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern='update-warehouse.dto.spec' 2>&1 | tail -20
```
Expected: PASS — `Tests: 6 passed`

- [ ] **Step 5: 컨트롤러 update 를 매퍼에 태운다**

`apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.ts:49` 의 `update` 를 교체:
```ts
  @Patch(':id')
  @ApiOperation({ summary: '창고 정보 수정' })
  @ApiResponse({ status: 200, description: '창고 정보가 수정되었습니다.', type: WarehouseDto })
  @ApiResponse({ status: 404, description: '창고를 찾을 수 없습니다.' })
  async update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto): Promise<WarehouseDto> {
    // 매퍼를 태우는 이유: 이 메서드만 raw 엔티티를 반환하고 있었다. 매퍼가
    // supportedPickingStrategies 의 null 을 [] 로 정규화하므로(warehouse.mapper.ts:11),
    // 화면이 PATCH 응답으로 목록을 갱신할 때 null 과 [] 가 섞이지 않는다.
    const warehouse = await this.warehouseService.update(id, dto);
    return WarehouseMapper.toDto(warehouse);
  }
```

- [ ] **Step 6: 창고 스펙 전체를 돌린다**

```bash
npx jest --testPathPattern='inventory/warehouse' --silent 2>&1 | tail -12
```
Expected: 실패 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/warehouse/dto/update-warehouse.dto.ts \
        apps/core/src/modules/inventory/warehouse/dto/update-warehouse.dto.spec.ts \
        apps/core/src/modules/inventory/warehouse/controllers/warehouse.controller.ts
git commit -F - <<'EOF'
feat(core): 창고 supported_picking_strategies 를 API 로 설정 가능하게 (#545)

#543 이 이 컬럼을 배치 생성 게이트로 만들면서, 값이 빈 창고는 출고에 쓸 수
없는데 고칠 수단이 프로덕션 DB 직접 UPDATE 뿐이었다.

- UpdateWarehouseDto 에만 필드 개방 (생성은 그대로 — 만든 뒤 수정으로 켠다)
- 등록되지 않은 전략 이름은 쓰기 시점에 400 (plan 단계까지 미루지 않는다)
- 빈 배열 허용 — 켠 것을 끄는 유일한 수단
- 컨트롤러 update 만 raw 엔티티를 반환하던 것을 WarehouseMapper 로 통일
- 마이그레이션 0건 (컬럼은 이미 존재)

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD
EOF
```

---

### Task 4: 기본 창고 시드 (#545)

**Files:**
- Modify: `apps/core/src/modules/inventory/core/constants/warehouse.constants.ts`
- Modify: `apps/core/src/modules/inventory/warehouse/services/warehouse.manager.ts:87` (`ensureDefaultsExist`)
- Test: `apps/core/src/modules/inventory/warehouse/services/warehouse.manager.spec.ts`

**Interfaces:**
- Consumes: `WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE` / `DEFAULT_OVERSEAS_WAREHOUSE` (기존)
- Produces: 두 상수가 `supportedPickingStrategies: ['discrete']` 를 갖는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/inventory/warehouse/services/warehouse.manager.spec.ts` 파일 끝의 `});` 뒤에 새 describe 를 추가하고, 상단 import 에 상수를 더한다.

import 추가:
```ts
import { WAREHOUSE_CONSTANTS } from '../../core/constants/warehouse.constants';
```

파일 끝에 추가:
```ts
describe('WarehouseManager default warehouse seeding', () => {
  // 이 값이 비면 새 환경의 기본 창고는 출고 배치를 만들 수 없는 상태로 태어난다
  // (outbound-batch-orchestrator.service.ts:107 게이트). discrete 는 레거시 동등한
  // 안전 기본값이고, 토탈·멀티오더는 여전히 창고 설정 화면에서 명시적으로 켠다.
  it('기본 창고 상수가 discrete 를 지원 전략으로 갖는다', () => {
    expect(WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.supportedPickingStrategies).toEqual([
      'discrete',
    ]);
    expect(WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.supportedPickingStrategies).toEqual([
      'discrete',
    ]);
  });

  it('기본 창고가 없으면 지원 전략까지 함께 insert 한다', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const trx = { insert: jest.fn().mockReturnValue({ values }) };
    const dbService = { run: jest.fn(async (fn) => fn(trx)) };
    const reader = {
      findOneOrNull: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
    };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const manager = new WarehouseManager(
      dbService as never,
      reader as never,
      locationService as never,
    );

    await manager.ensureDefaultsExist();

    expect(values).toHaveBeenCalledTimes(2);
    for (const call of values.mock.calls) {
      expect(call[0]).toMatchObject({ supportedPickingStrategies: ['discrete'] });
    }
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npx jest --testPathPattern='warehouse.manager.spec' 2>&1 | tail -25
```
Expected: FAIL — 상수에 프로퍼티가 없어 TS 컴파일 에러, 또는 `supportedPickingStrategies: undefined`

- [ ] **Step 3: 상수와 insert 를 고친다**

`apps/core/src/modules/inventory/core/constants/warehouse.constants.ts` 의 `WAREHOUSE_CONSTANTS` 를 교체:
```ts
export const WAREHOUSE_CONSTANTS = {
  // 기본 창고들
  DEFAULT_DOMESTIC_WAREHOUSE: {
    id: '00000000-0000-0000-0000-000000000001',
    name: '국내 메인 창고',
    location: '부천시',
    type: 'domestic' as const,
    // 이 값이 비면 배치 생성 게이트가 막아 출고에 쓸 수 없는 창고가 된다.
    // discrete(개별 피킹)만 켠다 — 토탈·멀티오더는 창고 설정 화면에서 명시적으로.
    supportedPickingStrategies: ['discrete'] as const,
  },
  DEFAULT_OVERSEAS_WAREHOUSE: {
    id: '00000000-0000-0000-0000-000000000002',
    name: '해외 메인 창고',
    location: '중국',
    type: 'overseas' as const,
    supportedPickingStrategies: ['discrete'] as const,
  },
} as const;
```

`apps/core/src/modules/inventory/warehouse/services/warehouse.manager.ts` 의 `ensureDefaultsExist` 안 insert 를 교체:
```ts
            await trx.insert(wmsTables.warehouses).values({
              id: data.id,
              name: data.name,
              type: data.type,
              location: data.location,
              supportedPickingStrategies: [...data.supportedPickingStrategies],
            });
```

`[...]` 로 펼치는 이유는 상수가 `readonly` 튜플이라 drizzle 의 가변 배열 타입과 맞지 않기 때문이다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern='warehouse.manager.spec' 2>&1 | tail -20
```
Expected: PASS — `Tests: 3 passed`

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/core/constants/warehouse.constants.ts \
        apps/core/src/modules/inventory/warehouse/services/warehouse.manager.ts \
        apps/core/src/modules/inventory/warehouse/services/warehouse.manager.spec.ts
git commit -F - <<'EOF'
fix(core): 기본 창고 부트스트랩이 discrete 지원 전략을 함께 시드 (#545)

supported_picking_strategies 에 DB default 가 없어, ensureDefaultsExist 가
만드는 기본 국내/해외 창고가 NULL 로 태어났다. 새 환경에서는 기본 창고조차
출고 배치를 만들 수 없는 상태였다.

ensureDefaultsExist 는 창고 부재 시에만 insert 하므로 기존 값은 덮어쓰지 않는다.

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD
EOF
```

---

### Task 5: admin-web 방식↔전략 매핑 공용화 (#545)

**Files:**
- Move: `apps/admin-web/src/features/order/outbound-batches/picking-method.ts` → `apps/admin-web/src/lib/utils/picking-method.ts`
- Modify: `apps/admin-web/src/features/order/outbound-batches/components/table/index.tsx:33`
- Modify: `apps/admin-web/src/features/order/outbound-batches/components/batch-detail-drawer/index.tsx:41`
- Modify: `apps/admin-web/src/features/order/outbound-batches/components/create-batch-dialog/index.tsx:35`

**Interfaces:**
- Produces: `@/lib/utils/picking-method` 가 `PickingMethod`, `STRATEGY_BY_PICKING_METHOD`, `PICKING_METHOD_LABELS`, `methodsForStrategies(supported: PickingStrategyName[]): PickingMethod[]` 를 내보낸다 — Task 6·7 이 이 경로에서 임포트한다

- [ ] **Step 1: 파일을 옮긴다**

```bash
git mv apps/admin-web/src/features/order/outbound-batches/picking-method.ts \
       apps/admin-web/src/lib/utils/picking-method.ts
```

내용은 바꾸지 않는다. `@/lib/types/dto/fulfillment` 임포트는 절대 경로라 그대로 동작한다.

- [ ] **Step 2: 임포트 3곳을 고친다**

`apps/admin-web/src/features/order/outbound-batches/components/table/index.tsx:33`:
```ts
import { PICKING_METHOD_LABELS } from '@/lib/utils/picking-method';
```

`apps/admin-web/src/features/order/outbound-batches/components/batch-detail-drawer/index.tsx:41`:
```ts
import { PICKING_METHOD_LABELS } from '@/lib/utils/picking-method';
```

`apps/admin-web/src/features/order/outbound-batches/components/create-batch-dialog/index.tsx:35` — 기존은 여러 심볼을 가져오는 멀티라인 임포트다. 그 블록 전체를 교체:
```ts
import {
  methodsForStrategies,
  PICKING_METHOD_LABELS,
  type PickingMethod,
} from '@/lib/utils/picking-method';
```

- [ ] **Step 3: 남은 참조가 없는지 확인한다**

```bash
grep -rn "outbound-batches/picking-method\|from '../../picking-method'\|from '../picking-method'" apps/admin-web/src
```
Expected: 출력 없음

- [ ] **Step 4: 타입 체크로 누락을 잡는다**

```bash
cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -i "picking-method" | head -20
```
Expected: 출력 없음. (저장소 상시 debt 로 다른 파일 error 는 나올 수 있다 — `picking-method` 관련만 본다)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/utils/picking-method.ts \
        apps/admin-web/src/features/order/outbound-batches/components/table/index.tsx \
        apps/admin-web/src/features/order/outbound-batches/components/batch-detail-drawer/index.tsx \
        apps/admin-web/src/features/order/outbound-batches/components/create-batch-dialog/index.tsx
git commit -F - <<'EOF'
refactor(admin-web): 피킹 방식↔전략 매핑을 lib/utils 로 이동 (#545)

창고 설정 화면(inventory)이 곧 같은 매핑을 쓴다. order feature 밑에 두면
feature 간 역방향 의존이 생기므로 공용 위치로 옮긴다. 내용 변경 없음.

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD
EOF
```

---

### Task 6: admin-web 창고 관리 화면 (#545)

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:835-839` (`UpdateWarehouseDto`)
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (재고관리 children, `inventory-locations` 다음)
- Create: `apps/admin-web/src/app/(admin)/inventory/warehouses/page.tsx`
- Create: `apps/admin-web/src/features/inventory/warehouses/template/index.tsx`
- Create: `apps/admin-web/src/features/inventory/warehouses/components/table/index.tsx`
- Create: `apps/admin-web/src/features/inventory/warehouses/components/picking-method-dialog/index.tsx`

**Interfaces:**
- Consumes: `useWarehouses()` / `useUpdateWarehouse()` (둘 다 `@/lib/services/inventory` 에서 `export *` 로 나온다 — `queries.ts:153`, `mutations.ts:204`), `methodsForStrategies` / `PICKING_METHOD_LABELS` / `STRATEGY_BY_PICKING_METHOD` / `PickingMethod` (Task 5 가 옮긴 `@/lib/utils/picking-method`), `WarehouseDto` (`@/lib/types/dto/inventory:212`), Task 3 의 `PATCH /inventory/warehouses/:id` 계약
- Produces: 없음 (말단)

- [ ] **Step 1: DTO 타입에 필드를 더한다**

`apps/admin-web/src/lib/types/dto/inventory.ts:835` 의 `UpdateWarehouseDto` 를 교체:
```ts
export interface UpdateWarehouseDto {
  name?: string;
  type?: 'domestic' | 'overseas' | 'bonded' | 'return';
  location?: string;
  supportedPickingStrategies?: Array<
    'discrete' | 'aggregate_then_sort' | 'pick_to_tote'
  >;
}
```

`WarehouseDto`(:212)에는 이미 있으므로 건드리지 않는다.

- [ ] **Step 2: 메뉴 항목을 더한다**

`apps/admin-web/src/lib/utils/menu.ts` 에서 `id: 'inventory-locations'` 항목 객체 **바로 뒤**에 추가:
```ts
      {
        id: 'inventory-warehouses',
        title: '창고 관리',
        path: '/inventory/warehouses',
      },
```

- [ ] **Step 3: 라우트를 만든다**

Create `apps/admin-web/src/app/(admin)/inventory/warehouses/page.tsx`:
```tsx
import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import WarehousesTemplate from '@/features/inventory/warehouses/template';

export default function Page() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <WarehousesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 4: 템플릿을 만든다**

Create `apps/admin-web/src/features/inventory/warehouses/template/index.tsx`:
```tsx
'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { WarehousesTable } from '../components/table';

export default function WarehousesTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="창고 관리"
        subtitle="창고가 지원하는 피킹 방식을 설정합니다. 방식이 없으면 출고 배치를 만들 수 없습니다."
      />
      <WarehousesTable />
    </Container>
  );
}
```

- [ ] **Step 5: 편집 다이얼로그를 만든다**

Create `apps/admin-web/src/features/inventory/warehouses/components/picking-method-dialog/index.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useUpdateWarehouse } from '@/lib/services/inventory';
import type { WarehouseDto } from '@/lib/types/dto/inventory';
import {
  methodsForStrategies,
  PICKING_METHOD_LABELS,
  STRATEGY_BY_PICKING_METHOD,
  type PickingMethod,
} from '@/lib/utils/picking-method';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: WarehouseDto | null;
};

const ALL_METHODS = Object.keys(STRATEGY_BY_PICKING_METHOD) as PickingMethod[];

export function PickingMethodDialog({ open, onOpenChange, warehouse }: Props) {
  const [selected, setSelected] = useState<PickingMethod[]>([]);
  const mutation = useUpdateWarehouse();

  useEffect(() => {
    setSelected(methodsForStrategies(warehouse?.supportedPickingStrategies ?? []));
  }, [warehouse, open]);

  const toggle = (method: PickingMethod, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, method] : prev.filter((item) => item !== method)
    );
  };

  const handleSubmit = async () => {
    if (!warehouse) return;
    // 화면은 방식으로 다루고 API 는 전략을 받는다. ALL_METHODS 순서로 매핑해
    // 체크 순서가 저장 값의 순서를 흔들지 않게 한다.
    const strategies = ALL_METHODS.filter((method) => selected.includes(method)).map(
      (method) => STRATEGY_BY_PICKING_METHOD[method]
    );
    try {
      await mutation.mutateAsync({
        id: warehouse.id,
        data: { supportedPickingStrategies: strategies },
      });
      toast.success('피킹 방식이 저장되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('저장에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{warehouse?.name} — 지원하는 피킹 방식</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {ALL_METHODS.map((method) => (
            <div key={method} className="flex items-center gap-3">
              <Checkbox
                id={`method-${method}`}
                checked={selected.includes(method)}
                onCheckedChange={(checked) => toggle(method, checked === true)}
              />
              <Label htmlFor={`method-${method}`}>{PICKING_METHOD_LABELS[method]}</Label>
            </div>
          ))}

          {selected.length === 0 && (
            // 빈 배열은 유효한 저장이다. 그 결과가 무엇인지 저장 전에 알려준다.
            <p className="text-destructive text-sm">
              ⚠ 하나도 고르지 않으면 이 창고로 출고 배치를 만들 수 없습니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: 목록 테이블을 만들고 다이얼로그를 연결한다**

Create `apps/admin-web/src/features/inventory/warehouses/components/table/index.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWarehouses } from '@/lib/services/inventory';
import type { WarehouseDto } from '@/lib/types/dto/inventory';
import { methodsForStrategies, PICKING_METHOD_LABELS } from '@/lib/utils/picking-method';
import { PickingMethodDialog } from '../picking-method-dialog';

const WAREHOUSE_TYPE_LABELS: Record<WarehouseDto['type'], string> = {
  domestic: '국내',
  overseas: '해외',
  bonded: '보세',
  return: '반품',
};

export function WarehousesTable() {
  const { data: warehouses = [], isLoading } = useWarehouses();
  const [editRow, setEditRow] = useState<WarehouseDto | null>(null);

  return (
    <div className="px-4 py-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>타입</TableHead>
            <TableHead>위치</TableHead>
            <TableHead>피킹 방식</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5}>불러오는 중...</TableCell>
            </TableRow>
          )}
          {!isLoading && warehouses.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>등록된 창고가 없습니다.</TableCell>
            </TableRow>
          )}
          {warehouses.map((warehouse) => {
            const methods = methodsForStrategies(warehouse.supportedPickingStrategies ?? []);
            return (
              <TableRow key={warehouse.id}>
                <TableCell className="font-medium">{warehouse.name}</TableCell>
                <TableCell>{WAREHOUSE_TYPE_LABELS[warehouse.type] ?? warehouse.type}</TableCell>
                <TableCell>{warehouse.location || '-'}</TableCell>
                <TableCell>
                  {methods.length === 0 ? (
                    // 빈 값은 유효한 저장이면서 동시에 출고 정지를 뜻한다 — 화면에서 보여야 한다.
                    <span className="text-destructive">⚠ 설정 없음 — 출고 배치 생성 불가</span>
                  ) : (
                    methods.map((method) => PICKING_METHOD_LABELS[method]).join(', ')
                  )}
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setEditRow(warehouse)}>
                    편집
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <PickingMethodDialog
        open={!!editRow}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
        warehouse={editRow}
      />
    </div>
  );
}
```

- [ ] **Step 7: 메뉴 스펙과 타입 체크를 돌린다**

```bash
npx jest --testPathPattern='menu.spec' 2>&1 | tail -10
```
Expected: PASS (기존 케이스 전부)

```bash
cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -E "features/inventory/warehouses|app/\(admin\)/inventory/warehouses|lib/utils/picking-method|lib/types/dto/inventory" | head -20
```
Expected: 출력 없음

- [ ] **Step 8: 개발 서버로 화면을 확인한다**

```bash
npm run start:admin-web:dev
```
`/inventory/warehouses` 에서 확인할 것:
1. 목록에 창고가 뜨고, 방식이 없는 창고는 `⚠ 설정 없음 — 출고 배치 생성 불가` 로 보인다
2. 편집 → 체크박스 선택 → 저장 → 목록이 갱신된다
3. 전부 해제하면 경고가 뜨고, 저장하면 목록이 `⚠ 설정 없음` 으로 바뀐다

core 가 로컬에서 떠 있지 않으면 저장이 실패한다. **확인하지 못했으면 그 사실을 보고한다 — 확인했다고 말하지 않는다.**

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/inventory.ts \
        apps/admin-web/src/lib/utils/menu.ts \
        "apps/admin-web/src/app/(admin)/inventory/warehouses/page.tsx" \
        apps/admin-web/src/features/inventory/warehouses/
git commit -F - <<'EOF'
feat(admin-web): 창고 관리 화면 — 피킹 방식 조회와 편집 (#545)

admin-web 에 창고 화면이 아예 없어서, 배치 생성 게이트를 좌우하는
supported_picking_strategies 를 운영자가 보거나 고칠 방법이 없었다.
토탈피킹·멀티오더 개통이 프로덕션 DB 직접 UPDATE 가 아니라 화면 조작이 된다.

- /inventory/warehouses 라우트 + RouteGuard(admin/master) — 다른 인벤토리
  페이지와 같은 패턴이라 logistics_worker 는 접근하지 못한다
- 화면은 방식(개별/토탈/멀티오더) 어휘로 다루고 저장 직전에 전략으로 변환
- 0개 선택은 유효한 저장이지만 출고 정지를 뜻하므로 목록과 다이얼로그 양쪽에 경고

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD
EOF
```

---

### Task 7: 전체 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 변경 범위의 유닛 테스트를 돌린다**

```bash
npx jest --testPathPattern='(fulfillment|inventory/warehouse|admin-web)' --silent 2>&1 | tail -12
```
Expected: 실패 0. 기준선은 작업 시작 시점의 `58 passed / 431 tests` 이며, 이번 작업이 더한 케이스만큼 늘어야 한다.

- [ ] **Step 2: 물류 앱 테스트를 돌린다**

```bash
cd native/warehouse-app && npm test 2>&1 | tail -12
```
Expected: 실패 0

- [ ] **Step 3: 변경 파일에 새 lint error 가 없는지 확인한다**

```bash
npx eslint $(git diff --name-only origin/develop...HEAD -- '*.ts' '*.tsx' | tr '\n' ' ') 2>&1 | tail -30
```
저장소 상시 debt 로 warning 은 나올 수 있다. **error 가 이번 변경 파일에서 새로 생겼는지**만 본다.

- [ ] **Step 4: 통합 테스트를 실증한다 (DB 있을 때)**

```bash
npx dotenv -e apps/core/.env -- npx jest --testPathPattern='simple-outbound.service.integration' 2>&1 | tail -20
```
Expected: PASS. DB 가 없어 skip 되면 **그 사실을 보고한다.**

- [ ] **Step 5: 배포 전 실측 항목을 확인한다**

```bash
npx dotenv -e apps/core/.env -- sh -c 'psql "$DATABASE_URL" -c "
  select picking_method, count(*) from outbound_batches group by picking_method;
" -c "
  select id, name, supported_picking_strategies from warehouses
  where supported_picking_strategies is null or cardinality(supported_picking_strategies) = 0;
"'
```

DB 가 원격이라 연결이 막히면 `./scripts/with-ipv4.sh` 를 앞에 붙인다 (일부 서비스가 쓰는 env 로딩 래퍼).
첫 쿼리에서 `individual` 외의 방식이 나오면 Task 1 의 가드가 기존 현장을 막는다 — 배포 전에 보고한다. 두 번째 쿼리 결과는 배포 후 새 화면에서 켜야 할 창고 목록이다.

DB 접근이 안 되면 이 실측은 사용자가 직접 해야 한다고 보고한다.

- [ ] **Step 6: 결과를 보고한다**

각 스텝의 실제 출력을 근거로 보고한다. 돌리지 못한 검증은 "돌리지 못했다"고 적는다.

---

## 배포 순서

마이그레이션 0건이라 `migrate`↔`deploy` 순서 제약이 없다.

1. `apps/core` — 가드(Task 1)와 DTO/시드(Task 3·4)가 함께 뜬다
2. `apps/admin-web` — 창고 화면(Task 5·6·7)
3. `native/warehouse-app` — 문구 한 줄(Task 2), 시점 무관

배포 후 새 화면에서 Task 7 Step 5 가 뽑은 "전략 없는 창고" 목록을 사람이 켠다.
