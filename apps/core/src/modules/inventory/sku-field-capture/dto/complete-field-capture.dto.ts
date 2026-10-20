import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { FIELD_CAPTURE_BARCODE_STATUSES, FieldCaptureBarcodeStatus, MAX_PACKAGE_MM } from '../sku-field-capture.rules';

export class CompleteFieldCaptureDto {
  @ApiProperty({ description: '포장 가로(mm)', minimum: 1, maximum: MAX_PACKAGE_MM })
  @IsInt()
  @Min(1)
  @Max(MAX_PACKAGE_MM)
  packageWidthMm!: number;

  @ApiProperty({ description: '포장 세로(mm)', minimum: 1, maximum: MAX_PACKAGE_MM })
  @IsInt()
  @Min(1)
  @Max(MAX_PACKAGE_MM)
  packageLengthMm!: number;

  @ApiProperty({ description: '포장 높이(mm)', minimum: 1, maximum: MAX_PACKAGE_MM })
  @IsInt()
  @Min(1)
  @Max(MAX_PACKAGE_MM)
  packageHeightMm!: number;

  @ApiProperty({ enum: FIELD_CAPTURE_BARCODE_STATUSES })
  @IsIn(FIELD_CAPTURE_BARCODE_STATUSES)
  barcodeStatus!: FieldCaptureBarcodeStatus;

  @ApiPropertyOptional({ description: 'barcodeStatus 가 scanned 일 때만 필수' })
  @ValidateIf((o: CompleteFieldCaptureDto) => o.barcodeStatus === 'scanned')
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  scannedBarcode?: string;

  @ApiProperty({ description: '모든 면 촬영 확인. true 만 허용', enum: [true] })
  @IsIn([true])
  allFacesConfirmed!: true;
}
