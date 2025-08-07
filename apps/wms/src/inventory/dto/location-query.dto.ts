// apps/wms/src/inventory/dto/location-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsInt, IsEnum, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { LocationType } from '../types';

export class LocationQueryDto {
    @ApiPropertyOptional({
        description: '로케이션 타입 필터',
        enum: ['standard', 'zone'],
        example: 'standard'
    })
    @IsOptional()
    @IsEnum(['standard', 'zone'])
    type?: LocationType;

    @ApiPropertyOptional({ description: '열 이름 필터', example: 'A' })
    @IsOptional()
    @IsString()
    columnName?: string;

    @ApiPropertyOptional({ description: '랙 번호 필터', example: 1 })
    @IsOptional()
    @Transform(({ value }) => parseInt(value))
    @IsInt()
    @Min(1)
    rackNumber?: number;

    @ApiPropertyOptional({ description: '활성 상태 필터' })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ description: '검색어 (코드나 이름)', example: 'A-01' })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional({ 
        description: '페이지 번호 (1부터 시작)', 
        example: 1,
        default: 1 
    })
    @IsOptional()
    @Transform(({ value }) => parseInt(value) || 1)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ 
        description: '페이지당 항목 수', 
        example: 20,
        default: 20 
    })
    @IsOptional()
    @Transform(({ value }) => parseInt(value) || 20)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @ApiPropertyOptional({
        description: '정렬 필드',
        enum: ['code', 'createdAt', 'columnName', 'rackNumber'],
        example: 'code'
    })
    @IsOptional()
    @IsEnum(['code', 'createdAt', 'columnName', 'rackNumber'])
    sortBy?: 'code' | 'createdAt' | 'columnName' | 'rackNumber' = 'code';

    @ApiPropertyOptional({
        description: '정렬 순서',
        enum: ['asc', 'desc'],
        example: 'asc'
    })
    @IsOptional()
    @IsEnum(['asc', 'desc'])
    sortOrder?: 'asc' | 'desc' = 'asc';
}

export class ColumnQueryDto {
    @ApiPropertyOptional({ description: '활성 상태 필터' })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isActive?: boolean;
}

export class RackQueryDto {
    @ApiPropertyOptional({ description: '열 이름 필터', example: 'A' })
    @IsOptional()
    @IsString()
    columnName?: string;

    @ApiPropertyOptional({ description: '활성 상태 필터' })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ description: '자동 생성 빈 필터' })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    autoGenerateBins?: boolean;
}

export class LocationListResponseDto {
    @ApiPropertyOptional({ description: '로케이션 목록' })
    items: any[]; // LocationResponseDto[] 타입이지만 순환 참조 방지를 위해 any 사용

    @ApiPropertyOptional({ description: '총 항목 수' })
    total: number;

    @ApiPropertyOptional({ description: '현재 페이지' })
    page: number;

    @ApiPropertyOptional({ description: '페이지당 항목 수' })
    limit: number;

    @ApiPropertyOptional({ description: '총 페이지 수' })
    totalPages: number;

    @ApiPropertyOptional({ description: '다음 페이지 존재 여부' })
    hasNext: boolean;

    @ApiPropertyOptional({ description: '이전 페이지 존재 여부' })
    hasPrev: boolean;
}