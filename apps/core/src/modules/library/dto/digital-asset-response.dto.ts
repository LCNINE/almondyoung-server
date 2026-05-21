import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DigitalAssetFileVersionDto {
  @ApiProperty() id: string;
  @ApiProperty() assetId: string;
  @ApiProperty() version: number;
  @ApiProperty() fileId: string;
  @ApiPropertyOptional() releaseNote?: string | null;
  @ApiProperty() releasedAt: Date;
  @ApiPropertyOptional() releasedBy?: string | null;
}

export class DigitalAssetResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() mimeType?: string | null;
  @ApiPropertyOptional() thumbnailUrl?: string | null;
  @ApiPropertyOptional() currentFileVersionId?: string | null;
  @ApiPropertyOptional({ type: () => DigitalAssetFileVersionDto })
  currentFileVersion?: DigitalAssetFileVersionDto | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class DigitalAssetListResponseDto {
  @ApiProperty({ type: () => [DigitalAssetResponseDto] }) data: DigitalAssetResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
