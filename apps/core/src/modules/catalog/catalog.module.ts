import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';

// Core domain modules
import { ProductsModule } from './core/products/products.module';
import { CategoriesModule } from './core/categories/categories.module';
import { ChannelsModule } from './core/channels/channels.module';
import { PricingModule } from './core/pricing/pricing.module';
import { TagsModule } from './core/tags/tags.module';
import { BannersModule } from './core/banners/banners.module';
import { NoticesModule } from './core/notices/notices.module';

// Operations modules
import { ApprovalModule } from './operations/approval/approval.module';
import { BulkModule } from './operations/bulk/bulk.module';
import { CsvModule } from './operations/csv/csv.module';
import { AuditModule } from './operations/audit/audit.module';

// Analytics modules
import { DashboardModule } from './analytics/dashboard/dashboard.module';

@Module({
  imports: [
    EventsModule.forRoot({
      streams: [PRODUCT_STREAM],
      serviceName: 'almondyoung',
      enableDLQ: true,
      enableOutbox: true,
    }),
    // Core
    ProductsModule,
    CategoriesModule,
    ChannelsModule,
    PricingModule,
    TagsModule,
    BannersModule,
    NoticesModule,
    // Operations
    ApprovalModule,
    BulkModule,
    CsvModule,
    AuditModule,
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
  ],
})
export class CatalogModule {}
