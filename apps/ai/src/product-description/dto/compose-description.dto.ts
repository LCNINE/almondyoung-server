import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ExtractResult } from '@packages/product-description';

export class ComposeDescriptionDto {
  @ApiProperty({
    description: '추출 단계가 돌려준 결과. 여러 청크를 합친 것이다.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  result: ExtractResult;

  @ApiPropertyOptional({ description: '상품명' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @ApiPropertyOptional({ description: '어떤 톤·무엇을 강조할지 같은 추가 지시' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hint?: string;

  @ApiPropertyOptional({
    description: '어드민이 고른 양식 ID. 없거나 못 찾으면 코드 기본 프롬프트를 쓴다.',
  })
  @IsOptional()
  @IsString()
  presetId?: string;
}
