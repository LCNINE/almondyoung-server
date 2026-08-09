import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { outbox_events } from './outbox.schema';
import { DbTx } from './outbox.types';
import { OutboxRecord, OutboxWriter } from './outbox-writer.port';

/**
 * 공용 아웃박스 테이블(`outbox_events`) 적재기.
 *
 * **envelope 조립과 검증은 하지 않는다** — 그건 `StreamPublisher.enqueue` 의 일이다(ADR-0029 §5).
 * 옛 `saveEvent` 는 topic·eventType 을 생문자열로 받아 envelope 를 직접 만들었고, 계약을 몰랐기
 * 때문에 zod 를 탈 수 없었다. 그것이 이 레포에서 아웃박스가 "검증되지 않는 쪽 경로"였던 이유다.
 * 이제 이 클래스는 이미 검증된 envelope 를 행으로 옮기기만 한다.
 */
@Injectable()
export class OutboxPublisher implements OutboxWriter {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  async write(record: OutboxRecord, tx: DbTx): Promise<void> {
    await tx.insert(outbox_events).values({
      topic: record.topic,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      payload: record.envelope,
      status: 'PENDING',
    });

    this.logger.debug(`Outbox event saved: ${record.eventType}`, {
      topic: record.topic,
      aggregateId: record.aggregateId,
    });
  }
}
