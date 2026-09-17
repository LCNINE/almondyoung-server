import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSessionDto {
  @ApiPropertyOptional({ description: '목록에 보여줄 이름. 비우면 첫 발화에서 딴다.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
