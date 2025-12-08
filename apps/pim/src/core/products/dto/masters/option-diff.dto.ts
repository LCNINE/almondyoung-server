import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class AddOptionValueDto {
  @ApiProperty({ description: '표시명' })
  @IsString()
  displayName: string;

  @ApiProperty({ description: '색상 코드 (예: #FF0000)', required: false })
  @IsOptional()
  @IsString()
  colorCode?: string;

  @ApiProperty({ description: '이미지 URL', required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class AddOptionDto {
  @ApiProperty({ description: '옵션 그룹 표시명' })
  @IsString()
  displayName: string;

  @ApiProperty({ description: '옵션 그룹 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiProperty({ description: '옵션 값 목록', type: [AddOptionValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddOptionValueDto)
  values: AddOptionValueDto[];
}

export class ModifyOptionValueDisplayDto {
  @ApiProperty({ description: '옵션 값 ID' })
  @IsUUID()
  optionValueId: string;

  @ApiProperty({ description: '표시명', required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ description: '색상 코드', required: false })
  @IsOptional()
  @IsString()
  colorCode?: string;

  @ApiProperty({ description: '이미지 URL', required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class ModifyOptionDisplayDto {
  @ApiProperty({ description: '옵션 그룹 ID' })
  @IsUUID()
  optionGroupId: string;

  @ApiProperty({ description: '표시명', required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ description: '설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiProperty({ description: '옵션 값 표시 정보 수정', type: [ModifyOptionValueDisplayDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifyOptionValueDisplayDto)
  values?: ModifyOptionValueDisplayDto[];
}

export class AddOptionValuesDto {
  @ApiProperty({ description: '옵션 그룹 ID' })
  @IsUUID()
  optionGroupId: string;

  @ApiProperty({ description: '추가할 옵션 값 목록', type: [AddOptionValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddOptionValueDto)
  values: AddOptionValueDto[];
}

export class RemoveOptionValuesDto {
  @ApiProperty({ description: '옵션 그룹 ID' })
  @IsUUID()
  optionGroupId: string;

  @ApiProperty({
    description: '삭제할 옵션 값 ID 목록',
    type: [String],
    example: ['01234567-89ab-cdef-0123-456789abcdef']
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  optionValueIds: string[];
}

export class OptionDiffDto {
  @ApiProperty({
    description: '새로 추가할 옵션 그룹',
    type: [AddOptionDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddOptionDto)
  add?: AddOptionDto[];

  @ApiProperty({
    description: '기존 옵션 그룹의 표시 정보 수정',
    type: [ModifyOptionDisplayDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifyOptionDisplayDto)
  modifyDisplay?: ModifyOptionDisplayDto[];

  @ApiProperty({
    description: '기존 옵션 그룹에 새 값 추가',
    type: [AddOptionValuesDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddOptionValuesDto)
  addValues?: AddOptionValuesDto[];

  @ApiProperty({
    description: '기존 옵션 그룹에서 값 제거',
    type: [RemoveOptionValuesDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemoveOptionValuesDto)
  removeValues?: RemoveOptionValuesDto[];

  @ApiProperty({
    description: '제거할 옵션 그룹 ID 목록',
    type: [String],
    required: false
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  remove?: string[];
}

