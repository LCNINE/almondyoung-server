import { Module } from '@nestjs/common';
import { VersionPricingController } from './version-pricing.controller';
import { MasterPricingController } from './master-pricing.controller';
import { PricingService } from './pricing.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import { PricingValidatorService } from './pricing-validator.service';

@Module({
  controllers: [VersionPricingController, MasterPricingController],
  providers: [
    PricingService,
    PricingCalculatorService,
    PricingValidatorService,
  ],
  exports: [
    PricingService,
    PricingCalculatorService,
    PricingValidatorService,
  ],
})
export class PricingModule {}

