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
          'postgresql://postgres:ehddud0724*@localhost:5432/pim_db',
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
  ],
  providers: [
    ProductCategoriesService,
    ProductMastersService,
    ProductVariantsService,
    ChannelProductsService,
    SalesChannelsService,
    PricingStrategyFactory,
    OptionBasedPricingStrategy,
    VariantBasedPricingStrategy,
  ],
})
export class PimModule {}
