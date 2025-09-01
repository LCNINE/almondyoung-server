import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { statusEnum } from '../../../../../database/drizzle/schema';

class DateRangeDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startRange: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endRange: Date;
}

type BusinessLicenseStatus = (typeof statusEnum.enumValues)[number];

// 검색
class SearchQueryDto {
  @ApiProperty({
    description: '사업자 등록 번호',
    type: String,
    required: false,
  })
  @IsString({ message: '사업자 등록 번호는 문자열이어야 합니다.' })
  @IsOptional()
  businessNumber?: string;

  @ApiProperty({
    description: '대표자 이름',
    type: String,
    required: false,
  })
  @IsString({ message: '대표자 이름는 문자열이어야 합니다.' })
  @IsOptional()
  representativeName?: string;

  @ApiProperty({
    description: '사업자 등록 정보 ID',
    type: String,
    required: false,
  })
  @IsString({ message: '사업자 등록 정보 ID는 문자열이어야 합니다.' })
  @IsOptional()
  id?: string;
}

export class BusinessLicenseQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: '최소 페이지는 1이어야 합니다.' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10, { message: '페이지당 최소 10개의 항목을 조회할 수 있습니다.' })
  @Max(30, { message: '페이지당 최대 30개의 항목을 조회할 수 있습니다.' })
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: SearchQueryDto;

  // 정렬
  @IsOptional()
  @IsIn(['createdAt', 'verifiedAt', 'updatedAt'])
  sortBy: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'], {
    message: '정렬 순서는 asc 또는 desc 이어야 합니다.',
  })
  sortOrder: 'asc' | 'desc' = 'desc';

  @ApiProperty({
    description: '상점이 있는 사업자 등록 정보',
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasShopId?: boolean;

  @ApiProperty({
    description: '상태 필터 (여러 개 선택 가능)',
    type: [String],
    enum: statusEnum.enumValues,
    required: false,
    example: ['approved', 'rejected'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(statusEnum.enumValues, { each: true })
  @Transform(({ value }) => {
    // 단일 값이 들어와도 배열로 변환
    if (typeof value === 'string') return [value];
    return value;
  })
  status?: BusinessLicenseStatus[];

  @ApiProperty({
    description: '날짜 범위',
    type: DateRangeDto,
    required: false,
    example: { start: '2024-12-01', end: '2024-12-31' },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DateRangeDto)
  Daterange?: DateRangeDto;

  @ApiProperty({
    description: '검증 파일 존재 여부',
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasVerificationFile?: boolean;
}
