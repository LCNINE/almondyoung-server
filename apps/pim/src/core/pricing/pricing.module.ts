import { Module } from '@nestjs/common';
import { VersionPricingController } from './version-pricing.controller';
import { MasterPricingController } from './master-pricing.controller';
import { PricingService } from './pricing.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import { PricingValidatorService } from './pricing-validator.service';
import { VariantPriceCacheService } from './variant-price-cache.service';

@Module({
  controllers: [VersionPricingController, MasterPricingController],
  providers: [
    PricingService,
    PricingCalculatorService,
    PricingValidatorService,
    VariantPriceCacheService,
  ],
  exports: [
    PricingService,
    PricingCalculatorService,
    PricingValidatorService,
    VariantPriceCacheService,
  ],
})
export class PricingModule {}
