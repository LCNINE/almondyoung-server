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
    // #510: Kafka 브로커가 있으면 전역 재시도/DLQ/스키마검증 인터셉터를 등록한다.
    // main.ts 의 forConsumer(전송 배선)와 짝 — forConsumerModule 은 provider 만 등록하고
    // connectMicroservice 를 부르지 않으므로 두 번째 컨슈머를 만들지 않는다.
    // 조건부인 이유: createKafkaConfigFromEnv() 는 KAFKA_BROKERS 미설정 시 null 이라
    // 무조건 넣으면 브로커 없는 로컬에서 부팅 실패 (channel-adapter adapter.module.ts:112 판례).
    ...(process.env.KAFKA_BROKERS
      ? [
          EventsModule.forConsumerModule({
            streams: [PRODUCT_STREAM, UGC_EVENT_STREAM],
            groupId: process.env.KAFKA_GROUP_ID || 'search-indexer',
            kafka: createKafkaConfigFromEnv()!,
            enableAutoDLQ: true,
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
