import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SelectedOptionDto {
  @ApiProperty({ description: '옵션 이름' })
  optionName: string;

  @ApiProperty({ description: '선택된 옵션 값' })
  optionValue: string;
}

export class VariantSkuLookupDto {
  @ApiProperty({
    description: '선택된 옵션 목록',
    type: [SelectedOptionDto],
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedOptionDto)
  @IsOptional()
  selectedOptions?: SelectedOptionDto[];
}
