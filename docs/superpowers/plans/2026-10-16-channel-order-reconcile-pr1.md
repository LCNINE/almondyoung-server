# 채널 주문 대사 PR 1 (백엔드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** channel-adapter 가 30분마다 최근 3일 갱신된 Medusa 주문을 core 판매주문과 맞춰 «core 에 없음»·«취소 미반영»을 기록하고, 실행 모드에서 다시 배달한다. core 에는 묶음 조회 내부 API 하나만 더한다.

**Architecture:** 대사는 전부 channel-adapter 의 새 디렉터리 `services/order-reconcile/` 에 있다. 판정은 순수 함수(`classifyChannelOrder`), 한 주기는 `ChannelOrderReconcileManager`, 다시 배달은 `ChannelOrderRedeliveryManager`, 기록은 `OrderReconcileFindingRepository` 가 맡는다. core 는 `POST /internal/sales-orders/lookup`(`@InternalOnly`)으로 SO 상태와 «이벤트 실패 열림»만 돌려준다. 화면(admin-web)은 PR 2 다.

**Tech Stack:** NestJS 11, drizzle-orm(postgres.js), `@app/cron-once`, `@app/events`(outbox `PublisherFor.enqueue`), Jest, class-validator.

**Spec:** `docs/superpowers/specs/2026-10-16-channel-order-reconcile-design.md`

## 계획 단계 정정 (스펙에 반영)

1. **스펙 §5.2 유예 문장이 거꾸로였다.** «두 시각 중 **늦은** 시각보다 뒤면 건너뛴다»가 아니라 **이른** 시각(`min(now − 30분, 워터마크 − 2분)`)보다 뒤면 건너뛴다. 늦은 쪽을 쓰면 폴러가 멈춘 동안의 주문을 «core 에 없음»으로 잘못 잡는다. 워터마크가 없으면(폴러가 한 번도 안 돎) 판정하지 않는다.
2. **스펙 §7.2 «`event_failure_open` 플래그가 꺼지면 `handling` 재판정»은 해소 확인이 아니라 «훑기»가 한다.** 해소 확인에서 `auto` 로 되돌리면 3일 창 밖 행이 «자동인데 아무도 안 건드리는» 상태로 숨는다. 재판정은 주문이 창 안에서 다시 보일 때 판정 함수가 매번 새로 한다. 창 밖 행은 사람 행으로 남고 [다시 배달]이 출구다.
3. **스펙 §6.2 «번역기에 주어진 id 입력을 더한다»는 하지 않는다.** `fetchOrderForSync` 가 돌려준 `createPayload` 에 `orderId` 만 기존 `wmsOrderId` 로 덮어 쓴다(`{ ...createPayload, orderId }`). 번역기는 그대로다.
4. **스펙 §8.1 «0 인 쪽 링크는 숨긴다» 등 화면은 PR 2.** 이 PR 은 API 까지.
5. **스펙 §12 «다시 배달 경로는 통합 스펙»은 유닛 스펙으로 대신한다.** 지킬 성질은 «적재와 시도 기록이 같은 tx» 하나라, `dbService.run` 이 넘긴 tx 가 `enqueue`·`recordAttempt` 둘 다에 그대로 가는지와 적재가 던지면 시도 기록이 없는지를 본다(Task 5). outbox 적재 자체는 `@app/events` 의 기존 스펙이 지킨다. core 조회 API 의 401 은 `@InternalOnly()` 와 `scripts/security` 라우트 감사가 지킨다.

## Global Constraints

- 대사 주기 `*/30 * * * *`, 크론 이름 `channel-order-reconcile`, 훑는 창 **갱신 3일**, 유예 **30분**, 폴러 lookback **2분**, 시도 상한 **3회**, core 조회 묶음 **최대 200건**.
- «core 에 없음» 자동은 채널 주문 **생성 3일 안**만. «취소 미반영» 자동은 core SO 상태 **`pending`·`confirmed`** 만.
- 첫 배포는 두 규칙 모두 **`observe`**. 관찰 모드는 아무것도 적재하지 않고 시도 수도 세지 않는다.
- core 는 channel-adapter 를 부르지 않는다. 새 통로는 «어댑터 → core» 내부 키 호출(`CORE_INTERNAL_KEY`, `PIM_API_URL`) 하나뿐이다.
- 트랜잭션 타입은 `TxFor<typeof channelAdapterSchema>`(`@app/db`)로 쓰고 `dbService.run(fn, tx)` 를 쓴다. per-class `inTx` 금지.
- `any`·근거 없는 `as` 금지. 도메인 예외는 `@app/shared` 의 `NotFoundError`·`ConflictError`·`BadRequestError`.
- 새 통합 스펙은 `describeIfDb` 가드, 스펙 안에서 `dotenv.config()` 금지.
- 검증 게이트: `npm run type-check` 0 · `npx jest` 실패 0.

## Review Focus

1. **core 조회가 실패한 주기** — «응답 없음»을 «SO 없음»으로 읽으면 전 주문이 `missing_order` 가 된다. 주기 전체를 건너뛰고 아무 행도 쓰지·닫지 않아야 한다 → Task 6 의 `core 조회 실패면 아무것도 기록하지 않는다`.
2. **폴러가 멈춘 동안** — 워터마크 뒤에 갱신된 주문은 판정하지 않아야 한다(정정 1) → Task 3 의 `폴러 워터마크 − 2분 뒤에 갱신된 주문은 건너뛴다`.
3. **적재가 실패한 다시 배달** — outbox 적재가 던지면 시도 수가 늘지 않아야 하고(같은 트랜잭션), 오류는 `last_result` 로 남아야 한다 → Task 5 의 `적재와 시도 기록이 같은 tx`, Task 6 의 `다시 배달이 던지면 오류를 last_result 로 남긴다`.
4. **사람이 종결한 뒤 같은 어긋남이 다시 생김** — 닫힌 행을 되살리지 않고 새 행이 생겨야 한다(부분 unique) → Task 2 의 `닫힌 행이 있어도 새 open 행을 만든다`.
5. **관찰 모드에서 수동 [다시 배달]** — 규칙 모드와 무관하게 실행돼야 하고, `event_failure_open` 이면 409 → Task 7 의 서비스 스펙.

---

## 파일 구조

**core**
- Create: `apps/core/src/modules/sales-order/internal/sales-order-lookup.dto.ts` — 요청·응답 DTO
- Create: `apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.ts` — SO 상태·dead letter 조회
- Create: `apps/core/src/modules/sales-order/internal/sales-order-lookup.service.ts` — 얇은 포트
- Create: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.ts` — `@InternalOnly()`
- Create: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.spec.ts`
- Create: `apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.integration.spec.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts`

**channel-adapter**
- Modify: `apps/channel-adapter/src/schema.ts` — `orderReconcileFindings` + `channelAdapterSchema` 등록
- Create: `apps/channel-adapter/drizzle/<timestamp>_add-order-reconcile-findings.sql` (생성)
- Create: `apps/channel-adapter/src/services/order-reconcile/order-reconcile.types.ts` — 종류·처리·사유·모드 타입
- Create: `apps/channel-adapter/src/services/order-reconcile/rules/missing-order.rule.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/rules/cancel-not-applied.rule.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.ts` (+ `.spec.ts`)
- Create: `apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.ts` (+ `.integration.spec.ts`)
- Create: `apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.ts` (+ `.spec.ts`)
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-redelivery.manager.ts` (+ `.spec.ts`)
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.manager.ts` (+ `.spec.ts`)
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.service.ts` (+ `.spec.ts`)
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.job.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/reconcile-order-sources.ts` — DI 토큰
- Create: `apps/channel-adapter/src/controllers/order-reconcile-findings.controller.ts`
- Create: `apps/channel-adapter/src/controllers/order-reconcile-sweep.controller.ts` (+ `.spec.ts`)
- Modify: `apps/channel-adapter/src/adapter.module.ts`

---

### Task 1: core — 판매주문 묶음 조회 내부 API

**Files:**
- Create: `apps/core/src/modules/sales-order/internal/sales-order-lookup.dto.ts`
- Create: `apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.ts`
- Create: `apps/core/src/modules/sales-order/internal/sales-order-lookup.service.ts`
- Create: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.ts`
- Test: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.spec.ts`
- Test: `apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.integration.spec.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts`

**Interfaces:**
- Produces: `POST /internal/sales-orders/lookup` — 요청 `{ salesChannel: 'medusa'|'naver'|'coupang'; orders: { externalOrderId: string; wmsOrderId?: string }[] }`(1~200), 응답 `{ orders: { externalOrderId: string; salesOrder: { status: string } | null; openEventFailure: boolean }[] }`. 응답 순서 = 요청 순서.

- [ ] **Step 1: 실패하는 컨트롤러 스펙을 쓴다**

```ts
// apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.spec.ts
import { ValidationPipe } from '@nestjs/common';
import { SalesOrdersInternalController } from './sales-orders-internal.controller';
import { SalesOrderLookupRequestDto } from './sales-order-lookup.dto';
import type { SalesOrderLookupService } from './sales-order-lookup.service';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: SalesOrderLookupRequestDto });

describe('SalesOrdersInternalController', () => {
  it('서비스에 그대로 넘기고 응답을 감싼다', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { externalOrderId: 'order_1', salesOrder: { status: 'confirmed' }, openEventFailure: false },
    ]);
    const controller = new SalesOrdersInternalController({ lookup } as unknown as SalesOrderLookupService);
    const dto = await validate({ salesChannel: 'medusa', orders: [{ externalOrderId: 'order_1' }] });

    await expect(controller.lookup(dto)).resolves.toEqual({
      orders: [{ externalOrderId: 'order_1', salesOrder: { status: 'confirmed' }, openEventFailure: false }],
    });
    expect(lookup).toHaveBeenCalledWith('medusa', [{ externalOrderId: 'order_1' }]);
  });

  it('200건을 넘으면 400', async () => {
    const orders = Array.from({ length: 201 }, (_, i) => ({ externalOrderId: `o${i}` }));
    await expect(validate({ salesChannel: 'medusa', orders })).rejects.toThrow();
  });

  it('빈 목록이면 400', async () => {
    await expect(validate({ salesChannel: 'medusa', orders: [] })).rejects.toThrow();
  });

  it('모르는 채널이면 400', async () => {
    await expect(validate({ salesChannel: '3pl', orders: [{ externalOrderId: 'x' }] })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.spec.ts`
Expected: FAIL — `Cannot find module './sales-orders-internal.controller'`

- [ ] **Step 3: DTO·리더·서비스·컨트롤러를 쓴다**

```ts
// apps/core/src/modules/sales-order/internal/sales-order-lookup.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const LOOKUP_SALES_CHANNELS = ['medusa', 'naver', 'coupang'] as const;
export type LookupSalesChannel = (typeof LOOKUP_SALES_CHANNELS)[number];
export const LOOKUP_MAX_ORDERS = 200;

export class SalesOrderLookupItemDto {
  @IsString()
  @MaxLength(255)
  externalOrderId!: string;

  /** 어댑터가 발급한 주문 id(`wms_order_mappings.wms_order_id`). dead letter 의 순서 키다. */
  @IsOptional()
  @IsUUID()
  wmsOrderId?: string;
}

export class SalesOrderLookupRequestDto {
  @IsIn(LOOKUP_SALES_CHANNELS)
  salesChannel!: LookupSalesChannel;

  @ValidateNested({ each: true })
  @Type(() => SalesOrderLookupItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(LOOKUP_MAX_ORDERS)
  orders!: SalesOrderLookupItemDto[];
}

export interface SalesOrderLookupResult {
  externalOrderId: string;
  salesOrder: { status: string } | null;
  openEventFailure: boolean;
}

export interface SalesOrderLookupResponse {
  orders: SalesOrderLookupResult[];
}
```

```ts
// apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.ts
import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { UNRESOLVED_DEAD_LETTER_STATUSES, dead_letters } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import type { LookupSalesChannel } from './sales-order-lookup.dto';

/**
 * 채널 대사(#1016 45번)가 묻는 두 가지만 읽는다 — SO 상태, 그 주문의 이벤트 실패가 열려 있는가.
 * 주소·고객 정보는 판정에 필요 없어 싣지 않는다.
 */
@Injectable()
export class SalesOrderLookupReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async statusesByChannelOrderId(channel: LookupSalesChannel, externalOrderIds: string[]): Promise<Map<string, string>> {
    if (externalOrderIds.length === 0) return new Map();
    const rows = await this.dbService.db
      .select({ channelOrderId: wmsTables.salesOrders.channelOrderId, status: wmsTables.salesOrders.status })
      .from(wmsTables.salesOrders)
      .where(
        and(
          eq(wmsTables.salesOrders.salesChannel, channel),
          inArray(wmsTables.salesOrders.channelOrderId, externalOrderIds),
        ),
      );
    return new Map(rows.map((row) => [row.channelOrderId, row.status]));
  }

  /** 주문 생애 토픽의 순서 키는 `envelope.source.aggregateId` = 어댑터의 `wmsOrderId` 다(7·8번 스펙 §1.4). */
  async wmsOrderIdsWithOpenEventFailure(wmsOrderIds: string[]): Promise<Set<string>> {
    if (wmsOrderIds.length === 0) return new Set();
    const rows = await this.dbService.db
      .selectDistinct({ sequenceKey: dead_letters.sequenceKey })
      .from(dead_letters)
      .where(
        and(
          eq(dead_letters.topic, ORDER_STREAM.topic.topic),
          inArray(dead_letters.status, [...UNRESOLVED_DEAD_LETTER_STATUSES]),
          inArray(dead_letters.sequenceKey, wmsOrderIds),
        ),
      );
    return new Set(rows.flatMap((row) => (row.sequenceKey ? [row.sequenceKey] : [])));
  }
}
```

```ts
// apps/core/src/modules/sales-order/internal/sales-order-lookup.service.ts
import { Injectable } from '@nestjs/common';
import { SalesOrderLookupReader } from './sales-order-lookup.reader';
import type { LookupSalesChannel, SalesOrderLookupItemDto, SalesOrderLookupResult } from './sales-order-lookup.dto';

@Injectable()
export class SalesOrderLookupService {
  constructor(private readonly reader: SalesOrderLookupReader) {}

  async lookup(channel: LookupSalesChannel, orders: SalesOrderLookupItemDto[]): Promise<SalesOrderLookupResult[]> {
    const [statuses, failing] = await Promise.all([
      this.reader.statusesByChannelOrderId(channel, orders.map((order) => order.externalOrderId)),
      this.reader.wmsOrderIdsWithOpenEventFailure(orders.flatMap((order) => (order.wmsOrderId ? [order.wmsOrderId] : []))),
    ]);
    return orders.map((order) => {
      const status = statuses.get(order.externalOrderId);
      return {
        externalOrderId: order.externalOrderId,
        salesOrder: status === undefined ? null : { status },
        openEventFailure: order.wmsOrderId ? failing.has(order.wmsOrderId) : false,
      };
    });
  }
}
```

```ts
// apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { SalesOrderLookupService } from './sales-order-lookup.service';
import { SalesOrderLookupRequestDto, SalesOrderLookupResponse } from './sales-order-lookup.dto';

/**
 * 서비스 간 호출 전용 판매주문 라우트 (#1016 45번). 호출자는 channel-adapter 의 채널 대사다.
 * 클래스 단위 `@InternalOnly()` 라 핸들러를 더해도 보호된다(`SalesChannelsInternalController` 와 같은 이유로 파일을 나눴다).
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/sales-orders')
export class SalesOrdersInternalController {
  constructor(private readonly lookupService: SalesOrderLookupService) {}

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(@Body() dto: SalesOrderLookupRequestDto): Promise<SalesOrderLookupResponse> {
    return { orders: await this.lookupService.lookup(dto.salesChannel, dto.orders) };
  }
}
```

`sales-order.module.ts` 의 `controllers` 에 `SalesOrdersInternalController`, `providers` 에 `SalesOrderLookupReader`·`SalesOrderLookupService` 를 더한다(주석 한 줄: `// 채널 대사(#1016 45번)의 묶음 조회 — 호출자는 channel-adapter`).

- [ ] **Step 4: 컨트롤러 스펙 통과를 확인한다**

Run: `npx jest apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.spec.ts`
Expected: PASS (4)

- [ ] **Step 5: 리더 통합 스펙을 쓴다**

```ts
// apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.integration.spec.ts
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { dead_letters } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrderLookupReader } from './sales-order-lookup.reader';

/**
 * 실행: dotenv -e apps/core/.env -- npx jest --runInBand apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SalesOrderLookupReader (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof wmsSchema>>;
  let reader: SalesOrderLookupReader;
  const suffix = Math.random().toString(36).slice(2, 10);
  const orderA = `spec-lookup-a-${suffix}`;
  const orderB = `spec-lookup-b-${suffix}`;
  const wmsA = '0b6f2f9e-0000-4000-8000-' + suffix.padEnd(12, '0').slice(0, 12);

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: wmsSchema });
    reader = new SalesOrderLookupReader({ db } as never);
  });
  afterAll(async () => {
    await db.delete(wmsTables.salesOrders).where(inArray(wmsTables.salesOrders.channelOrderId, [orderA, orderB]));
    await db.delete(dead_letters).where(eq(dead_letters.sequenceKey, wmsA));
    await client.end({ timeout: 0 });
  });

  it('있는 주문만 상태를 돌려준다', async () => {
    // NOT NULL 이고 기본값 없는 칸은 이 넷뿐이다(inventory.schema.ts 의 salesOrders 정의)
    await db.insert(wmsTables.salesOrders).values({
      channelOrderId: orderA,
      salesChannel: 'medusa',
      status: 'confirmed',
      shippingAddress: {},
      orderDate: new Date(),
    });

    const statuses = await reader.statusesByChannelOrderId('medusa', [orderA, orderB]);
    expect(statuses.get(orderA)).toBe('confirmed');
    expect(statuses.has(orderB)).toBe(false);
  });

  it('주문 생애 토픽의 failed·held 만 열린 실패로 본다', async () => {
    const base = {
      consumerGroup: 'spec',
      handler: 'spec',
      topic: ORDER_STREAM.topic.topic,
      sequenceKey: wmsA,
      envelope: {},
      kafkaPartition: 0,
      kafkaOffset: '0',
    };
    await db.insert(dead_letters).values({ ...base, messageId: `${suffix}-1`, status: 'resolved' });
    await expect(reader.wmsOrderIdsWithOpenEventFailure([wmsA])).resolves.toEqual(new Set());

    await db.insert(dead_letters).values({ ...base, messageId: `${suffix}-2`, status: 'held' });
    await expect(reader.wmsOrderIdsWithOpenEventFailure([wmsA])).resolves.toEqual(new Set([wmsA]));
  });
});
```

- [ ] **Step 6: 통합 스펙을 돌린다(로컬 DB 가 있을 때)**

Run: `dotenv -e apps/core/.env -- npx jest --runInBand apps/core/src/modules/sales-order/internal/sales-order-lookup.reader.integration.spec.ts`
Expected: PASS (2). DB 가 없으면 기본 `npx jest` 에서 skip 인지 확인: `npx jest apps/core/src/modules/sales-order/internal` → `skipped`.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/sales-order/internal apps/core/src/modules/sales-order/sales-order.module.ts
git commit -m "feat(core): 판매주문 묶음 조회 내부 API — 채널 대사가 SO 상태·이벤트 실패 열림을 묻는다 (#1016 45번)"
```

---

### Task 2: channel-adapter — `order_reconcile_findings` 테이블과 저장소

**Files:**
- Modify: `apps/channel-adapter/src/schema.ts`
- Create: `apps/channel-adapter/drizzle/<timestamp>_add-order-reconcile-findings.sql` (생성)
- Create: `apps/channel-adapter/src/services/order-reconcile/order-reconcile.types.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.ts`
- Test: `apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.integration.spec.ts`

**Interfaces:**
- Produces (`order-reconcile.types.ts`):
  ```ts
  export type FindingKind = 'missing_order' | 'cancel_not_applied';
  export type FindingHandling = 'auto' | 'human';
  export type HumanReason = 'out_of_window' | 'core_status' | 'event_failure_open' | 'attempts_exhausted';
  export type ReconcileMode = 'observe' | 'act';
  export type FindingStatus = 'open' | 'resolved' | 'closed';
  ```
- Produces (`OrderReconcileFindingRepository`):
  - `findOpenByOrders(channel: string, externalOrderIds: string[]): Promise<OrderReconcileFinding[]>`
  - `upsertOpen(input: UpsertFindingInput, tx?: AdapterTx): Promise<OrderReconcileFinding>`
  - `recordAttempt(id: string, lastResult: string, tx?: AdapterTx): Promise<void>`
  - `listOpen(channel: string): Promise<OrderReconcileFinding[]>`
  - `markResolved(ids: string[], at: Date): Promise<number>`
  - `close(id: string, actor: string | null, memo: string): Promise<OrderReconcileFinding | null>` — 열린 행만, 아니면 null
  - `findById(id: string): Promise<OrderReconcileFinding | null>`
  - `list(options: { status?: FindingStatus; limit: number; offset: number }): Promise<OrderReconcileFinding[]>`
  - `summary(): Promise<{ open: number; human: number; gaveUp: number; oldestFirstSeenAt: string | null }>`
  - 보조 조회(같은 DB 의 다른 테이블):
    - `mappingsByExternalOrderId(channel: string, ids: string[]): Promise<Map<string, string>>` — 값은 `wmsOrderId`
    - `openQuarantineExternalOrderIds(channel: string, ids: string[]): Promise<Set<string>>`
    - `wmsOrderIdsWithFailedOutbox(wmsOrderIds: string[]): Promise<Set<string>>`
  - `type AdapterTx = TxFor<typeof channelAdapterSchema>`; `type OrderReconcileFinding = typeof orderReconcileFindings.$inferSelect`
  - `interface UpsertFindingInput { channel: string; externalOrderId: string; displayOrderNo: string | null; kind: FindingKind; handling: FindingHandling; humanReason: HumanReason | null; coreStatus: string | null; channelCreatedAt: Date; mode: ReconcileMode; lastResult: string; seenAt: Date }`

- [ ] **Step 1: 스키마에 테이블을 더한다**

`schema.ts` 의 `orderCollectionFailures` 정의 바로 아래에:

```ts
// 🔹 채널 주문 대사 결과 (#1016 45번). 채널엔 있는데 core 에 없거나(`missing_order`) 채널 취소가 core 에 안 닿은(`cancel_not_applied`) 주문.
// 열린 행은 (channel, external_order_id, kind) 당 하나다(부분 unique). 사람이 닫은 뒤 같은 어긋남이 다시 생기면 새 행이다.
export const orderReconcileFindings = pgTable(
  'order_reconcile_findings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    channel: varchar('channel', { length: 50 }).notNull(),
    externalOrderId: varchar('external_order_id', { length: 255 }).notNull(),
    displayOrderNo: varchar('display_order_no', { length: 64 }),
    kind: varchar('kind', { length: 30 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    handling: varchar('handling', { length: 10 }).notNull(),
    humanReason: varchar('human_reason', { length: 30 }),
    coreStatus: varchar('core_status', { length: 30 }),
    channelCreatedAt: timestamp('channel_created_at', { withTimezone: true }).notNull(),
    mode: varchar('mode', { length: 10 }).notNull(),
    lastResult: varchar('last_result', { length: 200 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: varchar('closed_by', { length: 100 }),
    closeMemo: text('close_memo'),
  },
  (table) => [
    uniqueIndex('uq_order_reconcile_findings_open')
      .on(table.channel, table.externalOrderId, table.kind)
      .where(sql`status = 'open'`),
    index('order_reconcile_findings_status_handling_idx').on(table.status, table.handling),
  ],
);
```

`channelAdapterSchema` 객체에 `orderReconcileFindings` 를 더한다. (기존 테이블의 세 번째 인자가 배열 꼴인지 객체 꼴인지 `orderCollectionFailures` 정의 끝을 보고 같은 꼴로 맞춘다.)

- [ ] **Step 2: 마이그레이션을 생성하고 SQL 을 검토한다**

Run: `npm run db:generate:channel-adapter -- --name add-order-reconcile-findings`
Expected: `apps/channel-adapter/drizzle/<timestamp>_add-order-reconcile-findings.sql` 에 `CREATE TABLE "order_reconcile_findings"` 와 `CREATE UNIQUE INDEX "uq_order_reconcile_findings_open" … WHERE status = 'open'`, 인덱스 1개만 있다. 다른 테이블의 변경이 섞였으면 멈추고 원인을 본다(`drizzle.config.ts` 의 schema 목록 밖 변경).
로컬 적용: `npm run db:setup -- --stage dev --deployment lcnine-services` (인터랙티브).

- [ ] **Step 3: 타입 파일과 실패하는 저장소 통합 스펙을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/order-reconcile.types.ts
/** 채널 대사(#1016 45번)의 어휘. 값은 `order_reconcile_findings` 의 varchar 칸에 그대로 들어간다. */
export type FindingKind = 'missing_order' | 'cancel_not_applied';
export type FindingHandling = 'auto' | 'human';
export type HumanReason = 'out_of_window' | 'core_status' | 'event_failure_open' | 'attempts_exhausted';
export type ReconcileMode = 'observe' | 'act';
export type FindingStatus = 'open' | 'resolved' | 'closed';
```

```ts
// apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.integration.spec.ts
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { channelAdapterSchema, orderReconcileFindings } from '../../schema';
import { OrderReconcileFindingRepository, UpsertFindingInput } from './order-reconcile-finding.repository';

/**
 * 실행: dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('OrderReconcileFindingRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof channelAdapterSchema>>;
  let repo: OrderReconcileFindingRepository;
  const channel = `spec-${Math.random().toString(36).slice(2, 10)}`;

  const input = (over: Partial<UpsertFindingInput> = {}): UpsertFindingInput => ({
    channel,
    externalOrderId: 'order_1',
    displayOrderNo: '3900',
    kind: 'missing_order',
    handling: 'auto',
    humanReason: null,
    coreStatus: null,
    channelCreatedAt: new Date('2026-10-15T00:00:00Z'),
    mode: 'observe',
    lastResult: 'would_act',
    seenAt: new Date('2026-10-16T00:00:00Z'),
    ...over,
  });

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: channelAdapterSchema });
    // DbService 는 생성자에서 접속을 연다 — 스펙은 같은 모양(db + run)의 얇은 대역을 쓴다
    const run = <T>(fn: (tx: never) => Promise<T>, tx?: unknown) => (tx ? fn(tx as never) : db.transaction(fn));
    repo = new OrderReconcileFindingRepository({ db, run } as never);
  });
  afterEach(async () => {
    await db.delete(orderReconcileFindings).where(eq(orderReconcileFindings.channel, channel));
  });
  afterAll(async () => {
    await client.end({ timeout: 0 });
  });

  it('같은 열린 어긋남은 한 행을 갱신한다', async () => {
    const first = await repo.upsertOpen(input());
    const second = await repo.upsertOpen(
      input({ handling: 'human', humanReason: 'out_of_window', seenAt: new Date('2026-10-16T01:00:00Z') }),
    );
    expect(second.id).toBe(first.id);
    expect(second.handling).toBe('human');
    expect(second.humanReason).toBe('out_of_window');
    expect(second.firstSeenAt.toISOString()).toBe(first.firstSeenAt.toISOString());
    expect(second.lastSeenAt.toISOString()).toBe('2026-10-16T01:00:00.000Z');
  });

  it('닫힌 행이 있어도 새 open 행을 만든다', async () => {
    const first = await repo.upsertOpen(input());
    await expect(repo.close(first.id, 'admin-1', '셀메이트로 이미 나감')).resolves.toMatchObject({ status: 'closed' });
    const again = await repo.upsertOpen(input());
    expect(again.id).not.toBe(first.id);
    expect(again.status).toBe('open');
  });

  it('닫힌 행은 다시 닫지 못한다', async () => {
    const first = await repo.upsertOpen(input());
    await repo.close(first.id, null, '메모');
    await expect(repo.close(first.id, null, '또')).resolves.toBeNull();
  });

  it('시도 기록은 수를 1 올리고 결과를 남긴다', async () => {
    const row = await repo.upsertOpen(input());
    await repo.recordAttempt(row.id, 'enqueued');
    await expect(repo.findById(row.id)).resolves.toMatchObject({ attemptCount: 1, lastResult: 'enqueued' });
  });

  it('요약은 열린 행만 센다', async () => {
    await repo.upsertOpen(input({ externalOrderId: 'a' }));
    await repo.upsertOpen(input({ externalOrderId: 'b', handling: 'human', humanReason: 'attempts_exhausted' }));
    const c = await repo.upsertOpen(input({ externalOrderId: 'c', handling: 'human', humanReason: 'out_of_window' }));
    await repo.markResolved([c.id], new Date());
    const summary = await repo.summary();
    // 다른 스펙 행이 섞일 수 있어 하한으로 본다 — 이 채널 행만 세는 API 는 두지 않는다
    expect(summary.open).toBeGreaterThanOrEqual(2);
    expect(summary.human).toBeGreaterThanOrEqual(1);
    expect(summary.gaveUp).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.integration.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile-finding.repository'`

- [ ] **Step 5: 저장소를 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.ts
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DbService, TxFor } from '@app/db';
import { outbox_events } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import {
  channelAdapterSchema,
  orderCollectionFailures,
  orderReconcileFindings,
  wmsOrderMappings,
} from '../../schema';
import type { FindingHandling, FindingKind, FindingStatus, HumanReason, ReconcileMode } from './order-reconcile.types';

export type AdapterTx = TxFor<typeof channelAdapterSchema>;
export type OrderReconcileFinding = typeof orderReconcileFindings.$inferSelect;

export interface UpsertFindingInput {
  channel: string;
  externalOrderId: string;
  displayOrderNo: string | null;
  kind: FindingKind;
  handling: FindingHandling;
  humanReason: HumanReason | null;
  coreStatus: string | null;
  channelCreatedAt: Date;
  mode: ReconcileMode;
  lastResult: string;
  seenAt: Date;
}

const OPEN = sql`status = 'open'`;

@Injectable()
export class OrderReconcileFindingRepository {
  constructor(private readonly dbService: DbService<typeof channelAdapterSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async findOpenByOrders(channel: string, externalOrderIds: string[]): Promise<OrderReconcileFinding[]> {
    if (externalOrderIds.length === 0) return [];
    return this.db
      .select()
      .from(orderReconcileFindings)
      .where(
        and(
          eq(orderReconcileFindings.channel, channel),
          eq(orderReconcileFindings.status, 'open'),
          inArray(orderReconcileFindings.externalOrderId, externalOrderIds),
        ),
      );
  }

  async upsertOpen(input: UpsertFindingInput, tx?: AdapterTx): Promise<OrderReconcileFinding> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .insert(orderReconcileFindings)
        .values({
          channel: input.channel,
          externalOrderId: input.externalOrderId,
          displayOrderNo: input.displayOrderNo,
          kind: input.kind,
          handling: input.handling,
          humanReason: input.humanReason,
          coreStatus: input.coreStatus,
          channelCreatedAt: input.channelCreatedAt,
          mode: input.mode,
          lastResult: input.lastResult,
          firstSeenAt: input.seenAt,
          lastSeenAt: input.seenAt,
        })
        .onConflictDoUpdate({
          target: [orderReconcileFindings.channel, orderReconcileFindings.externalOrderId, orderReconcileFindings.kind],
          targetWhere: OPEN,
          set: {
            displayOrderNo: input.displayOrderNo,
            handling: input.handling,
            humanReason: input.humanReason,
            coreStatus: input.coreStatus,
            mode: input.mode,
            lastResult: input.lastResult,
            lastSeenAt: input.seenAt,
          },
        })
        .returning();
      if (!row) throw new Error('order_reconcile_findings upsert returned no row');
      return row;
    }, tx);
  }

  async recordAttempt(id: string, lastResult: string, tx?: AdapterTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      await trx
        .update(orderReconcileFindings)
        .set({
          attemptCount: sql`${orderReconcileFindings.attemptCount} + 1`,
          lastAttemptAt: new Date(),
          lastResult: lastResult.slice(0, 200),
        })
        .where(eq(orderReconcileFindings.id, id));
    }, tx);
  }

  async listOpen(channel: string): Promise<OrderReconcileFinding[]> {
    return this.db
      .select()
      .from(orderReconcileFindings)
      .where(and(eq(orderReconcileFindings.channel, channel), eq(orderReconcileFindings.status, 'open')))
      .orderBy(asc(orderReconcileFindings.firstSeenAt));
  }

  async markResolved(ids: string[], at: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(orderReconcileFindings)
      .set({ status: 'resolved', resolvedAt: at })
      .where(and(inArray(orderReconcileFindings.id, ids), eq(orderReconcileFindings.status, 'open')))
      .returning({ id: orderReconcileFindings.id });
    return rows.length;
  }

  async close(id: string, actor: string | null, memo: string): Promise<OrderReconcileFinding | null> {
    const [row] = await this.db
      .update(orderReconcileFindings)
      .set({ status: 'closed', closedAt: new Date(), closedBy: actor, closeMemo: memo })
      .where(and(eq(orderReconcileFindings.id, id), eq(orderReconcileFindings.status, 'open')))
      .returning();
    return row ?? null;
  }

  async findById(id: string): Promise<OrderReconcileFinding | null> {
    const [row] = await this.db.select().from(orderReconcileFindings).where(eq(orderReconcileFindings.id, id));
    return row ?? null;
  }

  async list(options: { status?: FindingStatus; limit: number; offset: number }): Promise<OrderReconcileFinding[]> {
    const query = this.db.select().from(orderReconcileFindings);
    const filtered = options.status ? query.where(eq(orderReconcileFindings.status, options.status)) : query;
    return filtered
      .orderBy(desc(orderReconcileFindings.lastSeenAt), desc(orderReconcileFindings.id))
      .limit(options.limit)
      .offset(options.offset);
  }

  async summary(): Promise<{ open: number; human: number; gaveUp: number; oldestFirstSeenAt: string | null }> {
    const [row] = await this.db
      .select({
        open: sql<number>`count(*)::int`,
        human: sql<number>`count(*) filter (where ${orderReconcileFindings.handling} = 'human')::int`,
        gaveUp: sql<number>`count(*) filter (where ${orderReconcileFindings.humanReason} = 'attempts_exhausted')::int`,
        oldestFirstSeenAt: sql<
          string | null
        >`to_char(min(${orderReconcileFindings.firstSeenAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(orderReconcileFindings)
      .where(eq(orderReconcileFindings.status, 'open'));
    return {
      open: row?.open ?? 0,
      human: row?.human ?? 0,
      gaveUp: row?.gaveUp ?? 0,
      oldestFirstSeenAt: row?.oldestFirstSeenAt ?? null,
    };
  }

  async mappingsByExternalOrderId(channel: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ channelOrderId: wmsOrderMappings.channelOrderId, wmsOrderId: wmsOrderMappings.wmsOrderId })
      .from(wmsOrderMappings)
      .where(and(eq(wmsOrderMappings.salesChannel, channel), inArray(wmsOrderMappings.channelOrderId, ids)));
    return new Map(rows.map((row) => [row.channelOrderId, row.wmsOrderId]));
  }

  /** 열린 수집 격리는 0단계 격리 칸에 이미 보인다 — 대사가 같은 주문을 또 세지 않는다. */
  async openQuarantineExternalOrderIds(channel: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ externalOrderId: orderCollectionFailures.externalOrderId })
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.status, 'quarantined'),
          inArray(orderCollectionFailures.externalOrderId, ids),
        ),
      );
    return new Set(rows.map((row) => row.externalOrderId));
  }

  /** 7·8번이 같은 주문(`aggregate_id`)의 뒤 이벤트를 보류한다 — 굳은 행이 있으면 다시 보내도 그 뒤에 묶인다(스펙 D8). */
  async wmsOrderIdsWithFailedOutbox(wmsOrderIds: string[]): Promise<Set<string>> {
    if (wmsOrderIds.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ aggregateId: outbox_events.aggregateId })
      .from(outbox_events)
      .where(
        and(
          eq(outbox_events.topic, ORDER_STREAM.topic.topic),
          eq(outbox_events.status, 'FAILED'),
          inArray(outbox_events.aggregateId, wmsOrderIds),
        ),
      );
    return new Set(rows.map((row) => row.aggregateId));
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.integration.spec.ts`
Expected: PASS (5)

- [ ] **Step 7: 커밋** — `schema.ts` + 생성된 SQL + `drizzle/meta/` 를 **한 커밋**에.

```bash
git add apps/channel-adapter/src/schema.ts apps/channel-adapter/drizzle apps/channel-adapter/src/services/order-reconcile
git commit -m "feat(channel-adapter): 채널 대사 결과 테이블 order_reconcile_findings 와 저장소 (#1016 45번)"
```

---

### Task 3: 판정 순수 함수와 규칙 모드

**Files:**
- Create: `apps/channel-adapter/src/services/order-reconcile/rules/missing-order.rule.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/rules/cancel-not-applied.rule.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.ts`
- Test: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.spec.ts`

**Interfaces:**
- Consumes: `FindingKind`, `FindingHandling`, `HumanReason`, `ReconcileMode` (Task 2), `ChannelOrderSnapshot` (`services/order-collection/channel-order-source.interface.ts`)
- Produces:
  ```ts
  export const RECONCILE_WINDOW_MS: number;      // 3일
  export const RECONCILE_GRACE_MS: number;       // 30분
  export const POLL_LOOKBACK_MS: number;         // 2분
  export const MAX_REDELIVERY_ATTEMPTS = 3;
  export interface ClassifyInput {
    snapshot: Pick<ChannelOrderSnapshot, 'externalOrderId' | 'paymentState' | 'sourceUpdatedAt' | 'createdAt' | 'lifecycle'>;
    wmsOrderId: string | null;
    openQuarantine: boolean;
    adapterOutboxFailed: boolean;
    core: { salesOrderStatus: string | null; openEventFailure: boolean };
    /** 이미 열린 행의 시도 수. 종류는 판정 뒤에야 알므로 함수로 받는다. */
    attemptCountFor: (kind: FindingKind) => number;
    pollWatermark: Date | null;
    now: Date;
  }
  export interface ClassifyVerdict { kind: FindingKind; handling: FindingHandling; humanReason: HumanReason | null; coreStatus: string | null }
  export function classifyChannelOrder(input: ClassifyInput): ClassifyVerdict | null;
  export const RECONCILE_RULES: Record<FindingKind, { mode: ReconcileMode }>;
  ```

- [ ] **Step 1: 실패하는 스펙을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.spec.ts
import { ClassifyInput, classifyChannelOrder } from './channel-order-reconcile.classifier';

const NOW = new Date('2026-10-16T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const cancelled = [
  {
    eventType: 'OrderCancelled' as const,
    eventKey: 'cancelled',
    rawEvent: {},
    payload: {
      salesChannel: 'medusa' as const,
      externalOrderId: 'order_1',
      reason: 'ADMIN_CANCEL',
      reasonDetail: 'x',
      cancelledBy: 'medusa',
      cancelledAt: '2026-10-16T09:00:00Z',
      refundRequired: false,
    },
  },
];

const base = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  snapshot: {
    externalOrderId: 'order_1',
    paymentState: 'accepted',
    sourceUpdatedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    createdAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
    lifecycle: [],
  },
  wmsOrderId: null,
  openQuarantine: false,
  adapterOutboxFailed: false,
  core: { salesOrderStatus: null, openEventFailure: false },
  attemptCountFor: () => 0,
  pollWatermark: new Date(NOW.getTime() - 60_000),
  now: NOW,
  ...over,
});
const withSnapshot = (over: Partial<ClassifyInput['snapshot']>, rest: Partial<ClassifyInput> = {}) =>
  base({ ...rest, snapshot: { ...base().snapshot, ...over } });

describe('classifyChannelOrder', () => {
  it('결제 accepted 인데 SO 가 없으면 missing_order · auto', () => {
    expect(classifyChannelOrder(base())).toEqual({
      kind: 'missing_order',
      handling: 'auto',
      humanReason: null,
      coreStatus: null,
    });
  });

  it('결제 accepted 이고 SO 가 있으면 정상', () => {
    expect(classifyChannelOrder(base({ core: { salesOrderStatus: 'confirmed', openEventFailure: false } }))).toBeNull();
  });

  it('pending(무통장 입금 대기·환불 신청)은 원래 core 에 없다', () => {
    expect(classifyChannelOrder(withSnapshot({ paymentState: 'pending' }))).toBeNull();
  });

  it('수집 전에 취소된 주문(매핑 없음)은 정상', () => {
    expect(classifyChannelOrder(withSnapshot({ paymentState: 'terminal', lifecycle: cancelled }))).toBeNull();
  });

  it('취소 · 매핑 있음 · SO 없음 → missing_order', () => {
    expect(
      classifyChannelOrder(withSnapshot({ paymentState: 'terminal', lifecycle: cancelled }, { wmsOrderId: 'w1' })),
    ).toMatchObject({ kind: 'missing_order', handling: 'auto' });
  });

  it('취소 · SO cancelled → 정상', () => {
    expect(
      classifyChannelOrder(
        withSnapshot(
          { paymentState: 'terminal', lifecycle: cancelled },
          { wmsOrderId: 'w1', core: { salesOrderStatus: 'cancelled', openEventFailure: false } },
        ),
      ),
    ).toBeNull();
  });

  it('취소 · SO confirmed → cancel_not_applied · auto (나이 무관, D6)', () => {
    const old = new Date(NOW.getTime() - 30 * 24 * HOUR).toISOString();
    expect(
      classifyChannelOrder(
        withSnapshot(
          { paymentState: 'terminal', lifecycle: cancelled, createdAt: old },
          { wmsOrderId: 'w1', core: { salesOrderStatus: 'confirmed', openEventFailure: false } },
        ),
      ),
    ).toEqual({ kind: 'cancel_not_applied', handling: 'auto', humanReason: null, coreStatus: 'confirmed' });
  });

  it('취소 · SO shipped(셀메이트) → human / core_status', () => {
    expect(
      classifyChannelOrder(
        withSnapshot(
          { paymentState: 'terminal', lifecycle: cancelled },
          { wmsOrderId: 'w1', core: { salesOrderStatus: 'shipped', openEventFailure: false } },
        ),
      ),
    ).toMatchObject({ kind: 'cancel_not_applied', handling: 'human', humanReason: 'core_status' });
  });

  it('생성 3일 밖의 missing_order 는 human / out_of_window (D5)', () => {
    const created = new Date(NOW.getTime() - 3 * 24 * HOUR - 60_000).toISOString();
    expect(classifyChannelOrder(withSnapshot({ createdAt: created }))).toMatchObject({
      handling: 'human',
      humanReason: 'out_of_window',
    });
  });

  it('생성 3일 경계 안쪽은 auto', () => {
    const created = new Date(NOW.getTime() - 3 * 24 * HOUR + 60_000).toISOString();
    expect(classifyChannelOrder(withSnapshot({ createdAt: created }))).toMatchObject({ handling: 'auto' });
  });

  it('열린 수집 격리가 있으면 대사하지 않는다', () => {
    expect(classifyChannelOrder(base({ openQuarantine: true }))).toBeNull();
  });

  it('갱신 30분이 안 된 주문은 건너뛴다', () => {
    expect(
      classifyChannelOrder(withSnapshot({ sourceUpdatedAt: new Date(NOW.getTime() - 29 * 60_000).toISOString() })),
    ).toBeNull();
  });

  it('폴러 워터마크 − 2분 뒤에 갱신된 주문은 건너뛴다 (폴러 정체)', () => {
    const watermark = new Date(NOW.getTime() - 5 * HOUR);
    expect(classifyChannelOrder(base({ pollWatermark: watermark }))).toBeNull();
  });

  it('워터마크가 없으면(폴러가 한 번도 안 돎) 판정하지 않는다', () => {
    expect(classifyChannelOrder(base({ pollWatermark: null }))).toBeNull();
  });

  it('어댑터 outbox FAILED 나 core 이벤트 실패가 열려 있으면 human / event_failure_open (D8)', () => {
    expect(classifyChannelOrder(base({ wmsOrderId: 'w1', adapterOutboxFailed: true }))).toMatchObject({
      handling: 'human',
      humanReason: 'event_failure_open',
    });
    expect(
      classifyChannelOrder(base({ wmsOrderId: 'w1', core: { salesOrderStatus: null, openEventFailure: true } })),
    ).toMatchObject({ handling: 'human', humanReason: 'event_failure_open' });
  });

  it('시도 3회에 닿으면 human / attempts_exhausted', () => {
    expect(classifyChannelOrder(base({ attemptCountFor: () => 3 }))).toMatchObject({
      handling: 'human',
      humanReason: 'attempts_exhausted',
    });
  });

  it('시도 수는 판정된 종류의 것만 본다', () => {
    // missing_order 로 3번 시도했던 주문이 이제 cancel_not_applied 로 판정되면 새로 센다
    const input = withSnapshot(
      { paymentState: 'terminal', lifecycle: cancelled },
      {
        wmsOrderId: 'w1',
        core: { salesOrderStatus: 'confirmed', openEventFailure: false },
        attemptCountFor: (kind) => (kind === 'missing_order' ? 3 : 0),
      },
    );
    expect(classifyChannelOrder(input)).toMatchObject({ kind: 'cancel_not_applied', handling: 'auto' });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.spec.ts`
Expected: FAIL — `Cannot find module './channel-order-reconcile.classifier'`

- [ ] **Step 3: 규칙 파일과 판정 함수를 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/rules/missing-order.rule.ts
import type { ReconcileMode } from '../order-reconcile.types';

/**
 * «core 에 없음» 규칙 (#1016 45번). 관찰 모드로 먼저 배포하고, 거짓 양성 0 을 본 뒤 PR 로 `act` 로 바꾼다.
 * #1016 «관찰 모드 규칙» 절의 grep 이 이 줄을 찾는다 — 모양을 바꾸지 말 것.
 */
export class MissingOrderRule {
  readonly kind = 'missing_order' as const;
  readonly mode: ReconcileMode = 'observe';
}
```

```ts
// apps/channel-adapter/src/services/order-reconcile/rules/cancel-not-applied.rule.ts
import type { ReconcileMode } from '../order-reconcile.types';

/** «취소 미반영» 규칙 (#1016 45번). 전환은 `MissingOrderRule` 과 따로 한다. */
export class CancelNotAppliedRule {
  readonly kind = 'cancel_not_applied' as const;
  readonly mode: ReconcileMode = 'observe';
}
```

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.ts
import type { ChannelOrderSnapshot } from '../order-collection/channel-order-source.interface';
import type { FindingHandling, FindingKind, HumanReason, ReconcileMode } from './order-reconcile.types';
import { CancelNotAppliedRule } from './rules/cancel-not-applied.rule';
import { MissingOrderRule } from './rules/missing-order.rule';

const MINUTE = 60 * 1000;
export const RECONCILE_WINDOW_MS = 3 * 24 * 60 * MINUTE;
export const RECONCILE_GRACE_MS = 30 * MINUTE;
/** 폴러의 lookback(`order-poller.orchestrator.ts` WATERMARK_LOOKBACK_MS)과 같은 값. */
export const POLL_LOOKBACK_MS = 2 * MINUTE;
export const MAX_REDELIVERY_ATTEMPTS = 3;
/** 셀메이트 스크립트가 쓴 `shipped` 등에 취소를 보내면 core 가 거절한다(스펙 D6). */
const AUTO_CANCEL_CORE_STATUSES: ReadonlySet<string> = new Set(['pending', 'confirmed']);

export const RECONCILE_RULES: Record<FindingKind, { mode: ReconcileMode }> = {
  missing_order: new MissingOrderRule(),
  cancel_not_applied: new CancelNotAppliedRule(),
};

export interface ClassifyInput {
  snapshot: Pick<ChannelOrderSnapshot, 'externalOrderId' | 'paymentState' | 'sourceUpdatedAt' | 'createdAt' | 'lifecycle'>;
  wmsOrderId: string | null;
  openQuarantine: boolean;
  adapterOutboxFailed: boolean;
  core: { salesOrderStatus: string | null; openEventFailure: boolean };
  /** 이미 열린 행의 시도 수. 종류는 판정 뒤에야 알므로 함수로 받는다. */
  attemptCountFor: (kind: FindingKind) => number;
  pollWatermark: Date | null;
  now: Date;
}

export interface ClassifyVerdict {
  kind: FindingKind;
  handling: FindingHandling;
  humanReason: HumanReason | null;
  coreStatus: string | null;
}

/**
 * 채널 스냅샷 하나를 «core 에 있어야 하는 모양»과 비교한다(스펙 §5.3·§5.4). 기대값은 폴러가 쓰는 스냅샷 해석
 * (`paymentState`·lifecycle 관측) 그대로다 — 수집 조건을 여기서 다시 구현하지 않는다.
 * null = 정상이거나 아직 판정할 때가 아니다.
 */
export function classifyChannelOrder(input: ClassifyInput): ClassifyVerdict | null {
  const { snapshot, core, now } = input;
  if (input.openQuarantine) return null;
  if (!input.pollWatermark) return null;

  // 두 기준 중 «이른» 쪽보다 뒤면 아직 폴링·전달 중일 수 있다(계획 정정 1).
  const cutoff = Math.min(now.getTime() - RECONCILE_GRACE_MS, input.pollWatermark.getTime() - POLL_LOOKBACK_MS);
  if (new Date(snapshot.sourceUpdatedAt).getTime() > cutoff) return null;

  const cancelledOnChannel = snapshot.lifecycle.some((observation) => observation.eventType === 'OrderCancelled');
  const soStatus = core.salesOrderStatus;
  let kind: FindingKind;
  if (cancelledOnChannel) {
    if (!input.wmsOrderId) return null;
    if (soStatus === null) kind = 'missing_order';
    else if (soStatus === 'cancelled') return null;
    else kind = 'cancel_not_applied';
  } else if (snapshot.paymentState === 'accepted') {
    if (soStatus !== null) return null;
    kind = 'missing_order';
  } else {
    return null;
  }

  return { kind, coreStatus: soStatus, ...handlingFor(kind, input) };
}

function handlingFor(kind: FindingKind, input: ClassifyInput): { handling: FindingHandling; humanReason: HumanReason | null } {
  const human = (humanReason: HumanReason) => ({ handling: 'human' as const, humanReason });
  if (input.adapterOutboxFailed || input.core.openEventFailure) return human('event_failure_open');
  if (input.attemptCountFor(kind) >= MAX_REDELIVERY_ATTEMPTS) return human('attempts_exhausted');
  if (kind === 'missing_order') {
    const age = input.now.getTime() - new Date(input.snapshot.createdAt).getTime();
    if (age > RECONCILE_WINDOW_MS) return human('out_of_window');
  }
  if (kind === 'cancel_not_applied' && !AUTO_CANCEL_CORE_STATUSES.has(input.core.salesOrderStatus ?? '')) {
    return human('core_status');
  }
  return { handling: 'auto', humanReason: null };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.spec.ts`
Expected: PASS (17)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/order-reconcile
git commit -m "feat(channel-adapter): 채널 대사 판정 — 폴러와 같은 스냅샷 해석으로 core 에 없음·취소 미반영을 가른다 (#1016 45번)"
```

---

### Task 4: core 조회 클라이언트

**Files:**
- Create: `apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.ts`
- Test: `apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CoreSalesOrderLookupItem { externalOrderId: string; salesOrder: { status: string } | null; openEventFailure: boolean }
  export class CoreSalesOrderLookupClient {
    lookup(channel: SalesChannel, orders: { externalOrderId: string; wmsOrderId?: string }[]): Promise<Map<string, CoreSalesOrderLookupItem>>;
  }
  export const CORE_LOOKUP_BATCH = 200;
  ```
  실패(키 없음·HTTP 오류·응답 모양 어긋남)는 **던진다** — «모름»을 «없음»으로 뭉개지 않는다(`SalesChannelClient` 와 같은 원칙).

- [ ] **Step 1: 실패하는 스펙을 쓴다**

```ts
// apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.spec.ts
import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { CORE_LOOKUP_BATCH, CoreSalesOrderLookupClient } from './core-sales-order-lookup.client';

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('CoreSalesOrderLookupClient', () => {
  it('200건씩 나눠 묻고 결과를 externalOrderId 로 모은다', async () => {
    // 세 번째 인자(요청 설정)까지 선언해야 mock.calls[0][2] 가 타입 검사를 지난다
    const post = jest.fn((_url: string, body: { orders: { externalOrderId: string }[] }, _config?: unknown) =>
      of({
        data: {
          orders: body.orders.map((order) => ({ externalOrderId: order.externalOrderId, salesOrder: null, openEventFailure: false })),
        },
      }),
    );
    const client = new CoreSalesOrderLookupClient(
      { post } as unknown as HttpService,
      config({ CORE_INTERNAL_KEY: 'k', PIM_API_URL: 'http://core' }),
    );
    const orders = Array.from({ length: CORE_LOOKUP_BATCH + 1 }, (_, i) => ({ externalOrderId: `o${i}` }));

    const result = await client.lookup('medusa', orders);

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe('http://core/internal/sales-orders/lookup');
    expect(post.mock.calls[0][2]).toMatchObject({ headers: { Authorization: 'Bearer k' } });
    expect(result.size).toBe(CORE_LOOKUP_BATCH + 1);
  });

  it('빈 목록이면 부르지 않는다', async () => {
    const post = jest.fn();
    const client = new CoreSalesOrderLookupClient({ post } as unknown as HttpService, config({ CORE_INTERNAL_KEY: 'k' }));
    await expect(client.lookup('medusa', [])).resolves.toEqual(new Map());
    expect(post).not.toHaveBeenCalled();
  });

  it('키가 없으면 던진다', async () => {
    const client = new CoreSalesOrderLookupClient({ post: jest.fn() } as unknown as HttpService, config({}));
    await expect(client.lookup('medusa', [{ externalOrderId: 'a' }])).rejects.toThrow('CORE_INTERNAL_KEY');
  });

  it('HTTP 오류는 던진다', async () => {
    const post = jest.fn(() => throwError(() => new Error('502')));
    const client = new CoreSalesOrderLookupClient({ post } as unknown as HttpService, config({ CORE_INTERNAL_KEY: 'k' }));
    await expect(client.lookup('medusa', [{ externalOrderId: 'a' }])).rejects.toThrow('502');
  });

  it('응답에 물은 주문이 빠져 있으면 던진다', async () => {
    const post = jest.fn(() => of({ data: { orders: [] } }));
    const client = new CoreSalesOrderLookupClient({ post } as unknown as HttpService, config({ CORE_INTERNAL_KEY: 'k' }));
    await expect(client.lookup('medusa', [{ externalOrderId: 'a' }])).rejects.toThrow('a');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 클라이언트를 쓴다**

```ts
// apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { SalesChannel } from '@packages/event-contracts/streams';

export const CORE_LOOKUP_BATCH = 200;

export interface CoreSalesOrderLookupItem {
  externalOrderId: string;
  salesOrder: { status: string } | null;
  openEventFailure: boolean;
}

/**
 * core 판매주문 묶음 조회 (#1016 45번). 채널 대사가 주기마다 부른다.
 *
 * 실패를 삼키지 않는다 — «core 가 모른다»를 «SO 가 없다»로 읽으면 그 주기의 모든 주문이 `missing_order` 가 된다.
 * 판정은 호출부(대사 매니저)가 «주기 건너뛰기»로 한다.
 */
@Injectable()
export class CoreSalesOrderLookupClient {
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('PIM_API_URL') || 'http://localhost:3001';
  }

  async lookup(
    channel: SalesChannel,
    orders: { externalOrderId: string; wmsOrderId?: string }[],
  ): Promise<Map<string, CoreSalesOrderLookupItem>> {
    const result = new Map<string, CoreSalesOrderLookupItem>();
    if (orders.length === 0) return result;
    const internalKey = this.configService.get<string>('CORE_INTERNAL_KEY');
    if (!internalKey) {
      throw new Error('CORE_INTERNAL_KEY 가 설정되지 않아 core 판매주문을 조회할 수 없다.');
    }
    for (let i = 0; i < orders.length; i += CORE_LOOKUP_BATCH) {
      const batch = orders.slice(i, i + CORE_LOOKUP_BATCH);
      const response = await firstValueFrom(
        this.httpService.post<{ orders: CoreSalesOrderLookupItem[] }>(
          `${this.baseUrl}/internal/sales-orders/lookup`,
          { salesChannel: channel, orders: batch },
          { headers: { Authorization: `Bearer ${internalKey}` }, timeout: 10_000 },
        ),
      );
      const items = response.data?.orders ?? [];
      for (const item of items) result.set(item.externalOrderId, item);
      const missing = batch.find((order) => !result.has(order.externalOrderId));
      if (missing) throw new Error(`core 조회 응답에 ${missing.externalOrderId} 가 없다`);
    }
    return result;
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.spec.ts`
Expected: PASS (5)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.ts apps/channel-adapter/src/services/clients/core-sales-order-lookup.client.spec.ts
git commit -m "feat(channel-adapter): core 판매주문 묶음 조회 클라이언트 — 실패를 «없음»으로 뭉개지 않는다 (#1016 45번)"
```

---

### Task 5: 다시 배달하기

**Files:**
- Create: `apps/channel-adapter/src/services/order-reconcile/reconcile-order-sources.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-redelivery.manager.ts`
- Test: `apps/channel-adapter/src/services/order-reconcile/channel-order-redelivery.manager.spec.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts` — `isSyncableProvider` 타입 가드를 export
- Modify: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts:881-883` — private `isSyncableProvider` 를 지우고 위 함수를 쓴다

**Interfaces:**
- Consumes: `OrderReconcileFindingRepository.recordAttempt`·`mappingsByExternalOrderId` (Task 2), `OrderPollerOrchestrator.syncOrder(channel, externalOrderId, options?)` → `{ outcome: OrderSyncOutcome }`, `CHANNEL_ORDER_PROVIDER` 배열(`SyncableChannelOrderProvider.fetchOrderForSync(externalOrderId)` → `OrderSyncFetch | null`), `@InjectPublisher(ORDER_STREAM)` 의 `enqueue(event, tx)`
- Produces:
  ```ts
  export type RedeliveryResult = OrderSyncOutcome | 'enqueued' | 'no_mapping' | 'nothing_to_send';
  // channel-order-provider.interface.ts
  export function isSyncableProvider(provider: ChannelOrderProvider): provider is SyncableChannelOrderProvider;
  export class ChannelOrderRedeliveryManager {
    redeliver(finding: Pick<OrderReconcileFinding, 'id' | 'channel' | 'externalOrderId' | 'kind'>): Promise<RedeliveryResult>;
  }
  // reconcile-order-sources.ts
  export const RECONCILE_ORDER_SOURCES = Symbol('RECONCILE_ORDER_SOURCES');
  ```
  모든 경로가 끝에 `recordAttempt(finding.id, result)` 를 한다. 적재하는 경로는 적재와 같은 tx 에서 한다.

- [ ] **Step 1: 실패하는 스펙을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-redelivery.manager.spec.ts
import type { OrderSyncFetch } from '../order-collection/channel-order-provider.interface';
import { ChannelOrderRedeliveryManager } from './channel-order-redelivery.manager';

const TX = Symbol('tx');
const createPayload = { orderId: 'fresh-uuid', externalOrderId: 'order_1', salesChannel: 'medusa' };
const cancelItem = {
  eventType: 'OrderCancelled' as const,
  externalOrderId: 'order_1',
  sourceUpdatedAt: '2026-10-16T00:00:00Z',
  eventKey: 'cancelled',
  rawEvent: {},
  payload: { reason: 'ADMIN_CANCEL', cancelledBy: 'medusa', cancelledAt: '2026-10-16T00:00:00Z', refundRequired: false },
};
const fetched = (lifecycle: unknown[] = []): OrderSyncFetch =>
  ({ outcome: { kind: 'order', order: { createPayload } }, lifecycle }) as unknown as OrderSyncFetch;

function setup(opts: { mapping?: string; fetch?: OrderSyncFetch | null; enqueueThrows?: boolean } = {}) {
  const enqueue = jest.fn(async (_event: { eventType: string }, _tx?: unknown) => {
    if (opts.enqueueThrows) throw new Error('outbox down');
  });
  const recordAttempt = jest.fn(async () => undefined);
  const repo = {
    mappingsByExternalOrderId: jest.fn(async () => new Map(opts.mapping ? [['order_1', opts.mapping]] : [])),
    recordAttempt,
  };
  const provider = { channel: 'medusa', fetchOrders: jest.fn(), fetchOrderForSync: jest.fn(async () => opts.fetch ?? null) };
  const orchestrator = { syncOrder: jest.fn(async () => ({ outcome: 'created' })) };
  const db = { run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) };
  const manager = new ChannelOrderRedeliveryManager(
    [provider] as never,
    { enqueue } as never,
    repo as never,
    orchestrator as never,
    db as never,
  );
  return { manager, enqueue, recordAttempt, orchestrator, provider };
}
const finding = (kind: 'missing_order' | 'cancel_not_applied') => ({ id: 'f1', channel: 'medusa', externalOrderId: 'order_1', kind });

describe('ChannelOrderRedeliveryManager', () => {
  it('missing_order · 매핑 없음 → 폴링과 같은 syncOrder', async () => {
    const { manager, orchestrator, recordAttempt, enqueue } = setup();
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('created');
    expect(orchestrator.syncOrder).toHaveBeenCalledWith('medusa', 'order_1');
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith('f1', 'created');
  });

  it('missing_order · 매핑 있음 → 기존 wmsOrderId 로 OrderCreated, 적재와 시도 기록이 같은 tx', async () => {
    const { manager, enqueue, recordAttempt } = setup({ mapping: 'wms-1', fetch: fetched() });
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('enqueued');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OrderCreated',
        aggregateId: 'wms-1',
        payload: expect.objectContaining({ orderId: 'wms-1', externalOrderId: 'order_1' }),
        partitionKey: 'medusa',
      }),
      TX,
    );
    expect(recordAttempt).toHaveBeenCalledWith('f1', 'enqueued', TX);
  });

  it('missing_order · 매핑 있음 · 채널 취소 → OrderCreated 뒤 OrderCancelled', async () => {
    const { manager, enqueue } = setup({ mapping: 'wms-1', fetch: fetched([cancelItem]) });
    await manager.redeliver(finding('missing_order'));
    expect(enqueue.mock.calls.map((call) => call[0].eventType)).toEqual([
      'OrderCreated',
      'OrderCancelled',
    ]);
  });

  it('cancel_not_applied → 처음 본 것 검사 없이 OrderCancelled 를 채널 키와 함께', async () => {
    const { manager, enqueue } = setup({ mapping: 'wms-1', fetch: fetched([cancelItem]) });
    await expect(manager.redeliver(finding('cancel_not_applied'))).resolves.toBe('enqueued');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OrderCancelled',
        aggregateId: 'wms-1',
        payload: expect.objectContaining({ orderId: 'wms-1', salesChannel: 'medusa', externalOrderId: 'order_1' }),
      }),
      TX,
    );
  });

  it('cancel_not_applied 인데 채널에 취소 관측이 없으면 nothing_to_send', async () => {
    const { manager, enqueue, recordAttempt } = setup({ mapping: 'wms-1', fetch: fetched([]) });
    await expect(manager.redeliver(finding('cancel_not_applied'))).resolves.toBe('nothing_to_send');
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith('f1', 'nothing_to_send');
  });

  it('채널에서 주문을 못 찾으면 not_found', async () => {
    const { manager } = setup({ mapping: 'wms-1', fetch: null });
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('not_found');
  });

  it('적재가 던지면 시도 기록도 남기지 않고 던진다(같은 tx 롤백)', async () => {
    const { manager, recordAttempt } = setup({ mapping: 'wms-1', fetch: fetched(), enqueueThrows: true });
    await expect(manager.redeliver(finding('missing_order'))).rejects.toThrow('outbox down');
    expect(recordAttempt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-redelivery.manager.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/reconcile-order-sources.ts
/**
 * 대사 가능한 채널 source 목록 (#1016 45번). `fetchOrders(since)` 가 «since 이후 갱신된 전부»를 주는 열린 질의여야 한다.
 * 네이버(닫힌 24시간 창)는 개통 때 따로 붙인다.
 */
export const RECONCILE_ORDER_SOURCES = Symbol('RECONCILE_ORDER_SOURCES');
```

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-redelivery.manager.ts
import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { ORDER_STREAM, OrderCancelledPayload } from '@packages/event-contracts/streams';
import { channelAdapterSchema } from '../../schema';
import {
  CHANNEL_ORDER_PROVIDER,
  ChannelOrderProvider,
  OrderLifecycleEventItem,
  SyncableChannelOrderProvider,
  isSyncableProvider,
} from '../order-collection/channel-order-provider.interface';
import { OrderPollerOrchestrator, OrderSyncOutcome } from '../order-collection/order-poller.orchestrator';
import { AdapterTx, OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';

export type RedeliveryResult = OrderSyncOutcome | 'enqueued' | 'no_mapping' | 'nothing_to_send';

type CancelItem = Extract<OrderLifecycleEventItem, { eventType: 'OrderCancelled' }>;

/**
 * 대사가 찾은 어긋남을 «다시 배달»한다 (#1016 45번 스펙 §6.2). 기존 `syncOrder` 는 매핑 있는 주문엔 `OrderModified` 만,
 * 취소엔 «처음 본 것만»(`claimFirstSeen`)이라 force 로도 다시 안 낸다 — 그래서 두 경로를 새로 둔다.
 * 매핑·해시는 건드리지 않는다. core 는 생성(채널 키)·취소(새 메시지 id) 모두 멱등이다.
 */
@Injectable()
export class ChannelOrderRedeliveryManager {
  constructor(
    @Inject(CHANNEL_ORDER_PROVIDER) private readonly providers: ChannelOrderProvider[],
    @InjectPublisher(ORDER_STREAM) private readonly ordersPublisher: PublisherFor<typeof ORDER_STREAM>,
    private readonly findings: OrderReconcileFindingRepository,
    private readonly orderPoller: OrderPollerOrchestrator,
    private readonly dbService: DbService<typeof channelAdapterSchema>,
  ) {}

  async redeliver(
    finding: Pick<OrderReconcileFinding, 'id' | 'channel' | 'externalOrderId' | 'kind'>,
  ): Promise<RedeliveryResult> {
    const provider = this.syncableProvider(finding.channel);
    const mappings = await this.findings.mappingsByExternalOrderId(finding.channel, [finding.externalOrderId]);
    const wmsOrderId = mappings.get(finding.externalOrderId);

    if (finding.kind === 'missing_order' && !wmsOrderId) {
      // 어댑터가 못 본 주문 — 폴링과 같은 경로가 매핑·OrderCreated·해시를 만든다.
      const { outcome } = await this.orderPoller.syncOrder(provider.channel, finding.externalOrderId);
      await this.findings.recordAttempt(finding.id, outcome);
      return outcome;
    }
    if (!wmsOrderId) return this.done(finding.id, 'no_mapping');

    const fetched = await provider.fetchOrderForSync(finding.externalOrderId);
    if (!fetched) return this.done(finding.id, 'not_found');
    const cancel = fetched.lifecycle.find((item): item is CancelItem => item.eventType === 'OrderCancelled');

    if (finding.kind === 'cancel_not_applied') {
      if (!cancel) return this.done(finding.id, 'nothing_to_send');
      return this.dbService.run(async (tx) => {
        await this.enqueueCancel(provider.channel, wmsOrderId, cancel, tx);
        await this.findings.recordAttempt(finding.id, 'enqueued', tx);
        return 'enqueued' as const;
      });
    }

    if (fetched.outcome.kind === 'failure') return this.done(finding.id, 'identification_failed');
    const createPayload = { ...fetched.outcome.order.createPayload, orderId: wmsOrderId };
    return this.dbService.run(async (tx) => {
      await this.ordersPublisher.enqueue(
        {
          eventType: 'OrderCreated',
          aggregateId: wmsOrderId,
          payload: createPayload,
          partitionKey: provider.channel,
          metadata: { partitionKey: provider.channel },
        },
        tx,
      );
      // SO 가 생겨야 취소도 닿는다 — 같은 aggregateId 라 순서가 지켜진다.
      if (cancel) await this.enqueueCancel(provider.channel, wmsOrderId, cancel, tx);
      await this.findings.recordAttempt(finding.id, 'enqueued', tx);
      return 'enqueued' as const;
    });
  }

  private async enqueueCancel(channel: ChannelOrderProvider['channel'], wmsOrderId: string, item: CancelItem, tx: AdapterTx) {
    const payload: OrderCancelledPayload = {
      orderId: wmsOrderId,
      salesChannel: channel,
      externalOrderId: item.externalOrderId,
      ...item.payload,
    };
    await this.ordersPublisher.enqueue(
      {
        eventType: 'OrderCancelled',
        aggregateId: wmsOrderId,
        payload,
        partitionKey: channel,
        metadata: { partitionKey: channel },
      },
      tx,
    );
  }

  private async done<R extends RedeliveryResult>(findingId: string, result: R): Promise<R> {
    await this.findings.recordAttempt(findingId, result);
    return result;
  }

  private syncableProvider(channel: string): SyncableChannelOrderProvider {
    const provider = this.providers.find((candidate) => candidate.channel === channel);
    if (!provider || !isSyncableProvider(provider)) {
      throw new Error(`No syncable order provider registered for channel: ${channel}`);
    }
    return provider;
  }
}
```

`channel-order-provider.interface.ts` 끝에 오케스트레이터의 판정을 옮긴다(같은 판정을 두 곳에 두지 않는다):

```ts
/** 즉시 끌어오기·다시 배달이 함께 쓰는 좁힘. `fetchOrderForSync` 는 선택 메서드라 존재로만 가른다. */
export function isSyncableProvider(provider: ChannelOrderProvider): provider is SyncableChannelOrderProvider {
  return typeof (provider as SyncableChannelOrderProvider).fetchOrderForSync === 'function';
}
```

`order-poller.orchestrator.ts` 의 `private isSyncableProvider` 를 지우고, `this.isSyncableProvider(x)` 호출을 전부 `isSyncableProvider(x)` 로 바꾼다(import 추가). 기존 `order-poller.orchestrator.spec.ts` 가 그대로 통과해야 한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-redelivery.manager.spec.ts apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts`
Expected: PASS (새 7 + 기존 오케스트레이터 스펙 전부)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/order-reconcile apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts
git commit -m "feat(channel-adapter): 다시 배달하기 — 매핑 있는 OrderCreated·첫 관측 검사 없는 OrderCancelled (#1016 45번)"
```

---

### Task 6: 대사 한 주기

**Files:**
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.manager.ts`
- Test: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.manager.spec.ts`

**Interfaces:**
- Consumes: `classifyChannelOrder`·`RECONCILE_RULES`·`POLL_LOOKBACK_MS` (Task 3), `OrderReconcileFindingRepository` (Task 2), `CoreSalesOrderLookupClient.lookup` (Task 4), `ChannelOrderRedeliveryManager.redeliver` (Task 5), `RECONCILE_ORDER_SOURCES`(`ChannelOrderSource[]`), `SyncStatusService.getSyncStatus(channelType, 'orders')` → `{ lastSyncAt: Date | null } | null`
- Produces:
  ```ts
  export interface ReconcileCycleReport {
    channel: string;
    scanned: number;
    findings: number;
    redelivered: number;
    resolved: number;
    skipped?: 'no_source' | 'core_unavailable';
  }
  export class ChannelOrderReconcileManager {
    runCycle(channel: SalesChannel, options: { updatedAfter: Date; now: Date; observeOnly: boolean }): Promise<ReconcileCycleReport>;
  }
  ```

- [ ] **Step 1: 실패하는 스펙을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.manager.spec.ts
import { ChannelOrderReconcileManager } from './channel-order-reconcile.manager';
import { RECONCILE_RULES } from './channel-order-reconcile.classifier';

const NOW = new Date('2026-10-16T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const snapshot = (id: string, over: Record<string, unknown> = {}) => ({
  externalOrderId: id,
  displayOrderNo: `D-${id}`,
  paymentState: 'accepted',
  sourceUpdatedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
  createdAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
  lifecycle: [],
  ...over,
});

function setup(opts: { core?: 'down' | Record<string, string | null>; open?: unknown[]; redeliverThrows?: boolean } = {}) {
  const source = { channel: 'medusa', fetchOrders: jest.fn(async () => [snapshot('a'), snapshot('b')]) };
  const repo = {
    mappingsByExternalOrderId: jest.fn(async () => new Map()),
    openQuarantineExternalOrderIds: jest.fn(async () => new Set()),
    wmsOrderIdsWithFailedOutbox: jest.fn(async () => new Set()),
    findOpenByOrders: jest.fn(async () => []),
    upsertOpen: jest.fn(async (input: { externalOrderId: string; kind: string }) => ({ id: `f-${input.externalOrderId}`, ...input })),
    recordAttempt: jest.fn(async () => undefined),
    listOpen: jest.fn(async () => opts.open ?? []),
    markResolved: jest.fn(async (ids: string[]) => ids.length),
  };
  const statuses = opts.core === 'down' ? null : (opts.core ?? { a: null, b: 'confirmed' });
  const lookup = {
    lookup: jest.fn(async (_c: string, orders: { externalOrderId: string }[]) => {
      if (!statuses) throw new Error('core 502');
      return new Map(
        orders.map((o) => [
          o.externalOrderId,
          {
            externalOrderId: o.externalOrderId,
            salesOrder: statuses[o.externalOrderId] ? { status: statuses[o.externalOrderId] as string } : null,
            openEventFailure: false,
          },
        ]),
      );
    }),
  };
  const redelivery = {
    redeliver: jest.fn(async () => {
      if (opts.redeliverThrows) throw new Error('outbox down');
      return 'enqueued';
    }),
  };
  const syncStatus = { getSyncStatus: jest.fn(async () => ({ lastSyncAt: new Date(NOW.getTime() - 60_000) })) };
  const manager = new ChannelOrderReconcileManager(
    [source] as never,
    repo as never,
    lookup as never,
    redelivery as never,
    syncStatus as never,
  );
  return { manager, repo, lookup, redelivery, source };
}
const run = (manager: ChannelOrderReconcileManager, observeOnly = false) =>
  manager.runCycle('medusa', { updatedAfter: new Date(NOW.getTime() - 72 * HOUR), now: NOW, observeOnly });

describe('ChannelOrderReconcileManager', () => {
  const original = { ...RECONCILE_RULES.missing_order };
  afterEach(() => {
    RECONCILE_RULES.missing_order.mode = original.mode;
  });

  it('관찰 모드: 불일치를 would_act 로 기록하고 아무것도 보내지 않는다', async () => {
    RECONCILE_RULES.missing_order.mode = 'observe';
    const { manager, repo, redelivery } = setup();
    const report = await run(manager);
    expect(repo.upsertOpen).toHaveBeenCalledTimes(1);
    expect(repo.upsertOpen).toHaveBeenCalledWith(
      expect.objectContaining({ externalOrderId: 'a', kind: 'missing_order', mode: 'observe', lastResult: 'would_act', displayOrderNo: 'D-a' }),
    );
    expect(redelivery.redeliver).not.toHaveBeenCalled();
    expect(report).toMatchObject({ scanned: 2, findings: 1, redelivered: 0 });
  });

  it('실행 모드: auto 불일치를 다시 배달한다', async () => {
    RECONCILE_RULES.missing_order.mode = 'act';
    const { manager, redelivery } = setup();
    const report = await run(manager);
    expect(redelivery.redeliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-a', kind: 'missing_order' }));
    expect(report.redelivered).toBe(1);
  });

  it('observeOnly(처음 한 번 훑기)는 규칙이 act 여도 보내지 않는다', async () => {
    RECONCILE_RULES.missing_order.mode = 'act';
    const { manager, repo, redelivery } = setup();
    await run(manager, true);
    expect(repo.upsertOpen).toHaveBeenCalledWith(expect.objectContaining({ mode: 'observe' }));
    expect(redelivery.redeliver).not.toHaveBeenCalled();
  });

  it('core 조회 실패면 아무것도 기록하지 않는다', async () => {
    const { manager, repo } = setup({ core: 'down' });
    const report = await run(manager);
    expect(report.skipped).toBe('core_unavailable');
    expect(repo.upsertOpen).not.toHaveBeenCalled();
    expect(repo.markResolved).not.toHaveBeenCalled();
  });

  it('다시 배달이 던지면 오류를 last_result 로 남기고 다음 주문으로 간다', async () => {
    RECONCILE_RULES.missing_order.mode = 'act';
    const { manager, repo } = setup({ core: { a: null, b: null }, redeliverThrows: true });
    await run(manager);
    expect(repo.recordAttempt).toHaveBeenCalledWith('f-a', 'error: outbox down');
    expect(repo.recordAttempt).toHaveBeenCalledWith('f-b', 'error: outbox down');
  });

  it('열린 행은 core 조회만으로 해소를 확인한다', async () => {
    const open = [
      { id: 'o1', externalOrderId: 'x', kind: 'missing_order' },
      { id: 'o2', externalOrderId: 'y', kind: 'cancel_not_applied' },
      { id: 'o3', externalOrderId: 'z', kind: 'cancel_not_applied' },
    ];
    const { manager, repo } = setup({ core: { a: 'confirmed', b: 'confirmed', x: 'confirmed', y: 'cancelled', z: 'confirmed' }, open });
    const report = await run(manager);
    expect(repo.markResolved).toHaveBeenCalledWith(['o1', 'o2'], NOW);
    expect(report.resolved).toBe(2);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.manager.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.manager.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import type { ChannelType } from '../../adapters/channel-adapter.factory';
import { SyncStatusService } from '../sync-status.service';
import type { ChannelOrderSource } from '../order-collection/channel-order-source.interface';
import { CoreSalesOrderLookupClient, CoreSalesOrderLookupItem } from '../clients/core-sales-order-lookup.client';
import { errorMessage } from '../order-collection/order-processing-stage.error';
import { POLL_LOOKBACK_MS, RECONCILE_RULES, classifyChannelOrder } from './channel-order-reconcile.classifier';
import { ChannelOrderRedeliveryManager } from './channel-order-redelivery.manager';
import { OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';
import { RECONCILE_ORDER_SOURCES } from './reconcile-order-sources';

export interface ReconcileCycleReport {
  channel: string;
  scanned: number;
  findings: number;
  redelivered: number;
  resolved: number;
  skipped?: 'no_source' | 'core_unavailable';
}

/** 채널 대사 한 주기 (#1016 45번 스펙 §5~§7). 크론과 처음 한 번 훑기가 같이 쓴다. */
@Injectable()
export class ChannelOrderReconcileManager {
  private readonly logger = new Logger(ChannelOrderReconcileManager.name);

  constructor(
    @Inject(RECONCILE_ORDER_SOURCES) private readonly sources: ChannelOrderSource[],
    private readonly findings: OrderReconcileFindingRepository,
    private readonly coreLookup: CoreSalesOrderLookupClient,
    private readonly redelivery: ChannelOrderRedeliveryManager,
    private readonly syncStatus: SyncStatusService,
  ) {}

  async runCycle(
    channel: SalesChannel,
    options: { updatedAfter: Date; now: Date; observeOnly: boolean },
  ): Promise<ReconcileCycleReport> {
    const report: ReconcileCycleReport = { channel, scanned: 0, findings: 0, redelivered: 0, resolved: 0 };
    const source = this.sources.find((candidate) => candidate.channel === channel);
    if (!source) return { ...report, skipped: 'no_source' };

    const snapshots = await source.fetchOrders(options.updatedAfter);
    report.scanned = snapshots.length;
    const ids = snapshots.map((snapshot) => snapshot.externalOrderId);
    const [mappings, quarantined, existing, sync] = await Promise.all([
      this.findings.mappingsByExternalOrderId(channel, ids),
      this.findings.openQuarantineExternalOrderIds(channel, ids),
      this.findings.findOpenByOrders(channel, ids),
      // 폴러의 sync_status 키는 ChannelType 이다(`order-poller.orchestrator.ts` 와 같은 변환)
      this.syncStatus.getSyncStatus(channel as ChannelType, 'orders'),
    ]);
    const outboxFailed = await this.findings.wmsOrderIdsWithFailedOutbox([...mappings.values()]);

    let core: Map<string, CoreSalesOrderLookupItem>;
    let openCore: Map<string, CoreSalesOrderLookupItem>;
    let open: OrderReconcileFinding[];
    try {
      core = await this.coreLookup.lookup(
        channel,
        ids.map((externalOrderId) => ({ externalOrderId, wmsOrderId: mappings.get(externalOrderId) })),
      );
      open = await this.findings.listOpen(channel);
      openCore = await this.coreLookup.lookup(
        channel,
        open.filter((row) => !core.has(row.externalOrderId)).map((row) => ({ externalOrderId: row.externalOrderId })),
      );
    } catch (error) {
      // «core 가 모른다»를 «SO 없음»으로 읽지 않는다 — 주기를 통째로 건너뛴다.
      this.logger.warn(`[${channel}] core 판매주문 조회 실패로 이번 대사를 건너뛴다: ${errorMessage(error)}`);
      return { ...report, skipped: 'core_unavailable' };
    }

    const watermark = sync?.lastSyncAt ?? null;
    const attempts = new Map(existing.map((row) => [`${row.externalOrderId}:${row.kind}`, row.attemptCount]));
    for (const snapshot of snapshots) {
      const wmsOrderId = mappings.get(snapshot.externalOrderId) ?? null;
      const coreItem = core.get(snapshot.externalOrderId);
      const verdict = classifyChannelOrder({
        snapshot,
        wmsOrderId,
        openQuarantine: quarantined.has(snapshot.externalOrderId),
        adapterOutboxFailed: wmsOrderId ? outboxFailed.has(wmsOrderId) : false,
        core: { salesOrderStatus: coreItem?.salesOrder?.status ?? null, openEventFailure: coreItem?.openEventFailure ?? false },
        attemptCountFor: (kind) => attempts.get(`${snapshot.externalOrderId}:${kind}`) ?? 0,
        pollWatermark: watermark,
        now: options.now,
      });
      if (!verdict) continue;

      const mode = options.observeOnly ? 'observe' : RECONCILE_RULES[verdict.kind].mode;
      const willAct = mode === 'act' && verdict.handling === 'auto';
      const finding = await this.findings.upsertOpen({
        channel,
        externalOrderId: snapshot.externalOrderId,
        displayOrderNo: snapshot.displayOrderNo ?? null,
        kind: verdict.kind,
        handling: verdict.handling,
        humanReason: verdict.humanReason,
        coreStatus: verdict.coreStatus,
        channelCreatedAt: new Date(snapshot.createdAt),
        mode,
        lastResult: verdict.handling === 'human' ? 'skipped' : willAct ? 'pending' : 'would_act',
        seenAt: options.now,
      });
      report.findings += 1;
      if (!willAct) continue;
      try {
        await this.redelivery.redeliver(finding);
        report.redelivered += 1;
      } catch (error) {
        // 적재는 롤백됐다 — 시도로 세어 상한이 무한 재시도를 끊게 한다.
        await this.findings.recordAttempt(finding.id, `error: ${errorMessage(error)}`);
      }
    }

    const allCore = new Map([...core, ...openCore]);
    const resolvedIds = open
      .filter((row) => {
        const status = allCore.get(row.externalOrderId)?.salesOrder?.status ?? null;
        return row.kind === 'missing_order' ? status !== null : status === 'cancelled';
      })
      .map((row) => row.id);
    report.resolved = await this.findings.markResolved(resolvedIds, options.now);

    this.logger.log(
      `[${channel}] 채널 대사(#45): 훑음 ${report.scanned} · 불일치 ${report.findings} · 다시 배달 ${report.redelivered} · 해소 ${report.resolved}`,
    );
    return report;
  }
}
```

> `channel as ChannelType` 은 `order-poller.orchestrator.ts` 의 `provider.channel as ChannelType` 과 같은 기존 변환이다. `SalesChannel` 과 `ChannelType` 의 겹침(`medusa`)이 명확하므로 근거 주석을 단다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.manager.spec.ts`
Expected: PASS (6)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/order-reconcile
git commit -m "feat(channel-adapter): 채널 대사 한 주기 — 기록·관찰/실행·해소 확인, core 조회 실패면 건너뛴다 (#1016 45번)"
```

---

### Task 7: 크론·서비스·컨트롤러·모듈 배선

**Files:**
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.service.ts`
- Test: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.service.spec.ts`
- Create: `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.job.ts`
- Create: `apps/channel-adapter/src/controllers/order-reconcile-findings.controller.ts`
- Create: `apps/channel-adapter/src/controllers/order-reconcile-sweep.controller.ts`
- Test: `apps/channel-adapter/src/controllers/order-reconcile-sweep.controller.spec.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts`

**Interfaces:**
- Consumes: Task 2·5·6 의 클래스, `SalesChannelClient.getActiveSites()`, `actorIdOf`·`User`(`@app/events`·`@app/authorization`), `isSyncableChannel`
- Produces (HTTP):
  - `GET adapter/order-reconcile-findings?status=open|resolved|closed&limit&offset` → `{ success: true, data: OrderReconcileFinding[] }`
  - `GET adapter/order-reconcile-findings/summary` → `{ success: true, data: { open, human, gaveUp, oldestFirstSeenAt } }`
  - `POST adapter/order-reconcile-findings/:id/redeliver` → `{ result: RedeliveryResult }` — 열린 행만, `event_failure_open` 이면 409
  - `POST adapter/order-reconcile-findings/:id/close` body `{ memo: string }`(1~500) → `{ data: OrderReconcileFinding }`
  - `POST adapter/order-reconcile/sweep` body `{ channel, updatedAfter }`, 내부 키 → 202 `{ accepted: true }` (백그라운드 실행, 결과는 로그)

- [ ] **Step 1: 실패하는 서비스 스펙을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.service.spec.ts
import { ConflictError, NotFoundError } from '@app/shared';
import { ChannelOrderReconcileService } from './channel-order-reconcile.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  channel: 'medusa',
  externalOrderId: 'order_1',
  kind: 'missing_order',
  status: 'open',
  humanReason: 'out_of_window',
  mode: 'observe',
  ...over,
});

function setup(found: unknown) {
  const repo = { findById: jest.fn(async () => found), close: jest.fn(async () => ({ ...row(), status: 'closed' })) };
  const redelivery = { redeliver: jest.fn(async () => 'enqueued') };
  const service = new ChannelOrderReconcileService(repo as never, redelivery as never, {} as never);
  return { service, repo, redelivery };
}

describe('ChannelOrderReconcileService', () => {
  it('수동 다시 배달은 관찰 모드·3일 밖이어도 실행한다', async () => {
    const { service, redelivery } = setup(row());
    await expect(service.redeliverFinding('f1')).resolves.toEqual({ result: 'enqueued' });
    expect(redelivery.redeliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('이벤트 실패가 열린 행은 409', async () => {
    const { service } = setup(row({ humanReason: 'event_failure_open' }));
    await expect(service.redeliverFinding('f1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('없거나 닫힌 행은 404', async () => {
    await expect(setup(null).service.redeliverFinding('f1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(setup(row({ status: 'closed' })).service.redeliverFinding('f1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('종결은 열린 행만, 아니면 404', async () => {
    const { service, repo } = setup(row());
    await expect(service.closeFinding('f1', 'admin-1', '셀메이트로 나감')).resolves.toMatchObject({ status: 'closed' });
    repo.close.mockResolvedValueOnce(null as never);
    await expect(service.closeFinding('f1', 'admin-1', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.service.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 서비스·잡을 쓴다**

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.service.ts
import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { ChannelOrderReconcileManager, ReconcileCycleReport } from './channel-order-reconcile.manager';
import { ChannelOrderRedeliveryManager, RedeliveryResult } from './channel-order-redelivery.manager';
import { OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';
import type { FindingStatus } from './order-reconcile.types';

@Injectable()
export class ChannelOrderReconcileService {
  constructor(
    private readonly findings: OrderReconcileFindingRepository,
    private readonly redelivery: ChannelOrderRedeliveryManager,
    private readonly manager: ChannelOrderReconcileManager,
  ) {}

  list(options: { status?: FindingStatus; limit: number; offset: number }): Promise<OrderReconcileFinding[]> {
    return this.findings.list(options);
  }

  summary() {
    return this.findings.summary();
  }

  /** 사람의 [다시 배달] — 창(D5)·규칙 모드와 무관하게 한 번 실행한다(스펙 §8.2). */
  async redeliverFinding(id: string): Promise<{ result: RedeliveryResult }> {
    const finding = await this.findings.findById(id);
    if (!finding || finding.status !== 'open') throw new NotFoundError(`Open reconcile finding not found: ${id}`);
    if (finding.humanReason === 'event_failure_open') {
      throw new ConflictError('이 주문의 이벤트 실패가 열려 있다 — «이벤트 실패» 화면에서 먼저 처리한다');
    }
    return { result: await this.redelivery.redeliver(finding) };
  }

  async closeFinding(id: string, actor: string | null, memo: string): Promise<OrderReconcileFinding> {
    const closed = await this.findings.close(id, actor, memo);
    if (!closed) throw new NotFoundError(`Open reconcile finding not found: ${id}`);
    return closed;
  }

  runCycle(channel: SalesChannel, options: { updatedAfter: Date; now: Date; observeOnly: boolean }): Promise<ReconcileCycleReport> {
    return this.manager.runCycle(channel, options);
  }
}
```

```ts
// apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.job.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { SalesChannelClient } from '../clients/sales-channel.client';
import type { ChannelOrderSource } from '../order-collection/channel-order-source.interface';
import { errorMessage } from '../order-collection/order-processing-stage.error';
import { RECONCILE_WINDOW_MS } from './channel-order-reconcile.classifier';
import { ChannelOrderReconcileService } from './channel-order-reconcile.service';
import { RECONCILE_ORDER_SOURCES } from './reconcile-order-sources';

/** 채널 대사 크론 (#1016 45번). 폴링(5분)과 따로 돈다 — 대사가 실패해도 수집은 영향받지 않는다. */
@Injectable()
export class ChannelOrderReconcileJob {
  private readonly logger = new Logger(ChannelOrderReconcileJob.name);

  constructor(
    @Inject(RECONCILE_ORDER_SOURCES) private readonly sources: ChannelOrderSource[],
    private readonly salesChannelClient: SalesChannelClient,
    private readonly service: ChannelOrderReconcileService,
  ) {}

  @CronOnce('*/30 * * * *', { name: 'channel-order-reconcile' })
  async run(): Promise<void> {
    if (this.sources.length === 0) return;
    let active: Set<string>;
    try {
      active = new Set(await this.salesChannelClient.getActiveSites());
    } catch (error) {
      this.logger.error(`활성 판매채널 조회 실패로 이번 대사를 건너뛴다: ${errorMessage(error)}`);
      return;
    }
    const now = new Date();
    for (const source of this.sources) {
      if (!active.has(source.channel)) continue;
      try {
        await this.service.runCycle(source.channel, {
          updatedAfter: new Date(now.getTime() - RECONCILE_WINDOW_MS),
          now,
          observeOnly: false,
        });
      } catch (error) {
        this.logger.error(`[${source.channel}] 채널 대사 실패: ${errorMessage(error)}`);
      }
    }
  }
}
```

- [ ] **Step 4: 서비스 스펙 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.service.spec.ts`
Expected: PASS (4)

- [ ] **Step 5: 컨트롤러 둘과 sweep 스펙을 쓴다**

```ts
// apps/channel-adapter/src/controllers/order-reconcile-findings.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { User } from '@app/authorization';
import { actorIdOf } from '@app/events';
import { GlobalExceptionFilter } from '@app/shared';
import { ChannelOrderReconcileService } from '../services/order-reconcile/channel-order-reconcile.service';
import type { FindingStatus } from '../services/order-reconcile/order-reconcile.types';

export class CloseFindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  memo!: string;
}

const STATUSES: readonly FindingStatus[] = ['open', 'resolved', 'closed'];
/** 없으면 open, `all` 이면 전부(undefined), 모르는 값은 400 — 조용히 «전부»로 읽지 않는다. */
const parseStatus = (value?: string): FindingStatus | undefined => {
  if (value === undefined || value === '') return 'open';
  if (value === 'all') return undefined;
  const status = STATUSES.find((candidate) => candidate === value);
  if (!status) throw new BadRequestException(`Unknown status: ${value}`);
  return status;
};
const clampInt = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
};

/** «채널과 어긋남» (#1016 45번 스펙 §8). 인가는 전역 `JwtAuthGuard`·`AdminRealmGuard` — 격리 컨트롤러와 같다. */
@ApiTags('adapter-order-reconcile-findings')
@UseFilters(GlobalExceptionFilter)
@Controller('adapter/order-reconcile-findings')
export class OrderReconcileFindingsController {
  constructor(private readonly service: ChannelOrderReconcileService) {}

  @Get()
  @ApiOperation({ summary: '채널과 어긋난 주문 목록 (기본 open)' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'resolved', 'closed', 'all'] })
  async list(@Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const data = await this.service.list({
      status: parseStatus(status),
      limit: clampInt(limit, 50, 200),
      offset: clampInt(offset, 0, Number.MAX_SAFE_INTEGER),
    });
    return { success: true, data };
  }

  // `:id` 보다 먼저 선언해야 한다 — 뒤에 두면 'summary' 가 id 로 잡힌다.
  @Get('summary')
  @ApiOperation({ summary: '채널과 어긋남 요약 (정체 보드 0단계)' })
  async summary() {
    return { success: true, data: await this.service.summary(), timestamp: new Date().toISOString() };
  }

  @Post(':id/redeliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '사람의 [다시 배달] — 창·모드와 무관하게 한 번' })
  redeliver(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.redeliverFinding(id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '메모를 남기고 종결' })
  async close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseFindingDto, @User() user: unknown) {
    return { data: await this.service.closeFinding(id, actorIdOf(user), dto.memo) };
  }
}
```

```ts
// apps/channel-adapter/src/controllers/order-reconcile-sweep.controller.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { OrderReconcileSweepController } from './order-reconcile-sweep.controller';

const config = { get: (key: string) => (key === 'CHANNEL_ADAPTER_INTERNAL_KEY' ? 'secret' : undefined) } as unknown as ConfigService;

describe('OrderReconcileSweepController', () => {
  it('내부 키가 틀리면 401', async () => {
    const service = { runCycle: jest.fn() };
    const controller = new OrderReconcileSweepController(service as never, config);
    await expect(
      controller.sweep('Bearer nope', { channel: 'medusa', updatedAfter: '2026-01-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.runCycle).not.toHaveBeenCalled();
  });

  it('관찰 전용으로 백그라운드 실행하고 바로 202 몸체를 돌려준다', async () => {
    const service = { runCycle: jest.fn(async () => ({ scanned: 0 })) };
    const controller = new OrderReconcileSweepController(service as never, config);
    await expect(
      controller.sweep('Bearer secret', { channel: 'medusa', updatedAfter: '2026-01-01T00:00:00Z' }),
    ).resolves.toEqual({ accepted: true });
    expect(service.runCycle).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({ updatedAfter: new Date('2026-01-01T00:00:00Z'), observeOnly: true }),
    );
  });
});
```

```ts
// apps/channel-adapter/src/controllers/order-reconcile-sweep.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsString } from 'class-validator';
import { Public } from '@app/authorization';
import { ChannelOrderReconcileService } from '../services/order-reconcile/channel-order-reconcile.service';
import { isSyncableChannel } from '../services/order-collection/syncable-channels';
import { errorMessage } from '../services/order-collection/order-processing-stage.error';

export class SweepBodyDto {
  @IsString()
  channel!: string;

  @IsISO8601()
  updatedAfter!: string;
}

@ApiTags('adapter-order-reconcile')
@ApiBearerAuth()
// 배포 직후 한 번 운영자가 부른다(스펙 §9). 사용자 JWT 가 없어 `ChannelOrderSyncController` 처럼 전역 가드를 면제하고
// **모든 핸들러가** verifyInternalKey 로 CHANNEL_ADAPTER_INTERNAL_KEY 를 검증한다.
@Public()
@Controller('adapter/order-reconcile')
export class OrderReconcileSweepController {
  private readonly logger = new Logger(OrderReconcileSweepController.name);

  constructor(
    private readonly service: ChannelOrderReconcileService,
    private readonly configService: ConfigService,
  ) {}

  @Post('sweep')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '전체 기간 훑기 — 항상 관찰 모드, 다시 배달하지 않는다. 결과는 로그' })
  async sweep(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: SweepBodyDto,
  ): Promise<{ accepted: true }> {
    this.verifyInternalKey(authorization);
    if (!isSyncableChannel(body.channel)) throw new BadRequestException(`Unsupported channel: ${body.channel}`);
    const channel = body.channel;
    // ALB 유휴 제한(60초) 안에 끝나지 않을 수 있어 기다리지 않는다.
    void this.service
      .runCycle(channel, { updatedAfter: new Date(body.updatedAfter), now: new Date(), observeOnly: true })
      .then((report) => this.logger.log(`[${channel}] 처음 한 번 훑기 완료: ${JSON.stringify(report)}`))
      .catch((error: unknown) => this.logger.error(`[${channel}] 처음 한 번 훑기 실패: ${errorMessage(error)}`));
    return { accepted: true };
  }

  private verifyInternalKey(authorization: string | undefined): void {
    const internalKey = this.configService.get<string>('CHANNEL_ADAPTER_INTERNAL_KEY');
    if (!internalKey) throw new UnauthorizedException('Internal key not configured');
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (token !== internalKey) throw new UnauthorizedException('Invalid internal key');
  }
}
```

- [ ] **Step 6: 모듈에 배선한다**

`adapter.module.ts`:
- `controllers` 의 `IS_SAFE_DEMO_MODE` 가 아닌 갈래(`OrderCollectionFailuresController` 옆)에 `OrderReconcileFindingsController`, `OrderReconcileSweepController`.
- `providers` 의 «주문 수집» 블록 아래, 같은 `!IS_SAFE_DEMO_MODE` 조건으로:

```ts
    // 채널 주문 대사 (#1016 45번). source 는 «since 이후 갱신 전부»를 주는 열린 질의만 — 지금은 Medusa.
    ...(!IS_SAFE_DEMO_MODE
      ? [
          { provide: RECONCILE_ORDER_SOURCES, useFactory: (medusa: MedusaOrderSource) => [medusa], inject: [MedusaOrderSource] },
          CoreSalesOrderLookupClient,
          OrderReconcileFindingRepository,
          ChannelOrderRedeliveryManager,
          ChannelOrderReconcileManager,
          ChannelOrderReconcileService,
          ChannelOrderReconcileJob,
        ]
      : []),
```

`DbService<typeof channelAdapterSchema>` 는 데코레이터 없이 생성자 타입으로 주입한다 — 기존 `OrderCollectionFailureService` 와 같다.

- [ ] **Step 7: 스펙·크론 가드·보안 가드를 돌린다**

Run: `npx jest apps/channel-adapter/src/controllers/order-reconcile-sweep.controller.spec.ts apps/channel-adapter/src/services/order-reconcile libs/cron-once scripts/security`
Expected: PASS. `libs/cron-once/src/guards/cron-once-guard.spec.ts` 가 새 크론 이름 `channel-order-reconcile` 의 유일성을, `scripts/security` 가 새 라우트의 인가를 본다. 보안 스펙이 `POST /adapter/order-reconcile/sweep` 를 무인증 쓰기로 잡으면, 같은 패턴인 `POST /adapter/orders/:channel/:externalOrderId/sync` 가 어떻게 통과하는지 `scripts/security/route-authz-audit.js` 에서 확인하고 같은 조건을 맞춘다 — `ALLOWED` 에 넣지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add apps/channel-adapter/src
git commit -m "feat(channel-adapter): 채널 대사 크론·«채널과 어긋남» API·처음 한 번 훑기 (#1016 45번)"
```

---

### Task 8: 검증 게이트·로컬 E2E·PR·이슈 본문

**Files:**
- Modify: (없음 — 검증과 문서)

- [ ] **Step 1: 게이트**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest --maxWorkers=2`
Expected: 실패 0 (`--maxWorkers=2` 는 이 저장소의 jest OOM 회피 관례)

- [ ] **Step 2: 로컬 E2E (관찰 모드)**

1. `npm run bootstrap:e2e:local` → `npm run start:all:local` → `npm run preflight:e2e:local`
2. 로컬 스토어프론트에서 주문 하나를 결제하고 폴러가 수집할 때까지(5분) 기다린다. core `sales_orders` 에 그 주문이 생겼는지 본다.
3. 그 SO 행을 로컬 core DB 에서 지운다(로컬 전용): `delete from sales_orders where channel_order_id = '<order_id>';` (FK 로 막히면 자식 행부터).
4. 대사를 즉시 부른다: `curl -X POST localhost:<adapter port>/adapter/order-reconcile/sweep -H "Authorization: Bearer $CHANNEL_ADAPTER_INTERNAL_KEY" -H 'content-type: application/json' -d '{"channel":"medusa","updatedAfter":"<1시간 전 ISO>"}'` — 주문 갱신이 30분 안이면 유예로 건너뛰므로 3번 뒤 30분을 기다리거나 SO 를 지운 주문 대신 1시간 이상 된 주문으로 한다.
5. 어댑터 DB: `select kind, handling, human_reason, mode, last_result from order_reconcile_findings;` → `missing_order · auto · observe · would_act` 1행.
6. 확인 뒤 `RECONCILE_RULES` 를 로컬에서만 `act` 로 바꿔 크론 한 주기를 기다리거나 `POST adapter/order-reconcile-findings/:id/redeliver` 를 admin 토큰으로 불러 SO 가 다시 생기고 다음 주기에 `resolved` 되는지 본다. 바꾼 모드는 되돌린다.

결과(성공/실패, 본 행)를 PR 본문에 적는다.

- [ ] **Step 3: PR**

브랜치 `feat/1016-45-channel-order-reconcile` 에서 PR 을 연다. 본문에:
- 스펙·계획 경로, 계획 단계 정정 4건
- 배포 순서: channel-adapter `db:migrate`(`add-order-reconcile-findings`) → `sst deploy`. core 조회 API 는 순서 무관
- 배포 뒤: `POST /adapter/order-reconcile/sweep` 를 `updatedAfter` = Medusa 첫 주문 이전으로 한 번 → 결과 로그의 건수를 #1016 에 적는다
- 로컬 E2E 결과
- 끝줄 `https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`

- [ ] **Step 4: #1016 본문 (머지 뒤)**

코멘트가 아니라 본문을 고친다:
- 45번 «해결» 칸: PR 2(화면)까지 머지된 뒤 두 머지 커밋. 이 PR 만 머지된 시점엔 비워 두고 «문서» 칸에 이 계획 경로를 더한다
- «남은 운영 작업»에 체크박스 넷: «45번 배포(`migrate → deploy`)», «45번 처음 한 번 훑기 + 건수 기록», «45번 `missing_order` 실행 모드 전환», «45번 `cancel_not_applied` 실행 모드 전환»
- «관찰 모드 규칙» 절의 grep 을 두 경로로:
  ```bash
  grep -rln --include='*.rule.ts' "mode: ReconcileMode = 'observe'" apps/core/src/modules/fulfillment/order-reconcile/rules apps/channel-adapter/src/services/order-reconcile/rules
  ```
  라이브 SQL 블록 아래에 어댑터 DB 용 한 줄: `-- channel_adapter` / `select kind, mode, last_result, count(*) from order_reconcile_findings where status = 'open' group by 1,2,3;`
- 그 뒤 «주문의 일생» 아티팩트 동기화(메모리 `order-lifecycle-audit-2026-10-05` 의 절차)
