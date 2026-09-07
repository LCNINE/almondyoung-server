import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReplayWithdrawnRequestDto {
  @ApiProperty({ description: 'true 면 대상 건수와 id 만 돌려주고 발행하지 않는다. 실행 전에 반드시 한 번 본다.' })
  @IsBoolean()
  dryRun: boolean;

  @ApiProperty({ required: false, description: '한 번에 처리할 최대 건수 (기본 200, 최대 1000)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiProperty({ required: false, description: '이전 응답의 lastUserId. 그 다음부터 이어서 처리한다.' })
  @IsOptional()
  @IsUUID('4')
  afterUserId?: string;
}
