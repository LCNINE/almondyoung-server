import { DbService } from '@app/db';
import { InjectPublisher, type PublisherFor } from '@app/events';
import { Inject, Injectable } from '@nestjs/common';
import { IAM_STREAM } from '@packages/event-contracts/streams';
import { PiiAccessRecorder, type PiiAccessRecord } from '../services/pii-access-recorder';

type IamPublisher = Pick<PublisherFor<typeof IAM_STREAM>, 'enqueue'>;
type OutboxDb = Pick<DbService['db'], 'insert'>;

/**
 * 아웃박스가 있는 앱의 접속기록 — 응답 전에 같은 DB 아웃박스에 적재하고 디스패처가 Kafka 로 보낸다.
 * 앱의 `EventsModule.forApp({ publishes })` 에 `IAM_STREAM` 이 있어야 한다. 이 파일은 패키지 루트에서
 * 내보내지 않는다(이벤트 모듈을 쓰지 않는 앱이 끌어오지 않게) — `@app/authorization/recorders/…` 로 가져온다.
 */
@Injectable()
export class OutboxPiiAccessRecorder extends PiiAccessRecorder {
  constructor(
    @InjectPublisher(IAM_STREAM) private readonly publisher: IamPublisher,
    @Inject(DbService) private readonly dbService: { readonly db: OutboxDb },
  ) {
    super();
  }

  async record(entry: PiiAccessRecord): Promise<void> {
    await this.publisher.enqueue(
      {
        eventType: 'PiiAccessed',
        aggregateId: entry.actorUserId,
        idempotencyKey: entry.eventId,
        payload: {
          ...entry,
          subjects: entry.subjects.map((s) => ({ type: s.type, id: s.id })),
          kinds: [...entry.kinds],
          queryKeys: [...entry.queryKeys],
          occurredAt: entry.occurredAt.toISOString(),
        },
      },
      this.dbService.db,
    );
  }
}
