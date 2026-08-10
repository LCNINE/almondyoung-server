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
            // 소비 스키마 검증 ON (플랜 Task 5-C, 2026-08-10).
            //
            // 이 앱을 막던 2개 이벤트(`ProductMasterActiveVersionChanged` ·
            // `ProductMasterDeleted`)는 core 카탈로그가 아웃박스로 내보내며 zod 를 우회했다.
            // 6-A 가 적재·발행 양쪽에 문을 달아 그 우회를 없앴고 둘 다 PROVEN 이 됐다.
            //
            // DLQ 메트릭은 스크레이프되지 않는다(`dlq.metrics.ts:10`) — 관측은 로그다.
            // 검증 실패는 `SchemaValidationInterceptor` 가 error 로 찍고 OTLP 로 Loki 에 간다.
            //
            // 되돌리기는 이 한 줄을 `false` 로 바꾸는 것이다.
            // 현황: `npm run audit:consume-validation -- search`
            validation: { validateOnConsume: true },
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
