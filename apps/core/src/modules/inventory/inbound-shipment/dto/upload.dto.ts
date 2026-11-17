import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
  registerDecorator,
} from 'class-validator';

function IsCellValue() {
  return function register(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isCellValue',
      target: target.constructor,
      propertyName,
      validator: {
        validate: (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
        defaultMessage: () => 'value 는 문자열·숫자·불리언·null 이어야 합니다.',
      },
    });
  };
}

export class ListCellDto {
  @ApiProperty() @IsString() @MaxLength(2000) text: string;

  @ApiProperty({ nullable: true, oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] })
  @IsCellValue()
  value: string | number | boolean | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) formula?: string;
}

export class ListRowDto {
  @ApiProperty() @IsInt() @Min(1) rowNumber: number;
  @ApiProperty({ type: [ListCellDto] })
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => ListCellDto)
  cells: ListCellDto[];
}

export class UploadInboundShipmentDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expectedArrival?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceFileId?: string;
  @ApiProperty() @IsString() @MaxLength(255) sourceFileName: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  header: string[];

  // 빈 줄 포함 상한 — 진짜 행 상한(2,000)은 파서가 건다
  @ApiProperty({ type: [ListRowDto] })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ListRowDto)
  rows: ListRowDto[];
}
