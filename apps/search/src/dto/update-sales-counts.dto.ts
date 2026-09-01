import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class SalesCountItemDto {
  @ApiProperty({ description: '상품 마스터 ID (색인 문서 ID)' })
  @IsString()
  masterId: string;

  @ApiProperty({ description: '누적 판매 수량' })
  @IsInt()
  @Min(0)
  salesCount: number;
}

export class UpdateSalesCountsDto {
  @ApiProperty({ type: [SalesCountItemDto], description: '한 번에 최대 1000건' })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SalesCountItemDto)
  items: SalesCountItemDto[];
}

export class UpdateSalesCountsResponseDto {
  @ApiProperty({ description: '요청에 담긴 건수' })
  received: number;

  @ApiProperty({ description: '색인에 실제로 반영된 건수 (색인에 없는 상품은 제외)' })
  applied: number;
}
