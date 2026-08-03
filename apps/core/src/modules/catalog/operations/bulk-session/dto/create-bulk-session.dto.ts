import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBulkSessionDto {
  @ApiPropertyOptional({ description: '세션 이름. 비우면 업로드 파일명이 들어간다.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
