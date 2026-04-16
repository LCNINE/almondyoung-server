import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsBoolean, IsUrl, IsArray } from 'class-validator';

export class CreateChannelProductDto {
  @ApiProperty({ description: '제품 마스터 ID (UUID 형식)' })
  @IsUUID()
  masterId: string;

  @ApiProperty({ description: '판매 채널 ID (UUID 형식)' })
  @IsUUID()
  channelId: string;

  @ApiProperty({ description: '채널별 제품명 (미지정시 마스터명 사용)', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '채널별 제품 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '채널별 제품 이미지 URL 배열', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  images?: string[];

  @ApiProperty({ description: '채널에서의 활성 상태', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '채널별 특화 데이터', required: false })
  @IsOptional()
  channelSpecificData?: Record<string, any>;
}
