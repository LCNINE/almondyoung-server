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

export class RefundAllocationDto {
  @IsUUID()
  legId!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}

export class CreateRefundRequestDto {
  @IsInt()
  @Min(1)
  refundAmount!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RefundAllocationDto)
  allocation!: RefundAllocationDto[];

  @IsString()
  reasonCode!: string;

  @IsOptional()
  @IsString()
  reasonMessage?: string;
}
