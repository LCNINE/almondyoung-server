import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

import { OwnershipAssetSummaryDto } from './ownership-response.dto';

export const ADMIN_OWNERSHIP_STATUSES = ['all', 'active', 'revoked'] as const;
export type AdminOwnershipStatus = (typeof ADMIN_OWNERSHIP_STATUSES)[number];

export class AdminOwnershipResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() customerId: string;
  @ApiProperty() assetId: string;
  @ApiProperty() salesOrderId: string;
  /** Medusa 주문 ID. 어드민 주문내역(Medusa 기준)과 매칭하려면 이 값이 필요하다. 목록 조회에서만 채워진다. */
  @ApiPropertyOptional({ nullable: true })
  channelOrderId?: string | null;
  @ApiProperty() grantedAt: Date;
  @ApiPropertyOptional({ type: Date, nullable: true })
  exercisedAt?: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true })
  revokedAt?: Date | null;
  @ApiPropertyOptional({ nullable: true })
  revokedReason?: string | null;

  @ApiProperty({ type: () => OwnershipAssetSummaryDto })
  asset: OwnershipAssetSummaryDto;
}

export class AdminOwnershipListResponseDto {
  @ApiProperty({ type: () => [AdminOwnershipResponseDto] })
  data: AdminOwnershipResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() skip: number;
  @ApiProperty() take: number;
}

export class GrantOwnershipDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty() @IsUUID() assetId: string;
  @ApiProperty() @IsUUID() salesOrderId: string;
}

export class RevokeOwnershipDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
