import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FIELD_CAPTURE_BARCODE_STATUSES, FieldCaptureBarcodeStatus } from '../sku-field-capture.rules';

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
