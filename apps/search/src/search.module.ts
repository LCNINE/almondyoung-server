import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/search/.env'],
    }),
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
