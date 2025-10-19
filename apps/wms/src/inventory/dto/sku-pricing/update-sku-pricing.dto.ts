import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSkuPricingDto } from './create-sku-pricing.dto';

export class UpdateSkuPricingDto extends PartialType(
    OmitType(CreateSkuPricingDto, ['skuId'] as const)
) { }

