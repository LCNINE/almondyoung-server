import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { channelAdapterSchema, inboxEvents } from '../schema';
import { ChannelAdapterSchema } from '../types';

// DbTx 타입 정의 (WMS 패턴 참고)
type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

/**
 * `inbox_events` 에서 **발행 큐**를 뜻하던 집계 종류. 그 값을 고르던 앱 자체 디스패처는
 * 6-C-4 에서 삭제됐다 — 즉 이 값으로 들어간 행은 이제 **아무도 읽지 않는다**. 아래
 * `enqueue` 의 거부가 그 블랙홀을 막는 유일한 방어선이다.
 */
const OUTBOX_AGGREGATE_TYPE = 'ChannelAdapter';

/**
 * InboxService
 *
 * ⚠️ 주의: Inbox 패턴 (이벤트 수신 처리)
 * - Kafka에서 받은 이벤트를 Inbox 테이블에 저장
 * - Consumer는 빠르게 ACK, Worker가 비동기 처리
 * - 공용 Outbox (libs/events)와는 다른 용도
 *
 * 책임:
 * - 수신한 이벤트를 Inbox 테이블에 저장
 * - 트랜잭션 내에서 호출되어 원자성 보장
 *
 * **이제 정말로 inbox 전용이다 (ADR-0029 §5-1, Task 6-C-3).** 그 전까지 이 서비스는 두
 * 방향을 겸했다 — `aggregateType` 을 넘기지 않은 호출은 컬럼 기본값 `'ChannelAdapter'` 로
 * 떨어졌고, 앱 자체 아웃박스 디스패처가 정확히 그 값으로 행을 골라 Kafka 로 **발행**했다.
 * 즉 같은 메서드가 수신 큐에도 발행 큐에도 넣었고, 어느 쪽인지는 **인자를 생략했는지**로
 * 갈렸다. 발행 8곳은 공용 `StreamPublisher.enqueue` 로 옮겼고, 6-C-4 가 그 디스패처와
 * 컬럼 기본값을 함께 지웠다 — 이제 생략은 NOT NULL 로 실패한다.
 */
@Injectable()
export class InboxService {
  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  /**
   * 수신한 이벤트를 Inbox에 저장
   *
   * @param params - 이벤트 정보
   * @param tx - 트랜잭션 컨텍스트 (선택적)
   *
   * @example
   * await this.inboxService.enqueue({
   *   eventType: 'ProductMasterActiveVersionChanged',
   *   aggregateType: 'Product',
   *   aggregateId: 'pim-master-123',
   *   partitionKey: 'pim-master-123',
   *   payload: { ... },
   *   metadata: { correlationId: '...' },
   * }, tx);
   */
  async enqueue(
    params: {
      eventType: string;
      aggregateId: string;
      partitionKey: string;
      payload: unknown;
      metadata?: Record<string, unknown>;
      /**
       * **필수다 (Task 6-C-3).** 옵셔널이던 시절 이 인자를 생략하면 컬럼 기본값
       * `'ChannelAdapter'` 가 먹었고, 그 값이 곧 "아웃박스 행" 이라는 뜻이었다 —
       * 생략이 방향을 바꾸는 셈이라 호출부만 봐서는 알 수 없었다. 발행은 이제 공용
       * `StreamPublisher.enqueue` 로 가므로, 여기 남는 것은 수신 큐뿐이고 그 집계
       * 종류는 호출자가 안다.
       */
      aggregateType: string; // 'Product', 'Order' 등
    },
    tx?: DbTx,
  ): Promise<void> {
    if (params.aggregateType === OUTBOX_AGGREGATE_TYPE) {
      // 이 값으로 들어간 행은 수신 큐가 아니라 **발행 큐**였다 — 옛 디스패처가 정확히 이
      // 값으로 행을 골라 Kafka 로 보냈다. 6-C-4 가 그 디스패처를 지웠으므로 같은 행은
      // 이제 아무도 읽지 않는 블랙홀이다. 막지 않으면 그 회귀는 **아무 로그도 남기지 않는다.**
      throw new Error(
        `InboxService.enqueue 는 아웃박스 행을 만들지 않는다 (aggregateType='${OUTBOX_AGGREGATE_TYPE}'). ` +
          '발행은 StreamPublisher.enqueue 로 한다 — ADR-0029 §5-1, Task 6-C-3.',
      );
    }

    const exec = async (trx: DbTx) => {
      await trx.insert(inboxEvents).values({
        eventType: params.eventType,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        partitionKey: params.partitionKey,
        payload: params.payload as any,
        metadata: params.metadata as any,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      });
    };

    if (tx) {
      return exec(tx);
    }
    return this.db.db.transaction(exec);
  }
}
