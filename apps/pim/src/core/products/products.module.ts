import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { ProductMastersController } from './controllers/product-masters.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { ProductMastersService } from './services/product-masters.service';
import { ProductVariantsService } from './services/product-variants.service';
import { ProductSearchService } from './services/product-search.service';
import { ProductPricingService } from './services/product-pricing.service';
import { PricingStrategyFactory } from './pricing/pricing-strategy.factory';
import { OptionBasedPricingStrategy } from './pricing/option-based-pricing.strategy';
import { VariantBasedPricingStrategy } from './pricing/variant-based-pricing.strategy';

@Module({
  imports: [],
  controllers: [ProductMastersController, ProductVariantsController],
  providers: [
    ProductMastersService,
    ProductVariantsService,
    ProductSearchService,
    ProductPricingService,
    PricingStrategyFactory,
    OptionBasedPricingStrategy,
    VariantBasedPricingStrategy,
  ],
  exports: [
    ProductMastersService,
    ProductVariantsService,
    ProductSearchService,
    ProductPricingService,
    PricingStrategyFactory,
  ],
})
export class ProductsModule {}

