import { IsNotEmpty, IsString, IsEnum, IsOptional, IsInt, Min, Max, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class GenerateBarcodeImageDto {
  @ApiProperty({
    description: 'Barcode value to generate',
    example: 'TEST-BARCODE-123',
  })
  @IsString()
  @IsNotEmpty()
  value: string;

  @ApiProperty({
    description: 'Barcode format',
    enum: ['CODE128', 'QR', 'EAN13', 'CODE39'],
    default: 'CODE128',
    required: false,
  })
  @IsEnum(['CODE128', 'QR', 'EAN13', 'CODE39'])
  @IsOptional()
  format?: 'CODE128' | 'QR' | 'EAN13' | 'CODE39';

  @ApiProperty({
    description: 'Scale factor for barcode size',
    minimum: 1,
    maximum: 10,
    default: 3,
    required: false,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  scale?: number;

  @ApiProperty({
    description: 'Height of barcode in modules',
    minimum: 5,
    maximum: 50,
    default: 10,
    required: false,
  })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(50)
  @IsOptional()
  height?: number;

  @ApiProperty({
    description: 'Include human-readable text below barcode',
    default: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  includetext?: boolean;
}

export class GenerateSkuBarcodeDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({
    description: 'Barcode format',
    enum: ['CODE128', 'QR'],
    default: 'CODE128',
    required: false,
  })
  @IsEnum(['CODE128', 'QR'])
  @IsOptional()
  format?: 'CODE128' | 'QR';
}

export class GenerateLocationBarcodeDto {
  @ApiProperty({
    description: 'Location code',
    example: 'A-01-02',
  })
  @IsString()
  @IsNotEmpty()
  locationCode: string;

  @ApiProperty({
    description: 'Barcode format',
    enum: ['CODE128', 'QR'],
    default: 'CODE128',
    required: false,
  })
  @IsEnum(['CODE128', 'QR'])
  @IsOptional()
  format?: 'CODE128' | 'QR';
}

export class GenerateFulfillmentOrderBarcodeDto {
  @ApiProperty({
    description: 'Fulfillment Order ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  fulfillmentOrderId: string;

  @ApiProperty({
    description: 'Barcode format',
    enum: ['CODE128', 'QR'],
    default: 'CODE128',
    required: false,
  })
  @IsEnum(['CODE128', 'QR'])
  @IsOptional()
  format?: 'CODE128' | 'QR';
}

export class BarcodeImageResponseDto {
  @ApiProperty({
    description: 'Barcode value',
    example: 'SKU-123e4567-e89b-12d3',
  })
  barcodeValue: string;

  @ApiProperty({
    description: 'Barcode format',
    example: 'CODE128',
  })
  format: string;

  @ApiProperty({
    description: 'Base64 encoded PNG image',
    example: 'iVBORw0KGgoAAAANSUhEUgAA...',
  })
  imageBase64: string;
}
