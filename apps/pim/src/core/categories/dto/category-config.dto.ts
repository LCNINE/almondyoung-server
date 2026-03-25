import { IsBoolean, IsOptional, IsString, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class MenuPositionsDto {
  @ApiProperty({
    description: '좌측 메뉴에 표시 여부',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  leftSide?: boolean;

  @ApiProperty({
    description: '상단 메뉴에 표시 여부',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  topMenu?: boolean;

  @ApiProperty({
    description: '푸터 메뉴에 표시 여부',
    required: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  footerMenu?: boolean;
}

export class UpdateDisplaySettingsDto {
  @ApiProperty({
    description: '메인 카테고리에 표시 여부',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  showOnMainCategory?: boolean;

  @ApiProperty({
    description: 'PC와 모바일 모두 표시',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  pcAndMobile?: boolean;

  @ApiProperty({
    description: '모바일 전용 표시',
    required: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  mobileOnly?: boolean;

  @ApiProperty({
    description: '상품 표시 순서',
    enum: ['asc', 'desc'],
    required: false,
    example: 'asc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  productDisplayOrder?: 'asc' | 'desc';

  @ApiProperty({
    description: '기본 정렬 필드',
    required: false,
    example: 'createdAt',
  })
  @IsOptional()
  @IsString()
  defaultSortField?: string;

  @ApiProperty({
    description: '메뉴 위치 설정',
    type: MenuPositionsDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MenuPositionsDto)
  menuPositions?: MenuPositionsDto;
}

export class UpdateSeoConfigDto {
  @ApiProperty({
    description: '브라우저 제목',
    required: false,
    example: '뷰티 제품 - 알몬드영',
  })
  @IsOptional()
  @IsString()
  browserTitle?: string;

  @ApiProperty({
    description: 'Meta 작성자',
    required: false,
    example: '알몬드영',
  })
  @IsOptional()
  @IsString()
  metaAuthor?: string;

  @ApiProperty({
    description: 'Meta 설명',
    required: false,
    example: '최고급 뷰티 제품을 만나보세요',
  })
  @IsOptional()
  @IsString()
  metaDescription?: string;

  @ApiProperty({
    description: 'Meta 키워드 배열',
    type: [String],
    required: false,
    example: ['뷰티', '화장품', '스킨케어'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metaKeywords?: string[];

  @ApiProperty({
    description: '검색 엔진에 노출 여부',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  showInSearchEngines?: boolean;
}

export class UpdateTemplateConfigDto {
  @ApiProperty({
    description: '템플릿 타입',
    enum: ['default', 'custom'],
    required: false,
    example: 'default',
  })
  @IsOptional()
  @IsEnum(['default', 'custom'])
  templateType?: 'default' | 'custom';

  @ApiProperty({
    description: '커스텀 HTML 컨텐츠',
    required: false,
    example: '<div class="custom-category">Custom content</div>',
  })
  @IsOptional()
  @IsString()
  htmlContent?: string;

  @ApiProperty({
    description: '커스텀 CSS',
    required: false,
    example: '.custom-category { padding: 20px; }',
  })
  @IsOptional()
  @IsString()
  customCss?: string;
}
