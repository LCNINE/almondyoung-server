import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class SimpleOutboundScanDto {
  @IsString()
  @IsNotEmpty()
  barcode: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class ForceSimpleOutboundDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  csCaseId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SimpleOutboundLineProgressDto {
  shipmentLineId: string;
  skuId: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export class SimpleOutboundStateDto {
  shipmentId: string;
  workItemStatus: string;

  @ApiProperty({ enum: ['in_progress', 'shipped'] })
  status: 'in_progress' | 'shipped';

  @ApiPropertyOptional({ nullable: true })
  dispatchAttemptId: string | null;

  @ApiProperty({ type: [SimpleOutboundLineProgressDto] })
  lines: SimpleOutboundLineProgressDto[];
}
