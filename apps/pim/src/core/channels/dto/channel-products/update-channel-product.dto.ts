import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdateChannelProductDto {
  @ApiProperty({ description: '채널별 제품명', maxLength: 255, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ description: '채널에서의 활성 상태', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '채널별 특화 데이터', required: false })
  @IsOptional()
  channelSpecificData?: Record<string, any>;
}

export class OverrideProductNameDto {
  @ApiProperty({ description: '새로운 제품 이름', minLength: 1 })
  @IsString()
  name: string;
}

export class SetChannelProductActiveDto {
  @ApiProperty({ description: '활성 여부' })
  @IsBoolean()
  isActive: boolean;
}
