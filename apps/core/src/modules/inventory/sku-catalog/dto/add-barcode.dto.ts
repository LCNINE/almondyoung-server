import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddBarcodeDto {
  @ApiProperty({ description: '바코드 값' })
  @IsString()
  @IsNotEmpty()
  barcode: string;

  @ApiProperty({ description: '포장 단위 — 이 바코드 1회 스캔이 뜻하는 낱개 수량', required: false, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  packingUnit?: number;
}
