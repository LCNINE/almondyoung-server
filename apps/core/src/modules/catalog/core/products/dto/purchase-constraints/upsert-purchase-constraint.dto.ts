import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpsertPurchaseConstraintDto {
  @ApiProperty({ description: '멤버십 회원만 구매 가능한지 여부' })
  @IsBoolean()
  requiresMembership: boolean;

  @ApiProperty({
    description: '회원별 lifetime 구매 가능 수량. null이면 수량 제한 없음',
    required: false,
    nullable: true,
    minimum: 1,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(1)
  lifetimeQuantityLimit?: number | null;
}
