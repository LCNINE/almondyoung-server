import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export class ChangePricingStrategyDto {
  @ApiProperty({ 
    description: '새로운 가격 전략',
    enum: ['option_based', 'variant_based']
  })
  @IsEnum(['option_based', 'variant_based'])
  pricingStrategy: 'option_based' | 'variant_based';

  @ApiProperty({ 
    description: '마이그레이션 데이터 (선택사항)',
    required: false
  })
  @IsOptional()
  migrationData?: any;
}

