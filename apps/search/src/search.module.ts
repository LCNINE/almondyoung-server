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
            // ⚠️ 현상 유지다 — 이 앱은 소비 경로에 스키마 검증이 붙은 적이 없다
            // (ADR-0029 §8). startConsumer 로 이주하면 인터셉터가 처음 붙으므로,
            // 명시하지 않으면 기본값 `true` 가 배선 이주에 묻어 함께 켜진다.
            // 검증 활성화는 payload 샘플링 후 별도 결정 (플랜 Task 5-C).
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
