import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsBoolean, IsOptional, Min, MaxLength } from 'class-validator';

export class CreateBannerGroupDto {
  @ApiProperty({ description: '배너 그룹 코드 (고유)', example: 'AY2312' })
  @IsString()
  @MaxLength(100)
  code: string;

  @ApiProperty({ description: '배너 그룹 제목', example: '메인 배너' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '배너 그룹 카테고리', example: 'main' })
  @IsString()
  @MaxLength(100)
  category: string;

  @ApiProperty({ description: 'PC 이미지 너비(px)', example: 1920, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  pcWidth?: number;

  @ApiProperty({ description: 'PC 이미지 높이(px)', example: 600, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  pcHeight?: number;

  @ApiProperty({ description: '모바일 이미지 너비(px)', example: 750, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  mobileWidth?: number;

  @ApiProperty({ description: '모바일 이미지 높이(px)', example: 500, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  mobileHeight?: number;

  @ApiProperty({ description: '설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '활성화 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ description: '생성자 ID', required: false })
  @IsOptional()
  @IsString()
  createdBy?: string;
}

