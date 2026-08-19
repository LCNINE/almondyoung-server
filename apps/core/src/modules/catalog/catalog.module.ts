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
import { SitePopupsModule } from './core/site-popups/site-popups.module';
import { ShopListingsModule } from './core/shop-listings/shop-listings.module';
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
      publishes: [PRODUCT_STREAM],
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
    SitePopupsModule,
    ShopListingsModule,
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
    ShopListingsModule,
    AiPromptsModule,
  ],
})
export class CatalogModule {}
