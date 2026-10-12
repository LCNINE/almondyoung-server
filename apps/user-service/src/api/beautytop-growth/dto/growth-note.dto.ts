import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const GROWTH_ACTIONS = ['MENU_CLARITY', 'SHOWCASE', 'PRICE_CHANGE'] as const;

export class GrowthNoteTargetDto {
  @ApiProperty({ enum: ['SHOP', 'PERSON'] })
  @IsIn(['SHOP', 'PERSON'])
  shopKind: 'SHOP' | 'PERSON';

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  shopId: number;
}

export class RecordGrowthNoteDto extends GrowthNoteTargetDto {
  @ApiProperty({ enum: GROWTH_ACTIONS })
  @IsIn(GROWTH_ACTIONS)
  action: (typeof GROWTH_ACTIONS)[number];

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  memo?: string;
}
