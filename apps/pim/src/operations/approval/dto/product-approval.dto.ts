import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class SubmitForApprovalDto {}

export class ApproveProductDto {
  @ApiProperty({
    description: 'Optional approval comment',
    required: false,
  })
  @IsString()
  @IsOptional()
  comment?: string;
}

export class RejectProductDto {
  @ApiProperty({ description: 'Reason for rejection' })
  @IsString()
  reason: string;
}

