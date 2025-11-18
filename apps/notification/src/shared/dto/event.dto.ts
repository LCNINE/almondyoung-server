// apps/notification/src/shared/dto/event.dto.ts
import { IsString, IsObject, IsOptional, IsArray, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEventDto {
    @ApiProperty({ description: '이벤트 키' })
    @IsString()
    eventKey: string;

    @ApiProperty({ description: '이벤트 이름' })
    @IsString()
    name: string;

    @ApiProperty({ description: '이벤트 설명' })
    @IsString()
    description: string;

    @ApiProperty({ description: '연결된 템플릿 키' })
    @IsString()
    templateKey: string;

    @ApiPropertyOptional({ description: '이벤트 카테고리' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ description: '기본 채널 목록' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    defaultChannels?: string[];

    @ApiPropertyOptional({ description: '이벤트 우선순위' })
    @IsOptional()
    @IsString()
    priority?: string;

    @ApiPropertyOptional({ description: '이벤트 조건' })
    @IsOptional()
    @IsObject()
    conditions?: Record<string, any>;

    @ApiPropertyOptional({ description: '메타데이터' })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

export class UpdateEventDto {
    @ApiPropertyOptional({ description: '이벤트 이름' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ description: '이벤트 설명' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ description: '연결된 템플릿 키' })
    @IsOptional()
    @IsString()
    templateKey?: string;

    @ApiPropertyOptional({ description: '이벤트 카테고리' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ description: '기본 채널 목록' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    defaultChannels?: string[];

    @ApiPropertyOptional({ description: '이벤트 우선순위' })
    @IsOptional()
    @IsString()
    priority?: string;

    @ApiPropertyOptional({ description: '이벤트 조건' })
    @IsOptional()
    @IsObject()
    conditions?: Record<string, any>;

    @ApiPropertyOptional({ description: '활성화 상태' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ description: '메타데이터' })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

export class TriggerEventDto {
    @ApiProperty({ description: '이벤트 키' })
    @IsString()
    eventKey: string;

    @ApiProperty({ description: '사용자 ID' })
    @IsString()
    userId: string;

    @ApiProperty({ description: '이벤트 페이로드' })
    @IsObject()
    payload: Record<string, any>;

    @ApiPropertyOptional({ description: '발송 채널 목록 (지정하지 않으면 기본 채널 사용)' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    channels?: string[];

    @ApiPropertyOptional({ description: '추가 메타데이터' })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

