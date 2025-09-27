import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSkuDto } from './create-sku.dto';

export class UpdateSkuDto extends PartialType(
    OmitType(CreateSkuDto, ['source', 'productName', 'variantName'] as const)
) { }