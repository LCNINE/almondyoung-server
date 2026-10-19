import { IAM_STREAM } from '@packages/event-contracts/streams';
import { Module } from '@nestjs/common';
import { EventsModule, LONG_OUTBOX_MAX_RETRIES, LONG_OUTBOX_RETRY_DELAYS_SECONDS } from '@app/events';
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  PRODUCT_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts';

// Core domain modules
import { ProductsModule } from './core/products/products.module';
import { CategoriesModule } from './core/categories/categories.module';
import { ChannelsModule } from './core/channels/channels.module';
import { ProductFilesModule } from './core/product-files/product-files.module';
import { PricingModule } from './core/pricing/pricing.module';
import { TagsModule } from './core/tags/tags.module';
import { BannersModule } from './core/banners/banners.module';
import { NoticesModule } from './core/notices/notices.module';
import { SitePopupsModule } from './core/site-popups/site-popups.module';
import { AiPromptsModule } from './core/ai-prompts/ai-prompts.module';

// Operations modules
import { BulkModule } from './operations/bulk/bulk.module';
import { ProductExportModule } from './operations/export/product-export.module';
import { AuditModule } from './operations/audit/audit.module';
import { BulkSessionModule } from './operations/bulk-session/bulk-session.module';

// Analytics modules
import { DashboardModule } from './analytics/dashboard/dashboard.module';

@Module({
  imports: [
    EventsModule.forApp({
      publishes: [PRODUCT_STREAM, IAM_STREAM],
      serviceName: 'almondyoung',
      enableDLQ: true,
      enableOutbox: true,
      // 굳기 전 약 2시간 버티고, 같은 주문의 순서를 지킨다 (#1016 7번, 스펙 D4·§8.2).
      // 아웃박스는 앱 하나에 테이블 하나라 이 설정이 core 전체 outbox 에 적용된다. 순서는 core 가 outbox 로 적재하는
      // 주문 생애 토픽만 — 재고(`ProductSellableQuantityChanged`)처럼 마지막 값이 이기는 토픽은 넣지 않는다
      // (`OutboxConfig.sequencedTopics` 주석).
      outbox: {
        retryDelaysSeconds: LONG_OUTBOX_RETRY_DELAYS_SECONDS,
        maxRetries: LONG_OUTBOX_MAX_RETRIES,
        sequencedTopics: [
          CORE_ORDER_STREAM.topic.topic,
          CHANNEL_ORDERS_COMMAND_STREAM.topic.topic,
          FULFILLMENT_STREAM.topic.topic,
          FULFILLMENT_V2_STREAM.topic.topic,
          SHIPMENT_STREAM.topic.topic,
        ],
      },
    }),
    // Core
    ProductsModule,
    CategoriesModule,
    ChannelsModule,
    ProductFilesModule,
    PricingModule,
    TagsModule,
    BannersModule,
    NoticesModule,
    SitePopupsModule,
    AiPromptsModule,
    // Operations
    BulkModule,
    ProductExportModule,
    AuditModule,
    BulkSessionModule,
    // Analytics
    DashboardModule,
  ],
  exports: [
    ProductsModule,
    CategoriesModule,
    ChannelsModule,
    PricingModule,
    TagsModule,
    BannersModule,
    NoticesModule,
    SitePopupsModule,
    AiPromptsModule,
  ],
})
export class CatalogModule {}
