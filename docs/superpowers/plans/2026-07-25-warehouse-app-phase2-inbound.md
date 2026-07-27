# warehouse-app Phase 2 — 입고/검수 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 핸드헬드 앱에 입고예정 기반 입고와 무계획 간편입고를 붙이고, 입고 직후 적치까지 한 흐름으로 잇는다.

**Architecture:** 예정·간편 두 경로 모두 재고를 입고기본존으로 넣은 뒤(`/inbound/plans/receive`·`/inbound/simple`) 별도 적치 호출(`/inbound/putaway`)로 목적지에 꽂는다. 수량은 NumberPad 기본에 바코드 스캔 누적을 얹고, 적치 대상지 선택은 기존 재고 이동 화면의 로케이션 스캔 패턴을 그대로 재사용한다. 백엔드는 세 군데만 손댄다 — 적치 연결에 필요한 `lineId` 반환, 취소 시 예정 누계 복원, packingUnit 계약 정상화.

**Tech Stack:** Tauri 2 · React 19 · TanStack Router/Query · vitest + Testing Library (앱) / NestJS · Drizzle · Jest (백엔드)

**설계 문서:** `docs/superpowers/specs/2026-07-25-warehouse-app-phase2-inbound-design.md`

## Global Constraints

- **작업 위치**: 워크트리 `.claude/worktrees/feat+warehouse-app-phase2-inbound`, 브랜치 `feat/warehouse-app-phase2-inbound`. 원본 체크아웃으로 `cd` 하지 않는다.
- **앱 테스트**: `cd native/warehouse-app && npx vitest run <path>`. 전체는 `npx vitest run`.
- **백엔드 테스트**: 저장소 루트에서 `npx jest --testPathPattern=<pattern>`.
- **통합 테스트는 `DATABASE_URL` 이 있어야 돈다.** 없으면 `describeIfDb` 가 `describe.skip` 으로 떨어져 조용히 통과한다 — 통합 스펙을 작성한 뒤에는 반드시 `DATABASE_URL` 을 주고 실제로 돌려서 초록을 확인한다.
- **타입 안전**: `any` 금지, 정당화 주석 없는 `as` 금지 (CLAUDE.md). 테스트의 `as unknown as ApiClient['request']` 는 기존 스펙들이 쓰는 확립된 예외다.
- **DB 마이그레이션 없음**: 이 계획은 스키마를 바꾸지 않는다. `packing_unit` 은 `varchar(64)` 그대로 둔다.
- **커밋**: 태스크마다 최소 1회. 메시지는 한국어 본문 + `feat(warehouse-app):` / `fix(core):` 등 기존 관례.

## File Structure

**백엔드 (`apps/core/src/modules/inventory/`)**

| 파일 | 책임 |
|---|---|
| `sku-catalog/packing-unit.ts` (신규) | `parsePackingUnit` / `serializePackingUnit` — varchar 컬럼과 number 계약 사이의 유일한 경계 |
| `sku-catalog/dto/add-barcode.dto.ts` | `packingUnit` 을 number 로 받도록 검증 교체 |
| `sku-catalog/dto/sku-response.dto.ts` | `BarcodeDto.packingUnit` 응답 타입 number |
| `sku-catalog/services/sku-catalog.manager.ts` | 저장 시 직렬화 |
| `sku-catalog/services/sku-catalog.reader.ts` | 읽기 3곳 파싱 |
| `sku-catalog/mappers/sku.mapper.ts` | 읽기 파싱 |
| `inbound/dto/create-stock-entry-by-skuid.dto.ts` | `packingUnit` number |
| `core/services/stock-event.service.ts` | 저장 시 직렬화 |
| `inbound/services/inbound.service.ts` | `receiveFromPlan` lineId 반환 · `cancelInbound` 예정 복원 |
| `inbound/services/__fixtures__/inbound-harness.ts` (신규) | 통합 스펙용 `InboundService` 조립 + 롤백 트랜잭션 러너 |

**테스트 하네스에 관한 결정** — 저장소의 통합 스펙 48개는 각자 서비스를 손으로 배선한다(core 전체에서 `Test.createTestingModule` 을 쓰는 건 4개뿐). 이 계획은 그 관례를 갈아엎지 않되, **DI 배선만** 두 스펙이 공유하는 파일로 뽑는다. 배선은 분기 없는 조립 5줄이고 실제로 드리프트한 이력이 있다 — `StockEventStore`·`InventoryCommandService` 에 `batchControlledStock` 이 기본값과 함께 추가되면서 어떤 스펙은 넘기고 어떤 스펙은 안 넘기게 갈렸다(`stock-event.store.ts:74`, `inventory-command.service.ts:22`). 반면 **시드 픽스처는 각 스펙에 인라인으로 둔다** — 시나리오마다 필요한 행이 달라(창고 1개 vs 2개, 원장 유무) 공유하면 과매개변수 함수가 되고 인라인보다 읽기 어려워진다. `__fixtures__/` 에 확장자 `.ts` 로 두면 jest 의 `testRegex: .*\.spec\.ts$` 에 걸리지 않는다.

**앱 (`native/warehouse-app/src/`)**

| 파일 | 책임 |
|---|---|
| `domains/inbound/types.ts` (신규) | 입고 도메인 타입 — 백엔드 응답 중 현장에서 쓰는 필드만 |
| `domains/inbound/packingUnit.ts` (신규) | 스캔 1회가 더할 수량 결정 |
| `domains/inbound/queries.ts` (신규) | `usePendingPlans` |
| `domains/inbound/mutations.ts` (신규) | 입고·적치·취소 뮤테이션 4종 |
| `domains/inbound/PutawaySheet.tsx` (신규) | 적치 대상지 스캔 시트 — 두 화면 공용 |
| `domains/inbound/PendingPlanListScreen.tsx` (신규) | 예정 목록 |
| `domains/inbound/ReceiveSheet.tsx` (신규) | 수량 확정 시트 — 예정 기반 전용 |
| `domains/inbound/PlanReceiveScreen.tsx` (신규) | 예정 상세 + 항목 스캔 |
| `domains/inbound/QuickInboundScreen.tsx` (신규) | 간편입고 카트 |
| `domains/inventory/types.ts` | `SkuSearchItem` 에 `barcodes[]` 추가 |
| `core/data/errorMessage.ts` | `'inbound'` 컨텍스트 |
| `app/routes/` | `InboundRoute` · `PlanReceiveRoute` · `QuickInboundRoute` (신규) |
| `app/routeTree.tsx` | `/inbound` 플레이스홀더 교체, 라우트 3개 + `/putaway` 추가 |
| `profiles/handheld/HandheldHome.tsx` | "적치" 타일 추가 |

**설계 문서와의 차이 한 가지** — 스펙 §4 는 `useScanCount.ts` 를 적었지만, 실제로 필요한 건 상태를 갖는 훅이 아니라 "이 바코드는 몇 개짜리인가"를 답하는 순수 함수다. 파일명을 `packingUnit.ts` 로 바꾸고 훅 접두사를 쓰지 않는다 (rules-of-hooks 오탐 방지).

---

## Task 1: packingUnit 계약 정상화

`sku_barcodes.packing_unit` 은 의미상 숫자인데(admin-web 이 `{n}개입` 으로 렌더) 컬럼은 `varchar(64)`, DTO 는 `@IsString()`, admin-web 은 `Number(...)` 를 보낸다. 전역 ValidationPipe 에 `enableImplicitConversion` 이 없어 **지금 포장단위를 채우면 400 이 난다.** 컬럼은 그대로 두고 계약만 number 로 통일한다.

**Files:**
- Create: `apps/core/src/modules/inventory/sku-catalog/packing-unit.ts`
- Create: `apps/core/src/modules/inventory/sku-catalog/packing-unit.spec.ts`
- Create: `apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts`
- Modify: `apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.ts`
- Modify: `apps/core/src/modules/inventory/sku-catalog/dto/sku-response.dto.ts:23-24`
- Modify: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.ts:229`
- Modify: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader.ts:113,252,428`
- Modify: `apps/core/src/modules/inventory/sku-catalog/mappers/sku.mapper.ts:10`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts:1114`
- Modify: `apps/core/src/modules/inventory/inbound/dto/create-stock-entry-by-skuid.dto.ts:52`
- Modify: `apps/core/src/modules/inventory/core/services/stock-event.service.ts:68`
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:69`
- Modify: `apps/admin-web/src/features/inventory/skus/components/barcode-list-section/index.tsx:32`

**Interfaces:**
- Produces: `parsePackingUnit(raw: string | null | undefined): number | null` — DB varchar → 계약 number. `serializePackingUnit(value: number | null | undefined): string | null` — 반대 방향. `BarcodeDto.packingUnit?: number | null` (응답 계약, Task 4 의 앱 타입이 이걸 그대로 받는다).

- [ ] **Step 1: 변환 헬퍼의 실패 테스트를 쓴다**

Create `apps/core/src/modules/inventory/sku-catalog/packing-unit.spec.ts`:

```typescript
import { parsePackingUnit, serializePackingUnit } from './packing-unit';

describe('parsePackingUnit', () => {
  it('숫자 문자열을 number 로 준다', () => {
    expect(parsePackingUnit('20')).toBe(20);
    expect(parsePackingUnit(' 6 ')).toBe(6);
  });

  it('값이 없으면 null', () => {
    expect(parsePackingUnit(null)).toBeNull();
    expect(parsePackingUnit(undefined)).toBeNull();
    expect(parsePackingUnit('')).toBeNull();
    expect(parsePackingUnit('   ')).toBeNull();
  });

  // 컬럼이 varchar(64) 라 손으로 아무 문자열이나 들어갈 수 있다. 소비자가
  // NaN 을 만나지 않도록 경계에서 null 로 떨군다.
  it('숫자가 아니거나 1 미만이면 null', () => {
    expect(parsePackingUnit('BOX')).toBeNull();
    expect(parsePackingUnit('20개입')).toBeNull();
    expect(parsePackingUnit('1.5')).toBeNull();
    expect(parsePackingUnit('-3')).toBeNull();
    expect(parsePackingUnit('0')).toBeNull();
  });
});

describe('serializePackingUnit', () => {
  it('number 를 문자열로 준다', () => {
    expect(serializePackingUnit(20)).toBe('20');
  });

  it('값이 없으면 null', () => {
    expect(serializePackingUnit(null)).toBeNull();
    expect(serializePackingUnit(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --testPathPattern=packing-unit.spec`
Expected: FAIL — `Cannot find module './packing-unit'`

- [ ] **Step 3: 헬퍼를 구현한다**

Create `apps/core/src/modules/inventory/sku-catalog/packing-unit.ts`:

```typescript
/**
 * sku_barcodes.packing_unit 은 "몇 개입"이라는 숫자인데 컬럼은 varchar(64) 다.
 * 컬럼 타입을 좁히는 건 ADR-0005 상 3-PR expand-contract 라 별도 작업으로 미뤘고,
 * 대신 이 두 함수를 varchar 와 number 계약 사이의 유일한 경계로 둔다.
 * 파싱은 방어적이다 — 컬럼이 varchar 인 한 손으로 'BOX' 같은 값이 들어갈 수 있고,
 * 소비자(현장 앱의 스캔 누적)가 NaN 을 만나면 수량이 조용히 망가진다.
 */
export function parsePackingUnit(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function serializePackingUnit(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --testPathPattern=packing-unit.spec`
Expected: PASS — 5 tests

- [ ] **Step 5: DTO 검증의 실패 테스트를 쓴다**

Create `apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { AddBarcodeDto } from './add-barcode.dto';

describe('AddBarcodeDto', () => {
  function dtoWith(packingUnit: unknown): AddBarcodeDto {
    const dto = new AddBarcodeDto();
    dto.barcode = '8801234567890';
    // 잘못된 런타임 타입을 일부러 넣어 검증을 확인하는 테스트라 캐스팅이 필요하다
    dto.packingUnit = packingUnit as number;
    return dto;
  }

  it('양의 정수 packingUnit 을 받는다', async () => {
    await expect(validate(dtoWith(20))).resolves.toHaveLength(0);
  });

  it('packingUnit 생략을 받는다', async () => {
    const dto = new AddBarcodeDto();
    dto.barcode = '8801234567890';
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  // 전역 ValidationPipe 에 enableImplicitConversion 이 없어서 문자열은 number 로
  // 바뀌지 않는다. 계약을 number 로 고정한 이상 문자열은 거부되어야 한다.
  it('문자열 packingUnit 을 거부한다', async () => {
    const errors = await validate(dtoWith('20'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('packingUnit');
  });

  it('0 과 음수를 거부한다', async () => {
    await expect(validate(dtoWith(0))).resolves.toHaveLength(1);
    await expect(validate(dtoWith(-1))).resolves.toHaveLength(1);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx jest --testPathPattern=add-barcode.dto.spec`
Expected: FAIL — "양의 정수 packingUnit 을 받는다" 가 `@IsString()` 때문에 에러 1개를 낸다

- [ ] **Step 7: DTO 두 곳을 number 계약으로 바꾼다**

Replace `apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.ts` entirely:

```typescript
import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddBarcodeDto {
  @ApiProperty({ description: '바코드 값' })
  @IsString()
  @IsNotEmpty()
  barcode: string;

  @ApiProperty({ description: '포장 단위 — 이 바코드 1회 스캔이 뜻하는 낱개 수량', required: false, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  packingUnit?: number;
}
```

In `apps/core/src/modules/inventory/inbound/dto/create-stock-entry-by-skuid.dto.ts`, replace the `packingUnit` field (line 52 area) — 기존 `@IsOptional() packingUnit?: string;` 을 아래로 교체하고, 파일 상단 `class-validator` import 에 `IsInt` 와 `Min` 이 없으면 추가한다:

```typescript
  @ApiProperty({ description: '포장 단위 — 이 바코드 1회 스캔이 뜻하는 낱개 수량', required: false, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  packingUnit?: number;
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx jest --testPathPattern=add-barcode.dto.spec`
Expected: PASS — 4 tests

- [ ] **Step 9: 저장 경로 두 곳을 직렬화한다**

In `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.ts`, add the import at the top:

```typescript
import { serializePackingUnit } from '../packing-unit';
```

and change the insert value (line 229 area):

```typescript
          packingUnit: serializePackingUnit(dto.packingUnit),
```

In `apps/core/src/modules/inventory/core/services/stock-event.service.ts`, add the import:

```typescript
import { serializePackingUnit } from '../../sku-catalog/packing-unit';
```

and change line 68:

```typescript
            packingUnit: serializePackingUnit(packingUnit),
```

- [ ] **Step 10: 읽기 경로 다섯 곳을 파싱한다**

In `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader.ts`, add the import:

```typescript
import { parsePackingUnit } from '../packing-unit';
```

and change all three barcode mappings (lines 113, 252, 428) to:

```typescript
          packingUnit: parsePackingUnit(b.packingUnit),
```

주의: 252 줄의 변수명은 `b` 가 아니라 `bc` 다 — `parsePackingUnit(bc.packingUnit)` 으로 쓴다. 113·428 은 `b`.

In `apps/core/src/modules/inventory/sku-catalog/mappers/sku.mapper.ts`, replace the file:

```typescript
import { SkuBarcode } from '../../schema/inventory.schema';
import { BarcodeDto } from '../dto/sku-response.dto';
import { parsePackingUnit } from '../packing-unit';

export class SkuBarcodeMapper {
  static toDto(barcode: SkuBarcode): BarcodeDto {
    return {
      id: barcode.id,
      barcode: barcode.barcode,
      isPrimary: barcode.isPrimary,
      packingUnit: parsePackingUnit(barcode.packingUnit),
    };
  }
}
```

In `apps/core/src/modules/inventory/inbound/services/inbound.service.ts`, add the import near the other module imports:

```typescript
import { parsePackingUnit } from '../../sku-catalog/packing-unit';
```

and change line 1114 (inside `verifyInboundByBarcode`'s return):

```typescript
      packingUnit: parsePackingUnit(skuBarcode.packingUnit),
```

- [ ] **Step 11: 응답 DTO 타입을 number 로 바꾼다**

In `apps/core/src/modules/inventory/sku-catalog/dto/sku-response.dto.ts`, replace the `BarcodeDto.packingUnit` declaration (lines 23-24):

```typescript
  @ApiProperty({ description: '포장 단위 — 이 바코드 1회 스캔이 뜻하는 낱개 수량', required: false, nullable: true })
  packingUnit?: number | null;
```

- [ ] **Step 12: 백엔드가 컴파일되는지 확인한다**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: `packingUnit` 관련 에러 없음. 저장소에 상시 타입 debt 가 있을 수 있으므로 이번에 손댄 파일에서 **새로 생긴** 에러만 본다.

- [ ] **Step 13: admin-web 타입을 맞춘다**

In `apps/admin-web/src/lib/types/dto/inventory.ts`, change `BarcodeDto.packingUnit` (line 69):

```typescript
  packingUnit?: number | null;
```

`AddBarcodeDto.packingUnit?: number` (line 816) 은 이미 number 라 그대로 둔다.

In `apps/admin-web/src/features/inventory/skus/components/barcode-list-section/index.tsx`, replace the `packingUnit` line inside `handleAdd` (line 32) — `Number('')` 는 `0` 이고 `Number('abc')` 는 `NaN` 이라 그대로 보내면 서버가 400 을 낸다:

```typescript
          packingUnit: parsePositiveInt(newPackingUnit),
```

and add this helper above the component (below the `type Props` block):

```typescript
/** 빈 값·비숫자·0 이하는 "미입력"으로 본다. 서버가 @IsInt() @Min(1) 로 받는다. */
function parsePositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}
```

- [ ] **Step 14: admin-web 타입체크**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 이 변경으로 **새로 생긴** 에러 없음. (저장소에 상시 타입 debt 가 있으므로 기존 에러는 무시하고 변경 파일만 본다.)

- [ ] **Step 15: 커밋**

```bash
git add apps/core/src/modules/inventory/sku-catalog/packing-unit.ts \
        apps/core/src/modules/inventory/sku-catalog/packing-unit.spec.ts \
        apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.ts \
        apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts \
        apps/core/src/modules/inventory/sku-catalog/dto/sku-response.dto.ts \
        apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.ts \
        apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader.ts \
        apps/core/src/modules/inventory/sku-catalog/mappers/sku.mapper.ts \
        apps/core/src/modules/inventory/inbound/services/inbound.service.ts \
        apps/core/src/modules/inventory/inbound/dto/create-stock-entry-by-skuid.dto.ts \
        apps/core/src/modules/inventory/core/services/stock-event.service.ts \
        apps/admin-web/src/lib/types/dto/inventory.ts \
        apps/admin-web/src/features/inventory/skus/components/barcode-list-section/index.tsx
git commit -m "fix(core): packingUnit 계약을 number 로 통일

컬럼은 varchar(64) 인데 DTO 는 @IsString(), admin-web 은 Number() 를 보냈다.
전역 ValidationPipe 에 enableImplicitConversion 이 없어 포장단위를 채워
바코드를 추가하면 400 이 났다(비워두면 undefined 로 통과해서 안 드러남).

컬럼 타입 좁히기는 ADR-0005 상 3-PR expand-contract 라 미루고, parse/serialize
헬퍼를 varchar 와 number 계약 사이의 유일한 경계로 둔다. 파싱은 방어적이다 —
varchar 인 한 'BOX' 같은 값이 손으로 들어갈 수 있고 소비자가 NaN 을 만나면
현장 스캔 수량이 조용히 망가진다."
```

---

## Task 2: `receiveFromPlan` 이 lineId 를 반환

`putaway` 는 `lineId` 를 요구하는데 `receiveFromPlan` 응답은 `{ success, receiptId }` 뿐이라 예정 기반 입고 직후 적치를 이을 수 없다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`receiveFromPlan`, 라인 insert 부근)
- Create: `apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/inbound.service.plan-receive.integration.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `receiveFromPlan` 응답 `{ success: true; receiptId: string; lineId: string }` (Task 5 의 `useReceiveFromPlan` 이 이 `lineId` 로 적치를 건다) / 하네스의 `makeInboundService(database: PostgresJsDatabase<typeof wmsSchema>): InboundService` 와 `inRollbackTx(database, fn: (tx: DbTx) => Promise<void>): Promise<void>` (Task 3 이 재사용)

- [ ] **Step 1: 통합 스펙용 공용 하네스를 만든다**

Create `apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../../schema/inventory.schema';
import { StockEventStore } from '../../../core/repositories/stock-event.store';
import { LocationService } from '../../../core/services/location.service';
import { InventoryCommandService } from '../../../core/services/inventory-command.service';
import { InventoryIdempotencyService } from '../../../core/services/inventory-idempotency.service';
import { BatchControlledStockGuard } from '../../../core/services/batch-controlled-stock.guard';
import { ProductSellableQuantityService } from '../../../product-sellable-quantity/services/product-sellable-quantity.service';
import { OutboxService as InventoryOutboxService } from '../../../shared/outbox/outbox.service';
import { InboundService } from '../inbound.service';

export type Database = PostgresJsDatabase<typeof wmsSchema>;

/**
 * 통합 스펙은 Nest DI 컨테이너를 거치지 않고 서비스를 손으로 세운다(저장소 관례).
 * 조립 자체는 분기 없는 5줄인데도 실제로 드리프트한 이력이 있다 — StockEventStore
 * 와 InventoryCommandService 에 batchControlledStock 이 기본값과 함께 추가되면서
 * 어떤 스펙은 넘기고 어떤 스펙은 안 넘기게 갈렸다. 배선만 여기 모아 둔다.
 *
 * 시드 픽스처는 일부러 여기 두지 않는다 — 스펙마다 필요한 행이 달라서
 * 공유하면 과매개변수 함수가 되고 인라인보다 읽기 어려워진다.
 */
function dbServiceFor(database: Database): DbService<typeof wmsSchema> {
  return {
    db: database,
    run: (<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) =>
      tx ? fn(tx) : database.transaction((trx) => fn(trx as unknown as DbTx))) as never,
  } as unknown as DbService<typeof wmsSchema>;
}

export function makeInboundService(database: Database): InboundService {
  const dbService = dbServiceFor(database);
  const guard = new BatchControlledStockGuard();
  const outbox = new InventoryOutboxService(dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, outbox);
  const eventStore = new StockEventStore(dbService, sellable, guard);
  const location = new LocationService(dbService);
  const command = new InventoryCommandService(dbService, eventStore, outbox, location, guard);
  const idempotency = new InventoryIdempotencyService(dbService);
  // individualInbound 경로만 skuCatalogService.findById 를 부른다. 전체 카탈로그
  // 서비스를 조립할 필요는 없어서 그 한 메서드만 스텁으로 세운다.
  const skuCatalog = {
    findById: (skuId: string, tx?: DbTx) =>
      (tx ?? database).query.skus.findFirst({ where: eq(wmsTables.skus.id, skuId) }),
  };
  return new InboundService(dbService, skuCatalog as never, command, location, eventStore, idempotency);
}

class Rollback extends Error {}

/** 커밋 없이 검증한다 — 통합 스펙이 dev DB 를 더럽히지 않게. */
export async function inRollbackTx(database: Database, fn: (tx: DbTx) => Promise<void>): Promise<void> {
  await expect(
    database.transaction(async (trx) => {
      await fn(trx as unknown as DbTx);
      throw new Rollback('intentional rollback');
    }),
  ).rejects.toThrow(Rollback);
}
```

- [ ] **Step 2: 실패하는 통합 테스트를 쓴다**

Create `apps/core/src/modules/inventory/inbound/services/inbound.service.plan-receive.integration.spec.ts`:

```typescript
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { Database, inRollbackTx, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InboundService.receiveFromPlan (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  // 시드는 이 스펙 전용이다 — 예정 아이템 1건만 있으면 되고, 하네스로 올리면
  // 다른 스펙의 필요와 뒤섞여 과매개변수 함수가 된다.
  async function seedPlanItem(tx: DbTx, expectedQty: number) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `plan-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `plan-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'plan sku', code: `PLAN-${suffix}`, holderId: holder.id })
      .returning();
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `plan-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({ supplierId: supplier.id, type: 'domestic' })
      .returning();
    const [plan] = await tx
      .insert(wmsTables.inboundPlans)
      .values({ warehouseId: warehouse.id, linkedPurchaseOrderId: po.id, status: 'pending' })
      .returning();
    const [item] = await tx
      .insert(wmsTables.inboundPlanItems)
      .values({ planId: plan.id, skuId: sku.id, expectedQty, receivedQty: 0, status: 'pending' })
      .returning();
    return { warehouse, sku, plan, item };
  }

  it('실입고 라인의 lineId 를 반환한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { item } = await seedPlanItem(tx, 20);

      const result = await svc.receiveFromPlan(
        { planItemId: item.id, quantity: 20, idempotencyKey: randomUUID() },
        tx,
      );

      expect(result.lineId).toEqual(expect.any(String));

      const line = await tx.query.inboundReceiptLines.findFirst({
        where: eq(wmsTables.inboundReceiptLines.id, result.lineId),
      });
      expect(line).toBeDefined();
      expect(line?.planItemId).toBe(item.id);
      expect(line?.quantity).toBe(20);
      expect(line?.receiptId).toBe(result.receiptId);
    });
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `DATABASE_URL="$DATABASE_URL" npx jest --testPathPattern=inbound.service.plan-receive.integration`
Expected: FAIL — `result.lineId` 가 `undefined` 라 `expect.any(String)` 에서 떨어진다

`DATABASE_URL` 이 없으면 스펙이 통째로 skip 되어 초록으로 보인다. 반드시 값을 주고 돌린다. 로컬 dev DB 문자열은 `apps/core/.env` 에 있다.

- [ ] **Step 4: 라인 insert 를 returning 으로 바꾸고 응답에 담는다**

In `apps/core/src/modules/inventory/inbound/services/inbound.service.ts`, inside `receiveFromPlan`, replace the line insert:

```typescript
      const [line] = await tx
        .insert(wmsTables.inboundReceiptLines)
        .values({
          receiptId: receipt.id,
          skuId: item.skuId,
          quantity: dto.quantity,
          originLocationId: effectiveLocationId,
          eventId: eventId ?? null,
          planItemId: item.id,
        })
        .returning();
```

and replace the return statement at the end of the same callback:

```typescript
      // lineId 는 후속 적치(putaway)의 유일한 입력이다 — 현장 앱이 입고 직후
      // 바로 적치를 걸 수 있도록 여기서 돌려준다.
      return { success: true, receiptId: receipt.id, lineId: line.id };
```

- [ ] **Step 5: 통과를 확인한다**

Run: `DATABASE_URL="$DATABASE_URL" npx jest --testPathPattern=inbound.service.plan-receive.integration`
Expected: PASS — 1 test

- [ ] **Step 6: 기존 멱등 배선 스펙이 깨지지 않았는지 확인한다**

Run: `npx jest --testPathPattern=inbound.service.idempotency`
Expected: PASS — 7 tests

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/inbound.service.ts \
        apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts \
        apps/core/src/modules/inventory/inbound/services/inbound.service.plan-receive.integration.spec.ts
git commit -m "feat(core): receiveFromPlan 이 lineId 를 반환

적치(putaway)는 lineId 를 유일한 입력으로 받는데 예정 기반 입고 응답에는
receiptId 만 있어서 입고 직후 적치를 이을 수 없었다. simple/individual 은
이미 라인을 반환한다."
```

---

## Task 3: `cancelInbound` 의 예정 연계 복원

`cancelInbound` 은 라인을 취소하고 이벤트를 역분개하지만 `inboundPlanItems.receivedQty` 를 되돌리지 않는다. 예정 20개를 20개 입고 → 취소 → 재입고하면 누계가 40 이 되고 항목이 `confirmed` 로 굳는다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`cancelInbound`)
- Create: `apps/core/src/modules/inventory/inbound/services/inbound.service.cancel-plan-restore.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `receiveFromPlan` 응답 `{ receiptId, lineId }`
- Produces: 없음 (동작 수정)

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다**

Create `apps/core/src/modules/inventory/inbound/services/inbound.service.cancel-plan-restore.integration.spec.ts`:

```typescript
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { Database, inRollbackTx, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InboundService.cancelInbound 예정 연계 복원 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  // 이 스펙은 예정 아이템 + 같은 SKU 의 개별입고까지 쓴다. Task 2 의 시드와
  // 필요한 행이 겹쳐 보이지만 반환 모양이 달라 각자 인라인으로 둔다.
  async function seedPlanItem(tx: DbTx, expectedQty: number) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `cancel-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `cancel-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'cancel sku', code: `CANCEL-${suffix}`, holderId: holder.id })
      .returning();
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `cancel-supplier-${suffix.slice(0, 8)}` })
      .returning();
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({ supplierId: supplier.id, type: 'domestic' })
      .returning();
    const [plan] = await tx
      .insert(wmsTables.inboundPlans)
      .values({ warehouseId: warehouse.id, linkedPurchaseOrderId: po.id, status: 'pending' })
      .returning();
    const [item] = await tx
      .insert(wmsTables.inboundPlanItems)
      .values({ planId: plan.id, skuId: sku.id, expectedQty, receivedQty: 0, status: 'pending' })
      .returning();
    return { warehouse, sku, plan, item };
  }

  it('전량 입고 후 취소하면 예정 누계와 상태가 되돌아온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { item } = await seedPlanItem(tx, 20);

      const received = await svc.receiveFromPlan(
        { planItemId: item.id, quantity: 20, idempotencyKey: randomUUID() },
        tx,
      );

      const afterReceive = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterReceive?.receivedQty).toBe(20);
      expect(afterReceive?.status).toBe('confirmed');

      await svc.cancelInbound(
        { lineId: received.lineId, quantity: 20, idempotencyKey: randomUUID() },
        tx,
      );

      const afterCancel = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterCancel?.receivedQty).toBe(0);
      expect(afterCancel?.status).toBe('pending');
    });
  });

  it('부분 입고 두 건 중 하나만 취소하면 나머지 누계는 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { item } = await seedPlanItem(tx, 20);

      await svc.receiveFromPlan({ planItemId: item.id, quantity: 8, idempotencyKey: randomUUID() }, tx);
      const second = await svc.receiveFromPlan(
        { planItemId: item.id, quantity: 12, idempotencyKey: randomUUID() },
        tx,
      );

      await svc.cancelInbound({ lineId: second.lineId, quantity: 12, idempotencyKey: randomUUID() }, tx);

      const afterCancel = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(afterCancel?.receivedQty).toBe(8);
      expect(afterCancel?.status).toBe('pending');
    });
  });

  it('예정과 무관한 간편입고 라인 취소는 예정을 건드리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku, item } = await seedPlanItem(tx, 20);

      // 같은 SKU 를 예정과 무관하게 개별입고한 뒤 그 라인을 취소한다
      const individual = await svc.individualInbound(
        {
          warehouseId: warehouse.id,
          skuId: sku.id,
          quantity: 5,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.cancelInbound(
        { lineId: individual.line.id, quantity: 5, idempotencyKey: randomUUID() },
        tx,
      );

      const planItem = await tx.query.inboundPlanItems.findFirst({
        where: eq(wmsTables.inboundPlanItems.id, item.id),
      });
      expect(planItem?.receivedQty).toBe(0);
      expect(planItem?.status).toBe('pending');
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL="$DATABASE_URL" npx jest --testPathPattern=inbound.service.cancel-plan-restore.integration`
Expected: FAIL — 첫 두 테스트가 취소 후에도 `receivedQty` 가 각각 20, 20 으로 남아서 떨어진다. 세 번째는 통과한다(기존 동작).

- [ ] **Step 3: 취소 시 예정 누계를 복원한다**

In `apps/core/src/modules/inventory/inbound/services/inbound.service.ts`, inside `cancelInbound`, insert this block **right after** the `inboundReceiptLines` `canceledQty` update and **before** the `inboundWorkLogs` insert:

```typescript
      // 예정 연계 라인이면 예정 누계를 되돌린다. 이게 없으면 취소 후 재입고가
      // receivedQty 를 이중 계상하고, 항목이 confirmed 로 굳어 예정 목록에서 사라진다.
      if (line.planItemId) {
        const planItem = await tx.query.inboundPlanItems.findFirst({
          where: eq(wmsTables.inboundPlanItems.id, line.planItemId),
        });
        if (planItem) {
          const restored = Math.max(0, (planItem.receivedQty ?? 0) - line.quantity);
          await tx
            .update(wmsTables.inboundPlanItems)
            .set({
              receivedQty: restored,
              // 여러 회차가 걸린 예정에서 한 건만 취소한 경우가 있으므로 상태는
              // 'pending' 으로 고정하지 않고 남은 누계로 다시 판정한다.
              status: restored >= planItem.expectedQty ? 'confirmed' : 'pending',
            })
            .where(eq(wmsTables.inboundPlanItems.id, planItem.id));
        }
      }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `DATABASE_URL="$DATABASE_URL" npx jest --testPathPattern=inbound.service.cancel-plan-restore.integration`
Expected: PASS — 3 tests

- [ ] **Step 5: 인접 스펙 회귀 확인**

Run: `npx jest --testPathPattern=inbound.service`
Expected: PASS — 멱등 배선 7건 + plan-receive 1건 + cancel-plan-restore 3건

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/inbound.service.ts \
        apps/core/src/modules/inventory/inbound/services/inbound.service.cancel-plan-restore.integration.spec.ts
git commit -m "fix(core): 입고 취소가 예정 누계를 되돌리도록

라인은 취소되고 이벤트도 역분개되는데 inboundPlanItems.receivedQty 가 그대로
남아, 예정 20개를 입고→취소→재입고하면 누계가 40 이 되고 항목이 confirmed 로
굳어 예정 목록에서 사라졌다. 상태는 'pending' 고정이 아니라 남은 누계로 다시
판정한다 — 여러 회차가 걸린 예정에서 한 건만 취소하는 경우가 있다."
```

---

## Task 4: 앱 토대 — 타입 · 에러 문맥 · 포장단위 해석

화면들이 딛고 설 순수 조각을 먼저 깐다.

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/types.ts`
- Create: `native/warehouse-app/src/domains/inbound/packingUnit.ts`
- Create: `native/warehouse-app/src/domains/inbound/packingUnit.test.ts`
- Modify: `native/warehouse-app/src/domains/inventory/types.ts`
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts`
- Modify: `native/warehouse-app/src/core/data/errorMessage.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `BarcodeDto.packingUnit?: number | null` 응답 계약
- Produces: `PendingPlan` · `PendingPlanItem` · `PendingPlanListResult` · `ReceiveFromPlanInput/Result` · `SimpleInboundInput/Result` · `SimpleInboundLine` · `PutawayInput` · `CancelInboundInput` (types.ts) / `scanIncrement(sku: SkuSearchItem | undefined, barcode: string): number` (packingUnit.ts) / `SkuSearchItem.barcodes?: SkuBarcodeItem[]`

- [ ] **Step 1: 입고 도메인 타입을 만든다**

Create `native/warehouse-app/src/domains/inbound/types.ts`:

```typescript
/** GET /inbound/pending 의 items[] 한 행. */
export interface PendingPlanItem {
  planItemId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  expectedQty: number;
  receivedQty: number;
  pendingQty: number;
}

/** GET /inbound/pending 의 pendingPlans[] 한 행 중 현장에서 쓰는 필드만. */
export interface PendingPlan {
  planId: string;
  warehouseId: string;
  /** ISO 문자열. 서버는 Date 로 두지만 JSON 을 건너오며 문자열이 된다. */
  expectedDate: string | null;
  purchaseOrder: {
    id: string;
    type: 'domestic' | 'foreign';
    supplier?: { id: string; name: string } | null;
  };
  items: PendingPlanItem[];
  totalQuantity: number;
  totalPendingQuantity: number;
}

export interface PendingPlanListResult {
  totalPendingPlans: number;
  totalPendingQuantity: number;
  pendingPlans: PendingPlan[];
}

export interface ReceiveFromPlanInput {
  planItemId: string;
  quantity: number;
  memo?: string;
  idempotencyKey: string;
}

export interface ReceiveFromPlanResult {
  success: boolean;
  receiptId: string;
  lineId: string;
}

export interface SimpleInboundInput {
  warehouseId: string;
  items: Array<{ skuId: string; quantity: number; memo?: string }>;
  idempotencyKey: string;
}

/** SimpleInboundResponseDto 의 lines[] 한 행 중 적치에 필요한 필드만. */
export interface SimpleInboundLine {
  id: string;
  skuId: string;
  quantity: number;
}

/** SimpleInboundResponseDto — 회차 헤더 필드는 id 로 온다(receiptId 아님). */
export interface SimpleInboundResult {
  id: string;
  lines: SimpleInboundLine[];
}

export interface PutawayInput {
  lineId: string;
  toLocationId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface CancelInboundInput {
  lineId: string;
  quantity: number;
  idempotencyKey: string;
}

/** 입고 직후 화면에 남는 "방금 만든 라인" — 적치·취소의 대상. */
export interface FreshLine {
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  quantity: number;
  putawayDone: boolean;
}
```

- [ ] **Step 2: `SkuSearchItem` 에 바코드를 붙인다**

In `native/warehouse-app/src/domains/inventory/types.ts`, replace the `SkuSearchItem` block:

```typescript
/** SkuResponseDto.barcodes[] 한 행. packingUnit 은 바코드마다 다르다. */
export interface SkuBarcodeItem {
  id: string;
  barcode: string;
  isPrimary: boolean;
  /** 이 바코드 1회 스캔이 뜻하는 낱개 수량. 미설정이면 null. */
  packingUnit?: number | null;
}

/** 재고조회 목록 표시용 최소 필드. 백엔드 SkuResponseDto의 부분집합. */
export interface SkuSearchItem {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
  /** search/advanced 응답에서 계산되는 현재고(전 창고 합산 또는 warehouseId 한정). */
  currentStock: number;
  /** 안전재고. 0이면 부족 판정 제외. */
  safetyStock: number;
  /**
   * GET /inventory/skus?barcode= 응답에만 담긴다(search/advanced 에는 없다).
   * 입고 화면이 "스캔한 바코드의 포장단위"를 고르는 데 쓴다.
   */
  barcodes?: SkuBarcodeItem[];
}
```

- [ ] **Step 3: 포장단위 해석의 실패 테스트를 쓴다**

Create `native/warehouse-app/src/domains/inbound/packingUnit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { SkuSearchItem } from '../inventory/types';
import { scanIncrement } from './packingUnit';

const sku: SkuSearchItem = {
  id: 's1',
  code: 'CT-001',
  name: '코튼셔츠',
  currentStock: 0,
  safetyStock: 0,
  barcodes: [
    { id: 'b1', barcode: '8801', isPrimary: true, packingUnit: null },
    { id: 'b2', barcode: '8802', isPrimary: false, packingUnit: 20 },
  ],
};

describe('scanIncrement', () => {
  it('스캔한 바코드의 packingUnit 을 쓴다', () => {
    expect(scanIncrement(sku, '8802')).toBe(20);
  });

  it('packingUnit 이 없는 바코드는 1', () => {
    expect(scanIncrement(sku, '8801')).toBe(1);
  });

  it('SKU 에 없는 바코드는 1', () => {
    expect(scanIncrement(sku, '9999')).toBe(1);
  });

  it('SKU 자체가 없으면 1', () => {
    expect(scanIncrement(undefined, '8802')).toBe(1);
  });

  // 컬럼이 varchar 라 서버 파싱을 뚫고 이상한 값이 올 여지가 남는다.
  it('정수가 아니거나 1 미만이면 1', () => {
    const broken: SkuSearchItem = {
      ...sku,
      barcodes: [
        { id: 'b3', barcode: '7001', isPrimary: false, packingUnit: 0 },
        { id: 'b4', barcode: '7002', isPrimary: false, packingUnit: -5 },
        { id: 'b5', barcode: '7003', isPrimary: false, packingUnit: 1.5 },
      ],
    };
    expect(scanIncrement(broken, '7001')).toBe(1);
    expect(scanIncrement(broken, '7002')).toBe(1);
    expect(scanIncrement(broken, '7003')).toBe(1);
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/packingUnit.test.ts`
Expected: FAIL — `Failed to resolve import "./packingUnit"`

- [ ] **Step 5: 구현한다**

Create `native/warehouse-app/src/domains/inbound/packingUnit.ts`:

```typescript
import type { SkuSearchItem } from '../inventory/types';

/**
 * 스캔 1회가 더할 수량. packingUnit 은 SKU 가 아니라 **바코드 행마다** 달리므로
 * 박스 바코드를 찍으면 +20, 낱개 바코드를 찍으면 +1 이 된다.
 *
 * 폴백이 1 인 건 안전한 쪽이라서다 — 값이 없거나 이상하면 작업자가 눈으로 센
 * 만큼만 오르고, NumberPad 로 언제든 고칠 수 있다. 반대로 잘못된 배수를
 * 곱하면 원장에 조용히 틀린 수량이 박힌다.
 *
 * 참고: 현재 sku_barcodes.packing_unit 은 전량 NULL 이라 실효 동작은 모두 +1 이다.
 * 운영에서 포장단위를 채우기 시작하면 앱 배포 없이 배수 누적으로 바뀐다.
 */
export function scanIncrement(sku: SkuSearchItem | undefined, barcode: string): number {
  const row = sku?.barcodes?.find((b) => b.barcode === barcode);
  const unit = row?.packingUnit;
  if (typeof unit !== 'number') return 1;
  if (!Number.isSafeInteger(unit) || unit < 1) return 1;
  return unit;
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/packingUnit.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 7: 에러 문맥에 'inbound' 를 더하는 테스트를 쓴다**

In `native/warehouse-app/src/core/data/errorMessage.test.ts`, append this describe block at the end of the file:

```typescript
describe('inbound 문맥', () => {
  it('적치 실패(400)는 입고기본존 재고를 짚어준다', () => {
    expect(errorMessage(new Error('POST /inbound/putaway → 400'), 'inbound')).toBe(
      '입고기본존 재고가 부족해요. 새로고침 후 확인해 주세요.'
    );
  });

  it('취소 실패(400)는 적치/당일 제약을 함께 안내한다', () => {
    expect(errorMessage(new Error('POST /inbound/cancel → 400'), 'inbound-cancel')).toBe(
      '이미 적치했거나 오늘 입고분이 아니라 취소할 수 없어요.'
    );
  });
});
```

`errorMessage.test.ts` 상단에 `errorMessage` import 가 이미 있으면 그대로 쓴다.

- [ ] **Step 8: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/core/data/errorMessage.test.ts`
Expected: FAIL — `'inbound'` 가 `ErrorContext` 에 없어 타입 에러 또는 기본 문구 반환

- [ ] **Step 9: 문맥 두 개를 더한다**

In `native/warehouse-app/src/core/data/errorMessage.ts`, replace the type and table:

```typescript
/** 같은 상태 코드라도 화면 문맥에 따라 현장에 필요한 문구가 다르다. */
export type ErrorContext =
  | 'barcode'
  | 'location'
  | 'stocktaking'
  | 'movement'
  | 'inbound'
  | 'inbound-cancel';

const CONTEXTUAL: Record<ErrorContext, Partial<Record<number, string>>> = {
  barcode: { 404: '등록되지 않은 바코드예요.' },
  location: { 404: '로케이션을 찾을 수 없어요.' },
  stocktaking: { 400: '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.' },
  movement: { 400: '출발지 재고가 부족해요. 다시 확인해 주세요.' },
  inbound: { 400: '입고기본존 재고가 부족해요. 새로고침 후 확인해 주세요.' },
  // 취소는 서버가 "적치 존재"·"당일 아님"·"전량 아님"을 모두 400 으로 낸다.
  // 현장에서 실제로 부딪히는 건 앞의 둘이고, 앱은 전량만 보내므로 셋째는 안 난다.
  'inbound-cancel': { 400: '이미 적치했거나 오늘 입고분이 아니라 취소할 수 없어요.' },
};
```

- [ ] **Step 10: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/core/data/errorMessage.test.ts`
Expected: PASS — 기존 테스트 + 새 2건

- [ ] **Step 11: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/types.ts \
        native/warehouse-app/src/domains/inbound/packingUnit.ts \
        native/warehouse-app/src/domains/inbound/packingUnit.test.ts \
        native/warehouse-app/src/domains/inventory/types.ts \
        native/warehouse-app/src/core/data/errorMessage.ts \
        native/warehouse-app/src/core/data/errorMessage.test.ts
git commit -m "feat(warehouse-app): 입고 도메인 타입·포장단위 해석·에러 문맥

packingUnit 은 SKU 가 아니라 바코드 행마다 달린다 — 박스 바코드는 +20,
낱개는 +1. 값이 없거나 이상하면 1 로 떨어뜨린다(잘못된 배수보다 안전하다)."
```

---

## Task 5: 쿼리와 뮤테이션

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/queries.ts`
- Create: `native/warehouse-app/src/domains/inbound/queries.test.tsx`
- Create: `native/warehouse-app/src/domains/inbound/mutations.ts`
- Create: `native/warehouse-app/src/domains/inbound/mutations.test.tsx`

**Interfaces:**
- Consumes: Task 4 의 타입 전부
- Produces: `usePendingPlans(warehouseId: string | null)` → `UseQueryResult<PendingPlanListResult>` / `useReceiveFromPlan()` · `useSimpleInbound()` · `usePutaway()` · `useCancelInbound()` — 각각 `useMutation` 결과

- [ ] **Step 1: 쿼리의 실패 테스트를 쓴다**

Create `native/warehouse-app/src/domains/inbound/queries.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { usePendingPlans } from './queries';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('usePendingPlans', () => {
  it('warehouseId 로 GET 경로를 만든다', async () => {
    const request = vi.fn(async (_o: { path: string }) => ({
      totalPendingPlans: 1,
      totalPendingQuantity: 20,
      pendingPlans: [],
    }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => usePendingPlans('w-1'), { wrapper: wrapperWith(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inbound/pending?warehouseId=w-1');
  });

  it('warehouseId 가 없으면 요청하지 않는다', () => {
    const request = vi.fn(async () => ({}));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    renderHook(() => usePendingPlans(null), { wrapper: wrapperWith(client) });
    expect(request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/queries.test.tsx`
Expected: FAIL — `Failed to resolve import "./queries"`

- [ ] **Step 3: 쿼리를 구현한다**

Create `native/warehouse-app/src/domains/inbound/queries.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { PendingPlanListResult } from './types';

/**
 * GET /inbound/pending?warehouseId=…
 *
 * 예정 단건 조회 API 는 없다. 예정 상세 화면도 이 쿼리를 그대로 재사용해
 * planId 로 골라 쓴다 — 목록과 상세가 한 캐시를 공유하므로 입고 후 무효화
 * 한 번이 양쪽에 반영된다.
 */
export function usePendingPlans(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['inbound-pending', warehouseId],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '' });
      return api.request<PendingPlanListResult>({ path: `/inbound/pending?${qs.toString()}` });
    },
  });
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/queries.test.tsx`
Expected: PASS — 2 tests

- [ ] **Step 5: 뮤테이션의 실패 테스트를 쓴다**

Create `native/warehouse-app/src/domains/inbound/mutations.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useReceiveFromPlan, useSimpleInbound, usePutaway, useCancelInbound } from './mutations';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

interface Call {
  path: string;
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}

function setup(calls: Call[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidated: unknown[][] = [];
  const original = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push((filters as { queryKey?: unknown[] })?.queryKey ?? []);
    return original(filters);
  });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      return { success: true, receiptId: 'r-1', lineId: 'ln-1', id: 'r-1', lines: [] };
    }) as unknown as ApiClient['request'],
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { wrapper, invalidated };
}

describe('useReceiveFromPlan', () => {
  it('멱등키를 본문과 헤더 양쪽에 싣는다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => useReceiveFromPlan(), { wrapper });

    result.current.mutate({ planItemId: 'pi-1', quantity: 20, idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/plans/receive');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].idempotencyKey).toBe('key-1');
    expect(calls[0].body).toMatchObject({ planItemId: 'pi-1', quantity: 20, idempotencyKey: 'key-1' });
  });

  it('원장이 움직였으므로 재고 캐시까지 무효화한다', async () => {
    const calls: Call[] = [];
    const { wrapper, invalidated } = setup(calls);
    const { result } = renderHook(() => useReceiveFromPlan(), { wrapper });

    result.current.mutate({ planItemId: 'pi-1', quantity: 1, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidated.map((k) => k[0]);
    expect(keys).toContain('inbound-pending');
    expect(keys).toContain('location-contents');
    expect(keys).toContain('sku-warehouse-stock');
    expect(keys).toContain('sku-stock-summary');
  });

  // onSuccess 가 아니라 onSettled 여야 한다: 서버는 커밋했는데 응답만 유실되면
  // onSuccess 는 영영 안 불리고 stale 캐시가 남는다.
  it('실패해도 무효화한다', async () => {
    const calls: Call[] = [];
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidated: unknown[][] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
      invalidated.push((filters as { queryKey?: unknown[] })?.queryKey ?? []);
      return Promise.resolve();
    });
    const client: ApiClient = {
      request: (async (o: Call) => {
        calls.push(o);
        throw new Error('POST /inbound/plans/receive → 500');
      }) as unknown as ApiClient['request'],
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    const { result } = renderHook(() => useReceiveFromPlan(), { wrapper });

    result.current.mutate({ planItemId: 'pi-1', quantity: 1, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated.map((k) => k[0])).toContain('inbound-pending');
  });
});

describe('나머지 뮤테이션 경로', () => {
  it('useSimpleInbound 는 /inbound/simple 로 간다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => useSimpleInbound(), { wrapper });

    result.current.mutate({
      warehouseId: 'w-1',
      items: [{ skuId: 's1', quantity: 3 }],
      idempotencyKey: 'k',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/simple');
    expect(calls[0].idempotencyKey).toBe('k');
  });

  it('usePutaway 는 /inbound/putaway 로 간다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => usePutaway(), { wrapper });

    result.current.mutate({ lineId: 'ln-1', toLocationId: 'l-9', quantity: 3, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/putaway');
    expect(calls[0].body).toMatchObject({ lineId: 'ln-1', toLocationId: 'l-9', quantity: 3 });
  });

  it('useCancelInbound 는 /inbound/cancel 로 간다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => useCancelInbound(), { wrapper });

    result.current.mutate({ lineId: 'ln-1', quantity: 3, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/cancel');
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/mutations.test.tsx`
Expected: FAIL — `Failed to resolve import "./mutations"`

- [ ] **Step 7: 뮤테이션을 구현한다**

Create `native/warehouse-app/src/domains/inbound/mutations.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type {
  CancelInboundInput,
  PutawayInput,
  ReceiveFromPlanInput,
  ReceiveFromPlanResult,
  SimpleInboundInput,
  SimpleInboundResult,
} from './types';

/**
 * 네 뮤테이션 모두 원장을 움직인다. 예정 잔여·로케이션 내용물·SKU 재고가 전부
 * 어긋나므로 한 곳에 묶어 부른다.
 */
function invalidateAfterLedgerWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['inbound-pending'] });
  void qc.invalidateQueries({ queryKey: ['location-contents'] });
  void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
  void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
}

/**
 * POST /inbound/plans/receive — 예정 아이템 기반 실입고.
 * 서버는 예정 초과를 막지 않는다(경고는 화면 책임). 로케이션을 안 넘기면
 * 입고기본존으로 들어가고, 목적지는 이어지는 putaway 가 정한다.
 *
 * onSettled 인 이유: 서버가 커밋한 뒤 응답만 유실되면 onSuccess 는 영영 안
 * 불린다. 그 상태로 예정 목록에 돌아오면 이미 입고된 수량이 잔여로 남아 보이고
 * 작업자가 한 번 더 찍는다.
 */
export function useReceiveFromPlan() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiveFromPlanInput) =>
      api.request<ReceiveFromPlanResult>({
        method: 'POST',
        path: '/inbound/plans/receive',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}

/** POST /inbound/simple — 다건 즉시 입고. 로케이션은 항상 입고기본존이다. */
export function useSimpleInbound() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SimpleInboundInput) =>
      api.request<SimpleInboundResult>({
        method: 'POST',
        path: '/inbound/simple',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}

/** POST /inbound/putaway — 입고기본존에서 목적지로 즉시 이동. lineId 기준. */
export function usePutaway() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutawayInput) =>
      api.request<{ success: boolean }>({
        method: 'POST',
        path: '/inbound/putaway',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}

/**
 * POST /inbound/cancel — 직전 입고 되돌리기.
 * 서버 제약: 전량만·적치 전에만·당일(Asia/Seoul)만. 화면은 이 셋을 만족하는
 * 순간에만 버튼을 노출한다.
 */
export function useCancelInbound() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CancelInboundInput) =>
      api.request<{ success: boolean }>({
        method: 'POST',
        path: '/inbound/cancel',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/mutations.test.tsx`
Expected: PASS — 6 tests

- [ ] **Step 9: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/queries.ts \
        native/warehouse-app/src/domains/inbound/queries.test.tsx \
        native/warehouse-app/src/domains/inbound/mutations.ts \
        native/warehouse-app/src/domains/inbound/mutations.test.tsx
git commit -m "feat(warehouse-app): 입고 쿼리·뮤테이션

무효화는 onSuccess 가 아니라 onSettled 다 — 서버가 커밋한 뒤 응답만 유실되면
onSuccess 는 안 불리고, 그 상태로 예정 목록에 돌아오면 이미 입고된 수량이
잔여로 남아 보여 작업자가 한 번 더 찍는다."
```

---

## Task 6: 적치 시트

두 화면이 공용으로 쓰는 대상 로케이션 선택 시트. 재고 이동 화면의 대상지 선택 로직(코드 완전일치 자동선택 + 직전 대상지 재사용)을 입고 문맥으로 옮긴 것이다.

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/PutawaySheet.tsx`
- Create: `native/warehouse-app/src/domains/inbound/PutawaySheet.test.tsx`

**Interfaces:**
- Consumes: Task 4 의 `FreshLine`, Task 5 의 `usePutaway`
- Produces: `<PutawaySheet line={FreshLine} warehouseId={string} lastDest={LocationRef | null} onDone={(dest: LocationRef) => void} onCancel={() => void} />` 와 `export interface LocationRef { id: string; code: string }`

- [ ] **Step 1: 실패 테스트를 쓴다**

Create `native/warehouse-app/src/domains/inbound/PutawaySheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import type { FreshLine } from './types';
import { PutawaySheet } from './PutawaySheet';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const LINE: FreshLine = {
  lineId: 'ln-1',
  skuId: 's1',
  skuCode: 'CT-001',
  skuName: '코튼셔츠',
  quantity: 20,
  putawayDone: false,
};

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

function makeClient(calls: Call[]): ApiClient {
  return {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/locations/warehouses/')) {
        if (o.path.includes('B-05')) {
          return { items: [{ id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' }], total: 1 };
        }
        return { items: [], total: 0 };
      }
      if (o.path === '/inbound/putaway') return { success: true };
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderSheet(props: Partial<ComponentProps<typeof PutawaySheet>> = {}, calls: Call[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={makeClient(calls)}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const onDone = props.onDone ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  render(
    <PutawaySheet
      line={props.line ?? LINE}
      warehouseId={props.warehouseId ?? 'w-1'}
      lastDest={props.lastDest ?? null}
      onDone={onDone}
      onCancel={onCancel}
    />,
    { wrapper }
  );
  return { onDone, onCancel };
}

describe('PutawaySheet', () => {
  it('코드 완전일치 단건이면 대상지를 자동 선택한다', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'B-05-03');

    await waitFor(() => expect(screen.getByText('B-05-03')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
  });

  it('직전 대상지 버튼으로 한 번에 고른다', async () => {
    const user = userEvent.setup();
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } });

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
  });

  it('적치하면 lineId·대상지·수량을 보내고 onDone 을 부른다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    const { onDone } = renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } }, calls);

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'l-prev', code: 'A-01-01' }));
    const putaway = calls.find((c) => c.path === '/inbound/putaway');
    expect(putaway?.body).toMatchObject({ lineId: 'ln-1', toLocationId: 'l-prev', quantity: 20 });
  });

  it('대상지를 안 고르면 적치할 수 없다', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/PutawaySheet.test.tsx`
Expected: FAIL — `Failed to resolve import "./PutawaySheet"`

- [ ] **Step 3: 구현한다**

Create `native/warehouse-app/src/domains/inbound/PutawaySheet.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { usePutaway } from './mutations';
import type { FreshLine } from './types';

export interface LocationRef {
  id: string;
  code: string;
}

/**
 * 입고 직후 적치 — 재고 이동 화면의 대상지 선택을 입고 문맥으로 옮긴 것이다.
 * 시트가 열려 있는 동안 스캔은 전부 로케이션 코드로 해석된다(상품 바코드는
 * 이 시점에 의미가 없다).
 */
export function PutawaySheet({
  line,
  warehouseId,
  lastDest,
  onDone,
  onCancel,
}: {
  line: FreshLine;
  warehouseId: string | null;
  lastDest: LocationRef | null;
  onDone: (dest: LocationRef) => void;
  onCancel: () => void;
}) {
  const [dest, setDest] = useState<LocationRef | null>(null);
  const [term, setTerm] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const search = useLocationSearch(warehouseId, dest ? '' : term);
  const putaway = usePutaway();

  useScanner((e) => {
    if (!dest) setTerm(e.code);
  });

  // 코드 완전일치 단건이면 자동 선택 — 이동 화면과 같은 규칙.
  useEffect(() => {
    if (dest) return;
    const trimmed = term.trim();
    if (!trimmed) return;
    const exact = (search.data?.items ?? []).filter((i) => i.code === trimmed);
    if (exact.length === 1) {
      setDest({ id: exact[0].id, code: exact[0].code });
      setTerm('');
    }
  }, [search.data, term, dest]);

  // 멱등키 회전: 대상지가 바뀌면 새 키. "커밋됐는데 응답만 유실" 뒤 대상지를
  // 고쳐 재제출할 때 옛 payload 를 같은 키로 replay 하는 사고를 막는다.
  const keyPayloadRef = useRef({ lineId: line.lineId, to: '' });
  useEffect(() => {
    const next = { lineId: line.lineId, to: dest?.id ?? '' };
    const prev = keyPayloadRef.current;
    if (prev.lineId === next.lineId && prev.to === next.to) return;
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [line.lineId, dest]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="적치"
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div>
          <div className="font-semibold text-gray-800">{line.skuName}</div>
          <div className="font-mono text-xs text-gray-500">{line.skuCode}</div>
          <div className="mt-1 text-xs text-gray-500">입고기본존 · {line.quantity}개를 적치합니다</div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">대상 로케이션</h3>
          {dest ? (
            <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
              <span className="flex-1 font-medium text-gray-800">{dest.code}</span>
              <button type="button" className="text-xs text-blue-700 underline" onClick={() => setDest(null)}>
                변경
              </button>
            </div>
          ) : (
            <>
              {lastDest ? (
                <button
                  type="button"
                  className="w-full rounded-md border border-blue-300 bg-blue-50 p-2 text-sm text-blue-700"
                  onClick={() => setDest(lastDest)}
                >
                  직전 대상지 {lastDest.code} 사용
                </button>
              ) : null}
              <label htmlFor="putaway-dest" className="sr-only">
                대상 로케이션 검색
              </label>
              <input
                id="putaway-dest"
                aria-label="대상 로케이션 검색"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="대상 로케이션 바코드를 스캔하거나 코드를 입력하세요"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              {search.isError ? (
                <p role="alert" className="text-sm text-red-600">
                  {errorMessage(search.error, 'location')}
                </p>
              ) : null}
              <ul className="space-y-1">
                {(search.data?.items ?? []).map((loc) => (
                  <li key={loc.id}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                      onClick={() => setDest({ id: loc.id, code: loc.code })}
                    >
                      {loc.code}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {putaway.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(putaway.error, 'inbound')}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={onCancel}
          >
            나중에
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!dest || putaway.isPending}
            onClick={() => {
              if (!dest) return;
              putaway.mutate(
                {
                  lineId: line.lineId,
                  toLocationId: dest.id,
                  quantity: line.quantity,
                  idempotencyKey,
                },
                { onSuccess: () => onDone(dest) }
              );
            }}
          >
            적치
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/PutawaySheet.test.tsx`
Expected: PASS — 4 tests

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/PutawaySheet.tsx \
        native/warehouse-app/src/domains/inbound/PutawaySheet.test.tsx
git commit -m "feat(warehouse-app): 적치 시트

이동 화면의 대상지 선택(완전일치 자동선택 + 직전 대상지 재사용)을 입고 문맥으로
옮겼다. 팔레트 하나를 한 자리에 통째로 꽂는 경우가 직전 대상지 버튼 한 번씩으로
끝나므로 회차 단위 일괄 적치를 따로 만들지 않는다."
```

---

## Task 7: 예정 목록 화면과 `/inbound` 라우트

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/PendingPlanListScreen.tsx`
- Create: `native/warehouse-app/src/domains/inbound/PendingPlanListScreen.test.tsx`
- Create: `native/warehouse-app/src/app/routes/InboundRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx`

**Interfaces:**
- Consumes: Task 5 의 `usePendingPlans`
- Produces: `<PendingPlanListScreen />` (props 없음). 라우트 `/inbound`.

- [ ] **Step 1: 실패 테스트를 쓴다**

Create `native/warehouse-app/src/domains/inbound/PendingPlanListScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { PendingPlanListScreen } from './PendingPlanListScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const PENDING = {
  totalPendingPlans: 2,
  totalPendingQuantity: 20,
  pendingPlans: [
    {
      planId: 'p-1',
      warehouseId: 'w-1',
      expectedDate: '2026-07-28T00:00:00.000Z',
      purchaseOrder: { id: 'po-1', type: 'domestic', supplier: { id: 'sup-1', name: '르아리컴퍼니' } },
      items: [
        {
          planItemId: 'pi-1',
          skuId: 's1',
          skuName: '코튼셔츠',
          skuCode: 'CT-001',
          expectedQty: 20,
          receivedQty: 0,
          pendingQty: 20,
        },
      ],
      totalQuantity: 20,
      totalPendingQuantity: 20,
    },
    // 전량 입고된 예정: 서버가 plan.status 를 안 닫아서 items 가 빈 채로 계속 내려온다
    {
      planId: 'p-done',
      warehouseId: 'w-1',
      expectedDate: '2026-07-20T00:00:00.000Z',
      purchaseOrder: { id: 'po-2', type: 'domestic', supplier: { id: 'sup-2', name: '다른업체' } },
      items: [],
      totalQuantity: 0,
      totalPendingQuantity: 0,
    },
  ],
};

function renderScreen(prefsSeed?: Record<string, string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      if (o.path.startsWith('/inbound/pending')) return PENDING;
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs(prefsSeed);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: PendingPlanListScreen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>{children}</ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

const SELECTED = { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }) };

describe('PendingPlanListScreen', () => {
  it('창고가 없으면 창고 선택을 요구한다', async () => {
    renderScreen();
    expect(await screen.findByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('예정을 발주처와 잔여수량으로 보여준다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByText('르아리컴퍼니')).toBeInTheDocument();
    expect(screen.getByText('잔여 20')).toBeInTheDocument();
  });

  it('잔여 항목이 없는 예정은 감춘다', async () => {
    renderScreen(SELECTED);
    await waitFor(() => expect(screen.getByText('르아리컴퍼니')).toBeInTheDocument());
    expect(screen.queryByText('다른업체')).not.toBeInTheDocument();
  });

  it('간편입고 진입점을 제공한다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByRole('link', { name: '간편입고' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/PendingPlanListScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./PendingPlanListScreen"`

- [ ] **Step 3: 구현한다**

Create `native/warehouse-app/src/domains/inbound/PendingPlanListScreen.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { usePendingPlans } from './queries';

function formatDate(iso: string | null): string {
  if (!iso) return '예정일 미정';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '예정일 미정';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function PendingPlanListScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const plans = usePendingPlans(warehouseId);

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="입고" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  // 서버는 전량 입고돼도 plan.status 를 닫지 않아서 잔여 항목이 없는 예정이
  // 계속 내려온다. 현장에는 할 일이 없는 카드라 감춘다.
  const open = (plans.data?.pendingPlans ?? []).filter((p) => p.items.length > 0);

  return (
    <div className="space-y-4">
      <ScreenHeader title="입고" backTo="/" />

      <Link
        to="/inbound/quick"
        className="block rounded-lg border border-blue-300 bg-blue-50 p-3 text-center text-sm font-semibold text-blue-700"
      >
        간편입고
      </Link>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">입고 예정</h2>
        {plans.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(plans.error, 'inbound')}
          </p>
        ) : plans.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-gray-500">입고 예정이 없어요. 간편입고로 진행해 주세요.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((plan) => (
              <li key={plan.planId}>
                <Link
                  to="/inbound/plans/$planId"
                  params={{ planId: plan.planId }}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 active:bg-gray-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-800">
                      {plan.purchaseOrder.supplier?.name ?? '발주처 미상'}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {formatDate(plan.expectedDate)} · {plan.items.length}품목
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                    잔여 {plan.totalPendingQuantity}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: 라우트를 붙인다**

Create `native/warehouse-app/src/app/routes/InboundRoute.tsx`:

```tsx
import { PendingPlanListScreen } from '../../domains/inbound/PendingPlanListScreen';

export function InboundRoute() {
  return <PendingPlanListScreen />;
}
```

In `native/warehouse-app/src/app/routeTree.tsx`, add the import next to the others:

```tsx
import { InboundRoute } from './routes/InboundRoute';
```

and replace the `inboundRoute` definition:

```tsx
const inboundRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound',
  component: InboundRoute,
});
```

- [ ] **Step 5: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/PendingPlanListScreen.test.tsx src/app/router.test.tsx`
Expected: PASS — 화면 4건 + 기존 라우터 스펙

- [ ] **Step 6: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/PendingPlanListScreen.tsx \
        native/warehouse-app/src/domains/inbound/PendingPlanListScreen.test.tsx \
        native/warehouse-app/src/app/routes/InboundRoute.tsx \
        native/warehouse-app/src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 입고예정 목록 화면

/inbound 를 허브가 아니라 예정 목록 자체로 둔다 — 예정 우선 동선을 탭 한 번
아낀 형태고, 간편입고는 상단 보조 진입점이다. 서버가 전량 입고된 예정의
plan.status 를 안 닫아서 빈 예정이 계속 내려오므로 잔여 항목 없는 카드는 감춘다."
```

---

## Task 8: 예정 상세 · 수량 시트 · 결과 배너

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/ReceiveSheet.tsx`
- Create: `native/warehouse-app/src/domains/inbound/PlanReceiveScreen.tsx`
- Create: `native/warehouse-app/src/domains/inbound/PlanReceiveScreen.test.tsx`
- Create: `native/warehouse-app/src/app/routes/PlanReceiveRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx`

**Interfaces:**
- Consumes: `usePendingPlans` · `useReceiveFromPlan` · `useCancelInbound` · `scanIncrement` · `useSkuByBarcode` · `PutawaySheet` · `LocationRef`
- Produces: `<ReceiveSheet item={PendingPlanItem} onSubmit={(quantity: number) => void} onCancel={() => void} pending={boolean} scanBump={number} />` / `<PlanReceiveScreen planId={string} />`. 라우트 `/inbound/plans/$planId`.

- [ ] **Step 1: 수량 시트를 만든다**

Create `native/warehouse-app/src/domains/inbound/ReceiveSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '../../core/design/Button';
import { NumberPad } from '../../core/design/NumberPad';
import { cn } from '../../core/design/cn';
import type { PendingPlanItem } from './types';

/**
 * 예정 항목 하나의 실입고 수량을 확정한다.
 *
 * 초기값은 잔여수량이다 — 예정대로 다 온 경우가 가장 흔하므로 바로 [입고] 를
 * 누르면 끝난다. 같은 바코드를 다시 스캔하면 부모가 scanBump 를 올려 주고,
 * 이 시트는 그만큼 수량을 더한다(전수 검수 흐름).
 */
export function ReceiveSheet({
  item,
  scanBump,
  pending,
  onSubmit,
  onCancel,
}: {
  item: PendingPlanItem;
  /** 부모가 스캔마다 더해 주는 누적 증가분. 0 이면 프리필만 쓴다. */
  scanBump: number;
  pending: boolean;
  onSubmit: (quantity: number) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(item.pendingQty);

  // 스캔 누적: 부모가 올린 증가분을 그대로 더한다. 첫 스캔에서 프리필을 밀어내지
  // 않도록, bump 가 0 에서 처음 올라갈 때는 프리필을 버리고 스캔값만 센다.
  useEffect(() => {
    if (scanBump <= 0) return;
    setQty(scanBump);
  }, [scanBump]);

  const over = qty > item.pendingQty;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="입고 수량"
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div>
          <div className="font-semibold text-gray-800">{item.skuName}</div>
          <div className="font-mono text-xs text-gray-500">{item.skuCode}</div>
          <div className="mt-1 text-xs text-gray-500">
            예정 {item.expectedQty} · 입고 {item.receivedQty} · 잔여 {item.pendingQty}
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">입고 수량</h3>
          <div
            className={cn(
              'rounded-lg border p-2 text-center text-2xl font-semibold',
              qty >= 1 && !over
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : over
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-400'
            )}
          >
            {qty}
          </div>
          <NumberPad value={qty} onChange={setQty} />
          {over ? (
            <p className="text-xs text-amber-700">
              잔여({item.pendingQty})보다 {qty - item.pendingQty}개 많아요.
            </p>
          ) : null}
        </section>

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={onCancel}
          >
            취소
          </Button>
          <Button type="button" className="flex-1" disabled={qty < 1 || pending} onClick={() => onSubmit(qty)}>
            입고
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 예정 상세 화면의 실패 테스트를 쓴다**

Create `native/warehouse-app/src/domains/inbound/PlanReceiveScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { PlanReceiveScreen } from './PlanReceiveScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const PENDING = {
  totalPendingPlans: 1,
  totalPendingQuantity: 20,
  pendingPlans: [
    {
      planId: 'p-1',
      warehouseId: 'w-1',
      expectedDate: '2026-07-28T00:00:00.000Z',
      purchaseOrder: { id: 'po-1', type: 'domestic', supplier: { id: 'sup-1', name: '르아리컴퍼니' } },
      items: [
        {
          planItemId: 'pi-1',
          skuId: 's1',
          skuName: '코튼셔츠',
          skuCode: 'CT-001',
          expectedQty: 20,
          receivedQty: 0,
          pendingQty: 20,
        },
      ],
      totalQuantity: 20,
      totalPendingQuantity: 20,
    },
  ],
};

const SKU_BY_BARCODE = [
  {
    id: 's1',
    code: 'CT-001',
    name: '코튼셔츠',
    currentStock: 0,
    safetyStock: 0,
    barcodes: [{ id: 'b1', barcode: '8801', isPrimary: true, packingUnit: null }],
  },
];

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

/** 테스트에서 하드웨어 스캔을 흉내 내는 버튼. ScanEvent 는 at 이 필수다. */
function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      스캔:{code}
    </button>
  );
}

function renderScreen(calls: Call[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/inbound/pending')) return PENDING;
      if (o.path.startsWith('/inventory/skus?barcode=8801')) return SKU_BY_BARCODE;
      if (o.path.startsWith('/inventory/skus?barcode=')) return [];
      if (o.path === '/inbound/plans/receive') return { success: true, receiptId: 'r-1', lineId: 'ln-1' };
      if (o.path === '/inbound/cancel') return { success: true };
      if (o.path.startsWith('/locations/warehouses/')) return { items: [], total: 0 };
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="8801" />
        <ScanButton code="9999" />
        <PlanReceiveScreen planId="p-1" />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>{children}</ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

describe('PlanReceiveScreen', () => {
  it('예정 항목을 예정/입고/잔여로 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText(/잔여 20/)).toBeInTheDocument();
  });

  it('예정에 있는 바코드를 스캔하면 수량 시트가 잔여수량으로 열린다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    expect(sheet).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '입고' })).toBeEnabled();
  });

  it('예정에 없는 바코드는 시트를 열지 않고 경고한다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:9999' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('이 예정에 없는 품목');
    expect(screen.queryByRole('dialog', { name: '입고 수량' })).not.toBeInTheDocument();
  });

  it('입고하면 planItemId 와 수량을 보내고 결과 배너를 남긴다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await user.click(screen.getByRole('button', { name: '입고' }));

    await waitFor(() => {
      const receive = calls.find((c) => c.path === '/inbound/plans/receive');
      expect(receive?.body).toMatchObject({ planItemId: 'pi-1', quantity: 20 });
    });
    expect(await screen.findByText(/입고됨/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치하기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('적치를 마치면 취소 버튼이 사라진다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await user.click(screen.getByRole('button', { name: '입고' }));
    await screen.findByRole('button', { name: '적치하기' });

    await user.click(screen.getByRole('button', { name: '적치하기' }));
    const sheet = await screen.findByRole('dialog', { name: '적치' });
    // 대상지를 못 고른 채 "나중에" 로 닫아도 취소 버튼은 남아야 한다
    await user.click(screen.getByRole('button', { name: '나중에' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('시트가 열린 뒤 같은 바코드를 다시 찍으면 스캔 누적으로 넘어간다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);
    await screen.findByText('코튼셔츠');

    // 첫 스캔: 잔여수량 20 프리필
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    // 둘째 스캔부터는 "세는 중"이다 — 프리필을 버리고 스캔한 개수만 센다
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    await user.click(screen.getByRole('button', { name: '입고' }));
    await waitFor(() => {
      const receive = calls.find((c) => c.path === '/inbound/plans/receive');
      expect(receive?.body).toMatchObject({ quantity: 2 });
    });
  });

  it('시트가 열린 상태에서 다른 품목을 찍으면 누적하지 않고 알린다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await user.click(screen.getByRole('button', { name: '스캔:9999' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // 시트는 그대로 열려 있고 수량도 프리필 그대로다
    expect(screen.getByRole('dialog', { name: '입고 수량' })).toBeInTheDocument();
  });
});
```

`9999` 는 fake client 에서 빈 배열을 돌려주므로 "등록되지 않은 바코드" 경고를 탄다. 예정에 있으나 다른 SKU 인 경우까지 구분해 보고 싶으면 fake client 에 두 번째 SKU 를 더한다.

- [ ] **Step 3: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/PlanReceiveScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./PlanReceiveScreen"`

- [ ] **Step 4: 예정 상세 화면을 구현한다**

Create `native/warehouse-app/src/domains/inbound/PlanReceiveScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { scanIncrement } from './packingUnit';
import { usePendingPlans } from './queries';
import { useCancelInbound, useReceiveFromPlan } from './mutations';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { ReceiveSheet } from './ReceiveSheet';
import type { FreshLine, PendingPlanItem } from './types';

export function PlanReceiveScreen({ planId }: { planId: string }) {
  const { warehouseId, isSet } = useWarehouse();
  const plans = usePendingPlans(warehouseId);
  const lookup = useSkuByBarcode();
  const receive = useReceiveFromPlan();
  const cancel = useCancelInbound();

  const [active, setActive] = useState<PendingPlanItem | null>(null);
  const [scanBump, setScanBump] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshLine | null>(null);
  const [putawayOpen, setPutawayOpen] = useState(false);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [confirming, setConfirming] = useState<{ quantity: number } | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const plan = (plans.data?.pendingPlans ?? []).find((p) => p.planId === planId);
  const items = plan?.items ?? [];

  // 멱등키 회전 — 항목이나 수량이 바뀌면 새 키.
  const keyPayloadRef = useRef({ planItemId: '', qty: 0 });
  useEffect(() => {
    const next = { planItemId: active?.planItemId ?? '', qty: confirming?.quantity ?? 0 };
    const prev = keyPayloadRef.current;
    if (prev.planItemId === next.planItemId && prev.qty === next.qty) return;
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [active, confirming]);

  // 스캔 라우팅: 적치 시트가 열려 있으면 그쪽이 먹고, 수량 시트가 열려 있으면
  // 같은 SKU 만 누적, 목록 상태면 예정 항목을 찾는다.
  useScanner((e) => {
    if (putawayOpen) return;
    lookup.mutate(e.code, {
      onSuccess: (skus) => {
        const sku = skus[0];
        if (!sku) {
          setNotice('등록되지 않은 바코드예요.');
          return;
        }
        const matched = items.find((i) => i.skuId === sku.id);
        if (!matched) {
          setNotice('이 예정에 없는 품목이에요.');
          return;
        }
        const step = scanIncrement(sku, e.code);
        setNotice(null);
        if (active) {
          if (active.skuId !== sku.id) {
            setNotice('다른 품목이에요. 지금 수량을 먼저 확정해 주세요.');
            return;
          }
          setScanBump((n) => n + step);
          return;
        }
        setActive(matched);
        setScanBump(0);
      },
      onError: (err) => setNotice(errorMessage(err, 'barcode')),
    });
  });

  function closeSheet() {
    setActive(null);
    setScanBump(0);
  }

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="예정 입고" backTo="/inbound" />
        <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title={plan?.purchaseOrder.supplier?.name ?? '예정 입고'} backTo="/inbound" />

      {notice ? (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          {notice}
        </p>
      ) : null}

      {fresh ? (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-sm text-green-900">
            {fresh.skuName} {fresh.quantity}개 입고됨
            {fresh.putawayDone ? ' · 적치 완료' : ''}
          </p>
          <div className="flex gap-2">
            {!fresh.putawayDone ? (
              <Button type="button" className="flex-1 py-1.5 text-xs" onClick={() => setPutawayOpen(true)}>
                적치하기
              </Button>
            ) : null}
            {/* 취소는 적치 전에만 가능하다 — 서버가 putawayFromOriginQty > 0 이면 거부한다. */}
            {!fresh.putawayDone ? (
              <Button
                type="button"
                className="flex-1 border border-red-300 bg-white py-1.5 text-xs text-red-700 hover:bg-red-50"
                onClick={() => setCancelConfirm(true)}
              >
                취소
              </Button>
            ) : null}
            <Button
              type="button"
              className="flex-1 border border-gray-300 bg-white py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              onClick={() => setFresh(null)}
            >
              닫기
            </Button>
          </div>
          {cancel.isError ? (
            <p role="alert" className="text-xs text-red-700">
              {errorMessage(cancel.error, 'inbound-cancel')}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">예정 품목</h2>
        {plans.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(plans.error, 'inbound')}
          </p>
        ) : plans.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500">남은 예정 품목이 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.planItemId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{item.skuName}</span>
                  <span className="block font-mono text-xs text-gray-500">{item.skuCode}</span>
                  <span className="block text-xs text-gray-500">
                    예정 {item.expectedQty} · 입고 {item.receivedQty} · 잔여 {item.pendingQty}
                  </span>
                </span>
                <Button
                  className="shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => {
                    setActive(item);
                    setScanBump(0);
                    setNotice(null);
                  }}
                >
                  입고
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active ? (
        <ReceiveSheet
          item={active}
          scanBump={scanBump}
          pending={receive.isPending}
          onCancel={closeSheet}
          onSubmit={(quantity) => setConfirming({ quantity })}
        />
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        title="입고 확인"
        message={
          active && confirming
            ? confirming.quantity > active.pendingQty
              ? `예정 잔여(${active.pendingQty})보다 ${confirming.quantity - active.pendingQty}개 많습니다. ${active.skuName} ${confirming.quantity}개를 입고할까요?`
              : `${active.skuName} ${confirming.quantity}개를 입고합니다.`
            : ''
        }
        confirmLabel="입고"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = active;
          const quantity = confirming?.quantity ?? 0;
          setConfirming(null);
          if (!target || quantity < 1) return;
          receive.mutate(
            { planItemId: target.planItemId, quantity, idempotencyKey },
            {
              onSuccess: (result) => {
                setFresh({
                  lineId: result.lineId,
                  skuId: target.skuId,
                  skuName: target.skuName,
                  skuCode: target.skuCode,
                  quantity,
                  putawayDone: false,
                });
                setIdempotencyKey(crypto.randomUUID());
                closeSheet();
              },
            }
          );
        }}
      />

      <ConfirmDialog
        open={cancelConfirm}
        title="입고 취소"
        message={fresh ? `${fresh.skuName} ${fresh.quantity}개 입고를 전량 취소합니다.` : ''}
        confirmLabel="취소하기"
        danger
        onCancel={() => setCancelConfirm(false)}
        onConfirm={() => {
          setCancelConfirm(false);
          if (!fresh) return;
          cancel.mutate(
            { lineId: fresh.lineId, quantity: fresh.quantity, idempotencyKey: crypto.randomUUID() },
            { onSuccess: () => setFresh(null) }
          );
        }}
      />

      {putawayOpen && fresh ? (
        <PutawaySheet
          line={fresh}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayOpen(false)}
          onDone={(dest) => {
            setLastDest(dest);
            setPutawayOpen(false);
            setFresh((prev) => (prev ? { ...prev, putawayDone: true } : prev));
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: 라우트를 붙인다**

Create `native/warehouse-app/src/app/routes/PlanReceiveRoute.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { PlanReceiveScreen } from '../../domains/inbound/PlanReceiveScreen';

export function PlanReceiveRoute() {
  const { planId } = useParams({ strict: false });
  return <PlanReceiveScreen planId={planId ?? ''} />;
}
```

In `native/warehouse-app/src/app/routeTree.tsx`, add the import and route, and register it in `addChildren`:

```tsx
import { PlanReceiveRoute } from './routes/PlanReceiveRoute';
```

```tsx
const inboundPlanRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound/plans/$planId',
  component: PlanReceiveRoute,
});
```

`addChildren` 배열의 `inboundRoute` 바로 뒤에 `inboundPlanRoute,` 를 넣는다.

- [ ] **Step 6: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/PlanReceiveScreen.test.tsx`
Expected: PASS — 5 tests

- [ ] **Step 7: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/ReceiveSheet.tsx \
        native/warehouse-app/src/domains/inbound/PlanReceiveScreen.tsx \
        native/warehouse-app/src/domains/inbound/PlanReceiveScreen.test.tsx \
        native/warehouse-app/src/app/routes/PlanReceiveRoute.tsx \
        native/warehouse-app/src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 예정 기반 입고 — 항목 스캔·수량 확정·결과 배너

예정에 없는 바코드는 시트를 열지 않고 막는다(다른 발주 물건을 밀어 넣는 사고
차단). 초과는 몇 개 많은지 짚어 확인만 받고 통과시킨다 — 서버가 어차피 허용하고,
현장을 막으면 물건이 안 들어간다. 취소 버튼은 적치 전에만 뜬다."
```

---

## Task 9: 간편입고 화면

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx`
- Create: `native/warehouse-app/src/domains/inbound/QuickInboundScreen.test.tsx`
- Create: `native/warehouse-app/src/app/routes/QuickInboundRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx`

**Interfaces:**
- Consumes: `useSimpleInbound` · `useSkuByBarcode` · `scanIncrement` · `PutawaySheet` · `LocationRef` · `FreshLine`
- Produces: `<QuickInboundScreen />`. 라우트 `/inbound/quick`.

- [ ] **Step 1: 실패 테스트를 쓴다**

Create `native/warehouse-app/src/domains/inbound/QuickInboundScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { QuickInboundScreen } from './QuickInboundScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BOX_SKU = [
  {
    id: 's1',
    code: 'CT-001',
    name: '코튼셔츠',
    currentStock: 0,
    safetyStock: 0,
    barcodes: [
      { id: 'b1', barcode: '8801', isPrimary: true, packingUnit: null },
      { id: 'b2', barcode: '8802', isPrimary: false, packingUnit: 20 },
    ],
  },
];

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

/** ScanEvent 는 at 이 필수다. */
function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      스캔:{code}
    </button>
  );
}

function renderScreen(calls: Call[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/inventory/skus?barcode=880')) return BOX_SKU;
      if (o.path.startsWith('/inventory/skus?barcode=')) return [];
      if (o.path === '/inbound/simple') {
        return { id: 'r-1', lines: [{ id: 'ln-1', skuId: 's1', quantity: 20 }] };
      }
      if (o.path.startsWith('/locations/warehouses/')) return { items: [], total: 0 };
      if (o.path.startsWith('/inbound/pending')) return { totalPendingPlans: 0, totalPendingQuantity: 0, pendingPlans: [] };
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="8801" />
        <ScanButton code="8802" />
        <QuickInboundScreen />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>{children}</ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

describe('QuickInboundScreen', () => {
  it('스캔하면 카트에 담긴다', async () => {
    const user = userEvent.setup();
    renderScreen([]);

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
  });

  it('같은 SKU 를 다시 스캔하면 포장단위만큼 더한다', async () => {
    const user = userEvent.setup();
    renderScreen([]);

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('코튼셔츠');
    // 박스 바코드(20개입)를 찍으면 1 → 21
    await user.click(screen.getByRole('button', { name: '스캔:8802' }));

    await waitFor(() => expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('21'));
  });

  it('등록하면 카트가 적치 대기 목록으로 바뀐다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);

    await user.click(screen.getByRole('button', { name: '스캔:8802' }));
    await screen.findByText('코튼셔츠');
    await user.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() => {
      const simple = calls.find((c) => c.path === '/inbound/simple');
      expect(simple?.body).toMatchObject({
        warehouseId: 'w-1',
        items: [{ skuId: 's1', quantity: 20 }],
      });
    });
    expect(await screen.findByText('적치 대기')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치' })).toBeInTheDocument();
  });

  it('빈 카트로는 등록할 수 없다', async () => {
    renderScreen([]);
    expect(await screen.findByRole('button', { name: '등록' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/QuickInboundScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./QuickInboundScreen"`

- [ ] **Step 3: 구현한다**

Create `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { NumberPad } from '../../core/design/NumberPad';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { scanIncrement } from './packingUnit';
import { useSimpleInbound } from './mutations';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import type { FreshLine } from './types';

interface CartRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
}

export function QuickInboundScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const lookup = useSkuByBarcode();
  const submit = useSimpleInbound();

  const [cart, setCart] = useState<CartRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [staged, setStaged] = useState<FreshLine[]>([]);
  const [putawayFor, setPutawayFor] = useState<FreshLine | null>(null);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // 멱등키 회전 — 카트 내용이 바뀌면 새 키.
  const cartSignature = cart.map((r) => `${r.skuId}:${r.quantity}`).join('|');
  const prevSignatureRef = useRef(cartSignature);
  useEffect(() => {
    if (prevSignatureRef.current === cartSignature) return;
    prevSignatureRef.current = cartSignature;
    setIdempotencyKey(crypto.randomUUID());
  }, [cartSignature]);

  // 적치 대기 목록으로 넘어간 뒤에는 스캔이 카트를 건드리면 안 된다.
  const stagedMode = staged.length > 0;

  useScanner((e) => {
    if (stagedMode || putawayFor) return;
    lookup.mutate(e.code, {
      onSuccess: (skus) => {
        const sku = skus[0];
        if (!sku) {
          setNotice('등록되지 않은 바코드예요.');
          return;
        }
        const step = scanIncrement(sku, e.code);
        setNotice(null);
        setCart((prev) => {
          const found = prev.find((r) => r.skuId === sku.id);
          if (!found) {
            return [...prev, { skuId: sku.id, skuCode: sku.code, skuName: sku.name, quantity: step }];
          }
          return prev.map((r) => (r.skuId === sku.id ? { ...r, quantity: r.quantity + step } : r));
        });
      },
      onError: (err) => setNotice(errorMessage(err, 'barcode')),
    });
  });

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="간편입고" backTo="/inbound" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title="간편입고" backTo="/inbound" />

      {notice ? (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          {notice}
        </p>
      ) : null}

      {stagedMode ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">적치 대기</h2>
          <p className="text-xs text-gray-500">
            입고는 끝났어요. 각 품목을 선반에 꽂으면서 대상 로케이션을 찍어 주세요.
          </p>
          <ul className="space-y-2">
            {staged.map((line) => (
              <li
                key={line.lineId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{line.skuName}</span>
                  <span className="block font-mono text-xs text-gray-500">{line.skuCode}</span>
                </span>
                <span className="text-lg font-semibold text-gray-900">{line.quantity}</span>
                {line.putawayDone ? (
                  <span className="shrink-0 text-xs font-semibold text-green-700">완료</span>
                ) : (
                  <Button className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setPutawayFor(line)}>
                    적치
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            className="w-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={() => {
              setStaged([]);
              setCart([]);
            }}
          >
            새 입고 시작
          </Button>
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">스캔한 품목</h2>
          {cart.length === 0 ? (
            <p className="text-sm text-gray-500">상품 바코드를 스캔해 주세요.</p>
          ) : (
            <ul className="space-y-2">
              {cart.map((row) => (
                <li key={row.skuId} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-800">{row.skuName}</span>
                      <span className="block font-mono text-xs text-gray-500">{row.skuCode}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`${row.skuName} 수량`}
                      className="text-lg font-semibold text-gray-900 underline"
                      onClick={() => setEditing(editing === row.skuId ? null : row.skuId)}
                    >
                      {row.quantity}
                    </button>
                    <button
                      type="button"
                      aria-label={`${row.skuName} 삭제`}
                      className="shrink-0 rounded p-1 text-gray-400 active:bg-gray-100"
                      onClick={() => setCart((prev) => prev.filter((r) => r.skuId !== row.skuId))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {editing === row.skuId ? (
                    <NumberPad
                      value={row.quantity}
                      onChange={(next) =>
                        setCart((prev) =>
                          prev.map((r) => (r.skuId === row.skuId ? { ...r, quantity: next } : r))
                        )
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {submit.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {errorMessage(submit.error, 'inbound')}
            </p>
          ) : null}

          <Button
            type="button"
            className="w-full"
            disabled={cart.length === 0 || cart.some((r) => r.quantity < 1) || submit.isPending}
            onClick={() => {
              if (!warehouseId) return;
              submit.mutate(
                {
                  warehouseId,
                  items: cart.map((r) => ({ skuId: r.skuId, quantity: r.quantity })),
                  idempotencyKey,
                },
                {
                  onSuccess: (result) => {
                    // 응답 lines[] 를 카트 행과 skuId 로 맞춰 이름을 되살린다.
                    setStaged(
                      result.lines.map((line) => {
                        const row = cart.find((r) => r.skuId === line.skuId);
                        return {
                          lineId: line.id,
                          skuId: line.skuId,
                          skuCode: row?.skuCode ?? '',
                          skuName: row?.skuName ?? '',
                          quantity: line.quantity,
                          putawayDone: false,
                        };
                      })
                    );
                    setIdempotencyKey(crypto.randomUUID());
                  },
                }
              );
            }}
          >
            등록
          </Button>
        </section>
      )}

      {putawayFor ? (
        <PutawaySheet
          line={putawayFor}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayFor(null)}
          onDone={(dest) => {
            setLastDest(dest);
            setStaged((prev) =>
              prev.map((l) => (l.lineId === putawayFor.lineId ? { ...l, putawayDone: true } : l))
            );
            setPutawayFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 라우트를 붙인다**

Create `native/warehouse-app/src/app/routes/QuickInboundRoute.tsx`:

```tsx
import { QuickInboundScreen } from '../../domains/inbound/QuickInboundScreen';

export function QuickInboundRoute() {
  return <QuickInboundScreen />;
}
```

In `native/warehouse-app/src/app/routeTree.tsx`, add the import, the route, and register it in `addChildren` after `inboundPlanRoute`:

```tsx
import { QuickInboundRoute } from './routes/QuickInboundRoute';
```

```tsx
const inboundQuickRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inbound/quick',
  component: QuickInboundRoute,
});
```

- [ ] **Step 5: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/QuickInboundScreen.test.tsx`
Expected: PASS — 4 tests

- [ ] **Step 6: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx \
        native/warehouse-app/src/domains/inbound/QuickInboundScreen.test.tsx \
        native/warehouse-app/src/app/routes/QuickInboundRoute.tsx \
        native/warehouse-app/src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 간편입고 — 스캔 카트와 적치 대기 목록

등록 후 화면이 그대로 적치 대기 목록으로 바뀐다. 등록 이후의 스캔은 카트를
건드리지 않는다 — 이미 원장에 박힌 회차를 뒤늦게 부풀리는 사고를 막는다."
```

---

## Task 10: 적치 플레이스홀더와 허브 타일 · 전체 회귀

미적치 라인을 나중에 이어서 처리하는 화면은 후속 Phase 로 미뤘다. 허브에 자리만 잡아 둔다.

**Files:**
- Modify: `native/warehouse-app/src/app/routeTree.tsx`
- Modify: `native/warehouse-app/src/profiles/handheld/HandheldHome.tsx`
- Modify: `native/warehouse-app/src/app/router.handheld.test.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 라우트 `/putaway` (플레이스홀더)

- [ ] **Step 1: 허브 타일과 신규 라우트의 실패 테스트를 쓴다**

`router.handheld.test.tsx` 는 공용 렌더 헬퍼 없이 테스트마다 트리를 직접 조립한다. 그 관례대로 자족적인 테스트를 파일 끝의 `describe('handheld hub navigation', …)` 안에 덧붙인다:

```tsx
  it('허브의 적치 타일이 후속 Phase 플레이스홀더로 간다', async () => {
    const session = stub();
    const user = userEvent.setup();
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === '/inventory/warehouses') return [];
        return { data: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider prefs={createMemoryPrefs()}>
              <ScanProvider>
                <RouterProvider router={createAppRouter(session)} />
              </ScanProvider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );

    const tile = await screen.findByRole('link', { name: /적치/ });
    await act(async () => {
      await user.click(tile);
    });
    expect(await screen.findByRole('heading', { name: '적치 대기' })).toBeInTheDocument();
  });

  it('입고 타일이 예정 목록으로 간다 (플레이스홀더가 아니다)', async () => {
    const session = stub();
    const user = userEvent.setup();
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === '/inventory/warehouses') return [];
        if (opts.path.startsWith('/inbound/pending')) {
          return { totalPendingPlans: 0, totalPendingQuantity: 0, pendingPlans: [] };
        }
        return { data: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider
              prefs={createMemoryPrefs({
                'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
              })}
            >
              <ScanProvider>
                <RouterProvider router={createAppRouter(session)} />
              </ScanProvider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );

    const tile = await screen.findByRole('link', { name: /입고/ });
    await act(async () => {
      await user.click(tile);
    });
    // 플레이스홀더의 "Phase 2에서 구현됩니다" 대신 실제 화면이 떠야 한다
    expect(await screen.findByRole('link', { name: '간편입고' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/app/router.handheld.test.tsx`
Expected: FAIL — 첫 테스트는 '적치' 링크를 못 찾는다. 둘째는 Task 7 이 이미 `/inbound` 를 갈아 끼웠으므로 통과한다(회귀 방지용으로 남긴다).

- [ ] **Step 3: 라우트와 타일을 더한다**

In `native/warehouse-app/src/app/routeTree.tsx`, add the route next to the other placeholders and register it in `addChildren`:

```tsx
const putawayRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/putaway',
  component: () => <PlaceholderScreen title="적치 대기" note="후속 Phase에서 구현됩니다." />,
});
```

In `native/warehouse-app/src/profiles/handheld/HandheldHome.tsx`, add `ClipboardList` to the `lucide-react` import and insert the tile after the 이동 tile:

```tsx
        <Link to="/putaway"><HubTile icon={ClipboardList} label="적치" /></Link>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/app/router.handheld.test.tsx`
Expected: PASS

- [ ] **Step 5: 앱 전체 스위트를 돌린다**

Run: `cd native/warehouse-app && npx vitest run`
Expected: PASS — 기존 211건 + 이번에 더한 30여 건 전부 초록

- [ ] **Step 6: 앱 빌드와 린트**

Run: `cd native/warehouse-app && npm run build && npm run lint`
Expected: 타입 에러 0, 린트 에러 0

- [ ] **Step 7: 백엔드 전체 회귀**

Run: `npx jest --testPathPattern="inventory|inbound|sku-catalog"`
Expected: PASS. 통합 스펙은 `DATABASE_URL` 없으면 skip 되므로, 있으면 붙여서 한 번 더 돌린다.

- [ ] **Step 8: 커밋**

```bash
git add native/warehouse-app/src/app/routeTree.tsx \
        native/warehouse-app/src/profiles/handheld/HandheldHome.tsx \
        native/warehouse-app/src/app/router.handheld.test.tsx
git commit -m "feat(warehouse-app): 적치 대기 플레이스홀더와 허브 타일

미적치 라인을 나중에 이어서 처리하는 화면은 후속 Phase 로 미뤘다. 허브에 자리를
잡아 두면 후속에서 화면만 갈아 끼우면 되고, 현장에도 곧 생긴다는 게 보인다.
그 전까지 남은 물건은 재고 이동 화면으로 처리한다(원장 결과는 같고 MOVE 로 기록)."
```

---

## 남은 수동 검증

계획이 끝나도 자동화로 덮이지 않는 것들이다. 머지 전에 사람이 확인한다.

1. **기기 스모크** — HID 스캐너로 예정 상세에서 상품 바코드, 적치 시트에서 로케이션 바코드가 각각 올바로 라우팅되는지. 시트가 열린 상태에서 엉뚱한 종류를 찍었을 때 조용히 먹히지 않는지.
2. **dev 입고예정 데이터** — `GET /inbound/pending` 이 실제로 행을 돌려주는지. 비어 있으면 admin-web 의 입고예정 생성 탭으로 하나 만들어 스모크한다.
3. **`packingUnit` 소비자** — 응답 타입이 `string` 에서 `number` 로 바뀌었다. storefront·channel-adapter·medusa 가 SKU 응답의 `barcodes[].packingUnit` 을 읽지 않는지 확인한다 (설계 §11 검증 항목 1).
4. **배포 순서** — 스키마 변경이 없으므로 마이그레이션은 없다. 다만 앱은 Task 2 의 `lineId` 반환에 의존하므로 **core 를 먼저 배포**하고 앱을 배포한다.
