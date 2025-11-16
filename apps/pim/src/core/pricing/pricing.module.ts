import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricingCalculatorService } from './pricing-calculator.service';
import { PricingValidatorService } from './pricing-validator.service';

@Module({
  controllers: [PricingController],
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

