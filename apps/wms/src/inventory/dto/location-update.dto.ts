// apps/wms/src/inventory/dto/location-update.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BinRangeDto } from './location-create.dto';

export class UpdateLocationDto {
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

    @ApiPropertyOptional({ description: '활성 상태' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ description: '메모' })
    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateColumnDto {
    @ApiPropertyOptional({ description: '열 이름' })
    @IsOptional()
    @IsString()
    columnName?: string;

    @ApiPropertyOptional({ description: '정렬 순서' })
    @IsOptional()
    @IsInt()
    @Min(0)
    displayOrder?: number;

    @ApiPropertyOptional({ description: '활성 상태' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateRackDto {
    @ApiPropertyOptional({ description: '기본 빈 시작 번호' })
    @IsOptional()
    @IsInt()
    @Min(1)
    defaultBinStart?: number;

    @ApiPropertyOptional({ description: '기본 빈 끝 번호' })
    @IsOptional()
    @IsInt()
    @Min(1)
    defaultBinEnd?: number;

    @ApiPropertyOptional({ description: '빈 자동 생성 여부' })
    @IsOptional()
    @IsBoolean()
    autoGenerateBins?: boolean;

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

    @ApiPropertyOptional({ description: '활성 상태' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class ExtendRackBinsDto {
    @ApiPropertyOptional({
        description: '추가할 표준 빈 범위',
        example: { start: 21, end: 30 }
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => BinRangeDto)
    standardBinRange?: BinRangeDto;

    @ApiPropertyOptional({
        description: '추가할 커스텀 빈 이름들',
        example: ['대형품', '깨지기쉬운물품']
    })
    @IsOptional()
    @IsString({ each: true })
    customBinNames?: string[];
}

export class BatchUpdateLocationDto {
    @ApiPropertyOptional({ description: '업데이트할 로케이션 ID 목록' })
    @IsString({ each: true })
    locationIds: string[];

    @ApiPropertyOptional({ description: '일괄 업데이트할 필드들' })
    @ValidateNested()
    @Type(() => UpdateLocationDto)
    updates: UpdateLocationDto;
}

export class LocationUpdateResultDto {
    @ApiPropertyOptional({ description: '업데이트 성공 여부' })
    success: boolean;

    @ApiPropertyOptional({ description: '업데이트된 로케이션 수' })
    updatedCount: number;

    @ApiPropertyOptional({ description: '에러 메시지들' })
    @IsOptional()
    @IsString({ each: true })
    errors?: string[];

    @ApiPropertyOptional({ description: '업데이트된 로케이션 ID들' })
    @IsOptional()
    @IsString({ each: true })
    updatedLocationIds?: string[];
}