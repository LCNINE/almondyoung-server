/**
 * analytics 백필 — 원본 DB(core·membership)를 읽어 합성 이벤트를 만들고,
 * 실시간 컨슈머가 부르는 **같은 서비스 메서드**에 먹인다. 집계 로직이 한 벌만 존재하므로
 * 백필 결과와 실시간 결과가 어긋날 수 없다 (설계: docs/superpowers/specs/2026-07-31-admin-statistics-design.md).
 *
 * 실행 (dry-run 이 기본 — `--apply` 없이는 아무것도 쓰지 않는다):
 *
 *   npx tsx scripts/analytics-backfill/index.ts --stage dev --deployment lcnine-services \
 *     [--orders] [--memberships] [--from YYYY-MM-DD] [--apply] [--allow-live]
 *
 * 로컬(도커) DB 로 시험하려면 sst shell 없이 env 로 연결을 준다:
 *
 *   ANALYTICS_DATABASE_URL=... CORE_DATABASE_URL=... MEMBERSHIP_DATABASE_URL=... \
 *     npx tsx scripts/analytics-backfill/index.ts --orders --memberships [--apply]
 *
 * 멱등성:
 *  - 합성 messageId 는 원본 키에서 결정론적으로 생성된다 → 백필 재실행은 claimed 게이트에 걸린다.
 *  - OrderCreated 는 fact_order_items 의 (orderKey, salesChannel, orderItemId) 유니크가
 *    실시간 이벤트와의 겹침도 막는다 (두 번째 게이트).
 *  - OrderCancelled 는 두 번째 게이트가 없다 — 먹이기 전에 그 주문의 취소 봉투가
 *    fact_order_events 에 이미 있는지 확인하고, 있으면 건너뛴다 (설계 문서 요건 1).
 *
 * 알려진 근사치 (dry-run 로그에도 남긴다):
 *  - 원본 line 에 skuId 가 없어 variantId 를 skuId 로 쓴다 (analytics 는 skuId 를 집계에 안 쓴다).
 *  - 멤버십은 subscription_entitlement 구간에서 ACTIVE/EXPIRED 만 복원한다 — 일시정지 이력은
 *    복원하지 않는다 (pause_events 재생은 범위 밖).
 *  - 취소 사유 원본이 없어 reason=ADMIN_CANCEL + reasonDetail 로 표시한다.
 */
import { createHash } from 'crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { Sql } from 'postgres';
import { DbModule, DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { DomainEvent } from '@packages/event-contracts/types';
import {
  ORDER_STREAM,
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderItem,
  SALES_CHANNELS,
  SalesChannel,
} from '@packages/event-contracts/streams/orders.stream';
import {
  MEMBERSHIP_STREAM,
  MembershipStatusChangedPayload,
} from '@packages/event-contracts/streams/membership.stream';
import { analyticsSchema, factOrderEvents } from '../../apps/analytics/src/schema';
import { OrderFactsService } from '../../apps/analytics/src/datasets/orders/facts/order-facts.service';
import { OrderAggregatesService } from '../../apps/analytics/src/datasets/orders/aggregates/order-aggregates.service';
import { UserPurchaseAggregatesService } from '../../apps/analytics/src/datasets/orders/aggregates/user-purchase-aggregates.service';
import { ChannelAggregatesService } from '../../apps/analytics/src/datasets/orders/aggregates/channel-aggregates.service';
import { VariantAggregatesService } from '../../apps/analytics/src/datasets/orders/aggregates/variant-aggregates.service';
import { CustomerLifetimeService } from '../../apps/analytics/src/datasets/orders/aggregates/customer-lifetime.service';
import { MembershipFactsService } from '../../apps/analytics/src/datasets/memberships/facts/membership-facts.service';
import { MembershipDimensionsService } from '../../apps/analytics/src/datasets/memberships/dimensions/membership-dimensions.service';
import { MembershipDailySnapshotService } from '../../apps/analytics/src/datasets/memberships/aggregates/membership-daily-snapshot.service';
import { toSeoulDateOnly } from '../../apps/analytics/src/shared/date.util';
import {
  ensureInsideSstShell,
  parseCommonArgs,
} from '../seeding/lib/sst-shell-relaunch';

const BATCH_SIZE = 200;

// ───────────────────────── CLI ─────────────────────────

const argvFlags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const args = parseCommonArgs(process.argv);
const APPLY = argvFlags.has('--apply');
const DO_ORDERS = argvFlags.has('--orders');
const DO_MEMBERSHIPS = argvFlags.has('--memberships');
const FROM = (() => {
  const idx = process.argv.indexOf('--from');
  return idx >= 0 ? process.argv[idx + 1] : undefined;
})();

const HAS_ENV_URLS = !!process.env.ANALYTICS_DATABASE_URL;

if ((args.stage === 'live' || process.env.SST_STAGE === 'live') && !argvFlags.has('--allow-live')) {
  console.error('live stage 는 --allow-live 없이 거부합니다. 실행은 운영자가 결정합니다.');
  process.exit(1);
}

if (!DO_ORDERS && !DO_MEMBERSHIPS) {
  console.error('대상을 지정하세요: --orders 그리고/또는 --memberships');
  process.exit(1);
}

// ───────────────────────── 연결 ─────────────────────────

function sstCredentials() {
  // scripts/seeding/lib/db-connection.ts 와 같은 방식 — sst shell 이 주입한 Resource 사용.
  // 이 파일에서 직접 읽는 이유: 그 모듈은 import 시점에 'sst' 를 로드해 env-URL 모드에서도
  // sst 밖 실행이 막힌다.
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- sst shell 안에서만 로드
  const { Resource } = require('sst') as { Resource: Record<string, any> };
  const name = ['Db', 'IdpDb'].find((n) => process.env[`SST_RESOURCE_${n}`]);
  if (!name) throw new Error('sst shell 밖입니다 — SST_RESOURCE_* 가 없습니다.');
  const db = Resource[name];
  return { host: db.host as string, port: db.port as number, user: db.username as string, password: db.password as string };
}

function sourceConnection(dbName: string, envUrl?: string): Sql {
  if (envUrl) return postgres(envUrl, { max: 4 });
  const creds = sstCredentials();
  return postgres({ ...creds, database: dbName, ssl: 'require', max: 4 });
}

function analyticsConnectionString(): string {
  if (process.env.ANALYTICS_DATABASE_URL) return process.env.ANALYTICS_DATABASE_URL;
  const { user, password, host, port } = sstCredentials();
  return `postgresql://${user}:${password}@${host}:${port}/analytics?sslmode=require`;
}

// ───────────────────────── 합성 봉투 ─────────────────────────

/** 원본 키에서 결정론적 26자 messageId. 'BF' 접두로 합성분을 육안 식별할 수 있다. */
function syntheticMessageId(kind: string, key: string): string {
  return `BF${createHash('sha256').update(`${kind}|${key}`).digest('hex').slice(0, 24).toUpperCase()}`;
}

function envelope<T>(
  messageType: string,
  aggregateType: string,
  aggregateId: string,
  messageId: string,
  occurredAtIso: string,
  payload: T,
): DomainEvent<T> {
  return {
    messageId,
    messageType,
    messageVersion: 1,
    messageKind: 'event',
    correlationId: messageId,
    timestamp: occurredAtIso,
    source: { service: 'analytics-backfill', aggregateType, aggregateId },
    payload,
  } as DomainEvent<T>;
}

// ───────────────────────── Nest 컨텍스트 (Kafka 없음) ─────────────────────────

function buildBackfillModule(connectionString: string) {
  // AnalyticsModule 을 그대로 부팅하면 EventsModule/Logger/Schedule 이 딸려온다.
  // 필요한 것은 DbService 와 집계 서비스뿐이다 — 컨슈머는 등록하지 않는다.
  @Module({
    imports: [
      DbModule.forRoot({
        config: { connectionString },
        schema: analyticsSchema,
      }),
    ],
    providers: [
      OrderFactsService,
      OrderAggregatesService,
      UserPurchaseAggregatesService,
      ChannelAggregatesService,
      VariantAggregatesService,
      CustomerLifetimeService,
      MembershipFactsService,
      MembershipDimensionsService,
      MembershipDailySnapshotService,
    ],
  })
  class BackfillModule {}
  return BackfillModule;
}

// ───────────────────────── 주문 백필 ─────────────────────────

interface CoreOrderRow {
  id: string;
  channel_order_id: string;
  sales_channel: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  shipping_address: Record<string, unknown> | null;
  total_amount: number | null;
  shipping_fee: number;
  order_date: Date;
  updated_at: Date;
  cancelled_at: Date | null;
}

interface CoreLineRow {
  id: string;
  sales_order_id: string;
  variant_id: string;
  product_name: string;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  master_id: string | null;
  version_id: string | null;
}

function toOrderItem(line: CoreLineRow): OrderItem | null {
  if (!line.master_id || !line.version_id) return null; // 매핑 없는 라인은 상품 귀속 불가 — 건너뛴다
  return {
    orderItemId: line.id,
    skuId: line.variant_id, // 원본 line 에 skuId 없음 — variantId 로 대체 (집계 미사용 필드)
    masterId: line.master_id,
    versionId: line.version_id,
    variantId: line.variant_id,
    productName: line.product_name || '-',
    quantity: line.quantity,
    unitPrice: line.unit_price ?? 0,
    totalPrice: line.total_price ?? 0,
  };
}

function toShippingAddress(raw: Record<string, unknown> | null, fallbackName: string | null) {
  const value = (key: string) => {
    const v = raw?.[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  return {
    recipientName: value('recipientName') ?? value('recipient_name') ?? fallbackName ?? '-',
    phone: value('phone') ?? '-',
    postalCode: value('postalCode') ?? value('postal_code') ?? '-',
    roadAddress: value('roadAddress') ?? value('road_address') ?? value('address1') ?? '-',
    detailAddress: value('detailAddress') ?? value('detail_address') ?? value('address2') ?? '-',
  };
}

async function backfillOrders(core: Sql, dbService: DbService<typeof analyticsSchema>, services: {
  facts: OrderFactsService;
  orderAgg: OrderAggregatesService;
  userPurchase: UserPurchaseAggregatesService;
  channelAgg: ChannelAggregatesService;
  variantAgg: VariantAggregatesService;
  lifetime: CustomerLifetimeService;
}) {
  const orderCreatedSchema = ORDER_STREAM.events.OrderCreated.schema;
  const orderCancelledSchema = ORDER_STREAM.events.OrderCancelled.schema;

  const counters = {
    read: 0,
    createdApplied: 0,
    createdDuplicate: 0,
    cancelApplied: 0,
    cancelSkippedExisting: 0,
    cancelOrphan: 0,
    linesDroppedNoMapping: 0,
    invalidPayload: 0,
    unknownChannel: 0,
  };

  let offset = 0;
  for (;;) {
    const orders = await core<CoreOrderRow[]>`
      SELECT o.id, o.channel_order_id, o.sales_channel::text AS sales_channel, o.status::text AS status,
             o.customer_id, o.customer_name, o.shipping_address, o.total_amount, o.shipping_fee,
             o.order_date, o.updated_at,
             (SELECT MIN(e.created_at) FROM order_events e
               WHERE e.order_id = o.id AND e.event_type = 'ORDER_CANCELLED') AS cancelled_at
      FROM sales_orders o
      ${FROM ? core`WHERE o.order_date >= ${FROM}::date` : core``}
      ORDER BY o.order_date ASC, o.id ASC
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `;
    if (orders.length === 0) break;
    offset += orders.length;
    counters.read += orders.length;

    const orderIds = orders.map((o) => o.id);
    const lines = await core<CoreLineRow[]>`
      SELECT l.id, l.sales_order_id, l.variant_id, l.product_name, l.quantity, l.unit_price, l.total_price,
             pmv.master_id, pmv.version_id
      FROM sales_order_lines l
      LEFT JOIN LATERAL (
        SELECT master_id, version_id FROM product_master_variants
        WHERE variant_id = l.variant_id
        ORDER BY created_at DESC LIMIT 1
      ) pmv ON true
      WHERE l.sales_order_id IN ${core(orderIds)}
    `;
    const linesByOrder = new Map<string, CoreLineRow[]>();
    for (const line of lines) {
      const list = linesByOrder.get(line.sales_order_id) ?? [];
      list.push(line);
      linesByOrder.set(line.sales_order_id, list);
    }

    // 취소 겹침 방지: 이 배치의 주문에 대한 취소 봉투가 이미 있는지 한 번에 조회.
    const cancelKeys = orders
      .filter((o) => o.status === 'cancelled')
      .flatMap((o) => [o.id, o.channel_order_id]);
    const existingCancelOrderIds = new Set<string>();
    if (cancelKeys.length > 0) {
      const rows = await dbService.db
        .select({ orderId: factOrderEvents.orderId })
        .from(factOrderEvents)
        .where(and(eq(factOrderEvents.messageType, 'OrderCancelled'), inArray(factOrderEvents.orderId, cancelKeys)));
      for (const row of rows) {
        if (row.orderId) existingCancelOrderIds.add(row.orderId);
      }
    }

    for (const order of orders) {
      if (!(SALES_CHANNELS as readonly string[]).includes(order.sales_channel)) {
        counters.unknownChannel += 1;
        continue;
      }
      const rawLines = linesByOrder.get(order.id) ?? [];
      const items = rawLines.map(toOrderItem).filter((item): item is OrderItem => item !== null);
      counters.linesDroppedNoMapping += rawLines.length - items.length;
      if (items.length === 0) continue;

      const createdAtIso = order.order_date.toISOString();
      const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
      const payload: OrderCreatedPayload = {
        orderId: order.id,
        externalOrderId: order.channel_order_id,
        salesChannel: order.sales_channel as SalesChannel,
        customerId: order.customer_id,
        items,
        totalAmount: order.total_amount ?? subtotal + order.shipping_fee,
        subtotalAmount: subtotal,
        shippingAmount: order.shipping_fee,
        discountAmount: 0,
        currency: 'KRW',
        shippingAddress: toShippingAddress(order.shipping_address, order.customer_name),
        status: order.status as OrderCreatedPayload['status'],
        createdAt: createdAtIso,
      };

      const parsed = orderCreatedSchema?.safeParse(payload);
      if (parsed && !parsed.success) {
        counters.invalidPayload += 1;
        console.warn(`  잘못된 합성 OrderCreated — 건너뜀: ${order.channel_order_id} (${parsed.error.issues[0]?.message})`);
        continue;
      }

      const orderKey = payload.externalOrderId ?? payload.orderId;
      const messageId = syntheticMessageId('OrderCreated', `${orderKey}|${payload.salesChannel}`);

      if (APPLY) {
        await dbService.run(async (tx) => {
          const result = await services.facts.recordOrderCreated(
            envelope('OrderCreated', 'Order', payload.orderId, messageId, createdAtIso, payload),
            payload,
            tx,
          );
          if (!result.claimed) {
            counters.createdDuplicate += 1;
            return;
          }
          counters.createdApplied += 1;
          await services.orderAgg.applyOrderCreated(result.seeds, tx);
          await services.userPurchase.applyOrderCreated(payload.customerId, payload.items, new Date(payload.createdAt), tx);
          await services.variantAgg.applyOrderCreated(result.variantSeeds, tx);
          if (result.channelSeed) await services.channelAgg.applyOrderCreated(result.channelSeed, tx);
          if (result.customerSeed) await services.lifetime.applyOrderCreated(result.customerSeed, tx);
        });
      } else {
        counters.createdApplied += 1; // dry-run: 적용 예정 건수
      }

      if (order.status === 'cancelled') {
        if (existingCancelOrderIds.has(order.id) || existingCancelOrderIds.has(order.channel_order_id)) {
          counters.cancelSkippedExisting += 1;
          continue;
        }
        const cancelledAtIso = (order.cancelled_at ?? order.updated_at).toISOString();
        const cancelPayload: OrderCancelledPayload = {
          // recordOrderCancelled 는 orderKey/orderId 양쪽으로 원본을 찾는다 — 합성 생성분의
          // orderKey(=channelOrderId)와 맞추기 위해 channelOrderId 를 쓴다.
          orderId: order.channel_order_id,
          salesChannel: order.sales_channel as SalesChannel,
          externalOrderId: order.channel_order_id,
          reason: 'ADMIN_CANCEL',
          reasonDetail: 'backfill: 원본 취소 사유 미보존',
          cancelledBy: 'analytics-backfill',
          cancelledAt: cancelledAtIso,
          refundRequired: false,
        };
        const cancelParsed = orderCancelledSchema?.safeParse(cancelPayload);
        if (cancelParsed && !cancelParsed.success) {
          counters.invalidPayload += 1;
          continue;
        }
        const cancelMessageId = syntheticMessageId('OrderCancelled', `${orderKey}|${payload.salesChannel}`);

        if (APPLY) {
          await dbService.run(async (tx) => {
            const result = await services.facts.recordOrderCancelled(
              envelope('OrderCancelled', 'Order', cancelPayload.orderId, cancelMessageId, cancelledAtIso, cancelPayload),
              cancelPayload,
              tx,
            );
            if (!result.claimed) return;
            if (result.orphan || !result.salesChannel) {
              counters.cancelOrphan += 1;
              return;
            }
            counters.cancelApplied += 1;
            await services.orderAgg.applyCancellation(result.occurredDate, result.salesChannel, result.masterAmounts, tx);
            await services.channelAgg.applyCancellation(result.occurredDate, result.salesChannel, result.totalAmount, tx);
          });
        } else {
          counters.cancelApplied += 1;
        }
      }
    }
    console.log(`  주문 진행: ${counters.read}건 읽음`);
  }

  return counters;
}

// ───────────────────────── 멤버십 백필 ─────────────────────────

interface EntitlementRow {
  user_id: string;
  tier_id: string;
  starts_at: string; // date
  ends_at: string; // date
  closed_at: Date | null;
}

async function backfillMemberships(
  membership: Sql,
  dbService: DbService<typeof analyticsSchema>,
  services: { facts: MembershipFactsService; dims: MembershipDimensionsService },
) {
  const schema = MEMBERSHIP_STREAM.events.MembershipStatusChanged.schema;
  const counters = { entitlements: 0, opened: 0, closed: 0, duplicate: 0, invalidPayload: 0 };
  const now = new Date();

  const rows = await membership<EntitlementRow[]>`
    SELECT e.user_id, e.tier_id, e.starts_at::text AS starts_at, e.ends_at::text AS ends_at, e.closed_at
    FROM subscription_entitlement e
    ${FROM ? membership`WHERE e.starts_at >= ${FROM}::date` : membership``}
    ORDER BY e.user_id ASC, e.starts_at ASC
  `;
  counters.entitlements = rows.length;

  const feed = async (payload: MembershipStatusChangedPayload, key: string) => {
    const parsed = schema?.safeParse(payload);
    if (parsed && !parsed.success) {
      counters.invalidPayload += 1;
      return;
    }
    if (!APPLY) return;
    const messageId = syntheticMessageId('MembershipStatusChanged', key);
    await dbService.run(async (tx) => {
      const result = await services.facts.recordStatusChanged(
        envelope('MembershipStatusChanged', 'Membership', payload.userId, messageId, payload.occurredAt, payload),
        payload,
        tx,
      );
      if (!result.claimed) {
        counters.duplicate += 1;
        return;
      }
      await services.dims.applyStatusChanged(result, tx);
    });
  };

  for (const row of rows) {
    // 자격 시작 = KST 그 날짜 00:00. dim 구간과 스냅샷 정의가 모두 KST 자정 기준이다.
    const startInstant = new Date(`${row.starts_at}T00:00:00+09:00`);
    await feed(
      {
        userId: row.user_id,
        status: 'ACTIVE',
        occurredAt: startInstant.toISOString(),
        tierId: row.tier_id,
      },
      `${row.user_id}|${row.starts_at}|open`,
    );
    counters.opened += 1;

    // 종료 시점: 조기 종료(closed_at)가 있으면 그 시각, 아니면 ends_at 다음날 KST 자정.
    const endInstant = row.closed_at ?? new Date(`${row.ends_at}T00:00:00+09:00`);
    if (!row.closed_at) endInstant.setUTCDate(endInstant.getUTCDate() + 1);
    if (endInstant <= now) {
      await feed(
        {
          userId: row.user_id,
          status: 'EXPIRED',
          occurredAt: endInstant.toISOString(),
          tierId: row.tier_id,
        },
        `${row.user_id}|${row.starts_at}|close`,
      );
      counters.closed += 1;
    }
  }

  return counters;
}

// ───────────────────────── main ─────────────────────────

async function main() {
  if (!HAS_ENV_URLS) {
    await ensureInsideSstShell({ stage: args.stage, deployment: args.deployment });
  }

  console.log(`analytics 백필 — ${APPLY ? 'APPLY' : 'DRY-RUN (쓰지 않음)'}${FROM ? `, from=${FROM}` : ''}`);

  const app = await NestFactory.createApplicationContext(buildBackfillModule(analyticsConnectionString()), {
    logger: ['warn', 'error'],
  });

  try {
    const dbService = app.get(DbService) as DbService<typeof analyticsSchema>;

    if (DO_ORDERS) {
      const core = sourceConnection('core', process.env.CORE_DATABASE_URL);
      try {
        const counters = await backfillOrders(core, dbService, {
          facts: app.get(OrderFactsService),
          orderAgg: app.get(OrderAggregatesService),
          userPurchase: app.get(UserPurchaseAggregatesService),
          channelAgg: app.get(ChannelAggregatesService),
          variantAgg: app.get(VariantAggregatesService),
          lifetime: app.get(CustomerLifetimeService),
        });
        console.log('주문 백필 결과:', JSON.stringify(counters));
      } finally {
        await core.end();
      }
    }

    if (DO_MEMBERSHIPS) {
      const membership = sourceConnection('membership', process.env.MEMBERSHIP_DATABASE_URL);
      try {
        const counters = await backfillMemberships(membership, dbService, {
          facts: app.get(MembershipFactsService),
          dims: app.get(MembershipDimensionsService),
        });
        console.log('멤버십 백필 결과:', JSON.stringify(counters));

        // dim 이 채워졌으니 오늘자 스냅샷을 다시 굽는다 (과거 날짜는 필요 시
        // snapshotFor(date) 를 날짜별로 호출해 재계산할 수 있다).
        if (APPLY) {
          const snapshot = app.get(MembershipDailySnapshotService);
          await snapshot.snapshotFor(toSeoulDateOnly(new Date()));
          console.log('오늘자 agg_membership_daily 스냅샷 재기록 완료');
        }
      } finally {
        await membership.end();
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
