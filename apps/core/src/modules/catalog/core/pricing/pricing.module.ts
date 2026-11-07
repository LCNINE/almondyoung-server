import { Module } from '@nestjs/common';
import { VersionPricingController } from './version-pricing.controller';
import { MasterPricingController } from './master-pricing.controller';
import { PricingService } from './pricing.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import { PricingValidatorService } from './pricing-validator.service';
import { VariantPriceCacheService } from './variant-price-cache.service';
import { QuantityDiscountReader } from './quantity-discount.reader';
import { QuantityDiscountManager } from './quantity-discount.manager';
import { QuantityDiscountService } from './quantity-discount.service';
import { QuantityDiscountController } from './quantity-discount.controller';

@Module({
  controllers: [VersionPricingController, MasterPricingController, QuantityDiscountController],
  providers: [
    PricingService,
    PricingCalculatorService,
    PricingValidatorService,
    VariantPriceCacheService,
    QuantityDiscountReader,
    QuantityDiscountManager,
    QuantityDiscountService,
  ],
  exports: [
    PricingService,
    PricingCalculatorService,
    PricingValidatorService,
    VariantPriceCacheService,
    QuantityDiscountReader,
    QuantityDiscountManager,
  ],
})
export class PricingModule {}
