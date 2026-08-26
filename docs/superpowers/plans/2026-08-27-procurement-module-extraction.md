# 발주 도메인 `procurement/` 추출 실행 계획 (#724 항목 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주 도메인을 `inventory/procurement/` 로 독립시키고, 971줄 God service 를 3개 서비스 + 3계층으로 쪼개며, 두 예외 규약이 섞인 상태를 `@app/shared` 로 통일하고, 호출자 0인 죽은 라우트를 지운다.

**Architecture:** 순수 파일 이동(Task 1·2) → 독립 정리(Task 3·4·5) → 책임 분할(Task 6·7·8) 순서. 이동과 수정을 한 커밋에 섞지 않는다 — 섞으면 리뷰가 diff 로 무엇이 바뀌었는지 볼 수 없다. 분할의 목표 모양은 `warehouse-transfer` 가 이미 쓰는 3계층(service = 위임만, manager = 검증·쓰기, reader = 조회)이다.

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · Jest · `@app/db`(`DbService.run`) · `@app/shared`(도메인 예외)

**Spec:** `docs/adr/0032-procurement-inbound-transfer-boundaries.md` (결정 4 = 이 계획의 모듈 경계) · 이슈 #724 「3. 항목 5 — 범위」

## Global Constraints

- **API 경로는 한 글자도 바뀌지 않는다.** `@Controller('purchase-orders')` · `@Controller('suppliers')` · `@Controller('supplier-categories')` 를 그대로 옮긴다 → admin-web · Tauri 앱 변경 **0건**.
- **마이그레이션 0건 · 이벤트 계약 변경 0건 · secret/env 변경 0건.**
- **트랜잭션은 ADR-0025.** `this.dbService.run(async (trx) => …, tx)` 단일 러너만 쓴다. per-class `inTx` 헬퍼 금지, 지역 `type Tx = Parameters<…>` 금지. `DbTx` 는 `schema/inventory.schema` 에서만 import.
- **모듈 경계는 ADR-0032 결정 4.** `procurement/` → `inbound/` 호출은 `ensurePlanForPurchaseOrder` · `addInboundPlanItems` **둘뿐**이다. `procurement/` 가 `warehouse-transfer/` 를 import 하면 ADR 위반 — 지금 0곳이고 0곳으로 유지한다.
- 🔴 **잠금 순서 불변식: PO 행 → 라인 행.** 테스트가 없고 주석만이 방어선이다. Task 8 이 이 불변식을 세 클래스에 걸치게 하므로 **새 파일 각각에 규약을 명시적으로 옮긴다.** 어기면 ABBA 교착이 `40P01` → 500 으로 나간다.
- **쿼리 규칙(CLAUDE.md §Inventory Query Rules):** `db.query.*` · `with` relations · `any`/`as` 캐스팅 금지. `trx.select().from().innerJoin().where()` 만.
- **게이트 4개, 매 커밋 초록:**
  ```bash
  npm run type-check                        # 0
  npx jest --maxWorkers=2                   # 0 실패 (--maxWorkers 없으면 OOM)
  cd apps/admin-web && npx tsc --noEmit      # 0 (루트 type-check 는 admin-web 을 제외한다)
  npm run test:core:integration:local        # 8 suite/12 test 는 develop 부터 RED — 새 실패로 오인 금지
  ```
- **PR 본문에 통합 스펙 결과를 붙인다** (#724 진행 규약 4). CI 는 DB 통합 스펙을 skip 한다.

---

## 이동 전 실측 (2026-08-27, 이 계획의 근거)

| 사실 | 값 |
|---|---|
| `PurchaseOrderService` | **971줄**, public 14 (발주 7 · 카트 5 · 재주문 1 · 상태 1), private 6 |
| Nest 예외 throw | **10곳** (`NotFoundException` 5 · `BadRequestException` 5) — 이슈 본문의 "12곳" 은 낡았다 |
| `@app/shared` 예외 throw | 6곳 (같은 파일에 두 규약 공존) |
| `TransactionService` | 생성자에 주입되나 **본문 사용 0회** (죽은 의존) |
| `procurement/` → `inbound/` 호출 | `ensurePlanForPurchaseOrder` · `addInboundPlanItems` **2개** |
| `procurement/` → `warehouse-transfer/` | **0곳** |
| `SuppliersService` 외부 소비자 | **`catalog/operations/export/product-export.service.ts:28`** ← 이슈에 없던 크로스 BC 소비자 |
| `POST /inbound/plans` 클라이언트 | **0** (admin-web 은 `GET plans/items` · `POST plans/receive` 만, Tauri 는 `POST plans/receive` · `GET plans/:planId` 만) |
| `PurchaseOrderService` 를 생성자로 직접 만드는 스펙 | 3개 (단위 1 · 통합 2) |

⚠️ **`POST /inbound/plans/items` 도 클라이언트 호출자가 0으로 보인다.** 이슈가 (d) 로 지목한 것은 `@Post('plans')` 하나뿐이므로 **이 계획은 그것만 지운다.** `plans/items` 는 별도 판단 대상으로 #745 에 남긴다 — 한 PR 에서 죽은 라우트를 두 개 지우면 하나가 사실은 살아 있었을 때 되돌리기가 섞인다.

---

## File Structure

**최종 모양** (`apps/core/src/modules/inventory/procurement/`):

| 파일 | 책임 | 유래 |
|---|---|---|
| `procurement.module.ts` | 모듈 배선 | 신규 |
| `controllers/purchase-order.controller.ts` | HTTP 표면 (295줄, 변경 없음) | `inbound/controllers/` 에서 이동 |
| `services/purchase-order.service.ts` | **포트** — 위임만 | 분할 후 ~120줄 |
| `services/purchase-order.manager.ts` | 검증 · 비즈니스 로직 · 쓰기 (생성 · 라인 실행 · 라인 수정 · 상태) | 분할 |
| `services/purchase-order.reader.ts` | 조회 (목록 · 상세) | 분할 |
| `services/purchase-order-cart.service.ts` | 카트 CRUD 5개 (단일 service — 나눌 실익 없음) | 분할 |
| `services/reorder-suggestion.reader.ts` | 재주문 제안 (읽기 전용, raw SQL 1개) | 분할 |
| `services/purchase-order-status.rules.ts` | 상태 전이 규칙 (26줄, 변경 없음) | 이동 |
| `services/earliest-expected-date.ts` | 헤더 ETA 파생 순수함수 (45줄, 변경 없음) | 이동 |
| `dto/**` | 발주 DTO 4파일 | 이동 |
| `suppliers/**` | 공급처 (이동만 — **계층 정렬은 범위 밖**, #745) | `inventory/suppliers/` 에서 이동 |

**`inbound/` 에 남는 것:** `inbound.service.ts`(1222줄) · `inbound-putaway.reader.ts` · `inbound.controllers.ts` · 입고 DTO. 발주 파일은 하나도 남지 않는다.

---

### Task 1: 발주 파일을 `procurement/` 로 이동 (동작 변경 0)

**Files:**
- Create: `apps/core/src/modules/inventory/procurement/procurement.module.ts`
- Move (git mv, 13개):
  - `inbound/controllers/purchase-order.controller.ts` → `procurement/controllers/`
  - `inbound/services/purchase-order.service.ts` → `procurement/services/`
  - `inbound/services/purchase-order.service.spec.ts` → `procurement/services/`
  - `inbound/services/purchase-order-status.rules.ts` (+`.spec.ts`) → `procurement/services/`
  - `inbound/services/earliest-expected-date.ts` (+`.spec.ts`) → `procurement/services/`
  - `inbound/services/purchase-order-line-execution.integration.spec.ts` → `procurement/services/`
  - `inbound/services/purchase-order-single-plan.integration.spec.ts` → `procurement/services/`
  - `inbound/dto/purchase-order.dto.ts` (+`.spec.ts`) → `procurement/dto/`
  - `inbound/dto/purchase-order/` (2파일) → `procurement/dto/purchase-order/`
- Modify: `inbound/inbound.module.ts` · `inventory.module.ts`

**Interfaces:**
- Consumes: `InboundService.ensurePlanForPurchaseOrder(poId, tx?)` · `InboundService.addInboundPlanItems(dto, tx?)` — `InboundModule` 이 이미 `exports` 한다.
- Produces: `ProcurementModule` (exports `PurchaseOrderService`) · 이후 모든 Task 의 경로 기준.

- [ ] **Step 1: 기준선을 찍는다**

```bash
cd /home/pauseb/workspace/almondyoung-server
npm run type-check 2>&1 | tail -3
npx jest --maxWorkers=2 2>&1 | tail -5
```
Expected: type-check 에러 0 · jest 실패 0. **여기서 빨간 것이 있으면 이동 전에 멈추고 원인을 먼저 판단한다** — 이동 후에 나오면 이동 탓으로 오인한다.

- [ ] **Step 2: 파일을 옮긴다 (`git mv` — 이름 변경 추적 유지)**

```bash
cd apps/core/src/modules/inventory
mkdir -p procurement/controllers procurement/services procurement/dto/purchase-order
git mv inbound/controllers/purchase-order.controller.ts procurement/controllers/
git mv inbound/services/purchase-order.service.ts procurement/services/
git mv inbound/services/purchase-order.service.spec.ts procurement/services/
git mv inbound/services/purchase-order-status.rules.ts procurement/services/
git mv inbound/services/purchase-order-status.rules.spec.ts procurement/services/
git mv inbound/services/earliest-expected-date.ts procurement/services/
git mv inbound/services/earliest-expected-date.spec.ts procurement/services/
git mv inbound/services/purchase-order-line-execution.integration.spec.ts procurement/services/
git mv inbound/services/purchase-order-single-plan.integration.spec.ts procurement/services/
git mv inbound/dto/purchase-order.dto.ts procurement/dto/
git mv inbound/dto/purchase-order.dto.spec.ts procurement/dto/
git mv inbound/dto/purchase-order/purchase-order-response.dto.ts procurement/dto/purchase-order/
git mv inbound/dto/purchase-order/execute-line.dto.ts procurement/dto/purchase-order/
```

- [ ] **Step 3: import 경로를 고친다 — 깊이는 그대로, 이웃만 바뀐다**

`inbound/services/` 와 `procurement/services/` 는 **같은 깊이**라 `../../schema/…` · `../../shared/…` 같은 상위 참조는 **그대로 맞다.** 고칠 것은 형제 참조뿐이다:

| 파일 | 옛 import | 새 import |
|---|---|---|
| `procurement/services/purchase-order.service.ts` | `from './inbound.service'` | `from '../../inbound/services/inbound.service'` |
| 〃 | `from '../dto/purchase-order.dto'` | 그대로 (`procurement/dto/` 로 같이 옮겼다) |
| 〃 | `from '../../suppliers/dto/supplier-response.dto'` | 그대로 (Task 2 가 다시 고친다) |
| `procurement/controllers/purchase-order.controller.ts` | `from '../services/purchase-order.service'` | 그대로 |

`tsc` 가 남은 것을 전부 잡는다 — 손으로 찾지 말고 Step 5 의 에러 목록을 따라간다.

- [ ] **Step 4: 모듈을 만들고 배선한다**

Create `procurement/procurement.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { InboundModule } from '../inbound/inbound.module';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { PurchaseOrderService } from './services/purchase-order.service';

/**
 * 조달(발주) 모듈. 경계는 ADR-0032 가 소유한다.
 *
 * - 발주는 공급사 → 출발 창고 입고까지만 소유하고 거기서 종결한다.
 * - `inbound/` 로 나가는 호출은 `ensurePlanForPurchaseOrder` · `addInboundPlanItems` 둘뿐이다.
 * - `warehouse-transfer/` 를 import 하지 않는다. 선적은 이동 지시서가 독립 소유한다.
 */
@Module({
  imports: [CoreInventoryModule, SharedModule, InboundModule],
  controllers: [PurchaseOrderController],
  providers: [PurchaseOrderService],
  exports: [PurchaseOrderService],
})
export class ProcurementModule {}
```

Modify `inbound/inbound.module.ts` — 발주를 걷어낸다:

```typescript
import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule],
  controllers: [InboundController],
  providers: [InboundService, InboundPutawayReader],
  exports: [InboundService],
})
export class InboundModule {}
```

Modify `inventory.module.ts` — `ProcurementModule` 을 imports 배열에 더한다 (`InboundModule` 바로 뒤).

⚠️ **순환 import 없음 확인:** `ProcurementModule → InboundModule` 단방향이다. `InboundModule` 은 `PurchaseOrderService` 를 쓰지 않는다(export 만 하고 있었고 소비자는 자기 컨트롤러뿐이었다).

- [ ] **Step 5: 게이트 — 이동은 타입체커가 검증한다**

```bash
npm run type-check
npx jest --maxWorkers=2 --testPathPattern='procurement|inbound'
```
Expected: type-check 0. jest 실패 0. **에러가 나오면 전부 경로 에러여야 한다** — 로직 에러가 나오면 `git mv` 이상의 무언가를 건드린 것이다.

- [ ] **Step 6: 부팅이 실제로 되는지 본다 (DI 배선은 tsc 가 못 잡는다)**

```bash
npx nest build core
npm run test:core:integration:local 2>&1 | tail -20
```
Expected: 빌드 성공 · 통합 스펙의 새 실패 0 (기준선 8 suite/12 test 는 그대로).

⚠️ **빌드 성공은 DI 가 배선됐다는 증거가 아니다.** provider 미등록·순환 import 는 **부팅해야** 드러난다. 실제 부팅은 Task 8 이 끝난 뒤 한 번 한다(↓ 마무리 절) — 매 Task 마다 부팅하면 8번 돌리게 되고, 이동 단계에서는 타입체커가 이미 대부분을 잡는다.

- [ ] **Step 7: 커밋**

```bash
git add -A apps/core/src/modules/inventory
git commit -m "refactor(inventory): 발주 파일을 procurement/ 로 이동 (#724 항목 5-a)

파일 이동과 모듈 배선만. 로직 변경 0줄, API 경로 변경 0건.
경계는 ADR-0032 결정 4 가 소유한다."
```

---

### Task 2: `suppliers/` 는 옮기지 않는다 — 실측이 이슈의 전제를 반박했다 ✅ 판정 완료

**Files:**
- Modify: `inventory/suppliers/suppliers.module.ts` (근거 docstring 만)

이슈 (a) 는 `purchase-order` + `suppliers` 를 함께 옮기라고 했다. 착수 시점 실측이 그 전제를 반박했다 — **공급처 소비자가 셋이고 둘이 조달 밖이다:**

| 소비자 | 무엇을 | 방향 |
|---|---|---|
| `procurement/services/purchase-order.service.ts:22` | `SupplierResponseDto` | 같은 도메인 |
| `inbound/services/inbound.service.ts:435` · `inbound/dto/simple-inbound.dto.ts:296` | `SupplierResponseDto.fromDbRow` — 입고 계획 응답에 연계 발주의 공급처를 싣는다 | **역방향** |
| `catalog/operations/export/product-export.module.ts:5` | `SuppliersModule` 자체 (런타임 모듈 의존) | **크로스 BC** |

`procurement/` 아래로 내리면 `inbound → procurement` · `catalog → procurement` 의존이 생겨 **ADR-0032 결정 4 와 어긋난다.** 공급처는 조달의 부품이 아니라 `sku-catalog` · `warehouse` 와 같은 층의 **마스터데이터**이므로 형제가 맞다.

**결정(2026-08-27, 사용자 확인):** 형제로 남긴다. 이동 0건. 근거를 `suppliers.module.ts` docstring 에 박아 다음 사람이 다시 옮기려 들지 않게 한다.

**후속:** ADR-0032 에 이 근거를 한 문단 더한다 (ADR 은 `docs/adr-0032-procurement-boundaries` 브랜치에 있다 — 그 브랜치에서 수정한다).

- [x] **Step 1: 소비자 실측** — `grep -rn "inventory/suppliers\|from '\.\./\.\./suppliers"` 로 위 표 확인
- [x] **Step 2: 근거를 `suppliers.module.ts` docstring 에 기록**
- [x] **Step 3: 커밋** (docs-only, 코드 이동 0)

---

### Task 3: 죽은 라우트 `POST /inbound/plans` 제거

**Files:**
- Modify: `inbound/controllers/inbound.controllers.ts` (`@Post('plans')` 핸들러 `createPlan` 제거, :267–273)
- Test: `inbound/controllers/inbound.controllers.spec.ts` (추가)

**Interfaces:**
- `InboundService.createInboundPlan(dto, tx?)` 은 **남긴다.** `ensurePlanForPurchaseOrder`(`inbound.service.ts:747`)가 이걸 부른다 — 메서드를 지우면 발주 라인 실행이 죽는다.

🔴 **`@Post('plans')` 만 지운다. `@Post('plans/receive')`(핸들러 `receiveFromPlan`)는 반드시 남긴다** — 창고 Tauri 앱의 실입고 경로다. 실수하면 물류 현장이 멈춘다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Append to `inbound/controllers/inbound.controllers.spec.ts`:

```typescript
/**
 * `POST /inbound/plans` 는 호출자가 0이었다 — #739 가 admin-web 「계획 등록」 탭을 지웠고
 * Tauri 앱이 쓰는 것은 `plans/receive`(POST) 와 `plans/:planId`(GET) 로 다른 라우트다.
 * 계획을 만드는 유일한 경로는 발주 라인 실행(`ensurePlanForPurchaseOrder`)이며,
 * 그 경로만이 "한 발주에 계획 하나" 불변식(ADR-0032 결정 1)을 잠근다.
 */
describe('InboundController — 계획 생성 라우트', () => {
  type Handlers = Record<string, unknown>;

  it('POST /inbound/plans 핸들러는 없다 (계획 생성은 발주 라인 실행이 소유한다)', () => {
    expect((InboundController.prototype as Handlers).createPlan).toBeUndefined();
  });

  it('POST /inbound/plans/receive 핸들러는 남아 있다 (창고 실입고 경로)', () => {
    expect(typeof (InboundController.prototype as Handlers).receiveFromPlan).toBe('function');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --maxWorkers=2 --testPathPattern='inbound.controllers.spec'
```
Expected: FAIL — 첫 번째 it 이 `expected undefined, received function`.

- [ ] **Step 3: 핸들러를 지운다**

`inbound/controllers/inbound.controllers.ts` 에서 이 블록을 통째로 삭제한다:

```typescript
  // 예정 CRUD 및 연계
  @Post('plans')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '입고예정 생성' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async createPlan(@Body() dto: CreateInboundPlanDto) {
    return this.inboundService.createInboundPlan(dto);
  }
```

그리고 상단 import 에서 `CreateInboundPlanDto` 를 뺀다 (컨트롤러의 유일한 사용처였다).

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --maxWorkers=2 --testPathPattern='inbound.controllers.spec'
npm run type-check
```
Expected: PASS · 타입 에러 0.

- [ ] **Step 5: 같이 죽는 것을 주석으로 남긴다**

`inbound/services/inbound.service.ts:429` 의 `isLinkedPlan: !!plan.parentPlanId` 위에:

```typescript
        // `parentPlanId` 를 채우던 유일한 경로(`POST /inbound/plans`)가 제거되어
        // 이 값은 이제 항상 false 다. 컬럼·필드는 남긴다(#663·#735 선례 — 코드에서만
        // 걷어내고 DROP 은 별도 PR). admin-web 의 「연계」 배지·컬럼은 영구히 빈다.
```

⚠️ **admin-web 후속:** `use-inbound-pending-table-columns.tsx:69` 의 `isLinkedPlan` 컬럼과 `plan-detail-drawer/index.tsx:102` 의 배지는 영원히 안 그려진다. **이 PR 에서 admin-web 을 건드리지 않는다** — 화면 정리는 별도 판단이다. #745 에 적는다.

- [ ] **Step 6: 커밋**

```bash
git commit -am "refactor(inventory): 죽은 라우트 POST /inbound/plans 제거 (#724 항목 5-d)

호출자 0. 계획 생성의 유일한 경로는 발주 라인 실행이다.
createInboundPlan 메서드와 plans/receive 라우트는 남긴다."
```

---

### Task 4: 예외 규약을 `@app/shared` 로 통일

**Files:**
- Modify: `procurement/services/purchase-order.service.ts` (10곳)
- Test: `procurement/services/purchase-order.service.spec.ts` (추가)

**Interfaces:**
- Produces: 이 파일에서 나가는 예외는 전부 `ApplicationException` 하위. `GlobalExceptionFilter`(`libs/shared/src/filters/http-exception.filter.ts`)가 상태코드를 매핑한다.

🔴 **HTTP 상태코드를 보존한다.** 이 Task 는 규약 통일이지 계약 변경이 아니다:

| 옛 | 새 | 상태 |
|---|---|---|
| `NotFoundException` | `NotFoundError` | 404 → 404 |
| `BadRequestException` | `BadRequestError` | 400 → 400 |

⚠️ **의미상 승격 후보는 손대지 않는다.** `:440` *"Cannot modify purchase order lines after fully received"* 는 의미로는 409(`ConflictError`)지만, 지금 400 이므로 **400 을 유지한다.** 상태코드를 바꾸는 것은 API 계약 변경이라 별도 PR 이다 — #745 에 적는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Append to `procurement/services/purchase-order.service.spec.ts`:

```typescript
import { NotFoundError } from '@app/shared';

/**
 * 이 파일은 `@nestjs/common` 예외와 `@app/shared` 예외를 동시에 던지고 있었다
 * (Nest 10곳 · shared 6곳). CLAUDE.md §Error handling 은 Service 층이 `HttpException`
 * 을 알지 못하게 하라고 못 박는다 — 상태코드 매핑은 GlobalExceptionFilter 의 일이다.
 */
describe('PurchaseOrderService 예외 규약', () => {
  function serviceWithNoRows() {
    const trx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) })),
        })),
      })),
    };
    const dbService = { run: jest.fn((fn: (executor: typeof trx) => unknown) => fn(trx)) };
    return new PurchaseOrderService(dbService as never, {} as never, {} as never);
  }

  it('없는 발주 조회는 @app/shared 의 NotFoundError 를 던진다 (Nest 예외가 아니다)', async () => {
    const service = serviceWithNoRows();
    await expect(service.getPurchaseOrderById('missing-po')).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --maxWorkers=2 --testPathPattern='purchase-order.service.spec'
```
Expected: FAIL — `NotFoundException` 인스턴스가 왔다.

- [ ] **Step 3: 10곳을 바꾼다**

```bash
cd apps/core/src/modules/inventory/procurement/services
sed -i 's/throw new NotFoundException(/throw new NotFoundError(/g; s/throw new BadRequestException(/throw new BadRequestError(/g' purchase-order.service.ts
```

그 다음 import 를 정리한다 — 첫 줄에서 `NotFoundException`, `BadRequestException` 을 뺀다:

```typescript
import { Injectable, Logger } from '@nestjs/common';
```

`@app/shared` import 는 이미 세 개를 다 갖고 있다(`BadRequestError, ConflictError, NotFoundError`) — 그대로 둔다.

- [ ] **Step 4: 남은 Nest 예외가 0인지 확인한다**

```bash
grep -c "NotFoundException\|BadRequestException\|HttpException" purchase-order.service.ts
```
Expected: `0`

- [ ] **Step 5: 게이트**

```bash
cd /home/pauseb/workspace/almondyoung-server
npx jest --maxWorkers=2 --testPathPattern='purchase-order' && npm run type-check
npm run test:core:integration:local 2>&1 | tail -20
```
Expected: PASS · 0 · 통합 새 실패 0.

⚠️ **통합 스펙을 반드시 돌린다.** 통합 스펙이 `rejects.toThrow(BadRequestException)` 처럼 Nest 타입을 기대하고 있으면 여기서만 드러난다.

- [ ] **Step 6: 커밋**

```bash
git commit -am "refactor(inventory): 발주 예외를 @app/shared 로 통일 (#724 항목 5-c)

한 파일이 Nest 예외 10곳 + shared 예외 6곳을 동시에 던지던 상태를 정리.
HTTP 상태코드는 전부 보존한다(404→404, 400→400).
의미상 409 인 :440 은 계약 변경이라 손대지 않았다 — #745."
```

---

### Task 5: 죽은 의존 `TransactionService` 제거

**Files:**
- Modify: `procurement/services/purchase-order.service.ts` (생성자 · import)
- Modify: `procurement/services/purchase-order.service.spec.ts` · `purchase-order-line-execution.integration.spec.ts:68` · `purchase-order-single-plan.integration.spec.ts:71`

**Interfaces:**
- Produces: `new PurchaseOrderService(dbService, inboundService)` — **인자 3개 → 2개.** Task 8 이 이 생성자를 다시 바꾼다.

`TransactionService` 는 생성자에 주입돼 있으나 본문 사용이 **0회**다. 게다가 그 클래스 자체가 ADR-0025 가 금지한 모양(`Parameters<Parameters<…>>` 지역 tx 타입 + per-class 러너)이다. 발주에서 먼저 끊는다.

- [ ] **Step 1: 사용 0회를 확인한다**

```bash
grep -n "transactionService" apps/core/src/modules/inventory/procurement/services/purchase-order.service.ts
```
Expected: 생성자 한 줄(`private readonly transactionService: TransactionService,`)만 나온다.

- [ ] **Step 2: 생성자에서 뺀다**

```typescript
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly inboundService: InboundService,
  ) {}
```

그리고 `import { TransactionService } from '../../shared/services/transaction.service';` 를 지운다.

- [ ] **Step 3: 스펙 3곳의 생성자 호출을 고친다**

```typescript
// purchase-order.service.spec.ts
return new PurchaseOrderService(dbService as never, {} as never);

// purchase-order-line-execution.integration.spec.ts:68
return new PurchaseOrderService(dbService, buildInboundService(trx));

// purchase-order-single-plan.integration.spec.ts:71
return new PurchaseOrderService(dbService, inboundService);
```

각 파일에서 쓰이지 않게 된 `TransactionService` import 도 함께 지운다.

- [ ] **Step 4: 게이트**

```bash
npm run type-check && npx jest --maxWorkers=2 --testPathPattern='purchase-order'
npm run test:core:integration:local 2>&1 | tail -20
```
Expected: 0 / PASS / 새 실패 0.

⚠️ **`TransactionService` 클래스 자체는 지우지 않는다** — 다른 소비자가 있는지는 이 Task 의 범위가 아니다. 발주에서 끊는 것까지가 여기의 일이다.

- [ ] **Step 5: 커밋**

```bash
git commit -am "refactor(inventory): 발주에서 쓰이지 않는 TransactionService 의존 제거 (#724 항목 5-b 선행)

본문 사용 0회. ADR-0025 가 금지한 per-class 러너 모양이기도 하다."
```

---

### Task 6: 카트를 `PurchaseOrderCartService` 로 분리

**Files:**
- Create: `procurement/services/purchase-order-cart.service.ts`
- Modify: `procurement/services/purchase-order.service.ts` (카트 5 + private 1 제거) · `procurement/controllers/purchase-order.controller.ts` · `procurement/procurement.module.ts`

**Interfaces:**
- Produces:
  ```typescript
  class PurchaseOrderCartService {
    addToCart(addDto: AddToCartDto, userId: string, tx?: DbTx): Promise<CartItemResponse>
    updateCartItem(itemId: string, updateDto: UpdateCartItemDto, userId: string, tx?: DbTx): Promise<CartItemResponse>
    removeFromCart(itemId: string, userId: string, tx?: DbTx): Promise<void>
    getCartItems(type: PurchaseOrderType | undefined, userId: string, tx?: DbTx): Promise<CartItemResponse[]>
    clearCart(type: PurchaseOrderType | undefined, userId: string, tx?: DbTx): Promise<void>
  }
  ```
  private `getCartItemById(itemId, userId, tx?)` 도 함께 옮긴다 — 소비자가 카트 메서드뿐이다.

⚠️ **`createPurchaseOrderFromCart` 는 `PurchaseOrderService` 에 남는다.** 그 메서드는 같은 트랜잭션 안에서 `purchaseOrderCart` 를 직접 읽고(:98–107) 발주를 만든다 — 원자성 때문에 쪼갤 수 없다. 결과적으로 카트 테이블을 읽는 곳이 두 파일이 되는데, **이건 의도다.** 새 파일 상단 docstring 에 그 이유를 적는다(리뷰어가 "왜 두 곳에서 카트를 읽나" 를 묻지 않도록).

- [ ] **Step 1: 옮길 경계를 확인한다**

```bash
cd apps/core/src/modules/inventory/procurement/services
sed -n '685,920p' purchase-order.service.ts | grep -n "async \|private "
```
Expected: `addToCart` · `updateCartItem` · `removeFromCart` · `getCartItems` · `getCartItemById`(private) · `clearCart` 6개.

- [ ] **Step 2: 새 파일을 만든다**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { AddToCartDto, UpdateCartItemDto, CartItemResponse, PurchaseOrderType } from '../dto/purchase-order.dto';

/**
 * 발주 카트 CRUD. 단일 service — 검증이 "내 것인가"(`createdBy = userId`) 하나뿐이라
 * manager/reader 로 나눌 실익이 없다.
 *
 * ⚠️ 카트 행을 읽는 곳이 여기 말고 하나 더 있다: `PurchaseOrderService.createPurchaseOrderFromCart`.
 * 그건 카트를 읽어 발주를 만드는 것을 **한 트랜잭션**으로 해야 해서 이리로 옮길 수 없다.
 * 중복이 아니라 원자성 요구다.
 */
@Injectable()
export class PurchaseOrderCartService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  // ↓ purchase-order.service.ts 에서 그대로 옮긴 6개 메서드 (본문 변경 없음)
}
```

메서드 본문은 **한 줄도 고치지 않고** 잘라 붙인다. 로직 변경이 섞이면 리뷰가 이동과 수정을 구분할 수 없다.

- [ ] **Step 3: 컨트롤러와 모듈을 배선한다**

`purchase-order.controller.ts` 생성자에 두 번째 의존을 더하고, 카트 라우트 5개의 위임 대상을 바꾼다:

```typescript
  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly cartService: PurchaseOrderCartService,
  ) {}
```

`procurement.module.ts` 의 `providers` · `exports` 에 `PurchaseOrderCartService` 를 더한다.

- [ ] **Step 4: 게이트**

```bash
cd /home/pauseb/workspace/almondyoung-server
npm run type-check && npx jest --maxWorkers=2 --testPathPattern='purchase-order'
npm run test:core:integration:local 2>&1 | tail -20
```
Expected: 0 / PASS / 새 실패 0.

- [ ] **Step 5: 부팅 확인 (DI 순환·미등록은 tsc 가 못 잡는다)**

```bash
npx nest build core
```
Expected: 성공. 새 provider 를 모듈에 등록하지 않으면 **런타임에만** 터지므로 Task 8 종료 후 실제 부팅 스모크가 필수다(↓ 마무리 절).

- [ ] **Step 6: 커밋**

```bash
git commit -am "refactor(inventory): 발주 카트를 PurchaseOrderCartService 로 분리 (#724 항목 5-b)

메서드 본문 변경 0줄 — 이동과 배선만.
createPurchaseOrderFromCart 는 원자성 때문에 PurchaseOrderService 에 남는다."
```

---

### Task 7: 재주문 제안을 `ReorderSuggestionReader` 로 분리

**Files:**
- Create: `procurement/services/reorder-suggestion.reader.ts`
- Modify: `procurement/services/purchase-order.service.ts` (`getReorderSuggestions` 제거) · 컨트롤러 · 모듈

**Interfaces:**
- Produces: `class ReorderSuggestionReader { getSuggestions(warehouseId?: string, tx?: DbTx): Promise<StockReorderSuggestion[]> }`

읽기 전용 · raw SQL 1개 · 협력자 0개라 가장 깨끗하게 떨어진다. **이 파일이 곧 #743(재고 보충 제안 재설계)의 작업 대상**이 되므로 독립 파일로 두는 값어치가 크다.

- [ ] **Step 1: 새 파일을 만든다**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockReorderSuggestion } from '../dto/purchase-order.dto';

/**
 * 재주문 제안 리더 (읽기 전용).
 *
 * ⚠️ 지금 산식은 임시다 — 안전재고를 리터럴 10 으로, 제안량을 `20 - available` 로 박아둔다.
 * 부천(판매 창고) 관점에서 중국 재고·발주 잔량·이동 중 물량이 셋 다 안 보이는 문제까지
 * 묶어 **#743 이 재설계**한다. `InboundPipelineReader` 가 그 세 구간을 이미 계산하고
 * 있는데 여기서 쓰지 않는 것이 #743 의 핵심이다.
 */
@Injectable()
export class ReorderSuggestionReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  // ↓ getReorderSuggestions 본문을 그대로 옮기고 이름만 getSuggestions 로 바꾼다
  async getSuggestions(warehouseId?: string, tx?: DbTx): Promise<StockReorderSuggestion[]> { /* … */ }
}
```

- [ ] **Step 2: 컨트롤러·모듈 배선**

컨트롤러 `getReorderSuggestions` 핸들러(`@Get('suggestions/reorder')`, :176–195)의 위임을 `this.reorderReader.getSuggestions(warehouseId)` 로 바꾸고, 모듈 `providers` 에 더한다. **라우트 경로·응답 타입은 그대로다.**

- [ ] **Step 3: 게이트**

```bash
npm run type-check && npx jest --maxWorkers=2 --testPathPattern='purchase-order'
```
Expected: 0 / PASS.

- [ ] **Step 4: 커밋**

```bash
git commit -am "refactor(inventory): 재주문 제안을 ReorderSuggestionReader 로 분리 (#724 항목 5-b)

읽기 전용·협력자 0. #743 의 작업 대상이 독립 파일이 된다."
```

---

### Task 8: `PurchaseOrderService` 를 service / manager / reader 3계층으로

**Files:**
- Create: `procurement/services/purchase-order.manager.ts` · `procurement/services/purchase-order.reader.ts`
- Modify: `procurement/services/purchase-order.service.ts` (포트만 남긴다) · 모듈 · 스펙 3개

**Interfaces:**
- Produces:
  ```typescript
  // reader — 조회만
  class PurchaseOrderReader {
    findById(poId: string, tx?: DbTx): Promise<PurchaseOrderResponse>
    findMany(filters: {...}, tx?: DbTx): Promise<PurchaseOrderResponse[]>
  }
  // manager — 검증 · 비즈니스 로직 · 쓰기
  class PurchaseOrderManager {
    create(dto: CreatePurchaseOrderDto, tx?: DbTx): Promise<PurchaseOrderResponse>
    createFromCart(dto: CreatePurchaseOrderFromCartDto, userId: string, tx?: DbTx): Promise<PurchaseOrderResponse>
    updateStatus(poId: string, dto: UpdatePurchaseOrderStatusDto, tx?: DbTx): Promise<PurchaseOrderResponse>
    orderLine(poId: string, skuId: string, dto: OrderPurchaseOrderLineDto, userId: string, tx?: DbTx): Promise<PurchaseOrderResponse>
    markLineUnavailable(poId: string, skuId: string, dto: MarkLineUnavailableDto, userId: string, tx?: DbTx): Promise<PurchaseOrderResponse>
    updateLines(poId: string, dto: UpdatePurchaseOrderLinesDto, tx?: DbTx): Promise<PurchaseOrderResponse>
  }
  // service — 위임만 (warehouse-transfer.service.ts 가 선례)
  ```
  **정확한 시그니처는 옮기기 전 현재 메서드에서 복사한다** — 위 목록은 배치를 정하는 것이지 시그니처를 새로 만드는 게 아니다.

🔴 **잠금 불변식을 세 파일에 옮긴다.** `lockPurchaseOrderForLineExecution` 은 manager 로 간다. **manager · service · reader 각 파일 상단 docstring 에** 다음을 적는다:

```
잠금 순서 불변식: **PO 행 → 라인 행.** 이 파일에서 발주에 쓰기를 추가하는 편집은
PO 행을 먼저 잠근다. 순서가 뒤집히면 두 경로가 만나는 순간 Postgres 가 ABBA 교착으로
한쪽을 40P01 로 죽이고, 그건 도메인 예외가 아니라 드라이버 에러라 409 가 아니라 500 으로 나간다.
```

- [ ] **Step 1: private 6개의 귀속을 정한다**

| private | 귀속 | 왜 |
|---|---|---|
| `executeLineOrder` | manager | 쓰기 + `inboundService` 호출 |
| `lockPurchaseOrderForLineExecution` | manager | 잠금 = 쓰기 경로 |
| `loadRequestedLine` | manager | 라인 실행 전용 검증 |
| `refreshHeaderStatus` | manager | 헤더 상태 파생 쓰기 |
| `getSupplierDefaultWarehouseId` | manager | 생성 검증 |
| `getCartItemById` | (Task 6 에서 이미 이동됨) | — |

- [ ] **Step 2: reader 를 먼저 뽑는다 (의존이 가장 얕다)**

`getPurchaseOrderById`(:507–583) · `getPurchaseOrders`(:584–684)를 `purchase-order.reader.ts` 로 옮긴다. 둘 다 `dbService` + `purchaseOrderExpectedArrival` 만 쓴다.

- [ ] **Step 3: 게이트 — reader 단계에서 한 번 끊는다**

```bash
npm run type-check && npx jest --maxWorkers=2 --testPathPattern='purchase-order'
```
Expected: 0 / PASS. **여기서 커밋한다** — manager 까지 한 커밋에 넣으면 되돌릴 단위가 너무 커진다.

```bash
git commit -am "refactor(inventory): 발주 조회를 PurchaseOrderReader 로 분리 (#724 항목 5-b)"
```

- [ ] **Step 4: manager 를 뽑는다**

나머지 쓰기 6 public + private 5 를 `purchase-order.manager.ts` 로 옮긴다. 잠금 불변식 docstring 을 파일 상단에 넣는다(위 문구 그대로).

- [ ] **Step 5: service 를 포트로 줄인다**

`warehouse-transfer.service.ts` 와 같은 모양 — 위임만:

```typescript
/**
 * 발주 포트. 위임만 한다 — 검증·비즈니스 로직은 Manager, 조회는 Reader 가 소유한다.
 * 경계는 ADR-0032 가 소유한다: 발주는 출발 창고 입고까지만 소유하고 거기서 종결한다.
 *
 * 잠금 순서 불변식: PO 행 → 라인 행. (위 문구 그대로)
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly manager: PurchaseOrderManager,
    private readonly reader: PurchaseOrderReader,
  ) {}

  createPurchaseOrder(dto: CreatePurchaseOrderDto, tx?: DbTx) {
    return this.manager.create(dto, tx);
  }

  getPurchaseOrderById(poId: string, tx?: DbTx) {
    return this.reader.findById(poId, tx);
  }

  // … 나머지 위임
}
```

- [ ] **Step 6: 스펙 3개의 생성자를 고친다**

통합 스펙 2개는 `new PurchaseOrderService(dbService, inboundService)` 대신 manager/reader 를 손으로 조립한다:

```typescript
function buildService(trx: DbTx): PurchaseOrderService {
  const dbService = makeDbService(trx);
  const inboundService = buildInboundService(trx);
  return new PurchaseOrderService(
    new PurchaseOrderManager(dbService, inboundService),
    new PurchaseOrderReader(dbService),
  );
}
```

단위 스펙 `purchase-order.service.spec.ts` 는 **`PurchaseOrderManager` 를 직접 테스트하도록 바꾼다** — 검증이 manager 로 갔으므로 포트를 통해 테스트할 이유가 없다.

- [ ] **Step 7: 전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit && cd ../..
npm run test:core:integration:local 2>&1 | tail -25
```
Expected: 0 / 0 실패 / 0 / 통합 새 실패 0.

- [ ] **Step 8: 커밋**

```bash
git commit -am "refactor(inventory): 발주 쓰기를 PurchaseOrderManager 로 분리, 서비스는 포트로 (#724 항목 5-b)

warehouse-transfer 3계층 선례를 따른다.
잠금 불변식(PO 행 → 라인 행)을 세 파일 docstring 에 명시적으로 옮겼다."
```

---

## 마무리 — 코드 게이트로는 못 잡는 것

이 도메인은 **"게이트 초록"이 완료 근거가 못 된다** (#724 가 낸 결함 3건이 전부 게이트 사각지대였고, 그중 하나는 리뷰 4번이 놓쳤다). 커밋 후 반드시:

- [ ] **실제 부팅.** `npm run start:main:dev` — DI 미등록·순환은 런타임에만 터진다. `nest start --watch` 는 실제로 안 붙으니 코드를 고쳤으면 프로세스를 직접 재시작한다.
- [ ] **라우트 5개를 실제로 호출한다.** core 는 **global prefix 가 없고**(`setGlobalPrefix` 0곳) 로컬 `PORT=3100` 이다 — `localhost:3000/api/…` 가 아니라 `localhost:3100/…` 다. 토큰은 `npm run generate:token`(#746 이 `iss` 를 빼도록 고쳤다):
  ```bash
  T=$(npm run -s generate:token)
  curl -s -H "Authorization: Bearer $T" localhost:3100/purchase-orders | head -c 400
  curl -s -H "Authorization: Bearer $T" localhost:3100/purchase-orders/cart | head -c 200
  curl -s -H "Authorization: Bearer $T" localhost:3100/purchase-orders/suggestions/reorder | head -c 200
  curl -s -H "Authorization: Bearer $T" localhost:3100/suppliers | head -c 200
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $T" localhost:3100/inbound/plans
  ```
  마지막 줄이 **404** 가 아니면 Task 3 이 덜 된 것이다. 앞의 네 줄이 401 이면 라우트가 아니라 토큰 문제다.
- [ ] **admin-web 발주 목록·상세 드로어를 브라우저로 연다.** 쿠키를 먼저 심어야 한다: ① `localhost:8002/api/proxy/api/purchase-orders` 로 이동 → ② `document.cookie='accessToken=<토큰>; path=/'` → ③ 앱 URL.
- [ ] **PR 본문에 통합 스펙 결과를 붙인다** (#724 진행 규약 4).
- [ ] **이슈 #724 현황판의 항목 5 를 🟩 로, 작업 순서 3 을 완료로 갱신한다** (진행 규약 5).

## 범위 밖 — #745 에 적을 것

- `suppliers` 의 §1.7 계층 정렬 (이슈 (e) 가 명시적으로 뺐다)
- `POST /inbound/plans/items` 의 생사 판정 (호출자 0으로 보이나 이 PR 은 라우트를 하나만 지운다)
- `:440` 의 400 → 409 승격 (API 계약 변경)
- admin-web 의 영구히 빈 `isLinkedPlan` 컬럼·배지 정리
- `inbound_plans.parent_plan_id` 컬럼 DROP (#663·#735 선례 — 코드 제거와 별 PR)

---

## 실행 결과 (2026-08-27)

8 태스크 전부 실행. 커밋 9개 (`b54bbe91d` 계획 → `fcca7cf27` 3계층).

| Task | 결과 | 계획과 달라진 점 |
|---|---|---|
| 1 이동 | 🟩 | **공유 순수 헬퍼 2개가 튀어나왔다** — `earliest-expected-date.ts`(inbound.service:428 이 사용) · `calendar-date.validator.ts`(simple-inbound.dto 가 사용). procurement 에 두면 `inbound → procurement` 역방향이 되어 `shared/dates/` · `shared/dto/` 로 보냈다 |
| 2 suppliers 이동 | ⬜ **하지 않음** | 실측이 전제를 반박 — 소비자 3개 중 2개가 조달 밖(inbound · catalog). 형제로 남기고 근거를 `suppliers.module.ts` docstring 에 기록 |
| 3 죽은 라우트 | 🟩 | **`inventory-scope-coverage.spec.ts` 가 잡았다** — 라우트 배정표가 stale 이 됐다. #551 의 가드가 의도대로 작동 |
| 4 예외 통일 | 🟩 | 실측 10곳(이슈의 "12곳" 은 낡음). `updatePurchaseOrderLines` 의 "예외 타입이 달라 helper 재사용 안 한다" 주석도 정정 |
| 5 TransactionService | 🟩 | — |
| 6 카트 | 🟩 | — |
| 7 재주문 제안 | 🟩 | — |
| 8 3계층 | 🟩 | `findMany` 시그니처가 **위치 인자**였다(계획은 filters 객체로 잘못 적었다). 단위 스펙은 `purchase-order.manager.spec.ts` 로 개명 후 Manager/Reader 를 직접 겨눔 |

**줄 수:** 971줄 God service → `service 103` · `manager 515` · `reader 204` · `cart 264` · `reorder 76`.

**게이트 (전부 초록):** `type-check` 0 · admin-web `tsc` 0 · `eslint` 0 · `jest` 489 suite/4213 test · `nest build core` 성공 · 통합 8 suite/12 test 실패(=develop 기준선, 새 실패 0)이며 발주 통합 스펙 2개 PASS.

**DI 그래프 검증 완료.** `nest build` 가 못 잡는 provider 미등록·순환 의존을 별도로 확인했다 — `Test.createTestingModule({ imports: [AppModule] }).compile()` 로 전체 그래프를 세우고 6개 provider + 컨트롤러 핸들러 5개를 해결시켰다. 전부 통과.

**라우트 표면 불변 확인.** `inventory-scope-coverage.spec.ts` 가 "표와 코드의 라우트 집합이 정확히 일치" 를 통과한다 — 의도적으로 지운 `POST /inbound/plans` 하나 외에 라우트가 늘거나 준 것이 없다는 뜻이다.

### 부팅 스모크 🟩 완료 (2026-08-27, dev DB `dev_core`)

옛 프로세스를 죽이고 새 빌드로 재부팅 → `Nest application successfully started`.

**라우트 상태코드**

| 라우트 | 결과 |
|---|---|
| `GET /purchase-orders` · `/cart` · `/suggestions/reorder` · `/suppliers` | **200** |
| `POST /inbound/plans` | **404** ✅ (죽은 라우트 제거 확인) |
| `POST /inbound/plans/receive` | **400** ✅ (살아 있고 빈 본문을 거부) |

**읽기 경로 (Reader)** — 목록 2건, 상세에 라인·공급처·파생 ETA 정상. 헤더 `expectedArrival` 이 `ordered` 라인 ETA 와 일치.

**쓰기 경로 (Manager + Cart)** — 카트 추가 → 조회 → `clearCart`(204) 정상. 발주 생성 후 라인 실행(요청 7 → 실발주 5) 결과:

```
status: confirmed          ← refreshHeaderStatus 파생
expectedArrival: 2026-12-01 ← purchaseOrderExpectedArrival 파생 (ordered 라인만)
line: status=ordered qty=7 orderedQty=5
```

**ADR-0032 결정 1 을 DB 로 확인** — 그 발주의 입고 계획이 정확히 **1행**이고:

```
plan_type=source · requires_transfer=t · warehouse=중국 물류창고 · items=1 · qty=5
```

출발 창고(중국)에 계획 1개, 수량은 요청 7 이 아니라 **실발주 5**. `procurement → inbound` 포트(`ensurePlanForPurchaseOrder` · `addInboundPlanItems`)가 새 모듈 경계를 넘어 정상 동작한다.

**곁다리 발견 2건 (내 변경과 무관, 기존 결함)**

- 🟠 `npm run generate:token` 은 **파이프 입력으로 못 돌린다.** readline 을 지연 생성하면서 파이프 버퍼 전체를 한 번에 삼켜 두 번째 질문부터 영원히 대기한다(프롬프트에서 멈추고 exit 0). #746 이 `iss` 는 고쳤지만 스크립트는 여전히 TTY 전용이다 — 자동화·CI 에서 못 쓴다.
- 🟠 `GET /inbound/pending?warehouseId=x` → **500.** 그 쿼리 파라미터에 UUID 검증이 없어 Postgres 캐스팅 에러가 그대로 500 으로 나간다. 정상 UUID 로는 200.

### admin-web 브라우저 확인 🟩 (2026-08-27, 부분)

쿠키를 심고(`/api/proxy/api/purchase-orders` → `document.cookie='accessToken=…'` → 앱 URL) `/inventory/purchase-orders` 를 열었다.

**목록** — 3건 렌더. API 로 만든 발주가 그대로 보인다:

```
1edd26f3… | 국내 | 개발용 공급처 | 확정됨 | 1/1 실행 | 2026. 12. 1.
d4af550c… | 국내 | 개발용 공급처 | 확정됨 | 2/2 실행 | 2026. 8. 1.
160749c9… | 해외 | 개발용 공급처 | 확정됨 | 1/1 실행 | 2026. 8. 1.
```

「라인 진행」·「입고 예정일」(파생 ETA) 컬럼이 정확하다.

**상세 드로어** — 기본 정보(발주번호·공급처·유형·운영 상태·입고 예정일 2026-12-01) + 발주 라인:

```
개발용 상품 0001  [발주됨]
요청 7 → 실발주 5   도착예정 2026-12-01
2026. 8. 27. 오전 6:16:21 · 처리자 26f48044…
```

라인 생명주기(요청↔실발주·ETA·시각·처리자)가 화면까지 온전히 도달한다. 이 발주는 `requested === 0` 이라 **「라인 수정」 버튼이 없고**, 그게 문서화한 조건(`canEditLines = canExecuteLines(status) && progress.requested > 0`)과 정확히 일치한다.

### 🔴 로컬 환경 한계로 못 본 것 — admin-web 은 user-service 없이 오래 못 버틴다

`created` 상태(미실행 라인 2개) 발주를 만들어 「라인 수정」 버튼이 **나타나는** 쪽을 보려 했으나 그 뒤로 테이블이 스켈레톤에서 멈췄다.

**원인은 발주가 아니다.** 페이지가 `RouteGuard requireRole={['admin','master']}` 로 감싸여 있고(`page.tsx:7`), 그 역할은 **user-service** 에서 온다. 콘솔이 `/proxy/users/users/me` · `users/roles` · `admin/users` 를 무한 재시도한다 — 로컬에 user-service 가 없다(`USER_SERVICE_URL=http://localhost:3000` 인데 그 포트는 비어 있고 `apps/user-service/.env` 자체가 없다). 같은 시점에 페이지 안에서 `fetch('/api/proxy/api/purchase-orders')` 는 **200 + 정상 JSON** 을 준다.

첫 로드는 성공했다(그래서 위 목록·드로어를 봤다) — 브라우저에 남아 있던 역할 캐시가 만료되기 전이었던 것으로 보인다.

**다음 사람에게:** admin-web 을 로컬에서 오래 보려면 user-service 를 같이 띄우거나(`apps/user-service/.env` 필요) 라이브 user-service 를 가리켜야 한다. `BYPASS_AUTH=true` 는 `middleware.ts` 의 페이지 가드만 우회하고 **`RouteGuard` 는 못 우회한다.**

### 남은 수동 검증

- ⛔ `created` 발주에서 「라인 수정」 버튼이 **나타나는** 쪽 확인 (위 환경 한계). 이 조건은 #739 가 만든 것이고 항목 5 가 건드리지 않았다.
