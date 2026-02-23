import { ApiProperty } from '@nestjs/swagger';
import { paymentIntentStatusEnum, paymentLegStatusEnum } from '../../schema';

export class RetryIntentResponseDto {
  @ApiProperty({
    description: 'Intent identifier',
    format: 'uuid',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Resulting intent status after retry',
    enum: paymentIntentStatusEnum.enumValues,
  })
  status!: string;
}

export class RetryLegResponseDto {
  @ApiProperty({
    description: 'Leg identifier',
    format: 'uuid',
  })
  legId!: string;

  @ApiProperty({
    description: 'Resulting leg status after retry',
    enum: paymentLegStatusEnum.enumValues,
  })
  status!: string;

  @ApiProperty({
    description: 'Parent intent identifier',
    format: 'uuid',
  })
  intentId!: string;
}
