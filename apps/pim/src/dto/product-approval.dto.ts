import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class SubmitForApprovalDto {
  @ApiProperty({ description: 'User ID who submits for approval' })
  @IsString()
  userId: string;
}

export class ApproveProductDto {
  @ApiProperty({ description: 'User ID who approves the product' })
  @IsString()
  userId: string;

  @ApiProperty({ 
    description: 'Optional approval comment',
    required: false,
  })
  @IsString()
  @IsOptional()
  comment?: string;
}

export class RejectProductDto {
  @ApiProperty({ description: 'User ID who rejects the product' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Reason for rejection' })
  @IsString()
  reason: string;
}

