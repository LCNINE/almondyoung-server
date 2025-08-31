// dto/settlement-run.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SettlementRunDto {
  @ApiPropertyOptional({ description: '정산 시작일 (yyyy-mm-dd)' })
  startDate?: string;

  @ApiPropertyOptional({ description: '정산 종료일 (yyyy-mm-dd)' })
  endDate?: string;
}
