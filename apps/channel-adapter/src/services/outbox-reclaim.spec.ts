/**
 * 아웃박스 회수 회귀 네트 (ADR-0029 §5-1, Task 6-C-3)
 *
 * 이 앱에는 `inbox_events` 테이블 하나가 **두 방향**을 겸하고 있었다. 수신 큐로 쓰는 행은
 * `InboxWorkerService` 가 처리하고, `aggregate_type = 'ChannelAdapter'` 인 행은
 * 앱 자체 아웃박스 디스패처(6-C-4 에서 삭제)가 Kafka 로 **발행**했다. 어느 쪽인지는 호출자가
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
});
