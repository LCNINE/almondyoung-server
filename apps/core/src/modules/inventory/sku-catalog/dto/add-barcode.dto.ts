import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** packing_unit 은 int4 컬럼이라 상한이 있다. 넘기면 DB 가 22003 을 던지므로 경계에서 막는다. */
const INT4_MAX = 2147483647;

export class AddBarcodeDto {
  @ApiProperty({ description: '바코드 값' })
  @IsString()
  @IsNotEmpty()
  barcode: string;

  @ApiProperty({
    description: '포장 단위 — 이 바코드 1회 스캔이 뜻하는 낱개 수량',
    required: false,
    minimum: 1,
    maximum: INT4_MAX,
  })
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  @IsOptional()
  packingUnit?: number;
}
