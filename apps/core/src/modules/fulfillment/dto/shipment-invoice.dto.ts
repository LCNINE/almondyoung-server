import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class IssueShipmentInvoiceDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(['goodsflow', 'hanjin'])
  provider: 'goodsflow' | 'hanjin';

  @IsString()
  @IsNotEmpty()
  carrierCode: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsUUID()
  @IsOptional()
  csCaseId?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class VoidShipmentInvoiceDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsUUID()
  @IsOptional()
  resumeOperationId?: string;

  @IsUUID()
  @IsOptional()
  csCaseId?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export type ShipmentInvoiceActor = { id: string; roles: string[] };

export class InvoiceOperationResponseDto {
  @ApiProperty()
  operationId: string;

  @ApiProperty()
  shipmentId: string;

  @ApiPropertyOptional({ nullable: true })
  invoiceId: string | null;

  @ApiProperty({ enum: ['issue', 'void'] })
  operation: 'issue' | 'void';

  @ApiProperty({ enum: ['pending', 'in_progress', 'succeeded', 'failed', 'recovery_required'] })
  status: 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'recovery_required';

  @ApiProperty()
  attempts: number;

  @ApiPropertyOptional({ nullable: true })
  resumeOperationId: string | null;

  @ApiPropertyOptional({ nullable: true })
  nextRetryAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  lastError: string | null;
}
