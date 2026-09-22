import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { UGC_COMMAND_STREAM, UGC_EVENT_STREAM } from '@packages/event-contracts/streams';
import { REVIEWS_OUTBOX_CONFIG } from './reviews/reviews-outbox.config';

@Module({
  imports: [
    EventsModule.forApp({
      publishes: [UGC_COMMAND_STREAM, UGC_EVENT_STREAM],
      serviceName: 'ugc-service',
      // 소비 검증 정책은 앱 전체에 하나. 다른 소비 앱과 같은 값이다.
      policy: { validateOnConsume: true },
      // 적립 명령은 리뷰 트랜잭션과 같이 커밋돼야 한다 — 원장엔 지급인데 명령만 사라지는 창을 없앤다.
      enableOutbox: true,
      outbox: REVIEWS_OUTBOX_CONFIG,
    }),
  ],
  exports: [EventsModule],
})
export class UgcEventsModule {}
