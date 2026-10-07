// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import {
  OrderCollectionFailureService,
  PROCESSING_FAILURE_MAX_ATTEMPTS,
} from './order-collection-failure.service';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  ORDER_COLLECTION_PROCESSING_FAILED,
  OrderProcessingFailureItem,
} from './channel-order-provider.interface';
import { orderCollectionFailures } from '../../schema';

/**
 * 실행:
 *   npx dotenv -e apps/channel-adapter/.env -- npx jest --runInBand \
 *     apps/channel-adapter/src/services/order-collection/order-collection-failure-processing.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('처리 실패 기록 (PostgreSQL integration, #1016 1번 행)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let service: OrderCollectionFailureService;
  const channel = `spec-${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    service = new OrderCollectionFailureService({ db } as never);
  });
  afterEach(async () => {
    await db.delete(orderCollectionFailures).where(eq(orderCollectionFailures.channel, channel));
  });
  afterAll(async () => {
    await client.end({ timeout: 0 });
  });

  const failure = (externalOrderId: string, overrides: Partial<OrderProcessingFailureItem> = {}): OrderProcessingFailureItem => ({
    externalOrderId,
    sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
    stage: 'enqueue_order',
    error: 'contract violation',
    input: { createPayload: { externalOrderId } },
    ...overrides,
  });
  const setUpdatedAt = (externalOrderId: string, at: Date) =>
    db
      .update(orderCollectionFailures)
      .set({ updatedAt: at })
      .where(and(eq(orderCollectionFailures.channel, channel), eq(orderCollectionFailures.externalOrderId, externalOrderId)));

  it('열린 행에 다시 실패하면 횟수를 누적하고 단계·에러·입력을 갱신한다', async () => {
    const first = await service.recordProcessingFailure(channel, failure('A'));
    const second = await service.recordProcessingFailure(
      channel,
      failure('A', { stage: 'enqueue_lifecycle', error: 'lifecycle broke', input: { eventKey: 'cancelled' } }),
    );

    expect(first.record.attemptCount).toBe(1);
    expect(second.record).toMatchObject({
      id: first.record.id,
      reason: ORDER_COLLECTION_PROCESSING_FAILED,
      status: 'quarantined',
      attemptCount: 2,
      failedStage: 'enqueue_lifecycle',
      lastError: 'lifecycle broke',
      rawOrder: { eventKey: 'cancelled' },
      errorMessage: null,
    });
  });

  it('exhaustedNow 는 횟수가 정확히 상한에 닿은 한 번만 true 다', async () => {
    const flags: boolean[] = [];
    for (let i = 0; i < PROCESSING_FAILURE_MAX_ATTEMPTS + 1; i++) {
      flags.push((await service.recordProcessingFailure(channel, failure('A'))).exhaustedNow);
    }
    expect(flags).toEqual([false, false, false, true, false]);
  });

  it('종결된 행이 다시 실패하면 새 사건이라 1 부터 다시 연다', async () => {
    const first = await service.recordProcessingFailure(channel, failure('A'));
    await service.recordProcessingFailure(channel, failure('A'));
    await service.markReplayed(first.record.id, undefined, '닫음');

    const reopened = await service.recordProcessingFailure(channel, failure('A'));

    expect(reopened.record).toMatchObject({ status: 'quarantined', attemptCount: 1, errorMessage: null, replayedAt: null });
  });

  it('markReplayed 의 note 는 error_message 에 남는다', async () => {
    const { record } = await service.recordProcessingFailure(channel, failure('A'));
    await service.markReplayed(record.id, undefined, '식별 실패 격리로 넘어감');
    await expect(service.findById(record.id)).resolves.toMatchObject({
      status: 'replayed',
      errorMessage: '식별 실패 격리로 넘어감',
    });
  });

  it('요약은 재시도가 남은 처리 실패를 빼고, 소진된 처리 실패와 다른 사유는 센다', async () => {
    await service.recordProcessingFailure(channel, failure('retrying'));
    for (let i = 0; i < PROCESSING_FAILURE_MAX_ATTEMPTS; i++) {
      await service.recordProcessingFailure(channel, failure('exhausted'));
    }
    await service.recordFailure(channel, {
      externalOrderId: 'identification',
      sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
    });

    await expect(service.summarizeQuarantined({ channel })).resolves.toMatchObject({ quarantined: 2 });
  });

  it('재시도 대상은 열린·처리 실패·상한 미만·주기 시작 전 갱신 행이고, 오래된 순으로 상한까지만', async () => {
    const now = Date.now();
    await service.recordProcessingFailure(channel, failure('old'));
    await setUpdatedAt('old', new Date(now - 20 * 60_000));
    await service.recordProcessingFailure(channel, failure('older'));
    await setUpdatedAt('older', new Date(now - 30 * 60_000));
    for (let i = 0; i < PROCESSING_FAILURE_MAX_ATTEMPTS; i++) {
      await service.recordProcessingFailure(channel, failure('exhausted'));
    }
    await setUpdatedAt('exhausted', new Date(now - 30 * 60_000));
    const closed = await service.recordProcessingFailure(channel, failure('closed'));
    await service.markReplayed(closed.record.id);
    await setUpdatedAt('closed', new Date(now - 30 * 60_000));
    await service.recordFailure(channel, {
      externalOrderId: 'identification',
      sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
    });
    await setUpdatedAt('identification', new Date(now - 30 * 60_000));
    await service.recordProcessingFailure(channel, failure('fresh')); // updated_at = 지금

    const before = new Date(now - 60_000);
    const rows = await service.findRetryableProcessingFailures(channel, before);
    expect(rows.map((row) => row.externalOrderId)).toEqual(['older', 'old']);

    const limited = await service.findRetryableProcessingFailures(channel, before, 1);
    expect(limited.map((row) => row.externalOrderId)).toEqual(['older']);
  });

  it('방금 갱신한 행은 1초 전 기준에선 빠지고 1초 뒤 기준에선 잡힌다 — JS Date 와 같은 시각 기준이다', async () => {
    await service.recordProcessingFailure(channel, failure('A'));

    const excluded = await service.findRetryableProcessingFailures(channel, new Date(Date.now() - 1_000));
    const included = await service.findRetryableProcessingFailures(channel, new Date(Date.now() + 1_000));

    expect(excluded).toEqual([]);
    expect(included.map((row) => row.externalOrderId)).toEqual(['A']);
  });

  it('findOpenProcessingFailures 는 열린 처리 실패 행만 주문 id 로 묶어 준다', async () => {
    await service.recordProcessingFailure(channel, failure('A'));
    const closed = await service.recordProcessingFailure(channel, failure('B'));
    await service.markReplayed(closed.record.id);

    const open = await service.findOpenProcessingFailures(channel, ['A', 'B', 'C']);

    expect([...open.keys()]).toEqual(['A']);
    await expect(service.findOpenProcessingFailures(channel, [])).resolves.toEqual(new Map());
  });

  it('findAllOpenByExternalOrderId 는 사유가 달라도 열린 행을 전부 준다', async () => {
    await service.recordProcessingFailure(channel, failure('A'));
    await service.recordFailure(channel, {
      externalOrderId: 'A',
      sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
    });

    const rows = await service.findAllOpenByExternalOrderId(channel, 'A');

    expect(rows.map((row) => row.reason).sort()).toEqual(
      [CHANNEL_PRODUCT_IDENTIFICATION_FAILED, ORDER_COLLECTION_PROCESSING_FAILED].sort(),
    );
  });
});
