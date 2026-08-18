// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { OrderCollectionFailureService } from './order-collection-failure.service';
import { CHANNEL_PRODUCT_IDENTIFICATION_FAILED, OrderCollectionFailureItem } from './channel-order-provider.interface';
import { orderCollectionFailures } from '../../schema';
import type { ListingResolutionCause } from '@packages/domain-types';

/**
 * 사유는 **폴링마다 달라진다** — 매핑을 만들면 `listing_not_found` → `variant_inactive` 로
 * 바뀐다. 그때 행이 하나로 유지되는지가 이 설계의 핵심이다 (#674).
 *
 * `reason` 을 쪼갰다면 `uq_order_collection_failure` 가 `(channel, external_order_id, reason)`
 * 이므로 같은 주문에 행이 두 개 생기고 옛 행이 `quarantined` 로 영원히 남았을 것이다. 그
 * 사실은 실 Postgres 로만 증명된다.
 *
 * 실행:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
 *   npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-cause.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('격리 사유 갱신 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: ReturnType<typeof postgres>;
  let service: OrderCollectionFailureService;
  let db: ReturnType<typeof drizzle>;
  const channels: string[] = [];

  const newChannel = () => {
    const channel = `spec-${Math.random().toString(36).slice(2, 10)}`;
    channels.push(channel);
    return channel;
  };

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    service = new OrderCollectionFailureService({ db } as never);
  });

  afterAll(async () => {
    for (const channel of channels) {
      await db.delete(orderCollectionFailures).where(eq(orderCollectionFailures.channel, channel));
    }
    await client.end({ timeout: 0 });
  });

  function failure(lines: { lineId: string; cause: ListingResolutionCause }[]): OrderCollectionFailureItem {
    return {
      externalOrderId: 'ORDER-1',
      sourceUpdatedAt: new Date().toISOString(),
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: lines.map((line) => line.lineId),
      affectedLines: lines,
      rawOrder: { hello: 'world' },
    };
  }

  it('사유를 그대로 저장한다', async () => {
    const channel = newChannel();
    const record = await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'listing_not_found' }]));
    expect(record.affectedLines).toEqual([{ lineId: 'L1', cause: 'listing_not_found' }]);
  });

  it('사유가 바뀌어도 행은 하나로 유지되고 갱신된다', async () => {
    const channel = newChannel();
    await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'listing_not_found' }]));
    await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'variant_inactive' }]));

    const rows = await db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(eq(orderCollectionFailures.channel, channel), eq(orderCollectionFailures.externalOrderId, 'ORDER-1')),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].affectedLines).toEqual([{ lineId: 'L1', cause: 'variant_inactive' }]);
  });

  it('목록 조회에도 사유가 실린다 — 화면(#640)이 읽을 자리다', async () => {
    const channel = newChannel();
    await service.recordFailure(channel, failure([{ lineId: 'L1', cause: 'no_active_version' }]));

    const listed = await service.list({ channel });

    expect(listed).toHaveLength(1);
    expect(listed[0].affectedLines).toEqual([{ lineId: 'L1', cause: 'no_active_version' }]);
  });

  it('사유가 없는 실패는 null 로 남는다', async () => {
    const channel = newChannel();
    const record = await service.recordFailure(channel, {
      externalOrderId: 'ORDER-1',
      sourceUpdatedAt: new Date().toISOString(),
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['L1'],
      rawOrder: {},
    });
    expect(record.affectedLines).toBeNull();
  });
});
