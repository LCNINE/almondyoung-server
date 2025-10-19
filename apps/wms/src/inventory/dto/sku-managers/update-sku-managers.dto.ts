import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSkuManagersDto } from './create-sku-managers.dto';

export class UpdateSkuManagersDto extends PartialType(
    OmitType(CreateSkuManagersDto, ['skuId'] as const)
) { }

