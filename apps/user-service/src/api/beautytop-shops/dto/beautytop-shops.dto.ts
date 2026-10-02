import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const SHOP_KINDS = ['SHOP', 'PERSON'] as const;

export class BeautytopShopDto {
  @ApiProperty({ enum: SHOP_KINDS })
  @IsIn(SHOP_KINDS)
  shopKind: (typeof SHOP_KINDS)[number];

  @ApiProperty({ description: '뷰티탑 원천의 샵 id' })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  shopId: number;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sido?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  gugun?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}

export class SetMyShopDto {
  @ApiPropertyOptional({ type: BeautytopShopDto, nullable: true, description: 'null 이면 «내 샵»을 지운다' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BeautytopShopDto)
  shop: BeautytopShopDto | null;
}
