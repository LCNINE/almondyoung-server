# 대기 변경 닫기와 옛 격리 종결 (#1016 6번 행) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 «반영 대기 변경»을 «무시»·«다시 확인»으로 닫을 수 있고, 무시한 똑같은 차이는 다시 뜨지 않으며, 옛 «수집 후 변경» 격리 행은 일괄 종결된다.

**Architecture:** core `sales_order_amendments` 에 `dismissed` 상태와 칸 넷을 더한다. «다시 확인»은 core 가 새 명령 스트림 `channel-orders.commands.v1` 에 `ResyncChannelOrder` 를 outbox 로 내고, channel-adapter 가 소비해 5번 행의 `syncOrder(…, { force: true })` 를 탄다 — core 는 channel-adapter 를 직접 부르지 않는다. 무시 억제는 `ChannelOrderChangeManager.handle` 이 기록 직전에 순수 함수로 판정한다.

**Tech Stack:** NestJS, Drizzle(postgres.js), `@app/events`(outbox·`@On`), zod 계약(`packages/event-contracts`), Next.js admin-web(TanStack Query), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-channel-change-close-design.md`

## Global Constraints

- 브랜치: `feat/1016-channel-change-close` (develop 에서). 모든 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G`
- core 는 channel-adapter 를 HTTP 로 부르지 않는다 — 요청은 `channel-orders.commands.v1` 명령으로만(스펙 D2)
- 토픽 이름 `channel-orders.commands.v1`, 명령 이름 `ResyncChannelOrder`, 파티션 키 `${salesChannel}:${externalOrderId}`(스펙 D3·§7.1)
- amendment `status` 값은 `applied`·`pending`·`superseded`·`dismissed` 넷. 무시·다시 확인은 `origin = channel` 이고 `status = pending` 인 행만, 아니면 `ConflictError`(409), 없으면 `NotFoundError`(404)
- 델타 지문은 `outcome`·`blockers` 를 뺀 키 정렬 JSON(스펙 §6.1). 비교 상대는 그 판매주문의 **가장 최근** `dismissed` 채널 행 하나(§6.2)
- 옛 격리 종결 상태값 `closed_obsolete`. 대상은 `reason = 'collected_order_modification_not_accepted' AND status = 'quarantined'`
- 마이그레이션은 추가·넓히기뿐 → 배포 순서 `migrate → deploy`
- 서비스는 `@app/shared` 도메인 예외만 던진다(`HttpException` 금지). 컨트롤러는 try/catch 로 상태를 매핑하지 않는다
- `any`·`as` 캐스팅 금지(근거 주석이 있는 기존 패턴 제외). Inventory 스키마 쿼리는 `db.query.*` 금지, `select().from()…` 형태
- admin-web 문구는 최소로, 판정·문구는 `.ts` 순수 함수(컴포넌트 테스트 불가). 작업자·운영자 문구에 설명 문장을 더하지 않는다
- 게이트: `npm run type-check` 0 · `npx jest` 실패 0 · `cd apps/admin-web && npx tsc --noEmit` 0 · `npm run test:admin-web` 실패 0. 통합 스펙은 `describeIfDb` 가드, 실행은 `npm run test:core:integration:local -- <패턴>`

## Review Focus

1. **겹친 무시 클릭·superseded 직후 무시** — 첫 클릭이 이미 닫았거나 그 사이 채널 이벤트가 행을 superseded 로 바꿨으면 409 가 나고 화면은 목록을 다시 불러 새 상태를 보여 줘야 한다(Task 5 통합 테스트 «superseded 행 무시 → 409», Task 8 은 버튼 비활성·409 시 invalidate)
2. **무시 뒤 자동 반영 가능한 변경만 옴** — 무시 행이 있는 주문에 주소 변경(반영 가능)만 오면 applied 행 하나가 생기고 무시 행은 그대로 `dismissed` 여야 한다(Task 4 통합 테스트)
3. **지원하지 않는 채널의 다시 확인** — `3pl`·`coupang` 주문 행에서 다시 확인을 눌러도 소비자가 던지지 않고(DLQ 에 쌓이지 않고) 로그만 남긴다(Task 6 단위 테스트)
4. **채널 키가 없는 채널 행** — `metadata.salesChannel`·`externalOrderId` 가 비면 명령을 내지 않고 `Error`(500)로 실패해야 한다. 빈 키로 명령을 내면 소비자가 엉뚱한 조회를 한다(Task 5 순수 함수 테스트)
5. **지문의 키 순서·중첩** — 같은 주소 델타가 jsonb 왕복으로 키 순서가 바뀌어도(배송지 `before`·`after` 중첩 객체) 같은 지문이어야 한다(Task 3 테스트)

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `packages/event-contracts/streams/channel-orders-command.stream.ts`(신규) | 명령 스트림 계약·파티션 키 함수 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-change-dismissal.ts`(신규) | `deltaFingerprint`·`suppressDismissed` 순수 함수 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.service.ts`(신규) | 무시·다시 확인(잠금·상태 판정·outbox), `channelKeyOf` 순수 함수 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts` | `latestDismissedChannelDeltas` 추가 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts` | 기록 직전 억제 호출 |
| `apps/core/src/modules/sales-order/controllers/sales-order-amendments.controller.ts`·`dto/dismiss-sales-order-amendment.dto.ts`(신규) | 두 엔드포인트 |
| `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts`(신규) | `ResyncChannelOrder` 소비 |
| `apps/channel-adapter/src/services/order-collection/syncable-channels.ts`(신규) | `SYNCABLE_CHANNELS`·`isSyncableChannel` 공유 |
| `scripts/ops/1016-close-obsolete-modification-quarantines.ts`(신규) | 옛 격리 일괄 종결 |
| `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.shape.ts`·`.client.ts`, `lib/services/orders/mutations.ts`, `features/mall/pending-changes/…`, `features/order/history/components/table/index.tsx` | 화면 |

**스펙과 다르게 가는 곳(계획 단계 수정, Task 9 가 스펙에 적는다):**
- 무시·다시 확인을 `SalesOrderAmendmentsService` 가 아니라 새 `ChannelAmendmentActionsService` 에 둔다. 기존 서비스 생성자에 발행자를 더하면 그 서비스를 `new` 로 만드는 통합 스펙 10곳을 모두 고쳐야 하고, 운영자 경로(`create`)와 채널 행 조치는 책임이 다르다
- 주문 상세의 무시 표시는 «무시됨 · 시각 · 메모». `dismissed_by`(uuid)는 저장하되 이름으로 바꿀 조회가 admin-web 에 없어 표시하지 않는다
- 스크립트는 분기가 없어(고정 조건 한 문장) 단위 테스트 대신 dry-run 출력으로 확인한다. `647-close-already-collected-quarantines.ts` 와 같은 꼴

---

### Task 1: 명령 스트림 계약

**Files:**
- Create: `packages/event-contracts/streams/channel-orders-command.stream.ts`
- Modify: `packages/event-contracts/streams/index.ts` (Wallet Command Stream export 아래)
- Modify: `packages/event-contracts/streams/registry.spec.ts:15-31` (`EXPECTED_TOPICS`)
- Test: `packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts`

**Interfaces:**
- Produces: `CHANNEL_ORDERS_COMMAND_STREAM`(topic `channel-orders.commands.v1`, event `ResyncChannelOrder`), `ResyncChannelOrderPayload { salesChannel: string; externalOrderId: string; requestedAt: string }`, `channelOrderPartitionKey(salesChannel: string, externalOrderId: string): string`

- [ ] **Step 1: 실패하는 테스트**

`packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts`:

```ts
import { CHANNEL_ORDERS_COMMAND_STREAM, channelOrderPartitionKey } from '../channel-orders-command.stream';

describe('CHANNEL_ORDERS_COMMAND_STREAM', () => {
  it('역할 이름의 명령 토픽이다 — 서비스 이름(channel-adapter)을 담지 않는다', () => {
    expect(CHANNEL_ORDERS_COMMAND_STREAM.topic.topic).toBe('channel-orders.commands.v1');
    expect(CHANNEL_ORDERS_COMMAND_STREAM.topic.topic).not.toContain('adapter');
  });

  it('ResyncChannelOrder 스키마는 채널·주문 id·ISO 시각을 요구한다', () => {
    const schema = CHANNEL_ORDERS_COMMAND_STREAM.events.ResyncChannelOrder.schema!;
    expect(() =>
      schema.parse({ salesChannel: 'medusa', externalOrderId: 'order_1', requestedAt: '2026-10-06T00:00:00.000Z' }),
    ).not.toThrow();
    expect(() => schema.parse({ salesChannel: '', externalOrderId: 'order_1', requestedAt: '2026-10-06T00:00:00.000Z' })).toThrow();
    expect(() => schema.parse({ salesChannel: 'medusa', externalOrderId: '', requestedAt: '2026-10-06T00:00:00.000Z' })).toThrow();
    expect(() => schema.parse({ salesChannel: 'medusa', externalOrderId: 'order_1', requestedAt: 'yesterday' })).toThrow();
  });

  it('파티션 키는 채널:주문 id — 같은 주문의 명령이 한 파티션으로 간다', () => {
    expect(channelOrderPartitionKey('naver', '2026100612345')).toBe('naver:2026100612345');
  });
});
```

`registry.spec.ts` 의 `EXPECTED_TOPICS` 에 `'channel-adapter.events.v1',` 바로 다음 줄로 `'channel-orders.commands.v1',` 를 넣는다.

- [ ] **Step 2: 실패 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts packages/event-contracts/streams/registry.spec.ts`
Expected: FAIL — `Cannot find module '../channel-orders-command.stream'`, registry 는 토픽 목록 불일치

- [ ] **Step 3: 구현**

`packages/event-contracts/streams/channel-orders-command.stream.ts`:

```ts
/**
 * Channel Orders Command Stream (#1016 6번 행)
 *
 * 명령 스트림이다 — «일어난 사실»이 아니라 실행자가 하나인 «요청». core 는 channel-adapter 를
 * 직접 부르지 않는다(channel-adapter 는 외부 세계의 일을 이벤트로 번역해 브로커에 던지는 자리다).
 * 그래서 토픽 이름은 서비스가 아니라 역할로 짓는다 — core 는 «채널 주문을 다룰 줄 아는 누군가»에게
 * 요청할 뿐 그게 누구인지 모른다. 기존 `wallet.commands.v1`(받는 쪽 이름)·`ugc.commands.v1`(보내는 쪽
 * 이름)과 기준이 다른 이유다. 명령 이름은 명령형(`CreateInvoice` 와 같은 꼴).
 *
 * 파티션 키 = `channelOrderPartitionKey` — 같은 주문의 명령(나중의 35번 행 취소 요청 포함)이 순서대로 처리된다.
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Command Payloads =====

/** 그 채널 주문의 지금 상태를 다시 가져와 수집 경로(`OrderModified`)로 흘려 달라는 요청. */
export interface ResyncChannelOrderPayload {
  /** 'medusa' | 'naver' … — 문자열로 두고, 지원 여부는 소비자가 판정한다 */
  salesChannel: string;
  externalOrderId: string;
  /** ISO 8601 */
  requestedAt: string;
}

// ===== Zod Schemas =====

const ResyncChannelOrderSchema = z.object({
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  requestedAt: z.string().datetime(),
});

// ===== Stream Config =====

export const CHANNEL_ORDERS_COMMAND_STREAM = stream({
  topic: 'channel-orders.commands.v1',
  partitions: 3,
  aggregateType: 'ChannelOrder',
  events: {
    ResyncChannelOrder: event<'ResyncChannelOrder', ResyncChannelOrderPayload>(
      'ResyncChannelOrder',
      ResyncChannelOrderSchema,
    ),
  },
});

export type ChannelOrdersCommandEvents = typeof CHANNEL_ORDERS_COMMAND_STREAM.events;

export function channelOrderPartitionKey(salesChannel: string, externalOrderId: string): string {
  return `${salesChannel}:${externalOrderId}`;
}
```

`packages/event-contracts/streams/index.ts` 끝의 Wallet Command Stream export 다음에:

```ts

// Channel Orders Command Stream (#1016 6번 행)
export * from './channel-orders-command.stream';
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts packages/event-contracts/streams/registry.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/event-contracts/streams/channel-orders-command.stream.ts packages/event-contracts/streams/index.ts packages/event-contracts/streams/registry.spec.ts packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts
git commit -m "feat(event-contracts): channel-orders.commands.v1 명령 스트림 — ResyncChannelOrder (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 2: amendment 스키마 — `dismissed` 와 칸 넷

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:1468-1500` (`salesOrderAmendments`)
- Create: `apps/core/drizzle/<timestamp>_add-amendment-dismiss-resync.sql` + `apps/core/drizzle/meta/*` (생성)
- Modify: `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts:21-33,295-305` (`AmendmentStatus`, `AmendmentListItem`, `list` select)
- Modify: `apps/core/src/modules/sales-order/dto/list-sales-order-amendments.dto.ts:6-9`
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-amendment-response.dto.ts:44-51`
- Test: `apps/core/src/modules/sales-order/services/sales-order-amendments.channel.integration.spec.ts`

**Interfaces:**
- Produces: `salesOrderAmendments` 칸 `dismissedAt: Date | null`, `dismissedBy: string | null`(uuid), `dismissNote: string | null`, `resyncRequestedAt: Date | null`; `status` 타입 `'applied' | 'pending' | 'superseded' | 'dismissed'`; `AmendmentStatus` 에 `'dismissed'`; `AmendmentListItem.resyncRequestedAt: Date | null`

> ⚠️ `db:generate:core` 는 메인 세션이 돌린다(서브에이전트 환경에서 실패한 이력). 구현자가 서브에이전트면 Step 3 의 generate 만 메인에 넘긴다.

- [ ] **Step 1: 실패하는 테스트** — `sales-order-amendments.channel.integration.spec.ts` 의 마지막 `it` 다음에 추가:

```ts
  it('dismissed 는 목록 status 필터로 따로 보이고 pending 목록에서는 빠진다. resyncRequestedAt 이 목록에 실린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const soId = await salesOrder(tx);
      const dismissedId = await record(service, soId, [PENDING], tx);
      await tx
        .update(wmsTables.salesOrderAmendments)
        .set({ status: 'dismissed', dismissedAt: new Date(), dismissNote: '채널 쪽 오류' })
        .where(eq(wmsTables.salesOrderAmendments.id, dismissedId));
      const otherSo = await salesOrder(tx);
      const pendingId = await record(service, otherSo, [PENDING], tx);
      const requestedAt = new Date('2026-10-06T01:00:00.000Z');
      await tx
        .update(wmsTables.salesOrderAmendments)
        .set({ resyncRequestedAt: requestedAt })
        .where(eq(wmsTables.salesOrderAmendments.id, pendingId));

      const dismissed = await service.list({ status: 'dismissed', origin: 'channel', limit: 50 }, tx);
      const pending = await service.list({ status: 'pending', origin: 'channel', limit: 50 }, tx);
      expect(dismissed.items.map((item) => item.id)).toContain(dismissedId);
      expect(pending.items.map((item) => item.id)).not.toContain(dismissedId);
      expect(pending.items.find((item) => item.id === pendingId)?.resyncRequestedAt).toEqual(requestedAt);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run type-check`
Expected: FAIL — `dismissedAt`·`dismissNote`·`resyncRequestedAt` 가 테이블에 없음, `status: 'dismissed'` 가 타입에 없음

- [ ] **Step 3: 스키마·마이그레이션**

`inventory.schema.ts` 의 `status` 줄과 `createdBy` 줄을 고친다:

```ts
    status: varchar('status', { length: 16 })
      .$type<'applied' | 'pending' | 'superseded' | 'dismissed'>()
      .notNull()
      .default('pending'),
```

`supersededById` 정의 다음, `createdBy` 앞에:

```ts
    // #1016 6번 행: 운영자가 «어긋난 채 둔다»고 닫은 채널 행. 이 행의 pending 델타와 똑같은 차이는 다시 띄우지 않는다.
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by'),
    dismissNote: text('dismiss_note'),
    // 마지막 «다시 확인»(ResyncChannelOrder 명령) 시각. 결과는 돌아오지 않으므로 화면이 이 시각을 보여 준다.
    resyncRequestedAt: timestamp('resync_requested_at', { withTimezone: true }),
```

`statusCheck`:

```ts
    statusCheck: check(
      'sales_order_amendments_status_check',
      sql`${t.status} IN ('applied', 'pending', 'superseded', 'dismissed')`,
    ),
```

Run: `npm run db:generate:core -- --name add-amendment-dismiss-resync`
생성된 SQL 을 열어 이 넷만 있는지 본다: `ALTER TABLE "sales_order_amendments" DROP CONSTRAINT "sales_order_amendments_status_check"` · `ADD COLUMN` 4개(전부 nullable) · `ADD CONSTRAINT "sales_order_amendments_status_check" CHECK (… 'dismissed')`. 다른 테이블 변경이 섞였으면 생성물을 지우고 원인(로컬 스냅샷 잔재)을 먼저 푼다.

- [ ] **Step 4: 서비스·DTO 타입**

`sales-order-amendments.service.ts`:

```ts
export type AmendmentStatus = 'applied' | 'pending' | 'superseded' | 'dismissed';
```

`AmendmentListItem` 에 `occurredAt: Date;` 다음 줄로:

```ts
  resyncRequestedAt: Date | null;
```

`list` 의 `.select({ … })` 에 `occurredAt: table.occurredAt,` 다음 줄로:

```ts
        resyncRequestedAt: table.resyncRequestedAt,
```

`list-sales-order-amendments.dto.ts`:

```ts
  @ApiPropertyOptional({ enum: ['applied', 'pending', 'superseded', 'dismissed'] })
  @IsOptional()
  @IsIn(['applied', 'pending', 'superseded', 'dismissed'])
  status?: 'applied' | 'pending' | 'superseded' | 'dismissed';
```

`sales-order-amendment-response.dto.ts` 의 `status` enum 을 `['applied', 'pending', 'superseded', 'dismissed']` 로, `supersededById` 다음에:

```ts
  @ApiProperty({ description: '무시한 시각', nullable: true })
  dismissedAt: Date | null;

  @ApiProperty({ description: '무시한 운영자 ID', nullable: true })
  dismissedBy: string | null;

  @ApiProperty({ description: '무시 메모', nullable: true })
  dismissNote: string | null;

  @ApiProperty({ description: '마지막 다시 확인 요청 시각', nullable: true })
  resyncRequestedAt: Date | null;
```

- [ ] **Step 5: 통과 확인**

Run: `npm run type-check` → 에러 0
Run: `npm run test:core:integration:local -- sales-order-amendments.channel.integration` → PASS (러너가 로컬 core DB 에 마이그를 적용한다)

- [ ] **Step 6: 커밋** (schema + SQL + meta 를 한 커밋에 — CLAUDE.md)

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts apps/core/src/modules/sales-order/dto/list-sales-order-amendments.dto.ts apps/core/src/modules/sales-order/dto/sales-order-amendment-response.dto.ts apps/core/src/modules/sales-order/services/sales-order-amendments.channel.integration.spec.ts
git commit -m "feat(core): amendment 에 dismissed 상태와 무시·다시 확인 칸 (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 3: 무시 억제 순수 함수

**Files:**
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-change-dismissal.ts`
- Test: `apps/core/src/modules/sales-order/channel-order-change/channel-change-dismissal.spec.ts`

**Interfaces:**
- Consumes: `RecordedChannelDelta`(`channel-order-change.types.ts`)
- Produces: `deltaFingerprint(delta: object): string`, `suppressDismissed(recorded: RecordedChannelDelta[], dismissedDeltas: readonly unknown[] | null): RecordedChannelDelta[]`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { deltaFingerprint, suppressDismissed } from './channel-change-dismissal';
import type { RecordedChannelDelta } from './channel-order-change.types';

const ADD: RecordedChannelDelta = {
  type: 'add_product',
  channelOrderItemId: 'ci-9',
  channelProductId: 'cp-9',
  quantity: 1,
  unitPrice: 1000,
  outcome: 'pending',
  blockers: [{ code: 'OUT_OF_SCOPE' }],
};
const UP: RecordedChannelDelta = {
  type: 'quantity_correction',
  salesOrderLineId: 'sol-1',
  channelOrderItemId: 'ci-1',
  quantityBefore: 1,
  correctedQuantity: 3,
  outcome: 'pending',
  blockers: [{ code: 'OUT_OF_SCOPE' }],
};
const ADDRESS_APPLIED: RecordedChannelDelta = {
  type: 'shipping_address_change',
  before: { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' },
  after: { recipientName: '김', phone: '010', postalCode: '2', roadAddress: '부산', detailAddress: '2' },
  outcome: 'applied',
};

describe('deltaFingerprint', () => {
  it('막힌 사유·결과는 지문 밖이다 — 무시는 «이 차이»를 받아들인 것', () => {
    const later = { ...ADD, blockers: [{ code: 'WAYBILL_ISSUED', shipmentId: 'sh-1' }] };
    expect(deltaFingerprint(later)).toBe(deltaFingerprint(ADD));
    const { outcome: _o, blockers: _b, ...bare } = ADD;
    expect(deltaFingerprint(bare)).toBe(deltaFingerprint(ADD));
  });

  it('값이 다르면 지문이 다르다', () => {
    expect(deltaFingerprint({ ...ADD, quantity: 2 })).not.toBe(deltaFingerprint(ADD));
  });

  it('중첩 객체의 키 순서가 달라도(jsonb 왕복) 같은 지문', () => {
    const reordered = {
      outcome: 'pending',
      after: { detailAddress: '2', roadAddress: '부산', postalCode: '2', phone: '010', recipientName: '김' },
      type: 'shipping_address_change',
      before: { detailAddress: '1', roadAddress: '서울', postalCode: '1', phone: '010', recipientName: '김' },
      blockers: [{ code: 'WAYBILL_ISSUED' }],
    };
    expect(deltaFingerprint(reordered)).toBe(deltaFingerprint(ADDRESS_APPLIED));
  });
});

describe('suppressDismissed', () => {
  const dismissedJson = (deltas: RecordedChannelDelta[]): unknown[] => JSON.parse(JSON.stringify(deltas));

  it('무시 행이 없으면 그대로', () => {
    expect(suppressDismissed([ADD], null)).toEqual([ADD]);
  });

  it('이번 pending 이 전부 무시된 것이면 pending 을 뺀다', () => {
    expect(suppressDismissed([ADD], dismissedJson([ADD]))).toEqual([]);
  });

  it('반영된 델타는 억제 대상이 아니다 — 남는다', () => {
    expect(suppressDismissed([ADDRESS_APPLIED, ADD], dismissedJson([ADD]))).toEqual([ADDRESS_APPLIED]);
  });

  it('새 pending 이 하나라도 있으면 아무것도 빼지 않는다', () => {
    expect(suppressDismissed([ADD, UP], dismissedJson([ADD]))).toEqual([ADD, UP]);
  });

  it('무시 행의 applied 델타는 무시 기준이 아니다', () => {
    const appliedAdd = { ...ADD, outcome: 'applied' };
    expect(suppressDismissed([ADD], [appliedAdd])).toEqual([ADD]);
  });

  it('무시 행의 jsonb 에 객체가 아닌 원소가 섞여도 죽지 않는다', () => {
    expect(suppressDismissed([ADD], [null, 'x', ...dismissedJson([ADD])])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-order-change/channel-change-dismissal.spec.ts`
Expected: FAIL — `Cannot find module './channel-change-dismissal'`

- [ ] **Step 3: 구현**

```ts
import type { RecordedChannelDelta } from './channel-order-change.types';

/**
 * #1016 6번 행 스펙 §6. 운영자가 «무시»한 차이와 똑같은 차이로는 pending 을 다시 띄우지 않는다.
 * core 는 이벤트마다 판매주문과 처음부터 다시 diff 하므로, 이 억제가 없으면 PIM 식별만 바뀐 해시
 * 변경이나 «다시 확인» 하나로 무시한 행이 그대로 되살아난다.
 */

const OUTSIDE_FINGERPRINT = new Set(['outcome', 'blockers']);

/** 키를 정렬한 JSON — jsonb 왕복은 키 순서를 보장하지 않는다. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 같은 차이 = 같은 지문. 막힌 사유·결과는 뺀다 — 그 사이 송장이 발급됐다고 다시 물을 이유가 없다. */
export function deltaFingerprint(delta: object): string {
  return canonical(Object.fromEntries(Object.entries(delta).filter(([key]) => !OUTSIDE_FINGERPRINT.has(key))));
}

function isPendingRecord(value: unknown): value is object {
  return value !== null && typeof value === 'object' && 'outcome' in value && value.outcome === 'pending';
}

/**
 * 이번 기록의 pending 델타가 **전부** 가장 최근 무시 행의 pending 델타 안에 있으면 pending 을 뺀다.
 * 하나라도 새것이면 그대로 둔다 — 새 pending 행이 이번 이벤트의 델타 전부를 담는다(스펙 §6.2).
 */
export function suppressDismissed(
  recorded: RecordedChannelDelta[],
  dismissedDeltas: readonly unknown[] | null,
): RecordedChannelDelta[] {
  if (!dismissedDeltas) return recorded;
  const pending = recorded.filter((delta) => delta.outcome === 'pending');
  if (pending.length === 0) return recorded;
  const dismissed = new Set(dismissedDeltas.filter(isPendingRecord).map(deltaFingerprint));
  const allDismissed = pending.every((delta) => dismissed.has(deltaFingerprint(delta)));
  return allDismissed ? recorded.filter((delta) => delta.outcome !== 'pending') : recorded;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-order-change/channel-change-dismissal.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order/channel-order-change/channel-change-dismissal.ts apps/core/src/modules/sales-order/channel-order-change/channel-change-dismissal.spec.ts
git commit -m "feat(core): 무시한 채널 변경 억제 판정 — 델타 지문 (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 4: 기록 직전 억제 배선

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts` (메서드 추가)
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts:50-70` (`handle`)
- Test: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts`

**Interfaces:**
- Consumes: `suppressDismissed`(Task 3), amendment 칸(Task 2)
- Produces: `ChannelOrderChangeReader.latestDismissedChannelDeltas(salesOrderId: string, tx: DbTx): Promise<unknown[] | null>`

- [ ] **Step 1: 실패하는 테스트** — `channel-order-change.integration.spec.ts` 의 `describeIfDb` 블록 마지막에 추가. 파일 위쪽 import 에 `desc` 를 더한다(`import { and, desc, eq, like } from 'drizzle-orm';`).

```ts
  async function dismissLatestPending(tx: DbTx, salesOrderId: string) {
    const [row] = await tx
      .select({ id: wmsTables.salesOrderAmendments.id })
      .from(wmsTables.salesOrderAmendments)
      .where(and(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId), eq(wmsTables.salesOrderAmendments.status, 'pending')))
      .orderBy(desc(wmsTables.salesOrderAmendments.createdAt))
      .limit(1);
    await tx
      .update(wmsTables.salesOrderAmendments)
      .set({ status: 'dismissed', dismissedAt: new Date() })
      .where(eq(wmsTables.salesOrderAmendments.id, row.id));
    return row.id;
  }

  it('무시 — 똑같은 스냅샷이 다시 오면 pending 이 생기지 않고 무시 행은 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const increased = payload(seed, {
        lines: seed.lines.map((line, i) => ({ channelOrderItemId: line.item, channelProductId: `cp-${line.item}`, quantity: i === 0 ? 5 : line.qty, unitPrice: 1000, cancelled: false })),
      });
      await w.manager.handle(seed.salesOrderId, increased, `msg-${randomUUID()}`, tx);
      const dismissedId = await dismissLatestPending(tx, seed.salesOrderId);

      await w.manager.handle(seed.salesOrderId, { ...increased, orderId: randomUUID() }, `msg-${randomUUID()}`, tx);

      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
      expect(rows.find((row) => row.id === dismissedId)?.status).toBe('dismissed');
    });
  });

  it('무시 — 새 범위 밖 차이가 섞이면 델타 전부를 담은 pending 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const lineOf = (qty0: number, qty1: number) =>
        seed.lines.map((line, i) => ({ channelOrderItemId: line.item, channelProductId: `cp-${line.item}`, quantity: i === 0 ? qty0 : qty1, unitPrice: 1000, cancelled: false }));
      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: lineOf(5, 1) }), `msg-${randomUUID()}`, tx);
      await dismissLatestPending(tx, seed.salesOrderId);

      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: lineOf(5, 4) }), `msg-${randomUUID()}`, tx);

      const pending = (await amendmentsOf(tx, seed.salesOrderId)).filter((row) => row.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].deltas).toHaveLength(2);
    });
  });

  it('무시 — 뒤이어 반영 가능한 주소 변경이 오면 applied 행 하나, pending 0, 무시 행 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const increasedLines = seed.lines.map((line, i) => ({ channelOrderItemId: line.item, channelProductId: `cp-${line.item}`, quantity: i === 0 ? 5 : line.qty, unitPrice: 1000, cancelled: false }));
      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: increasedLines }), `msg-${randomUUID()}`, tx);
      const dismissedId = await dismissLatestPending(tx, seed.salesOrderId);

      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: increasedLines, shippingAddress: NEXT }), `msg-${randomUUID()}`, tx);

      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
      expect(rows.filter((row) => row.status === 'applied')).toHaveLength(1);
      expect(rows.find((row) => row.id === dismissedId)?.status).toBe('dismissed');
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- channel-order-change.integration`
Expected: FAIL — 첫 두 테스트에서 pending 이 다시 생긴다(억제 없음), 세 번째는 pending 1

- [ ] **Step 3: 구현**

`channel-order-change.reader.ts` — import 에 `desc` 를 더하고(`drizzle-orm`), 클래스 안에:

```ts
  /** 그 판매주문의 가장 최근 «무시» 채널 행의 델타(스펙 §6.2). 없으면 null. */
  async latestDismissedChannelDeltas(salesOrderId: string, tx: DbTx): Promise<unknown[] | null> {
    const table = wmsTables.salesOrderAmendments;
    const [row] = await tx
      .select({ deltas: table.deltas })
      .from(table)
      .where(and(eq(table.salesOrderId, salesOrderId), eq(table.origin, 'channel'), eq(table.status, 'dismissed')))
      .orderBy(desc(table.dismissedAt), desc(table.id))
      .limit(1);
    if (!row) return null;
    return Array.isArray(row.deltas) ? row.deltas : [];
  }
```

(`and`·`eq` 가 이미 import 돼 있지 않으면 함께 더한다.)

`channel-order-change.manager.ts` — import 추가:

```ts
import { suppressDismissed } from './channel-change-dismissal';
```

`handle` 의 `for` 루프와 `recordChannelAmendment` 사이:

```ts
    // 운영자가 무시한 차이와 똑같은 차이면 pending 을 다시 띄우지 않는다(#1016 6번 행 §6).
    const dismissed = await this.reader.latestDismissedChannelDeltas(salesOrderId, tx);
    const kept = suppressDismissed(recorded, dismissed);
```

그리고 `recordChannelAmendment` 인자의 `deltas: recorded,` 를 `deltas: kept,` 로.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:core:integration:local -- channel-order-change.integration`
Expected: 새 셋 PASS, 기존 테스트 전부 PASS

Run: `npx jest apps/core/src/modules/sales-order` → 실패 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts
git commit -m "feat(core): 무시한 차이와 같은 채널 변경은 pending 을 다시 만들지 않는다 (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 5: 무시·다시 확인 서비스와 엔드포인트

**Files:**
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.service.ts`
- Create: `apps/core/src/modules/sales-order/dto/dismiss-sales-order-amendment.dto.ts`
- Modify: `apps/core/src/modules/sales-order/controllers/sales-order-amendments.controller.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (providers)
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts:82` (`publishes`)
- Test: `apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.spec.ts`(순수), `apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.integration.spec.ts`

**Interfaces:**
- Consumes: `CHANNEL_ORDERS_COMMAND_STREAM`·`channelOrderPartitionKey`(Task 1), amendment 칸(Task 2)
- Produces:
  - `channelKeyOf(metadata: unknown): { salesChannel: string; externalOrderId: string }` (없으면 `Error`)
  - `ChannelAmendmentActionsService.dismiss(id: string, input: { note?: string; operatorId?: string }, tx?: DbTx): Promise<{ id: string; status: 'dismissed' }>`
  - `ChannelAmendmentActionsService.requestResync(id: string, tx?: DbTx): Promise<{ id: string; resyncRequestedAt: Date }>`
  - HTTP `POST /sales-order-amendments/:id/dismiss` 본문 `{ note?: string }` → 200, `POST /sales-order-amendments/:id/resync` → 200

- [ ] **Step 1: 실패하는 순수 테스트** — `channel-amendment-actions.spec.ts`:

```ts
import { channelKeyOf } from './channel-amendment-actions.service';

describe('channelKeyOf', () => {
  it('채널 행 metadata 에서 채널 키를 읽는다', () => {
    expect(channelKeyOf({ salesChannel: 'medusa', externalOrderId: 'order_1' })).toEqual({
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
    });
  });

  it.each([[null], [{}], [{ salesChannel: 'medusa' }], [{ salesChannel: '', externalOrderId: 'o' }], [{ salesChannel: 'medusa', externalOrderId: 7 }]])(
    '키가 없거나 비면 명령을 내지 않고 실패한다 — %j',
    (metadata) => {
      expect(() => channelKeyOf(metadata)).toThrow('channel key');
    },
  );
});
```

- [ ] **Step 2: 실패하는 통합 테스트** — `channel-amendment-actions.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { ChannelAmendmentActionsService } from './channel-amendment-actions.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' };
const OPERATOR = '7d0a3c6e-0000-4000-8000-000000000001';

describeIfDb('ChannelAmendmentActionsService (DB integration, rollback-only)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  function wire(tx: DbTx) {
    const dbService = ambientDbService(tx);
    return new ChannelAmendmentActionsService(dbService, outboxPublisherFor(CHANNEL_ORDERS_COMMAND_STREAM, dbService));
  }

  async function amendment(tx: DbTx, over: { origin?: 'channel' | 'operator'; status?: 'pending' | 'superseded' | 'applied' } = {}) {
    const externalOrderId = `ext-${randomUUID().slice(0, 8)}`;
    const [so] = await tx
      .insert(wmsTables.salesOrders)
      .values({ channelOrderId: externalOrderId, salesChannel: 'medusa', status: 'pending', shippingAddress: ADDRESS, orderDate: new Date() })
      .returning();
    const [row] = await tx
      .insert(wmsTables.salesOrderAmendments)
      .values({
        salesOrderId: so.id,
        amendmentKind: 'commercial',
        reasonCode: 'CHANNEL_ORDER_MODIFIED',
        deltas: [],
        metadata: { salesChannel: 'medusa', externalOrderId },
        origin: over.origin ?? 'channel',
        status: over.status ?? 'pending',
      })
      .returning();
    return { id: row.id, externalOrderId };
  }

  it('무시 — dismissed·시각·운영자·메모', async () => {
    await inRollbackTx(db, async (tx) => {
      const { id } = await amendment(tx);
      await expect(wire(tx).dismiss(id, { note: '채널 쪽 오류', operatorId: OPERATOR }, tx)).resolves.toEqual({ id, status: 'dismissed' });
      const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
      expect(row).toMatchObject({ status: 'dismissed', dismissedBy: OPERATOR, dismissNote: '채널 쪽 오류' });
      expect(row.dismissedAt).toBeInstanceOf(Date);
    });
  });

  it.each([
    ['superseded 채널 행', { status: 'superseded' as const }],
    ['applied 채널 행', { status: 'applied' as const }],
    ['운영자 행', { origin: 'operator' as const }],
  ])('무시·다시 확인 — %s 은 409', async (_label, over) => {
    await inRollbackTx(db, async (tx) => {
      const { id } = await amendment(tx, over);
      await expect(wire(tx).dismiss(id, {}, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(wire(tx).requestResync(id, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('두 번째 무시는 409 — 겹친 클릭', async () => {
    await inRollbackTx(db, async (tx) => {
      const { id } = await amendment(tx);
      await wire(tx).dismiss(id, {}, tx);
      await expect(wire(tx).dismiss(id, {}, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('없는 행은 404', async () => {
    await inRollbackTx(db, async (tx) => {
      await expect(wire(tx).dismiss(randomUUID(), {}, tx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('다시 확인 — 시각을 찍고 같은 트랜잭션에 ResyncChannelOrder 명령을 outbox 에 넣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { id, externalOrderId } = await amendment(tx);
      const result = await wire(tx).requestResync(id, tx);
      const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
      expect(row.status).toBe('pending');
      expect(row.resyncRequestedAt).toEqual(result.resyncRequestedAt);
      const outbox = await tx.execute<{ topic: string; event_type: string; partition_key: string; payload: Record<string, unknown> }>(
        drizzleSql`SELECT topic, event_type, partition_key, payload FROM event.outbox_events WHERE aggregate_id = ${`medusa:${externalOrderId}`}`,
      );
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        topic: 'channel-orders.commands.v1',
        event_type: 'ResyncChannelOrder',
        partition_key: `medusa:${externalOrderId}`,
        payload: { salesChannel: 'medusa', externalOrderId },
      });
    });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 서비스 구현** — `channel-amendment-actions.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM, channelOrderPartitionKey } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;

/** 채널 행 metadata(5번 행 `recordChannelAmendment` 가 채움)의 채널 키. 비면 명령을 내지 않는다 — 빈 키는 엉뚱한 조회가 된다. */
export function channelKeyOf(metadata: unknown): { salesChannel: string; externalOrderId: string } {
  if (metadata !== null && typeof metadata === 'object' && 'salesChannel' in metadata && 'externalOrderId' in metadata) {
    const { salesChannel, externalOrderId } = metadata;
    if (typeof salesChannel === 'string' && salesChannel && typeof externalOrderId === 'string' && externalOrderId) {
      return { salesChannel, externalOrderId };
    }
  }
  throw new Error('Channel amendment has no channel key in metadata');
}

/**
 * «반영 대기 변경»(채널 amendment pending)을 닫는 두 조치 (#1016 6번 행 §5).
 * - 무시: 어긋난 채 둔다. 이 행의 pending 델타와 똑같은 차이는 다시 띄우지 않는다(§6, manager 가 판정)
 * - 다시 확인: 채널에서 그 주문을 다시 가져오라는 명령을 낸다. core 는 channel-adapter 를 직접 부르지 않는다(§3 D2).
 *   결과는 돌아오지 않는다 — 같아졌으면 다음 `OrderModified` 가 이 행을 superseded 로 바꾼다
 */
@Injectable()
export class ChannelAmendmentActionsService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  ) {}

  async dismiss(id: string, input: { note?: string; operatorId?: string }, tx?: DbTx): Promise<{ id: string; status: 'dismissed' }> {
    return this.db.run(async (trx) => {
      await this.lockPendingChannel(id, trx);
      const now = new Date();
      await trx
        .update(wmsTables.salesOrderAmendments)
        .set({ status: 'dismissed', dismissedAt: now, dismissedBy: input.operatorId ?? null, dismissNote: input.note ?? null, updatedAt: now })
        .where(eq(wmsTables.salesOrderAmendments.id, id));
      return { id, status: 'dismissed' as const };
    }, tx);
  }

  async requestResync(id: string, tx?: DbTx): Promise<{ id: string; resyncRequestedAt: Date }> {
    return this.db.run(async (trx) => {
      const row = await this.lockPendingChannel(id, trx);
      const { salesChannel, externalOrderId } = channelKeyOf(row.metadata);
      const requestedAt = new Date();
      await trx
        .update(wmsTables.salesOrderAmendments)
        .set({ resyncRequestedAt: requestedAt, updatedAt: requestedAt })
        .where(eq(wmsTables.salesOrderAmendments.id, id));
      const key = channelOrderPartitionKey(salesChannel, externalOrderId);
      await this.commands.enqueue(
        {
          idempotencyKey: `resync:${id}:${requestedAt.getTime()}`,
          eventType: 'ResyncChannelOrder',
          aggregateId: key,
          partitionKey: key,
          payload: { salesChannel, externalOrderId, requestedAt: requestedAt.toISOString() },
        },
        trx,
      );
      return { id, resyncRequestedAt: requestedAt };
    }, tx);
  }

  private async lockPendingChannel(id: string, trx: DbTx): Promise<AmendmentRow> {
    const [row] = await trx
      .select()
      .from(wmsTables.salesOrderAmendments)
      .where(eq(wmsTables.salesOrderAmendments.id, id))
      .for('update');
    if (!row) throw new NotFoundError(`SalesOrderAmendment ${id} not found`);
    if (row.origin !== 'channel' || row.status !== 'pending') {
      throw new ConflictError(`SalesOrderAmendment ${id} is not a pending channel change (origin=${row.origin}, status=${row.status})`);
    }
    return row;
  }
}
```

`dto/dismiss-sales-order-amendment.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DismissSalesOrderAmendmentDto {
  @ApiPropertyOptional({ description: '무시 메모', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
```

- [ ] **Step 5: 컨트롤러·모듈 배선**

`sales-order-amendments.controller.ts` — import 줄을 `import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';` 로 바꾸고 아래 두 import 를 더한다:

```ts
import { DismissSalesOrderAmendmentDto } from '../dto/dismiss-sales-order-amendment.dto';
import { ChannelAmendmentActionsService } from '../channel-order-change/channel-amendment-actions.service';
```

생성자:

```ts
  constructor(
    private readonly service: SalesOrderAmendmentsService,
    private readonly channelActions: ChannelAmendmentActionsService,
  ) {}
```

`getOne` 다음에:

```ts
  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '반영 대기 채널 변경을 무시로 닫는다 (#1016 6번 행)' })
  @ApiParam({ name: 'id', description: 'SalesOrderAmendment ID' })
  dismiss(@Param('id') id: string, @Body() dto: DismissSalesOrderAmendmentDto, @User() user: AuthenticatedUser) {
    return this.channelActions.dismiss(id, { note: dto.note, operatorId: this.getUserId(user) });
  }

  @Post(':id/resync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '반영 대기 채널 변경의 주문을 채널에서 다시 확인하도록 요청한다 (#1016 6번 행)' })
  @ApiParam({ name: 'id', description: 'SalesOrderAmendment ID' })
  resync(@Param('id') id: string) {
    return this.channelActions.requestResync(id);
  }
```

`sales-order.module.ts` — import 와 `providers` 배열에 `ChannelAmendmentActionsService` 를 더한다(`ChannelOrderChangeService` 옆).

`fulfillment.module.ts` — import 에 `CHANNEL_ORDERS_COMMAND_STREAM`(`@packages/event-contracts/streams`)을 더하고:

```ts
    // CHANNEL_ORDERS_COMMAND_STREAM: «다시 확인» 명령(#1016 6번 행). 선언이 기동 때 토픽도 만든다
    EventsModule.forApp({
      publishes: [FULFILLMENT_STREAM, CORE_ORDER_STREAM, SHIPMENT_STREAM, FULFILLMENT_V2_STREAM, CHANNEL_ORDERS_COMMAND_STREAM],
```

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.spec.ts` → PASS
Run: `npm run test:core:integration:local -- channel-amendment-actions.integration` → PASS
Run: `npm run type-check` → 0
Run: `npm run audit:consume-validation -- --gate` → exit 0 (새 발행 경로가 zod 를 지나는지 — outbox `enqueue` 는 스키마 검증을 한다)

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.service.ts apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.spec.ts apps/core/src/modules/sales-order/channel-order-change/channel-amendment-actions.integration.spec.ts apps/core/src/modules/sales-order/dto/dismiss-sales-order-amendment.dto.ts apps/core/src/modules/sales-order/controllers/sales-order-amendments.controller.ts apps/core/src/modules/sales-order/sales-order.module.ts apps/core/src/modules/fulfillment/fulfillment.module.ts
git commit -m "feat(core): 반영 대기 채널 변경 무시·다시 확인 — ResyncChannelOrder 명령 (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 6: channel-adapter 명령 소비자

**Files:**
- Create: `apps/channel-adapter/src/services/order-collection/syncable-channels.ts`
- Modify: `apps/channel-adapter/src/controllers/channel-order-sync.controller.ts:20-25` (공유 모듈로 이동)
- Create: `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts` (import + 비데모 `controllers` 에 등록)
- Modify: `apps/channel-adapter/CLAUDE.md` (§3-5 근처 한 줄)
- Test: `apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts`

**Interfaces:**
- Consumes: `CHANNEL_ORDERS_COMMAND_STREAM`(Task 1), `OrderPollerOrchestrator.syncOrder(channel: SalesChannel, externalOrderId: string, options: { force?: boolean }): Promise<{ outcome: OrderSyncOutcome }>`
- Produces: `SYNCABLE_CHANNELS`, `SyncableChannel`, `isSyncableChannel(value: string): value is SyncableChannel`, `ChannelOrdersCommandConsumer.handleResync(payload, envelope): Promise<void>`

- [ ] **Step 1: 실패하는 테스트** — `channel-orders-command.consumer.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { ChannelOrdersCommandConsumer } from './channel-orders-command.consumer';
import type { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';

const envelope = { messageId: 'msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as never;

function consumerWith(syncOrder: jest.Mock) {
  return new ChannelOrdersCommandConsumer({ syncOrder } as unknown as OrderPollerOrchestrator);
}

describe('ChannelOrdersCommandConsumer — ResyncChannelOrder (#1016 6번 행)', () => {
  it('지원 채널이면 force 로 즉시 끌어오기를 탄다', async () => {
    const syncOrder = jest.fn().mockResolvedValue({ outcome: 'emitted' });
    await consumerWith(syncOrder).handleResync(
      { salesChannel: 'medusa', externalOrderId: 'order_1', requestedAt: '2026-10-06T00:00:00.000Z' },
      envelope,
    );
    expect(syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
  });

  it.each(['3pl', 'coupang', 'unknown'])('지원하지 않는 채널(%s)은 부르지도 던지지도 않는다', async (salesChannel) => {
    const syncOrder = jest.fn();
    await expect(
      consumerWith(syncOrder).handleResync({ salesChannel, externalOrderId: 'o', requestedAt: '2026-10-06T00:00:00.000Z' }, envelope),
    ).resolves.toBeUndefined();
    expect(syncOrder).not.toHaveBeenCalled();
  });

  it.each(['channel_inactive', 'not_found', 'not_eligible', 'identification_failed', 'unchanged'])(
    '결과가 %s 여도 던지지 않는다 — 재시도해도 같다',
    async (outcome) => {
      const syncOrder = jest.fn().mockResolvedValue({ outcome });
      await expect(
        consumerWith(syncOrder).handleResync({ salesChannel: 'naver', externalOrderId: 'o', requestedAt: '2026-10-06T00:00:00.000Z' }, envelope),
      ).resolves.toBeUndefined();
    },
  );

  it('예상 밖 예외(채널 API 5xx 등)는 던진다 — 재시도·DLQ 를 탄다', async () => {
    const syncOrder = jest.fn().mockRejectedValue(new Error('Request failed with status code 503'));
    await expect(
      consumerWith(syncOrder).handleResync({ salesChannel: 'medusa', externalOrderId: 'o', requestedAt: '2026-10-06T00:00:00.000Z' }, envelope),
    ).rejects.toThrow('503');
  });

  it('adapter.module 의 controllers 에 등록돼 있다 — 빠지면 구독이 조용히 안 된다', () => {
    const source = readFileSync(join(__dirname, '..', 'adapter.module.ts'), 'utf8');
    const controllers = source.slice(source.indexOf('controllers: ['));
    expect(controllers).toMatch(/\bChannelOrdersCommandConsumer\b/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 공유 모듈로 이동**

`apps/channel-adapter/src/services/order-collection/syncable-channels.ts`:

```ts
/** 즉시 끌어오기(`syncOrder`)를 지원하는 채널. HTTP 입구와 명령 소비자가 같이 쓴다(#1016 5·6번 행). */
export const SYNCABLE_CHANNELS = ['medusa', 'naver'] as const;
export type SyncableChannel = (typeof SYNCABLE_CHANNELS)[number];

export function isSyncableChannel(value: string): value is SyncableChannel {
  return SYNCABLE_CHANNELS.some((channel) => channel === value);
}
```

`channel-order-sync.controller.ts` 에서 `SYNCABLE_CHANNELS`·`SyncableChannel`·`isSyncableChannel` 로컬 정의(20-25행)를 지우고 import 한다:

```ts
import { isSyncableChannel } from '../services/order-collection/syncable-channels';
```

- [ ] **Step 4: 소비자 구현** — `channel-orders-command.consumer.ts`:

```ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { CHANNEL_ORDERS_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';
import { isSyncableChannel } from '../services/order-collection/syncable-channels';

/**
 * `channel-orders.commands.v1` 소비자 (#1016 6번 행 스펙 §7.3).
 *
 * core 는 channel-adapter 를 직접 부르지 않는다 — 채널 쪽 일을 원하면 이 명령 스트림에 요청한다.
 * «다시 확인»은 5번 행의 즉시 끌어오기와 같은 메서드를 `force` 로 탄다. 결과는 `OrderModified` 로 돌아간다.
 *
 * 결과가 정해진 실패(미지원 채널·비활성·주문 없음 등)는 로그만 남기고 정상 종료한다 — 재시도해도 같다.
 * 예상 밖 예외(채널 API 5xx·네트워크)는 던져서 재시도·DLQ 를 탄다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class ChannelOrdersCommandConsumer {
  private readonly logger = new Logger(ChannelOrdersCommandConsumer.name);

  constructor(private readonly orderPoller: OrderPollerOrchestrator) {}

  @On(CHANNEL_ORDERS_COMMAND_STREAM, 'ResyncChannelOrder')
  async handleResync(
    @EventPayload() payload: EventPayloadOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'ResyncChannelOrder'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'ResyncChannelOrder'>,
  ): Promise<void> {
    const { salesChannel, externalOrderId } = payload;
    if (!isSyncableChannel(salesChannel)) {
      this.logger.warn(`[RESYNC] 지원하지 않는 채널이라 건너뜀: ${salesChannel}:${externalOrderId}`, {
        correlationId: envelope.correlationId,
      });
      return;
    }
    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    this.logger.log(`[RESYNC] ${salesChannel}:${externalOrderId} → ${outcome}`, { correlationId: envelope.correlationId });
  }
}
```

`adapter.module.ts` — import 추가(`ChannelOrderSyncController` import 옆):

```ts
import { ChannelOrdersCommandConsumer } from './consumers/channel-orders-command.consumer';
```

비데모 `controllers` 배열의 `ChannelOrderSyncController,` 다음 줄에 `ChannelOrdersCommandConsumer,` 를 넣는다.

`apps/channel-adapter/CLAUDE.md` — 수집 뒤 변경 정책 문장(§3-5) 아래에 한 줄:

```md
- core 는 이 앱을 직접 부르지 않는다. 채널 쪽 일을 원하면 `channel-orders.commands.v1` 에 명령을 낸다(지금은 `ResyncChannelOrder` — #1016 6번 행). 소비자는 `consumers/channel-orders-command.consumer.ts`.
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts apps/channel-adapter/src/controllers/channel-order-sync.controller.spec.ts` → PASS
Run: `npm run type-check` → 0
Run: `npm run audit:consume-validation -- --gate` → exit 0

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection/syncable-channels.ts apps/channel-adapter/src/controllers/channel-order-sync.controller.ts apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts apps/channel-adapter/src/adapter.module.ts apps/channel-adapter/CLAUDE.md
git commit -m "feat(channel-adapter): ResyncChannelOrder 명령 소비 — 즉시 끌어오기 force (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 7: 옛 격리 종결 — `closed_obsolete` 와 스크립트

**Files:**
- Modify: `apps/channel-adapter/src/types.ts:56-64` (`OrderCollectionFailureStatus`)
- Modify: `apps/channel-adapter/src/schema.ts:241-247` (상태 주석)
- Modify: `apps/channel-adapter/src/controllers/order-collection-failures.controller.ts:29-31` (`@ApiQuery` status enum)
- Create: `scripts/ops/1016-close-obsolete-modification-quarantines.ts`
- Test: 없음(분기 없는 고정 조건 — dry-run 출력으로 확인, File Structure 의 계획 단계 수정 참고)

**Interfaces:**
- Produces: `OrderCollectionFailureStatus` 에 `'closed_obsolete'`

- [ ] **Step 1: 상태값**

`types.ts` 의 유니온 끝에:

```ts
  /** 그 주문의 수집 경로가 사라진 사유라 할 일이 없다 — 지금은 «수집 후 변경»뿐(#1016 6번 행). */
  | 'closed_obsolete';
```

`schema.ts` 의 상태 주석 첫 줄을 `// 'quarantined' | 'replayed' | 'closed_lifecycle' | 'closed_already_collected' | 'closed_obsolete'` 로, 주석 끝에:

```ts
    // closed_obsolete: the path that created this quarantine is gone. Today that is only
    //   `collected_order_modification_not_accepted` — post-collection changes go to Core as
    //   OrderModified since #1016 row 5. Closed in bulk by
    //   scripts/ops/1016-close-obsolete-modification-quarantines.ts.
```

`order-collection-failures.controller.ts` 의 status `@ApiQuery` enum 에 `'closed_obsolete'` 를 더한다.

- [ ] **Step 2: 스크립트** — `scripts/ops/1016-close-obsolete-modification-quarantines.ts`:

```ts
/**
 * #1016 6번 행 일회성 정리 — 옛 «수집 후 변경» 격리를 일괄 종결한다(스펙 §4, 결정 D1).
 *
 * 배경: 5번 행 이전에는 수집 뒤 채널 변경이 전부 `collected_order_modification_not_accepted` 격리가 됐다.
 * 이 사유는 replay 도 안 되므로(`not_replayable`) 영원히 열려 격리 목록·메뉴 배지를 채우고 진짜 격리(식별 실패)를 가렸다.
 * 5번 행부터 이 사유는 다시 생기지 않는다(변경은 core diff 로 간다). 5번 백필 판단(2026-10-06)이 끝나지 않은 주문 30건을
 * «반영할 실물 없음»으로 확인했다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-close-obsolete-modification-quarantines.ts          # 조회만 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-close-obsolete-modification-quarantines.ts --apply  # 실제 종결
 */
import postgres from 'postgres';
import { Resource } from 'sst';

const APPLY = process.argv.includes('--apply');
const REASON =
  'Closed by scripts/ops/1016-close-obsolete-modification-quarantines.ts: post-collection changes go to Core as OrderModified since #1016 row 5';

type TargetRow = { id: string; channel: string };
type CountRow = { reason: string; n: number };

async function main() {
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). 647 스크립트와 같은 이유로 캐스팅한다.
  const Db = (Resource as unknown as { Db: { host: string; port: number; username: string; password: string } }).Db;
  const sql = postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'channel_adapter',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });

  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    const targets = await sql<TargetRow[]>`
      SELECT id, channel
      FROM order_collection_failures
      WHERE reason = 'collected_order_modification_not_accepted' AND status = 'quarantined'
      ORDER BY created_at`;

    // 3천 건 남짓이라 행을 다 찍지 않고 채널별 수를 보인다.
    const byChannel = new Map<string, number>();
    for (const row of targets) byChannel.set(row.channel, (byChannel.get(row.channel) ?? 0) + 1);
    console.log(`종결 대상: ${targets.length}건`);
    for (const [channel, n] of byChannel) console.log(`  ${channel}: ${n}건`);

    if (!APPLY) {
      console.log('\n조회만 했다. 적용하려면 --apply 를 붙일 것.');
      return;
    }
    if (targets.length === 0) {
      console.log('\n닫을 것이 없다.');
      return;
    }

    // 위에서 센 **바로 그 id 들**만 손댄다(647 과 같은 이유 — 승인한 목록과 실행 대상이 어긋나지 않게).
    const targetIds = targets.map((row) => row.id);
    const result = await sql`
      UPDATE order_collection_failures
         SET status = 'closed_obsolete',
             error_message = ${REASON},
             updated_at = now()
       WHERE id = ANY(${targetIds})
         AND status = 'quarantined'`;
    console.log(`\n종결 완료: ${result.count}건`);

    const after = await sql<CountRow[]>`
      SELECT reason, count(*)::int AS n
      FROM order_collection_failures
      WHERE status = 'quarantined'
      GROUP BY reason`;
    console.log('남은 quarantined (사유별):');
    for (const row of after) console.log(`  ${row.reason}: ${row.n}건`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: 확인**

Run: `npm run type-check` → 0 (루트 tsconfig 가 `scripts/` 를 포함하므로 스크립트 타입도 여기서 본다)
Run: `npx jest apps/channel-adapter/src/controllers` → 실패 0

- [ ] **Step 4: 커밋**

```bash
git add apps/channel-adapter/src/types.ts apps/channel-adapter/src/schema.ts apps/channel-adapter/src/controllers/order-collection-failures.controller.ts scripts/ops/1016-close-obsolete-modification-quarantines.ts
git commit -m "feat(channel-adapter): closed_obsolete 상태와 옛 «수집 후 변경» 격리 일괄 종결 스크립트 (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 8: admin-web — 무시·다시 확인 버튼과 표시

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.shape.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.client.ts`
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts`·`index.ts`
- Modify: `apps/admin-web/src/features/mall/pending-changes/components/pending-changes-table/index.tsx`
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx:607-622`
- Modify: `apps/admin-web/src/features/mall/quarantine/guidance.ts:3-7`
- Test: `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.shape.spec.ts`

**Interfaces:**
- Consumes: `POST /sales-order-amendments/:id/dismiss { note? }`, `POST /sales-order-amendments/:id/resync`(Task 5), 목록 응답의 `resyncRequestedAt`, 상세 응답의 `dismissedAt`·`dismissNote`(Task 2)
- Produces: `resyncLabel(resyncRequestedAt: string | null | undefined, now: Date): string | null`, `dismissedLabel(record: Pick<AmendmentRecord, 'dismissedAt' | 'dismissNote'>): string`, `useDismissChannelChange()`, `useResyncChannelChange()`

- [ ] **Step 1: 실패하는 테스트** — `sales-order-amendments.shape.spec.ts` import 줄을 `import { blockerLabel, dismissedLabel, resyncLabel, summarizeDelta, toAmendmentPage, toAmendmentRecords } from './sales-order-amendments.shape';` 로 바꾸고 끝에:

```ts
describe('resyncLabel', () => {
  const now = new Date('2026-10-06T10:00:00.000Z');

  it.each([
    [null, null],
    [undefined, null],
    ['not-a-date', null],
    ['2026-10-06T09:59:40.000Z', '확인 요청 방금'],
    ['2026-10-06T09:55:00.000Z', '확인 요청 5분 전'],
    ['2026-10-06T07:00:00.000Z', '확인 요청 3시간 전'],
    ['2026-10-04T10:00:00.000Z', '확인 요청 2일 전'],
  ])('%s → %s', (requestedAt, expected) => {
    expect(resyncLabel(requestedAt, now)).toBe(expected);
  });
});

describe('dismissedLabel', () => {
  it('메모가 있으면 붙이고 없으면 날짜까지만', () => {
    expect(dismissedLabel({ dismissedAt: '2026-10-06T01:00:00.000Z', dismissNote: '채널 쪽 오류' })).toBe('무시됨 · 10. 6. · 채널 쪽 오류');
    expect(dismissedLabel({ dismissedAt: '2026-10-06T01:00:00.000Z', dismissNote: null })).toBe('무시됨 · 10. 6.');
    expect(dismissedLabel({ dismissedAt: null, dismissNote: null })).toBe('무시됨');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- sales-order-amendments.shape`
Expected: FAIL — `resyncLabel` 등 미정의

- [ ] **Step 3: shape 구현** — `sales-order-amendments.shape.ts`:

`AmendmentRecord` 에 `occurredAt: string;` 다음으로:

```ts
  dismissedAt?: string | null;
  dismissNote?: string | null;
  resyncRequestedAt?: string | null;
```

파일 끝에:

```ts
/** «다시 확인»은 결과가 돌아오지 않는다(스펙 D5) — 요청 시각만 보여 주고, 오래 그대로면 사람이 알아챈다. */
export function resyncLabel(resyncRequestedAt: string | null | undefined, now: Date): string | null {
  if (!resyncRequestedAt) return null;
  const at = new Date(resyncRequestedAt).getTime();
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 1) return '확인 요청 방금';
  if (minutes < 60) return `확인 요청 ${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `확인 요청 ${hours}시간 전`;
  return `확인 요청 ${Math.floor(hours / 24)}일 전`;
}

const shortDate = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });

export function dismissedLabel(record: Pick<AmendmentRecord, 'dismissedAt' | 'dismissNote'>): string {
  const parts = ['무시됨'];
  if (record.dismissedAt) parts.push(shortDate.format(new Date(record.dismissedAt)));
  if (record.dismissNote) parts.push(record.dismissNote);
  return parts.join(' · ');
}
```

> `shortDate` 결과가 테스트의 `'10. 6.'` 과 다르면(노드 ICU 차이) 테스트 기대값을 `shortDate.format(new Date('2026-10-06T01:00:00.000Z'))` 로 계산해 비교하도록 바꾼다 — 고정 문자열을 맞추려고 포맷을 손으로 짜지 않는다.

`AmendmentListItem` 은 `AmendmentRecord` 를 확장하므로 `resyncRequestedAt` 이 따라온다.

- [ ] **Step 4: client·mutation**

`sales-order-amendments.client.ts` 의 객체에 더한다:

```ts
  dismiss: async (id: string, note?: string): Promise<void> => {
    await client.post(`${ALMONDYOUNG_API_BASE_URL}/sales-order-amendments/${encodeURIComponent(id)}/dismiss`, { note });
  },
  resync: async (id: string): Promise<void> => {
    await client.post(`${ALMONDYOUNG_API_BASE_URL}/sales-order-amendments/${encodeURIComponent(id)}/resync`);
  },
```

`mutations.ts` 파일 끝에:

```ts
// ===== 반영 대기 채널 변경 닫기 (#1016 6번 행) =====
// 성공이든 409(그 사이 superseded·이미 닫힘)든 목록을 다시 불러온다 — 409 면 지금 상태가 답이다.

export const useDismissChannelChange = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => orders.amendments.dismiss(id, note),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.amendments });
    },
  });
};

export const useResyncChannelChange = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orders.amendments.resync(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.amendments });
    },
  });
};
```

(`orderQueryKeys.amendments` = `['sales-order-amendments']` — 목록·주문별 키가 전부 이 접두를 쓴다.)

- [ ] **Step 5: 대기 목록 표** — `pending-changes-table/index.tsx` 전체를 아래로 바꾼다:

```tsx
'use client';

// src/features/mall/pending-changes/components/pending-changes-table/index.tsx
// 채널에서 바뀌었는데 core 가 자동 반영하지 못한 변경(#1016 5번 행)과 그 닫기(6번 행: 무시·다시 확인).

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { usePendingChannelChanges, useDismissChannelChange, useResyncChannelChange } from '@/lib/services/orders';
import {
  blockerCodes,
  blockerLabel,
  resyncLabel,
  summarizeDelta,
} from '@/lib/api/domains/orders/sales-order-amendments.shape';

export function PendingChangesTable() {
  const { data, isLoading, isError, refetch } = usePendingChannelChanges();
  const dismiss = useDismissChannelChange();
  const resync = useResyncChannelChange();
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const rows = data?.items ?? [];
  const now = new Date();

  const closeDialog = () => {
    setDismissTarget(null);
    setNote('');
  };

  return (
    <div className="px-4 pb-4">
      {data?.nextCursor && (
        <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          상위 {rows.length}건만 표시했습니다.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>채널</TableHead>
            <TableHead>주문번호</TableHead>
            <TableHead>변경</TableHead>
            <TableHead>막힌 이유</TableHead>
            <TableHead>변경시각</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">불러오는 중…</TableCell>
            </TableRow>
          ) : isError ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-sm text-destructive">
                불러오지 못했습니다.
                <Button variant="outline" size="sm" className="ml-2" onClick={() => void refetch()}>
                  다시 시도
                </Button>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">반영 대기 중인 변경이 없습니다.</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const pending = row.deltas.filter((delta) => delta.outcome === 'pending');
              const busy = (dismiss.isPending && dismiss.variables?.id === row.id) || (resync.isPending && resync.variables === row.id);
              const requested = resyncLabel(row.resyncRequestedAt, now);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.salesChannel}</TableCell>
                  <TableCell className="font-mono text-xs">{row.displayOrderNo ?? row.channelOrderId}</TableCell>
                  <TableCell className="text-sm">
                    {pending.map((delta, index) => (
                      <div key={index}>{summarizeDelta(delta)}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {pending.map((delta, index) => (
                      <div key={index}>{blockerCodes(delta).map(blockerLabel).join(', ')}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(row.occurredAt).toLocaleString('ko-KR')}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => resync.mutate(row.id)}>
                        다시 확인
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDismissTarget(row.id)}>
                        무시
                      </Button>
                    </div>
                    {requested && <div className="mt-1 text-xs text-muted-foreground">{requested}</div>}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      <AlertDialog open={dismissTarget !== null} onOpenChange={(open) => !open && closeDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 변경을 무시할까요?</AlertDialogTitle>
          </AlertDialogHeader>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="메모 (선택)" maxLength={500} />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dismissTarget) dismiss.mutate({ id: dismissTarget, note: note.trim() || undefined });
                closeDialog();
              }}
            >
              무시
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

`apps/admin-web/src/lib/services/orders/index.ts` 는 `./mutations` 의 훅을 이름으로 다시 내보낸다 — 그 목록 끝(`useBatchIssueWaybills,` 다음)에 더한다:

```ts
  // 반영 대기 채널 변경 닫기 (#1016 6번 행)
  useDismissChannelChange,
  useResyncChannelChange,
```

409(그 사이 superseded·이미 닫힘)는 따로 문구를 띄우지 않는다 — `onSettled` 가 목록을 다시 불러오면 그 행이 사라지거나 바뀐 상태로 보인다(최소 문구 원칙).

- [ ] **Step 6: 주문 상세 무시 표시** — `features/order/history/components/table/index.tsx` 의 import 에 `dismissedLabel` 을 더하고, 채널 변경 블록(607-622행)의 `.map((amendment) => (` 안 `<div key={amendment.id} className="mb-2 text-sm">` 바로 아래에:

```tsx
                    {amendment.status === 'dismissed' && (
                      <div className="text-xs text-muted-foreground">{dismissedLabel(amendment)}</div>
                    )}
```

그리고 무시된 행의 pending 델타가 주황으로 보이지 않게 델타 줄 className 조건을 바꾼다:

```tsx
                      <div key={index} className={delta.outcome === 'pending' && amendment.status === 'pending' ? 'text-amber-700' : 'text-muted-foreground'}>
```

- [ ] **Step 7: 격리 상태 유니온** — `features/mall/quarantine/guidance.ts` 의 `QuarantineStatus` 끝에 `| 'closed_obsolete'` 를 더한다.

- [ ] **Step 8: 통과 확인**

Run: `npm run test:admin-web -- sales-order-amendments.shape` → PASS
Run: `cd apps/admin-web && npx tsc --noEmit` → 0
Run: `npm run test:admin-web` → 실패 0

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.shape.ts apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.shape.spec.ts apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.client.ts apps/admin-web/src/lib/services/orders/mutations.ts apps/admin-web/src/lib/services/orders/index.ts apps/admin-web/src/features/mall/pending-changes/components/pending-changes-table/index.tsx apps/admin-web/src/features/order/history/components/table/index.tsx apps/admin-web/src/features/mall/quarantine/guidance.ts
git commit -m "feat(admin-web): 반영 대기 변경 무시·다시 확인 버튼과 무시 표시 (#1016 6번 행)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

### Task 9: 스펙 정정·전체 게이트

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-channel-change-close-design.md` (§5·§8·§10 아래 «계획 단계 수정» 인용 블록)

- [ ] **Step 1: 스펙에 계획 단계 수정 기록** — 5번 스펙과 같은 꼴(`> **계획 단계 수정(2026-10-06):** …`)로 셋을 적는다:
  - §5 아래: 무시·다시 확인은 `SalesOrderAmendmentsService` 가 아니라 `channel-order-change/channel-amendment-actions.service.ts` 의 `ChannelAmendmentActionsService` 에 둔다(기존 서비스 생성자를 쓰는 통합 스펙 10곳, 운영자 경로와 책임이 다름). 명령의 `aggregateId` 는 채널 키
  - §8 아래: 주문 상세 무시 표시는 «무시됨 · 날짜 · 메모». `dismissed_by` 는 저장만 한다(이름 조회 없음)
  - §10 아래: 스크립트는 분기 없는 고정 조건이라 단위 테스트 없이 dry-run 출력으로 확인한다

- [ ] **Step 2: 전체 게이트**

Run: `npm run type-check` → 에러 0
Run: `npx jest --maxWorkers=2` → 실패 0 (OOM 이 나면 `--maxWorkers=2` 가 기준)
Run: `cd apps/admin-web && npx tsc --noEmit` → 0
Run: `npm run test:admin-web` → 실패 0
Run: `npm run test:core:integration:local -- channel` → 이번에 더한·고친 스펙 PASS (develop 에서도 빨간 suite 는 별도로 대조)
Run: `npm run audit:consume-validation -- --gate` → exit 0

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-10-06-channel-change-close-design.md
git commit -m "docs(spec): 6번 행 계획 단계 수정 기록 (#1016)

Claude-Session: https://claude.ai/code/session_01Y8QLhTQK2bwgx1HmEaiX2G"
```

---

## 배포 뒤 (사람)

1. 배포 전 `npm run db:migrate -- --stage live --deployment lcnine-services --yes` (`migrate → deploy`)
2. `sst deploy` 후 Core·channel-adapter 태스크 정의가 바뀌었는지 `aws ecs describe-services` 로 확인
3. `scripts/ops/1016-close-obsolete-modification-quarantines.ts` dry-run → 수 확인(3,004 근처) → `--apply`
4. admin-web «반영 대기 변경»에서 한 행 [다시 확인] → 수 분 뒤 행이 사라지거나 «확인 요청 n분 전»이 남는지, 한 행 [무시] → 목록에서 빠지고 주문 상세에 «무시됨»이 보이는지(브라우저 로그인은 사용자가 한다)
5. #1016 6번 행 «해결» 칸에 머지 커밋 해시, «문서» 칸에 이 계획 경로 → 아티팩트 재게시
