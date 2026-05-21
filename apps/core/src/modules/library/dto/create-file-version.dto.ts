import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateFileVersionDto {
  @ApiProperty({ description: 'file-service 의 새 파일 ID' })
  @IsUUID()
  fileId: string;

  @ApiPropertyOptional({ description: '릴리즈 노트 (운영자가 어떤 변경인지 메모)' })
  @IsOptional()
  @IsString()
  releaseNote?: string;
}
