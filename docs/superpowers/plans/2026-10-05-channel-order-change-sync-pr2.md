# 수집 뒤 채널 변경 반영 — PR 2 (즉시 끌어오기와 백필) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** channel-adapter 에 주문 하나를 지금 채널에서 다시 가져와 폴링과 같은 처리를 태우는 입구(`POST /adapter/orders/:channel/:externalOrderId/sync`, `force` 지원)를 만들고, 배포 뒤 한 번 돌릴 백필 스크립트를 둔다. 덤으로 PR 1 이 셀메이트가 `shipped` 로 찍은 판매주문을 «아직 안 떠남» 으로 다루는 구멍을 막는다.

**Architecture:** 입구는 `OrderPollerOrchestrator.syncOrder` 하나다 — provider 의 새 `fetchOrderForSync`(번역 결과 + lifecycle)를 받아 기존 `processOrderItem`·`processLifecycleItem` 을 그대로 부른다. 워터마크·sync_status 는 건드리지 않는다. 백필 스크립트는 `sst shell` 안에서 channel_adapter·core 두 DB 를 **읽기 전용**으로 읽어 대상을 거르고, 입구를 내부 키로 부른다. channel-adapter 는 core DB 를 못 읽으므로 «끝나지 않은 판매주문» 판정은 스크립트가 한다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), class-validator, Jest(ts-jest), SST v3(`Resource`), tsx.

**Spec:** `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md` §9 · §14 PR 2 절. PR 1 계획: `docs/superpowers/plans/2026-10-05-channel-order-change-sync-pr1.md`(PR #1017, 머지됨·**미배포** — 라이브 Core task def 231 은 10-04 등록).

## 착수 전 판단 (2026-10-05, 라이브 읽기 전용 실측)

**1. 백필 대상은 스크립트가 core DB 를 읽어 거른다.** channel-adapter 는 core DB 를 못 읽지만 백필 스크립트는 `sst shell` 안에서 두 DB 를 모두 읽을 수 있다(`scripts/ops/647-*`·`scripts/sellmate/*` 와 같은 방식). «core 가 이미 cancelled/timeout 을 건너뛰니 거르지 않아도 된다»는 **성립하지 않는다** — diff 는 `shipped`·`delivered` 를 건너뛰지 않고, 격리 3,004건 중 2,888건이 `shipped` 다. 걸러야 할 status: `cancelled`·`timeout`·`shipped`·`delivered`. 판매주문이 없는 격리(2건)는 보내면 core 가 NotFound → DLQ 이므로 뺀다.

**2. 셀메이트 `shipped` 판매주문에 `OrderModified` 가 오면 PR 1 은 «반영됨» 으로 거짓 기록한다 → 이 PR 의 Task 1 에서 고친다.** PR 1 의 «이미 떠났나» 판정(`isFullyShipped`)은 core 출고지시·박스만 본다. 셀메이트가 출고한 주문은 core 출고 기록이 없거나(출고지시 0개 856건, `awaiting_matching` 백로그 657건) 유령 출고지시(`created`·`ready`·`partially_reserved` 205건)라 «안 떠남» 으로 판정된다. 그 결과:
   - 배송지: 판매주문·출고지시 주소가 바뀌고 `applied` — 소포는 이미 옛 주소로 떠났는데 정정이 묻힌다(PR 1 final fix 가 «전량 출고» 에 막은 바로 그 함정)
   - 수량 감소: V1 `cancelPartial` 은 판매주문 status 를 보지 않는다. 출고지시가 없으면 `no_physical_fulfillment_adjustment_required`, `awaiting_matching` 백로그면 백로그를 줄이고 **`pending` 으로 되돌려 매칭을 다시 시도시킨다** — 이미 나간 주문에 매칭·예약이 다시 붙을 길을 연다. 기록은 `applied`
   - core 출고지시까지 `shipped` 인 1,166건은 기존 판정이 이미 `pending` 으로 막는다
   처방: 판매주문 status 가 `shipped`·`delivered` 면 배송지는 `SHIPMENT_NOT_REVISABLE`, 감소는 `CANCEL_NOT_IMMEDIATE`(둘 다 `detail: 'sales order marked shipped'`)로 **시도 없이** 대기. 지금 이 status 를 쓰는 코드는 없고(#1016 15번 행) 셀메이트 스크립트만 쓰므로, 이 판정은 그 과도기 주문만 건드린다. PR 1 이 아직 배포 전이라 이 PR 과 함께 나가면 틈이 없다.

**3. 백필 대상 수 (2026-10-05 라이브).** `order_collection_failures` 의 `collected_order_modification_not_accepted`·`quarantined` = **3,004건**(전부 medusa, 06-15~10-04). core 판매주문 status 로 나누면 `shipped` 2,888 · `cancelled` 80 · `pending` 29 · `delivered` 4 · 판매주문 없음 2 · `confirmed` 1. **백필 대상 = 30건**(`pending` 29 + `confirmed` 1). 시점 값이다 — 실행 때 스크립트의 dry-run 이 다시 센다.

## Global Constraints

- channel-adapter 해시 입력(`OrderFetchItem.changes`)을 **바꾸지 않는다**(스펙 §5)
- 입구는 폴링과 **같은** 주문 처리(`processOrderItem` + lifecycle)를 탄다. 별도 경로를 만들지 않는다(스펙 §9.1)
- 입구는 워터마크·`sync_statuses` 를 건드리지 않는다(주문 하나의 관측이다)
- 비활성 채널(`sales_channels.is_active=false`)은 입구도 거절한다 — 폴링의 킬스위치와 같은 뜻(409)
- 지원 채널 `medusa`·`naver`. 그 밖은 400(스펙 §9.1)
- 인증은 기존 내부 키 방식: `@Public()` + 핸들러마다 `verifyInternalKey`(`CHANNEL_ADAPTER_INTERNAL_KEY`, `Bearer`)
- 백필 스크립트는 DB 에 **쓰지 않는다**(두 연결 모두 `default_transaction_read_only=on`). 쓰기는 입구가 한다. 기본은 dry-run, `--apply` 에서만 입구를 부른다
- 격리 행은 닫지 않는다(스펙 §9.2, 6번 행 몫)
- `any`·`as` 금지. 불가피하면 바로 윗줄에 근거 주석(이 계획에서 허용한 곳: 스크립트의 `Resource` 캐스팅 — 기존 ops 스크립트와 같은 근거, 테스트 목의 `as any` — 기존 스펙 관례)
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0, `npx jest scripts/security` 통과
- core DB 통합 스펙 실행: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_sdd_1016 npx drizzle-kit migrate --config apps/core/drizzle.config.ts` 한 번 뒤 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_sdd_1016 npx jest apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts --runInBand`
- 진행 상태는 스펙에 적지 않는다(#1016 5번 행). 스펙에는 «계획 단계 수정» 메모만 더한다

## Review Focus

1. **셀메이트가 `shipped` 로 찍은 판매주문(core 출고지시 없음)의 배송지·감소는 판매주문을 바꾸지 않고 대기여야 한다** — Task 1 통합 테스트 두 개(주소 불변 + 취소 행 0)
2. **`force` 는 폴러가 이미 같은 해시를 선점했어도 발행해야 한다** — Task 2 «force 는 같은 해시에도 발행»
3. **입구는 워터마크를 움직이지 않는다** — Task 2 의 각 테스트가 `recordSyncStart`·`recordSyncComplete` 미호출을 확인
4. **비활성 채널·틀린 키에서는 채널을 부르지 않는다** — Task 2 «비활성 채널» · Task 3 «틀린 키»
5. **백필 대상에서 `shipped`·`delivered`·판매주문 없음이 빠진다** — Task 4 순수 함수 테스트

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts` | 셀메이트 출고 표시 판매주문 → 시도 없이 대기 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts` | 위 두 테스트 |
| `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts` | `OrderSyncFetch`·`SyncableChannelOrderProvider` |
| `apps/channel-adapter/src/services/order-collection/translating-order.provider.ts` | `fetchOrderForSync` |
| `apps/channel-adapter/src/services/order-collection/translating-order.provider.spec.ts`(신규) | 위 |
| `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts` | `syncOrder`, `processOrderItem` 의 `force` |
| `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts` | `syncOrder` describe |
| `apps/channel-adapter/src/controllers/channel-order-sync.controller.ts`(신규) + `.spec.ts` | 입구 |
| `apps/channel-adapter/src/adapter.module.ts` | 컨트롤러 등록 |
| `scripts/ops/1016-backfill-targets.ts`(신규) + `.spec.ts` | 대상 선별(순수) |
| `scripts/ops/1016-backfill-channel-order-modifications.ts`(신규) | 백필 실행 |
| `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md` | §7·§9 계획 단계 수정 메모 |
| `apps/channel-adapter/CLAUDE.md` §3-5 | 입구 한 줄 |

---

### Task 1: core — 셀메이트가 `shipped` 로 찍은 판매주문은 시도 없이 대기

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts` (`settle`, 파일 상단 상수)
- Test: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md` §7 (메모)

**Interfaces:**
- Consumes: PR 1 의 `ChannelOrderChangeManager.handle(salesOrderId, payload, sourceEventId, tx)`, 통합 스펙의 `wire`·`seedOrder`·`payload`·`amendmentsOf` 헬퍼
- Produces: 없음(동작 변경만). blocker detail 문자열 `'sales order marked shipped'`

- [ ] **Step 1: 통합 테스트 두 개를 쓴다** — `describeIfDb('채널 변경 반영 …')` 블록의 마지막 `it` 뒤에 더한다.

```ts
  it('셀메이트가 shipped 로 찍은 판매주문(core 출고 기록 없음) — 배송지는 판매주문 그대로 SHIPMENT_NOT_REVISABLE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      // scripts/sellmate/mark-shipped-from-csv.ts 가 하는 일 그대로 — status 만 바꾼다(#1016 15번 행).
      await tx.update(wmsTables.salesOrders).set({ status: 'shipped' }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(ADDRESS);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([
        expect.objectContaining({
          type: 'shipping_address_change',
          outcome: 'pending',
          blockers: [{ code: 'SHIPMENT_NOT_REVISABLE', detail: 'sales order marked shipped' }],
        }),
      ]);
    });
  });

  it('셀메이트가 shipped 로 찍은 판매주문 — 감소는 취소하지 않고 CANCEL_NOT_IMMEDIATE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await tx.update(wmsTables.salesOrders).set({ status: 'shipped' }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      const p = payload(seed, {});
      p.snapshot.lines[0].quantity = 1;
      await w.manager.handle(seed.salesOrderId, p, `m-${randomUUID()}`, tx);
      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(0);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([
        expect.objectContaining({
          type: 'quantity_correction',
          outcome: 'pending',
          blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: 'sales order marked shipped' }],
        }),
      ]);
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_sdd_1016 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_sdd_1016 npx jest apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts --runInBand -t "셀메이트"
```
Expected: 2 FAIL — 첫째는 `so.shippingAddress` 가 `NEXT`, 둘째는 `cancellations` 길이 1.

- [ ] **Step 3: `settle` 에 판정을 더한다** — `channel-order-change.manager.ts`. `CHANNEL_ACTOR` 상수 아래에:

```ts
/**
 * 셀메이트 과도기에 `scripts/sellmate/mark-shipped-from-csv.ts` 가 직접 찍는 출고 표시(#1016 15번 행).
 * core 출고 기록이 없어도 물건은 이미 떠났다 — `isFullyShipped` 는 core 출고지시·박스만 보므로 이걸 못 본다.
 * 지금 이 status 를 쓰는 코드는 없다. 생기더라도 «떠났다» 는 뜻은 같다.
 */
const MARKED_SHIPPED_STATUSES: ReadonlySet<string> = new Set(['shipped', 'delivered']);
const MARKED_SHIPPED_DETAIL = 'sales order marked shipped';
```

`settle` 의 첫 두 갈래를 이렇게 바꾼다:

```ts
    const markedShipped = MARKED_SHIPPED_STATUSES.has(order.status);
    if (delta.type === 'shipping_address_change') {
      if (markedShipped) {
        return { ...delta, outcome: 'pending', blockers: [{ code: 'SHIPMENT_NOT_REVISABLE', detail: MARKED_SHIPPED_DETAIL }] };
      }
      return this.tryAddress(order, delta, ctx.amendmentId, tx);
    }
    if (isDecrease(delta)) {
      if (ctx.allRemoved) return { ...delta, outcome: 'pending', blockers: [{ code: 'ALL_LINES_REMOVED' }] };
      // V1 cancelPartial 은 판매주문 status 를 보지 않는다 — 시도하면 이미 나간 수량을 «안 나간 몫» 으로 줄이고
      // awaiting_matching 백로그를 pending 으로 되돌려 매칭을 다시 시도시킨다.
      if (markedShipped) {
        return { ...delta, outcome: 'pending', blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: MARKED_SHIPPED_DETAIL }] };
      }
      return this.tryDecrease(order, delta, ctx, tx);
    }
```

- [ ] **Step 4: 통과를 확인한다** — 스펙 파일 전체(기존 테스트 회귀 포함)

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_sdd_1016 npx jest apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts --runInBand
```
Expected: 전부 PASS.

- [ ] **Step 5: 스펙 §7 에 메모를 더한다** — `### 7.1 배송지` 바로 위(§7 머리의 «계획 단계 수정» 인용 블록 다음)에:

```markdown
> **계획 단계 수정(PR 2, 2026-10-05):** 판매주문 status 가 `shipped`·`delivered` 면 시도하지 않고 대기한다 — 배송지
> `SHIPMENT_NOT_REVISABLE`, 감소 `CANCEL_NOT_IMMEDIATE`(둘 다 `detail: 'sales order marked shipped'`). 셀메이트 과도기에
> 스크립트가 이 status 를 직접 찍어, core 출고 기록이 없어도 물건은 이미 떠났다. 그대로 시도하면 배송지는 «반영됨» 으로
> 묻히고, 감소는 V1 부분취소가 status 를 보지 않아 `awaiting_matching` 백로그를 다시 매칭 대기로 돌린다.
```

- [ ] **Step 6: 타입체크·커밋**

```bash
npm run type-check
git add apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md
git commit -m "fix(core): 셀메이트가 shipped 로 찍은 판매주문의 채널 변경은 시도 없이 대기 (#1016 5번 행)"
```

---

### Task 2: channel-adapter — `syncOrder`(즉시 끌어오기)와 `force`

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/translating-order.provider.ts`
- Create: `apps/channel-adapter/src/services/order-collection/translating-order.provider.spec.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts`
- Test: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts`

**Interfaces:**
- Consumes: `ChannelOrderTranslator.translate(channel, snapshot): Promise<{ outcome: OrderFetchOutcome; lifecycle: OrderLifecycleEventItem[] }>`, `ReplayableChannelOrderSource.fetchOrder(externalOrderId): Promise<ChannelOrderSnapshot | null>`
- Produces:
  - `export interface OrderSyncFetch { outcome: OrderFetchOutcome; lifecycle: OrderLifecycleEventItem[] }` (provider interface 파일)
  - `export interface SyncableChannelOrderProvider extends ChannelOrderProvider { fetchOrderForSync(externalOrderId: string): Promise<OrderSyncFetch | null> }`
  - `export type OrderSyncOutcome = 'unchanged' | 'emitted' | 'created' | 'not_found' | 'not_eligible' | 'identification_failed' | 'channel_inactive'` (orchestrator 파일)
  - `OrderPollerOrchestrator.syncOrder(channel: SalesChannel, externalOrderId: string, options?: { force?: boolean }): Promise<{ outcome: OrderSyncOutcome }>`

- [ ] **Step 1: provider 테스트를 쓴다** — `translating-order.provider.spec.ts`(신규)

```ts
import { createOrderProvider } from './translating-order.provider';
import type { SyncableChannelOrderProvider } from './channel-order-provider.interface';

describe('ReplayableTranslatingOrderProvider.fetchOrderForSync', () => {
  const snapshot = { externalOrderId: 'order_1' };
  const translated = {
    outcome: { kind: 'order', order: { externalOrderId: 'order_1' } },
    lifecycle: [{ eventType: 'OrderCancelled', externalOrderId: 'order_1' }],
  };

  function make(fetched: unknown) {
    const source = { channel: 'medusa', fetchOrders: jest.fn(), fetchOrder: jest.fn().mockResolvedValue(fetched) };
    const translator = { translate: jest.fn().mockResolvedValue(translated) };
    // 테스트 목 — 번역기·source 의 나머지 표면은 이 경로가 쓰지 않는다.
    const provider = createOrderProvider(source as any, translator as any) as SyncableChannelOrderProvider;
    return { provider, source, translator };
  }

  it('번역 결과와 lifecycle 을 함께 돌려준다 — 폴링과 같은 처리를 태우려면 둘 다 필요하다', async () => {
    const { provider, translator } = make(snapshot);
    await expect(provider.fetchOrderForSync('order_1')).resolves.toEqual(translated);
    expect(translator.translate).toHaveBeenCalledWith('medusa', snapshot);
  });

  it('채널에 없으면 null', async () => {
    const { provider, translator } = make(null);
    await expect(provider.fetchOrderForSync('order_1')).resolves.toBeNull();
    expect(translator.translate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx jest apps/channel-adapter/src/services/order-collection/translating-order.provider.spec.ts` → FAIL(`fetchOrderForSync is not a function` 또는 타입 에러)

- [ ] **Step 3: 인터페이스와 provider 를 구현한다**

`channel-order-provider.interface.ts` 의 `ReplayableChannelOrderProvider` 아래에:

```ts
/** 즉시 끌어오기(#1016 5번 행, 스펙 §9.1)가 받는 것 — 폴링과 같은 처리를 태우려면 lifecycle 도 함께 필요하다. */
export interface OrderSyncFetch {
  outcome: OrderFetchOutcome;
  lifecycle: OrderLifecycleEventItem[];
}

export interface SyncableChannelOrderProvider extends ChannelOrderProvider {
  fetchOrderForSync(externalOrderId: string): Promise<OrderSyncFetch | null>;
}
```

`translating-order.provider.ts`: import 에 `OrderSyncFetch`, `SyncableChannelOrderProvider` 를 더하고, `ReplayableTranslatingOrderProvider` 가 `implements ReplayableChannelOrderProvider, SyncableChannelOrderProvider` 하게 바꾼 뒤 `fetchOrder` 아래에:

```ts
  async fetchOrderForSync(externalOrderId: string): Promise<OrderSyncFetch | null> {
    const snapshot = await this.replayableSource.fetchOrder(externalOrderId);
    if (!snapshot) {
      return null;
    }
    return this.translator.translate(this.channel, snapshot);
  }
```

- [ ] **Step 4: provider 테스트 통과 확인** — 같은 명령 → PASS

- [ ] **Step 5: orchestrator 테스트를 쓴다** — `order-poller.orchestrator.spec.ts` 파일 끝(헬퍼 함수들 위, 마지막 `describe` 뒤)에 새 describe. 헬퍼 `makeOrder`·`makeFailure`·`makeLifecycleEvent`·`makeDb`·`makeHashService`·`makeFailureService`·`makeSyncStatus`·`makeSalesChannelClient` 는 같은 파일에 이미 있다.

```ts
describe('OrderPollerOrchestrator.syncOrder — 즉시 끌어오기 (#1016 5번 행, 스펙 §9.1)', () => {
  function setup(options: { activeSites?: string[]; collected?: string[] } = {}) {
    const db = makeDb({ collected: options.collected });
    const provider = {
      channel: 'medusa' as const,
      fetchOrders: jest.fn(),
      fetchOrderForSync: jest.fn(),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    const salesChannels = makeSalesChannelClient(options.activeSites ?? ['medusa']);
    const orchestrator = new OrderPollerOrchestrator(
      [provider as any],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      salesChannels as any,
    );
    const eventTypes = () => outbox.enqueue.mock.calls.map(([event]) => event.eventType);
    return { orchestrator, provider, syncStatus, outbox, hashes, failures, eventTypes };
  }

  function expectWatermarkUntouched(syncStatus: ReturnType<typeof makeSyncStatus>) {
    expect(syncStatus.recordSyncStart).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncComplete).not.toHaveBeenCalled();
  }

  it('처음 보는 주문은 created, 같은 내용은 unchanged, 바뀐 내용은 emitted(OrderModified)', async () => {
    const { orchestrator, provider, syncStatus, eventTypes } = setup();
    provider.fetchOrderForSync
      .mockResolvedValueOnce({ outcome: { kind: 'order', order: makeOrder('2026-10-05T01:00:00.000Z') }, lifecycle: [] })
      .mockResolvedValueOnce({ outcome: { kind: 'order', order: makeOrder('2026-10-05T01:00:00.000Z') }, lifecycle: [] })
      .mockResolvedValueOnce({
        outcome: { kind: 'order', order: makeOrder('2026-10-05T01:10:00.000Z', { totalAmount: 12000 }) },
        lifecycle: [],
      });

    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({ outcome: 'created' });
    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({ outcome: 'unchanged' });
    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({ outcome: 'emitted' });

    expect(eventTypes()).toEqual(['OrderCreated', 'OrderModified']);
    expect(provider.fetchOrderForSync).toHaveBeenCalledWith('medusa_order_1');
    expectWatermarkUntouched(syncStatus);
  });

  it('force 는 같은 해시에도 OrderModified 를 낸다(백필 전용)', async () => {
    const { orchestrator, provider, syncStatus, eventTypes } = setup();
    const same = { outcome: { kind: 'order', order: makeOrder('2026-10-05T01:00:00.000Z') }, lifecycle: [] };
    provider.fetchOrderForSync.mockResolvedValue(same);

    await orchestrator.syncOrder('medusa', 'medusa_order_1');
    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1', { force: true })).resolves.toEqual({
      outcome: 'emitted',
    });
    // 폴러가 같은 해시를 이미 선점한 뒤에도 — force 는 선점 결과와 무관하게 발행한다.
    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1', { force: true })).resolves.toEqual({
      outcome: 'emitted',
    });

    expect(eventTypes()).toEqual(['OrderCreated', 'OrderModified', 'OrderModified']);
    expectWatermarkUntouched(syncStatus);
  });

  it('force 는 아직 수집 안 된 주문을 두 번 만들지 않는다 — 생성 경로의 멱등은 매핑이 지킨다', async () => {
    const { orchestrator, provider, eventTypes } = setup();
    provider.fetchOrderForSync.mockResolvedValue({
      outcome: { kind: 'order', order: makeOrder('2026-10-05T01:00:00.000Z') },
      lifecycle: [],
    });

    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1', { force: true })).resolves.toEqual({
      outcome: 'created',
    });
    expect(eventTypes()).toEqual(['OrderCreated']);
  });

  it('주문을 먼저 처리하고 그 주문의 lifecycle 을 이어서 낸다', async () => {
    const { orchestrator, provider, eventTypes } = setup();
    provider.fetchOrderForSync.mockResolvedValue({
      outcome: { kind: 'order', order: makeOrder('2026-10-05T01:00:00.000Z') },
      lifecycle: [makeLifecycleEvent('OrderCancelled', 'cancelled', '2026-10-05T00:59:00.000Z')],
    });

    await orchestrator.syncOrder('medusa', 'medusa_order_1');

    expect(eventTypes()).toEqual(['OrderCreated', 'OrderCancelled']);
  });

  it('채널에 없으면 not_found 이고 아무것도 내지 않는다', async () => {
    const { orchestrator, provider, outbox } = setup();
    provider.fetchOrderForSync.mockResolvedValue(null);

    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({ outcome: 'not_found' });
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('수집 대상이 아닌(결제 미완·종결) 미수집 주문은 not_eligible', async () => {
    const { orchestrator, provider, outbox } = setup();
    provider.fetchOrderForSync.mockResolvedValue({
      outcome: { kind: 'order', order: makeOrder('2026-10-05T01:00:00.000Z', { eligibleForOrderCreation: false }) },
      lifecycle: [],
    });

    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({ outcome: 'not_eligible' });
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('식별 실패 — 미수집 주문이면 폴링처럼 격리한다', async () => {
    const { orchestrator, provider, failures } = setup();
    const failure = makeFailure('2026-10-05T01:00:00.000Z');
    provider.fetchOrderForSync.mockResolvedValue({ outcome: { kind: 'failure', failure }, lifecycle: [] });

    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({
      outcome: 'identification_failed',
    });
    expect(failures.recordFailure).toHaveBeenCalledWith('medusa', failure);
  });

  it('식별 실패 — 이미 수집된 주문이면 격리하지 않고 열린 격리를 닫는다(#647 과 같은 처리)', async () => {
    const { orchestrator, provider, failures } = setup({ collected: ['medusa_order_1'] });
    failures.findOpenByExternalOrderId.mockResolvedValue({ id: 'failure_1' });
    provider.fetchOrderForSync.mockResolvedValue({
      outcome: { kind: 'failure', failure: makeFailure('2026-10-05T01:00:00.000Z') },
      lifecycle: [],
    });

    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({
      outcome: 'identification_failed',
    });
    expect(failures.recordFailure).not.toHaveBeenCalled();
    expect(failures.closeAsAlreadyCollected).toHaveBeenCalledWith('failure_1', expect.any(String), 'wms_medusa_order_1');
  });

  it('비활성 채널이면 채널을 부르지 않고 channel_inactive', async () => {
    const { orchestrator, provider, outbox } = setup({ activeSites: ['naver'] });

    await expect(orchestrator.syncOrder('medusa', 'medusa_order_1')).resolves.toEqual({
      outcome: 'channel_inactive',
    });
    expect(provider.fetchOrderForSync).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
```

> 메모: `makeFailure` 가 만드는 실패의 `reason` 이 `CHANNEL_PRODUCT_IDENTIFICATION_FAILED` 인지 파일에서 확인한다. 아니면 두 식별 실패 테스트에서 `{ ...makeFailure(...), reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED }` 로 덮는다.

- [ ] **Step 6: 실패 확인** — `npx jest apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts -t syncOrder` → FAIL(`syncOrder is not a function`)

- [ ] **Step 7: orchestrator 를 구현한다** — `order-poller.orchestrator.ts`

import 에 `SalesChannel`(`@packages/event-contracts/streams`), `OrderFetchOutcome`, `SyncableChannelOrderProvider` 를 더한다.

`ProcessPollItemResult` 에 칸 하나:

```ts
  // 이번 호출이 매핑을 새로 만들었는가(OrderCreated). 즉시 끌어오기의 응답을 가른다.
  created?: boolean;
```

`processOrderItem` 시그니처와 두 군데:

```ts
  private async processOrderItem(
    provider: ChannelOrderProvider,
    item: OrderFetchItem,
    options: { force?: boolean } = {},
  ): Promise<ProcessPollItemResult> {
```

생성 갈래의 반환:

```ts
      return {
        emitted: created ? 1 : 0,
        dedupedUnchanged: 0,
        created,
        wmsOrderId: created ? payload.orderId : undefined,
      };
```

수집된 주문 갈래의 선점 직후:

```ts
      // force(백필 전용, 스펙 §9.1): 해시가 같아도 낸다. 해시는 claimChanged 가 이미 이 값으로 맞춰 두었다.
      // 폴러와 겹치면 같은 스냅샷이 두 번 갈 수 있다 — core 가 두 번째를 실질 차이 0 으로 버린다.
      if (!won && !options.force) {
        return false;
      }
```

파일 상단 타입 선언 근처에:

```ts
/** 즉시 끌어오기의 결과 (스펙 §9.1 의 네 값 + 계획 단계에서 더한 셋). */
export type OrderSyncOutcome =
  | 'unchanged'
  | 'emitted'
  | 'created'
  | 'not_found'
  | 'not_eligible'
  | 'identification_failed'
  | 'channel_inactive';
```

`replayFailure` 위에 공개 메서드:

```ts
  /**
   * 주문 하나를 지금 채널에서 다시 가져와 폴링과 **같은** 처리를 태운다 (#1016 5번 행, 스펙 §9.1).
   *
   * 워터마크·sync_status 는 건드리지 않는다 — 주문 하나의 관측이라 채널 진행 상태와 무관하다.
   * 비활성 채널은 폴링의 킬스위치와 같은 뜻으로 거절한다. 주문을 먼저 처리해야 그 주문의 lifecycle 이
   * 매핑을 찾는다(폴링 정렬의 order < lifecycle 과 같다).
   */
  async syncOrder(
    channel: SalesChannel,
    externalOrderId: string,
    options: { force?: boolean } = {},
  ): Promise<{ outcome: OrderSyncOutcome }> {
    const activeSites = await this.salesChannelClient.getActiveSites();
    if (!activeSites.includes(channel)) {
      return { outcome: 'channel_inactive' };
    }
    const provider = this.providers.find((candidate) => candidate.channel === channel);
    if (!provider || !this.isSyncableProvider(provider)) {
      throw new Error(`No syncable order provider registered for channel: ${channel}`);
    }
    const fetched = await provider.fetchOrderForSync(externalOrderId);
    if (!fetched) {
      return { outcome: 'not_found' };
    }
    const outcome = await this.syncFetched(provider, fetched.outcome, options);
    for (const lifecycle of fetched.lifecycle) {
      await this.processLifecycleItem(provider, lifecycle);
    }
    return { outcome };
  }
```

private 메서드들(`isReplayableProvider` 옆):

```ts
  private isSyncableProvider(provider: ChannelOrderProvider): provider is SyncableChannelOrderProvider {
    return typeof (provider as SyncableChannelOrderProvider).fetchOrderForSync === 'function';
  }

  /** 폴링 루프의 failure·order 갈래와 같은 처리. 워터마크 계산만 없다. */
  private async syncFetched(
    provider: ChannelOrderProvider,
    fetched: OrderFetchOutcome,
    options: { force?: boolean },
  ): Promise<OrderSyncOutcome> {
    if (fetched.kind === 'failure') {
      const collected = await this.findCollectedOrders(provider.channel, [fetched.failure.externalOrderId]);
      if (this.isAlreadyCollectedIdentificationFailure(fetched.failure, collected)) {
        await this.closeOpenQuarantineAsCollected(
          provider.channel,
          fetched.failure.externalOrderId,
          collected.get(fetched.failure.externalOrderId),
        );
      } else {
        await this.orderCollectionFailureService.recordFailure(provider.channel, fetched.failure);
      }
      return 'identification_failed';
    }
    const result = await this.processOrderItem(provider, fetched.order, options);
    if (result.created) return 'created';
    if (!result.wmsOrderId) {
      return fetched.order.eligibleForOrderCreation === false ? 'not_eligible' : 'unchanged';
    }
    return result.emitted > 0 ? 'emitted' : 'unchanged';
  }
```

> `isSyncableProvider` 의 `as` 는 기존 `isReplayableProvider` 와 같은 타입 가드 관례다. 근거 주석을 그 줄 위에 단다: `// 타입 가드 — 선택 메서드의 존재만 본다(isReplayableProvider 와 같은 관례).`

- [ ] **Step 8: 통과 확인** — orchestrator 스펙 전체(폴링 회귀 포함)와 provider 스펙

```bash
npx jest apps/channel-adapter/src/services/order-collection
```
Expected: 전부 PASS.

- [ ] **Step 9: 타입체크·커밋**

```bash
npm run type-check
git add apps/channel-adapter/src/services/order-collection
git commit -m "feat(channel-adapter): 주문 하나 즉시 끌어오기 syncOrder 와 force (#1016 5번 행)"
```

---

### Task 3: channel-adapter — 입구 컨트롤러

**Files:**
- Create: `apps/channel-adapter/src/controllers/channel-order-sync.controller.ts`
- Create: `apps/channel-adapter/src/controllers/channel-order-sync.controller.spec.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts` (비데모 `controllers` 배열, `OrderCollectionFailuresController` 옆)
- Modify: `apps/channel-adapter/CLAUDE.md` §3-5
- Modify: `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md` §9.1 (메모)

**Interfaces:**
- Consumes: `OrderPollerOrchestrator.syncOrder(channel, externalOrderId, { force })`, `OrderSyncOutcome`(Task 2)
- Produces: `POST /adapter/orders/:channel/:externalOrderId/sync` — 본문 `{ force?: boolean }`, 응답 `{ outcome: Exclude<OrderSyncOutcome, 'channel_inactive'> }`. 401(키), 400(채널·본문), 409(비활성 채널). Task 4 의 스크립트가 이 계약을 쓴다

- [ ] **Step 1: 컨트롤러 테스트를 쓴다** — `channel-order-sync.controller.spec.ts`

```ts
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ChannelOrderSyncController } from './channel-order-sync.controller';

function makeController(outcome = 'emitted', internalKey: string | undefined = 'internal-secret') {
  const orderPoller = { syncOrder: jest.fn().mockResolvedValue({ outcome }) };
  const config = { get: jest.fn().mockReturnValue(internalKey) };
  return { controller: new ChannelOrderSyncController(orderPoller as never, config as never), orderPoller };
}

describe('ChannelOrderSyncController', () => {
  it('내부 키가 맞으면 force 를 넘겨 끌어오고 결과를 돌려준다', async () => {
    const { controller, orderPoller } = makeController('emitted');
    await expect(controller.sync('Bearer internal-secret', 'medusa', 'order_1', { force: true })).resolves.toEqual({
      outcome: 'emitted',
    });
    expect(orderPoller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
  });

  it('본문이 없으면 force 는 false', async () => {
    const { controller, orderPoller } = makeController('unchanged');
    await controller.sync('Bearer internal-secret', 'naver', 'order_1', {});
    expect(orderPoller.syncOrder).toHaveBeenCalledWith('naver', 'order_1', { force: false });
  });

  it('틀린 키는 채널을 부르기 전에 401', async () => {
    const { controller, orderPoller } = makeController();
    await expect(controller.sync('Bearer wrong', 'medusa', 'order_1', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(orderPoller.syncOrder).not.toHaveBeenCalled();
  });

  it('키가 설정되지 않았으면 401', async () => {
    const { controller, orderPoller } = makeController('emitted', undefined);
    await expect(controller.sync('Bearer anything', 'medusa', 'order_1', {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(orderPoller.syncOrder).not.toHaveBeenCalled();
  });

  it('medusa·naver 밖의 채널은 400', async () => {
    const { controller, orderPoller } = makeController();
    await expect(controller.sync('Bearer internal-secret', 'coupang', 'order_1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(orderPoller.syncOrder).not.toHaveBeenCalled();
  });

  it('비활성 채널은 409', async () => {
    const { controller } = makeController('channel_inactive');
    await expect(controller.sync('Bearer internal-secret', 'medusa', 'order_1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx jest apps/channel-adapter/src/controllers/channel-order-sync.controller.spec.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 컨트롤러를 구현한다** — `channel-order-sync.controller.ts`

```ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { Public } from '@app/authorization';
import { OrderPollerOrchestrator, OrderSyncOutcome } from '../services/order-collection/order-poller.orchestrator';

const SYNCABLE_CHANNELS = ['medusa', 'naver'] as const;
type SyncableChannel = (typeof SYNCABLE_CHANNELS)[number];

function isSyncableChannel(value: string): value is SyncableChannel {
  return SYNCABLE_CHANNELS.some((channel) => channel === value);
}

export class SyncOrderBodyDto {
  @ApiPropertyOptional({ description: '해시가 같아도 OrderModified 를 낸다. 백필 전용' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@ApiTags('adapter-order-sync')
@ApiBearerAuth()
// 호출자는 운영 스크립트(백필)와, 나중에 운영자의 «채널 먼저» 흐름(#1016 35번 행)이라 사용자 JWT 가 없다.
// 전역 JwtAuthGuard 를 면제하는 대신 **모든 핸들러가** verifyInternalKey 로 CHANNEL_ADAPTER_INTERNAL_KEY 를
// 검증한다 — 핸들러를 더할 때 그 호출을 빠뜨리면 무인증으로 열린다.
@Public()
@Controller('adapter/orders')
export class ChannelOrderSyncController {
  private readonly logger = new Logger(ChannelOrderSyncController.name);

  constructor(
    private readonly orderPoller: OrderPollerOrchestrator,
    private readonly configService: ConfigService,
  ) {}

  @Post(':channel/:externalOrderId/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 주문 하나를 지금 다시 가져와 폴링과 같은 처리를 태운다 (#1016 5번 행)' })
  async sync(
    @Headers('authorization') authorization: string | undefined,
    @Param('channel') channel: string,
    @Param('externalOrderId') externalOrderId: string,
    @Body() body: SyncOrderBodyDto,
  ): Promise<{ outcome: Exclude<OrderSyncOutcome, 'channel_inactive'> }> {
    this.verifyInternalKey(authorization);
    if (!isSyncableChannel(channel)) {
      throw new BadRequestException(`Order sync is not supported for channel: ${channel}`);
    }
    const { outcome } = await this.orderPoller.syncOrder(channel, externalOrderId, { force: body?.force === true });
    if (outcome === 'channel_inactive') {
      throw new ConflictException(`Channel ${channel} is inactive (sales_channels.is_active=false)`);
    }
    return { outcome };
  }

  private verifyInternalKey(authorization: string | undefined): void {
    const internalKey = this.configService.get<string>('CHANNEL_ADAPTER_INTERNAL_KEY');
    if (!internalKey) {
      this.logger.error('CHANNEL_ADAPTER_INTERNAL_KEY is not configured.');
      throw new UnauthorizedException('Internal key not configured');
    }
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (token !== internalKey) throw new UnauthorizedException('Invalid internal key');
  }
}
```

`syncOrder` 의 `channel` 은 `SalesChannel` 이다 — `SyncableChannel`(`'medusa' | 'naver'`)이 그 부분집합이 아니면 type-check 가 알려준다. 그때는 `SalesChannel` 정의(`packages/event-contracts/streams`)를 보고 맞춘다.

`adapter.module.ts`: import 를 더하고, 비데모 갈래의 `controllers` 배열에서 `OrderCollectionFailuresController,` 바로 다음 줄에 `ChannelOrderSyncController,` 를 넣는다.

- [ ] **Step 4: 통과 확인**

```bash
npx jest apps/channel-adapter/src/controllers/channel-order-sync.controller.spec.ts scripts/security
```
Expected: 전부 PASS. `scripts/security/route-authz-audit*` 가 새 `@Public` 쓰기 라우트를 문제 삼으면, 그 스펙이 «키 검증 있는 공개 라우트» 를 어떻게 인정하는지(예: 검토 목록) 읽고 그 방식대로 등록한다 — 키 검증을 빼거나 테스트를 약하게 만들지 않는다.

- [ ] **Step 5: 문서를 갱신한다**

`apps/channel-adapter/CLAUDE.md` §3-5 의 `OrderModified` 문장(88행 근처) 바로 다음 줄에:

```markdown
- 주문 하나를 지금 다시 끌어오는 입구: `POST /adapter/orders/:channel/:externalOrderId/sync`(내부 키, 본문 `{ force?: boolean }`). 폴링과 같은 `processOrderItem` + lifecycle 을 타고 워터마크는 건드리지 않는다. `force` 는 해시가 같아도 `OrderModified` 를 낸다(백필 전용). 지원 `medusa`·`naver`, 비활성 채널은 409.
```

스펙 §9.1 의 목록 끝(«같은 주문을 폴러가 동시에…» 항목 다음)에:

```markdown
> **계획 단계 수정(PR 2, 2026-10-05):** 응답 `outcome` 에 셋을 더했다 — `not_eligible`(수집 대상이 아닌 미수집 주문),
> `identification_failed`(번역이 식별 실패를 냄 — 폴링과 같이 미수집이면 격리, 수집됐으면 열린 격리를 닫는다),
> 그리고 비활성 채널은 409(폴링의 킬스위치와 같은 뜻). 주문을 먼저, 그 주문의 lifecycle 을 이어서 처리한다.
```

- [ ] **Step 6: 타입체크·커밋**

```bash
npm run type-check
git add apps/channel-adapter/src/controllers/channel-order-sync.controller.ts apps/channel-adapter/src/controllers/channel-order-sync.controller.spec.ts apps/channel-adapter/src/adapter.module.ts apps/channel-adapter/CLAUDE.md docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md
git commit -m "feat(channel-adapter): 주문 즉시 끌어오기 입구 POST /adapter/orders/:channel/:externalOrderId/sync (#1016 5번 행)"
```

---

### Task 4: 백필 스크립트

**Files:**
- Create: `scripts/ops/1016-backfill-targets.ts`
- Create: `scripts/ops/1016-backfill-targets.spec.ts`
- Create: `scripts/ops/1016-backfill-channel-order-modifications.ts`
- Modify: `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md` §9.2 (메모)

**Interfaces:**
- Consumes: Task 3 의 입구 계약(경로·본문·응답·상태코드)
- Produces:
  - `export const FINISHED_SALES_ORDER_STATUSES: readonly string[]` = `['cancelled', 'timeout', 'shipped', 'delivered']`
  - `export interface QuarantinedModification { channel: string; externalOrderId: string }`
  - `export interface CoreSalesOrderStatus { salesChannel: string; channelOrderId: string; status: string }`
  - `export interface BackfillSelection { targets: QuarantinedModification[]; skipped: Array<QuarantinedModification & { reason: string }> }`
  - `export function selectBackfillTargets(quarantined: QuarantinedModification[], salesOrders: CoreSalesOrderStatus[]): BackfillSelection`
  - `export function countByReason(skipped: BackfillSelection['skipped']): Record<string, number>`

- [ ] **Step 1: 순수 함수 테스트를 쓴다** — `scripts/ops/1016-backfill-targets.spec.ts`

```ts
import { countByReason, selectBackfillTargets } from './1016-backfill-targets';

const q = (externalOrderId: string, channel = 'medusa') => ({ channel, externalOrderId });
const so = (channelOrderId: string, status: string, salesChannel = 'medusa') => ({ salesChannel, channelOrderId, status });

describe('selectBackfillTargets (#1016 5번 행, 스펙 §9.2)', () => {
  it('끝나지 않은 판매주문만 대상이다 — pending·confirmed·processing', () => {
    const result = selectBackfillTargets(
      [q('a'), q('b'), q('c')],
      [so('a', 'pending'), so('b', 'confirmed'), so('c', 'processing')],
    );
    expect(result.targets).toEqual([q('a'), q('b'), q('c')]);
    expect(result.skipped).toEqual([]);
  });

  it('취소·만료·출고 표시(셀메이트 shipped 포함)·배송완료는 뺀다', () => {
    const result = selectBackfillTargets(
      [q('a'), q('b'), q('c'), q('d')],
      [so('a', 'cancelled'), so('b', 'timeout'), so('c', 'shipped'), so('d', 'delivered')],
    );
    expect(result.targets).toEqual([]);
    expect(countByReason(result.skipped)).toEqual({
      'status:cancelled': 1,
      'status:timeout': 1,
      'status:shipped': 1,
      'status:delivered': 1,
    });
  });

  it('판매주문이 없으면 뺀다 — 보내면 core 가 NotFound 로 DLQ 에 쌓는다', () => {
    const result = selectBackfillTargets([q('a')], []);
    expect(result.targets).toEqual([]);
    expect(result.skipped).toEqual([{ ...q('a'), reason: 'no_sales_order' }]);
  });

  it('채널이 다르면 같은 주문번호라도 짝짓지 않는다', () => {
    const result = selectBackfillTargets([q('a', 'naver')], [so('a', 'pending', 'medusa')]);
    expect(result.skipped).toEqual([{ ...q('a', 'naver'), reason: 'no_sales_order' }]);
  });

  it('입구가 지원하지 않는 채널은 뺀다', () => {
    const result = selectBackfillTargets([q('a', 'coupang')], [so('a', 'pending', 'coupang')]);
    expect(result.skipped).toEqual([{ ...q('a', 'coupang'), reason: 'unsupported_channel' }]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx jest scripts/ops/1016-backfill-targets.spec.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 순수 함수를 구현한다** — `scripts/ops/1016-backfill-targets.ts`

```ts
/**
 * #1016 5번 행 백필의 대상 선별 (스펙 §9.2). 순수 함수 — DB·HTTP 는 실행 스크립트가 한다.
 *
 * channel-adapter 는 core DB 를 못 읽으므로 «끝나지 않은 판매주문» 판정은 여기서 한다.
 * core diff 는 cancelled·timeout 만 건너뛰고 shipped·delivered 는 건너뛰지 않는다 — 셀메이트가
 * shipped 로 찍은 주문(2026-10-05 기준 격리의 96%)을 보내면 대기 목록을 출고된 주문으로 채운다.
 */

export const FINISHED_SALES_ORDER_STATUSES: readonly string[] = ['cancelled', 'timeout', 'shipped', 'delivered'];
const SYNCABLE_CHANNELS: readonly string[] = ['medusa', 'naver'];

export interface QuarantinedModification {
  channel: string;
  externalOrderId: string;
}

export interface CoreSalesOrderStatus {
  salesChannel: string;
  channelOrderId: string;
  status: string;
}

export interface BackfillSelection {
  targets: QuarantinedModification[];
  skipped: Array<QuarantinedModification & { reason: string }>;
}

export function selectBackfillTargets(
  quarantined: QuarantinedModification[],
  salesOrders: CoreSalesOrderStatus[],
): BackfillSelection {
  const statusByKey = new Map(salesOrders.map((row) => [`${row.salesChannel}:${row.channelOrderId}`, row.status]));
  const selection: BackfillSelection = { targets: [], skipped: [] };
  for (const row of quarantined) {
    if (!SYNCABLE_CHANNELS.includes(row.channel)) {
      selection.skipped.push({ ...row, reason: 'unsupported_channel' });
      continue;
    }
    const status = statusByKey.get(`${row.channel}:${row.externalOrderId}`);
    if (status === undefined) {
      selection.skipped.push({ ...row, reason: 'no_sales_order' });
      continue;
    }
    if (FINISHED_SALES_ORDER_STATUSES.includes(status)) {
      selection.skipped.push({ ...row, reason: `status:${status}` });
      continue;
    }
    selection.targets.push(row);
  }
  return selection;
}

export function countByReason(skipped: BackfillSelection['skipped']): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of skipped) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS

- [ ] **Step 5: 실행 스크립트를 쓴다** — `scripts/ops/1016-backfill-channel-order-modifications.ts`

```ts
/**
 * #1016 5번 행 백필(스펙 §9.2, R8) — PR 1·PR 2 배포 **뒤 한 번**.
 *
 * 격리(`collected_order_modification_not_accepted`·`quarantined`) 중 core 판매주문이 끝나지 않은 주문만
 * 즉시 끌어오기 입구에 `force: true` 로 보낸다. 실제 주소 변경은 반영되고, 오탐(우리 쪽 식별만 바뀜)은
 * core 가 기록 없이 버린다. 격리 행은 닫지 않는다(6번 행 몫).
 *
 * 이 스크립트는 DB 에 쓰지 않는다 — 두 연결 모두 읽기 전용이다. 쓰기는 입구(channel-adapter)가 한다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   # 대상만 센다 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-backfill-channel-order-modifications.ts
 *   # 실제 실행
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-backfill-channel-order-modifications.ts \
 *     --apply --base-url https://channel-adapter.almondyoung.com
 */
import postgres from 'postgres';
import { Resource } from 'sst';
import {
  CoreSalesOrderStatus,
  QuarantinedModification,
  countByReason,
  selectBackfillTargets,
} from './1016-backfill-targets';

const APPLY = process.argv.includes('--apply');
const BASE_URL = argValue('--base-url');
const PAUSE_MS = 300;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// `Resource` 의 타입 선언에는 `Db`·시크릿이 없다(SST 가 실행 시점에 채운다). 기존 ops 스크립트
// (647-close-already-collected-quarantines.ts)와 같은 이유로 캐스팅한다.
const linked = Resource as unknown as {
  Db: { host: string; port: number; username: string; password: string };
  ChannelAdapterInternalKey?: { value: string };
};

function connect(database: string) {
  return postgres({
    host: linked.Db.host,
    port: linked.Db.port,
    username: linked.Db.username,
    password: linked.Db.password,
    database,
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
    // 이 스크립트는 읽기만 한다 — 실수로 쓰는 문장이 들어와도 서버가 거절하게 한다.
    connection: { default_transaction_read_only: 'on' },
  });
}

async function loadQuarantined(): Promise<QuarantinedModification[]> {
  const sql = connect('channel_adapter');
  try {
    return await sql<QuarantinedModification[]>`
      SELECT channel, external_order_id AS "externalOrderId"
      FROM order_collection_failures
      WHERE reason = 'collected_order_modification_not_accepted' AND status = 'quarantined'
      ORDER BY created_at`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function loadSalesOrders(rows: QuarantinedModification[]): Promise<CoreSalesOrderStatus[]> {
  if (rows.length === 0) return [];
  const sql = connect('core');
  try {
    return await sql<CoreSalesOrderStatus[]>`
      SELECT sales_channel AS "salesChannel", channel_order_id AS "channelOrderId", status::text AS status
      FROM sales_orders
      WHERE channel_order_id = ANY(${rows.map((row) => row.externalOrderId)})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function syncOne(baseUrl: string, key: string, row: QuarantinedModification): Promise<string> {
  const url = `${baseUrl}/adapter/orders/${encodeURIComponent(row.channel)}/${encodeURIComponent(row.externalOrderId)}/sync`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ force: true }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  const parsed: unknown = JSON.parse(text);
  const outcome = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'outcome') : undefined;
  return typeof outcome === 'string' ? outcome : `unexpected body: ${text.slice(0, 300)}`;
}

async function main(): Promise<void> {
  console.log(`모드: ${APPLY ? '실행 (--apply)' : '대상만 센다 — 실행하려면 --apply --base-url <channel-adapter URL>'}\n`);

  const quarantined = await loadQuarantined();
  const { targets, skipped } = selectBackfillTargets(quarantined, await loadSalesOrders(quarantined));
  console.log(`격리 ${quarantined.length}건 → 대상 ${targets.length}건, 제외 ${skipped.length}건`);
  console.table(countByReason(skipped));
  // 무엇을 승인했는지 확인할 수 있게 대상 행을 전부 찍는다.
  for (const row of targets) console.log(`  ${row.channel}  ${row.externalOrderId}`);

  if (!APPLY) return;
  if (!BASE_URL) throw new Error('--apply 에는 --base-url 이 필요하다 (예: https://channel-adapter.almondyoung.com)');
  const key = linked.ChannelAdapterInternalKey?.value ?? process.env.CHANNEL_ADAPTER_INTERNAL_KEY;
  if (!key) throw new Error('ChannelAdapterInternalKey 를 읽지 못했다 — sst shell 안에서 돌리거나 CHANNEL_ADAPTER_INTERNAL_KEY 를 넘긴다');

  const outcomes: Record<string, number> = {};
  let failed = 0;
  for (const row of targets) {
    try {
      const outcome = await syncOne(BASE_URL.replace(/\/+$/, ''), key, row);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      console.log(`  ✓ ${row.externalOrderId}  ${outcome}`);
    } catch (error) {
      failed++;
      console.log(`  ✗ ${row.externalOrderId}  ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  console.log('\n결과');
  console.table(outcomes);
  if (failed > 0) {
    console.log(`실패 ${failed}건 — 같은 명령을 다시 돌려도 안전하다(이미 반영된 주문은 core 가 실질 차이 0 으로 버린다).`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

> `ANY(${array})` 는 postgres.js 가 배열을 그대로 바인딩한다(기존 `scripts/sellmate/mark-shipped-from-csv.ts` 와 같은 쓰임). `sales_orders` 는 채널을 함께 걸지 않고 주문번호로만 가져온 뒤 순수 함수가 `(채널, 주문번호)` 로 짝짓는다.

- [ ] **Step 6: 타입체크를 확인한다** — 루트 `type-check`(`tsconfig.json`)는 `scripts/` 를 포함한다.

```bash
npm run type-check
```
Expected: 에러 0.

- [ ] **Step 7: 스펙 §9.2 에 메모를 더한다** — §9.2 의 «격리 행은 닫지 않는다(6번 행)» 항목 다음에:

```markdown
> **계획 단계 수정(PR 2, 2026-10-05):** «끝나지 않은» = 판매주문 status 가 `cancelled`·`timeout`·`shipped`·`delivered` 가
> 아닌 것. core diff 는 `shipped`·`delivered` 를 건너뛰지 않으므로 스크립트가 거른다. 판매주문이 없는 격리도 뺀다(보내면
> NotFound → DLQ). 스크립트는 `sst shell` 안에서 channel_adapter·core 를 읽기 전용으로 읽고, 쓰기는 입구가 한다.
> 스크립트: `scripts/ops/1016-backfill-channel-order-modifications.ts`.
```

- [ ] **Step 8: 커밋**

```bash
git add scripts/ops/1016-backfill-targets.ts scripts/ops/1016-backfill-targets.spec.ts scripts/ops/1016-backfill-channel-order-modifications.ts docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md
git commit -m "feat(ops): 수집 뒤 변경 격리 백필 스크립트 — 끝나지 않은 판매주문만 force 끌어오기 (#1016 5번 행)"
```

---

## 마무리 (메인 세션)

- 전체 게이트: `npm run type-check` · `npx jest --maxWorkers=2` · Task 1 통합 스펙(core_sdd_1016)
- PR 본문에 «착수 전 판단» 1~3 과 배포 절차를 싣는다:
  1. PR 1(#1017)·PR 2 를 함께 배포(마이그레이션은 PR 1 의 추가뿐 → `migrate → deploy`)
  2. 배포 확인 뒤 백필 dry-run 으로 대상 수 재확인 → 사람이 `--apply`
- #1016 5번 행의 문서 칸에 이 계획 경로를 더한다(진행 상태·수치는 적지 않는다)
