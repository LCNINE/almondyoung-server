import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsBoolean, IsOptional, IsArray, IsDateString, MaxLength } from 'class-validator';

export class UpdateBannerDto {
  @ApiProperty({ description: '배너 제목', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ description: '배너 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'PC 이미지 URL', required: false })
  @IsOptional()
  @IsString()
  pcImageUrl?: string;

  @ApiProperty({ description: '모바일 이미지 URL', required: false })
  @IsOptional()
  @IsString()
  mobileImageUrl?: string;

  @ApiProperty({ description: '클릭 시 이동할 URL', required: false })
  @IsOptional()
  @IsString()
  linkUrl?: string;

  @ApiProperty({
    description: '연결된 제품 마스터 ID 배열',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  linkedProductMasterIds?: string[];

  @ApiProperty({ description: '게시 시작 일시', required: false })
  @IsOptional()
  @IsDateString()
  displayStartAt?: string;

  @ApiProperty({ description: '게시 종료 일시', required: false })
  @IsOptional()
  @IsDateString()
  displayEndAt?: string;

  @ApiProperty({ description: '활성화 여부', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ description: '수정자 ID', required: false })
  @IsOptional()
  @IsString()
  updatedBy?: string;
}

