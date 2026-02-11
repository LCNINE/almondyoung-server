import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchController } from './search.controller';
import { ProductEventsConsumer } from './product-events.consumer';
import { OpenSearchService } from './opensearch.service';
import { ProductIndexService } from './product-index.service';
import { SearchService } from './search.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/search/.env'],
    }),
  ],
  controllers: [SearchController, ProductEventsConsumer],
  providers: [SearchService, OpenSearchService, ProductIndexService],
})
export class SearchModule {}
