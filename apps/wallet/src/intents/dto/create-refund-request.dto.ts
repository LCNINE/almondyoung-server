import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefundAllocationDto {
  @ApiProperty({
    description: 'Leg identifier',
    format: 'uuid',
    example: 'f3d8f7ab-54f4-4cf4-b8f9-cb8df2c30001',
  })
  @IsUUID()
  legId!: string;

  @ApiProperty({
    description: 'Allocation amount for this leg (minor units)',
    minimum: 1,
    example: 3000,
  })
  @IsInt()
  @Min(1)
  amount!: number;
}

export class CreateRefundRequestDto {
  @ApiProperty({
    description: 'Requested refund amount (minor units)',
    minimum: 1,
    example: 5000,
  })
  @IsInt()
  @Min(1)
  refundAmount!: number;

  @ApiProperty({
    description: 'Refund allocations by leg',
    type: () => [RefundAllocationDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RefundAllocationDto)
  allocation!: RefundAllocationDto[];

  @ApiProperty({
    description: 'Reason code',
    example: 'CUSTOMER_REQUEST',
  })
  @IsString()
  reasonCode!: string;

  @ApiPropertyOptional({
    description: 'Optional reason message',
    example: 'Customer requested partial refund due to delay',
  })
  @IsOptional()
  @IsString()
  reasonMessage?: string;
}
