import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OwnershipAssetSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() mimeType?: string | null;
  @ApiPropertyOptional() thumbnailUrl?: string | null;
}

export class OwnershipResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() customerId: string;
  @ApiProperty() assetId: string;
  @ApiProperty() salesOrderId: string;
  @ApiProperty() grantedAt: Date;
  @ApiPropertyOptional({ type: Date, nullable: true })
  exercisedAt?: Date | null;

  @ApiProperty({ type: () => OwnershipAssetSummaryDto })
  asset: OwnershipAssetSummaryDto;
}

export class OwnershipListResponseDto {
  @ApiProperty({ type: () => [OwnershipResponseDto] })
  data: OwnershipResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() skip: number;
  @ApiProperty() take: number;
}
