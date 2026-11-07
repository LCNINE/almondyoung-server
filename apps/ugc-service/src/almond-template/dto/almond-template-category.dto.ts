import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ALMOND_TEMPLATE_CATEGORY_MAX_DESCRIPTION_LENGTH,
  ALMOND_TEMPLATE_CATEGORY_MAX_NAME_LENGTH,
  ALMOND_TEMPLATE_KINDS,
} from '../constants/almond-template.constants';

export class UpsertAlmondTemplateCategoryDto {
  @ApiProperty({ description: '랜딩 카드에 보일 이름', maxLength: ALMOND_TEMPLATE_CATEGORY_MAX_NAME_LENGTH })
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: '이름을 입력해 주세요.' })
  @MaxLength(ALMOND_TEMPLATE_CATEGORY_MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({
    description: '이름 아래 한 줄 설명',
    maxLength: ALMOND_TEMPLATE_CATEGORY_MAX_DESCRIPTION_LENGTH,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(ALMOND_TEMPLATE_CATEGORY_MAX_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiProperty({ description: 'file-service 의 almond-template-image 컨텍스트로 올린 카드 이미지', format: 'uuid' })
  @IsUUID()
  imageFileId: string;

  @ApiProperty({ description: '카드를 누르면 보여 줄 상품 종류', enum: ALMOND_TEMPLATE_KINDS })
  @IsIn(ALMOND_TEMPLATE_KINDS)
  kind: string;

  @ApiProperty({ description: '랜딩에 보일지', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

export class ReorderAlmondTemplateCategoriesDto {
  @ApiProperty({ description: '보일 순서대로 늘어놓은 카테고리 id 전부', type: [String], format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}

export class AlmondTemplateCategoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ format: 'uuid' }) imageFileId: string;
  @ApiProperty({ enum: ALMOND_TEMPLATE_KINDS }) kind: string;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isVisible: boolean;
  @ApiProperty() updatedAt: string;
}
