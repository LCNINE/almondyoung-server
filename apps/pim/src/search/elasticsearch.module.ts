import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { ElasticsearchService } from './elasticsearch.service';
import { ElasticsearchIndexService } from './elasticsearch-index.service';
import { ElasticsearchSyncService } from './elasticsearch-sync.service';
import { ProductSearchService } from './product-search.service';
import { ProductSearchController } from './product-search.controller';

@Module({
  imports: [
    EventsModule.forConsumerModule({
      streams: [PRODUCT_STREAM],
      groupId: 'pim-es-sync',
      enableAutoDLQ: true,
    }),
  ],
  providers: [
    ElasticsearchService,
    ElasticsearchIndexService,
    ElasticsearchSyncService,
    ProductSearchService,
  ],
  controllers: [ProductSearchController],
  exports: [
    ElasticsearchService,
    ElasticsearchIndexService,
    ElasticsearchSyncService,
    ProductSearchService,
  ],
})
export class ElasticsearchModule { }

