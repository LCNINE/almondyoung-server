import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FIELD_CAPTURE_BARCODE_STATUSES,
  FIELD_CAPTURE_LIST_WHO,
  FieldCaptureBarcodeStatus,
  FieldCaptureListWho,
} from '../sku-field-capture.rules';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class FieldCaptureCompletionDto {
  @ApiProperty({ enum: FIELD_CAPTURE_BARCODE_STATUSES })
  barcodeStatus!: FieldCaptureBarcodeStatus;

  @ApiProperty()
  lastWorkerLabel!: string;

  @ApiProperty({ description: 'ISO 8601' })
  lastCompletedAt!: string;
}

export class FieldCaptureSkuSummaryDto {
  @ApiProperty() skuId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty({ type: () => FieldCaptureCompletionDto, nullable: true }) completion!: FieldCaptureCompletionDto | null;
}

export class ShelfPositionDto {
  @ApiProperty() positionCode!: string;
  @ApiProperty({ type: () => [FieldCaptureSkuSummaryDto] }) skus!: FieldCaptureSkuSummaryDto[];
}

export class ReferencePhotoDto {
  @ApiProperty() id!: string;
  @ApiProperty() fileId!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() takenByLabel!: string;
  @ApiProperty({ description: 'ISO 8601' }) createdAt!: string;
}

export class BarcodeOwnerDto {
  @ApiProperty() skuId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class FieldCaptureDetailCompletionDto extends FieldCaptureCompletionDto {
  @ApiProperty({ type: String, nullable: true }) scannedBarcode!: string | null;
  @ApiProperty({ type: () => BarcodeOwnerDto, nullable: true }) barcodeConflict!: BarcodeOwnerDto | null;
  @ApiProperty() allFacesConfirmed!: boolean;
}

export class FieldCaptureDetailDto {
  @ApiProperty() skuId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) positionCode!: string | null;
  @ApiProperty({ type: Number, nullable: true }) packageWidthMm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) packageLengthMm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) packageHeightMm!: number | null;
  @ApiProperty({ type: [String] }) barcodes!: string[];
  @ApiProperty({ type: () => [ReferencePhotoDto] }) photos!: ReferencePhotoDto[];
  @ApiPropertyOptional({ type: () => FieldCaptureDetailCompletionDto, nullable: true })
  completion!: FieldCaptureDetailCompletionDto | null;
}

export class WorkerProgressDto {
  @ApiProperty() workerId!: string;
  @ApiProperty() workerLabel!: string;
  @ApiProperty() today!: number;
  @ApiProperty() total!: number;
}

export class FieldCaptureProgressDto {
  @ApiProperty() remainingSkus!: number;
  @ApiProperty() completedSkus!: number;
  @ApiProperty() stickerNeededSkus!: number;
  @ApiProperty() barcodeConflictSkus!: number;
  @ApiProperty({ type: () => [WorkerProgressDto] }) workers!: WorkerProgressDto[];
}

export class MyTodayDto {
  @ApiProperty() today!: number;
}

export class MyCaptureItemDto {
  @ApiProperty() skuId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) positionCode!: string | null;
  @ApiProperty({ description: 'mine 은 내가, all 은 누군가 마지막으로 완료한 시각. ISO 8601' }) completedAt!: string;
  @ApiProperty({ description: '현재 완료의 마지막 완료 시각, ISO 8601' }) lastCompletedAt!: string;
  @ApiProperty() lastWorkerLabel!: string;
  @ApiProperty({ type: Number, nullable: true }) packageWidthMm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) packageLengthMm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) packageHeightMm!: number | null;
  @ApiProperty({ enum: FIELD_CAPTURE_BARCODE_STATUSES })
  barcodeStatus!: FieldCaptureBarcodeStatus;
  @ApiProperty({ description: '마지막 완료자가 나일 때만 완료를 취소할 수 있다' }) canCancel!: boolean;
}

export class FieldCaptureListQueryDto {
  @ApiPropertyOptional({ enum: FIELD_CAPTURE_LIST_WHO, default: 'mine' })
  @IsOptional()
  @IsIn(FIELD_CAPTURE_LIST_WHO)
  who?: FieldCaptureListWho;

  @ApiPropertyOptional({ description: '이 날부터(KST, YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: '이 날까지(KST, YYYY-MM-DD, 포함)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ description: '상품명·코드·선반 부분일치' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class MyCaptureItemsDto {
  @ApiProperty({ type: () => [MyCaptureItemDto] }) items!: MyCaptureItemDto[];
}
