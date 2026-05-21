import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SetVariantAssetLinksDto {
  @ApiProperty({ type: [String], description: '이 variant 에 매칭할 asset id 의 완전 집합 (replace 의미)' })
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  assetIds: string[];
}

export class VariantAssetLinkDto {
  @ApiProperty() variantId: string;
  @ApiProperty() assetId: string;
  @ApiProperty() createdAt: Date;
}
