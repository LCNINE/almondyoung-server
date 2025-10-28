import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { PimController } from './pim.controller';
import { PimService } from './pim.service';
import { ProductCategoriesController } from './controllers/categories.controller';
import { ProductCategoriesService } from './services/categories.service';
import { ProductMastersController } from './controllers/product-masters.controller';
import { ProductMastersService } from './services/product-masters.service';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { ProductVariantsService } from './services/product-variants.service';
import { ChannelProductsController } from './controllers/channel-products.controller';
import { ChannelProductsService } from './services/channel-products.service';
import { SalesChannelsController } from './controllers/sales-channels.controller';
import { SalesChannelsService } from './services/sales-channels.service';
import { FileUploadController } from './controllers/file-upload.controller';
import { ImageService } from './services/image.service';

// Phase 1 new imports
import { ProductApprovalController } from './controllers/product-approval.controller';
import { ProductApprovalService } from './services/product-approval.service';
import { ProductSearchService } from './services/product-search.service';
import { ProductBulkController } from './controllers/product-bulk.controller';
import { ProductBulkService } from './services/product-bulk.service';

// Phase 3 new imports
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ProductCsvService } from './services/product-csv.service';
import { ProductCsvController } from './controllers/product-csv.controller';
import { ProductAuditService } from './services/product-audit.service';
import { ProductAuditController } from './controllers/product-audit.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';

import { PricingStrategyFactory } from './services/pricing/pricing-strategy.factory';
import { OptionBasedPricingStrategy } from './services/pricing/option-based-pricing.strategy';
import { VariantBasedPricingStrategy } from './services/pricing/variant-based-pricing.strategy';
import { pimSchema } from './schema';

@Module({
  imports: [
    // PIM 전체 스키마를 한 곳에서 관리
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_uZH3erzXIdR6@ep-plain-tooth-a1jtqmyb-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      },
      schema: pimSchema,
    }),
  ],
  controllers: [
    PimController,
    ProductCategoriesController,
    ProductMastersController,
    ProductVariantsController,
    ChannelProductsController,
    SalesChannelsController,
    FileUploadController,
    // Phase 1 new controllers
    ProductApprovalController,
    ProductBulkController,
    // Phase 3 new controllers
    ProductCsvController,
    ProductAuditController,
  ],
  providers: [
    PimService,
    ProductCategoriesService,
    ProductMastersService,
    ProductVariantsService,
    ChannelProductsService,
    SalesChannelsService,
    ImageService,
    PricingStrategyFactory,
    OptionBasedPricingStrategy,
    VariantBasedPricingStrategy,
    // Phase 1 new services
    ProductApprovalService,
    ProductSearchService,
    ProductBulkService,
    // Phase 3 new services
    ProductCsvService,
    ProductAuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class PimModule {}
