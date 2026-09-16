import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional } from 'class-validator';

export class ListSessionsQueryDto {
  @ApiPropertyOptional({ description: '가져올 개수 (1~100, 기본 20)', example: '20' })
  @IsOptional()
  @IsNumberString()
  limit?: string;
}
