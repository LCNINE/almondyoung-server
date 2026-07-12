# drop_ship 예약/이전 주입 가드 (작업 11b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** drop_ship FO 의 "자사 재고 예약 없음" 불변식을 예약 **생성 경로**(`reserve`·`transferReservation` 주입)에서 강제하고, admin 광고·FE 버튼을 그 계약에 맞춘다.

**Architecture:** 서버 facade 에 THROW 가드(본체) + 후보조회 필터(UX 방어선) 추가 → `computeAdminAvailableActions` 광고에서 drop_ship 의 reserve/transfer 제외(unreserve 유지) → admin-web surface #1 인라인 예약 버튼을 서버 광고 기반으로 전환. 잔존 예약은 방치(terminal 도달 시 기존 sweep 이 heal). 스키마 무변경.

**Tech Stack:** NestJS · Drizzle ORM(postgres.js) · Jest(유닛 mock + rollback 통합) · Next.js(admin-web) · TypeScript.

**설계 문서:** `docs/superpowers/specs/2026-07-12-drop-ship-reserve-guard-design.md`

## Global Constraints

- 예외 타입: facade·service 는 **Nest `ConflictException`/`BadRequestException`** 사용(파일 기존 관행 — `@app/shared` 도메인 에러 이관은 P3-1 별건, 손대지 않음).
- `fulfillmentMode` 는 **nullable**(`string | null`). `null`/`'in_house'` = 자사(예약 허용), `'drop_ship'` = 타사(예약 금지). `=== 'drop_ship'` 로만 판정 — null 은 자사.
- 잔존 데이터 = **방치**(정리 코드 없음, terminal sweep 의존). 일회 정리·대사잡 확장은 비목표.
- 광고 규칙: drop_ship non-terminal → `reserve`·`transferReservation` **제외**, `unreserve` **유지**.
- `unreserve` 는 facade 에서 drop_ship 가드하지 않음(예약을 줄이는 방향이라 불변식과 정합, 수동 정리 escape hatch).
- 검증(공통 규약): `nest build core` exit 0 · arch 경계 spec PASS · 변경 파일 **신규** eslint 0(repo 전역 lint 는 상시 debt — 전역 판정 금지) · admin-web `type-check` 신규 0. 스키마 무변경이라 dev DB ⏸ 없음.
- 브랜치: `feat/drop-ship-reserve-guard`(이미 생성, spec 커밋 `216c098ea` 위).

## File Structure

- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts` — reserve/transfer 가드 + 후보 필터.
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:1083-1114` — `computeAdminAvailableActions` 광고.
- Modify: `apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx:220` — surface #1 게이트.
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.spec.ts` — reserve/transfer 가드 유닛.
- Test: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts` — 광고 유닛.
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.integration.spec.ts` — getTransferCandidates 필터(deferred, DB 없으면 auto-skip).

**단일 spec 실행:** `npx jest --testPathPattern="<파일명 without .ts>"`

---

### Task 1: facade `reserve` drop_ship 가드

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts` (reserve, 현재 `:68-73` 사이 삽입)
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.spec.ts` (`makeFacade` 옵션 확장 + `describe('reserve')` 에 케이스 추가)

**Interfaces:**
- Consumes: `makeFacade(options)` 기존 헬퍼, 반환 `{ facade, tx, unified, ... }`.
- Produces: `makeFacade` 에 `foFulfillmentMode?: string | null` 옵션(Task 2 도 사용). `fo.fulfillmentMode` 셋.

- [ ] **Step 1: mock 에 `foFulfillmentMode` 옵션 추가**

`fulfillment-reservations.facade.spec.ts` 의 `makeFacade` 옵션 타입(현재 `:14-25`)에 필드 추가:

```typescript
      firstItemFulfillmentOrderId?: string;
      foFulfillmentMode?: string | null;
      reservations?: Array<{ id: string; skuId: string; quantity: number }>;
```

같은 함수의 `fo` 객체(현재 `:28-34`)에 `fulfillmentMode` 추가:

```typescript
    const fo = {
      id: fulfillmentOrderId,
      status: options.foStatus ?? 'unfulfillable',
      fulfillmentMode: options.foFulfillmentMode ?? null,
      warehouseId,
      totalReservedQty: 1,
      reservationFailureReason: 'RESERVATION_FAILED',
      reservationFailureDetails: { failedItems: [{ skuId }] },
    };
```

- [ ] **Step 2: 실패하는 테스트 작성**

`describe('reserve', ...)` 블록 안(예: over-reserve 케이스 뒤, `:250` 근처)에 추가:

```typescript
    it('drop_ship FO에 reserve 요청하면 ConflictException을 던진다 (타사 재고 불변식)', async () => {
      const { facade, tx, unified } = makeFacade({ foFulfillmentMode: 'drop_ship' });

      await expect(
        facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx),
      ).rejects.toThrow(ConflictException);
      expect(unified.reserveStock).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx jest --testPathPattern="fulfillment-reservations.facade.spec"`
Expected: FAIL — 가드 부재라 `reserveStock` 이 호출되고(예약 성공) `ConflictException` 이 안 던져짐.

- [ ] **Step 4: 가드 구현**

`fulfillment-reservations.facade.ts` 의 `reserve` 에서 terminal 체크(현재 `:68-70`) **직후**, warehouseId 체크(`:71`) **앞**에 삽입:

```typescript
      if (this.TERMINAL_STATUSES.includes(fo.status as never)) {
        throw new ConflictException(`Cannot reserve for FO ${fo.id} in status '${fo.status}'`);
      }
      // W6(직배 별도 엔티티 추출) 전까지의 방어선: drop_ship 은 타사 재고라
      // 자사 예약을 생성하지 않는다. warehouseId 검사보다 앞에 두어 명확한 사유를 반환.
      if (fo.fulfillmentMode === 'drop_ship') {
        throw new ConflictException(
          `Cannot reserve for drop_ship FO ${fo.id}: 타사 재고라 자사 예약을 생성하지 않습니다`,
        );
      }
      if (!fo.warehouseId) {
        throw new BadRequestException(`FO ${fo.id} has no warehouseId`);
      }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern="fulfillment-reservations.facade.spec"`
Expected: PASS — 신규 케이스 포함 전량 통과(기존 51 + 1).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts \
        apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.spec.ts
git commit -m "feat(core): drop_ship FO reserve 가드 — 자사 예약 생성 차단 (작업 11b)"
```

---

### Task 2: facade `transferReservation` drop_ship 가드 (from·to 양방향)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts` (transferReservation, 현재 `:307-311` 사이 삽입)
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.spec.ts` (`makeTransferTx` opts 타입 확장 + `describe('transferReservation')` 케이스 추가)

**Interfaces:**
- Consumes: `makeTransferTx(opts)` 헬퍼, `opts.fromFo`/`opts.toFo` 는 select mock 이 그대로 반환(가드가 `fromFo.fulfillmentMode`/`toFo.fulfillmentMode` 를 읽음).
- Produces: `makeTransferTx` opts 의 `fromFo`/`toFo` 타입에 `fulfillmentMode?: string | null`.

- [ ] **Step 1: `makeTransferTx` opts 타입 확장**

`makeTransferTx` 의 opts 타입(현재 `:311-312`)에서 `fromFo`·`toFo` 에 필드 추가:

```typescript
      fromFo: { id: string; status: string; warehouseId: string; totalReservedQty: number; fulfillmentMode?: string | null };
      toFo: { id: string; status: string; warehouseId: string; totalReservedQty: number; fulfillmentMode?: string | null };
```

(mock 본문은 `opts.fromFo`/`opts.toFo` 를 그대로 rows 로 반환하므로 추가 변경 불필요.)

- [ ] **Step 2: 실패하는 테스트 작성**

`describe('transferReservation', ...)` 안(성공 케이스 근처)에 2건 추가:

```typescript
    it('fromFo가 drop_ship이면 예약 이전이 ConflictException으로 차단된다 (타사 재고 불변식)', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2, fulfillmentMode: 'drop_ship' },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(ConflictException);
      expect(captured.insertedReservations).toHaveLength(0);
      expect(captured.reservationUpdates).toHaveLength(0);
    });

    it('toFo가 drop_ship이면 예약 주입이 ConflictException으로 차단된다 (타사 재고 불변식)', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0, fulfillmentMode: 'drop_ship' },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(ConflictException);
      expect(captured.insertedReservations).toHaveLength(0);
      expect(captured.reservationUpdates).toHaveLength(0);
    });
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx jest --testPathPattern="fulfillment-reservations.facade.spec"`
Expected: FAIL — 가드 부재라 이전이 진행되어 `insertedReservations` 가 1이 되고 ConflictException 미발생.

- [ ] **Step 4: 가드 구현**

`transferReservation` 의 SKU 일치 검사(현재 `:307-309`) **직후**, warehouseId 검사(`:311`) **앞**에 삽입:

```typescript
      if (from.skuId !== to.skuId) {
        throw new BadRequestException('출처와 대상 FOI의 SKU가 다릅니다.');
      }

      // W6 방어선: drop_ship 은 타사 재고 — 예약을 이전으로 주입/유출할 수 없다(source·target 양방향 차단).
      if (fromFo.fulfillmentMode === 'drop_ship' || toFo.fulfillmentMode === 'drop_ship') {
        throw new ConflictException('drop_ship 출고주문은 예약 이전 대상이 될 수 없습니다 (타사 재고).');
      }

      if (!fromFo.warehouseId || !toFo.warehouseId) {
        throw new BadRequestException('FO에 창고가 지정되어 있지 않습니다.');
      }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern="fulfillment-reservations.facade.spec"`
Expected: PASS — 전량 통과(기존 + Task1 1건 + Task2 2건).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts \
        apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.spec.ts
git commit -m "feat(core): drop_ship FO 예약 이전 주입 가드 (from·to 양방향, 작업 11b)"
```

---

### Task 3: `getTransferCandidates` NULL-safe drop_ship 후보 제외

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts` (drizzle import `:4` + `getTransferCandidates` WHERE `:476-484`)
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.integration.spec.ts` (deferred — DB 없으면 auto-skip)

**Interfaces:**
- Consumes: 통합 spec 의 `createFixture(tx)`(fromFo=ready·reservedQty=2, toFo=null-mode·same sku/wh), `inRollbackTx`, `facade.getTransferCandidates`.
- Produces: 없음(내부 필터).

**Note:** 유닛 mock 은 WHERE 를 무시하므로 이 필터는 유닛 검증 불가 — 실 안전망은 Task 2 의 transfer THROW(유닛). 후보 필터는 UX 방어선이며 SQL 정합은 아래 deferred 통합 spec 으로 검증(dev DB 시 실행).

- [ ] **Step 1: drizzle import 확장**

`fulfillment-reservations.facade.ts:4`:

```typescript
import { eq, and, asc, gt, ne, inArray, isNull, or } from 'drizzle-orm';
```

- [ ] **Step 2: WHERE 에 NULL-safe drop_ship 제외 추가**

`getTransferCandidates` 의 후보 쿼리 WHERE(현재 `:476-484`)에 조건 1개 추가:

```typescript
      .where(
        and(
          ne(wmsTables.fulfillmentOrderItems.id, from.id),
          eq(wmsTables.fulfillmentOrderItems.skuId, from.skuId),
          eq(wmsTables.fulfillmentOrders.warehouseId, fromFo.warehouseId),
          inArray(wmsTables.fulfillmentOrders.status, [...this.RESERVATION_TRANSFER_ALLOWED_STATUS_LIST]),
          gt(wmsTables.fulfillmentOrderItems.qty, wmsTables.fulfillmentOrderItems.reservedQty),
          // W6 방어선: drop_ship 후보 제외. fulfillmentMode 는 nullable(=in_house 기본)이라
          // 단순 ne 는 null-mode 후보를 잘못 제외 → NULL-safe(or isNull)로 in_house 보존.
          or(
            isNull(wmsTables.fulfillmentOrders.fulfillmentMode),
            ne(wmsTables.fulfillmentOrders.fulfillmentMode, 'drop_ship'),
          ),
        ),
      )
```

- [ ] **Step 3: deferred 통합 테스트 추가**

`fulfillment-reservations.facade.integration.spec.ts` 의 마지막 `it(...)` 뒤(닫는 `});` 앞)에 추가:

```typescript
  it('getTransferCandidates는 drop_ship 후보를 제외하고 null-mode(in_house) 후보는 보존한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx); // toFo 는 fulfillmentMode 미지정 = null(in_house)

      // 같은 sku·warehouse 에 drop_ship 후보 FO+FOI 추가 (shortage 존재)
      const [dsFo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          warehouseId: f.warehouseId,
          status: 'created',
          totalItems: 1,
          totalQty: 2,
          fulfillmentMode: 'drop_ship',
        })
        .returning();
      const [dsFoi] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: dsFo.id, skuId: f.skuId, qty: 2, reservedQty: 0 })
        .returning();

      const candidates = await facade.getTransferCandidates(f.fromFo.id, f.fromFoi.id, tx);
      const ids = candidates.map((c) => c.id);
      expect(ids).toContain(f.toFoi.id); // null-mode(in_house) 후보 보존
      expect(ids).not.toContain(dsFoi.id); // drop_ship 후보 제외
    });
  });
```

- [ ] **Step 4: 유닛 회귀 + 컴파일 확인**

Run: `npx jest --testPathPattern="fulfillment-reservations.facade.spec"`
Expected: PASS — 기존 유닛(WHERE 무시 mock)은 무영향, 전량 통과. (통합 spec 은 `DATABASE_URL` 없어 auto-skip.)

- [ ] **Step 5: deferred 통합 spec 타입체크 (isolatedModules off)**

임시 tsconfig 로 통합 spec 만 타입체크(작업 10 판례 — build/jest 는 `isolatedModules` 라 spec 미검사):

```bash
SCRATCH="/tmp/claude-1000/-home-pauseb-workspace-almondyoung-server/30612629-2035-467b-9ac7-00ced54faaf3/scratchpad"
cat > "$SCRATCH/tsconfig.intspec.json" <<'JSON'
{
  "extends": "/home/pauseb/workspace/almondyoung-server/tsconfig.json",
  "compilerOptions": { "noEmit": true, "isolatedModules": false },
  "include": ["/home/pauseb/workspace/almondyoung-server/apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.integration.spec.ts"]
}
JSON
cd /home/pauseb/workspace/almondyoung-server && npx tsc -p "$SCRATCH/tsconfig.intspec.json" 2>&1 | grep "facade.integration.spec" || echo "TYPECHECK CLEAN"
```

Expected: `TYPECHECK CLEAN`(해당 spec 에 타입 에러 없음).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts \
        apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.integration.spec.ts
git commit -m "feat(core): getTransferCandidates에서 drop_ship 후보 NULL-safe 제외 (작업 11b)"
```

---

### Task 4: `computeAdminAvailableActions` 광고 — drop_ship reserve/transfer 제외

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:1095-1104`
- Test: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts` (신규 `describe`)

**Interfaces:**
- Consumes: `makeService()` → `{ service }`. private 메서드는 `(service as any)['computeAdminAvailableActions'](fo, items)` 로 호출(순수 함수, DB 불필요).
- Produces: 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

`fulfillments.service.spec.ts` 상단 `describe('FulfillmentsService', ...)` 안 아무 위치에 블록 추가:

```typescript
  describe('computeAdminAvailableActions (drop_ship 예약 가드)', () => {
    const items = [{ shippedQty: 0 }];

    it('drop_ship non-terminal FO는 reserve/transferReservation을 광고하지 않고 unreserve/cancel/forwardDropShip은 유지한다', () => {
      const { service } = makeService();
      const actions = (service as any)['computeAdminAvailableActions'](
        { status: 'created', fulfillmentMode: 'drop_ship', directShipStatus: null },
        items,
      );
      expect(actions).not.toContain('reserve');
      expect(actions).not.toContain('transferReservation');
      expect(actions).toContain('unreserve');
      expect(actions).toContain('cancel');
      expect(actions).toContain('forwardDropShip');
    });

    it('null-mode(in_house 기본) FO는 reserve를 광고한다 (회귀)', () => {
      const { service } = makeService();
      const actions = (service as any)['computeAdminAvailableActions'](
        { status: 'created', fulfillmentMode: null, directShipStatus: null },
        items,
      );
      expect(actions).toContain('reserve');
      expect(actions).toContain('transferReservation'); // 'created'는 TRANSFER_ALLOWED
    });

    it('in_house 명시 FO는 reserve/transferReservation을 광고한다 (회귀)', () => {
      const { service } = makeService();
      const actions = (service as any)['computeAdminAvailableActions'](
        { status: 'ready', fulfillmentMode: 'in_house', directShipStatus: null },
        items,
      );
      expect(actions).toContain('reserve');
      expect(actions).toContain('transferReservation');
    });
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --testPathPattern="fulfillments.service.spec"`
Expected: FAIL — 첫 케이스에서 drop_ship 인데 `reserve`/`transferReservation` 가 광고되어 `not.toContain` 실패.

- [ ] **Step 3: 광고 로직 구현**

`fulfillments.service.ts` 의 `computeAdminAvailableActions` 에서 현재 블록(`:1095-1104`):

```typescript
    if (!isTerminal) {
      actions.push('reserve');
      if (!hasShippedItems) {
        actions.push('unreserve');
        if (TRANSFER_ALLOWED_STATUSES.has(fo.status)) {
          actions.push('transferReservation');
        }
      }
      actions.push('cancel');
    }
```

를 아래로 교체:

```typescript
    // W6(직배 별도 엔티티 추출) 전까지의 방어선: drop_ship 은 타사 재고라 자사 예약이 없다.
    // reserve/transferReservation 은 예약을 생성/주입하므로 광고 제외. unreserve 는 잔존 예약
    // 수동 해제 escape hatch 로 유지(facade 도 unreserve 는 drop_ship 가드하지 않음).
    const isDropShip = fo.fulfillmentMode === 'drop_ship';
    if (!isTerminal) {
      if (!isDropShip) actions.push('reserve');
      if (!hasShippedItems) {
        actions.push('unreserve');
        if (!isDropShip && TRANSFER_ALLOWED_STATUSES.has(fo.status)) {
          actions.push('transferReservation');
        }
      }
      actions.push('cancel');
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern="fulfillments.service.spec"`
Expected: PASS — 신규 3건 포함 전량 통과.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillments.service.ts \
        apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts
git commit -m "feat(core): drop_ship FO 광고에서 reserve/transfer 제외, unreserve 유지 (작업 11b)"
```

---

### Task 5: admin-web surface #1 인라인 예약 버튼을 서버 광고 기반으로 전환

**Files:**
- Modify: `apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx:220`

**Interfaces:**
- Consumes: `fo.adminAvailableActions`(현재 `:120` `data.adminAvailableActions ?? []` 로 세팅됨).
- Produces: 없음.

**배경:** surface #2(`detail/inventory-tab.tsx`)는 이미 `adminAvailableActions.includes('reserve')` 기반이라 서버 광고 제거로 **자동 반영**. surface #1(인라인 per-item 버튼)만 `remaining>0 && !isTerminal` 로 **mode-blind** → 서버 계약 기반으로 전환.

- [ ] **Step 1: 게이트 조건 교체**

`components/detail/index.tsx:220`:

```typescript
                const remaining = item.qty - item.reservedQty;
                const canReserve = remaining > 0 && fo.adminAvailableActions.includes('reserve');
```

(`const canReserve = remaining > 0 && !isTerminal;` 를 위로 교체. 비-drop_ship 은 `reserve` 가 `!isTerminal` 일 때 정확히 광고되므로 동작 불변, drop_ship 은 서버 미광고로 자동 숨김.)

- [ ] **Step 2: admin-web 타입체크**

Run: `cd apps/admin-web && npm run type-check`
Expected: 변경 파일(`components/detail/index.tsx`) 신규 에러 0. (repo 기존 TS7006 debt 는 무관 — 출력에서 해당 파일명이 새로 등장하지 않으면 통과.)

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx
git commit -m "feat(admin-web): FO 인라인 예약 버튼을 서버 광고(adminAvailableActions) 기반으로 (작업 11b)"
```

---

### Task 6: 전체 검증 게이트 + 현황판 갱신

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md` (§2 P1-3 관련 없음 — 신설 작업 11b 완료 블록을 §5 WS-D 에 추가)

**Interfaces:** 없음(검증 + 문서).

- [ ] **Step 1: core 빌드**

Run: `npx nest build core`
Expected: exit 0(tsc/webpack 무오류).

- [ ] **Step 2: arch 경계 + fulfillment 유닛 회귀**

Run: `npx jest --testPathPattern="inventory-write-boundary.arch.spec|fulfillment-reservations.facade.spec|fulfillments.service.spec"`
Expected: 3 suites PASS(arch 경계 회귀 + reserve/transfer 가드 + 광고).

- [ ] **Step 3: 변경 파일 eslint (신규 error 0)**

Run:
```bash
cd /home/pauseb/workspace/almondyoung-server && npx eslint \
  apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts \
  apps/core/src/modules/fulfillment/services/fulfillments.service.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.spec.ts \
  apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.integration.spec.ts
```
Expected: 변경 라인發 신규 error 0(파일에 HEAD 부터 있던 기존 warning 은 무관 — 전역 lint 는 상시 debt).

- [ ] **Step 4: admin-web 타입체크(재확인)**

Run: `cd apps/admin-web && npm run type-check`
Expected: 변경 파일 신규 에러 0.

- [ ] **Step 5: 현황판 §5 WS-D 에 작업 11b 완료 블록 추가**

`docs/logistics-backend-hardening-2026-07.md` 의 WS-D "권장 작업 분할" 4번(`:277`) **뒤**, `**WS-E...` (`:294`) **앞**에 완료 블록 추가:

```markdown
> **✅ 작업 11b (drop_ship 예약/이전 주입 가드) 완료 — 2026-07-12:** drop_ship FO 의 "자사 재고 예약 없음" 불변식을 예약 **생성 경로**에서 강제. 작업 11 부수 발견(operator 수동 `/reserve` 가드 부재 + 광고 노출 → sweep-warn 도달)을 봉합. 스키마 무변경(작업 4·5·6·7·9·10·11 판례).
> - **facade 가드(본체)**: `reserve`(drop_ship THROW)·`transferReservation`(from·to 양방향 THROW)·`getTransferCandidates`(NULL-safe drop_ship 후보 제외 — `or(isNull, ne)` 로 null-mode=in_house 보존). `unreserve` 는 무가드 유지(예약 감소 방향, 잔존 정리 escape hatch).
> - **광고**: `computeAdminAvailableActions` 에서 drop_ship non-terminal → `reserve`·`transferReservation` 제외, `unreserve`·`cancel`·`forwardDropShip` 유지.
> - **admin-web**: surface #1 인라인 예약 버튼을 `adminAvailableActions.includes('reserve')` 서버 계약 기반으로 전환(surface #2 InventoryTab·unreserve/transfer 섹션은 광고 게이트라 자동 반영).
> - **잔존 데이터 = 방치**: 배포 전 non-terminal drop_ship FO 의 기존 confirmed 예약은 terminal 도달 시 기존 `ship()`/`markDelivered()` sweep 이 heal. 일회 정리·대사잡 non-terminal 확장은 비목표(작업 12·구 8b 판례).
> - 설계 `docs/superpowers/specs/2026-07-12-drop-ship-reserve-guard-design.md` · 계획 `docs/superpowers/plans/2026-07-12-drop-ship-reserve-guard.md`.
> - 브랜치 `feat/drop-ship-reserve-guard` → develop **스쿼시 머지 `<TBD>`**(머지 시 해시 기입).
> - 검증: `nest build core` exit 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS · facade/service 유닛 신규 6건 포함 GREEN · 변경 파일 신규 eslint 0 · admin-web `type-check` 신규 0. getTransferCandidates 필터는 deferred 통합 spec 1건(DB 없으면 auto-skip · isolatedModules-off tsc 타입체크 CLEAN). 스키마 무변경이라 dev DB ⏸ 없음.
> - **WS-D 잔여**: 작업 13(컨슈머 포이즌 P1-1·P1-2)·작업 14(반품 환불 상태기계)·작업 15(SO 상태) + 작업 10b(reverseEvent) + ② 보류(게이지 실측).
```

- [ ] **Step 6: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "docs(core): 작업 11b drop_ship 예약 가드 완료 — 현황판 갱신"
```

---

## Self-Review

- **Spec coverage:** §4.A reserve 가드→T1 · transfer 가드→T2 · getTransferCandidates NULL-safe→T3 · §4.B 광고→T4 · §4.C admin-web→T5 · §6 테스트(유닛 3+deferred 통합 1)→T1·T2·T3·T4 · §8 검증 게이트→T6. 잔존 방치(§3.1)=코드 없음, 문서 반영(T6 완료 블록). W6 주석=T1·T2·T3·T4 각 구현 스텝에 포함. 갭 없음.
- **Placeholder scan:** 완료 블록의 `<TBD>` 는 머지 해시 자리(설계 상 머지 시점 확정) — 유일하게 의도된 미확정. 그 외 모든 스텝에 실제 코드/명령/기대출력 포함.
- **Type consistency:** `foFulfillmentMode`(T1)·`makeTransferTx` `fulfillmentMode`(T2)·`isDropShip`(T4) 명칭 일관. `fo.fulfillmentMode === 'drop_ship'` 판정 전 태스크 통일. drizzle `isNull`/`or` import(T3) 는 T3 에서만 사용.

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — batch execution with checkpoints.
