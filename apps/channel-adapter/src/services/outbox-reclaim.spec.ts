/**
 * 아웃박스 회수 회귀 네트 (ADR-0029 §5-1, Task 6-C-3)
 *
 * 이 앱에는 `inbox_events` 테이블 하나가 **두 방향**을 겸하고 있었다. 수신 큐로 쓰는 행은
 * `InboxWorkerService` 가 처리하고, `aggregate_type = 'ChannelAdapter'` 인 행은
 * `OutboxDispatcherService` 가 Kafka 로 **발행**했다. 어느 쪽인지는 호출자가
 * `aggregateType` 인자를 **생략했는지**로 갈렸다 — 생략하면 컬럼 기본값이 발행 큐였다.
 *
 * 회수는 그 발행 8곳을 공용 `event.outbox_events`(=`StreamPublisher.enqueue`)로 옮긴다.
 * 여기 있는 단언은 옮긴 뒤에도 **조용히 되돌아갈 수 있는 것들**만 고른다:
 *
 *  1. 발행이 옛 큐로 되돌아가는 것 — `InboxService` 가 그 집계 종류를 거부한다.
 *  2. 파티션 키 소실 — 두 스트림 다 파생 함수가 없어 생략하면 aggregateId 로 조용히 떨어진다.
 *  3. 스트림 오배치 — CommandExecuted/InventorySyncCompleted 가 orders 토픽으로 가는 것.
 */

import type { DbService } from '@app/db';
import type { PublisherFor } from '@app/events';
import { CHANNEL_ADAPTER_STREAM } from '@packages/event-contracts/streams';
import type { channelAdapterSchema } from '../types';
import { InboxService } from './inbox.service';
import { ChannelCommandManager } from './channel-command.manager';
import { ChannelSyncManager } from './channel-sync.manager';
import type { ChannelAdapterFactory } from '../adapters/channel-adapter.factory';

type EnqueueCall = [
  { eventType: string; aggregateId: string; partitionKey?: string; payload: Record<string, unknown> },
  unknown,
];

function makeOutbox() {
  return {
    enqueue: jest.fn<Promise<void>, EnqueueCall>().mockResolvedValue(undefined),
  };
}

describe('channel-adapter 아웃박스 회수', () => {
  describe('InboxService 는 발행 큐를 만들지 않는다', () => {
    const db = { db: { insert: jest.fn(), transaction: jest.fn() } };
    const inbox = new InboxService(db as unknown as DbService<typeof channelAdapterSchema>);

    it("aggregateType='ChannelAdapter' 를 거부한다", async () => {
      await expect(
        inbox.enqueue({
          eventType: 'OrderCreated',
          aggregateType: 'ChannelAdapter',
          aggregateId: 'order-1',
          partitionKey: 'medusa',
          payload: {},
        }),
      ).rejects.toThrow(/StreamPublisher\.enqueue/);

      // 던지기 전에 아무것도 쓰지 않는다 — 부분 상태가 남으면 거부가 무의미하다.
      expect(db.db.insert).not.toHaveBeenCalled();
      expect(db.db.transaction).not.toHaveBeenCalled();
    });

    it('수신 큐 집계 종류는 그대로 통과시킨다 (대조군)', async () => {
      // 이 대조군이 없으면 위 단언은 "enqueue 가 항상 던진다" 로도 초록이다.
      const values = jest.fn().mockResolvedValue(undefined);
      const tx = { insert: jest.fn().mockReturnValue({ values }) };

      await inbox.enqueue(
        {
          eventType: 'CategoryChanged',
          aggregateType: 'Category',
          aggregateId: 'cat-1',
          partitionKey: 'cat-1',
          payload: { categoryId: 'cat-1' },
        },
        tx as never,
      );

      expect(values).toHaveBeenCalledWith(expect.objectContaining({ aggregateType: 'Category', status: 'pending' }));
    });
  });

  describe('CHANNEL_ADAPTER_STREAM 적재', () => {
    it('CommandExecuted 를 채널명 파티션으로 적재한다', async () => {
      const outbox = makeOutbox();
      const db = { db: { insert: jest.fn() } };
      const adapter = {
        executeCommand: jest.fn().mockResolvedValue({ success: true, processedCount: 2, failedCount: 0 }),
      };
      const factory = { getAdapter: jest.fn().mockReturnValue(adapter) };

      const manager = new ChannelCommandManager(
        factory as unknown as ChannelAdapterFactory,
        db as unknown as DbService<typeof channelAdapterSchema>,
        outbox as unknown as PublisherFor<typeof CHANNEL_ADAPTER_STREAM>,
      );

      await manager.execute('naver_smartstore', { type: 'SHIP', orderId: 'order-9' } as never);

      const [params, writer] = outbox.enqueue.mock.calls[0];
      expect(params.eventType).toBe('CommandExecuted');
      // 옛 경로는 행의 `partition_key` 컬럼(= 채널명)을 Kafka 키로 썼다. 생략하면
      // aggregateId(`naver_smartstore-order-9`)로 떨어져 파티션이 주문마다 흩어진다.
      expect(params.partitionKey).toBe('naver_smartstore');
      // 도메인 쓰기와 묶을 트랜잭션이 없는 경로다 — 커넥션에 직접 쓴다(옛 경로도 그랬다).
      expect(writer).toBe(db.db);
      // 계약을 실제로 만족하는지는 스키마에 물어본다. `enqueue` 는 적재 시점에 zod 를
      // 태우므로, 여기서 통과하지 못하는 payload 는 프로덕션에서 도메인 트랜잭션을 깬다.
      expect(CHANNEL_ADAPTER_STREAM.events.CommandExecuted.schema!.parse(params.payload)).toEqual(params.payload);
    });

    it('InventorySyncCompleted 를 채널명 파티션으로 적재한다', async () => {
      const outbox = makeOutbox();
      const values = jest.fn().mockResolvedValue(undefined);
      const db = { db: { insert: jest.fn().mockReturnValue({ values }) } };

      const manager = new ChannelSyncManager(
        db as unknown as DbService<typeof channelAdapterSchema>,
        outbox as unknown as PublisherFor<typeof CHANNEL_ADAPTER_STREAM>,
        {} as unknown as ChannelAdapterFactory,
      );

      await manager.logOutboundSync(
        'coupang',
        { dataType: 'inventory', payload: { productId: 'prod-1', stockQuantity: 7, isOptionProduct: false } } as never,
        { success: true } as never,
      );

      const [params] = outbox.enqueue.mock.calls[0];
      expect(params.eventType).toBe('InventorySyncCompleted');
      expect(params.partitionKey).toBe('coupang');
      expect(CHANNEL_ADAPTER_STREAM.events.InventorySyncCompleted.schema!.parse(params.payload)).toEqual(
        params.payload,
      );
    });
  });
});
