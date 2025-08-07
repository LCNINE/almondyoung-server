// apps/wms/src/inventory/dto/location-create.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, IsBoolean, IsOptional, IsArray, Min, Max, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BinSettingsDto {
    @ApiProperty({ description: '빈 자동 생성 여부' })
    @IsBoolean()
    autoGenerate: boolean;

    @ApiPropertyOptional({
        description: '표준 빈 범위',
        example: { start: 1, end: 15 }
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => BinRangeDto)
    standardBins?: BinRangeDto;

    @ApiPropertyOptional({
        description: '커스텀 빈 이름들',
        example: ['바닥', '상단', '특수']
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    customBins?: string[];
}

export class BinRangeDto {
    @ApiProperty({ description: '시작 빈 번호', example: 1 })
    @IsInt()
    @Min(1)
    start: number;

    @ApiProperty({ description: '끝 빈 번호', example: 15 })
    @IsInt()
    @Min(1)
    @Max(999)
    end: number;
}

export class CreateColumnDto {
    @ApiProperty({ description: '열 이름', example: 'A' })
    @IsString()
    @IsNotEmpty()
    columnName: string;

    @ApiPropertyOptional({ description: '정렬 순서' })
    @IsOptional()
    @IsInt()
    @Min(0)
    displayOrder?: number;
}

export class CreateRackDto {
    @ApiProperty({ description: '열 이름', example: 'A' })
    @IsString()
    @IsNotEmpty()
    columnName: string;

    @ApiProperty({ description: '랙 번호', example: 1 })
    @IsInt()
    @Min(1)
    @Max(999)
    rackNumber: number;

    @ApiProperty({ description: '빈 설정' })
    @ValidateNested()
    @Type(() => BinSettingsDto)
    binSettings: BinSettingsDto;

    @ApiPropertyOptional({ description: '물리적 너비 (cm)' })
    @IsOptional()
    @IsInt()
    @Min(1)
    physicalWidth?: number;

    @ApiPropertyOptional({ description: '물리적 높이 (cm)' })
    @IsOptional()
    @IsInt()
    @Min(1)
    physicalHeight?: number;

    @ApiPropertyOptional({ description: '메모' })
    @IsOptional()
    @IsString()
    notes?: string;
}

export class CreateZoneLocationDto {
    @ApiProperty({ description: '구역 로케이션 코드', example: '입고기본존' })
    @IsString()
    @IsNotEmpty()
    code: string;

    @ApiPropertyOptional({ description: '표시명' })
    @IsOptional()
    @IsString()
    displayName?: string;

    @ApiPropertyOptional({ description: '용량 제한' })
    @IsOptional()
    @IsInt()
    @Min(0)
    capacityLimit?: number;

    @ApiPropertyOptional({ description: 'FIFO 순위' })
    @IsOptional()
    @IsInt()
    @Min(0)
    fifoRank?: number;

    @ApiPropertyOptional({ description: '유통기한별 분리 보관 여부' })
    @IsOptional()
    @IsBoolean()
    isExpirySeparated?: boolean;

    @ApiPropertyOptional({ description: '메모' })
    @IsOptional()
    @IsString()
    notes?: string;
}

export class AddCustomBinDto {
    @ApiProperty({ description: '열 이름', example: 'A' })
    @IsString()
    @IsNotEmpty()
    columnName: string;

    @ApiProperty({ description: '랙 번호', example: 1 })
    @IsInt()
    @Min(1)
    rackNumber: number;

    @ApiProperty({ description: '커스텀 빈 이름', example: '바닥' })
    @IsString()
    @IsNotEmpty()
    customBinName: string;

    @ApiPropertyOptional({ description: '표시명' })
    @IsOptional()
    @IsString()
    displayName?: string;

    @ApiPropertyOptional({ description: '용량 제한' })
    @IsOptional()
    @IsInt()
    @Min(0)
    capacityLimit?: number;

    @ApiPropertyOptional({ description: '메모' })
    @IsOptional()
    @IsString()
    notes?: string;
}

export class LocationCreateResultDto {
    @ApiProperty({ description: '생성 성공 여부' })
    success: boolean;

    @ApiProperty({ description: '생성된 로케이션 수' })
    createdCount: number;

    @ApiPropertyOptional({ description: '에러 메시지들' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    errors?: string[];

    @ApiPropertyOptional({ description: '생성된 로케이션 코드들' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    createdLocationCodes?: string[];
}