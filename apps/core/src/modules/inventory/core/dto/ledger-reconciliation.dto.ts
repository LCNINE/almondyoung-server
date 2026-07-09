import { ApiProperty } from '@nestjs/swagger';
import { LedgerDriftSeverity } from '../services/ledger-reconciliation.service';

export class LedgerDriftRowDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '로케이션 ID' })
  locationId: string;

  @ApiProperty({ description: '재고 상태', example: 'ON_HAND' })
  stockState: string;

  @ApiProperty({ description: '이벤트 파생 수량(진실)' })
  derivedQty: number;

  @ApiProperty({ description: '원장 저장 수량' })
  ledgerQty: number;

  @ApiProperty({ description: 'ledgerQty - derivedQty' })
  delta: number;

  @ApiProperty({ description: '심각도', enum: ['CRITICAL', 'MISMATCH'] })
  severity: LedgerDriftSeverity;
}

export class LedgerReconciliationReportDto {
  @ApiProperty({ description: '대사 실행 시각', type: String, format: 'date-time' })
  checkedAt: Date;

  @ApiProperty({ description: '불일치 grain 총 수' })
  totalDriftGrains: number;

  @ApiProperty({ description: 'CRITICAL 등급 수' })
  criticalCount: number;

  @ApiProperty({ description: '불일치 grain 목록', type: [LedgerDriftRowDto] })
  drifts: LedgerDriftRowDto[];
}
