import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class PublishProductVersionDto {
  @ApiPropertyOptional({ enum: ['bulk_import'], description: '대량 작업의 동기화를 후순위로 처리한다.' })
  @IsOptional()
  @IsIn(['bulk_import'])
  origin?: 'bulk_import';

  @ApiPropertyOptional({ format: 'uuid', description: '조회한 활성 버전과 다르면 발행하지 않는다.' })
  @IsOptional()
  @IsUUID()
  expectedActiveVersionId?: string;
}
