import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDigitalAssetDto {
  @ApiPropertyOptional({ description: '자산 이름', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'MIME 타입', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
}
