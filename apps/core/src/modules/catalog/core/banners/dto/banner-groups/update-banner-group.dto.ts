import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsBoolean, IsOptional, Min, MaxLength } from 'class-validator';

export class UpdateBannerGroupDto {
  @ApiProperty({ description: '배너 그룹 제목', example: '메인 배너', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ description: '배너 그룹 카테고리', example: 'main', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ description: 'PC 이미지 너비(px)', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  pcWidth?: number;

  @ApiProperty({ description: 'PC 이미지 높이(px)', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  pcHeight?: number;

  @ApiProperty({ description: '모바일 이미지 너비(px)', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  mobileWidth?: number;

  @ApiProperty({ description: '모바일 이미지 높이(px)', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  mobileHeight?: number;

  @ApiProperty({ description: '설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

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
