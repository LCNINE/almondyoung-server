import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { PRODUCT_STREAM, UGC_EVENT_STREAM } from '@packages/event-contracts/streams';
import { SearchController } from './search.controller';
import { ProductEventsConsumer } from './product-events.consumer';
import { ReviewEventsConsumer } from './review-events.consumer';
import { OpenSearchService } from './opensearch.service';
import { ProductIndexService } from './product-index.service';
import { SearchService } from './search.service';
import { HealthController } from './health.controller';
import { OpenSearchKeywordRepository } from './opensearch-keyword.repository';
import { SEARCH_KEYWORD_REPOSITORY } from './search-keyword.repository';
import { SearchKeywordService } from './search-keyword.service';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/search/.env'],
    }),
    // #510: Kafka 브로커가 있으면 DLQ 핸들러·추적 서비스·소비 정책을 등록한다.
    // forConsumerModule 은 provider 만 등록하고 connectMicroservice 를 부르지 않으므로
    // 두 번째 컨슈머를 만들지 않는다 — 소비 전송 배선은 main.ts 의 startConsumer 가 한다.
    // 조건부인 이유: createKafkaConfigFromEnv() 는 KAFKA_BROKERS 미설정 시 null 이라
    // 무조건 넣으면 브로커 없는 로컬에서 부팅 실패 (channel-adapter adapter.module.ts:112 판례).
    // main.ts 도 같은 조건으로 startConsumer 를 건너뛰므로 두 조건은 짝이다.
    ...(process.env.KAFKA_BROKERS
      ? [
          EventsModule.forConsumerModule({
            streams: [PRODUCT_STREAM, UGC_EVENT_STREAM],
            groupId: process.env.KAFKA_GROUP_ID || 'search-indexer',
            kafka: createKafkaConfigFromEnv()!,
            enableAutoDLQ: true,
            // ⚠️ 아직 끈다. core 는 5-C 에서 켰지만 이 앱은 못 켠다 (ADR-0029 §8).
            //
            // 막는 것은 딱 2개 이벤트다 — `ProductMasterActiveVersionChanged` ·
            // `ProductMasterDeleted`. 둘 다 core 카탈로그가 `OutboxPublisher.saveEvent` 로
            // 발행하는데, 그 경로는 `publishRawEnvelope` 로 zod 를 우회한다. 즉 이 토픽에
            // 스키마를 안 지키는 payload 가 올라올 수 있는지 정적으로 증명되지 않는다.
            //
            // **이걸 여는 것은 Task 6 이다** (enqueue 시점 zod 검증). 그게 들어가면 두 이벤트가
            // 자동으로 PROVEN 이 되어 이 줄을 뒤집을 수 있다. 그 전에 켜는 것은 추측이다.
            // 현황: `npm run audit:consume-validation -- search`
            validation: { validateOnConsume: false },
          }),
        ]
      : []),
  ],
  controllers: [SearchController, ProductEventsConsumer, ReviewEventsConsumer, HealthController],
  providers: [
    SearchService,
    OpenSearchService,
    ProductIndexService,
    SearchKeywordService,
    OpenSearchKeywordRepository,
    {
      provide: SEARCH_KEYWORD_REPOSITORY,
      useExisting: OpenSearchKeywordRepository,
    },
  ],
})
export class SearchModule {}
