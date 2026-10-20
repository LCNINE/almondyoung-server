import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { Controller, Inject, UseInterceptors } from '@nestjs/common';
import { IAM_STREAM, PiiAccessedSchema } from '@packages/event-contracts/streams';
import { PiiAccessCreator } from './pii-access.creator';

/**
 * 다른 서비스가 아웃박스로 적재한 접속기록을 모은다. 계약을 어긴 payload 는 throw — 재시도·DLQ 경로로 보낸다
 * (조용히 버리면 기록이 사라진다).
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class PiiAccessConsumer {
  constructor(@Inject(PiiAccessCreator) private readonly creator: Pick<PiiAccessCreator, 'record'>) {}

  @On(IAM_STREAM, 'PiiAccessed')
  async onPiiAccessed(@EventPayload() payload: unknown): Promise<void> {
    const parsed = PiiAccessedSchema.parse(payload);
    await this.creator.record({ ...parsed, occurredAt: new Date(parsed.occurredAt) });
  }
}
