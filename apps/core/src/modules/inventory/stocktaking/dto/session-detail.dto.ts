import { ApiProperty } from '@nestjs/swagger';
import type { StocktakingStatus } from './list-sessions-query.dto';

export class StocktakingLineDto {
  @ApiProperty() lineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty({ type: String, nullable: true }) locationId: string | null;
  @ApiProperty({ type: String, nullable: true }) locationCode: string | null;
  @ApiProperty() expectedQuantity: number;
  @ApiProperty({ type: Number, nullable: true, description: '미카운트면 null' })
  countedQuantity: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'counted − expected. 미카운트면 null' })
  variance: number | null;
  @ApiProperty({ type: String, nullable: true }) scannedBarcode: string | null;
  @ApiProperty({ description: 'pending | counted | verified' }) status: string;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
}

export class StocktakingProgressDto {
  @ApiProperty({ description: '세션의 전체 라인 수' }) total: number;
  @ApiProperty({ description: 'countedQuantity 가 채워진 라인 수' }) counted: number;
}

export class StocktakingSessionDetailDto {
  @ApiProperty() id: string;
  @ApiProperty() warehouseId: string;
  @ApiProperty() sessionName: string;
  @ApiProperty({ enum: ['draft', 'in_progress', 'completed', 'cancelled'] })
  status: StocktakingStatus;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) completedAt: Date | null;
  @ApiProperty({ type: StocktakingProgressDto }) progress: StocktakingProgressDto;
  @ApiProperty({ type: [StocktakingLineDto] }) lines: StocktakingLineDto[];
}
